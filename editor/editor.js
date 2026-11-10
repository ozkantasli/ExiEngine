// ExiEngine browser editor.
// The edited scene is a live ExiEngine scene. Every committed edit goes through
// serializeScene -> change one option -> deserializeScene, so validation is done
// by the engine itself, undo/redo is a list of documents, and what you save is
// exactly what deserializeScene() loads in a game. Drags and tile painting edit
// the live nodes directly and are committed when the pointer is released.
import {
  Camera, ExiEngine, FILTER_TYPES, Graphics, NineSliceSprite, Node, Scene, Sprite, Text, Texture, TileMap,
  SCENE_FORMAT, SCENE_FORMAT_VERSION, deserializeScene, getAABB, serializeScene,
} from "../src/index.js";

const AUTOSAVE_KEY = "exi-editor:autosave";
const MAX_HISTORY = 100;
const BUILTIN_TILES_ID = "editor:tiles";
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

function createBuiltinTiles() {
  const tile = 32;
  const colors = ["#4d7c0f", "#78350f", "#9a3412", "#1e3a8a", "#0e7490", "#6b21a8", "#a16207", "#334155"];
  const source = document.createElement("canvas");
  source.width = tile * colors.length;
  source.height = tile;
  const context = source.getContext("2d");
  colors.forEach((color, index) => {
    context.fillStyle = color; context.fillRect(index * tile, 0, tile, tile);
    context.fillStyle = "rgba(255,255,255,0.18)"; context.fillRect(index * tile, 0, tile, 4);
    context.fillStyle = "rgba(0,0,0,0.25)"; context.fillRect(index * tile, tile - 3, tile, 3);
    context.fillStyle = "rgba(255,255,255,0.85)"; context.font = "bold 12px system-ui, sans-serif"; context.fillText(String(index), index * tile + 4, 18);
  });
  return new Texture({ id: BUILTIN_TILES_ID, source, filter: "nearest" });
}
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
  // Rebuild so nodes that referenced a missing id pick up the real texture.
  rebuildFrom(serializeScene(docRoot));
  renderTextures();
  setStatus(`Imported ${files.length} texture(s).`);
}

function renderTextures() {
  texturesNode.replaceChildren();
  const ids = new Set([...textures.keys(), ...missingTextures]);
  for (const id of ids) {
    const item = document.createElement("li");
    const texture = textures.get(id);
    item.textContent = id;
    const size = document.createElement("span");
    size.textContent = texture ? `${texture.sourceWidth}×${texture.sourceHeight}` : "missing";
    item.append(size);
    if (!texture) item.classList.add("missing");
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

function rebuildFrom(document) {
  const report = {};
  const next = deserializeScene(document, { textures, report });
  missingTextures = report.missingTextures;
  swapRoot(next);
  if (selection && !nodeAt(selection)) selection = null;
  return next;
}

function commit(label) {
  const json = JSON.stringify(serializeScene(docRoot));
  if (history.at(-1) === json) return;
  history.push(json);
  if (history.length > MAX_HISTORY) history.shift();
  future = [];
  try { localStorage.setItem(AUTOSAVE_KEY, json); } catch { /* storage is a convenience only */ }
  refreshUi();
  if (label) setStatus(label);
}

function applyDocument(mutate, label) {
  const document = serializeScene(docRoot);
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

function setOption(key, value) {
  if (!selection) return;
  const path = selection;
  applyDocument((document) => {
    const entry = entryAt(document, path);
    entry.options = entry.options || {};
    if (value === undefined) delete entry.options[key];
    else entry.options[key] = value;
  }, `Set ${key}`);
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
  if (finished.mode === "move" && (finished.node.position.x !== finished.startX || finished.node.position.y !== finished.startY)) commit(`Moved ${finished.node.name}`);
  if (finished.mode === "paint" && finished.changed) commit("Painted tiles");
}
viewportElement.addEventListener("pointerup", endDrag);
viewportElement.addEventListener("pointercancel", endDrag);

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

function saveDocument() {
  const json = JSON.stringify(serializeScene(docRoot), null, 2);
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
  save: saveDocument,
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
  onUpdate() {
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
  serialize: () => serializeScene(docRoot),
  load: (document) => loadDocument(document, "Loaded from script"),
};
