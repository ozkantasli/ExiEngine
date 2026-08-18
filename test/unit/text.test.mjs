// ExiEngine unit test — Text / TextCache / GlyphAtlas (Canvas 2D stub ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Text, TextCache, GlyphAtlas } from "../../src/index.js";

const previousOffscreenCanvas = globalThis.OffscreenCanvas;
const previousIntl = globalThis.Intl;

const textOps = [];
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext(type) {
    if (type !== "2d") return null;
    return {
      font: "",
      measureText: (value) => ({ width: String(value).length * 8 }),
      clearRect: (...args) => textOps.push(["clear", ...args]),
      setTransform: (...args) => textOps.push(["transform", ...args]),
      fillText: (...args) => textOps.push(["fill", ...args]),
      strokeText: (...args) => textOps.push(["stroke", ...args]),
      drawImage: (...args) => textOps.push(["image", ...args]),
    };
  }
};

test.after(() => {
  if (previousOffscreenCanvas) globalThis.OffscreenCanvas = previousOffscreenCanvas;
  else delete globalThis.OffscreenCanvas;
  if (previousIntl) globalThis.Intl = previousIntl;
  else delete globalThis.Intl;
});

test("text: temel render ve cache", () => {
  const label = new Text({ text: "GPU", font: "16px sans-serif", padding: 2 });
  const texture = label.texture;
  assert.equal(label.width, 28);
  label.setText("CPU");
  assert.equal(label.texture, texture);
  assert.equal(texture.version, 1);
  const ops = textOps.length;
  label.setText("CPU");
  assert.equal(textOps.length, ops);
  label.setText("GPU CORE");
  assert.notEqual(label.texture, texture);
  assert.equal(texture.destroyed, true);
  assert.throws(() => label.setText("x".repeat(16_385)), /limiti/);
  assert.throws(() => label.setText("\n".repeat(16_384)), /limiti/);
  assert.throws(() => label.setStyle({ font: "x".repeat(513) }), /font/);
  label.destroy();
});

test("text: wordWrap ve style", () => {
  const label = new Text({ text: "AAAA BBBB", font: "16px sans-serif", maxWidth: 32, wordWrap: true });
  assert.equal(label.maxWidth, 32);
  assert.equal(label.wordWrap, true);
  assert.equal(label.width, 32);
  label.setStyle({ wordWrap: false });
  assert.equal(label.wordWrap, false);
  assert.ok(label.width > 32);
  const bounded = new Text({ text: "X", font: "99999999999999999999px sans-serif" });
  assert.equal(Number.isFinite(bounded.lineHeight), true);
  assert.ok(bounded.lineHeight <= 4_096);
  label.destroy();
  bounded.destroy();
});

test("text: TextCache paylaşım ve refcount", () => {
  const cache = new TextCache({ maxEntries: 4, maxPixels: 4096 });
  const a = new Text({ text: "SAME", font: "16px sans-serif", cache });
  const b = new Text({ text: "SAME", font: "16px sans-serif", cache });
  const shared = a.texture;
  assert.equal(b.texture, shared);
  assert.equal(cache.size, 1);
  assert.equal(cache.clear(), 0);
  a.destroy();
  assert.equal(shared.destroyed, false);
  b.destroy();
  assert.equal(cache.clear(), 1);
  assert.equal(shared.destroyed, true);
  const limited = new TextCache({ maxEntries: 1, maxPixels: 4096 });
  const limitedA = new Text({ text: "A", cache: limited });
  const limitedB = new Text({ text: "B", cache: limited });
  assert.notEqual(limitedA.texture, limitedB.texture);
  limitedA.destroy(); limitedB.destroy(); limited.clear();
  const direct = new TextCache();
  direct.maxPixels = Number.MAX_SAFE_INTEGER;
  assert.throws(() => direct.acquire("guard", () => null), (error) => error?.code === "EXI_TEXT_CONFIG");
});

test("text: GlyphAtlas grapheme ve kompleks script fallback", () => {
  const atlas = new GlyphAtlas({ width: 64, height: 64, maxEntries: 32, maxPixels: 4096 });
  assert.throws(() => new GlyphAtlas({ width: 4097 }), /limit/);
  assert.throws(() => new GlyphAtlas({ width: 64, height: 64, maxPixels: 1024 }), /pixel/);
  const direct = new GlyphAtlas({ width: 64, height: 64 });
  direct.maxEntries = 8192;
  assert.throws(() => direct.getGlyph("A", { font: "16px sans-serif", fill: "#fff", stroke: null, strokeWidth: 0, resolution: 1 }), (error) => error?.code === "EXI_TEXT_CONFIG");
  direct.destroy();
  const label = new Text({ text: "ABBA 😀", font: "16px sans-serif", glyphAtlas: atlas });
  assert.ok(atlas.size >= 4);
  const count = atlas.size;
  const complex = new Text({ text: "سلام", font: "16px sans-serif", glyphAtlas: atlas });
  assert.equal(atlas.size, count);
  assert.equal(atlas.getInfo().size, count);
  assert.equal(atlas.getInfo().complexScriptFallbacks, 1);
  complex.destroy(); label.destroy(); atlas.clear();
  atlas.destroy();
  const destroyed = new Text({ text: "AB", font: "16px sans-serif", glyphAtlas: atlas });
  assert.equal(atlas.getInfo().destroyed, true);
  destroyed.destroy();
});

test("text: Intl.Segmenter yoksa legacy grapheme", () => {
  globalThis.Intl = { Segmenter: undefined };
  const atlas = new GlyphAtlas({ width: 128, height: 128, maxEntries: 32, maxPixels: 16_384 });
  const label = new Text({ text: "A\u0301👩‍💻🇹🇷", font: "16px sans-serif", glyphAtlas: atlas });
  assert.equal(atlas.size, 3);
  label.destroy();
  atlas.destroy();
});
