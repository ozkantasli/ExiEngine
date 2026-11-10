# ExiEngine API and AI/MCP reference

This file describes ExiEngine's runtime API and the AI CLI bridge in one place. The verified JavaScript export surface is in [src/index.js](src/index.js), the TypeScript signatures in [index.d.ts](index.d.ts), the security rules in [SECURITY.md](SECURITY.md) and the MCP client settings in [MCP.md](MCP.md). This document is a conceptual starting point and a reference with examples; for signature changes, `index.d.ts` is authoritative.

## 1. Design contract

ExiEngine does not import another game engine at runtime. The core scene graph, 2D geometry, input, physics, audio, assets, batching and the WebGL2/WebGPU backends live in the repository.

- There are no runtime dependencies.
- WebGPU is preferred; WebGL2 is used when it is not supported or when `webgl2` is selected.
- Node.js is for tests, the MCP bridge and the local preview; the browser canvas and Web Audio are the real runtime.
- Assets, JSON, URLs, input, callbacks and GPU resources are treated as untrusted or bounded boundaries.
- Public collections and config fields are re-validated on hot-path inputs even when they look directly mutable.
- Browser/GPU results cannot be inferred from the Node smoke test; real device evidence is collected separately with `test/hardware-soak.html`.

## 2. Setup and first game

With Node.js in the repository root:

```powershell
npm run doctor
npm test
npm run dev
```

The following minimal game can be added to the canvas in `index.html` or to your own HTML page:

```js
import { ExiEngine, Graphics, Scene } from "/src/index.js";

const scene = new Scene();
scene.add(new Graphics({ x: 120, y: 80 })
  .rect(0, 0, 128, 80, { fill: 0x5eead4 }));

const engine = await ExiEngine.create({
  canvas: document.querySelector("canvas"),
  scene,
  width: 960,
  height: 540,
  renderer: "auto",
});

engine.start();
```

`ExiEngine.create()` sets up the renderer, sizes the canvas, binds the scene and returns a ready engine. If you need a manual lifecycle, use `new ExiEngine(options)`, `await engine.init()` and `engine.start()`. `step(delta)` is only for a deterministic/custom loop while the engine is not running.

## 3. Types and common values

`RendererKind`: `"auto" | "webgpu" | "webgl2"`.

`ResizeMode`: `"resize" | "contain" | "cover"`.

`BlendMode`: `"normal" | "additive" | "multiply"`.

`FilterKind` (also exported as `FILTER_TYPES`): color filters `"none" | "grayscale" | "invert" | "brightness" | "sepia" | "contrast" | "saturate"`, spatial filters `"blur" | "glow" | "outline" | "pixelate"` and `"vignette"`. `filterAmount` is 0..1 for all of them (blur radius up to 4 px, glow radius up to 8 px, outline thickness 1-4 px in white, pixel blocks 1-16 px, vignette strength). Spatial filters sample neighbouring texels of the texture being drawn, so they are meant for whole textures: use them as `RenderGroup` effects (`new RenderGroup({ width, height, effects: [{ filter: "outline", amount: 0.5 }, { filter: "glow", amount: 0.6 }] })`) or on sprites with their own texture; on atlas frames, neighbouring frames can bleed in. RenderGroup targets are cleared to transparent, so a group only covers what its children draw.

`Point` `{ x, y }`, `ClipRect` `{ x, y, width, height }`, and `MAX_WORLD_COORDINATE` expresses the finite world-coordinate limit. All significant numeric values must be finite and bounded.

`Vec2` is a mutable 2D vector: `set`, `copy`, `clone`, `add`, `subtract`, `multiplyScalar`, `length`, `lengthSquared`, `normalize`, `dot`, `distanceTo`, `distanceSquared`, `angle`, `rotate`, `equals`. `Mat3` is a 2D affine matrix: `identity`, `setTransform`, `multiply`, `transformPoint`.

Pointer, keyboard, focus and gamepad callback types are defined in `index.d.ts` as `EnginePointerEvent`, `EngineKeyEvent`, `EngineFocusEvent` and `GamepadSnapshot`. Events are transient; do not keep them outside the callback.

Safe utility exports: `clamp(value, min, max)`, `lerp(from, to, amount)`, `degToRad(degrees)`, `radToDeg(radians)`, `getAABB(node, output?)`, `intersectsAABB(first, second)`, `pointInAABB(bounds, x, y)`, `containsAABB(parent, child)`. For KTX2, `inspectKTX2(bytes, options?)` and `VK_FORMAT_R8G8B8A8_UNORM` are exported. These top-level functions hold no state and are called over MCP with `exi_function`; nested export functions use `exi_export_call`.

`findGridPath(grid, start, goal, options?)` runs dependency-free, deterministic A* on a rectangular grid. By default, cells with value `1` are obstacles; behavior can be bounded with the `blockedValues`, `diagonal`, `allowCornerCutting` and `maxNodes` options. `grid` is not modified. The result is `{ path, reached, expanded, truncated }`; `path` is a list of `{ x, y }` points including the start and the goal. The grid can have at most `MAX_GRID_PATH_CELLS` cells, and `maxNodes` must be between 1 and the cell count. If the start/goal is blocked or unreachable within the limit, `reached:false` is returned.

```js
const result = findGridPath(
  [[0, 0, 1], [1, 0, 0], [0, 0, 0]],
  { x: 0, y: 0 },
  { x: 2, y: 2 },
  { diagonal: false, maxNodes: 1000 },
);
// { reached: true, truncated: false, expanded: ..., path: [...] }
```

## 4. Engine lifecycle and renderer

### `ExiEngine`

Constructor options:

```ts
interface EngineOptions {
  canvas: HTMLCanvasElement;
  renderer?: "auto" | "webgpu" | "webgl2";
  width?: number; height?: number;
  resizeMode?: "resize" | "contain" | "cover";
  maxPixelRatio?: number;
  maxTextureBytes?: number; maxTextureCount?: number;
  backgroundColor?: number | string; backgroundAlpha?: number;
  clearBeforeRender?: boolean;
  scene?: Scene; camera?: Camera;
  overlayScene?: Scene | null; overlayCamera?: Camera | null;
  animator?: Animator | null; physics?: PhysicsWorld | null;
  fixedStep?: number; maxFrameDelta?: number; timeScale?: number;
  interpolate?: boolean; pauseOnHidden?: boolean; pauseAudio?: boolean;
  onUpdate?: (delta: number, engine: ExiEngine) => void;
  onRender?: (engine: ExiEngine, profiler: Profiler) => void;
  onStatus?: (status: EngineStatus) => void;
}
```

> **Canvas replacement on fallback.** With `renderer: "auto"`, a failed or lost WebGPU
> backend falls back to WebGL2 on a fresh clone of the canvas (a canvas cannot switch
> context types). DOM listeners you attached to the original canvas do not move with it:
> attach them to a stable parent element, or always read the current canvas from
> `engine.canvas`. The engine's own `Input` is re-created on the new canvas automatically.

Main lifecycle methods:

- `static create(options): Promise<ExiEngine>`: async backend setup in the browser.
- `init(): Promise<this>`: renderer and input preparation; concurrent calls share a single setup. If setup fails, the engine cleans up its own resources and is destroyed; create a new engine to retry. An externally provided scene is not destroyed.
- `start(): this`, `stop(): this`: RAF loop management; `stop()` also suspends engine-owned audio.
- `pause(): this`, `resume(): this`: controlled pausing of the simulation; a pause caused by a hidden tab is tracked separately as `visibilityPaused`.
- `lifecycleState`: the derived state `created | ready | running | paused | visibility-paused | stopped | destroyed`; the `running`/`paused` fields stay writable for backward compatibility.
- `step(delta): this`: a single bounded frame for a custom loop.
- `destroy(): void`: teardown of the renderer, input, audio, assets and event listeners.
- `prepare(): { batches, uploads }`: allocation/upload preparation for the first visible frame.
- `getInfo(): Record<string, unknown>`: backend, limit, texture, batch, frame and lifecycle metrics.
- `setScene(scene, camera?)`, `setOverlay(scene, camera?)`: make scene changes atomic together with the pointer/cache lifecycle.
- `setLogicalSize(width, height)`, `setResizeMode(mode)`, `resize()`: the responsive canvas contract.
- `setTimeScale(value)`: bounded `0..16` simulation scale.
- `focus(node?)`, `blur()`, `focusNext(reverse?)`: canvas UI focus.
- `renderToTexture(target, scene?, camera?, time?)`: offscreen render pass.
- `captureFrame({ columns?, rows? })`: renders into a temporary RenderTexture of at most 64×64 and returns the GPU readback result (`pixels`, `format`, `flipY`); the AI observer turns this into a bounded grid instead of a raw image.

Renderer errors are reported through `onStatus` as events with metadata such as `renderer-error`, `runtime-error` and `device-lost`. A callback exception must not break the lifecycle.

## 5. Scene graph

### `Node` and `Scene`

```js
const root = new Scene();
const player = new Node({ name: "player", x: 100, y: 80, interactive: true });
root.add(player);
player.setAlpha(0.9).setBlendMode("normal");
player.setCullBounds({ x: -32, y: -32, width: 64, height: 64 });
```

`Node` transform fields are `position`, `scale`, `rotation` and `zIndex`; visibility fields are `visible`, `alpha`, `filter` and `blendMode`; interaction fields are `interactive`, `hitArea`, and the focus and pointer callbacks.

Core methods:

- `add(...nodes)`: adds and reparents children; checks for cycles, duplicates, destroyed nodes and capacity.
- `remove(node)`: detaches a child.
- `destroy()`: removes the child graph and attached resources from the lifecycle.
- `setClipRect`, `setMaskRect`, `setMaskTexture`, `setCullBounds`, `setHitArea` and the related `clear*` methods.
- `setInteractive`, `setPointerHandlers`, `setUpdateHandler`, `setFocusHandlers`, `setFocusable`.
- `setLayout`, `clearLayout`, `applyLayout`: overlay viewport layout.
- `traverse(callback)`, `find(predicate)`, `findByName(name)`: safe search and traversal of the scene graph.
- `containsPoint(worldX, worldY)`, `isAncestorOf(node)`, `collectFocusables`.
- `update(delta)`, `updateWorldMatrix(...)`, `collectRenderables(...)`, `collectHitTestables(...)`: mostly called by the engine.

`Scene.pick(worldX, worldY, predicate?)` selects an interactive node by world transform and z-order. Pointer events bubble from child to parent; `stopPropagation()` and `preventDefault()` are available.

### `Camera`

```js
const camera = new Camera({ width: 960, height: 540, zoom: 1, roundPixels: true });
camera.follow(player, { smoothing: 8, deadzoneWidth: 160, deadzoneHeight: 90 });
camera.setBounds({ x: 0, y: 0, width: 4000, height: 2000 });
camera.shake(8, 0.25, { frequency: 30 });
const visibleBounds = camera.getVisibleBounds();
```

Provides `worldToScreen`, `screenToWorld`, `getVisibleBounds`, `setViewport`, `setScreenViewport`, `setPixelRatio`, `setRoundPixels`, `setBounds`, `zoomAt`, `follow`, `clearFollow`, `shake`, `clearShake` and `update`. In `contain` mode, the letterbox area is not valid for pointers.

## 6. Renderable classes

### `Texture`, `RenderTexture`

```js
const white = Texture.white;
const spriteTexture = Texture.fromImage(image, { id: "player", filter: "nearest" });
const frame = spriteTexture.subTexture({ x: 0, y: 0, width: 32, height: 32 });
const target = new RenderTexture({ id: "minimap", width: 320, height: 180 });
```

`Texture` includes the static `white`, `fromImage`, `subTexture`, `setFilter`, `markDirty`, `updateSource` and `destroy`. A `Texture` subtexture shares the base GPU resource; destroying a subtexture does not take ownership of the base texture.

`RenderTexture` is the target for minimaps/portals/UI with `resize`, `subTexture` and `updateSource`. During `renderToTexture`, rendering a source into the same texture as the target is rejected as a feedback loop.

### `Sprite`

```js
const sprite = new Sprite({
  texture: Texture.white,
  x: 320, y: 180, width: 64, height: 64,
  anchorX: 0.5, anchorY: 0.5,
});
sprite.setTint("#f97316").setFlip(true, false);
scene.add(sprite);
```

Provides `setTexture`, `setTint`, `setFlip` and `getLocalBounds`. `flipX/flipY` are applied at the UV level; they do not grow the geometry stride.

### `NineSliceSprite`

Scales a panel texture with `left/right/top/bottom` borders. Use `setBorders`, `setSize` and `getLocalBounds`.

### `Text`, `TextCache`, `GlyphAtlas`

```js
const score = new Text({ text: "SCORE 000", fontFamily: "sans-serif", fontSize: 24, fill: "#fff" });
score.setStyle({ wordWrap: true, maxWidth: 240 });
hud.add(score);
score.setText("SCORE 001");
```

`Text.setText`, `setStyle` and `redraw` manage the Canvas 2D raster cache. `TextCache` shares repeated identical style/text pairs with bounded reference counting. `GlyphAtlas` reduces glyph rasterization and provides `getInfo`, `clear` and `destroy`. The Canvas fallback is kept for complex shaping.

### `Graphics`

```js
const shape = new Graphics({ staticCache: true })
  .rect(0, 0, 100, 40, { fill: 0x22c55e })
  .roundedRect(120, 0, 100, 40, 8, { fill: 0x3b82f6 })
  .circle(260, 20, 20, { fill: 0xfacc15 })
  .ellipse(320, 20, 30, 15, { fill: 0xa855f7 })
  .triangle(380, 0, 410, 40, 350, 40, { fill: 0xec4899 })
  .line(0, 80, 200, 80, 4, { fill: 0xffffff })
  .strokeRect(220, 60, 60, 40, 2, { fill: 0x14b8a6 })
  .strokeCircle(320, 80, 20, 2, { fill: 0xf97316 })
  .polygon([0, 120, 40, 120, 20, 150], { fill: 0xef4444 });
```

Provides `clear`, `rect`, `roundedRect`, `circle`, `ellipse`, `triangle`, `line`, `strokeRect`, `strokeCircle`, `polygon` and `getLocalBounds`. Polygon ear-clipping and command/point limits are kept bounded by the engine.

### `SpriteBatch`

Removes per-node overhead in dense sprite layers that use a single texture/atlas:

```js
const batch = new SpriteBatch({ texture: Texture.white, instanced: true, gpuCulling: true });
const index = batch.addSprite({ x: 10, y: 20, width: 16, height: 16, tint: 0xffffff });
batch.setSprite(index, { x: 40 });
batch.markDirty();
```

Provides `addSprite`, `addSprites`, `setSprite`, `removeSprite`, `clear`, `setTexture`, `setFrame`, `getLocalBounds`, and for animation `addAnimatedSprite`, `setSpriteAnimation`, `playSprite`, `stopSprite`, `gotoSpriteFrame` and `updateAnimations`. `instanced` is WebGL2/WebGPU instancing; `gpuCulling` is the WebGPU compute/indirect path, with a safe CPU fallback on WebGL2.

### `AnimatedSprite`

Provides `setFrames`, `gotoFrame`, `play`, `stop` and `update`. The output of `TextureAtlas.getClip()` can be passed directly to the constructor; the frame array is snapshotted. With `loop: false`, `completed` becomes true when the animation ends naturally; `play()` restarts a completed animation from frame 0.

### `ParticleEmitter`

Uses a bounded object pool with `emit(count, options?)`, `burst(count, options?)`, `clear()`, `count` and `update(delta)`. `gpuCulling: true` leaves world/cull work to the compute stage on WebGPU.

### `TileMap`

```js
const map = new TileMap({ columns: 100, rows: 60, tileWidth: 16, tileHeight: 16, texture: atlasTexture });
map.setTile(4, 8, 2, { flipX: true });
map.setRegion(0, 0, 10, 10, values);
const staticBodies = map.createStaticBodies(physics, { solidTiles: new Set([1, 2]) });
```

Provides `index`, `inBounds`, `setTile`, `getTile`, `setTiles`, `setRegion`, `rebuild`, `getCollisionRects` and `createStaticBodies`. It does not create a Sprite per tile; typed-array and region inputs are validated atomically.

#### Tiled import

```js
const level = await loader.loadJSON("/maps/level1.tmj");
const tileset = await loader.loadTexture("/maps/tiles.png");
const ground = TileMap.fromTiled(level, { texture: tileset, layer: "Ground" });
const solid = TileMap.tiledTileIdsWithProperty(level, "solid");
ground.createStaticBodies(physics, { solidTiles: solid });
```

`TileMap.fromTiled(map, { texture, layer?, tileset?, ...nodeOptions })` builds one TileMap from one tile layer of a [Tiled](https://www.mapeditor.org) JSON (`.tmj`) map. `layer` and `tileset` select by index or name (defaults: first tile layer, first tileset). Layer `offsetx`/`offsety`, `opacity`, `visible` and `name` are applied on top of the node options, and horizontal/vertical flip bits become `flipX`/`flipY`. Supported: finite orthogonal maps, CSV-array or uncompressed base64 data, embedded or external tilesets (external tilesets are only range-checked against the texture grid). Rejected with an explicit error instead of rendering wrong: infinite/chunked maps, compressed data, non-orthogonal orientation, diagonal-flip (rotated) tiles, tileset margin/spacing, a tile size that differs from the map, and layers that mix tiles from several tilesets (create one TileMap per tileset/layer). `TileMap.tiledTileIdsWithProperty(map, name, { tileset?, value = true })` returns the local tile ids whose custom property equals `value`, ready for `solidTiles`.

### `RenderGroup`

Collects its children in a RenderTexture pass. Provides `resize`, `setEffects`, `clearEffects`, `getEffects` and `getRenderCamera`. The effect list consists of allowlisted filters and uses a bounded ping-pong target.

### Scene serialization

```js
const document = serializeScene(scene);                       // plain JSON-safe object
localStorage.setItem("level", JSON.stringify(document));
const report = {};
const restored = deserializeScene(JSON.parse(localStorage.getItem("level")), {
  textures: { tiles: tilesetTexture, hero: heroTexture },     // Map, record or resolveTexture(id)
  report,                                                     // { nodes, missingTextures }
});
engine.setScene(restored);
```

Documents are `{ format: "exi-scene", version: 1, root }`, where every node is the same `{ type, options, children }` shape that MCP `exi_build_scene` accepts. Supported types are `SERIALIZABLE_NODE_TYPES` (`Scene`, `Node`, `Sprite`, `NineSliceSprite`, `Text`, `Graphics`, `TileMap`); common transform/visual/interaction fields, Sprite/Text style, Graphics commands (polygons keep their source points) and TileMap tiles/flip flags are stored. Callbacks and caches are never stored and loading never evaluates code: unknown types or option keys, non-finite numbers, over-long strings and documents past `MAX_SERIALIZED_NODES` (10 000) nodes or depth 64 are rejected. Textures are stored by id (`"white"` for `Texture.white`); an unresolved id becomes a sourceless placeholder (drawn white) that keeps the original id, so saving again never loses the reference; it is listed in `report.missingTextures`, or loading throws with `strict: true`. Unsupported nodes (particles, batches, render groups) throw on save unless `unsupported: "skip"` is passed, which lists them in `document.skipped`.

## 7. Atlases and asset loading

### `TextureAtlas`

```js
const atlas = TextureAtlas.fromGrid(texture, {
  frameWidth: 32, frameHeight: 32, columns: 8, rows: 4,
  names: ["idle-0", "idle-1" /* ... */],
});
const clip = atlas.getClip(["idle-0", "idle-1"], { frameRate: 8, loop: true });
```

Provides `get`, `getFrames`, `getClip`, `has`, `destroy`, `fromJSON`, `fromGrid` and `pack`. Frames must stay within the atlas texture bounds; `rotated`/`trimmed` metadata is deliberately rejected.

### `AssetLoader`

```js
const assets = new AssetLoader({
  baseURL: location.href,
  maxBytes: 8 * 1024 * 1024,
});

const config = await assets.loadJSON("data/config.json", {
  integrity: "sha256-...",
  maxJSONBytes: 512 * 1024,
});
const texture = await assets.loadTexture("images/player.png", { mimeType: "image/png" });
const atlas = await assets.loadAtlas("images/player.png", "data/player.json");
```

Methods: `resolve`, `loadBytes`, `loadJSON`, `loadTexture`, `loadAtlas`, `inspectKTX2`, `loadKTX2`, `loadMany`, `release`, `clear`, `destroy`.

The `loadMany` entry format is `{ key, type, url, atlasUrl?, options?, decoder? }`. `type`: `texture`, `json`, `bytes`, `ktx2`, `atlas`. It shares work for the same URL/signal; a caller's abort only cancels that caller's promise. Origin, redirect, credential URL, byte/image/pixel/JSON/cache limits and optional integrity verification are applied.

### KTX2

`inspectKTX2(bytes)` returns bounded header/level information. `loadKTX2` can open RGBA8 on its own path; for compressed Basis/KTX2 the application must provide an explicitly trusted `decoder` adapter. The decoder is never loaded automatically as external asset code.

## 8. Input, animation and physics

### `Input`

Input is attached to the canvas by the engine; `new Input(canvas, options)` is possible for direct use. Provides `bindAction`, `unbindAction`, `bindAxis`, `unbindAxis`, `getBindings`, `setBindings`, `getAxis`, `getActionAxis`, `getVector`, action/key/pointer/gamepad queries, `getPointerWorld`, `rumbleGamepad`, bounded `injectKeyDown`/`injectKeyUp`/`injectPointer`/`inject`, `beginFrame`, `endFrame` and `destroy`.

```js
engine.input.bindAction("jump", "Space");
engine.input.bindAxis("moveX", { type: "key-axis", positive: "KeyD", negative: "KeyA" });
engine.input.bindAxis("moveY", { type: "key-axis", positive: "KeyS", negative: "KeyW" });
if (engine.input.wasActionPressed("jump")) playerJump();
const move = engine.input.getVector("moveX", "moveY");
player.position.x += move.x * 240 * delta;
player.position.y += move.y * 240 * delta;
```

Binding and raw state capacity is bounded; gamepad hot-plug gives a snapshot and does not leak the native Gamepad object.

For AI tests and replays, a deterministic input tape can be applied without generating native DOM events:

```js
engine.stop();
engine.input.inject([{ type: "keydown", code: "ArrowRight" }]);
engine.step(1 / 60);
engine.input.inject([{ type: "keyup", code: "ArrowRight" }]);
engine.step(1 / 60);
```

`inject` accepts up to 128 events; key codes, pointer coordinates, pointerId, button and modifier fields are bounded. This method is not real user permission/OS input; it only feeds the page's own Input state in a controlled way.

### `Tween`, `Animator`, `easing`

```js
const animator = new Animator({ maxTweens: 1024 });
animator.add(new Tween(player.position, "x", 600, 0.8, { ease: easing.outCubic }));
const engine = await ExiEngine.create({ canvas, scene, animator });
```

Provides `Tween.update`, `Animator.add/remove/update/clear` and the `easing` functions (linear, smooth, in/out/inOut quad, cubic, sine, expo, bounce, elastic). If the engine binds the animator to the fixed-step order, the order is `scene → animator → physics → onUpdate`.

### `Collider`, `CollisionWorld`, `PhysicsBody`, `PhysicsWorld`

```js
const physics = new PhysicsWorld({ scene, gravityY: 980 });
const floor = new Node({ x: 0, y: 500 });
const playerBody = new PhysicsBody(player, { maxSpeed: 1200 });
physics.add(new PhysicsBody(floor, { static: true }));
physics.add(playerBody);
const nearbyBodies = physics.overlapCircle(100, 100, 50);
const engine = await ExiEngine.create({ canvas, scene, physics });
```

`Collider` is a generic AABB, `CollisionWorld` provides broadphase/query/raycast/overlapCircle; `PhysicsBody` sets velocity/static/kinematic; `PhysicsWorld` provides add/remove/sync/overlaps/overlapCircle/step/clear and begin/stay/end contact callbacks. Layers/masks, one-way, triggers, local bounds, finite velocity and body/cell capacity are enforced.

### `RigidBodyWorld` and `RigidBody` (rotating rigid bodies)

```js
const world = new RigidBodyWorld({ gravityY: 980, iterations: 10, onContact: (a, b, manifold) => {} });
world.add(new RigidBody({ shape: { type: "box", width: 800, height: 40 }, x: 400, y: 520, static: true }));
const crate = world.add(new RigidBody({
  shape: { type: "box", width: 32, height: 32 },        // or { type: "circle", radius } / { type: "polygon", points: [x, y, ...] }
  x: 300, y: 100, angle: 0.4, friction: 0.6, restitution: 0.1, density: 1,
  node: crateGraphics,                                  // optional: position/rotation are copied to this Node every step
}));
crate.applyImpulse(0, -400, crate.position.x + 10, crate.position.y); // off-center impulses spin the body
const engine = await ExiEngine.create({ canvas, scene, physics: world }); // stepped on the fixed timestep
```

An optional second physics module next to the axis-aligned `PhysicsWorld`: circles, boxes and convex polygons (up to `MAX_POLYGON_VERTICES`, either winding; concave input is rejected) with rotation, mass/inertia from `density`, Coulomb friction, restitution, damping, `gravityScale`, `fixedRotation`, static bodies, sensors (`isSensor`, reported through `onContact` but never blocking) and 32-bit `layer`/`mask` filtering. Collision uses SAT with up to two contact points, sequential impulses with warm starting, a two-point block solver and direct position correction, so stacks and pyramids settle and stay upright; the same inputs and fixed step give the same results. `onContact(a, b, manifold)` fires when a pair starts touching. Polygon bodies are centered on their centroid: draw them with `body.shape.vertices`. Use `PhysicsWorld` for tile platformers (cheaper, one-way platforms, tile bodies); use `RigidBodyWorld` when objects must tumble, roll or stack. Limits: `MAX_RIGID_BODIES` (2 048) bodies, speeds and coordinates are clamped, and there are no joints or continuous collision yet, so very thin, very fast bodies can tunnel.

## 9. Save, audio and profiler

### `SaveStore`

`new SaveStore({ namespace, storage, maxBytes })` provides `key`, `get`, `set` and `remove`. It only stores JSON data; there are namespace/key/byte/node/depth limits. There is no executable/script data.

### `AudioManager`

Provides `ensureContext`, `createBus`, `getBus`, `getBusNames`, `setBusVolume`, `getBusVolume`, `setBusMuted`, `isBusMuted`, `fadeBus`, `stopBus`, `unlock`, `load`, `loadMany`, `play`, `stopVoice`, `stopAll`, `suspend`, `resume`, `setVoiceVolume`, `setVoicePan`, `has`, `unload` and `destroy`.

The AudioContext is subject to the browser's autoplay policy; `unlock()` must be called after a user gesture. Decode byte, decoded byte, voice, bus and lifecycle limits are enforced.

### `Profiler`

Carries frame/fps/frameMs and renderer metrics with `begin(time)`, `end(time, metrics?)` and `snapshot()`.

## 10. AI CLI MCP bridge

Bridge command (direct Node, so the npm banner does not mix into stdout in MCP stdio):

```powershell
node tools/exi-mcp-server.mjs
```

The transport is newline-delimited JSON-RPC stdio only. No logs are written to stdout; error diagnostics go to stderr. `tools/call` requests that touch engine state are processed in a single queue in arrival order; batching several asset loads into one call with `loadMany()` is recommended. A long-running active or queued tool request can be cancelled without producing a response through a JSON-RPC cancellation notification:

```json
{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":42,"reason":"agent stopped waiting"}}
```

`requestId` must be the same as the id of the `tools/call` to cancel. `exi_check`, `exi_project_check` and `exi_project_open` end their child/syntax-check flows, and `exi_preview_start` ends a failed/cancelled preview start, with bounded cleanup. Cancellation is not a tool and no response is sent. The MCP lifecycle order:

If the client gives a request `params._meta.progressToken` on long calls, the bridge sends `notifications/progress`; for example, for `exi_check`, `progress: 0` reports the start and `progress: 1` completion. Progress is only user-interface/heartbeat information; the verifiable result is still the `tools/call` response.

The current MCP `2026-07-28` modern flow has no `initialize`. The client first calls `server/discover`; every modern request carries `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities` and the optional `io.modelcontextprotocol/clientInfo` in `params._meta`:

```json
{"jsonrpc":"2.0","id":"discover-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"my-agent","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
```

Modern result responses contain `resultType: "complete"` and `result._meta["io.modelcontextprotocol/serverInfo"]`. Legacy clients keep using the `initialize` flow below; the bridge accepts both eras in the same stdio process.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"my-agent","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"resources/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/list"}
```

The server supports the modern `2026-07-28` version and the legacy `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05` versions. Standard MCP resources:

| URI | Content |
| --- | --- |
| `exi://api` | Runtime reflection manifest |
| `exi://types` | `index.d.ts` |
| `exi://guide` | AI working contract |
| `exi://security` | Threat model and limits |
| `exi://runtime` | Browser runtime telemetry selector/attribute contract |
| `exi://clients` | Codex/Claude/OpenCode/Gemini/Cursor/Cline/Windsurf stdio config contracts |

### Prompt surface

`prompts/list` returns two reusable workflows: `exi_create_game` (game creation) and `exi_verify_runtime` (static preview + real browser telemetry verification). `prompts/get` only produces bounded text prompts; it performs no shell, file writes or runtime mutation.

```json
{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"exi_create_game","arguments":{"goal":"top-down arena"}}}
```

The client follows the steps in the prompt: `exi_api` → `exi_scaffold` for a new project or `exi_project_open` for an existing one → the normal AI CLI file editor → asset upload with `exi_asset_*` → `exi_project_preview` (or a separate `exi_project_check` + `exi_preview_start`) → `AssetLoader.loadTexture`/`loadAtlas`/`loadJSON` in the browser → `exi://runtime` browser evidence → `exi_check` → cleanup. A client without browser capability must report the runtime step separately from the static HTTP evidence.

### Tool table

| Tool | Purpose |
| --- | --- |
| `exi_api` | Manifest of exports, classes, instance methods, static methods, nested members and canonical routes |
| `exi_create` | Public class constructor call |
| `exi_function` | Top-level public function call |
| `exi_export_get` | Read `Texture.white` or another allowlisted export/static property |
| `exi_export_call` | A function in the nested export tree, such as `easing.linear` |
| `exi_static_call` | Class static method call |
| `exi_call` | Public method on a handle; sync/async results are awaited |
| `exi_inspect` | Return a handle's public method/property metadata without running getters |
| `exi_get` | Read a handle property/getter |
| `exi_set` | Write a property with a public scalar or another handle; no collection replacement |
| `exi_release` | Release a handle and run the owned `destroy()` lifecycle |
| `exi_session_status` | Bounded handle, scope, upload and preview session metadata without running getters |
| `exi_session_reset` | Clear the session's handles |
| `exi_build_scene` | Build a bounded JSON scene graph |
| `exi_scaffold` | Generate a safe starter browser game; staged multi-file commit/rollback |
| `exi_project_open` | Statically check an existing in-repo game and open it into the session scope |
| `exi_project_apply` | Apply up to 16 bounded text files with transactional staging/commit/rollback |
| `exi_file_list` | List allowlisted text files in a scaffolded or opened project with bounded metadata |
| `exi_file_read` | Bounded read of an allowlisted text project file in the repository |
| `exi_file_write` | Create/update an allowlisted text project file in the repository |
| `exi_file_patch` | Atomically replace a single `find` match in an existing text project file |
| `exi_file_begin` | Start a sequential chunk upload for a text project file over 64 KiB |
| `exi_file_chunk` | Add a UTF-8 part to a text chunk upload |
| `exi_file_commit` | Commit a completed text upload to the target file |
| `exi_file_abort` | Clean up a text upload's temporary file |
| `exi_asset_list` | List allowlisted binary game assets in a scaffolded or opened project with metadata |
| `exi_asset_read` | Read a bounded byte range of up to 32 KiB of an allowlisted asset |
| `exi_asset_write` | Upload a bounded binary game asset to a scaffolded or opened project |
| `exi_asset_begin` | Start a sequential chunk upload for an asset over 512 KiB |
| `exi_asset_chunk` | Add a bounded byte part to a chunk upload |
| `exi_asset_commit` | Commit a completed chunk upload to the target file |
| `exi_asset_abort` | Clean up a chunk upload's temporary file |
| `exi_file_check` | Shell-free static check of a `.html`/`.js`/`.mjs`/`.json` file in a scaffolded or opened project |
| `exi_project_status` | Summarize text files, asset metadata, static check and matching preview telemetry in the same session scope in one read-only bounded result |
| `exi_project_check` | Verify all checkable text files of a scaffolded or opened game in one bounded flow |
| `exi_check` | Only `doctor`, `test`, `verify` |
| `exi_preview_start` | Start the repo server on loopback and prepare the preview telemetry channel |
| `exi_preview_call` | Call an allowlisted engine operation through the token-protected demo or scaffold browser RuntimeAgent |
| `exi_preview_batch` | Run up to 8 browser RuntimeAgent operations sequentially in one round trip |
| `exi_preview_probe` | Verify HTML/assets or token-managed runtime telemetry with a preview GET |
| `exi_preview_stop` | Preview process cleanup |
| `exi_batch` | Run up to 128 public tool calls in order |

The MCP `annotations` fields in the `tools/list` response also carry the security intent: `exi_api`, `exi_inspect`, `exi_get`, `exi_session_status`, `exi_project_status`, `exi_project_check`, `exi_check` and `exi_preview_probe` are read-only; `exi_set`, `exi_release`, `exi_scaffold`, `exi_preview_call`, `exi_preview_batch` and `exi_preview_stop` are marked as destructive mutations. These are hints given to the client; the real security boundary is the bridge's validation.

### Tool parameters and results

| Tool | Input | Successful result |
| --- | --- | --- |
| `exi_api` | `{}` | `{ protocol, supportedProtocols[], mcpEra, server, transport, resources, callRoutes, limits, workflow, exports[] }`; each export includes `route`, `methodRoutes`, `staticMethodRoutes`, `members[]` and `staticProperties[]` |
| `exi_session_status` | `{}` | `{ handleCount, protectedHandleCount, handles[], scopes[], assetUploads[], projectFileUploads[], previews[] }`; contains no tokens or temp paths |
| `exi_session_reset` | `{}` | `{ released: true }`; clears handles, uploads and the same session's preview processes |
| `exi_create` | `{ type, args? }` | `{$handle, type}` |
| `exi_function` | `{ name, args? }` | Function result |
| `exi_export_get` | `{ path }` | Constant/static value or protected handle |
| `exi_export_call` | `{ path, args? }` | Awaited async function result |
| `exi_static_call` | `{ type, method, args? }` | Awaited async static method result |
| `exi_call` | `{ handle, method, args? }` | Awaited async instance method result |
| `exi_inspect` | `{ handle }` | `{ handle, type, methods[], properties[] }`; getter values are not read |
| `exi_get` | `{ handle, property }` | Property/getter result |
| `exi_set` | `{ handle, property, value }` | `{ handle, property, value }` |
| `exi_release` | `{ handle }` | `{ released: handle }` |
| `exi_build_scene` | `{ scene: { type, options?, children? } }` | Root `{$handle, type}` |
| `exi_scaffold` | `{ directory?, overwrite? }` | `{ directory, files[] }` |
| `exi_project_apply` | `{ path, files: [{ path, content, expectedVersion? }], overwrite? }` | `{ directory, applied, bytes, files: [{ path, bytes, overwritten }] }`; 16 files/512 KiB total, rollback on error and stale version conflict |
| `exi_file_list` | `{ path }` | `{ directory, files: [{ path, bytes, version: { bytes, mtimeMs } }] }` |
| `exi_file_read` | `{ path, offset?, limit? }` | `{ path, offset, nextOffset, totalBytes, bytes, version: { bytes, mtimeMs }, complete, content }` |
| `exi_file_write` | `{ path, content, overwrite?, expectedVersion?, expectedSha256? }` | `{ path, bytes, sha256, overwritten }`; missing parent folders are created inside the scaffold, a version mismatch returns `EXI_MCP_FILE_CONFLICT`, a hash mismatch returns `EXI_MCP_UPLOAD_INTEGRITY` |
| `exi_file_patch` | `{ path, find, replace }` | `{ path, bytes, replacedBytes, matchCount, overwritten }`; `find` must match exactly once |
| `exi_file_begin` | `{ path, size, overwrite?, expectedVersion?, expectedSha256? }` | `{ fileUploadId, path, expectedBytes, receivedBytes, chunkBytes, expectedSha256? }`; the version and content hash are re-verified at commit |
| `exi_file_chunk` | `{ fileUploadId, offset, content }` | `{ fileUploadId, path, receivedBytes, expectedBytes, remainingBytes, complete }` |
| `exi_file_commit` | `{ fileUploadId }` | `{ fileUploadId, path, bytes, sha256?, overwritten }` |
| `exi_file_abort` | `{ fileUploadId }` | `{ fileUploadId, aborted: true }` |
| `exi_asset_list` | `{ path }` | `{ directory, assets: [{ path, bytes, type, version: { bytes, mtimeMs } }] }` |
| `exi_asset_read` | `{ path, offset?, limit? }` | `{ path, offset, nextOffset, totalBytes, bytes, version: { bytes, mtimeMs }, complete, data: { "$bytes": base64 } }`; the range is at most 32 KiB |
| `exi_asset_write` | `{ path, bytes: { "$bytes": [...]\|base64 }, overwrite?, expectedVersion?, expectedSha256? }` | `{ path, bytes, type, sha256, overwritten }`; missing parent folders are created inside the scaffold, a version mismatch returns `EXI_MCP_FILE_CONFLICT`, a hash mismatch returns `EXI_MCP_UPLOAD_INTEGRITY` |
| `exi_asset_begin` | `{ path, size, overwrite?, expectedVersion?, expectedSha256? }` | `{ uploadId, path, expectedBytes, receivedBytes, chunkBytes, expectedSha256? }`; the version and content hash are re-verified at commit |
| `exi_asset_chunk` | `{ uploadId, offset, bytes: { "$bytes": [...]\|base64 } }` | `{ uploadId, path, receivedBytes, expectedBytes, remainingBytes, complete }` |
| `exi_asset_commit` | `{ uploadId }` | `{ uploadId, path, bytes, type, sha256?, overwritten }` |
| `exi_asset_abort` | `{ uploadId }` | `{ uploadId, aborted: true }` |
| `exi_file_check` | `{ path }` (`.html`, `.js`, `.mjs`, `.json`) | `{ path, kind, ok, code, stdout, stderr, references? }` |
| `exi_project_check` | `{ path }` | `{ directory, ok, files, checked, skipped, failureCount, failures[] }` |
| `exi_project_status` | `{ path }` | `{ directory, ok, projectCheck, files[], assets[], previews: [{ previewId, directory, pagePath, pageUrl, port, ready, runtime }] }`; `exi_project_preview` previews in the same scope, or direct `exi_preview_start` previews whose path is under this project, are matched; without a runtime report it returns `runtime.ok=false` or `telemetry:null` |
| `exi_project_preview` | `{ path, port? }` | `{ ok, phase, directory, projectCheck, preview? }`; runs a static check first and starts no preview on failure; on success returns `preview.previewId/pageUrl` |
| `exi_project_open` | `{ path }` | `{ directory, opened, ok, files, checked, skipped, failureCount, failures[] }`; the same session's file/asset scope after the static check |
| `exi_check` | `{ mode: "doctor" | "test" | "verify" }` | `{ ok, code, stdout, stderr }` |
| `exi_preview_start` | `{ port?, path? }` | `{ previewId, url, pagePath, pageUrl, port, ready, runtime: { path, tokenManaged } }`; if `path` is given, it does not return ready until that in-repo page answers HTTP 200 |
| `exi_preview_call` | `{ previewId, operation, name?, path?, type?, method?, handle?, property?, value?, args? }` | Browser RuntimeAgent result; operation is `function`, `create`, `export_get`, `export_call`, `static_call`, `call`, `inspect`, `get`, `set`, `release`, `observe`, `snapshot` or `scenario` |
| `exi_preview_batch` | `{ previewId, calls, stopOnError? }` | `{ completed, failed, stopped, results[] }`; at most 8 calls, each call picks from the same operation list via its `operation` field; `observe` returns a bounded canvas grid/hash, `snapshot` a bounded scene graph/hash, `scenario` a bounded input/step/observation; later calls can use `{"$result":0}` or `{"$result":0,"$path":"value"}` references |
| `exi_preview_probe` | `{ previewId, path? }` | `{ status, ok, contentType, body }`; `path: "/__exi/runtime"` reads the real browser report with the token |
| `exi_preview_stop` | `{ previewId }` | `{ stopped: previewId }` |
| `exi_batch` | `{ calls: [{ name, arguments? }], stopOnError? }` | `{ completed, failed, stopped, results[] }` |

`args` must be a JSON array in every public function/constructor/static/instance call; if missing, an empty array is used, and other types are rejected with `EXI_MCP_ARGS_TYPE`. A handle reference inside the array is only resolved when it has exactly the form `{ "$handle": "hN" }`; nested option objects are resolved recursively too. For binary APIs, `{ "$bytes": [0, 1, 255] }` or bounded base64 `{ "$bytes": "..." }` is decoded as a `Uint8Array`. `exi_set` rejects method overwrites, collection replacement and replacement of live objects that are not handles.

`tools/list` publishes the top-level input schema of every MCP tool with `additionalProperties:false`. The bridge applies the same gate; a top-level field not in the schema becomes `EXI_MCP_ARGUMENT_UNKNOWN`, a non-object tool argument `EXI_MCP_ARGS_TYPE`, a missing required field `EXI_MCP_ARGUMENT_REQUIRED`, and enum/type/limit/schema violations `EXI_MCP_ARGUMENT_ENUM`, `EXI_MCP_ARGUMENT_TYPE`/`EXI_MCP_ARGUMENT_LIMIT` and `EXI_MCP_ARGUMENT_INVALID` respectively. The asset upload schema explicitly carries the `$bytes` array or base64 form; because nested engine `args` are JSON, handle/byte references are still resolved recursively.

If the result of `exi_call`/`exi_function` is a typed array or `DataView`, the bridge returns the `type`, `length`, `byteLength`, a 16-element `sample` and the bytes in `bytes: { "$bytes": "base64" }`. The inline byte payload is bounded by `exi_api.limits.maxInlineBinaryBytes` (32 KiB); larger results return `bytes: { "truncated": true, "maxInlineBytes": 32768 }`, and `exi_asset_read` must be used for the full asset. Inside `exi_batch`, `{"$result":0,"$path":"bytes"}` binds this bounded byte result back to the next binary API as a `Uint8Array`, so the result of `AssetLoader.loadBytes()` is not lost in the AI call chain. `DataView` samples are bytes, and BigInt typed-array sample values are carried as strings for JSON safety.

`exi_project_open({ path })` validates an existing in-repo folder against the symlink/engine/test/tool/traversal limits, statically checks its checkable HTML/JS/JSON files and returns a successful scope record; a broken project can also be opened with an `ok: false` report so it can be fixed, but a folder with no checkable file/outside the allowlist cannot be opened. After that, `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch` accept the `.css`, `.html`, `.js`, `.json`, `.mjs`, `.md`, `.svg`, `.ts` and `.txt` extensions in project folders created with `exi_scaffold` or opened with `exi_project_open` in the same MCP session. Single-call `exi_file_write` and `exi_file_patch` texts are limited to 64 KiB UTF-8; a patch does not touch the file on zero or several `find` matches. Larger sources can be written up to 4 MiB with the `exi_file_begin` → `exi_file_chunk` → `exi_file_commit` flow. `exi_file_read` returns at most 48 KiB, directly for a normal file and in `offset`/`limit` pages that preserve UTF-8 boundaries for a large file. Listing returns at most 1,024 files/32 folder levels and gives `{ path, bytes, version: { bytes, mtimeMs } }` metadata for each file. When the read/listed `version` is passed in the `expectedVersion` field of `exi_file_write`, `exi_file_begin` or `exi_project_apply` and another change exists, a stale overwrite is rejected with `EXI_MCP_FILE_CONFLICT`; this optimistic guard is not a lock, and an external race window can remain between the last check and the write. `exi_file_write` and chunk commits create missing parent folders inside the project scope; `exi_file_patch` requires an existing file. Engine/test/tool roots, `.env`, credential extensions, binary files, traversal and symlinks are rejected. An existing file is only replaced with `overwrite: true`; direct/chunk overwrites and unique patches first write the new content to a temporary file, keep the old file as a backup and restore it if the rename fails.
`exi_asset_list`/`exi_asset_read`/`exi_asset_write` preserve the scaffolded or `exi_project_open`-opened project scope and the symlink checks. The asset list only returns allowlisted image/audio/font/KTX2 extensions as metadata and gives each resource's `{ bytes, mtimeMs }` version; `exi_asset_read` returns a byte range of at most 32 KiB as `{ "$bytes": base64 }` with `offset`/`limit` without loading the whole file into memory. The upload payload can be `{ "$bytes": [0..255] }` or bounded base64 and is limited to an absolute 512 KiB. The asset tool does not write arbitrary binaries or executables; when replacing an existing file with `overwrite: true`, giving `expectedVersion` stops a stale asset overwrite with `EXI_MCP_FILE_CONFLICT`.
For files over 512 KiB, use the `exi_asset_begin` → `exi_asset_chunk` (offset is always the previous `receivedBytes`) → `exi_asset_commit` order. On an error or when abandoning, call `exi_asset_abort`. A chunk upload writes to a temporary file; uncommitted files are cleaned up on session reset or MCP process shutdown. A single asset is limited to 64 MiB, total pending uploads to 64 MiB and active uploads to 8.

Example binary asset upload:

```json
{"name":"exi_asset_write","arguments":{"path":"ai-game/assets/player.png","bytes":{"$bytes":"iVBORw0KGgo="}}}
```

The payload in this example only shows the flow format; real PNG/audio/KTX2 bytes must be supplied by the application. After the upload, `exi_asset_list`, `exi_preview_probe` and `AssetLoader.loadBytes()` give metadata, HTTP MIME and engine fetch evidence respectively.

Large asset flow:

```json
{"name":"exi_asset_begin","arguments":{"path":"ai-game/assets/world.ktx2","size":600000}}
{"name":"exi_asset_chunk","arguments":{"uploadId":"u1","offset":0,"bytes":{"$bytes":"..."}}}
{"name":"exi_asset_chunk","arguments":{"uploadId":"u1","offset":400000,"bytes":{"$bytes":"..."}}}
{"name":"exi_asset_commit","arguments":{"uploadId":"u1"}}
```
`exi_file_check` preserves the same session scope and the 64 KiB limit; it uses Node's `--check` parse path for `.js`/`.mjs`, first a 16,384-node/32-depth text budget and then `JSON.parse()` for `.json`, and local script/style reference plus traversal/external URL checks for `.html`. It runs no code, opens no shell and does not replace browser/API runtime verification.
`exi_project_check` applies the same checks to at most 128 checkable files in a folder scaffolded or opened with `exi_project_open`; it returns the file list, the number of successful checks and at most 32 error summaries. This static gate does not replace browser runtime evidence; preview and `#exi-runtime` checks must follow.

`exi_api.resources` gives the canonical `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime` and `exi://clients` document URIs, and `exi_api.callRoutes` gives the tool mapping for constructor/function/nested export/static method/instance method/property/inspect and browser runtime operations. The export `route` field in `exi_api.exports[]` carries the tool to use directly, `methodRoutes`/`staticMethodRoutes` the instance and static method routes, and the nested `members[]` and `staticProperties[]` fields their own routes; agents must read these fields and not guess names or URIs. `exi_api.toolInput` gives the strict top-level argument policy, the `EXI_MCP_ARGS_TYPE` top-level and `EXI_MCP_ARGUMENT_TYPE` nested type error codes, the other canonical error codes and the `$bytes` format; `exi_api.limits` is the canonical source of the bridge limits at run time. The timeouts for `exi_check` are `doctor=60s`, `test=180s` and `verify=300s`; the readiness window for `exi_preview_start` is 10 seconds. Select the target game page with `exi_preview_start({ path: "/ai-game/index.html" })`; the `pageUrl` in the result can be handed directly to a browser agent, and the preview is not considered ready until the page answers HTTP 200. The preview server only serves engine/game web extensions and does not expose dot/credential and dependency-lock files.

`exi_preview_call` and `exi_preview_batch` reach the `/src/ai/runtime-agent.js` client added by the root demo or by `exi_scaffold` through a token-protected command/result queue. At startup `RuntimeAgent` provides the `engine` and `scene` handles; these root handles cannot be released, and new objects are kept as handles on the browser side. `exi_preview_batch` runs at most 8 calls sequentially and carries the handle from a create result to the next call with `{"$result":0}`; a safe own-property field of any earlier result object can be selected with `{"$result":1,"$path":"handle"}`. `stopOnError:false` continues with the following calls but provides no transaction/rollback; temporary handles must still be released. Operation names are the same as the MCP engine calls, but handles belonging to the browser API are separate from MCP process handles. This channel only uses the prototype methods/properties of the `src/index.js` export tree and the `engine`/`scene` roots; game callbacks on the instance, such as `onUpdate`/`onRender`, are not listed as callable methods in `inspect` and cannot be run with `exi_call`. The browser `inspect` result also gives the callback names registered on the page in the `callbacks` field; these names can only be used in a `{"$callback":"name"}` reference. There is no eval, `new Function`, arbitrary script or callback serialization. The runtime command payload is limited to 768 KiB, the result to 64 KiB and the wait to 10 seconds. If the RuntimeAgent is not loaded, the call fails with a bounded timeout; a static preview or synthetic telemetry does not count as GPU evidence.

The `observe` operation works with `createEngineObserver(engine)`, which the scaffold/demo page wires up in advance. Instead of a swapchain canvas readback, the engine produces a low-resolution temporary `RenderTexture` and reads the real GPU result with WebGL2 `readPixels` or WebGPU `copyTextureToBuffer`. It downsamples to at most 64×64 sample cells and returns `{ type: "canvas-grid", width, height, columns, rows, grid[], hash, changed, previousHash, nonEmpty, averageLuma }`. The `grid` rows are carried as text with the ` .:-=+*#%@` luminance palette; no raw screenshot, DOM or arbitrary page state is sent. The default resolution is 32×18. `createCanvasObserver(canvas)` can be used as a fallback for custom canvas pages; because it can give an empty/unsuitable result in browsers without GPU swapchain readback support, the scaffold and demo use the engine observer.

The `snapshot` operation returns the default `scene` root, or an explicitly given root handle, as a pre-order scene tree without running getters/callbacks. Each page is limited to 64 nodes, total traversal to 4,096 nodes and depth to 32; paging is done with `args: [{ offset?, limit? }]`. The result has the form `{ type: "scene-snapshot", root, offset, limit, total, nextOffset, truncated, nodes[], hash, changed, previousHash }`; node records carry the handle, parent, type, name/id, transform and visible basic state fields. `hash` shows changes on the same page, and `changed:false` shows that a repeated observation has not changed. This lets the AI understand not just the pixel grid but also the scene structure quickly and in bounded form; no raw object graph, getter, callback or arbitrary script is run.

The `scenario` operation reduces the AI test/replay round trip: `args: [{ frames: [{ delta?, input?, observe?, snapshot? }], resume? }]`. The RuntimeAgent only uses the public `stop()`/`step()`/`start()` paths of the `engine` root and the engine's public `Input.inject()` method; it runs no arbitrary method name, callback or script. At most 16 frames, 512 input events in total, 128 events per frame, 1,024 cells in an observation and 16 nodes/page in a snapshot are accepted. By default, an engine that was running before the scenario is restarted at the end; `resume:false` leaves it stopped. The result has the form `{ type: "runtime-scenario", handle, frames[], frameCount, wasRunning, resumed }`. This is not a transaction; if a frame fails, earlier frames are not rolled back.

For `prompts/get`, `arguments` must be an object; fields not defined for the prompt are rejected with `EXI_MCP_ARGUMENT_UNKNOWN`, non-object prompt arguments with `EXI_MCP_PROMPT_ARGS_TYPE`, and a wrong `goal`/`path` type with `EXI_MCP_ARGUMENT_TYPE`. In JSON-RPC prompt/resource errors, the canonical code is carried in the `error.data.code` field.

### Callback references

For browser calls that take callbacks, such as `Node.traverse`, `Node.find`, `Scene.pick` and input/physics filters, the callback body is not put in the MCP JSON. Add a function that has been through human/agent review to the `runtimeCallbacks` registry in the scaffold's `game.js`; then use `{"$callback":"visit"}` in the `exi_preview_call` or `exi_preview_batch` args. The browser `inspect` result lists the registered names in the `callbacks` field, so the agent does not have to guess names. The RuntimeAgent only resolves names registered on this page; the registry holds at most 256 callbacks and 256 characters per name. An unknown name is rejected with `EXI_RUNTIME_CALLBACK`. Direct process-side `exi_call`/`exi_function` stays JSON-only; callback code must be written in a project file and go through `exi_project_check` and review.

### Batch calls

`exi_batch` can be used to reduce round trips when preparing scenes, files or assets. Calls run sequentially in the same MCP session queue; the result of an earlier call can be referenced in a later call as `{"$result": 0}`. For a field of a result object, use `{"$result": 0, "$path": "fileUploadId"}`; the path is only a safe own-property chain. If a handle result is referenced, the bridge converts it into the safe `{ "$handle": "hN" }` form and resolves it to the real handle. The default `stopOnError: true` stops at the first error; `false` keeps trying the remaining calls. A batch is not a transaction: on failure, earlier completed calls are not rolled back, so call `exi_release` or `exi_session_reset` at the end of the work. Nested `exi_batch` is rejected, and a total limit of 128 calls/64 KiB of results applies.

```json
{"name":"exi_batch","arguments":{"calls":[
  {"name":"exi_create","arguments":{"type":"Node","args":[{"x":80}]}},
  {"name":"exi_get","arguments":{"handle":{"$result":0},"property":"position"}},
  {"name":"exi_set","arguments":{"handle":{"$result":1},"property":"x","value":120}}
]}}
```

A chunked text upload can also be done inside a batch to reduce round trips:

```json
{"name":"exi_batch","arguments":{"calls":[
  {"name":"exi_file_begin","arguments":{"path":"ai-game/src/level.js","size":24}},
  {"name":"exi_file_chunk","arguments":{"fileUploadId":{"$result":0,"$path":"fileUploadId"},"offset":0,"content":"export const level = 1;\n"}},
  {"name":"exi_file_commit","arguments":{"fileUploadId":{"$result":0,"$path":"fileUploadId"}}}
]}}
```

### Handle and async call example

Tool call:

```json
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"exi_create","arguments":{"type":"Scene"}}}
```

Response:

```json
{"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"{\"$handle\":\"h1\",\"type\":\"Scene\"}"}],"structuredContent":{"$handle":"h1","type":"Scene"}}}
```

A handle is passed to an argument in JSON as `{ "$handle": "h1" }`:

```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"exi_create","arguments":{"type":"Node","args":[{"x":80,"y":120}]}}}
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"exi_call","arguments":{"handle":"h1","method":"add","args":[{"$handle":"h2"}]}}}
```

If `exi_call`, `exi_function`, `exi_export_call`, `exi_static_call` and `exi_get` return a Promise, the bridge awaits the result. This way the AI receives the real result, not a Promise handle, for asset/audio loads.

Asset loading flow:

```json
{"name":"exi_create","arguments":{"type":"AssetLoader","args":[{"baseURL":"http://127.0.0.1:4173/"}]}}
{"name":"exi_call","arguments":{"handle":"h3","method":"loadJSON","args":["package.json"]}}
```

### Declarative scene example

```json
{
  "scene": {
    "type": "Scene",
    "children": [
      { "type": "Graphics", "options": { "x": 100, "y": 80 } },
      { "type": "Node", "options": { "name": "player", "x": 320, "y": 180 } }
    ]
  }
}
```

`exi_build_scene` only accepts the `type`, `options` and `children` fields; `options` must be an object and `children` an array. It accepts no callbacks, functions, dynamic imports or scripts. If an error occurs during creation, the handles created so far are rolled back. Gameplay code that needs callbacks is written as normal JavaScript in the scaffolded `game.js`; the AI CLI can review it with its file editor and check the result with the MCP preview.

### Starter game and preview

```json
{"name":"exi_scaffold","arguments":{"directory":"games/space-demo"}}
{"name":"exi_preview_start","arguments":{"path":"/games/space-demo/index.html"}}
{"name":"exi_preview_probe","arguments":{"previewId":"p1","path":"/games/space-demo/index.html"}}
{"name":"exi_preview_stop","arguments":{"previewId":"p1"}}
```

The scaffold does not overwrite existing files by default, rejects absolute/traversal paths and does not write directly to the repo root. The generated page updates the `data-ready`, `data-status`, `data-event`, `data-backend`, `data-fps`, `data-draws` and `data-nodes` fields in bounded form in the hidden `#exi-runtime` output that browser-capable AI CLIs can read. The same page sends at most 4 KiB of whitelisted telemetry to `/__exi/runtime` with the per-preview token it gets from `/__exi/runtime-token`; `exi_preview_probe({ previewId, path: "/__exi/runtime" })` reads the latest report. The `RuntimeAgent` consumes the `/__exi/runtime-command` queue with the same token and sends `exi_preview_call`/`exi_preview_batch` results back through `/__exi/runtime-result`; it only accesses the `src/index.js` public API and the `engine`/`scene` root handles. After a backend change, wait for `warmupMs` from `exi://runtime`; the profiler can return `data-fps="0"` during the warmup window. The preview does not bind outside `127.0.0.1`; a normal preview response is limited to 64 KiB, the runtime telemetry body to 4 KiB, a runtime command to 768 KiB and a result to 64 KiB. A synthetic POST or static index response is not real browser/GPU evidence.

## 11. Codex, Claude, OpenCode, Gemini setup

Detailed config examples are in [MCP.md](MCP.md). Short commands that can be used from the repo root:

```powershell
codex mcp add exi-engine -- node tools/exi-mcp-server.mjs
claude mcp add --transport stdio exi-engine -- node tools/exi-mcp-server.mjs
opencode mcp add
gemini mcp add exi-engine node tools/exi-mcp-server.mjs
```

For Gemini CLI, use `mcpServers.exi-engine` in `.gemini/settings.json` with `command: "node"`, `args: ["tools/exi-mcp-server.mjs"]` and `cwd: "."`; `type` is not needed in a stdio config. In Claude Code `.mcp.json` the `${CLAUDE_PROJECT_DIR:-.}` placeholder can be used. Cursor CLI uses the same `mcpServers` stdio shape in `.cursor/mcp.json`, and Cline CLI in `.cline/mcp.json`. For Windsurf/Cascade, the same entry is added to the user-level `~/.codeium/windsurf/mcp_config.json` file with an absolute script path and `EXI_MCP_ROOT`. The current OpenCode CLI management command is `opencode mcp add`; the config shape is `type: "local"` and an array `command` under `mcp.servers`. On Windows the client working directory must be the repo root; otherwise give an absolute script path and `EXI_MCP_ROOT`.

For other stdio MCP clients, the minimum contract is `command: "node"`, `args: ["tools/exi-mcp-server.mjs"]`, the repo root as `cwd` and the `EXI_MCP_ROOT` environment variable if needed. The modern client order is `server/discover` → `tools/list`/`resources/list`/`prompts/list` carrying `_meta` → `exi_api`; the legacy client order is `initialize` → `notifications/initialized` → `tools/list`/`resources/list`/`prompts/list` → `exi_api`.

## 12. Error handling and security

Known tool execution errors are returned as MCP `result.isError=true` with bounded text. An unknown method/resource returns a JSON-RPC error. The AI must verify the result with `exi_get`/`exi_api` after every mutation and call `exi_release` or `exi_session_reset` at the end of the work.

Result serialization, `exi_inspect`, `exi_session_status` and the browser `RuntimeAgent` determine the object type from the prototype data descriptor; normal `constructor`/`destroy` property access does not run accessors. Real engine properties with getters are only read on an explicit `exi_get`, `exi_export_get` or public method call.

Bridge limits: 1 MiB JSON-RPC message, 64 KiB string, JSON depth 32, 128 object keys, 4096 array items, 512 KiB binary argument, 4096 active handles, 1024 scene nodes, scene depth 32, 256 KiB resource, 64 KiB tool output, 64 KiB preview response, 4 KiB runtime telemetry body and 8 calls per browser batch. The engine `exi_check` timeouts are `doctor=60s`, `test=180s` and `verify=300s`; the example Codex/Gemini/OpenCode client timeout is 360 seconds. Engine method/property resolution is limited to the engine prototype chain and the class-based public allowlist in `src/ai/public-methods.js`, and static calls to the own-property allowlist; internal renderer/cache/validation helpers are not exposed. There is no `Object.prototype`, `Function.prototype`, `__proto__`, `prototype`, `constructor`, private method, eval, `new Function`, dynamic import or arbitrary shell.

MCP is a local process boundary; it is not authentication or an OS sandbox. Only connect it to trusted AI CLIs, and apply process/container permissions separately in production. Read [SECURITY.md](SECURITY.md) for the full threat model.

## 13. Verification flow

```powershell
npm run doctor
npm test
npm run verify
```

`npm test`: runs static dependency/security, the HTTP server, doctor, MCP protocol/asset/preview/scaffold and the engine smoke.

`npm run test:clients` verifies the real stdio bridge handshake/tool-call flow with the shapes of the six repo configs, including Cursor/Cline, and the host CLI discovery state; because the Windsurf user config lives outside the repository, it is checked through the `exi://clients` shape and the documentation example. To check the installed host clients' own MCP management path read-only, run `npm run test:clients:native`; this command looks for `exi-engine` in the `mcp list` output, limits it to 5 seconds and skips clients that are not installed. Native result states are separated into `passed`, `skipped`, `unavailable`, `failed`, `spawn-error` and `timeout`; host executable permission issues such as WindowsApps become `unavailable`. `npm run test:mcp` verifies the modern/legacy MCP wire flow and the AI game generation workflow. These tests do not provide the host CLI's own executable permissions/cancellation/UI behavior in full or physical browser/GPU evidence; live host and browser evidence must be recorded separately.

`npm run verify`: additionally runs the allocation/streaming/culling/physics benchmarks. Benchmark FPS values are a Node simulation; they are not real WebGL2/WebGPU driver or mobile device results.

For real GPU/device loss, WebGPU fallback, WebGL2 restore, audio and the browser lifecycle, open `test/hardware-soak.html`; physical devices must be reported separately with [test/HARDWARE_MATRIX.md](test/HARDWARE_MATRIX.md).

For AI CLI browser verification, open `/index.html` after `npm run dev`. First read the `BACKEND`, `FPS`, `DRAW`, `NODE` and `ASSET LOCAL OK` fields from the visible DOM; then apply the `WebGL2` and `WebGPU` selections one by one and read the same fields again. The console error/warning list must be empty. In the MCP preview flow, after the real page has loaded and `warmupMs` has passed, the token-protected server report is also collected with `exi_preview_probe({ previewId, path: "/__exi/runtime" })`. This test proves that the canvas runtime really set up a backend and produced frames, not just that the HTTP file arrived. For CLIs without browser capability, MCP `exi_preview_probe` only gives static HTTP evidence or telemetry previously sent by a browser; synthetic telemetry cannot count as browser/GPU evidence.

### Upload integrity

`exi_file_write`, `exi_file_begin`, `exi_asset_write` and `exi_asset_begin` accept an optional `expectedSha256` field. The value must be a 64-hexadecimal-character SHA-256 digest; a direct write/commit result returns `sha256`, and on a mismatch `EXI_MCP_UPLOAD_INTEGRITY` is returned without renaming to the target. In a chunk upload, the hash is updated incrementally with each chunk; the integrity check happens before the target commit.
