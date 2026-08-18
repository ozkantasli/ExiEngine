// ExiEngine unit test — Graphics
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graphics, Camera } from "../../src/index.js";

test("graphics: primitives ve bounds", () => {
  const gfx = new Graphics({ staticCache: true }).rect(0, 0, 10, 10, { fill: 0xff0000 }).circle(20, 20, 5, { fill: 0x00ff00, segments: 8 });
  const items = gfx.getRenderItems();
  assert.deepEqual(items[0].bounds, { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(items[1].bounds, { x: 15, y: 15, width: 10, height: 10 });
  const extra = new Graphics();
  extra.ellipse(50, 50, 30, 20, { fill: 0xff0000 });
  extra.triangle(0, 0, 10, 0, 5, 10, { fill: 0x00ff00 });
  extra.roundedRect(100, 100, 80, 40, 5, { fill: 0x0000ff });
  extra.strokeRect(0, 0, 100, 50, 2);
  extra.strokeCircle(50, 50, 25, 2);
  const extraItems = extra.getRenderItems();
  assert.ok(extraItems.length >= 5);
  assert.ok(extra.getLocalBounds().width > 0);
});

test("graphics: polygon ve doğrulama", () => {
  const poly = new Graphics().polygon([0, 0, 20, 0, 20, 20, 10, 8, 10, 30, 0, 20]);
  const item = poly.getRenderItems()[0];
  assert.equal(item.positions.length, 24);
  assert.deepEqual(item.bounds, { x: 0, y: 0, width: 20, height: 30 });
  assert.throws(() => new Graphics().polygon([0, 0, 1, 1]), /en az üç nokta/);
  assert.throws(() => new Graphics().polygon([0, 0, 10, 10, 0, 10, 10, 0]), /alanı geçersiz/);
  assert.throws(() => new Graphics().polygon(new Array(514).fill(0)), /nokta limiti/);
});

test("graphics: staticCache invalidasyon ve clear", () => {
  const gfx = new Graphics().rect(0, 0, 8, 8);
  const items = gfx.getRenderItems();
  const item = items[0];
  const positions = item.positions;
  assert.equal(gfx.getRenderItems(), items);
  const bounds = gfx.getLocalBounds();
  assert.equal(gfx.getLocalBounds(), bounds);
  gfx.clear();
  assert.equal(gfx.getRenderItems().length, 0);
  gfx.rect(1, 2, 9, 10);
  const rebuilt = gfx.getRenderItems();
  assert.equal(rebuilt, items);
  assert.equal(rebuilt[0], item);
  assert.equal(rebuilt[0].positions, positions);
  assert.notEqual(gfx.getLocalBounds(), bounds);
});

test("graphics: limitler ve güvenli değerler", () => {
  const limitProbe = new Graphics();
  limitProbe.commands.length = 4_096;
  assert.throws(() => limitProbe.rect(0, 0, 1, 1), /limiti/);
  const direct = new Graphics();
  direct.commands.length = 4_097;
  assert.throws(() => direct.getRenderItems(), /limiti/);
  assert.throws(() => direct.getLocalBounds(), /limiti/);
  const safe = new Graphics().rect(Infinity, NaN, 8, 8, { alpha: Infinity });
  assert.deepEqual(safe.getLocalBounds(), { x: 0, y: 0, width: 8, height: 8 });
});

test("graphics: static render key", () => {
  const gfx = new Graphics({ staticCache: true }).rect(0, 0, 10, 10, { fill: 0xff0000 });
  const camera = new Camera({ width: 320, height: 180 });
  const key = gfx.getStaticRenderKey(camera, 320, 180);
  assert.equal(typeof key, "number");
  assert.equal(gfx.getStaticRenderKey(camera, 320, 180), key);
  camera.position.x = 3;
  assert.notEqual(gfx.getStaticRenderKey(camera, 320, 180), key);
});

test("graphics: destroy temizliği", () => {
  const gfx = new Graphics({ staticCache: true }).rect(0, 0, 8, 8);
  gfx.getRenderItems();
  gfx.destroy();
  assert.equal(gfx.commands.length, 0);
});
