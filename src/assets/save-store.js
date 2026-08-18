const textEncoder = new TextEncoder();
const MAX_NAMESPACE_LENGTH = 64;
const MAX_KEY_NAME_LENGTH = 128;
const MAX_SAVE_BYTES = 16 * 1024 * 1024;
const MAX_SAVE_NODES = 100_000;
const MAX_SAVE_DEPTH = 64;

function normalizeSegment(value, maximum, label) {
  const segment = String(value ?? "").replace(/[^a-z0-9_-]/gi, "_");
  if (!segment || segment.length > maximum) throw new RangeError(`${label} limiti geçersiz.`);
  return segment;
}

function validateJSONBudget(encoded) {
  let depth = 0;
  let maxDepth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === "{" || character === "[") {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      nodes += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new RangeError("Save JSON yapısı geçersiz.");
    } else if (character === "," || character === ":") nodes += 1;
    if (maxDepth > MAX_SAVE_DEPTH || nodes > MAX_SAVE_NODES) throw new RangeError("Save JSON limiti aşıldı.");
  }
  if (inString || depth !== 0) throw new RangeError("Save JSON yapısı geçersiz.");
}

export class SaveStore {
  constructor({ namespace = "exi", storage = globalThis.localStorage, maxBytes = 256 * 1024 } = {}) {
    this.namespace = normalizeSegment(namespace, MAX_NAMESPACE_LENGTH, "Save namespace");
    this.storage = storage;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_SAVE_BYTES) throw new RangeError(`Save byte limiti 1-${MAX_SAVE_BYTES} arasında olmalı.`);
    this._maxBytes = maxBytes;
    this.maxBytes = maxBytes;
  }

  assertBudget() {
    if (this.maxBytes !== this._maxBytes || !Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > MAX_SAVE_BYTES) throw new RangeError(`Save byte limiti 1-${MAX_SAVE_BYTES} arasında olmalı.`);
  }

  key(name) { return `${this.namespace}:${normalizeSegment(name, MAX_KEY_NAME_LENGTH, "Save key")}`; }

  set(name, value) {
    this.assertBudget();
    const encoded = JSON.stringify(value);
    if (encoded === undefined || textEncoder.encode(encoded).byteLength > this.maxBytes) throw new Error("Save verisi geçersiz veya çok büyük.");
    try { validateJSONBudget(encoded); } catch { throw new Error("Save verisi geçersiz veya çok büyük."); }
    this.storage.setItem(this.key(name), encoded);
  }

  get(name, fallback = null) {
    this.assertBudget();
    const encoded = this.storage.getItem(this.key(name));
    if (encoded === null) return fallback;
    if (textEncoder.encode(encoded).byteLength > this.maxBytes) return fallback;
    try { validateJSONBudget(encoded); return JSON.parse(encoded); } catch { return fallback; }
  }

  remove(name) { this.storage.removeItem(this.key(name)); }
}
