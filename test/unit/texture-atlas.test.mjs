// ExiEngine unit test — TextureAtlas pack/fromJSON/fromGrid edge'leri
import { test } from "node:test";
import assert from "node:assert/strict";
import { Texture, TextureAtlas } from "../../src/index.js";

const previousOffscreenCanvas = globalThis.OffscreenCanvas;

test.after(() => {
  if (previousOffscreenCanvas) globalThis.OffscreenCanvas = previousOffscreenCanvas;
  else delete globalThis.OffscreenCanvas;
});

test("atlas: pack drawImage sırası ve boyut", () => {
  const packedDraws = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext(type) { return type === "2d" ? { drawImage: (...args) => packedDraws.push(args) } : null; }
  };
  const atlas = TextureAtlas.pack([
    { name: "red", source: { width: 8, height: 8 } },
    { name: "blue", source: { width: 4, height: 6 } },
  ], { padding: 1, maxWidth: 32, maxHeight: 32, id: "smoke-packed-atlas" });
  assert.equal(packedDraws.length, 18);
  assert.equal(packedDraws[1][6], 0);
  assert.equal(atlas.texture.id, "smoke-packed-atlas");
  assert.ok(atlas.texture.width >= 10 && atlas.texture.height >= 10);
  assert.equal(atlas.get("red"), atlas.get("red"));
});

test("atlas: pack texture frame kaynağı", () => {
  const packedDraws = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext(type) { return type === "2d" ? { drawImage: (...args) => packedDraws.push(args) } : null; }
  };
  const sourceTexture = new Texture({ id: "pack-source", source: { width: 16, height: 8 }, width: 16, height: 8 });
  const sourceFrame = sourceTexture.subTexture({ x: 4, y: 2, width: 6, height: 3, id: "pack-source-frame" });
  const atlas = TextureAtlas.pack([{ name: "frame", source: sourceFrame }], { padding: 0, id: "packed-texture-atlas" });
  assert.equal(atlas.get("frame").width, 6);
  assert.deepEqual(packedDraws.at(-1).slice(1, 5), [4, 2, 6, 3]);
});

test("atlas: pack limitler ve red'ler", () => {
  const packedDraws = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext(type) { return type === "2d" ? { drawImage: (...args) => packedDraws.push(args) } : null; }
  };
  assert.throws(() => TextureAtlas.pack([{ name: "too-large", source: { width: 64, height: 64 } }], { maxWidth: 32, maxHeight: 32 }));
  assert.throws(() => TextureAtlas.pack([{ name: "unsafe", source: { width: Number.MAX_SAFE_INTEGER, height: 1 } }]), /boyutu/);
  assert.throws(() => TextureAtlas.pack([{ name: "same", source: { width: 1, height: 1 } }, { name: "same", source: { width: 1, height: 1 } }]));
  assert.throws(() => TextureAtlas.pack([{ name: "one", source: { width: 1, height: 1 } }], { maxWidth: Infinity }), /limitleri/);
});

test("atlas: fromJSON array ve name limitleri", () => {
  const arr = TextureAtlas.fromJSON(new Texture({ sourceWidth: 32, sourceHeight: 16 }), { frames: [
    { filename: "hero/run-0.png", frame: { x: 0, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
    { name: "hero/run-1.png", frame: { x: 16, y: 0, w: 16, h: 16 } },
  ] });
  assert.equal(arr.has("hero/run-0.png"), true);
  assert.equal(arr.get("hero/run-1.png").u0, 0.5);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: [{ filename: "rotated", frame: { x: 0, y: 0, w: 8, h: 8 }, rotated: true }] }), /rotated/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: [{ filename: "trimmed", frame: { x: 0, y: 0, w: 8, h: 8 }, trimmed: true }] }), /trimmed/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: [{ filename: "same", frame: { x: 0, y: 0, w: 8, h: 8 } }, { filename: "same", frame: { x: 8, y: 0, w: 8, h: 8 } }] }), /tekrar/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: { ["x".repeat(257)]: { frame: { x: 0, y: 0, w: 1, h: 1 } } } }), /adı/);
});

test("atlas: kapasite ve lifecycle edge'leri", () => {
  const base = new Texture({ id: "atlas-base", sourceWidth: 8, sourceHeight: 8 });
  const lifecycle = new TextureAtlas(base, { hero: { x: 0, y: 0, width: 4, height: 4 } });
  const frame = lifecycle.get("hero");
  lifecycle.destroy();
  assert.equal(lifecycle.destroyed, true);
  assert.equal(frame.destroyed, true);
  assert.equal(base.destroyed, false);
  assert.throws(() => lifecycle.get("hero"), /yok edilmiş/);
  const externalBase = new Texture({ id: "external", sourceWidth: 8, sourceHeight: 8 });
  const external = new TextureAtlas(externalBase, { hero: { x: 0, y: 0, width: 4, height: 4 } });
  const externalFrame = external.get("hero");
  externalBase.destroy();
  assert.throws(() => external.get("hero"), /yok edilmiş/);
  assert.equal(external.destroyed, true);
  assert.equal(external.has("hero"), false);
  assert.equal(externalFrame.destroyed, true);
  assert.throws(() => new TextureAtlas(externalBase, { hero: { x: 0, y: 0, width: 1, height: 1 } }), /yok edilmiş/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: {} }, { maxFrames: Infinity }), /limiti/);
  assert.throws(() => TextureAtlas.fromGrid(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frameWidth: 16, frameHeight: 16, columns: 1, rows: 1, maxFrames: Infinity }), /limiti/);
  assert.throws(() => new TextureAtlas(Texture.white, { bad: { x: 0, y: 0, width: 2, height: 2 } }), /sınır/);
  assert.throws(() => new TextureAtlas(Texture.white, Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [String(index), { x: 0, y: 0, width: 1, height: 1 }]))), /limiti/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: { bad: { frame: { x: 10, y: 10, w: 10, h: 10 } } } }), /sınır dışı/);
});
