import { Texture } from "./texture.js";
import { TextureAtlas } from "./texture-atlas.js";
import { inspectKTX2 as inspectKTX2Bytes } from "./ktx2.js";

const MAX_CACHE_TEXTURES = 4_096;
const MAX_CACHE_PIXELS = 512 * 1024 * 1024;
const MAX_BATCH_ENTRIES = 4_096;
const MAX_ASSET_KEY_LENGTH = 256;
const MAX_STREAM_CHUNKS = 16_384;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_JSON_NODES = 1_000_000;
const MAX_JSON_DEPTH = 128;
const MAX_IMAGE_SIZE = 16_384;
const MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;
const MAX_INTEGRITY_LENGTH = 512;
const MAX_INTEGRITY_HASHES = 4;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function uint16BE(bytes, offset) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function uint16LE(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function uint32BE(bytes, offset) { return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; }
function uint32LE(bytes, offset) { return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + bytes[offset + 3] * 0x1000000; }
function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }

function readImageDimensions(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a && ascii(bytes, 12, 4) === "IHDR") {
    return { width: uint32BE(bytes, 16), height: uint32BE(bytes, 20) };
  }
  if (bytes.length >= 10 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) {
    return { width: uint16LE(bytes, 6), height: uint16LE(bytes, 8) };
  }
  if (bytes.length >= 26 && ascii(bytes, 0, 2) === "BM") {
    const width = uint32LE(bytes, 18);
    const rawHeight = uint32LE(bytes, 22);
    return { width, height: rawHeight > 0x7fffffff ? 0x100000000 - rawHeight : rawHeight };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(bytes, offset, 4);
      const size = uint32LE(bytes, offset + 4);
      const data = offset + 8;
      if (data + size > bytes.length) return null;
      if (type === "VP8X" && size >= 10) return {
        width: 1 + bytes[data + 4] + (bytes[data + 5] << 8) + (bytes[data + 6] << 16),
        height: 1 + bytes[data + 7] + (bytes[data + 8] << 8) + (bytes[data + 9] << 16),
      };
      if (type === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) return { width: uint16LE(bytes, data + 6) & 0x3fff, height: uint16LE(bytes, data + 8) & 0x3fff };
      if (type === "VP8L" && size >= 6 && bytes[data] === 0x2f) return {
        width: 1 + (bytes[data + 1] | (bytes[data + 2] << 8) | ((bytes[data + 3] & 0x3f) << 16)),
        height: 1 + ((bytes[data + 3] >> 6) | (bytes[data + 4] << 2) | ((bytes[data + 5] & 0x0f) << 10)),
      };
      offset = data + size + (size & 1);
    }
    return null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = uint16BE(bytes, offset);
      if (length < 2 || offset + length > bytes.length) return null;
      const isFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isFrame && length >= 7) return { width: uint16BE(bytes, offset + 5), height: uint16BE(bytes, offset + 3) };
      offset += length;
    }
  }
  return null;
}

function assertImageDimensions(width, height, maxImageSize, maxTexturePixels) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error("Texture boyutu geçersiz.");
  if (width > maxImageSize || height > maxImageSize) throw new Error("Texture boyutu limiti aşıldı.");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > maxTexturePixels) throw new Error("Texture pixel limiti aşıldı.");
}

function positiveLimit(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} limiti geçersiz.`);
  return value;
}

function boundedPositiveLimit(value, label, maximum) {
  const result = positiveLimit(value, label);
  if (result > maximum) throw new RangeError(`${label} limiti ${maximum} değerini aşamaz.`);
  return result;
}

function normalizeIntegrity(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > MAX_INTEGRITY_LENGTH) throw new TypeError("Asset integrity değeri geçersiz.");
  const hashes = value.trim().split(/\s+/).filter(Boolean);
  if (hashes.length === 0 || hashes.length > MAX_INTEGRITY_HASHES || hashes.some((hash) => !/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash))) throw new TypeError("Asset integrity yalnızca en fazla dört sha256 hash kabul eder.");
  return hashes.join(" ");
}

function encodeBase64(bytes) {
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const value = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(value >> 18) & 63];
    encoded += BASE64_ALPHABET[(value >> 12) & 63];
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : "=";
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : "=";
  }
  return encoded;
}

async function verifyIntegrity(bytes, integrity) {
  if (!integrity) return bytes;
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== "function") throw new Error("Asset integrity için Web Crypto gerekli.");
  const verifiedBytes = bytes.slice();
  const digest = await subtle.digest("SHA-256", verifiedBytes);
  const actual = `sha256-${encodeBase64(new Uint8Array(digest))}`;
  if (!integrity.split(" ").includes(actual)) {
    const error = new Error("Asset integrity doğrulaması başarısız.");
    error.code = "EXI_ASSET_INTEGRITY";
    throw error;
  }
  return verifiedBytes;
}

function validateJSONShape(value, maxNodes, maxDepth) {
  const values = [value];
  const depths = [0];
  let nodes = 0;
  while (values.length > 0) {
    const current = values.pop();
    const depth = depths.pop();
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError("JSON düğüm limiti aşıldı.");
    if (!current || typeof current !== "object") continue;
    if (depth >= maxDepth) throw new RangeError("JSON derinlik limiti aşıldı.");
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        values.push(current[index]);
        depths.push(depth + 1);
      }
    } else {
      const keys = Object.keys(current);
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        values.push(current[keys[index]]);
        depths.push(depth + 1);
      }
    }
  }
}

function validateJSONTextBudget(text, maxNodes, maxDepth) {
  const contexts = [];
  let depth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  let stringIsObjectKey = false;
  const recordValue = () => {
    nodes += 1;
    if (nodes > maxNodes) throw new RangeError("JSON düğüm limiti aşıldı.");
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        inString = false;
        if (!stringIsObjectKey) recordValue();
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      const context = contexts[contexts.length - 1];
      stringIsObjectKey = context?.type === "object" && context.state === "key";
      continue;
    }
    if (character === "{" || character === "[") {
      if (depth >= maxDepth) throw new RangeError("JSON derinlik limiti aşıldı.");
      recordValue();
      depth += 1;
      contexts.push({ type: character === "{" ? "object" : "array", state: character === "{" ? "key" : "value" });
      continue;
    }
    if (character === "}" || character === "]") {
      const context = contexts.pop();
      if (!context || (character === "}" ? context.type !== "object" : context.type !== "array")) throw new SyntaxError("JSON yapısı geçersiz.");
      depth -= 1;
      continue;
    }
    if (character === ":") {
      const context = contexts[contexts.length - 1];
      if (context?.type === "object") context.state = "value";
      continue;
    }
    if (character === ",") {
      const context = contexts[contexts.length - 1];
      if (context) context.state = context.type === "object" ? "key" : "value";
      continue;
    }
    if (/\s/.test(character)) continue;
    recordValue();
    while (index + 1 < text.length && !/[\s\[\]{}:,]/.test(text[index + 1])) index += 1;
  }
  if (inString || escaped || depth !== 0) throw new SyntaxError("JSON yapısı geçersiz.");
}

async function readLimited(response, maxBytes) {
  if (!response.ok) throw new Error(`Asset yüklenemedi: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length"));
  if (contentLength > maxBytes) throw new Error(`Asset limiti aşıldı: ${contentLength} > ${maxBytes} byte`);
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("Asset limiti aşıldı.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (chunks.length >= MAX_STREAM_CHUNKS) { await reader.cancel(); throw new Error("Asset stream parça limiti aşıldı."); }
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Asset limiti aşıldı."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function waitForAbort(promise, signal) {
  if (!signal || typeof signal.addEventListener !== "function") return promise;
  const abortReason = () => signal.reason || Object.assign(new Error("Asset yükleme iptal edildi."), { name: "AbortError" });
  if (signal.aborted) return Promise.reject(abortReason());
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener?.("abort", onAbort);
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(abortReason()); };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { if (settled) return; settled = true; cleanup(); resolve(value); }, (error) => { if (settled) return; settled = true; cleanup(); reject(error); });
  });
}

export class AssetLoader {
  constructor({ baseURL = globalThis.location?.href || "http://127.0.0.1/", allowedOrigins = [], maxBytes = 16 * 1024 * 1024, maxJSONBytes = 4 * 1024 * 1024, maxJSONNodes = 100_000, maxJSONDepth = 64, maxImageSize = 4096, maxTexturePixels = 16 * 1024 * 1024, maxCacheTextures = 256, maxCachePixels = 128 * 1024 * 1024 } = {}) {
    this.baseURL = baseURL;
    this.allowedOrigins = new Set([new URL(baseURL).origin, ...allowedOrigins.map((origin) => new URL(origin).origin)]);
    this._baseURLSnapshot = this.baseURL;
    this._allowedOriginsSnapshot = new Set(this.allowedOrigins);
    this.maxBytes = boundedPositiveLimit(maxBytes, "Asset byte", MAX_ASSET_BYTES);
    this.maxJSONBytes = boundedPositiveLimit(maxJSONBytes, "JSON byte", MAX_JSON_BYTES);
    this.maxJSONNodes = boundedPositiveLimit(maxJSONNodes, "JSON düğüm", MAX_JSON_NODES);
    this.maxJSONDepth = boundedPositiveLimit(maxJSONDepth, "JSON derinlik", MAX_JSON_DEPTH);
    this.maxImageSize = boundedPositiveLimit(maxImageSize, "Image", MAX_IMAGE_SIZE);
    this.maxTexturePixels = boundedPositiveLimit(maxTexturePixels, "Texture pixel", MAX_TEXTURE_PIXELS);
    this._maxBytesCapacity = this.maxBytes;
    this._maxJSONBytesCapacity = this.maxJSONBytes;
    this._maxJSONNodesCapacity = this.maxJSONNodes;
    this._maxJSONDepthCapacity = this.maxJSONDepth;
    this._maxImageSizeCapacity = this.maxImageSize;
    this._maxTexturePixelsCapacity = this.maxTexturePixels;
    if (!Number.isSafeInteger(maxCacheTextures) || maxCacheTextures <= 0 || maxCacheTextures > MAX_CACHE_TEXTURES) throw new RangeError("Texture cache sayÄ± limiti geÃ§ersiz.");
    if (!Number.isSafeInteger(maxCachePixels) || maxCachePixels <= 0 || maxCachePixels > MAX_CACHE_PIXELS) throw new RangeError("Texture cache pixel limiti geÃ§ersiz.");
    this._cacheTextureCapacity = maxCacheTextures;
    this._cachePixelCapacity = maxCachePixels;
    this.maxCacheTextures = maxCacheTextures;
    this.maxCachePixels = maxCachePixels;
    this.cache = new Map();
    this.cachePixels = 0;
    this.cacheGeneration = 0;
    this.textureGenerations = new Map();
    this.pendingBytes = new Map();
    this.pendingTextures = new Map();
    this.decoderIds = new WeakMap();
    this.nextDecoderId = 1;
    this.pendingControllers = new Set();
    this.destroyed = false;
  }

  assertConfigBudget() {
    if (this.baseURL !== this._baseURLSnapshot || !(this.allowedOrigins instanceof Set) || this.allowedOrigins.size !== this._allowedOriginsSnapshot.size || [...this._allowedOriginsSnapshot].some((origin) => !this.allowedOrigins.has(origin))) throw new Error("Asset origin ayarları doğrudan değiştirilemez.");
    if (this.maxBytes !== this._maxBytesCapacity || this.maxJSONBytes !== this._maxJSONBytesCapacity || this.maxJSONNodes !== this._maxJSONNodesCapacity || this.maxJSONDepth !== this._maxJSONDepthCapacity || this.maxImageSize !== this._maxImageSizeCapacity || this.maxTexturePixels !== this._maxTexturePixelsCapacity) throw new RangeError("Asset limit bütçesi doğrudan değiştirilemez.");
  }

  ensureActive() { if (this.destroyed) throw new Error("AssetLoader yok edilmiş."); this.assertConfigBudget(); }

  createRequestSignal(signal) {
    if (typeof AbortController !== "function") return { signal, dispose() {} };
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
    this.pendingControllers.add(controller);
    return {
      signal: controller.signal,
      dispose: () => {
        signal?.removeEventListener?.("abort", abort);
        this.pendingControllers.delete(controller);
      },
    };
  }

  decoderKey(decoder) {
    if (decoder === null || decoder === undefined) return "none";
    if (typeof decoder !== "function") return "invalid";
    if (!this.decoderIds.has(decoder)) this.decoderIds.set(decoder, this.nextDecoderId++);
    return `decoder-${this.decoderIds.get(decoder)}`;
  }

  trackPending(map, key, factory) {
    if (map.has(key)) return map.get(key);
    const promise = Promise.resolve().then(factory);
    map.set(key, promise);
    promise.then(() => { if (map.get(key) === promise) map.delete(key); }, () => { if (map.get(key) === promise) map.delete(key); });
    return promise;
  }

  assertCacheBudget() {
    if (this.maxCacheTextures !== this._cacheTextureCapacity || this.maxCachePixels !== this._cachePixelCapacity) throw new RangeError("Texture cache bütçesi doğrudan değiştirilemez.");
    if (this.cache.size > this._cacheTextureCapacity) throw new RangeError(`Texture cache sayısı limiti ${this._cacheTextureCapacity}.`);
    let pixels = 0;
    for (const [key, texture] of this.cache) {
      if (!(texture instanceof Texture)) throw new TypeError("Cache texture bekleniyor.");
      if (texture.destroyed) { this.cache.delete(key); continue; }
      const texturePixels = texture.sourceWidth * texture.sourceHeight;
      if (!Number.isSafeInteger(texturePixels) || texturePixels <= 0) throw new RangeError("Cache texture boyutu geçersiz.");
      pixels += texturePixels;
      if (!Number.isSafeInteger(pixels) || pixels > this._cachePixelCapacity) throw new RangeError(`Texture cache pixel limiti ${this._cachePixelCapacity}.`);
    }
    this.cachePixels = pixels;
  }

  getCachedTexture(resolved) {
    this.assertCacheBudget();
    const texture = this.cache.get(resolved);
    if (texture?.destroyed) { this.cache.delete(resolved); this.cachePixels = Math.max(0, this.cachePixels - texture.sourceWidth * texture.sourceHeight); return null; }
    return texture || null;
  }

  cacheTexture(resolved, texture) {
    this.assertCacheBudget();
    if (!(texture instanceof Texture)) throw new TypeError("Cache texture bekleniyor.");
    const pixels = texture.sourceWidth * texture.sourceHeight;
    if (!Number.isSafeInteger(pixels) || pixels <= 0) throw new RangeError("Cache texture boyutu geçersiz.");
    const existing = this.cache.get(resolved);
    if (existing) {
      if (existing.destroyed) {
        this.cache.delete(resolved);
        this.cachePixels = Math.max(0, this.cachePixels - existing.sourceWidth * existing.sourceHeight);
      } else return false;
    }
    if (this.cache.size >= this._cacheTextureCapacity || this.cachePixels + pixels > this._cachePixelCapacity) return false;
    this.cache.set(resolved, texture);
    this.cachePixels += pixels;
    return true;
  }

  resolve(url) {
    this.assertConfigBudget();
    const resolved = new URL(url, this.baseURL);
    if (resolved.username || resolved.password) throw new Error("Asset URL kimlik bilgisi taşıyamaz.");
    if (!["http:", "https:"].includes(resolved.protocol) || !this.allowedOrigins.has(resolved.origin)) {
      throw new Error(`Asset originine izin yok: ${resolved.origin}`);
    }
    return resolved.href;
  }

  resolveMaxBytes(requested) {
    this.assertConfigBudget();
    const value = requested === undefined ? this.maxBytes : positiveLimit(requested, "Asset byte");
    return Math.min(this.maxBytes, value);
  }

  resolveJSONBytes(requested) {
    return Math.min(this.maxJSONBytes, this.resolveMaxBytes(requested));
  }

  resolveJSONNodes(requested) {
    this.assertConfigBudget();
    const value = requested === undefined ? this.maxJSONNodes : positiveLimit(requested, "JSON düğüm");
    return Math.min(this.maxJSONNodes, value);
  }

  resolveJSONDepth(requested) {
    this.assertConfigBudget();
    const value = requested === undefined ? this.maxJSONDepth : positiveLimit(requested, "JSON derinlik");
    return Math.min(this.maxJSONDepth, value);
  }

  async loadBytes(url, options = {}) {
    this.ensureActive();
    const resolved = this.resolve(url);
    const integrity = normalizeIntegrity(options.integrity);
    const maxBytes = this.resolveMaxBytes(options.maxBytes);
    const key = `${resolved}|${maxBytes}`;
    const pending = this.trackPending(this.pendingBytes, key, async () => {
      this.ensureActive();
      const request = this.createRequestSignal(null);
      try {
        const response = await fetch(resolved, { signal: request.signal, credentials: "same-origin", redirect: "error" });
        const bytes = await readLimited(response, maxBytes);
        this.ensureActive();
        return bytes;
      } finally {
        request.dispose();
      }
    });
    return waitForAbort(pending.then((bytes) => verifyIntegrity(bytes, integrity)), options.signal);
  }

  async loadJSON(url, options = {}) {
    const maxBytes = this.resolveJSONBytes(options.maxJSONBytes ?? options.maxBytes);
    const maxNodes = this.resolveJSONNodes(options.maxJSONNodes);
    const maxDepth = this.resolveJSONDepth(options.maxJSONDepth);
    const bytes = await this.loadBytes(url, { ...options, maxBytes });
    const text = new TextDecoder().decode(bytes);
    validateJSONTextBudget(text, maxNodes, maxDepth);
    const value = JSON.parse(text);
    validateJSONShape(value, maxNodes, maxDepth);
    return value;
  }

  async loadTexture(url, options = {}) {
    this.ensureActive();
    const resolved = this.resolve(url);
    const integrity = normalizeIntegrity(options.integrity);
    const cached = integrity ? null : this.getCachedTexture(resolved);
    if (cached) return cached;
    const maxBytes = this.resolveMaxBytes(options.maxBytes);
    const generation = this.cacheGeneration;
    const textureGeneration = this.textureGenerations.get(resolved) || 0;
    const key = `${resolved}|${options.mimeType || "image/png"}|${maxBytes}|${integrity || "none"}`;
    const pending = this.trackPending(this.pendingTextures, key, async () => {
      this.ensureActive();
      const current = integrity ? null : this.getCachedTexture(resolved);
      if (current) return current;
      if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap gerekli.");
      const bytes = await this.loadBytes(resolved, { ...options, signal: null, maxBytes });
      const dimensions = readImageDimensions(bytes);
      if (dimensions) assertImageDimensions(dimensions.width, dimensions.height, this.maxImageSize, this.maxTexturePixels);
      const blob = new Blob([bytes], { type: options.mimeType || "image/png" });
      let source;
      try {
        source = await createImageBitmap(blob);
      } catch (bitmapError) {
        if (typeof Image !== "function") throw bitmapError;
        const objectURL = URL.createObjectURL(blob);
        try {
          const image = new Image();
          image.decoding = "async";
          image.src = objectURL;
          await image.decode();
          source = image;
        } finally {
          URL.revokeObjectURL(objectURL);
        }
      }
      try { assertImageDimensions(Number(source.width), Number(source.height), this.maxImageSize, this.maxTexturePixels); }
      catch (error) { source.close?.(); throw error; }
      if (this.destroyed) { source.close?.(); throw new Error("AssetLoader yok edilmiş."); }
      const texture = Texture.fromImage(source, { id: resolved });
      if (!integrity) {
        const existing = this.getCachedTexture(resolved);
        if (existing) { texture.destroy(); return existing; }
        if (generation !== this.cacheGeneration || textureGeneration !== (this.textureGenerations.get(resolved) || 0)) return texture;
        this.cacheTexture(resolved, texture);
      }
      return texture;
    });
    return waitForAbort(pending, options.signal);
  }

  async loadAtlas(textureUrl, atlasUrl, options = {}) {
    const { integrity, atlasIntegrity, ...sharedOptions } = options;
    const [texture, data] = await Promise.all([
      this.loadTexture(textureUrl, { ...sharedOptions, integrity }),
      this.loadJSON(atlasUrl, { ...sharedOptions, integrity: atlasIntegrity }),
    ]);
    return TextureAtlas.fromJSON(texture, data, sharedOptions);
  }

  inspectKTX2(bytes) {
    this.ensureActive();
    return inspectKTX2Bytes(bytes, { maxImageSize: this.maxImageSize, maxTexturePixels: this.maxTexturePixels });
  }

  async loadKTX2(url, { decoder = null, ...options } = {}) {
    this.ensureActive();
    const resolved = this.resolve(url);
    const integrity = normalizeIntegrity(options.integrity);
    const cached = integrity ? null : this.getCachedTexture(resolved);
    if (cached) return cached;
    const maxBytes = this.resolveMaxBytes(options.maxBytes);
    const generation = this.cacheGeneration;
    const textureGeneration = this.textureGenerations.get(resolved) || 0;
    const key = `ktx2|${resolved}|${maxBytes}|${this.decoderKey(decoder)}|${integrity || "none"}`;
    const pending = this.trackPending(this.pendingTextures, key, async () => {
      this.ensureActive();
      const current = integrity ? null : this.getCachedTexture(resolved);
      if (current) return current;
      const bytes = await this.loadBytes(resolved, { ...options, signal: null, maxBytes });
      const info = this.inspectKTX2(bytes);
      let texture;
      if (info.rgba8) {
        if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.ImageData !== "function") throw new Error("KTX2 RGBA8 için ImageData ve createImageBitmap gerekli.");
        const level = info.levels[0];
        const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset + level.byteOffset, level.byteLength);
        const source = await globalThis.createImageBitmap(new globalThis.ImageData(pixels, info.width, info.height));
        if (!source || Number(source.width) !== info.width || Number(source.height) !== info.height) { source?.close?.(); throw new TypeError("KTX2 ImageBitmap boyutu header ile eşleşmiyor."); }
        if (this.destroyed) { source.close?.(); throw new Error("AssetLoader yok edilmiş."); }
        texture = Texture.fromImage(source, { id: resolved });
      } else {
        if (typeof decoder !== "function") throw new Error("KTX2 sıkıştırılmış formatı için decoder adaptörü gerekli.");
        const decoded = await decoder(bytes, info, { signal: null });
        if (!decoded || decoded instanceof Texture || Number(decoded.width) !== info.width || Number(decoded.height) !== info.height) throw new TypeError("KTX2 decoder eşleşen CanvasImageSource döndürmeli.");
        if (this.destroyed) { decoded.close?.(); throw new Error("AssetLoader yok edilmiş."); }
        texture = Texture.fromImage(decoded, { id: resolved });
      }
      if (!integrity) {
        const existing = this.getCachedTexture(resolved);
        if (existing) { if (existing !== texture) texture.destroy(); return existing; }
        if (generation !== this.cacheGeneration || textureGeneration !== (this.textureGenerations.get(resolved) || 0)) return texture;
        this.cacheTexture(resolved, texture);
      }
      return texture;
    });
    return waitForAbort(pending, options.signal);
  }

  async loadMany(entries, { onProgress = () => {}, signal = null, stopOnError = true, maxConcurrent = 4 } = {}) {
    if (!Array.isArray(entries)) throw new TypeError("Asset listesi dizi olmalı.");
    if (entries.length > MAX_BATCH_ENTRIES) throw new RangeError(`Asset batch limiti ${MAX_BATCH_ENTRIES}.`);
    const total = entries.length;
    const results = new Map();
    const errors = new Map();
    const seen = new Set();
    let cursor = 0;
    let loaded = 0;
    const workerCount = Math.max(1, Math.min(total || 1, Math.floor(maxConcurrent) || 1));

    const loadEntry = async (entry) => {
      if (!entry || typeof entry.key !== "string" || !entry.key.trim() || entry.key.length > MAX_ASSET_KEY_LENGTH) throw new TypeError("Asset anahtarı geçersiz veya fazla uzun.");
      if (seen.has(entry.key)) throw new Error(`Asset anahtarı tekrar ediyor: ${entry.key}`);
      seen.add(entry.key);
      const options = { ...(entry.options || {}), signal: signal || entry.options?.signal };
      if (entry.type === "json") return this.loadJSON(entry.url, options);
      if (entry.type === "bytes") return this.loadBytes(entry.url, options);
      if (entry.type === "ktx2") return this.loadKTX2(entry.url, { ...options, decoder: entry.decoder });
      if (entry.type === "atlas") {
        if (typeof entry.atlasUrl !== "string" || !entry.atlasUrl) throw new TypeError("Atlas asset atlasUrl gerekli.");
        return this.loadAtlas(entry.url, entry.atlasUrl, options);
      }
      if (!entry.type || entry.type === "texture") return this.loadTexture(entry.url, options);
      throw new Error(`Desteklenmeyen asset türü: ${entry.type}`);
    };

    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= total || (stopOnError && errors.size)) return;
        const entry = entries[index];
        try {
          results.set(entry.key, await loadEntry(entry));
        } catch (error) {
          errors.set(entry?.key || `#${index}`, error);
          if (stopOnError) throw error;
        } finally {
          loaded += 1;
          onProgress({ loaded, total, key: entry?.key || `#${index}`, percent: total ? loaded / total : 1 });
        }
      }
    };

    const workers = Array.from({ length: workerCount }, () => worker());
    if (stopOnError) await Promise.all(workers);
    else await Promise.all(workers.map((promise) => promise.catch(() => undefined)));
    return { results, errors };
  }

  release(url) {
    this.assertCacheBudget();
    const resolved = this.resolve(url);
    this.textureGenerations.set(resolved, (this.textureGenerations.get(resolved) || 0) + 1);
    const texture = this.cache.get(resolved);
    if (!texture) return false;
    this.cache.delete(resolved);
    this.cachePixels = Math.max(0, this.cachePixels - texture.sourceWidth * texture.sourceHeight);
    texture.destroy();
    return true;
  }

  clear() { this.cacheGeneration += 1; for (const texture of this.cache.values()) if (texture instanceof Texture) texture.destroy(); this.cache.clear(); this.cachePixels = 0; this.textureGenerations.clear(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const controller of this.pendingControllers) controller.abort();
    this.pendingControllers.clear();
    this.pendingBytes.clear();
    this.pendingTextures.clear();
    this.clear();
  }
}
