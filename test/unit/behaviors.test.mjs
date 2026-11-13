// ExiEngine unit test — data-driven behaviours (node.data.behaviors) and keyframes
import { test } from "node:test";
import assert from "node:assert/strict";
import { BEHAVIOR_TYPES, BehaviorSystem, Camera, Node, Scene, applyKeyframes, deserializeScene, describeBehaviors, normalizeBehavior, normalizeBehaviors, sampleKeyframes, serializeScene } from "../../src/index.js";

const near = (actual, expected, label, epsilon = 1e-6) => assert.ok(Math.abs(actual - expected) < epsilon, `${label}: ${actual} != ${expected}`);
function run(system, seconds, step = 1 / 60) { for (let time = 0; time < seconds - 1e-9; time += step) system.update(step); }

test("behaviors: definitions are validated, defaulted and described", () => {
  assert.deepEqual(normalizeBehavior({ type: "rotate" }), { type: "rotate", speed: 1 });
  assert.deepEqual(normalizeBehavior({ type: "oscillate", amplitude: 4 }), { type: "oscillate", axis: "y", amplitude: 4, period: 2, phase: 0 });
  assert.throws(() => normalizeBehavior({ type: "teleport" }), /Unknown behaviour/);
  assert.throws(() => normalizeBehavior({ type: "rotate", speed: 1e9 }), /between/);
  assert.throws(() => normalizeBehavior({ type: "rotate", speed: "fast" }), /finite/);
  assert.throws(() => normalizeBehavior({ type: "oscillate", axis: "z" }), /one of/);
  assert.throws(() => normalizeBehavior([]), /object/);
  assert.throws(() => normalizeBehaviors({}), /array/);
  assert.throws(() => normalizeBehaviors(new Array(17).fill({ type: "rotate" })), /at most 16/);
  assert.throws(() => normalizeBehavior({ type: "keyframes", duration: 1, tracks: { color: [[0, 1]] } }), /not one of/);
  assert.throws(() => normalizeBehavior({ type: "keyframes", duration: 1, tracks: { x: [[2, 1]] } }), /outside/);
  assert.throws(() => normalizeBehavior({ type: "keyframes", tracks: { x: [] } }), /non-empty/);
  assert.throws(() => normalizeBehavior({ type: "keyframes", tracks: { x: [[0, 1, 2]] } }), /\[time, value\]/);
  assert.throws(() => normalizeBehavior({ type: "keyframes", tracks: { x: new Array(300).fill([0, 0]) } }), /at most 256/);
  const sorted = normalizeBehavior({ type: "keyframes", duration: 2, tracks: { x: [[2, 20], [0, 0]] } });
  assert.deepEqual(sorted.tracks.x, [[0, 0], [2, 20]], "keys are sorted by time");
  const description = describeBehaviors();
  assert.deepEqual(Object.keys(description), [...BEHAVIOR_TYPES]);
  assert.equal(description.oscillate.params.axis.kind, "choice");
  description.oscillate.params.axis.values.push("z");
  assert.equal(describeBehaviors().oscillate.params.axis.values.length, 2, "descriptions are copies");
});

test("behaviors: move, rotate, oscillate, pulse and blink drive nodes over time", () => {
  const scene = new Scene();
  const mover = new Node({ x: 0, y: 0, data: { behaviors: [{ type: "move", vx: 30, vy: -10 }, { type: "rotate", speed: 2 }] } });
  const bob = new Node({ x: 50, y: 100, data: { behaviors: [{ type: "oscillate", axis: "y", amplitude: 10, period: 2 }] } });
  const heart = new Node({ scaleX: 2, scaleY: 2, data: { behaviors: [{ type: "pulse", amount: 0.5, period: 1 }] } });
  const lamp = new Node({ data: { behaviors: [{ type: "blink", period: 1, duty: 0.25 }] } });
  const plain = new Node({ data: { note: "no behaviours" } });
  scene.add(mover, bob, heart, plain);
  mover.add(lamp);
  const system = new BehaviorSystem();
  assert.equal(system.attach(scene), 5);
  assert.equal(system.entries.length, 4);
  run(system, 1);
  near(mover.position.x, 30, "move x", 1e-3); near(mover.position.y, -10, "move y", 1e-3); near(mover.rotation, 2, "rotate", 1e-3);
  run(system, 0.5);
  near(system.time, 1.5, "time", 1e-6);
  near(bob.position.y, 100 + Math.sin(1.5 / 2 * Math.PI * 2) * 10, "oscillate y", 1e-6);
  near(bob.position.x, 50, "oscillate keeps the other axis");
  near(heart.scale.x, 2 * (1 + Math.sin(1.5 * Math.PI * 2) * 0.5), "pulse", 1e-6);
  assert.equal(lamp.visible, (1.5 % 1) < 0.25);
  system.update(0.8); // time 2.3 → 0.3 into the period → hidden
  assert.equal(lamp.visible, false);
  system.update(0.75); // 3.05 → visible
  assert.equal(lamp.visible, true);
  mover.destroy();
  system.update(1 / 60);
  assert.equal(system.entries.length, 2, "destroyed nodes are dropped");
  system.update(NaN); system.update(-1); system.update(Infinity);
  assert.ok(Number.isFinite(system.time), "bad deltas are ignored");
});

test("behaviors: keyboard-move reads arrows/WASD, camera-follow follows, bad data is reported", () => {
  // BehaviorSystem only needs isKeyDown, so a stand-in replaces the DOM-bound Input.
  const keys = new Set();
  const input = { isKeyDown: (code) => keys.has(code), inject(events) { for (const event of events) event.type === "keydown" ? keys.add(event.code) : keys.delete(event.code); } };
  const camera = new Camera();
  const scene = new Scene();
  const hero = new Node({ name: "hero", data: { behaviors: [{ type: "keyboard-move", speed: 100 }, { type: "camera-follow", smoothing: 0.5 }] } });
  const broken = new Node({ name: "broken", data: { behaviors: [{ type: "explode" }] } });
  scene.add(hero, broken);
  const system = new BehaviorSystem({ input, camera });
  system.attach(scene);
  assert.equal(system.errors.length, 1);
  assert.match(system.errors[0].message, /explode/);
  assert.equal(system.errors[0].node, "broken");
  input.inject([{ type: "keydown", code: "KeyD" }, { type: "keydown", code: "ArrowDown" }]);
  run(system, 1);
  near(hero.position.x, 100 / Math.SQRT2, "diagonal x is normalized", 1e-3);
  near(hero.position.y, 100 / Math.SQRT2, "diagonal y", 1e-3);
  assert.equal(camera.followTarget, hero);
  input.inject([{ type: "keyup", code: "KeyD" }, { type: "keyup", code: "ArrowDown" }]);
  const resting = hero.position.x;
  run(system, 0.5);
  assert.equal(hero.position.x, resting);
  const horizontal = new BehaviorSystem({ input });
  const walker = new Node({ data: { behaviors: [{ type: "keyboard-move", speed: 10, vertical: false }] } });
  horizontal.attach(walker);
  input.inject([{ type: "keydown", code: "KeyW" }]);
  run(horizontal, 1);
  assert.equal(walker.position.y, 0, "vertical: false ignores up/down");
  const noInput = new BehaviorSystem();
  const idle = new Node({ data: { behaviors: [{ type: "keyboard-move" }] } });
  noInput.attach(idle); noInput.update(1);
  assert.equal(idle.position.x, 0, "without input keyboard-move does nothing");
});

test("behaviors: keyframes interpolate tracks with loop, once, pingpong and smooth easing", () => {
  const base = { type: "keyframes", duration: 2, tracks: { x: [[0, 0], [1, 100], [2, 0]], alpha: [[0, 1], [2, 0]], rotation: [[1, 3]] } };
  const linear = normalizeBehavior(base);
  near(sampleKeyframes(linear, "x", 0.5), 50, "linear midpoint");
  near(sampleKeyframes(linear, "x", 1.5), 50, "second segment");
  near(sampleKeyframes(linear, "rotation", 0), 3, "a single key holds its value");
  assert.equal(sampleKeyframes(linear, "y", 1), undefined, "untracked properties are left alone");
  const smooth = normalizeBehavior({ ...base, ease: "smooth" });
  near(sampleKeyframes(smooth, "x", 0.25), 100 * (0.25 * 0.25 * (3 - 0.5)), "smoothstep");
  const node = new Node({ y: 7 });
  applyKeyframes(node, linear, 1);
  assert.deepEqual([node.position.x, node.position.y, node.rotation], [100, 7, 3]);
  near(node.alpha, 0.5, "alpha");
  const looping = new Node({ data: { behaviors: [base] } });
  const once = new Node({ data: { behaviors: [{ ...base, mode: "once" }] } });
  const pingpong = new Node({ data: { behaviors: [{ ...base, duration: 2, mode: "pingpong", tracks: { x: [[0, 0], [2, 100]] } }] } });
  const scene = new Scene(); scene.add(looping, once, pingpong);
  const system = new BehaviorSystem(); system.attach(scene);
  system.update(2.5);
  near(looping.position.x, 50, "loop wraps to 0.5 s");
  near(once.position.x, 0, "once holds the last key");
  near(pingpong.position.x, 75, "pingpong runs backwards (1.5 s)");
});

test("behaviors: definitions survive scene documents", () => {
  const scene = new Scene();
  scene.add(new Node({ name: "spinner", data: { behaviors: [{ type: "rotate", speed: 3 }, { type: "keyframes", duration: 1, tracks: { y: [[0, 0], [1, 10]] } }] } }));
  const loaded = deserializeScene(JSON.parse(JSON.stringify(serializeScene(scene))));
  const system = new BehaviorSystem();
  assert.equal(system.attach(loaded), 2);
  system.update(0.5);
  const spinner = loaded.findByName("spinner");
  near(spinner.rotation, 1.5, "rotation after load");
  near(spinner.position.y, 5, "keyframes after load");
});
