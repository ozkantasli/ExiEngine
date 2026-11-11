import { RenderGroup } from "./render-group.js";
import { Sprite } from "./sprite.js";
import { Texture } from "../assets/texture.js";

// Cheap 2D lighting built from existing pieces: a low-resolution RenderGroup is
// filled with the ambient color, point lights are added on top as radial
// gradients with additive blending, and the whole layer is composited over the
// world with multiply blending. Lit areas keep their colors, unlit areas fade
// to the ambient color. No normal maps or shadows; light falloff is smooth
// because the light map is upscaled with linear filtering.

export const MAX_LIGHTS = 256;
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

export class LightLayer extends RenderGroup {
  constructor({ x = 0, y = 0, width, height, resolution = 0.25, ambient = 0x0b1020, ...options } = {}) {
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
  }

  get ambient() { return this.ambientSprite.tint; }
  set ambient(value) { this.setAmbient(value); }
  setAmbient(color) { this.ambientSprite.setTint(color); return this; }

  // Lights are plain objects in world coordinates; edit their fields freely
  // (x, y, radius, color, intensity, enabled) and the layer syncs every update.
  addLight({ x = 0, y = 0, radius = 128, color = 0xffffff, intensity = 1, enabled = true } = {}) {
    if (this.lights.length >= MAX_LIGHTS) throw new RangeError(`LightLayer supports at most ${MAX_LIGHTS} lights.`);
    const sprite = new Sprite({ name: "light", texture: this.lightTexture, blendMode: "additive", cullable: false });
    const light = { x: finite(x, "Light x"), y: finite(y, "Light y"), radius: finite(radius, "Light radius"), color, intensity: finite(intensity, "Light intensity"), enabled: Boolean(enabled), sprite };
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
  }

  update(delta, stamp, depth) {
    for (const light of this.lights) this.syncLight(light);
    super.update(delta, stamp, depth);
  }
}
