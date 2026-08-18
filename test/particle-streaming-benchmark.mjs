import { Camera, ParticleEmitter, Scene, Texture } from "../src/index.js";
import { buildRenderBatches } from "../src/render/batch.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const particleCount = Math.min(100_000, positiveInteger(process.argv[2], 1_000));
const frameCount = Math.min(600, positiveInteger(process.argv[3], 60));
const width = 1280;
const height = 720;
const scene = new Scene();
const emitter = new ParticleEmitter({
  texture: new Texture({ id: "particle-streaming-benchmark-texture", sourceWidth: 16, sourceHeight: 16 }),
  maxParticles: particleCount,
  lifetime: 10,
  gravityY: 4,
  random: () => 0.5,
});
emitter.emit(particleCount, { size: 8, vx: 1, vy: -1 });
scene.add(emitter);
const camera = new Camera({ width, height });
const warmQueue = buildRenderBatches(scene, camera, width, height);
const sourceData = warmQueue.batches[0]?.instanceData;
const sourceItems = emitter.instanceItems;
if (!(sourceData instanceof Float32Array)) throw new Error("Particle benchmark kaynak buffer üretmedi.");

let sameBufferFrames = 0;
let sameViewFrames = 0;
let sameItemListFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  emitter.update(1 / 60);
  camera.position.x = frame % 3;
  const queue = buildRenderBatches(scene, camera, width, height);
  const nextData = queue.batches[0]?.instanceData;
  if (nextData === sourceData) sameBufferFrames += 1;
  if (emitter.instanceView === sourceData) sameViewFrames += 1;
  if (emitter.instanceItems === sourceItems) sameItemListFrames += 1;
  if (nextData?.[0] === undefined) throw new Error("Particle benchmark güncellenen kaydı okuyamadı.");
}
const elapsedMs = performance.now() - start;
const result = {
  particles: particleCount,
  frames: frameCount,
  instanceBytes: sourceData.byteLength,
  sameBufferFrames,
  sameViewFrames,
  sameItemListFrames,
  bufferReallocations: frameCount - sameBufferFrames,
  viewReallocations: frameCount - sameViewFrames,
  itemListReallocations: frameCount - sameItemListFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGL2/WebGPU sürücü ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameBufferFrames !== frameCount || sameViewFrames !== frameCount || sameItemListFrames !== frameCount) process.exitCode = 1;
