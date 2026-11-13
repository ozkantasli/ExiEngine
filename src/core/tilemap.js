import { Node } from "./node.js";
import { Texture } from "../assets/texture.js";
import { GPU_SOURCE_FLOATS, INSTANCE_FLOATS } from "../render/instanced.js";
import { updateStaticRenderKey } from "../render/batch.js";
import { PhysicsBody } from "./collision.js";
import { NONE } from "./sentinel.js";

const MAX_TILE_COUNT = 500_000;

// TileMap frameCache stores subTextures per tileIndex; but if the texture
// was reassigned or the atlas UVs changed it would serve stale frames. It keys
// on texture identity through a WeakMap and on the baseTexture version.
const textureUidRegistry = new WeakMap();
let nextTextureUid = 1;
function textureUid(texture) {
  let uid = textureUidRegistry.get(texture);
  if (uid === undefined) { uid = nextTextureUid; nextTextureUid += 1; textureUidRegistry.set(texture, uid); }
  return uid;
}
const TILE_FLIP_X = 1;
const TILE_FLIP_Y = 2;

function writeTilePoint(matrix, camera, worldPoint, screenPoint, data, offset, x, y) {
  matrix.transformPoint(x, y, worldPoint);
  camera.worldToScreen(worldPoint.x, worldPoint.y, screenPoint);
  data[offset] = screenPoint.x;
  data[offset + 1] = screenPoint.y;
}

function includeTileCullCorner(camera, matrix, screenX, screenY, worldPoint, localPoint, inverseDeterminant, bounds) {
  camera.screenToWorld(screenX, screenY, worldPoint);
  const deltaX = worldPoint.x - matrix.tx; const deltaY = worldPoint.y - matrix.ty;
  localPoint.x = (matrix.d * deltaX - matrix.c * deltaY) * inverseDeterminant;
  localPoint.y = (-matrix.b * deltaX + matrix.a * deltaY) * inverseDeterminant;
  bounds[0] = Math.min(bounds[0], localPoint.x); bounds[1] = Math.min(bounds[1], localPoint.y);
  bounds[2] = Math.max(bounds[2], localPoint.x); bounds[3] = Math.max(bounds[3], localPoint.y);
}

function normalizeSolidTiles(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "function") return value;
  if (value instanceof Set) return value;
  throw new TypeError("TileMap solidTiles must be a Set or a predicate function.");
}

function isSolidTile(tileIndex, x, y, solidTiles) {
  if (tileIndex < 0) return false;
  return solidTiles === null ? true : typeof solidTiles === "function" ? solidTiles(tileIndex, x, y) === true : solidTiles.has(tileIndex);
}

function normalizeTileFlags(options) {
  if (options === undefined) return 0;
  if (options === null || typeof options !== "object") throw new TypeError("TileMap tile options must be an object.");
  return (options.flipX ? TILE_FLIP_X : 0) | (options.flipY ? TILE_FLIP_Y : 0);
}

// Tiled (https://www.mapeditor.org) JSON map import. Only the subset that maps
// losslessly onto a single-texture TileMap is accepted; everything else is
// rejected explicitly instead of being rendered wrong.
const TILED_FLIP_H = 0x80000000;
const TILED_FLIP_V = 0x40000000;
const TILED_FLIP_D = 0x20000000;
const TILED_ROTATE_HEX = 0x10000000;
const TILED_GID_MASK = 0x0fffffff;
const MAX_TILED_LAYERS = 1024;
const MAX_TILED_TILESETS = 256;
const MAX_TILED_TILE_RECORDS = 65_536;
const MAX_TILED_PROPERTIES = 256;
const MAX_TILED_NAME_LENGTH = 256;

function isTiledRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tiledPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Tiled ${label} must be a positive integer.`);
  return value;
}

function tiledFiniteNumber(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new RangeError(`Tiled ${label} must be a finite number.`);
  return value;
}

function tiledArray(value, limit, label) {
  if (!Array.isArray(value)) throw new TypeError(`Tiled ${label} must be an array.`);
  if (value.length > limit) throw new RangeError(`Tiled ${label} limit exceeded.`);
  return value;
}

function findTiledEntry(entries, selector, label, predicate = () => true) {
  if (selector === undefined) {
    for (const entry of entries) if (isTiledRecord(entry) && predicate(entry)) return entry;
    throw new RangeError(`Tiled map has no ${label}.`);
  }
  if (typeof selector === "number") {
    if (!Number.isSafeInteger(selector) || selector < 0 || selector >= entries.length) throw new RangeError(`Tiled ${label} index is out of range.`);
    const entry = entries[selector];
    if (!isTiledRecord(entry) || !predicate(entry)) throw new RangeError(`Tiled ${label} at index ${selector} is not supported.`);
    return entry;
  }
  if (typeof selector === "string" && selector.length <= MAX_TILED_NAME_LENGTH) {
    for (const entry of entries) if (isTiledRecord(entry) && entry.name === selector && predicate(entry)) return entry;
    throw new RangeError(`Tiled ${label} not found.`);
  }
  throw new TypeError(`Tiled ${label} selector must be an index or a name.`);
}

function resolveTiledTileset(map, selector) {
  const tilesets = tiledArray(map.tilesets, MAX_TILED_TILESETS, "tilesets");
  if (tilesets.length === 0) throw new RangeError("Tiled map has no tileset.");
  const tileset = findTiledEntry(tilesets, selector ?? 0, "tileset");
  const firstGid = tiledPositiveInteger(tileset.firstgid, "tileset firstgid");
  let endGid = TILED_GID_MASK + 1;
  for (const other of tilesets) {
    if (!isTiledRecord(other) || other === tileset) continue;
    const otherFirst = tiledPositiveInteger(other.firstgid, "tileset firstgid");
    if (otherFirst > firstGid && otherFirst < endGid) endGid = otherFirst;
  }
  if (tileset.tilecount !== undefined) endGid = Math.min(endGid, firstGid + tiledPositiveInteger(tileset.tilecount, "tileset tilecount"));
  if ((tileset.margin ?? 0) !== 0 || (tileset.spacing ?? 0) !== 0) throw new RangeError("Tiled tileset margin/spacing is not supported; export the tileset without margin and spacing.");
  if (tileset.tilewidth !== undefined && tileset.tilewidth !== map.tilewidth) throw new RangeError("Tiled tileset tilewidth must match the map tilewidth.");
  if (tileset.tileheight !== undefined && tileset.tileheight !== map.tileheight) throw new RangeError("Tiled tileset tileheight must match the map tileheight.");
  return { tileset, firstGid, endGid };
}

function decodeTiledGids(layer, count) {
  if (layer.chunks !== undefined) throw new RangeError("Tiled infinite (chunked) layers are not supported.");
  const data = layer.data;
  if (Array.isArray(data)) {
    if (data.length !== count) throw new RangeError("Tiled layer data size does not match the layer size.");
    const gids = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) {
      const value = data[index];
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError("Tiled layer gid is invalid.");
      gids[index] = value;
    }
    return gids;
  }
  if (typeof data === "string") {
    if (layer.encoding !== "base64") throw new RangeError("Tiled string layer data must use base64 encoding.");
    if (layer.compression !== undefined && layer.compression !== "") throw new RangeError("Tiled compressed layer data is not supported; export with uncompressed base64 or CSV.");
    if (data.length > 4 * Math.ceil((count * 4) / 3) + 16) throw new RangeError("Tiled layer data size does not match the layer size.");
    let binary;
    try { binary = atob(data.trim()); } catch { throw new RangeError("Tiled layer base64 data is invalid."); }
    if (binary.length !== count * 4) throw new RangeError("Tiled layer data size does not match the layer size.");
    const gids = new Uint32Array(count);
    for (let index = 0; index < count; index += 1) {
      const offset = index * 4;
      gids[index] = (binary.charCodeAt(offset) | (binary.charCodeAt(offset + 1) << 8) | (binary.charCodeAt(offset + 2) << 16) | (binary.charCodeAt(offset + 3) << 24)) >>> 0;
    }
    return gids;
  }
  throw new TypeError("Tiled layer data must be an array or a base64 string.");
}

function resetRenderItem(items, index) {
  let item = items[index];
  if (!item) {
    item = { texture: Texture.white, tint: 0xffffff, alpha: 1, positions: [], uvs: [] };
    items[index] = item;
  }
  item.positions.length = 0;
  item.uvs.length = 0;
  return item;
}

export class TileMap extends Node {
  constructor({ texture = Texture.white, tileWidth, tileHeight, columns, rows, staticCache = false, instanced = true, gpuCulling = true, cullTiles = true, ...options } = {}) {
    super({ name: "tilemap", ...options });
    if (!(texture instanceof Texture)) throw new TypeError("TileMap texture expected.");
    this.texture = texture;
    this.isBatch = true;
    this.tileWidth = Math.max(1, tileWidth | 0);
    this.tileHeight = Math.max(1, tileHeight | 0);
    this.columns = Math.max(1, columns | 0);
    this.rows = Math.max(1, rows | 0);
    if (this.columns * this.rows > MAX_TILE_COUNT) throw new RangeError("TileMap tile count limit exceeded.");
    this.tiles = new Int32Array(this.columns * this.rows);
    this.tiles.fill(-1);
    this.tileFlags = null;
    this.frameCache = new Map();
    this.renderItems = [];
    this.renderItemPool = [];
    this.renderItemsDirty = true;
    this.instanceItemsDirty = true;
    this.staticCache = Boolean(staticCache);
    this.staticKeyState = { version: 0, contentVersion: -1 };
    this.instanced = Boolean(instanced);
    this.gpuCulling = Boolean(gpuCulling) && this.instanced;
    this.cullTiles = cullTiles !== false;
    this.isInstancedBatch = this.instanced;
    this.contentVersion = 0;
    this.activeTileIndices = [];
    this.instanceData = this.instanced ? new Float32Array(0) : null;
    this.instanceView = this.instanced ? new Float32Array(0) : null;
    this.instanceItems = [];
    this.visibleTileIndices = this.instanced ? [] : null;
    this.lastCulledCount = 0;
    this.instanceItem = this.instanced ? { texture: this.texture, instanceData: null, instanceCount: 0, bounds: null, gpuCulling: false, instanceStride: INSTANCE_FLOATS, gpuSource: false } : null;
    this.instanceCacheContentVersion = -1;
    this.instanceCacheUseGpuCulling = false;
    this.instanceCacheWidth = 0;
    this.instanceCacheHeight = 0;
    this.instanceCacheCameraX = 0;
    this.instanceCacheCameraY = 0;
    this.instanceCacheZoom = 1;
    this.instanceCachePixelRatio = 1;
    this.instanceCacheRotation = 0;
    this.instanceCacheCameraWidth = 0;
    this.instanceCacheCameraHeight = 0;
    this.instanceCacheAlpha = 1;
    this.instanceCacheA = 1;
    this.instanceCacheB = 0;
    this.instanceCacheC = 0;
    this.instanceCacheD = 1;
    this.instanceCacheTx = 0;
    this.instanceCacheTy = 0;
    this.instanceWorldPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.instanceScreenPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.tileCullWorldPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.tileCullLocalPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.tileCullBounds = this.instanced ? new Float64Array(4) : null;
    this.instanceItemsKey = null;
    this.collisionRects = [];
    this.staticBodyControllers = new Set();
    this.bounds = { x: 0, y: 0, width: this.columns * this.tileWidth, height: this.rows * this.tileHeight };
    this.isRenderable = true;
  }

  static fromTiled(map, { texture, layer, tileset, ...options } = {}) {
    if (!isTiledRecord(map)) throw new TypeError("Tiled map must be an object.");
    if (!(texture instanceof Texture)) throw new TypeError("TileMap.fromTiled texture is required.");
    if (map.orientation !== undefined && map.orientation !== "orthogonal") throw new RangeError("Only orthogonal Tiled maps are supported.");
    if (map.infinite === true) throw new RangeError("Tiled infinite maps are not supported.");
    const columns = tiledPositiveInteger(map.width, "map width");
    const rows = tiledPositiveInteger(map.height, "map height");
    const tileWidth = tiledPositiveInteger(map.tilewidth, "map tilewidth");
    const tileHeight = tiledPositiveInteger(map.tileheight, "map tileheight");
    if (columns * rows > MAX_TILE_COUNT) throw new RangeError("TileMap tile count limit exceeded.");
    const layers = tiledArray(map.layers, MAX_TILED_LAYERS, "layers");
    const source = findTiledEntry(layers, layer, "tile layer", (entry) => entry.type === "tilelayer");
    if ((source.width !== undefined && source.width !== columns) || (source.height !== undefined && source.height !== rows)) throw new RangeError("Tiled layer size must match the map size.");
    const { firstGid, endGid } = resolveTiledTileset(map, tileset);
    const count = columns * rows;
    const gids = decodeTiledGids(source, count);
    const tiles = new Int32Array(count);
    let flagged = null;
    for (let index = 0; index < count; index += 1) {
      const gid = gids[index];
      if (gid === 0) { tiles[index] = -1; continue; }
      if (gid & (TILED_FLIP_D | TILED_ROTATE_HEX)) throw new RangeError("Tiled rotated (diagonal-flip) tiles are not supported.");
      const id = gid & TILED_GID_MASK;
      if (id < firstGid || id >= endGid) throw new RangeError("Tiled layer uses a tile from a different tileset.");
      tiles[index] = id - firstGid;
      if (gid & (TILED_FLIP_H | TILED_FLIP_V)) (flagged ??= []).push(index);
    }
    const offsetX = tiledFiniteNumber(source.offsetx, 0, "layer offsetx");
    const offsetY = tiledFiniteNumber(source.offsety, 0, "layer offsety");
    const opacity = tiledFiniteNumber(source.opacity, 1, "layer opacity");
    if (opacity < 0 || opacity > 1) throw new RangeError("Tiled layer opacity must be within 0..1.");
    const nodeOptions = {
      ...options,
      texture, tileWidth, tileHeight, columns, rows,
      x: tiledFiniteNumber(options.x, 0, "x option") + offsetX,
      y: tiledFiniteNumber(options.y, 0, "y option") + offsetY,
      alpha: tiledFiniteNumber(options.alpha, 1, "alpha option") * opacity,
      visible: options.visible !== false && source.visible !== false,
    };
    if (options.name === undefined && typeof source.name === "string" && source.name.length <= MAX_TILED_NAME_LENGTH) nodeOptions.name = source.name;
    const tileMap = new TileMap(nodeOptions);
    try {
      tileMap.setTiles(tiles);
      if (flagged) {
        for (const index of flagged) {
          const gid = gids[index];
          tileMap.setTile(index % columns, Math.floor(index / columns), tiles[index], { flipX: (gid & TILED_FLIP_H) !== 0, flipY: (gid & TILED_FLIP_V) !== 0 });
        }
      }
    } catch (error) {
      tileMap.destroy();
      throw error;
    }
    return tileMap;
  }

  static tiledTileIdsWithProperty(map, propertyName, { tileset, value = true } = {}) {
    if (!isTiledRecord(map)) throw new TypeError("Tiled map must be an object.");
    if (typeof propertyName !== "string" || propertyName.length === 0 || propertyName.length > MAX_TILED_NAME_LENGTH) throw new TypeError("Tiled property name is invalid.");
    const { tileset: record, firstGid, endGid } = resolveTiledTileset(map, tileset);
    const result = new Set();
    if (record.tiles === undefined) return result;
    for (const tile of tiledArray(record.tiles, MAX_TILED_TILE_RECORDS, "tileset tiles")) {
      if (!isTiledRecord(tile) || !Number.isSafeInteger(tile.id) || tile.id < 0 || firstGid + tile.id >= endGid) continue;
      if (tile.properties === undefined) continue;
      for (const property of tiledArray(tile.properties, MAX_TILED_PROPERTIES, "tile properties")) {
        if (isTiledRecord(property) && property.name === propertyName && property.value === value) { result.add(tile.id); break; }
      }
    }
    return result;
  }

  index(x, y) { return y * this.columns + x; }
  inBounds(x, y) { return Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= 0 && y >= 0 && x < this.columns && y < this.rows; }

  validateTileIndex(tileIndex) {
    const value = Number(tileIndex);
    if (!Number.isSafeInteger(value)) throw new RangeError("TileMap tile index is invalid.");
    if (value < 0) return value;
    const gridColumns = Math.floor(this.texture.sourceWidth / this.tileWidth);
    const gridRows = Math.floor(this.texture.sourceHeight / this.tileHeight);
    if (gridColumns <= 0 || gridRows <= 0 || value >= gridColumns * gridRows) throw new RangeError("TileMap tile index is out of bounds.");
    return value;
  }

  setTile(x, y, tileIndex, options) {
    if (!this.inBounds(x, y)) return this;
    const index = this.index(x, y);
    const next = this.validateTileIndex(tileIndex);
    const nextFlags = normalizeTileFlags(options);
    const currentFlags = this.tileFlags ? this.tileFlags[index] : 0;
    if (this.tiles[index] === next && currentFlags === nextFlags) return this;
    this.tiles[index] = next;
    if (nextFlags || this.tileFlags) {
      if (!this.tileFlags) this.tileFlags = new Uint8Array(this.tiles.length);
      this.tileFlags[index] = nextFlags;
    }
    this.renderItemsDirty = true;
    this.instanceItemsDirty = true;
    this.contentVersion += 1;
    return this;
  }

  getTile(x, y) { return this.inBounds(x, y) ? this.tiles[this.index(x, y)] : -1; }

  setTiles(values) {
    if (!ArrayBuffer.isView(values) && !Array.isArray(values)) throw new TypeError("TileMap data must be an array.");
    if (values.length !== this.tiles.length) throw new RangeError("TileMap data size does not match.");
    let changed = false;
    if (values instanceof Int32Array) {
      for (let index = 0; index < values.length; index += 1) {
        const next = this.validateTileIndex(values[index]);
        if (this.tiles[index] !== next) changed = true;
      }
      if (changed) this.tiles.set(values);
    } else {
      const normalized = new Int32Array(values.length);
      for (let index = 0; index < values.length; index += 1) normalized[index] = this.validateTileIndex(values[index]);
      for (let index = 0; index < normalized.length; index += 1) if (this.tiles[index] !== normalized[index]) { changed = true; break; }
      if (changed) this.tiles.set(normalized);
    }
    if (changed) { this.renderItemsDirty = true; this.instanceItemsDirty = true; this.contentVersion += 1; }
    return this;
  }

  setRegion(x, y, width, height, values) {
    const left = Number(x); const top = Number(y); const regionWidth = Number(width); const regionHeight = Number(height);
    if (![left, top, regionWidth, regionHeight].every(Number.isSafeInteger) || left < 0 || top < 0 || regionWidth <= 0 || regionHeight <= 0 || left + regionWidth > this.columns || top + regionHeight > this.rows) throw new RangeError("TileMap region is out of bounds.");
    if (!ArrayBuffer.isView(values) && !Array.isArray(values)) throw new TypeError("TileMap region data must be an array.");
    const area = regionWidth * regionHeight;
    if (values.length !== area) throw new RangeError("TileMap region data size does not match.");
    const directValues = ArrayBuffer.isView(values);
    const normalized = directValues ? null : new Int32Array(area);
    for (let index = 0; index < area; index += 1) {
      const next = this.validateTileIndex(values[index]);
      if (normalized) normalized[index] = next;
    }
    let changed = false;
    for (let row = 0; row < regionHeight; row += 1) {
      const sourceOffset = row * regionWidth;
      const targetOffset = (top + row) * this.columns + left;
      for (let column = 0; column < regionWidth; column += 1) if (this.tiles[targetOffset + column] !== (normalized ? normalized[sourceOffset + column] : values[sourceOffset + column])) changed = true;
    }
    if (!changed) return this;
    for (let row = 0; row < regionHeight; row += 1) {
      const sourceOffset = row * regionWidth;
      const targetOffset = (top + row) * this.columns + left;
      for (let column = 0; column < regionWidth; column += 1) this.tiles[targetOffset + column] = normalized ? normalized[sourceOffset + column] : values[sourceOffset + column];
    }
    this.renderItemsDirty = true;
    this.instanceItemsDirty = true;
    this.contentVersion += 1;
    return this;
  }

  rebuild() {
    this.renderItemsDirty = true;
    this.instanceItemsDirty = true;
    this.contentVersion += 1;
    return this;
  }

  getCollisionRects(solidTiles = null, out = this.collisionRects) {
    const predicate = normalizeSolidTiles(solidTiles);
    if (!Array.isArray(out)) throw new TypeError("TileMap collision rect output array is required.");
    out.length = 0;
    let active = new Map();
    for (let row = 0; row < this.rows; row += 1) {
      const current = new Map();
      let runStart = NONE;
      const flushRun = (end) => {
        if (runStart === NONE) return;
        const runWidth = end - runStart;
        let widths = current.get(runStart);
        if (!widths) { widths = new Map(); current.set(runStart, widths); }
        const previous = active.get(runStart)?.get(runWidth);
        const y = row * this.tileHeight;
        const rect = previous && previous.y + previous.height === y
          ? previous
          : { x: runStart * this.tileWidth, y, width: runWidth * this.tileWidth, height: this.tileHeight };
        if (previous) rect.height += this.tileHeight;
        widths.set(runWidth, rect);
        runStart = NONE;
      };
      for (let column = 0; column <= this.columns; column += 1) {
        const tileIndex = column < this.columns ? this.tiles[row * this.columns + column] : -1;
        if (column < this.columns && isSolidTile(tileIndex, column, row, predicate)) {
          if (runStart === NONE) runStart = column;
        } else flushRun(column);
      }
      for (const [x, widths] of active) for (const [width, rect] of widths) if (!current.get(x)?.has(width)) out.push(rect);
      active = current;
    }
    for (const widths of active.values()) for (const rect of widths.values()) out.push(rect);
    return out;
  }

  createStaticBodies(physicsWorld, { solidTiles = null, tag = "tilemap", layer = 1, mask = 0xFFFFFFFF } = {}) {
    if (!physicsWorld || typeof physicsWorld.add !== "function" || typeof physicsWorld.remove !== "function") throw new TypeError("TileMap PhysicsWorld is required.");
    if (this.destroyed) throw new Error("TileMap has been destroyed.");
    const predicate = normalizeSolidTiles(solidTiles);
    const tileMap = this;
    const controller = {
      tileMap,
      physicsWorld,
      bodies: [],
      nodes: [],
      destroyed: false,
      rebuild() {
        if (this.destroyed || tileMap.destroyed) throw new Error("TileMap collision controller has been destroyed.");
        const rects = tileMap.getCollisionRects(predicate);
        const nextNodes = [];
        const nextBodies = [];
        try {
          for (const rect of rects) {
            const node = new Node({ name: `${tileMap.name}-collision`, x: rect.x, y: rect.y });
            node.width = rect.width;
            node.height = rect.height;
            tileMap.add(node);
            nextNodes.push(node);
            nextBodies.push(new PhysicsBody(node, { static: true, tag, layer, mask }));
          }
        } catch (error) {
          for (const node of nextNodes) node.destroy();
          throw error;
        }
        const previousBodies = this.bodies.slice();
        const previousNodes = this.nodes.slice();
        for (const body of previousBodies) physicsWorld.remove(body);
        let added = 0;
        try {
          for (; added < nextBodies.length; added += 1) physicsWorld.add(nextBodies[added]);
        } catch (error) {
          for (let index = 0; index < added; index += 1) physicsWorld.remove(nextBodies[index]);
          for (const node of nextNodes) node.destroy();
          for (const body of previousBodies) physicsWorld.add(body);
          throw error;
        }
        for (const node of previousNodes) node.destroy();
        this.bodies.length = 0; this.bodies.push(...nextBodies);
        this.nodes.length = 0; this.nodes.push(...nextNodes);
        return this;
      },
      destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const body of this.bodies) physicsWorld.remove(body);
        for (const node of this.nodes) node.destroy();
        this.bodies.length = 0;
        this.nodes.length = 0;
        tileMap.staticBodyControllers.delete(this);
      },
    };
    this.staticBodyControllers.add(controller);
    try { return controller.rebuild(); }
    catch (error) { controller.destroy(); throw error; }
  }

  getStaticRenderKey(camera, width, height) {
    if (!this.staticCache || this.instanced) return null;
    return updateStaticRenderKey(this.staticKeyState, this.contentVersion, camera, width, height, this.worldMatrix, this.renderClip, this.worldAlpha, this.worldFilter, this.worldFilterAmount, this.worldMaskTexture, this.worldMaskRect, this.texture?.baseTexture?.version ?? -1);
  }

  hasInstanceCache(camera, width, height, useGpuCulling) {
    if (this.instanceCacheContentVersion !== this.contentVersion || this.instanceCacheUseGpuCulling !== useGpuCulling) return false;
    if (this.instanceCacheAlpha !== (Number.isFinite(Number(this.worldAlpha)) ? this.worldAlpha : 1)) return false;
    if (useGpuCulling) return true;
    const matrix = this.worldMatrix;
    return this.instanceCacheWidth === width && this.instanceCacheHeight === height
      && this.instanceCacheCameraX === camera.position.x && this.instanceCacheCameraY === camera.position.y
      && this.instanceCacheZoom === camera.zoom && this.instanceCachePixelRatio === (camera.pixelRatio || 1) && this.instanceCacheRotation === camera.rotation
      && this.instanceCacheCameraWidth === camera.width && this.instanceCacheCameraHeight === camera.height
      && this.instanceCacheViewportX === (camera.viewportX || 0) && this.instanceCacheViewportY === (camera.viewportY || 0)
      && this.instanceCacheViewportWidth === (camera.viewportWidth || camera.width) && this.instanceCacheViewportHeight === (camera.viewportHeight || camera.height)
      && this.instanceCacheA === matrix.a && this.instanceCacheB === matrix.b && this.instanceCacheC === matrix.c
      && this.instanceCacheD === matrix.d && this.instanceCacheTx === matrix.tx && this.instanceCacheTy === matrix.ty;
  }

  saveInstanceCache(camera, width, height, useGpuCulling) {
    this.instanceCacheContentVersion = this.contentVersion;
    this.instanceCacheUseGpuCulling = useGpuCulling;
    this.instanceCacheAlpha = Number.isFinite(Number(this.worldAlpha)) ? this.worldAlpha : 1;
    if (useGpuCulling) return;
    const matrix = this.worldMatrix;
    this.instanceCacheWidth = width; this.instanceCacheHeight = height;
    this.instanceCacheCameraX = camera.position.x; this.instanceCacheCameraY = camera.position.y;
    this.instanceCacheZoom = camera.zoom; this.instanceCachePixelRatio = camera.pixelRatio || 1; this.instanceCacheRotation = camera.rotation;
    this.instanceCacheCameraWidth = camera.width; this.instanceCacheCameraHeight = camera.height;
    this.instanceCacheViewportX = camera.viewportX || 0; this.instanceCacheViewportY = camera.viewportY || 0;
    this.instanceCacheViewportWidth = camera.viewportWidth || camera.width; this.instanceCacheViewportHeight = camera.viewportHeight || camera.height;
    this.instanceCacheA = matrix.a; this.instanceCacheB = matrix.b; this.instanceCacheC = matrix.c; this.instanceCacheD = matrix.d; this.instanceCacheTx = matrix.tx; this.instanceCacheTy = matrix.ty;
  }

  getVisibleTileIndices(camera, width, height) {
    const visible = this.visibleTileIndices;
    visible.length = 0;
    if (!camera || this.cullable === false || !this.cullTiles) return this.activeTileIndices;
    const matrix = this.worldMatrix;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return this.activeTileIndices;
    const worldPoint = this.tileCullWorldPoint;
    const localPoint = this.tileCullLocalPoint;
    const bounds = this.tileCullBounds;
    bounds[0] = Infinity; bounds[1] = Infinity; bounds[2] = -Infinity; bounds[3] = -Infinity;
    const viewportWidth = Number.isFinite(Number(width)) && width > 0 ? width : camera.width;
    const viewportHeight = Number.isFinite(Number(height)) && height > 0 ? height : camera.height;
    const inverseDeterminant = 1 / determinant;
    includeTileCullCorner(camera, matrix, 0, 0, worldPoint, localPoint, inverseDeterminant, bounds);
    includeTileCullCorner(camera, matrix, viewportWidth, 0, worldPoint, localPoint, inverseDeterminant, bounds);
    includeTileCullCorner(camera, matrix, viewportWidth, viewportHeight, worldPoint, localPoint, inverseDeterminant, bounds);
    includeTileCullCorner(camera, matrix, 0, viewportHeight, worldPoint, localPoint, inverseDeterminant, bounds);
    const minColumn = Math.max(0, Math.floor(bounds[0] / this.tileWidth));
    const maxColumn = Math.min(this.columns - 1, Math.ceil(bounds[2] / this.tileWidth) - 1);
    const minRow = Math.max(0, Math.floor(bounds[1] / this.tileHeight));
    const maxRow = Math.min(this.rows - 1, Math.ceil(bounds[3] / this.tileHeight) - 1);
    if (minColumn > maxColumn || minRow > maxRow) return visible;
    for (let row = minRow; row <= maxRow; row += 1) {
      const start = row * this.columns + minColumn;
      const end = row * this.columns + maxColumn;
      for (let index = start; index <= end; index += 1) if (this.tiles[index] >= 0) visible.push(index);
    }
    return visible;
  }

  getInstanceItems(camera, width, height, { gpuCulling = false, alpha = this.worldAlpha } = {}) {
    if (this.destroyed) { this.instanceItems.length = 0; this.lastCulledCount = 0; return this.instanceItems; }
    const renderAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
    const useGpuCulling = this.gpuCulling && gpuCulling;
    if (!this.instanceItemsDirty && this.hasInstanceCache(camera, width, height, useGpuCulling)) { this.lastCulledCount = 0; return this.instanceItems; }
    if (this.instanceItemsDirty) {
      this.activeTileIndices.length = 0;
      for (let index = 0; index < this.tiles.length; index += 1) if (this.tiles[index] >= 0) this.activeTileIndices.push(index);
      this.instanceItemsDirty = false;
    }
    const indices = useGpuCulling ? this.activeTileIndices : this.getVisibleTileIndices(camera, width, height);
    this.lastCulledCount = this.activeTileIndices.length - indices.length;
    const count = indices.length;
    if (!count) { this.instanceItems.length = 0; this.saveInstanceCache(camera, width, height, useGpuCulling); return this.instanceItems; }
    const stride = useGpuCulling ? GPU_SOURCE_FLOATS : INSTANCE_FLOATS;
    const required = count * stride;
    const capacity = this.activeTileIndices.length * stride;
    if (this.instanceData.length < capacity) this.instanceData = new Float32Array(Math.max(capacity, this.instanceData.length * 2, stride));
    const data = this.instanceData;
    if (this.instanceView.length !== required || this.instanceView.buffer !== data.buffer) this.instanceView = data.subarray(0, required);
    const worldPoint = this.instanceWorldPoint;
    const screenPoint = this.instanceScreenPoint;
    for (let index = 0; index < count; index += 1) {
      const tileIndex = indices[index];
      const tile = this.tiles[tileIndex];
      const tileX = tileIndex % this.columns;
      const tileY = Math.floor(tileIndex / this.columns);
      const x = tileX * this.tileWidth;
      const y = tileY * this.tileHeight;
      const frame = this.getFrame(tile);
      const flags = this.tileFlags ? this.tileFlags[tileIndex] : 0;
      const u0 = flags & TILE_FLIP_X ? frame.u1 : frame.u0;
      const u1 = flags & TILE_FLIP_X ? frame.u0 : frame.u1;
      const v0 = flags & TILE_FLIP_Y ? frame.v1 : frame.v0;
      const v1 = flags & TILE_FLIP_Y ? frame.v0 : frame.v1;
      const offset = index * stride;
      if (useGpuCulling) {
        data[offset] = x; data[offset + 1] = y; data[offset + 2] = this.tileWidth; data[offset + 3] = this.tileHeight;
        data[offset + 4] = 0; data[offset + 5] = 0; data[offset + 6] = 0; data[offset + 7] = renderAlpha;
        data[offset + 8] = u0; data[offset + 9] = v0; data[offset + 10] = u1; data[offset + 11] = v1;
        data[offset + 12] = 1; data[offset + 13] = 1; data[offset + 14] = 1; data[offset + 15] = 0;
        continue;
      }
      writeTilePoint(this.worldMatrix, camera, worldPoint, screenPoint, data, offset, x, y);
      writeTilePoint(this.worldMatrix, camera, worldPoint, screenPoint, data, offset + 2, x + this.tileWidth, y);
      writeTilePoint(this.worldMatrix, camera, worldPoint, screenPoint, data, offset + 4, x, y + this.tileHeight);
      data[offset + 2] -= data[offset]; data[offset + 3] -= data[offset + 1];
      data[offset + 4] -= data[offset]; data[offset + 5] -= data[offset + 1];
      data[offset + 6] = u0; data[offset + 7] = v0; data[offset + 8] = u1; data[offset + 9] = v1;
        data[offset + 10] = 1; data[offset + 11] = 1; data[offset + 12] = 1; data[offset + 13] = renderAlpha;
    }
    const item = this.instanceItems[0] || this.instanceItem;
    item.texture = this.texture; item.instanceData = this.instanceView; item.instanceCount = count; item.bounds = this.getLocalBounds(); item.gpuCulling = useGpuCulling; item.instanceStride = stride; item.gpuSource = useGpuCulling;
    this.instanceItems[0] = item; this.instanceItems.length = 1; this.saveInstanceCache(camera, width, height, useGpuCulling);
    return this.instanceItems;
  }

  getFrame(tileIndex) {
    const gridColumns = Math.floor(this.texture.sourceWidth / this.tileWidth);
    if (gridColumns <= 0) throw new RangeError("TileMap texture tile grid is invalid.");
    const frameX = (tileIndex % gridColumns) * this.tileWidth;
    const frameY = Math.floor(tileIndex / gridColumns) * this.tileHeight;
    const textureVersion = this.texture?.baseTexture?.version ?? this.texture?.version ?? 0;
    const frameKey = `${textureUid(this.texture)}:${textureVersion}:${gridColumns}:${this.tileWidth}:${this.tileHeight}:${tileIndex}`;
    let frame = this.frameCache.get(frameKey);
    if (!frame) {
      frame = this.texture.subTexture({ x: frameX, y: frameY, width: this.tileWidth, height: this.tileHeight, id: `${this.texture.id}:${frameX}:${frameY}:${this.tileWidth}:${this.tileHeight}` });
      this.frameCache.set(frameKey, frame);
    }
    return frame;
  }

  getRenderItems() {
    if (this.destroyed) { this.renderItems.length = 0; return this.renderItems; }
    if (!this.renderItemsDirty) return this.renderItems;
    const renderItems = this.renderItems;
    let itemIndex = 0;
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.columns; x += 1) {
        const tileIndex = this.tiles[this.index(x, y)];
        if (tileIndex < 0) continue;
        const frame = this.getFrame(tileIndex);
        const flags = this.tileFlags ? this.tileFlags[this.index(x, y)] : 0;
        const u0 = flags & TILE_FLIP_X ? frame.u1 : frame.u0;
        const u1 = flags & TILE_FLIP_X ? frame.u0 : frame.u1;
        const v0 = flags & TILE_FLIP_Y ? frame.v1 : frame.v0;
        const v1 = flags & TILE_FLIP_Y ? frame.v0 : frame.v1;
        const left = x * this.tileWidth;
        const top = y * this.tileHeight;
        const item = resetRenderItem(this.renderItemPool, itemIndex);
        renderItems[itemIndex++] = item;
        item.texture = frame;
        item.tint = 0xffffff;
        item.alpha = 1;
        item.positions.push(left, top, left + this.tileWidth, top, left + this.tileWidth, top + this.tileHeight, left, top, left + this.tileWidth, top + this.tileHeight, left, top + this.tileHeight);
        item.uvs.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      }
    }
    renderItems.length = itemIndex;
    this.renderItemsDirty = false;
    return renderItems;
  }

  getLocalBounds() { return this.bounds; }

  destroy() {
    for (const controller of this.staticBodyControllers) controller.destroy();
    this.staticBodyControllers.clear();
    for (const frame of this.frameCache.values()) frame.destroy();
    this.frameCache.clear();
    this.renderItems.length = 0;
    this.renderItemPool.length = 0;
    this.instanceItems.length = 0;
    if (this.visibleTileIndices) this.visibleTileIndices.length = 0;
    this.instanceData = null;
    this.instanceView = null;
    this.tileFlags = null;
    this.instanceItem = null;
    this.collisionRects.length = 0;
    super.destroy();
  }
}
