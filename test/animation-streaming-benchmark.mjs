import { Camera, Scene, SpriteBatch, Texture } from "../src/index.js";
import { buildRenderBatches, createRenderBatchState } from "../src/render/batch.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const spriteCount = Math.min(100_000, positiveInteger(process.argv[2], 2_000));
const frameCount = Math.min(600, positiveInteger(process.argv[3], 120));
const width = 1280;
const height = 720;
const atlas = new Texture({ id: "animation-streaming-atlas", sourceWidth: 32, sourceHeight: 16 });
const frames = [
  atlas.subTexture({ x: 0, y: 0, width: 16, height: 16 }),
  atlas.subTexture({ x: 16, y: 0, width: 16, height: 16 }),
];
const batch = new SpriteBatch({ texture: atlas, instanced: true, gpuCulling: true, cullable: false });
const sprites = new Array(spriteCount);
for (let index = 0; index < spriteCount; index += 1) sprites[index] = {
  x: (index % 100) * 18,
  y: Math.floor(index / 100) * 18,
  width: 16,
  height: 16,
  frames,
  frameRate: 12,
};
batch.addSprites(sprites.map(({ frames: animationFrames, frameRate, ...options }) => ({ ...options, animation: { frames: animationFrames, frameRate } })));
const scene = new Scene();
scene.add(batch);
const camera = new Camera({ width, height });
const state = createRenderBatchState();
const firstQueue = buildRenderBatches(scene, camera, width, height, { state, gpuCulling: true });
const firstBatch = firstQueue.batches[0];
if (!firstBatch?.gpuSource || !(firstBatch.instanceData instanceof Float32Array)) throw new Error("Animation benchmark GPU source üretmedi.");
const sourceBuffer = firstBatch.instanceData;
let sameBufferFrames = 0;
let advancedFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  const beforeFrame = batch.sprites[0].animation.currentFrame;
  batch.update(1 / 60);
  if (batch.sprites[0].animation.currentFrame !== beforeFrame) advancedFrames += 1;
  const queue = buildRenderBatches(scene, camera, width, height, { state, gpuCulling: true });
  if (queue.batches[0]?.instanceData === sourceBuffer) sameBufferFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  sprites: spriteCount,
  frames: frameCount,
  animatedFrameAdvances: advancedFrames,
  sameInstanceBufferFrames: sameBufferFrames,
  instanceBufferReallocations: frameCount - sameBufferFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node GPU-source streaming sözleşmesi; gerçek WebGL2/WebGPU sürücü ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (advancedFrames === 0 || sameBufferFrames !== frameCount) process.exitCode = 1;
