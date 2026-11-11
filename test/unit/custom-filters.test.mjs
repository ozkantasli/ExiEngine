// ExiEngine unit test — registerFilter (bounded custom shader bodies, agent deny list)
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILTER_TYPES, MAX_CUSTOM_FILTERS, Node, listFilters, registerFilter } from "../../src/index.js";
import { filterMode, normalizeFilterType } from "../../src/core/node.js";
import { buildFragmentSource } from "../../src/render/webgl2-renderer.js";
import { buildShaderSource } from "../../src/render/webgpu-renderer.js";
import { getCustomFilters } from "../../src/render/custom-filters.js";
import { isAgentCallableExport } from "../../src/ai/public-methods.js";

const body = { glsl: "return vec4(1.0 - color.rgb, color.a);", wgsl: "return vec4f(1.0 - color.rgb, color.a);" };

test("custom filters: registration adds a node filter with the next shader mode", () => {
  const { name, mode } = registerFilter("negative", body);
  assert.equal(name, "negative");
  assert.equal(mode, FILTER_TYPES.length);
  assert.equal(filterMode("negative"), mode);
  assert.equal(normalizeFilterType("negative"), "negative");
  assert.equal(new Node({ filter: "negative" }).filter, "negative");
  assert.ok(listFilters().includes("negative"));
  const glsl = buildFragmentSource(getCustomFilters());
  assert.match(glsl, /vec4 exiCustomFilter\d+\(vec4 color, vec2 uv, float amount, vec2 texel\) \{\nreturn vec4\(1\.0 - color\.rgb, color\.a\);/);
  assert.match(glsl, /vec4 exiSample\(vec2 uv\)/);
  assert.ok(glsl.indexOf("exiCustomFilter") < glsl.indexOf("void main()"), "functions are declared before main");
  const wgsl = buildShaderSource(getCustomFilters());
  assert.match(wgsl, /fn exiCustomFilter\d+\(color: vec4f, uv: vec2f, amount: f32, texel: vec2f\) -> vec4f/);
  assert.ok(wgsl.indexOf("exiCustomFilter") < wgsl.indexOf("@fragment"));
  assert.equal(buildFragmentSource([]).includes("exiCustomFilter"), false, "no custom code without filters");
});

test("custom filters: bodies cannot escape their function or use directives/attributes", () => {
  const bad = (overrides) => ({ ...body, ...overrides });
  assert.throws(() => registerFilter("Bad Name", body), /names/);
  assert.throws(() => registerFilter("blur", body), /already exists/);
  assert.throws(() => registerFilter("negative", body), /already exists/);
  assert.throws(() => registerFilter("x1", bad({ glsl: "" })), /non-empty/);
  assert.throws(() => registerFilter("x1", bad({ glsl: "return color; } uniform float u_x; vec4 f() {" })), /directives|braces/);
  assert.throws(() => registerFilter("x1", bad({ glsl: "return color; } void x() { return; " })), /unbalanced braces/);
  assert.throws(() => registerFilter("x1", bad({ glsl: "#extension GL_X : enable\nreturn color;" })), /directives/);
  assert.throws(() => registerFilter("x1", bad({ wgsl: "@group(0) @binding(9) var t: texture_2d<f32>; return color;" })), /attributes/);
  assert.throws(() => registerFilter("x1", bad({ wgsl: "enable f16; return color;" })), /directives/);
  assert.throws(() => registerFilter("x1", bad({ glsl: "color.r = 1.0;" })), /return/);
  assert.throws(() => registerFilter("x1", bad({ glsl: `return color;${" ".repeat(5_000)}` })), /4096/);
  assert.throws(() => registerFilter("x1", { glsl: body.glsl }), /wgsl/);
});

test("custom filters: bounded count and hidden from AI agents", () => {
  for (let index = getCustomFilters().length; index < MAX_CUSTOM_FILTERS; index += 1) registerFilter(`fill-${index}`, body);
  assert.throws(() => registerFilter("one-more", body), /At most/);
  assert.equal(isAgentCallableExport("registerFilter"), false);
  assert.equal(isAgentCallableExport("serializeScene"), true);
});
