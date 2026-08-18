import { Sprite } from "./sprite.js";
import { worldValue } from "./math.js";

const finiteBorder = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, worldValue(number)) : 0;
};

const finiteSize = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, worldValue(number)) : fallback;
};

function fitTextureBorders(first, second, textureSize, targetSize, output, offset) {
  let safeFirst = Math.min(first, textureSize);
  let safeSecond = Math.min(second, textureSize);
  let total = safeFirst + safeSecond;
  if (total > textureSize && total > 0) {
    const scale = textureSize / total;
    safeFirst = worldValue(safeFirst * scale);
    safeSecond = worldValue(safeSecond * scale);
  }
  total = safeFirst + safeSecond;
  if (total > targetSize && total > 0) {
    const scale = targetSize / total;
    safeFirst = worldValue(safeFirst * scale);
    safeSecond = worldValue(safeSecond * scale);
  }
  output[offset] = safeFirst;
  output[offset + 1] = safeSecond;
}

function writeQuad(item, left, top, right, bottom, u0, v0, u1, v1) {
  item.bounds.x = left; item.bounds.y = top; item.bounds.width = Math.max(0, right - left); item.bounds.height = Math.max(0, bottom - top);
  item.positions[0] = left; item.positions[1] = top;
  item.positions[2] = right; item.positions[3] = top;
  item.positions[4] = right; item.positions[5] = bottom;
  item.positions[6] = left; item.positions[7] = top;
  item.positions[8] = right; item.positions[9] = bottom;
  item.positions[10] = left; item.positions[11] = bottom;
  item.uvs[0] = u0; item.uvs[1] = v0;
  item.uvs[2] = u1; item.uvs[3] = v0;
  item.uvs[4] = u1; item.uvs[5] = v1;
  item.uvs[6] = u0; item.uvs[7] = v0;
  item.uvs[8] = u1; item.uvs[9] = v1;
  item.uvs[10] = u0; item.uvs[11] = v1;
}

export class NineSliceSprite extends Sprite {
  constructor({ left = 8, right = 8, top = 8, bottom = 8, ...options } = {}) {
    super({ name: "nine-slice-sprite", ...options });
    this.left = finiteBorder(left);
    this.right = finiteBorder(right);
    this.top = finiteBorder(top);
    this.bottom = finiteBorder(bottom);
    this.renderGeometryLeft = NaN;
    this.renderGeometryRight = NaN;
    this.renderGeometryTop = NaN;
    this.renderGeometryBottom = NaN;
    this.sliceX = new Float64Array(4);
    this.sliceY = new Float64Array(4);
    this.sliceU = new Float64Array(4);
    this.sliceV = new Float64Array(4);
    this.sliceBorders = new Float64Array(4);
  }

  setBorders({ left = this.left, right = this.right, top = this.top, bottom = this.bottom } = {}) {
    this.left = finiteBorder(left);
    this.right = finiteBorder(right);
    this.top = finiteBorder(top);
    this.bottom = finiteBorder(bottom);
    return this;
  }

  setSize(width, height = this.height) {
    this.width = finiteSize(width, this.width);
    this.height = finiteSize(height, this.height);
    return this;
  }

  getRenderItems() {
    const texture = this.texture;
    const sameGeometry = this.renderItems.length === 9
      && this.renderGeometryTexture === texture
      && this.renderGeometryWidth === this.width && this.renderGeometryHeight === this.height
      && this.renderGeometryAnchorX === this.anchor.x && this.renderGeometryAnchorY === this.anchor.y
      && this.renderGeometryFlipX === this.flipX && this.renderGeometryFlipY === this.flipY
      && this.renderGeometryLeft === this.left && this.renderGeometryRight === this.right
      && this.renderGeometryTop === this.top && this.renderGeometryBottom === this.bottom;
    if (!sameGeometry) {
      const textureWidth = Math.max(1, Number(texture.u0) === 0 && Number(texture.u1) === 1 ? Number(texture.sourceWidth) || Number(texture.width) || 1 : Number(texture.width) || 1);
      const textureHeight = Math.max(1, Number(texture.v0) === 0 && Number(texture.v1) === 1 ? Number(texture.sourceHeight) || Number(texture.height) || 1 : Number(texture.height) || 1);
      const borders = this.sliceBorders;
      fitTextureBorders(this.left, this.right, textureWidth, this.width, borders, 0);
      fitTextureBorders(this.top, this.bottom, textureHeight, this.height, borders, 2);
      const safeLeftBorder = borders[0]; const safeRightBorder = borders[1];
      const safeTopBorder = borders[2]; const safeBottomBorder = borders[3];
      const left = -worldValue(this.width * this.anchor.x);
      const top = -worldValue(this.height * this.anchor.y);
      const x = this.sliceX;
      const y = this.sliceY;
      x[0] = left; x[1] = worldValue(left + safeLeftBorder); x[2] = worldValue(left + this.width - safeRightBorder); x[3] = worldValue(left + this.width);
      y[0] = top; y[1] = worldValue(top + safeTopBorder); y[2] = worldValue(top + this.height - safeBottomBorder); y[3] = worldValue(top + this.height);
      const uSpan = texture.u1 - texture.u0;
      const vSpan = texture.v1 - texture.v0;
      const u = this.sliceU;
      const v = this.sliceV;
      u[0] = texture.u0; u[1] = texture.u0 + (safeLeftBorder / textureWidth) * uSpan; u[2] = texture.u1 - (safeRightBorder / textureWidth) * uSpan; u[3] = texture.u1;
      v[0] = texture.v0; v[1] = texture.v0 + (safeTopBorder / textureHeight) * vSpan; v[2] = texture.v1 - (safeBottomBorder / textureHeight) * vSpan; v[3] = texture.v1;
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const index = row * 3 + column;
          const item = this.renderItems[index] || { texture, tint: this.tint, alpha: 1, bounds: { x: 0, y: 0, width: 0, height: 0 }, positions: new Array(12), uvs: new Array(12) };
          item.texture = texture;
          const uStart = this.flipX ? u[3 - column] : u[column];
          const uEnd = this.flipX ? u[2 - column] : u[column + 1];
          const vStart = this.flipY ? v[3 - row] : v[row];
          const vEnd = this.flipY ? v[2 - row] : v[row + 1];
          writeQuad(item, x[column], y[row], x[column + 1], y[row + 1], uStart, vStart, uEnd, vEnd);
          this.renderItems[index] = item;
        }
      }
      this.renderItems.length = 9;
      this.renderGeometryTexture = texture;
      this.renderGeometryWidth = this.width; this.renderGeometryHeight = this.height;
      this.renderGeometryAnchorX = this.anchor.x; this.renderGeometryAnchorY = this.anchor.y;
      this.renderGeometryFlipX = this.flipX; this.renderGeometryFlipY = this.flipY;
      this.renderGeometryLeft = this.left; this.renderGeometryRight = this.right;
      this.renderGeometryTop = this.top; this.renderGeometryBottom = this.bottom;
    }
    for (const item of this.renderItems) { item.texture = texture; item.tint = this.tint; item.alpha = 1; }
    return this.renderItems;
  }

  getLocalBounds() {
    if (this.width !== this.localBoundsWidth || this.height !== this.localBoundsHeight || this.anchor.x !== this.localBoundsAnchorX || this.anchor.y !== this.localBoundsAnchorY) {
      this.localBounds.x = -worldValue(this.width * this.anchor.x);
      this.localBounds.y = -worldValue(this.height * this.anchor.y);
      this.localBounds.width = this.width;
      this.localBounds.height = this.height;
      this.localBoundsWidth = this.width;
      this.localBoundsHeight = this.height;
      this.localBoundsAnchorX = this.anchor.x;
      this.localBoundsAnchorY = this.anchor.y;
    }
    return this.localBounds;
  }
}
