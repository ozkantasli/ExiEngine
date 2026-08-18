import { Node, Scene } from "../src/index.js";

const nodeCount = Math.min(100_000, Math.max(1, Math.floor(Number(process.argv[2]) || 10_000)));
const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[3]) || 60)));
const scene = new Scene();
const nodes = [];
for (let index = 0; index < nodeCount; index += 1) {
  const node = new Node({ x: index % 100, y: Math.floor(index / 100) });
  scene.add(node);
  nodes.push(node);
}
scene.updateWorldMatrix();
const staticVersion = nodes[Math.floor(nodeCount / 2)]._worldVersion;
let sameStaticVersionFrames = 0;
const staticStart = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  scene.updateWorldMatrix();
  if (nodes[Math.floor(nodeCount / 2)]._worldVersion === staticVersion) sameStaticVersionFrames += 1;
}
const staticElapsedMs = performance.now() - staticStart;
const movingNode = nodes[0];
let previousMovingVersion = movingNode._worldVersion;
let movingVersionChanges = 0;
const movingStart = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  movingNode.position.x = frame + 1;
  scene.updateWorldMatrix();
  if (movingNode._worldVersion > previousMovingVersion) movingVersionChanges += 1;
  previousMovingVersion = movingNode._worldVersion;
}
const movingElapsedMs = performance.now() - movingStart;
const result = {
  nodes: nodeCount,
  frames: frameCount,
  sameStaticVersionFrames,
  movingVersionChanges,
  staticElapsedMs: Number(staticElapsedMs.toFixed(2)),
  movingElapsedMs: Number(movingElapsedMs.toFixed(2)),
  note: "Node transform sözleşme ölçümü; gerçek GPU sürücüsü veya fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameStaticVersionFrames !== frameCount || movingVersionChanges !== frameCount) process.exitCode = 1;
