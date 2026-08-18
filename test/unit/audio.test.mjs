// ExiEngine unit test — AudioManager (Fake AudioContext ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioManager } from "../../src/index.js";

class FakeGain {
  constructor() {
    this.gain = {
      value: 1,
      events: [],
      cancelScheduledValues(time) { this.events.push(["cancel", time]); },
      setValueAtTime(value, time) { this.events.push(["set", value, time]); this.value = value; },
      linearRampToValueAtTime(value, time) { this.events.push(["ramp", value, time]); this.value = value; },
    };
  }
  connect(target) { this.target = target; return target; }
  disconnect() { this.target = null; }
}
class FakeAudioSource {
  constructor() { this.listeners = new Map(); this.started = 0; this.stopped = 0; }
  connect(target) { this.target = target; return target; }
  disconnect() { this.target = null; }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
  start() { this.started += 1; }
  stop() { this.stopped += 1; this.listeners.get("ended")?.(); }
}
class FakePanner {
  constructor() { this.pan = { value: 0 }; }
  connect(target) { this.target = target; return target; }
  disconnect() { this.target = null; }
}
class FakeAudioContext {
  constructor() { this.destination = {}; this.state = "suspended"; }
  createGain() { return new FakeGain(); }
  createBufferSource() { return new FakeAudioSource(); }
  createStereoPanner() { this.lastPanner = new FakePanner(); return this.lastPanner; }
  decodeAudioData(value) { this.decodedBytes = value.byteLength; return Promise.resolve({ length: 4, numberOfChannels: 2 }); }
  resume() { this.state = "running"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
}

const previousAudioContext = globalThis.AudioContext;

test.beforeEach(() => { globalThis.AudioContext = FakeAudioContext; });
test.after(() => {
  if (previousAudioContext) globalThis.AudioContext = previousAudioContext;
  else delete globalThis.AudioContext;
});

const audioLoader = {
  loadBytes: async (url, options = {}) => { audioLoader.calls.push({ url, integrity: options.integrity }); return new Uint8Array(new ArrayBuffer(8), 1, 2); },
  calls: [],
};

test("audio: limitler constructor doğrulaması", () => {
  assert.throws(() => new AudioManager({ maxBytes: 0 }), /limiti/);
  assert.throws(() => new AudioManager({ maxBytes: 64 * 1024 * 1024 + 1 }), /limiti/);
  assert.throws(() => new AudioManager({ maxDecodedBytes: 0 }), /limit/);
  assert.throws(() => new AudioManager({ maxDecodedBytes: 512 * 1024 * 1024 + 1 }), /limit/);
  assert.throws(() => new AudioManager({ maxVoices: 0 }), /voice/);
  assert.throws(() => new AudioManager({ maxVoices: 257 }), /voice/);
  const probe = new AudioManager();
  probe.maxBytes = Number.MAX_SAFE_INTEGER;
  assert.throws(() => probe.ensureContext(), (error) => error?.code === "EXI_AUDIO_CONFIG");
  probe.maxBytes = 8 * 1024 * 1024;
  probe.maxDecodedBytes = Number.MAX_SAFE_INTEGER;
  assert.throws(() => probe.ensureContext(), (error) => error?.code === "EXI_AUDIO_CONFIG");
  probe.maxDecodedBytes = 256 * 1024 * 1024;
  probe.maxVoices = 256;
  assert.throws(() => probe.ensureContext(), (error) => error?.code === "EXI_AUDIO_CONFIG");
  probe.destroy();
});

test("audio: load / unload / voice lifecycle", async () => {
  audioLoader.calls = [];
  const audio = new AudioManager({ loader: audioLoader, maxDecodedBytes: 32 });
  await assert.rejects(() => audio.load("a".repeat(257), "/too-long.ogg"), /limiti/);
  await audio.load("beep", "/beep.ogg", { integrity: "sha256-audio" });
  assert.equal(audioLoader.calls.find(({ url }) => url === "/beep.ogg").integrity, "sha256-audio");
  assert.equal(audio.decodedBytes, 32);
  await assert.rejects(() => audio.load("music", "/music.ogg"), /total decoded/);
  const voice = audio.play("beep", { loop: true, volume: 0, pan: -0.5 });
  assert.equal(audio.context.lastPanner.pan.value, -0.5);
  assert.equal(audio.voiceCount, 1);
  assert.equal(audio.stopVoice(voice), true);
  assert.equal(audio.voiceCount, 0);
  assert.equal(audio.stopVoice(voice), false);
  await audio.load("beep", "/beep-reloaded.ogg");
  assert.equal(voice.stopped, 1);
  const voice2 = audio.play("beep", { loop: true });
  assert.equal(audio.setVoiceVolume(voice2, 0.25), true);
  assert.equal(audio.voiceGains.get(voice2).gain.value, 0.25);
  assert.equal(audio.setVoicePan(voice2, 0.5), true);
  assert.equal(audio.context.lastPanner.pan.value, 0.5);
  assert.equal(audio.setVoicePan(voice2, 7), true);
  assert.equal(audio.context.lastPanner.pan.value, 1);
  assert.equal(audio.unload("beep"), true);
  assert.equal(voice2.stopped, 1);
  assert.equal(audio.voiceCount, 0);
  assert.equal(audio.decodedBytes, 0);
  assert.equal(audio.unload("beep"), false);
  audio.destroy();
});

test("audio: loadMany batch ve progress", async () => {
  audioLoader.calls = [];
  const audio = new AudioManager({ loader: audioLoader, maxDecodedBytes: 128 });
  const progress = [];
  const batch = await audio.loadMany([
    { name: "click", url: "/click.ogg", integrity: "sha256-batch" },
    { name: "ambient", url: "/ambient.ogg" },
  ], { maxConcurrent: 99, onProgress: (event) => progress.push(event) });
  assert.equal(batch.results.size, 2);
  assert.equal(batch.errors.size, 0);
  assert.deepEqual([...batch.results.keys()].sort(), ["ambient", "click"]);
  assert.deepEqual(progress.map(({ loaded, total }) => [loaded, total]).sort(), [[1, 2], [2, 2]]);
  assert.equal(audioLoader.calls.find(({ url }) => url === "/click.ogg").integrity, "sha256-batch");
  assert.equal(audio.decodedBytes, 64);
  await assert.rejects(() => audio.loadMany([{ name: "duplicate", url: "/a.ogg" }, { name: "duplicate", url: "/b.ogg" }]), /tekrar/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => audio.loadMany([{ name: "cancelled", url: "/cancelled.ogg" }], { signal: abort.signal }), /iptal edildi|aborted/);
  audio.destroy();
});

test("audio: voice limiti", () => {
  const audio = new AudioManager({ maxVoices: 1 });
  const buffer = { length: 1, numberOfChannels: 1 };
  const voice = audio.play(buffer);
  assert.equal(audio.voiceCount, 1);
  assert.throws(() => audio.play(buffer), /voice limiti/);
  assert.equal(audio.stopVoice(voice), true);
  audio.destroy();
});

test("audio: StereoPanner yoksa pan hatası", () => {
  class NoPannerContext extends FakeAudioContext {
    createStereoPanner() { return null; }
  }
  globalThis.AudioContext = NoPannerContext;
  const audio = new AudioManager();
  assert.throws(() => audio.play({ length: 1, numberOfChannels: 1 }, { pan: 1 }), /StereoPanner/);
  audio.destroy();
  globalThis.AudioContext = FakeAudioContext;
});

test("audio: destroy sırasında pending decode reddedilir", async () => {
  let resolveDecode;
  class DeferredContext extends FakeAudioContext {
    decodeAudioData() { return new Promise((resolve) => { resolveDecode = () => resolve({ length: 4, numberOfChannels: 2 }); }); }
  }
  globalThis.AudioContext = DeferredContext;
  audioLoader.calls = [];
  const audio = new AudioManager({ loader: audioLoader });
  const pending = audio.load("late", "/late.ogg");
  for (let index = 0; index < 4 && !resolveDecode; index += 1) await Promise.resolve();
  assert.equal(typeof resolveDecode, "function");
  audio.destroy();
  resolveDecode();
  await assert.rejects(pending, /yok edilmiş/);
  assert.equal(audio.buffers.size, 0);
  globalThis.AudioContext = FakeAudioContext;
});

test("audio: shared load dedupe ve abort", async () => {
  let resolveBytes;
  let loadCalls = 0;
  const sharedLoader = {
    loadBytes: (_url, options = {}) => {
      assert.equal(options.signal, null);
      loadCalls += 1;
      return new Promise((resolve) => { resolveBytes = () => resolve(new Uint8Array([1, 2])); });
    },
  };
  const audio = new AudioManager({ loader: sharedLoader });
  const abort = new AbortController();
  const aborted = audio.load("shared", "/shared.ogg", { signal: abort.signal });
  for (let index = 0; index < 4 && !resolveBytes; index += 1) await Promise.resolve();
  const surviving = audio.load("shared", "/shared.ogg");
  abort.abort();
  await assert.rejects(aborted, /AbortError/);
  // Pending load varken farklı URL ile aynı isim → "zaten yükleniyor" (rejected promise)
  await assert.rejects(audio.load("shared", "/other.ogg"), /zaten yükleniyor/);
  resolveBytes();
  await surviving;
  assert.equal(loadCalls, 1);
  audio.destroy();
});

test("audio: bus volume / mute / fade", async () => {
  const audio = new AudioManager();
  audio.ensureContext();
  assert.equal(audio.getBusVolume("master"), 1);
  audio.setBusVolume("music", 0.4);
  assert.equal(audio.getBusVolume("music"), 0.4);
  assert.equal(audio.isBusMuted("music"), false);
  audio.setBusMuted("music");
  assert.equal(audio.isBusMuted("music"), true);
  assert.equal(audio.getBus("music").gain.gain.value, 0);
  audio.setBusVolume("music", 0.7);
  assert.equal(audio.getBus("music").gain.gain.value, 0);
  audio.setBusMuted("music", false);
  assert.equal(audio.getBus("music").gain.gain.value, 0.7);
  audio.fadeBus("music", 0.2, 1.5);
  assert.equal(audio.getBusVolume("music"), 0.2);
  assert.deepEqual(audio.getBus("music").gain.gain.events.slice(-3).map(([type]) => type), ["cancel", "set", "ramp"]);
  audio.setBusMuted("music");
  audio.fadeBus("music", 0.3, 1);
  assert.equal(audio.getBus("music").gain.gain.value, 0);
  audio.setBusMuted("music", false);
  assert.equal(audio.getBus("music").gain.gain.value, 0.3);
  await audio.unlock();
  audio.destroy();
});

test("audio: custom bus ve limitler", () => {
  const audio = new AudioManager();
  audio.createBus("voice", { volume: 0.5, parent: null });
  audio.ensureContext();
  assert.equal(audio.getBusVolume("voice"), 0.5);
  assert.equal(audio.getBusVolume("master"), 1);
  assert.throws(() => audio.createBus("b".repeat(65)), /geçersiz/);
  for (let index = 0; index < 60; index += 1) audio.createBus(`bus-${index}`);
  assert.throws(() => audio.createBus("bus-overflow"), /limiti/);
  audio.destroy();
});
