import { TileMap } from "./tilemap.js";
import { Texture } from "../assets/texture.js";

// LDtk (https://ldtk.io) project import. Reads the JSON a project saves
// (embedded levels; for "separate level files" load the .ldtkl file and pass
// it as `level`). Supported: Tiles and AutoLayer layers -> TileMap,
// IntGrid -> integer grid for collisions/pathfinding, Entities -> plain list.
// Unsupported data is rejected explicitly instead of being rendered wrong.

const MAX_LDTK_LEVELS = 4_096;
const MAX_LDTK_LAYERS = 256;
const MAX_LDTK_ENTITIES = 65_536;
const MAX_LDTK_CELLS = 500_000;
const TILE_LAYER_TYPES = new Set(["Tiles", "AutoLayer", "IntGrid"]);

function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`LDtk ${label} must be a positive integer.`);
  return value;
}

function select(list, selector, label, limit, predicate = () => true) {
  if (!Array.isArray(list)) throw new TypeError(`LDtk ${label} list is missing.`);
  if (list.length > limit) throw new RangeError(`LDtk ${label} limit exceeded.`);
  if (selector === undefined) {
    const found = list.find((entry) => isRecord(entry) && predicate(entry));
    if (!found) throw new RangeError(`LDtk project has no ${label}.`);
    return found;
  }
  if (isRecord(selector)) return selector;
  if (typeof selector === "number") {
    const entry = list[selector];
    if (!isRecord(entry) || !predicate(entry)) throw new RangeError(`LDtk ${label} index ${selector} is not available.`);
    return entry;
  }
  if (typeof selector === "string") {
    const entry = list.find((item) => isRecord(item) && (item.identifier === selector || item.__identifier === selector) && predicate(item));
    if (!entry) throw new RangeError(`LDtk ${label} "${selector}" not found.`);
    return entry;
  }
  throw new TypeError(`LDtk ${label} selector must be an index, an identifier or an object.`);
}

function resolveLevel(project, level) {
  if (!isRecord(project)) throw new TypeError("LDtk project must be an object.");
  if (isRecord(level) && Array.isArray(level.layerInstances)) return level;
  const found = select(project.levels, level, "level", MAX_LDTK_LEVELS);
  if (!Array.isArray(found.layerInstances)) throw new RangeError("LDtk level has no layerInstances (separate level files: pass the loaded .ldtkl as level).");
  return found;
}

function resolveLayer(project, level, layer, types) {
  const resolved = resolveLevel(project, level);
  return select(resolved.layerInstances, layer, "layer", MAX_LDTK_LAYERS, (entry) => types.has(entry.__type));
}

function layerGrid(layer) {
  const columns = positiveInteger(layer.__cWid, "layer __cWid");
  const rows = positiveInteger(layer.__cHei, "layer __cHei");
  if (columns * rows > MAX_LDTK_CELLS) throw new RangeError("LDtk layer cell limit exceeded.");
  return { columns, rows, gridSize: positiveInteger(layer.__gridSize, "layer __gridSize") };
}

function findTileset(project, uid) {
  const tilesets = project?.defs?.tilesets;
  if (!Array.isArray(tilesets)) return null;
  return tilesets.find((entry) => isRecord(entry) && entry.uid === uid) ?? null;
}

// Builds one TileMap from a Tiles or AutoLayer layer (IntGrid layers with an
// auto-tile rule set use their autoLayerTiles too).
export function tileMapFromLDtk(project, { level, layer, texture, ...options } = {}) {
  if (!(texture instanceof Texture)) throw new TypeError("tileMapFromLDtk texture is required.");
  const source = resolveLayer(project, level, layer, TILE_LAYER_TYPES);
  const { columns, rows, gridSize } = layerGrid(source);
  const tileset = findTileset(project, source.__tilesetDefUid);
  if (tileset) {
    if ((tileset.padding ?? 0) !== 0 || (tileset.spacing ?? 0) !== 0) throw new RangeError("LDtk tileset padding/spacing is not supported; export the tileset without them.");
    if (tileset.tileGridSize !== undefined && tileset.tileGridSize !== gridSize) throw new RangeError("LDtk tileset grid size must match the layer grid size.");
  }
  const tiles = source.__type === "Tiles" ? source.gridTiles : source.autoLayerTiles;
  if (!Array.isArray(tiles)) throw new RangeError("LDtk layer has no tiles (IntGrid layers without auto-tiles: use ldtkIntGrid).");
  if (tiles.length > MAX_LDTK_CELLS * 4) throw new RangeError("LDtk tile limit exceeded.");
  const values = new Int32Array(columns * rows).fill(-1);
  const flags = new Uint8Array(columns * rows);
  for (const tile of tiles) {
    if (!isRecord(tile) || !Array.isArray(tile.px)) throw new TypeError("LDtk tile entries need px.");
    const cellX = Math.floor(tile.px[0] / gridSize); const cellY = Math.floor(tile.px[1] / gridSize);
    if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY) || cellX < 0 || cellY < 0 || cellX >= columns || cellY >= rows) continue;
    if (!Number.isSafeInteger(tile.t) || tile.t < 0) throw new RangeError("LDtk tile id is invalid.");
    // Later tiles are drawn on top in LDtk, so the last one per cell wins.
    values[cellY * columns + cellX] = tile.t;
    flags[cellY * columns + cellX] = (Number(tile.f) || 0) & 3;
  }
  const opacity = Number(source.__opacity ?? 1);
  const nodeOptions = {
    name: typeof source.__identifier === "string" ? source.__identifier.slice(0, 256) : "ldtk-layer",
    ...options,
    texture, tileWidth: gridSize, tileHeight: gridSize, columns, rows,
    x: Number(options.x ?? 0) + Number(source.__pxTotalOffsetX ?? source.pxOffsetX ?? 0),
    y: Number(options.y ?? 0) + Number(source.__pxTotalOffsetY ?? source.pxOffsetY ?? 0),
    alpha: Number(options.alpha ?? 1) * (Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1),
    visible: options.visible !== false && source.visible !== false,
  };
  const map = new TileMap(nodeOptions);
  try {
    map.setTiles(values);
    for (let index = 0; index < flags.length; index += 1) {
      if (!flags[index]) continue;
      map.setTile(index % columns, Math.floor(index / columns), values[index], { flipX: (flags[index] & 1) !== 0, flipY: (flags[index] & 2) !== 0 });
    }
  } catch (error) {
    map.destroy();
    throw error;
  }
  return map;
}

// IntGrid values row by row (0 = empty), plus helpers for the engine's grid APIs.
export function ldtkIntGrid(project, { level, layer } = {}) {
  const source = resolveLayer(project, level, layer, new Set(["IntGrid"]));
  const { columns, rows, gridSize } = layerGrid(source);
  const csv = source.intGridCsv;
  if (!Array.isArray(csv) || csv.length !== columns * rows) throw new RangeError("LDtk intGridCsv size does not match the layer.");
  const values = new Int32Array(columns * rows);
  for (let index = 0; index < csv.length; index += 1) {
    if (!Number.isSafeInteger(csv[index]) || csv[index] < 0) throw new RangeError("LDtk intGridCsv values must be non-negative integers.");
    values[index] = csv[index];
  }
  return {
    identifier: source.__identifier, columns, rows, gridSize, values,
    get(x, y) { return x >= 0 && y >= 0 && x < columns && y < rows ? values[y * columns + x] : 0; },
    // Rows of numbers for findGridPath (blockedValues picks what is solid).
    toRows() { return Array.from({ length: rows }, (_, y) => Array.from(values.subarray(y * columns, (y + 1) * columns))); },
  };
}

// Entities as plain records with world positions (pivot applied) and custom fields.
export function ldtkEntities(project, { level, layer } = {}) {
  const resolved = resolveLevel(project, level);
  const layers = resolved.layerInstances.filter((entry) => isRecord(entry) && entry.__type === "Entities" && (layer === undefined || entry.__identifier === layer));
  const entities = [];
  for (const source of layers) {
    const offsetX = Number(source.__pxTotalOffsetX ?? 0); const offsetY = Number(source.__pxTotalOffsetY ?? 0);
    for (const entity of source.entityInstances ?? []) {
      if (entities.length >= MAX_LDTK_ENTITIES) throw new RangeError("LDtk entity limit exceeded.");
      if (!isRecord(entity) || !Array.isArray(entity.px)) continue;
      const width = Number(entity.width) || 0; const height = Number(entity.height) || 0;
      const pivot = Array.isArray(entity.__pivot) ? entity.__pivot : [0, 0];
      const fields = Object.create(null);
      for (const field of entity.fieldInstances ?? []) if (isRecord(field) && typeof field.__identifier === "string") fields[field.__identifier] = field.__value;
      entities.push({
        identifier: String(entity.__identifier ?? ""), iid: entity.iid ?? null, layer: source.__identifier,
        x: entity.px[0] + offsetX, y: entity.px[1] + offsetY, width, height,
        left: entity.px[0] + offsetX - pivot[0] * width, top: entity.px[1] + offsetY - pivot[1] * height,
        tags: Array.isArray(entity.__tags) ? entity.__tags.slice() : [], fields,
      });
    }
  }
  return entities;
}
