import { Texture } from "./texture.js";

const MAX_RENDER_TEXTURE_DIMENSION = 16_384;
const MAX_RENDER_TEXTURE_PIXELS = 16 * 1024 * 1024;

function size(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_RENDER_TEXTURE_DIMENSION) {
    throw new RangeError(`RenderTexture ${name} boyutu geçersiz veya limit dışında.`);
  }
  return number;
}

function dimensions(width, height) {
  const safeWidth = size(width, "width");
  const safeHeight = size(height, "height");
  if (safeWidth * safeHeight > MAX_RENDER_TEXTURE_PIXELS) throw new RangeError("RenderTexture pixel limiti aşıldı.");
  return [safeWidth, safeHeight];
}

export class RenderTexture extends Texture {
  constructor({ id, width = 1, height = 1, filter = "linear" } = {}) {
    const [safeWidth, safeHeight] = dimensions(width, height);
    super({ id, source: null, width: safeWidth, height: safeHeight, sourceWidth: safeWidth, sourceHeight: safeHeight, filter });
    this.renderTarget = true;
  }

  resize(width, height) {
    if (this.destroyed) throw new Error("RenderTexture yok edilmiş.");
    const [safeWidth, safeHeight] = dimensions(width, height);
    if (safeWidth === this.width && safeHeight === this.height) return this;
    this.width = safeWidth;
    this.height = safeHeight;
    this.sourceWidth = safeWidth;
    this.sourceHeight = safeHeight;
    this.version += 1;
    return this;
  }

  subTexture() { throw new Error("RenderTexture alt texture oluşturamaz."); }
  updateSource() { throw new Error("RenderTexture kaynağı updateSource ile değiştirilemez."); }
}
