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
const texture = new Texture({ id: "cpu-instanced-benchmark-texture", sourceWidth: 16, sourceHeight: 16 });
const batch = new SpriteBatch({ texture, instanced: true, cullable: false });
for (let index = 0; index < spriteCount; index += 1) batch.addSprite({ x: (index % 100) * 18, y: Math.floor(index / 100) * 18, width: 12, height: 12 });
scene.add(batch);
const camera = new Camera({ width, height });
const warmQueue = buildRenderBatches(scene, camera, width, height);
const sourceData = warmQueue.batches[0]?.instanceData;
if (!(sourceData instanceof Float32Array)) throw new Error("CPU instanced benchmark kaynak buffer üretmedi.");

let sameBufferFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  const offset = frame % 120;
  batch.setSprite(0, { x: offset, tint: frame % 2 === 0 ? 0xff0000 : 0x00ff00 });
  camera.position.x = frame % 3;
  const queue = buildRenderBatches(scene, camera, width, height);
  const nextData = queue.batches[0]?.instanceData;
  if (nextData === sourceData) sameBufferFrames += 1;
  if (nextData?.[0] === undefined) throw new Error("CPU instanced benchmark güncellenen kaydı okuyamadı.");
}
const elapsedMs = performance.now() - start;
const result = {
  sprites: spriteCount,
  frames: frameCount,
  instanceBytes: sourceData.byteLength,
  sameBufferFrames,
  bufferReallocations: frameCount - sameBufferFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGL2 driver/GPU FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameBufferFrames !== frameCount) process.exitCode = 1;
