import { Node } from "./node.js";
import { Texture } from "../assets/texture.js";
import { worldValue } from "./math.js";

export class Sprite extends Node {
  constructor({ texture = Texture.white, width = 64, height = 64, anchorX = 0.5, anchorY = 0.5, tint = 0xffffff, alpha = 1, flipX = false, flipY = false, ...options } = {}) {
    super({ name: "sprite", ...options });
    this.isRenderable = true;
    const selectedTexture = texture || Texture.white;
    if (!(selectedTexture instanceof Texture)) throw new TypeError("Sprite texture bekleniyor.");
    this.texture = selectedTexture;
    const requestedWidth = Number(width); const requestedHeight = Number(height);
    const requestedAnchorX = Number(anchorX); const requestedAnchorY = Number(anchorY);
    this.width = Number.isFinite(requestedWidth) ? Math.max(0, worldValue(requestedWidth)) : 0;
    this.height = Number.isFinite(requestedHeight) ? Math.max(0, worldValue(requestedHeight)) : 0;
    this.anchor = { x: Number.isFinite(requestedAnchorX) ? worldValue(requestedAnchorX, 0.5) : 0.5, y: Number.isFinite(requestedAnchorY) ? worldValue(requestedAnchorY, 0.5) : 0.5 };
    this.tint = tint;
    this.flipX = Boolean(flipX);
    this.flipY = Boolean(flipY);
    const requestedAlpha = Number(alpha);
    this.alpha = Number.isFinite(requestedAlpha) ? Math.max(0, Math.min(1, requestedAlpha)) : 1;
    this.renderItems = [];
    this.renderGeometryTexture = null;
    this.renderGeometryU0 = NaN;
    this.renderGeometryV0 = NaN;
    this.renderGeometryU1 = NaN;
    this.renderGeometryV1 = NaN;
    this.renderGeometryWidth = NaN;
    this.renderGeometryHeight = NaN;
    this.renderGeometryAnchorX = NaN;
    this.renderGeometryAnchorY = NaN;
    this.renderGeometryFlipX = null;
    this.renderGeometryFlipY = null;
    this.localBounds = { x: 0, y: 0, width: 0, height: 0 };
    this.localBoundsWidth = NaN;
    this.localBoundsHeight = NaN;
    this.localBoundsAnchorX = NaN;
    this.localBoundsAnchorY = NaN;
  }

  setTexture(texture, { width = this.width, height = this.height } = {}) {
    if (!(texture instanceof Texture)) throw new TypeError("Texture bekleniyor.");
    this.texture = texture;
    const requestedWidth = Number(width); const requestedHeight = Number(height);
    this.width = Number.isFinite(requestedWidth) ? Math.max(0, worldValue(requestedWidth)) : 0;
    this.height = Number.isFinite(requestedHeight) ? Math.max(0, worldValue(requestedHeight)) : 0;
    return this;
  }

  setTint(tint) { this.tint = tint; return this; }

  setFlip(flipX, flipY = this.flipY) { this.flipX = Boolean(flipX); this.flipY = Boolean(flipY); return this; }

  getRenderItems() {
    const texture = this.texture;
    let cached = this.renderItems[0];
    const sameGeometry = cached
      && this.renderGeometryTexture === texture
      && this.renderGeometryU0 === texture.u0
      && this.renderGeometryV0 === texture.v0
      && this.renderGeometryU1 === texture.u1
      && this.renderGeometryV1 === texture.v1
      && this.renderGeometryWidth === this.width
      && this.renderGeometryHeight === this.height
      && this.renderGeometryAnchorX === this.anchor.x
      && this.renderGeometryAnchorY === this.anchor.y
      && this.renderGeometryFlipX === this.flipX
      && this.renderGeometryFlipY === this.flipY;
    if (!sameGeometry) {
      const bounds = this.getLocalBounds();
      const right = worldValue(bounds.x + bounds.width);
      const bottom = worldValue(bounds.y + bounds.height);
      const u0 = this.flipX ? texture.u1 : texture.u0;
      const u1 = this.flipX ? texture.u0 : texture.u1;
      const v0 = this.flipY ? texture.v1 : texture.v0;
      const v1 = this.flipY ? texture.v0 : texture.v1;
      if (!cached) {
        cached = { texture, tint: this.tint, alpha: 1, bounds, positions: new Array(12), uvs: new Array(12) };
        this.renderItems[0] = cached;
      }
      const positions = cached.positions;
      positions[0] = bounds.x; positions[1] = bounds.y;
      positions[2] = right; positions[3] = bounds.y;
      positions[4] = right; positions[5] = bottom;
      positions[6] = bounds.x; positions[7] = bounds.y;
      positions[8] = right; positions[9] = bottom;
      positions[10] = bounds.x; positions[11] = bottom;
      const uvs = cached.uvs;
      uvs[0] = u0; uvs[1] = v0;
      uvs[2] = u1; uvs[3] = v0;
      uvs[4] = u1; uvs[5] = v1;
      uvs[6] = u0; uvs[7] = v0;
      uvs[8] = u1; uvs[9] = v1;
      uvs[10] = u0; uvs[11] = v1;
      cached.texture = texture;
      cached.tint = this.tint;
      cached.alpha = 1;
      cached.bounds = bounds;
      this.renderItems.length = 1;
      this.renderGeometryTexture = texture;
      this.renderGeometryU0 = texture.u0;
      this.renderGeometryV0 = texture.v0;
      this.renderGeometryU1 = texture.u1;
      this.renderGeometryV1 = texture.v1;
      this.renderGeometryWidth = this.width;
      this.renderGeometryHeight = this.height;
      this.renderGeometryAnchorX = this.anchor.x;
      this.renderGeometryAnchorY = this.anchor.y;
      this.renderGeometryFlipX = this.flipX;
      this.renderGeometryFlipY = this.flipY;
    } else {
      cached.texture = texture;
      cached.bounds = this.getLocalBounds();
    }
    cached.tint = this.tint;
    cached.alpha = 1;
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

  destroy() {
    this.renderItems.length = 0;
    this.renderGeometryTexture = null;
    super.destroy();
  }
}
