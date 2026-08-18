import { Node } from "./node.js";
import { Texture } from "../assets/texture.js";
import { worldValue } from "./math.js";
import { GPU_SOURCE_FLOATS, INSTANCE_FLOATS } from "../render/instanced.js";
import { updateStaticRenderKey } from "../render/batch.js";

const MAX_SPATIAL_CELLS = 4_096;
const MAX_SPRITES = 100_000;
const MAX_ANIMATION_FRAMES = 4_096;
const MAX_ANIMATION_RATE = 240;
const MAX_ANIMATION_DELTA = 5;
const MAX_ANIMATION_STEPS = 4_096;

function normalizeAnimation(options) {
  if (options === null || options === undefined) return null;
  if (!options || typeof options !== "object" || !Array.isArray(options.frames) || options.frames.length === 0 || options.frames.length > MAX_ANIMATION_FRAMES || options.frames.some((frame) => !(frame instanceof Texture))) {
    throw new TypeError("SpriteBatch animation frames Texture dizisi geçersiz veya limit dışı.");
  }
  const requestedRate = Number(options.frameRate ?? 12);
  const requestedFrame = Number(options.currentFrame ?? 0);
  return {
    frames: options.frames.slice(),
    frameRate: Number.isFinite(requestedRate) ? Math.min(MAX_ANIMATION_RATE, Math.max(0, requestedRate)) : 0,
    loop: options.loop !== false,
    pingPong: Boolean(options.pingPong),
    playing: options.playing !== false,
    onComplete: options.onComplete == null ? null : options.onComplete,
    onLoop: options.onLoop == null ? null : options.onLoop,
    onFrameChange: options.onFrameChange == null ? null : options.onFrameChange,
    currentFrame: Number.isSafeInteger(requestedFrame) ? Math.max(0, Math.min(options.frames.length - 1, requestedFrame)) : 0,
    direction: 1,
    elapsed: 0,
  };
}

function normalizeSprite(options = {}, fallbackTexture = null) {
  const number = (value, fallback) => Number.isFinite(Number(value)) ? worldValue(value, fallback) : fallback;
  const animation = normalizeAnimation(options.animation);
  return {
    x: number(options.x, 0),
    y: number(options.y, 0),
    width: Math.max(0, number(options.width, 64)),
    height: Math.max(0, number(options.height, 64)),
    anchorX: number(options.anchorX, 0.5),
    anchorY: number(options.anchorY, 0.5),
    rotation: number(options.rotation, 0),
    flipX: Boolean(options.flipX),
    flipY: Boolean(options.flipY),
    tint: options.tint ?? 0xffffff,
    alpha: Math.max(0, Math.min(1, number(options.alpha, 1))),
    texture: options.texture || animation?.frames[0] || fallbackTexture,
    animation,
  };
}

function updateSprite(target, options, fallbackTexture, animation = target.animation) {
  const number = (value, fallback) => Number.isFinite(Number(value)) ? worldValue(value, fallback) : fallback;
  target.x = number(options.x, target.x);
  target.y = number(options.y, target.y);
  target.width = Math.max(0, number(options.width, target.width));
  target.height = Math.max(0, number(options.height, target.height));
  target.anchorX = number(options.anchorX, target.anchorX);
  target.anchorY = number(options.anchorY, target.anchorY);
  target.rotation = number(options.rotation, target.rotation);
  if (options.flipX !== undefined) target.flipX = Boolean(options.flipX);
  if (options.flipY !== undefined) target.flipY = Boolean(options.flipY);
  target.tint = options.tint ?? target.tint;
  target.alpha = Math.max(0, Math.min(1, number(options.alpha, target.alpha)));
  target.texture = options.texture === undefined ? (animation?.frames[animation.currentFrame] || target.texture) : (options.texture || fallbackTexture);
  target.animation = animation;
  return target;
}

function writeColor(data, offset, color) {
  if (typeof color === "string") color = Number.parseInt(color.replace(/^#/, ""), 16);
  const value = Number.isFinite(color) ? color >>> 0 : 0xffffff;
  data[offset] = (value >> 16 & 255) / 255;
  data[offset + 1] = (value >> 8 & 255) / 255;
  data[offset + 2] = (value & 255) / 255;
}

function writeInstancePoint(matrix, camera, worldPoint, screenPoint, x, y, data, offset) {
  matrix.transformPoint(x, y, worldPoint);
  camera.worldToScreen(worldPoint.x, worldPoint.y, screenPoint);
  data[offset] = screenPoint.x;
  data[offset + 1] = screenPoint.y;
}

function pushVertex(positions, uvs, colors, x, y, u, v, red, green, blue, alpha) {
  positions.push(x, y);
  uvs.push(u, v);
  colors.push(red, green, blue, alpha);
}

function includeBoundsPoint(bounds, x, y) {
  bounds.x = Math.min(bounds.x, x);
  bounds.y = Math.min(bounds.y, y);
  bounds.width = Math.max(bounds.width, x);
  bounds.height = Math.max(bounds.height, y);
}

export class SpriteBatch extends Node {
  constructor({ texture = Texture.white, chunkSize = 256, spatialCulling = false, cellSize = 256, instanced = false, gpuCulling = false, ...options } = {}) {
    super({ name: "sprite-batch", ...options });
    if (!(texture instanceof Texture)) throw new TypeError("SpriteBatch texture bekleniyor.");
    this.texture = texture;
    this.isBatch = true;
    this.chunkSize = Math.max(1, Math.min(4096, Number(chunkSize) | 0 || 256));
    this.spatialCulling = Boolean(spatialCulling);
    this.cellSize = Math.max(16, Math.min(4096, Number(cellSize) | 0 || 256));
    this.instanced = Boolean(instanced);
    this.gpuCulling = Boolean(gpuCulling) && this.instanced;
    this.isInstancedBatch = this.instanced;
    this.sprites = [];
    this.renderItems = [];
    this.chunkItems = [];
    this.instanceChunkItems = [];
    this.instanceItems = [];
    this.instanceMergedItem = null;
    this.chunkBounds = [];
    this.renderItemsKey = null;
    this.staticKeyState = { version: 0, contentVersion: -1 };
    this.instanceItemsKey = null;
    this.instanceCacheContentVersion = -1;
    this.instanceCacheUseGpuCulling = false;
    this.instanceCacheNeedsCamera = false;
    this.instanceCacheWidth = 0;
    this.instanceCacheHeight = 0;
    this.instanceCacheCameraX = 0;
    this.instanceCacheCameraY = 0;
    this.instanceCacheZoom = 1;
    this.instanceCachePixelRatio = 1;
    this.instanceCacheRotation = 0;
    this.instanceCacheCameraWidth = 0;
    this.instanceCacheCameraHeight = 0;
    this.instanceCacheAlpha = 1;
    this.instanceCacheA = 1;
    this.instanceCacheB = 0;
    this.instanceCacheC = 0;
    this.instanceCacheD = 1;
    this.instanceCacheTx = 0;
    this.instanceCacheTy = 0;
    this.lastCulledCount = 0;
    this.spatialIndex = new Map();
    this.spatialLargeIndices = [];
    this.spatialSpriteBounds = [];
    this.visibleChunkBounds = [];
    this.spatialIndexVersion = -1;
    this.visibleStamp = new Uint32Array(0);
    this.visibleIndices = [];
    this.visibleToken = 0;
    this.cullingCorners = new Float64Array(8);
    this.cullingLocal = { x: 0, y: 0 };
    this.cullingScreen = { x: 0, y: 0 };
    this.spatialCellRange = new Float64Array(4);
    this.itemsDirty = true;
    this.contentVersion = 0;
    this.boundsCache = { version: -1, value: null };
    this.instanceWorldPoint = { x: 0, y: 0 };
    this.instanceScreenPoint = { x: 0, y: 0 };
    this.isRenderable = true;
  }

  get count() { return this.sprites.length; }

  invalidate({ preserveInstanceBuffer = false } = {}) { this.itemsDirty = true; this.contentVersion += 1; if (!preserveInstanceBuffer) this.instanceChunkItems.length = 0; this.spatialIndex.clear(); this.spatialLargeIndices.length = 0; this.spatialSpriteBounds.length = 0; this.visibleChunkBounds.length = 0; this.spatialIndexVersion = -1; this.visibleIndices.length = 0; this.renderItemsKey = null; this.instanceItemsKey = null; }

  markDirty() { this.invalidate({ preserveInstanceBuffer: true }); return this; }

  validateSpriteTexture(texture) {
    if (!(texture instanceof Texture)) throw new TypeError("SpriteBatch sprite texture bekleniyor.");
    const batchBase = this.texture.baseTexture || this.texture;
    const spriteBase = texture.baseTexture || texture;
    if (batchBase !== spriteBase) throw new Error("SpriteBatch sprite texture aynÄ± atlas/base texture kullanmalÄ±.");
  }

  validateSpriteAnimation(animation) {
    if (!animation) return;
    if (typeof animation.onComplete !== "function" && animation.onComplete !== null) throw new TypeError("SpriteBatch animation onComplete fonksiyonu gerekli.");
    if (typeof animation.onLoop !== "function" && animation.onLoop !== null) throw new TypeError("SpriteBatch animation onLoop fonksiyonu gerekli.");
    if (typeof animation.onFrameChange !== "function" && animation.onFrameChange !== null) throw new TypeError("SpriteBatch animation onFrameChange fonksiyonu gerekli.");
    const batchBase = this.texture.baseTexture || this.texture;
    for (const frame of animation.frames) {
      if (!(frame instanceof Texture)) throw new TypeError("SpriteBatch animation frame Texture bekleniyor.");
      const frameBase = frame.baseTexture || frame;
      if (batchBase !== frameBase) throw new Error("SpriteBatch animation frame'leri aynı atlas/base texture kullanmalı.");
    }
  }

  addSprite(options = {}) {
    if (this.sprites.length >= MAX_SPRITES) throw new RangeError(`SpriteBatch sprite limiti ${MAX_SPRITES}.`);
    const sprite = normalizeSprite(options, this.texture);
    this.validateSpriteTexture(sprite.texture);
    this.validateSpriteAnimation(sprite.animation);
    this.sprites.push(sprite);
    this.invalidate();
    return this.sprites.length - 1;
  }

  addSprites(options = []) {
    if (!Array.isArray(options)) throw new TypeError("SpriteBatch toplu sprite listesi array olmalı.");
    if (options.length > MAX_SPRITES - this.sprites.length) throw new RangeError(`SpriteBatch sprite limiti ${MAX_SPRITES}.`);
    if (options.length === 0) return this;
    const pending = new Array(options.length);
    for (let index = 0; index < options.length; index += 1) {
      const sprite = normalizeSprite(options[index], this.texture);
      this.validateSpriteTexture(sprite.texture);
      this.validateSpriteAnimation(sprite.animation);
      pending[index] = sprite;
    }
    for (const sprite of pending) this.sprites.push(sprite);
    this.invalidate();
    return this;
  }

  setSprite(index, options = {}) {
    const sprite = this.sprites[index];
    if (!sprite) return false;
    const updates = options && typeof options === "object" ? options : {};
    const texture = updates.texture === undefined ? sprite.texture : (updates.texture || this.texture);
    this.validateSpriteTexture(texture);
    const animation = Object.prototype.hasOwnProperty.call(updates, "animation") ? normalizeAnimation(updates.animation) : sprite.animation;
    this.validateSpriteAnimation(animation);
    updateSprite(sprite, updates, this.texture, animation);
    this.markDirty();
    return true;
  }

  addAnimatedSprite({ frames, frameRate = 12, loop = true, pingPong = false, playing = true, currentFrame = 0, onComplete = null, onLoop = null, onFrameChange = null, ...options } = {}) {
    return this.addSprite({ ...options, animation: { frames, frameRate, loop, pingPong, playing, currentFrame, onComplete, onLoop, onFrameChange } });
  }

  setSpriteAnimation(index, options = null) {
    const sprite = this.sprites[index];
    if (!sprite) return false;
    const animation = normalizeAnimation(options);
    this.validateSpriteAnimation(animation);
    sprite.animation = animation;
    if (animation) sprite.texture = animation.frames[animation.currentFrame];
    this.markDirty();
    return true;
  }

  playSprite(index) {
    const animation = this.sprites[index]?.animation;
    if (!animation) return false;
    animation.playing = true;
    return true;
  }

  stopSprite(index) {
    const animation = this.sprites[index]?.animation;
    if (!animation) return false;
    animation.playing = false;
    return true;
  }

  gotoSpriteFrame(index, frame) {
    const animation = this.sprites[index]?.animation;
    if (!animation) return false;
    const requestedFrame = Number(frame);
    const nextFrame = Number.isSafeInteger(requestedFrame) ? Math.max(0, Math.min(animation.frames.length - 1, requestedFrame)) : 0;
    const changed = nextFrame !== animation.currentFrame;
    animation.currentFrame = nextFrame;
    animation.direction = 1;
    animation.elapsed = 0;
    this.sprites[index].texture = animation.frames[animation.currentFrame];
    if (changed) animation.onFrameChange?.(this, index, animation.currentFrame);
    this.markDirty();
    return true;
  }

  updateAnimations(delta) {
    const requestedDelta = Number(delta);
    const frameDelta = Number.isFinite(requestedDelta) ? Math.min(MAX_ANIMATION_DELTA, Math.max(0, requestedDelta)) : 0;
    if (frameDelta <= 0) return this;
    let changed = false;
    for (let index = 0; index < this.sprites.length; index += 1) {
      const sprite = this.sprites[index];
      const animation = sprite.animation;
      if (!animation || !animation.playing || animation.frames.length < 2 || animation.frameRate <= 0) continue;
      animation.elapsed += frameDelta;
      const frameDuration = 1 / animation.frameRate;
      let steps = 0;
      while (animation.elapsed >= frameDuration && animation.playing && steps < MAX_ANIMATION_STEPS) {
        animation.elapsed -= frameDuration;
        steps += 1;
        if (animation.pingPong && animation.loop) {
          if (animation.direction > 0) {
            if (animation.currentFrame < animation.frames.length - 1) animation.currentFrame += 1;
            else { animation.direction = -1; animation.currentFrame -= 1; }
          } else if (animation.currentFrame > 0) animation.currentFrame -= 1;
          else { animation.direction = 1; animation.currentFrame += 1; animation.onLoop?.(this, index); }
        } else if (animation.currentFrame < animation.frames.length - 1) animation.currentFrame += 1;
        else if (animation.loop) { animation.currentFrame = 0; animation.onLoop?.(this, index); }
        else {
          animation.playing = false;
          animation.onComplete?.(this, index);
          break;
        }
        sprite.texture = animation.frames[animation.currentFrame];
        animation.onFrameChange?.(this, index, animation.currentFrame);
        changed = true;
      }
      if (steps === MAX_ANIMATION_STEPS && animation.elapsed >= frameDuration) animation.elapsed %= frameDuration;
    }
    if (changed) this.markDirty();
    return this;
  }

  update(delta) {
    super.update(delta);
    this.updateAnimations(delta);
  }

  removeSprite(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.sprites.length) return false;
    this.sprites.splice(index, 1);
    this.invalidate();
    return true;
  }

  clear() { this.sprites.length = 0; this.chunkItems.length = 0; this.chunkBounds.length = 0; this.instanceChunkItems.length = 0; this.invalidate(); return this; }

  setTexture(texture) {
    if (!(texture instanceof Texture)) throw new TypeError("SpriteBatch texture bekleniyor.");
    const batchBase = texture.baseTexture || texture;
    for (const sprite of this.sprites) {
      const spriteBase = sprite.texture.baseTexture || sprite.texture;
      if (batchBase !== spriteBase) throw new Error("SpriteBatch mevcut sprite texture'larÄ±yla aynÄ± atlas/base texture kullanmalÄ±.");
    }
    this.texture = texture;
    this.invalidate();
    return this;
  }

  setFrame(texture) {
    if (!(texture instanceof Texture)) throw new TypeError("SpriteBatch frame texture bekleniyor.");
    this.validateSpriteTexture(texture);
    for (const sprite of this.sprites) sprite.texture = texture;
    this.invalidate({ preserveInstanceBuffer: true });
    return this;
  }

  getStaticRenderKey(camera, width, height) {
    if (this.instanced) return null;
    return updateStaticRenderKey(this.staticKeyState, this.contentVersion, camera, width, height, this.worldMatrix, this.renderClip, this.worldAlpha, this.worldFilter, this.worldFilterAmount, this.worldMaskTexture, this.worldMaskRect);
  }

  buildGpuSourceChunk(start, end, bounds, indices = null, reuseItem = null, alpha = 1) {
    const count = end - start;
    const instanceData = reuseItem?.instanceData?.length === count * GPU_SOURCE_FLOATS ? reuseItem.instanceData : new Float32Array(count * GPU_SOURCE_FLOATS);
    for (let cursor = start; cursor < end; cursor += 1) {
      const sprite = this.sprites[indices ? indices[cursor] : cursor];
      this.validateSpriteTexture(sprite.texture);
      const offset = (cursor - start) * GPU_SOURCE_FLOATS;
      instanceData[offset] = sprite.x; instanceData[offset + 1] = sprite.y;
      instanceData[offset + 2] = sprite.width; instanceData[offset + 3] = sprite.height;
      instanceData[offset + 4] = sprite.anchorX; instanceData[offset + 5] = sprite.anchorY;
      instanceData[offset + 6] = sprite.rotation; instanceData[offset + 7] = sprite.alpha * alpha;
      const { u0: textureU0, v0: textureV0, u1: textureU1, v1: textureV1 } = sprite.texture;
      const u0 = sprite.flipX ? textureU1 : textureU0; const u1 = sprite.flipX ? textureU0 : textureU1;
      const v0 = sprite.flipY ? textureV1 : textureV0; const v1 = sprite.flipY ? textureV0 : textureV1;
      instanceData[offset + 8] = u0; instanceData[offset + 9] = v0; instanceData[offset + 10] = u1; instanceData[offset + 11] = v1;
      writeColor(instanceData, offset + 12, sprite.tint);
    }
    if (reuseItem) { reuseItem.texture = this.texture; reuseItem.instanceData = instanceData; reuseItem.instanceCount = count; reuseItem.bounds = bounds; reuseItem.gpuCulling = true; reuseItem.instanceStride = GPU_SOURCE_FLOATS; reuseItem.gpuSource = true; return reuseItem; }
    return { texture: this.texture, instanceData, instanceCount: count, bounds, gpuCulling: true, instanceStride: GPU_SOURCE_FLOATS, gpuSource: true };
  }

  buildInstanceChunk(start, end, bounds, camera, indices = null, gpuCulling = false, reuseItem = null, alpha = 1) {
    if (gpuCulling) return this.buildGpuSourceChunk(start, end, bounds, indices, reuseItem, alpha);
    const count = end - start;
    const instanceData = reuseItem?.instanceData?.length === count * INSTANCE_FLOATS ? reuseItem.instanceData : new Float32Array(count * INSTANCE_FLOATS);
    const worldPoint = this.instanceWorldPoint;
    const screenPoint = this.instanceScreenPoint;
    for (let cursor = start; cursor < end; cursor += 1) {
      const sprite = this.sprites[indices ? indices[cursor] : cursor];
      this.validateSpriteTexture(sprite.texture);
      const left = -sprite.width * sprite.anchorX; const top = -sprite.height * sprite.anchorY;
      const right = sprite.width * (1 - sprite.anchorX); const bottom = sprite.height * (1 - sprite.anchorY);
      const cosine = Math.cos(sprite.rotation); const sine = Math.sin(sprite.rotation);
      const offset = (cursor - start) * INSTANCE_FLOATS;
      writeInstancePoint(this.worldMatrix, camera, worldPoint, screenPoint, sprite.x + left * cosine - top * sine, sprite.y + left * sine + top * cosine, instanceData, offset);
      const topRightOffset = offset + 2;
      writeInstancePoint(this.worldMatrix, camera, worldPoint, screenPoint, sprite.x + right * cosine - top * sine, sprite.y + right * sine + top * cosine, instanceData, topRightOffset);
      const bottomLeftOffset = offset + 4;
      writeInstancePoint(this.worldMatrix, camera, worldPoint, screenPoint, sprite.x + left * cosine - bottom * sine, sprite.y + left * sine + bottom * cosine, instanceData, bottomLeftOffset);
      instanceData[offset + 2] -= instanceData[offset]; instanceData[offset + 3] -= instanceData[offset + 1];
      instanceData[offset + 4] -= instanceData[offset]; instanceData[offset + 5] -= instanceData[offset + 1];
      const { u0: textureU0, v0: textureV0, u1: textureU1, v1: textureV1 } = sprite.texture;
      const u0 = sprite.flipX ? textureU1 : textureU0; const u1 = sprite.flipX ? textureU0 : textureU1;
      const v0 = sprite.flipY ? textureV1 : textureV0; const v1 = sprite.flipY ? textureV0 : textureV1;
      instanceData[offset + 6] = u0; instanceData[offset + 7] = v0; instanceData[offset + 8] = u1; instanceData[offset + 9] = v1;
      writeColor(instanceData, offset + 10, sprite.tint); instanceData[offset + 13] = sprite.alpha * alpha;
    }
    if (reuseItem) { reuseItem.texture = this.texture; reuseItem.instanceData = instanceData; reuseItem.instanceCount = count; reuseItem.bounds = bounds; reuseItem.gpuCulling = false; reuseItem.instanceStride = INSTANCE_FLOATS; reuseItem.gpuSource = false; return reuseItem; }
    return { texture: this.texture, instanceData, instanceCount: count, bounds, gpuCulling, instanceStride: INSTANCE_FLOATS, gpuSource: false };
  }

  hasInstanceCache(camera, width, height, useGpuCulling, needsCamera) {
    if (this.instanceCacheContentVersion !== this.contentVersion || this.instanceCacheUseGpuCulling !== useGpuCulling || this.instanceCacheNeedsCamera !== needsCamera) return false;
    if (this.instanceCacheAlpha !== (Number.isFinite(Number(this.worldAlpha)) ? this.worldAlpha : 1)) return false;
    if (useGpuCulling || !needsCamera) return true;
    const matrix = this.worldMatrix;
    return this.instanceCacheWidth === width && this.instanceCacheHeight === height
      && this.instanceCacheCameraX === camera.position.x && this.instanceCacheCameraY === camera.position.y
      && this.instanceCacheZoom === camera.zoom && this.instanceCachePixelRatio === (camera.pixelRatio || 1) && this.instanceCacheRotation === camera.rotation
      && this.instanceCacheCameraWidth === camera.width && this.instanceCacheCameraHeight === camera.height
      && this.instanceCacheViewportX === (camera.viewportX || 0) && this.instanceCacheViewportY === (camera.viewportY || 0)
      && this.instanceCacheViewportWidth === (camera.viewportWidth || camera.width) && this.instanceCacheViewportHeight === (camera.viewportHeight || camera.height)
      && this.instanceCacheA === matrix.a && this.instanceCacheB === matrix.b && this.instanceCacheC === matrix.c
      && this.instanceCacheD === matrix.d && this.instanceCacheTx === matrix.tx && this.instanceCacheTy === matrix.ty;
  }

  saveInstanceCache(camera, width, height, useGpuCulling, needsCamera) {
    this.instanceCacheContentVersion = this.contentVersion;
    this.instanceCacheUseGpuCulling = useGpuCulling;
    this.instanceCacheAlpha = Number.isFinite(Number(this.worldAlpha)) ? this.worldAlpha : 1;
    this.instanceCacheNeedsCamera = needsCamera;
    if (useGpuCulling || !needsCamera) return;
    const matrix = this.worldMatrix;
    this.instanceCacheWidth = width; this.instanceCacheHeight = height;
    this.instanceCacheCameraX = camera.position.x; this.instanceCacheCameraY = camera.position.y;
    this.instanceCacheZoom = camera.zoom; this.instanceCachePixelRatio = camera.pixelRatio || 1; this.instanceCacheRotation = camera.rotation;
    this.instanceCacheCameraWidth = camera.width; this.instanceCacheCameraHeight = camera.height;
    this.instanceCacheViewportX = camera.viewportX || 0; this.instanceCacheViewportY = camera.viewportY || 0;
    this.instanceCacheViewportWidth = camera.viewportWidth || camera.width; this.instanceCacheViewportHeight = camera.viewportHeight || camera.height;
    this.instanceCacheA = matrix.a; this.instanceCacheB = matrix.b; this.instanceCacheC = matrix.c; this.instanceCacheD = matrix.d; this.instanceCacheTx = matrix.tx; this.instanceCacheTy = matrix.ty;
  }

  mergeCpuInstanceItems() {
    if (this.instanceItems.length <= 1) return this.instanceItems;
    let totalInstances = 0;
    for (const item of this.instanceItems) totalInstances += item.instanceCount;
    const requiredLength = totalInstances * INSTANCE_FLOATS;
    const previous = this.instanceMergedItem;
    const instanceData = previous?.instanceData?.length === requiredLength ? previous.instanceData : new Float32Array(requiredLength);
    let offset = 0;
    for (const item of this.instanceItems) {
      instanceData.set(item.instanceData, offset);
      offset += item.instanceData.length;
    }
    const merged = previous || { texture: this.texture, instanceData: null, instanceCount: 0, bounds: null, gpuCulling: false, instanceStride: INSTANCE_FLOATS, gpuSource: false };
    merged.texture = this.texture;
    merged.instanceData = instanceData;
    merged.instanceCount = totalInstances;
    merged.bounds = null;
    merged.gpuCulling = false;
    merged.instanceStride = INSTANCE_FLOATS;
    merged.gpuSource = false;
    this.instanceMergedItem = merged;
    this.instanceItems[0] = merged;
    this.instanceItems.length = 1;
    return this.instanceItems;
  }

  getInstanceItems(camera, width, height, { gpuCulling = false, alpha = this.worldAlpha } = {}) {
    if (this.sprites.length > MAX_SPRITES) throw new RangeError(`SpriteBatch sprite limiti ${MAX_SPRITES}.`);
    const renderAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
    const useGpuCulling = this.gpuCulling && gpuCulling;
    const canCull = Boolean(camera && this.cullable !== false);
    const needsCamera = Boolean(camera && !useGpuCulling);
    if (!this.itemsDirty && this.hasInstanceCache(camera, width, height, useGpuCulling, needsCamera)) { this.lastCulledCount = 0; return this.instanceItems; }
    this.lastCulledCount = 0;
    const previousInstanceItem = this.instanceItems[0] || this.instanceChunkItems[0] || null;
    this.instanceItems.length = 0;
    if (this.itemsDirty) {
      this.chunkItems.length = 0;
      this.chunkBounds.length = 0;
      this.itemsDirty = false;
    }
    if (useGpuCulling && this.sprites.length > 0) {
      const item = this.buildInstanceChunk(0, this.sprites.length, this.getLocalBounds(), camera, null, true, previousInstanceItem, renderAlpha);
      this.instanceChunkItems[0] = item;
      this.instanceItems.push(item);
      this.saveInstanceCache(camera, width, height, useGpuCulling, needsCamera);
      return this.instanceItems;
    }
    if (this.spatialCulling && canCull && !useGpuCulling) {
      const indices = this.getVisibleSpriteIndices(camera, width, height);
      this.lastCulledCount = this.sprites.length - indices.length;
      for (let start = 0, chunkIndex = 0; start < indices.length; start += this.chunkSize, chunkIndex += 1) {
        const end = Math.min(indices.length, start + this.chunkSize);
        const bounds = this.getIndicesBounds(indices, start, end, this.visibleChunkBounds[chunkIndex]);
        this.visibleChunkBounds[chunkIndex] = bounds;
        const existingItem = this.instanceChunkItems[chunkIndex];
        const item = existingItem?.gpuCulling === false ? this.buildInstanceChunk(start, end, bounds, camera, indices, false, existingItem, renderAlpha) : this.buildInstanceChunk(start, end, bounds, camera, indices, false, null, renderAlpha);
        this.instanceChunkItems[chunkIndex] = item;
        this.instanceItems.push(item);
      }
      this.saveInstanceCache(camera, width, height, useGpuCulling, needsCamera);
      return this.mergeCpuInstanceItems();
    }
    for (let start = 0, chunkIndex = 0; start < this.sprites.length; start += this.chunkSize, chunkIndex += 1) {
      const end = Math.min(this.sprites.length, start + this.chunkSize);
      const bounds = this.chunkBounds[chunkIndex] || this.getChunkBounds(start, end);
      this.chunkBounds[chunkIndex] = bounds;
      if (canCull && !useGpuCulling && !this.isChunkVisible(bounds, camera, width, height)) { this.lastCulledCount += 1; continue; }
      const existingItem = this.instanceChunkItems[chunkIndex];
      const item = existingItem?.gpuCulling === useGpuCulling ? this.buildInstanceChunk(start, end, bounds, camera, null, useGpuCulling, existingItem, renderAlpha) : this.buildInstanceChunk(start, end, bounds, camera, null, useGpuCulling, null, renderAlpha);
      this.instanceChunkItems[chunkIndex] = item;
      this.instanceItems.push(item);
    }
    this.saveInstanceCache(camera, width, height, useGpuCulling, needsCamera);
    return this.mergeCpuInstanceItems();
  }

  getChunkBounds(start, end, reuseBounds = null) {
    const bounds = reuseBounds || { x: Infinity, y: Infinity, width: -Infinity, height: -Infinity };
    bounds.x = Infinity; bounds.y = Infinity; bounds.width = -Infinity; bounds.height = -Infinity;
    for (let index = start; index < end; index += 1) {
      const sprite = this.sprites[index];
      const left = -sprite.width * sprite.anchorX; const top = -sprite.height * sprite.anchorY;
      const right = sprite.width * (1 - sprite.anchorX); const bottom = sprite.height * (1 - sprite.anchorY);
      const cosine = Math.cos(sprite.rotation); const sine = Math.sin(sprite.rotation);
      const topLeftX = sprite.x + left * cosine - top * sine;
      const topLeftY = sprite.y + left * sine + top * cosine;
      const topRightX = sprite.x + right * cosine - top * sine;
      const topRightY = sprite.y + right * sine + top * cosine;
      const bottomRightX = sprite.x + right * cosine - bottom * sine;
      const bottomRightY = sprite.y + right * sine + bottom * cosine;
      const bottomLeftX = sprite.x + left * cosine - bottom * sine;
      const bottomLeftY = sprite.y + left * sine + bottom * cosine;
      includeBoundsPoint(bounds, topLeftX, topLeftY);
      includeBoundsPoint(bounds, topRightX, topRightY);
      includeBoundsPoint(bounds, bottomRightX, bottomRightY);
      includeBoundsPoint(bounds, bottomLeftX, bottomLeftY);
    }
    bounds.width -= bounds.x; bounds.height -= bounds.y;
    return bounds;
  }

  buildSpatialIndex() {
    if (!this.spatialCulling || this.spatialIndexVersion === this.contentVersion) return;
    this.spatialIndex.clear();
    this.spatialLargeIndices.length = 0;
    this.spatialSpriteBounds.length = this.sprites.length;
    for (let index = 0; index < this.sprites.length; index += 1) {
      const bounds = this.getChunkBounds(index, index + 1, this.spatialSpriteBounds[index]);
      this.spatialSpriteBounds[index] = bounds;
      const minCellX = Math.floor(bounds.x / this.cellSize); const maxCellX = Math.floor((bounds.x + bounds.width) / this.cellSize);
      const minCellY = Math.floor(bounds.y / this.cellSize); const maxCellY = Math.floor((bounds.y + bounds.height) / this.cellSize);
      const cellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
      if (!Number.isFinite(cellCount) || cellCount > MAX_SPATIAL_CELLS) { this.spatialLargeIndices.push(index); continue; }
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
          let column = this.spatialIndex.get(cellX);
          if (!column) { column = new Map(); this.spatialIndex.set(cellX, column); }
          let cell = column.get(cellY);
          if (!cell) { cell = { x: cellX * this.cellSize, y: cellY * this.cellSize, width: this.cellSize, height: this.cellSize, indices: [] }; column.set(cellY, cell); }
          cell.indices.push(index);
        }
      }
    }
    this.visibleStamp = new Uint32Array(this.sprites.length);
    this.visibleToken = 0;
    this.spatialIndexVersion = this.contentVersion;
  }

  getVisibleSpriteIndices(camera, width, height) {
    this.buildSpatialIndex();
    this.visibleToken += 1;
    if (this.visibleToken === 0xffffffff) { this.visibleStamp.fill(0); this.visibleToken = 1; }
    const token = this.visibleToken;
    const range = this.getVisibleSpatialCellRange(camera, width, height);
    if (range) {
      for (let cellY = range[2]; cellY <= range[3]; cellY += 1) {
        for (let cellX = range[0]; cellX <= range[1]; cellX += 1) {
          const cell = this.spatialIndex.get(cellX)?.get(cellY);
          if (!cell || !this.isChunkVisible(cell, camera, width, height)) continue;
          for (const index of cell.indices) this.visibleStamp[index] = token;
        }
      }
    } else {
      for (const column of this.spatialIndex.values()) {
        for (const cell of column.values()) {
          if (!this.isChunkVisible(cell, camera, width, height)) continue;
          for (const index of cell.indices) this.visibleStamp[index] = token;
        }
      }
    }
    for (const index of this.spatialLargeIndices) if (this.isChunkVisible(this.spatialSpriteBounds[index], camera, width, height)) this.visibleStamp[index] = token;
    const indices = this.visibleIndices;
    indices.length = 0;
    for (let index = 0; index < this.sprites.length; index += 1) if (this.visibleStamp[index] === token) indices.push(index);
    return indices;
  }

  getIndicesBounds(indices, start, end, reuseBounds = null) {
    const bounds = reuseBounds || { x: Infinity, y: Infinity, width: -Infinity, height: -Infinity };
    bounds.x = Infinity; bounds.y = Infinity; bounds.width = -Infinity; bounds.height = -Infinity;
    for (let cursor = start; cursor < end; cursor += 1) {
      const spriteBounds = this.spatialSpriteBounds[indices[cursor]];
      bounds.x = Math.min(bounds.x, spriteBounds.x); bounds.y = Math.min(bounds.y, spriteBounds.y);
      bounds.width = Math.max(bounds.width, spriteBounds.x + spriteBounds.width); bounds.height = Math.max(bounds.height, spriteBounds.y + spriteBounds.height);
    }
    bounds.width -= bounds.x; bounds.height -= bounds.y;
    return bounds;
  }

  buildChunk(start, end, bounds, indices = null, reuseItem = null) {
    const item = reuseItem || { texture: this.texture, tint: 0xffffff, alpha: 1, positions: [], uvs: [], colors: [], bounds };
    item.texture = this.texture;
    item.bounds = bounds;
    item.positions.length = 0;
    item.uvs.length = 0;
    item.colors.length = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      const sprite = this.sprites[indices ? indices[cursor] : cursor];
      this.validateSpriteTexture(sprite.texture);
      const { u0: textureU0, v0: textureV0, u1: textureU1, v1: textureV1 } = sprite.texture;
      const u0 = sprite.flipX ? textureU1 : textureU0; const u1 = sprite.flipX ? textureU0 : textureU1;
      const v0 = sprite.flipY ? textureV1 : textureV0; const v1 = sprite.flipY ? textureV0 : textureV1;
      const left = -sprite.width * sprite.anchorX; const top = -sprite.height * sprite.anchorY;
      const right = sprite.width * (1 - sprite.anchorX); const bottom = sprite.height * (1 - sprite.anchorY);
      const cosine = Math.cos(sprite.rotation); const sine = Math.sin(sprite.rotation);
      const rawTint = typeof sprite.tint === "string" ? Number.parseInt(sprite.tint.replace(/^#/, ""), 16) : sprite.tint;
      const tint = Number.isFinite(rawTint) ? rawTint >>> 0 : 0xffffff;
      const red = (tint >> 16 & 255) / 255; const green = (tint >> 8 & 255) / 255; const blue = (tint & 255) / 255;
      const topLeftX = sprite.x + left * cosine - top * sine;
      const topLeftY = sprite.y + left * sine + top * cosine;
      const topRightX = sprite.x + right * cosine - top * sine;
      const topRightY = sprite.y + right * sine + top * cosine;
      const bottomRightX = sprite.x + right * cosine - bottom * sine;
      const bottomRightY = sprite.y + right * sine + bottom * cosine;
      const bottomLeftX = sprite.x + left * cosine - bottom * sine;
      const bottomLeftY = sprite.y + left * sine + bottom * cosine;
      pushVertex(item.positions, item.uvs, item.colors, topLeftX, topLeftY, u0, v0, red, green, blue, sprite.alpha);
      pushVertex(item.positions, item.uvs, item.colors, topRightX, topRightY, u1, v0, red, green, blue, sprite.alpha);
      pushVertex(item.positions, item.uvs, item.colors, bottomRightX, bottomRightY, u1, v1, red, green, blue, sprite.alpha);
      pushVertex(item.positions, item.uvs, item.colors, topLeftX, topLeftY, u0, v0, red, green, blue, sprite.alpha);
      pushVertex(item.positions, item.uvs, item.colors, bottomRightX, bottomRightY, u1, v1, red, green, blue, sprite.alpha);
      pushVertex(item.positions, item.uvs, item.colors, bottomLeftX, bottomLeftY, u0, v1, red, green, blue, sprite.alpha);
    }
    return item;
  }

  isChunkVisible(bounds, camera, width, height) {
    const corners = this.cullingCorners;
    corners[0] = bounds.x; corners[1] = bounds.y; corners[2] = bounds.x + bounds.width; corners[3] = bounds.y;
    corners[4] = bounds.x + bounds.width; corners[5] = bounds.y + bounds.height; corners[6] = bounds.x; corners[7] = bounds.y + bounds.height;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const local = this.cullingLocal; const screen = this.cullingScreen;
    for (let index = 0; index < corners.length; index += 2) {
      this.worldMatrix.transformPoint(corners[index], corners[index + 1], local);
      camera.worldToScreen(local.x, local.y, screen);
      minX = Math.min(minX, screen.x); minY = Math.min(minY, screen.y); maxX = Math.max(maxX, screen.x); maxY = Math.max(maxY, screen.y);
    }
    return !(maxX < 0 || minX > width || maxY < 0 || minY > height);
  }

  getVisibleSpatialCellRange(camera, width, height) {
    if (!camera || !Number.isFinite(Number(width)) || !Number.isFinite(Number(height)) || width <= 0 || height <= 0) return null;
    const matrix = this.worldMatrix;
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    const zoom = Number(camera.zoom);
    const pixelRatio = Number(camera.pixelRatio || 1);
    const scale = zoom * pixelRatio;
    const cameraX = Number(camera.position?.x); const cameraY = Number(camera.position?.y);
    const viewportX = Number(camera.viewportX || 0); const viewportY = Number(camera.viewportY || 0);
    const viewportWidth = Number(camera.viewportWidth || width); const viewportHeight = Number(camera.viewportHeight || height);
    const rotation = Number(camera.rotation);
    if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON || !Number.isFinite(scale) || scale <= 0
      || !Number.isFinite(cameraX) || !Number.isFinite(cameraY) || !Number.isFinite(viewportX) || !Number.isFinite(viewportY)
      || !Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0 || !Number.isFinite(rotation)) return null;
    const cosine = Math.cos(rotation); const sine = Math.sin(rotation);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    const local = this.cullingLocal;
    const screen = this.cullingScreen;
    for (let corner = 0; corner < 4; corner += 1) {
      const screenX = corner === 1 || corner === 2 ? width : 0;
      const screenY = corner >= 2 ? height : 0;
      const dx = (screenX - viewportX - viewportWidth * 0.5) / scale;
      const dy = (screenY - viewportY - viewportHeight * 0.5) / scale;
      screen.x = cameraX + dx * cosine - dy * sine;
      screen.y = cameraY + dx * sine + dy * cosine;
      const deltaX = screen.x - matrix.tx; const deltaY = screen.y - matrix.ty;
      local.x = (matrix.d * deltaX - matrix.c * deltaY) / determinant;
      local.y = (-matrix.b * deltaX + matrix.a * deltaY) / determinant;
      minX = Math.min(minX, local.x); minY = Math.min(minY, local.y);
      maxX = Math.max(maxX, local.x); maxY = Math.max(maxY, local.y);
    }
    const minCellX = Math.floor(minX / this.cellSize); const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize); const maxCellY = Math.floor(maxY / this.cellSize);
    const cellCount = (maxCellX - minCellX + 1) * (maxCellY - minCellY + 1);
    if (![minCellX, maxCellX, minCellY, maxCellY, cellCount].every(Number.isSafeInteger) || cellCount > MAX_SPATIAL_CELLS) return null;
    const range = this.spatialCellRange;
    range[0] = minCellX; range[1] = maxCellX; range[2] = minCellY; range[3] = maxCellY;
    return range;
  }

  getRenderItems(camera = null, width = 0, height = 0) {
    if (this.sprites.length > MAX_SPRITES) throw new RangeError(`SpriteBatch sprite limiti ${MAX_SPRITES}.`);
    const canCull = camera && this.cullable !== false;
    const renderItemsKey = canCull ? this.getStaticRenderKey(camera, width, height) : "all";
    if (!this.itemsDirty && this.renderItemsKey === renderItemsKey) { this.lastCulledCount = 0; return this.renderItems; }
    this.lastCulledCount = 0;
    const wasDirty = this.itemsDirty;
    if (wasDirty) this.itemsDirty = false;
    this.renderItems.length = 0;
    if (this.spatialCulling && canCull) {
      const indices = this.getVisibleSpriteIndices(camera, width, height);
      this.lastCulledCount = this.sprites.length - indices.length;
      for (let start = 0, chunkIndex = 0; start < indices.length; start += this.chunkSize, chunkIndex += 1) {
        const end = Math.min(indices.length, start + this.chunkSize);
        const existingItem = this.chunkItems[chunkIndex];
        const bounds = this.getIndicesBounds(indices, start, end, this.visibleChunkBounds[chunkIndex]);
        this.visibleChunkBounds[chunkIndex] = bounds;
        this.renderItems.push(this.buildChunk(start, end, bounds, indices, existingItem));
      }
      this.renderItemsKey = renderItemsKey;
      return this.renderItems;
    }
    for (let start = 0, chunkIndex = 0; start < this.sprites.length; start += this.chunkSize, chunkIndex += 1) {
      const end = Math.min(this.sprites.length, start + this.chunkSize);
      const bounds = this.chunkBounds[chunkIndex] || { x: 0, y: 0, width: 0, height: 0 };
      if (wasDirty || !this.chunkBounds[chunkIndex]) this.getChunkBounds(start, end, bounds);
      this.chunkBounds[chunkIndex] = bounds;
      if (canCull && !this.isChunkVisible(bounds, camera, width, height)) { this.lastCulledCount += 1; continue; }
      const item = this.buildChunk(start, end, bounds, null, this.chunkItems[chunkIndex]);
      this.chunkItems[chunkIndex] = item;
      this.renderItems.push(item);
    }
    this.renderItemsKey = renderItemsKey;
    return this.renderItems;
  }

  getLocalBounds() {
    if (this.sprites.length > MAX_SPRITES) throw new RangeError(`SpriteBatch sprite limiti ${MAX_SPRITES}.`);
    if (this.boundsCache.version === this.contentVersion) return this.boundsCache.value;
    if (!this.sprites.length) {
      this.boundsCache = { version: this.contentVersion, value: { x: 0, y: 0, width: 0, height: 0 } };
      return this.boundsCache.value;
    }
    const wasDirty = this.itemsDirty;
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (let start = 0; start < this.sprites.length; start += this.chunkSize) {
      const chunkIndex = Math.floor(start / this.chunkSize);
      const bounds = this.chunkBounds[chunkIndex] || { x: 0, y: 0, width: 0, height: 0 };
      if (wasDirty || !this.chunkBounds[chunkIndex]) this.getChunkBounds(start, Math.min(this.sprites.length, start + this.chunkSize), bounds);
      this.chunkBounds[chunkIndex] = bounds;
      left = Math.min(left, bounds.x); top = Math.min(top, bounds.y); right = Math.max(right, bounds.x + bounds.width); bottom = Math.max(bottom, bounds.y + bounds.height);
    }
    this.boundsCache = { version: this.contentVersion, value: { x: left, y: top, width: right - left, height: bottom - top } };
    return this.boundsCache.value;
  }

  destroy() {
    this.sprites.length = 0;
    this.renderItems.length = 0;
    this.chunkItems.length = 0;
    this.instanceChunkItems.length = 0;
    this.instanceItems.length = 0;
    this.instanceMergedItem = null;
    this.staticRenderCache = null;
    this.renderItemsKey = null;
    this.instanceItemsKey = null;
    this.chunkBounds.length = 0;
    this.spatialIndex.clear();
    this.spatialLargeIndices.length = 0;
    this.spatialSpriteBounds.length = 0;
    this.visibleChunkBounds.length = 0;
    this.visibleStamp = new Uint32Array(0);
    this.visibleIndices.length = 0;
    this.boundsCache = { version: -1, value: null };
    super.destroy();
  }
}
