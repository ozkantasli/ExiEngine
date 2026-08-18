// ExiEngine unit test — CollisionWorld / PhysicsWorld
import { test } from "node:test";
import assert from "node:assert/strict";
import { Scene, Sprite, Node, Collider, CollisionWorld, PhysicsBody, PhysicsWorld, getAABB } from "../../src/index.js";

test("collision: firstHit / query / raycast", () => {
  const scene = new Scene();
  const sprite = new Sprite({ width: 16, height: 16, x: 0, y: 0 });
  const spriteTwo = new Sprite({ width: 16, height: 16, x: 10, y: 6 });
  scene.add(sprite, spriteTwo);
  scene.updateWorldMatrix();
  const world = new CollisionWorld();
  world.add(new Collider(spriteTwo, { tag: "test" }));
  assert.equal(world.firstHit(getAABB(sprite))?.tag, "test");
  const results = [];
  assert.equal(world.query(getAABB(sprite), undefined, results), results);
  assert.equal(results.length, 1);
  // Raycast ayrı senaryo: hedef sprite'ın bounds'u ile kesişen ışın
  const rayTarget = new Sprite({ width: 16, height: 16, x: 30, y: 0 });
  scene.add(rayTarget);
  scene.updateWorldMatrix();
  const rayWorld = new CollisionWorld();
  rayWorld.add(new Collider(rayTarget, { tag: "ray" }));
  const hit = rayWorld.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 100);
  assert.equal(hit.collider.tag, "ray");
  assert.equal(rayWorld.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, 10), null);
  assert.throws(() => world.query(getAABB(sprite), "invalid"), /filter/);
  assert.throws(() => world.raycast({ x: 0, y: 0 }, { x: NaN, y: 1 }), /finite/);
  assert.throws(() => world.raycast({ x: 0, y: 0 }, { x: 1, y: 0 }, -1), /negatif/);
});

test("collision: autoSync spatial index", () => {
  const scene = new Scene();
  const node = new Sprite({ x: 10, y: 6, width: 16, height: 16 });
  const probe = new Sprite({ width: 16, height: 16, x: 0, y: 0 });
  scene.add(node, probe);
  scene.updateWorldMatrix();
  const world = new CollisionWorld({ spatial: true, autoSync: true });
  world.add(new Collider(node, { tag: "auto-sync" }));
  assert.equal(world.firstHit(getAABB(probe))?.tag, "auto-sync");
  node.position.x = 1_000;
  scene.updateWorldMatrix();
  assert.equal(world.hasSpatialChanges(), true);
  assert.equal(world.firstHit(getAABB(probe)), null);
  assert.equal(world.hasSpatialChanges(), false);
  assert.throws(() => new CollisionWorld({ spatial: true, cellSize: 8 }), /cellSize/);
});

test("collision: spatial world syncCollider ve disable", () => {
  const scene = new Scene();
  const probe = new Sprite({ width: 16, height: 16 });
  const target = new Sprite({ width: 16, height: 16, x: 10, y: 6 });
  scene.add(probe, target);
  scene.updateWorldMatrix();
  const world = new CollisionWorld({ spatial: true, cellSize: 16 });
  const collider = new Collider(target, { tag: "spatial" });
  const cachedBounds = collider.bounds;
  assert.equal(collider.bounds, cachedBounds);
  collider.enabled = false;
  world.add(collider);
  world.rebuild();
  assert.equal(world.firstHit(getAABB(probe)), null);
  collider.enabled = true;
  assert.equal(world.firstHit(getAABB(probe))?.tag, "spatial");
  target.position.x = 1_000;
  scene.updateWorldMatrix();
  assert.equal(collider.bounds, cachedBounds);
  world.syncCollider(collider);
  assert.equal(world.firstHit(getAABB(probe)), null);
  target.position.x = 10;
  scene.updateWorldMatrix();
  world.syncCollider(collider);
  assert.equal(world.query(getAABB(probe)).length, 1);
  const hit = world.raycast({ x: -20, y: 0 }, { x: 1, y: 0 }, 100, (c) => c.tag === "spatial");
  assert.equal(hit.collider, collider);
});

test("collision: yok edilmiş node collider'ı otomatik kaldırılır", () => {
  const scene = new Scene();
  const probe = new Sprite({ width: 16, height: 16 });
  const node = new Sprite({ width: 10, height: 10 });
  scene.add(probe, node);
  scene.updateWorldMatrix();
  const world = new CollisionWorld({ spatial: true });
  const collider = new Collider(node, { tag: "destroyed" });
  world.add(collider);
  node.destroy();
  assert.equal(world.firstHit(getAABB(probe)), null);
  assert.equal(world.query(getAABB(probe)).length, 0);
  assert.throws(() => new Collider(node), /canlı/);
});

test("collision: custom hitbox bounds", () => {
  const scene = new Scene();
  const node = new Sprite({ width: 100, height: 100 });
  scene.add(node);
  scene.updateWorldMatrix();
  const world = new CollisionWorld({ spatial: true, cellSize: 16 });
  const collider = new Collider(node, { bounds: { x: 40, y: 40, width: 10, height: 10 }, tag: "custom" });
  world.add(collider);
  assert.equal(collider.bounds.left, 40);
  assert.equal(world.firstHit({ left: 0, top: 0, right: 20, bottom: 20 }), null);
  assert.equal(world.firstHit({ left: 40, top: 40, right: 50, bottom: 50 }), collider);
  collider.setBounds({ x: -10, y: -10, width: 20, height: 20 });
  assert.equal(world.spatialDirty, true);
  assert.equal(world.firstHit({ left: -10, top: -10, right: 10, bottom: 10 }), collider);
  collider.setBounds(null);
  assert.equal(collider.bounds.width, 100);
  assert.throws(() => collider.setBounds({ x: 0, y: 0, width: Infinity, height: 10 }), /finite/);
  assert.throws(() => new Collider(node, { bounds: { x: 0, y: 0, width: 0, height: 10 } }), /dikdörtgen/);
});

test("physics: gravity, grounded, static", () => {
  const scene = new Scene();
  const floor = new Sprite({ width: 100, height: 10, x: 0, y: 50 });
  const player = new Sprite({ width: 10, height: 10, x: 0, y: 0 });
  scene.add(floor, player);
  const world = new PhysicsWorld({ scene, gravityY: 300 });
  const floorBody = new PhysicsBody(floor, { static: true, tag: "floor" });
  const playerBody = new PhysicsBody(player, { velocityX: Infinity, velocityY: 0, tag: "player" });
  world.add(floorBody);
  world.add(playerBody);
  for (let frame = 0; frame < 120; frame += 1) world.step(1 / 60);
  assert.equal(playerBody.grounded, true);
  assert.equal(playerBody.velocity.y, 0);
  assert.equal(player.position.y, 40);
  assert.equal(playerBody.setVelocity(0, -60), playerBody);
  assert.equal(playerBody.setStatic(true), playerBody);
  assert.equal(playerBody.isStatic, true);
  assert.throws(() => new PhysicsBody(null), /Node/);
  world.clear();
  assert.equal(world.bodies.size, 0);
});

test("physics: overlaps, layer/mask, trigger", () => {
  const scene = new Scene();
  const floor = new Sprite({ width: 100, height: 10, y: 50 });
  const trigger = new Sprite({ width: 30, height: 10, x: 0, y: 20 });
  const player = new Sprite({ width: 10, height: 10, x: 0, y: 0 });
  scene.add(floor, trigger, player);
  const world = new PhysicsWorld({ scene, gravityY: 300 });
  const floorBody = new PhysicsBody(floor, { static: true, tag: "floor" });
  const triggerBody = new PhysicsBody(trigger, { static: true, isTrigger: true, tag: "trigger" });
  const playerBody = new PhysicsBody(player, { velocityY: 0, tag: "player" });
  world.add(floorBody);
  world.add(triggerBody);
  world.add(playerBody);
  for (let frame = 0; frame < 120; frame += 1) world.step(1 / 60);
  const probe = new Sprite({ width: 30, height: 10, x: 0, y: 20 });
  scene.add(probe);
  const probeBody = new PhysicsBody(probe);
  world.add(probeBody);
  const results = [];
  assert.equal(world.overlaps(probeBody, (body) => body === triggerBody, results), results);
  assert.equal(results.length, 1);
  triggerBody.collider.layer = 2;
  triggerBody.collider.mask = 2;
  assert.equal(world.overlaps(probeBody, (body) => body === triggerBody, results).length, 0);
  triggerBody.collider.layer = 1;
  triggerBody.collider.mask = 0xFFFFFFFF;
  assert.equal(world.overlaps(probeBody, (body) => body === triggerBody, results).length, 1);
  assert.throws(() => { triggerBody.collider.layer = Infinity; }, /32-bit/);
  assert.throws(() => world.overlaps(probeBody, "invalid"), /filter/);
  world.remove(probeBody);
  probe.destroy();
});

test("physics: yok edilmiş node otomatik kaldırılır", () => {
  const node = new Sprite({ width: 10, height: 10 });
  const body = new PhysicsBody(node);
  const world = new PhysicsWorld({ gravityY: 0 });
  world.add(body);
  node.destroy();
  world.step(1 / 60);
  assert.equal(world.bodies.has(body), false);
  assert.equal(body._worlds.has(world), false);
  assert.throws(() => new PhysicsBody(node), /canlı/);
  world.clear();
});

test("physics: custom bounds ve one-way platform", () => {
  const scene = new Scene();
  const floor = new Sprite({ width: 100, height: 10, y: 50 });
  const player = new Sprite({ width: 100, height: 100, y: 0 });
  scene.add(floor, player);
  const world = new PhysicsWorld({ scene, gravityY: 300 });
  const floorBody = new PhysicsBody(floor, { static: true, bounds: { x: 0, y: 0, width: 100, height: 10 } });
  const playerBody = new PhysicsBody(player, { bounds: { x: 45, y: 0, width: 10, height: 10 }, velocityY: 1_000 });
  world.add(floorBody);
  world.add(playerBody);
  world.step(0.25);
  assert.equal(player.position.y, 40);
  assert.equal(playerBody.grounded, true);

  const oneWayScene = new Scene();
  const platform = new Sprite({ width: 100, height: 10, y: 50 });
  const oneWayPlayer = new Sprite({ width: 10, height: 10, y: 80 });
  oneWayScene.add(platform, oneWayPlayer);
  const oneWayWorld = new PhysicsWorld({ scene: oneWayScene, gravityY: 0 });
  const platformBody = new PhysicsBody(platform, { static: true, oneWay: "up" });
  const oneWayPlayerBody = new PhysicsBody(oneWayPlayer, { velocityY: -1_000 });
  oneWayWorld.add(platformBody);
  oneWayWorld.add(oneWayPlayerBody);
  oneWayWorld.step(0.25);
  assert.equal(oneWayPlayer.position.y < 0, true);
  oneWayPlayer.position.y = 0;
  oneWayPlayerBody.setVelocity(0, 1_000);
  oneWayWorld.step(0.25);
  assert.equal(oneWayPlayer.position.y, 40);
  assert.equal(oneWayPlayerBody.grounded, true);
  assert.throws(() => new Collider(platform, { oneWay: "diagonal" }), /oneWay/);
});

test("physics: kinematic platform taşıyıcı", () => {
  const scene = new Scene();
  const platform = new Sprite({ width: 100, height: 10, x: 0, y: 50 });
  const rider = new Sprite({ width: 10, height: 10, x: 10, y: 40 });
  scene.add(platform, rider);
  const world = new PhysicsWorld({ scene, gravityY: 0 });
  const platformBody = new PhysicsBody(platform, { kinematic: true });
  const riderBody = new PhysicsBody(rider, { velocityY: 10 });
  world.add(platformBody);
  world.add(riderBody);
  world.step(1 / 60);
  assert.equal(rider.position.y, 40);
  assert.equal(riderBody.grounded, true);
  platformBody.setVelocity(60, -30);
  for (let frame = 0; frame < 10; frame += 1) world.step(1 / 60);
  assert.equal(platform.position.x, 10);
  assert.equal(platform.position.y, 45);
  assert.equal(rider.position.x, 20);
  assert.equal(rider.position.y, 35);
  assert.equal(platformBody.setKinematic(false), platformBody);
  assert.throws(() => new PhysicsBody(platform, { static: true, kinematic: true }), /aynı anda/);
  assert.throws(() => new PhysicsBody(platform, { static: true }).setKinematic(true), /Static/);
  world.clear();
});

test("physics: contact begin/stay/end lifecycle", () => {
  const scene = new Scene();
  const a = new Sprite({ width: 10, height: 10 });
  const b = new Sprite({ width: 10, height: 10 });
  scene.add(a, b);
  const events = [];
  const world = new PhysicsWorld({
    scene,
    gravityY: 0,
    onBeginContact: (body, other, contact) => events.push(["begin", contact.penetration]),
    onEndContact: (body, other, contact) => events.push(["end", contact.penetration]),
  });
  const bodyA = new PhysicsBody(a, { tag: "a" });
  const bodyB = new PhysicsBody(b, { tag: "b" });
  world.add(bodyA);
  world.add(bodyB);
  let sceneUpdates = 0;
  const originalUpdate = scene.updateWorldMatrix.bind(scene);
  scene.updateWorldMatrix = (...args) => { sceneUpdates += 1; return originalUpdate(...args); };
  world.step(1 / 60);
  assert.equal(sceneUpdates, 1);
  assert.deepEqual(events.map(([type]) => type), ["begin"]);
  assert.deepEqual(events[0][1], 10);
  world.step(1 / 60);
  assert.deepEqual(events.map(([type]) => type), ["begin"]);
  b.position.x = 30;
  world.step(1 / 60);
  assert.deepEqual(events.map(([type]) => type), ["begin", "end"]);
  b.position.x = 0;
  world.step(1 / 60);
  bodyB.collider.enabled = false;
  world.step(1 / 60);
  assert.deepEqual(events.map(([type]) => type), ["begin", "end", "begin", "end"]);
  world.clear();
});

test("physics: onStayContact ve clear end-contact", () => {
  const scene = new Scene();
  const a = new Sprite({ width: 10, height: 10 });
  const b = new Sprite({ width: 10, height: 10 });
  scene.add(a, b);
  const stays = [];
  const world = new PhysicsWorld({
    scene, gravityY: 0,
    onStayContact: (body, other, contact) => { stays.push([body, other]); assert.equal(contact.phase, "stay"); assert.equal(contact.penetration, 10); },
  });
  const bodyA = new PhysicsBody(a);
  const bodyB = new PhysicsBody(b);
  world.add(bodyA);
  world.add(bodyB);
  world.step(1 / 60);
  assert.equal(stays.length, 1);
  world.step(1 / 60);
  assert.equal(stays.length, 2);
  b.position.x = 30;
  world.step(1 / 60);
  assert.equal(stays.length, 2);
  world.clear();

  const ends = [];
  const clearScene = new Scene();
  const clearA = new Sprite({ width: 10, height: 10 });
  const clearB = new Sprite({ width: 10, height: 10 });
  clearScene.add(clearA, clearB);
  const clearWorld = new PhysicsWorld({ scene: clearScene, gravityY: 0, onEndContact: (body, other, contact) => ends.push(contact.phase) });
  const clearBodyA = new PhysicsBody(clearA);
  const clearBodyB = new PhysicsBody(clearB);
  clearWorld.add(clearBodyA);
  clearWorld.add(clearBodyB);
  clearWorld.step(1 / 60);
  clearWorld.clear();
  assert.deepEqual(ends, ["end"]);
  assert.equal(clearWorld.bodies.size, 0);
});

test("physics: autoSync, tunnel, hız sınırı, kapasite", () => {
  const scene = new Scene();
  const wall = new Sprite({ width: 1, height: 100, x: 50, y: 0 });
  const player = new Sprite({ width: 10, height: 10, x: 0, y: 10 });
  const floor = new Sprite({ width: 100, height: 1, x: 0, y: 50 });
  const falling = new Sprite({ width: 10, height: 10, x: 10, y: 0 });
  scene.add(wall, player, floor, falling);
  const world = new PhysicsWorld({ scene, gravityY: 0, autoSync: true });
  const wallBody = new PhysicsBody(wall, { static: true });
  const playerBody = new PhysicsBody(player, { velocityX: 10_000 });
  const floorBody = new PhysicsBody(floor, { static: true });
  const fallingBody = new PhysicsBody(falling, { velocityY: 10_000 });
  world.add(wallBody);
  world.add(playerBody);
  world.add(floorBody);
  world.add(fallingBody);
  world.step(1 / 60);
  assert.equal(player.position.x, 44.5);
  assert.equal(playerBody.velocity.x, 0);
  assert.equal(falling.position.y, 44.5);
  assert.equal(fallingBody.grounded, true);
  assert.equal(fallingBody.velocity.y, 0);

  const capacityProbe = new PhysicsWorld();
  for (let index = 0; index < 10_001; index += 1) capacityProbe.bodies.add({});
  assert.throws(() => capacityProbe.step(1 / 60), /en fazla 10000 body/);
  assert.throws(() => capacityProbe.syncCollisionIndex(), /en fazla 10000 body/);
  assert.throws(() => capacityProbe.overlaps(new PhysicsBody(new Node())), /en fazla 10000 body/);
  capacityProbe.bodies.clear();
});
