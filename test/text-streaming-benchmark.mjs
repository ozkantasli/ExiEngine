import assert from "node:assert/strict";
import { Text, TextCache } from "../src/index.js";

const iterations = Math.min(600, Math.max(1, Number.parseInt(process.argv[2] || "120", 10) || 120));
const previousOffscreenCanvas = globalThis.OffscreenCanvas;

globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext(type) {
    if (type !== "2d") return null;
    return {
      measureText: (value) => ({ width: String(value).length * 8 }),
      clearRect() {}, setTransform() {}, fillText() {}, strokeText() {},
    };
  }
};

try {
  const label = new Text({ text: "FRAME A", font: "16px sans-serif", padding: 2 });
  const initialTexture = label.texture;
  let sameTextureFrames = 0;
  let textureVersionUpdates = 0;
  let sameTextFrames = 0;
  for (let frame = 0; frame < iterations; frame += 1) {
    const previousVersion = label.texture.version;
    const nextText = frame % 2 === 0 ? "FRAME A" : "FRAME B";
    if (nextText === label.text) sameTextFrames += 1;
    label.setText(nextText);
    if (label.texture === initialTexture) sameTextureFrames += 1;
    if (label.texture.version > previousVersion) textureVersionUpdates += 1;
  }

  const dynamic = new Text({ text: "A", font: "16px sans-serif" });
  const dynamicInitialTexture = dynamic.texture;
  dynamic.setText("A longer label");
  const resizedTexture = dynamic.texture;
  assert.notEqual(resizedTexture, dynamicInitialTexture);
  assert.equal(dynamicInitialTexture.destroyed, true);
  assert.equal(sameTextureFrames, iterations);
  assert.equal(textureVersionUpdates, iterations - sameTextFrames);

  const cache = new TextCache({ maxEntries: 16, maxPixels: 4096 });
  const cachedA = new Text({ text: "HUD", font: "16px sans-serif", cache });
  const cachedB = new Text({ text: "HUD", font: "16px sans-serif", cache });
  const cacheHits = cachedA.texture === cachedB.texture ? 1 : 0;
  assert.equal(cacheHits, 1);
  assert.equal(cache.size, 1);
  cachedA.destroy(); cachedB.destroy();
  const clearedEntries = cache.clear();
  assert.equal(clearedEntries, 1);

  const result = {
    iterations,
    sameTextureFrames,
    textureReallocations: iterations - sameTextureFrames,
    textureVersionUpdates,
    sameTextFrames,
    resizeReallocations: resizedTexture === dynamicInitialTexture ? 0 : 1,
    cacheHits,
    clearedEntries,
    note: "Node Canvas 2D sözleşme ölçümü; gerçek GPU upload/FPS ölçümü değildir.",
  };
  console.log(JSON.stringify(result, null, 2));
  label.destroy();
  dynamic.destroy();
  if (sameTextureFrames !== iterations || textureVersionUpdates !== iterations - sameTextFrames || sameTextFrames !== (iterations > 0 ? 1 : 0)) process.exitCode = 1;
} finally {
  if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
  else globalThis.OffscreenCanvas = previousOffscreenCanvas;
}
