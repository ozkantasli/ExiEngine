import { Camera, ParticleEmitter, Scene, Texture } from "../src/index.js";
import { buildRenderBatches } from "../src/render/batch.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const width = 1280;
const height = 720;
const scene = new Scene();
const emitter = new ParticleEmitter({
  texture: new Texture({ id: "particle-cpu-streaming-benchmark-texture", sourceWidth: 16, sourceHeight: 16 }),
  maxParticles: 1_000,
  lifetime: 100,
  instanced: false,
});
emitter.emit(1_000, { size: 8, vx: 1, vy: -1 });
scene.add(emitter);
const camera = new Camera({ width, height });
buildRenderBatches(scene, camera, width, height);
const sourceItems = emitter.renderItems;
const sourcePositions = sourceItems[0]?.positions;
if (!Array.isArray(sourceItems) || !sourcePositions) throw new Error("Particle CPU benchmark kaynak item üretmedi.");

let sameItemListFrames = 0;
let samePositionsFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  emitter.update(1 / 60);
  camera.position.x = frame % 3;
  buildRenderBatches(scene, camera, width, height);
  if (emitter.renderItems === sourceItems) sameItemListFrames += 1;
  if (emitter.renderItems[0]?.positions === sourcePositions) samePositionsFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  particles: 1_000,
  frames: frameCount,
  sameItemListFrames,
  samePositionsFrames,
  itemListReallocations: frameCount - sameItemListFrames,
  positionsReallocations: frameCount - samePositionsFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node CPU fallback sözleşme ölçümü; gerçek WebGL2 sürücü ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameItemListFrames !== frameCount || samePositionsFrames !== frameCount) process.exitCode = 1;
