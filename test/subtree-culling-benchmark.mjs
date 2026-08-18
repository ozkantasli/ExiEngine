import { buildRenderBatches, createRenderBatchState } from "../src/render/batch.js";
import { Camera } from "../src/core/camera.js";
import { Node, Scene } from "../src/core/node.js";
import { Sprite } from "../src/core/sprite.js";

const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const childCount = 2_000;
const scene = new Scene();
const camera = new Camera({ width: 320, height: 180 });
const subtree = new Node({ x: 10_000, y: 10_000, cullBounds: { x: -32, y: -32, width: 900, height: 700 } });

class CountingSprite extends Sprite {
  getRenderItems(...args) {
    this.renderItemCalls += 1;
    return super.getRenderItems(...args);
  }
}

const children = [];
for (let index = 0; index < childCount; index += 1) {
  const child = new CountingSprite({ x: (index % 50) * 16, y: Math.floor(index / 50) * 16, width: 8, height: 8 });
  child.renderItemCalls = 0;
  children.push(child);
  subtree.add(child);
}
scene.add(subtree);
const state = createRenderBatchState();
let offscreenCulled = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  const queue = buildRenderBatches(scene, camera, 320, 180, { state });
  offscreenCulled += queue.culledCount;
  if (queue.nodeCount !== 0 || queue.batches.length !== 0) process.exitCode = 1;
}
const offscreenRenderItemCalls = children.reduce((sum, child) => sum + child.renderItemCalls, 0);
subtree.position.set(0, 0);
const visibleQueue = buildRenderBatches(scene, camera, 320, 180, { state });
const visibleRenderItemCalls = children.reduce((sum, child) => sum + child.renderItemCalls, 0) - offscreenRenderItemCalls;
const result = {
  childCount,
  frames: frameCount,
  subtreeCulledFrames: offscreenCulled,
  offscreenRenderItemCalls,
  visibleRenderItemCalls,
  visibleNodeCount: visibleQueue.nodeCount,
  note: "Node subtree cullBounds sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (offscreenCulled !== frameCount || offscreenRenderItemCalls !== 0 || visibleRenderItemCalls !== childCount || visibleQueue.nodeCount !== childCount) process.exitCode = 1;
