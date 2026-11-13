// ExiEngine unit test — scissor.js + post-process.js helpers
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScissorRect } from "../../src/render/scissor.js";
import { renderGroupWithPostProcess } from "../../src/render/post-process.js";
import { updateStaticRenderKey } from "../../src/render/batch.js";
import { RenderGroup, Scene, Sprite, Camera, RenderTexture } from "../../src/index.js";

test("scissor: null rect and viewport clamping", () => {
  assert.equal(getScissorRect(null, 320, 180), null);
  assert.equal(getScissorRect(undefined, 320, 180), null);
  const rect = getScissorRect({ x: -10, y: -20, width: 400, height: 300 }, 320, 180);
  assert.deepEqual(rect, { x: 0, y: 0, width: 320, height: 180 });
});

test("scissor: clip rect conversion and floor/ceil", () => {
  const rect = getScissorRect({ x: 10.4, y: 20.6, width: 100.2, height: 50.8 }, 320, 180);
  // bottom = ceil(20.6 + 50.8) = 72; height = 72 - 20 = 52
  assert.deepEqual(rect, { x: 10, y: 20, width: 101, height: 52 });
});

test("scissor: output object reuse", () => {
  const output = { x: 0, y: 0, width: 0, height: 0 };
  const result = getScissorRect({ x: 5, y: 6, width: 30, height: 20 }, 320, 180, output);
  assert.equal(result, output);
  assert.deepEqual(output, { x: 5, y: 6, width: 30, height: 20 });
});

test("scissor: out-of-bounds rect clamp", () => {
  assert.deepEqual(getScissorRect({ x: 400, y: 200, width: 50, height: 50 }, 320, 180), { x: 320, y: 180, width: 0, height: 0 });
  assert.deepEqual(getScissorRect({ x: 100, y: 100, width: -50, height: -20 }, 320, 180), { x: 100, y: 100, width: 0, height: 0 });
});

test("postProcess: a single render without effects", () => {
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

test("postProcess: effect chain ping-pong", () => {
  const group = new RenderGroup({ width: 64, height: 32, effects: [{ filter: "sepia", amount: 0.25 }, { filter: "contrast", amount: 0.2 }] });
  const sprite = new Sprite({ width: 8, height: 8 });
  group.add(sprite);
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  const count = renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(count, 2);
  // effects.length + 1 render (the first source + each effect)
  assert.equal(calls.length, 3);
  assert.equal(calls[0][3], group.getPostProcessState().targets[0]);
  assert.equal(calls[1][3], group.getPostProcessState().targets[1]);
  assert.equal(calls[2][3], group.target);
  // The sprite source and filter are updated per effect (the calls verify the destinations)
  const state = group.getPostProcessState();
  assert.equal(state.sprite.filter, "contrast");
  assert.equal(state.sprite.filterAmount, 0.2);
  group.destroy();
});

test("postProcess: a single effect targets group.target", () => {
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

test("postProcess: safe fallback without getPostProcessState", () => {
  const group = new RenderGroup({ width: 64, height: 32 });
  group.add(new Sprite({ width: 8, height: 8 }));
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  renderGroupWithPostProcess(renderer, 0, group);
  assert.equal(calls.length, 1);
  group.destroy();
});

test("updateStaticRenderKey: a texture version change produces a new static key", () => {
  const camera = { position: { x: 0, y: 0 }, zoom: 1, pixelRatio: 1, rotation: 0, width: 320, height: 180 };
  const matrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const state = { version: 0, contentVersion: -1 };
  const args = [state, 1, camera, 320, 180, matrix, null, 1, "none", 1, null, null];
  const first = updateStaticRenderKey(...args, 0);
  const second = updateStaticRenderKey(...args, 0);
  assert.equal(second, first);
  const third = updateStaticRenderKey(...args, 1);
  assert.notEqual(third, second);
  const fourth = updateStaticRenderKey(...args, 1);
  assert.equal(fourth, third);
  const withoutTexture = updateStaticRenderKey(...args);
  assert.notEqual(withoutTexture, fourth);
  // dataByteLength axis: a new key for the same content bytes and for different bytes
  const argsBytes = [state, 1, camera, 320, 180, matrix, null, 1, "none", 1, null, null];
  const keyA = updateStaticRenderKey(...argsBytes, 0, 512);
  const keyA2 = updateStaticRenderKey(...argsBytes, 0, 512);
  assert.equal(keyA2, keyA);
  const keyB = updateStaticRenderKey(...argsBytes, 0, 1024);
  assert.notEqual(keyB, keyA);
  assert.notEqual(withoutTexture, fourth);
});
