// ExiEngine browser editor.
// The edited scene is a live ExiEngine scene. Every committed edit goes through
// serializeScene -> change one option -> deserializeScene, so validation is done
// by the engine itself, undo/redo is a list of documents, and what you save is
// exactly what deserializeScene() loads in a game. Drags and tile painting edit
// the live nodes directly and are committed when the pointer is released.
import {
  Camera, ExiEngine, FILTER_TYPES, MAX_PREFABS, Graphics, NineSliceSprite, Node, Scene, Sprite, Text, Texture, TileMap,
  SCENE_FORMAT, SCENE_FORMAT_VERSION, deserializeScene, getAABB, serializeScene,
  KEYFRAME_PROPERTIES, applyKeyframes, describeBehaviors, normalizeBehavior, normalizeBehaviors,
} from "../src/index.js";
import { AUTOSAVE_KEY, BUILTIN_TILES_ID, EDITOR_CHANNEL, createBuiltinTiles } from "./shared.js";

const MAX_HISTORY = 100;
const $ = (selector) => document.querySelector(selector);
// ExiEngine replaces its canvas when an automatic WebGPU -> WebGL2 fallback
// happens, so DOM listeners live on the stable .viewport container and the
// current canvas is always read from the engine.
const viewportElement = $(".viewport");
let engine = null;
const currentCanvas = () => engine?.canvas || $("#editor-canvas");
const statusNode = $("#status");
const treeNode = $("#tree");
const texturesNode = $("#textures");
const inspector = $("#inspector");

// ---------------------------------------------------------------- textures
const textures = new Map();
let missingTextures = [];

textures.set(BUILTIN_TILES_ID, createBuiltinTiles());

async function importTextures(files) {
  for (const file of files) {
    try {
      const bitmap = await createImageBitmap(file);
      const id = file.name.slice(0, 200);
      const previous = textures.get(id);
      textures.set(id, new Texture({ id, source: bitmap, filter: "nearest" }));
      previous?.destroy?.();
    } catch (error) {
      setStatus(`Could not import ${file.name}: ${error.message}`, true);
    }
  }
  broadcastTextures();
  // Rebuild so nodes that referenced a missing id pick up the real texture.
  rebuildFrom(snapshot());
  renderTextures();
  setStatus(`Imported ${files.length} texture(s).`);
}

// Asset browser: a thumbnail per texture with its size and how many nodes use
// it. Click assigns it to the selected Sprite / Panel / TileMap, dragging it
// into the view creates a Sprite there, × removes an unused imported texture.
function textureUsage() {
  const counts = new Map();
  const visit = (entry) => {
    const id = entry?.options?.texture;
    if (typeof id === "string") counts.set(id, (counts.get(id) || 0) + 1);
    for (const child of entry?.children || []) visit(child);
  };
  visit(snapshot().root);
  return counts;
}

function thumbnail(texture) {
  const canvas = document.createElement("canvas");
  canvas.width = 32; canvas.height = 32;
  canvas.className = "thumb";
  const source = texture?.source;
  const context = canvas.getContext("2d");
  if (source && context) {
    const scale = Math.min(32 / Math.max(1, texture.sourceWidth), 32 / Math.max(1, texture.sourceHeight));
    const width = texture.sourceWidth * scale; const height = texture.sourceHeight * scale;
    try { context.imageSmoothingEnabled = false; context.drawImage(source, (32 - width) / 2, (32 - height) / 2, width, height); } catch { /* not drawable */ }
  }
  return canvas;
}

function assignTexture(id) {
  const node = selection ? nodeAt(selection) : null;
  if (!(node instanceof Sprite || node instanceof TileMap)) { setStatus("Select a Sprite, Panel or TileMap to assign a texture, or drag the texture into the view.", true); return; }
  setOption("texture", id, `Texture ${id}`);
}

function removeTexture(id) {
  if (id === BUILTIN_TILES_ID || (textureUsage().get(id) || 0) > 0) return;
  textures.get(id)?.destroy?.();
  textures.delete(id);
  renderTextures();
  setStatus(`Removed texture ${id}`);
}

function renderTextures() {
  texturesNode.replaceChildren();
  const usage = textureUsage();
  const ids = new Set([...textures.keys(), ...missingTextures]);
  for (const id of ids) {
    const item = document.createElement("li");
    const texture = textures.get(id);
    item.className = "asset";
    item.title = texture ? "Click: use on the selected node · drag into the view: new sprite" : "Missing: import an image with this file name";
    item.draggable = Boolean(texture);
    item.dataset.texture = id;
    const name = Object.assign(document.createElement("span"), { className: "asset-name", textContent: id });
    const info = Object.assign(document.createElement("span"), { className: "asset-info", textContent: texture ? `${texture.sourceWidth}×${texture.sourceHeight} · ${usage.get(id) || 0} use(s)` : "missing" });
    const text = document.createElement("span");
    text.className = "asset-text";
    text.append(name, info);
    item.append(thumbnail(texture), text);
    if (!texture) item.classList.add("missing");
    if (texture && id !== BUILTIN_TILES_ID && !usage.get(id)) {
      const remove = Object.assign(document.createElement("button"), { type: "button", className: "asset-remove", textContent: "×", title: "Remove this unused texture" });
      remove.addEventListener("click", (event) => { event.stopPropagation(); removeTexture(id); });
      item.append(remove);
    }
    if (texture) {
      item.addEventListener("click", () => assignTexture(id));
      item.addEventListener("dragstart", (event) => { event.dataTransfer.setData("text/exi-texture", id); event.dataTransfer.effectAllowed = "copy"; });
    }
    texturesNode.append(item);
  }
}

// ---------------------------------------------------------------- scene + history
const world = new Scene({ name: "editor-world" });
const grid = new Graphics({ name: "editor-grid", zIndex: -1_000_000 });
const gizmo = new Graphics({ name: "editor-gizmo", zIndex: 1_000_000 });
let docRoot = new Scene({ name: "scene" });
world.add(grid, docRoot, gizmo);

let selection = null; // child-index path from docRoot, [] = root
let history = [];
let future = [];

function setStatus(message, error = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", error);
}

function nodeAt(path) {
  let node = docRoot;
  for (const index of path || []) {
    node = node?.children[index];
    if (!node) return null;
  }
  return node;
}

function entryAt(document, path) {
  let entry = document.root;
  for (const index of path) entry = entry.children[index];
  return entry;
}

function pathOf(node) {
  const path = [];
  while (node && node !== docRoot) {
    const parent = node.parent;
    if (!parent) return null;
    path.unshift(parent.children.indexOf(node));
    node = parent;
  }
  return node === docRoot ? path : null;
}

function swapRoot(next) {
  world.remove(docRoot);
  docRoot.destroy();
  docRoot = next;
  world.add(docRoot);
}

// Prefab definitions live next to the scene root in the document.
let prefabs = {};
function snapshot() { return serializeScene(docRoot, { prefabs }); }

function rebuildFrom(document) {
  prefabs = document.prefabs ? JSON.parse(JSON.stringify(document.prefabs)) : {};
  const report = {};
  const next = deserializeScene(document, { textures, report });
  missingTextures = report.missingTextures;
  swapRoot(next);
  if (selection && !nodeAt(selection)) selection = null;
  return next;
}

function commit(label) {
  const json = JSON.stringify(snapshot());
  if (history.at(-1) === json) return;
  history.push(json);
  if (history.length > MAX_HISTORY) history.shift();
  future = [];
  try { localStorage.setItem(AUTOSAVE_KEY, json); } catch { /* storage is a convenience only */ }
  broadcastScene(json);
  refreshUi();
  if (label) setStatus(label);
}

// Live link to Play windows and games that use watchScene({ channel: EDITOR_CHANNEL }).
const liveChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(EDITOR_CHANNEL) : null;
function broadcastScene(json = JSON.stringify(snapshot())) {
  liveChannel?.postMessage({ type: "exi-scene", name: docRoot.name, document: JSON.parse(json) });
}
function broadcastTextures() {
  if (!liveChannel) return;
  const items = [];
  for (const [id, texture] of textures) if (id !== BUILTIN_TILES_ID && texture.source && typeof ImageBitmap === "function" && texture.source instanceof ImageBitmap) items.push({ id, bitmap: texture.source });
  if (!items.length) return;
  try { liveChannel.postMessage({ type: "exi-textures", items }); } catch { /* bitmaps that cannot be cloned stay placeholders */ }
}
if (liveChannel) {
  liveChannel.onmessage = (event) => {
    if (event.data?.type !== "exi-play-hello") return;
    broadcastTextures();
    broadcastScene();
  };
}

function applyDocument(mutate, label) {
  const document = snapshot();
  try {
    const result = mutate(document);
    rebuildFrom(document);
    if (result && result.select !== undefined) selection = result.select;
    commit(label);
    return true;
  } catch (error) {
    setStatus(error.message, true);
    refreshUi();
    return false;
  }
}

function undo() {
  if (history.length < 2) return;
  future.push(history.pop());
  rebuildFrom(JSON.parse(history.at(-1)));
  refreshUi();
  setStatus("Undo");
}

function redo() {
  const json = future.pop();
  if (!json) return;
  history.push(json);
  rebuildFrom(JSON.parse(json));
  refreshUi();
  setStatus("Redo");
}

// ---------------------------------------------------------------- creating nodes
function selectedContainerPath() {
  if (!selection) return [];
  const node = nodeAt(selection);
  // Plain Node/Scene groups receive children; anything else gets a sibling.
  if (node && (Object.getPrototypeOf(node) === Node.prototype || Object.getPrototypeOf(node) === Scene.prototype)) return selection;
  return selection.slice(0, -1);
}

function newEntry(kind) {
  const center = camera.position;
  const x = Math.round(center.x);
  const y = Math.round(center.y);
  switch (kind) {
    case "Node": return { type: "Node", options: { name: "group", x, y } };
    case "Sprite": return { type: "Sprite", options: { name: "sprite", x, y, width: 64, height: 64, tint: 0x5eead4 } };
    case "Rect": return { type: "Graphics", options: { name: "rect", x, y, commands: [{ type: "rect", x: -32, y: -32, width: 64, height: 64, fill: 0x60a5fa, alpha: 1 }] } };
    case "Circle": return { type: "Graphics", options: { name: "circle", x, y, commands: [{ type: "circle", x: 0, y: 0, radius: 32, fill: 0xf472b6, alpha: 1 }] } };
    case "Text": return { type: "Text", options: { name: "text", x, y, text: "Text", font: "24px system-ui, sans-serif", fill: "#ffffff", resolution: 2 } };
    case "NineSliceSprite": return { type: "NineSliceSprite", options: { name: "panel", x, y, width: 160, height: 96, tint: 0x334155, left: 8, right: 8, top: 8, bottom: 8 } };
    case "TileMap": return { type: "TileMap", options: { name: "tilemap", x: x - 256, y: y - 160, texture: BUILTIN_TILES_ID, tileWidth: 32, tileHeight: 32, columns: 16, rows: 10, tiles: new Array(160).fill(-1) } };
    default: throw new Error(`Unknown node kind: ${kind}`);
  }
}

function addNode(kind) {
  const parentPath = selectedContainerPath();
  applyDocument((document) => {
    const parent = entryAt(document, parentPath);
    parent.children = parent.children || [];
    parent.children.push(newEntry(kind));
    return { select: [...parentPath, parent.children.length - 1] };
  }, `Added ${kind}`);
}

function deleteSelected() {
  if (!selection || selection.length === 0) return;
  const path = selection;
  applyDocument((document) => {
    const parent = entryAt(document, path.slice(0, -1));
    parent.children.splice(path.at(-1), 1);
    if (parent.children.length === 0) delete parent.children;
    return { select: null };
  }, "Deleted");
}

function duplicateSelected() {
  if (!selection || selection.length === 0) return;
  const path = selection;
  applyDocument((document) => {
    const parent = entryAt(document, path.slice(0, -1));
    const copy = JSON.parse(JSON.stringify(parent.children[path.at(-1)]));
    copy.options = copy.options || {};
    copy.options.x = (copy.options.x || 0) + gridSize();
    copy.options.y = (copy.options.y || 0) + gridSize();
    if (copy.options.name) copy.options.name = `${copy.options.name} copy`.slice(0, 256);
    parent.children.splice(path.at(-1) + 1, 0, copy);
    return { select: [...path.slice(0, -1), path.at(-1) + 1] };
  }, "Duplicated");
}

function setOption(key, value, label = `Set ${key}`) {
  if (!selection) return false;
  const path = selection;
  return applyDocument((document) => {
    const entry = entryAt(document, path);
    entry.options = entry.options || {};
    if (value === undefined) delete entry.options[key];
    else entry.options[key] = value;
  }, label);
}

// Adds a sprite with a texture at a world point (asset drag and drop).
function addSpriteAt(id, x, y) {
  const texture = textures.get(id);
  const scale = texture ? Math.min(1, 256 / Math.max(texture.sourceWidth, texture.sourceHeight)) : 1;
  const parentPath = selectedContainerPath();
  return applyDocument((document) => {
    const parent = entryAt(document, parentPath);
    parent.children = parent.children || [];
    parent.children.push({ type: "Sprite", options: { name: id.replace(/\.[a-z0-9]+$/i, "").slice(0, 64) || "sprite", texture: id, x: Math.round(x), y: Math.round(y), width: Math.round((texture?.sourceWidth || 64) * scale), height: Math.round((texture?.sourceHeight || 64) * scale) } });
    return { select: [...parentPath, parent.children.length - 1] };
  }, `Added sprite ${id}`);
}

// ---------------------------------------------------------------- behaviours + timeline
// Behaviours are plain JSON in node.data.behaviors (see src/core/behaviors.js);
// the Play window and games run them with BehaviorSystem.
const BEHAVIOR_SPECS = describeBehaviors();
const timeline = { time: 0, playing: false, tracks: new Set(["x", "y", "rotation"]), autoKey: true, slider: null, readout: null };

function behaviorsOf(node) { return Array.isArray(node?.data?.behaviors) ? node.data.behaviors : []; }
function keyframesIndex(node) { return behaviorsOf(node).findIndex((behavior) => behavior?.type === "keyframes"); }

function setBehaviors(list, label) {
  const node = selection ? nodeAt(selection) : null;
  if (!node) return false;
  try { normalizeBehaviors(list); } catch (error) { setStatus(error.message, true); renderInspector(); return false; }
  const data = { ...(node.data || {}) };
  if (list.length) data.behaviors = list; else delete data.behaviors;
  const ok = setOption("data", Object.keys(data).length ? data : undefined, label);
  previewTimeline();
  return ok;
}

function updateBehavior(index, key, value) {
  const list = JSON.parse(JSON.stringify(behaviorsOf(nodeAt(selection))));
  list[index][key] = value;
  if (key === "duration" && list[index].tracks) {
    // Keys past a shorter duration are dropped instead of failing validation.
    for (const property of Object.keys(list[index].tracks)) {
      list[index].tracks[property] = list[index].tracks[property].filter(([time]) => time <= value);
      if (!list[index].tracks[property].length) delete list[index].tracks[property];
    }
  }
  setBehaviors(list, `Behaviour ${list[index].type}: ${key}`);
}

// Shows the selected node at the timeline time (the live node only; nothing is committed).
function previewTimeline() {
  const node = selection ? nodeAt(selection) : null;
  const index = keyframesIndex(node);
  if (index < 0) return;
  try { applyKeyframes(node, normalizeBehavior(behaviorsOf(node)[index]), timeline.time); } catch { /* invalid data is reported on edit */ }
}

const PROPERTY_VALUE = {
  x: (node) => node.position.x, y: (node) => node.position.y, rotation: (node) => node.rotation,
  scaleX: (node) => node.scale.x, scaleY: (node) => node.scale.y, alpha: (node) => node.alpha,
};

// Records the live node's current values for the checked tracks at the timeline time.
function recordKey() {
  const node = selection ? nodeAt(selection) : null;
  const index = keyframesIndex(node);
  if (index < 0) return false;
  const list = JSON.parse(JSON.stringify(behaviorsOf(node)));
  const behavior = list[index];
  behavior.tracks = behavior.tracks || {};
  const time = Math.round(timeline.time * 1000) / 1000;
  for (const property of timeline.tracks) {
    const value = Math.round(PROPERTY_VALUE[property](node) * 10000) / 10000;
    const keys = (behavior.tracks[property] || []).filter(([keyTime]) => Math.abs(keyTime - time) > 0.005);
    keys.push([time, value]);
    keys.sort((left, right) => left[0] - right[0]);
    behavior.tracks[property] = keys;
  }
  return setBehaviors(list, `Key at ${time.toFixed(2)} s`);
}

function deleteKey() {
  const node = selection ? nodeAt(selection) : null;
  const index = keyframesIndex(node);
  if (index < 0) return;
  const list = JSON.parse(JSON.stringify(behaviorsOf(node)));
  const tracks = list[index].tracks || {};
  for (const property of Object.keys(tracks)) {
    tracks[property] = tracks[property].filter(([time]) => Math.abs(time - timeline.time) > 0.02);
    if (!tracks[property].length) delete tracks[property];
  }
  setBehaviors(list, `Deleted keys at ${timeline.time.toFixed(2)} s`);
}

function setTimelineTime(time, duration) {
  timeline.time = Math.max(0, Math.min(duration, time));
  if (timeline.slider) timeline.slider.value = String(timeline.time);
  if (timeline.readout) timeline.readout.textContent = `${timeline.time.toFixed(2)} / ${duration.toFixed(2)} s`;
  previewTimeline();
}

function paramControl(param, value, onCommit) {
  if (param.kind === "choice") return selectInput(value ?? param.fallback, param.values, onCommit);
  if (param.kind === "boolean") return checkbox(value ?? param.fallback, onCommit);
  const step = param.max - param.min <= 2 ? 0.05 : param.max <= 100 ? 0.1 : 1;
  return numberInput(Number(value ?? param.fallback), (next) => onCommit(Math.max(param.min, Math.min(param.max, next))), { step, min: param.min, max: param.max });
}

function renderBehaviors(node) {
  section("Behaviours");
  const list = behaviorsOf(node);
  list.forEach((behavior, index) => {
    const spec = BEHAVIOR_SPECS[behavior?.type];
    const remove = Object.assign(document.createElement("button"), { type: "button", textContent: "Remove", className: "small" });
    remove.addEventListener("click", () => setBehaviors(list.filter((_, other) => other !== index), `Removed ${behavior?.type}`));
    field(spec ? spec.label : `Unknown: ${behavior?.type}`, remove);
    if (!spec) return;
    for (const [key, param] of Object.entries(spec.params)) field(`· ${key}`, paramControl(param, behavior[key], (value) => updateBehavior(index, key, value)));
  });
  const picker = selectInput("rotate", Object.keys(BEHAVIOR_SPECS), () => {});
  const add = Object.assign(document.createElement("button"), { type: "button", textContent: "Add" });
  add.addEventListener("click", () => {
    const type = picker.value;
    if (type === "keyframes" && keyframesIndex(node) >= 0) { setStatus("This node already has a keyframes behaviour.", true); return; }
    const definition = { type };
    for (const [key, param] of Object.entries(BEHAVIOR_SPECS[type].params)) definition[key] = param.fallback;
    if (type === "keyframes") { definition.tracks = {}; timeline.time = 0; }
    setBehaviors([...list, definition], `Added ${type} behaviour`);
  });
  field("Add behaviour", pair(picker, add));
  if (keyframesIndex(node) >= 0) renderTimeline(node);
}

function renderTimeline(node) {
  const behavior = behaviorsOf(node)[keyframesIndex(node)];
  const duration = Number(behavior.duration) || 2;
  section("Timeline");
  const slider = Object.assign(document.createElement("input"), { type: "range", min: "0", max: String(duration), step: "0.01", value: String(Math.min(timeline.time, duration)) });
  slider.addEventListener("input", () => { timeline.playing = false; setTimelineTime(Number(slider.value), duration); });
  timeline.slider = slider;
  field("Time", slider, { wide: true });
  const readout = document.createElement("span");
  timeline.readout = readout;
  const play = Object.assign(document.createElement("button"), { type: "button", textContent: timeline.playing ? "■ Stop" : "▶ Preview" });
  play.addEventListener("click", () => { timeline.playing = !timeline.playing; renderInspector(); });
  field("Playback", pair(play, readout));
  const trackBoxes = document.createElement("div");
  trackBoxes.className = "tracks";
  for (const property of KEYFRAME_PROPERTIES) {
    const label = document.createElement("label");
    const box = checkbox(timeline.tracks.has(property), (checked) => { if (checked) timeline.tracks.add(property); else timeline.tracks.delete(property); });
    label.append(box, ` ${property}`);
    trackBoxes.append(label);
  }
  field("Record", trackBoxes, { wide: true });
  const key = Object.assign(document.createElement("button"), { type: "button", textContent: "◆ Key" });
  key.addEventListener("click", recordKey);
  const unkey = Object.assign(document.createElement("button"), { type: "button", textContent: "Delete key" });
  unkey.addEventListener("click", deleteKey);
  field("Keys", pair(key, unkey));
  field("Auto key", checkbox(timeline.autoKey, (value) => { timeline.autoKey = value; }));
  // Key markers: one button per key time; click jumps there.
  const times = [...new Set(Object.values(behavior.tracks || {}).flatMap((keys) => keys.map(([time]) => time)))].sort((left, right) => left - right);
  const markers = document.createElement("div");
  markers.className = "markers";
  for (const time of times) {
    const marker = Object.assign(document.createElement("button"), { type: "button", textContent: time.toFixed(2), title: Object.entries(behavior.tracks).filter(([, keys]) => keys.some(([keyTime]) => keyTime === time)).map(([property]) => property).join(", ") });
    marker.classList.toggle("active", Math.abs(time - timeline.time) < 0.005);
    marker.addEventListener("click", () => { timeline.playing = false; setTimelineTime(time, duration); renderInspector(); });
    markers.append(marker);
  }
  if (!times.length) markers.textContent = "No keys yet: move the node, pick a time and press ◆ Key (or drag with Auto key on).";
  field("Key times", markers, { wide: true });
  setTimelineTime(timeline.time, duration);
}

function advanceTimeline(delta) {
  if (!timeline.playing) return;
  const node = selection ? nodeAt(selection) : null;
  const index = keyframesIndex(node);
  if (index < 0) { timeline.playing = false; return; }
  const duration = Number(behaviorsOf(node)[index].duration) || 2;
  setTimelineTime((timeline.time + delta) % duration, duration);
}

// ---------------------------------------------------------------- prefabs
const PREFAB_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const INSTANCE_KEYS = ["x", "y", "rotation", "scaleX", "scaleY", "name", "zIndex", "visible"];

function makePrefab(rawName) {
  const name = String(rawName ?? "").trim();
  if (!selection || selection.length === 0) { setStatus("Select a node (not the root) to make a prefab", true); return false; }
  if (!PREFAB_NAME.test(name)) { setStatus("Prefab names use 1-64 letters, digits, _ - or .", true); return false; }
  if (!prefabs[name] && Object.keys(prefabs).length >= MAX_PREFABS) { setStatus(`At most ${MAX_PREFABS} prefabs`, true); return false; }
  const path = selection;
  return applyDocument((document) => {
    const entry = entryAt(document, path);
    entry.options = entry.options || {};
    entry.options.data = { ...(entry.options.data || {}), prefab: name };
    const definition = JSON.parse(JSON.stringify(entry));
    for (const key of ["x", "y", "rotation"]) delete definition.options[key];
    document.prefabs = { ...(document.prefabs || {}), [name]: definition };
  }, `Prefab "${name}" created`);
}

function insertPrefab(name) {
  if (!prefabs[name]) return false;
  const parentPath = selectedContainerPath();
  return applyDocument((document) => {
    const parent = entryAt(document, parentPath);
    const instance = JSON.parse(JSON.stringify(document.prefabs[name]));
    instance.options = { ...(instance.options || {}), x: Math.round(camera.position.x), y: Math.round(camera.position.y) };
    instance.options.data = { ...(instance.options.data || {}), prefab: name };
    parent.children = parent.children || [];
    parent.children.push(instance);
    return { select: [...parentPath, parent.children.length - 1] };
  }, `Inserted ${name}`);
}

// Copies the selected instance into its prefab and onto every other instance,
// keeping each instance's own transform, name, z-index and visibility.
function applyPrefab() {
  const node = selection ? nodeAt(selection) : null;
  const name = node?.data?.prefab;
  if (!name || !prefabs[name]) { setStatus("The selection is not a prefab instance", true); return false; }
  const path = selection;
  let updated = 0;
  const ok = applyDocument((document) => {
    const source = JSON.parse(JSON.stringify(entryAt(document, path)));
    for (const key of ["x", "y", "rotation"]) delete source.options[key];
    document.prefabs[name] = source;
    const visit = (entry) => {
      for (let index = 0; index < (entry.children || []).length; index += 1) {
        const child = entry.children[index];
        if (child.options?.data?.prefab === name) {
          const replacement = JSON.parse(JSON.stringify(source));
          for (const key of INSTANCE_KEYS) if (child.options[key] !== undefined) replacement.options[key] = child.options[key];
          entry.children[index] = replacement;
          updated += 1;
        } else visit(child);
      }
    };
    visit(document.root);
  }, `Applied "${name}"`);
  if (ok) setStatus(`Applied "${name}" to ${updated} instance(s)`);
  return ok;
}

function deletePrefab(name) {
  return applyDocument((document) => { delete document.prefabs[name]; }, `Prefab "${name}" removed (instances kept)`);
}

function renderPrefabs() {
  const list = $("#prefabs");
  list.replaceChildren();
  for (const name of Object.keys(prefabs).sort()) {
    const item = document.createElement("li");
    const insert = document.createElement("button");
    insert.type = "button";
    insert.textContent = name;
    insert.title = `Insert ${name} at the view center`;
    insert.addEventListener("click", () => insertPrefab(name));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.title = `Delete the ${name} definition (instances stay)`;
    remove.addEventListener("click", () => deletePrefab(name));
    item.append(insert, remove);
    list.append(item);
  }
}

// ---------------------------------------------------------------- hierarchy + inspector UI
function typeName(node) {
  if (node instanceof Scene) return "Scene";
  if (node instanceof Text) return "Text";
  if (node instanceof NineSliceSprite) return "Panel";
  if (node instanceof Sprite) return "Sprite";
  if (node instanceof TileMap) return "TileMap";
  if (node instanceof Graphics) return "Graphics";
  return "Group";
}

function renderTree() {
  treeNode.replaceChildren();
  const walk = (node, path, depth) => {
    const item = document.createElement("li");
    item.setAttribute("role", "treeitem");
    item.style.paddingLeft = `${6 + depth * 14}px`;
    item.textContent = node.name || "(unnamed)";
    const type = document.createElement("span");
    type.className = "type";
    type.textContent = typeName(node);
    item.append(type);
    if (!node.visible) item.classList.add("hidden-node");
    if (selection && path.length === selection.length && path.every((value, index) => value === selection[index])) {
      item.classList.add("selected");
      item.setAttribute("aria-selected", "true");
    }
    item.addEventListener("click", () => select(path));
    treeNode.append(item);
    node.children.forEach((child, index) => walk(child, [...path, index], depth + 1));
  };
  walk(docRoot, [], 0);
}

function field(label, control, { wide = false } = {}) {
  const id = `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
  control.id = id;
  if (wide) {
    const wrapper = document.createElement("div");
    wrapper.className = "wide";
    const caption = document.createElement("label");
    caption.htmlFor = id;
    caption.textContent = label;
    wrapper.append(caption, control);
    inspector.append(wrapper);
    return;
  }
  const caption = document.createElement("label");
  caption.htmlFor = id;
  caption.textContent = label;
  inspector.append(caption, control);
}

function section(title) {
  const node = document.createElement("div");
  node.className = "section";
  node.textContent = title;
  inspector.append(node);
}

function numberInput(value, onCommit, { step = 1, min, max, round = 3 } = {}) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = String(step);
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.value = String(Number(value.toFixed(round)));
  input.addEventListener("change", () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onCommit(next);
  });
  return input;
}

function textInput(value, onCommit, { multiline = false } = {}) {
  const input = document.createElement(multiline ? "textarea" : "input");
  input.value = value ?? "";
  input.addEventListener("change", () => onCommit(input.value));
  return input;
}

function checkbox(value, onCommit) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  input.addEventListener("change", () => onCommit(input.checked));
  return input;
}

function colorToHex(value) {
  if (typeof value === "number") return `#${value.toString(16).padStart(6, "0")}`;
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) return value;
  return "#ffffff";
}

function colorInput(value, onCommit, asNumber = true) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = colorToHex(value);
  input.addEventListener("change", () => onCommit(asNumber ? Number.parseInt(input.value.slice(1), 16) : input.value));
  return input;
}

function selectInput(value, options, onCommit) {
  const input = document.createElement("select");
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option;
    element.textContent = option;
    input.append(element);
  }
  input.value = value;
  input.addEventListener("change", () => onCommit(input.value));
  return input;
}

function pair(left, right) {
  const wrapper = document.createElement("div");
  wrapper.className = "pair";
  wrapper.append(left, right);
  return wrapper;
}

function textureOptions(current) {
  return [...new Set(["white", ...textures.keys(), ...missingTextures, current])];
}

let paintTile = 0;
let paintMode = false;

function renderInspector() {
  inspector.replaceChildren();
  const node = selection ? nodeAt(selection) : null;
  if (!node) {
    const empty = document.createElement("p");
    empty.className = "wide";
    empty.textContent = "Select a node in the view or the hierarchy.";
    inspector.append(empty);
    return;
  }
  const options = serializeScene(node).root.options || {};
  section(`${typeName(node)}${selection.length === 0 ? " (root)" : ""}`);
  field("Name", textInput(node.name, (value) => setOption("name", value)));
  if (selection.length > 0) {
    field("Position", pair(numberInput(node.position.x, (value) => setOption("x", value)), numberInput(node.position.y, (value) => setOption("y", value))));
    field("Rotation °", numberInput((node.rotation * 180) / Math.PI, (value) => setOption("rotation", (value * Math.PI) / 180), { round: 2 }));
    field("Scale", pair(numberInput(node.scale.x, (value) => setOption("scaleX", value), { step: 0.1 }), numberInput(node.scale.y, (value) => setOption("scaleY", value), { step: 0.1 })));
  }
  field("Alpha", numberInput(node.alpha, (value) => setOption("alpha", Math.max(0, Math.min(1, value))), { step: 0.05, min: 0, max: 1 }));
  field("Z index", numberInput(node.zIndex, (value) => setOption("zIndex", value)));
  field("Visible", checkbox(node.visible, (value) => setOption("visible", value)));
  field("Filter", selectInput(node.filter, FILTER_TYPES, (value) => setOption("filter", value)));
  field("Filter amount", numberInput(node.filterAmount, (value) => setOption("filterAmount", Math.max(0, Math.min(1, value))), { step: 0.05, min: 0, max: 1 }));
  field("Blend", selectInput(node.blendMode, ["normal", "additive", "multiply"], (value) => setOption("blendMode", value)));
  field("Data (JSON)", textInput(node.data ? JSON.stringify(node.data, null, 1) : "", (value) => {
    if (!value.trim()) { setOption("data", undefined); return; }
    let parsed;
    try { parsed = JSON.parse(value); } catch (error) { setStatus(`Data is not valid JSON: ${error.message}`, true); return; }
    setOption("data", parsed);
  }, { multiline: true }), { wide: true });

  if (selection.length > 0) renderBehaviors(node);

  if (selection.length > 0) {
    section("Prefab");
    if (node.data?.prefab) {
      field("Instance of", Object.assign(document.createElement("span"), { textContent: node.data.prefab }));
      const apply = Object.assign(document.createElement("button"), { type: "button", textContent: "Apply to all instances" });
      apply.addEventListener("click", applyPrefab);
      field("Changes", apply);
    }
    const nameField = Object.assign(document.createElement("input"), { placeholder: "prefab-name", value: node.data?.prefab || node.name || "" });
    const make = Object.assign(document.createElement("button"), { type: "button", textContent: node.data?.prefab ? "Save as prefab" : "Make prefab" });
    make.addEventListener("click", () => makePrefab(nameField.value));
    field("Prefab name", pair(nameField, make));
  }

  if (node instanceof Text) {
    section("Text");
    field("Text", textInput(node.text, (value) => setOption("text", value), { multiline: true }), { wide: true });
    field("Font", textInput(node.font, (value) => setOption("font", value)));
    field("Fill", colorInput(node.fill, (value) => setOption("fill", value), false));
    field("Align", selectInput(node.align, ["left", "center", "right"], (value) => setOption("align", value)));
    field("Anchor", pair(numberInput(node.anchor.x, (value) => setOption("anchorX", value), { step: 0.1 }), numberInput(node.anchor.y, (value) => setOption("anchorY", value), { step: 0.1 })));
  } else if (node instanceof Sprite) {
    section(node instanceof NineSliceSprite ? "Panel" : "Sprite");
    field("Texture", selectInput(options.texture, textureOptions(options.texture), (value) => setOption("texture", value)));
    field("Size", pair(numberInput(node.width, (value) => setOption("width", Math.max(0, value))), numberInput(node.height, (value) => setOption("height", Math.max(0, value)))));
    field("Tint", colorInput(node.tint, (value) => setOption("tint", value)));
    field("Anchor", pair(numberInput(node.anchor.x, (value) => setOption("anchorX", value), { step: 0.1 }), numberInput(node.anchor.y, (value) => setOption("anchorY", value), { step: 0.1 })));
    field("Flip X / Y", pair(checkbox(node.flipX, (value) => setOption("flipX", value)), checkbox(node.flipY, (value) => setOption("flipY", value))));
    if (node instanceof NineSliceSprite) {
      field("Border L/R", pair(numberInput(node.left, (value) => setOption("left", value)), numberInput(node.right, (value) => setOption("right", value))));
      field("Border T/B", pair(numberInput(node.top, (value) => setOption("top", value)), numberInput(node.bottom, (value) => setOption("bottom", value))));
    }
  } else if (node instanceof TileMap) {
    section("TileMap");
    field("Texture", selectInput(options.texture, textureOptions(options.texture), (value) => setOption("texture", value)));
    const info = document.createElement("span");
    info.textContent = `${node.columns}×${node.rows} tiles of ${node.tileWidth}×${node.tileHeight}`;
    field("Grid", info);
    const gridColumns = Math.max(1, Math.floor(node.texture.sourceWidth / node.tileWidth));
    const tileCount = gridColumns * Math.max(1, Math.floor(node.texture.sourceHeight / node.tileHeight));
    paintTile = Math.min(paintTile, tileCount - 1);
    field("Paint tile", numberInput(paintTile, (value) => { paintTile = Math.max(0, Math.min(tileCount - 1, Math.round(value))); }, { min: 0, max: tileCount - 1 }));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = paintMode ? "Painting (P)" : "Paint mode (P)";
    toggle.classList.toggle("active", paintMode);
    toggle.addEventListener("click", () => { paintMode = !paintMode; renderInspector(); });
    field("Brush", toggle);
    const help = document.createElement("p");
    help.className = "wide";
    help.style.color = "var(--muted)";
    help.textContent = "Left-drag paints, Alt/right-drag erases while paint mode is on.";
    inspector.append(help);
  } else if (node instanceof Graphics) {
    section("Graphics");
    const commands = options.commands || [];
    field("Shapes", Object.assign(document.createElement("span"), { textContent: `${commands.length} command(s)` }));
    if (commands.length) {
      field("Fill (all)", colorInput(commands[0].fill, (value) => {
        const path = selection;
        applyDocument((doc) => { for (const command of entryAt(doc, path).options.commands) command.fill = value; }, "Recolored shapes");
      }));
    }
  }
}

function refreshUi() {
  renderPrefabs();
  renderTree();
  renderInspector();
  renderTextures();
  $("[data-action=undo]").disabled = history.length < 2;
  $("[data-action=redo]").disabled = future.length === 0;
}

function select(path) {
  selection = path;
  if (!(nodeAt(selection) instanceof TileMap)) paintMode = false;
  refreshUi();
}

// ---------------------------------------------------------------- view: camera, grid, gizmo
const camera = new Camera({ x: 480, y: 270 });
const pointer = { x: 0, y: 0 };
let lastGridKey = "";

function gridSize() {
  const value = Number($("#grid-size").value);
  return Number.isFinite(value) ? Math.max(2, Math.min(256, Math.round(value))) : 16;
}

function snap(value, bypass = false) {
  if (bypass || !$("#snap").checked) return value;
  const size = gridSize();
  return Math.round(value / size) * size;
}

function drawGrid() {
  const bounds = camera.getVisibleBounds();
  let size = gridSize();
  while ((bounds.width / size) + (bounds.height / size) > 300) size *= 2;
  const key = `${Math.round(bounds.x)}:${Math.round(bounds.y)}:${Math.round(bounds.width)}:${Math.round(bounds.height)}:${size}`;
  if (key === lastGridKey) return;
  lastGridKey = key;
  grid.clear();
  const line = 1 / camera.zoom;
  const startX = Math.floor(bounds.x / size) * size;
  const startY = Math.floor(bounds.y / size) * size;
  for (let x = startX; x <= bounds.x + bounds.width; x += size) grid.line(x, bounds.y, x, bounds.y + bounds.height, line, { fill: x === 0 ? 0x475569 : 0x1e293b });
  for (let y = startY; y <= bounds.y + bounds.height; y += size) grid.line(bounds.x, y, bounds.x + bounds.width, y, line, { fill: y === 0 ? 0x475569 : 0x1e293b });
}

function drawGizmo() {
  gizmo.clear();
  const node = selection ? nodeAt(selection) : null;
  if (!node || node === docRoot) return;
  const width = 2 / camera.zoom;
  const box = getAABB(node);
  if (box.width > 0 || box.height > 0) gizmo.strokeRect(box.left, box.top, box.width, box.height, width, { fill: 0x38bdf8 });
  const origin = node.parent ? node.parent.worldMatrix : null;
  const ox = origin ? origin.a * node.position.x + origin.c * node.position.y + origin.tx : node.position.x;
  const oy = origin ? origin.b * node.position.x + origin.d * node.position.y + origin.ty : node.position.y;
  const cross = 6 / camera.zoom;
  gizmo.line(ox - cross, oy, ox + cross, oy, width, { fill: 0xfacc15 }).line(ox, oy - cross, ox, oy + cross, width, { fill: 0xfacc15 });
  if (node instanceof TileMap && paintMode) {
    const cell = tileCell(node, pointer.x, pointer.y);
    if (cell) {
      const m = node.worldMatrix;
      const x = m.a * cell.x * node.tileWidth + m.tx;
      const y = m.d * cell.y * node.tileHeight + m.ty;
      gizmo.strokeRect(x, y, node.tileWidth * m.a, node.tileHeight * m.d, width, { fill: 0xfacc15 });
    }
  }
}

function frameScene() {
  const box = getAABB(docRoot);
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  docRoot.updateWorldMatrix();
  const visit = (node) => {
    if (node !== docRoot && node.getLocalBounds) {
      const b = getAABB(node);
      if (b.width > 0 || b.height > 0) { left = Math.min(left, b.left); top = Math.min(top, b.top); right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom); }
    }
    node.children.forEach(visit);
  };
  visit(docRoot);
  if (!Number.isFinite(left)) { left = box.left; top = box.top; right = left + 960; bottom = top + 540; }
  camera.position.set((left + right) / 2, (top + bottom) / 2);
  const view = camera.getVisibleBounds();
  const zoom = camera.zoom * Math.min(view.width / Math.max(1, (right - left) * 1.2), view.height / Math.max(1, (bottom - top) * 1.2));
  camera.zoom = Math.max(0.05, Math.min(8, zoom));
}

// ---------------------------------------------------------------- pointer interaction
function worldToLocal(parent, x, y) {
  const m = parent.worldMatrix;
  const determinant = m.a * m.d - m.b * m.c || 1;
  const dx = x - m.tx; const dy = y - m.ty;
  return { x: (m.d * dx - m.c * dy) / determinant, y: (-m.b * dx + m.a * dy) / determinant };
}

function tileCell(map, x, y) {
  const local = worldToLocal(map, x, y);
  const cellX = Math.floor(local.x / map.tileWidth);
  const cellY = Math.floor(local.y / map.tileHeight);
  return map.inBounds(cellX, cellY) ? { x: cellX, y: cellY } : null;
}

let drag = null;
let spaceHeld = false;

// Computed from the DOM event itself (canvas pixels -> camera), so it does not
// depend on the order in which the engine's own Input listeners run.
const screenPoint = { x: 0, y: 0 };
function updatePointer(event) {
  const canvas = currentCanvas();
  const rect = canvas.getBoundingClientRect();
  screenPoint.x = (event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
  screenPoint.y = (event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height));
  camera.screenToWorld(screenPoint.x, screenPoint.y, pointer);
}

function paintAt(map, erase) {
  const cell = tileCell(map, pointer.x, pointer.y);
  if (!cell) return false;
  const value = erase ? -1 : paintTile;
  if (map.getTile(cell.x, cell.y) === value) return false;
  map.setTile(cell.x, cell.y, value);
  return true;
}

viewportElement.addEventListener("contextmenu", (event) => event.preventDefault());
viewportElement.addEventListener("pointerdown", (event) => {
  currentCanvas().focus();
  viewportElement.setPointerCapture?.(event.pointerId);
  updatePointer(event);
  const selected = selection ? nodeAt(selection) : null;
  if (event.button === 1 || event.button === 2 && !(paintMode && selected instanceof TileMap) || (event.button === 0 && spaceHeld)) {
    drag = { mode: "pan", startX: event.clientX, startY: event.clientY, cameraX: camera.position.x, cameraY: camera.position.y };
    return;
  }
  if (paintMode && selected instanceof TileMap) {
    drag = { mode: "paint", erase: event.button === 2 || event.altKey, changed: paintAt(selected, event.button === 2 || event.altKey) };
    return;
  }
  if (event.button !== 0) return;
  const hit = docRoot.pick(pointer.x, pointer.y);
  if (!hit) { select(null); return; }
  const path = pathOf(hit);
  if (!path) return;
  select(path);
  const parent = hit.parent || docRoot;
  const local = worldToLocal(parent, pointer.x, pointer.y);
  drag = { mode: "move", node: hit, parent, offsetX: hit.position.x - local.x, offsetY: hit.position.y - local.y, startX: hit.position.x, startY: hit.position.y };
});

viewportElement.addEventListener("pointermove", (event) => {
  updatePointer(event);
  if (!drag) return;
  if (drag.mode === "pan") {
    const rect = currentCanvas().getBoundingClientRect();
    const view = camera.getVisibleBounds();
    const scale = view.width / Math.max(1, rect.width);
    camera.position.set(drag.cameraX - (event.clientX - drag.startX) * scale, drag.cameraY - (event.clientY - drag.startY) * scale);
  } else if (drag.mode === "move") {
    const local = worldToLocal(drag.parent, pointer.x, pointer.y);
    drag.node.position.set(snap(local.x + drag.offsetX, event.shiftKey), snap(local.y + drag.offsetY, event.shiftKey));
  } else if (drag.mode === "paint") {
    const map = selection ? nodeAt(selection) : null;
    if (map instanceof TileMap && paintAt(map, drag.erase)) drag.changed = true;
  }
});

function endDrag() {
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (finished.mode === "move" && (finished.node.position.x !== finished.startX || finished.node.position.y !== finished.startY)) {
    // With a keyframes behaviour and Auto key on, a move becomes a key at the timeline time.
    if (timeline.autoKey && keyframesIndex(finished.node) >= 0 && nodeAt(selection) === finished.node) recordKey();
    else commit(`Moved ${finished.node.name}`);
  }
  if (finished.mode === "paint" && finished.changed) commit("Painted tiles");
}
viewportElement.addEventListener("pointerup", endDrag);
viewportElement.addEventListener("pointercancel", endDrag);

// Asset drag and drop: textures from the browser panel, or image files from the desktop.
viewportElement.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; });
viewportElement.addEventListener("drop", async (event) => {
  event.preventDefault();
  updatePointer(event);
  const x = snap(pointer.x); const y = snap(pointer.y);
  const id = event.dataTransfer.getData("text/exi-texture");
  if (id && textures.has(id)) { addSpriteAt(id, x, y); return; }
  const files = [...(event.dataTransfer.files || [])].filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  await importTextures(files);
  files.forEach((file, index) => { const name = file.name.slice(0, 200); if (textures.has(name)) addSpriteAt(name, x + index * gridSize(), y); });
});

viewportElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  const factor = Math.exp(-event.deltaY * 0.0015);
  const zoom = Math.max(0.05, Math.min(8, camera.zoom * factor));
  updatePointer(event);
  camera.zoomAt(screenPoint.x, screenPoint.y, zoom);
}, { passive: false });

// ---------------------------------------------------------------- keyboard + toolbar
window.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
  if (event.code === "Space" && !typing) { spaceHeld = true; event.preventDefault(); }
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.code === "KeyZ" && !typing) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
  if (mod && event.code === "KeyY" && !typing) { event.preventDefault(); redo(); return; }
  if (mod && event.code === "KeyS") { event.preventDefault(); saveDocument(); return; }
  if (mod && event.code === "KeyD" && !typing) { event.preventDefault(); duplicateSelected(); return; }
  if (typing) return;
  if (event.code === "Delete" || event.code === "Backspace") { event.preventDefault(); deleteSelected(); }
  else if (event.code === "KeyF") frameScene();
  else if (event.code === "KeyP" && selection && nodeAt(selection) instanceof TileMap) { paintMode = !paintMode; renderInspector(); }
  else if (event.code === "Escape") select(null);
  else if (selection && selection.length && event.code.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? gridSize() : 1;
    const node = nodeAt(selection);
    if (event.code === "ArrowLeft") node.position.x -= step;
    if (event.code === "ArrowRight") node.position.x += step;
    if (event.code === "ArrowUp") node.position.y -= step;
    if (event.code === "ArrowDown") node.position.y += step;
    commit(`Nudged ${node.name}`);
  }
});
window.addEventListener("keyup", (event) => { if (event.code === "Space") spaceHeld = false; });

// With the File System Access API (Chromium) the first save asks for a file in
// the project and later saves overwrite it, so games watching that file with
// watchScene({ url }) reload. Other browsers download the JSON.
let fileHandle = null;
async function saveDocument({ chooseFile = false } = {}) {
  const json = JSON.stringify(snapshot(), null, 2);
  if (typeof window.showSaveFilePicker === "function") {
    try {
      if (!fileHandle || chooseFile) {
        fileHandle = await window.showSaveFilePicker({ suggestedName: `${(docRoot.name || "scene").replace(/[^\w.-]+/g, "-")}.json`, types: [{ description: "ExiEngine scene", accept: { "application/json": [".json"] } }] });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(json);
      await writable.close();
      setStatus(`Saved to ${fileHandle.name}`);
      return;
    } catch (error) {
      if (error?.name === "AbortError") { setStatus("Save cancelled"); return; }
      fileHandle = null;
      setStatus(`Saving to a file failed (${error.message}); downloading instead`, true);
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  link.download = `${(docRoot.name || "scene").replace(/[^\w.-]+/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
  setStatus(`Saved ${link.download}`);
}

function loadDocument(document, label) {
  rebuildFrom(document);
  selection = null;
  history = [];
  future = [];
  commit();
  frameScene();
  setStatus(missingTextures.length ? `${label} · missing textures: ${missingTextures.join(", ")} (import them with Textures…)` : label, missingTextures.length > 0);
}

async function openFile(file) {
  try {
    const document = JSON.parse(await file.text());
    loadDocument(document, `Opened ${file.name}`);
  } catch (error) {
    setStatus(`Could not open ${file.name}: ${error.message}`, true);
  }
}

$("#open-file").addEventListener("change", (event) => { const [file] = event.target.files; if (file) openFile(file); event.target.value = ""; });
$("#texture-file").addEventListener("change", (event) => { const files = [...event.target.files]; if (files.length) importTextures(files); event.target.value = ""; });
$("#grid-size").addEventListener("change", () => { lastGridKey = ""; });
document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addNode(button.dataset.add)));
const actions = {
  new: () => loadDocument({ format: SCENE_FORMAT, version: SCENE_FORMAT_VERSION, root: { type: "Scene", options: { name: "scene" } } }, "New scene"),
  open: () => $("#open-file").click(),
  save: () => saveDocument(),
  "save-as": () => saveDocument({ chooseFile: true }),
  play: () => window.open(`./play.html?name=${encodeURIComponent(docRoot.name || "scene")}`, "exi-play"),
  "import-texture": () => $("#texture-file").click(),
  undo, redo,
  duplicate: duplicateSelected,
  delete: deleteSelected,
  frame: frameScene,
};
document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.action]?.()));

// ---------------------------------------------------------------- start
engine = await ExiEngine.create({
  canvas: currentCanvas(),
  backgroundColor: "#0b1020",
  scene: world,
  camera,
  onUpdate(delta) {
    advanceTimeline(delta);
    drawGrid();
    drawGizmo();
  },
});
engine.start();
currentCanvas().tabIndex = 0;

function starterDocument() {
  return {
    format: SCENE_FORMAT,
    version: SCENE_FORMAT_VERSION,
    root: {
      type: "Scene",
      options: { name: "scene" },
      children: [
        { type: "TileMap", options: { name: "ground", x: 0, y: 416, texture: BUILTIN_TILES_ID, tileWidth: 32, tileHeight: 32, columns: 30, rows: 4, tiles: [...new Array(30).fill(0), ...new Array(90).fill(1)] } },
        { type: "Sprite", options: { name: "player", x: 160, y: 384, width: 32, height: 48, tint: 0x5eead4 } },
        { type: "Graphics", options: { name: "sun", x: 820, y: 96, commands: [{ type: "circle", x: 0, y: 0, radius: 40, fill: 0xfacc15, alpha: 1 }] } },
        { type: "Text", options: { name: "title", x: 480, y: 160, text: "Hello from the ExiEngine editor", font: "bold 28px system-ui, sans-serif", fill: "#e2e8f0", resolution: 2 } },
      ],
    },
  };
}

let restored = null;
try { restored = localStorage.getItem(AUTOSAVE_KEY); } catch { restored = null; }
try {
  loadDocument(restored ? JSON.parse(restored) : starterDocument(), restored ? "Restored autosave" : "Starter scene");
} catch (error) {
  loadDocument(starterDocument(), `Autosave could not be loaded (${error.message}); starter scene opened`);
}

// Console access for scripting and AI agents driving the editor page.
window.editor = {
  engine, camera, textures, pointer,
  get root() { return docRoot; },
  get selection() { return selection; },
  select, addNode, deleteSelected, duplicateSelected, setOption, undo, redo,
  serialize: () => snapshot(),
  get prefabs() { return prefabs; },
  makePrefab: (name) => makePrefab(name),
  insertPrefab: (name) => insertPrefab(name),
  applyPrefab: () => applyPrefab(),
  load: (document) => loadDocument(document, "Loaded from script"),
  setBehaviors: (list) => setBehaviors(list, "Behaviours from script"),
  timeline,
  setTimelineTime: (time) => { const node = nodeAt(selection); const index = keyframesIndex(node); if (index >= 0) setTimelineTime(time, Number(behaviorsOf(node)[index].duration) || 2); },
  recordKey: () => recordKey(),
  assignTexture: (id) => assignTexture(id),
  addSpriteAt: (id, x, y) => addSpriteAt(id, x, y),
};
