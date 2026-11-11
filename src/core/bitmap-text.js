import { SpriteBatch } from "./sprite-batch.js";
import { Texture } from "../assets/texture.js";

// AngelCode BMFont support (the format written by BMFont, Hiero, msdf-bmfont,
// Littera, ShoeBox ...). Both the text ".fnt" format and the common JSON shape
// ({ info, common, chars, kernings }) are accepted. A font is one texture page:
// every glyph is a sub-texture of it, so a BitmapText draws as one batch.

export const MAX_BITMAP_FONT_GLYPHS = 65_536;
export const MAX_BITMAP_FONT_KERNINGS = 131_072;
export const MAX_BITMAP_TEXT_LENGTH = 16_384;
const MAX_FONT_SOURCE_LENGTH = 8 * 1024 * 1024;
const NEWLINE = 10;
const SPACE = 32;

function fontInteger(value, label, { min = -65_536, max = 65_536 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new RangeError(`BitmapFont ${label} must be an integer between ${min} and ${max}.`);
  return number;
}

function parseTextAttributes(line) {
  const attributes = Object.create(null);
  const pattern = /(\w+)=("([^"]*)"|\S+)/g;
  let match;
  while ((match = pattern.exec(line))) attributes[match[1]] = match[3] !== undefined ? match[3] : match[2];
  return attributes;
}

// Parses the text .fnt format into the JSON shape.
export function parseBitmapFontText(source) {
  if (typeof source !== "string" || source.length > MAX_FONT_SOURCE_LENGTH) throw new TypeError("BitmapFont text source must be a string of at most 8 MiB.");
  const data = { info: {}, common: {}, pages: [], chars: [], kernings: [] };
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const space = line.indexOf(" ");
    const tag = space < 0 ? line : line.slice(0, space);
    const attributes = parseTextAttributes(space < 0 ? "" : line.slice(space + 1));
    if (tag === "info") data.info = attributes;
    else if (tag === "common") data.common = attributes;
    else if (tag === "page") data.pages.push(attributes.file ?? "");
    else if (tag === "char") {
      if (data.chars.length >= MAX_BITMAP_FONT_GLYPHS) throw new RangeError("BitmapFont glyph limit exceeded.");
      data.chars.push(attributes);
    } else if (tag === "kerning") {
      if (data.kernings.length >= MAX_BITMAP_FONT_KERNINGS) throw new RangeError("BitmapFont kerning limit exceeded.");
      data.kernings.push(attributes);
    }
  }
  return data;
}

export class BitmapFont {
  constructor(texture, data) {
    if (!(texture instanceof Texture) || texture.destroyed) throw new TypeError("BitmapFont requires a live Texture.");
    const parsed = typeof data === "string" ? parseBitmapFontText(data) : data;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("BitmapFont data must be BMFont text or a BMFont JSON object.");
    const common = parsed.common && typeof parsed.common === "object" ? parsed.common : {};
    const pages = Array.isArray(parsed.pages) ? parsed.pages.length : fontInteger(common.pages ?? 1, "common.pages", { min: 0, max: 64 });
    if (pages > 1 || fontInteger(common.pages ?? 1, "common.pages", { min: 0, max: 64 }) > 1) throw new RangeError("BitmapFont supports single-page fonts; pack the font into one texture page.");
    const chars = parsed.chars;
    if (!Array.isArray(chars) || chars.length === 0) throw new TypeError("BitmapFont needs a non-empty chars list.");
    if (chars.length > MAX_BITMAP_FONT_GLYPHS) throw new RangeError("BitmapFont glyph limit exceeded.");
    this.texture = texture;
    this.face = typeof parsed.info?.face === "string" ? parsed.info.face.slice(0, 256) : "bitmap";
    this.size = Math.abs(fontInteger(parsed.info?.size ?? common.lineHeight ?? 16, "info.size"));
    this.lineHeight = fontInteger(common.lineHeight ?? this.size, "common.lineHeight", { min: 1 });
    this.base = fontInteger(common.base ?? this.lineHeight, "common.base", { min: 0 });
    this.glyphs = new Map();
    // Glyph rectangles are in texture pixels of the base page; frames inherit
    // the page texture so every glyph shares one GPU texture.
    const pageWidth = texture.sourceWidth;
    const pageHeight = texture.sourceHeight;
    for (const entry of chars) {
      if (!entry || typeof entry !== "object") throw new TypeError("BitmapFont char entries must be objects.");
      const id = fontInteger(entry.id, "char.id", { min: 0, max: 0x10ffff });
      const x = fontInteger(entry.x ?? 0, "char.x", { min: 0 });
      const y = fontInteger(entry.y ?? 0, "char.y", { min: 0 });
      const width = fontInteger(entry.width ?? 0, "char.width", { min: 0 });
      const height = fontInteger(entry.height ?? 0, "char.height", { min: 0 });
      if (fontInteger(entry.page ?? 0, "char.page", { min: 0, max: 64 }) !== 0) throw new RangeError("BitmapFont supports single-page fonts; pack the font into one texture page.");
      if (x + width > pageWidth || y + height > pageHeight) throw new RangeError(`BitmapFont glyph ${id} is outside the font texture.`);
      const glyph = {
        id, width, height,
        xOffset: fontInteger(entry.xoffset ?? 0, "char.xoffset"),
        yOffset: fontInteger(entry.yoffset ?? 0, "char.yoffset"),
        xAdvance: fontInteger(entry.xadvance ?? width, "char.xadvance"),
        frame: width > 0 && height > 0 ? texture.subTexture({ x, y, width, height, id: `${texture.id}:glyph:${id}` }) : null,
      };
      this.glyphs.set(id, glyph);
    }
    this.kernings = new Map();
    const kernings = parsed.kernings ?? [];
    if (!Array.isArray(kernings) || kernings.length > MAX_BITMAP_FONT_KERNINGS) throw new RangeError("BitmapFont kernings must be an array within the kerning limit.");
    for (const entry of kernings) {
      if (!entry || typeof entry !== "object") continue;
      const first = fontInteger(entry.first, "kerning.first", { min: 0, max: 0x10ffff });
      const second = fontInteger(entry.second, "kerning.second", { min: 0, max: 0x10ffff });
      this.kernings.set(first * 0x110000 + second, fontInteger(entry.amount, "kerning.amount"));
    }
    this.fallback = this.glyphs.get(63) ?? null; // "?"
    this.destroyed = false;
  }

  static fromText(texture, source) { return new BitmapFont(texture, parseBitmapFontText(source)); }
  static fromJSON(texture, data) { return new BitmapFont(texture, data); }

  getGlyph(codePoint) { return this.glyphs.get(codePoint) ?? null; }
  getKerning(first, second) { return this.kernings.get(first * 0x110000 + second) ?? 0; }

  // Lays text out into glyph placements (top-left origin). Word wrap breaks at
  // spaces when maxWidth > 0; a single word longer than maxWidth is broken.
  layout(text, { maxWidth = 0, letterSpacing = 0, lineHeight = 0, align = "left" } = {}) {
    if (this.destroyed) throw new Error("BitmapFont has been destroyed.");
    const value = String(text ?? "");
    if (value.length > MAX_BITMAP_TEXT_LENGTH) throw new RangeError(`BitmapText length limit is ${MAX_BITMAP_TEXT_LENGTH} characters.`);
    const wrapWidth = Math.max(0, Number(maxWidth) || 0);
    const spacing = Number.isFinite(Number(letterSpacing)) ? Number(letterSpacing) : 0;
    const advanceY = Number(lineHeight) > 0 ? Number(lineHeight) : this.lineHeight;
    if (align !== "left" && align !== "center" && align !== "right") throw new TypeError('BitmapText align must be "left", "center" or "right".');
    const lines = [[]];
    const lineWidths = [0];
    let penX = 0;
    let previous = -1;
    let missing = 0;
    let lastSpace = -1; // index in the current line of the last space glyph
    const newLine = () => { lines.push([]); lineWidths.push(0); penX = 0; previous = -1; lastSpace = -1; };
    for (const character of value) {
      const code = character.codePointAt(0);
      if (code === NEWLINE) { newLine(); continue; }
      if (code === 13) continue;
      let glyph = this.glyphs.get(code);
      if (!glyph) { missing += 1; glyph = this.fallback; if (!glyph) continue; }
      const kerning = previous >= 0 ? this.getKerning(previous, glyph.id) : 0;
      let line = lines[lines.length - 1];
      if (wrapWidth > 0 && code !== SPACE && penX + kerning + glyph.xOffset + glyph.width > wrapWidth && line.length > 0) {
        if (lastSpace >= 0) {
          // Move the word after the last space to a new line.
          const carried = line.splice(lastSpace + 1);
          line.pop(); // the space itself
          lineWidths[lines.length - 1] = line.length ? Math.max(...line.map((item) => item.x + item.advanceWidth)) : 0;
          newLine();
          line = lines[lines.length - 1];
          const shift = carried.length ? carried[0].x - carried[0].glyph.xOffset : 0;
          for (const item of carried) { item.x -= shift; line.push(item); }
          penX = carried.length ? carried[carried.length - 1].x - carried[carried.length - 1].glyph.xOffset + carried[carried.length - 1].glyph.xAdvance + spacing : 0;
          previous = carried.length ? carried[carried.length - 1].glyph.id : -1;
        } else {
          newLine();
          line = lines[lines.length - 1];
        }
      }
      const appliedKerning = previous >= 0 ? this.getKerning(previous, glyph.id) : 0;
      penX += appliedKerning;
      const item = { glyph, x: penX + glyph.xOffset, y: (lines.length - 1) * advanceY + glyph.yOffset, advanceWidth: glyph.width };
      if (code === SPACE) lastSpace = line.length;
      line.push(item);
      penX += glyph.xAdvance + spacing;
      lineWidths[lines.length - 1] = Math.max(lineWidths[lines.length - 1], penX - spacing);
      previous = glyph.id;
    }
    const width = Math.max(0, ...lineWidths);
    const placements = [];
    lines.forEach((line, index) => {
      const shift = align === "center" ? (width - lineWidths[index]) / 2 : align === "right" ? width - lineWidths[index] : 0;
      for (const item of line) {
        if (!item.glyph.frame) continue;
        placements.push({ glyph: item.glyph, x: item.x + shift, y: (index * advanceY) + item.glyph.yOffset, line: index });
      }
    });
    return { placements, width, height: lines.length * advanceY, lines: lines.length, missing };
  }

  measure(text, options) {
    const { width, height, lines, missing } = this.layout(text, options);
    return { width, height, lines, missing };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const glyph of this.glyphs.values()) glyph.frame?.destroy?.();
    this.glyphs.clear();
    this.kernings.clear();
  }
}

// A text node drawn from a BitmapFont: one SpriteBatch quad per visible glyph,
// re-laid out only when the text or layout options change.
export class BitmapText extends SpriteBatch {
  constructor({ font, text = "", tint = 0xffffff, align = "left", maxWidth = 0, letterSpacing = 0, lineHeight = 0, anchorX = 0, anchorY = 0, ...options } = {}) {
    if (!(font instanceof BitmapFont) || font.destroyed) throw new TypeError("BitmapText requires a live BitmapFont.");
    super({ name: "bitmap-text", ...options, texture: font.texture });
    this.font = font;
    this._text = "";
    this._style = { tint, align, maxWidth, letterSpacing, lineHeight, anchorX: Number(anchorX) || 0, anchorY: Number(anchorY) || 0 };
    this.textWidth = 0;
    this.textHeight = 0;
    this.missingGlyphs = 0;
    this.setText(text);
  }

  get text() { return this._text; }
  set text(value) { this.setText(value); }

  setText(value) {
    const next = String(value ?? "");
    if (next === this._text && this.count > 0) return this;
    this._text = next;
    return this.relayout();
  }

  setStyle(style = {}) {
    if (!style || typeof style !== "object") throw new TypeError("BitmapText style must be an object.");
    for (const key of ["tint", "align", "maxWidth", "letterSpacing", "lineHeight", "anchorX", "anchorY"]) if (style[key] !== undefined) this._style[key] = style[key];
    return this.relayout();
  }

  relayout() {
    const { tint, align, maxWidth, letterSpacing, lineHeight, anchorX, anchorY } = this._style;
    const layout = this.font.layout(this._text, { align, maxWidth, letterSpacing, lineHeight });
    const offsetX = -anchorX * layout.width;
    const offsetY = -anchorY * layout.height;
    this.clear();
    this.addSprites(layout.placements.map((placement) => ({
      texture: placement.glyph.frame,
      x: placement.x + offsetX, y: placement.y + offsetY,
      width: placement.glyph.width, height: placement.glyph.height,
      anchorX: 0, anchorY: 0, tint,
    })));
    this.textWidth = layout.width;
    this.textHeight = layout.height;
    this.missingGlyphs = layout.missing;
    return this;
  }
}
