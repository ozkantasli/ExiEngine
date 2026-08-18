let nextTextureId = 1;
const MAX_TEXTURE_DIMENSION = 16_384;

function dimension(value, fallback = 1) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(MAX_TEXTURE_DIMENSION, number) : fallback;
}

function coordinate(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uv(value, fallback) { return Math.max(0, Math.min(1, coordinate(value, fallback))); }
function textureFilter(value) { return value === "nearest" ? "nearest" : "linear"; }

export class Texture {
  get filter() {
    const base = this.baseTexture;
    return base && base !== this ? base._filter : this._filter;
  }

  set filter(value) {
    const normalized = textureFilter(value);
    const base = this.baseTexture || this;
    base._filter = normalized;
    this._filter = normalized;
  }

  constructor({ id = `texture-${nextTextureId++}`, source = null, width = 1, height = 1, sourceWidth = source?.width || width, sourceHeight = source?.height || height, baseTexture = null, u0 = 0, v0 = 0, u1 = 1, v1 = 1, filter = "linear" } = {}) {
    if (baseTexture !== null && !(baseTexture instanceof Texture)) throw new TypeError("Texture baseTexture bekleniyor.");
    if (source) {
      const actualWidth = Number(source.width); const actualHeight = Number(source.height);
      if (!Number.isSafeInteger(actualWidth) || !Number.isSafeInteger(actualHeight) || actualWidth <= 0 || actualHeight <= 0 || actualWidth > MAX_TEXTURE_DIMENSION || actualHeight > MAX_TEXTURE_DIMENSION) throw new RangeError("Texture kaynak boyutu limiti aşıldı.");
      if (Number(sourceWidth) !== actualWidth || Number(sourceHeight) !== actualHeight) throw new RangeError("Texture kaynak boyutu ile metadata eşleşmiyor.");
    }
    this.id = id;
    this.source = source;
    this.width = dimension(width);
    this.height = dimension(height);
    this.sourceWidth = dimension(sourceWidth);
    this.sourceHeight = dimension(sourceHeight);
    this.baseTexture = baseTexture || this;
    this.filter = textureFilter(filter);
    this.u0 = uv(u0, 0); this.v0 = uv(v0, 0); this.u1 = uv(u1, 1); this.v1 = uv(v1, 1);
    if (this.u1 < this.u0 || this.v1 < this.v0) throw new RangeError("Texture UV sırası geçersiz.");
    this.version = 0;
    this.destroyed = false;
  }

  static fromImage(source, options = {}) {
    return new Texture({ source, width: source.width, height: source.height, ...options });
  }

  subTexture({ x, y, width, height, id } = {}) {
    if (this.destroyed || this.baseTexture?.destroyed) throw new Error("Texture yok edilmiş.");
    const frameX = Number(x); const frameY = Number(y); const frameWidth = Number(width); const frameHeight = Number(height);
    const regionWidth = (this.u1 - this.u0) * this.sourceWidth;
    const regionHeight = (this.v1 - this.v0) * this.sourceHeight;
    if (![frameX, frameY, frameWidth, frameHeight, regionWidth, regionHeight].every(Number.isFinite) || frameX < 0 || frameY < 0 || frameWidth <= 0 || frameHeight <= 0 || frameX + frameWidth > regionWidth || frameY + frameHeight > regionHeight) throw new RangeError("Texture frame sınırları geçersiz.");
    return new Texture({
      id: id || `${this.id}:${frameX},${frameY},${frameWidth},${frameHeight}`,
      source: this.source,
      width: frameWidth,
      height: frameHeight,
      sourceWidth: this.sourceWidth,
      sourceHeight: this.sourceHeight,
      baseTexture: this.baseTexture,
      filter: this.filter,
      u0: this.u0 + (frameX / regionWidth) * (this.u1 - this.u0),
      v0: this.v0 + (frameY / regionHeight) * (this.v1 - this.v0),
      u1: this.u0 + ((frameX + frameWidth) / regionWidth) * (this.u1 - this.u0),
      v1: this.v0 + ((frameY + frameHeight) / regionHeight) * (this.v1 - this.v0),
    });
  }

  setFilter(filter) {
    if (this.destroyed || this.baseTexture?.destroyed) throw new Error("Texture yok edilmiş.");
    this.filter = filter;
    return this;
  }

  markDirty() {
    const base = this.baseTexture === this ? this : this.baseTexture;
    if (base.source && (Number(base.source.width) !== base.sourceWidth || Number(base.source.height) !== base.sourceHeight)) throw new RangeError("Texture kaynak boyutu değiştirilemez.");
    if (base.destroyed) throw new Error("Texture yok edilmiÅŸ.");
    base.version += 1;
    return this;
  }

  updateSource(source) {
    const base = this.baseTexture === this ? this : this.baseTexture;
    if (base.destroyed) throw new Error("Texture yok edilmiÅŸ.");
    if (!source || source.width !== base.sourceWidth || source.height !== base.sourceHeight) throw new RangeError("Texture kaynak boyutu deÄŸiÅŸtirilemez.");
    base.source = source;
    base.version += 1;
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    if (this.baseTexture === this) this.source?.close?.();
    this.source = null;
    this.baseTexture = this;
    this.destroyed = true;
  }
}

Texture.white = new Texture({ id: "white", width: 1, height: 1 });
