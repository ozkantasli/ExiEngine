// StateMachine / Sentinel — explicit state-machine infrastructure tests
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  StateMachine,
  InvalidStateTransitionError,
  UNINITIALIZED,
  NONE,
  CONSUMED,
  isSentinel,
  Tween,
  AnimatedSprite,
  Texture,
} from "../../src/index.js";

function makeMachine() {
  return new StateMachine({
    name: "test",
    initial: "idle",
    states: {
      idle: { on: { arm: "armed", reset: "idle" } },
      armed: { on: { fire: "idle" } },
    },
  });
}

test("stateMachine: initial/state/can/events contract", () => {
  const machine = makeMachine();
  assert.equal(machine.state, "idle");
  assert.ok(machine.is("idle"));
  assert.ok(machine.can("arm"));
  assert.ok(!machine.can("fire"));
  assert.deepEqual([...machine.events].sort(), ["arm", "reset"]);
  assert.equal(machine.transitions.length, 3);
});

test("stateMachine: send returns the target state and applies the transition", () => {
  const machine = makeMachine();
  assert.equal(machine.send("arm"), "armed");
  assert.equal(machine.state, "armed");
  assert.ok(machine.can("fire"));
  assert.equal(machine.send("fire"), "idle");
});

test("stateMachine: same-state re-arm is legal", () => {
  const machine = makeMachine();
  assert.equal(machine.send("reset"), "idle");
});

test("stateMachine: an invalid transition throws InvalidStateTransitionError", () => {
  const machine = makeMachine();
  assert.throws(() => machine.send("fire"), (error) => {
    assert.ok(error instanceof InvalidStateTransitionError);
    assert.equal(error.code, "EXI_INVALID_STATE_TRANSITION");
    assert.equal(error.from, "idle");
    assert.equal(error.event, "fire");
    assert.equal(error.machine, "test");
    return true;
  });
  assert.equal(machine.state, "idle");
});

test("stateMachine: transition table validation and listeners", () => {
  assert.throws(() => new StateMachine({ name: "bad", initial: "a", states: { a: { on: { go: "missing" } } } }), RangeError);
  assert.throws(() => new StateMachine({ name: "bad", initial: "missing", states: { a: { on: {} } } }), RangeError);
  const machine = makeMachine();
  const seen = [];
  const off = machine.onTransition(({ from, to, event, machine: name }) => seen.push([name, from, event, to]));
  machine.send("arm");
  off();
  machine.send("fire");
  assert.deepEqual(seen, [["test", "idle", "arm", "armed"]]);
  const failing = makeMachine();
  failing.onTransition(() => { throw new Error("listener exploded"); });
  assert.equal(failing.send("arm"), "armed");
  assert.equal(typeof machine.clone().state, "string");
});

test("sentinel: UNINITIALIZED/NONE/CONSUMED are unique and isSentinel is consistent", () => {
  assert.notEqual(UNINITIALIZED, NONE);
  assert.notEqual(UNINITIALIZED, CONSUMED);
  assert.notEqual(NONE, CONSUMED);
  for (const sentinel of [UNINITIALIZED, NONE, CONSUMED]) {
    assert.ok(isSentinel(sentinel));
    assert.ok(!isSentinel(null));
    assert.ok(!isSentinel(undefined));
    assert.ok(!isSentinel(0));
    assert.ok(!isSentinel("exi.none"));
  }
});

test("tween: finished is derived from the explicit player state machine", () => {
  const target = { value: 0 };
  const tween = new Tween(target, "value", 10, 1, { loop: 0, ease: (value) => value });
  assert.equal(tween.finished, false);
  tween.update(2);
  assert.equal(tween.finished, true);
  assert.equal(tween.update(1), false);
});

test("animatedSprite: the phase machine keeps the play/stop/complete/reopen flow", () => {
  const texture = new Texture({ width: 1, height: 1 });
  const sprite = new AnimatedSprite({ frames: [texture, texture], frameRate: 4, loop: false, onComplete: () => { sprite.completedHits = (sprite.completedHits || 0) + 1; } });
  assert.equal(sprite.phase, "playing");
  assert.equal(sprite.playing, true);
  assert.equal(sprite.completed, false);
  sprite.stop();
  assert.equal(sprite.phase, "stopped");
  sprite.play();
  assert.equal(sprite.phase, "playing");
  sprite.update(10);
  assert.equal(sprite.phase, "completed");
  assert.equal(sprite.completed, true);
  assert.equal(sprite.playing, false);
  sprite.stop();
  assert.equal(sprite.completed, true, "stop() must not lose the completed flag");
  sprite.gotoFrame(0);
  assert.equal(sprite.phase, "stopped", "gotoFrame completed → stopped");
  sprite.play();
  assert.equal(sprite.phase, "playing");
});
