import { Camera } from "./camera.js";
import { Node, Scene, normalizeFilterAmount, normalizeFilterType } from "./node.js";
import { Sprite } from "./sprite.js";
import { RenderTexture } from "../assets/render-texture.js";

const MAX_POST_PROCESS_EFFECTS = 4;
const MAX_POST_PROCESS_PIXELS = 16 * 1024 * 1024;

function normalizeEffect(effect) {
  if (!effect || typeof effect !== "object") throw new TypeError("RenderGroup effect nesnesi gerekli.");
  const filter = normalizeFilterType(effect.filter ?? effect.type);
  if (filter === "none") throw new TypeError("RenderGroup effect filtresi allowlist içinde olmalı.");
  return Object.freeze({ filter, amount: normalizeFilterAmount(effect.amount ?? effect.filterAmount) });
}

function validateEffectBudget(width, height, effectCount) {
  const scratchCount = effectCount > 1 ? 2 : effectCount;
  if (width * height * scratchCount > MAX_POST_PROCESS_PIXELS) throw new RangeError("RenderGroup post-process pixel bütçesi aşıldı.");
}

function normalizeEffects(effects, width, height) {
  if (effects === null || effects === undefined) return Object.freeze([]);
  if (!Array.isArray(effects)) throw new TypeError("RenderGroup effects bir dizi olmalı.");
  if (effects.length > MAX_POST_PROCESS_EFFECTS) throw new RangeError(`RenderGroup en fazla ${MAX_POST_PROCESS_EFFECTS} effect destekler.`);
  validateEffectBudget(width, height, effects.length);
  return Object.freeze(effects.map(normalizeEffect));
}

export class RenderGroup extends Node {
  constructor({ width = 256, height = 256, target = null, camera = null, effects = [], ...options } = {}) {
    super({ name: "render-group", ...options });
    if (target !== null && !(target instanceof RenderTexture)) throw new TypeError("RenderGroup target RenderTexture olmalı.");
    this.target = target || new RenderTexture({ width, height });
    this.ownsTarget = target === null;
    this.width = this.target.width;
    this.height = this.target.height;
    if (camera !== null && !(camera instanceof Camera)) throw new TypeError("RenderGroup camera Camera olmalı.");
    this.camera = camera || new Camera({ x: this.width * 0.5, y: this.height * 0.5, width: this.width, height: this.height });
    this.ownsCamera = camera === null;
    this.camera.setViewport(this.width, this.height);
    this.isRenderable = true;
    this.isRenderGroup = true;
    this.renderItems = [];
    this.effects = normalizeEffects(effects, this.width, this.height);
    this.effectTargets = [];
    this.effectTargetCount = -1;
    this.effectTargetWidth = 0;
    this.effectTargetHeight = 0;
    this.effectTargetFilter = "";
    this.effectScene = null;
    this.effectCamera = null;
    this.effectSprite = null;
    this.postProcessState = null;
    this.localBounds = { x: -this.width * 0.5, y: -this.height * 0.5, width: this.width, height: this.height };
    this.geometryWidth = this.width;
    this.geometryHeight = this.height;
  }

  resize(width, height) {
    validateEffectBudget(width, height, this.effects.length);
    this.target.resize(width, height);
    this.width = this.target.width;
    this.height = this.target.height;
    this.localBounds.x = -this.width * 0.5;
    this.localBounds.y = -this.height * 0.5;
    this.localBounds.width = this.width;
    this.localBounds.height = this.height;
    if (this.ownsCamera) this.camera.position.set(this.width * 0.5, this.height * 0.5);
    this.camera.setViewport(this.width, this.height);
    this.syncEffectTargets();
    return this;
  }

  setEffects(effects = []) {
    this.effects = normalizeEffects(effects, this.target.width, this.target.height);
    this.syncEffectTargets();
    return this;
  }

  clearEffects() { return this.setEffects([]); }

  getEffects() { return this.effects; }

  syncEffectTargets() {
    const targetCount = this.effects.length > 1 ? 2 : this.effects.length;
    const targetWidth = this.target.width;
    const targetHeight = this.target.height;
    const targetFilter = this.target.filter;
    if (this.effectTargetCount === targetCount && this.effectTargetWidth === targetWidth && this.effectTargetHeight === targetHeight && this.effectTargetFilter === targetFilter && (targetCount > 0 || this.effectScene === null)) return this.effectTargets;
    validateEffectBudget(this.target.width, this.target.height, this.effects.length);
    while (this.effectTargets.length < targetCount) this.effectTargets.push(new RenderTexture({ width: targetWidth, height: targetHeight, filter: targetFilter }));
    while (this.effectTargets.length > targetCount) this.effectTargets.pop().destroy();
    for (const effectTarget of this.effectTargets) {
      if (effectTarget.width !== targetWidth || effectTarget.height !== targetHeight) effectTarget.resize(targetWidth, targetHeight);
      effectTarget.setFilter(targetFilter);
    }
    if (targetCount === 0) {
      this.effectScene?.destroy();
      this.effectScene = null;
      this.effectCamera = null;
      this.effectSprite = null;
      this.postProcessState = null;
    }
    this.effectTargetCount = targetCount;
    this.effectTargetWidth = targetWidth;
    this.effectTargetHeight = targetHeight;
    this.effectTargetFilter = targetFilter;
    return this.effectTargets;
  }

  getPostProcessState() {
    if (this.effects.length === 0) return null;
    this.getLocalBounds();
    this.syncEffectTargets();
    if (!this.effectScene) {
      this.effectScene = new Scene();
      this.effectCamera = new Camera({ x: this.width * 0.5, y: this.height * 0.5, width: this.width, height: this.height });
      this.effectSprite = new Sprite({ width: this.width, height: this.height, x: this.width * 0.5, y: this.height * 0.5, cullable: false });
      this.effectScene.add(this.effectSprite);
      this.postProcessState = { scene: this.effectScene, camera: this.effectCamera, sprite: this.effectSprite, effects: this.effects, targets: this.effectTargets };
    }
    this.effectCamera.position.set(this.width * 0.5, this.height * 0.5);
    this.effectCamera.setViewport(this.width, this.height);
    this.effectSprite.position.set(this.width * 0.5, this.height * 0.5);
    this.effectSprite.width = this.width;
    this.effectSprite.height = this.height;
    this.postProcessState.effects = this.effects;
    this.postProcessState.targets = this.effectTargets;
    return this.postProcessState;
  }

  getRenderCamera() {
    this.getLocalBounds();
    if (this.ownsCamera) this.camera.position.set(this.width * 0.5, this.height * 0.5);
    this.camera.setViewport(this.target.width, this.target.height);
    return this.camera;
  }

  updateOffscreenWorldMatrix() {
    this.worldMatrix.identity();
    this._worldVersion += 1;
    this._lastParentWorldVersion = -1;
    this._lastParentMatrix = null;
    this.worldZ = 0;
    this.worldAlpha = 1;
    this.worldFilter = "none";
    this.worldFilterAmount = 1;
    this.worldMaskTexture = null;
    this.worldMaskRect = null;
    for (const child of this.children) child.updateWorldMatrix(this.worldMatrix, 0, this._worldVersion, 1, "none", 1, null, null);
  }

  getLocalBounds() {
    if (this.geometryWidth !== this.target.width || this.geometryHeight !== this.target.height) {
      this.width = this.target.width;
      this.height = this.target.height;
      this.geometryWidth = this.width;
      this.geometryHeight = this.height;
      this.localBounds.x = -this.width * 0.5;
      this.localBounds.y = -this.height * 0.5;
      this.localBounds.width = this.width;
      this.localBounds.height = this.height;
    }
    return this.localBounds;
  }

  getRenderItems() {
    const bounds = this.getLocalBounds();
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const item = this.renderItems[0] || { texture: this.target, tint: 0xffffff, alpha: 1, bounds, positions: new Array(12), uvs: new Array(12) };
    item.texture = this.target;
    item.tint = 0xffffff;
    item.alpha = 1;
    item.bounds = bounds;
    item.positions[0] = bounds.x; item.positions[1] = bounds.y;
    item.positions[2] = right; item.positions[3] = bounds.y;
    item.positions[4] = right; item.positions[5] = bottom;
    item.positions[6] = bounds.x; item.positions[7] = bounds.y;
    item.positions[8] = right; item.positions[9] = bottom;
    item.positions[10] = bounds.x; item.positions[11] = bottom;
    item.uvs[0] = this.target.u0; item.uvs[1] = this.target.v0;
    item.uvs[2] = this.target.u1; item.uvs[3] = this.target.v0;
    item.uvs[4] = this.target.u1; item.uvs[5] = this.target.v1;
    item.uvs[6] = this.target.u0; item.uvs[7] = this.target.v0;
    item.uvs[8] = this.target.u1; item.uvs[9] = this.target.v1;
    item.uvs[10] = this.target.u0; item.uvs[11] = this.target.v1;
    this.renderItems[0] = item;
    this.renderItems.length = 1;
    return this.renderItems;
  }

  destroy() {
    this.renderItems.length = 0;
    for (const effectTarget of this.effectTargets) effectTarget.destroy();
    this.effectTargets.length = 0;
    this.effectScene?.destroy();
    this.effectScene = null;
    this.effectCamera = null;
    this.effectSprite = null;
    this.postProcessState = null;
    if (this.ownsTarget) this.target.destroy();
    super.destroy();
  }
}
