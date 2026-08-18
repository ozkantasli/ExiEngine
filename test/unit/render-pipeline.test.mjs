// ExiEngine unit test — render pipeline (buildRenderBatches / createRenderBatchState / collectRenderGroups)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Node, Sprite, Camera, Texture, TextureAtlas, Graphics, SpriteBatch, ParticleEmitter, TileMap, RenderGroup, RenderTexture } from "../../src/index.js";
import { buildRenderBatches, collectRenderGroups, createRenderBatchState } from "../../src/render/batch.js";

test("pipeline: compact batch cache ve scratch reuse", () => {
  const scene = new Scene();
  const batch = new SpriteBatch({ texture: Texture.white });
  batch.addSprite({ x: -20, y: 0, width: 12, height: 12, tint: 0xff0000 });
  batch.addSprite({ x: 20, y: 0, width: 12, height: 12, tint: 0x00ff00, rotation: Math.PI / 4 });
  scene.add(batch);
  const camera = new Camera({ width: 320, height: 180 });
  const state = createRenderBatchState();
  const renderablesScratch = state.renderables;
  const pointsScratch = state.screenPoints;
  const queue = buildRenderBatches(scene, camera, 320, 180, { state });
  assert.equal(queue.nodeCount, 1);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].vertexCount, 12);
  assert.equal(queue.batches[0].staticOwner, batch);
  assert.equal(queue.batches[0].data[4], 1);
  assert.equal(state.renderables, renderablesScratch);
  assert.equal(state.screenPoints, pointsScratch);
  const again = buildRenderBatches(scene, camera, 320, 180, { state });
  assert.equal(state.batches[0], queue.batches[0]);
  assert.equal(again.batches[0].data, queue.batches[0].data);
  // setSprite sprite kaydını günceller; data buffer'ı korunur (cache sözleşmesi)
  const spriteRecord = batch.sprites[0];
  batch.setSprite(0, { x: 4 });
  assert.equal(batch.sprites[0], spriteRecord);
  assert.equal(batch.sprites[0].x, 4);
  assert.equal(batch.removeSprite(0), true);
  assert.equal(batch.count, 1);
  const afterRemove = buildRenderBatches(scene, camera, 320, 180, { state });
  assert.equal(afterRemove.batches[0].vertexCount, 6);
});

test("pipeline: renderOrder cache ve equal-z kararlılığı", () => {
  const frameOne = new Texture({ id: "ro-one" });
  const frameTwo = new Texture({ id: "ro-two" });
  const scene = new Scene();
  const firstParent = new Node({ zIndex: 0 });
  const secondParent = new Node({ zIndex: 10 });
  const first = new Sprite({ texture: frameOne, zIndex: 100, width: 4, height: 4 });
  const second = new Sprite({ texture: frameTwo, zIndex: -100, width: 4, height: 4 });
  firstParent.add(first);
  secondParent.add(second);
  scene.add(firstParent, secondParent);
  const camera = new Camera({ width: 320, height: 180 });
  const state = createRenderBatchState();
  const queue = buildRenderBatches(scene, camera, 320, 180, { state });
  assert.equal(queue.batches[0].texture, frameTwo);
  assert.equal(state.renderOrderRebuilds, 1);
  buildRenderBatches(scene, camera, 320, 180, { state });
  assert.equal(state.renderOrderRebuilds, 1);

  const equalScene = new Scene();
  const equalFirst = new Sprite({ texture: frameOne, zIndex: 0, width: 4, height: 4 });
  const equalSecond = new Sprite({ texture: frameTwo, zIndex: 0, width: 4, height: 4 });
  equalScene.add(equalFirst, equalSecond);
  const equalState = createRenderBatchState();
  buildRenderBatches(equalScene, camera, 320, 180, { state: equalState });
  equalScene.remove(equalFirst);
  equalScene.add(equalFirst);
  assert.equal(buildRenderBatches(equalScene, camera, 320, 180, { state: equalState }).batches[0].texture, frameTwo);
});

test("pipeline: alpha ve filter mirası", () => {
  const scene = new Scene();
  const group = new Node({ alpha: 0.5 });
  const sprite = new Sprite({ width: 8, height: 8, alpha: 0.8 });
  group.add(sprite);
  scene.add(group);
  const camera = new Camera({ width: 320, height: 180 });
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(group.worldAlpha, 0.5);
  assert.equal(sprite.worldAlpha, 0.4);
  assert.ok(Math.abs(queue.batches[0].data[7] - 0.4) < 1e-6);
  group.setAlpha(0);
  assert.equal(buildRenderBatches(scene, camera, 320, 180).batches.length, 0);
  group.setAlpha(0.25);
  assert.ok(Math.abs(buildRenderBatches(scene, camera, 320, 180).batches[0].data[7] - 0.2) < 1e-6);

  const filterScene = new Scene();
  const filterGroup = new Node({ filter: "grayscale", filterAmount: 0.6 });
  const filtered = new Sprite({ width: 8, height: 8 });
  const overriding = new Sprite({ width: 8, height: 8, x: 16, filter: "invert", filterAmount: 0.25 });
  filterGroup.add(filtered, overriding);
  filterScene.add(filterGroup);
  const filterQueue = buildRenderBatches(filterScene, camera, 320, 180);
  assert.equal(filtered.worldFilter, "grayscale");
  assert.equal(filtered.worldFilterAmount, 0.6);
  assert.equal(overriding.worldFilter, "invert");
  assert.equal(filterQueue.batches.length, 2);
  assert.equal(filterQueue.batches[0].filterType, "grayscale");
  assert.equal(filterQueue.batches[1].filterType, "invert");
  filterGroup.clearFilter();
  buildRenderBatches(filterScene, camera, 320, 180);
  assert.equal(filtered.worldFilter, "none");
});

test("pipeline: culling (offscreen, subtree, tile)", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const scene = new Scene();
  scene.add(new Sprite({ x: 10000, y: 10000 }));
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.ok(queue.culledCount >= 1);

  const cullSubtree = new Node({ x: 10000, y: 10000, cullBounds: { x: -8, y: -8, width: 16, height: 16 } });
  const cullChild = new Sprite({ width: 8, height: 8 });
  let childCalls = 0;
  const original = cullChild.getRenderItems.bind(cullChild);
  cullChild.getRenderItems = (...args) => { childCalls += 1; return original(...args); };
  cullSubtree.add(cullChild);
  scene.add(cullSubtree);
  assert.equal(buildRenderBatches(scene, camera, 320, 180).culledCount >= 1, true);
  assert.equal(childCalls, 0);
  cullSubtree.position.set(0, 0);
  buildRenderBatches(scene, camera, 320, 180);
  assert.equal(childCalls, 1);

  const offscreenTile = new TileMap({ texture: new Texture({ sourceWidth: 32, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 32, rows: 32, x: 10000, y: 10000 });
  offscreenTile.setTile(0, 0, 0);
  const tileScene = new Scene();
  tileScene.add(offscreenTile);
  const tileQueue = buildRenderBatches(tileScene, camera, 320, 180);
  assert.equal(tileQueue.culledCount, 1);
});

test("pipeline: scissor/clip ve mask", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const scene = new Scene();
  const clipGroup = new Node({ clipRect: { x: 20, y: 20, width: 140, height: 90 } });
  clipGroup.add(new Sprite({ width: 24, height: 24 }));
  scene.add(clipGroup, new Sprite({ x: 10, y: 10, width: 12, height: 12, zIndex: 1 }));
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.scissorCount, 1);
  assert.equal(queue.batches.length, 2);
  assert.deepEqual(queue.batches[0].clip, { x: 20, y: 20, width: 140, height: 90 });

  const maskScene = new Scene();
  const maskGroup = new Node({ clipRect: { x: 20, y: 20, width: 100, height: 80 }, maskRect: { x: 40, y: 10, width: 60, height: 90 } });
  maskGroup.add(new Sprite({ width: 12, height: 12 }));
  maskScene.add(maskGroup);
  const maskQueue = buildRenderBatches(maskScene, camera, 320, 180);
  assert.deepEqual(maskQueue.batches[0].clip, { x: 40, y: 20, width: 60, height: 80 });
});

test("pipeline: renderGroup toplama ve post-process", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const renderGroup = new RenderGroup({ width: 64, height: 32, x: 20, y: 30, filter: "invert", filterAmount: 0.5, effects: [{ filter: "sepia", amount: 0.25 }, { filter: "contrast", amount: 0.2 }] });
  renderGroup.add(new Sprite({ width: 8, height: 8 }));
  const scene = new Scene();
  scene.add(renderGroup);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.nodeCount, 1);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].texture, renderGroup.target);
  assert.equal(queue.batches[0].filterType, "invert");
  const offscreen = buildRenderBatches(renderGroup, renderGroup.getRenderCamera(), 64, 32, { offscreenRoot: true });
  assert.equal(offscreen.nodeCount, 1);
  const post = renderGroup.getPostProcessState();
  assert.equal(post.effects.length, 2);
  assert.equal(post.targets.length, 2);
  assert.equal(collectRenderGroups(scene).length, 1);
  renderGroup.destroy();
});

test("pipeline: graphics static cache ve alpha invalidasyon", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const scene = new Scene();
  const group = new Node({ alpha: 0.5 });
  const graphics = new Graphics({ staticCache: true }).rect(0, 0, 8, 8);
  group.add(graphics);
  scene.add(group);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  const data = queue.batches[0].data;
  assert.ok(Math.abs(data[7] - 0.5) < 1e-6);
  group.setAlpha(0.25);
  const changed = buildRenderBatches(scene, camera, 320, 180);
  assert.notEqual(changed.batches[0].data, data);
  assert.ok(Math.abs(changed.batches[0].data[7] - 0.25) < 1e-6);
  group.setFilter("invert", 0.5);
  const filtered = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(filtered.batches[0].filterType, "invert");
  assert.notEqual(filtered.batches[0].data, changed.batches[0].data);
});

test("pipeline: instanced ve gpuCulling batch", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const batch = new SpriteBatch({ texture: Texture.white, instanced: true, chunkSize: 1 });
  batch.addSprite({ x: -20, y: 0, width: 12, height: 12, tint: 0xff0000 });
  batch.addSprite({ x: 20, y: 0, width: 12, height: 12, tint: 0x00ff00, rotation: Math.PI / 4 });
  const scene = new Scene();
  scene.add(batch);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].instanced, true);
  assert.equal(queue.batches[0].instanceCount, 2);
  assert.equal(queue.batches[0].instanceData.length, 28);
  assert.equal(queue.batches[0].vertexCount, 12);
  assert.equal(queue.batches[0].instanceStride, 14);
  assert.equal(batch.getStaticRenderKey(camera, 320, 180), null);

  const spatial = new SpriteBatch({ texture: Texture.white, instanced: true, gpuCulling: true, spatialCulling: true, cellSize: 32, chunkSize: 2 });
  spatial.addSprite({ x: 1000, width: 12, height: 12 });
  spatial.addSprite({ x: 0, width: 12, height: 12 });
  const spatialScene = new Scene();
  spatialScene.add(spatial);
  const spatialQueue = buildRenderBatches(spatialScene, camera, 320, 180);
  assert.equal(spatialQueue.culledCount, 1);
  assert.equal(spatialQueue.batches[0].instanceCount, 1);
  const gpuQueue = buildRenderBatches(spatialScene, camera, 320, 180, { gpuCulling: true });
  assert.equal(gpuQueue.batches[0].gpuCulling, true);
  assert.equal(gpuQueue.batches[0].instanceCount, 2);
  assert.equal(gpuQueue.batches[0].instanceStride, 16);
});

test("pipeline: particle ve tilemap instanced queue", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const emitter = new ParticleEmitter({ maxParticles: 2, random: () => 0.5 });
  emitter.emit(2, { size: 2 });
  const emitterScene = new Scene();
  emitterScene.add(emitter);
  const emitterQueue = buildRenderBatches(emitterScene, camera, 320, 180);
  assert.equal(emitterQueue.batches[0].instanced, true);
  assert.equal(emitter.instanceView, emitterQueue.batches[0].instanceData);

  const tileMap = new TileMap({ texture: new Texture({ sourceWidth: 64, sourceHeight: 32 }), tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  tileMap.setTiles([0, 1]);
  const tileScene = new Scene();
  tileScene.add(tileMap);
  const tileQueue = buildRenderBatches(tileScene, camera, 320, 180);
  assert.equal(tileQueue.batches.length, 1);
  assert.equal(tileQueue.batches[0].vertexCount, 12);
  assert.equal(tileQueue.batches[0].instanced, true);
  const gpuTileQueue = buildRenderBatches(tileScene, camera, 320, 180, { gpuCulling: true });
  assert.equal(gpuTileQueue.batches[0].gpuCulling, true);
  assert.equal(gpuTileQueue.batches[0].instanceStride, 16);
  assert.equal(gpuTileQueue.batches[0].instanceCount, 2);
});

test("pipeline: atlas batch ve flip UV", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const base = new Texture({ id: "pipeline-atlas", sourceWidth: 64, sourceHeight: 32 });
  const atlas = TextureAtlas.fromJSON(base, { frames: { left: { frame: { x: 0, y: 0, w: 32, h: 32 } }, right: { frame: { x: 32, y: 0, w: 32, h: 32 } } } });
  const batch = new SpriteBatch({ texture: base });
  batch.addSprite({ texture: atlas.get("left"), x: -16 });
  batch.addSprite({ texture: atlas.get("right"), x: 16 });
  const scene = new Scene();
  scene.add(batch);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].vertexCount, 12);
  assert.equal(queue.batches[0].data[10], 0.5);
  const flipped = new Sprite({ texture: atlas.get("left"), width: 32, height: 32, flipX: true, flipY: true });
  assert.equal(flipped.getRenderItems()[0].uvs[0], atlas.get("left").u1);
  flipped.setFlip(false, true);
  assert.equal(flipped.getRenderItems()[0].uvs[0], atlas.get("left").u0);
});
