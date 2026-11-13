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

function insideConvex(points, x, y) {
  let sign = 0;
  for (let index = 0; index < points.length; index += 2) {
    const x1 = points[index]; const y1 = points[index + 1];
    const x2 = points[(index + 2) % points.length]; const y2 = points[(index + 3) % points.length];
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

// Is a world point dark in this light's shadow pass?
function shadowed(layer, light, worldX, worldY) {
  const { shadow } = light;
  const scaleX = layer.width / layer.worldBounds.width; const scaleY = layer.height / layer.worldBounds.height;
  const half = shadow.size / 2;
  const lightX = (light.x - layer.worldBounds.x) * scaleX; const lightY = (light.y - layer.worldBounds.y) * scaleY;
  const x = ((worldX - layer.worldBounds.x) * scaleX - lightX) / shadow.scale + half;
  const y = ((worldY - layer.worldBounds.y) * scaleY - lightY) / shadow.scale + half;
  return shadow.shapes.commands.some((command) => insideConvex(command.points, x, y));
}

test("light layer: shadow-casting lights darken only the area behind occluders", async () => {
  const { MAX_SHADOW_LIGHTS, Graphics, Sprite } = await import("../../src/index.js");
  const scene = new Scene();
  const layer = new LightLayer({ width: 400, height: 200, resolution: 0.5 });
  scene.add(layer);
  const wall = layer.addOccluder({ x: 140, y: 80, width: 20, height: 40 });
  layer.addOccluder({ points: [300, 20, 330, 20, 315, 50] });
  const lamp = layer.addLight({ x: 100, y: 100, radius: 120, shadows: true });
  scene.update(1 / 60);
  assert.ok(lamp.shadow, "a shadow pass exists");
  assert.equal(lamp.sprite.parent, lamp.shadow.group, "the light draws inside its shadow pass");
  assert.equal(lamp.shadow.group.blendMode, "additive");
  assert.ok(lamp.shadow.size >= 120 && lamp.shadow.size <= 1024);
  assert.equal(shadowed(layer, lamp, 200, 100), true, "behind the wall is dark");
  assert.equal(shadowed(layer, lamp, 210, 85), true, "the shadow widens with distance");
  assert.equal(shadowed(layer, lamp, 120, 100), false, "in front of the wall is lit");
  assert.equal(shadowed(layer, lamp, 150, 100), false, "the wall itself stays lit");
  assert.equal(shadowed(layer, lamp, 100, 160), false, "beside the light is lit");
  assert.equal(shadowed(layer, lamp, 200, 30), false, "outside the wall's shadow cone is lit");
  const commandsWithFarTriangle = lamp.shadow.shapes.commands.length;
  assert.ok(commandsWithFarTriangle >= 1 && commandsWithFarTriangle <= 3, `only back-facing edges inside the light cast (${commandsWithFarTriangle})`);

  // Occluders follow edits; moving the light moves the shadow.
  lamp.x = 250; scene.update(1 / 60);
  assert.equal(shadowed(layer, lamp, 200, 100), false);
  assert.equal(shadowed(layer, lamp, 100, 100), true, "the shadow now falls to the left");
  wall.enabled = false; scene.update(1 / 60);
  assert.equal(shadowed(layer, lamp, 100, 100), false, "a disabled occluder casts nothing");
  wall.enabled = true;

  // Node occluders follow position and rotation.
  const crate = new Graphics({ x: 180, y: 100 }).rect(-10, -10, 20, 20, { fill: 0xffffff });
  scene.add(crate);
  const following = layer.addOccluder({ node: crate });
  lamp.x = 100; layer.removeOccluder(wall); scene.update(1 / 60);
  assert.equal(shadowed(layer, lamp, 240, 100), true, "a node occluder casts a shadow");
  crate.position.y = 40; scene.update(1 / 60);
  assert.ok(following.points[1] < 40, "node occluder points follow the node");
  assert.equal(shadowed(layer, lamp, 240, 100), false);
  crate.visible = false; scene.update(1 / 60);
  assert.equal(lamp.shadow.shapes.commands.length, 0, "hidden nodes cast nothing");

  // Turning shadows off moves the light back into the light map and frees the pass.
  const group = lamp.shadow.group;
  lamp.shadows = false; scene.update(1 / 60);
  assert.equal(lamp.shadow, null);
  assert.equal(group.destroyed, true);
  assert.equal(lamp.sprite.parent, layer);
  assert.deepEqual([lamp.sprite.position.x, lamp.sprite.width], [50, 120]);
  lamp.shadows = true; scene.update(1 / 60);
  assert.ok(lamp.shadow);
  layer.removeLight(lamp);
  assert.equal(layer.shadowLightCount, 0);

  // Limits and validation.
  for (let index = 0; index < MAX_SHADOW_LIGHTS; index += 1) layer.addLight({ x: index, y: 10, radius: 4, shadows: true });
  assert.throws(() => layer.addLight({ shadows: true }), /shadow-casting/);
  const extra = layer.addLight({ x: 10, y: 10, radius: 4 });
  extra.shadows = true; scene.update(1 / 60);
  assert.equal(extra.shadow, null, "over the cap a light stays unshadowed instead of failing");
  assert.throws(() => layer.addOccluder({ points: [0, 0, 1, 1] }), /three/);
  assert.throws(() => layer.addOccluder({ points: new Array(200).fill(1) }), /at most/);
  assert.throws(() => layer.addOccluder({ x: 0, y: 0, width: 0, height: 5 }), /positive/);
  assert.throws(() => layer.addOccluder({ node: {} }), /Node/);
  assert.throws(() => layer.addOccluder({ points: [0, 0, NaN, 1, 2, 2] }), /finite/);
  layer.clearOccluders();
  assert.equal(layer.occluders.length, 0);
  layer.destroy();
  void Sprite;
});

test("light layer: shadow passes keep normal mapping by remapping the normal buffer", async () => {
  const { Sprite } = await import("../../src/index.js");
  const scene = new Scene();
  const layer = new LightLayer({ width: 400, height: 200, resolution: 0.5, normals: true });
  scene.add(layer);
  const wall = new Sprite({ texture: Texture.white, x: 150, y: 100, width: 20, height: 40 });
  scene.add(wall);
  layer.addNormalMap(wall, Texture.white);
  layer.addOccluder({ node: wall });
  const lamp = layer.addLight({ x: 100, y: 100, radius: 80, shadows: true });
  scene.update(1 / 60);
  assert.equal(lamp.sprite.filter, "normal-light");
  assert.equal(lamp.sprite.maskTexture, layer.normalBuffer.target);
  const half = lamp.shadow.size / 2;
  // The light map origin sits at half - lightX in the pass, at the light map's size.
  assert.deepEqual([lamp.sprite.maskRect.x, lamp.sprite.maskRect.y, lamp.sprite.maskRect.width, lamp.sprite.maskRect.height], [half - 50, half - 50, 200, 100]);
  lamp.shadows = false; scene.update(1 / 60);
  assert.deepEqual([lamp.sprite.maskRect.x, lamp.sprite.maskRect.width], [0, 200], "back in the light map the mask covers it again");
  layer.destroy();
});
