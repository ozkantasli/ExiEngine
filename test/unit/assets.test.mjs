// ExiEngine unit test — AssetLoader / SaveStore / KTX2
import { test } from "node:test";
import assert from "node:assert/strict";
import { AssetLoader, SaveStore, Texture, inspectKTX2 } from "../../src/index.js";

const previousFetch = globalThis.fetch;
const previousCreateImageBitmap = globalThis.createImageBitmap;
const previousImageData = Object.getOwnPropertyDescriptor(globalThis, "ImageData");

function fakeResponse(bytes, headers = {}) {
  return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.byteLength ?? Buffer.byteLength(bytes)), ...headers } });
}

test.after(() => {
  if (previousFetch) globalThis.fetch = previousFetch;
  else delete globalThis.fetch;
  if (previousCreateImageBitmap) globalThis.createImageBitmap = previousCreateImageBitmap;
  else delete globalThis.createImageBitmap;
  if (previousImageData) Object.defineProperty(globalThis, "ImageData", previousImageData);
  else delete globalThis.ImageData;
});

function ktx2Fixture() {
  const bytes = new Uint8Array(112);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(12, 37, true); view.setUint32(16, 1, true); view.setUint32(20, 2, true); view.setUint32(24, 1, true); view.setUint32(36, 1, true); view.setUint32(40, 1, true);
  view.setUint32(80, 104, true); view.setUint32(88, 8, true); view.setUint32(96, 8, true);
  bytes.set([255, 0, 0, 255, 0, 255, 0, 255], 104);
  return bytes;
}

test("assets: resolve origin allowlist", () => {
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  assert.equal(loader.resolve("/assets/demo.json"), "http://127.0.0.1:4174/assets/demo.json");
  assert.throws(() => loader.resolve("https://evil.example/image.png"), /originine izin yok/);
  assert.throws(() => loader.resolve("http://user:pass@127.0.0.1:4174/assets/demo.json"), /kimlik bilgisi/);
  assert.throws(() => loader.resolve("data:text/plain,unsafe"), /originine izin yok/);
  loader.allowedOrigins.add("https://evil.example");
  assert.throws(() => loader.resolve("https://evil.example/image.png"), /doğrudan değiştirilemez/);
  loader.allowedOrigins.delete("https://evil.example");
  loader.baseURL = "https://evil.example/";
  assert.throws(() => loader.resolve("/image.png"), /doğrudan değiştirilemez/);
  loader.baseURL = "http://127.0.0.1:4174/";
  loader.destroy();
});

test("assets: constructor limitler", () => {
  assert.throws(() => new AssetLoader({ maxBytes: 0 }), /limiti/);
  assert.throws(() => new AssetLoader({ maxBytes: 64 * 1024 * 1024 + 1 }), /aşamaz/);
  assert.throws(() => new AssetLoader({ maxJSONBytes: 0 }), /limiti/);
  assert.throws(() => new AssetLoader({ maxJSONNodes: 1_000_001 }), /aşamaz/);
  assert.throws(() => new AssetLoader({ maxJSONDepth: 129 }), /aşamaz/);
  assert.throws(() => new AssetLoader({ maxImageSize: 0 }), /limiti/);
  assert.throws(() => new AssetLoader({ maxImageSize: 16_385 }), /aşamaz/);
  assert.throws(() => new AssetLoader({ maxTexturePixels: 16 * 1024 * 1024 + 1 }), /aşamaz/);
  assert.throws(() => new AssetLoader({ maxCacheTextures: 4_097 }), /cache/);
  assert.throws(() => new AssetLoader({ maxCachePixels: 512 * 1024 * 1024 + 1 }), /cache/);
  assert.throws(() => new AssetLoader({ allowedOrigins: ["not-a-url"] }), /Invalid URL/);
});

test("assets: loadJSON bütçeleri (maxBytes/maxJSONNodes/maxJSONDepth)", async () => {
  const jsonLoader = new AssetLoader({ maxBytes: 64, maxJSONBytes: 8 });
  let observedMaxBytes = 0;
  jsonLoader.loadBytes = async (_url, options) => {
    observedMaxBytes = options.maxBytes;
    return new TextEncoder().encode('{"ok":true}');
  };
  assert.deepEqual(await jsonLoader.loadJSON("/small.json"), { ok: true });
  assert.equal(observedMaxBytes, 8);
  assert.equal(jsonLoader.cache.size, 0);

  const nodeLoader = new AssetLoader({ maxJSONNodes: 4 });
  nodeLoader.loadBytes = async () => new TextEncoder().encode("[0,1,2,3]");
  await assert.rejects(() => nodeLoader.loadJSON("/nodes.json"), /JSON düğüm/);
  const overrideLoader = new AssetLoader({ maxJSONNodes: 8 });
  overrideLoader.loadBytes = async () => new TextEncoder().encode("[0,1,2,3]");
  await assert.rejects(() => overrideLoader.loadJSON("/nodes.json", { maxJSONNodes: 3 }), /JSON düğüm/);
  assert.deepEqual(await overrideLoader.loadJSON("/nodes.json", { maxJSONNodes: 99 }), [0, 1, 2, 3]);

  const depthLoader = new AssetLoader({ maxJSONDepth: 3 });
  depthLoader.loadBytes = async () => new TextEncoder().encode("[[[[0]]]]");
  await assert.rejects(() => depthLoader.loadJSON("/depth.json"), /JSON derinlik/);
  await assert.rejects(() => depthLoader.loadJSON("/depth.json", { maxJSONDepth: 2 }), /JSON derinlik/);
  // preflight: parse çağrılmadan derinlik reddi
  const previousJSONParse = JSON.parse;
  let jsonParseCalls = 0;
  JSON.parse = (...args) => { jsonParseCalls += 1; return previousJSONParse(...args); };
  const preflight = new AssetLoader({ maxJSONDepth: 3 });
  preflight.loadBytes = async () => new TextEncoder().encode("[".repeat(65) + "0" + "]".repeat(65));
  await assert.rejects(() => preflight.loadJSON("/preflight.json"), /JSON derinlik/);
  assert.equal(jsonParseCalls, 0);
  JSON.parse = previousJSONParse;
});

test("assets: loadBytes fetch dedupe ve abort", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return fakeResponse(new Uint8Array([1, 2, 3]));
  };
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  const [first, second] = await Promise.all([loader.loadBytes("/shared.bin"), loader.loadBytes("/shared.bin")]);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(Array.from(first), Array.from(second));

  let signalFetch;
  let resolveSignal;
  globalThis.fetch = (_url, options = {}) => {
    signalFetch = options.signal;
    return new Promise((resolve) => { resolveSignal = () => resolve(fakeResponse(new Uint8Array([4, 5, 6]))); });
  };
  const abort = new AbortController();
  const active = new AbortController();
  const abortedLoad = loader.loadBytes("/shared-signal.bin", { signal: abort.signal });
  await Promise.resolve();
  const activeLoad = loader.loadBytes("/shared-signal.bin", { signal: active.signal });
  abort.abort();
  await assert.rejects(() => abortedLoad, /AbortError/);
  assert.equal(signalFetch.aborted, false);
  resolveSignal();
  assert.deepEqual(Array.from(await activeLoad), [4, 5, 6]);
  loader.destroy();
  globalThis.fetch = previousFetch;
});

test("assets: integrity doğrulaması", async () => {
  const helloIntegrity = "sha256-LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=";
  globalThis.fetch = async () => fakeResponse(new TextEncoder().encode("hello"));
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  const verified = await loader.loadBytes("/integrity.txt", { integrity: helloIntegrity });
  assert.equal(new TextDecoder().decode(verified), "hello");
  await assert.rejects(() => loader.loadBytes("/mismatch.txt", { integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), (error) => error?.code === "EXI_ASSET_INTEGRITY");
  await assert.rejects(() => loader.loadBytes("/algorithm.txt", { integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), /sha256/);
  globalThis.fetch = previousFetch;
});

test("assets: fragmente stream limiti", async () => {
  let reads = 0;
  let cancelled = false;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => { reads += 1; return { done: false, value: new Uint8Array([1]) }; },
        cancel: async () => { cancelled = true; },
      }),
    },
  });
  await assert.rejects(() => new AssetLoader({ baseURL: "http://127.0.0.1:4174/" }).loadBytes("/fragmented.bin"), /parça/);
  assert.equal(reads, 16_385);
  assert.equal(cancelled, true);
  globalThis.fetch = previousFetch;
});

test("assets: texture cache budget ve release", async () => {
  globalThis.createImageBitmap = async () => { await new Promise((resolve) => setTimeout(resolve, 1)); return { width: 2, height: 2, close() {} }; };
  globalThis.fetch = async () => fakeResponse(new Uint8Array([1, 2, 3, 4]));
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  const textureA = await loader.loadTexture("/a.png");
  const textureB = await loader.loadTexture("/a.png");
  assert.equal(textureA, textureB);
  assert.equal(loader.cache.size, 1);
  assert.equal(loader.release("/a.png"), true);
  assert.equal(loader.cache.size, 0);
  assert.equal(textureA.destroyed, true);
  loader.destroy();
  globalThis.fetch = previousFetch;
  globalThis.createImageBitmap = previousCreateImageBitmap;
});

test("assets: cacheTexture doğrudan bütçe", () => {
  const loader = new AssetLoader({ maxCacheTextures: 1, maxCachePixels: 4 });
  const a = new Texture({ id: "a", sourceWidth: 2, sourceHeight: 2 });
  const b = new Texture({ id: "b", sourceWidth: 2, sourceHeight: 2 });
  assert.equal(loader.cacheTexture("a", a), true);
  assert.equal(loader.cacheTexture("a", new Texture({ id: "replacement", sourceWidth: 2, sourceHeight: 2 })), false);
  assert.equal(loader.cacheTexture("b", b), false);
  assert.equal(loader.cachePixels, 4);
  loader.clear();
  a.destroy(); b.destroy();
  const capacityProbe = new AssetLoader({ maxCacheTextures: 1, maxCachePixels: 4 });
  capacityProbe.maxCachePixels = 8;
  const capacityTexture = new Texture({ id: "capacity", sourceWidth: 1, sourceHeight: 1 });
  assert.throws(() => capacityProbe.cacheTexture("direct", capacityTexture), /cache/);
  capacityTexture.destroy();
  const oversized = new Texture({ id: "oversized", sourceWidth: 3, sourceHeight: 2 });
  const directProbe = new AssetLoader({ maxCacheTextures: 1, maxCachePixels: 4 });
  directProbe.cache.set("direct", oversized);
  assert.rejects(() => directProbe.loadTexture("/direct.png"), /cache/);
  directProbe.clear();
});

test("assets: loadMany ve loadAtlas", async () => {
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  loader.loadJSON = async (url) => ({ url });
  loader.loadBytes = async (url) => new TextEncoder().encode(url);
  loader.loadAtlas = async (textureUrl, atlasUrl) => ({ textureUrl, atlasUrl });
  const progress = [];
  const loaded = await loader.loadMany([
    { key: "config", type: "json", url: "/config.json" },
    { key: "sound", type: "bytes", url: "/sound.ogg" },
    { key: "characters", type: "atlas", url: "/characters.png", atlasUrl: "/characters.json" },
  ], { maxConcurrent: 2, onProgress: (event) => progress.push(event) });
  assert.equal(loaded.results.size, 3);
  assert.equal(progress.at(-1).percent, 1);
  await assert.rejects(() => loader.loadMany([{ key: "invalid", type: "atlas", url: "/characters.png" }]), /atlasUrl/);
  await assert.rejects(() => loader.loadMany([{ key: "same", type: "json", url: "/a" }, { key: "same", type: "json", url: "/b" }]), /tekrar ediyor/);
  await assert.rejects(() => loader.loadMany(new Array(4_097).fill({ key: "entry", type: "bytes", url: "/entry" })), /batch/);
  await assert.rejects(() => loader.loadMany([{ key: "k".repeat(257), type: "bytes", url: "/entry" }]), /anahtarı/);
});

test("assets: loadKTX2 inspect ve decoder", async () => {
  const bytes = ktx2Fixture();
  const info = inspectKTX2(bytes);
  assert.deepEqual({ width: info.width, height: info.height, levelCount: info.levelCount, rgba8: info.rgba8 }, { width: 2, height: 1, levelCount: 1, rgba8: true });
  const corrupt = bytes.slice();
  new DataView(corrupt.buffer).setUint32(84, 0x00200000, true);
  assert.throws(() => inspectKTX2(corrupt), /güvenli/);
  assert.throws(() => inspectKTX2(new Uint8Array([0, 1])), /header eksik/);

  const previousImageDataDesc = Object.getOwnPropertyDescriptor(globalThis, "ImageData");
  Object.defineProperty(globalThis, "ImageData", { configurable: true, writable: true, value: class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } } });
  const originalBitmap = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async (source) => source?.width === 2 && source?.height === 1 ? { width: 2, height: 1, close() {} } : originalBitmap();
  globalThis.fetch = async () => fakeResponse(bytes);
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  const texture = await loader.loadKTX2("/raw.ktx2");
  assert.equal(texture.sourceWidth, 2);
  assert.equal(texture.sourceHeight, 1);
  assert.equal(loader.cache.size, 1);
  loader.clear();
  loader.destroy();
  globalThis.fetch = previousFetch;
  globalThis.createImageBitmap = originalBitmap;
  if (previousImageDataDesc) Object.defineProperty(globalThis, "ImageData", previousImageDataDesc);
  else delete globalThis.ImageData;
});

test("assets: KTX2 compressed decoder zorunluluğu", async () => {
  const bytes = ktx2Fixture();
  const compressed = bytes.slice();
  const view = new DataView(compressed.buffer);
  view.setUint32(12, 0, true);
  view.setUint32(44, 1, true);
  globalThis.fetch = async () => fakeResponse(compressed);
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  await assert.rejects(() => loader.loadKTX2("/compressed.ktx2"), /decoder/);
  const decoded = await loader.loadKTX2("/compressed.ktx2", { decoder: () => ({ width: 2, height: 1, close() {} }) });
  assert.equal(decoded.sourceWidth, 2);
  loader.destroy();
  globalThis.fetch = previousFetch;
});

test("assets: destroy sonrası ve pixel preflight", async () => {
  let destroyedSignal;
  globalThis.fetch = (_url, { signal }) => {
    destroyedSignal = signal;
    return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  const loader = new AssetLoader({ baseURL: "http://127.0.0.1:4174/" });
  const pending = loader.loadBytes("/destroyed.bin");
  await Promise.resolve();
  loader.destroy();
  assert.equal(destroyedSignal.aborted, true);
  await assert.rejects(pending, /aborted/);
  await assert.rejects(() => loader.loadBytes("/after-destroy.bin"), /yok edilmiş/);

  // PNG header pixel preflight
  const oversizedPNG = new Uint8Array(24);
  oversizedPNG.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  oversizedPNG.set([0x49, 0x48, 0x44, 0x52], 12);
  oversizedPNG.set([0x00, 0x00, 0x13, 0x88, 0x00, 0x00, 0x00, 0x01], 16);
  const bitmapCallsBefore = globalThis.createImageBitmap;
  let bitmapCalls = 0;
  globalThis.createImageBitmap = async () => { bitmapCalls += 1; return { width: 1, height: 1, close() {} }; };
  globalThis.fetch = async () => fakeResponse(oversizedPNG);
  await assert.rejects(() => new AssetLoader({ baseURL: "http://127.0.0.1:4174/", maxImageSize: 4096 }).loadTexture("/oversized.png"), /boyutu/);
  assert.equal(bitmapCalls, 0);
  globalThis.fetch = previousFetch;
  globalThis.createImageBitmap = bitmapCallsBefore;
});

test("saveStore: set/get ve limitler", () => {
  const values = new Map();
  const storage = { setItem: (key, value) => values.set(key, value), getItem: (key) => values.get(key) ?? null, removeItem: (key) => values.delete(key) };
  const saves = new SaveStore({ storage, namespace: "smoke" });
  saves.set("progress", { level: 2, unlocked: true });
  assert.deepEqual(saves.get("progress"), { level: 2, unlocked: true });
  assert.throws(() => new SaveStore({ storage, maxBytes: 0 }), /limiti/);
  assert.throws(() => new SaveStore({ storage, maxBytes: 16 * 1024 * 1024 + 1 }), /limiti/);
  assert.throws(() => new SaveStore({ storage, namespace: "n".repeat(65) }), /limiti/);
  assert.throws(() => saves.set("k".repeat(129), true), /limiti/);
  const unicode = new SaveStore({ storage, namespace: "unicode", maxBytes: 20 });
  assert.throws(() => unicode.set("emoji", "😀😀😀😀😀"), /çok büyük/);
  values.set("unicode:oversized", `"${"😀".repeat(20)}"`);
  assert.equal(unicode.get("oversized", "fallback"), "fallback");
  const deep = "[".repeat(65) + "0" + "]".repeat(65);
  values.set("smoke:deep", deep);
  assert.equal(saves.get("deep", "fallback"), "fallback");
  const direct = new SaveStore({ storage, namespace: "direct" });
  direct.maxBytes = 16 * 1024 * 1024;
  assert.throws(() => direct.set("progress", { safe: true }), /limiti/);
  const small = new SaveStore({ storage, namespace: "small", maxBytes: 1 });
  assert.throws(() => small.set("too-large", "x".repeat(20)), /çok büyük/);
});
