// ExiEngine example: rigid-body sandbox.
// Shows RigidBodyWorld with boxes, circles and convex polygons: rotation,
// friction, restitution, a pyramid that stays standing, static ramps, a plank
// bridge on revolute joints, a pendulum on a distance joint, a motorized
// windmill (two welded blades on a revolute motor), a piston on a prismatic
// joint with limits and a reversing motor, a flipper on a revolute joint with
// angle limits, a car on wheel joints (spring suspension, drive motor), and
// RigidBody.node keeping Graphics nodes in sync. Passed to ExiEngine as
// `physics`, so the engine steps it on its fixed timestep.
import { Camera, DistanceJoint, ExiEngine, Graphics, PrismaticJoint, RevoluteJoint, RigidBody, RigidBodyWorld, Scene, Text, WeldJoint, WheelJoint } from "../../src/index.js";

const WIDTH = 960;
const HEIGHT = 540;
const COLORS = [0x5eead4, 0x60a5fa, 0xf472b6, 0xfacc15, 0xa78bfa, 0xfb923c];

const scene = new Scene();
const world = new RigidBodyWorld({ gravityY: 980, iterations: 10 });
let spawned = 0;
let piston = null;
let pistonTimer = 0;
let flipper = null;
let carWheels = [];
let car = null;
const DRIVE_SPEED = 12;
const DRIVE_TORQUE = 2e7;
// The arm alone needs ~8e7 to lift against gravity, a car on it ~2e8 more.
const FLIP_TORQUE = 6e8;

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
  for (const node of [...scene.children]) if (node.name === "rope") node.destroy();
  spawned = 0;
  createBody({ shape: { type: "box", width: WIDTH * 2, height: 40 }, x: WIDTH / 2, y: HEIGHT - 20, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 30, height: HEIGHT }, x: -15, y: HEIGHT / 2, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 30, height: HEIGHT }, x: WIDTH + 15, y: HEIGHT / 2, static: true }, 0x1e293b);
  createBody({ shape: { type: "box", width: 260, height: 16 }, x: 190, y: 250, angle: 0.35, static: true, friction: 0.3 }, 0x334155);
  createBody({ shape: { type: "box", width: 200, height: 16 }, x: 760, y: 300, angle: -0.3, static: true }, 0x334155);
  // A plank bridge hanging between two posts (revolute joints at plank ends).
  const postLeft = createBody({ shape: { type: "box", width: 12, height: 40 }, x: 600, y: 150, static: true }, 0x475569);
  let previous = postLeft;
  for (let index = 0; index < 8; index += 1) {
    const plank = createBody({ shape: { type: "box", width: 30, height: 8 }, x: 621 + index * 30, y: 132, friction: 0.8 }, 0xa16207);
    world.addJoint(new RevoluteJoint({ a: previous, b: plank, x: 606 + index * 30, y: 132 }));
    previous = plank;
  }
  const postRight = createBody({ shape: { type: "box", width: 12, height: 40 }, x: 852, y: 150, static: true }, 0x475569);
  world.addJoint(new RevoluteJoint({ a: previous, b: postRight, x: 846, y: 132 }));
  // A pendulum: a heavy ball on a distance joint, released from the side.
  const pivot = createBody({ shape: { type: "circle", radius: 5 }, x: 330, y: 30, static: true }, 0x94a3b8);
  const ball = createBody({ shape: { type: "circle", radius: 22 }, x: 230, y: 70, density: 3, friction: 0.3 }, 0xe2e8f0);
  world.addJoint(new DistanceJoint({ a: pivot, b: ball }));
  const rope = new Graphics({ name: "rope", zIndex: -1, onUpdate: (delta, node) => { node.clear().line(pivot.position.x, pivot.position.y, ball.position.x, ball.position.y, 2, { fill: 0x94a3b8 }); } });
  scene.add(rope);
  // A windmill: two blades welded into a cross, spun by a revolute motor.
  // The hub is a sensor: only directly jointed bodies skip collision, and blade B overlaps it.
  const hub = createBody({ shape: { type: "circle", radius: 6 }, x: 740, y: 430, static: true, isSensor: true }, 0x94a3b8);
  const bladeA = createBody({ shape: { type: "box", width: 130, height: 10 }, x: 740, y: 430, density: 0.5 }, 0x38bdf8);
  const bladeB = createBody({ shape: { type: "box", width: 10, height: 130 }, x: 740, y: 430, density: 0.5 }, 0x38bdf8);
  world.addJoint(new WeldJoint({ a: bladeA, b: bladeB, x: 740, y: 430 }));
  world.addJoint(new RevoluteJoint({ a: hub, b: bladeA, x: 740, y: 430, motorSpeed: 1.6, maxMotorTorque: 4e7 }));
  // A piston: a platform that slides up and down a vertical axis between limits.
  const base = createBody({ shape: { type: "box", width: 70, height: 12 }, x: 880, y: HEIGHT - 46, static: true }, 0x475569);
  const platform = createBody({ shape: { type: "box", width: 70, height: 12 }, x: 880, y: HEIGHT - 70, friction: 0.9 }, 0xf59e0b);
  piston = world.addJoint(new PrismaticJoint({ a: base, b: platform, x: 880, y: HEIGHT - 70, axisX: 0, axisY: 1, lowerLimit: -150, upperLimit: 0, motorSpeed: -120, maxMotorForce: 5e7 }));
  pistonTimer = 0;
  // A flipper: an arm hinged at its right end, kept between two angle limits.
  // At rest it is a ramp the car can climb; F swings it up against the upper limit.
  const flipperPivot = createBody({ shape: { type: "circle", radius: 6 }, x: 345, y: 484, static: true, isSensor: true }, 0x94a3b8);
  const flipperArm = createBody({ shape: { type: "box", width: 90, height: 10 }, x: 300, y: 484, density: 2, friction: 0.9 }, 0xef4444);
  flipper = world.addJoint(new RevoluteJoint({ a: flipperPivot, b: flipperArm, x: 345, y: 484, lowerAngle: -0.12, upperAngle: 0.7, motorSpeed: -4, maxMotorTorque: FLIP_TORQUE / 20 }));
  // A car: a chassis on two wheel joints (spring suspension), driven by the arrow keys.
  car = createBody({ shape: { type: "polygon", points: [0, 0, 110, 0, 110, -14, 80, -30, 30, -30, 0, -14] }, x: 90, y: 440, density: 1, friction: 0.5 }, 0x22c55e);
  carWheels = [];
  for (const offset of [-36, 36]) {
    const wheel = createBody({ shape: { type: "circle", radius: 15 }, x: car.position.x + offset, y: 466, friction: 1.2 }, 0xcbd5e1);
    world.addJoint(new WheelJoint({ a: car, b: wheel, axisX: 0, axisY: 1, frequency: 4, dampingRatio: 0.7, maxMotorTorque: DRIVE_TORQUE / 10 }));
    carWheels.push(wheel);
  }
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
  inputActions: { slow: ["Space"], reset: ["KeyR"], flip: ["KeyF"], left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"] },
  onUpdate(delta, currentEngine) {
    const input = currentEngine.input;
    if (!input) return;
    if (input.wasPointerPressed(0)) {
      input.getPointerWorld(camera, pointerWorld);
      if (world.bodies.length < 400) spawnShape(pointerWorld.x, pointerWorld.y);
    }
    pistonTimer += delta;
    if (piston && pistonTimer > 1.6) { pistonTimer = 0; piston.setMotor(-piston.motorSpeed); }
    if (flipper) flipper.setMotor(input.isActionDown("flip") ? 10 : -4, input.isActionDown("flip") ? FLIP_TORQUE : FLIP_TORQUE / 20);
    const drive = (input.isActionDown("right") ? 1 : 0) - (input.isActionDown("left") ? 1 : 0);
    // With no key held the motors act as a brake (target speed 0, low torque).
    for (const joint of world.joints) if (joint instanceof WheelJoint) joint.setMotor(drive * DRIVE_SPEED, drive ? DRIVE_TORQUE : DRIVE_TORQUE / 10);
    if (input.wasActionPressed("slow")) { slowMotion = !slowMotion; currentEngine.setTimeScale(slowMotion ? 0.25 : 1); }
    if (input.wasActionPressed("reset")) buildLevel();
    label.setText(`${world.bodies.length} bodies · ${world.joints.length} joints · ${world.contacts.length} contacts${slowMotion ? " · slow motion" : ""}`);
  },
});
engine.start();

window.game = { engine, scene, world, get piston() { return piston; }, get flipper() { return flipper; }, get car() { return car; }, get carWheels() { return carWheels; } };
