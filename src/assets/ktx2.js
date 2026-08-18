const KTX2_IDENTIFIER = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];
const KTX2_HEADER_BYTES = 80;
const KTX2_LEVEL_INDEX_BYTES = 24;
const MAX_KTX2_LEVELS = 16;
const MAX_KTX2_DIMENSION = 16_384;
const MAX_KTX2_PIXELS = 16 * 1024 * 1024;
export const VK_FORMAT_R8G8B8A8_UNORM = 37;

function safeLimit(value, fallback, maximum, label) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0 || result > maximum) throw new RangeError(`${label} limiti geçersiz.`);
  return result;
}

function readU64(view, offset, label) {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  if (high > 0x001fffff) throw new RangeError(`KTX2 ${label} güvenli sayı sınırını aşıyor.`);
  return high * 0x100000000 + low;
}

function rangeWithin(offset, length, total, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > total || length > total - offset) throw new RangeError(`KTX2 ${label} aralığı geçersiz.`);
}

function maxMipLevels(width, height) {
  let levels = 1;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    levels += 1;
  }
  return levels;
}

export function inspectKTX2(bytes, { maxImageSize = MAX_KTX2_DIMENSION, maxTexturePixels = MAX_KTX2_PIXELS } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("KTX2 bytes Uint8Array olmalı.");
  const imageLimit = safeLimit(maxImageSize, MAX_KTX2_DIMENSION, MAX_KTX2_DIMENSION, "KTX2 image");
  const pixelLimit = safeLimit(maxTexturePixels, MAX_KTX2_PIXELS, MAX_KTX2_PIXELS, "KTX2 pixel");
  if (bytes.byteLength < KTX2_HEADER_BYTES) throw new RangeError("KTX2 header eksik.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < KTX2_IDENTIFIER.length; index += 1) if (view.getUint8(index) !== KTX2_IDENTIFIER[index]) throw new TypeError("KTX2 imzası geçersiz.");
  const vkFormat = view.getUint32(12, true);
  const typeSize = view.getUint32(16, true);
  const width = view.getUint32(20, true);
  const height = view.getUint32(24, true);
  const pixelDepth = view.getUint32(28, true);
  const layerCount = view.getUint32(32, true);
  const faceCount = view.getUint32(36, true);
  const levelCount = view.getUint32(40, true);
  const supercompressionScheme = view.getUint32(44, true);
  if (!width || !height || width > imageLimit || height > imageLimit) throw new RangeError("KTX2 image boyutu limiti aşıldı.");
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > pixelLimit) throw new RangeError("KTX2 pixel limiti aşıldı.");
  if (pixelDepth !== 0 || layerCount !== 0 || faceCount !== 1) throw new RangeError("KTX2 yalnızca 2D tek yüz texture destekler.");
  if (!Number.isSafeInteger(levelCount) || levelCount < 1 || levelCount > MAX_KTX2_LEVELS || levelCount > maxMipLevels(width, height)) throw new RangeError("KTX2 mip level limiti geçersiz.");
  const levelIndexEnd = KTX2_HEADER_BYTES + levelCount * KTX2_LEVEL_INDEX_BYTES;
  if (levelIndexEnd > bytes.byteLength) throw new RangeError("KTX2 level index eksik.");
  const dfdByteOffset = view.getUint32(48, true);
  const dfdByteLength = view.getUint32(52, true);
  const kvdByteOffset = view.getUint32(56, true);
  const kvdByteLength = view.getUint32(60, true);
  const sgdByteOffset = readU64(view, 64, "SGD offset");
  const sgdByteLength = readU64(view, 72, "SGD length");
  rangeWithin(dfdByteOffset, dfdByteLength, bytes.byteLength, "DFD");
  rangeWithin(kvdByteOffset, kvdByteLength, bytes.byteLength, "KVD");
  rangeWithin(sgdByteOffset, sgdByteLength, bytes.byteLength, "SGD");
  const levels = new Array(levelCount);
  const maxLevelBytes = pixelLimit * 16;
  for (let index = 0; index < levelCount; index += 1) {
    const offset = KTX2_HEADER_BYTES + index * KTX2_LEVEL_INDEX_BYTES;
    const byteOffset = readU64(view, offset, `level ${index} offset`);
    const byteLength = readU64(view, offset + 8, `level ${index} length`);
    const uncompressedByteLength = readU64(view, offset + 16, `level ${index} uncompressed length`);
    if (byteOffset < levelIndexEnd || byteLength <= 0) throw new RangeError(`KTX2 level ${index} aralığı geçersiz.`);
    rangeWithin(byteOffset, byteLength, bytes.byteLength, `level ${index}`);
    if (uncompressedByteLength <= 0 || uncompressedByteLength > maxLevelBytes) throw new RangeError(`KTX2 level ${index} uncompressed length limiti aşıldı.`);
    levels[index] = { byteOffset, byteLength, uncompressedByteLength };
  }
  const rgba8 = vkFormat === VK_FORMAT_R8G8B8A8_UNORM && typeSize === 1 && supercompressionScheme === 0;
  const baseByteLength = width * height * 4;
  if (rgba8 && (levels[0].byteLength !== baseByteLength || levels[0].uncompressedByteLength !== baseByteLength)) throw new RangeError("KTX2 RGBA8 base level boyutu geçersiz.");
  return { width, height, pixelDepth, layerCount, faceCount, levelCount, vkFormat, typeSize, supercompressionScheme, rgba8, levels };
}
