import { Vec2, MAX_WORLD_COORDINATE, worldValue } from "./math.js";

function transformedBounds(node, output = null, localBounds = null) {
  const bounds = localBounds || node.getLocalBounds?.();
  const x = Number.isFinite(Number(bounds?.x)) ? Number(bounds.x) : 0;
  const y = Number.isFinite(Number(bounds?.y)) ? Number(bounds.y) : 0;
  const width = Number.isFinite(Number(bounds?.width)) ? Number(bounds.width) : (Number.isFinite(Number(node.width)) ? Number(node.width) : 0);
  const height = Number.isFinite(Number(bounds?.height)) ? Number(bounds.height) : (Number.isFinite(Number(node.height)) ? Number(node.height) : 0);
  const right = x + width;
  const bottom = y + height;
  const matrix = node.worldMatrix;
  const x0 = matrix.a * x + matrix.c * y + matrix.tx;
  const y0 = matrix.b * x + matrix.d * y + matrix.ty;
  const x1 = matrix.a * right + matrix.c * y + matrix.tx;
  const y1 = matrix.b * right + matrix.d * y + matrix.ty;
  const x2 = matrix.a * right + matrix.c * bottom + matrix.tx;
  const y2 = matrix.b * right + matrix.d * bottom + matrix.ty;
  const x3 = matrix.a * x + matrix.c * bottom + matrix.tx;
  const y3 = matrix.b * x + matrix.d * bottom + matrix.ty;
  const left = Math.min(x0, x1, x2, x3);
  const top = Math.min(y0, y1, y2, y3);
  const maxX = Math.max(x0, x1, x2, x3);
  const maxY = Math.max(y0, y1, y2, y3);
  const result = output || { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  result.x = left;
  result.y = top;
  result.left = left;
  result.top = top;
  result.right = maxX;
  result.bottom = maxY;
  result.width = maxX - left;
  result.height = maxY - top;
  return result;
}

const acceptCollider = () => true;
const acceptPhysicsBody = () => true;
const DEFAULT_COLLISION_CELL_SIZE = 128;
const MIN_COLLISION_CELL_SIZE = 16;
const MAX_COLLISION_CELL_SIZE = 4_096;
const MAX_COLLISION_CELLS = 4_096;
const MAX_RAY_DISTANCE = 1_000_000;
const RAY_BOUNDS_EPSILON = 1e-7;
const RAY_DIRECTION_EPSILON = 1e-12;
const MAX_PHYSICS_BODIES = 10_000;
const MAX_PHYSICS_DELTA = 0.25;
const PHYSICS_SUBSTEP_DELTA = 1 / 60;
const MAX_PHYSICS_SUBSTEPS = 16;
const MAX_PHYSICS_SPEED = 100_000;
const MAX_PHYSICS_GRAVITY_SCALE = 16;
const MAX_COLLISION_BITS = 0xFFFFFFFF;
const ONE_WAY_EPSILON = 1e-7;
const KINEMATIC_CONTACT_EPSILON = 1e-5;

function boundedPhysics(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function normalizeCollisionBits(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_COLLISION_BITS) throw new RangeError(`Collider ${label} 32-bit unsigned integer olmalı.`);
  return number >>> 0;
}

function normalizeOneWay(value) {
  if (value === null || value === undefined) return null;
  if (value === "up" || value === "down" || value === "left" || value === "right") return value;
  throw new TypeError("Collider oneWay up, down, left veya right olmalı.");
}

function normalizeContactHandler(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "function") throw new TypeError(`${label} callback fonksiyonu gerekli.`);
  return value;
}

function writePhysicsContact(contact, body, other, phase) {
  const first = body.collider.bounds;
  const second = other.collider.bounds;
  const overlapX = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const overlapY = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  const firstCenterX = (first.left + first.right) * 0.5;
  const firstCenterY = (first.top + first.bottom) * 0.5;
  const secondCenterX = (second.left + second.right) * 0.5;
  const secondCenterY = (second.top + second.bottom) * 0.5;
  const normal = contact.normal;
  contact.body = body;
  contact.other = other;
  contact.phase = phase;
  if (overlapX >= 0 && overlapY >= 0 && overlapX <= overlapY) {
    normal.x = secondCenterX >= firstCenterX ? 1 : -1;
    normal.y = 0;
    contact.penetration = overlapX;
  } else if (overlapX >= 0 && overlapY >= 0) {
    normal.x = 0;
    normal.y = secondCenterY >= firstCenterY ? 1 : -1;
    contact.penetration = overlapY;
  } else if (Math.abs(secondCenterX - firstCenterX) >= Math.abs(secondCenterY - firstCenterY)) {
    normal.x = secondCenterX >= firstCenterX ? 1 : -1;
    normal.y = 0;
    contact.penetration = 0;
  } else {
    normal.x = 0;
    normal.y = secondCenterY >= firstCenterY ? 1 : -1;
    contact.penetration = 0;
  }
  return contact;
}

function normalizeColliderBounds(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Collider bounds nesnesi gerekli.");
  const x = Number(value.x); const y = Number(value.y); const width = Number(value.width); const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || Math.abs(x) > MAX_WORLD_COORDINATE || Math.abs(y) > MAX_WORLD_COORDINATE || width <= 0 || height <= 0 || width > MAX_WORLD_COORDINATE || height > MAX_WORLD_COORDINATE) throw new RangeError("Collider bounds finite ve sınırlı bir dikdörtgen olmalı.");
  return { x: worldValue(x), y: worldValue(y), width, height };
}

function canCollide(first, second) {
  return (first.mask & second.layer) !== 0 && (second.mask & first.layer) !== 0;
}

function intersectRayAABB(originX, originY, directionX, directionY, maxDistance, bounds, output) {
  let enter = 0;
  let exit = maxDistance;
  let normalX = 0;
  let normalY = 0;
  if (Math.abs(directionX) <= RAY_DIRECTION_EPSILON) {
    if (originX < bounds.left || originX > bounds.right) return false;
  } else {
    let first = (bounds.left - originX) / directionX;
    let second = (bounds.right - originX) / directionX;
    let firstNormal = directionX > 0 ? -1 : 1;
    if (first > second) { const value = first; first = second; second = value; firstNormal = -firstNormal; }
    if (first > enter) { enter = first; normalX = firstNormal; normalY = 0; }
    if (second < exit) exit = second;
    if (enter > exit) return false;
  }
  if (Math.abs(directionY) <= RAY_DIRECTION_EPSILON) {
    if (originY < bounds.top || originY > bounds.bottom) return false;
  } else {
    let first = (bounds.top - originY) / directionY;
    let second = (bounds.bottom - originY) / directionY;
    let firstNormal = directionY > 0 ? -1 : 1;
    if (first > second) { const value = first; first = second; second = value; firstNormal = -firstNormal; }
    if (first > enter) { enter = first; normalX = 0; normalY = firstNormal; }
    if (second < exit) exit = second;
    if (enter > exit) return false;
  }
  output.distance = enter;
  output.normalX = normalX;
  output.normalY = normalY;
  return true;
}

function validateCellSize(value) {
  if (!Number.isFinite(value) || value < MIN_COLLISION_CELL_SIZE || value > MAX_COLLISION_CELL_SIZE) throw new RangeError(`CollisionWorld cellSize ${MIN_COLLISION_CELL_SIZE}-${MAX_COLLISION_CELL_SIZE} arasında olmalı.`);
  return value;
}

export function getAABB(node, output = null) { return transformedBounds(node, output); }

export function intersectsAABB(first, second) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

export function pointInAABB(bounds, x, y) {
  if (!bounds) return false;
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  const left = Number.isFinite(Number(bounds.left)) ? Number(bounds.left) : (Number(bounds.x) || 0);
  const top = Number.isFinite(Number(bounds.top)) ? Number(bounds.top) : (Number(bounds.y) || 0);
  const right = Number.isFinite(Number(bounds.right)) ? Number(bounds.right) : left + (Number(bounds.width) || 0);
  const bottom = Number.isFinite(Number(bounds.bottom)) ? Number(bounds.bottom) : top + (Number(bounds.height) || 0);
  return px >= left && px <= right && py >= top && py <= bottom;
}

export function containsAABB(parent, child) {
  if (!parent || !child) return false;
  const pLeft = Number.isFinite(Number(parent.left)) ? Number(parent.left) : (Number(parent.x) || 0);
  const pTop = Number.isFinite(Number(parent.top)) ? Number(parent.top) : (Number(parent.y) || 0);
  const pRight = Number.isFinite(Number(parent.right)) ? Number(parent.right) : pLeft + (Number(parent.width) || 0);
  const pBottom = Number.isFinite(Number(parent.bottom)) ? Number(parent.bottom) : pTop + (Number(parent.height) || 0);

  const cLeft = Number.isFinite(Number(child.left)) ? Number(child.left) : (Number(child.x) || 0);
  const cTop = Number.isFinite(Number(child.top)) ? Number(child.top) : (Number(child.y) || 0);
  const cRight = Number.isFinite(Number(child.right)) ? Number(child.right) : cLeft + (Number(child.width) || 0);
  const cBottom = Number.isFinite(Number(child.bottom)) ? Number(child.bottom) : cTop + (Number(child.height) || 0);

  return cLeft >= pLeft && cRight <= pRight && cTop >= pTop && cBottom <= pBottom;
}

export class Collider {
  constructor(node, { tag = "default", isTrigger = false, oneWay = null, layer = 1, mask = MAX_COLLISION_BITS, bounds = null } = {}) {
    if (!node || node.destroyed === true) throw new TypeError("Collider canlı bir Node ister.");
    this.node = node;
    this.tag = tag;
    this.isTrigger = isTrigger;
    this.oneWay = normalizeOneWay(oneWay);
    this._localBounds = normalizeColliderBounds(bounds);
    this._layer = normalizeCollisionBits(layer, "layer");
    this._mask = normalizeCollisionBits(mask, "mask");
    this._enabled = true;
    this._worlds = new Set();
    this._bounds = null;
    this._boundsWorldVersion = -1;
    this._boundsX = NaN;
    this._boundsY = NaN;
    this._boundsWidth = NaN;
    this._boundsHeight = NaN;
  }

  setBounds(bounds = null) {
    this._localBounds = normalizeColliderBounds(bounds);
    this._boundsWorldVersion = -1;
    this._boundsX = NaN;
    this._boundsY = NaN;
    this._boundsWidth = NaN;
    this._boundsHeight = NaN;
    for (const world of this._worlds) world.spatialDirty = true;
    return this;
  }

  get layer() { return this._layer; }
  set layer(value) { this._layer = normalizeCollisionBits(value, "layer"); }
  get mask() { return this._mask; }
  set mask(value) { this._mask = normalizeCollisionBits(value, "mask"); }
  get enabled() { return this._enabled; }
  set enabled(value) {
    const next = Boolean(value);
    if (next === this._enabled) return;
    this._enabled = next;
    for (const world of this._worlds) world.spatialDirty = true;
  }

  get bounds() {
    const localBounds = this._localBounds || this.node.getLocalBounds?.() || null;
    const localX = Number.isFinite(Number(localBounds?.x)) ? Number(localBounds.x) : 0;
    const localY = Number.isFinite(Number(localBounds?.y)) ? Number(localBounds.y) : 0;
    const localWidth = Number.isFinite(Number(localBounds?.width)) ? Number(localBounds.width) : (Number.isFinite(Number(this.node.width)) ? Number(this.node.width) : 0);
    const localHeight = Number.isFinite(Number(localBounds?.height)) ? Number(localBounds.height) : (Number.isFinite(Number(this.node.height)) ? Number(this.node.height) : 0);
    const worldVersion = Number.isSafeInteger(this.node._worldVersion) ? this.node._worldVersion : 0;
    if (!this._bounds || this._boundsWorldVersion !== worldVersion || this._boundsX !== localX || this._boundsY !== localY || this._boundsWidth !== localWidth || this._boundsHeight !== localHeight) {
      this._bounds = transformedBounds(this.node, this._bounds, localBounds);
      this._boundsWorldVersion = worldVersion;
      this._boundsX = localX;
      this._boundsY = localY;
      this._boundsWidth = localWidth;
      this._boundsHeight = localHeight;
    }
    return this._bounds;
  }
}

export class CollisionWorld {
  constructor(options = {}) {
    if (options === null || typeof options !== "object") throw new TypeError("CollisionWorld seçenekleri nesne olmalı.");
    this.colliders = new Set();
    this.spatial = Boolean(options.spatial);
    this.autoSync = options.autoSync === true;
    this.cellSize = validateCellSize(options.cellSize ?? DEFAULT_COLLISION_CELL_SIZE);
    this.spatialIndex = new Map();
    this.spatialBounds = new Map();
    this.spatialSnapshots = new Map();
    this.spatialCellRecords = new Map();
    this.largeColliders = [];
    this.spatialDirty = true;
    this.queryToken = 0;
    this.candidateStamp = new Map();
    this.raycastCandidates = [];
    this.raycastBounds = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.raycastCandidateHit = { distance: 0, normalX: 0, normalY: 0 };
    this.raycastResult = { collider: null, distance: 0, point: { x: 0, y: 0 }, normal: { x: 0, y: 0 } };
    this.circleCandidates = [];
    this.circleBounds = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  add(collider) {
    if (!(collider instanceof Collider)) throw new TypeError("Collider bekleniyor.");
    if (collider.node?.destroyed === true) throw new TypeError("Collider yok edilmiş Node’a bağlı olamaz.");
    if (this.colliders.has(collider)) return collider;
    this.colliders.add(collider);
    collider._worlds.add(this);
    this.spatialDirty = true;
    return collider;
  }

  remove(collider) {
    const removed = this.colliders.delete(collider);
    if (removed) {
      collider._worlds.delete(this);
      if (this.spatial && !this.spatialDirty) this._removeSpatialIndex(collider);
      this.spatialCellRecords.delete(collider);
      this.spatialSnapshots.delete(collider);
      this.spatialDirty = true;
    }
    return removed;
  }

  _removeSpatialIndex(collider) {
    const cells = this.spatialCellRecords.get(collider);
    if (cells) {
      for (let index = 0; index < cells.length; index += 2) {
        const cellX = cells[index];
        const cellY = cells[index + 1];
        const column = this.spatialIndex.get(cellX);
        const cell = column?.get(cellY);
        if (!cell) continue;
        const cellIndex = cell.indexOf(collider);
        if (cellIndex >= 0) {
          const last = cell.pop();
          if (cellIndex < cell.length) cell[cellIndex] = last;
        }
        if (cell.length === 0) {
          column.delete(cellY);
          if (column.size === 0) this.spatialIndex.delete(cellX);
        }
      }
      cells.length = 0;
    }
    const largeIndex = this.largeColliders.indexOf(collider);
    if (largeIndex >= 0) {
      const last = this.largeColliders.pop();
      if (largeIndex < this.largeColliders.length) this.largeColliders[largeIndex] = last;
    }
    this.spatialBounds.delete(collider);
    this.spatialSnapshots.delete(collider);
  }

  _indexSpatialCollider(collider) {
    if (!collider.enabled || collider.node?.destroyed === true) return;
    const bounds = collider.bounds;
    this.spatialBounds.set(collider, bounds);
    let snapshot = this.spatialSnapshots.get(collider);
    if (!snapshot) {
      snapshot = { worldVersion: 0, x: 0, y: 0, width: 0, height: 0 };
      this.spatialSnapshots.set(collider, snapshot);
    }
    snapshot.worldVersion = collider._boundsWorldVersion;
    snapshot.x = collider._boundsX;
    snapshot.y = collider._boundsY;
    snapshot.width = collider._boundsWidth;
    snapshot.height = collider._boundsHeight;
    let cells = this.spatialCellRecords.get(collider);
    if (!cells) { cells = []; this.spatialCellRecords.set(collider, cells); }
    cells.length = 0;
    const minX = Math.floor(bounds.left / this.cellSize);
    const maxX = Math.floor(bounds.right / this.cellSize);
    const minY = Math.floor(bounds.top / this.cellSize);
    const maxY = Math.floor(bounds.bottom / this.cellSize);
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (!Number.isFinite(cellCount) || cellCount > MAX_COLLISION_CELLS) {
      this.largeColliders.push(collider);
      return;
    }
    for (let cellY = minY; cellY <= maxY; cellY += 1) for (let cellX = minX; cellX <= maxX; cellX += 1) {
      let column = this.spatialIndex.get(cellX);
      if (!column) { column = new Map(); this.spatialIndex.set(cellX, column); }
      let cell = column.get(cellY);
      if (!cell) { cell = []; column.set(cellY, cell); }
      cell.push(collider);
      cells.push(cellX, cellY);
    }
  }

  syncCollider(collider) {
    if (!this.spatial || this.spatialDirty || !this.colliders.has(collider)) return this;
    this._removeSpatialIndex(collider);
    this._indexSpatialCollider(collider);
    return this;
  }

  rebuild() {
    if (!this.spatial) return this;
    this.spatialIndex.clear();
    this.spatialBounds.clear();
    this.spatialSnapshots.clear();
    this.spatialCellRecords.clear();
    this.largeColliders.length = 0;
    this.candidateStamp.clear();
    for (const collider of this.colliders) this._indexSpatialCollider(collider);
    this.spatialDirty = false;
    return this;
  }

  hasSpatialChanges() {
    if (!this.autoSync || this.spatialDirty) return this.spatialDirty;
    for (const collider of this.colliders) {
      if (!collider.enabled) { if (this.spatialSnapshots.has(collider)) return true; continue; }
      const bounds = collider.bounds;
      const snapshot = this.spatialSnapshots.get(collider);
      if (!snapshot || snapshot.worldVersion !== collider._boundsWorldVersion || snapshot.x !== collider._boundsX || snapshot.y !== collider._boundsY || snapshot.width !== collider._boundsWidth || snapshot.height !== collider._boundsHeight || !bounds) return true;
    }
    return false;
  }

  _nextQueryToken() {
    if (this.queryToken >= Number.MAX_SAFE_INTEGER - 1) { this.queryToken = 0; this.candidateStamp.clear(); }
    this.queryToken += 1;
    return this.queryToken;
  }

  _visitSpatialCandidate(collider, token, bounds, filter, out) {
    if (this.candidateStamp.get(collider) === token) return null;
    this.candidateStamp.set(collider, token);
    const colliderBounds = this.spatialBounds.get(collider);
    if (collider.node?.destroyed === true || !collider.enabled || !filter(collider) || !colliderBounds || !intersectsAABB(bounds, colliderBounds)) return null;
    if (out) { out.push(collider); return null; }
    return collider;
  }

  _visitSpatial(bounds, filter, out = null) {
    if (this.autoSync && this.hasSpatialChanges()) this.spatialDirty = true;
    if (this.spatialDirty) this.rebuild();
    const token = this._nextQueryToken();
    const minX = Math.floor(bounds.left / this.cellSize);
    const maxX = Math.floor(bounds.right / this.cellSize);
    const minY = Math.floor(bounds.top / this.cellSize);
    const maxY = Math.floor(bounds.bottom / this.cellSize);
    const cellCount = (maxX - minX + 1) * (maxY - minY + 1);
    if (!Number.isFinite(cellCount) || cellCount > MAX_COLLISION_CELLS) {
      for (const collider of this.colliders) { const hit = this._visitSpatialCandidate(collider, token, bounds, filter, out); if (hit) return hit; }
      return null;
    }
    for (let cellY = minY; cellY <= maxY; cellY += 1) for (let cellX = minX; cellX <= maxX; cellX += 1) {
      const cell = this.spatialIndex.get(cellX)?.get(cellY);
      if (cell) for (const collider of cell) { const hit = this._visitSpatialCandidate(collider, token, bounds, filter, out); if (hit) return hit; }
    }
    for (const collider of this.largeColliders) { const hit = this._visitSpatialCandidate(collider, token, bounds, filter, out); if (hit) return hit; }
    return null;
  }

  query(bounds, filter = acceptCollider, out = []) {
    if (typeof filter !== "function") throw new TypeError("CollisionWorld filter fonksiyonu gerekli.");
    if (!Array.isArray(out)) throw new TypeError("CollisionWorld output dizisi gerekli.");
    out.length = 0;
    if (!this.spatial) {
      for (const collider of this.colliders) if (collider.node?.destroyed !== true && collider.enabled && filter(collider) && intersectsAABB(bounds, collider.bounds)) out.push(collider);
      return out;
    }
    this._visitSpatial(bounds, filter, out);
    return out;
  }

  firstHit(bounds, filter = acceptCollider) {
    if (typeof filter !== "function") throw new TypeError("CollisionWorld filter fonksiyonu gerekli.");
    if (this.spatial) {
      return this._visitSpatial(bounds, filter);
    }
    for (const collider of this.colliders) if (collider.node?.destroyed !== true && collider.enabled && filter(collider) && intersectsAABB(bounds, collider.bounds)) return collider;
    return null;
  }

  raycast(origin, direction, maxDistance = Infinity, filter = acceptCollider, out = null) {
    if (typeof filter !== "function") throw new TypeError("CollisionWorld filter fonksiyonu gerekli.");
    const originX = Number(origin?.x); const originY = Number(origin?.y);
    const rawDirectionX = Number(direction?.x); const rawDirectionY = Number(direction?.y);
    const requestedDistance = Number(maxDistance);
    if (![originX, originY, rawDirectionX, rawDirectionY].every(Number.isFinite) || (!Number.isFinite(requestedDistance) && requestedDistance !== Infinity)) throw new RangeError("CollisionWorld ray girdisi finite olmalı.");
    if (requestedDistance < 0) throw new RangeError("CollisionWorld ray mesafesi negatif olamaz.");
    if (out !== null && (!out || typeof out !== "object" || !out.point || !out.normal)) throw new TypeError("CollisionWorld ray output nesnesi gerekli.");
    const directionLength = Math.hypot(rawDirectionX, rawDirectionY);
    const distanceLimit = Math.min(MAX_RAY_DISTANCE, requestedDistance === Infinity ? MAX_RAY_DISTANCE : requestedDistance);
    if (distanceLimit <= 0 || !Number.isFinite(directionLength) || directionLength <= RAY_DIRECTION_EPSILON) return null;
    const directionX = rawDirectionX / directionLength; const directionY = rawDirectionY / directionLength;
    const endX = originX + directionX * distanceLimit; const endY = originY + directionY * distanceLimit;
    const bounds = this.raycastBounds;
    bounds.left = Math.min(originX, endX) - RAY_BOUNDS_EPSILON;
    bounds.top = Math.min(originY, endY) - RAY_BOUNDS_EPSILON;
    bounds.right = Math.max(originX, endX) + RAY_BOUNDS_EPSILON;
    bounds.bottom = Math.max(originY, endY) + RAY_BOUNDS_EPSILON;
    bounds.x = bounds.left; bounds.y = bounds.top;
    bounds.width = bounds.right - bounds.left; bounds.height = bounds.bottom - bounds.top;
    const candidates = this.raycastCandidates;
    candidates.length = 0;
    this.query(bounds, filter, candidates);
    let hit = null; let nearestDistance = distanceLimit; let nearestNormalX = 0; let nearestNormalY = 0;
    const candidateHit = this.raycastCandidateHit;
    for (const collider of candidates) {
      if (!intersectRayAABB(originX, originY, directionX, directionY, distanceLimit, collider.bounds, candidateHit)) continue;
      if (candidateHit.distance < nearestDistance) {
        hit = collider;
        nearestDistance = candidateHit.distance;
        nearestNormalX = candidateHit.normalX;
        nearestNormalY = candidateHit.normalY;
      }
    }
    candidates.length = 0;
    if (!hit) return null;
    const result = out || this.raycastResult;
    result.collider = hit;
    result.distance = nearestDistance;
    result.point.x = originX + directionX * nearestDistance;
    result.point.y = originY + directionY * nearestDistance;
    result.normal.x = nearestNormalX;
    result.normal.y = nearestNormalY;
    return result;
  }

  overlapCircle(centerX, centerY, radius, filter = acceptCollider, out = []) {
    if (typeof filter !== "function") throw new TypeError("CollisionWorld filter fonksiyonu gerekli.");
    if (!Array.isArray(out)) throw new TypeError("CollisionWorld overlap output dizisi gerekli.");
    const cx = Number(centerX);
    const cy = Number(centerY);
    const r = Number(radius);
    if (![cx, cy, r].every(Number.isFinite) || r < 0) throw new RangeError("CollisionWorld overlapCircle parametreleri finite olmalı.");
    const r2 = r * r;
    const bounds = this.circleBounds;
    bounds.left = cx - r;
    bounds.top = cy - r;
    bounds.right = cx + r;
    bounds.bottom = cy + r;
    bounds.x = bounds.left;
    bounds.y = bounds.top;
    bounds.width = r * 2;
    bounds.height = r * 2;
    const candidates = this.circleCandidates;
    candidates.length = 0;
    this.query(bounds, filter, candidates);
    out.length = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const collider = candidates[index];
      const cb = collider.bounds;
      const closestX = Math.max(cb.left, Math.min(cx, cb.right));
      const closestY = Math.max(cb.top, Math.min(cy, cb.bottom));
      const dx = cx - closestX;
      const dy = cy - closestY;
      if (dx * dx + dy * dy <= r2) {
        out.push(collider);
      }
    }
    candidates.length = 0;
    return out;
  }

  clear() {
    for (const collider of this.colliders) collider._worlds.delete(this);
    this.colliders.clear();
    this.spatialIndex.clear();
    this.spatialBounds.clear();
    this.spatialSnapshots.clear();
    this.spatialCellRecords.clear();
    this.largeColliders.length = 0;
    this.candidateStamp.clear();
    this.raycastCandidates.length = 0;
    this.circleCandidates.length = 0;
    this.spatialDirty = true;
  }
}

export class PhysicsBody {
  constructor(node, { static: isStatic = false, kinematic = false, isTrigger = false, oneWay = null, tag = "physics", layer = 1, mask = MAX_COLLISION_BITS, bounds = null, velocityX = 0, velocityY = 0, gravityScale = 1, maxSpeed = MAX_PHYSICS_SPEED } = {}) {
    if (!node || node.destroyed === true || !node.position || typeof node.updateWorldMatrix !== "function") throw new TypeError("PhysicsBody canlı ve geçerli bir Node ister.");
    this.node = node;
    this.isStatic = Boolean(isStatic);
    this.isKinematic = Boolean(kinematic);
    if (this.isStatic && this.isKinematic) throw new TypeError("PhysicsBody static ve kinematic aynı anda olamaz.");
    this.gravityScale = boundedPhysics(gravityScale, 1, -MAX_PHYSICS_GRAVITY_SCALE, MAX_PHYSICS_GRAVITY_SCALE);
    this.maxSpeed = boundedPhysics(maxSpeed, MAX_PHYSICS_SPEED, 1, MAX_PHYSICS_SPEED);
    this.velocity = new Vec2(
      boundedPhysics(velocityX, 0, -this.maxSpeed, this.maxSpeed),
      boundedPhysics(velocityY, 0, -this.maxSpeed, this.maxSpeed),
    );
    this.grounded = false;
    this._wasGrounded = false;
    this._stepDeltaX = 0;
    this._stepDeltaY = 0;
    this.collider = new Collider(node, { tag, isTrigger, oneWay, layer, mask, bounds });
    this.collider.body = this;
    this._worlds = new Set();
  }

  setVelocity(x, y = 0) {
    this.velocity.x = boundedPhysics(x, 0, -this.maxSpeed, this.maxSpeed);
    this.velocity.y = boundedPhysics(y, 0, -this.maxSpeed, this.maxSpeed);
    return this;
  }

  setStatic(value) {
    const next = Boolean(value);
    if (next === this.isStatic) return this;
    if (next && this.isKinematic) throw new Error("Kinematic PhysicsBody static yapılamaz.");
    this.isStatic = next;
    for (const world of this._worlds) world.collisionWorld.spatialDirty = true;
    return this;
  }

  setKinematic(value) {
    const next = Boolean(value);
    if (next === this.isKinematic) return this;
    if (next && this.isStatic) throw new Error("Static PhysicsBody kinematic yapılamaz.");
    this.isKinematic = next;
    this.grounded = false;
    this._wasGrounded = false;
    this._stepDeltaX = 0;
    this._stepDeltaY = 0;
    for (const world of this._worlds) world.collisionWorld.spatialDirty = true;
    return this;
  }
}

export class PhysicsWorld {
  constructor({ scene = null, gravityX = 0, gravityY = 980, autoSync = false, onBeginContact = null, onStayContact = null, onEndContact = null } = {}) {
    if (scene !== null && (!scene || typeof scene.updateWorldMatrix !== "function")) throw new TypeError("PhysicsWorld scene geçerli olmalı.");
    this.onBeginContact = normalizeContactHandler(onBeginContact, "PhysicsWorld onBeginContact");
    this.onStayContact = normalizeContactHandler(onStayContact, "PhysicsWorld onStayContact");
    this.onEndContact = normalizeContactHandler(onEndContact, "PhysicsWorld onEndContact");
    this.scene = scene;
    this.autoSync = autoSync === true;
    this.gravity = new Vec2(
      boundedPhysics(gravityX, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED),
      boundedPhysics(gravityY, 980, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED),
    );
    this.bodies = new Set();
    this.collisionWorld = new CollisionWorld({ spatial: true, autoSync: this.autoSync });
    this.sweepBounds = { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.sweepResult = { collider: null, distance: 0 };
    this.sweepStartLeft = 0;
    this.sweepStartTop = 0;
    this.sweepStartRight = 0;
    this.sweepStartBottom = 0;
    this.sweepMoveX = 0;
    this.sweepMoveY = 0;
    this.sweepNearestDistance = Infinity;
    this.sweepNearestCollider = null;
    this.overlapCandidates = [];
    this.overlapColliderCandidates = [];
    this.contactPairs = new Map();
    this.nextContactPairs = new Map();
    this.contactOrder = new Map();
    this.contactInfo = { body: null, other: null, phase: "begin", normal: { x: 0, y: 0 }, penetration: 0 };
    this.activeBody = null;
    this.activeOverlapFilter = acceptPhysicsBody;
    this.filterSolid = (collider) => {
      const active = this.activeBody;
      const solidBody = collider.body;
      if (!active || collider === active.collider || collider.isTrigger || (solidBody?.isStatic !== true && solidBody?.isKinematic !== true) || !canCollide(active.collider, collider)) return false;
      if (collider.oneWay === "up") return this.sweepMoveY > 0 && this.sweepStartBottom <= collider.bounds.top + ONE_WAY_EPSILON;
      if (collider.oneWay === "down") return this.sweepMoveY < 0 && this.sweepStartTop >= collider.bounds.bottom - ONE_WAY_EPSILON;
      if (collider.oneWay === "left") return this.sweepMoveX > 0 && this.sweepStartRight <= collider.bounds.left + ONE_WAY_EPSILON;
      if (collider.oneWay === "right") return this.sweepMoveX < 0 && this.sweepStartLeft >= collider.bounds.right - ONE_WAY_EPSILON;
      return true;
    };
    this.filterOverlap = (collider) => {
      const active = this.activeBody;
      return !!active && collider !== active.collider && collider.body instanceof PhysicsBody && canCollide(active.collider, collider) && this.activeOverlapFilter(collider.body);
    };
    this.sweepFilter = (collider) => {
      if (!this.filterSolid(collider)) return false;
      const candidateBounds = collider.bounds;
      let distance;
      if (this.sweepMoveX !== 0) {
        if (candidateBounds.top >= this.sweepStartBottom || candidateBounds.bottom <= this.sweepStartTop) return false;
        distance = this.sweepMoveX > 0 ? candidateBounds.left - this.sweepStartRight : this.sweepStartLeft - candidateBounds.right;
        if (distance < 0 || distance > Math.abs(this.sweepMoveX)) return false;
      } else {
        if (candidateBounds.left >= this.sweepStartRight || candidateBounds.right <= this.sweepStartLeft) return false;
        distance = this.sweepMoveY > 0 ? candidateBounds.top - this.sweepStartBottom : this.sweepStartTop - candidateBounds.bottom;
        if (distance < 0 || distance > Math.abs(this.sweepMoveY)) return false;
      }
      if (distance < this.sweepNearestDistance) {
        this.sweepNearestDistance = distance;
        this.sweepNearestCollider = collider;
      }
      return false;
    };
  }

  assertBodyLimit() {
    if (this.bodies.size > MAX_PHYSICS_BODIES) throw new RangeError(`PhysicsWorld en fazla ${MAX_PHYSICS_BODIES} body destekler.`);
  }

  add(body) {
    if (!(body instanceof PhysicsBody)) throw new TypeError("PhysicsBody bekleniyor.");
    if (body.node?.destroyed === true) throw new TypeError("PhysicsBody yok edilmiş Node’a bağlı olamaz.");
    if (this.bodies.has(body)) return body;
    if (this.bodies.size >= MAX_PHYSICS_BODIES) throw new RangeError(`PhysicsWorld en fazla ${MAX_PHYSICS_BODIES} body destekler.`);
    this.bodies.add(body);
    body._worlds.add(this);
    this.collisionWorld.add(body.collider);
    return body;
  }

  _removeContactBody(body) {
    const onEndContact = typeof this.onEndContact === "function" ? this.onEndContact : null;
    const current = this.contactPairs.get(body);
    if (onEndContact && current) for (const other of current) onEndContact.call(this, body, other, writePhysicsContact(this.contactInfo, body, other, "end"));
    this.contactPairs.delete(body);
    this.nextContactPairs.delete(body);
    for (const [owner, pairs] of this.contactPairs) {
      if (owner !== body && pairs.delete(body) && onEndContact) onEndContact.call(this, owner, body, writePhysicsContact(this.contactInfo, owner, body, "end"));
    }
    for (const pairs of this.nextContactPairs.values()) pairs.delete(body);
    this.contactOrder.delete(body);
  }

  remove(body) {
    const removed = this.bodies.delete(body);
    if (removed) {
      this._removeContactBody(body);
      body._worlds.delete(this);
      this.collisionWorld.remove(body.collider);
    }
    return removed;
  }

  syncBody(body) {
    if (body?.node?.destroyed === true) { this.remove(body); return; }
    const parent = body.node.parent;
    if (parent) body.node.updateWorldMatrix(parent.worldMatrix, parent.worldZ, parent._worldVersion, parent.worldAlpha, parent.worldFilter, parent.worldFilterAmount, parent.worldMaskTexture, parent.worldMaskRect);
    else body.node.updateWorldMatrix();
    for (const world of body._worlds) world.collisionWorld.syncCollider(body.collider);
  }

  hasSolidOverlap(body) {
    const previousBody = this.activeBody;
    this.activeBody = body;
    try { return this.collisionWorld.firstHit(body.collider.bounds, this.filterSolid) !== null; }
    finally { this.activeBody = previousBody; }
  }

  firstSolidOverlap(body) {
    const previousBody = this.activeBody;
    this.activeBody = body;
    try { return this.collisionWorld.firstHit(body.collider.bounds, this.filterSolid); }
    finally { this.activeBody = previousBody; }
  }

  sweepSolid(body, moveX, moveY) {
    const deltaX = Number(moveX);
    const deltaY = Number(moveY);
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) return null;
    const start = body.collider.bounds;
    const bounds = this.sweepBounds;
    if (deltaX !== 0) {
      bounds.left = deltaX > 0 ? start.left : start.left + deltaX;
      bounds.right = deltaX > 0 ? start.right + deltaX : start.right;
      bounds.top = start.top;
      bounds.bottom = start.bottom;
    } else {
      bounds.left = start.left;
      bounds.right = start.right;
      bounds.top = deltaY > 0 ? start.top : start.top + deltaY;
      bounds.bottom = deltaY > 0 ? start.bottom + deltaY : start.bottom;
    }
    bounds.x = bounds.left;
    bounds.y = bounds.top;
    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;
    this.sweepStartLeft = start.left;
    this.sweepStartTop = start.top;
    this.sweepStartRight = start.right;
    this.sweepStartBottom = start.bottom;
    this.sweepMoveX = deltaX;
    this.sweepMoveY = deltaY;
    this.sweepNearestDistance = Infinity;
    this.sweepNearestCollider = null;
    const previousBody = this.activeBody;
    this.activeBody = body;
    try {
      this.collisionWorld.firstHit(bounds, this.sweepFilter);
    } finally {
      this.activeBody = previousBody;
    }
    const hit = this.sweepNearestCollider;
    if (!hit) return null;
    const result = this.sweepResult;
    result.collider = hit;
    result.distance = this.sweepNearestDistance;
    return result;
  }

  _overlaps(body, filter, out, sync = true) {
    out.length = 0;
    const previousBody = this.activeBody;
    const previousFilter = this.activeOverlapFilter;
    this.activeBody = body;
    this.activeOverlapFilter = filter;
    const candidates = this.overlapColliderCandidates;
    candidates.length = 0;
    try {
      if (sync) {
        this.scene?.updateWorldMatrix();
        this.syncBody(body);
        this.syncCollisionIndex();
      }
      this.collisionWorld.query(body.collider.bounds, this.filterOverlap, candidates);
      for (const collider of candidates) out.push(collider.body);
    } finally {
      candidates.length = 0;
      this.activeBody = previousBody;
      this.activeOverlapFilter = previousFilter;
    }
    return out;
  }

  overlaps(body, filter = acceptPhysicsBody, out = this.overlapCandidates) {
    this.assertBodyLimit();
    if (!(body instanceof PhysicsBody)) throw new TypeError("PhysicsBody bekleniyor.");
    if (typeof filter !== "function") throw new TypeError("PhysicsWorld overlap filter fonksiyonu gerekli.");
    if (!Array.isArray(out)) throw new TypeError("PhysicsWorld overlap output dizisi gerekli.");
    if (out === this.overlapColliderCandidates) throw new TypeError("PhysicsWorld overlap output scratch dizisinden farklı olmalı.");
    if (body.node.destroyed === true) { this.remove(body); out.length = 0; return out; }
    return this._overlaps(body, filter, out, true);
  }

  overlapCircle(centerX, centerY, radius, filter = acceptPhysicsBody, out = this.overlapCandidates) {
    this.assertBodyLimit();
    if (typeof filter !== "function") throw new TypeError("PhysicsWorld overlap filter fonksiyonu gerekli.");
    if (!Array.isArray(out)) throw new TypeError("PhysicsWorld overlap output dizisi gerekli.");
    if (out === this.overlapColliderCandidates) throw new TypeError("PhysicsWorld overlap output scratch dizisinden farklı olmalı.");
    const candidates = this.overlapColliderCandidates;
    candidates.length = 0;
    try {
      this.collisionWorld.overlapCircle(centerX, centerY, radius, acceptCollider, candidates);
      out.length = 0;
      for (let index = 0; index < candidates.length; index += 1) {
        const collider = candidates[index];
        const body = collider.body;
        if (body && filter(body)) out.push(body);
      }
    } finally {
      candidates.length = 0;
    }
    return out;
  }

  syncCollisionIndex() {
    this.assertBodyLimit();
    let rebuild = this.collisionWorld.spatialDirty;
    if (!rebuild && this.autoSync) rebuild = this.collisionWorld.hasSpatialChanges();
    if (!rebuild) for (const body of this.bodies) {
      if (body.collider._boundsWorldVersion !== body.node._worldVersion) { rebuild = true; break; }
    }
    if (rebuild) this.collisionWorld.rebuild();
  }

  _syncContactEvents() {
    const onBeginContact = typeof this.onBeginContact === "function" ? this.onBeginContact : null;
    const onStayContact = typeof this.onStayContact === "function" ? this.onStayContact : null;
    const onEndContact = typeof this.onEndContact === "function" ? this.onEndContact : null;
    if (!onBeginContact && !onStayContact && !onEndContact) {
      this.contactPairs.clear();
      this.nextContactPairs.clear();
      return;
    }
    const previousPairs = this.contactPairs;
    const nextPairs = this.nextContactPairs;
    this.contactOrder.clear();
    let order = 0;
    for (const body of this.bodies) {
      this.contactOrder.set(body, order);
      order += 1;
      let pairs = nextPairs.get(body);
      if (!pairs) { pairs = new Set(); nextPairs.set(body, pairs); }
      else pairs.clear();
    }
    for (const body of this.bodies) {
      if (!body.collider.enabled) continue;
      const bodyPairs = nextPairs.get(body);
      const bodyOrder = this.contactOrder.get(body);
      const overlaps = this._overlaps(body, acceptPhysicsBody, this.overlapCandidates, false);
      for (const other of overlaps) {
        if (!other || other === body || !other.collider.enabled || bodyOrder >= this.contactOrder.get(other)) continue;
        bodyPairs.add(other);
      }
    }
    for (const [body, next] of nextPairs) {
      const previous = previousPairs.get(body) || null;
      if (onBeginContact) for (const other of next) if (!previous?.has(other)) onBeginContact.call(this, body, other, writePhysicsContact(this.contactInfo, body, other, "begin"));
      if (onStayContact) for (const other of next) onStayContact.call(this, body, other, writePhysicsContact(this.contactInfo, body, other, "stay"));
      if (onEndContact && previous) for (const other of previous) if (!next.has(other)) onEndContact.call(this, body, other, writePhysicsContact(this.contactInfo, body, other, "end"));
    }
    this.contactPairs = nextPairs;
    this.nextContactPairs = previousPairs;
    for (const pairs of this.nextContactPairs.values()) pairs.clear();
  }

  _carryKinematicBody(body) {
    const bodyBounds = body.collider.bounds;
    for (const platform of this.bodies) {
      if (!platform.isKinematic || !platform.collider.enabled || platform.collider.isTrigger || !canCollide(body.collider, platform.collider)) continue;
      const deltaX = platform._stepDeltaX;
      const deltaY = platform._stepDeltaY;
      if (deltaX === 0 && deltaY === 0) continue;
      const platformBounds = platform.collider.bounds;
      const previousLeft = platformBounds.left - deltaX;
      const previousRight = platformBounds.right - deltaX;
      const previousTop = platformBounds.top - deltaY;
      if (bodyBounds.right <= previousLeft || bodyBounds.left >= previousRight || Math.abs(bodyBounds.bottom - previousTop) > KINEMATIC_CONTACT_EPSILON) continue;
      body.node.position.x = boundedPhysics(body.node.position.x + deltaX, body.node.position.x, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
      body.node.position.y = boundedPhysics(body.node.position.y + deltaY, body.node.position.y, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
      this.syncBody(body);
      body.grounded = true;
      return;
    }
  }

  _stepKinematicBody(body, substepDelta) {
    const speed = body.maxSpeed = boundedPhysics(body.maxSpeed, MAX_PHYSICS_SPEED, 1, MAX_PHYSICS_SPEED);
    body.velocity.x = boundedPhysics(body.velocity.x, 0, -speed, speed);
    body.velocity.y = boundedPhysics(body.velocity.y, 0, -speed, speed);
    const previousX = boundedPhysics(body.node.position.x, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    const previousY = boundedPhysics(body.node.position.y, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    const nextX = boundedPhysics(previousX + body.velocity.x * substepDelta, previousX, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    const nextY = boundedPhysics(previousY + body.velocity.y * substepDelta, previousY, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    body.node.position.x = nextX;
    body.node.position.y = nextY;
    body._stepDeltaX = nextX - previousX;
    body._stepDeltaY = nextY - previousY;
    if (nextX !== previousX || nextY !== previousY) this.syncBody(body);
  }

  // ponytail: axis-separated kinematic resolution; rigid-body impulses/rotation stay out of the zero-dependency core.
  step(delta) {
    this.assertBodyLimit();
    const requestedDelta = Number(delta);
    if (!Number.isFinite(requestedDelta) || requestedDelta <= 0 || this.bodies.size === 0) return this;
    for (const body of this.bodies) if (body.node?.destroyed === true) this.remove(body);
    if (this.bodies.size === 0) return this;
    const stepDelta = Math.min(MAX_PHYSICS_DELTA, requestedDelta);
    const substeps = Math.min(MAX_PHYSICS_SUBSTEPS, Math.max(1, Math.ceil(stepDelta / PHYSICS_SUBSTEP_DELTA)));
    const substepDelta = stepDelta / substeps;
    this.scene?.updateWorldMatrix();
    const gravityX = boundedPhysics(this.gravity.x, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    const gravityY = boundedPhysics(this.gravity.y, 980, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
    this.syncCollisionIndex();
    for (const body of this.bodies) {
      if (body.isStatic || body.isKinematic) continue;
      body._wasGrounded = body.grounded;
      body.grounded = false;
    }
    try {
      for (let substep = 0; substep < substeps; substep += 1) {
        for (const body of this.bodies) {
          if (body.isKinematic) this._stepKinematicBody(body, substepDelta);
        }
        for (const body of this.bodies) {
          if (body.isStatic || body.isKinematic) continue;
          if (body.grounded || (substep === 0 && body._wasGrounded)) this._carryKinematicBody(body);
          this.activeBody = body;
          const speed = body.maxSpeed = boundedPhysics(body.maxSpeed, MAX_PHYSICS_SPEED, 1, MAX_PHYSICS_SPEED);
          const gravityScale = boundedPhysics(body.gravityScale, 1, -MAX_PHYSICS_GRAVITY_SCALE, MAX_PHYSICS_GRAVITY_SCALE);
          body.velocity.x = boundedPhysics(body.velocity.x + gravityX * gravityScale * substepDelta, 0, -speed, speed);
          body.velocity.y = boundedPhysics(body.velocity.y + gravityY * gravityScale * substepDelta, 0, -speed, speed);

          const previousX = boundedPhysics(body.node.position.x, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
          if (body.node.position.x !== previousX) { body.node.position.x = previousX; this.syncBody(body); }
          const moveX = body.velocity.x * substepDelta;
          if (moveX !== 0) {
            const sweep = this.sweepSolid(body, moveX, 0);
            if (sweep) {
              const travel = moveX > 0 ? sweep.distance : -sweep.distance;
              body.node.position.x = boundedPhysics(previousX + travel, previousX, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
              this.syncBody(body);
              if (this.hasSolidOverlap(body)) { body.node.position.x = previousX; this.syncBody(body); }
              body.velocity.x = 0;
            } else {
              body.node.position.x = boundedPhysics(previousX + moveX, previousX, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
              this.syncBody(body);
              const hit = this.firstSolidOverlap(body);
              if (hit) {
                const bodyBounds = body.collider.bounds;
                const hitBounds = hit.bounds;
                const correction = moveX > 0 ? hitBounds.left - bodyBounds.right : hitBounds.right - bodyBounds.left;
                body.node.position.x = boundedPhysics(body.node.position.x + correction, previousX, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
                this.syncBody(body);
                if (this.hasSolidOverlap(body)) { body.node.position.x = previousX; this.syncBody(body); }
                body.velocity.x = 0;
              }
            }
          }

          const previousY = boundedPhysics(body.node.position.y, 0, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
          if (body.node.position.y !== previousY) { body.node.position.y = previousY; this.syncBody(body); }
          const moveY = body.velocity.y * substepDelta;
          if (moveY !== 0) {
            const sweep = this.sweepSolid(body, 0, moveY);
            if (sweep) {
              const travel = moveY > 0 ? sweep.distance : -sweep.distance;
              body.node.position.y = boundedPhysics(previousY + travel, previousY, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
              this.syncBody(body);
              if (this.hasSolidOverlap(body)) { body.node.position.y = previousY; this.syncBody(body); }
              body.grounded = moveY > 0;
              body.velocity.y = 0;
            } else {
              body.node.position.y = boundedPhysics(previousY + moveY, previousY, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
              this.syncBody(body);
              const hit = this.firstSolidOverlap(body);
              if (hit) {
                const bodyBounds = body.collider.bounds;
                const hitBounds = hit.bounds;
                const correction = moveY > 0 ? hitBounds.top - bodyBounds.bottom : hitBounds.bottom - bodyBounds.top;
                body.node.position.y = boundedPhysics(body.node.position.y + correction, previousY, -MAX_PHYSICS_SPEED, MAX_PHYSICS_SPEED);
                this.syncBody(body);
                if (this.hasSolidOverlap(body)) { body.node.position.y = previousY; this.syncBody(body); }
                body.grounded = moveY > 0;
                body.velocity.y = 0;
              }
            }
          }
        }
      }
    } finally {
      this.activeBody = null;
      for (const body of this.bodies) {
        body._wasGrounded = false;
        body._stepDeltaX = 0;
        body._stepDeltaY = 0;
      }
    }
    this._syncContactEvents();
    return this;
  }

  clear() {
    const activePairs = this.contactPairs;
    const onEndContact = typeof this.onEndContact === "function" ? this.onEndContact : null;
    const bodies = [...this.bodies];
    this.bodies.clear();
    this.contactPairs = new Map();
    this.nextContactPairs = new Map();
    this.contactOrder.clear();
    for (const body of bodies) body._worlds.delete(this);
    if (onEndContact) for (const [body, pairs] of activePairs) for (const other of pairs) onEndContact.call(this, body, other, writePhysicsContact(this.contactInfo, body, other, "end"));
    this.collisionWorld.clear();
    this.overlapCandidates.length = 0;
    this.overlapColliderCandidates.length = 0;
    this.contactInfo.body = null;
    this.contactInfo.other = null;
    this.contactInfo.phase = "end";
    this.contactInfo.normal.x = 0;
    this.contactInfo.normal.y = 0;
    this.contactInfo.penetration = 0;
    this.activeBody = null;
  }
}
