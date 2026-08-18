import { buildRenderBatches, createRenderBatchState } from "../src/render/batch.js";
import { Camera } from "../src/core/camera.js";
import { Scene } from "../src/core/node.js";
import { Sprite } from "../src/core/sprite.js";

const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const offscreenCount = 2_000;
const scene = new Scene();
const camera = new Camera({ width: 320, height: 180 });
const sprites = [];
for (let index = 0; index < offscreenCount; index += 1) {
  const sprite = new Sprite({ x: 10_000 + index * 16, y: 10_000, width: 8, height: 8 });
  sprites.push(sprite);
  scene.add(sprite);
}
const visible = new Sprite({ x: 32, y: 32, width: 8, height: 8 });
sprites.push(visible);
scene.add(visible);
scene.updateWorldMatrix();

let transformPointCalls = 0;
for (const sprite of sprites) {
  const matrix = sprite.worldMatrix;
  const transformPoint = matrix.transformPoint.bind(matrix);
  matrix.transformPoint = (x, y, out) => { transformPointCalls += 1; return transformPoint(x, y, out); };
}

const state = createRenderBatchState();
let culledSprites = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  culledSprites += buildRenderBatches(scene, camera, 320, 180, { state }).culledCount;
}

const expectedTransformPointCalls = (offscreenCount * 4 + 10) * frameCount;
const result = {
  sprites: sprites.length,
  offscreenSprites: offscreenCount,
  frames: frameCount,
  culledSprites,
  transformPointCalls,
  expectedTransformPointCalls,
  note: "Node tekil Sprite bounds-culling sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (culledSprites !== offscreenCount * frameCount || transformPointCalls !== expectedTransformPointCalls) process.exitCode = 1;
