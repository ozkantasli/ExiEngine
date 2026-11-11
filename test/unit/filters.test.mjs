// ExiEngine unit test — filter catalogue, spatial post-process filters and transparent group passes
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTER_TYPES, Node, RenderGroup, Scene, Sprite } from "../../src/index.js";
import { filterMode, normalizeFilterType } from "../../src/core/node.js";
import { renderGroupWithPostProcess, TRANSPARENT_CLEAR } from "../../src/render/post-process.js";
import { readFileSync } from "node:fs";

test("filters: catalogue, normalization and shader modes stay in sync", () => {
  assert.deepEqual([...FILTER_TYPES], ["none", "grayscale", "invert", "brightness", "sepia", "contrast", "saturate", "blur", "glow", "outline", "pixelate", "vignette", "normal-light"]);
  FILTER_TYPES.forEach((name, index) => {
    assert.equal(filterMode(name), index);
    assert.equal(normalizeFilterType(name), name);
  });
  for (const bad of ["drop-shadow", "", null, "constructor", "__proto__", 7]) {
    assert.equal(normalizeFilterType(bad), "none");
    assert.equal(filterMode(bad), 0);
  }
  // Each mode >= 7 has a branch in both backends, and the saturate branch no longer swallows them.
  const webgl = readFileSync(new URL("../../src/render/webgl2-renderer.js", import.meta.url), "utf8");
  const webgpu = readFileSync(new URL("../../src/render/webgpu-renderer.js", import.meta.url), "utf8");
  for (const source of [webgl, webgpu]) {
    assert.doesNotMatch(source, /values\.x > 5\.5\)|u_filter\.x > 5\.5\)/, "saturate must be bounded above");
    assert.match(source, /mode < 7\.5/);
    assert.match(source, /mode < 8\.5/);
    assert.match(source, /mode < 9\.5/);
    assert.match(source, /> 10\.5 && .* < 11\.5/);
  }
});

test("filters: nodes and RenderGroup effects accept the spatial filters and inherit them", () => {
  const parent = new Node({ filter: "blur", filterAmount: 0.5 });
  const child = new Sprite({ width: 4, height: 4 });
  parent.add(child);
  parent.updateWorldMatrix();
  assert.equal(child.worldFilter, "blur");
  assert.equal(child.worldFilterAmount, 0.5);
  child.setFilter("outline", 2);
  assert.equal(child.filter, "outline");
  assert.equal(child.filterAmount, 1, "amount is clamped to 0..1");
  const group = new RenderGroup({ width: 64, height: 64, effects: [{ filter: "glow", amount: 0.8 }, { filter: "vignette", amount: 0.4 }] });
  assert.deepEqual(group.getEffects().map((effect) => effect.filter), ["glow", "vignette"]);
  assert.throws(() => group.setEffects([{ filter: "drop-shadow" }]), /allowlist/);
  group.destroy();
});

test("filters: RenderGroup passes clear their targets to transparent", () => {
  const calls = [];
  const renderer = { render: (...args) => calls.push(args) };
  const plain = new RenderGroup({ width: 32, height: 32 });
  renderGroupWithPostProcess(renderer, 0, plain);
  const withEffects = new RenderGroup({ width: 32, height: 32, effects: [{ filter: "blur", amount: 1 }, { filter: "pixelate", amount: 0.5 }] });
  new Scene().add(withEffects);
  const passes = renderGroupWithPostProcess(renderer, 0, withEffects);
  assert.equal(passes, 2);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(call[6], TRANSPARENT_CLEAR);
  plain.destroy();
  withEffects.destroy();
});
