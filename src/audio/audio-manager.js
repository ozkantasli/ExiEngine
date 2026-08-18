const MAX_AUDIO_BUS_COUNT = 64;
const MAX_AUDIO_BUS_NAME_LENGTH = 64;
const MAX_AUDIO_KEY_LENGTH = 256;
const MAX_AUDIO_VOICES = 256;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const MAX_AUDIO_DECODED_BYTES = 512 * 1024 * 1024;
const MAX_AUDIO_BATCH_ENTRIES = 4_096;
const MAX_AUDIO_BATCH_CONCURRENCY = 16;
const MAX_AUDIO_FADE_DURATION = 60;
const safeVolume = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const safePan = (value) => Math.max(-1, Math.min(1, Number(value) || 0));

function normalizeAudioKey(value) {
  const key = String(value);
  if (!key || key.length > MAX_AUDIO_KEY_LENGTH) throw new RangeError("Audio key limiti geçersiz.");
  return key;
}

function normalizeBusName(value) {
  const id = String(value).trim();
  if (!id || id.length > MAX_AUDIO_BUS_NAME_LENGTH || /[^a-zA-Z0-9_-]/.test(id)) throw new Error("Audio bus adı geçersiz.");
  return id;
}

function abortReason(signal) {
  return signal?.reason || Object.assign(new Error("Audio yükleme iptal edildi."), { name: "AbortError" });
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
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_AUDIO_BYTES) throw new RangeError("Audio byte limiti geçersiz.");
    if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0 || maxDecodedBytes > MAX_AUDIO_DECODED_BYTES) throw new RangeError("Audio decoded byte limit invalid.");
    if (!Number.isSafeInteger(maxVoices) || maxVoices <= 0 || maxVoices > MAX_AUDIO_VOICES) throw new RangeError("Audio voice limiti geçersiz.");
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
    this.keyGenerations = new Map();
    this.activeVoices = new Set();
    this.voiceBuffers = new Map();
    this.voiceGains = new Map();
    this.voicePanners = new Map();
    this.voiceOutputs = new Map();
    this.voiceCleanups = new Map();
    this.buses = new Map();
    this.destroyed = false;
    this.generation = 0;
  }

  ensureActive() {
    if (this.destroyed) throw new Error("AudioManager yok edilmiş.");
    this.assertBudget();
  }

  assertBudget() {
    if (this.maxBytes !== this._maxBytesCapacity || this.maxDecodedBytes !== this._maxDecodedBytesCapacity || this.maxVoices !== this._maxVoicesCapacity) {
      const error = new RangeError("Audio bütçe ayarları doğrudan değiştirilemez.");
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
    if (this.buses.size >= MAX_AUDIO_BUS_COUNT) throw new RangeError(`Audio bus limiti ${MAX_AUDIO_BUS_COUNT}.`);
    if (!this.context || (id !== "master" && !this.buses.has("master"))) this.ensureContext();
    if (this.buses.has(id)) return this.buses.get(id);
    const context = this.ensureContextWithoutBuses();
    if (parent && parent === id) throw new Error("Audio bus kendisine bağlanamaz.");
    const parentBus = parent ? this.buses.get(parent) : null;
    if (parent && !parentBus) throw new Error(`Audio parent bus bulunamadı: ${parent}`);
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
    if (!AudioContextClass) throw new Error("Web Audio API kullanılamıyor.");
    this.context = new AudioContextClass();
    return this.context;
  }

  getBus(name = "master") { this.ensureContext(); return this.buses.get(name) || null; }
  setBusVolume(name, volume) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus bulunamadı: ${name}`);
    bus.gain.gain.cancelScheduledValues?.(audioTime(this.context));
    bus.volume = safeVolume(volume);
    if (!bus.muted) bus.gain.gain.value = bus.volume;
    return this;
  }
  getBusVolume(name) { const bus = this.getBus(name); return bus?.volume ?? 0; }
  setBusMuted(name, muted = true) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus bulunamadı: ${name}`);
    bus.gain.gain.cancelScheduledValues?.(audioTime(this.context));
    bus.muted = Boolean(muted);
    bus.gain.gain.value = bus.muted ? 0 : bus.volume;
    return this;
  }
  isBusMuted(name) { return this.getBus(name)?.muted ?? false; }
  fadeBus(name, volume, duration = 0.25) {
    const bus = this.getBus(name);
    if (!bus) throw new Error(`Audio bus bulunamadı: ${name}`);
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

  get voiceCount() { return this.activeVoices.size; }

  stopVoice(source) {
    if (!this.activeVoices.has(source)) return false;
    try { source.stop?.(); } catch {}
    this.voiceCleanups.get(source)?.();
    return true;
  }

  stopAll() {
    for (const source of this.activeVoices) this.stopVoice(source);
    return this;
  }

  has(name) {
    return this.buffers.has(String(name));
  }

  getBusNames() {
    return Array.from(this.buses.keys());
  }

  stopBus(name) {
    const bus = this.getBus(name);
    if (!bus) return 0;
    let count = 0;
    for (const [source, output] of this.voiceOutputs) {
      if (output === bus.gain) {
        this.stopVoice(source);
        count += 1;
      }
    }
    return count;
  }

  stopVoicesForBuffer(buffer) {
    if (!buffer) return this;
    for (const [source, sourceBuffer] of this.voiceBuffers) if (sourceBuffer === buffer) this.stopVoice(source);
    return this;
  }

  setVoiceVolume(source, volume) {
    if (!this.activeVoices.has(source)) return false;
    const gain = this.voiceGains.get(source);
    if (!gain) return false;
    gain.gain.value = safeVolume(volume);
    return true;
  }

  setVoicePan(source, pan) {
    if (!this.activeVoices.has(source)) return false;
    const gain = this.voiceGains.get(source);
    const output = this.voiceOutputs.get(source);
    if (!gain || !output) return false;
    const requestedPan = safePan(pan);
    let panner = this.voicePanners.get(source);
    if (requestedPan === 0) {
      if (panner) {
        try { gain.disconnect?.(); } catch {}
        try { panner.disconnect?.(); } catch {}
        gain.connect(output);
        this.voicePanners.delete(source);
      }
      return true;
    }
    if (!panner) {
      panner = typeof this.context?.createStereoPanner === "function" ? this.context.createStereoPanner() : null;
      if (!panner) throw new Error("StereoPannerNode kullanılamıyor.");
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
      this.voicePanners.set(source, panner);
    } else panner.pan.value = requestedPan;
    return true;
  }

  unload(name) {
    const key = normalizeAudioKey(name);
    this.keyGenerations.set(key, (this.keyGenerations.get(key) || 0) + 1);
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
    if (!this.loader) throw new Error("AudioManager için AssetLoader gerekli.");
    const key = normalizeAudioKey(name);
    const requestURL = String(url);
    if (signal?.aborted) throw abortReason(signal);
    const pending = this.pendingLoads.get(key);
    if (pending) {
      if (this.pendingLoadURLs.get(key) !== requestURL || this.pendingLoadIntegrities.get(key) !== integrity) throw new Error(`Audio adı zaten yükleniyor: ${key}`);
      return waitForAbort(pending, signal);
    }
    const generation = this.generation;
    const keyGeneration = this.keyGenerations.get(key) || 0;
    const promise = (async () => {
      const bytes = await this.loader.loadBytes(requestURL, { maxBytes: this.maxBytes, signal: null, integrity });
      if (this.destroyed || generation !== this.generation) throw new Error("AudioManager yok edilmiş.");
      if (keyGeneration !== (this.keyGenerations.get(key) || 0)) throw new Error("Audio load geçersiz kılındı.");
      const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const buffer = await this.ensureContext().decodeAudioData(exactBuffer);
      if (this.destroyed || generation !== this.generation) throw new Error("AudioManager yok edilmiş.");
      if (keyGeneration !== (this.keyGenerations.get(key) || 0)) throw new Error("Audio load geçersiz kılındı.");
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
    promise.then(() => { if (this.pendingLoads.get(key) === promise) { this.pendingLoads.delete(key); this.pendingLoadURLs.delete(key); this.pendingLoadIntegrities.delete(key); } }, () => { if (this.pendingLoads.get(key) === promise) { this.pendingLoads.delete(key); this.pendingLoadURLs.delete(key); this.pendingLoadIntegrities.delete(key); } });
    return waitForAbort(promise, signal);
  }

  async loadMany(entries, { onProgress = () => {}, signal = null, stopOnError = true, maxConcurrent = 4 } = {}) {
    this.ensureActive();
    if (!Array.isArray(entries)) throw new TypeError("Audio listesi dizi olmalı.");
    if (entries.length > MAX_AUDIO_BATCH_ENTRIES) throw new RangeError(`Audio batch limiti ${MAX_AUDIO_BATCH_ENTRIES}.`);
    if (typeof onProgress !== "function") throw new TypeError("Audio progress callback fonksiyonu gerekli.");
    const total = entries.length;
    const results = new Map();
    const errors = new Map();
    const seen = new Set();
    let cursor = 0;
    let loaded = 0;
    const workerCount = Math.max(1, Math.min(total || 1, MAX_AUDIO_BATCH_CONCURRENCY, Math.floor(maxConcurrent) || 1));

    const loadEntry = async (entry) => {
      if (!entry || typeof entry.name !== "string" || !entry.name || entry.name.length > MAX_AUDIO_KEY_LENGTH || typeof entry.url !== "string" || !entry.url) throw new TypeError("Audio adı veya URL geçersiz.");
      const name = normalizeAudioKey(entry.name);
      if (seen.has(name)) throw new Error(`Audio adı tekrar ediyor: ${name}`);
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
          onProgress({ loaded, total, name: entry?.name || `#${index}`, percent: total ? loaded / total : 1 });
        }
      }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    if (stopOnError) await Promise.all(workers);
    else await Promise.all(workers.map((promise) => promise.catch(() => undefined)));
    return { results, errors };
  }

  play(nameOrBuffer, { volume = 1, loop = false, bus = "sfx", pan = 0 } = {}) {
    this.ensureActive();
    const buffer = typeof nameOrBuffer === "string" ? this.buffers.get(normalizeAudioKey(nameOrBuffer)) : nameOrBuffer;
    if (!buffer) throw new Error("Audio buffer bulunamadı.");
    if (this.activeVoices.size >= this.maxVoices) throw new RangeError(`Audio voice limiti ${this.maxVoices}.`);
    const context = this.ensureContext();
    const output = this.getBus(bus) || this.getBus("master");
    const source = context.createBufferSource();
    const gain = context.createGain();
    const requestedPan = safePan(pan);
    const panner = requestedPan === 0 ? null : context.createStereoPanner?.();
    if (requestedPan !== 0 && !panner) throw new Error("StereoPannerNode kullanılamıyor.");
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = safeVolume(volume);
    source.connect(gain);
    if (panner) {
      panner.pan.value = requestedPan;
      gain.connect(panner);
      panner.connect(output.gain);
    } else gain.connect(output.gain);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      source.removeEventListener?.("ended", cleanup);
      source.onended = null;
      try { source.disconnect?.(); } catch {}
      try { gain.disconnect?.(); } catch {}
      try { panner?.disconnect?.(); } catch {}
      this.activeVoices.delete(source);
      this.voiceBuffers.delete(source);
      this.voiceGains.delete(source);
      this.voicePanners.delete(source);
      this.voiceOutputs.delete(source);
      this.voiceCleanups.delete(source);
    };
    this.activeVoices.add(source);
    this.voiceBuffers.set(source, buffer);
    this.voiceGains.set(source, gain);
    this.voiceOutputs.set(source, output.gain);
    this.voiceCleanups.set(source, cleanup);
    if (panner) this.voicePanners.set(source, panner);
    source.addEventListener?.("ended", cleanup, { once: true });
    source.onended = cleanup;
    try { source.start(); } catch (error) { cleanup(); throw error; }
    return source;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.generation += 1;
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
    this.activeVoices.clear();
    this.voiceBuffers.clear();
    this.voiceGains.clear();
    this.voicePanners.clear();
    this.voiceOutputs.clear();
    this.voiceCleanups.clear();
    this.buses.clear();
  }
}
