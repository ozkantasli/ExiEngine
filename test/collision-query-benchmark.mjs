import { Camera, Collider, CollisionWorld, Scene, Sprite, Texture, getAABB } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const scene = new Scene();
const world = new CollisionWorld();
const spatialWorld = new CollisionWorld({ spatial: true, cellSize: 64 });
for (let index = 0; index < 1_000; index += 1) {
  const sprite = new Sprite({ texture: Texture.white, width: 8, height: 8, x: (index % 100) * 12, y: Math.floor(index / 100) * 12 });
  scene.add(sprite);
  const collider = new Collider(sprite);
  world.add(collider);
  spatialWorld.add(collider);
}
scene.updateWorldMatrix();
spatialWorld.rebuild();
const probe = new Sprite({ texture: Texture.white, width: 8, height: 8, x: 12, y: 12 });
scene.add(probe);
scene.updateWorldMatrix();
const bounds = getAABB(probe);
const cachedProbeCollider = new Collider(probe);
const cachedProbeBounds = cachedProbeCollider.bounds;
const results = [];
const spatialResults = [];
world.query(bounds, undefined, results);
spatialWorld.query(bounds, undefined, spatialResults);
let sameResultListFrames = 0;
let firstHitFrames = 0;
let sameColliderBoundsFrames = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  probe.position.x = frame % 20;
  scene.updateWorldMatrix();
  if (cachedProbeCollider.bounds === cachedProbeBounds) sameColliderBoundsFrames += 1;
  const nextBounds = getAABB(probe);
  if (world.query(nextBounds, undefined, results) === results) sameResultListFrames += 1;
  if (world.firstHit(nextBounds)) firstHitFrames += 1;
}
const elapsedMs = performance.now() - start;
let spatialSameResultListFrames = 0;
let spatialFirstHitFrames = 0;
const spatialStart = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  probe.position.x = frame % 20;
  scene.updateWorldMatrix();
  const nextBounds = getAABB(probe);
  if (spatialWorld.query(nextBounds, undefined, spatialResults) === spatialResults) spatialSameResultListFrames += 1;
  if (spatialWorld.firstHit(nextBounds)) spatialFirstHitFrames += 1;
}
const spatialElapsedMs = performance.now() - spatialStart;
const result = {
  colliders: 1_000,
  frames: frameCount,
  sameResultListFrames,
  firstHitFrames,
  sameColliderBoundsFrames,
  queryListReallocations: frameCount - sameResultListFrames,
  colliderBoundsReallocations: frameCount - sameColliderBoundsFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  spatial: {
    sameResultListFrames: spatialSameResultListFrames,
    firstHitFrames: spatialFirstHitFrames,
    queryListReallocations: frameCount - spatialSameResultListFrames,
    elapsedMs: Number(spatialElapsedMs.toFixed(2)),
    simulatedFramesPerSecond: Number((frameCount / Math.max(spatialElapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  },
  note: "Node collision sözleşme ölçümü; gerçek fiziksel cihaz FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameResultListFrames !== frameCount || firstHitFrames !== frameCount || sameColliderBoundsFrames !== frameCount || spatialSameResultListFrames !== frameCount || spatialFirstHitFrames !== frameCount) process.exitCode = 1;
