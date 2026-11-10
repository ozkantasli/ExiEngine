// ExiEngine unit test — TileMap
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Texture, TileMap, PhysicsWorld, PhysicsBody, Sprite, Camera } from "../../src/index.js";
import { buildRenderBatches } from "../../src/render/batch.js";

test("tilemap: setTile sonrası getInstanceItems getRenderItems'ı bozamaz (ayrı dirty)", () => {
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  const camera = new Camera({ width: 320, height: 180 });
  map.setTiles([0, -1]);
  map.getInstanceItems(camera, 320, 180);
  assert.equal(map.getInstanceItems(camera, 320, 180)[0].instanceCount, 1);
  map.setTile(1, 0, 1);
  map.getInstanceItems(camera, 320, 180);
  assert.equal(map.getInstanceItems(camera, 320, 180)[0].instanceCount, 2);
  assert.equal(map.getRenderItems().length, 2);
  map.setTiles([0, -1]);
  assert.equal(map.getRenderItems().length, 1);
  map.rebuild();
  map.getInstanceItems(camera, 320, 180);
  assert.equal(map.getRenderItems().length, 1);
  map.destroy();
  assert.deepEqual(map.getRenderItems(), []);
  assert.deepEqual(map.getInstanceItems(camera, 320, 180), []);
});

test("tilemap: temel setTile/getTile/getFrame", () => {
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  map.setTiles([0, 1]);
  assert.equal(map.getTile(0, 0), 0);
  assert.equal(map.getTile(1, 0), 1);
  assert.equal(map.getTile(0.5, 0), -1);
  assert.throws(() => map.setTile(0, 0, NaN), /index/);
  assert.throws(() => map.setTile(0, 0, 2 ** 32), /index/);
  const uneven = new TileMap({ texture: new Texture({ sourceWidth: 10, sourceHeight: 8 }), tileWidth: 4, tileHeight: 4, columns: 2, rows: 1 });
  uneven.setTile(0, 0, 0).setTile(1, 0, 1);
  assert.equal(uneven.getFrame(1).u0, 0.4);
  assert.equal(uneven.getFrame(2).u0, 0);
  assert.equal(uneven.getFrame(2).v0, 0.5);
  assert.throws(() => uneven.getFrame(4), /sınır/);
  assert.throws(() => new TileMap({ texture: Texture.white, tileWidth: 1, tileHeight: 1, columns: 1000, rows: 501 }), /limiti/);
});

test("tilemap: flip flag ve setTile seçenekleri", () => {
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  map.setTiles([0, 1]);
  const frame = map.getFrame(1);
  map.setTile(1, 0, 1, { flipX: true, flipY: true });
  assert.equal(map.tileFlags[1], 3);
  map.setTile(1, 0, 1);
  assert.equal(map.tileFlags[1], 0);
  assert.throws(() => map.setTile(0, 0, 0, null), /seçenek/);
  assert.throws(() => map.setTile(0, 0, 99), /index/);
});

test("tilemap: getCollisionRects ve createStaticBodies", () => {
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 4, rows: 3, x: 10, y: 20 });
  map.setTiles([0, 0, -1, -1, 0, 0, -1, -1, -1, -1, 1, 1]);
  const rects = map.getCollisionRects(new Set([0, 1]));
  assert.deepEqual(rects, [{ x: 0, y: 0, width: 32, height: 32 }, { x: 32, y: 32, width: 32, height: 16 }]);
  assert.equal(map.getCollisionRects(new Set([0])).length, 1);
  assert.equal(map.getCollisionRects((tileIndex) => tileIndex === 1).length, 1);
  const scene = new Scene();
  scene.add(map);
  const world = new PhysicsWorld({ scene, gravityY: 0 });
  const controller = map.createStaticBodies(world, { solidTiles: new Set([0, 1]), tag: "map" });
  assert.equal(controller.bodies.length, 2);
  assert.equal(world.bodies.size, 2);
  scene.updateWorldMatrix();
  assert.equal(controller.bodies[0].collider.bounds.left, 10);
  map.setTile(0, 0, -1);
  assert.equal(controller.rebuild(), controller);
  assert.equal(controller.bodies.length, 3);
  controller.destroy();
  assert.equal(world.bodies.size, 0);
});

test("tilemap: lifecycle controller ve static cache", () => {
  const scene = new Scene();
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1, staticCache: true, instanced: false });
  map.setTiles([0, 1]);
  scene.add(map);
  const world = new PhysicsWorld({ scene, gravityY: 0 });
  const controller = map.createStaticBodies(world, { solidTiles: new Set([0, 1]) });
  // 2x1 map'te iki solid tile yan yana → birleşik tek rect → 1 body
  assert.equal(world.bodies.size, 1);
  map.destroy();
  assert.equal(world.bodies.size, 0);
  assert.equal(controller.destroyed, true);

  const camera = new Camera({ width: 320, height: 180 });
  const key = map.getStaticRenderKey(camera, 320, 180);
  assert.equal(typeof key, "number");
});

test("tilemap: setRegion atomik ve culling", () => {
  const map = new TileMap({ texture: new Texture({ sourceWidth: 32, sourceHeight: 16 }), tileWidth: 16, tileHeight: 16, columns: 4, rows: 4, gpuCulling: false });
  map.setRegion(1, 1, 2, 2, new Int32Array([0, 1, 1, 0]));
  assert.equal(map.getTile(1, 1), 0);
  assert.equal(map.getTile(2, 1), 1);
  const snapshot = map.tiles.slice();
  assert.throws(() => map.setRegion(1, 1, 2, 2, [0, 1, 99, 0]), /sınır/);
  assert.deepEqual(map.tiles, snapshot);
  assert.throws(() => map.setRegion(3, 3, 2, 2, [0, 0, 0, 0]), /sınır/);

  const culled = new TileMap({ texture: new Texture({ sourceWidth: 16, sourceHeight: 16 }), tileWidth: 16, tileHeight: 16, columns: 100, rows: 100, gpuCulling: false });
  culled.setTiles(new Int32Array(100 * 100).fill(0));
  const camera = new Camera({ width: 64, height: 64 });
  const queue = buildRenderBatches(culled, camera, 64, 64);
  assert.equal(queue.batches[0].instanceCount, 4);
  assert.equal(queue.culledCount, 9_996);
  camera.position.set(800, 800);
  const moved = buildRenderBatches(culled, camera, 64, 64);
  assert.equal(moved.batches[0].instanceCount, 16);
});

test("tilemap: render batch ve getLocalBounds cache", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const map = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  map.setTiles([0, 1]);
  assert.equal(map.getLocalBounds(), map.getLocalBounds());
  const queue = buildRenderBatches(map, camera, 320, 180);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].vertexCount, 12);
  assert.equal(queue.batches[0].instanced, true);
});

// --- Tiled (.tmj) import ---------------------------------------------------
function tiledMap(overrides = {}, layerOverrides = {}) {
  return {
    width: 3, height: 2, tilewidth: 16, tileheight: 16, orientation: "orthogonal", infinite: false,
    layers: [
      { type: "objectgroup", name: "spawns", objects: [] },
      { type: "tilelayer", name: "ground", width: 3, height: 2, data: [1, 2, 0, 0, 4, 1], offsetx: 4, offsety: -2, opacity: 0.5, ...layerOverrides },
      { type: "tilelayer", name: "decor", width: 3, height: 2, data: [0, 0, 3, 0, 0, 0] },
    ],
    tilesets: [{ firstgid: 1, name: "tiles", tilewidth: 16, tileheight: 16, tilecount: 8, columns: 4, margin: 0, spacing: 0,
      tiles: [{ id: 1, properties: [{ name: "solid", type: "bool", value: true }] }, { id: 3, properties: [{ name: "solid", type: "bool", value: false }, { name: "kind", type: "string", value: "spike" }] }] }],
    ...overrides,
  };
}
const tiledTexture = () => new Texture({ sourceWidth: 64, sourceHeight: 32 });

test("tilemap: fromTiled imports the first tile layer with offset/opacity/name", () => {
  const map = TileMap.fromTiled(tiledMap(), { texture: tiledTexture(), x: 10, alpha: 0.5 });
  assert.equal(map.columns, 3);
  assert.equal(map.rows, 2);
  assert.equal(map.tileWidth, 16);
  assert.deepEqual(Array.from(map.tiles), [0, 1, -1, -1, 3, 0]);
  assert.equal(map.name, "ground");
  assert.equal(map.position.x, 14);
  assert.equal(map.position.y, -2);
  assert.equal(map.alpha, 0.25);
  assert.equal(map.visible, true);
  map.destroy();
});

test("tilemap: fromTiled selects layer by name or index and honors hidden layers", () => {
  const byName = TileMap.fromTiled(tiledMap(), { texture: tiledTexture(), layer: "decor", name: "custom" });
  assert.deepEqual(Array.from(byName.tiles), [-1, -1, 2, -1, -1, -1]);
  assert.equal(byName.name, "custom");
  const byIndex = TileMap.fromTiled(tiledMap({}, { visible: false }), { texture: tiledTexture(), layer: 1 });
  assert.equal(byIndex.visible, false);
  assert.throws(() => TileMap.fromTiled(tiledMap(), { texture: tiledTexture(), layer: 0 }), /not supported/);
  assert.throws(() => TileMap.fromTiled(tiledMap(), { texture: tiledTexture(), layer: "missing" }), /not found/);
  assert.throws(() => TileMap.fromTiled(tiledMap(), { texture: tiledTexture(), layer: 9 }), /out of range/);
});

test("tilemap: fromTiled maps flip bits to tile flags and rejects diagonal flips", () => {
  const data = [(0x80000000 | 1) >>> 0, (0x40000000 | 2) >>> 0, 0, 0, 0, (0xC0000000 | 1) >>> 0];
  const map = TileMap.fromTiled(tiledMap({}, { data }), { texture: tiledTexture() });
  assert.deepEqual(Array.from(map.tiles), [0, 1, -1, -1, -1, 0]);
  assert.deepEqual(Array.from(map.tileFlags), [1, 2, 0, 0, 0, 3]);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: [(0x20000000 | 1) >>> 0, 0, 0, 0, 0, 0] }), { texture: tiledTexture() }), /rotated/);
});

test("tilemap: fromTiled decodes uncompressed base64 layer data", () => {
  const bytes = new Uint8Array(new Uint32Array([1, 2, 0, 0, 4, (0x80000000 | 1) >>> 0]).buffer);
  const data = Buffer.from(bytes).toString("base64");
  const map = TileMap.fromTiled(tiledMap({}, { data, encoding: "base64" }), { texture: tiledTexture() });
  assert.deepEqual(Array.from(map.tiles), [0, 1, -1, -1, 3, 0]);
  assert.equal(map.tileFlags[5], 1);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data, encoding: "base64", compression: "zlib" }), { texture: tiledTexture() }), /compressed/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: "AAAA", encoding: "base64" }), { texture: tiledTexture() }), /size/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: "!!!!", encoding: "base64" }), { texture: tiledTexture() }), /base64|size/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: "x", encoding: "csv" }), { texture: tiledTexture() }), /base64/);
});

test("tilemap: fromTiled honors multiple tilesets by firstgid", () => {
  const map = tiledMap({ tilesets: [{ firstgid: 1, tilecount: 8 }, { firstgid: 9, name: "props", tilecount: 8 }] }, { data: [9, 10, 0, 0, 0, 16] });
  const props = TileMap.fromTiled(map, { texture: tiledTexture(), tileset: "props" });
  assert.deepEqual(Array.from(props.tiles), [0, 1, -1, -1, -1, 7]);
  assert.throws(() => TileMap.fromTiled(map, { texture: tiledTexture() }), /different tileset/);
});

test("tilemap: fromTiled rejects unsupported or invalid maps with explicit errors", () => {
  const texture = tiledTexture();
  assert.throws(() => TileMap.fromTiled(null, { texture }), /object/);
  assert.throws(() => TileMap.fromTiled(tiledMap(), {}), /texture/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ orientation: "isometric" }), { texture }), /orthogonal/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ infinite: true }), { texture }), /infinite/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { chunks: [] }), { texture }), /chunked/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ width: 0 }), { texture }), /width/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ width: 1000, height: 1000 }), { texture }), /limit/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { width: 2 }), { texture }), /size/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: [1, 2] }), { texture }), /size/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: [1, 2, 0, 0, 0, -1] }), { texture }), /gid/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { opacity: 2 }), { texture }), /opacity/);
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { offsetx: Infinity }), { texture }), /offsetx/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ tilesets: [{ firstgid: 1, margin: 1 }] }), { texture }), /margin/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ tilesets: [{ firstgid: 1, tilewidth: 8 }] }), { texture }), /tilewidth/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ tilesets: [] }), { texture }), /no tileset/);
  assert.throws(() => TileMap.fromTiled(tiledMap({ layers: [] }), { texture }), /no tile layer/);
  // Tile ids beyond the texture grid are still rejected by the existing TileMap validation.
  assert.throws(() => TileMap.fromTiled(tiledMap({}, { data: [8, 0, 0, 0, 0, 0] }), { texture: new Texture({ sourceWidth: 32, sourceHeight: 16 }) }), /TileMap/);
});

test("tilemap: tiledTileIdsWithProperty feeds solidTiles/createStaticBodies", () => {
  const level = tiledMap();
  const solid = TileMap.tiledTileIdsWithProperty(level, "solid");
  assert.deepEqual([...solid], [1]);
  assert.deepEqual([...TileMap.tiledTileIdsWithProperty(level, "kind", { value: "spike" })], [3]);
  assert.equal(TileMap.tiledTileIdsWithProperty(tiledMap({ tilesets: [{ firstgid: 1 }] }), "solid").size, 0);
  assert.throws(() => TileMap.tiledTileIdsWithProperty(level, ""), /property name/);
  const map = TileMap.fromTiled(level, { texture: tiledTexture() });
  const rects = map.getCollisionRects(solid);
  assert.deepEqual(rects.map(({ x, y, width, height }) => [x, y, width, height]), [[16, 0, 16, 16]]);
  const world = new PhysicsWorld();
  const bodies = map.createStaticBodies(world, { solidTiles: solid });
  assert.equal(bodies.bodies.length, 1);
  map.destroy();
});
