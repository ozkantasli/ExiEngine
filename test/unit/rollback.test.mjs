// ExiEngine unit test — RollbackSession (prediction, rollback, resend, desync detection)
import { test } from "node:test";
import assert from "node:assert/strict";
import { RollbackSession, MAX_ROLLBACK_FRAMES } from "../../src/index.js";

// Deterministic toy game: each player moves by its input and bumps a shared hash.
function createGame(players) {
  let state = { positions: new Array(players).fill(0), hash: 7 };
  return {
    get state() { return state; },
    saveState: () => JSON.parse(JSON.stringify(state)),
    loadState: (snapshot) => { state = JSON.parse(JSON.stringify(snapshot)); },
    step: (inputs, frame) => {
      inputs.forEach((input, player) => {
        state.positions[player] += input?.dx ?? 0;
        state.hash = (state.hash * 31 + (input?.dx ?? 0) * (player + 1) + frame) % 1_000_003;
      });
    },
  };
}

// Pseudo-random but reproducible input script per player.
const inputAt = (player, frame) => ({ dx: ((frame * 7 + player * 3) % 5) - 2 });

// A lossy, reordering, delayed network between sessions.
function createNetwork({ latency = 4, jitter = 3, loss = 0.25, seed = 1 } = {}) {
  let random = seed;
  const next = () => { random = (random * 1_103_515_245 + 12_345) % 2_147_483_648; return random / 2_147_483_648; };
  const queue = [];
  return {
    send(to, message, tick) {
      if (next() < loss) return;
      queue.push({ to, message: JSON.parse(JSON.stringify(message)), at: tick + latency + Math.floor(next() * jitter) });
    },
    deliver(tick, sessions) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].at > tick) continue;
        const [{ to, message }] = queue.splice(index, 1);
        sessions[to].receive(message);
      }
    },
  };
}

function runMatch({ players = 2, frames = 240, inputDelay = 2, maxRollback = 12, network }) {
  const games = Array.from({ length: players }, () => createGame(players));
  let tick = 0;
  const sessions = games.map((game, local) => new RollbackSession({
    players, localPlayer: local, inputDelay, maxRollback, defaultInput: { dx: 0 },
    saveState: game.saveState, loadState: game.loadState, step: game.step,
    checksum: (snapshot) => snapshot.hash,
    send: (message) => { for (let peer = 0; peer < players; peer += 1) if (peer !== local) network.send(peer, message, tick); },
  }));
  // Every peer ticks at the same rate; a stalled peer retries the same frame.
  for (tick = 0; tick < frames * 4 && sessions.some((session) => session.frame < frames); tick += 1) {
    network.deliver(tick, sessions);
    sessions.forEach((session, local) => {
      if (session.frame >= frames) { session.flush(); return; }
      session.addLocalInput(inputAt(local, session.frame + inputDelay));
      session.advance();
    });
  }
  // Let late messages arrive, then apply any final rollback without stepping further.
  for (let extra = 0; extra < 40; extra += 1) { tick += 1; network.deliver(tick, sessions); sessions.forEach((session) => { session.flush(); }); }
  sessions.forEach((session) => session.synchronize());
  return { games, sessions };
}

function referenceRun(players, frames, inputDelay) {
  const game = createGame(players);
  for (let frame = 0; frame < frames + 1; frame += 1) {
    game.step(Array.from({ length: players }, (_, player) => (frame < inputDelay ? { dx: 0 } : inputAt(player, frame))), frame);
  }
  return game.state;
}

test("rollback: two peers over a lossy, reordering network converge to the reference simulation", () => {
  const { games, sessions } = runMatch({ network: createNetwork() });
  const frames = Math.min(...sessions.map((session) => session.frame));
  assert.ok(frames >= 240);
  assert.deepEqual(games[0].state, games[1].state, "both peers agree");
  assert.deepEqual(games[0].state, referenceRun(2, sessions[0].frame - 1, 2), "and match a run with every input known up front");
  const stats = sessions.map((session) => session.stats);
  assert.ok(stats.some((item) => item.predictions > 0), "remote inputs were predicted");
  assert.ok(stats.some((item) => item.rollbacks > 0), "mispredictions were rolled back");
  assert.equal(stats[0].desyncs + stats[1].desyncs, 0);
});

test("rollback: four players and a perfect network never roll back", () => {
  const { games, sessions } = runMatch({ players: 4, frames: 120, network: createNetwork({ latency: 0, jitter: 1, loss: 0 }) });
  for (const game of games.slice(1)) assert.deepEqual(game.state, games[0].state);
  assert.equal(sessions.reduce((sum, session) => sum + session.stats.rollbacks, 0), 0);
});

test("rollback: a silent peer stalls the session after maxRollback frames", () => {
  const game = createGame(2);
  const session = new RollbackSession({ inputDelay: 1, maxRollback: 3, saveState: game.saveState, loadState: game.loadState, step: game.step });
  let advanced = 0;
  for (let index = 0; index < 10; index += 1) { session.addLocalInput({ dx: 1 }); if (session.advance()) advanced += 1; }
  assert.equal(advanced, 4, "frames 0..3: confirmed frame 0 + 3 predicted");
  assert.ok(session.stats.stalls > 0);
  session.receive({ type: "exi-rollback", player: 1, start: 1, inputs: [{ dx: 0 }, { dx: 0 }, { dx: 0 }, { dx: 0 }], acks: [] });
  assert.equal(session.advance(), true, "confirmed inputs release the stall");
});

test("rollback: desyncs are reported through checksums", () => {
  const desyncs = [];
  const game = createGame(2);
  const session = new RollbackSession({ inputDelay: 0, saveState: game.saveState, loadState: game.loadState, step: game.step, checksum: (snapshot) => snapshot.hash, onDesync: (event) => desyncs.push(event) });
  for (let frame = 0; frame < 6; frame += 1) {
    session.addLocalInput({ dx: 1 });
    session.receive({ type: "exi-rollback", player: 1, start: frame, inputs: [{ dx: 0 }], acks: [] });
    session.advance();
  }
  const [frame] = [...session.checksums.keys()];
  session.receive({ type: "exi-rollback", player: 1, start: 0, inputs: [], acks: [], checksum: { frame, value: -1 } });
  assert.equal(desyncs.length, 1);
  assert.equal(desyncs[0].frame, frame);
});

test("rollback: configuration and messages are validated", () => {
  const game = createGame(2);
  const base = { saveState: game.saveState, loadState: game.loadState, step: game.step };
  assert.throws(() => new RollbackSession({}), /saveState/);
  assert.throws(() => new RollbackSession({ ...base, players: 0 }), /players/);
  assert.throws(() => new RollbackSession({ ...base, localPlayer: 2 }), /localPlayer/);
  assert.throws(() => new RollbackSession({ ...base, maxRollback: MAX_ROLLBACK_FRAMES + 1 }), /maxRollback/);
  assert.throws(() => new RollbackSession({ ...base, send: 1 }), /send/);
  const session = new RollbackSession(base);
  assert.throws(() => session.receive(null), /unknown message/);
  assert.throws(() => session.receive({ type: "exi-rollback", player: 0, start: 0, inputs: [] }), /local player/);
  assert.throws(() => session.receive({ type: "exi-rollback", player: 1, start: -1, inputs: [] }), /start/);
  assert.throws(() => session.receive({ type: "exi-rollback", player: 1, start: 0, inputs: new Array(65).fill(0) }), /at most 64/);
  assert.throws(() => session.addLocalInput("x".repeat(2_000)), /JSON data/);
  assert.throws(() => session.addLocalInput(() => 1), /JSON data/);
});
