// ExiEngine unit test — AudioManager slices, audio sprites, loop regions, playbackRate and 2D spatial audio
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioManager } from "../../src/index.js";

class FakeParam { constructor(value) { this.value = value; } }
class FakeNode { connect(target) { this.target = target; return target; } disconnect() { this.target = null; } }
class FakeGain extends FakeNode { constructor() { super(); this.gain = new FakeParam(1); } }
class FakePanner extends FakeNode { constructor() { super(); this.pan = new FakeParam(0); } }
class FakeSource extends FakeNode {
  constructor() { super(); this.playbackRate = new FakeParam(1); this.starts = []; this.listeners = new Map(); }
  start(...args) { this.starts.push(args); }
  stop() { this.listeners.get("ended")?.(); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
}
class FakeContext {
  constructor() { this.destination = {}; this.currentTime = 0; }
  createGain() { return new FakeGain(); }
  createBufferSource() { return new FakeSource(); }
  createStereoPanner() { return new FakePanner(); }
  resume() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
const previous = globalThis.AudioContext;
test.beforeEach(() => { globalThis.AudioContext = FakeContext; });
test.after(() => { if (previous) globalThis.AudioContext = previous; else delete globalThis.AudioContext; });

function managerWithBuffer(duration = 10) {
  const audio = new AudioManager();
  audio.ensureContext();
  audio.buffers.set("sfx", { duration, length: duration * 44_100, numberOfChannels: 1 });
  return audio;
}

test("audio sprites: named slices play the right region and loop regions loop", () => {
  const audio = managerWithBuffer();
  audio.addSprites("sfx", { jump: { start: 1, duration: 0.5 }, coin: { start: 2, end: 2.25 }, engine: { start: 4, duration: 2, loop: true } });
  assert.ok(audio.hasSprite("jump"));
  const jump = audio.play("jump");
  assert.deepEqual(jump.starts[0], [0, 1, 0.5]);
  const coin = audio.play("coin", { offset: 0.1 });
  assert.deepEqual(coin.starts[0].map((value) => Math.round(value * 1000) / 1000), [0, 2.1, 0.15]);
  const engine = audio.play("engine");
  assert.equal(engine.loop, true);
  assert.deepEqual([engine.loopStart, engine.loopEnd], [4, 6]);
  assert.deepEqual(engine.starts[0], [0, 4]);
  const plain = audio.play("sfx");
  assert.deepEqual(plain.starts[0], [], "the default path still calls start() without arguments");
  const region = audio.play("sfx", { loopStart: 1, loopEnd: 3, playbackRate: 1.5 });
  assert.equal(region.loop, true);
  assert.equal(region.playbackRate.value, 1.5);
  assert.ok(audio.setVoicePlaybackRate(region, 100));
  assert.equal(region.playbackRate.value, 16);
  assert.ok(audio.removeSprite("jump"));
  assert.throws(() => audio.play("jump"), /not found/);
  audio.destroy();
});

test("audio sprites: definitions and play options are validated", () => {
  const audio = managerWithBuffer(2);
  assert.throws(() => audio.addSprites("sfx", null), /object/);
  assert.throws(() => audio.addSprites("sfx", { bad: { start: 1 } }), /duration/);
  assert.throws(() => audio.addSprites("sfx", { bad: { start: 1, end: 0.5 } }), /duration/);
  assert.throws(() => audio.addSprites("sfx", { bad: { start: -1, duration: 1 } }), /seconds/);
  assert.throws(() => audio.play("sfx", { offset: 5 }), /past the end/);
  assert.throws(() => audio.play("sfx", { duration: 0 }), /seconds/);
  assert.throws(() => audio.play("sfx", { loopStart: 1, loopEnd: 1 }), /loopEnd/);
  assert.throws(() => audio.play("sfx", { loopEnd: 3 }), /loopEnd/);
  assert.throws(() => audio.play("sfx", { playbackRate: 0 }), /playbackRate/);
  assert.throws(() => audio.play("sfx", { position: { x: NaN, y: 0 } }), /coordinate/);
  assert.equal(audio.voiceCount, 0, "rejected plays leave no voices behind");
  audio.addSprites("missing", { ghost: { start: 0, duration: 1 } });
  assert.throws(() => audio.play("ghost"), /not found/);
  audio.destroy();
});

test("spatial audio: distance attenuation and pan follow the listener", () => {
  const audio = managerWithBuffer();
  audio.configureSpatial({ refDistance: 100, maxDistance: 500, panDistance: 200 });
  audio.setListener(0, 0);
  const near = audio.play("sfx", { position: { x: 50, y: 0 }, volume: 0.8 });
  const nearRecord = audio.voices.get(near);
  assert.equal(nearRecord.gain.gain.value, 0.8, "inside refDistance plays at full volume");
  assert.equal(nearRecord.panner.pan.value, 0.25);
  const far = audio.play("sfx", { position: { x: -300, y: 0 } });
  const farRecord = audio.voices.get(far);
  assert.equal(farRecord.gain.gain.value, 0.5, "halfway between ref and max distance");
  assert.equal(farRecord.panner.pan.value, -1);
  audio.setListener(-300, 0);
  assert.equal(farRecord.gain.gain.value, 1);
  assert.equal(farRecord.panner.pan.value, 0);
  assert.ok(Math.abs(nearRecord.gain.gain.value - 0.3) < 1e-9, "350 units away: 0.8 * 0.375");
  audio.setListener(-600, 0);
  assert.equal(nearRecord.gain.gain.value, 0, "past maxDistance is silent");
  audio.setListener(-300, 0);
  assert.ok(audio.setVoicePosition(far, -300, 250));
  assert.equal(farRecord.gain.gain.value, 0.625);
  audio.setVoiceVolume(far, 0.5);
  assert.equal(farRecord.gain.gain.value, 0.3125, "volume and attenuation multiply");
  assert.throws(() => audio.configureSpatial({ refDistance: 10, maxDistance: 5 }), /refDistance/);
  assert.equal(audio.setVoicePosition({}, 0, 0), false);
  audio.destroy();
});
