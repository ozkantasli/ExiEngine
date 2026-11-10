import { Node, Scene } from "./node.js";
import { Sprite } from "./sprite.js";
import { NineSliceSprite } from "./nine-slice-sprite.js";
import { Text } from "./text.js";
import { Graphics } from "./graphics.js";
import { TileMap } from "./tilemap.js";
import { Texture } from "../assets/texture.js";

// Scene documents use the same { type, options, children } shape as the MCP
// exi_build_scene tool, wrapped in a versioned envelope. Only data is stored:
// callbacks (onUpdate, pointer/focus handlers) and runtime caches are never
// serialized, and loading never evaluates code. Textures are stored by id and
// resolved by the caller, so a document never embeds image data.
export const SCENE_FORMAT = "exi-scene";
export const SCENE_FORMAT_VERSION = 1;
export const MAX_SERIALIZED_NODES = 10_000;
export const MAX_SERIALIZED_DEPTH = 64;
const MAX_STRING_LENGTH = 4_096;
const MAX_NAME_LENGTH = 256;
const WHITE_TEXTURE_ID = "white";

const NODE_NUMBER_KEYS = ["x", "y", "scaleX", "scaleY", "rotation", "zIndex", "alpha", "filterAmount", "tabIndex"];
const NODE_BOOLEAN_KEYS = ["visible", "cullable", "interactive", "focusable"];
const NODE_STRING_KEYS = ["name", "filter", "blendMode"];
const NODE_RECT_KEYS = ["hitArea", "clipRect", "maskRect", "cullBounds"];
const LAYOUT_KEYS = ["left", "top", "right", "bottom", "width", "height", "offsetX", "offsetY", "anchorX", "anchorY"];
const SPRITE_NUMBER_KEYS = ["width", "height", "anchorX", "anchorY"];
const SPRITE_BOOLEAN_KEYS = ["flipX", "flipY"];
const NINE_SLICE_KEYS = ["left", "right", "top", "bottom"];
const TEXT_STRING_KEYS = ["text", "font", "fill", "align", "baseline"];
const TEXT_NUMBER_KEYS = ["strokeWidth", "lineHeight", "padding", "resolution", "maxWidth"];
const TILEMAP_NUMBER_KEYS = ["tileWidth", "tileHeight", "columns", "rows"];
const TILEMAP_BOOLEAN_KEYS = ["staticCache", "instanced", "gpuCulling", "cullTiles"];
const GRAPHICS_COMMANDS = {
  rect: ["x", "y", "width", "height"],
  circle: ["x", "y", "radius", "segments"],
  ellipse: ["x", "y", "radiusX", "radiusY", "segments"],
  line: ["x1", "y1", "x2", "y2", "width"],
  triangle: ["x1", "y1", "x2", "y2", "x3", "y3"],
  polygon: [],
};

// Most specific first: instanceof order decides the stored type name.
const TYPES = [
  ["Scene", Scene], ["Text", Text], ["NineSliceSprite", NineSliceSprite], ["Sprite", Sprite],
  ["TileMap", TileMap], ["Graphics", Graphics], ["Node", Node],
];
const TYPE_BY_NAME = new Map(TYPES);
export const SERIALIZABLE_NODE_TYPES = Object.freeze(TYPES.map(([name]) => name));

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typeNameOf(node) {
  for (const [name, Constructor] of TYPES) {
    if (!(node instanceof Constructor)) continue;
    // A subclass we do not know (ParticleEmitter, SpriteBatch, ...) must not be
    // silently downgraded to its base class.
    if (Object.getPrototypeOf(node) !== Constructor.prototype) return null;
    return name;
  }
  return null;
}

function textureRef(texture) {
  if (!texture || texture === Texture.white) return WHITE_TEXTURE_ID;
  return texture.id;
}

function rectData(rect) {
  return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
}

function nodeOptions(node) {
  const options = {
    name: node.name, x: node.position.x, y: node.position.y, scaleX: node.scale.x, scaleY: node.scale.y,
    rotation: node.rotation, zIndex: node.zIndex, visible: node.visible, alpha: node.alpha,
    filter: node.filter, filterAmount: node.filterAmount, blendMode: node.blendMode, cullable: node.cullable,
    interactive: node.interactive, focusable: node.focusable, tabIndex: node.tabIndex,
  };
  for (const key of NODE_RECT_KEYS) if (node[key]) options[key] = rectData(node[key]);
  if (node.layout) {
    options.layout = {};
    for (const key of LAYOUT_KEYS) if (node.layout[key] !== null && node.layout[key] !== undefined) options.layout[key] = node.layout[key];
  }
  return options;
}

function graphicsCommands(graphics) {
  return graphics.commands.map((command) => {
    const keys = GRAPHICS_COMMANDS[command.type];
    if (!keys) throw new TypeError(`Graphics command "${command.type}" cannot be serialized.`);
    const data = { type: command.type, fill: command.tint, alpha: command.alpha };
    for (const key of keys) if (command[key] !== undefined) data[key] = command[key];
    if (command.type === "polygon") {
      if (!Array.isArray(command.points)) throw new TypeError("Graphics polygon has no source points to serialize.");
      data.points = command.points.slice();
    }
    return data;
  });
}

function serializeNode(node, state, depth, unsupported) {
  if (!(node instanceof Node)) throw new TypeError("serializeScene expects a Node.");
  if (node.destroyed) throw new TypeError("A destroyed Node cannot be serialized.");
  if (depth > MAX_SERIALIZED_DEPTH) throw new RangeError("Serialized scene depth limit exceeded.");
  const type = typeNameOf(node);
  if (!type) {
    if (unsupported === "skip") { state.skipped.push(node.constructor?.name || "unknown"); return null; }
    throw new TypeError(`${node.constructor?.name || "This node type"} cannot be serialized; supported types: ${SERIALIZABLE_NODE_TYPES.join(", ")}.`);
  }
  state.nodes += 1;
  if (state.nodes > state.maxNodes) throw new RangeError("Serialized scene node limit exceeded.");
  const options = nodeOptions(node);
  if (node instanceof Sprite) {
    Object.assign(options, { texture: textureRef(node.texture), width: node.width, height: node.height, anchorX: node.anchor.x, anchorY: node.anchor.y, tint: node.tint, flipX: node.flipX, flipY: node.flipY });
    if (node instanceof NineSliceSprite) Object.assign(options, { left: node.left, right: node.right, top: node.top, bottom: node.bottom });
    if (node instanceof Text) {
      for (const key of [...TEXT_STRING_KEYS, ...TEXT_NUMBER_KEYS]) options[key] = node[key];
      options.stroke = node.stroke;
      options.wordWrap = node.wordWrap;
      delete options.texture; delete options.width; delete options.height; delete options.tint;
    }
  } else if (node instanceof TileMap) {
    Object.assign(options, { texture: textureRef(node.texture), tileWidth: node.tileWidth, tileHeight: node.tileHeight, columns: node.columns, rows: node.rows, staticCache: node.staticCache, instanced: node.instanced, gpuCulling: node.gpuCulling, cullTiles: node.cullTiles });
    options.tiles = Array.from(node.tiles);
    if (node.tileFlags && node.tileFlags.some((flag) => flag !== 0)) options.tileFlags = Array.from(node.tileFlags);
  } else if (node instanceof Graphics) {
    options.staticCache = node.staticCache;
    options.commands = graphicsCommands(node);
  }
  const entry = { type, options };
  const children = [];
  for (const child of node.children) {
    const serialized = serializeNode(child, state, depth + 1, unsupported);
    if (serialized) children.push(serialized);
  }
  if (children.length) entry.children = children;
  return entry;
}

export function serializeScene(root, { maxNodes = MAX_SERIALIZED_NODES, unsupported = "throw" } = {}) {
  if (unsupported !== "throw" && unsupported !== "skip") throw new TypeError('serializeScene unsupported must be "throw" or "skip".');
  if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0 || maxNodes > MAX_SERIALIZED_NODES) throw new RangeError(`serializeScene maxNodes must be between 1 and ${MAX_SERIALIZED_NODES}.`);
  const state = { nodes: 0, maxNodes, skipped: [] };
  const document = { format: SCENE_FORMAT, version: SCENE_FORMAT_VERSION, root: serializeNode(root, state, 0, unsupported) };
  if (!document.root) throw new TypeError("The root node cannot be serialized.");
  if (state.skipped.length) document.skipped = state.skipped;
  return document;
}

// ---------------------------------------------------------------------------

function readNumber(source, key, target, label) {
  if (source[key] === undefined) return;
  if (typeof source[key] !== "number" || !Number.isFinite(source[key])) throw new TypeError(`${label}.${key} must be a finite number.`);
  target[key] = source[key];
}

function readBoolean(source, key, target, label) {
  if (source[key] === undefined) return;
  if (typeof source[key] !== "boolean") throw new TypeError(`${label}.${key} must be a boolean.`);
  target[key] = source[key];
}

function readString(source, key, target, label, limit = MAX_STRING_LENGTH) {
  if (source[key] === undefined) return;
  if (typeof source[key] !== "string" || source[key].length > limit) throw new TypeError(`${label}.${key} must be a string of at most ${limit} characters.`);
  target[key] = source[key];
}

function readColor(source, key, target, label) {
  if (source[key] === undefined) return;
  const value = source[key];
  if (!((typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 0xffffff) || (typeof value === "string" && value.length <= 64))) throw new TypeError(`${label}.${key} must be a 0xRRGGBB number or a CSS color string.`);
  target[key] = value;
}

function readRect(source, key, target, label) {
  if (source[key] === undefined || source[key] === null) return;
  const rect = source[key];
  if (!isRecord(rect)) throw new TypeError(`${label}.${key} must be a rectangle.`);
  const result = {};
  for (const field of ["x", "y", "width", "height"]) {
    if (typeof rect[field] !== "number" || !Number.isFinite(rect[field])) throw new TypeError(`${label}.${key}.${field} must be a finite number.`);
    result[field] = rect[field];
  }
  target[key] = result;
}

function readIntArray(source, key, label, expectedLength, min, max) {
  const values = source[key];
  if (!Array.isArray(values) || values.length !== expectedLength) throw new RangeError(`${label}.${key} must be an array of ${expectedLength} integers.`);
  for (const value of values) if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${label}.${key} contains an invalid value.`);
  return values;
}

function assertKnownKeys(options, allowed, label) {
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new TypeError(`${label} has an unknown option: ${key}`);
}

function resolveTexture(id, label, context) {
  if (id === undefined || id === WHITE_TEXTURE_ID) return Texture.white;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_NAME_LENGTH) throw new TypeError(`${label}.texture must be a texture id.`);
  let texture = null;
  if (typeof context.resolveTexture === "function") texture = context.resolveTexture(id);
  else if (context.textures instanceof Map) texture = context.textures.get(id);
  else if (isRecord(context.textures) && Object.hasOwn(context.textures, id)) texture = context.textures[id];
  if (texture instanceof Texture && !texture.destroyed) return texture;
  if (texture !== null && texture !== undefined) throw new TypeError(`${label}.texture "${id}" did not resolve to a live Texture.`);
  if (context.strict) throw new RangeError(`${label}.texture "${id}" could not be resolved.`);
  context.missingTextures.add(id);
  return null;
}

function missingTilesetTexture(source, options) {
  const tileWidth = Math.max(1, options.tileWidth | 0);
  const tileHeight = Math.max(1, options.tileHeight | 0);
  let highest = 0;
  if (Array.isArray(source.tiles)) for (const value of source.tiles) if (Number.isSafeInteger(value) && value > highest) highest = value;
  const columns = Math.max(1, Math.min(Math.floor(16_384 / tileWidth), highest + 1));
  const rows = Math.max(1, Math.ceil((highest + 1) / columns));
  return new Texture({ id: `missing-tileset:${String(source.texture).slice(0, 64)}`, sourceWidth: columns * tileWidth, sourceHeight: rows * tileHeight });
}

const COMMON_KEYS = new Set([...NODE_NUMBER_KEYS, ...NODE_BOOLEAN_KEYS, ...NODE_STRING_KEYS, ...NODE_RECT_KEYS, "layout"]);
const SPRITE_KEYS = new Set([...COMMON_KEYS, "texture", "tint", ...SPRITE_NUMBER_KEYS, ...SPRITE_BOOLEAN_KEYS]);
const ALLOWED_KEYS = {
  Node: COMMON_KEYS,
  Scene: COMMON_KEYS,
  Sprite: SPRITE_KEYS,
  NineSliceSprite: new Set([...SPRITE_KEYS, ...NINE_SLICE_KEYS]),
  Text: new Set([...COMMON_KEYS, "anchorX", "anchorY", "flipX", "flipY", ...TEXT_STRING_KEYS, ...TEXT_NUMBER_KEYS, "stroke", "wordWrap"]),
  TileMap: new Set([...COMMON_KEYS, "texture", ...TILEMAP_NUMBER_KEYS, ...TILEMAP_BOOLEAN_KEYS, "tiles", "tileFlags"]),
  Graphics: new Set([...COMMON_KEYS, "staticCache", "commands"]),
};

function readCommonOptions(source, label) {
  const options = {};
  for (const key of NODE_NUMBER_KEYS) readNumber(source, key, options, label);
  for (const key of NODE_BOOLEAN_KEYS) readBoolean(source, key, options, label);
  for (const key of NODE_STRING_KEYS) readString(source, key, options, label, MAX_NAME_LENGTH);
  for (const key of NODE_RECT_KEYS) readRect(source, key, options, label);
  if (source.layout !== undefined && source.layout !== null) {
    if (!isRecord(source.layout)) throw new TypeError(`${label}.layout must be an object.`);
    assertKnownKeys(source.layout, new Set(LAYOUT_KEYS), `${label}.layout`);
    options.layout = {};
    for (const key of LAYOUT_KEYS) readNumber(source.layout, key, options.layout, `${label}.layout`);
  }
  return options;
}

function applyGraphicsCommands(graphics, commands, label) {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) throw new TypeError(`${label}.commands must be an array.`);
  commands.forEach((command, index) => {
    const commandLabel = `${label}.commands[${index}]`;
    if (!isRecord(command) || !Object.hasOwn(GRAPHICS_COMMANDS, command.type)) throw new TypeError(`${commandLabel}.type is not a supported Graphics command.`);
    const keys = GRAPHICS_COMMANDS[command.type];
    assertKnownKeys(command, new Set(["type", "fill", "alpha", "points", ...keys]), commandLabel);
    const values = {};
    for (const key of keys) readNumber(command, key, values, commandLabel);
    const style = {};
    readColor(command, "fill", style, commandLabel);
    readNumber(command, "alpha", style, commandLabel);
    if (values.segments !== undefined) style.segments = values.segments;
    switch (command.type) {
      case "rect": graphics.rect(values.x, values.y, values.width, values.height, style); break;
      case "circle": graphics.circle(values.x, values.y, values.radius, style); break;
      case "ellipse": graphics.ellipse(values.x, values.y, values.radiusX, values.radiusY, style); break;
      case "line": graphics.line(values.x1, values.y1, values.x2, values.y2, values.width, style); break;
      case "triangle": graphics.triangle(values.x1, values.y1, values.x2, values.y2, values.x3, values.y3, style); break;
      case "polygon":
        if (!Array.isArray(command.points) || command.points.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new TypeError(`${commandLabel}.points must be an array of finite numbers.`);
        graphics.polygon(command.points, style);
        break;
      default: break;
    }
  });
}

function buildNode(entry, context, depth, path) {
  if (depth > MAX_SERIALIZED_DEPTH) throw new RangeError("Serialized scene depth limit exceeded.");
  if (!isRecord(entry)) throw new TypeError(`${path} must be an object.`);
  assertKnownKeys(entry, new Set(["type", "options", "children"]), path);
  context.nodes += 1;
  if (context.nodes > context.maxNodes) throw new RangeError("Serialized scene node limit exceeded.");
  const type = entry.type;
  if (typeof type !== "string" || !TYPE_BY_NAME.has(type)) throw new TypeError(`${path}.type must be one of ${SERIALIZABLE_NODE_TYPES.join(", ")}.`);
  const source = entry.options === undefined ? {} : entry.options;
  if (!isRecord(source)) throw new TypeError(`${path}.options must be an object.`);
  const label = `${path}.options`;
  assertKnownKeys(source, ALLOWED_KEYS[type], `${path} (${type})`);
  const options = readCommonOptions(source, label);
  let node;
  if (type === "Sprite" || type === "NineSliceSprite") {
    options.texture = resolveTexture(source.texture, label, context) || Texture.white;
    for (const key of SPRITE_NUMBER_KEYS) readNumber(source, key, options, label);
    for (const key of SPRITE_BOOLEAN_KEYS) readBoolean(source, key, options, label);
    readColor(source, "tint", options, label);
    if (type === "NineSliceSprite") for (const key of NINE_SLICE_KEYS) readNumber(source, key, options, label);
    node = type === "Sprite" ? new Sprite(options) : new NineSliceSprite(options);
  } else if (type === "Text") {
    for (const key of ["anchorX", "anchorY"]) readNumber(source, key, options, label);
    for (const key of ["flipX", "flipY", "wordWrap"]) readBoolean(source, key, options, label);
    for (const key of TEXT_STRING_KEYS) readString(source, key, options, label);
    for (const key of TEXT_NUMBER_KEYS) readNumber(source, key, options, label);
    if (source.stroke !== undefined && source.stroke !== null) readString(source, "stroke", options, label, 64);
    node = new Text(options);
  } else if (type === "TileMap") {
    const texture = resolveTexture(source.texture, label, context);
    for (const key of TILEMAP_NUMBER_KEYS) readNumber(source, key, options, label);
    for (const key of TILEMAP_BOOLEAN_KEYS) readBoolean(source, key, options, label);
    // A missing tileset becomes a sourceless placeholder wide enough for every
    // stored tile index; the renderers draw sourceless textures as plain white.
    options.texture = texture || missingTilesetTexture(source, options);
    node = new TileMap(options);
    try {
      const count = node.columns * node.rows;
      if (source.tiles !== undefined) node.setTiles(readIntArray(source, "tiles", label, count, -1, 0x7fffffff));
      if (source.tileFlags !== undefined) {
        const flags = readIntArray(source, "tileFlags", label, count, 0, 3);
        flags.forEach((flag, index) => {
          if (flag) node.setTile(index % node.columns, Math.floor(index / node.columns), node.tiles[index], { flipX: (flag & 1) !== 0, flipY: (flag & 2) !== 0 });
        });
      }
    } catch (error) { node.destroy(); throw error; }
  } else if (type === "Graphics") {
    readBoolean(source, "staticCache", options, label);
    node = new Graphics(options);
    try { applyGraphicsCommands(node, source.commands, label); } catch (error) { node.destroy(); throw error; }
  } else {
    node = type === "Scene" ? new Scene(options) : new Node(options);
  }
  const children = entry.children === undefined ? [] : entry.children;
  if (!Array.isArray(children)) { node.destroy(); throw new TypeError(`${path}.children must be an array.`); }
  try {
    children.forEach((child, index) => node.add(buildNode(child, context, depth + 1, `${path}.children[${index}]`)));
  } catch (error) { node.destroy(); throw error; }
  return node;
}

export function deserializeScene(document, { textures = null, resolveTexture: resolver = null, strict = false, maxNodes = MAX_SERIALIZED_NODES, report = null } = {}) {
  if (!isRecord(document)) throw new TypeError("Scene document must be an object.");
  if (document.format !== SCENE_FORMAT) throw new TypeError(`Scene document format must be "${SCENE_FORMAT}".`);
  if (document.version !== SCENE_FORMAT_VERSION) throw new RangeError(`Unsupported scene document version: ${String(document.version)}.`);
  if (!Number.isSafeInteger(maxNodes) || maxNodes <= 0 || maxNodes > MAX_SERIALIZED_NODES) throw new RangeError(`deserializeScene maxNodes must be between 1 and ${MAX_SERIALIZED_NODES}.`);
  if (resolver !== null && typeof resolver !== "function") throw new TypeError("deserializeScene resolveTexture must be a function.");
  if (report !== null && !isRecord(report)) throw new TypeError("deserializeScene report must be an object.");
  const context = { textures, resolveTexture: resolver, strict: Boolean(strict), maxNodes, nodes: 0, missingTextures: new Set() };
  const root = buildNode(document.root, context, 0, "root");
  if (report) {
    report.nodes = context.nodes;
    report.missingTextures = [...context.missingTextures];
  }
  return root;
}
