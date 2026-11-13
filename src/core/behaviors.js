// Data-driven behaviours: small, reusable motions stored as plain JSON in
// node.data.behaviors, so they travel inside scene documents, are edited in the
// editor's inspector and need no code (nothing is evaluated; every behaviour is
// a built-in with validated, bounded parameters).
//
//   node.data = { behaviors: [{ type: "rotate", speed: 2 }, { type: "oscillate", axis: "y", amplitude: 12, period: 1.5 }] }
//   const behaviors = new BehaviorSystem({ input: engine.input, camera });
//   behaviors.attach(scene);              // scans the tree once
//   onUpdate: (delta) => behaviors.update(delta)
//
// Relative behaviours (oscillate, pulse) work around the transform the node had
// when it was attached; keyframes set absolute values.

export const MAX_BEHAVIORS_PER_NODE = 16;
export const MAX_BEHAVIOR_NODES = 4_096;
export const MAX_KEYFRAMES = 256;
export const KEYFRAME_PROPERTIES = Object.freeze(["x", "y", "rotation", "scaleX", "scaleY", "alpha"]);

const LIMIT = 1e6;
const number = (fallback, min = -LIMIT, max = LIMIT) => ({ kind: "number", fallback, min, max });
const choice = (fallback, values) => ({ kind: "choice", fallback, values });
const flag = (fallback) => ({ kind: "boolean", fallback });

// Parameter schemas; the editor builds its behaviour inspector from these.
const SPECS = {
  move: { label: "Move (constant velocity)", params: { vx: number(60), vy: number(0) } },
  rotate: { label: "Rotate", params: { speed: number(1, -100, 100) } },
  oscillate: { label: "Oscillate", params: { axis: choice("y", ["x", "y"]), amplitude: number(16, 0), period: number(2, 0.05, 3_600), phase: number(0, 0, 1) } },
  pulse: { label: "Pulse (scale)", params: { amount: number(0.1, 0, 10), period: number(1, 0.05, 3_600) } },
  blink: { label: "Blink", params: { period: number(0.5, 0.05, 3_600), duty: number(0.5, 0, 1) } },
  "keyboard-move": { label: "Keyboard move (arrows / WASD)", params: { speed: number(200, 0, 100_000), vertical: flag(true) } },
  "camera-follow": { label: "Camera follow", params: { smoothing: number(0.15, 0, 1) } },
  keyframes: { label: "Keyframes (timeline)", params: { duration: number(2, 0.01, 3_600), mode: choice("loop", ["loop", "once", "pingpong"]), ease: choice("linear", ["linear", "smooth"]) } },
};
export const BEHAVIOR_TYPES = Object.freeze(Object.keys(SPECS));

// A read-only description of every behaviour type and its parameters.
export function describeBehaviors() {
  const result = {};
  for (const [type, spec] of Object.entries(SPECS)) {
    const params = {};
    for (const [key, param] of Object.entries(spec.params)) params[key] = { ...param, ...(param.values ? { values: [...param.values] } : {}) };
    result[type] = { label: spec.label, params };
  }
  return result;
}

function finite(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new RangeError(`${label} must be a finite number.`);
  return result;
}

function normalizeTracks(tracks, duration) {
  if (tracks === undefined || tracks === null) return {};
  if (typeof tracks !== "object" || Array.isArray(tracks)) throw new TypeError("keyframes tracks must be an object.");
  const result = {};
  for (const [property, keys] of Object.entries(tracks)) {
    if (!KEYFRAME_PROPERTIES.includes(property)) throw new RangeError(`keyframes track "${property}" is not one of ${KEYFRAME_PROPERTIES.join(", ")}.`);
    if (!Array.isArray(keys) || keys.length === 0) throw new TypeError(`keyframes track "${property}" must be a non-empty array of [time, value].`);
    if (keys.length > MAX_KEYFRAMES) throw new RangeError(`keyframes track "${property}" supports at most ${MAX_KEYFRAMES} keys.`);
    const normalized = keys.map((key, index) => {
      if (!Array.isArray(key) || key.length !== 2) throw new TypeError(`keyframes track "${property}" key ${index} must be [time, value].`);
      const time = finite(key[0], `keyframes ${property} time`);
      const value = finite(key[1], `keyframes ${property} value`);
      if (time < 0 || time > duration) throw new RangeError(`keyframes ${property} time ${time} is outside 0..${duration}.`);
      if (Math.abs(value) > LIMIT) throw new RangeError(`keyframes ${property} value is out of range.`);
      return [time, value];
    });
    normalized.sort((left, right) => left[0] - right[0]);
    result[property] = normalized;
  }
  return result;
}

// Validates one behaviour definition and fills in defaults.
export function normalizeBehavior(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new TypeError("A behaviour must be an object with a type.");
  const spec = SPECS[definition.type];
  if (!spec) throw new RangeError(`Unknown behaviour type "${definition.type}" (expected one of ${BEHAVIOR_TYPES.join(", ")}).`);
  const result = { type: definition.type };
  for (const [key, param] of Object.entries(spec.params)) {
    const value = definition[key] ?? param.fallback;
    if (param.kind === "number") {
      const parsed = finite(value, `${definition.type} ${key}`);
      if (parsed < param.min || parsed > param.max) throw new RangeError(`${definition.type} ${key} must be between ${param.min} and ${param.max}.`);
      result[key] = parsed;
    } else if (param.kind === "choice") {
      if (!param.values.includes(value)) throw new RangeError(`${definition.type} ${key} must be one of ${param.values.join(", ")}.`);
      result[key] = value;
    } else {
      result[key] = Boolean(value);
    }
  }
  if (definition.type === "keyframes") result.tracks = normalizeTracks(definition.tracks, result.duration);
  return result;
}

export function normalizeBehaviors(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new TypeError("node.data.behaviors must be an array.");
  if (list.length > MAX_BEHAVIORS_PER_NODE) throw new RangeError(`A node supports at most ${MAX_BEHAVIORS_PER_NODE} behaviours.`);
  return list.map(normalizeBehavior);
}

function sample(keys, time, ease) {
  if (time <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (time >= last[0]) return last[1];
  let index = 1;
  while (keys[index][0] < time) index += 1;
  const [t0, v0] = keys[index - 1]; const [t1, v1] = keys[index];
  let t = t1 > t0 ? (time - t0) / (t1 - t0) : 1;
  if (ease === "smooth") t = t * t * (3 - 2 * t);
  return v0 + (v1 - v0) * t;
}

// Value of a keyframes behaviour's track at a time (the editor's timeline
// preview uses the same function the runtime uses).
export function sampleKeyframes(behavior, property, time) {
  const keys = behavior.tracks?.[property];
  if (!keys?.length) return undefined;
  return sample(keys, time, behavior.ease);
}

function keyframeTime(behavior, elapsed) {
  const { duration, mode } = behavior;
  if (mode === "once") return Math.min(elapsed, duration);
  if (mode === "pingpong") {
    const cycle = elapsed % (duration * 2);
    return cycle <= duration ? cycle : duration * 2 - cycle;
  }
  return elapsed % duration;
}

const SETTERS = {
  x: (node, value) => { node.position.x = value; },
  y: (node, value) => { node.position.y = value; },
  rotation: (node, value) => { node.rotation = value; },
  scaleX: (node, value) => { node.scale.x = value; },
  scaleY: (node, value) => { node.scale.y = value; },
  alpha: (node, value) => { node.alpha = Math.max(0, Math.min(1, value)); },
};

// Applies a keyframes behaviour to a node at a time (used by the runtime and
// by the editor's timeline scrubber).
export function applyKeyframes(node, behavior, time) {
  for (const property of KEYFRAME_PROPERTIES) {
    const value = sampleKeyframes(behavior, property, time);
    if (value !== undefined) SETTERS[property](node, value);
  }
}

const ARROWS = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] };

export class BehaviorSystem {
  constructor({ input = null, camera = null } = {}) {
    this.input = input;
    this.camera = camera;
    this.entries = [];
    this.time = 0;
    this.errors = [];
  }

  get count() { return this.entries.reduce((total, entry) => total + entry.behaviors.length, 0); }

  // Scans root and its descendants for node.data.behaviors. Nodes with invalid
  // behaviour data are skipped and reported in this.errors (the game keeps
  // running). Returns the number of behaviours attached.
  attach(root) {
    this.clear();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || node.destroyed) continue;
      for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
      const list = node.data?.behaviors;
      if (list === undefined) continue;
      try {
        const behaviors = normalizeBehaviors(list);
        if (behaviors.length === 0) continue;
        if (this.entries.length >= MAX_BEHAVIOR_NODES) throw new RangeError(`At most ${MAX_BEHAVIOR_NODES} nodes can have behaviours.`);
        this.entries.push({
          node, behaviors,
          base: { x: node.position.x, y: node.position.y, scaleX: node.scale.x, scaleY: node.scale.y, visible: node.visible },
        });
      } catch (error) {
        if (this.errors.length < 64) this.errors.push({ node: node.name, message: error.message });
      }
    }
    return this.count;
  }

  clear() {
    this.entries.length = 0;
    this.errors.length = 0;
    this.time = 0;
    return this;
  }

  update(delta) {
    const step = Number(delta);
    if (!(step > 0) || !Number.isFinite(step)) return this;
    this.time += step;
    const { time, input } = this;
    let write = 0;
    for (const entry of this.entries) {
      const { node, base } = entry;
      if (node.destroyed) continue;
      this.entries[write++] = entry;
      for (const behavior of entry.behaviors) {
        switch (behavior.type) {
          case "move":
            node.position.x += behavior.vx * step; node.position.y += behavior.vy * step;
            break;
          case "rotate":
            node.rotation += behavior.speed * step;
            break;
          case "oscillate": {
            const offset = Math.sin((time / behavior.period + behavior.phase) * Math.PI * 2) * behavior.amplitude;
            if (behavior.axis === "x") node.position.x = base.x + offset; else node.position.y = base.y + offset;
            break;
          }
          case "pulse": {
            const factor = 1 + Math.sin((time / behavior.period) * Math.PI * 2) * behavior.amount;
            node.scale.set(base.scaleX * factor, base.scaleY * factor);
            break;
          }
          case "blink":
            node.visible = base.visible && (time % behavior.period) < behavior.period * behavior.duty;
            break;
          case "keyboard-move": {
            if (!input) break;
            const held = (codes) => codes.some((code) => input.isKeyDown(code));
            let dx = (held(ARROWS.right) ? 1 : 0) - (held(ARROWS.left) ? 1 : 0);
            let dy = behavior.vertical ? (held(ARROWS.down) ? 1 : 0) - (held(ARROWS.up) ? 1 : 0) : 0;
            const length = Math.hypot(dx, dy);
            if (length > 0) { dx /= length; dy /= length; }
            node.position.x += dx * behavior.speed * step; node.position.y += dy * behavior.speed * step;
            break;
          }
          case "camera-follow":
            if (this.camera && this.camera.followTarget !== node) this.camera.follow(node, { smoothing: behavior.smoothing });
            break;
          case "keyframes":
            applyKeyframes(node, behavior, keyframeTime(behavior, time));
            break;
          default:
            break;
        }
      }
    }
    this.entries.length = write;
    return this;
  }
}
