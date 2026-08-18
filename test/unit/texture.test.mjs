// ExiEngine unit test — Texture / TextureAtlas / RenderTexture
import { test } from "node:test";
import assert from "node:assert/strict";
import { Texture, TextureAtlas, RenderTexture, MAX_WORLD_COORDINATE } from "../../src/index.js";

test("texture: varsayılanlar ve güvenli normalizasyon", () => {
  const safe = new Texture({ width: Infinity, sourceWidth: Infinity, u0: Infinity, u1: -Infinity });
  assert.equal(safe.width, 1);
  assert.equal(safe.sourceWidth, 1);
  assert.equal(safe.u0, 0);
  assert.equal(safe.u1, 1);
  assert.throws(() => new Texture({ u0: 0.8, u1: 0.2 }), /UV/);
  assert.throws(() => new Texture({ source: { width: 16_385, height: 1 } }), /boyutu/);
  assert.equal(Texture.white.width, 1);
});

test("texture: filter kalıtımı", () => {
  const nearest = new Texture({ id: "nearest", filter: "nearest", sourceWidth: 8, sourceHeight: 8 });
  assert.equal(nearest.filter, "nearest");
  const frame = nearest.subTexture({ x: 0, y: 0, width: 4, height: 4 });
  const sibling = nearest.subTexture({ x: 4, y: 0, width: 4, height: 4 });
  assert.equal(frame.filter, "nearest");
  assert.equal(nearest.setFilter("linear").filter, "linear");
  assert.equal(frame.filter, "linear");
  frame.setFilter("nearest");
  assert.equal(nearest.filter, "nearest");
  sibling.filter = "linear";
  assert.equal(nearest.filter, "linear");
});

test("texture: subTexture UV hesaplaması", () => {
  const base = new Texture({ id: "nested-source", sourceWidth: 100, sourceHeight: 100 });
  const outer = base.subTexture({ x: 20, y: 20, width: 40, height: 30 });
  const inner = outer.subTexture({ x: 10, y: 5, width: 20, height: 10 });
  assert.equal(inner.u0, 0.3);
  assert.equal(inner.v0, 0.25);
  assert.equal(inner.u1, 0.5);
  assert.equal(inner.v1, 0.35);
  assert.throws(() => new Texture({ id: "tiny", sourceWidth: 2, sourceHeight: 2 }).subTexture({ x: 2, y: 0, width: 1, height: 1 }), /sınır/);
});

test("texture: destroy ve markDirty", () => {
  const source = { width: 4, height: 4 };
  const texture = new Texture({ source });
  const frame = texture.subTexture({ x: 0, y: 0, width: 2, height: 2 });
  assert.equal(texture.version, 0);
  frame.markDirty();
  assert.equal(texture.version, 1);
  texture.updateSource({ width: 4, height: 4 });
  assert.equal(texture.version, 2);
  assert.throws(() => texture.updateSource({ width: 8, height: 8 }));
  texture.destroy();
  assert.throws(() => texture.markDirty());
  assert.throws(() => texture.subTexture({ x: 0, y: 0, width: 1, height: 1 }), /yok edilmiş/);
  assert.throws(() => texture.setFilter("nearest"), /yok edilmiş/);
});

test("texture: fromImage ve markDirty source kilit", () => {
  const source = { width: 4, height: 4 };
  const texture = Texture.fromImage(source);
  assert.equal(texture.width, 4);
  const mutableSource = { width: 4, height: 4 };
  const mutable = new Texture({ source: mutableSource });
  mutableSource.width = 8;
  assert.throws(() => mutable.markDirty(), /değiştirilemez/);
});

test("textureAtlas: fromJSON, prototype güvenliği, lifecycle", () => {
  const atlas = TextureAtlas.fromJSON(new Texture({ sourceWidth: 64, sourceHeight: 32 }), { frames: { hero: { frame: { x: 0, y: 0, w: 32, h: 32 } } } });
  assert.equal(atlas.get("hero").u1, 0.5);
  assert.equal(atlas.get("hero"), atlas.get("hero"));
  const proto = TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), JSON.parse('{"frames":{"__proto__":{"frame":{"x":0,"y":0,"w":8,"h":8}}}}'));
  assert.equal(proto.has("__proto__"), true);
  assert.equal(proto.get("__proto__").width, 8);
  const arr = TextureAtlas.fromJSON(new Texture({ sourceWidth: 32, sourceHeight: 16 }), { frames: [
    { filename: "hero/run-0.png", frame: { x: 0, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
    { name: "hero/run-1.png", frame: { x: 16, y: 0, w: 16, h: 16 } },
  ] });
  assert.equal(arr.has("hero/run-0.png"), true);
  assert.equal(arr.get("hero/run-1.png").u0, 0.5);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: [{ filename: "rotated", frame: { x: 0, y: 0, w: 8, h: 8 }, rotated: true }] }), /rotated/);
  assert.throws(() => TextureAtlas.fromJSON(new Texture({ sourceWidth: 16, sourceHeight: 16 }), { frames: [{ filename: "trimmed", frame: { x: 0, y: 0, w: 8, h: 8 }, trimmed: true }] }), /trimmed/);
  const base = new Texture({ id: "atlas-base", sourceWidth: 8, sourceHeight: 8 });
  const lifecycle = new TextureAtlas(base, { hero: { x: 0, y: 0, width: 4, height: 4 } });
  const frame = lifecycle.get("hero");
  lifecycle.destroy();
  assert.equal(lifecycle.destroyed, true);
  assert.equal(frame.destroyed, true);
  assert.equal(base.destroyed, false);
  assert.throws(() => lifecycle.get("hero"), /yok edilmiş/);
});

test("textureAtlas: fromGrid ve kapasite", () => {
  const gridTexture = new Texture({ id: "grid", sourceWidth: 40, sourceHeight: 20 });
  const grid = TextureAtlas.fromGrid(gridTexture, { frameWidth: 8, frameHeight: 8, columns: 4, rows: 2, marginX: 2, marginY: 2, spacingX: 2, spacingY: 2, names: Array.from({ length: 8 }, (_, i) => `frame-${i}`) });
  assert.equal(grid.get("frame-3").u0, 0.8);
  assert.equal(grid.get("frame-3").v1, 0.5);
  assert.deepEqual(grid.getFrames(["frame-0", "frame-1", "frame-0"]), [grid.get("frame-0"), grid.get("frame-1"), grid.get("frame-0")]);
  assert.deepEqual(grid.getClip(["frame-0", "frame-1"], { frameRate: 8, pingPong: true }).frames, [grid.get("frame-0"), grid.get("frame-1")]);
  assert.throws(() => grid.getFrames([]), /dizisi/);
  assert.throws(() => grid.getFrames(["frame-0", 1]), /dizisi/);
  assert.throws(() => grid.getClip(["frame-0"], null), /seçenekleri/);
  const capacity = TextureAtlas.fromGrid(gridTexture, { frameWidth: 8, frameHeight: 8, columns: 4, rows: 2 });
  capacity.frames.set("overflow", { x: 0, y: 0, width: 1, height: 1 });
  assert.throws(() => capacity.get("frame-0"), /frame limiti/);
  assert.throws(() => TextureAtlas.fromGrid(gridTexture, { frameWidth: 16, frameHeight: 8, columns: 3, rows: 1 }));
  assert.throws(() => TextureAtlas.fromGrid(gridTexture, { frameWidth: 8, frameHeight: 8, columns: 2, rows: 1, names: ["same", "same"] }));
});

test("renderTexture: boyut ve subTexture koruması", () => {
  const target = new RenderTexture({ id: "smoke-target", width: 64, height: 32, filter: "nearest" });
  assert.equal(target.renderTarget, true);
  assert.equal(target.source, null);
  assert.equal(target.sourceWidth, 64);
  assert.equal(target.resize(32, 16), target);
  assert.deepEqual({ width: target.width, height: target.height }, { width: 32, height: 16 });
  assert.throws(() => new RenderTexture({ width: 16_385, height: 1 }), /boyutu/);
  assert.throws(() => new RenderTexture({ width: 4097, height: 4096 }), /pixel/);
  assert.throws(() => target.subTexture({ x: 0, y: 0, width: 1, height: 1 }), /alt texture/);
  assert.throws(() => target.updateSource({ width: 64, height: 32 }), /değiştirilemez/);
});

test("renderTexture: renderToTexture eşleşme", () => {
  // RenderTexture boyutu ile engine camera eşleşme kontrolleri engine-smoke'ta;
  // burada temel davranış doğrulanır.
  const target = new RenderTexture({ width: 32, height: 16 });
  assert.equal(target.renderTarget, true);
  target.destroy();
});
