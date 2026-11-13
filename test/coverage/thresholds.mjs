// ExiEngine coverage thresholds — minimum line coverage per module.
// Since phase 2: the unit suite has grown (14 files / ~145 tests then); nearly all unit modules are 85%+.
// The renderers (webgl2/webgpu) depend on a GPU; hardware-soak completes them.
// NOTE: these are tooling thresholds, NOT a softening of tests; they are raised as the unit suite grows.

export const thresholds = {
  // Unit modules — high threshold (targeted directly by unit tests)
  "src/core/math.js": 90,
  "src/core/pathfinding.js": 90,
  "src/core/profiler.js": 90,
  "src/core/camera.js": 95,
  "src/core/node.js": 90,
  "src/core/sprite.js": 90,
  "src/assets/texture.js": 90,
  "src/core/animation.js": 95,
  "src/core/animated-sprite.js": 85,
  "src/assets/render-texture.js": 90,
  "src/core/nine-slice-sprite.js": 90,
  "src/index.js": 90,
  "src/assets/texture-atlas.js": 90,
  "src/render/instanced.js": 90,
  "src/render/clear.js": 95,
  "src/render/scissor.js": 95,
  "src/render/post-process.js": 95,
  "src/render/batch.js": 90,
  "src/render/webgl2-renderer.js": 75,
  "src/render/webgpu-renderer.js": 85,
  "src/audio/audio-manager.js": 90,
  "src/core/exi-engine.js": 55,
  "src/core/input.js": 90,
  "src/core/collision.js": 85,
  "src/core/graphics.js": 95,
  "src/core/tilemap.js": 85,
  "src/core/sprite-batch.js": 90,
  "src/core/particle-emitter.js": 90,
  "src/core/text.js": 95,
  "src/core/render-group.js": 80,
  "src/assets/asset-loader.js": 85,
  "src/assets/save-store.js": 90,
  "src/assets/ktx2.js": 90,
};
