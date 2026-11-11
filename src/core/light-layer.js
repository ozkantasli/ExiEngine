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
// slot and multiplies the light by max(dot(N, L), 0). No shadows.

export const MAX_LIGHTS = 256;
export const MAX_NORMAL_SPRITES = 4_096;
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
    if (normals) {
      // Rendered every frame (render groups are drawn before their parents) but
      // composited with alpha 0: it is only read by the light shader.
      this.normalBuffer = new RenderGroup({ name: "normal-buffer", width: targetWidth, height: targetHeight, x: targetWidth / 2, y: targetHeight / 2, alpha: 0, zIndex: -1 });
      this.normalBufferMask = { x: 0, y: 0, width: targetWidth, height: targetHeight };
      // The normal buffer is drawn first; sync right before it so mirrors and
      // lights match what onUpdate did this frame.
      const buffer = this.normalBuffer;
      buffer.getRenderCamera = () => { this.syncAll(); return RenderGroup.prototype.getRenderCamera.call(buffer); };
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
  addLight({ x = 0, y = 0, radius = 128, color = 0xffffff, intensity = 1, height = 0.35, enabled = true } = {}) {
    if (this.lights.length >= MAX_LIGHTS) throw new RangeError(`LightLayer supports at most ${MAX_LIGHTS} lights.`);
    const sprite = new Sprite({ name: "light", texture: this.lightTexture, blendMode: "additive", cullable: false });
    if (this.normalBuffer) {
      sprite.filter = "normal-light";
      sprite.setMaskTexture(this.normalBuffer.target).setMaskRect(this.normalBufferMask);
    }
    const light = { x: finite(x, "Light x"), y: finite(y, "Light y"), radius: finite(radius, "Light radius"), color, intensity: finite(intensity, "Light intensity"), height: finite(height, "Light height"), enabled: Boolean(enabled), sprite };
    this.lights.push(light);
    this.add(sprite);
    this.syncLight(light);
    return light;
  }

  removeLight(light) {
    const index = this.lights.indexOf(light);
    if (index < 0) return false;
    this.lights.splice(index, 1);
    this.remove(light.sprite);
    light.sprite.destroy();
    return true;
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
    sprite.position.set((Number(light.x) - this.worldBounds.x) * scaleX, (Number(light.y) - this.worldBounds.y) * scaleY);
    sprite.width = radius * 2 * scaleX;
    sprite.height = radius * 2 * scaleY;
    sprite.setTint(light.color);
    sprite.alpha = Math.max(0, Math.min(1, Number(light.intensity) || 0));
    sprite.visible = Boolean(light.enabled) && radius > 0;
    if (this.normalBuffer) sprite.filterAmount = Math.max(0, Math.min(1, Number(light.height) || 0));
  }

  syncAll() {
    for (const light of this.lights) this.syncLight(light);
    for (const [sprite, mirror] of this.normalSprites) {
      if (sprite.destroyed) this.removeNormalMap(sprite);
      else this.syncNormalSprite(sprite, mirror);
    }
    return this;
  }

  getRenderCamera() {
    if (!this.normalBuffer) this.syncAll();
    return super.getRenderCamera();
  }

  update(delta, stamp, depth) {
    this.syncAll();
    super.update(delta, stamp, depth);
  }
}
