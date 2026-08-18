import { Camera, Scene, Texture, TileMap } from "../src/index.js";
import { buildRenderBatches } from "../src/render/batch.js";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const frameCount = Math.min(600, positiveInteger(process.argv[2], 60));
const width = 1280;
const height = 720;
const scene = new Scene();
const map = new TileMap({
  texture: new Texture({ id: "tilemap-streaming-benchmark-texture", sourceWidth: 64, sourceHeight: 64 }),
  tileWidth: 16,
  tileHeight: 16,
  columns: 64,
  rows: 64,
  gpuCulling: false,
});
map.setTiles(new Int32Array(64 * 64).fill(0));
scene.add(map);
const camera = new Camera({ width, height });
const warmQueue = buildRenderBatches(scene, camera, width, height);
const sourceData = warmQueue.batches[0]?.instanceData;
const sourceView = map.instanceView;
const sourceItems = map.instanceItems;
if (!(sourceData instanceof Float32Array)) throw new Error("TileMap benchmark kaynak buffer üretmedi.");

let sameBufferFrames = 0;
let sameViewBufferFrames = 0;
let sameItemListFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  camera.position.x = frame % 5;
  const queue = buildRenderBatches(scene, camera, width, height);
  const nextData = queue.batches[0]?.instanceData;
  if (nextData?.buffer === sourceData.buffer) sameBufferFrames += 1;
  if (map.instanceView?.buffer === sourceView.buffer) sameViewBufferFrames += 1;
  if (map.instanceItems === sourceItems) sameItemListFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  tiles: 64 * 64,
  frames: frameCount,
  instanceBytes: sourceData.byteLength,
  sameBufferFrames,
  sameViewBufferFrames,
  sameItemListFrames,
  bufferReallocations: frameCount - sameBufferFrames,
  viewBufferReallocations: frameCount - sameViewBufferFrames,
  itemListReallocations: frameCount - sameItemListFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node ölçümü; gerçek WebGL2/WebGPU sürücü ve fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameBufferFrames !== frameCount || sameViewBufferFrames !== frameCount || sameItemListFrames !== frameCount) process.exitCode = 1;
