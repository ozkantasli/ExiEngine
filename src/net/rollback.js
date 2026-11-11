// Transport-agnostic rollback netcode (GGPO-style) for deterministic games.
//
// The game provides three pure callbacks: saveState() -> snapshot,
// loadState(snapshot) and step(inputs, frame) which advances exactly one fixed
// frame. Local inputs are scheduled `inputDelay` frames ahead and sent through
// `send(message)`; messages from peers go into receive(message). When a remote
// input is missing the session predicts it (the last known input repeats);
// when the real input arrives and differs, the session reloads the snapshot of
// that frame and re-simulates up to the present. Messages repeat every input
// the peer has not acknowledged yet, so packet loss and reordering are fine.
// ExiEngine's fixed step and deterministic physics make step() reproducible.

export const MAX_ROLLBACK_PLAYERS = 8;
export const MAX_ROLLBACK_FRAMES = 60;
const MAX_INPUT_JSON_LENGTH = 1_024;
const MAX_MESSAGE_INPUTS = 64;
const MAX_FRAME = 2 ** 31;

function cloneInput(value) {
  const json = JSON.stringify(value === undefined ? null : value);
  if (json === undefined || json.length > MAX_INPUT_JSON_LENGTH) throw new RangeError(`Rollback input must be JSON data of at most ${MAX_INPUT_JSON_LENGTH} characters.`);
  return { json, value: JSON.parse(json) };
}

function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
  return value;
}

export class RollbackSession {
  constructor({ players = 2, localPlayer = 0, inputDelay = 2, maxRollback = 8, defaultInput = null, saveState, loadState, step, send = null, checksum = null, onDesync = null } = {}) {
    this.players = integer(players, "RollbackSession players", 1, MAX_ROLLBACK_PLAYERS);
    this.localPlayer = integer(localPlayer, "RollbackSession localPlayer", 0, this.players - 1);
    this.inputDelay = integer(inputDelay, "RollbackSession inputDelay", 0, MAX_ROLLBACK_FRAMES);
    this.maxRollback = integer(maxRollback, "RollbackSession maxRollback", 1, MAX_ROLLBACK_FRAMES);
    for (const [name, fn] of [["saveState", saveState], ["loadState", loadState], ["step", step]]) {
      if (typeof fn !== "function") throw new TypeError(`RollbackSession ${name} must be a function.`);
    }
    for (const [name, fn] of [["send", send], ["checksum", checksum], ["onDesync", onDesync]]) {
      if (fn !== null && typeof fn !== "function") throw new TypeError(`RollbackSession ${name} must be a function or null.`);
    }
    this.saveState = saveState;
    this.loadState = loadState;
    this.stepFrame = step;
    this.send = send;
    this.checksum = checksum;
    this.onDesync = onDesync;
    this.defaultInput = cloneInput(defaultInput);
    this.frame = 0; // next frame to simulate
    this.confirmed = Array.from({ length: this.players }, () => new Map()); // frame -> { json, value }
    this.lastConfirmed = new Array(this.players).fill(-1); // highest contiguous confirmed frame per player
    this.used = new Map(); // frame -> array of input json strings used when it was simulated
    this.states = new Map(); // frame -> snapshot taken before simulating it
    this.checksums = new Map(); // frame -> local checksum once the frame is fully confirmed
    this.remoteAcks = new Array(this.players).fill(-1); // highest local frame each peer has acknowledged
    this.rollbackFrom = Infinity;
    this.stats = { rollbacks: 0, resimulatedFrames: 0, predictions: 0, stalls: 0, desyncs: 0 };
    // Frames before the input delay window use the default input for everyone.
    for (let player = 0; player < this.players; player += 1) {
      for (let frame = 0; frame < this.inputDelay; frame += 1) this.confirmed[player].set(frame, this.defaultInput);
      this.lastConfirmed[player] = this.inputDelay - 1;
    }
  }

  get confirmedFrame() { return Math.min(...this.lastConfirmed); }

  // Schedules this tick's local input (inputDelay frames ahead) and sends it.
  addLocalInput(input) {
    const target = this.frame + this.inputDelay;
    const local = this.confirmed[this.localPlayer];
    if (!local.has(target)) {
      local.set(target, cloneInput(input));
      this.advanceContiguous(this.localPlayer);
    }
    this.flush();
    return target;
  }

  // Sends every local input the peers have not acknowledged yet (bounded).
  flush() {
    if (!this.send) return null;
    const ack = Math.min(...this.remoteAcks.filter((_, player) => player !== this.localPlayer), this.lastConfirmed[this.localPlayer]);
    const start = Math.max(ack + 1, this.lastConfirmed[this.localPlayer] - MAX_MESSAGE_INPUTS + 1, 0);
    const inputs = [];
    for (let frame = start; frame <= this.lastConfirmed[this.localPlayer]; frame += 1) inputs.push(this.confirmed[this.localPlayer].get(frame).value);
    const acks = this.lastConfirmed.slice();
    const message = { type: "exi-rollback", player: this.localPlayer, start, inputs, acks };
    const checkFrame = this.latestChecksumFrame();
    if (checkFrame >= 0) message.checksum = { frame: checkFrame, value: this.checksums.get(checkFrame) };
    this.send(message);
    return message;
  }

  latestChecksumFrame() {
    let latest = -1;
    for (const frame of this.checksums.keys()) if (frame > latest) latest = frame;
    return latest;
  }

  receive(message) {
    if (!message || typeof message !== "object" || message.type !== "exi-rollback") throw new TypeError("RollbackSession received an unknown message.");
    const player = integer(message.player, "Rollback message player", 0, this.players - 1);
    if (player === this.localPlayer) throw new RangeError("Rollback message claims to come from the local player.");
    const start = integer(message.start, "Rollback message start", 0, MAX_FRAME);
    if (!Array.isArray(message.inputs) || message.inputs.length > MAX_MESSAGE_INPUTS) throw new RangeError(`Rollback message inputs must be an array of at most ${MAX_MESSAGE_INPUTS}.`);
    if (Array.isArray(message.acks) && Number.isSafeInteger(message.acks[this.localPlayer])) {
      this.remoteAcks[player] = Math.max(this.remoteAcks[player], message.acks[this.localPlayer]);
    }
    const store = this.confirmed[player];
    message.inputs.forEach((input, offset) => {
      const frame = start + offset;
      if (frame <= this.lastConfirmed[player] || store.has(frame)) return;
      if (frame > this.frame + this.inputDelay + MAX_ROLLBACK_FRAMES * 2) return; // far future: ignore
      const entry = cloneInput(input);
      store.set(frame, entry);
      const used = this.used.get(frame);
      if (used && used[player] !== entry.json) this.rollbackFrom = Math.min(this.rollbackFrom, frame);
    });
    this.advanceContiguous(player);
    if (message.checksum && Number.isSafeInteger(message.checksum.frame)) {
      const local = this.checksums.get(message.checksum.frame);
      if (local !== undefined && local !== message.checksum.value) {
        this.stats.desyncs += 1;
        this.onDesync?.({ frame: message.checksum.frame, local, remote: message.checksum.value, player });
      }
    }
  }

  advanceContiguous(player) {
    const store = this.confirmed[player];
    while (store.has(this.lastConfirmed[player] + 1)) this.lastConfirmed[player] += 1;
  }

  inputFor(player, frame) {
    const exact = this.confirmed[player].get(frame);
    if (exact) return exact;
    // Prediction: repeat the most recent known input of that player.
    for (let previous = Math.min(frame - 1, this.lastConfirmed[player]); previous >= 0 && previous >= frame - MAX_ROLLBACK_FRAMES * 2; previous -= 1) {
      const known = this.confirmed[player].get(previous);
      if (known) return known;
    }
    return this.defaultInput;
  }

  simulate(frame) {
    this.states.set(frame, this.saveState());
    const entries = [];
    let predicted = false;
    for (let player = 0; player < this.players; player += 1) {
      if (!this.confirmed[player].has(frame)) predicted = true;
      entries.push(this.inputFor(player, frame));
    }
    if (predicted) this.stats.predictions += 1;
    this.used.set(frame, entries.map((entry) => entry.json));
    this.stepFrame(entries.map((entry) => entry.value), frame);
  }

  // Advances one frame. Returns false (and does nothing) when the session would
  // have to predict further than maxRollback frames ahead of confirmed inputs.
  advance() {
    this.synchronize();
    if (this.frame - this.confirmedFrame > this.maxRollback) { this.stats.stalls += 1; return false; }
    this.simulate(this.frame);
    this.frame += 1;
    this.recordChecksums();
    this.prune();
    return true;
  }

  // Applies a pending rollback (re-simulating up to the present) without
  // advancing to a new frame; advance() calls it first. Returns true if the
  // state changed.
  synchronize() {
    if (!(this.rollbackFrom < this.frame)) { this.rollbackFrom = Infinity; return false; }
    const from = this.rollbackFrom;
    this.rollbackFrom = Infinity;
    this.loadState(this.states.get(from));
    this.stats.rollbacks += 1;
    for (let frame = from; frame < this.frame; frame += 1) { this.simulate(frame); this.stats.resimulatedFrames += 1; }
    return true;
  }

  recordChecksums() {
    if (!this.checksum) return;
    // A frame's resulting state is final once every input up to it is confirmed;
    // state "after frame f" is the snapshot taken before frame f + 1.
    const final = Math.min(this.confirmedFrame, this.frame - 2);
    if (final < 0 || this.checksums.has(final)) return;
    const snapshot = this.states.get(final + 1);
    if (snapshot !== undefined) this.checksums.set(final, this.checksum(snapshot));
  }

  prune() {
    const keepFrom = Math.min(this.confirmedFrame, this.frame - 1) - 1;
    for (const map of [this.states, this.used]) for (const frame of map.keys()) if (frame < keepFrom) map.delete(frame);
    for (const frame of this.checksums.keys()) if (frame < keepFrom - MAX_ROLLBACK_FRAMES) this.checksums.delete(frame);
    const inputFloor = keepFrom - MAX_ROLLBACK_FRAMES * 2;
    for (const store of this.confirmed) for (const frame of store.keys()) if (frame < inputFloor) store.delete(frame);
  }
}
