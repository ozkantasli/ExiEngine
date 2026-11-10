// ExiEngine example: a small platformer built from a Tiled (.json/.tmj) map.
// Shows TileMap.fromTiled, tile properties -> static physics bodies, gravity,
// coyote time + jump buffering, camera follow with world bounds and a HUD overlay.
import { AssetLoader, Camera, ExiEngine, Graphics, PhysicsBody, PhysicsWorld, Scene, Text, Texture, TileMap } from "../../src/index.js";

const VIEW_WIDTH = 480;
const VIEW_HEIGHT = 270;
const RUN_SPEED = 150;
const JUMP_SPEED = 340;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;

// The tileset is drawn at runtime so the example ships without binary assets.
// Tile ids (0-based, same order as the Tiled tileset): 0 grass, 1 dirt, 2 brick, 3 flower.
function createTileset() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  context.fillStyle = "#4d7c0f"; context.fillRect(0, 0, 16, 16);
  context.fillStyle = "#84cc16"; context.fillRect(0, 0, 16, 5);
  context.fillStyle = "#78350f"; context.fillRect(16, 0, 16, 16);
  context.fillStyle = "#92400e"; for (let index = 0; index < 6; index += 1) context.fillRect(17 + ((index * 5) % 13), 2 + ((index * 7) % 12), 2, 2);
  context.fillStyle = "#9a3412"; context.fillRect(32, 0, 16, 16);
  context.fillStyle = "#c2410c"; context.fillRect(33, 1, 6, 6); context.fillRect(41, 1, 6, 6); context.fillRect(33, 9, 14, 6);
  context.fillStyle = "#22c55e"; context.fillRect(55, 8, 2, 8);
  context.fillStyle = "#f472b6"; context.fillRect(52, 4, 8, 5);
  context.fillStyle = "#fde047"; context.fillRect(55, 5, 2, 2);
  return new Texture({ source: canvas, filter: "nearest", id: "platformer-tiles" });
}

function findObject(level, name) {
  for (const layer of level.layers) {
    if (layer.type !== "objectgroup") continue;
    const object = layer.objects.find((entry) => entry.name === name);
    if (object) return object;
  }
  throw new Error(`Level object "${name}" is missing.`);
}

const loader = new AssetLoader();
const level = await loader.loadJSON("./level.json");
const tileset = createTileset();
const worldWidth = level.width * level.tilewidth;
const worldHeight = level.height * level.tileheight;

const scene = new Scene();
const physics = new PhysicsWorld({ scene, gravityY: 980 });
const ground = TileMap.fromTiled(level, { texture: tileset, layer: "Ground" });
const decor = TileMap.fromTiled(level, { texture: tileset, layer: "Decor", zIndex: -1 });
scene.add(decor, ground);
ground.createStaticBodies(physics, { solidTiles: TileMap.tiledTileIdsWithProperty(level, "solid") });

const spawn = findObject(level, "player");
const goalObject = findObject(level, "goal");
const goal = new Graphics({ x: goalObject.x, y: goalObject.y - goalObject.height }).rect(0, 0, 4, goalObject.height + 16, { fill: 0xe2e8f0 }).rect(4, 0, 12, 8, { fill: 0xfacc15 });
const player = new Graphics({ name: "player", x: spawn.x, y: spawn.y }).rect(0, 0, spawn.width, spawn.height, { fill: 0x5eead4 }).rect(spawn.width - 4, 3, 2, 3, { fill: 0x0f172a });
scene.add(goal, player);
const body = physics.add(new PhysicsBody(player, { maxSpeed: 600 }));

const camera = new Camera({ roundPixels: true });
camera.setBounds({ x: 0, y: 0, width: worldWidth, height: worldHeight });
camera.follow(player, { smoothing: 0.15, deadzoneWidth: 40, deadzoneHeight: 30 });

const hud = new Scene();
const label = new Text({ x: 8, y: 6, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 12px system-ui, sans-serif", fill: "#e2e8f0" });
hud.add(label);

let coyote = 0;
let jumpBuffer = 0;
let deaths = 0;
let elapsed = 0;
let finished = false;

function respawn() {
  player.position.set(spawn.x, spawn.y);
  body.setVelocity(0, 0);
  physics.syncBody(body);
  deaths += 1;
  camera.shake(4, 0.25);
}

const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#0b1020",
  scene,
  camera,
  overlayScene: hud,
  physics,
  inputActions: { jump: ["Space", "KeyW", "ArrowUp", { type: "gamepad", button: 0 }] },
  inputAxes: { moveX: [{ type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" }, { type: "key-axis", positive: "KeyD", negative: "KeyA" }, { type: "gamepad-axis", axis: 0, deadzone: 0.2 }] },
  onUpdate(delta, currentEngine) {
    const input = currentEngine.input;
    if (!finished) elapsed += delta;
    body.velocity.x = finished ? 0 : (input?.getAxis("moveX") ?? 0) * RUN_SPEED;

    coyote = body.grounded ? COYOTE_TIME : Math.max(0, coyote - delta);
    jumpBuffer = input?.wasActionPressed("jump") ? JUMP_BUFFER : Math.max(0, jumpBuffer - delta);
    if (!finished && jumpBuffer > 0 && coyote > 0) {
      body.velocity.y = -JUMP_SPEED;
      jumpBuffer = 0;
      coyote = 0;
    }
    // Releasing jump early gives a shorter hop.
    if (input && !input.isActionDown("jump") && body.velocity.y < -JUMP_SPEED * 0.45) body.velocity.y = -JUMP_SPEED * 0.45;

    if (player.position.y > worldHeight + 64) respawn();
    if (!finished && player.position.x + spawn.width >= goal.position.x && player.position.y + spawn.height >= goal.position.y) {
      finished = true;
      camera.shake(3, 0.3);
    }
    label.setText(finished
      ? `Level complete in ${elapsed.toFixed(1)} s · falls: ${deaths}`
      : `Time ${elapsed.toFixed(1)} s · falls: ${deaths}`);
  },
});
engine.start();

// Handy for poking at the game from the browser console.
window.game = { engine, scene, player, body, physics, level };
