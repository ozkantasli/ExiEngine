import { Mat3, Vec2, worldValue } from "./math.js";
import { Texture } from "../assets/texture.js";

let nextNodeId = 1;
let nextTraversalStamp = 1;

const MAX_SCENE_CHILDREN = 65_536;
const MAX_SCENE_DEPTH = 1_024;

function beginTraversal(node, stamp = 0, depth = 0) {
  const safeDepth = Number.isSafeInteger(depth) && depth >= 0 ? depth : 0;
  if (safeDepth > MAX_SCENE_DEPTH) throw new RangeError(`Scene graph derinlik limiti ${MAX_SCENE_DEPTH}.`);
  if (!Array.isArray(node.children) || node.children.length > MAX_SCENE_CHILDREN) throw new RangeError(`Bir Node en fazla ${MAX_SCENE_CHILDREN} child taşıyabilir.`);
  const traversalStamp = stamp || nextTraversalStamp;
  if (!stamp) nextTraversalStamp = nextTraversalStamp >= Number.MAX_SAFE_INTEGER - 1 ? 1 : nextTraversalStamp + 1;
  if (node._lastTraversalStamp === traversalStamp) throw new Error("Scene graph cycle veya duplicate child algılandı.");
  node._lastTraversalStamp = traversalStamp;
  return traversalStamp;
}

function normalizeClip(rect) {
  if (!rect) return null;
  const x = Number(rect.x); const y = Number(rect.y); const width = Number(rect.width); const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError("Clip rect boyutu geçersiz.");
  const safeX = worldValue(x); const safeY = worldValue(y); const safeWidth = worldValue(width); const safeHeight = worldValue(height);
  if (safeWidth <= 0 || safeHeight <= 0) throw new RangeError("Clip rect boyutu geçersiz.");
  return { x: safeX, y: safeY, width: safeWidth, height: safeHeight };
}

function normalizeDirectClip(rect) {
  if (rect === null || rect === undefined) return null;
  if (typeof rect === "object" && !Array.isArray(rect)) {
    const x = Number(rect.x); const y = Number(rect.y); const width = Number(rect.width); const height = Number(rect.height);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
      && rect.x === worldValue(x) && rect.y === worldValue(y)
      && rect.width === worldValue(width) && rect.height === worldValue(height)) return rect;
  }
  return normalizeClip(rect);
}

function normalizeAlpha(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

const MAX_LAYOUT_VALUE = 1_000_000;
const MAX_TAB_INDEX = 32_767;

function normalizeLayoutValue(value, label) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} finite olmalı.`);
  return worldValue(Math.max(-MAX_LAYOUT_VALUE, Math.min(MAX_LAYOUT_VALUE, number)));
}

function normalizeLayoutRatio(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeLayoutSize(value, label) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${label} sıfır veya pozitif olmalı.`);
  return worldValue(Math.min(MAX_LAYOUT_VALUE, number));
}

function normalizeLayout(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Node layout nesnesi gerekli.");
  return {
    left: normalizeLayoutValue(value.left, "Layout left"), top: normalizeLayoutValue(value.top, "Layout top"),
    right: normalizeLayoutValue(value.right, "Layout right"), bottom: normalizeLayoutValue(value.bottom, "Layout bottom"),
    width: normalizeLayoutSize(value.width, "Layout width"), height: normalizeLayoutSize(value.height, "Layout height"),
    offsetX: normalizeLayoutValue(value.offsetX, "Layout offsetX") ?? 0,
    offsetY: normalizeLayoutValue(value.offsetY, "Layout offsetY") ?? 0,
    anchorX: normalizeLayoutRatio(value.anchorX, 0), anchorY: normalizeLayoutRatio(value.anchorY, 0),
  };
}

function normalizeTabIndex(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(-1, Math.min(MAX_TAB_INDEX, number)) : 0;
}

export function normalizeFilterType(value) {
  return value === "grayscale" || value === "invert" || value === "brightness" || value === "sepia" || value === "contrast" || value === "saturate" ? value : "none";
}

export function normalizeFilterAmount(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function normalizeMaskTexture(value) {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Texture)) throw new TypeError("maskTexture Texture veya RenderTexture olmalı.");
  return value;
}

export function filterMode(value) {
  return value === "grayscale" ? 1 : value === "invert" ? 2 : value === "brightness" ? 3 : value === "sepia" ? 4 : value === "contrast" ? 5 : value === "saturate" ? 6 : 0;
}

function boundsVisible(node, bounds, camera, width, height, scratch) {
  if (!camera || width <= 0 || height <= 0 || !scratch) return true;
  const corners = scratch.boundsCorners;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  corners[0] = bounds.x; corners[1] = bounds.y;
  corners[2] = right; corners[3] = bounds.y;
  corners[4] = right; corners[5] = bottom;
  corners[6] = bounds.x; corners[7] = bottom;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let index = 0; index < corners.length; index += 2) {
    node.worldMatrix.transformPoint(corners[index], corners[index + 1], scratch.localPoint);
    camera.worldToScreen(scratch.localPoint.x, scratch.localPoint.y, scratch.screenPoint);
    minX = Math.min(minX, scratch.screenPoint.x); minY = Math.min(minY, scratch.screenPoint.y);
    maxX = Math.max(maxX, scratch.screenPoint.x); maxY = Math.max(maxY, scratch.screenPoint.y);
  }
  return !(maxX < 0 || minX > width || maxY < 0 || minY > height);
}

function normalizePointerHandler(handler, label) {
  if (handler === null || handler === undefined) return null;
  if (typeof handler !== "function") throw new TypeError(`${label} callback fonksiyonu gerekli.`);
  return handler;
}

function normalizeFocusHandler(handler, label) {
  if (handler === null || handler === undefined) return null;
  if (typeof handler !== "function") throw new TypeError(`${label} callback fonksiyonu gerekli.`);
  return handler;
}

function intersectClip(parent, own, output = null) {
  if (!parent) return own;
  if (!own) return parent;
  const x = Math.max(parent.x, own.x); const y = Math.max(parent.y, own.y);
  const right = Math.min(parent.x + parent.width, own.x + own.width);
  const bottom = Math.min(parent.y + parent.height, own.y + own.height);
  const result = output || { x: 0, y: 0, width: 0, height: 0 };
  result.x = x; result.y = y; result.width = Math.max(0, right - x); result.height = Math.max(0, bottom - y);
  return result;
}

export const normalizeBlendMode = (value) => value === "additive" || value === "multiply" ? value : "normal";

function pointInNodeBounds(node, worldX, worldY) {
  const bounds = node.hitArea || node.getLocalBounds?.();
  if (!bounds) return false;
  const matrix = node.worldMatrix;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return false;
  const deltaX = worldX - matrix.tx; const deltaY = worldY - matrix.ty;
  const localX = (matrix.d * deltaX - matrix.c * deltaY) / determinant;
  const localY = (-matrix.b * deltaX + matrix.a * deltaY) / determinant;
  return localX >= bounds.x && localX <= bounds.x + bounds.width && localY >= bounds.y && localY <= bounds.y + bounds.height;
}

export class Node {
  constructor({ name = "node", x = 0, y = 0, scaleX = 1, scaleY = 1, rotation = 0, zIndex = 0, visible = true, alpha = 1, filter = "none", filterAmount = 1, cullable = true, cullBounds = null, clipRect = null, maskRect = null, maskTexture = null, hitArea = null, blendMode = "normal", interactive = false, onPointerDown = null, onPointerUp = null, onPointerCancel = null, onPointerMove = null, onPointerEnter = null, onPointerLeave = null, onWheel = null, onUpdate = null, focusable = false, tabIndex = 0, onFocus = null, onBlur = null, onKeyDown = null, layout = null } = {}) {
    this.id = `node-${nextNodeId++}`;
    this.name = name;
    this.position = new Vec2(x, y);
    this.scale = new Vec2(Number.isFinite(Number(scaleX)) ? Number(scaleX) : 1, Number.isFinite(Number(scaleY)) ? Number(scaleY) : 1);
    this.rotation = Number.isFinite(Number(rotation)) ? Number(rotation) : 0;
    this.zIndex = Number.isFinite(Number(zIndex)) ? Number(zIndex) : 0;
    this.visible = visible !== false;
    this.alpha = normalizeAlpha(alpha);
    this.worldAlpha = this.alpha;
    this.filter = normalizeFilterType(filter);
    this.filterAmount = normalizeFilterAmount(filterAmount);
    this.worldFilter = this.filter;
    this.worldFilterAmount = this.filterAmount;
    this.cullable = cullable !== false;
    this.cullBounds = normalizeClip(cullBounds);
    this.clipRect = normalizeClip(clipRect);
    this.maskRect = normalizeClip(maskRect);
    this.maskTexture = normalizeMaskTexture(maskTexture);
    this.worldMaskTexture = this.maskTexture;
    this.worldMaskRect = this.maskTexture ? this.maskRect : null;
    this.hitArea = normalizeClip(hitArea);
    this.blendMode = normalizeBlendMode(blendMode);
    this.onPointerDown = normalizePointerHandler(onPointerDown, "onPointerDown");
    this.onPointerUp = normalizePointerHandler(onPointerUp, "onPointerUp");
    this.onPointerCancel = normalizePointerHandler(onPointerCancel, "onPointerCancel");
    this.onPointerMove = normalizePointerHandler(onPointerMove, "onPointerMove");
    this.onPointerEnter = normalizePointerHandler(onPointerEnter, "onPointerEnter");
    this.onPointerLeave = normalizePointerHandler(onPointerLeave, "onPointerLeave");
    this.onWheel = normalizePointerHandler(onWheel, "onWheel");
    this.onUpdate = normalizePointerHandler(onUpdate, "onUpdate");
    this.focusable = Boolean(focusable);
    this.tabIndex = normalizeTabIndex(tabIndex);
    this.onFocus = normalizeFocusHandler(onFocus, "onFocus");
    this.onBlur = normalizeFocusHandler(onBlur, "onBlur");
    this.onKeyDown = normalizeFocusHandler(onKeyDown, "onKeyDown");
    this.focused = false;
    this.layout = normalizeLayout(layout);
    this.interactive = Boolean(interactive) || Boolean(this.onPointerDown || this.onPointerUp || this.onPointerCancel || this.onPointerMove || this.onPointerEnter || this.onPointerLeave || this.onWheel);
    this.renderClip = null;
    this.renderClipCache = null;
    this.parent = null;
    this.children = [];
    this._renderGroupSubtree = false;
    this.localMatrix = new Mat3();
    this.worldMatrix = new Mat3();
    this.worldZ = this.zIndex;
    this.destroyed = false;
    this.childrenDirty = false;
    this._worldVersion = 0;
    this._lastParentWorldVersion = -1;
    this._lastParentMatrix = null;
    this._lastPositionX = undefined;
    this._lastPositionY = undefined;
    this._lastScaleX = undefined;
    this._lastScaleY = undefined;
    this._lastRotation = undefined;
    this._interpolateTransforms = false;
    this._previousPositionX = this.position.x;
    this._previousPositionY = this.position.y;
    this._previousScaleX = this.scale.x;
    this._previousScaleY = this.scale.y;
    this._previousRotation = this.rotation;
    this._renderPositionX = this.position.x;
    this._renderPositionY = this.position.y;
    this._renderScaleX = this.scale.x;
    this._renderScaleY = this.scale.y;
    this._renderRotation = this.rotation;
    this._lastTraversalStamp = 0;
  }

  add(...nodes) {
    if (this.destroyed) throw new Error("Node yok edilmiş parent'a eklenemez.");
    if (!Array.isArray(this.children) || this.children.length > MAX_SCENE_CHILDREN || nodes.length > MAX_SCENE_CHILDREN - this.children.length) throw new RangeError(`Bir Node en fazla ${MAX_SCENE_CHILDREN} child taşıyabilir.`);
    const seen = new Set();
    for (const node of nodes) {
      if (!(node instanceof Node)) throw new TypeError("Scene node bekleniyor.");
      if (node.destroyed) throw new Error("yok edilmiş Node scene graph'a eklenemez.");
      if (seen.has(node)) throw new Error("Scene node aynı parent'a iki kez eklenemez.");
      if (node === this || node.isAncestorOf(this)) throw new Error("Node kendisinin altına eklenemez.");
      seen.add(node);
    }
    for (const node of nodes) {
      node.parent?.remove(node);
      node.parent = this;
      node._setInterpolationEnabled(this._interpolateTransforms);
      this.children.push(node);
    }
    this.childrenDirty = true;
    this._refreshRenderGroupSubtree();
    return nodes.length === 1 ? nodes[0] : nodes;
  }

  remove(node) {
    const index = this.children.indexOf(node);
    if (index < 0) return false;
    this.children.splice(index, 1);
    node.parent = null;
    this.childrenDirty = true;
    this._refreshRenderGroupSubtree();
    return true;
  }

  _refreshRenderGroupSubtree(depth = 0) {
    if (!Number.isSafeInteger(depth) || depth > MAX_SCENE_DEPTH) throw new RangeError(`Scene graph parent derinlik limiti ${MAX_SCENE_DEPTH}.`);
    if (!Array.isArray(this.children) || this.children.length > MAX_SCENE_CHILDREN) throw new RangeError(`Bir Node en fazla ${MAX_SCENE_CHILDREN} child taşıyabilir.`);
    let containsRenderGroup = this.isRenderGroup === true;
    if (!containsRenderGroup) {
      for (const child of this.children) {
        if (child.isRenderGroup === true || child._renderGroupSubtree === true) {
          containsRenderGroup = true;
          break;
        }
      }
    }
    if (containsRenderGroup === this._renderGroupSubtree) return this;
    this._renderGroupSubtree = containsRenderGroup;
    this.parent?._refreshRenderGroupSubtree(depth + 1);
    return this;
  }

  setClipRect(rect) { this.clipRect = normalizeClip(rect); return this; }
  clearClipRect() { this.clipRect = null; return this; }
  setMaskRect(rect) { this.maskRect = normalizeClip(rect); return this; }
  clearMaskRect() { this.maskRect = null; return this; }
  setMaskTexture(texture) { this.maskTexture = normalizeMaskTexture(texture); return this; }
  clearMaskTexture() { this.maskTexture = null; return this; }
  setCullBounds(rect) { this.cullBounds = normalizeClip(rect); return this; }
  clearCullBounds() { this.cullBounds = null; return this; }
  setHitArea(rect) { this.hitArea = normalizeClip(rect); return this; }
  setAlpha(value) { this.alpha = normalizeAlpha(value); return this; }
  setFilter(filter, amount = 1) { this.filter = normalizeFilterType(filter); this.filterAmount = normalizeFilterAmount(amount); return this; }
  clearFilter() { this.filter = "none"; this.filterAmount = 1; return this; }
  setBlendMode(mode) { this.blendMode = normalizeBlendMode(mode); return this; }
  setInteractive(value) { this.interactive = Boolean(value); return this; }
  setPointerHandlers(options = {}) {
    if (!options || typeof options !== "object") throw new TypeError("Pointer handler seçenekleri nesne olmalı.");
    if ("onPointerDown" in options) this.onPointerDown = normalizePointerHandler(options.onPointerDown, "onPointerDown");
    if ("onPointerUp" in options) this.onPointerUp = normalizePointerHandler(options.onPointerUp, "onPointerUp");
    if ("onPointerCancel" in options) this.onPointerCancel = normalizePointerHandler(options.onPointerCancel, "onPointerCancel");
    if ("onPointerMove" in options) this.onPointerMove = normalizePointerHandler(options.onPointerMove, "onPointerMove");
    if ("onPointerEnter" in options) this.onPointerEnter = normalizePointerHandler(options.onPointerEnter, "onPointerEnter");
    if ("onPointerLeave" in options) this.onPointerLeave = normalizePointerHandler(options.onPointerLeave, "onPointerLeave");
    if ("onWheel" in options) this.onWheel = normalizePointerHandler(options.onWheel, "onWheel");
    if (this.onPointerDown || this.onPointerUp || this.onPointerCancel || this.onPointerMove || this.onPointerEnter || this.onPointerLeave || this.onWheel) this.interactive = true;
    return this;
  }

  setUpdateHandler(handler = null) { this.onUpdate = normalizePointerHandler(handler, "onUpdate"); return this; }

  setFocusHandlers(options = {}) {
    if (!options || typeof options !== "object") throw new TypeError("Focus handler seçenekleri nesne olmalı.");
    if ("onFocus" in options) this.onFocus = normalizeFocusHandler(options.onFocus, "onFocus");
    if ("onBlur" in options) this.onBlur = normalizeFocusHandler(options.onBlur, "onBlur");
    if ("onKeyDown" in options) this.onKeyDown = normalizeFocusHandler(options.onKeyDown, "onKeyDown");
    return this;
  }

  setFocusable(value, tabIndex = this.tabIndex) {
    this.focusable = Boolean(value);
    this.tabIndex = normalizeTabIndex(tabIndex);
    return this;
  }

  setLayout(layout) { this.layout = normalizeLayout(layout); return this; }
  clearLayout() { this.layout = null; return this; }

  containsPoint(worldX, worldY) {
    if (this.destroyed || !this.visible) return false;
    const x = Number(worldX); const y = Number(worldY);
    return Number.isFinite(x) && Number.isFinite(y) && pointInNodeBounds(this, x, y);
  }

  _setInterpolationEnabled(value, stamp = 0, depth = 0) {
    const traversalStamp = beginTraversal(this, stamp, depth);
    this._interpolateTransforms = Boolean(value);
    if (this._interpolateTransforms) {
      this._previousPositionX = this.position.x; this._previousPositionY = this.position.y;
      this._previousScaleX = this.scale.x; this._previousScaleY = this.scale.y; this._previousRotation = this.rotation;
    }
    for (const child of this.children) child._setInterpolationEnabled(this._interpolateTransforms, traversalStamp, depth + 1);
    return this;
  }

  _captureInterpolation(stamp = 0, depth = 0) {
    if (!this._interpolateTransforms) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    this._previousPositionX = this.position.x; this._previousPositionY = this.position.y;
    this._previousScaleX = this.scale.x; this._previousScaleY = this.scale.y; this._previousRotation = this.rotation;
    for (const child of this.children) child._captureInterpolation(traversalStamp, depth + 1);
  }

  _applyInterpolation(alpha, stamp = 0, depth = 0) {
    if (!this._interpolateTransforms) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    const amount = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
    this._renderPositionX = this.position.x; this._renderPositionY = this.position.y;
    this._renderScaleX = this.scale.x; this._renderScaleY = this.scale.y; this._renderRotation = this.rotation;
    this.position.x = worldValue(this._previousPositionX + (this._renderPositionX - this._previousPositionX) * amount);
    this.position.y = worldValue(this._previousPositionY + (this._renderPositionY - this._previousPositionY) * amount);
    this.scale.x = worldValue(this._previousScaleX + (this._renderScaleX - this._previousScaleX) * amount);
    this.scale.y = worldValue(this._previousScaleY + (this._renderScaleY - this._previousScaleY) * amount);
    this.rotation = Number.isFinite(this._previousRotation) && Number.isFinite(this._renderRotation)
      ? this._previousRotation + (this._renderRotation - this._previousRotation) * amount
      : this._renderRotation;
    for (const child of this.children) child._applyInterpolation(amount, traversalStamp, depth + 1);
  }

  _restoreInterpolation(stamp = 0, depth = 0) {
    if (!this._interpolateTransforms) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    this.position.x = this._renderPositionX; this.position.y = this._renderPositionY;
    this.scale.x = this._renderScaleX; this.scale.y = this._renderScaleY; this.rotation = this._renderRotation;
    this._lastPositionX = undefined; this._lastPositionY = undefined;
    this._lastScaleX = undefined; this._lastScaleY = undefined; this._lastRotation = undefined;
    for (const child of this.children) child._restoreInterpolation(traversalStamp, depth + 1);
  }

  isAncestorOf(node) {
    let current = node;
    let depth = 0;
    while (current) {
      if (depth++ > MAX_SCENE_DEPTH) throw new RangeError(`Scene graph parent derinlik limiti ${MAX_SCENE_DEPTH}.`);
      if (current === this) return true;
      current = current.parent;
    }
    return false;
  }

  traverse(callback, stamp = 0, depth = 0) {
    if (this.destroyed) return;
    if (typeof callback !== "function") throw new TypeError("Node traverse callback fonksiyonu gerekli.");
    const traversalStamp = beginTraversal(this, stamp, depth);
    callback(this);
    for (const child of this.children) child.traverse(callback, traversalStamp, depth + 1);
  }

  find(predicate) {
    if (typeof predicate !== "function") throw new TypeError("Node find predicate fonksiyonu gerekli.");
    if (this.destroyed) return null;
    if (predicate(this)) return this;
    for (const child of this.children) {
      const found = child.find(predicate);
      if (found) return found;
    }
    return null;
  }

  findByName(name) {
    const targetName = String(name);
    return this.find((node) => node.name === targetName);
  }

  update(delta, stamp = 0, depth = 0) {
    if (this.destroyed) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    this.onUpdate?.(delta, this);
    for (const child of this.children) child.update(delta, traversalStamp, depth + 1);
  }

  _applyLayoutNode(parentWidth, parentHeight, parentX = 0, parentY = 0, stamp = 0, depth = 0) {
    const traversalStamp = beginTraversal(this, stamp, depth);
    const bounds = this.getLocalBounds?.() || { x: 0, y: 0, width: 0, height: 0 };
    const layout = this.layout;
    const fallbackWidth = Number.isFinite(Number(bounds.width)) ? Math.max(0, Number(bounds.width)) : 0;
    const fallbackHeight = Number.isFinite(Number(bounds.height)) ? Math.max(0, Number(bounds.height)) : 0;
    const width = layout?.width ?? (layout && layout.left !== null && layout.right !== null ? Math.max(0, parentWidth - layout.left - layout.right) : fallbackWidth);
    const height = layout?.height ?? (layout && layout.top !== null && layout.bottom !== null ? Math.max(0, parentHeight - layout.top - layout.bottom) : fallbackHeight);
    const originX = Number.isFinite(Number(bounds.x)) ? -Number(bounds.x) : 0;
    const originY = Number.isFinite(Number(bounds.y)) ? -Number(bounds.y) : 0;
    if (layout) {
      const x = layout.left !== null ? parentX + layout.left + originX : layout.right !== null ? parentX + parentWidth - layout.right - width + originX : parentX + (parentWidth - width) * layout.anchorX + originX;
      const y = layout.top !== null ? parentY + layout.top + originY : layout.bottom !== null ? parentY + parentHeight - layout.bottom - height + originY : parentY + (parentHeight - height) * layout.anchorY + originY;
      this.position.x = worldValue(x + layout.offsetX);
      this.position.y = worldValue(y + layout.offsetY);
    }
    const childX = Number.isFinite(Number(bounds.x)) ? Number(bounds.x) : 0;
    const childY = Number.isFinite(Number(bounds.y)) ? Number(bounds.y) : 0;
    for (const child of this.children) child._applyLayoutNode(width, height, childX, childY, traversalStamp, depth + 1);
  }

  applyLayout(viewportWidth, viewportHeight) {
    const traversalStamp = beginTraversal(this);
    const width = Number.isFinite(Number(viewportWidth)) ? Math.max(0, Math.min(MAX_LAYOUT_VALUE, Number(viewportWidth))) : 0;
    const height = Number.isFinite(Number(viewportHeight)) ? Math.max(0, Math.min(MAX_LAYOUT_VALUE, Number(viewportHeight))) : 0;
    for (const child of this.children) child._applyLayoutNode(width, height, 0, 0, traversalStamp, 1);
    return this;
  }

  collectFocusables(output, inheritedVisible = true, limit = 4_096, stamp = 0, depth = 0) {
    if (!output || output.length >= limit) return;
    const isVisible = inheritedVisible && this.visible && !this.destroyed;
    if (!isVisible) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    if (this.focusable && output.length < limit) output.push(this);
    for (const child of this.children) {
      if (output.length >= limit) break;
      child.collectFocusables(output, isVisible, limit, traversalStamp, depth + 1);
    }
  }

  updateWorldMatrix(parentMatrix = null, parentZ = 0, parentWorldVersion = 0, parentAlpha = 1, parentFilter = "none", parentFilterAmount = 1, parentMaskTexture = null, parentMaskRect = null, stamp = 0, depth = 0) {
    const traversalStamp = beginTraversal(this, stamp, depth);
    this.cullBounds = normalizeDirectClip(this.cullBounds);
    this.clipRect = normalizeDirectClip(this.clipRect);
    this.maskRect = normalizeDirectClip(this.maskRect);
    this.hitArea = normalizeDirectClip(this.hitArea);
    const localChanged = this.position.x !== this._lastPositionX || this.position.y !== this._lastPositionY || this.scale.x !== this._lastScaleX || this.scale.y !== this._lastScaleY || this.rotation !== this._lastRotation;
    const parentChanged = parentWorldVersion !== this._lastParentWorldVersion || parentMatrix !== this._lastParentMatrix;
    if (localChanged) {
      this.localMatrix.setTransform(this.position, this.scale, this.rotation);
      this._lastPositionX = this.position.x; this._lastPositionY = this.position.y;
      this._lastScaleX = this.scale.x; this._lastScaleY = this.scale.y; this._lastRotation = this.rotation;
    }
    if (localChanged || parentChanged) {
      if (parentMatrix) this.worldMatrix.multiply(parentMatrix, this.localMatrix);
      else this.worldMatrix = this.localMatrix;
      this._worldVersion += 1;
    }
    this._lastParentWorldVersion = parentWorldVersion;
    this._lastParentMatrix = parentMatrix;
    if (typeof this.alpha !== "number" || !Number.isFinite(this.alpha) || this.alpha < 0 || this.alpha > 1 || Object.is(this.alpha, -0)) this.alpha = normalizeAlpha(this.alpha);
    const inheritedAlpha = typeof parentAlpha === "number" && Number.isFinite(parentAlpha) && parentAlpha >= 0 && parentAlpha <= 1 && !Object.is(parentAlpha, -0) ? parentAlpha : normalizeAlpha(parentAlpha);
    this.worldAlpha = inheritedAlpha * this.alpha;
    if (this.filter !== "none" && this.filter !== "grayscale" && this.filter !== "invert" && this.filter !== "brightness" && this.filter !== "sepia" && this.filter !== "contrast" && this.filter !== "saturate") this.filter = normalizeFilterType(this.filter);
    if (typeof this.filterAmount !== "number" || !Number.isFinite(this.filterAmount) || this.filterAmount < 0 || this.filterAmount > 1 || Object.is(this.filterAmount, -0)) this.filterAmount = normalizeFilterAmount(this.filterAmount);
    const inheritedFilter = parentFilter === "none" || parentFilter === "grayscale" || parentFilter === "invert" || parentFilter === "brightness" || parentFilter === "sepia" || parentFilter === "contrast" || parentFilter === "saturate" ? parentFilter : normalizeFilterType(parentFilter);
    const inheritedFilterAmount = typeof parentFilterAmount === "number" && Number.isFinite(parentFilterAmount) && parentFilterAmount >= 0 && parentFilterAmount <= 1 && !Object.is(parentFilterAmount, -0) ? parentFilterAmount : normalizeFilterAmount(parentFilterAmount);
    this.worldFilter = this.filter === "none" ? inheritedFilter : this.filter;
    this.worldFilterAmount = this.filter === "none" ? inheritedFilterAmount : this.filterAmount;
    if (this.maskTexture !== null && !(this.maskTexture instanceof Texture)) this.maskTexture = normalizeMaskTexture(this.maskTexture);
    const inheritedMaskTexture = parentMaskTexture === null || parentMaskTexture instanceof Texture ? parentMaskTexture : normalizeMaskTexture(parentMaskTexture);
    const inheritedMaskRect = normalizeDirectClip(parentMaskRect);
    this.worldMaskTexture = this.maskTexture || inheritedMaskTexture;
    this.worldMaskRect = this.maskTexture ? this.maskRect : (this.worldMaskTexture ? inheritedMaskRect : null);
    const localZ = Number.isFinite(Number(this.zIndex)) ? Number(this.zIndex) : 0;
    const worldDepth = (Number.isFinite(Number(parentZ)) ? Number(parentZ) : 0) + localZ;
    this.worldZ = Number.isFinite(worldDepth) ? worldDepth : 0;
    for (const child of this.children) child.updateWorldMatrix(this.worldMatrix, this.worldZ, this._worldVersion, this.worldAlpha, this.worldFilter, this.worldFilterAmount, this.worldMaskTexture, this.worldMaskRect, traversalStamp, depth + 1);
  }

  collectRenderables(output, inheritedVisible = true, inheritedClip = null, camera = null, width = 0, height = 0, cullStats = null, scratch = null, offscreenRoot = false, stamp = 0, depth = 0) {
    const isVisible = inheritedVisible && this.visible && !this.destroyed;
    if (!isVisible) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    if (this.cullable !== false && this.cullBounds && !boundsVisible(this, this.cullBounds, camera, width, height, scratch)) {
      if (cullStats) cullStats.value += 1;
      return;
    }
    const ownClip = this.maskRect ? intersectClip(this.clipRect, this.maskRect, this.renderClipCache) : this.clipRect;
    if (this.maskRect && ownClip !== this.clipRect && ownClip !== this.maskRect) this.renderClipCache = ownClip;
    const renderClip = intersectClip(inheritedClip, ownClip, this.renderClipCache);
    if (renderClip !== inheritedClip && renderClip !== ownClip) this.renderClipCache = renderClip;
    this.renderClip = renderClip;
    if (!this.isRenderGroup || !offscreenRoot) {
      if (this.isRenderable) output.push(this);
    }
    if (this.childrenDirty) {
      this.children.sort((left, right) => left.zIndex - right.zIndex);
      this.childrenDirty = false;
    }
    if (!this.isRenderGroup || offscreenRoot) for (const child of this.children) child.collectRenderables(output, isVisible, renderClip, camera, width, height, cullStats, scratch, false, traversalStamp, depth + 1);
  }

  collectHitTestables(output, inheritedVisible = true, stamp = 0, depth = 0) {
    const isVisible = inheritedVisible && this.visible && !this.destroyed;
    if (!isVisible) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    if (this.isRenderable || this.interactive) output.push(this);
    if (this.childrenDirty) {
      this.children.sort((left, right) => left.zIndex - right.zIndex);
      this.childrenDirty = false;
    }
    for (const child of this.children) child.collectHitTestables(output, isVisible, traversalStamp, depth + 1);
  }

  collectSprites(output, inheritedVisible = true) { this.collectRenderables(output, inheritedVisible); }

  destroy(stamp = 0, depth = 0) {
    if (this.destroyed) return;
    const traversalStamp = beginTraversal(this, stamp, depth);
    while (this.children.length > 0) {
      const child = this.children[this.children.length - 1];
      child.destroy(traversalStamp, depth + 1);
      if (this.children[this.children.length - 1] === child) {
        this.children.pop();
        if (child.parent === this) child.parent = null;
      }
    }
    this.parent?.remove(this);
    this.children.length = 0;
    this._refreshRenderGroupSubtree();
    this.destroyed = true;
  }
}

export class Scene extends Node {
  constructor(options = {}) {
    super({ name: "scene", ...options });
    this.hitTestScratch = [];
  }

  pick(worldX, worldY, predicate = null) {
    if (predicate !== null && typeof predicate !== "function") throw new TypeError("Scene pick predicate fonksiyonu gerekli.");
    const x = Number(worldX); const y = Number(worldY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    this.updateWorldMatrix();
    const candidates = this.hitTestScratch;
    candidates.length = 0;
    this.collectHitTestables(candidates);
    let hit = null;
    let hitZ = -Infinity;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      if (predicate && !predicate(candidate)) continue;
      if (candidate.containsPoint(x, y) && (!hit || candidate.worldZ > hitZ || candidate.worldZ === hitZ)) {
        hit = candidate;
        hitZ = candidate.worldZ;
      }
    }
    candidates.length = 0;
    return hit;
  }
}
