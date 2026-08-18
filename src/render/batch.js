import { INSTANCE_FLOATS, INSTANCE_VERTEX_COUNT } from "./instanced.js";
import { normalizeBlendMode, normalizeFilterAmount, normalizeFilterType } from "../core/node.js";

const FLOATS_PER_VERTEX = 8;
const BATCH_POOL_RETENTION = 16;

export function updateStaticRenderKey(state, contentVersion, camera, width, height, matrix, clip, alpha = 1, filter = "none", filterAmount = 1, maskTexture = null, maskRect = null) {
  const hasClip = Boolean(clip);
  const clipX = hasClip ? clip.x : 0;
  const clipY = hasClip ? clip.y : 0;
  const clipWidth = hasClip ? clip.width : 0;
  const clipHeight = hasClip ? clip.height : 0;
  const maskX = maskRect?.x || 0;
  const maskY = maskRect?.y || 0;
  const maskWidth = maskRect?.width || 0;
  const maskHeight = maskRect?.height || 0;
  if (state.contentVersion === contentVersion && state.width === width && state.height === height
    && state.cameraX === camera.position.x && state.cameraY === camera.position.y
    && state.zoom === camera.zoom && state.pixelRatio === (camera.pixelRatio || 1) && state.rotation === camera.rotation
    && state.cameraWidth === camera.width && state.cameraHeight === camera.height
    && state.viewportX === (camera.viewportX || 0) && state.viewportY === (camera.viewportY || 0)
    && state.viewportWidth === (camera.viewportWidth || camera.width) && state.viewportHeight === (camera.viewportHeight || camera.height)
    && state.a === matrix.a && state.b === matrix.b && state.c === matrix.c && state.d === matrix.d
    && state.tx === matrix.tx && state.ty === matrix.ty && state.hasClip === hasClip
    && state.clipX === clipX && state.clipY === clipY && state.clipWidth === clipWidth && state.clipHeight === clipHeight && state.alpha === alpha
    && state.filter === filter && state.filterAmount === filterAmount && state.maskTexture === maskTexture
    && state.maskX === maskX && state.maskY === maskY && state.maskWidth === maskWidth && state.maskHeight === maskHeight) return state.version;
  state.contentVersion = contentVersion;
  state.width = width; state.height = height;
  state.cameraX = camera.position.x; state.cameraY = camera.position.y;
  state.zoom = camera.zoom; state.pixelRatio = camera.pixelRatio || 1; state.rotation = camera.rotation;
  state.cameraWidth = camera.width; state.cameraHeight = camera.height;
  state.viewportX = camera.viewportX || 0; state.viewportY = camera.viewportY || 0;
  state.viewportWidth = camera.viewportWidth || camera.width; state.viewportHeight = camera.viewportHeight || camera.height;
  state.a = matrix.a; state.b = matrix.b; state.c = matrix.c; state.d = matrix.d; state.tx = matrix.tx; state.ty = matrix.ty;
  state.hasClip = hasClip;
  state.clipX = clipX; state.clipY = clipY; state.clipWidth = clipWidth; state.clipHeight = clipHeight;
  state.alpha = alpha;
  state.filter = filter;
  state.filterAmount = filterAmount;
  state.maskTexture = maskTexture;
  state.maskX = maskX; state.maskY = maskY; state.maskWidth = maskWidth; state.maskHeight = maskHeight;
  state.version = state.version >= Number.MAX_SAFE_INTEGER ? 1 : state.version + 1;
  return state.version;
}

export function createRenderBatchState() {
  return {
    renderables: [],
    batches: [],
    batchPool: [],
    batchCursor: 0,
    screenPoints: [],
    localPoint: { x: 0, y: 0 },
    screenPoint: { x: 0, y: 0 },
    boundsCorners: new Float64Array(8),
    renderGroups: [],
    sortedRenderables: [],
    collectionOrder: [],
    renderableSet: new Set(),
    renderableZ: new Map(),
    result: { batches: [], nodeCount: 0, culledCount: 0, scissorCount: 0, width: 0, height: 0, stride: FLOATS_PER_VERTEX, renderOrderRebuilds: 0 },
    renderOrderRebuilds: 0,
    subtreeCull: { value: 0 },
  };
}

function takeBatch(state) {
  const batchIndex = state.batchCursor++;
  let batch = state.batchPool[batchIndex];
  if (!batch) {
    batch = { instanceValues: [], values: [] };
    state.batchPool[batchIndex] = batch;
  }
  if (!batch.instanceValues) batch.instanceValues = [];
  if (!batch.values) batch.values = [];
  batch.instanceValues.length = 0;
  batch.values.length = 0;
  batch.texture = null;
  batch.clip = null;
  batch.clipX = 0;
  batch.clipY = 0;
  batch.clipWidth = 0;
  batch.clipHeight = 0;
  batch.instanceCount = 0;
  batch.vertexCount = 0;
  batch.instanced = false;
  batch.gpuCulling = false;
  batch.gpuOwner = null;
  batch.gpuResource = null;
  batch.gpuSource = false;
  batch.instanceStride = 0;
  batch.filterType = "none";
  batch.filterAmount = 1;
  batch.maskTexture = null;
  batch.maskRect = null;
  batch.order = 0;
  batch.staticOwner = null;
  batch.staticKey = null;
  batch.blendMode = "normal";
  state.batches.push(batch);
  return batch;
}

function clearInactiveBatch(batch, releaseBuffers = false) {
  batch.texture = null;
  batch.clip = null;
  batch.maskTexture = null;
  batch.maskRect = null;
  batch.staticOwner = null;
  batch.staticKey = null;
  batch.gpuOwner = null;
  batch.gpuResource = null;
  if (releaseBuffers) {
    batch.values = [];
    batch.instanceValues = [];
    batch.data = null;
    batch.instanceData = null;
  } else {
    if (batch.values) batch.values.length = 0;
    if (batch.instanceValues) batch.instanceValues.length = 0;
  }
}

function trimBatchPool(state) {
  const pool = state.batchPool;
  const keepLength = Math.min(pool.length, state.batchCursor + BATCH_POOL_RETENTION);
  for (let index = state.batchCursor; index < pool.length; index += 1) clearInactiveBatch(pool[index], index >= keepLength);
  if (pool.length > keepLength) pool.length = keepLength;
}

function setBatchClip(batch, clip) {
  batch.clip = clip;
  if (!clip) return;
  batch.clipX = clip.x;
  batch.clipY = clip.y;
  batch.clipWidth = clip.width;
  batch.clipHeight = clip.height;
}

function sameBatchClip(batch, clip) {
  if (!clip) return batch.clip === null;
  return batch.clip !== null && batch.clipX === clip.x && batch.clipY === clip.y && batch.clipWidth === clip.width && batch.clipHeight === clip.height;
}

function sameBatchFilter(batch, filterType, filterAmount) {
  return batch.filterType === filterType && batch.filterAmount === filterAmount;
}

function sameBatchMask(batch, maskTexture, maskRect) {
  if (batch.maskTexture !== maskTexture) return false;
  if (!maskRect) return !batch.maskRect;
  return batch.maskRect !== null && batch.maskRect.x === maskRect.x && batch.maskRect.y === maskRect.y && batch.maskRect.width === maskRect.width && batch.maskRect.height === maskRect.height;
}

function setBoundsCorners(corners, bounds) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  corners[0] = bounds.x; corners[1] = bounds.y;
  corners[2] = right; corners[3] = bounds.y;
  corners[4] = right; corners[5] = bottom;
  corners[6] = bounds.x; corners[7] = bottom;
}

function resolveRenderOrder(state, collected) {
  const cached = state.sortedRenderables;
  let reusable = cached.length === collected.length && state.collectionOrder.length === collected.length && state.renderableSet.size === collected.length;
  if (reusable) {
    for (let index = 0; index < collected.length; index += 1) {
      const renderable = collected[index];
      if (state.collectionOrder[index] !== renderable || !state.renderableSet.has(renderable) || state.renderableZ.get(renderable) !== renderable.worldZ) { reusable = false; break; }
    }
  }
  if (reusable) return cached;
  state.collectionOrder.length = 0;
  for (const renderable of collected) state.collectionOrder.push(renderable);
  collected.sort((left, right) => left.worldZ - right.worldZ);
  cached.length = 0;
  for (const renderable of collected) cached.push(renderable);
  state.renderableSet.clear();
  state.renderableZ.clear();
  for (const renderable of cached) { state.renderableSet.add(renderable); state.renderableZ.set(renderable, renderable.worldZ); }
  state.renderOrderRebuilds += 1;
  return cached;
}

export function collectRenderGroups(node, output = [], inheritedVisible = true) {
  if (!node || node.destroyed) return output;
  if (node.isRenderGroup !== true && node._renderGroupSubtree !== true) return output;
  const visible = inheritedVisible && node.visible !== false;
  if (!visible) return output;
  for (const child of node.children || []) collectRenderGroups(child, output, visible);
  if (node.isRenderGroup) output.push(node);
  return output;
}

export function buildRenderBatches(scene, camera, width, height, { gpuCulling = false, state = null, offscreenRoot = false } = {}) {
  camera?.normalize?.();
  if (offscreenRoot && typeof scene.updateOffscreenWorldMatrix === "function") scene.updateOffscreenWorldMatrix();
  else scene.updateWorldMatrix();
  const scratch = state || createRenderBatchState();
  const renderables = scratch.renderables;
  scratch.batches ||= [];
  scratch.batchPool ||= [];
  scratch.batchCursor = 0;
  scratch.batches.length = 0;
  renderables.length = 0;
  scratch.subtreeCull.value = 0;
  scene.collectRenderables(renderables, true, null, camera, width, height, scratch.subtreeCull, scratch, offscreenRoot);
  const orderedRenderables = resolveRenderOrder(scratch, renderables);
  const batches = scratch.batches;
  let current = null;
  let order = 0;
  let culledCount = scratch.subtreeCull.value;
  const { screenPoints, localPoint, screenPoint, boundsCorners } = scratch;

  for (const renderable of orderedRenderables) {
    const clip = renderable.renderClip;
    const blendMode = normalizeBlendMode(renderable.blendMode);
    const renderAlpha = Number.isFinite(Number(renderable.worldAlpha)) ? Math.max(0, Math.min(1, Number(renderable.worldAlpha))) : 1;
    const filterType = normalizeFilterType(renderable.worldFilter ?? renderable.filter);
    const filterAmount = normalizeFilterAmount(renderable.worldFilterAmount ?? renderable.filterAmount);
    const maskTexture = renderable.worldMaskTexture && !renderable.worldMaskTexture.destroyed && !renderable.worldMaskTexture.baseTexture?.destroyed ? renderable.worldMaskTexture : null;
    const maskRect = maskTexture ? renderable.worldMaskRect : null;
    const staticKey = typeof renderable.getStaticRenderKey === "function" ? renderable.getStaticRenderKey(camera, width, height) : null;
    const isStatic = staticKey !== null;
    if (renderAlpha <= 0) { current = null; if (isStatic) renderable.staticRenderCache = null; continue; }
    if (isStatic && renderable.staticRenderCache?.key === staticKey && renderable.staticRenderCache.texture && !renderable.staticRenderCache.texture.destroyed && !renderable.staticRenderCache.texture.baseTexture?.destroyed) {
      current = null;
      const cache = renderable.staticRenderCache;
      if (cache.vertexCount > 0) {
        const cachedBatch = takeBatch(scratch);
        cachedBatch.texture = cache.texture; setBatchClip(cachedBatch, clip); cachedBatch.data = cache.data; cachedBatch.vertexCount = cache.vertexCount; cachedBatch.order = order++; cachedBatch.staticOwner = renderable; cachedBatch.staticKey = staticKey; cachedBatch.blendMode = blendMode; cachedBatch.filterType = filterType; cachedBatch.filterAmount = filterAmount; cachedBatch.maskTexture = maskTexture; cachedBatch.maskRect = maskRect;
      }
      continue;
    }
    if (renderable.isBatch && renderable.cullable !== false) {
      const bounds = renderable.getLocalBounds();
      setBoundsCorners(boundsCorners, bounds);
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let index = 0; index < boundsCorners.length; index += 2) {
        renderable.worldMatrix.transformPoint(boundsCorners[index], boundsCorners[index + 1], localPoint);
        camera.worldToScreen(localPoint.x, localPoint.y, screenPoint);
        minX = Math.min(minX, screenPoint.x); minY = Math.min(minY, screenPoint.y); maxX = Math.max(maxX, screenPoint.x); maxY = Math.max(maxY, screenPoint.y);
      }
      if (maxX < 0 || minX > width || maxY < 0 || minY > height) { culledCount += 1; if (isStatic) renderable.staticRenderCache = null; continue; }
    }
    if (isStatic) renderable.staticRenderCache = null;
    if (isStatic) current = null;
    if (renderable.isInstancedBatch && typeof renderable.getInstanceItems === "function") {
      const items = renderable.getInstanceItems(camera, width, height, { gpuCulling, cull: renderable.cullable !== false, alpha: renderAlpha });
      if (renderable.lastCulledCount) { culledCount += renderable.lastCulledCount; renderable.lastCulledCount = 0; }
      for (const item of items) {
        if (!item?.texture || item.texture.destroyed || item.texture.baseTexture?.destroyed || !item.instanceData?.length || item.instanceCount <= 0) continue;
        const texture = item.texture.baseTexture || item.texture;
        const itemGpuCulling = item.gpuCulling === true;
        if (!current || !current.instanced || current.texture !== texture || !sameBatchClip(current, clip) || !sameBatchFilter(current, filterType, filterAmount) || !sameBatchMask(current, maskTexture, maskRect) || current.blendMode !== blendMode || current.gpuCulling !== itemGpuCulling || current.instanceStride !== (item.instanceStride || INSTANCE_FLOATS) || (itemGpuCulling && current.gpuOwner !== renderable)) {
          current = takeBatch(scratch);
          current.texture = texture; setBatchClip(current, clip); current.filterType = filterType; current.filterAmount = filterAmount; current.maskTexture = maskTexture; current.maskRect = maskRect; current.blendMode = blendMode; current.instanced = true; current.gpuCulling = itemGpuCulling; current.gpuOwner = itemGpuCulling ? renderable : null; current.instanceStride = item.instanceStride || INSTANCE_FLOATS; current.gpuSource = item.gpuSource === true; current.order = order++;
        }
        if (current.instanceCount === 0 && current.instanceValues.length === 0) current.instanceData = item.instanceData;
        else {
          if (current.instanceData) { for (const value of current.instanceData) current.instanceValues.push(value); current.instanceData = null; }
          for (const value of item.instanceData) current.instanceValues.push(value);
        }
        current.instanceCount += item.instanceCount;
        current.vertexCount += item.instanceCount * INSTANCE_VERTEX_COUNT;
      }
      continue;
    }
    const items = renderable.getRenderItems ? renderable.getRenderItems(camera, width, height) : (() => {
      const bounds = renderable.getLocalBounds();
      return [{ texture: renderable.texture, tint: renderable.tint, alpha: 1, positions: [bounds.x, bounds.y, bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height], uvs: [renderable.texture.u0, renderable.texture.v0, renderable.texture.u1, renderable.texture.v0, renderable.texture.u1, renderable.texture.v1, renderable.texture.u0, renderable.texture.v0, renderable.texture.u1, renderable.texture.v1, renderable.texture.u0, renderable.texture.v1] }];
    })();
    if (renderable.lastCulledCount) { culledCount += renderable.lastCulledCount; renderable.lastCulledCount = 0; }
    for (const item of items) {
      const texture = item.texture;
      const itemAlpha = Number.isFinite(Number(item.alpha)) ? Math.max(0, Math.min(1, Number(item.alpha))) : 1;
      const effectiveAlpha = itemAlpha * renderAlpha;
      if (!texture || texture.destroyed || texture.baseTexture?.destroyed || effectiveAlpha <= 0 || !item.positions?.length) continue;
      const gpuTexture = texture.baseTexture || texture;
      if (item.bounds && renderable.cullable !== false) {
        setBoundsCorners(boundsCorners, item.bounds);
        let itemMinX = Infinity; let itemMinY = Infinity; let itemMaxX = -Infinity; let itemMaxY = -Infinity;
        for (let index = 0; index < boundsCorners.length; index += 2) {
          renderable.worldMatrix.transformPoint(boundsCorners[index], boundsCorners[index + 1], localPoint);
          camera.worldToScreen(localPoint.x, localPoint.y, screenPoint);
          itemMinX = Math.min(itemMinX, screenPoint.x); itemMinY = Math.min(itemMinY, screenPoint.y); itemMaxX = Math.max(itemMaxX, screenPoint.x); itemMaxY = Math.max(itemMaxY, screenPoint.y);
        }
        if (itemMaxX < 0 || itemMinX > width || itemMaxY < 0 || itemMinY > height) { culledCount += 1; continue; }
      }
      screenPoints.length = 0;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      for (let index = 0; index < item.positions.length; index += 2) {
        renderable.worldMatrix.transformPoint(item.positions[index], item.positions[index + 1], localPoint);
        camera.worldToScreen(localPoint.x, localPoint.y, screenPoint);
        screenPoints.push(screenPoint.x, screenPoint.y);
        minX = Math.min(minX, screenPoint.x); minY = Math.min(minY, screenPoint.y);
        maxX = Math.max(maxX, screenPoint.x); maxY = Math.max(maxY, screenPoint.y);
      }
      if (renderable.cullable !== false && (maxX < 0 || minX > width || maxY < 0 || minY > height)) { culledCount += 1; continue; }
      if (!current || current.instanced || current.texture !== gpuTexture || !sameBatchClip(current, clip) || !sameBatchFilter(current, filterType, filterAmount) || !sameBatchMask(current, maskTexture, maskRect) || current.blendMode !== blendMode) {
        current = takeBatch(scratch);
        current.texture = gpuTexture; setBatchClip(current, clip); current.filterType = filterType; current.filterAmount = filterAmount; current.maskTexture = maskTexture; current.maskRect = maskRect; current.blendMode = blendMode; current.order = order++;
      }
      const rawTint = typeof item.tint === "string" ? Number.parseInt(item.tint.replace(/^#/, ""), 16) : item.tint;
      const tint = Number.isFinite(rawTint) ? rawTint >>> 0 : 0xffffff;
      const red = (tint >> 16 & 255) / 255; const green = (tint >> 8 & 255) / 255; const blue = (tint & 255) / 255;
      for (let index = 0; index < screenPoints.length; index += 2) {
        const u = item.uvs?.[index] ?? (index % 4 === 0 ? texture.u0 : texture.u1);
        const v = item.uvs?.[index + 1] ?? (index % 4 < 2 ? texture.v0 : texture.v1);
        const colorIndex = (index / 2) * 4;
        const itemColorAlpha = Number.isFinite(Number(item.colors?.[colorIndex + 3])) ? Math.max(0, Math.min(1, Number(item.colors[colorIndex + 3]) * renderAlpha)) : effectiveAlpha;
        current.values.push(screenPoints[index], screenPoints[index + 1], u, v, item.colors?.[colorIndex] ?? red, item.colors?.[colorIndex + 1] ?? green, item.colors?.[colorIndex + 2] ?? blue, itemColorAlpha);
      }
      current.vertexCount += screenPoints.length / 2;
    }
    if (isStatic) {
      const staticBatch = current;
      current = null;
      if (staticBatch && staticBatch.vertexCount > 0) {
        staticBatch.data = new Float32Array(staticBatch.values);
        staticBatch.values = null;
        staticBatch.staticOwner = renderable;
        staticBatch.staticKey = staticKey;
        renderable.staticRenderCache = { key: staticKey, texture: staticBatch.texture, data: staticBatch.data, vertexCount: staticBatch.vertexCount };
      } else {
        renderable.staticRenderCache = { key: staticKey, texture: null, data: null, vertexCount: 0 };
      }
    }
  }

  for (const batch of batches) {
    if (batch.instanced) {
      if (batch.instanceValues.length > 0) {
        if (!batch.instanceData || batch.instanceData.length !== batch.instanceValues.length) batch.instanceData = new Float32Array(batch.instanceValues.length);
        batch.instanceData.set(batch.instanceValues);
      }
      batch.instanceValues.length = 0;
    } else if (batch.values?.length > 0) {
      if (!batch.data || batch.data.length !== batch.values.length) batch.data = new Float32Array(batch.values.length);
      batch.data.set(batch.values);
      batch.values.length = 0;
    }
  }
  trimBatchPool(scratch);
  let visibleCount = 0;
  let scissorCount = 0;
  for (const batch of batches) {
    if (batch.vertexCount <= 0) continue;
    batches[visibleCount++] = batch;
    if (batch.clip) scissorCount += 1;
  }
  batches.length = visibleCount;
  const result = scratch.result || (scratch.result = {});
  result.batches = batches;
  result.nodeCount = orderedRenderables.length;
  result.culledCount = culledCount;
  result.scissorCount = scissorCount;
  result.width = width;
  result.height = height;
  result.stride = FLOATS_PER_VERTEX;
  result.renderOrderRebuilds = scratch.renderOrderRebuilds;
  return result;
}
