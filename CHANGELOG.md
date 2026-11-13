# Changelog

All notable changes to ExiEngine. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/) (0.x: minor versions may change APIs).

## [0.3.0] — unreleased

Content, authoring and game-feature release. Everything stays dependency-free.

### Added
- **Packaging:** npm-ready `package.json` (conditional exports, types, `files` allowlist),
  zero-dependency bundler `tools/build.mjs` producing `dist/exi-engine.js` (ESM) and
  `dist/exi-engine.global.js` (`globalThis.Exi`); `npm run build`, built on `prepack`.
- **Level import:** `TileMap.fromTiled` / `TileMap.tiledTileIdsWithProperty` (Tiled `.tmj`) and
  `tileMapFromLDtk` / `ldtkIntGrid` / `ldtkEntities` (LDtk).
- **Scenes:** `serializeScene` / `deserializeScene` JSON documents (same shape as MCP
  `exi_build_scene`), `node.data` metadata, `watchScene` hot reload (polling and BroadcastChannel).
- **Editor** (`/editor/`): hierarchy, inspector, drag/snap, tile painting, undo/redo, texture import,
  autosave, save straight into project files, live **Play** window with physics preview, prefabs
  (`instantiatePrefab` for runtime spawning).
- **Physics:** `RigidBodyWorld` / `RigidBody` (circles, boxes, convex polygons, rotation, friction,
  restitution, stable stacking, sensors, layers), `RevoluteJoint` (with motor), `WeldJoint`,
  `PrismaticJoint` (limits, motor), `DistanceJoint` (rod/rope),
  `RevoluteJoint` angle limits (`lowerAngle`/`upperAngle`, `setLimits`, `jointAngle`),
  damped springs and bungees through `DistanceJoint` `frequency`/`dampingRatio` (`setSpring`, `currentLength`),
  anti-tunneling (speculative contacts + substeps).
- **Rendering:** `blur`, `glow`, `outline`, `pixelate`, `vignette` filters (`FILTER_TYPES`),
  `LightLayer` 2D lighting with optional normal maps (`normals: true`, `addNormalMap`), `BitmapFont` / `BitmapText` (AngelCode BMFont), `registerFilter` custom
  filter bodies (GLSL + WGSL, bounded, not reachable by AI agents).
- **Audio:** audio sprites (`addSprites`), slices and loop regions, `playbackRate`, deterministic 2D
  spatial audio (`setListener`, `configureSpatial`, `setVoicePosition`).
- **Multiplayer:** `RollbackSession`, transport-agnostic rollback netcode with desync detection.
- **UI:** `Button`, `Slider`, `TextInput` (IME and mobile keyboards through a hidden input), `ScrollView`,
  `Checkbox`, `Dropdown`, `Stack` and `Grid` layout containers.
- **Examples:** platformer (Tiled), top-down (A*, lighting), normal-mapped lighting, physics sandbox, UI menu, UI widgets;
  `npm run test:e2e:examples` drives them and the editor in Chromium.

### Changed
- All runtime, MCP and lint messages are English; existing `EXI_*` error codes are unchanged.
- RenderGroup targets are cleared to transparent, so a group no longer covers the scene behind
  its empty area.
- `Input` registers `keydown` as a non-passive listener.
- MCP `exi_api` has its own 256 KiB output bound (`limits.maxApiOutputBytes`) so the growing manifest fits;
  every other tool output stays at 64 KiB.
- The competitor analysis now targets web 2D engines (Phaser, PixiJS, Excalibur, KAPLAY,
  melonJS, GDevelop, Construct, Godot web).

### Fixed
- WebGL2 drew RenderGroups without effects, RenderTexture sprites and render-target masks upside down.
- Text cut accents above capitals (Ö, Ü, Ç, Ş, İ …).
- `Graphics.roundedRect` failed when the radius was half a side (pills, round buttons).
- Tab focus navigation could not `preventDefault` inside a passive listener.
- Double-encoded UTF-8 in several error messages; wrong `TileMap` and `Text` examples in API.md.
- Widget pointer math ignored parent transforms, so widgets nested in containers or groups missed clicks.
- A key, action, pointer or gamepad press was reported to every fixed step of a slow frame (toggles fired twice)
  and key/gamepad presses were dropped in frames that ran no fixed step; each press now reaches exactly one step.
- `deserializeScene` placeholders now keep missing texture ids instead of rewriting them to `"white"`.

## [0.2.0]

Hardening release: bounded 2D physics/collision, deterministic fixed-step ordering, A* pathfinding,
asset pipeline (Texture, atlas, loader, save, KTX2), security and lifecycle bounds, benchmark and
release gates, MCP bridge.
