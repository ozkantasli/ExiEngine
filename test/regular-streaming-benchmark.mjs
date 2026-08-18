import { Camera, Scene, SpriteBatch, Texture } from "../src/index.js";
import { buildRenderBatches } from "../src/render/batch.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const spriteCount = Math.min(100_000, positiveInteger(process.argv[2], 1_000));
const frameCount = Math.min(600, positiveInteger(process.argv[3], 60));
const width = 1280;
const height = 720;
const scene = new Scene();
const texture = new Texture({ id: "regular-streaming-benchmark-texture", sourceWidth: 16, sourceHeight: 16 });
const batch = new SpriteBatch({ texture, chunkSize: 256, cullable: false });
for (let index = 0; index < spriteCount; index += 1) batch.addSprite({ x: (index % 100) * 18, y: Math.floor(index / 100) * 18, width: 12, height: 12 });
scene.add(batch);
const camera = new Camera({ width, height });
buildRenderBatches(scene, camera, width, height);
const firstItems = batch.getRenderItems();
const firstBuffers = firstItems.map((item) => [item.positions, item.uvs, item.colors]);

let sameBufferFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  batch.setSprite(0, { x: frame % 120, tint: frame % 2 === 0 ? 0xff0000 : 0x00ff00 });
  buildRenderBatches(scene, camera, width, height);
  const nextItems = batch.getRenderItems();
  if (nextItems.length !== firstBuffers.length || nextItems.every((item, index) => item.positions === firstBuffers[index][0] && item.uvs === firstBuffers[index][1] && item.colors === firstBuffers[index][2])) sameBufferFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  sprites: spriteCount,
  frames: frameCount,
  chunks: firstBuffers.length,
  sameBufferFrames,
  bufferReallocations: frameCount - sameBufferFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGL2 driver ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameBufferFrames !== frameCount) process.exitCode = 1;
