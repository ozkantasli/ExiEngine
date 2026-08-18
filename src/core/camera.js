import { Vec2, worldValue } from "./math.js";

const MAX_CAMERA_VIEWPORT = 16_384;
const MAX_CAMERA_ZOOM = 1_000;
const MAX_CAMERA_PIXEL_RATIO = 4;
const MAX_CAMERA_SHAKE_AMPLITUDE = 2_048;
const MAX_CAMERA_SHAKE_DURATION = 10;
const MAX_CAMERA_SHAKE_FREQUENCY = 120;
const viewport = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(MAX_CAMERA_VIEWPORT, Math.max(1, Math.floor(number))) : fallback;
};
const pixelRatioValue = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(MAX_CAMERA_PIXEL_RATIO, Math.max(0.25, number)) : fallback;
};
function normalizeBounds(value) {
  if (!value || typeof value !== "object") throw new TypeError("Camera bounds nesnesi gerekli.");
  const x = Number(value.x); const y = Number(value.y); const width = Number(value.width); const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new RangeError("Camera bounds finite ve pozitif olmalı.");
  return { x: worldValue(x), y: worldValue(y), width: worldValue(width), height: worldValue(height) };
}

function normalizeDirectBounds(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    const x = Number(value.x); const y = Number(value.y); const width = Number(value.width); const height = Number(value.height);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
      && value.x === worldValue(x) && value.y === worldValue(y)
      && value.width === worldValue(width) && value.height === worldValue(height)) return value;
  }
  return normalizeBounds(value);
}

export class Camera {
  constructor({ x = 0, y = 0, zoom = 1, rotation = 0, width = 1, height = 1, pixelRatio = 1, roundPixels = false, bounds = null } = {}) {
    this.position = new Vec2(x, y);
    this.bounds = null;
    this.followTarget = null;
    this.followOffset = new Vec2();
    this.followDeadzone = new Vec2();
    this.followSmoothing = 1;
    this.shakeOffset = new Vec2();
    this.shakeAmplitude = 0;
    this.shakeDuration = 0;
    this.shakeElapsed = 0;
    this.shakeFrequency = 24;
    this.shakePhase = 0;
    const requestedZoom = Number(zoom); const requestedRotation = Number(rotation);
    this.zoom = Number.isFinite(requestedZoom) && requestedZoom > 0 ? Math.min(MAX_CAMERA_ZOOM, Math.max(0.0001, requestedZoom)) : 1;
    this.rotation = Number.isFinite(requestedRotation) ? requestedRotation : 0;
    this.width = viewport(width, 1);
    this.height = viewport(height, 1);
    this.viewportX = 0;
    this.viewportY = 0;
    this.viewportWidth = this.width;
    this.viewportHeight = this.height;
    this.pixelRatio = pixelRatioValue(pixelRatio, 1);
    this.roundPixels = Boolean(roundPixels);
    if (bounds !== null) this.setBounds(bounds);
  }

  normalize() {
    this.position.x = Number.isFinite(Number(this.position.x)) ? Number(this.position.x) : 0;
    this.position.y = Number.isFinite(Number(this.position.y)) ? Number(this.position.y) : 0;
    const zoom = Number(this.zoom);
    const rotation = Number(this.rotation);
    this.zoom = Number.isFinite(zoom) && zoom > 0 ? Math.min(MAX_CAMERA_ZOOM, Math.max(0.0001, zoom)) : 1;
    this.rotation = Number.isFinite(rotation) ? rotation : 0;
    this.width = viewport(this.width, 1);
    this.height = viewport(this.height, 1);
    this.viewportX = worldValue(this.viewportX);
    this.viewportY = worldValue(this.viewportY);
    this.viewportWidth = viewport(this.viewportWidth, this.width);
    this.viewportHeight = viewport(this.viewportHeight, this.height);
    this.pixelRatio = pixelRatioValue(this.pixelRatio, 1);
    this.roundPixels = Boolean(this.roundPixels);
    this.clampToBounds();
    return this;
  }

  setViewport(width, height) {
    this.width = viewport(width, this.width);
    this.height = viewport(height, this.height);
    this.viewportX = 0;
    this.viewportY = 0;
    this.viewportWidth = this.width;
    this.viewportHeight = this.height;
    return this.clampToBounds();
  }
  setScreenViewport(x, y, width, height) {
    this.viewportX = worldValue(x);
    this.viewportY = worldValue(y);
    this.viewportWidth = viewport(width, this.width);
    this.viewportHeight = viewport(height, this.height);
    return this.clampToBounds();
  }
  isScreenPointInViewport(x, y) {
    const screenX = Number(x); const screenY = Number(y);
    return Number.isFinite(screenX) && Number.isFinite(screenY)
      && screenX >= this.viewportX && screenX <= this.viewportX + this.viewportWidth
      && screenY >= this.viewportY && screenY <= this.viewportY + this.viewportHeight;
  }
  setPixelRatio(value) { this.pixelRatio = pixelRatioValue(value, this.pixelRatio); return this.clampToBounds(); }
  setRoundPixels(value) { this.roundPixels = Boolean(value); return this; }

  setBounds(bounds) { this.bounds = normalizeBounds(bounds); return this.clampToBounds(); }
  clearBounds() { this.bounds = null; return this; }

  zoomAt(screenX, screenY, zoom) {
    this.normalize();
    const requestedZoom = Number(zoom);
    if (!Number.isFinite(requestedZoom) || requestedZoom <= 0) return this;
    const x = Number.isFinite(Number(screenX)) ? Number(screenX) : 0;
    const y = Number.isFinite(Number(screenY)) ? Number(screenY) : 0;
    const cosine = Math.cos(this.rotation);
    const sine = Math.sin(this.rotation);
    const oldScale = this.zoom * this.pixelRatio;
    const oldDX = (x - this.viewportX - this.viewportWidth * 0.5) / oldScale;
    const oldDY = (y - this.viewportY - this.viewportHeight * 0.5) / oldScale;
    const worldX = this.position.x + oldDX * cosine - oldDY * sine;
    const worldY = this.position.y + oldDX * sine + oldDY * cosine;
    this.zoom = Math.min(MAX_CAMERA_ZOOM, Math.max(0.0001, requestedZoom));
    const newScale = this.zoom * this.pixelRatio;
    const newDX = (x - this.viewportX - this.viewportWidth * 0.5) / newScale;
    const newDY = (y - this.viewportY - this.viewportHeight * 0.5) / newScale;
    this.position.x = worldX - (newDX * cosine - newDY * sine);
    this.position.y = worldY - (newDX * sine + newDY * cosine);
    return this.clampToBounds();
  }

  clampToBounds() {
    this.bounds = normalizeDirectBounds(this.bounds);
    const bounds = this.bounds;
    if (!bounds) return this;
    const cosine = Math.abs(Math.cos(this.rotation));
    const sine = Math.abs(Math.sin(this.rotation));
    const scale = this.zoom * this.pixelRatio;
    const halfWidth = (cosine * this.viewportWidth + sine * this.viewportHeight) / (2 * scale);
    const halfHeight = (sine * this.viewportWidth + cosine * this.viewportHeight) / (2 * scale);
    const minX = bounds.x + Math.min(halfWidth, bounds.width * 0.5);
    const maxX = bounds.x + bounds.width - Math.min(halfWidth, bounds.width * 0.5);
    const minY = bounds.y + Math.min(halfHeight, bounds.height * 0.5);
    const maxY = bounds.y + bounds.height - Math.min(halfHeight, bounds.height * 0.5);
    this.position.x = Math.max(minX, Math.min(maxX, this.position.x));
    this.position.y = Math.max(minY, Math.min(maxY, this.position.y));
    return this;
  }

  follow(target, { offsetX = 0, offsetY = 0, smoothing = 1, deadzoneWidth = 0, deadzoneHeight = 0 } = {}) {
    const point = target?.position || target;
    if (!target || typeof target !== "object" || !point || typeof point !== "object" || !("x" in point) || !("y" in point)) throw new TypeError("Camera follow hedefi x/y veya position.x/position.y taşımalı.");
    const requestedSmoothing = Number(smoothing);
    this.followTarget = target;
    this.followOffset.set(offsetX, offsetY);
    this.followDeadzone.set(Math.max(0, worldValue(deadzoneWidth)), Math.max(0, worldValue(deadzoneHeight)));
    this.followSmoothing = Number.isFinite(requestedSmoothing) ? Math.min(1, Math.max(0, requestedSmoothing)) : 1;
    return this;
  }

  clearFollow() { this.followTarget = null; return this; }

  get isShaking() { return this.shakeDuration > 0; }

  shake(amplitude = 4, duration = 0.2, { frequency = 24 } = {}) {
    const requestedAmplitude = Number(amplitude);
    const requestedDuration = Number(duration);
    if (!Number.isFinite(requestedAmplitude) || !Number.isFinite(requestedDuration) || requestedAmplitude <= 0 || requestedDuration <= 0) return this.clearShake();
    const requestedFrequency = Number(frequency);
    this.shakeAmplitude = Math.min(MAX_CAMERA_SHAKE_AMPLITUDE, Math.max(0, Math.abs(requestedAmplitude)));
    this.shakeDuration = Math.min(MAX_CAMERA_SHAKE_DURATION, Math.max(0.0001, requestedDuration));
    this.shakeElapsed = 0;
    this.shakeFrequency = Number.isFinite(requestedFrequency) ? Math.min(MAX_CAMERA_SHAKE_FREQUENCY, Math.max(1, requestedFrequency)) : 24;
    this.shakePhase = (this.shakePhase + 0.754877666) % (Math.PI * 2);
    return this;
  }

  clearShake() {
    this.position.x = worldValue(this.position.x - this.shakeOffset.x);
    this.position.y = worldValue(this.position.y - this.shakeOffset.y);
    this.shakeOffset.set(0, 0);
    this.shakeAmplitude = 0;
    this.shakeDuration = 0;
    this.shakeElapsed = 0;
    return this.normalize();
  }

  update(delta = 1 / 60) {
    this.position.x = worldValue(this.position.x - this.shakeOffset.x);
    this.position.y = worldValue(this.position.y - this.shakeOffset.y);
    this.shakeOffset.set(0, 0);
    const point = this.followTarget?.position || this.followTarget;
    if (point) {
      const x = Number(point.x); const y = Number(point.y);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const amount = Number.isFinite(Number(this.followSmoothing)) ? Math.min(1, Math.max(0, Number(this.followSmoothing))) : 1;
        const offsetX = Number.isFinite(Number(this.followOffset.x)) ? Number(this.followOffset.x) : 0;
        const offsetY = Number.isFinite(Number(this.followOffset.y)) ? Number(this.followOffset.y) : 0;
        const deadzoneX = Math.max(0, worldValue(this.followDeadzone.x));
        const deadzoneY = Math.max(0, worldValue(this.followDeadzone.y));
        const requestedX = x + offsetX;
        const requestedY = y + offsetY;
        let targetX = this.position.x;
        let targetY = this.position.y;
        if (requestedX < this.position.x - deadzoneX * 0.5) targetX = requestedX + deadzoneX * 0.5;
        else if (requestedX > this.position.x + deadzoneX * 0.5) targetX = requestedX - deadzoneX * 0.5;
        if (requestedY < this.position.y - deadzoneY * 0.5) targetY = requestedY + deadzoneY * 0.5;
        else if (requestedY > this.position.y + deadzoneY * 0.5) targetY = requestedY - deadzoneY * 0.5;
        this.position.x += (targetX - this.position.x) * amount;
        this.position.y += (targetY - this.position.y) * amount;
      }
    }
    this.normalize();
    if (this.shakeDuration <= 0) return this;
    const requestedDelta = Number(delta);
    this.shakeElapsed = Math.min(this.shakeDuration, this.shakeElapsed + (Number.isFinite(requestedDelta) ? Math.max(0, requestedDelta) : 0));
    const progress = Math.min(1, this.shakeElapsed / this.shakeDuration);
    const amount = this.shakeAmplitude * (1 - progress);
    if (amount <= 0) return this.clearShake();
    const angle = this.shakePhase + this.shakeElapsed * this.shakeFrequency * Math.PI * 2;
    this.shakeOffset.x = Math.sin(angle) * amount;
    this.shakeOffset.y = Math.cos(angle * 1.37) * amount * 0.7;
    this.position.x = worldValue(this.position.x + this.shakeOffset.x);
    this.position.y = worldValue(this.position.y + this.shakeOffset.y);
    return this;
  }

  worldToScreen(x, y, out = { x: 0, y: 0 }) {
    const dx = worldValue(x) - worldValue(this.position.x);
    const dy = worldValue(y) - worldValue(this.position.y);
    const cosine = Math.cos(-this.rotation);
    const sine = Math.sin(-this.rotation);
    const scale = this.zoom * this.pixelRatio;
    out.x = worldValue(this.viewportX + this.viewportWidth * 0.5 + (dx * cosine - dy * sine) * scale);
    out.y = worldValue(this.viewportY + this.viewportHeight * 0.5 + (dx * sine + dy * cosine) * scale);
    if (this.roundPixels) { out.x = Math.round(out.x); out.y = Math.round(out.y); }
    return out;
  }

  screenToWorld(x, y, out = { x: 0, y: 0 }) {
    this.normalize();
    const screenX = Number.isFinite(Number(x)) ? Number(x) : 0;
    const screenY = Number.isFinite(Number(y)) ? Number(y) : 0;
    const scale = this.zoom * this.pixelRatio;
    const dx = (screenX - this.viewportX - this.viewportWidth * 0.5) / scale;
    const dy = (screenY - this.viewportY - this.viewportHeight * 0.5) / scale;
    const cosine = Math.cos(this.rotation);
    const sine = Math.sin(this.rotation);
    out.x = worldValue(this.position.x + dx * cosine - dy * sine);
    out.y = worldValue(this.position.y + dx * sine + dy * cosine);
    return out;
  }

  getVisibleBounds(out = { x: 0, y: 0, width: 0, height: 0 }) {
    this.normalize();
    const cosine = Math.abs(Math.cos(this.rotation));
    const sine = Math.abs(Math.sin(this.rotation));
    const scale = this.zoom * this.pixelRatio;
    const halfWidth = (cosine * this.viewportWidth + sine * this.viewportHeight) / (2 * scale);
    const halfHeight = (sine * this.viewportWidth + cosine * this.viewportHeight) / (2 * scale);
    out.x = worldValue(this.position.x - halfWidth);
    out.y = worldValue(this.position.y - halfHeight);
    out.width = worldValue(halfWidth * 2);
    out.height = worldValue(halfHeight * 2);
    return out;
  }
}
