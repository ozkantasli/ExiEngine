import { buildRenderBatches } from "../src/render/batch.js";
import { Camera } from "../src/core/camera.js";
import { ParticleEmitter } from "../src/core/particle-emitter.js";
import { Scene } from "../src/core/node.js";
import { Texture } from "../src/assets/texture.js";

const particleCount = Math.min(10_000, Math.max(1, Math.floor(Number(process.argv[2]) || 2_000)));
const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[3]) || 60)));
const width = 320;
const height = 180;
const scene = new Scene();
const camera = new Camera({ width, height });
const emitter = new ParticleEmitter({
  texture: new Texture({ id: "particle-gpu-culling-benchmark-texture", sourceWidth: 16, sourceHeight: 16 }),
  maxParticles: particleCount,
  gpuCulling: true,
  x: 10_000,
  y: 10_000,
  lifetime: 10,
});
emitter.emit(particleCount, { size: 8, vx: 1, vy: -1 });
scene.add(emitter);
let transformPointCalls = 0;
const originalTransformPoint = emitter.worldMatrix.transformPoint.bind(emitter.worldMatrix);
emitter.worldMatrix.transformPoint = (...args) => { transformPointCalls += 1; return originalTransformPoint(...args); };
const firstQueue = buildRenderBatches(scene, camera, width, height, { gpuCulling: true });
const sourceData = firstQueue.batches[0]?.instanceData;
const sourceView = emitter.instanceView;
let sameBufferFrames = 0;
let sameViewFrames = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  emitter.update(1 / 60);
  const queue = buildRenderBatches(scene, camera, width, height, { gpuCulling: true });
  if (queue.batches[0]?.instanceData === sourceData) sameBufferFrames += 1;
  if (emitter.instanceView === sourceView) sameViewFrames += 1;
  if (queue.batches[0]?.gpuCulling !== true || queue.batches[0]?.gpuSource !== true || queue.batches[0]?.instanceStride !== 16 || queue.batches[0]?.instanceCount !== particleCount) process.exitCode = 1;
}
const result = {
  particles: particleCount,
  frames: frameCount,
  sourceBytes: sourceData?.byteLength || 0,
  sameBufferFrames,
  sameViewFrames,
  transformPointCalls,
  note: "Node ParticleEmitter WebGPU source-stream sözleşme ölçümü; gerçek compute/GPU FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sourceData?.length !== particleCount * 16 || sameBufferFrames !== frameCount || sameViewFrames !== frameCount || transformPointCalls !== 0) process.exitCode = 1;
