import { Graphics } from "../src/core/graphics.js";

const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const graphics = new Graphics().rect(0, 0, 8, 8);
const firstItems = graphics.getRenderItems();
const firstItem = firstItems[0];
const firstPositions = firstItem.positions;
const firstBounds = firstItem.bounds;
let sameItemListFrames = 0;
let sameItemFrames = 0;
let samePositionsFrames = 0;
let sameBoundsFrames = 0;
const started = performance.now();

for (let frame = 0; frame < frameCount; frame += 1) {
  graphics.clear().rect(frame, 0, 8, 8);
  const items = graphics.getRenderItems();
  if (items === firstItems) sameItemListFrames += 1;
  if (items[0] === firstItem) sameItemFrames += 1;
  if (items[0]?.positions === firstPositions) samePositionsFrames += 1;
  if (items[0]?.bounds === firstBounds) sameBoundsFrames += 1;
}

const elapsedMs = performance.now() - started;
const result = {
  frames: frameCount,
  sameItemListFrames,
  sameItemFrames,
  samePositionsFrames,
  sameBoundsFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  note: "Node Graphics dirty-rebuild identity sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if ([sameItemListFrames, sameItemFrames, samePositionsFrames, sameBoundsFrames].some((value) => value !== frameCount)) process.exitCode = 1;
