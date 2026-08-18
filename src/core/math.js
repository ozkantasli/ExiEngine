export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (from, to, amount) => from + (to - from) * amount;
export const degToRad = (degrees) => degrees * Math.PI / 180;
export const radToDeg = (radians) => radians * 180 / Math.PI;

export const MAX_WORLD_COORDINATE = 1_000_000_000;

export const worldValue = (value, fallback = 0) => {
  const number = Number(value);
  if (Number.isNaN(number)) return fallback;
  return Number.isFinite(number) ? Math.min(MAX_WORLD_COORDINATE, Math.max(-MAX_WORLD_COORDINATE, number)) : fallback;
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boundedResult = (value, fallback = 0) => {
  if (value === Infinity) return MAX_WORLD_COORDINATE;
  if (value === -Infinity) return -MAX_WORLD_COORDINATE;
  return worldValue(value, fallback);
};
const worldProduct = (left, right) => boundedResult(Number(left) * Number(right));
const worldSum = (a, b, c) => {
  if (c !== undefined) return boundedResult(Number(a) + Number(b) + Number(c));
  if (b !== undefined) return boundedResult(Number(a) + Number(b));
  return boundedResult(Number(a) || 0);
};

export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = worldValue(x);
    this.y = worldValue(y);
  }

  set(x, y = x) { this.x = worldValue(x); this.y = worldValue(y); return this; }
  copy(other) { return this.set(other?.x, other?.y); }
  clone() { return new Vec2(this.x, this.y); }
  add(other) { this.x = worldSum(this.x, other?.x); this.y = worldSum(this.y, other?.y); return this; }
  subtract(other) { this.x = worldSum(this.x, -finite(other?.x)); this.y = worldSum(this.y, -finite(other?.y)); return this; }
  multiplyScalar(value) { const scalar = finite(value, 1); this.x = worldProduct(this.x, scalar); this.y = worldProduct(this.y, scalar); return this; }
  length() { return Math.hypot(this.x, this.y); }
  lengthSquared() { return worldSum(worldProduct(this.x, this.x), worldProduct(this.y, this.y)); }
  normalize() { const length = this.length(); return Number.isFinite(length) && length > 0 ? this.multiplyScalar(1 / length) : this; }
  dot(other) { return worldSum(worldProduct(this.x, finite(other?.x)), worldProduct(this.y, finite(other?.y))); }
  distanceTo(other) { return Math.hypot(this.x - finite(other?.x), this.y - finite(other?.y)); }
  distanceSquared(other) { const dx = this.x - finite(other?.x); const dy = this.y - finite(other?.y); return worldSum(worldProduct(dx, dx), worldProduct(dy, dy)); }
  angle() { return Math.atan2(this.y, this.x); }
  rotate(radians) {
    const angle = finite(radians);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x = worldSum(worldProduct(this.x, cos), worldProduct(-this.y, sin));
    const y = worldSum(worldProduct(this.x, sin), worldProduct(this.y, cos));
    this.x = x;
    this.y = y;
    return this;
  }
  equals(other, epsilon = 0) {
    if (!other) return false;
    const eps = Math.max(0, finite(epsilon));
    return Math.abs(this.x - finite(other.x)) <= eps && Math.abs(this.y - finite(other.y)) <= eps;
  }
}

export class Mat3 {
  constructor() { this.identity(); }

  identity() {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.tx = 0; this.ty = 0;
    return this;
  }

  setTransform(position, scale, rotation) {
    const angle = finite(rotation);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const scaleX = worldValue(scale?.x, 1); const scaleY = worldValue(scale?.y, 1);
    this.a = worldProduct(cosine, scaleX);
    this.b = worldProduct(sine, scaleX);
    this.c = worldProduct(-sine, scaleY);
    this.d = worldProduct(cosine, scaleY);
    this.tx = worldValue(position?.x);
    this.ty = worldValue(position?.y);
    return this;
  }

  multiply(parent, local) {
    const a = worldSum(worldProduct(parent.a, local.a), worldProduct(parent.c, local.b));
    const b = worldSum(worldProduct(parent.b, local.a), worldProduct(parent.d, local.b));
    const c = worldSum(worldProduct(parent.a, local.c), worldProduct(parent.c, local.d));
    const d = worldSum(worldProduct(parent.b, local.c), worldProduct(parent.d, local.d));
    const tx = worldSum(worldProduct(parent.a, local.tx), worldProduct(parent.c, local.ty), parent.tx);
    const ty = worldSum(worldProduct(parent.b, local.tx), worldProduct(parent.d, local.ty), parent.ty);
    this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty;
    return this;
  }

  transformPoint(x, y, out = { x: 0, y: 0 }) {
    out.x = worldSum(worldProduct(this.a, worldValue(x)), worldProduct(this.c, worldValue(y)), this.tx);
    out.y = worldSum(worldProduct(this.b, worldValue(x)), worldProduct(this.d, worldValue(y)), this.ty);
    return out;
  }
}


