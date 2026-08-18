import { buildRenderBatches } from "../src/render/batch.js";
import { Camera } from "../src/core/camera.js";
import { Graphics } from "../src/core/graphics.js";
import { Scene } from "../src/core/node.js";

const commandCount = Math.min(4_000, Math.max(1, Math.floor(Number(process.argv[2]) || 2_000)));
const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[3]) || 60)));
const scene = new Scene();
const camera = new Camera({ width: 320, height: 180 });
const graphics = new Graphics();
for (let index = 0; index < commandCount; index += 1) graphics.rect(10_000 + index * 16, 10_000, 8, 8);
graphics.rect(32, 32, 8, 8);
scene.add(graphics);
scene.updateWorldMatrix();

let transformPointCalls = 0;
const matrix = graphics.worldMatrix;
const transformPoint = matrix.transformPoint.bind(matrix);
matrix.transformPoint = (x, y, out) => { transformPointCalls += 1; return transformPoint(x, y, out); };

let culledCommands = 0;
for (let frame = 0; frame < frameCount; frame += 1) culledCommands += buildRenderBatches(scene, camera, 320, 180).culledCount;

const expectedTransformPointCalls = (commandCount * 4 + 10) * frameCount;
const result = {
  commands: commandCount + 1,
  offscreenCommands: commandCount,
  frames: frameCount,
  culledCommands,
  transformPointCalls,
  expectedTransformPointCalls,
  note: "Node Graphics item-bounds culling sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (culledCommands !== commandCount * frameCount || transformPointCalls !== expectedTransformPointCalls) process.exitCode = 1;
