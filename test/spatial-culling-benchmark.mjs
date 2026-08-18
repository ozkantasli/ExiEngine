import { Camera, Scene, SpriteBatch, Texture } from "../src/index.js";
import { buildRenderBatches } from "../src/render/batch.js";

const spriteCount = Math.min(100_000, Math.max(1, Number.parseInt(process.argv[2] || "10000", 10) || 10000));
const frameCount = Math.min(600, Math.max(1, Number.parseInt(process.argv[3] || "60", 10) || 60));
const scene = new Scene();
const batch = new SpriteBatch({ texture: Texture.white, instanced: true, spatialCulling: true, cellSize: 64, chunkSize: 128 });
for (let index = 0; index < spriteCount; index += 1) batch.addSprite({ x: (index % 200) * 20, y: Math.floor(index / 200) * 20, width: 12, height: 12 });
scene.add(batch);
const camera = new Camera({ width: 320, height: 180 });
const warmQueue = buildRenderBatches(scene, camera, 320, 180);
let spatialVisibilityChecks = 0;
const originalIsChunkVisible = batch.isChunkVisible.bind(batch);
batch.isChunkVisible = (...args) => { spatialVisibilityChecks += 1; return originalIsChunkVisible(...args); };
const visibleIndices = batch.visibleIndices;
const cullingCorners = batch.cullingCorners;
const visibleChunkBounds = batch.visibleChunkBounds;
const firstVisibleChunkBounds = visibleChunkBounds[0];
let sameScratchFrames = 0;
let sameBoundsFrames = 0;
let visibleSpriteTotal = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  camera.position.x = frame % 100;
  camera.position.y = (frame * 2) % 100;
  const queue = buildRenderBatches(scene, camera, 320, 180);
  if (batch.visibleIndices === visibleIndices && batch.cullingCorners === cullingCorners) sameScratchFrames += 1;
  if (batch.visibleChunkBounds === visibleChunkBounds && batch.visibleChunkBounds[0] === firstVisibleChunkBounds) sameBoundsFrames += 1;
  visibleSpriteTotal += queue.batches[0]?.instanceCount || 0;
}
const elapsedMs = performance.now() - start;
const result = {
  sprites: spriteCount,
  frames: frameCount,
  warmVisibleInstances: warmQueue.batches[0]?.instanceCount || 0,
  averageVisibleInstances: Number((visibleSpriteTotal / frameCount).toFixed(2)),
  sameScratchFrames,
  scratchReallocations: frameCount - sameScratchFrames,
  sameBoundsFrames,
  boundsReallocations: frameCount - sameBoundsFrames,
  spatialVisibilityChecks,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGL2/WebGPU driver/GPU FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameScratchFrames !== frameCount || sameBoundsFrames !== frameCount || spatialVisibilityChecks >= frameCount * 256) process.exitCode = 1;
