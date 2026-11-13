// ExiEngine unit test — Graphics
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graphics, Camera } from "../../src/index.js";

test("graphics: primitives and bounds", () => {
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

test("graphics: polygon and validation", () => {
  const poly = new Graphics().polygon([0, 0, 20, 0, 20, 20, 10, 8, 10, 30, 0, 20]);
  const item = poly.getRenderItems()[0];
  assert.equal(item.positions.length, 24);
  assert.deepEqual(item.bounds, { x: 0, y: 0, width: 20, height: 30 });
  assert.throws(() => new Graphics().polygon([0, 0, 1, 1]), /at least three points/);
  assert.throws(() => new Graphics().polygon([0, 0, 10, 10, 0, 10, 10, 0]), /area is invalid/);
  assert.throws(() => new Graphics().polygon(new Array(514).fill(0)), /point limit/);
});

test("graphics: staticCache invalidation and clear", () => {
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

test("graphics: limits and safe values", () => {
  const limitProbe = new Graphics();
  limitProbe.commands.length = 4_096;
  assert.throws(() => limitProbe.rect(0, 0, 1, 1), /limit/);
  const direct = new Graphics();
  direct.commands.length = 4_097;
  assert.throws(() => direct.getRenderItems(), /limit/);
  assert.throws(() => direct.getLocalBounds(), /limit/);
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

test("graphics: destroy cleanup", () => {
  const gfx = new Graphics({ staticCache: true }).rect(0, 0, 8, 8);
  gfx.getRenderItems();
  gfx.destroy();
  assert.equal(gfx.commands.length, 0);
});

test("graphics: roundedRect with the radius at half a side (pills, round buttons)", async () => {
  const { Graphics } = await import("../../src/index.js");
  const shapes = new Graphics().roundedRect(0, 0, 6, 6, 3).roundedRect(0, 0, 100, 6, 3).roundedRect(0, 0, 6, 100, 3).roundedRect(0, 0, 40, 40, 99);
  assert.equal(shapes.commands.length, 4);
  for (const command of shapes.commands) {
    const points = command.points;
    for (let index = 2; index < points.length; index += 2) assert.ok(points[index] !== points[index - 2] || points[index + 1] !== points[index - 1], "no duplicate consecutive points");
  }
});
