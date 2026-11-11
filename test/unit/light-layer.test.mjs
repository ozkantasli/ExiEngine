// ExiEngine unit test — LightLayer (ambient + additive point lights composited with multiply)
import { test } from "node:test";
import assert from "node:assert/strict";
import { LightLayer, MAX_LIGHTS, RenderGroup, Scene, Texture } from "../../src/index.js";

const previous = globalThis.OffscreenCanvas;
const gradients = [];
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    return { createRadialGradient: (...args) => { const gradient = { args, stops: [], addColorStop(offset, color) { this.stops.push([offset, color]); } }; gradients.push(gradient); return gradient; }, fillRect() {}, set fillStyle(value) { this.style = value; } };
  }
};
test.after(() => { if (previous) globalThis.OffscreenCanvas = previous; else delete globalThis.OffscreenCanvas; });

test("light layer: a low-resolution multiply RenderGroup covering the world rect", () => {
  const layer = new LightLayer({ x: 100, y: 50, width: 800, height: 400, resolution: 0.25, ambient: 0x101820 });
  assert.ok(layer instanceof RenderGroup);
  assert.equal(layer.blendMode, "multiply");
  assert.deepEqual([layer.width, layer.height], [200, 100]);
  assert.deepEqual([layer.position.x, layer.position.y, layer.scale.x, layer.scale.y], [500, 250, 4, 4]);
  assert.equal(layer.ambient, 0x101820);
  layer.setAmbient(0x202020);
  assert.equal(layer.ambientSprite.tint, 0x202020);
  assert.ok(gradients.length >= 1 && gradients[0].stops.at(-1)[1].endsWith(",0)"), "radial gradient fades to transparent");
  assert.notEqual(layer.lightTexture, Texture.white);
  layer.destroy();
});

test("light layer: lights are world-space objects synced into the light map", () => {
  const scene = new Scene();
  const layer = new LightLayer({ width: 400, height: 200, resolution: 0.5 });
  scene.add(layer);
  const torch = layer.addLight({ x: 100, y: 60, radius: 50, color: 0xffcc88, intensity: 0.75 });
  assert.equal(torch.sprite.blendMode, "additive");
  assert.deepEqual([torch.sprite.position.x, torch.sprite.position.y, torch.sprite.width, torch.sprite.height], [50, 30, 50, 50]);
  assert.equal(torch.sprite.alpha, 0.75);
  torch.x = 300; torch.radius = 20; torch.intensity = 3; torch.color = 0x00ff00;
  scene.update(1 / 60);
  assert.deepEqual([torch.sprite.position.x, torch.sprite.width, torch.sprite.alpha, torch.sprite.tint], [150, 20, 1, 0x00ff00]);
  torch.enabled = false;
  scene.update(1 / 60);
  assert.equal(torch.sprite.visible, false);
  assert.ok(layer.removeLight(torch));
  assert.equal(layer.removeLight(torch), false);
  assert.equal(layer.lights.length, 0);
  layer.addLight({ x: 1, y: 1 });
  layer.clearLights();
  assert.equal(layer.children.length, 1, "only the ambient fill remains");
  layer.destroy();
});

test("light layer: options and limits are validated", () => {
  assert.throws(() => new LightLayer({ width: 0, height: 10 }), /positive/);
  assert.throws(() => new LightLayer({ width: 10, height: NaN }), /finite/);
  assert.throws(() => new LightLayer({ width: 10, height: 10, resolution: 2 }), /resolution/);
  assert.throws(() => new LightLayer({ width: 100_000, height: 100_000, resolution: 1 }), /too large/);
  const layer = new LightLayer({ width: 64, height: 64, resolution: 0.25 });
  assert.throws(() => layer.addLight({ x: Infinity }), /finite/);
  for (let index = 0; index < MAX_LIGHTS; index += 1) layer.addLight({});
  assert.throws(() => layer.addLight({}), /at most/);
  layer.destroy();
});

test("light layer: normal buffer mirrors sprites and lights use the normal-light mode", async () => {
  const { Sprite, Node, FILTER_TYPES, MAX_NORMAL_SPRITES } = await import("../../src/index.js");
  assert.ok(FILTER_TYPES.includes("normal-light"));
  assert.ok(MAX_NORMAL_SPRITES >= 1024);
  const plain = new LightLayer({ width: 400, height: 200, resolution: 0.5 });
  assert.equal(plain.normals, false);
  assert.throws(() => plain.addNormalMap(new Sprite(), Texture.white), /normals: true/);
  assert.equal(plain.addLight({}).sprite.filter, "none");
  plain.destroy();

  const scene = new Scene();
  const world = new Node({ x: 100, y: 20 });
  const brick = new Sprite({ x: 50, y: 30, width: 40, height: 20, scaleX: -2, anchorX: 0, anchorY: 0, flipY: true });
  world.add(brick);
  const layer = new LightLayer({ width: 400, height: 200, resolution: 0.5, normals: true });
  scene.add(world, layer);
  assert.equal(layer.normals, true);
  assert.ok(layer.normalBuffer instanceof RenderGroup);
  assert.equal(layer.normalBuffer.alpha, 0, "only read by the light shader, never composited");
  const normalTexture = new Texture({ id: "brick-n", sourceWidth: 40, sourceHeight: 20 });
  const mirror = layer.addNormalMap(brick, normalTexture);
  assert.equal(layer.addNormalMap(brick, normalTexture), mirror, "registering twice reuses the mirror");
  assert.throws(() => layer.addNormalMap({}, normalTexture), /Sprite/);
  assert.throws(() => layer.addNormalMap(new Sprite(), {}), /Texture/);
  const light = layer.addLight({ x: 200, y: 100, radius: 50, height: 0.8 });
  scene.update(1 / 60);
  assert.equal(light.sprite.filter, "normal-light");
  assert.equal(light.sprite.filterAmount, 0.8);
  assert.equal(light.sprite.maskTexture, layer.normalBuffer.target);
  assert.deepEqual([mirror.position.x, mirror.position.y], [75, 25], "world (150, 50) at half resolution");
  assert.deepEqual([mirror.scale.x, mirror.scale.y], [-1, 0.5]);
  assert.deepEqual([mirror.width, mirror.height, mirror.anchor.x, mirror.flipY], [40, 20, 0, true]);
  assert.equal(mirror.texture, normalTexture);
  world.visible = false;
  scene.update(1 / 60);
  assert.equal(mirror.visible, false, "follows the visibility of the sprite and its parents");
  light.height = 7;
  scene.update(1 / 60);
  assert.equal(light.sprite.filterAmount, 1);
  brick.destroy();
  scene.update(1 / 60);
  assert.equal(layer.normalSprites.size, 0, "destroyed sprites are dropped");
  assert.equal(mirror.destroyed, true);
  const other = new Sprite();
  layer.addNormalMap(other, normalTexture);
  assert.equal(layer.removeNormalMap(other), true);
  assert.equal(layer.removeNormalMap(other), false);
  layer.destroy();
});
