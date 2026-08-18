// ExiEngine unit test — scissor.js + post-process.js helper'ları
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScissorRect } from "../../src/render/scissor.js";
import { renderGroupWithPostProcess } from "../../src/render/post-process.js";
import { RenderGroup, Scene, Sprite, Camera, RenderTexture } from "../../src/index.js";

test("scissor: null rect ve viewport sınırlama", () => {
  assert.equal(getScissorRect(null, 320, 180), null);
  assert.equal(getScissorRect(undefined, 320, 180), null);
  const rect = getScissorRect({ x: -10, y: -20, width: 400, height: 300 }, 320, 180);
  assert.deepEqual(rect, { x: 0, y: 0, width: 320, height: 180 });
});

test("scissor: clip rect dönüşümü ve floor/ceil", () => {
  const rect = getScissorRect({ x: 10.4, y: 20.6, width: 100.2, height: 50.8 }, 320, 180);
  // bottom = ceil(20.6 + 50.8) = 72; height = 72 - 20 = 52
  assert.deepEqual(rect, { x: 10, y: 20, width: 101, height: 52 });
});

test("scissor: output nesnesi reuse", () => {
  const output = { x: 0, y: 0, width: 0, height: 0 };
  const result = getScissorRect({ x: 5, y: 6, width: 30, height: 20 }, 320, 180, output);
  assert.equal(result, output);
  assert.deepEqual(output, { x: 5, y: 6, width: 30, height: 20 });
});

test("scissor: sınır dışı rect clamp", () => {
  assert.deepEqual(getScissorRect({ x: 400, y: 200, width: 50, height: 50 }, 320, 180), { x: 320, y: 180, width: 0, height: 0 });
  assert.deepEqual(getScissorRect({ x: 100, y: 100, width: -50, height: -20 }, 320, 180), { x: 100, y: 100, width: 0, height: 0 });
});

test("postProcess: effects yoksa tek render", () => {
  const group = new RenderGroup({ width: 64, height: 32 });
  group.add(new Sprite({ width: 8, height: 8 }));
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  const count = renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(count, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], group);
  assert.equal(calls[0][2], group.getRenderCamera());
  assert.equal(calls[0][3], group.target);
  group.destroy();
});

test("postProcess: effect zinciri ping-pong", () => {
  const group = new RenderGroup({ width: 64, height: 32, effects: [{ filter: "sepia", amount: 0.25 }, { filter: "contrast", amount: 0.2 }] });
  const sprite = new Sprite({ width: 8, height: 8 });
  group.add(sprite);
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  const count = renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(count, 2);
  // effects.length + 1 render (ilk source + her effect)
  assert.equal(calls.length, 3);
  assert.equal(calls[0][3], group.getPostProcessState().targets[0]);
  assert.equal(calls[1][3], group.getPostProcessState().targets[1]);
  assert.equal(calls[2][3], group.target);
  // Sprite source ve filter her effect'te güncellenir (calls destination'ları doğruluyor)
  const state = group.getPostProcessState();
  assert.equal(state.sprite.filter, "contrast");
  assert.equal(state.sprite.filterAmount, 0.2);
  group.destroy();
});

test("postProcess: tek effect destination group.target", () => {
  const group = new RenderGroup({ width: 64, height: 32, effects: [{ filter: "invert", amount: 0.5 }] });
  group.add(new Sprite({ width: 8, height: 8 }));
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][3], group.getPostProcessState().targets[0]);
  assert.equal(calls[1][3], group.target);
  group.destroy();
});

test("postProcess: getPostProcessState yoksa güvenli fallback", () => {
  const group = new RenderGroup({ width: 64, height: 32 });
  group.add(new Sprite({ width: 8, height: 8 }));
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(calls.length, 1);
  group.destroy();
});
