import { Camera, Scene, Sprite, Texture } from "../src/index.js";
import { buildRenderBatches, createRenderBatchState } from "../src/render/batch.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const width = 1280;
const height = 720;
const scene = new Scene();
const sprite = new Sprite({ texture: new Texture({ id: "queue-streaming-benchmark-texture", sourceWidth: 16, sourceHeight: 16 }), width: 32, height: 32 });
scene.add(sprite);
const camera = new Camera({ width, height });
const state = createRenderBatchState();
const warmQueue = buildRenderBatches(scene, camera, width, height, { state });
const sourceBatch = warmQueue.batches[0];
const sourceData = sourceBatch?.data;
if (!(sourceData instanceof Float32Array)) throw new Error("Queue benchmark kaynak buffer üretmedi.");

let sameBatchFrames = 0;
let sameDataFrames = 0;
let sameQueueFrames = 0;
const sourceQueue = warmQueue;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  sprite.position.x = frame % 5;
  const queue = buildRenderBatches(scene, camera, width, height, { state });
  if (queue === sourceQueue) sameQueueFrames += 1;
  if (queue.batches[0] === sourceBatch) sameBatchFrames += 1;
  if (queue.batches[0]?.data === sourceData) sameDataFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  frames: frameCount,
  sameQueueFrames,
  sameBatchFrames,
  sameDataFrames,
  queueReallocations: frameCount - sameQueueFrames,
  batchReallocations: frameCount - sameBatchFrames,
  dataReallocations: frameCount - sameDataFrames,
  renderOrderRebuilds: state.renderOrderRebuilds,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node queue sözleşme ölçümü; gerçek WebGL2/WebGPU sürücü ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameQueueFrames !== frameCount || sameBatchFrames !== frameCount || sameDataFrames !== frameCount) process.exitCode = 1;
