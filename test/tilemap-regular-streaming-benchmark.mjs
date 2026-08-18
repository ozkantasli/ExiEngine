import { Texture } from "../src/assets/texture.js";
import { TileMap } from "../src/core/tilemap.js";

const frameCount = Math.min(120, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const tileMap = new TileMap({ texture: new Texture({ sourceWidth: 32, sourceHeight: 16 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1, instanced: false });
tileMap.setTiles([0, 1]);
const firstItems = tileMap.getRenderItems();
const firstItem = firstItems[0];
const firstPositions = firstItem.positions;
const firstUvs = firstItem.uvs;
let sameItemListFrames = 0;
let sameItemFrames = 0;
let samePositionsFrames = 0;
let sameUvsFrames = 0;
const started = performance.now();

for (let frame = 0; frame < frameCount; frame += 1) {
  tileMap.setTile(0, 0, frame % 2);
  const items = tileMap.getRenderItems();
  if (items === firstItems) sameItemListFrames += 1;
  if (items[0] === firstItem) sameItemFrames += 1;
  if (items[0]?.positions === firstPositions) samePositionsFrames += 1;
  if (items[0]?.uvs === firstUvs) sameUvsFrames += 1;
}

const elapsedMs = performance.now() - started;
const result = {
  frames: frameCount,
  sameItemListFrames,
  sameItemFrames,
  samePositionsFrames,
  sameUvsFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  note: "Node TileMap regular dirty-rebuild identity sözleşme ölçümü; gerçek WebGL2/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if ([sameItemListFrames, sameItemFrames, samePositionsFrames, sameUvsFrames].some((value) => value !== frameCount)) process.exitCode = 1;
