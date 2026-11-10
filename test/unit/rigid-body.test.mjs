// ExiEngine unit test — RigidBodyWorld (circles, boxes, convex polygons, SAT, impulses)
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_POLYGON_VERTICES, Node, RigidBody, RigidBodyWorld, collideRigidBodies } from "../../src/index.js";

const ground = (world, options = {}) => world.add(new RigidBody({ shape: { type: "box", width: 1200, height: 40 }, x: 600, y: 500, static: true, ...options }));
const run = (world, steps) => { for (let index = 0; index < steps; index += 1) world.step(1 / 60); };

test("rigid: a box stack and a pyramid stay upright and settle", () => {
  const world = new RigidBodyWorld({ gravityY: 980 });
  ground(world);
  const stack = Array.from({ length: 12 }, (_, index) => world.add(new RigidBody({ shape: { type: "box", width: 40, height: 40 }, x: 300, y: 460 - index * 40.5, friction: 0.6 })));
  const pyramid = [];
  for (let row = 0; row < 6; row += 1) for (let index = 0; index < 6 - row; index += 1) pyramid.push(world.add(new RigidBody({ shape: { type: "box", width: 40, height: 40 }, x: 700 - (6 - row) * 21 + index * 42 + 21, y: 460 - row * 41 })));
  run(world, 900);
  for (const body of [...stack, ...pyramid]) {
    assert.ok(Math.abs(body.angle) < 0.01, `angle ${body.angle}`);
    assert.ok(Math.hypot(body.velocity.x, body.velocity.y) < 1, "settled");
  }
  assert.ok(Math.abs(stack.at(-1).position.y - (460 - 11 * 40)) < 1.5);
  assert.ok(Math.abs(stack.at(-1).position.x - 300) < 0.5);
});

test("rigid: circles rest, bounce with restitution and roll without slipping", () => {
  const world = new RigidBodyWorld();
  ground(world);
  const resting = world.add(new RigidBody({ shape: { type: "circle", radius: 20 }, x: 200, y: 100, restitution: 0 }));
  const bouncy = world.add(new RigidBody({ shape: { type: "circle", radius: 20 }, x: 400, y: 100, restitution: 0.8 }));
  let bounced = false; let apex = Infinity;
  for (let index = 0; index < 120; index += 1) {
    world.step(1 / 60);
    if (bouncy.velocity.y < 0) bounced = true;
    if (bounced) apex = Math.min(apex, bouncy.position.y);
  }
  run(world, 300);
  assert.ok(Math.abs(resting.position.y - 460) < 0.2);
  assert.ok(Math.abs(resting.velocity.y) < 0.5);
  assert.ok(apex > 160 && apex < 280, `bounce apex ${apex}`);

  const slopeWorld = new RigidBodyWorld();
  slopeWorld.add(new RigidBody({ shape: { type: "box", width: 600, height: 20 }, x: 300, y: 300, angle: 0.4, static: true }));
  const wheel = slopeWorld.add(new RigidBody({ shape: { type: "circle", radius: 15 }, x: 150, y: 200, friction: 0.8 }));
  run(slopeWorld, 60);
  const speed = Math.hypot(wheel.velocity.x, wheel.velocity.y);
  assert.ok(wheel.angularVelocity > 0 && speed > 50);
  assert.ok(Math.abs(speed / (wheel.angularVelocity * 15) - 1) < 0.05, "rolls without slipping");
});

test("rigid: tilted boxes and triangles tumble onto a flat face", () => {
  const world = new RigidBodyWorld();
  ground(world);
  const box = world.add(new RigidBody({ shape: { type: "box", width: 60, height: 30 }, x: 300, y: 200, angle: 0.6 }));
  const triangle = world.add(new RigidBody({ shape: { type: "polygon", points: [0, 0, 50, 0, 25, -40] }, x: 500, y: 100, angle: 1 }));
  run(world, 600);
  const quarter = Math.PI / 2;
  assert.ok(Math.abs(box.angle - Math.round(box.angle / quarter) * quarter) < 0.01);
  assert.ok(Math.abs(box.position.y - (box.angle % Math.PI === 0 || Math.abs(Math.cos(box.angle)) > 0.5 ? 465 : 450)) < 1);
  assert.ok(Math.abs(triangle.position.y - (480 - 40 / 3)) < 1);
  assert.ok(Math.abs(triangle.angularVelocity) < 0.01);
});

test("rigid: shapes are validated and mass properties are computed", () => {
  assert.throws(() => new RigidBody({}), /shape/);
  assert.throws(() => new RigidBody({ shape: { type: "capsule" } }), /circle", "box" or "polygon/);
  assert.throws(() => new RigidBody({ shape: { type: "circle", radius: 0 } }), /positive/);
  assert.throws(() => new RigidBody({ shape: { type: "box", width: 10, height: NaN } }), /finite|positive/);
  assert.throws(() => new RigidBody({ shape: { type: "polygon", points: [0, 0, 10, 0] } }), /3-/);
  assert.throws(() => new RigidBody({ shape: { type: "polygon", points: [0, 0, 10, 0, 20, 0] } }), /area/);
  assert.throws(() => new RigidBody({ shape: { type: "polygon", points: [0, 0, 10, 0, 5, 2, 10, 10, 0, 10] } }), /convex/);
  assert.throws(() => new RigidBody({ shape: { type: "polygon", points: new Array((MAX_POLYGON_VERTICES + 1) * 2).fill(0) } }), /3-/);
  const box = new RigidBody({ shape: { type: "box", width: 40, height: 20 }, density: 2 });
  assert.equal(box.mass, 1600);
  assert.ok(Math.abs(box.inertia - (1600 * (40 * 40 + 20 * 20)) / 12) < 1e-6);
  // Clockwise and counter-clockwise input give the same convex polygon.
  const cw = new RigidBody({ shape: { type: "polygon", points: [0, 0, 0, 10, 10, 10, 10, 0] } });
  const ccw = new RigidBody({ shape: { type: "polygon", points: [0, 0, 10, 0, 10, 10, 0, 10] } });
  assert.equal(cw.mass, ccw.mass);
  assert.ok(cw.containsPoint(0, 0) && !cw.containsPoint(6, 0));
  const fixed = new RigidBody({ shape: { type: "circle", radius: 5 }, static: true });
  assert.equal(fixed.invMass, 0);
  assert.equal(new RigidBody({ shape: { type: "circle", radius: 5 }, fixedRotation: true }).invInertia, 0);
  assert.throws(() => new RigidBody({ shape: { type: "circle", radius: 5 }, node: {} }), /Node/);
});

test("rigid: SAT manifolds report normals from A to B and up to two points", () => {
  const floor = new RigidBody({ shape: { type: "box", width: 100, height: 20 }, x: 0, y: 0, static: true });
  const box = new RigidBody({ shape: { type: "box", width: 20, height: 20 }, x: 0, y: -19 });
  const manifold = collideRigidBodies(floor, box);
  assert.equal(manifold.count, 2);
  assert.deepEqual([manifold.normalX, Math.round(manifold.normalY)], [0, -1]);
  assert.ok(Math.abs(manifold.depth - 1) < 1e-9);
  const ball = new RigidBody({ shape: { type: "circle", radius: 5 }, x: 0, y: -14 });
  const circleHit = collideRigidBodies(floor, ball);
  assert.equal(circleHit.count, 1);
  assert.ok(circleHit.normalY < 0);
  assert.ok(collideRigidBodies(ball, floor).normalY > 0, "flipping the pair flips the normal");
  assert.equal(collideRigidBodies(floor, new RigidBody({ shape: { type: "circle", radius: 5 }, x: 0, y: -40 })), null);
  assert.throws(() => collideRigidBodies(floor, {}), /RigidBody/);
});

test("rigid: simulation is deterministic for identical inputs", () => {
  const simulate = () => {
    const world = new RigidBodyWorld();
    ground(world);
    for (let index = 0; index < 20; index += 1) world.add(new RigidBody({ shape: index % 2 ? { type: "circle", radius: 10 + (index % 3) } : { type: "polygon", points: [0, 0, 24, 0, 30, 18, 6, 24] }, x: 300 + (index * 37) % 200, y: 100 - index * 30, angle: index * 0.3 }));
    run(world, 240);
    return world.bodies.map((body) => [body.position.x, body.position.y, body.angle]);
  };
  assert.deepEqual(simulate(), simulate());
});

test("rigid: nodes follow bodies, sensors report without blocking, limits hold", () => {
  const node = new Node();
  const contacts = [];
  const world = new RigidBodyWorld({ onContact: (a, b) => contacts.push([a.tag, b.tag]) });
  ground(world, { tag: "ground" });
  const body = world.add(new RigidBody({ shape: { type: "box", width: 20, height: 20 }, x: 100, y: 300, angle: 0.2, node, tag: "crate" }));
  const sensor = world.add(new RigidBody({ shape: { type: "box", width: 400, height: 40 }, x: 300, y: 380, static: true, isSensor: true, tag: "zone" }));
  run(world, 120);
  assert.equal(node.position.x, body.position.x);
  assert.equal(node.position.y, body.position.y);
  assert.equal(node.rotation, body.angle);
  assert.ok(body.position.y > 400, "the sensor did not block the crate");
  assert.ok(contacts.some((pair) => pair.includes("zone")), "sensor contact reported");
  assert.ok(contacts.some((pair) => pair.includes("ground")));
  const groundBegins = contacts.filter((pair) => pair.includes("ground")).length;
  assert.ok(groundBegins >= 1 && groundBegins <= 4, `onContact fires on begin only, not every step (${groundBegins})`);
  assert.ok(world.queryPoint(body.position.x, body.position.y).includes(body));
  assert.ok(world.remove(sensor));
  assert.equal(world.remove(sensor), false);
  const small = new RigidBodyWorld({ maxBodies: 1 });
  small.add(new RigidBody({ shape: { type: "circle", radius: 1 } }));
  assert.throws(() => small.add(new RigidBody({ shape: { type: "circle", radius: 1 } })), /at most 1/);
  assert.throws(() => world.add(small.bodies[0]), /another world/);
  assert.throws(() => new RigidBodyWorld({ iterations: 0 }), /iterations/);
  assert.throws(() => new RigidBodyWorld({ onContact: 1 }), /function/);
  body.applyImpulse(0, -1e12);
  run(world, 1);
  assert.ok(Number.isFinite(body.position.y) && Math.abs(body.velocity.y) <= 1e5, "speeds are clamped");
});

test("rigid: forces, impulses at an offset and layer masks", () => {
  const world = new RigidBodyWorld({ gravityY: 0 });
  const spinner = world.add(new RigidBody({ shape: { type: "box", width: 20, height: 20 } }));
  spinner.applyImpulse(0, 100, 10, 0);
  assert.ok(spinner.angularVelocity > 0 && spinner.velocity.y > 0);
  const pushed = world.add(new RigidBody({ shape: { type: "circle", radius: 5 }, x: 200 }));
  pushed.applyForce(600, 0);
  world.step(1 / 60);
  assert.ok(pushed.velocity.x > 0);
  const gravityWorld = new RigidBodyWorld();
  ground(gravityWorld, { layer: 2 });
  const ghost = gravityWorld.add(new RigidBody({ shape: { type: "circle", radius: 10 }, x: 100, y: 400, mask: 1 }));
  run(gravityWorld, 60);
  assert.ok(ghost.position.y > 500, "masked layers do not collide");
});
