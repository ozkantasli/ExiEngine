import { FILTER_TYPES, registerFilterMode } from "../core/node.js";

// Custom filters registered by local game code (never by AI agents: the name
// is on the agent deny list in src/ai/public-methods.js). A filter is only a
// function BODY, compiled into the engine's own shaders for both backends:
//   GLSL: vec4 body(vec4 color, vec2 uv, float amount, vec2 texel)
//   WGSL: fn body(color: vec4f, uv: vec2f, amount: f32, texel: vec2f) -> vec4f
// exiSample(uv) samples the current texture in both languages. Bodies must keep
// their braces balanced and cannot use preprocessor directives or attributes,
// so they cannot add declarations outside their function. A body that fails to
// compile on a backend is disabled there (status "error") instead of breaking
// rendering; until a backend has compiled a filter it draws unfiltered.

export const MAX_CUSTOM_FILTERS = 16;
export const MAX_CUSTOM_FILTER_SOURCE = 4_096;
const FIRST_CUSTOM_MODE = FILTER_TYPES.length;
const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const filters = [];
let version = 0;

function checkBody(source, label, forbidden) {
  if (typeof source !== "string" || !source.trim() || source.length > MAX_CUSTOM_FILTER_SOURCE) throw new TypeError(`${label} must be a non-empty string of at most ${MAX_CUSTOM_FILTER_SOURCE} characters.`);
  if (forbidden.test(source)) throw new TypeError(`${label} may not contain preprocessor directives, attributes or backslashes.`);
  let depth = 0;
  for (const character of source) {
    if (character === "{") depth += 1;
    else if (character === "}") { depth -= 1; if (depth < 0) throw new TypeError(`${label} has unbalanced braces.`); }
  }
  if (depth !== 0) throw new TypeError(`${label} has unbalanced braces.`);
  if (!/\breturn\b/.test(source)) throw new TypeError(`${label} must return the filtered color.`);
  return source;
}

export function registerFilter(name, { glsl, wgsl } = {}) {
  if (typeof name !== "string" || !NAME.test(name)) throw new TypeError("Custom filter names are 2-32 characters: a lowercase letter, then lowercase letters, digits or '-'.");
  if (FILTER_TYPES.includes(name) || filters.some((filter) => filter.name === name)) throw new TypeError(`Filter "${name}" already exists.`);
  if (filters.length >= MAX_CUSTOM_FILTERS) throw new RangeError(`At most ${MAX_CUSTOM_FILTERS} custom filters can be registered.`);
  const filter = Object.freeze({
    name,
    mode: FIRST_CUSTOM_MODE + filters.length,
    glsl: checkBody(glsl, `Filter "${name}" glsl`, /#|\\|\buniform\b|\blayout\b|\bprecision\b/),
    wgsl: checkBody(wgsl, `Filter "${name}" wgsl`, /@|\\|\benable\b|\brequires\b|\bdiagnostic\b/),
  });
  filters.push(filter);
  registerFilterMode(name, filter.mode);
  version += 1;
  return { name, mode: filter.mode };
}

export function getCustomFilters() { return filters; }
export function customFilterVersion() { return version; }
export function listFilters() { return [...FILTER_TYPES, ...filters.map((filter) => filter.name)]; }

// Shared helpers that build the extra shader code for a set of filters.
export function glslCustomFilterCode(list) {
  if (!list.length) return { functions: "", dispatch: "" };
  const functions = list.map((filter) => `vec4 exiCustomFilter${filter.mode}(vec4 color, vec2 uv, float amount, vec2 texel) {\n${filter.glsl}\n}`).join("\n");
  const branches = list.map((filter) => `if (mode > ${filter.mode - 0.5} && mode < ${filter.mode + 0.5}) color = exiCustomFilter${filter.mode}(color, uv, u_filter.y, customTexel);`).join("\n    else ");
  return {
    functions: `vec4 exiSample(vec2 uv) { return texture(u_texture, uv); }\n${functions}`,
    dispatch: `  if (mode > ${FIRST_CUSTOM_MODE - 0.5}) {\n    vec2 customTexel = 1.0 / vec2(textureSize(u_texture, 0));\n    ${branches}\n  }\n`,
  };
}

export function wgslCustomFilterCode(list) {
  if (!list.length) return { functions: "", dispatch: "" };
  const functions = list.map((filter) => `fn exiCustomFilter${filter.mode}(color: vec4f, uv: vec2f, amount: f32, texel: vec2f) -> vec4f {\n${filter.wgsl}\n}`).join("\n");
  const branches = list.map((filter) => `if (mode > ${filter.mode - 0.5} && mode < ${filter.mode + 0.5}) { color = exiCustomFilter${filter.mode}(color, input.uv, filterParams.values.y, customTexel); }`).join("\n    else ");
  return {
    functions: `fn exiSample(uv: vec2f) -> vec4f { return textureSampleLevel(spriteTexture, spriteSampler, uv, 0.0); }\n${functions}`,
    dispatch: `  if (mode > ${FIRST_CUSTOM_MODE - 0.5}) {\n    let customTexel = 1.0 / vec2f(textureDimensions(spriteTexture));\n    ${branches}\n  }\n`,
  };
}
