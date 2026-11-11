import { isAgentCallableExport, isPublicMethod } from "./public-methods.js";
import { StateMachine } from "../core/state-machine.js";

// Poll phase machine: idle (not running) → armed (running, timer set) → polling (poll in flight).
// `pollEpoch` remains the abort-identity guard; the machine makes the phase explicit and throws on nonsense.
const POLL_STATES = {
  idle: { on: { start: "armed", fire: "polling", stop: "idle" } },
  armed: { on: { start: "armed", fire: "polling", stop: "idle" } },
  polling: { on: { settle: "armed", stop: "idle" } },
};

const MAX_DEPTH = 32;
const MAX_KEYS = 128;
const MAX_ITEMS = 4096;
const MAX_STRING_LENGTH = 64 * 1024;
const MAX_BINARY_BYTES = 512 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_BINARY_BYTES / 3) * 4;
const MAX_HANDLES = 4096;
const MAX_CALLBACKS = 256;
const MAX_BATCH_CALLS = 8;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_INLINE_BINARY_BYTES = 32 * 1024;
const MAX_OUTPUT_DEPTH = 4;
const MAX_OUTPUT_ITEMS = 64;
const DEFAULT_OBSERVE_COLUMNS = 32;
const DEFAULT_OBSERVE_ROWS = 18;
const MAX_OBSERVE_COLUMNS = 64;
const MAX_OBSERVE_ROWS = 64;
const MAX_OBSERVE_CELLS = 4096;
const MAX_SNAPSHOT_NODES = 64;
const MAX_SNAPSHOT_VISITED = 4096;
const MAX_SNAPSHOT_DEPTH = 32;
const MAX_SNAPSHOT_OFFSET = MAX_SNAPSHOT_VISITED - 1;
const MAX_SCENARIO_FRAMES = 16;
const MAX_SCENARIO_EVENTS = 512;
const MAX_SCENARIO_FRAME_EVENTS = 128;
const MAX_SCENARIO_OBSERVE_CELLS = 1024;
const MAX_SCENARIO_SNAPSHOT_NODES = 16;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

function fail(message, code = "EXI_RUNTIME_INPUT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertPublicName(value, label) {
  if (typeof value !== "string" || !value || value.length > 256 || value.startsWith("_") || forbiddenKeys.has(value)) fail(`${label} is invalid.`);
  return value;
}

function assertPublicPath(value) {
  if (typeof value !== "string" || !value || value.length > 512) fail("path is invalid.");
  const segments = value.split(".");
  if (segments.some((segment) => !segment || segment.startsWith("_") || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail("Must be a public export path.");
  return segments;
}

function assertSafeData(value, depth = 0) {
  if (depth > MAX_DEPTH) fail("Runtime data depth limit exceeded.");
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) fail("Runtime text limit exceeded.");
    return;
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("Runtime number must be finite.");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) fail("Runtime array limit exceeded.");
    for (const item of value) assertSafeData(item, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") fail("Runtime may only contain JSON data.");
  const keys = Object.keys(value);
  if (keys.length === 1 && Object.hasOwn(value, "$callback")) {
    assertPublicName(value.$callback, "callback");
    return;
  }
  if (keys.length === 1 && Object.hasOwn(value, "$bytes")) {
    if (Array.isArray(value.$bytes)) {
      if (value.$bytes.length > MAX_BINARY_BYTES || value.$bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) fail("Runtime byte data is invalid.");
    } else if (typeof value.$bytes !== "string" || value.$bytes.length > MAX_BASE64_LENGTH || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.$bytes)) fail("Runtime base64 byte data is invalid.");
    return;
  }
  if (keys.length > MAX_KEYS) fail("Runtime object field limit exceeded.");
  for (const key of keys) {
    if (forbiddenKeys.has(key)) fail(`Unsafe runtime field: ${key}`);
    assertSafeData(value[key], depth + 1);
  }
}

function isClass(value) {
  return typeof value === "function" && Function.prototype.toString.call(value).startsWith("class ");
}

function isHandleable(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && prototype !== Object.prototype;
}

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function observeGridSize(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > (label === "columns" ? MAX_OBSERVE_COLUMNS : MAX_OBSERVE_ROWS)) fail(`${label} must be within the observation bounds.`);
  return value;
}

function observeDefaults(defaults) {
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) fail("Observer defaults must be an object.");
  const columns = observeGridSize(defaults.columns, DEFAULT_OBSERVE_COLUMNS, "columns");
  const rows = observeGridSize(defaults.rows, DEFAULT_OBSERVE_ROWS, "rows");
  if (columns * rows > MAX_OBSERVE_CELLS) fail("Observation grid budget exceeded.");
  return { columns, rows };
}

function readDataProperty(object, property) {
  let target = object;
  while (target && target !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    target = Object.getPrototypeOf(target);
  }
  return undefined;
}

function objectType(object) {
  const prototype = object && Object.getPrototypeOf(object);
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return typeof constructor?.name === "string" && constructor.name ? constructor.name.slice(0, 128) : "object";
}

function snapshotOptions(value) {
  if (value === undefined) return { offset: 0, limit: MAX_SNAPSHOT_NODES };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("snapshot options must be an object.");
  for (const key of Object.keys(value)) if (key !== "offset" && key !== "limit") fail(`snapshot unknown option: ${key}`);
  const offset = value.offset === undefined ? 0 : value.offset;
  const limit = value.limit === undefined ? MAX_SNAPSHOT_NODES : value.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_SNAPSHOT_OFFSET) fail("snapshot offset must be within bounds.");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SNAPSHOT_NODES) fail("snapshot limit must be within bounds.");
  return { offset, limit };
}

function scenarioObserveOptions(value) {
  if (value === undefined || value === false) return null;
  if (value === true) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("scenario observe options must be an object.");
  for (const key of Object.keys(value)) if (key !== "columns" && key !== "rows") fail(`scenario observe unknown option: ${key}`);
  const options = observeDefaults(value);
  if (options.columns * options.rows > MAX_SCENARIO_OBSERVE_CELLS) fail("scenario observe grid budget exceeded.");
  return options;
}

function scenarioSnapshotOptions(value) {
  if (value === undefined || value === false) return null;
  if (value === true) return { offset: 0, limit: MAX_SCENARIO_SNAPSHOT_NODES };
  const options = snapshotOptions(value);
  if (options.limit > MAX_SCENARIO_SNAPSHOT_NODES) fail(`scenario snapshot limit must be at most ${MAX_SCENARIO_SNAPSHOT_NODES}.`);
  return options;
}

function scenarioOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("scenario options must be an object.");
  for (const key of Object.keys(value)) if (key !== "frames" && key !== "resume") fail(`scenario unknown option: ${key}`);
  if (!Array.isArray(value.frames) || value.frames.length < 1 || value.frames.length > MAX_SCENARIO_FRAMES) fail(`scenario frames must be between 1 and ${MAX_SCENARIO_FRAMES}.`);
  if (value.resume !== undefined && typeof value.resume !== "boolean") fail("scenario resume must be a boolean.");
  let eventCount = 0;
  const frames = value.frames.map((frame, index) => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) fail(`scenario frame ${index} must be an object.`);
    for (const key of Object.keys(frame)) if (key !== "delta" && key !== "input" && key !== "observe" && key !== "snapshot") fail(`scenario frame ${index} unknown field: ${key}`);
    const delta = frame.delta === undefined ? null : frame.delta;
    if (delta !== null && (typeof delta !== "number" || !Number.isFinite(delta) || delta < 0 || delta > 1)) fail(`scenario frame ${index} delta must be a finite number between 0 and 1.`);
    const input = frame.input === undefined ? [] : frame.input;
    if (!Array.isArray(input) || input.length > MAX_SCENARIO_FRAME_EVENTS) fail(`scenario frame ${index} input can take at most ${MAX_SCENARIO_FRAME_EVENTS} events.`);
    eventCount += input.length;
    if (eventCount > MAX_SCENARIO_EVENTS) fail(`scenario total input can take at most ${MAX_SCENARIO_EVENTS} events.`);
    return { delta, input, observe: scenarioObserveOptions(frame.observe), snapshot: scenarioSnapshotOptions(frame.snapshot) };
  });
  return { frames, resume: value.resume !== false };
}

function snapshotHash(value) {
  let hash = 2_166_136_261;
  for (const character of JSON.stringify(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function sceneSnapshot(agent, root, rootHandle, options) {
  const entries = [];
  const stack = [{ node: root, parent: null, depth: 0 }];
  const visited = new Set();
  let total = 0;
  let truncated = false;
  while (stack.length) {
    const current = stack.pop();
    if (!isHandleable(current.node) || visited.has(current.node)) continue;
    visited.add(current.node);
    if (total >= MAX_SNAPSHOT_VISITED) { truncated = true; break; }
    const handle = agent.registerHandle(current.node);
    if (total >= options.offset && entries.length < options.limit) {
      const node = current.node;
      const record = { handle, parent: current.parent, type: objectType(node), children: 0 };
      const name = readDataProperty(node, "name");
      const id = readDataProperty(node, "id");
      if (typeof name === "string") record.name = name.slice(0, 128);
      if (typeof id === "string") record.id = id.slice(0, 128);
      const position = readDataProperty(node, "position");
      const scale = readDataProperty(node, "scale");
      const x = readDataProperty(position, "x");
      const y = readDataProperty(position, "y");
      const scaleX = readDataProperty(scale, "x");
      const scaleY = readDataProperty(scale, "y");
      if (Number.isFinite(x)) record.x = x;
      if (Number.isFinite(y)) record.y = y;
      if (Number.isFinite(scaleX)) record.scaleX = scaleX;
      if (Number.isFinite(scaleY)) record.scaleY = scaleY;
      for (const property of ["rotation", "zIndex", "alpha", "worldAlpha", "width", "height"]) {
        const propertyValue = readDataProperty(node, property);
        if (Number.isFinite(propertyValue)) record[property] = propertyValue;
      }
      for (const property of ["visible", "interactive", "isRenderable"]) {
        const propertyValue = readDataProperty(node, property);
        if (typeof propertyValue === "boolean") record[property] = propertyValue;
      }
      const children = readDataProperty(node, "children");
      record.children = Array.isArray(children) ? children.length : 0;
      entries.push(record);
    }
    total += 1;
    const children = readDataProperty(current.node, "children");
    if (!Array.isArray(children) || children.length === 0) continue;
    if (current.depth >= MAX_SNAPSHOT_DEPTH) { truncated = true; continue; }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (isHandleable(child)) stack.push({ node: child, parent: handle, depth: current.depth + 1 });
    }
  }
  const nextOffset = options.offset + entries.length < total && options.offset + entries.length < MAX_SNAPSHOT_VISITED
    ? options.offset + entries.length
    : null;
  const value = { root: rootHandle, offset: options.offset, limit: options.limit, total, nextOffset, truncated, nodes: entries };
  const hash = snapshotHash(value);
  const previousHash = agent.snapshotHashes.get(`${rootHandle}:${options.offset}:${options.limit}`) ?? null;
  agent.snapshotHashes.set(`${rootHandle}:${options.offset}:${options.limit}`, hash);
  return { type: "scene-snapshot", ...value, hash, changed: previousHash === null || previousHash !== hash, previousHash };
}

function createGridObservation({ width, height, columns, rows, pixels, flipY = false, format = "rgba8", previousHash }) {
  if (!ArrayBuffer.isView(pixels) || pixels.byteLength < columns * rows * 4) fail("Renderer observation readback data is invalid.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
  const data = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  const palette = " .:-=+*#%@";
  const isBgra = String(format).toLowerCase().startsWith("bgra");
  const grid = [];
  let hash = 2_166_136_261;
  let nonEmpty = 0;
  let lumaTotal = 0;
  for (let row = 0; row < rows; row += 1) {
    const sourceRow = flipY ? rows - row - 1 : row;
    let line = "";
    for (let column = 0; column < columns; column += 1) {
      const offset = (sourceRow * columns + column) * 4;
      const red = isBgra ? data[offset + 2] : data[offset];
      const green = data[offset + 1];
      const blue = isBgra ? data[offset] : data[offset + 2];
      const alpha = data[offset + 3];
      const luma = Math.round((red * 299 + green * 587 + blue * 114) / 1000);
      const visible = alpha >= 16;
      if (visible) nonEmpty += 1;
      lumaTotal += visible ? luma : 0;
      line += visible ? palette[Math.max(1, Math.min(palette.length - 1, Math.floor(luma * palette.length / 256)))] : " ";
      hash ^= red; hash = Math.imul(hash, 16_777_619);
      hash ^= green; hash = Math.imul(hash, 16_777_619);
      hash ^= blue; hash = Math.imul(hash, 16_777_619);
      hash ^= alpha; hash = Math.imul(hash, 16_777_619);
    }
    grid.push(line);
  }
  const frameHash = hash >>> 0;
  return {
    type: "canvas-grid",
    width,
    height,
    columns,
    rows,
    grid,
    hash: frameHash,
    changed: previousHash === null || previousHash !== frameHash,
    previousHash,
    nonEmpty,
    averageLuma: nonEmpty ? Math.round(lumaTotal / nonEmpty) : 0,
  };
}

/**
 * Creates a page-owned, bounded canvas observer for the MCP runtime channel.
 * It returns a coarse text grid rather than arbitrary image bytes, so text-only agents can inspect frames safely.
 */
export function createCanvasObserver(canvas, defaults = {}) {
  if (!canvas || typeof canvas !== "object" || !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) || canvas.width < 1 || canvas.height < 1) fail("Canvas observer requires a valid canvas.");
  const { columns: defaultColumns, rows: defaultRows } = observeDefaults(defaults);
  let previousHash = null;
  let observeQueue = Promise.resolve();
  return (options = {}) => {
    const run = observeQueue.then(() => observeCanvas(options));
    observeQueue = run.then(() => {}, () => {});
    return run;
  };

  async function observeCanvas(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) fail("Canvas observation options must be an object.");
    const columns = observeGridSize(options.columns, defaultColumns, "columns");
    const rows = observeGridSize(options.rows, defaultRows, "rows");
    if (columns * rows > MAX_OBSERVE_CELLS) fail("Canvas observation grid budget exceeded.");
    const surface = typeof globalThis.OffscreenCanvas === "function"
      ? new globalThis.OffscreenCanvas(columns, rows)
      : globalThis.document?.createElement?.("canvas");
    if (!surface) fail("Could not create a 2D surface for canvas observation.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
    surface.width = columns;
    surface.height = rows;
    const context = surface.getContext?.("2d", { willReadFrequently: true });
    if (!context?.drawImage || typeof context.getImageData !== "function") fail("No 2D readback is available for canvas observation.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
    let source = canvas;
    let bitmap = null;
    if (typeof globalThis.createImageBitmap === "function") {
      try {
        bitmap = await globalThis.createImageBitmap(canvas);
        source = bitmap;
      } catch {
        // Some canvas backends do not expose an ImageBitmap snapshot; try the canvas directly.
      }
    }
    try { context.drawImage(source, 0, 0, columns, rows); } finally { bitmap?.close?.(); }
    const observation = createGridObservation({ width: canvas.width, height: canvas.height, columns, rows, pixels: context.getImageData(0, 0, columns, rows).data, previousHash });
    previousHash = observation.hash;
    return observation;
  }
}

/**
 * Creates an observer backed by ExiEngine's bounded offscreen render-target readback.
 * This is the preferred observer for WebGPU/WebGL pages because swapchain canvas readback is not portable.
 */
export function createEngineObserver(engine, defaults = {}) {
  if (!engine || typeof engine.captureFrame !== "function") fail("Engine observer requires an ExiEngine that supports captureFrame.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
  const { columns: defaultColumns, rows: defaultRows } = observeDefaults(defaults);
  let previousHash = null;
  let observeQueue = Promise.resolve();
  return (options = {}) => {
    const run = observeQueue.then(() => observeEngine(options));
    observeQueue = run.then(() => {}, () => {});
    return run;
  };

  async function observeEngine(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) fail("Engine observation options must be an object.");
    const columns = observeGridSize(options.columns, defaultColumns, "columns");
    const rows = observeGridSize(options.rows, defaultRows, "rows");
    if (columns * rows > MAX_OBSERVE_CELLS) fail("Engine observation grid budget exceeded.");
    const frame = await engine.captureFrame({ columns, rows });
    const observation = createGridObservation({
      width: Number(frame?.width) || columns,
      height: Number(frame?.height) || rows,
      columns,
      rows,
      pixels: frame?.pixels,
      flipY: frame?.flipY === true,
      format: frame?.format,
      previousHash,
    });
    previousHash = observation.hash;
    return observation;
  }
}

function serializeTypedArray(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const sample = value instanceof DataView ? bytes.slice(0, 16) : value.slice(0, 16);
  const result = {
    type: objectType(value),
    length: Number.isSafeInteger(value.length) ? value.length : null,
    byteLength: bytes.byteLength,
    sample: Array.from(sample, (item) => typeof item === "bigint" ? String(item) : item),
  };
  result.bytes = bytes.byteLength <= MAX_INLINE_BINARY_BYTES
    ? { $bytes: encodeBase64(bytes) }
    : { truncated: true, maxInlineBytes: MAX_INLINE_BINARY_BYTES };
  return result;
}

function decodeBytes(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 1 || !Object.hasOwn(value, "$bytes")) return null;
  if (Array.isArray(value.$bytes)) return Uint8Array.from(value.$bytes);
  return Uint8Array.from(atob(value.$bytes), (character) => character.charCodeAt(0));
}

function resolveBatchPath(value, resultPath) {
  if (typeof resultPath !== "string" || !resultPath || resultPath.length > 128) fail("Runtime batch result path is invalid.");
  const segments = resultPath.split(".");
  if (segments.some((segment) => !segment || segment.startsWith("_") || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail("Runtime batch result path must be a safe property path.");
  let current = value;
  for (const segment of segments) {
    if (current === null || (typeof current !== "object" && typeof current !== "function") || !Object.hasOwn(current, segment)) fail(`Runtime batch result property not found: ${resultPath}.`);
    current = current[segment];
  }
  return current;
}

function resolveBatchReferences(value, results, depth = 0, key = "") {
  if (depth > MAX_DEPTH) fail("Runtime batch reference depth exceeded.");
  if (Array.isArray(value)) {
    if (value.length > MAX_ITEMS) fail("Runtime batch array limit exceeded.");
    return value.map((item) => resolveBatchReferences(item, results, depth + 1));
  }
  if (!value || typeof value !== "object") return value;
  const referenceKeys = Object.keys(value);
  const hasResultReference = Number.isSafeInteger(value.$result) && (referenceKeys.length === 1 || (referenceKeys.length === 2 && referenceKeys.includes("$path")));
  if (hasResultReference) {
    const reference = results[value.$result];
    if (!reference || !reference.ok) fail(`Runtime batch result reference is invalid: ${value.$result}.`);
    const result = Object.hasOwn(value, "$path") ? resolveBatchPath(reference.value, value.$path) : reference.value;
    if (result && typeof result === "object" && typeof result.$handle === "string") return key === "handle" ? result.$handle : { $handle: result.$handle };
    return result;
  }
  if (referenceKeys.length > MAX_KEYS) fail("Runtime batch object field limit exceeded.");
  const resolved = {};
  for (const property of referenceKeys) {
    if (forbiddenKeys.has(property)) fail(`Unsafe runtime batch field: ${property}`);
    resolved[property] = resolveBatchReferences(value[property], results, depth + 1, property);
  }
  return resolved;
}

function raceWithTimeout(promise, timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return Promise.resolve(promise);
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try { fail(`Runtime command timed out: ${timeoutMs} ms.`, "EXI_RUNTIME_COMMAND_TIMEOUT"); } catch (error) { reject(error); }
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => { clearTimeout(timer); });
}

export class RuntimeAgent {
  constructor({ api, roots = {}, callbacks = {}, observe = null, token = "", baseUrl = "", pollMs = 100, executeTimeoutMs = 10_000, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    if (!api || typeof api !== "object") throw new TypeError("RuntimeAgent api object is required.");
    if (typeof fetchImpl !== "function") throw new TypeError("RuntimeAgent fetch is required.");
    if (!callbacks || typeof callbacks !== "object" || Array.isArray(callbacks)) throw new TypeError("RuntimeAgent callbacks object is required.");
    if (observe !== null && typeof observe !== "function") throw new TypeError("RuntimeAgent observe function is required.");
    this.api = api;
    this.token = typeof token === "string" ? token : "";
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.pollMs = Number.isFinite(Number(pollMs)) ? Math.min(2_000, Math.max(25, Number(pollMs))) : 100;
    this.executeTimeoutMs = Number.isSafeInteger(Number(executeTimeoutMs)) ? Math.min(60_000, Math.max(250, Number(executeTimeoutMs))) : 10_000;
    this.fetch = fetchImpl;
    this.handles = new Map();
    this.objectHandles = new WeakMap();
    this.callbacks = new Map();
    this.observe = observe;
    this.snapshotHashes = new Map();
    this.protectedHandles = new Set();
    this.nextHandleId = 1;
    this.timer = null;
    this.running = false;
    // Explicit poll phase machine (idle → armed → polling); pollEpoch remains the abort-identity guard.
    this.pollMachine = new StateMachine({ name: "runtimeAgentPoll", initial: "idle", states: POLL_STATES });
    this.pollEpoch = 0;
    this.controller = null;
    for (const [name, callback] of Object.entries(callbacks)) this.registerCallback(name, callback);
    for (const [handle, value] of Object.entries(roots)) this.registerHandle(value, handle, true);
  }

  registerCallback(name, callback) {
    assertPublicName(name, "callback");
    if (typeof callback !== "function") fail(`Runtime callback function is required: ${name}`);
    if (!this.callbacks.has(name) && this.callbacks.size >= MAX_CALLBACKS) fail("Runtime callback limit exceeded.", "EXI_RUNTIME_CALLBACK_LIMIT");
    this.callbacks.set(name, callback);
    return this;
  }

  requireCallback(name) {
    assertPublicName(name, "callback");
    const callback = this.callbacks.get(name);
    if (!callback) fail(`Runtime callback not found: ${name}`, "EXI_RUNTIME_CALLBACK");
    return callback;
  }

  endpoint(path) {
    return `${this.baseUrl}${path}`;
  }

  get polling() { return this.pollMachine.state === "polling"; }

  start() {
    if (this.running || !this.token) return this;
    this.running = true;
    if (this.pollMachine.state !== "polling") this.pollMachine.send("start");
    this.schedule();
    return this;
  }

  stop() {
    this.running = false;
    this.pollEpoch += 1;
    if (this.pollMachine.state !== "idle") this.pollMachine.send("stop");
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort?.();
    this.controller = null;
    this.snapshotHashes.clear();
    return this;
  }

  schedule() {
    if (!this.running || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().finally(() => this.schedule());
    }, this.pollMs);
  }

  async poll() {
    if (!this.running || this.polling || this.controller) return;
    const epoch = ++this.pollEpoch;
    this.pollMachine.send("fire");
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    this.controller = controller;
    const signal = controller?.signal;
    try {
      let response;
      try {
        response = await this.fetch(this.endpoint("/__exi/runtime-command"), { headers: { "x-exi-runtime-token": this.token, accept: "application/json" }, cache: "no-store", signal });
      } catch {
        return;
      }
      if (!response.ok) return;
      let payload;
      try { payload = await response.json(); } catch { return; }
      if (!Array.isArray(payload?.commands)) return;
      for (const command of payload.commands) {
        if (!this.running) return;
        let result;
        try { result = { id: command.id, ok: true, value: await raceWithTimeout(this.execute(command), this.executeTimeoutMs) }; }
        catch (error) { result = { id: command?.id, ok: false, error: { message: error instanceof Error ? error.message : String(error), code: error?.code || "EXI_RUNTIME_ERROR" } }; }
        if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_RESULT_BYTES) result = { id: command?.id, ok: false, error: { message: "Runtime result size limit exceeded.", code: "EXI_RUNTIME_OUTPUT_LIMIT" } };
        try {
          await this.fetch(this.endpoint("/__exi/runtime-result"), { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": this.token }, body: JSON.stringify(result), keepalive: true, signal });
        } catch { /* the MCP caller will time out if the preview has gone away */ }
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      if (this.pollEpoch === epoch && this.pollMachine.state === "polling") this.pollMachine.send("settle");
    }
  }

  registerHandle(value, preferredHandle = null, protectedValue = false) {
    if (!isHandleable(value)) return null;
    const existing = this.objectHandles.get(value);
    if (existing && this.handles.has(existing)) {
      if (protectedValue) this.protectedHandles.add(existing);
      return existing;
    }
    if (this.handles.size >= MAX_HANDLES) fail("Active runtime handle limit exceeded.", "EXI_RUNTIME_HANDLE_LIMIT");
    const handle = preferredHandle || `h${this.nextHandleId++}`;
    if (typeof handle !== "string" || !/^([A-Za-z][A-Za-z0-9_-]{0,127})$/.test(handle) || this.handles.has(handle)) fail("Runtime handle is invalid.");
    this.handles.set(handle, value);
    this.objectHandles.set(value, handle);
    if (protectedValue) this.protectedHandles.add(handle);
    return handle;
  }

  requireHandle(handle) {
    if (typeof handle !== "string" || !/^(?:[A-Za-z][A-Za-z0-9_-]{0,127})$/.test(handle) || !this.handles.has(handle)) fail(`Runtime handle not found: ${handle}`);
    return this.handles.get(handle);
  }

  resolveArgument(value, depth = 0) {
    if (depth > MAX_DEPTH) fail("Runtime argument depth exceeded.");
    if (Array.isArray(value)) return value.map((item) => this.resolveArgument(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    const bytes = decodeBytes(value);
    if (bytes) return bytes;
    if (Object.keys(value).length === 1 && typeof value.$callback === "string") return this.requireCallback(value.$callback);
    if (Object.keys(value).length === 1 && typeof value.$handle === "string") return this.requireHandle(value.$handle);
    const resolved = {};
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) fail(`Unsafe runtime argument field: ${key}`);
      resolved[key] = this.resolveArgument(item, depth + 1);
    }
    return resolved;
  }

  resolveArgs(args) {
    if (args === undefined) return [];
    if (!Array.isArray(args)) fail("Runtime args must be an array.");
    return args.map((item) => this.resolveArgument(item));
  }

  resolveExportPath(value) {
    const segments = assertPublicPath(value);
    let current = isAgentCallableExport(segments[0]) ? this.api[segments[0]] : undefined;
    if (current === undefined) fail(`Public export not found: ${value}`);
    let parent = null;
    for (const segment of segments.slice(1)) {
      if ((current === null || (typeof current !== "object" && typeof current !== "function")) || !Object.hasOwn(current, segment)) fail(`Public export path not found: ${value}`);
      parent = current;
      current = current[segment];
    }
    return { value: current, parent };
  }

  getPublicMethod(object, method) {
    assertPublicName(method, "method");
    // Callback-valued instance fields are application code, not engine methods.
    let prototype = Object.getPrototypeOf(object);
    while (prototype && prototype !== Object.prototype) {
      const ownerName = prototype.constructor?.name;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      if (descriptor) {
        if (!isPublicMethod(ownerName, method)) fail(`Not a public method: ${method}`);
        if (typeof descriptor.value !== "function") fail(`Not a public method: ${method}`);
        return descriptor.value;
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    fail(`Runtime method not found: ${method}`);
  }

  getPublicStaticMethod(Constructor, method) {
    assertPublicName(method, "method");
    const descriptor = Object.getOwnPropertyDescriptor(Constructor, method);
    if (!descriptor || typeof descriptor.value !== "function") fail(`Static method not found: ${Constructor.name}.${method}`);
    return descriptor.value;
  }

  getPublicProperty(object, property) {
    assertPublicName(property, "property");
    let prototype = object;
    while (prototype && prototype !== Object.prototype) {
      if (Object.getOwnPropertyDescriptor(prototype, property)) return object[property];
      prototype = Object.getPrototypeOf(prototype);
    }
    fail(`Runtime property not found: ${property}`);
  }

  inspectHandle(object, handle) {
    const methods = new Set();
    const properties = new Map();
    let target = object;
    while (target && target !== Object.prototype) {
      const ownerName = target.constructor?.name;
      for (const name of Object.getOwnPropertyNames(target)) {
        if (name === "constructor" || !isPublicMethod(ownerName, name) || forbiddenKeys.has(name) || methods.has(name) || properties.has(name)) continue;
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (!descriptor) continue;
        if (typeof descriptor.value === "function") {
          if (target === object) continue;
          methods.add(name);
        }
        else properties.set(name, { name, kind: "value" in descriptor ? typeof descriptor.value : "accessor", readable: "value" in descriptor || typeof descriptor.get === "function", writable: "value" in descriptor ? descriptor.writable === true : typeof descriptor.set === "function" });
      }
      target = Object.getPrototypeOf(target);
    }
    return { handle, type: objectType(object), methods: [...methods].sort(), properties: [...properties.values()].sort((left, right) => left.name.localeCompare(right.name)), callbacks: [...this.callbacks.keys()].sort() };
  }

  async executeBatch(command) {
    if (!Array.isArray(command.calls) || command.calls.length === 0 || command.calls.length > MAX_BATCH_CALLS) fail("Runtime batch calls must be between 1 and 8.", "EXI_RUNTIME_BATCH_LIMIT");
    if (command.stopOnError !== undefined && typeof command.stopOnError !== "boolean") fail("Runtime batch stopOnError must be a boolean.");
    const stopOnError = command.stopOnError !== false;
    const results = [];
    for (let index = 0; index < command.calls.length; index += 1) {
      try {
        const call = resolveBatchReferences(command.calls[index], results);
        if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.operation !== "string" || !call.operation || call.operation === "batch") fail(`Runtime batch call ${index} is invalid.`);
        const value = await this.execute(call);
        results.push({ index, ok: true, value });
      } catch (error) {
        results.push({ index, ok: false, error: { message: error instanceof Error ? error.message : String(error), code: error?.code || "EXI_RUNTIME_BATCH_ERROR" } });
        if (stopOnError) break;
      }
    }
    return { completed: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length, stopped: results.length < command.calls.length, results };
  }

  async executeScenario(command, args) {
    if (args.length > 1) fail("scenario accepts at most one options argument.");
    const options = scenarioOptions(args[0]);
    const engineHandle = command.handle === undefined ? "engine" : command.handle;
    const engine = this.requireHandle(engineHandle);
    const input = readDataProperty(engine, "input");
    const scene = readDataProperty(engine, "scene");
    if (!input || typeof input !== "object" || typeof readDataProperty(input, "inject") !== "function") fail("scenario: engine.input does not support inject.", "EXI_RUNTIME_SCENARIO_UNAVAILABLE");
    if (!scene || !isHandleable(scene)) fail("scenario: engine.scene is not supported.", "EXI_RUNTIME_SCENARIO_UNAVAILABLE");
    const stop = this.getPublicMethod(engine, "stop");
    const step = this.getPublicMethod(engine, "step");
    const inject = this.getPublicMethod(input, "inject");
    const start = this.getPublicMethod(engine, "start");
    const wasRunning = readDataProperty(engine, "running") === true;
    const fixedStep = Number.isFinite(readDataProperty(engine, "fixedStep")) ? readDataProperty(engine, "fixedStep") : 1 / 60;
    const sceneHandle = this.objectHandles.get(scene) || this.registerHandle(scene);
    const frames = [];
    let resumed = false;
    let scenarioError = null;
    let resumeError = null;
    try {
      stop.call(engine);
      for (let index = 0; index < options.frames.length; index += 1) {
        const frame = options.frames[index];
        if (frame.input.length > 0) inject.call(input, frame.input);
        const delta = frame.delta === null ? fixedStep : frame.delta;
        step.call(engine, delta);
        const result = { index, delta, inputEvents: frame.input.length };
        if (frame.observe !== null) {
          if (!this.observe) fail("scenario observe is not configured on this RuntimeAgent page.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
          result.observe = await this.observe(frame.observe);
        }
        if (frame.snapshot !== null) result.snapshot = sceneSnapshot(this, scene, sceneHandle, frame.snapshot);
        frames.push(result);
      }
    } catch (error) {
      // Scenario hatasını sakla; resume hatası onun maskelemesin (#101).
      scenarioError = error;
    } finally {
      if (wasRunning && options.resume) {
        try {
          start.call(engine);
          resumed = true;
        } catch (error) {
          resumed = false;
          resumeError = error;
        }
      }
    }
    if (scenarioError) throw scenarioError;
    if (resumeError) throw resumeError;
    return { type: "runtime-scenario", handle: engineHandle, frames, frameCount: frames.length, wasRunning, resumed };
  }

  serializeScenario(value) {
    const result = { type: "runtime-scenario", handle: value.handle, frameCount: value.frameCount, wasRunning: value.wasRunning === true, resumed: value.resumed === true, frames: [] };
    for (const frame of Array.isArray(value.frames) ? value.frames.slice(0, MAX_SCENARIO_FRAMES) : []) {
      const output = { index: frame.index, delta: frame.delta, inputEvents: frame.inputEvents };
      if (frame.observe !== undefined) output.observe = this.serialize(frame.observe, 0);
      if (frame.snapshot !== undefined) output.snapshot = this.serialize(frame.snapshot, 0);
      result.frames.push(output);
    }
    return result;
  }

  serialize(value, depth = 0, seen = new Set()) {
    if (value === undefined) return null;
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function") return { type: "function" };
    if (depth === 0 && value?.type === "runtime-scenario") return this.serializeScenario(value);
    const knownHandle = this.objectHandles.get(value);
    if (knownHandle && this.handles.has(knownHandle)) return { $handle: knownHandle, type: objectType(value) };
    if (depth >= MAX_OUTPUT_DEPTH) return { type: objectType(value) };
    if (isHandleable(value)) return { $handle: this.registerHandle(value), type: objectType(value) };
    if (seen.has(value)) return { type: "circular" };
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, MAX_OUTPUT_ITEMS).map((item) => this.serialize(item, depth + 1, seen));
    if (ArrayBuffer.isView(value)) return serializeTypedArray(value);
    if (value instanceof Map) return { type: "Map", size: value.size };
    if (value instanceof Set) return { type: "Set", size: value.size };
    const result = { type: objectType(value) };
    for (const key of Object.keys(value).slice(0, 32)) {
      if (forbiddenKeys.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) result[key] = this.serialize(descriptor.value, depth + 1, seen);
    }
    return result;
  }

  async execute(command) {
    assertSafeData(command);
    if (command.operation === "batch") return this.executeBatch(command);
    const args = this.resolveArgs(command.args);
    if (command.operation === "observe") {
      if (!this.observe) fail("Canvas observe is not configured on this RuntimeAgent page.", "EXI_RUNTIME_OBSERVE_UNAVAILABLE");
      if (args.length > 1) fail("observe accepts at most one options argument.");
      return this.serialize(await this.observe(args[0]));
    }
    if (command.operation === "snapshot") {
      if (args.length > 1) fail("snapshot accepts at most one options argument.");
      const rootHandle = command.handle === undefined ? "scene" : command.handle;
      return this.serialize(sceneSnapshot(this, this.requireHandle(rootHandle), rootHandle, snapshotOptions(args[0])));
    }
    if (command.operation === "scenario") return this.serialize(await this.executeScenario(command, args));
    if (command.operation === "function") {
      const functionName = assertPublicName(command.name, "name");
      const fn = isAgentCallableExport(functionName) ? this.api[functionName] : undefined;
      if (typeof fn !== "function" || isClass(fn)) fail(`Public function not found: ${command.name}`);
      return this.serialize(await fn(...args));
    }
    if (command.operation === "create") {
      const Constructor = this.api[assertPublicName(command.type, "type")];
      if (!isClass(Constructor)) fail(`Public class not found: ${command.type}`);
      return this.serialize(new Constructor(...args));
    }
    if (command.operation === "export_get") return this.serialize(this.resolveExportPath(command.path).value);
    if (command.operation === "export_call") {
      const resolved = this.resolveExportPath(command.path);
      if (typeof resolved.value !== "function") fail(`Public export is not a function: ${command.path}`);
      return this.serialize(await resolved.value.apply(resolved.parent, args));
    }
    if (command.operation === "static_call") {
      const Constructor = this.api[assertPublicName(command.type, "type")];
      if (!isClass(Constructor)) fail(`Static method not found: ${command.type}.${command.method}`);
      return this.serialize(await this.getPublicStaticMethod(Constructor, command.method).apply(Constructor, args));
    }
    if (command.operation === "call") {
      const object = this.requireHandle(command.handle);
      return this.serialize(await this.getPublicMethod(object, command.method).apply(object, args));
    }
    if (command.operation === "inspect") return this.inspectHandle(this.requireHandle(command.handle), command.handle);
    if (command.operation === "get") return this.serialize(this.getPublicProperty(this.requireHandle(command.handle), command.property));
    if (command.operation === "set") {
      const object = this.requireHandle(command.handle);
      const property = assertPublicName(command.property, "property");
      let target = object;
      let descriptor = null;
      while (target && target !== Object.prototype && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(target, property);
        target = Object.getPrototypeOf(target);
      }
      if (!descriptor || typeof descriptor.value === "function" || ("value" in descriptor && descriptor.writable !== true) || (!("value" in descriptor) && typeof descriptor.set !== "function")) fail(`Runtime property is not writable: ${property}`);
      const current = object[property];
      if (Array.isArray(current) || current instanceof Map || current instanceof Set) fail(`Collection property cannot be written directly: ${property}`);
      const next = this.resolveArgument(command.value);
      if (current && typeof current === "object" && next && typeof next === "object" && !this.objectHandles.has(next)) fail(`Object property must be changed through a handle: ${property}`);
      object[property] = next;
      return { handle: command.handle, property, value: this.serialize(object[property]) };
    }
    if (command.operation === "release") {
      const object = this.requireHandle(command.handle);
      if (this.protectedHandles.has(command.handle)) fail(`Runtime root handle cannot be released: ${command.handle}`, "EXI_RUNTIME_ROOT_HANDLE");
      if (typeof object.destroy === "function") object.destroy();
      this.handles.delete(command.handle);
      this.objectHandles.delete(object);
      for (const key of [...this.snapshotHashes.keys()]) {
        if (key.startsWith(`${command.handle}:`)) this.snapshotHashes.delete(key);
      }
      return { released: command.handle };
    }
    fail(`Unknown runtime operation: ${command.operation}`);
  }
}
