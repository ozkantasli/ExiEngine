import { Graphics } from "./graphics.js";
import { RenderGroup } from "./render-group.js";
import { Sprite } from "./sprite.js";
import { Texture } from "../assets/texture.js";

// Cheap 2D lighting built from existing pieces: a low-resolution RenderGroup is
// filled with the ambient color, point lights are added on top as radial
// gradients with additive blending, and the whole layer is composited over the
// world with multiply blending. Lit areas keep their colors, unlit areas fade
// to the ambient color. Light falloff is smooth because the light map is
// upscaled with linear filtering.
//
// With { normals: true } the layer also keeps a normal buffer (a RenderGroup at
// the light-map resolution). addNormalMap(sprite, texture) mirrors a world
// sprite into it with its normal-map texture; every light is then drawn with
// the "normal-light" shader mode, which reads that buffer through the mask
// slot and multiplies the light by max(dot(N, L), 0).
//
// Shadows: lights with { shadows: true } are drawn into their own small
// RenderGroup instead of straight into the light map: an opaque black
// backdrop, the light on top, then black shadow polygons cast from the
// occluders' back-facing edges. That group is added to the light map with
// additive blending, so shadowed pixels add nothing. Occluders themselves stay
// lit (only the area behind them is dark). Each shadowed light costs one extra
// render pass, so they are capped at MAX_SHADOW_LIGHTS.

export const MAX_LIGHTS = 256;
export const MAX_NORMAL_SPRITES = 4_096;
export const MAX_SHADOW_LIGHTS = 32;
export const MAX_OCCLUDERS = 1_024;
export const MAX_OCCLUDER_POINTS = 64;
const MIN_SHADOW_TARGET = 16;
const MAX_SHADOW_TARGET = 1_024;
// Graphics command budget per shadow pass; edges past it cast no shadow.
const MAX_SHADOW_POLYGONS = 4_096;
const MAX_LIGHT_LAYER_PIXELS = 4 * 1024 * 1024;
let sharedGradient = null;

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be a finite number.`);
  return number;
}

function lightTexture() {
  if (sharedGradient && !sharedGradient.destroyed) return sharedGradient;
  const size = 128;
  let canvas = null;
  if (typeof OffscreenCanvas === "function") canvas = new OffscreenCanvas(size, size);
  else if (typeof document !== "undefined" && document?.createElement) { canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size; }
  const context = canvas?.getContext?.("2d");
  if (!context?.createRadialGradient) return Texture.white;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Smooth quadratic-like falloff to zero at the edge.
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.7, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  sharedGradient = new Texture({ id: "exi-light-gradient", source: canvas });
  return sharedGradient;
}

// World transform from the local transforms up to the root. Unlike
// worldMatrix it does not wait for the renderer's matrix pass, so mirrors made
// right after onUpdate are not a frame late.
function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function polygonPoints(points, label) {
  if (!points || typeof points.length !== "number") throw new TypeError(`${label} points must be an array of numbers.`);
  if (points.length < 6 || points.length % 2 !== 0) throw new RangeError(`${label} needs at least three x/y pairs.`);
  if (points.length / 2 > MAX_OCCLUDER_POINTS) throw new RangeError(`${label} supports at most ${MAX_OCCLUDER_POINTS} points.`);
  return Array.from(points, (value) => finite(value, `${label} point`));
}

function composedTransform(node, out) {
  let a = 1; let b = 0; let c = 0; let d = 1; let tx = 0; let ty = 0;
  for (let current = node; current; current = current.parent) {
    const cosine = Math.cos(current.rotation || 0);
    const sine = Math.sin(current.rotation || 0);
    const la = cosine * current.scale.x; const lb = sine * current.scale.x;
    const lc = -sine * current.scale.y; const ld = cosine * current.scale.y;
    const nextA = la * a + lc * b; const nextB = lb * a + ld * b;
    const nextC = la * c + lc * d; const nextD = lb * c + ld * d;
    const nextX = la * tx + lc * ty + current.position.x; const nextY = lb * tx + ld * ty + current.position.y;
    a = nextA; b = nextB; c = nextC; d = nextD; tx = nextX; ty = nextY;
  }
  out.a = a; out.b = b; out.c = c; out.d = d; out.tx = tx; out.ty = ty;
  return out;
}

export class LightLayer extends RenderGroup {
  constructor({ x = 0, y = 0, width, height, resolution = 0.25, ambient = 0x0b1020, normals = false, ...options } = {}) {
    const worldWidth = finite(width, "LightLayer width");
    const worldHeight = finite(height, "LightLayer height");
    const scale = finite(resolution, "LightLayer resolution");
    if (worldWidth <= 0 || worldHeight <= 0) throw new RangeError("LightLayer width and height must be positive.");
    if (!(scale > 0 && scale <= 1)) throw new RangeError("LightLayer resolution must be in (0, 1].");
    const targetWidth = Math.max(1, Math.ceil(worldWidth * scale));
    const targetHeight = Math.max(1, Math.ceil(worldHeight * scale));
    if (targetWidth * targetHeight > MAX_LIGHT_LAYER_PIXELS) throw new RangeError("LightLayer light map is too large; lower the resolution.");
    super({
      name: "light-layer", zIndex: 1_000_000, ...options,
      width: targetWidth, height: targetHeight,
      x: finite(x, "LightLayer x") + worldWidth / 2, y: finite(y, "LightLayer y") + worldHeight / 2,
      scaleX: worldWidth / targetWidth, scaleY: worldHeight / targetHeight,
      blendMode: "multiply",
    });
    this.worldBounds = { x: Number(x), y: Number(y), width: worldWidth, height: worldHeight };
    this.resolution = scale;
    this.lights = [];
    this.ambientSprite = new Sprite({ name: "ambient", texture: Texture.white, x: targetWidth / 2, y: targetHeight / 2, width: targetWidth, height: targetHeight, tint: ambient, cullable: false });
    this.add(this.ambientSprite);
    this.lightTexture = lightTexture();
    this.normalBuffer = null;
    this.normalSprites = new Map();
    this.scratchMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    this.occluders = [];
    this.shadowLightCount = 0;
    this.syncPending = true;
    if (normals) {
      // Rendered every frame (render groups are drawn before their parents) but
      // composited with alpha 0: it is only read by the light shader.
      this.normalBuffer = new RenderGroup({ name: "normal-buffer", width: targetWidth, height: targetHeight, x: targetWidth / 2, y: targetHeight / 2, alpha: 0, zIndex: -1 });
      this.normalBufferMask = { x: 0, y: 0, width: targetWidth, height: targetHeight };
      // The normal buffer is drawn first; sync right before it so mirrors and
      // lights match what onUpdate did this frame.
      const buffer = this.normalBuffer;
      buffer.getRenderCamera = () => { this.syncIfPending(); return RenderGroup.prototype.getRenderCamera.call(buffer); };
      this.add(this.normalBuffer);
    }
  }

  get normals() { return this.normalBuffer !== null; }

  // Registers a world sprite whose normal map should shape the lighting. The
  // normal texture uses the usual tangent-space encoding (rgb = n * 0.5 + 0.5,
  // green up) and must match the sprite's frame layout. Position, scale, flips
  // and visibility follow the sprite; rotation moves the normal map but does not
  // rotate its normal vectors.
  addNormalMap(sprite, normalTexture) {
    if (!this.normalBuffer) throw new Error("LightLayer was created without { normals: true }.");
    if (!(sprite instanceof Sprite)) throw new TypeError("addNormalMap needs a Sprite.");
    if (!(normalTexture instanceof Texture)) throw new TypeError("addNormalMap needs a normal-map Texture.");
    const existing = this.normalSprites.get(sprite);
    if (existing) { existing.setTexture(normalTexture); return existing; }
    if (this.normalSprites.size >= MAX_NORMAL_SPRITES) throw new RangeError(`LightLayer supports at most ${MAX_NORMAL_SPRITES} normal-mapped sprites.`);
    const mirror = new Sprite({ name: "normal", texture: normalTexture, cullable: false });
    this.normalSprites.set(sprite, mirror);
    this.normalBuffer.add(mirror);
    this.syncNormalSprite(sprite, mirror);
    return mirror;
  }

  removeNormalMap(sprite) {
    const mirror = this.normalSprites.get(sprite);
    if (!mirror) return false;
    this.normalSprites.delete(sprite);
    this.normalBuffer.remove(mirror);
    mirror.destroy();
    return true;
  }

  syncNormalSprite(sprite, mirror) {
    const matrix = composedTransform(sprite, this.scratchMatrix);
    const scaleX = this.width / this.worldBounds.width;
    const scaleY = this.height / this.worldBounds.height;
    let visible = !sprite.destroyed;
    for (let node = sprite; visible && node; node = node.parent) visible = node.visible !== false;
    mirror.visible = visible;
    if (!visible) return;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    mirror.position.set((matrix.tx - this.worldBounds.x) * scaleX, (matrix.ty - this.worldBounds.y) * scaleY);
    // A mirrored transform keeps its flip on X (same pixels as a flip on Y plus a half turn).
    const flip = determinant < 0 ? -1 : 1;
    mirror.rotation = Math.atan2(flip * matrix.b, flip * matrix.a);
    mirror.scale.set(flip * Math.hypot(matrix.a, matrix.b) * scaleX, Math.hypot(matrix.c, matrix.d) * scaleY);
    mirror.width = sprite.width;
    mirror.height = sprite.height;
    mirror.anchor.x = sprite.anchor.x;
    mirror.anchor.y = sprite.anchor.y;
    mirror.flipX = sprite.flipX;
    mirror.flipY = sprite.flipY;
  }

  get ambient() { return this.ambientSprite.tint; }
  set ambient(value) { this.setAmbient(value); }
  setAmbient(color) { this.ambientSprite.setTint(color); return this; }

  // Lights are plain objects in world coordinates; edit their fields freely
  // (x, y, radius, color, intensity, enabled) and the layer syncs every update.
  // height (0..1) only matters with normal maps: low lights graze surfaces and
  // bring out relief, high lights light them evenly.
  // shadows: true makes the light cast shadows from the layer's occluders
  // (toggle light.shadows later the same way; at most MAX_SHADOW_LIGHTS at once).
  addLight({ x = 0, y = 0, radius = 128, color = 0xffffff, intensity = 1, height = 0.35, enabled = true, shadows = false } = {}) {
    if (this.lights.length >= MAX_LIGHTS) throw new RangeError(`LightLayer supports at most ${MAX_LIGHTS} lights.`);
    if (shadows && this.shadowLightCount >= MAX_SHADOW_LIGHTS) throw new RangeError(`LightLayer supports at most ${MAX_SHADOW_LIGHTS} shadow-casting lights.`);
    const sprite = new Sprite({ name: "light", texture: this.lightTexture, blendMode: "additive", cullable: false });
    if (this.normalBuffer) {
      sprite.filter = "normal-light";
      sprite.setMaskTexture(this.normalBuffer.target).setMaskRect(this.normalBufferMask);
    }
    const light = { x: finite(x, "Light x"), y: finite(y, "Light y"), radius: finite(radius, "Light radius"), color, intensity: finite(intensity, "Light intensity"), height: finite(height, "Light height"), enabled: Boolean(enabled), shadows: Boolean(shadows), sprite, shadow: null };
    this.lights.push(light);
    this.add(sprite);
    this.syncLight(light);
    return light;
  }

  removeLight(light) {
    const index = this.lights.indexOf(light);
    if (index < 0) return false;
    this.lights.splice(index, 1);
    this.releaseShadow(light);
    this.remove(light.sprite);
    light.sprite.destroy();
    return true;
  }

  // Occluders block shadow-casting lights. Give a convex or concave polygon
  // ({ points: [x0, y0, x1, y1, ...] }), a rectangle ({ x, y, width, height }),
  // both in world coordinates, or a node ({ node }) whose local bounds follow
  // its position, rotation and scale. Edit points / enabled freely afterwards.
  addOccluder(options = {}) {
    if (this.occluders.length >= MAX_OCCLUDERS) throw new RangeError(`LightLayer supports at most ${MAX_OCCLUDERS} occluders.`);
    if (!options || typeof options !== "object") throw new TypeError("addOccluder needs an options object.");
    let occluder;
    if (options.node !== undefined) {
      if (!(options.node && typeof options.node.getLocalBounds === "function")) throw new TypeError("Occluder node must be a Node with local bounds.");
      occluder = { node: options.node, points: [0, 0, 0, 0, 0, 0, 0, 0], enabled: options.enabled !== false };
    } else if (options.points !== undefined) {
      occluder = { node: null, points: polygonPoints(options.points, "Occluder"), enabled: options.enabled !== false };
    } else {
      const x = finite(options.x, "Occluder x"); const y = finite(options.y, "Occluder y");
      const width = finite(options.width, "Occluder width"); const height = finite(options.height, "Occluder height");
      if (!(width > 0 && height > 0)) throw new RangeError("Occluder width and height must be positive.");
      occluder = { node: null, points: [x, y, x + width, y, x + width, y + height, x, y + height], enabled: options.enabled !== false };
    }
    this.occluders.push(occluder);
    return occluder;
  }

  removeOccluder(occluder) {
    const index = this.occluders.indexOf(occluder);
    if (index < 0) return false;
    this.occluders.splice(index, 1);
    return true;
  }

  clearOccluders() {
    this.occluders.length = 0;
    return this;
  }

  // Brings node-following occluders up to date (world-space corners).
  syncOccluder(occluder) {
    const { node } = occluder;
    if (!node) return occluder.points.length >= 6;
    if (node.destroyed) return false;
    let visible = true;
    for (let current = node; visible && current; current = current.parent) visible = current.visible !== false;
    if (!visible) return false;
    const bounds = node.getLocalBounds();
    const m = composedTransform(node, this.scratchMatrix);
    const corners = [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height];
    for (let index = 0; index < 8; index += 2) {
      const lx = corners[index]; const ly = corners[index + 1];
      occluder.points[index] = m.a * lx + m.c * ly + m.tx;
      occluder.points[index + 1] = m.b * lx + m.d * ly + m.ty;
    }
    return true;
  }

  ensureShadow(light) {
    if (light.shadow) return light.shadow;
    if (this.shadowLightCount >= MAX_SHADOW_LIGHTS) throw new RangeError(`LightLayer supports at most ${MAX_SHADOW_LIGHTS} shadow-casting lights.`);
    const group = new RenderGroup({ name: "shadow-light", width: MIN_SHADOW_TARGET, height: MIN_SHADOW_TARGET, blendMode: "additive", cullable: false });
    // Opaque black backdrop: the light adds onto it, shadows paint it back to black,
    // and the group's alpha stays 1 so the additive composite adds exactly the light.
    const backdrop = new Sprite({ name: "shadow-backdrop", texture: Texture.white, tint: 0x000000, cullable: false, zIndex: -1 });
    const shapes = new Graphics({ name: "shadows", zIndex: 1 });
    group.add(backdrop, shapes);
    group.add(light.sprite);
    // Keep the shadow pass in sync with lights moved in onUpdate this frame.
    group.getRenderCamera = () => { this.syncIfPending(); return RenderGroup.prototype.getRenderCamera.call(group); };
    this.add(group);
    this.shadowLightCount += 1;
    light.shadow = { group, backdrop, shapes, size: 0, scale: 1, mask: { x: 0, y: 0, width: 0, height: 0 } };
    return light.shadow;
  }

  releaseShadow(light) {
    if (!light.shadow) return;
    const { group } = light.shadow;
    light.shadow = null;
    this.shadowLightCount -= 1;
    if (!light.sprite.destroyed) this.add(light.sprite);
    this.remove(group);
    group.destroy();
  }

  // Redraws one light's shadow pass: sizes its target, places the light and
  // casts a polygon behind every back-facing occluder edge inside the light.
  syncShadow(light, lightX, lightY, radiusX, radiusY) {
    const shadow = this.ensureShadow(light);
    const span = 2 * Math.max(radiusX, radiusY) + 2;
    const size = Math.min(MAX_SHADOW_TARGET, Math.max(MIN_SHADOW_TARGET, nextPowerOfTwo(span)));
    if (shadow.size !== size) { shadow.group.resize(size, size); shadow.size = size; }
    // Light-map pixels per shadow-target pixel (> 1 only when the target is capped).
    const scale = Math.max(1, span / size);
    shadow.scale = scale;
    const half = size / 2;
    shadow.group.position.set(lightX, lightY);
    shadow.group.scale.set(scale, scale);
    shadow.backdrop.position.set(half, half);
    shadow.backdrop.width = size; shadow.backdrop.height = size;
    const { sprite } = light;
    sprite.position.set(half, half);
    sprite.width = (radiusX * 2) / scale; sprite.height = (radiusY * 2) / scale;
    if (this.normalBuffer) {
      // The normal buffer covers the whole light map; express it in this target's pixels.
      shadow.mask.x = half - lightX / scale; shadow.mask.y = half - lightY / scale;
      shadow.mask.width = this.width / scale; shadow.mask.height = this.height / scale;
      sprite.setMaskRect(shadow.mask);
    }
    const shapes = shadow.shapes.clear();
    const scaleX = this.width / this.worldBounds.width;
    const scaleY = this.height / this.worldBounds.height;
    const far = size * 2;
    const toLocalX = (worldX) => ((worldX - this.worldBounds.x) * scaleX - lightX) / scale + half;
    const toLocalY = (worldY) => ((worldY - this.worldBounds.y) * scaleY - lightY) / scale + half;
    const reachX = radiusX + 1; const reachY = radiusY + 1;
    for (const occluder of this.occluders) {
      if (!occluder.enabled || !this.syncOccluder(occluder)) continue;
      const { points } = occluder;
      const count = points.length / 2;
      // Cheap reject: occluder bounds against the light's square.
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let area = 0;
      for (let index = 0; index < count; index += 1) {
        const x = (points[index * 2] - this.worldBounds.x) * scaleX; const y = (points[index * 2 + 1] - this.worldBounds.y) * scaleY;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        const next = (index + 1) % count;
        area += points[index * 2] * points[next * 2 + 1] - points[next * 2] * points[index * 2 + 1];
      }
      if (maxX < lightX - reachX || minX > lightX + reachX || maxY < lightY - reachY || minY > lightY + reachY || area === 0) continue;
      const orientation = Math.sign(area);
      for (let index = 0; index < count; index += 1) {
        const next = (index + 1) % count;
        const x1 = toLocalX(points[index * 2]); const y1 = toLocalY(points[index * 2 + 1]);
        const x2 = toLocalX(points[next * 2]); const y2 = toLocalY(points[next * 2 + 1]);
        // Outward normal of the edge; it casts only when it faces away from the light.
        const nx = orientation * (y2 - y1); const ny = orientation * (x1 - x2);
        if (nx * ((x1 + x2) / 2 - half) + ny * ((y1 + y2) / 2 - half) <= 0) continue;
        if (shapes.commands.length >= MAX_SHADOW_POLYGONS) return;
        const d1x = x1 - half; const d1y = y1 - half; const d2x = x2 - half; const d2y = y2 - half;
        const l1 = Math.hypot(d1x, d1y); const l2 = Math.hypot(d2x, d2y);
        if (l1 < 1e-6 || l2 < 1e-6) continue;
        let mx = d1x / l1 + d2x / l2; let my = d1y / l1 + d2y / l2;
        const lm = Math.hypot(mx, my);
        if (lm < 1e-6) { const ln = Math.hypot(nx, ny) || 1; mx = nx / ln; my = ny / ln; } else { mx /= lm; my /= lm; }
        // The extra middle point keeps wide edges' shadows beyond the light's reach.
        shapes.polygon([
          x1, y1, x2, y2,
          half + (d2x / l2) * far, half + (d2y / l2) * far,
          half + mx * far, half + my * far,
          half + (d1x / l1) * far, half + (d1y / l1) * far,
        ], { fill: 0x000000 });
      }
    }
  }

  clearLights() {
    for (const light of [...this.lights]) this.removeLight(light);
    return this;
  }

  syncLight(light) {
    const { sprite } = light;
    const scaleX = this.width / this.worldBounds.width;
    const scaleY = this.height / this.worldBounds.height;
    const radius = Math.max(0, Number(light.radius) || 0);
    const lightX = (Number(light.x) - this.worldBounds.x) * scaleX;
    const lightY = (Number(light.y) - this.worldBounds.y) * scaleY;
    const visible = Boolean(light.enabled) && radius > 0;
    sprite.setTint(light.color);
    sprite.alpha = Math.max(0, Math.min(1, Number(light.intensity) || 0));
    sprite.visible = visible;
    if (this.normalBuffer) sprite.filterAmount = Math.max(0, Math.min(1, Number(light.height) || 0));
    // Over the cap a light renders unshadowed instead of failing mid-frame.
    if (light.shadows && visible && (light.shadow || this.shadowLightCount < MAX_SHADOW_LIGHTS)) {
      this.syncShadow(light, lightX, lightY, radius * scaleX, radius * scaleY);
      return;
    }
    if (light.shadow) {
      this.releaseShadow(light);
      if (this.normalBuffer) sprite.setMaskRect(this.normalBufferMask);
    }
    sprite.position.set(lightX, lightY);
    sprite.width = radius * 2 * scaleX;
    sprite.height = radius * 2 * scaleY;
  }

  syncAll() {
    for (const light of this.lights) this.syncLight(light);
    for (const [sprite, mirror] of this.normalSprites) {
      if (sprite.destroyed) this.removeNormalMap(sprite);
      else this.syncNormalSprite(sprite, mirror);
    }
    return this;
  }

  // Render groups are drawn before their parent, so the first group of this
  // layer to render (a shadow pass, the normal buffer or the layer itself)
  // syncs once per update; lights moved in onUpdate are then not a frame late.
  syncIfPending() {
    if (!this.syncPending) return;
    this.syncPending = false;
    this.syncAll();
  }

  getRenderCamera() {
    this.syncIfPending();
    return super.getRenderCamera();
  }

  update(delta, stamp, depth) {
    this.syncAll();
    this.syncPending = true;
    super.update(delta, stamp, depth);
  }
}
