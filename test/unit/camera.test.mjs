// ExiEngine unit test — Camera
import { test } from "node:test";
import assert from "node:assert/strict";
import { Camera } from "../../src/index.js";

test("camera: güvenli normalizasyon (Infinity/NaN)", () => {
  const safe = new Camera({ zoom: Infinity, rotation: NaN, width: Infinity, height: NaN });
  assert.equal(safe.zoom, 1);
  assert.equal(safe.rotation, 0);
  assert.equal(safe.width, 1);
  assert.equal(safe.height, 1);
  assert.equal(safe.pixelRatio, 1);
  safe.position.x = Infinity;
  safe.zoom = Infinity;
  safe.rotation = NaN;
  assert.deepEqual(safe.normalize().worldToScreen(Infinity, NaN), { x: 0.5, y: 0.5 });
});

test("camera: worldToScreen / screenToWorld / viewport", () => {
  const density = new Camera({ width: 200, height: 100, pixelRatio: 2 });
  assert.equal(density.pixelRatio, 2);
  assert.deepEqual(density.worldToScreen(10, 5), { x: 120, y: 60 });
  assert.deepEqual(density.screenToWorld(120, 60, { x: 0, y: 0 }), { x: 10, y: 5 });
  const viewportCam = new Camera({ width: 100, height: 50 });
  viewportCam.setScreenViewport(20, 10, 200, 100);
  assert.deepEqual({ x: viewportCam.viewportX, y: viewportCam.viewportY, width: viewportCam.viewportWidth, height: viewportCam.viewportHeight }, { x: 20, y: 10, width: 200, height: 100 });
  assert.deepEqual(viewportCam.worldToScreen(0, 0), { x: 120, y: 60 });
  assert.equal(viewportCam.isScreenPointInViewport(20, 10), true);
  assert.equal(viewportCam.isScreenPointInViewport(19.99, 10), false);
});

test("camera: zoomAt ve pixelRatio sınırı", () => {
  const cam = new Camera({ width: 200, height: 100, pixelRatio: 2 });
  const anchor = cam.screenToWorld(40, 20, { x: 0, y: 0 });
  cam.zoomAt(40, 20, 2);
  assert.deepEqual(cam.screenToWorld(40, 20, { x: 0, y: 0 }), anchor);
  assert.equal(cam.setPixelRatio(99).pixelRatio, 4);
});

test("camera: follow / deadzone / smoothing / clearFollow", () => {
  const point = { x: 100, y: 50 };
  const cam = new Camera();
  assert.equal(cam.follow(point, { offsetX: 10, offsetY: -5 }), cam);
  cam.update();
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 110, y: 45 });
  point.x = 210;
  cam.follow(point, { smoothing: 0.5 });
  cam.update();
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 160, y: 47.5 });
  cam.clearFollow();
  point.x = 500;
  cam.update();
  assert.equal(cam.position.x, 160);
  assert.throws(() => cam.follow({ x: 1 }), /x\/y/);
});

test("camera: deadzone davranışı", () => {
  const point = { x: 10, y: 5 };
  const cam = new Camera();
  cam.follow(point, { deadzoneWidth: 40, deadzoneHeight: 20 });
  cam.update();
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 0, y: 0 });
  point.x = 100; point.y = 50;
  cam.update();
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 80, y: 40 });
  point.x = 95; point.y = 45;
  cam.update();
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 80, y: 40 });
});

test("camera: bounds sınırlaması", () => {
  const bounded = new Camera({ width: 100, height: 50, bounds: { x: 0, y: 0, width: 200, height: 100 } });
  bounded.position.set(-100, 999);
  bounded.normalize();
  assert.deepEqual({ x: bounded.position.x, y: bounded.position.y }, { x: 50, y: 75 });
  bounded.rotation = Math.PI / 2;
  bounded.position.set(-100, 999);
  bounded.normalize();
  assert.ok(Math.abs(bounded.position.x - 25) < 1e-9);
  assert.equal(bounded.position.y, 50);
  assert.throws(() => bounded.setBounds({ x: 0, y: 0, width: Infinity, height: 1 }), /bounds/);
  const direct = new Camera({ width: 100, height: 50 });
  direct.bounds = {};
  assert.throws(() => direct.normalize(), /bounds/);
  direct.bounds = { x: 0, y: 0, width: 200, height: 100 };
  direct.position.set(-100, 999);
  direct.normalize();
  assert.deepEqual({ x: direct.position.x, y: direct.position.y }, { x: 50, y: 75 });
  bounded.clearBounds();
  assert.equal(bounded.bounds, null);
});

test("camera: shake", () => {
  const cam = new Camera({ x: 10, y: 20 });
  cam.shake(10, 0.2, { frequency: 12 });
  assert.equal(cam.isShaking, true);
  cam.update(1 / 60);
  assert.equal(cam.isShaking, true);
  assert.equal(Number.isFinite(cam.position.x) && Number.isFinite(cam.position.y), true);
  cam.clearShake();
  assert.equal(cam.isShaking, false);
  assert.deepEqual({ x: cam.position.x, y: cam.position.y }, { x: 10, y: 20 });
  cam.shake(Infinity, 1);
  assert.equal(cam.isShaking, false);
});

test("camera: getVisibleBounds", () => {
  const cam = new Camera({ x: 100, y: 200, width: 800, height: 600, zoom: 2 });
  assert.deepEqual(cam.getVisibleBounds(), { x: -100, y: 50, width: 400, height: 300 });
});

test("camera: roundPixels", () => {
  const cam = new Camera({ width: 320, height: 180, pixelRatio: 2, roundPixels: true });
  const point = cam.worldToScreen(0.123, 0.456);
  assert.equal(point.x, Math.round(point.x));
  assert.equal(point.y, Math.round(point.y));
  cam.setRoundPixels(false);
  assert.equal(cam.roundPixels, false);
});
