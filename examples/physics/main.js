// ExiEngine example: rigid-body sandbox.
// Shows RigidBodyWorld with boxes, circles and convex polygons: rotation,
// friction, restitution, a pyramid that stays standing, static ramps, and
// RigidBody.node keeping Graphics nodes in sync. Passed to ExiEngine as
// `physics`, so the engine steps it on its fixed timestep.
import { Camera, ExiEngine, Graphics, RigidBody, RigidBodyWorld, Scene, Text } from "../../src/index.js";

const WIDTH = 960;
const HEIGHT = 540;
const COLORS = [0x5eead4, 0x60a5fa, 0xf472b6, 0xfacc15, 0xa78bfa, 0xfb923c];

const scene = new Scene();
const world = new RigidBodyWorld({ gravityY: 980, iterations: 10 });
let spawned = 0;

// Draws a body's shape around its center of mass so node rotation matches.
function createBody(options, color) {
  const node = new Graphics();
  const body = new RigidBody({ ...options, node });
  if (body.shape.type === "circle") {
    node.circle(0, 0, body.shape.radius, { fill: color, segments: 28 }).line(0, 0, body.shape.radius, 0, 2, { fill: 0x0f172a });
  } else {
    node.polygon(body.shape.vertices.flatMap((vertex) => [vertex.x, vertex.y]), { fill: color });
  }
  scene.add(node);
  return world.add(body);
}

function spawnShape(x, y) {
  const kind = spawned % 4;
  const color = COLORS[spawned % COLORS.length];
  spawned += 1;
  const angle = (spawned * 0.7) % Math.PI;
  if (kind === 0) return createBody({ shape: { type: "box", width: 36, height: 36 }, x, y, angle, friction: 0.6 }, color);
  if (kind === 1) return createBody({ shape: { type: "circle", radius: 18 }, x, y, restitution: 0.5, friction: 0.4 }, color);
  if (kind === 2) return createBody({ shape: { type: "polygon", points: [0, 0, 44, 0, 22, -38] }, x, y, angle, friction: 0.7 }, color);
  return createBody({ shape: { type: "polygon", points: [0, 0, 30, -8, 40, 18, 18, 36, -6, 22] }, x, y, angle }, color);
}

function buildLevel() {
  for (const body of [...world.bodies]) { world.remove(body); body.node?.destroy(); }
  spawned = 0;
  createBody({ shape: { type: "box", width: WIDTH * 2, height: 40 }, x: WIDTH / 2, y: HEIGHT - 20, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 30, height: HEIGHT }, x: -15, y: HEIGHT / 2, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 30, height: HEIGHT }, x: WIDTH + 15, y: HEIGHT / 2, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 260, height: 16 }, x: 190, y: 250, angle: 0.35, static: true, friction: 0.3 }, 0x334155);
  createBody({ shape: { type: "box", width: 200, height: 16 }, x: 760, y: 300, angle: -0.3, static: true }, 0x334155);
  // A pyramid that stays standing until something hits it.
  for (let row = 0; row < 7; row += 1) {
    for (let index = 0; index < 7 - row; index += 1) {
      createBody({ shape: { type: "box", width: 32, height: 32 }, x: 480 - (7 - row) * 17 + index * 34 + 17, y: HEIGHT - 56 - row * 33, friction: 0.7 }, COLORS[(row + index) % COLORS.length]);
    }
  }
  for (let index = 0; index < 6; index += 1) spawnShape(120 + index * 22, 80 - index * 40);
}

const hud = new Scene();
const label = new Text({ x: 12, y: 10, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 15px system-ui, sans-serif", fill: "#e2e8f0" });
hud.add(label);

const camera = new Camera({ x: WIDTH / 2, y: HEIGHT / 2 });
const pointerWorld = { x: 0, y: 0 };
let slowMotion = false;

buildLevel();
const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#020617",
  scene,
  camera,
  overlayScene: hud,
  physics: world,
  inputActions: { slow: ["Space"], reset: ["KeyR"] },
  onUpdate(delta, currentEngine) {
    const input = currentEngine.input;
    if (!input) return;
    if (input.wasPointerPressed(0)) {
      input.getPointerWorld(camera, pointerWorld);
      if (world.bodies.length < 400) spawnShape(pointerWorld.x, pointerWorld.y);
    }
    if (input.wasActionPressed("slow")) { slowMotion = !slowMotion; currentEngine.setTimeScale(slowMotion ? 0.25 : 1); }
    if (input.wasActionPressed("reset")) buildLevel();
    label.setText(`${world.bodies.length} bodies · ${world.contacts.length} contacts${slowMotion ? " · slow motion" : ""}`);
  },
});
engine.start();

window.game = { engine, scene, world };
