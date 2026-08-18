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
const animationAtlas = new Texture({ id: "streaming-benchmark-atlas", sourceWidth: 64, sourceHeight: 16 });
const frameA = animationAtlas.subTexture({ x: 0, y: 0, width: 16, height: 16, id: "streaming-frame-a" });
const frameB = animationAtlas.subTexture({ x: 16, y: 0, width: 16, height: 16, id: "streaming-frame-b" });
const batch = new SpriteBatch({ texture: animationAtlas, instanced: true, gpuCulling: true, cullable: false });

for (let index = 0; index < spriteCount; index += 1) {
  batch.addSprite({ texture: frameA, x: (index % 100) * 18, y: Math.floor(index / 100) * 18, width: 12, height: 12 });
}
scene.add(batch);
const camera = new Camera({ width, height });
const warmQueue = buildRenderBatches(scene, camera, width, height, { gpuCulling: true });
const sourceData = warmQueue.batches[0]?.instanceData;
if (!(sourceData instanceof Float32Array)) throw new Error("GPU streaming benchmark kaynak buffer üretmedi.");

let sameBufferFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  const offset = frame % 120;
  const animationFrame = frame % 2 === 0 ? frameA : frameB;
  batch.setFrame(animationFrame);
  batch.setSprite(0, { x: offset });
  const queue = buildRenderBatches(scene, camera, width, height, { gpuCulling: true });
  const nextData = queue.batches[0]?.instanceData;
  if (nextData === sourceData) sameBufferFrames += 1;
  if (nextData?.[0] !== offset) throw new Error("GPU streaming benchmark güncellenen kaydı okuyamadı.");
  if (nextData?.[8] !== (frame % 2 === 0 ? 0 : 0.25)) throw new Error("GPU animation benchmark frame UV güncellenemedi.");
}
const elapsedMs = performance.now() - start;

const result = {
  sprites: spriteCount,
  frames: frameCount,
  sourceBytes: sourceData.byteLength,
  sameBufferFrames,
  bufferReallocations: frameCount - sameBufferFrames,
  animatedFrameSwitches: frameCount,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGPU driver/GPU FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameBufferFrames !== frameCount) process.exitCode = 1;
