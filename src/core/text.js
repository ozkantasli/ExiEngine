import { Sprite } from "./sprite.js";
import { Texture } from "../assets/texture.js";

const MAX_TEXT_LENGTH = 16_384;
const MAX_TEXT_FONT_LENGTH = 512;
const MAX_TEXT_DIMENSION = 4_096;
const MAX_TEXT_PIXELS = 16 * 1024 * 1024;
const MAX_GLYPH_ATLAS_DIMENSION = 4_096;
const MAX_GLYPH_CLUSTER_LENGTH = 256;
let nextTextId = 1;
let graphemeSegmenter = null;

function createCanvas(width = 1, height = 1) {
  let canvas;
  if (typeof globalThis.OffscreenCanvas === "function") canvas = new globalThis.OffscreenCanvas(width, height);
  else if (typeof globalThis.document?.createElement === "function") canvas = globalThis.document.createElement("canvas");
  else throw new Error("Text için Canvas 2D gerekli.");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function splitGraphemes(value) {
  if (typeof globalThis.Intl?.Segmenter === "function") {
    graphemeSegmenter ||= new globalThis.Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
  }
  const clusters = [];
  for (const symbol of Array.from(value)) {
    const codePoint = symbol.codePointAt(0);
    const previous = clusters[clusters.length - 1];
    const previousSymbols = previous ? Array.from(previous) : [];
    const previousCodePoint = previousSymbols.length ? previousSymbols[previousSymbols.length - 1].codePointAt(0) : undefined;
    const isMark = (codePoint >= 0x0300 && codePoint <= 0x036f) || (codePoint >= 0x1ab0 && codePoint <= 0x1aff) || (codePoint >= 0x1dc0 && codePoint <= 0x1dff) || (codePoint >= 0x20d0 && codePoint <= 0x20ff) || (codePoint >= 0xfe20 && codePoint <= 0xfe2f) || (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff);
    const isJoiner = codePoint === 0x200d || previousCodePoint === 0x200d;
    const isRegionalPair = codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff && previousSymbols.length === 1 && previousCodePoint >= 0x1f1e6 && previousCodePoint <= 0x1f1ff;
    if (previous && (isMark || isJoiner || isRegionalPair)) clusters[clusters.length - 1] += symbol;
    else clusters.push(symbol);
  }
  return clusters;
}

function requiresComplexShaping(value) {
  return /[\u0590-\u08ff\u0900-\u1fff\u2d00-\u2d7f\u1100-\u11ff\ua800-\ua8ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(value);
}

function glyphStyleKey({ font, fill, stroke, strokeWidth, resolution }) {
  return [String(font), String(fill), stroke == null ? "" : String(stroke), strokeWidth, resolution];
}

function validateAtlasDimension(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_GLYPH_ATLAS_DIMENSION) throw new RangeError(`${label} limit invalid.`);
  return number;
}

function validateAtlasPadding(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 64) throw new RangeError("Glyph atlas padding limit invalid.");
  return number;
}

function createGlyphContext(canvas) {
  const context = canvas.getContext?.("2d");
  if (!context?.measureText || !context.clearRect || !context.fillText || !context.drawImage) throw new Error("Glyph atlas için Canvas 2D context gerekli.");
  return context;
}

function lineHeightFor(font) {
  const match = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/i.exec(font);
  const requested = match ? Number(match[1]) * 1.2 : 19.2;
  return Number.isFinite(requested) ? Math.min(MAX_TEXT_DIMENSION, Math.max(1, requested)) : 19.2;
}

function positive(value, fallback, maximum) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(maximum, number) : fallback;
}

function textWidthLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(MAX_TEXT_DIMENSION, number) : 0;
}

function wrapLine(line, maxWidth, measureContext) {
  if (line.length === 0) return [""];
  const wrapped = [];
  let current = "";
  const tokens = line.match(/\s+|\S+/gu) || [line];
  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      if (current) current += token;
      continue;
    }
    if (current && Number(measureContext.measureText(current + token)?.width) > maxWidth) {
      wrapped.push(current.trimEnd());
      current = "";
    }
    for (const symbol of Array.from(token)) {
      if (current && Number(measureContext.measureText(current + symbol)?.width) > maxWidth) {
        wrapped.push(current.trimEnd());
        current = "";
      }
      current += symbol;
    }
  }
  wrapped.push(current.trimEnd());
  return wrapped;
}

function wrapLines(lines, maxWidth, measureContext) {
  const wrapped = [];
  for (const line of lines) for (const part of wrapLine(line, maxWidth, measureContext)) wrapped.push(part);
  return wrapped;
}

function normalizeFont(value) {
  const font = String(value);
  if (font.length === 0 || font.length > MAX_TEXT_FONT_LENGTH) throw new RangeError("Text font limit exceeded.");
  return font;
}

function cacheLimit(value, fallback, maximum, label) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) throw new RangeError(`${label} limit invalid.`);
  return number;
}

function textCacheKey(text, font, fill, stroke, strokeWidth, align, baseline, lineHeight, padding, resolution, maxWidth, wordWrap, width, height, sourceWidth, sourceHeight, renderMode) {
  return JSON.stringify([text, font, String(fill), stroke == null ? "" : String(stroke), strokeWidth, align, baseline, lineHeight, padding, resolution, maxWidth, wordWrap, width, height, sourceWidth, sourceHeight, renderMode]);
}

function renderText(canvas, context, lines, { font, fill, stroke, strokeWidth, align, baseline, resolution, logicalWidth, logicalHeight, sourceWidth, sourceHeight, outerPadding, lineHeight, measureContext, glyphAtlas = null }) {
  if (glyphAtlas?.renderText(canvas, context, lines, { font, fill, stroke, strokeWidth, align, baseline, resolution, logicalWidth, logicalHeight, sourceWidth, sourceHeight, outerPadding, lineHeight, measureContext })) return { source: canvas, context, width: logicalWidth, height: logicalHeight, sourceWidth, sourceHeight };
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  if (context.setTransform) context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, sourceWidth, sourceHeight);
  if (context.setTransform) context.setTransform(resolution, 0, 0, resolution, 0, 0);
  else context.scale?.(resolution, resolution);
  context.font = font;
  context.textAlign = align;
  context.textBaseline = baseline;
  context.fillStyle = fill;
  if (stroke && strokeWidth > 0) { context.strokeStyle = stroke; context.lineWidth = strokeWidth; }
  const x = align === "left" ? outerPadding : align === "center" ? logicalWidth * 0.5 : logicalWidth - outerPadding;
  for (let index = 0; index < lines.length; index += 1) {
    const y = outerPadding + index * lineHeight;
    if (stroke && strokeWidth > 0) context.strokeText(lines[index], x, y);
    context.fillText(lines[index], x, y);
  }
  if (context.setTransform) context.setTransform(1, 0, 0, 1, 0, 0);
  return { source: canvas, context, width: logicalWidth, height: logicalHeight, sourceWidth, sourceHeight };
}

export class TextCache {
  constructor({ maxEntries = 256, maxPixels = 4 * 1024 * 1024 } = {}) {
    this.maxEntries = cacheLimit(maxEntries, 256, 4096, "Text cache entry");
    this.maxPixels = cacheLimit(maxPixels, 4 * 1024 * 1024, MAX_TEXT_PIXELS, "Text cache pixel");
    this._maxEntriesCapacity = this.maxEntries;
    this._maxPixelsCapacity = this.maxPixels;
    this.entries = new Map();
    this.totalPixels = 0;
    this.clock = 0;
  }

  get size() { return this.entries.size; }

  assertBudget() {
    if (this.maxEntries !== this._maxEntriesCapacity || this.maxPixels !== this._maxPixelsCapacity) {
      const error = new RangeError("Text cache bütçesi doğrudan değiştirilemez.");
      error.code = "EXI_TEXT_CONFIG";
      throw error;
    }
  }

  acquire(key, create) {
    this.assertBudget();
    const existing = this.entries.get(key);
    if (existing && !existing.texture.destroyed) {
      existing.references += 1;
      existing.lastUsed = ++this.clock;
      return existing;
    }
    if (existing) this.remove(existing);
    const value = create();
    const pixels = value.sourceWidth * value.sourceHeight;
    if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > this.maxPixels) return null;
    while (this.entries.size >= this.maxEntries || this.totalPixels + pixels > this.maxPixels) {
      const idle = [...this.entries.values()].filter((entry) => entry.references === 0).sort((left, right) => left.lastUsed - right.lastUsed)[0];
      if (!idle) return null;
      this.remove(idle);
    }
    const entry = {
      key,
      source: value.source,
      context: value.context,
      width: value.width,
      height: value.height,
      sourceWidth: value.sourceWidth,
      sourceHeight: value.sourceHeight,
      texture: new Texture({ id: `text-cache-${this.entries.size + 1}`, source: value.source, width: value.width, height: value.height, sourceWidth: value.sourceWidth, sourceHeight: value.sourceHeight }),
      references: 1,
      lastUsed: ++this.clock,
    };
    this.entries.set(key, entry);
    this.totalPixels += pixels;
    return entry;
  }

  release(entry) {
    if (!entry || entry.references <= 0) return false;
    entry.references -= 1;
    return true;
  }

  clear() {
    let removed = 0;
    for (const entry of [...this.entries.values()]) {
      if (entry.references === 0) { this.remove(entry); removed += 1; }
    }
    return removed;
  }

  remove(entry) {
    if (this.entries.get(entry.key) !== entry || entry.references > 0) return false;
    this.entries.delete(entry.key);
    this.totalPixels -= entry.sourceWidth * entry.sourceHeight;
    entry.texture.destroy();
    return true;
  }
}

export class GlyphAtlas {
  constructor({ width = 1024, height = 1024, maxEntries = 2048, maxPixels = 4 * 1024 * 1024, padding = 2 } = {}) {
    this.width = validateAtlasDimension(width, "Glyph atlas width");
    this.height = validateAtlasDimension(height, "Glyph atlas height");
    this.maxEntries = cacheLimit(maxEntries, 2048, 8192, "Glyph atlas entry");
    this.maxPixels = cacheLimit(maxPixels, 4 * 1024 * 1024, MAX_TEXT_PIXELS, "Glyph atlas pixel");
    if (this.width * this.height > this.maxPixels) throw new RangeError("Glyph atlas pixel limit invalid.");
    this.padding = validateAtlasPadding(padding);
    this._widthSnapshot = this.width;
    this._heightSnapshot = this.height;
    this._maxEntriesCapacity = this.maxEntries;
    this._maxPixelsCapacity = this.maxPixels;
    this._paddingSnapshot = this.padding;
    this.canvas = createCanvas(this.width, this.height);
    this.context = createGlyphContext(this.canvas);
    this.entries = new Map();
    this.cursorX = 0;
    this.cursorY = 0;
    this.rowHeight = 0;
    this.usedPixels = 0;
    this.complexScriptFallbacks = 0;
    this.destroyed = false;
  }

  get size() { return this.entries.size; }

  getInfo() {
    return { width: this.width, height: this.height, size: this.size, maxEntries: this.maxEntries, maxPixels: this.maxPixels, usedPixels: this.usedPixels, complexScriptFallbacks: this.complexScriptFallbacks, destroyed: this.destroyed };
  }

  assertBudget() {
    if (this.width !== this._widthSnapshot || this.height !== this._heightSnapshot || this.maxEntries !== this._maxEntriesCapacity || this.maxPixels !== this._maxPixelsCapacity || this.padding !== this._paddingSnapshot) {
      const error = new RangeError("Glyph atlas bütçesi doğrudan değiştirilemez.");
      error.code = "EXI_TEXT_CONFIG";
      throw error;
    }
  }

  getGlyph(cluster, style, measureContext = this.context) {
    if (this.destroyed || typeof cluster !== "string" || cluster.length === 0 || cluster.length > MAX_GLYPH_CLUSTER_LENGTH) return null;
    this.assertBudget();
    const styleKey = glyphStyleKey(style);
    const key = JSON.stringify([cluster, ...styleKey]);
    const existing = this.entries.get(key);
    if (existing) return existing;
    if (this.entries.size >= this.maxEntries) return null;
    measureContext.font = style.font;
    const metrics = measureContext.measureText(cluster);
    const advance = Number(metrics?.width);
    if (!Number.isFinite(advance) || advance < 0) return null;
    const inset = this.padding + style.strokeWidth;
    const logicalWidth = Math.max(1, advance + inset * 2);
    const logicalHeight = Math.max(1, lineHeightFor(style.font) + inset * 2);
    const sourceWidth = Math.max(1, Math.ceil(logicalWidth * style.resolution));
    const sourceHeight = Math.max(1, Math.ceil(logicalHeight * style.resolution));
    if (sourceWidth > this.width || sourceHeight > this.height) return null;
    if (this.cursorX + sourceWidth > this.width) {
      this.cursorX = 0;
      this.cursorY += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.cursorY + sourceHeight > this.height) return null;
    const x = this.cursorX;
    const y = this.cursorY;
    this.cursorX += sourceWidth;
    this.rowHeight = Math.max(this.rowHeight, sourceHeight);
    this.usedPixels = Math.max(this.usedPixels, (this.cursorY + this.rowHeight) * this.width);
    const context = this.context;
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.clearRect(x, y, sourceWidth, sourceHeight);
    context.setTransform?.(style.resolution, 0, 0, style.resolution, 0, 0);
    context.font = style.font;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillStyle = style.fill;
    if (style.stroke && style.strokeWidth > 0) { context.strokeStyle = style.stroke; context.lineWidth = style.strokeWidth; context.strokeText(cluster, x / style.resolution + inset, y / style.resolution + inset); }
    context.fillText(cluster, x / style.resolution + inset, y / style.resolution + inset);
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    const entry = { x, y, sourceWidth, sourceHeight, logicalWidth, logicalHeight, inset, advance };
    this.entries.set(key, entry);
    return entry;
  }

  renderText(canvas, context, lines, { font, fill, stroke, strokeWidth, align, baseline, resolution, logicalWidth, logicalHeight, sourceWidth, sourceHeight, outerPadding, lineHeight, measureContext = context }) {
    const complexShaping = requiresComplexShaping(lines.join("\n"));
    if (complexShaping) this.complexScriptFallbacks += 1;
    if (this.destroyed || baseline !== "top" || typeof context.drawImage !== "function" || complexShaping) return false;
    const style = { font, fill, stroke, strokeWidth, resolution };
    const lineGlyphs = [];
    for (const line of lines) {
      const glyphs = [];
      for (const cluster of splitGraphemes(line)) {
        const glyph = this.getGlyph(cluster, style, measureContext);
        if (!glyph) return false;
        glyphs.push(glyph);
      }
      lineGlyphs.push(glyphs);
    }
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    if (context.setTransform) context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, sourceWidth, sourceHeight);
    context.setTransform?.(resolution, 0, 0, resolution, 0, 0);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const lineWidth = Number(measureContext.measureText(line).width) || 0;
      let x = align === "left" ? outerPadding : align === "center" ? logicalWidth * 0.5 - lineWidth * 0.5 : logicalWidth - outerPadding - lineWidth;
      const y = outerPadding + index * lineHeight;
      for (const glyph of lineGlyphs[index]) {
        context.drawImage(this.canvas, glyph.x, glyph.y, glyph.sourceWidth, glyph.sourceHeight, x - glyph.inset, y - glyph.inset, glyph.logicalWidth, glyph.logicalHeight);
        x += glyph.advance;
      }
    }
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    return true;
  }

  clear() {
    if (this.destroyed) return this;
    this.entries.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.rowHeight = 0;
    this.usedPixels = 0;
    this.context.setTransform?.(1, 0, 0, 1, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

export class Text extends Sprite {
  constructor({ text = "", font = "16px sans-serif", fill = "#ffffff", stroke = null, strokeWidth = 0, align = "left", baseline = "top", lineHeight = 0, padding = 0, resolution = 1, maxWidth = 0, wordWrap = false, cache = null, glyphAtlas = null, ...options } = {}) {
    const canvas = createCanvas();
    const context = canvas.getContext?.("2d");
    if (!context?.measureText) throw new Error("Text için Canvas 2D context gerekli.");
    const texture = new Texture({ id: `text-${nextTextId++}`, source: canvas, width: 1, height: 1, sourceWidth: 1, sourceHeight: 1 });
    super({ ...options, texture, width: 1, height: 1 });
    this.canvas = canvas;
    this.context = context;
    this.measureContext = context;
    this.cache = cache instanceof TextCache ? cache : null;
    this.glyphAtlas = glyphAtlas instanceof GlyphAtlas ? glyphAtlas : null;
    this.cacheEntry = null;
    this.cacheKey = null;
    this.text = null;
    this.font = normalizeFont(font);
    this.fill = fill;
    this.stroke = stroke;
    this.strokeWidth = positive(strokeWidth, 0, 128);
    this.align = ["left", "center", "right"].includes(align) ? align : "left";
    this.baseline = ["top", "middle", "alphabetic", "bottom"].includes(baseline) ? baseline : "top";
    this.lineHeight = positive(lineHeight, 0, MAX_TEXT_DIMENSION) || lineHeightFor(this.font);
    this.padding = positive(padding, 0, 1024);
    this.resolution = Math.max(0.25, Math.min(4, Number(resolution) || 1));
    this.maxWidth = textWidthLimit(maxWidth);
    this.wordWrap = Boolean(wordWrap);
    this.setText(text);
  }

  setText(value) {
    const next = String(value ?? "");
    if (next.length > MAX_TEXT_LENGTH) throw new RangeError("Text karakter limiti aşıldı.");
    if (next === this.text) return this;
    this.text = next;
    this.redraw();
    return this;
  }

  setStyle({ font = this.font, fill = this.fill, stroke = this.stroke, strokeWidth = this.strokeWidth, align = this.align, baseline = this.baseline, lineHeight = this.lineHeight, padding = this.padding, resolution = this.resolution, maxWidth = this.maxWidth, wordWrap = this.wordWrap } = {}) {
    const nextFont = normalizeFont(font);
    const nextStrokeWidth = positive(strokeWidth, 0, 128);
    const nextAlign = ["left", "center", "right"].includes(align) ? align : "left";
    const nextBaseline = ["top", "middle", "alphabetic", "bottom"].includes(baseline) ? baseline : "top";
    const nextLineHeight = positive(lineHeight, 0, MAX_TEXT_DIMENSION) || lineHeightFor(nextFont);
    const nextPadding = positive(padding, 0, 1024);
    const nextResolution = Math.max(0.25, Math.min(4, Number(resolution) || 1));
    const nextMaxWidth = textWidthLimit(maxWidth);
    const nextWordWrap = Boolean(wordWrap);
    if (nextFont === this.font && Object.is(fill, this.fill) && Object.is(stroke, this.stroke) && nextStrokeWidth === this.strokeWidth && nextAlign === this.align && nextBaseline === this.baseline && nextLineHeight === this.lineHeight && nextPadding === this.padding && nextResolution === this.resolution && nextMaxWidth === this.maxWidth && nextWordWrap === this.wordWrap) return this;
    this.fill = fill;
    this.stroke = stroke;
    this.strokeWidth = nextStrokeWidth;
    this.align = nextAlign;
    this.baseline = nextBaseline;
    this.font = nextFont;
    this.lineHeight = nextLineHeight;
    this.padding = nextPadding;
    this.resolution = nextResolution;
    this.maxWidth = nextMaxWidth;
    this.wordWrap = nextWordWrap;
    this.redraw();
    return this;
  }

  releaseTexture() {
    if (this.cacheEntry) {
      this.cache.release(this.cacheEntry);
      this.cacheEntry = null;
      this.cacheKey = null;
    } else {
      this.texture?.destroy();
    }
  }

  redraw() {
    const sourceLines = this.text.split("\n");
    const measureContext = this.measureContext || this.context;
    measureContext.font = this.font;
    const lines = this.wordWrap && this.maxWidth > 0 ? wrapLines(sourceLines, this.maxWidth, measureContext) : sourceLines;
    const outerPadding = this.padding + this.strokeWidth;
    let maxLineWidth = 0;
    for (const line of lines) maxLineWidth = Math.max(maxLineWidth, Number(measureContext.measureText(line)?.width) || 0);
    const logicalWidth = Math.max(1, Math.ceil((this.wordWrap && this.maxWidth > 0 ? this.maxWidth : maxLineWidth) + outerPadding * 2));
    const logicalHeight = Math.max(1, Math.ceil(lines.length * this.lineHeight + outerPadding * 2));
    const pixelWidth = Math.max(1, Math.ceil(logicalWidth * this.resolution));
    const pixelHeight = Math.max(1, Math.ceil(logicalHeight * this.resolution));
    if (pixelWidth > MAX_TEXT_DIMENSION || pixelHeight > MAX_TEXT_DIMENSION || pixelWidth * pixelHeight > MAX_TEXT_PIXELS) throw new RangeError("Text canvas limiti aşıldı.");
    const key = this.cache ? textCacheKey(this.text, this.font, this.fill, this.stroke, this.strokeWidth, this.align, this.baseline, this.lineHeight, this.padding, this.resolution, this.maxWidth, this.wordWrap, logicalWidth, logicalHeight, pixelWidth, pixelHeight, this.glyphAtlas ? "glyph" : "canvas") : null;
    if (this.cache && this.cacheEntry && this.cacheKey === key) return this;

    let ownsNewCanvas = false;
    if (this.cache) {
      const entry = this.cache.acquire(key, () => {
        const canvas = createCanvas();
        const context = canvas.getContext?.("2d");
        if (!context?.measureText) throw new Error("Text için Canvas 2D context gerekli.");
        return renderText(canvas, context, lines, { font: this.font, fill: this.fill, stroke: this.stroke, strokeWidth: this.strokeWidth, align: this.align, baseline: this.baseline, resolution: this.resolution, logicalWidth, logicalHeight, sourceWidth: pixelWidth, sourceHeight: pixelHeight, outerPadding, lineHeight: this.lineHeight, measureContext, glyphAtlas: this.glyphAtlas });
      });
      if (entry) {
        this.releaseTexture();
        this.texture = entry.texture;
        this.canvas = entry.source;
        this.context = entry.context;
        this.cacheEntry = entry;
        this.cacheKey = key;
        this.width = logicalWidth;
        this.height = logicalHeight;
        return this;
      }
      this.releaseTexture();
      this.canvas = createCanvas();
      this.context = this.canvas.getContext("2d");
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
      this.cacheKey = null;
      ownsNewCanvas = true;
    }

    const sameSize = this.canvas.width === pixelWidth && this.canvas.height === pixelHeight;
    const rendered = renderText(this.canvas, this.context, lines, { font: this.font, fill: this.fill, stroke: this.stroke, strokeWidth: this.strokeWidth, align: this.align, baseline: this.baseline, resolution: this.resolution, logicalWidth, logicalHeight, sourceWidth: pixelWidth, sourceHeight: pixelHeight, outerPadding, lineHeight: this.lineHeight, measureContext, glyphAtlas: this.glyphAtlas });
    if (sameSize && !this.cacheEntry && !ownsNewCanvas) this.texture.updateSource(this.canvas);
    else {
      const previous = this.texture;
      this.setTexture(new Texture({ id: `text-${nextTextId++}`, source: this.canvas, width: logicalWidth, height: logicalHeight, sourceWidth: pixelWidth, sourceHeight: pixelHeight }), { width: logicalWidth, height: logicalHeight });
      previous.destroy();
    }
    this.context = rendered.context;
    this.width = logicalWidth;
    this.height = logicalHeight;
    return this;
  }

  destroy() {
    this.releaseTexture();
    super.destroy();
  }
}
