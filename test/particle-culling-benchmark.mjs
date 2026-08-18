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
  texture: new Texture({ id: "particle-culling-benchmark-texture", sourceWidth: 16, sourceHeight: 16 }),
  maxParticles: particleCount,
  x: 10_000,
  y: 10_000,
  lifetime: 10,
});
emitter.emit(particleCount, { size: 8 });
scene.add(emitter);

const offscreenQueue = buildRenderBatches(scene, camera, width, height);
const offscreenInstanceCount = emitter.instanceItem?.instanceCount || 0;
const offscreenCulledCount = offscreenQueue.culledCount;

emitter.position.set(0, 0);
const visibleWarmQueue = buildRenderBatches(scene, camera, width, height);
const visibleInstanceCount = visibleWarmQueue.batches[0]?.instanceCount || 0;
const visibleView = emitter.instanceView;
let sameViewFrames = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  const queue = buildRenderBatches(scene, camera, width, height);
  if (emitter.instanceView === visibleView) sameViewFrames += 1;
  if (queue.batches[0]?.instanceCount !== particleCount) process.exitCode = 1;
}

const result = {
  particles: particleCount,
  frames: frameCount,
  offscreenInstanceCount,
  offscreenCulledCount,
  visibleInstanceCount,
  sameViewFrames,
  viewReallocations: frameCount - sameViewFrames,
  note: "Node particle packed-culling sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (offscreenInstanceCount !== 0 || offscreenCulledCount !== particleCount || visibleInstanceCount !== particleCount || sameViewFrames !== frameCount) process.exitCode = 1;
