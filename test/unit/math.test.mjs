// ExiEngine unit test — math & pathfinding
// node:test + node:assert/strict; bağımlılık yok.
// Beklenen davranışlar src/core/math.js, src/core/pathfinding.js ve index.d.ts'den alınmıştır.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Vec2, Mat3, clamp, lerp, degToRad, radToDeg, findGridPath, MAX_GRID_PATH_CELLS, MAX_WORLD_COORDINATE, getAABB, intersectsAABB, pointInAABB, containsAABB, Node } from "../../src/index.js";

test("math: Vec2 temel işlemler", () => {
  const v = new Vec2(3, 4);
  assert.equal(v.length(), 5);
  assert.equal(v.lengthSquared(), 25);
  assert.equal(v.dot(new Vec2(2, 1)), 10);
  assert.equal(v.distanceTo(new Vec2(0, 0)), 5);
  assert.equal(v.distanceSquared(new Vec2(0, 0)), 25);
  assert.equal(new Vec2(1, 0).angle(), 0);
  const rotated = new Vec2(1, 0).rotate(Math.PI / 2);
  assert.ok(Math.abs(rotated.x) < 1e-9 && Math.abs(rotated.y - 1) < 1e-9);
  assert.equal(new Vec2(5, 5).equals(new Vec2(5, 5)), true);
  assert.equal(new Vec2(5, 5).equals(new Vec2(5.05, 5), 0.1), true);
  assert.equal(new Vec2(5, 5).equals(new Vec2(6, 5)), false);
  assert.equal(v.multiplyScalar(2).x, 6);
});

test("math: Vec2 güvenli sınırlama (Infinity/NaN/MAX_WORLD)", () => {
  // multiplyScalar sınırlı sonuç üretir (engine-smoke sözleşmesi)
  const safe = new Vec2(Infinity, NaN).multiplyScalar(Infinity);
  assert.deepEqual({ x: safe.x, y: safe.y }, { x: 0, y: 0 });
  const bounded = new Vec2(Number.MAX_VALUE, -Number.MAX_VALUE);
  assert.deepEqual({ x: bounded.x, y: bounded.y }, { x: MAX_WORLD_COORDINATE, y: -MAX_WORLD_COORDINATE });
  const multiplied = new Vec2(2, 3).multiplyScalar(Number.MAX_VALUE);
  assert.equal(multiplied.x, MAX_WORLD_COORDINATE);
});

test("math: Mat3 transform ve taşma koruması", () => {
  assert.deepEqual(new Mat3().transformPoint(2, 3), { x: 2, y: 3 });
  const matrix = new Mat3();
  matrix.a = Number.MAX_VALUE; matrix.d = Number.MAX_VALUE; matrix.tx = Number.MAX_VALUE; matrix.ty = -Number.MAX_VALUE;
  const point = matrix.transformPoint(Number.MAX_VALUE, -Number.MAX_VALUE);
  assert.ok([point.x, point.y].every((value) => Number.isFinite(value) && Math.abs(value) <= MAX_WORLD_COORDINATE));
  // setTransform + multiply (index.d.ts imzaları)
  const manual = new Mat3().setTransform({ x: 5, y: 7 }, { x: 1, y: 1 }, 0);
  assert.deepEqual(manual.transformPoint(1, 1), { x: 6, y: 8 });
  const parent = new Mat3().setTransform({ x: 10, y: 0 }, { x: 1, y: 1 }, 0);
  const local = new Mat3().setTransform({ x: 2, y: 3 }, { x: 1, y: 1 }, 0);
  const composed = new Mat3().multiply(parent, local);
  assert.deepEqual(composed.transformPoint(0, 0), { x: 12, y: 3 });
  assert.equal(new Mat3().identity().a, 1);
});

test("math: yardımcı fonksiyonlar", () => {
  assert.equal(clamp(2, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(clamp(Infinity, 0, 1), 1);
  assert.equal(lerp(0, 10, 0.25), 2.5);
  assert.equal(lerp(0, 10, 2), 20);
  assert.equal(degToRad(180), Math.PI);
  assert.equal(radToDeg(Math.PI), 180);
});

test("math: AABB yardımcıları", () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  const b = { left: 5, top: 5, right: 15, bottom: 15 };
  assert.equal(intersectsAABB(a, b), true);
  assert.equal(intersectsAABB(a, { left: 11, top: 0, right: 20, bottom: 10 }), false);
  assert.equal(containsAABB(a, { left: 2, top: 2, right: 4, bottom: 4 }), true);
  assert.equal(containsAABB(a, { left: 2, top: 2, right: 12, bottom: 4 }), false);
  assert.equal(pointInAABB(a, 5, 5), true);
  assert.equal(pointInAABB(a, 11, 5), false);
  // getAABB gerçek bir Node bekler (worldMatrix üzerinden hesaplar)
  const node = new Node({ x: 0, y: 0, width: 0, height: 0 });
  const bounds = getAABB(node);
  assert.ok(typeof bounds.x === "number" && typeof bounds.width === "number");
});

test("pathfinding: findGridPath temel yol bulma", () => {
  const grid = [
    [0, 0, 0, 1, 0],
    [1, 1, 0, 1, 0],
    [0, 0, 0, 0, 0],
  ];
  const result = findGridPath(grid, [0, 0], { x: 4, y: 2 });
  assert.equal(result.reached, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.path[0], { x: 0, y: 0 });
  assert.deepEqual(result.path.at(-1), { x: 4, y: 2 });
  assert.ok(result.path.every(({ x, y }) => grid[y][x] !== 1));
  assert.ok(MAX_GRID_PATH_CELLS > 0);
});

test("pathfinding: diyagonal ve köşe kırpma seçenekleri", () => {
  const grid = [[0, 1], [1, 0]];
  assert.equal(findGridPath(grid, [0, 0], [1, 1], { diagonal: true }).reached, false);
  assert.equal(findGridPath(grid, [0, 0], [1, 1], { diagonal: true, allowCornerCutting: true }).reached, true);
  assert.equal(findGridPath([[0, 0, 0]], [0, 0], [2, 0], { maxNodes: 1 }).truncated, true);
  assert.equal(findGridPath([[1]], [0, 0], [0, 0]).reached, false);
  assert.throws(() => findGridPath([[0], [0, 0]], [0, 0], [0, 1]), /dikdörtgen/);
  assert.throws(() => findGridPath([[]], [0, 0], [0, 0]), /boş olmayan/);
});
