// ExiEngine unit test — Sprite family (Sprite, NineSliceSprite, AnimatedSprite)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sprite, NineSliceSprite, AnimatedSprite, Texture, MAX_WORLD_COORDINATE } from "../../src/index.js";

test("sprite: güvenli boyutlar ve anchor", () => {
  const safe = new Sprite({ width: Infinity, height: NaN, anchorX: Infinity, alpha: NaN });
  assert.equal(safe.width, 0);
  assert.equal(safe.height, 0);
  assert.equal(safe.anchor.x, 0.5);
  assert.equal(safe.alpha, 1);
  assert.throws(() => new Sprite({ texture: {} }), /texture/);
});

test("sprite: renderItems cache ve invalidasyon", () => {
  const sprite = new Sprite({ width: 20, height: 10, x: 5, y: 6, tint: 0xff0000 });
  const items = sprite.getRenderItems();
  assert.equal(sprite.getRenderItems(), items);
  const positions = items[0].positions;
  sprite.width = 24;
  assert.equal(sprite.getRenderItems()[0], items[0]);
  assert.equal(sprite.getRenderItems()[0].positions, positions);
  sprite.setTint(0x00ffff);
  assert.equal(sprite.getRenderItems()[0].tint, 0x00ffff);
});

test("sprite: getLocalBounds cache", () => {
  const sprite = new Sprite({ width: 20, height: 10 });
  const bounds = sprite.getLocalBounds();
  assert.equal(sprite.getLocalBounds(), bounds);
  sprite.width = 20;
  assert.equal(sprite.getLocalBounds(), bounds);
  assert.equal(bounds.width, 20);
});

test("sprite: setTexture / setFlip / destroy", () => {
  const a = new Texture({ id: "sprite-a" });
  const sprite = new Sprite({ texture: a, width: 8, height: 8 });
  sprite.getRenderItems();
  sprite.destroy();
  assert.equal(sprite.renderItems.length, 0);
  const flip = new Sprite({ texture: a, width: 8, height: 8, flipX: true, flipY: true });
  assert.equal(flip.flipX, true);
  assert.equal(flip.setFlip(false).flipX, false);
});

test("sprite: düşmanca değerler (hostile inputs)", () => {
  const hostile = new Sprite({ width: Number.MAX_VALUE, height: Number.MAX_VALUE, anchorX: Number.MAX_VALUE, anchorY: -Number.MAX_VALUE });
  assert.equal(hostile.width, MAX_WORLD_COORDINATE);
  assert.ok([hostile.getLocalBounds(), ...hostile.getRenderItems().flatMap((item) => item.positions)].flatMap((value) => typeof value === "number" ? [value] : Object.values(value)).every(Number.isFinite));
});

test("nineSlice: 9 parça render ve flip", () => {
  const texture = new Texture({ id: "nine-slice", width: 16, height: 16, sourceWidth: 16, sourceHeight: 16 });
  const nine = new NineSliceSprite({ texture, width: 100, height: 60, left: 6, right: 6, top: 5, bottom: 5 });
  const items = nine.getRenderItems();
  assert.equal(items.length, 9);
  assert.equal(nine.getRenderItems(), items);
  assert.deepEqual(nine.getLocalBounds(), { x: -50, y: -30, width: 100, height: 60 });
  assert.ok(items.every((item) => item.positions.every(Number.isFinite) && item.uvs.every((value) => value >= 0 && value <= 1)));
  nine.setFlip(true, true);
  assert.equal(nine.getRenderItems()[0].uvs[0], texture.u1);
  assert.equal(nine.getRenderItems()[0].uvs[1], texture.v1);
  nine.setSize(8, 7).setBorders({ left: 99, right: 99, top: 99, bottom: 99 });
  assert.equal(nine.getRenderItems().length, 9);
  const hostile = new NineSliceSprite({ width: 1, height: 1, left: Infinity });
  assert.equal(hostile.left, 0);
});

test("animatedSprite: frame ilerleme, pingPong, callback'ler", () => {
  const frameOne = new Texture({ id: "frame-one" });
  const frameTwo = new Texture({ id: "frame-two" });
  let completed = 0;
  const animated = new AnimatedSprite({ frames: [frameOne, frameTwo], frameRate: 10, loop: false, onComplete: () => { completed += 1; } });
  animated.update(0.11);
  assert.equal(animated.currentFrame, 1);
  assert.equal(animated.texture, frameTwo);
  animated.update(0.11);
  assert.equal(animated.playing, false);
  assert.equal(completed, 1);
  animated.gotoFrame(0).play();
  assert.equal(animated.currentFrame, 0);
  const loops = [];
  const pingPong = new AnimatedSprite({ frames: [frameOne, frameTwo], frameRate: 10, pingPong: true, onLoop: (sprite) => loops.push(sprite) });
  pingPong.update(0.11);
  assert.equal(pingPong.currentFrame, 1);
  assert.equal(pingPong.direction, 1);
  pingPong.update(0.11);
  assert.equal(pingPong.currentFrame, 0);
  assert.equal(pingPong.direction, -1);
  pingPong.update(0.11);
  assert.equal(pingPong.currentFrame, 1);
  assert.equal(pingPong.direction, 1);
  assert.deepEqual(loops, [pingPong]);
});

test("animatedSprite: limitler ve frame sahipliği", () => {
  const frameOne = new Texture({ id: "frame-one-b" });
  const frameTwo = new Texture({ id: "frame-two-b" });
  assert.throws(() => new AnimatedSprite({ frames: new Array(4_097).fill(frameOne) }), /limit/);
  assert.throws(() => new AnimatedSprite({ frames: [frameOne], frameRate: 1, onComplete: "not-a-function" }), /onComplete/);
  assert.throws(() => new AnimatedSprite({ frames: [frameOne], frameRate: 1, onLoop: "not-a-function" }), /onLoop/);
  const source = [frameOne, frameTwo];
  const owned = new AnimatedSprite({ frames: source });
  source[0] = frameTwo;
  source.length = 0;
  assert.deepEqual(owned.frames, [frameOne, frameTwo]);
  const direct = new AnimatedSprite({ frames: [frameOne, frameTwo] });
  direct.frames.length = 4_097;
  assert.throws(() => direct.gotoFrame(0), /limiti/);
  assert.throws(() => direct.update(0), /limiti/);
  const bounded = new AnimatedSprite({ frames: [frameOne, frameTwo], frameRate: Infinity });
  bounded.update(Infinity);
  assert.equal(Number.isFinite(bounded.elapsed), true);
});
