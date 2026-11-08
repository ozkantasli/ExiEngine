// Methods used by the renderer, validators, or cache internals are not part
// of the AI-facing engine contract even when JavaScript exposes them.
const internalMethods = new Map([
  ["AnimatedSprite", new Set(["assertFrameLimit"])],
  ["Animator", new Set(["assertTweenLimit"])],
  ["AssetLoader", new Set(["assertCacheBudget", "assertConfigBudget", "cacheTexture", "createRequestSignal", "decoderKey", "ensureActive", "getCachedTexture", "resolveJSONBytes", "resolveJSONDepth", "resolveJSONNodes", "resolveMaxBytes", "trackPending"])],
  ["AudioManager", new Set(["assertBudget", "ensureActive", "ensureContextWithoutBuses", "stopVoicesForBuffer"])],
  ["ExiEngine", new Set(["detectCanvasSizing", "dispatchKeyEvent", "dispatchPointerEvent", "dispatchPointerInput", "dispatchPointerState", "fallbackToWebGL", "pointerHandlerName", "pointerHoverTargetFor", "pointerTargetFor", "replaceCanvas", "reportRuntimeError", "resolvePointerHit", "resolvePointerHoverHit", "selectBackend"])],
  ["GlyphAtlas", new Set(["assertBudget", "getGlyph", "renderText"])],
  ["Graphics", new Set(["getRenderItems", "getStaticRenderKey"])],
  ["Input", new Set(["actionState", "updateGamepads"])],
  ["Node", new Set(["collectSprites"])],
  ["NineSliceSprite", new Set(["getRenderItems"])],
  ["ParticleEmitter", new Set(["assertParticleLimit", "getInstanceItems", "getRenderItems"])],
  ["PhysicsWorld", new Set(["assertBodyLimit", "firstSolidOverlap", "hasSolidOverlap", "sweepSolid", "syncCollisionIndex"])],
  ["RenderGroup", new Set(["getLocalBounds", "getPostProcessState", "getRenderItems", "syncEffectTargets", "updateOffscreenWorldMatrix"])],
  ["SaveStore", new Set(["assertBudget"])],
  ["Sprite", new Set(["getRenderItems"])],
  ["SpriteBatch", new Set(["buildChunk", "buildGpuSourceChunk", "buildInstanceChunk", "buildSpatialIndex", "getChunkBounds", "getIndicesBounds", "getInstanceItems", "getRenderItems", "getStaticRenderKey", "getVisibleSpatialCellRange", "getVisibleSpriteIndices", "hasInstanceCache", "invalidate", "isChunkVisible", "mergeCpuInstanceItems", "saveInstanceCache", "validateSpriteAnimation", "validateSpriteTexture"])],
  ["Text", new Set(["releaseTexture"])],
  ["TextCache", new Set(["acquire", "assertBudget", "release", "remove"])],
  ["TextureAtlas", new Set(["invalidateIfTextureDestroyed"])],
  ["TileMap", new Set(["getFrame", "getInstanceItems", "getLocalBounds", "getRenderItems", "getStaticRenderKey", "getVisibleTileIndices", "hasInstanceCache", "saveInstanceCache", "validateTileIndex"])],
]);

export function isPublicMethod(ownerName, method) {
  return typeof method === "string" && !method.startsWith("_") && !internalMethods.get(ownerName)?.has(method);
}
