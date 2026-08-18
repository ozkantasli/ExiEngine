// ExiEngine unit test — SpriteBatch (compact / instanced / spatial / animation)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, SpriteBatch, Texture, TextureAtlas, Camera } from "../../src/index.js";
import { buildRenderBatches } from "../../src/render/batch.js";

test("spriteBatch: compact batch ve cache", () => {
  const batch = new SpriteBatch({ texture: Texture.white });
  batch.addSprite({ x: -20, y: 0, width: 12, height: 12, tint: 0xff0000 });
  batch.addSprite({ x: 20, y: 0, width: 12, height: 12, tint: 0x00ff00, rotation: Math.PI / 4 });
  const items = batch.getRenderItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].positions.length, 24);
  assert.equal(items[0].colors.length, 48);
  assert.equal(batch.getRenderItems(), items);
  const record = batch.sprites[0];
  const positions = items[0].positions;
  const uvs = items[0].uvs;
  const colors = items[0].colors;
  batch.setSprite(0, { x: 4 });
  assert.equal(batch.sprites[0], record);
  assert.equal(batch.sprites[0].x, 4);
  const updated = batch.getRenderItems();
  assert.equal(updated[0].positions, positions);
  assert.equal(updated[0].uvs, uvs);
  assert.equal(updated[0].colors, colors);
});

test("spriteBatch: markDirty, addSprites, removeSprite, setFrame", () => {
  const batch = new SpriteBatch({ texture: Texture.white });
  batch.addSprite({ x: 0, y: 0, width: 8, height: 8 });
  const items = batch.getRenderItems();
  const positions = items[0].positions;
  batch.sprites[0].x = 24;
  assert.equal(batch.markDirty(), batch);
  const updated = batch.getRenderItems();
  assert.equal(updated[0].positions, positions);
  assert.equal(updated[0].positions[0], 20);
  assert.equal(batch.addSprites([{ x: 0 }, { x: 16, tint: 0xff00ff }]), batch);
  assert.equal(batch.count, 3);
  const count = batch.count;
  assert.throws(() => batch.addSprites([{ x: 32 }, { texture: new Texture({ id: "other-base" }) }]), /atlas\/base texture/);
  assert.equal(batch.count, count);
  assert.equal(batch.addSprites([]), batch);
  assert.throws(() => batch.addSprites(null), /array/);
  assert.equal(batch.setSprite(0, null), true);
  assert.equal(batch.removeSprite(NaN), false);
  assert.equal(batch.removeSprite(0), true);
});

test("spriteBatch: kapasite limitleri", () => {
  const capped = new SpriteBatch({ texture: Texture.white });
  capped.sprites.length = 100_000;
  assert.throws(() => capped.addSprite(), /limiti/);
  const direct = new SpriteBatch({ texture: Texture.white });
  direct.sprites.length = 100_001;
  assert.throws(() => direct.getRenderItems(), /limiti/);
  assert.throws(() => direct.getInstanceItems(null, 320, 180), /limiti/);
  assert.throws(() => direct.getLocalBounds(), /limiti/);
});

test("spriteBatch: spatial culling ve chunk", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const batch = new SpriteBatch({ texture: Texture.white, chunkSize: 2, spatialCulling: true, cellSize: 32 });
  batch.addSprite({ x: 1000, width: 12, height: 12 });
  batch.addSprite({ x: 0, width: 12, height: 12 });
  batch.addSprite({ x: 20, width: 12, height: 12 });
  const scene = new Scene();
  scene.add(batch);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.culledCount, 1);
  assert.equal(queue.batches.length, 1);
  assert.equal(queue.batches[0].vertexCount, 12);
  assert.ok(batch.spatialIndex.size > 0);
  assert.equal(batch.spatialIndex.values().next().value instanceof Map, true);
  assert.equal(batch.renderItems.length, 1);
  const chunkBounds = batch.visibleChunkBounds;
  const first = chunkBounds[0];
  camera.position.x = 4;
  buildRenderBatches(scene, camera, 320, 180);
  assert.equal(batch.visibleChunkBounds, chunkBounds);
  assert.equal(batch.visibleChunkBounds[0], first);
  camera.position.x = 0;
  const chunked = new SpriteBatch({ texture: Texture.white, chunkSize: 1 });
  chunked.addSprite({ x: -1000, width: 12, height: 12 });
  chunked.addSprite({ x: 0, width: 12, height: 12 });
  const chunkScene = new Scene();
  chunkScene.add(chunked);
  const chunkQueue = buildRenderBatches(chunkScene, camera, 320, 180);
  assert.equal(chunkQueue.culledCount, 1);
  assert.equal(chunkQueue.batches[0].vertexCount, 6);
  assert.equal(chunked.chunkItems.filter(Boolean).length, 1);
  assert.equal(chunked.getRenderItems().length, 2);
});

test("spriteBatch: instanced + gpuCulling stream", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const batch = new SpriteBatch({ texture: Texture.white, instanced: true, gpuCulling: true, spatialCulling: true, cellSize: 32, chunkSize: 2 });
  batch.addSprite({ x: 1000, width: 12, height: 12 });
  batch.addSprite({ x: 0, width: 12, height: 12 });
  const scene = new Scene();
  scene.add(batch);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.culledCount, 1);
  assert.equal(queue.batches[0].instanceCount, 1);
  const gpuQueue = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true });
  assert.equal(gpuQueue.batches[0].gpuCulling, true);
  assert.equal(gpuQueue.batches[0].instanceCount, 2);
  assert.equal(gpuQueue.batches[0].instanceStride, 16);
  assert.equal(gpuQueue.batches[0].instanceData.length, 32);
  const data = gpuQueue.batches[0].instanceData;
  assert.equal(batch.setSprite(1, { x: 8, tint: 0xff00ff }), true);
  const stream = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true });
  assert.equal(stream.batches[0].instanceData, data);
  assert.equal(stream.batches[0].instanceData[0 + 16], 8);
  camera.position.x = 25;
  assert.equal(buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true }).batches[0].instanceData, data);
  camera.position.x = 0;
});

test("spriteBatch: atlas frame ve setFrame animasyon", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const base = new Texture({ id: "batch-atlas", sourceWidth: 64, sourceHeight: 32 });
  const atlas = TextureAtlas.fromJSON(base, { frames: { left: { frame: { x: 0, y: 0, w: 32, h: 32 } }, right: { frame: { x: 32, y: 0, w: 32, h: 32 } } } });
  const batch = new SpriteBatch({ texture: base, instanced: true, gpuCulling: true });
  batch.addSprite({ texture: atlas.get("left"), x: 0 });
  batch.addSprite({ texture: atlas.get("left"), x: 16 });
  const scene = new Scene();
  scene.add(batch);
  const queue = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true });
  const source = queue.batches[0].instanceData;
  batch.setFrame(atlas.get("right"));
  const frameQueue = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true });
  assert.equal(frameQueue.batches[0].instanceData, source);
  assert.equal(frameQueue.batches[0].instanceData[8], 0.5);
});

test("spriteBatch: addAnimatedSprite ve animation lifecycle", () => {
  const base = new Texture({ id: "batch-anim-atlas", sourceWidth: 64, sourceHeight: 32 });
  const atlas = TextureAtlas.fromJSON(base, { frames: { left: { frame: { x: 0, y: 0, w: 32, h: 32 } }, right: { frame: { x: 32, y: 0, w: 32, h: 32 } } } });
  const batch = new SpriteBatch({ texture: base, instanced: true, gpuCulling: true });
  let completed = 0;
  const index = batch.addAnimatedSprite({
    frames: [atlas.get("left"), atlas.get("right")],
    frameRate: 10,
    loop: false,
    onComplete: (batch_, idx) => { if (batch_ === batch && idx === index) completed += 1; },
  });
  assert.equal(batch.sprites[index].texture, atlas.get("left"));
  batch.update(0.11);
  assert.equal(batch.sprites[index].animation.currentFrame, 1);
  assert.equal(batch.sprites[index].texture, atlas.get("right"));
  batch.update(0.11);
  assert.equal(batch.sprites[index].animation.playing, false);
  assert.equal(completed, 1);
  assert.equal(batch.gotoSpriteFrame(index, 0), true);
  assert.equal(batch.playSprite(index), true);
  assert.equal(batch.stopSprite(index), true);
  assert.equal(batch.setSpriteAnimation(index, null), true);
  assert.equal(batch.sprites[index].animation, null);
  assert.equal(batch.setSpriteAnimation(99, null), false);
  assert.throws(() => batch.addAnimatedSprite({ frames: [new Texture({ id: "other" })] }), /atlas\/base/);
  assert.throws(() => batch.addAnimatedSprite({ frames: [atlas.get("left")], onComplete: "invalid" }), /onComplete/);
});

test("spriteBatch: pingPong ve frame change callbacks", () => {
  const base = new Texture({ id: "batch-pingpong", sourceWidth: 64, sourceHeight: 32 });
  const atlas = TextureAtlas.fromJSON(base, { frames: { left: { frame: { x: 0, y: 0, w: 32, h: 32 } }, right: { frame: { x: 32, y: 0, w: 32, h: 32 } } } });
  const batch = new SpriteBatch({ texture: base });
  const changes = [];
  const loops = [];
  const index = batch.addAnimatedSprite({
    frames: [atlas.get("left"), atlas.get("right")],
    frameRate: 10, pingPong: true, currentFrame: 0,
    onLoop: (b, i) => loops.push([b, i]),
    onFrameChange: (b, i, frame) => changes.push(frame),
  });
  batch.update(0.11);
  assert.equal(batch.sprites[index].animation.currentFrame, 1);
  assert.deepEqual(changes, [1]);
  batch.update(0.11);
  assert.equal(batch.sprites[index].animation.currentFrame, 0);
  assert.equal(batch.sprites[index].animation.direction, -1);
  batch.update(0.11);
  assert.equal(batch.sprites[index].animation.currentFrame, 1);
  assert.deepEqual(changes, [1, 0, 1]);
  assert.deepEqual(loops, [[batch, index]]);
});

test("spriteBatch: destroy lifecycle", () => {
  const batch = new SpriteBatch({ texture: new Texture({ id: "lifecycle" }) });
  batch.addSprite({ width: 8, height: 8 });
  batch.getRenderItems();
  batch.destroy();
  assert.equal(batch.count, 0);
  assert.equal(batch.spatialIndex.size, 0);
});
