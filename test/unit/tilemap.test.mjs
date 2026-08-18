// ExiEngine unit test — TileMap
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Texture, TileMap, PhysicsWorld, PhysicsBody, Sprite, Camera } from "../../src/index.js";
import { buildRenderBatches } from "../../src/render/batch.js";

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
