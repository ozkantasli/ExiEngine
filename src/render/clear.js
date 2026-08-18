export const DEFAULT_CLEAR_COLOR = 0x060912;

export function normalizeClearColor(value, fallback = DEFAULT_CLEAR_COLOR) {
  let raw = value;
  if (raw === undefined || raw === null) raw = fallback;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      raw = Number.parseInt(text.slice(1), 16);
      raw = ((raw >> 8 & 0xf) * 0x11 << 16) | ((raw >> 4 & 0xf) * 0x11 << 8) | ((raw & 0xf) * 0x11);
    } else if (/^#[0-9a-f]{6}$/i.test(text)) raw = Number.parseInt(text.slice(1), 16);
    else raw = Number(text);
  }
  raw = Number(raw);
  if (!Number.isFinite(raw)) raw = Number(fallback);
  if (!Number.isFinite(raw)) raw = DEFAULT_CLEAR_COLOR;
  return Math.max(0, Math.min(0xffffff, Math.trunc(raw))) >>> 0;
}

export function normalizeClearAlpha(value, fallback = 1) {
  const raw = Number(value);
  const safe = Number.isFinite(raw) ? raw : Number(fallback);
  return Math.max(0, Math.min(1, Number.isFinite(safe) ? safe : 1));
}

export function clearColorChannels(color, alpha, output = { r: 0, g: 0, b: 0, a: 1 }) {
  const value = normalizeClearColor(color);
  output.r = ((value >> 16) & 255) / 255;
  output.g = ((value >> 8) & 255) / 255;
  output.b = (value & 255) / 255;
  output.a = normalizeClearAlpha(alpha);
  return output;
}
