import { PhysicsBody, PhysicsWorld, Scene, Sprite, Texture } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const scene = new Scene();
const floor = new Sprite({ texture: Texture.white, width: 4_096, height: 16, y: 320 });
scene.add(floor);
const world = new PhysicsWorld({ scene, gravityY: 980 });
world.add(new PhysicsBody(floor, { static: true, tag: "floor" }));
for (let index = 0; index < 256; index += 1) {
  const bodyNode = new Sprite({ texture: Texture.white, width: 8, height: 8, x: (index % 64) * 16 - 500, y: Math.floor(index / 64) * 16 });
  scene.add(bodyNode);
  world.add(new PhysicsBody(bodyNode, { tag: "body" }));
}
scene.updateWorldMatrix();
const scratch = world.solidCandidates;
let rebuilds = 0;
const originalRebuild = world.collisionWorld.rebuild.bind(world.collisionWorld);
world.collisionWorld.rebuild = () => { rebuilds += 1; return originalRebuild(); };
const start = performance.now();
let sameScratchFrames = 0;
let finiteFrames = 0;
let rebuildsAfterFirstFrame = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  world.step(1 / 60);
  if (frame === 0) rebuildsAfterFirstFrame = rebuilds;
  if (world.solidCandidates === scratch) sameScratchFrames += 1;
  let finite = true;
  for (const body of world.bodies) if (!Number.isFinite(body.node.position.x) || !Number.isFinite(body.node.position.y) || !Number.isFinite(body.velocity.x) || !Number.isFinite(body.velocity.y)) { finite = false; break; }
  if (finite) finiteFrames += 1;
}
const elapsedMs = performance.now() - start;
const result = {
  bodies: world.bodies.size,
  frames: frameCount,
  sameScratchFrames,
  finiteFrames,
  scratchReallocations: frameCount - sameScratchFrames,
  rebuildsAfterWarmup: rebuilds - rebuildsAfterFirstFrame,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node PhysicsWorld sözleşme ölçümü; gerçek fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameScratchFrames !== frameCount || finiteFrames !== frameCount || rebuilds - rebuildsAfterFirstFrame !== 0) process.exitCode = 1;
