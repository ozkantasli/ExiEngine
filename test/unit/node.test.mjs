// ExiEngine unit test — Node / Scene
import { test } from "node:test";
import assert from "node:assert/strict";
import { Node, Scene, Sprite } from "../../src/index.js";

test("node: traversal ve arama", () => {
  const scene = new Scene();
  const parent = new Node({ name: "parent" });
  const childA = new Node({ name: "childA" });
  const childB = new Node({ name: "childB" });
  scene.add(parent);
  parent.add(childA, childB);
  const visited = [];
  scene.traverse((n) => visited.push(n.name));
  assert.deepEqual(visited, ["scene", "parent", "childA", "childB"]);
  assert.equal(scene.findByName("childA"), childA);
  assert.equal(scene.findByName("childB"), childB);
  assert.equal(scene.findByName("nonexistent"), null);
  assert.equal(scene.find((n) => n.name === "parent"), parent);
});

test("node: update sırası ve callback doğrulaması", () => {
  const order = [];
  const deltas = [];
  const parent = new Node({ onUpdate: (delta, node) => { order.push(node); deltas.push(delta); } });
  const child = new Node({ onUpdate: (delta, node) => { order.push(node); deltas.push(delta); } });
  parent.add(child);
  parent.update(0.25);
  assert.deepEqual(order, [parent, child]);
  assert.deepEqual(deltas, [0.25, 0.25]);
  assert.equal(parent.setUpdateHandler(null), parent);
  assert.throws(() => parent.setUpdateHandler("invalid"), /callback/);
  assert.throws(() => new Node({ onUpdate: "invalid" }), /callback/);
});

test("node: pointer handler yönetimi", () => {
  const node = new Node();
  const handler = () => {};
  node.setPointerHandlers({ onPointerDown: handler });
  assert.equal(node.interactive, true);
  assert.equal(node.onPointerDown, handler);
  node.setPointerHandlers({});
  assert.equal(node.onPointerDown, handler);
  assert.throws(() => new Node({ onPointerDown: "not-a-function" }), /callback/);
});

test("node: hitArea ve containsPoint", () => {
  const node = new Node({ interactive: true, hitArea: { x: -10, y: -5, width: 20, height: 10 } });
  assert.equal(node.containsPoint(9, 4), true);
  assert.equal(node.containsPoint(11, 0), false);
  assert.throws(() => node.setHitArea({ x: 0, y: 0, width: Infinity, height: 1 }), /Clip rect/);
});

test("node: dünya matrisi ve lazy güncelleme", () => {
  const scene = new Scene();
  const parent = new Node({ x: 10 });
  const child = new Sprite({ width: 4, height: 4, x: 2 });
  parent.add(child);
  scene.add(parent);
  let updates = 0;
  const original = child.worldMatrix.multiply;
  child.worldMatrix.multiply = function (...args) { updates += 1; return original.apply(this, args); };
  scene.updateWorldMatrix();
  const firstCount = updates;
  scene.updateWorldMatrix();
  assert.equal(updates, firstCount);
  parent.position.x = 20;
  scene.updateWorldMatrix();
  assert.equal(updates, firstCount + 1);
  assert.equal(child.worldMatrix.tx, 22);
});

test("node: yeniden ebeveynleme (reparenting)", () => {
  const scene = new Scene();
  const a = new Node({ x: 10 });
  const b = new Node({ x: 100 });
  const child = new Sprite({ x: 2, width: 2, height: 2 });
  a.add(child);
  scene.add(a, b);
  scene.updateWorldMatrix();
  a.remove(child);
  b.add(child);
  scene.updateWorldMatrix();
  assert.equal(child.worldMatrix.tx, 102);
});

test("node: cycle koruması", () => {
  const parent = new Node();
  const child = new Node();
  parent.children.push(child);
  child.children.push(parent);
  assert.throws(() => parent.update(0), /cycle/);
  assert.throws(() => parent.updateWorldMatrix(), /cycle/);
  assert.throws(() => parent.collectRenderables([]), /cycle/);
  assert.throws(() => parent.destroy(), /cycle/);
  parent.children.length = 0;
  child.children.length = 0;
  parent.destroy();
  child.destroy();
});

test("node: derinlik ve child limitleri", () => {
  const root = new Node();
  let cursor = root;
  for (let depth = 0; depth <= 1_024; depth += 1) {
    const child = new Node();
    cursor.children.push(child);
    cursor = child;
  }
  assert.throws(() => root.update(0), /derinlik/);
  const oversized = new Node();
  oversized.children.length = 65_537;
  assert.throws(() => oversized.update(0), /child/);
  oversized.children.length = 0;
  oversized.destroy();
});

test("node: destroy zinciri ve atomic add", () => {
  const parent = new Node();
  const child = new Node();
  parent.add(child);
  parent.destroy();
  assert.equal(parent.children.length, 0);
  assert.equal(child.destroyed, true);
  assert.throws(() => new Node().add(child), /yok edilmiş/);
  assert.throws(() => parent.add(new Node()), /yok edilmiş/);
  const scene = new Scene();
  const before = new Node({ name: "atomic-before" });
  scene.add(before);
  assert.throws(() => scene.add(new Node({ name: "atomic-child" }), {}), /Scene node/);
  assert.deepEqual(scene.children, [before]);
});

test("scene: pick ve zIndex sıralaması", () => {
  const scene = new Scene();
  const back = new Sprite({ width: 100, height: 100, zIndex: 0 });
  const front = new Sprite({ width: 50, height: 50, zIndex: 1 });
  scene.add(back, front);
  assert.equal(scene.pick(0, 0), front);
  assert.equal(scene.pick(40, 40), back);
  assert.equal(scene.pick(0, 0, (node) => node === back), back);
  assert.equal(scene.pick(100, 100), null);
  assert.throws(() => scene.pick(0, 0, "not-a-function"), /predicate/);
});

test("node: yok edilmiş düğüm update tetiklemez", () => {
  let calls = 0;
  const node = new Node({ onUpdate: () => { calls += 1; } });
  node.destroy();
  node.update(1);
  assert.equal(calls, 0);
});
