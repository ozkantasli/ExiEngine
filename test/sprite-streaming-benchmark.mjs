import { AnimatedSprite, Sprite, Texture } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const atlas = new Texture({ id: "sprite-streaming-atlas", sourceWidth: 32, sourceHeight: 16 });
const frames = [
  atlas.subTexture({ x: 0, y: 0, width: 16, height: 16 }),
  atlas.subTexture({ x: 16, y: 0, width: 16, height: 16 }),
];

const sprite = new Sprite({ texture: frames[0], width: 16, height: 16 });
const firstItems = sprite.getRenderItems();
const firstItem = firstItems[0];
const firstPositions = firstItem.positions;
const firstUvs = firstItem.uvs;
let sameItemListFrames = 0;
let sameItemFrames = 0;
let samePositionsFrames = 0;
let sameUvsFrames = 0;
let textureChanges = 0;
const started = performance.now();

for (let frame = 0; frame < frameCount; frame += 1) {
  const nextTexture = frames[frame & 1];
  if (sprite.texture !== nextTexture) textureChanges += 1;
  sprite.setTexture(nextTexture);
  const items = sprite.getRenderItems();
  if (items === firstItems) sameItemListFrames += 1;
  if (items[0] === firstItem) sameItemFrames += 1;
  if (items[0]?.positions === firstPositions) samePositionsFrames += 1;
  if (items[0]?.uvs === firstUvs) sameUvsFrames += 1;
}

const animated = new AnimatedSprite({ frames, frameRate: 30 });
const animatedItems = animated.getRenderItems();
const animatedItem = animatedItems[0];
const animatedPositions = animatedItem.positions;
const animatedUvs = animatedItem.uvs;
let animatedFrameChanges = 0;
let animatedSameItems = 0;
let animatedSamePositions = 0;
let animatedSameUvs = 0;
for (let frame = 0; frame < frameCount; frame += 1) {
  const before = animated.currentFrame;
  animated.update(1 / 30);
  if (animated.currentFrame !== before) animatedFrameChanges += 1;
  const items = animated.getRenderItems();
  if (items[0] === animatedItem) animatedSameItems += 1;
  if (items[0]?.positions === animatedPositions) animatedSamePositions += 1;
  if (items[0]?.uvs === animatedUvs) animatedSameUvs += 1;
}

const elapsedMs = performance.now() - started;
const result = {
  frames: frameCount,
  textureChanges,
  sameItemListFrames,
  sameItemFrames,
  samePositionsFrames,
  sameUvsFrames,
  animatedFrameChanges,
  animatedSameItems,
  animatedSamePositions,
  animatedSameUvs,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  note: "Node Sprite/AnimatedSprite identity sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (textureChanges === 0 || [sameItemListFrames, sameItemFrames, samePositionsFrames, sameUvsFrames].some((value) => value !== frameCount) || animatedFrameChanges === 0 || [animatedSameItems, animatedSamePositions, animatedSameUvs].some((value) => value !== frameCount)) process.exitCode = 1;
