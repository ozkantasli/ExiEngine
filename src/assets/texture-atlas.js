import { Texture } from "./texture.js";

const MAX_ATLAS_FRAMES = 10_000;
const MAX_ATLAS_DIMENSION = 4_096;
const MAX_ATLAS_PIXELS = 16 * 1024 * 1024;
const MAX_ATLAS_FRAME_NAME_LENGTH = 256;
const nextPowerOfTwo = (value) => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

function assertAtlasFrame(texture, value, name) {
  const frame = value?.frame || value;
  const x = Number(frame?.x); const y = Number(frame?.y); const width = Number(frame?.width ?? frame?.w); const height = Number(frame?.height ?? frame?.h);
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > texture.sourceWidth || y + height > texture.sourceHeight) throw new RangeError(`Atlas frame sınır dışı: ${name}`);
  return frame;
}

function atlasLimit(value, maximum, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) throw new RangeError(`${label} limiti geçersiz.`);
  return number;
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (globalThis.document?.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  throw new Error("TextureAtlas.pack için Canvas veya OffscreenCanvas gerekli.");
}

function drawPaddedImage(context, item, padding) {
  const { source, sourceX, sourceY, width: sourceWidth, height: sourceHeight } = item;
  context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, item.x, item.y, item.width, item.height);
  if (!padding) return;
  const right = item.x + item.width;
  const bottom = item.y + item.height;
  context.drawImage(source, sourceX, sourceY, sourceWidth, 1, item.x, item.y - padding, item.width, padding);
  context.drawImage(source, sourceX, sourceY + sourceHeight - 1, sourceWidth, 1, item.x, bottom, item.width, padding);
  context.drawImage(source, sourceX, sourceY, 1, sourceHeight, item.x - padding, item.y, padding, item.height);
  context.drawImage(source, sourceX + sourceWidth - 1, sourceY, 1, sourceHeight, right, item.y, padding, item.height);
  context.drawImage(source, sourceX, sourceY, 1, 1, item.x - padding, item.y - padding, padding, padding);
  context.drawImage(source, sourceX + sourceWidth - 1, sourceY, 1, 1, right, item.y - padding, padding, padding);
  context.drawImage(source, sourceX, sourceY + sourceHeight - 1, 1, 1, item.x - padding, bottom, padding, padding);
  context.drawImage(source, sourceX + sourceWidth - 1, sourceY + sourceHeight - 1, 1, 1, right, bottom, padding, padding);
}

function resolvePackSource(source) {
  if (source instanceof Texture) {
    const base = source.baseTexture || source;
    const sourceX = source.u0 * base.sourceWidth;
    const sourceY = source.v0 * base.sourceHeight;
    const width = (source.u1 - source.u0) * base.sourceWidth;
    const height = (source.v1 - source.v0) * base.sourceHeight;
    if (source.destroyed || base.destroyed || !base.source || ![sourceX, sourceY, width, height].every(Number.isSafeInteger) || sourceX < 0 || sourceY < 0 || width <= 0 || height <= 0 || sourceX + width > base.sourceWidth || sourceY + height > base.sourceHeight) throw new TypeError("Atlas pack Texture kaynağı geçersiz veya yok edilmiş.");
    return { source: base.source, sourceX, sourceY, width, height };
  }
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new RangeError("Atlas pack kaynak boyutu geçersiz.");
  return { source, sourceX: 0, sourceY: 0, width, height };
}

export class TextureAtlas {
  constructor(texture, frames) {
    if (!(texture instanceof Texture)) throw new TypeError("Atlas texture bekleniyor.");
    if (texture.destroyed || texture.baseTexture?.destroyed) throw new Error("Atlas texture yok edilmiş.");
    if (!frames || typeof frames !== "object" || Array.isArray(frames)) throw new TypeError("Atlas frames alanı geçersiz.");
    const entries = Object.entries(frames);
    if (entries.length > MAX_ATLAS_FRAMES) throw new RangeError("Atlas frame limiti aşıldı.");
    const normalizedFrames = Object.create(null);
    for (const [name, value] of entries) {
      if (name.length > MAX_ATLAS_FRAME_NAME_LENGTH) throw new RangeError("Atlas frame adı limiti aşıldı.");
      const frame = assertAtlasFrame(texture, value, name);
      const x = Number(frame.x); const y = Number(frame.y); const width = Number(frame.width ?? frame.w); const height = Number(frame.height ?? frame.h);
      normalizedFrames[name] = { x, y, width, height };
    }
    this.texture = texture;
    this.frames = new Map(Object.entries(normalizedFrames));
    this._frameCapacity = this.frames.size;
    this.frameCache = new Map();
    this.destroyed = false;
  }

  _assertFrameBudget() {
    if (!(this.frames instanceof Map) || this.frames.size > this._frameCapacity) throw new RangeError(`Atlas frame limiti ${this._frameCapacity}.`);
  }

  invalidateIfTextureDestroyed() {
    if (this.destroyed) return false;
    if (!this.texture || this.texture.destroyed || this.texture.baseTexture?.destroyed) {
      this.destroy();
      return false;
    }
    return true;
  }

  get(name) {
    if (!this.invalidateIfTextureDestroyed()) throw new Error("TextureAtlas yok edilmiş.");
    this._assertFrameBudget();
    const frame = this.frames.get(name);
    if (!frame) throw new Error(`Atlas frame bulunamadı: ${name}`);
    assertAtlasFrame(this.texture, frame, name);
    if (this.frameCache.has(name)) return this.frameCache.get(name);
    const texture = this.texture.subTexture({ ...frame, id: `${this.texture.id}:${name}` });
    this.frameCache.set(name, texture);
    return texture;
  }

  getFrames(names) {
    if (!this.invalidateIfTextureDestroyed()) throw new Error("TextureAtlas yok edilmiş.");
    this._assertFrameBudget();
    if (!Array.isArray(names) || names.length === 0 || names.length > MAX_ATLAS_FRAMES || names.some((name) => typeof name !== "string" || name.length === 0 || name.length > MAX_ATLAS_FRAME_NAME_LENGTH)) throw new TypeError("Atlas frame adı dizisi geçersiz veya limit dışı.");
    return names.map((name) => this.get(name));
  }

  getClip(names, options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Atlas clip seçenekleri nesne olmalı.");
    return {
      frames: this.getFrames(names),
      frameRate: options.frameRate ?? 12,
      loop: options.loop !== false,
      pingPong: Boolean(options.pingPong),
      playing: options.playing !== false,
    };
  }

  has(name) {
    if (!this.invalidateIfTextureDestroyed()) return false;
    this._assertFrameBudget();
    const frame = this.frames.get(name);
    if (!frame) return false;
    assertAtlasFrame(this.texture, frame, name);
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    for (const texture of this.frameCache.values()) texture.destroy();
    this.frameCache.clear();
    this.destroyed = true;
  }

  static fromJSON(texture, data, { maxFrames = 10000 } = {}) {
    const rawFrames = data?.frames;
    if (!rawFrames || typeof rawFrames !== "object") throw new TypeError("Atlas frames alanı geçersiz.");
    const entries = Array.isArray(rawFrames)
      ? rawFrames.map((value, index) => [typeof value?.filename === "string" && value.filename ? value.filename : typeof value?.name === "string" && value.name ? value.name : String(index), value])
      : Object.entries(rawFrames);
    const frameLimit = atlasLimit(maxFrames, MAX_ATLAS_FRAMES, "Atlas frame");
    if (entries.length > frameLimit) throw new Error("Atlas frame limiti aşıldı.");
    if (entries.length > maxFrames) throw new Error("Atlas frame limiti aşıldı.");
    const frames = Object.create(null);
    const seenNames = new Set();
    for (const [name, value] of entries) {
      if (name.length > MAX_ATLAS_FRAME_NAME_LENGTH) throw new Error("Atlas frame adı limiti aşıldı.");
      if (seenNames.has(name)) throw new Error(`Atlas frame adı tekrar ediyor: ${name}`);
      if (value?.rotated || value?.trimmed) throw new Error(`Atlas rotated/trimmed frame metadata desteklenmiyor: ${name}`);
      const frame = value?.frame || value;
      const x = Number(frame?.x); const y = Number(frame?.y); const width = Number(frame?.w ?? frame?.width); const height = Number(frame?.h ?? frame?.height);
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > texture.sourceWidth || y + height > texture.sourceHeight) throw new Error(`Atlas frame sınır dışı: ${name}`);
      seenNames.add(name);
      frames[name] = { x, y, width, height };
    }
    return new TextureAtlas(texture, frames);
  }

  static fromGrid(texture, { frameWidth, frameHeight, columns, rows, marginX = 0, marginY = 0, spacingX = 0, spacingY = 0, names = null, maxFrames = 10000 } = {}) {
    if (!(texture instanceof Texture)) throw new TypeError("Atlas texture bekleniyor.");
    const values = [frameWidth, frameHeight, columns, rows, marginX, marginY, spacingX, spacingY].map(Number);
    if (![frameWidth, frameHeight, columns, rows].every((value) => Number.isInteger(Number(value)) && Number(value) > 0) || [marginX, marginY, spacingX, spacingY].some((value) => !Number.isInteger(Number(value)) || Number(value) < 0)) throw new RangeError("Atlas grid ölçüleri geçersiz.");
    const [width, height, columnCount, rowCount, left, top, gapX, gapY] = values;
    const count = columnCount * rowCount;
    const frameLimit = atlasLimit(maxFrames, MAX_ATLAS_FRAMES, "Atlas frame");
    if (!Number.isSafeInteger(count) || count > frameLimit) throw new Error("Atlas frame limiti aşıldı.");
    if (count > maxFrames) throw new Error("Atlas frame limiti aşıldı.");
    if (names !== null && (!Array.isArray(names) || names.length !== count || new Set(names.map(String)).size !== count)) throw new TypeError("Atlas grid isimleri frame sayısıyla eşleşmeli.");
    const frames = Object.create(null);
    for (let row = 0; row < rowCount; row += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        const index = row * columnCount + column;
        const x = left + column * (width + gapX);
        const y = top + row * (height + gapY);
        if (x + width > texture.sourceWidth || y + height > texture.sourceHeight) throw new RangeError(`Atlas grid frame sınır dışında: ${index}`);
        frames[names ? String(names[index]) : String(index)] = { x, y, width, height };
      }
    }
    return new TextureAtlas(texture, frames);
  }

  static pack(entries, { padding = 1, maxWidth = 2048, maxHeight = 2048, maxPixels = 16 * 1024 * 1024, id = "packed-atlas" } = {}) {
    if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("Atlas pack girdisi boş olamaz.");
    const pad = Number(padding); const limitWidth = Number(maxWidth); const limitHeight = Number(maxHeight); const pixelLimit = Number(maxPixels);
    if (entries.length > MAX_ATLAS_FRAMES || !Number.isSafeInteger(pad) || pad < 0 || !Number.isSafeInteger(limitWidth) || limitWidth <= 0 || limitWidth > MAX_ATLAS_DIMENSION || !Number.isSafeInteger(limitHeight) || limitHeight <= 0 || limitHeight > MAX_ATLAS_DIMENSION || !Number.isSafeInteger(pixelLimit) || pixelLimit <= 0 || pixelLimit > MAX_ATLAS_PIXELS) throw new RangeError("Atlas pack limitleri geçersiz.");
    if (![pad, limitWidth, limitHeight, pixelLimit].every(Number.isFinite) || ![pad, limitWidth, limitHeight, pixelLimit].every(Number.isInteger) || pad < 0 || limitWidth <= 0 || limitHeight <= 0 || pixelLimit <= 0) throw new RangeError("Atlas pack limitleri geçersiz.");
    const names = new Set();
    const items = entries.map((entry) => {
      const name = String(entry?.name || "");
      const resolved = resolvePackSource(entry?.source);
      const { source, sourceX, sourceY, width, height } = resolved;
      if (!name || name.length > MAX_ATLAS_FRAME_NAME_LENGTH || names.has(name)) throw new TypeError("Atlas pack frame adı geçersiz veya benzersiz değil.");
      const paddedWidth = width + pad * 2; const paddedHeight = height + pad * 2;
      if (!source || width > MAX_ATLAS_DIMENSION || height > MAX_ATLAS_DIMENSION || !Number.isSafeInteger(paddedWidth) || !Number.isSafeInteger(paddedHeight) || paddedWidth > limitWidth || paddedHeight > limitHeight) throw new RangeError(`Atlas pack kaynak boyutu limiti aşıldı: ${name}`);
      names.add(name);
      return { name, source, sourceX, sourceY, width, height };
    });
    const totalArea = items.reduce((sum, item) => sum + (item.width + pad * 2) * (item.height + pad * 2), 0);
    const widest = Math.max(...items.map((item) => item.width + pad * 2));
    let atlasWidth = Math.min(limitWidth, Math.max(nextPowerOfTwo(widest), nextPowerOfTwo(Math.ceil(Math.sqrt(totalArea)))));
    let placements = null; let atlasHeight = 0;
    while (true) {
      let x = 0; let y = 0; let rowHeight = 0; const next = [];
      for (const item of items) {
        const packedWidth = item.width + pad * 2; const packedHeight = item.height + pad * 2;
        if (x + packedWidth > atlasWidth) { x = 0; y += rowHeight; rowHeight = 0; }
        if (y + packedHeight > limitHeight) { next.length = 0; break; }
        next.push({ ...item, x: x + pad, y: y + pad });
        x += packedWidth; rowHeight = Math.max(rowHeight, packedHeight);
      }
      if (next.length === items.length) { placements = next; atlasHeight = y + rowHeight; break; }
      if (atlasWidth >= limitWidth) throw new RangeError("Atlas pack maksimum boyutu aşıldı.");
      atlasWidth = Math.min(limitWidth, atlasWidth * 2);
    }
    if (atlasWidth * atlasHeight > pixelLimit) throw new RangeError("Atlas pack pixel limiti aşıldı.");
    const canvas = createCanvas(atlasWidth, atlasHeight);
    const context = canvas.getContext?.("2d");
    if (!context?.drawImage) throw new Error("Atlas pack için 2D canvas context gerekli.");
    const frames = Object.create(null);
    for (const item of placements) {
      drawPaddedImage(context, item, pad);
      frames[item.name] = { x: item.x, y: item.y, width: item.width, height: item.height };
    }
    return new TextureAtlas(Texture.fromImage(canvas, { id }), frames);
  }
}
