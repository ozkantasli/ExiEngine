import assert from "node:assert/strict";
import { GlyphAtlas, Text } from "../src/index.js";

const iterations = Math.min(600, Math.max(1, Number.parseInt(process.argv[2] || "120", 10) || 120));
const previousOffscreenCanvas = globalThis.OffscreenCanvas;
const counters = { fill: 0, image: 0, clear: 0 };

globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext(type) {
    if (type !== "2d") return null;
    return {
      font: "",
      measureText: (value) => ({ width: String(value).length * 8 }),
      clearRect: () => { counters.clear += 1; },
      setTransform() {},
      fillText: () => { counters.fill += 1; },
      strokeText() {},
      drawImage: () => { counters.image += 1; },
    };
  }
};

try {
  const atlas = new GlyphAtlas({ width: 128, height: 128, maxEntries: 128, maxPixels: 16_384 });
  const label = new Text({ text: "SCORE 00", font: "16px sans-serif", glyphAtlas: atlas });
  const initialTexture = label.texture;
  const imagesBefore = counters.image;
  for (let frame = 0; frame < iterations; frame += 1) label.setText(`SCORE ${String(frame % 100).padStart(2, "0")}`);
  const complexBefore = atlas.size;
  const complex = new Text({ text: "سلام", font: "16px sans-serif", glyphAtlas: atlas });
  assert.equal(atlas.size, complexBefore);
  assert.equal(label.texture, initialTexture);
  assert.ok(counters.image - imagesBefore >= iterations);
  assert.ok(atlas.size <= 20);
  const result = {
    iterations,
    glyphEntries: atlas.size,
    atlasDraws: counters.image - imagesBefore,
    glyphRasterizations: atlas.size,
    textureReallocations: label.texture === initialTexture ? 0 : 1,
    complexScriptFallback: true,
    note: "Node Canvas 2D sözleşme ölçümü; gerçek GPU upload/FPS ölçümü değildir.",
  };
  console.log(JSON.stringify(result, null, 2));
  complex.destroy();
  label.destroy();
  atlas.clear();
} finally {
  if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
  else globalThis.OffscreenCanvas = previousOffscreenCanvas;
}
