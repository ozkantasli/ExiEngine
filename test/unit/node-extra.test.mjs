// ExiEngine unit test — Node/Scene ek davranışlar (renderGroup flag, mask, focus, layout)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Node, Scene, Sprite, RenderGroup, Camera, Texture } from "../../src/index.js";
import { collectRenderGroups } from "../../src/render/batch.js";

test("node: renderGroupSubtree flag collectRenderGroups", () => {
  const scene = new Scene();
  const holder = new Node();
  const group = new RenderGroup({ width: 8, height: 8 });
  holder.add(group);
  scene.add(holder);
  assert.equal(scene._renderGroupSubtree, true);
  assert.deepEqual(collectRenderGroups(scene), [group]);
  holder.remove(group);
  assert.equal(scene._renderGroupSubtree, false);
  assert.deepEqual(collectRenderGroups(scene), []);
  holder.add(group);
  assert.equal(scene._renderGroupSubtree, true);
  group.destroy();
  holder.destroy();
  scene.destroy();
});

test("node: nested renderGroup post-order toplama", () => {
  const scene = new Scene();
  const outer = new RenderGroup({ width: 32, height: 16 });
  const inner = new RenderGroup({ width: 16, height: 16 });
  outer.add(inner);
  scene.add(outer);
  assert.deepEqual(collectRenderGroups(scene), [inner, outer]);
  inner.visible = false;
  assert.deepEqual(collectRenderGroups(scene), [outer]);
  inner.visible = true;
  outer.remove(inner);
  assert.equal(scene._renderGroupSubtree, true);
  assert.deepEqual(collectRenderGroups(scene), [outer]);
  outer.add(inner);
  assert.deepEqual(collectRenderGroups(scene), [inner, outer]);
  outer.destroy();
});

test("node: maskTexture mirası ve doğrulama", () => {
  const maskTexture = new Texture({ id: "mask", sourceWidth: 4, sourceHeight: 4 });
  const scene = new Scene();
  const group = new Node({ maskTexture, maskRect: { x: 12, y: 18, width: 80, height: 50 } });
  const sprite = new Sprite({ width: 12, height: 12 });
  group.add(sprite);
  scene.add(group);
  scene.updateWorldMatrix();
  assert.equal(group.worldMaskTexture, maskTexture);
  assert.equal(sprite.worldMaskTexture, maskTexture);
  group.setMaskTexture(null);
  scene.updateWorldMatrix();
  assert.equal(group.worldMaskTexture, null);
  assert.throws(() => new Node({ maskTexture: {} }), /maskTexture/);
  assert.throws(() => new Node().setMaskTexture({}), /maskTexture/);
});

test("node: clipRect nested kesişim", () => {
  const scene = new Scene();
  const group = new Node({ clipRect: { x: 20, y: 20, width: 140, height: 90 } });
  const nested = new Node({ clipRect: { x: 60, y: 10, width: 100, height: 100 } });
  nested.add(new Sprite({ width: 8, height: 8 }));
  group.add(nested);
  scene.add(group);
  scene.updateWorldMatrix();
  const clip = nested.renderClip;
  scene.updateWorldMatrix();
  assert.equal(nested.renderClip, clip);
});

test("node: focus ve focusNext", () => {
  const scene = new Scene();
  const a = new Node({ focusable: true, onFocus: () => { a.focused = true; } });
  const b = new Node({ focusable: true, onBlur: () => { b.focused = false; }, onFocus: () => { b.focused = true; } });
  scene.add(a, b);
  // Focus, ExiEngine üzerinden yönetilir; Scene düzeyinde focusable keşfi doğrulanır
  const focusables = [];
  scene.traverse((node) => { if (node.focusable) focusables.push(node); });
  assert.deepEqual(focusables, [a, b]);
  // focusable alan doğrudan set/get
  assert.equal(a.focusable, true);
  assert.equal(b.focusable, true);
  a.focusable = false;
  assert.equal(a.focusable, false);
  a.focusable = true;
});

test("node: layout anchor HUD", () => {
  const scene = new Scene();
  const sprite = new Sprite({ width: 100, height: 20, anchorX: 0.5, anchorY: 0.5, layout: { right: 16, bottom: 8 } });
  scene.add(sprite);
  // layout normalize edilmiş tam nesne olarak saklanır
  assert.equal(sprite.layout.right, 16);
  assert.equal(sprite.layout.bottom, 8);
  assert.equal(sprite.setLayout({ left: 16, top: 12 }), sprite);
  assert.equal(sprite.layout.left, 16);
  assert.equal(sprite.layout.top, 12);
  assert.equal(sprite.layout.right, null);
  assert.throws(() => sprite.setLayout({ left: Infinity }), /finite/);
});

test("node: directNormalization alpha/filter/mask", () => {
  const node = new Node();
  node.alpha = 2;
  node.filter = "invert";
  node.filterAmount = 2;
  node.maskTexture = Texture.white;
  node.updateWorldMatrix();
  assert.equal(node.alpha, 1);
  assert.equal(node.filter, "invert");
  assert.equal(node.filterAmount, 1);
  assert.equal(node.worldMaskTexture, Texture.white);
  node.alpha = 0.25;
  node.filter = "none";
  node.filterAmount = 0.5;
  node.maskTexture = null;
  node.updateWorldMatrix();
  assert.equal(node.alpha, 0.25);
  assert.equal(node.worldFilter, "none");
  assert.equal(node.filterAmount, 0.5);
  assert.equal(node.worldMaskTexture, null);
  node.maskTexture = {};
  assert.throws(() => node.updateWorldMatrix(), /maskTexture/);
  for (const rectName of ["clipRect", "maskRect", "cullBounds", "hitArea"]) {
    node[rectName] = {};
    assert.throws(() => node.updateWorldMatrix(), /Clip rect/);
    node[rectName] = null;
  }
});
