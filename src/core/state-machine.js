// Minimal explicit state machine for ExiEngine subsystems.
//
// Many engine machines were implicit: booleans + sentinels whose legal values and
// transitions were only documented by scattered code. StateMachine makes the table
// explicit and guards every transition. Illegal transitions throw
// InvalidStateTransitionError instead of silently producing an impossible state.
//
// Declaring a transition whose target is the current state ("re-arm", "accumulate")
// is legal and fires listeners; undeclared events always throw. Machines are strict by
// default because engine invariants must never degrade into silent no-ops.
//
// Example:
//   const machine = new StateMachine({
//     name: "tween",
//     initial: "active",
//     states: { active: { on: { finish: "finished", loop: "active" } }, finished: { on: {} } },
//   });
//   machine.send("finish"); // "finished"
//   machine.send("finish"); // throws InvalidStateTransitionError
export class InvalidStateTransitionError extends Error {
  constructor(name, from, event) {
    super(`${name}: '${event}' geçişi '${from}' durumunda geçersiz.`);
    this.name = "InvalidStateTransitionError";
    this.code = "EXI_INVALID_STATE_TRANSITION";
    this.machine = name;
    this.from = from;
    this.event = event;
  }
}

function validateDefinition(name, initial, states) {
  if (typeof name !== "string" || name.length === 0) throw new TypeError("StateMachine name boş olamaz.");
  if (states === null || typeof states !== "object" || Array.isArray(states)) throw new TypeError("StateMachine states nesnesi gerekli.");
  const names = Object.keys(states);
  if (names.length === 0) throw new RangeError("StateMachine en az bir durum tanımlamalı.");
  if (!Object.prototype.hasOwnProperty.call(states, initial)) throw new RangeError(`StateMachine ilk durumu '${initial}' tanımlı değil.`);
  const cleaned = {};
  for (const stateName of names) {
    const entry = states[stateName];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`StateMachine durumu '${stateName}' nesne olmalı.`);
    const on = entry.on ?? {};
    if (on === null || typeof on !== "object" || Array.isArray(on)) throw new TypeError(`StateMachine '${stateName}' üzerindeki on tablosu nesne olmalı.`);
    const transitions = {};
    for (const [event, target] of Object.entries(on)) {
      if (typeof event !== "string" || event.length === 0) throw new TypeError(`StateMachine '${stateName}' üzerinde boş event adı.`);
      if (!Object.prototype.hasOwnProperty.call(states, target)) throw new RangeError(`StateMachine '${stateName}' için '${event}' hedef durumu '${target}' tanımlı değil.`);
      transitions[event] = target;
    }
    cleaned[stateName] = Object.freeze({ on: Object.freeze(transitions) });
  }
  return Object.freeze(cleaned);
}

export class StateMachine {
  constructor({ name = "fsm", initial, states } = {}) {
    this.name = name;
    this.states = validateDefinition(name, initial, states);
    this._state = initial;
    this._listeners = new Set();
  }

  get state() { return this._state; }
  is(state) { return this._state === state; }
  can(event) {
    const entry = this.states[this._state];
    return Object.prototype.hasOwnProperty.call(entry.on, event);
  }
  get events() { return Object.freeze(Object.keys(this.states[this._state].on)); }
  get transitions() {
    const list = [];
    for (const [from, entry] of Object.entries(this.states)) {
      for (const [event, to] of Object.entries(entry.on)) list.push({ from, event, to });
    }
    return Object.freeze(list);
  }
  onTransition(listener) {
    if (typeof listener !== "function") throw new TypeError("StateMachine listener fonksiyon olmalı.");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
  send(event) {
    if (typeof event !== "string" || event.length === 0) throw new TypeError("StateMachine event adı string olmalı.");
    const entry = this.states[this._state];
    const target = entry.on[event];
    if (target === undefined) throw new InvalidStateTransitionError(this.name, this._state, event);
    const from = this._state;
    this._state = target;
    if (this._listeners.size > 0) {
      for (const listener of [...this._listeners]) {
        try { listener({ from, to: target, event, machine: this.name }); } catch { /* listener errors must not corrupt the machine */ }
      }
    }
    return this._state;
  }
  clone() {
    const machine = new StateMachine({ name: this.name, initial: this._state, states: this.states });
    return machine;
  }
}
