import { Node } from "./node.js";
import { Texture } from "../assets/texture.js";
import { worldValue } from "./math.js";
import { updateStaticRenderKey } from "../render/batch.js";

const clampSegments = (value) => Math.max(3, Math.min(64, value | 0));
const MAX_GRAPHICS_COMMANDS = 4_096;
const MAX_GRAPHICS_POLYGON_POINTS = 256;
const finite = (value, fallback = 0) => worldValue(value, fallback);
const alphaValue = (value) => Math.max(0, Math.min(1, finite(value, 1)));

function cross(points, first, second, third) {
  const firstOffset = first * 2; const secondOffset = second * 2; const thirdOffset = third * 2;
  return (points[secondOffset] - points[firstOffset]) * (points[thirdOffset + 1] - points[firstOffset + 1])
    - (points[secondOffset + 1] - points[firstOffset + 1]) * (points[thirdOffset] - points[firstOffset]);
}

function pointInsideTriangle(points, point, first, second, third) {
  const ab = cross(points, first, second, point); const bc = cross(points, second, third, point); const ca = cross(points, third, first, point);
  return (ab > 0 && bc > 0 && ca > 0) || (ab < 0 && bc < 0 && ca < 0);
}

function triangulatePolygon(points) {
  const pointCount = points.length / 2;
  let area = 0;
  for (let index = 0; index < pointCount; index += 1) {
    const next = (index + 1) % pointCount;
    area += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
  }
  if (!Number.isFinite(area) || area === 0) throw new RangeError("Graphics polygon alanı geçersiz.");
  const indices = Array.from({ length: pointCount }, (_, index) => index);
  if (area < 0) indices.reverse();
  const positions = [];
  let guard = 0;
  while (indices.length > 3) {
    let earFound = false;
    for (let index = 0; index < indices.length; index += 1) {
      const previous = indices[(index + indices.length - 1) % indices.length];
      const current = indices[index];
      const next = indices[(index + 1) % indices.length];
      if (cross(points, previous, current, next) <= 0) continue;
      let containsPoint = false;
      for (const candidate of indices) {
        if (candidate === previous || candidate === current || candidate === next) continue;
        if (pointInsideTriangle(points, candidate, previous, current, next)) { containsPoint = true; break; }
      }
      if (containsPoint) continue;
      positions.push(
        points[previous * 2], points[previous * 2 + 1],
        points[current * 2], points[current * 2 + 1],
        points[next * 2], points[next * 2 + 1],
      );
      indices.splice(index, 1);
      earFound = true;
      break;
    }
    guard += 1;
    if (!earFound || guard > pointCount * pointCount) throw new RangeError("Graphics polygon üçgenlenemedi.");
  }
  positions.push(
    points[indices[0] * 2], points[indices[0] * 2 + 1],
    points[indices[1] * 2], points[indices[1] * 2 + 1],
    points[indices[2] * 2], points[indices[2] * 2 + 1],
  );
  return positions;
}

function polygonBounds(points) {
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (let index = 0; index < points.length; index += 2) {
    left = Math.min(left, points[index]); top = Math.min(top, points[index + 1]);
    right = Math.max(right, points[index]); bottom = Math.max(bottom, points[index + 1]);
  }
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function resetRenderItem(items, index) {
  let item = items[index];
  if (!item) {
    item = { texture: Texture.white, tint: 0xffffff, alpha: 1, bounds: { x: 0, y: 0, width: 0, height: 0 }, positions: [] };
    items[index] = item;
  }
  item.texture = Texture.white;
  item.positions.length = 0;
  return item;
}

export class Graphics extends Node {
  constructor({ staticCache = false, ...options } = {}) {
    super({ name: "graphics", ...options });
    this.isRenderable = true;
    this.staticCache = Boolean(staticCache);
    this.commands = [];
    this.renderItems = [];
    this.renderItemPool = [];
    this.itemsDirty = true;
    this.contentVersion = 0;
    this.staticKeyState = { version: 0, contentVersion: -1 };
    this.boundsCache = null;
  }

  clear() { this.commands.length = 0; this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1; return this; }

  rect(x, y, width, height, { fill = 0xffffff, alpha = 1 } = {}) {
    const left = finite(x); const top = finite(y); const rectWidth = finite(width); const rectHeight = finite(height);
    if (rectWidth <= 0 || rectHeight <= 0 || this.commands.length >= MAX_GRAPHICS_COMMANDS) { if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`); return this; }
    this.commands.push({ type: "rect", x: left, y: top, width: rectWidth, height: rectHeight, tint: fill, alpha: alphaValue(alpha) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  circle(x, y, radius, { fill = 0xffffff, alpha = 1, segments = 24 } = {}) {
    const centerX = finite(x); const centerY = finite(y); const circleRadius = finite(radius);
    if (circleRadius <= 0 || this.commands.length >= MAX_GRAPHICS_COMMANDS) { if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`); return this; }
    this.commands.push({ type: "circle", x: centerX, y: centerY, radius: circleRadius, tint: fill, alpha: alphaValue(alpha), segments: clampSegments(segments) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  line(x1, y1, x2, y2, width = 1, { fill = 0xffffff, alpha = 1 } = {}) {
    const startX = finite(x1); const startY = finite(y1); const endX = finite(x2); const endY = finite(y2); const lineWidth = finite(width);
    if (lineWidth <= 0 || this.commands.length >= MAX_GRAPHICS_COMMANDS) { if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`); return this; }
    this.commands.push({ type: "line", x1: startX, y1: startY, x2: endX, y2: endY, width: lineWidth, tint: fill, alpha: alphaValue(alpha) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  triangle(x1, y1, x2, y2, x3, y3, { fill = 0xffffff, alpha = 1 } = {}) {
    const p1x = finite(x1); const p1y = finite(y1);
    const p2x = finite(x2); const p2y = finite(y2);
    const p3x = finite(x3); const p3y = finite(y3);
    if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`);
    this.commands.push({ type: "triangle", x1: p1x, y1: p1y, x2: p2x, y2: p2y, x3: p3x, y3: p3y, tint: fill, alpha: alphaValue(alpha) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  ellipse(x, y, radiusX, radiusY, { fill = 0xffffff, alpha = 1, segments = 24 } = {}) {
    const centerX = finite(x); const centerY = finite(y);
    const rx = finite(radiusX); const ry = finite(radiusY);
    if (rx <= 0 || ry <= 0 || this.commands.length >= MAX_GRAPHICS_COMMANDS) {
      if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`);
      return this;
    }
    this.commands.push({ type: "ellipse", x: centerX, y: centerY, radiusX: rx, radiusY: ry, tint: fill, alpha: alphaValue(alpha), segments: clampSegments(segments) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  roundedRect(x, y, width, height, radius, { fill = 0xffffff, alpha = 1, segments = 8 } = {}) {
    const left = finite(x); const top = finite(y); const rectWidth = finite(width); const rectHeight = finite(height);
    const r = Math.min(Math.max(0, finite(radius)), rectWidth * 0.5, rectHeight * 0.5);
    if (rectWidth <= 0 || rectHeight <= 0) return this;
    if (r <= 0) return this.rect(left, top, rectWidth, rectHeight, { fill, alpha });
    const segs = Math.max(2, Math.min(16, Number(segments) | 0));
    const points = [];
    const corners = [
      { cx: left + rectWidth - r, cy: top + r, startAngle: -Math.PI * 0.5, endAngle: 0 },
      { cx: left + rectWidth - r, cy: top + rectHeight - r, startAngle: 0, endAngle: Math.PI * 0.5 },
      { cx: left + r, cy: top + rectHeight - r, startAngle: Math.PI * 0.5, endAngle: Math.PI },
      { cx: left + r, cy: top + r, startAngle: Math.PI, endAngle: Math.PI * 1.5 },
    ];
    for (const corner of corners) {
      for (let i = 0; i <= segs; i += 1) {
        const angle = corner.startAngle + (corner.endAngle - corner.startAngle) * (i / segs);
        points.push(worldValue(corner.cx + Math.cos(angle) * r), worldValue(corner.cy + Math.sin(angle) * r));
      }
    }
    return this.polygon(points, { fill, alpha });
  }

  strokeRect(x, y, width, height, lineWidth = 1, { fill = 0xffffff, alpha = 1 } = {}) {
    const left = finite(x); const top = finite(y); const w = finite(width); const h = finite(height); const lw = finite(lineWidth, 1);
    if (w <= 0 || h <= 0 || lw <= 0) return this;
    this.line(left, top, left + w, top, lw, { fill, alpha });
    this.line(left + w, top, left + w, top + h, lw, { fill, alpha });
    this.line(left + w, top + h, left, top + h, lw, { fill, alpha });
    this.line(left, top + h, left, top, lw, { fill, alpha });
    return this;
  }

  strokeCircle(x, y, radius, lineWidth = 1, { fill = 0xffffff, alpha = 1, segments = 24 } = {}) {
    const cx = finite(x); const cy = finite(y); const r = finite(radius); const lw = finite(lineWidth, 1);
    if (r <= 0 || lw <= 0) return this;
    const segs = clampSegments(segments);
    for (let i = 0; i < segs; i += 1) {
      const first = i * Math.PI * 2 / segs;
      const second = (i + 1) * Math.PI * 2 / segs;
      this.line(
        worldValue(cx + Math.cos(first) * r), worldValue(cy + Math.sin(first) * r),
        worldValue(cx + Math.cos(second) * r), worldValue(cy + Math.sin(second) * r),
        lw, { fill, alpha }
      );
    }
    return this;
  }

  polygon(points, { fill = 0xffffff, alpha = 1 } = {}) {
    const length = Number(points?.length);
    if (!Number.isSafeInteger(length) || length < 6 || length % 2 !== 0) throw new TypeError("Graphics polygon points çift sayıda ve en az üç nokta olmalı.");
    const pointCount = length / 2;
    if (pointCount > MAX_GRAPHICS_POLYGON_POINTS) throw new RangeError(`Graphics polygon nokta limiti ${MAX_GRAPHICS_POLYGON_POINTS}.`);
    if (this.commands.length >= MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`);
    const normalized = new Array(length);
    for (let index = 0; index < length; index += 1) normalized[index] = finite(points[index]);
    this.commands.push({ type: "polygon", positions: triangulatePolygon(normalized), bounds: polygonBounds(normalized), tint: fill, alpha: alphaValue(alpha) });
    this.itemsDirty = true; this.boundsCache = null; this.contentVersion += 1;
    return this;
  }

  getRenderItems() {
    if (this.commands.length > MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`);
    if (!this.itemsDirty) return this.renderItems;
    const renderItems = this.renderItems;
    let itemIndex = 0;
    for (const command of this.commands) {
      if (command.type === "rect") {
        const right = worldValue(command.x + command.width); const bottom = worldValue(command.y + command.height);
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        item.bounds.x = command.x; item.bounds.y = command.y; item.bounds.width = Math.max(0, right - command.x); item.bounds.height = Math.max(0, bottom - command.y);
        item.positions.push(command.x, command.y, right, command.y, right, bottom, command.x, command.y, right, bottom, command.x, bottom);
      } else if (command.type === "circle") {
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        item.bounds.x = worldValue(command.x - command.radius); item.bounds.y = worldValue(command.y - command.radius);
        item.bounds.width = worldValue(command.radius * 2); item.bounds.height = worldValue(command.radius * 2);
        const positions = item.positions;
        for (let index = 0; index < command.segments; index += 1) {
          const first = index * Math.PI * 2 / command.segments;
          const second = (index + 1) * Math.PI * 2 / command.segments;
          positions.push(command.x, command.y, worldValue(command.x + Math.cos(first) * command.radius), worldValue(command.y + Math.sin(first) * command.radius), worldValue(command.x + Math.cos(second) * command.radius), worldValue(command.y + Math.sin(second) * command.radius));
        }
      } else if (command.type === "ellipse") {
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        item.bounds.x = worldValue(command.x - command.radiusX); item.bounds.y = worldValue(command.y - command.radiusY);
        item.bounds.width = worldValue(command.radiusX * 2); item.bounds.height = worldValue(command.radiusY * 2);
        const positions = item.positions;
        for (let index = 0; index < command.segments; index += 1) {
          const first = index * Math.PI * 2 / command.segments;
          const second = (index + 1) * Math.PI * 2 / command.segments;
          positions.push(command.x, command.y, worldValue(command.x + Math.cos(first) * command.radiusX), worldValue(command.y + Math.sin(first) * command.radiusY), worldValue(command.x + Math.cos(second) * command.radiusX), worldValue(command.y + Math.sin(second) * command.radiusY));
        }
      } else if (command.type === "triangle") {
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        const minX = Math.min(command.x1, command.x2, command.x3);
        const minY = Math.min(command.y1, command.y2, command.y3);
        const maxX = Math.max(command.x1, command.x2, command.x3);
        const maxY = Math.max(command.y1, command.y2, command.y3);
        item.bounds.x = worldValue(minX); item.bounds.y = worldValue(minY);
        item.bounds.width = worldValue(Math.max(0, maxX - minX)); item.bounds.height = worldValue(Math.max(0, maxY - minY));
        item.positions.push(command.x1, command.y1, command.x2, command.y2, command.x3, command.y3);
      } else if (command.type === "polygon") {
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        item.bounds.x = command.bounds.x; item.bounds.y = command.bounds.y; item.bounds.width = command.bounds.width; item.bounds.height = command.bounds.height;
        for (const value of command.positions) item.positions.push(value);
      } else {
        const item = resetRenderItem(this.renderItemPool, itemIndex); renderItems[itemIndex++] = item;
        item.tint = command.tint; item.alpha = command.alpha;
        const dx = command.x2 - command.x1; const dy = command.y2 - command.y1; const length = Math.hypot(dx, dy) || 1; const nx = -dy / length * command.width * 0.5; const ny = dx / length * command.width * 0.5;
        item.bounds.x = worldValue(Math.min(command.x1, command.x2) - command.width * 0.5); item.bounds.y = worldValue(Math.min(command.y1, command.y2) - command.width * 0.5);
        item.bounds.width = worldValue(Math.abs(command.x2 - command.x1) + command.width); item.bounds.height = worldValue(Math.abs(command.y2 - command.y1) + command.width);
        item.positions.push(worldValue(command.x1 + nx), worldValue(command.y1 + ny), worldValue(command.x2 + nx), worldValue(command.y2 + ny), worldValue(command.x2 - nx), worldValue(command.y2 - ny), worldValue(command.x1 + nx), worldValue(command.y1 + ny), worldValue(command.x2 - nx), worldValue(command.y2 - ny), worldValue(command.x1 - nx), worldValue(command.y1 - ny));
      }
    }
    renderItems.length = itemIndex;
    this.itemsDirty = false;
    return renderItems;
  }

  getStaticRenderKey(camera, width, height) {
    if (!this.staticCache) return null;
    return updateStaticRenderKey(this.staticKeyState, this.contentVersion, camera, width, height, this.worldMatrix, this.renderClip, this.worldAlpha, this.worldFilter, this.worldFilterAmount, this.worldMaskTexture, this.worldMaskRect);
  }

  getLocalBounds() {
    if (this.commands.length > MAX_GRAPHICS_COMMANDS) throw new RangeError(`Graphics komut limiti ${MAX_GRAPHICS_COMMANDS}.`);
    if (this.boundsCache) return this.boundsCache;
    const items = this.getRenderItems();
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const item of items) for (let index = 0; index < item.positions.length; index += 2) {
      const x = item.positions[index]; const y = item.positions[index + 1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    this.boundsCache = Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : { x: 0, y: 0, width: 0, height: 0 };
    return this.boundsCache;
  }

  destroy() {
    this.commands.length = 0;
    this.renderItems.length = 0;
    this.renderItemPool.length = 0;
    this.boundsCache = null;
    this.staticRenderCache = null;
    super.destroy();
  }
}
