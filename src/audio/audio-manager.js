const MAX_AUDIO_BUS_COUNT = 64;
const MAX_AUDIO_BUS_NAME_LENGTH = 64;
const MAX_AUDIO_KEY_LENGTH = 256;
const MAX_AUDIO_VOICES = 256;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_DECODED_BYTES = 512 * 1024 * 1024;
const MAX_AUDIO_BATCH_ENTRIES = 4_096;
const MAX_AUDIO_BATCH_CONCURRENCY = 16;
const MAX_AUDIO_FADE_DURATION = 60;
const MAX_AUDIO_SPRITES = 4_096;
const MIN_PLAYBACK_RATE = 0.0625;
const MAX_PLAYBACK_RATE = 16;
const MAX_SPATIAL_DISTANCE = 1e7;
const safeVolume = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function audioSeconds(value, label, { allowZero = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0) || number > 86_400) throw new RangeError(`${label} must be a finite number of seconds.`);
  return number;
}

function spatialNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_SPATIAL_DISTANCE) throw new RangeError(`${label} must be a finite coordinate.`);
  return number;
}

// 2D spatial audio: pan follows the horizontal offset from the listener and the
// volume falls off linearly from refDistance (full) to maxDistance (silent).
// Plain arithmetic instead of a PannerNode keeps it deterministic and cheap.
function spatialMix(settings, listener, position) {
  const dx = position.x - listener.x;
  const dy = position.y - listener.y;
  const distance = Math.hypot(dx, dy);
  const span = Math.max(1e-6, settings.maxDistance - settings.refDistance);
  const attenuation = distance <= settings.refDistance ? 1 : Math.max(0, 1 - (settings.rolloff * (distance - settings.refDistance)) / span);
  return { gain: attenuation, pan: Math.max(-1, Math.min(1, dx / settings.panDistance)) };
}
const safePan = (value) => Math.max(-1, Math.min(1, Number(value) || 0));

function normalizeAudioKey(value) {
  const key = String(value);
  if (!key || key.length > MAX_AUDIO_KEY_LENGTH) throw new RangeError("Audio key limit is invalid.");
  return key;
}

function normalizeBusName(value) {
  const id = String(value).trim();
  if (!id || id.length > MAX_AUDIO_BUS_NAME_LENGTH || /[^a-zA-Z0-9_-]/.test(id)) throw new Error("Audio bus name is invalid.");
  return id;
}

function abortReason(signal) {
  return signal?.reason || Object.assign(new Error("Audio loading was aborted."), { name: "AbortError" });
}

function waitForAbort(promise, signal) {
  if (!signal || typeof signal.addEventListener !== "function") return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener?.("abort", onAbort);
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(abortReason(signal)); };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { if (settled) return; settled = true; cleanup(); resolve(value); }, (error) => { if (settled) return; settled = true; cleanup(); reject(error); });
  });
}

function audioTime(context) {
  const time = Number(context?.currentTime);
  return Number.isFinite(time) && time >= 0 ? time : 0;
}

export class AudioManager {
  constructor({ loader = null, maxBytes = 16 * 1024 * 1024, maxDecodedBytes = 128 * 1024 * 1024, maxVoices = 64 } = {}) {
    this.loader = loader;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_AUDIO_BYTES) throw new RangeError("Audio byte limit is invalid.");
    if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0 || maxDecodedBytes > MAX_AUDIO_DECODED_BYTES) throw new RangeError("Audio decoded byte limit invalid.");
    if (!Number.isSafeInteger(maxVoices) || maxVoices <= 0 || maxVoices > MAX_AUDIO_VOICES) throw new RangeError("Audio voice limit is invalid.");
    this.maxBytes = maxBytes;
    this.maxDecodedBytes = maxDecodedBytes;
    this.maxVoices = maxVoices;
    this._maxBytesCapacity = maxBytes;
    this._maxDecodedBytesCapacity = maxDecodedBytes;
    this._maxVoicesCapacity = maxVoices;
    this.context = null;
    this.buffers = new Map();
    this.decodedSizes = new Map();
    this.decodedBytes = 0;
    this.pendingLoads = new Map();
    this.pendingLoadURLs = new Map();
    this.pendingLoadIntegrities = new Map();
    this.loadControllers = new Map();
    this.keyGenerations = new Map();
    // Tek ses kayıt tablosu: source → { buffer, gain, panner, output, cleanup, phase }.
    // Semantics: voices üyeliği "alive" demektir; cleanup() idempotent olup kaydı siler (#40).
    this.voices = new Map();
    this.sprites = new Map();
    this.listener = { x: 0, y: 0 };
    this.spatialSettings = { refDistance: 64, maxDistance: 1024, rolloff: 1, panDistance: 512 };
    this.buses = new Map();
    this.destroyed = false;
    this.generation = 0;
  }

  ensureActive() {
    if (this.destroyed) throw new Error("AudioManager has been destroyed.");
    this.assertBudget();
  }

  assertBudget() {
    if (this.maxBytes !== this._maxBytesCapacity || this.maxDecodedBytes !== this._maxDecodedBytesCapacity || this.maxVoices !== this._maxVoicesCapacity) {
      const error = new RangeError("Audio budget settings cannot be changed directly.");
      error.code = "EXI_AUDIO_CONFIG";
      throw error;
    }
  }

  ensureContext() {
    this.ensureActive();
    this.ensureContextWithoutBuses();
    if (!this.buses.has("master")) this.createBus("master", { volume: 1, parent: null });
    if (!this.buses.has("music")) this.createBus("music", { volume: 1, parent: "master" });
    if (!this.buses.has("sfx")) this.createBus("sfx", { volume: 1, parent: "master" });
    return this.context;
  }

  createBus(name, { volume = 1, parent = "master" } = {}) {
    const id = normalizeBusName(name);
    if (this.buses.has(id)) return this.buses.get(id);
    if (this.buses.size >= MAX_AUDIO_BUS_COUNT) throw new RangeError(`Audio bus limit is ${MAX_AUDIO_BUS_COUNT}.`);
    if (!this.context || (id !== "master" && !this.buses.has("master"))) this.ensureContext();
    if (this.buses.has(id)) return this.buses.get(id);
    const context = this.ensureContextWithoutBuses();
    if (parent && parent === id) throw new Error("Audio bus cannot connect to itself.");
    const parentBus = parent ? this.buses.get(parent) : null;
    if (parent && !parentBus) throw new Error(`Audio parent bus not found: ${parent}`);
    const gain = context.createGain();
    const normalizedVolume = safeVolume(volume);
    gain.gain.value = normalizedVolume;
    gain.connect(parentBus ? parentBus.gain : context.destination);
    const bus = { name: id, gain, parent: parent || null, volume: normalizedVolume, muted: false };
    this.buses.set(id, bus);
    return bus;
  }

  ensureContextWithoutBuses() {
    this.ensureActive();
    if (this.context) return this.context;
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio API is not available.");
    this.context = new AudioContextClass();
    return this.context;
  }

  getBus(name = "master") { this.ensureContext(); return this.buses.get(name) || null; }
  setBusVolume(name, volume) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus not found: ${name}`);
    bus.gain.gain.cancelScheduledValues?.(audioTime(this.context));
    bus.volume = safeVolume(volume);
    if (!bus.muted) bus.gain.gain.value = bus.volume;
    return this;
  }
  getBusVolume(name) { const bus = this.getBus(name); return bus?.volume ?? 0; }
  setBusMuted(name, muted = true) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus not found: ${name}`);
    bus.gain.gain.cancelScheduledValues?.(audioTime(this.context));
    bus.muted = Boolean(muted);
    bus.gain.gain.value = bus.muted ? 0 : bus.volume;
    return this;
  }
  isBusMuted(name) { return this.getBus(name)?.muted ?? false; }
  fadeBus(name, volume, duration = 0.25) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus not found: ${name}`);
    const requestedDuration = Number(duration);
    const fadeDuration = Number.isFinite(requestedDuration) ? Math.max(0, Math.min(MAX_AUDIO_FADE_DURATION, requestedDuration)) : 0;
    const target = safeVolume(volume);
    const param = bus.gain.gain;
    const now = audioTime(this.context);
    param.cancelScheduledValues?.(now);
    bus.volume = target;
    if (bus.muted) { param.value = 0; return this; }
    if (fadeDuration <= 0 || typeof param.setValueAtTime !== "function" || typeof param.linearRampToValueAtTime !== "function") {
      param.value = target;
      return this;
    }
    const current = Number.isFinite(Number(param.value)) ? Number(param.value) : 0;
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(target, now + fadeDuration);
    return this;
  }
  async suspend() {
    this.ensureActive();
    if (!this.context || this.context.state === "suspended" || typeof this.context.suspend !== "function") return;
    await this.context.suspend();
  }
  async resume() {
    this.ensureActive();
    if (!this.context || this.context.state === "running" || typeof this.context.resume !== "function") return;
    await this.context.resume();
  }
  async unlock() { this.ensureContext(); await this.resume(); }

  get voiceCount() { return this.voices.size; }

  // Compat views for existing consumers (tests/tools read voiceGains/activeVoices by name).
  get activeVoices() { return new Set(this.voices.keys()); }
  get voiceGains() {
    // Minimal compatibility view: existing consumers only call .get(source)?.gain / .has(source).
    return {
      get: (source) => this.voices.get(source)?.gain ?? undefined,
      has: (source) => this.voices.has(source),
    };
  }

  stopVoice(source) {
    const record = this.voices.get(source);
    if (!record) return false;
    try { source.stop?.(); } catch {}
    record.cleanup();
    return true;
  }

  stopAll() {
    for (const source of [...this.voices.keys()]) this.stopVoice(source);
    return this;
  }

  has(name) {
    return this.buffers.has(String(name));
  }

  // "Loading" used to be invisible to has() — callers could not distinguish
  // "absent" from "decode in flight". hasPending reports the pendingLoads generation.
  hasPending(name) {
    return this.pendingLoads.has(normalizeAudioKey(name));
  }

  get pendingCount() {
    return this.pendingLoads.size;
  }

  getBusNames() {
    return Array.from(this.buses.keys());
  }

  stopBus(name) {
    const bus = this.getBus(name);
    if (!bus) return 0;
    let count = 0;
    for (const [source, record] of [...this.voices]) {
      if (record.output === bus.gain) {
        this.stopVoice(source);
        count += 1;
      }
    }
    return count;
  }

  stopVoicesForBuffer(buffer) {
    if (!buffer) return this;
    for (const [source, record] of [...this.voices]) if (record.buffer === buffer) this.stopVoice(source);
    return this;
  }

  setVoiceVolume(source, volume) {
    const record = this.voices.get(source);
    if (!record) return false;
    record.volume = safeVolume(volume);
    this.applyVoiceMix(source, record);
    return true;
  }

  setVoicePan(source, pan) {
    const record = this.voices.get(source);
    if (!record) return false;
    const { gain, output } = record;
    if (!gain || !output) return false;
    const requestedPan = safePan(pan);
    let panner = record.panner;
    if (requestedPan === 0) {
      if (panner) {
        try { gain.disconnect?.(); } catch {}
        try { panner.disconnect?.(); } catch {}
        gain.connect(output);
        record.panner = null;
      }
      return true;
    }
    if (!panner) {
      panner = typeof this.context?.createStereoPanner === "function" ? this.context.createStereoPanner() : null;
      if (!panner) throw new Error("StereoPannerNode is not available.");
      try {
        panner.pan.value = requestedPan;
        gain.disconnect?.();
        gain.connect(panner);
        panner.connect(output);
      } catch (error) {
        try { panner.disconnect?.(); } catch {}
        try { gain.disconnect?.(); } catch {}
        gain.connect(output);
        throw error;
      }
      record.panner = panner;
    } else panner.pan.value = requestedPan;
    return true;
  }

  unload(name) {
    const key = normalizeAudioKey(name);
    this.keyGenerations.set(key, (this.keyGenerations.get(key) || 0) + 1);
    this.loadControllers.get(key)?.abort?.();
    this.loadControllers.delete(key);
    this.pendingLoads.delete(key);
    this.pendingLoadURLs.delete(key);
    this.pendingLoadIntegrities.delete(key);
    const buffer = this.buffers.get(key);
    if (!buffer) return false;
    this.stopVoicesForBuffer(buffer);
    this.buffers.delete(key);
    this.decodedBytes = Math.max(0, this.decodedBytes - (this.decodedSizes.get(key) || 0));
    this.decodedSizes.delete(key);
    return true;
  }

  async load(name, url, { signal = null, integrity = null } = {}) {
    this.ensureActive();
    if (!this.loader) throw new Error("AudioManager requires an AssetLoader.");
    const key = normalizeAudioKey(name);
    const requestURL = String(url);
    if (signal?.aborted) throw abortReason(signal);
    const pending = this.pendingLoads.get(key);
    if (pending) {
      if (this.pendingLoadURLs.get(key) !== requestURL || this.pendingLoadIntegrities.get(key) !== integrity) throw new Error(`Audio name is already loading: ${key}`);
      return waitForAbort(pending, signal);
    }
    const generation = this.generation;
    const keyGeneration = this.keyGenerations.get(key) || 0;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const promise = (async () => {
      const bytes = await this.loader.loadBytes(requestURL, { maxBytes: this.maxBytes, signal: null, requestSignal: controller?.signal, integrity });
      if (this.destroyed || generation !== this.generation) throw new Error("AudioManager has been destroyed.");
      if (keyGeneration !== (this.keyGenerations.get(key) || 0)) throw new Error("Audio load was invalidated.");
      const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await this.ensureContext().decodeAudioData(exactBuffer);
      if (this.destroyed || generation !== this.generation) throw new Error("AudioManager has been destroyed.");
      if (keyGeneration !== (this.keyGenerations.get(key) || 0)) throw new Error("Audio load was invalidated.");
      this.assertBudget();
      const decodedBytes = Number(buffer?.length) * Number(buffer?.numberOfChannels) * Float32Array.BYTES_PER_ELEMENT;
      if (!Number.isSafeInteger(decodedBytes) || decodedBytes <= 0 || decodedBytes > this.maxDecodedBytes) throw new RangeError("Audio decoded byte limit exceeded.");
      const previousBytes = this.decodedSizes.get(key) || 0;
      if (this.decodedBytes - previousBytes + decodedBytes > this.maxDecodedBytes) throw new RangeError("Audio total decoded byte limit exceeded.");
      const previousBuffer = this.buffers.get(key);
      if (previousBuffer && previousBuffer !== buffer) this.stopVoicesForBuffer(previousBuffer);
      this.buffers.set(key, buffer);
      this.decodedSizes.set(key, decodedBytes);
      this.decodedBytes = this.decodedBytes - previousBytes + decodedBytes;
      return buffer;
    })();
    this.pendingLoads.set(key, promise);
    this.pendingLoadURLs.set(key, requestURL);
    this.pendingLoadIntegrities.set(key, integrity);
    if (controller) this.loadControllers.set(key, controller);
    const clearPending = () => {
      if (this.pendingLoads.get(key) !== promise) return;
      this.pendingLoads.delete(key);
      this.pendingLoadURLs.delete(key);
      this.pendingLoadIntegrities.delete(key);
      if (this.loadControllers.get(key) === controller) this.loadControllers.delete(key);
    };
    promise.then(clearPending, clearPending);
    return waitForAbort(promise, signal);
  }

  async loadMany(entries, { onProgress = () => {}, signal = null, stopOnError = true, maxConcurrent = 4 } = {}) {
    this.ensureActive();
    if (!Array.isArray(entries)) throw new TypeError("Audio list must be an array.");
    if (entries.length > MAX_AUDIO_BATCH_ENTRIES) throw new RangeError(`Audio batch limit is ${MAX_AUDIO_BATCH_ENTRIES}.`);
    if (typeof onProgress !== "function") throw new TypeError("Audio progress callback function is required.");
    const total = entries.length;
    const results = new Map();
    const errors = new Map();
    const seen = new Set();
    let cursor = 0;
    let loaded = 0;
    const workerCount = Math.max(1, Math.min(total || 1, MAX_AUDIO_BATCH_CONCURRENCY, Math.floor(maxConcurrent) || 1));

    const loadEntry = async (entry) => {
      if (!entry || typeof entry.name !== "string" || !entry.name || entry.name.length > MAX_AUDIO_KEY_LENGTH || typeof entry.url !== "string" || !entry.url) throw new TypeError("Audio name or URL is invalid.");
      const name = normalizeAudioKey(entry.name);
      if (seen.has(name)) throw new Error(`Duplicate audio name: ${name}`);
      seen.add(name);
      return this.load(name, entry.url, { signal, integrity: entry.integrity ?? null });
    };

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= total || (stopOnError && errors.size)) return;
        const entry = entries[index];
        try {
          results.set(entry.name, await loadEntry(entry));
        } catch (error) {
          errors.set(entry?.name || `#${index}`, error);
          if (stopOnError) throw error;
        } finally {
          loaded += 1;
          onProgress({ loaded, failed: errors.size, total, name: entry?.name || `#${index}`, percent: total ? loaded / total : 1 });
        }
      }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    if (stopOnError) await Promise.all(workers);
    else await Promise.all(workers.map((promise) => promise.catch(() => undefined)));
    return { results, errors };
  }

  // Named slices of a loaded buffer ("audio sprites"): one file, many sounds.
  addSprites(sourceName, definitions) {
    this.ensureActive();
    const source = normalizeAudioKey(sourceName);
    if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) throw new TypeError("Audio sprite definitions must be an object.");
    const entries = Object.entries(definitions);
    if (this.sprites.size + entries.length > MAX_AUDIO_SPRITES) throw new RangeError(`Audio sprite limit is ${MAX_AUDIO_SPRITES}.`);
    const normalized = entries.map(([name, definition]) => {
      const key = normalizeAudioKey(name);
      if (!definition || typeof definition !== "object") throw new TypeError(`Audio sprite "${key}" must be an object.`);
      const start = audioSeconds(definition.start ?? 0, `Audio sprite "${key}" start`);
      const end = definition.end === undefined ? undefined : audioSeconds(definition.end, `Audio sprite "${key}" end`);
      const duration = definition.duration === undefined ? (end === undefined ? undefined : end - start) : audioSeconds(definition.duration, `Audio sprite "${key}" duration`, { allowZero: false });
      if (duration === undefined || !(duration > 0)) throw new RangeError(`Audio sprite "${key}" needs a positive duration or an end after start.`);
      return [key, Object.freeze({ source, start, duration, loop: Boolean(definition.loop) })];
    });
    for (const [key, sprite] of normalized) this.sprites.set(key, sprite);
    return this;
  }

  hasSprite(name) { return this.sprites.has(String(name)); }
  removeSprite(name) { return this.sprites.delete(String(name)); }

  setListener(x, y) {
    this.listener.x = spatialNumber(x, "Audio listener x");
    this.listener.y = spatialNumber(y, "Audio listener y");
    for (const [source, record] of this.voices) if (record.position) this.applyVoiceMix(source, record);
    return this;
  }

  configureSpatial({ refDistance = this.spatialSettings.refDistance, maxDistance = this.spatialSettings.maxDistance, rolloff = this.spatialSettings.rolloff, panDistance = this.spatialSettings.panDistance } = {}) {
    const next = { refDistance: Number(refDistance), maxDistance: Number(maxDistance), rolloff: Number(rolloff), panDistance: Number(panDistance) };
    if (!(next.refDistance >= 0) || !(next.maxDistance > next.refDistance) || !(next.maxDistance <= MAX_SPATIAL_DISTANCE) || !(next.rolloff >= 0 && next.rolloff <= 1) || !(next.panDistance > 0 && next.panDistance <= MAX_SPATIAL_DISTANCE)) {
      throw new RangeError("Audio spatial settings need 0 <= refDistance < maxDistance, rolloff 0..1 and a positive panDistance.");
    }
    this.spatialSettings = next;
    for (const [source, record] of this.voices) if (record.position) this.applyVoiceMix(source, record);
    return this;
  }

  setVoicePosition(source, x, y) {
    const record = this.voices.get(source);
    if (!record) return false;
    record.position = { x: spatialNumber(x, "Audio voice x"), y: spatialNumber(y, "Audio voice y") };
    this.applyVoiceMix(source, record);
    return true;
  }

  setVoicePlaybackRate(source, rate) {
    const record = this.voices.get(source);
    if (!record) return false;
    if (source.playbackRate) source.playbackRate.value = Math.max(MIN_PLAYBACK_RATE, Math.min(MAX_PLAYBACK_RATE, Number(rate) || 1));
    return true;
  }

  applyVoiceMix(source, record) {
    if (!record.position) { record.gain.gain.value = record.volume; return; }
    const mix = spatialMix(this.spatialSettings, this.listener, record.position);
    record.gain.gain.value = record.volume * mix.gain;
    if (record.panner) record.panner.pan.value = mix.pan;
    else if (mix.pan !== 0 && typeof this.context?.createStereoPanner === "function") this.setVoicePan(source, mix.pan);
  }

  play(nameOrBuffer, { volume = 1, loop = false, bus = "sfx", pan = 0, offset = 0, duration, loopStart, loopEnd, playbackRate = 1, position = null } = {}) {
    this.ensureActive();
    let buffer = nameOrBuffer;
    let sliceStart = 0;
    let sliceDuration;
    let loopRegion = null;
    let shouldLoop = Boolean(loop);
    if (typeof nameOrBuffer === "string") {
      const sprite = this.sprites.get(nameOrBuffer);
      if (sprite) {
        buffer = this.buffers.get(sprite.source);
        sliceStart = sprite.start;
        sliceDuration = sprite.duration;
        if (sprite.loop) { shouldLoop = true; loopRegion = [sprite.start, sprite.start + sprite.duration]; }
      } else {
        buffer = this.buffers.get(normalizeAudioKey(nameOrBuffer));
      }
    }
    if (!buffer) throw new Error("Audio buffer not found.");
    const bufferDuration = Number.isFinite(Number(buffer.duration)) ? Number(buffer.duration) : Infinity;
    const startAt = sliceStart + audioSeconds(offset, "Audio offset");
    if (startAt >= bufferDuration) throw new RangeError("Audio offset is past the end of the buffer.");
    let playFor = duration === undefined ? sliceDuration : audioSeconds(duration, "Audio duration", { allowZero: false });
    if (playFor !== undefined && sliceDuration !== undefined) playFor = Math.min(playFor, sliceStart + sliceDuration - startAt);
    if (loopStart !== undefined || loopEnd !== undefined) {
      const regionStart = audioSeconds(loopStart ?? 0, "Audio loopStart");
      const regionEnd = loopEnd === undefined ? bufferDuration : audioSeconds(loopEnd, "Audio loopEnd");
      if (!(regionEnd > regionStart) || regionEnd > bufferDuration) throw new RangeError("Audio loopEnd must be after loopStart and inside the buffer.");
      loopRegion = [regionStart, regionEnd];
      shouldLoop = true;
    }
    const rate = Number(playbackRate);
    if (!Number.isFinite(rate) || rate < MIN_PLAYBACK_RATE || rate > MAX_PLAYBACK_RATE) throw new RangeError(`Audio playbackRate must be between ${MIN_PLAYBACK_RATE} and ${MAX_PLAYBACK_RATE}.`);
    let voicePosition = null;
    if (position !== null && position !== undefined) {
      if (typeof position !== "object") throw new TypeError("Audio position must be { x, y }.");
      voicePosition = { x: spatialNumber(position.x, "Audio position x"), y: spatialNumber(position.y, "Audio position y") };
    }
    if (this.voices.size >= this.maxVoices) throw new RangeError(`Audio voice limit is ${this.maxVoices}.`);
    const context = this.ensureContext();
    const output = this.getBus(bus) || this.getBus("master");
    const source = context.createBufferSource();
    const gain = context.createGain();
    const mix = voicePosition ? spatialMix(this.spatialSettings, this.listener, voicePosition) : null;
    const requestedPan = mix ? mix.pan : safePan(pan);
    const panner = requestedPan === 0 ? null : context.createStereoPanner?.();
    if (requestedPan !== 0 && !panner && !mix) throw new Error("StereoPannerNode is not available.");
    source.buffer = buffer;
    source.loop = shouldLoop;
    if (loopRegion) { source.loopStart = loopRegion[0]; source.loopEnd = loopRegion[1]; }
    if (source.playbackRate) source.playbackRate.value = rate;
    const baseVolume = safeVolume(volume);
    gain.gain.value = mix ? baseVolume * mix.gain : baseVolume;
    source.connect(gain);
    if (panner) {
      panner.pan.value = requestedPan;
      gain.connect(panner);
      panner.connect(output.gain);
    } else gain.connect(output.gain);
    // Voice liveness is membership in the voices table; cleanup is idempotent.
    const record = { buffer, gain, panner, output: output.gain, phase: "alive", cleanup: null, volume: baseVolume, position: voicePosition };
    const cleanup = () => {
      if (!this.voices.has(source)) return;
      record.phase = "cleaned";
      source.removeEventListener?.("ended", cleanup);
      source.onended = null;
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
      try { record.panner?.disconnect?.(); } catch {}
      this.voices.delete(source);
    };
    record.cleanup = cleanup;
    this.voices.set(source, record);
    source.addEventListener?.("ended", cleanup, { once: true });
    source.onended = cleanup;
    try {
      // A looping voice plays until stopped, so it gets no duration argument.
      if (startAt === 0 && (playFor === undefined || shouldLoop)) source.start();
      else if (playFor === undefined || shouldLoop) source.start(0, startAt);
      else source.start(0, startAt, playFor);
    } catch (error) { cleanup(); throw error; }
    return source;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
    for (const controller of this.loadControllers.values()) controller?.abort?.();
    this.loadControllers.clear();
    this.stopAll();
    for (const bus of this.buses.values()) bus.gain.disconnect();
    this.context?.close?.();
    this.context = null;
    this.buffers.clear();
    this.decodedSizes.clear();
    this.decodedBytes = 0;
    this.pendingLoads.clear();
    this.pendingLoadURLs.clear();
    this.pendingLoadIntegrities.clear();
    this.keyGenerations.clear();
    this.voices.clear();
    this.buses.clear();
  }
}
