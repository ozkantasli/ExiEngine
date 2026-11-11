// Normal-mapped 2D lighting: a LightLayer with { normals: true }. Every wall
// brick and orb is a plain Sprite; addNormalMap() gives it a normal-map texture
// that shapes how the point lights hit it. Textures are generated at start-up,
// so the example has no image files.
import { Camera, ExiEngine, LightLayer, Scene, Sprite, Text, Texture } from "../../src/index.js";

const WIDTH = 960;
const HEIGHT = 540;
const BRICK_W = 96;
const BRICK_H = 48;

function canvas(width, height) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

// Writes a normal map from a height function h(x, y) in 0..1 (central differences).
function normalTexture(id, width, height, heightAt, strength) {
  const element = canvas(width, height);
  const context = element.getContext("2d");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * strength; // green points up
      const length = Math.hypot(dx, dy, 1);
      const index = (y * width + x) * 4;
      image.data[index] = (-dx / length * 0.5 + 0.5) * 255;
      image.data[index + 1] = (-dy / length * 0.5 + 0.5) * 255;
      image.data[index + 2] = (1 / length * 0.5 + 0.5) * 255;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return new Texture({ id, source: element });
}

// Deterministic value noise so the bricks look rough but identical every run.
function noise(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

const brickHeight = (x, y) => {
  const edge = Math.min(x, y, BRICK_W - 1 - x, BRICK_H - 1 - y);
  const bevel = Math.max(0, Math.min(1, edge / 6));
  return bevel * 0.85 + noise(Math.floor(x / 3), Math.floor(y / 3)) * 0.15 * bevel;
};
const brickNormals = normalTexture("brick-normal", BRICK_W, BRICK_H, brickHeight, 6);

function brickColor() {
  const element = canvas(BRICK_W, BRICK_H);
  const context = element.getContext("2d");
  context.fillStyle = "#3b2f2a";
  context.fillRect(0, 0, BRICK_W, BRICK_H);
  context.fillStyle = "#a0644a";
  context.fillRect(3, 3, BRICK_W - 6, BRICK_H - 6);
  for (let index = 0; index < 60; index += 1) {
    context.fillStyle = `rgba(0,0,0,${0.05 + noise(index, 7) * 0.1})`;
    context.fillRect(noise(index, 1) * BRICK_W, noise(index, 2) * BRICK_H, 4, 3);
  }
  return new Texture({ id: "brick", source: element });
}
const brickTexture = brickColor();

const ORB = 64;
const orbNormals = normalTexture("orb-normal", ORB, ORB, (x, y) => {
  const nx = (x + 0.5) / ORB * 2 - 1;
  const ny = (y + 0.5) / ORB * 2 - 1;
  return Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
}, ORB / 4);
function orbColor() {
  const element = canvas(ORB, ORB);
  const context = element.getContext("2d");
  context.fillStyle = "#e2e8f0";
  context.beginPath();
  context.arc(ORB / 2, ORB / 2, ORB / 2 - 1, 0, Math.PI * 2);
  context.fill();
  return new Texture({ id: "orb", source: element });
}
const orbTexture = orbColor();

const scene = new Scene();
const camera = new Camera({ x: WIDTH / 2, y: HEIGHT / 2, width: WIDTH, height: HEIGHT });
const lighting = new LightLayer({ width: WIDTH, height: HEIGHT, resolution: 0.5, ambient: 0x1a1f2e, normals: true });
const surfaces = [];
for (let row = 0; row * BRICK_H < HEIGHT; row += 1) {
  for (let column = -1; column * BRICK_W < WIDTH; column += 1) {
    const brick = new Sprite({ texture: brickTexture, width: BRICK_W, height: BRICK_H, anchorX: 0, anchorY: 0, x: column * BRICK_W + (row % 2) * BRICK_W / 2, y: row * BRICK_H });
    scene.add(brick);
    surfaces.push([brick, brickNormals]);
  }
}
const orbs = [[240, 300, 0x60a5fa], [480, 200, 0xf472b6], [720, 330, 0x4ade80]].map(([x, y, tint]) => {
  const orb = new Sprite({ texture: orbTexture, width: 96, height: 96, x, y, tint, zIndex: 1 });
  scene.add(orb);
  surfaces.push([orb, orbNormals]);
  return orb;
});
let normalsOn = true;
for (const [sprite, normals] of surfaces) lighting.addNormalMap(sprite, normals);

const torch = lighting.addLight({ x: WIDTH / 2, y: HEIGHT / 2, radius: 320, color: 0xffd9a0, intensity: 1, height: 0.25 });
const blue = lighting.addLight({ x: 120, y: 80, radius: 260, color: 0x7dd3fc, intensity: 0.7, height: 0.3 });
scene.add(lighting);

const hud = new Scene();
const label = new Text({ text: "", x: 16, y: 16, anchorX: 0, anchorY: 0, font: "16px system-ui, sans-serif", fill: "#e2e8f0" });
hud.add(label);

const pointerWorld = { x: 0, y: 0 };
let time = 0;
const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#000000",
  scene,
  camera,
  overlayScene: hud,
  inputActions: { normals: ["KeyN"], height: ["KeyH"] },
  inputAxes: {
    moveX: [{ type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" }],
    moveY: [{ type: "key-axis", positive: "ArrowDown", negative: "ArrowUp" }],
  },
  onUpdate(delta, currentEngine) {
    const input = currentEngine.input;
    if (!input) return;
    time += delta;
    const moveX = input.getAxis("moveX");
    const moveY = input.getAxis("moveY");
    if (moveX || moveY) {
      torch.x = Math.max(0, Math.min(WIDTH, torch.x + moveX * 300 * delta));
      torch.y = Math.max(0, Math.min(HEIGHT, torch.y + moveY * 300 * delta));
    } else if (input.pointer.moved || input.isPointerDown(0)) {
      input.getPointerWorld(camera, pointerWorld);
      torch.x = pointerWorld.x;
      torch.y = pointerWorld.y;
    }
    blue.x = WIDTH / 2 + Math.cos(time * 0.6) * 380;
    blue.y = HEIGHT / 2 + Math.sin(time * 0.9) * 200;
    for (const [index, orb] of orbs.entries()) orb.position.y += Math.sin(time * 1.5 + index) * 0.3;
    if (input.wasActionPressed("normals")) {
      normalsOn = !normalsOn;
      for (const [sprite, normals] of surfaces) {
        if (normalsOn) lighting.addNormalMap(sprite, normals);
        else lighting.removeNormalMap(sprite);
      }
    }
    if (input.wasActionPressed("height")) torch.height = torch.height > 0.5 ? 0.1 : torch.height + 0.2;
    label.setText(`normal maps ${normalsOn ? "on" : "off"} (N) · torch height ${torch.height.toFixed(2)} (H) · arrows or pointer move the torch`);
  },
});
engine.start();

window.game = { engine, scene, lighting, torch, surfaces };
