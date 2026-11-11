# ExiEngine — Detailed feature list

> This file keeps the full feature and behavior list from the previous README. For a short introduction see [README.md](README.md); for the API with examples see [API.md](API.md).

## Included core

- A scene graph of `Scene`, `Node`, `Sprite`, `Text`, `AnimatedSprite`, `Graphics`, `ParticleEmitter` and `TileMap`
- `Node.add()` validates all inputs before bulk reparenting; on an invalid or duplicate node error the scene graph is not partially changed
- A `destroy()`ed Node cannot be added back to the graph and its `update()` callback does not run; `ExiEngine.setScene()`/`setOverlay()` reject destroyed scenes
- Opt-in fixed-step behavior per node with `Node({ onUpdate })`; the parent callback runs before the children, and traversal behavior does not change when there is no callback (it can be assigned later with `setUpdateHandler()`)
- A high-density static sprite layer with a single texture via `SpriteBatch`; per-sprite tint/alpha/rotation
- Atlas frame animation inside the same SpriteBatch with `addAnimatedSprite()`; each sprite carries its own bounded frame state, `pingPong: true` goes back and forth without repeating the ends, `onLoop` is called at loop boundaries and `onFrameChange` only on real frame transitions; it enters the regular/instanced/WebGPU GPU-culling flow without duplicating nodes
- Atomic, safety-limited bulk sprite adds with `addSprites()`; a single cache/spatial invalidation for large layer setups
- Refreshing the cache/spatial index with `markDirty()` after hot in-place `sprites[index]` edits, without an automatic O(n) scan
- On the CPU/WebGL2 regular `SpriteBatch` path, chunk geometry, bounds and color calculations are updated on the existing records; no temporary per-frame corner/color arrays are produced
- Individual `Sprite`/`Text` render items are culled with the existing local bounds cache before the world→screen corner transform; the `SpriteBatch`/`TileMap` coarse culling path is kept
- `Graphics` rect/circle/line render items also carry local bounds by command type; off-screen primitives are filtered before the vertex world→screen transform
- Concave/convex polygons with `Graphics.polygon()`; ear-clipping is done once when the command is added and kept within a 256-point limit
- Optional local `cullBounds` for large containers/subtrees; if a branch is off-screen, its child renderables are cut before they enter the scene queue
- Node/container `alpha` is inherited by children as `worldAlpha`; in the regular, static and instanced/WebGPU source flows the cache keys track alpha changes
- Node/container `filter` is inherited by children; lightweight `grayscale`, `invert`, `brightness`, `sepia`, `contrast` and `saturate` color filters plus `blur`, `glow`, `outline`, `pixelate` and `vignette` (`FILTER_TYPES`) are applied in regular/static/instanced WebGL2/WebGPU draws
- Protection of the matrix and GPU stream against finite but extremely large transform/geometry values through the shared `MAX_WORLD_COORDINATE` limit
- A WebGL2/WebGPU instanced draw path with `SpriteBatch({ instanced: true })`; the CPU only produces a 14-float sprite instance record and reuses a same-size stream buffer
- WebGPU compute culling and indirect draw with `SpriteBatch({ instanced: true, gpuCulling: true })`; WebGL2 uses a safe instanced fallback with the same API
- Using `TextureAtlas` frames with a single draw in the same `SpriteBatch`; different base textures are kept explicitly separate
- A named frame array with `TextureAtlas.getFrames()`, and options for `AnimatedSprite` or `SpriteBatch.addAnimatedSprite()` directly with `getClip()`
- `TextureAtlas.fromJSON()` safely normalizes object or TexturePacker-style `frames` array metadata; it rejects unsupported `rotated`/`trimmed` frames instead of silently corrupting them
- The renderer shares atlas frames as a single GPU residency per `baseTexture`; with `maxTextureBytes`/`maxTextureCount`, direct Texture/RenderTexture allocations are also limited by the total GPU texture budget; the shared base filter state looks the same across all frames, and destroyed texture inputs are rejected with `EXI_TEXTURE_INPUT`
- If the base texture an atlas receives from outside is destroyed, the atlas is invalidated lazily on first access and releases its cached frames; the atlas does not take ownership of the external base texture
- A `TextureAtlas.fromGrid()` helper for regular spritesheets that needs no JSON
- Turning Canvas/OffscreenCanvas sources into a single safety-limited atlas texture with `TextureAtlas.pack()`
- `TextureAtlas.pack()` also merges existing `Texture` and atlas subtexture inputs directly; no manual `.source`/crop calculation is needed
- `Vec2`, `Mat3`, camera, zoom and world/screen transforms
- Rounding world→screen coordinates to physical pixels for pixel-art rendering with `Camera({ roundPixels: true })`; off by default
- `Camera.follow()` with a Point/Node.position target, offset, smoothing and optional `deadzoneWidth/deadzoneHeight`; cursor-centered zoom with `zoomAt()` and zoom/rotation-aware world bounds with `setBounds()`
- A fixed logical resolution with `ExiEngine({ width, height, resizeMode: "contain" | "cover" })`; the Camera screen viewport, pointer transform, CPU culling, WebGPU culling and responsive overlay layout use the same viewport contract; the contain letterbox area is closed to interaction (`resize` is the default)
- Validating the design resolution and resizing in a single pass on orientation or game mode changes with `engine.setLogicalSize(width, height)`; `resize()` reuses the same measurement flow and is chainable
- Allocation-free hit/explosion camera feedback with bounded duration/amplitude/frequency via `Camera.shake()`; `clearShake()` safely undoes the active offset
- Texture, atlas frame and texture-based batch drawing
- UV-level `flipX`/`flipY` for `Sprite` and `SpriteBatch`; direction changes without changing geometry, anchor or the instanced buffer format
- A sampleable WebGL2 framebuffer/WebGPU render target in the same core with `RenderTexture`; `engine.renderToTexture()` for minimaps, portals and UI composition; if a resize allocation fails, the previous working target is kept
- Drawing the child scene graph in an independent `RenderTexture` pass with `RenderGroup` and bringing it into the main scene as a single composite quad; nested groups are processed in post-order and WebGL2/WebGPU use the same lifecycle
- Running up to four allowlisted shader effects in a bounded ping-pong chain with two intermediate targets via `RenderGroup({ effects: [{ filter, amount }] })`; the effect passes reuse the WebGL2/WebGPU filter shaders, including the spatial `blur`, `glow`, `outline`, `pixelate` and `vignette` effects; group targets are cleared to transparent so empty areas never cover the scene behind the group
- `engine.prepare()` pre-warms the visible RenderGroup children, group targets and ping-pong intermediate targets alongside the main scene; the first-frame GPU allocation/upload spike becomes measurable
- Pixel-art nearest sampling with `Texture({ filter: "nearest" })`; linear filtering by default
- Node-based `blendMode: "normal" | "additive" | "multiply"`; WebGL2 blend state and WebGPU pipeline variants with the same API
- Re-uploading same-size canvas textures to the GPU only when they change with `Texture.markDirty()`/`updateSource()`
- Sourceless virtual textures are uploaded as a deterministic 1×1 white fallback in WebGL2 and WebGPU; the logical sprite size does not bloat GPU texture memory
- Canvas 2D-based `Text` without an external UI/runtime dependency; redraw is skipped for the same text or a normalized repeated style, the texture is reused for same-size text changes, and size and character/pixel budgets are bounded
- Splitting long HUD/menu text into bounded lines with Canvas 2D measurement via `Text({ wordWrap: true, maxWidth })`; off by default, and long single words are safely broken at the character limit
- Text line measurement is done without stack spread or an intermediate `map` array; long multi-line content safely reaches the limit check
- A bounded, reference-counted `TextCache` for repeated label/HUD texts; entry/pixel budgets are tied to the constructor snapshot, and `clear()` only cleans up textures that are no longer used
- An optional `GlyphAtlas`; size/padding/entry/pixel budgets are snapshotted, it reuses grapheme clusters, reduces glyph rasterization and keeps the Canvas fallback for complex scripts
- A single renderable batch for TileMap; it does not create a Node/Sprite per tile
- Producing a small number of AABBs by merging solid tiles horizontally/vertically with `TileMap.getCollisionRects()`; binding them to `PhysicsWorld` static bodies with `createStaticBodies()`
- Safe, atomic chunk/region updates with `TileMap.setRegion()`; typed-array bulk/region paths make no temporary copy after validation, and atomicity is kept for normal arrays
- TileMap is drawn instanced by default; on WebGPU, tile transform/culling moves to the GPU with `gpuCulling`, and on the WebGL2 CPU fallback `cullTiles` packs the visible row/column range
- Mirroring sprite atlas UVs per cell with `TileMap.setTile(x, y, index, { flipX, flipY })` without growing the geometry/instance stride
- Importing a tile layer of a [Tiled](https://www.mapeditor.org) JSON (`.tmj`) map with `TileMap.fromTiled(map, { texture, layer, tileset })`; CSV-array or uncompressed base64 data, flip bits become `flipX`/`flipY`, layer offset/opacity/visibility/name are applied, and unsupported data (infinite/compressed/non-orthogonal maps, rotated tiles, tileset margin/spacing, mixed tilesets) is rejected explicitly; `TileMap.tiledTileIdsWithProperty()` turns custom tile properties into a `solidTiles` set
- Lightweight, nestable scissor clip rects in screen coordinates
- Fast rectangular masks with `maskRect`, using the same allocation-free scissor intersection path, and screen-space alpha masks with `maskTexture`; a `RenderTexture` can be used as a mask
- WebGPU-first selection, WebGL2 fallback and context/device loss reporting
- Atomic GPU resource cleanup on WebGL2/WebGPU shader/program/pipeline/buffer/texture and GPU-culling helper resource creation errors; the validation scope closes, failed handles are not written to the cache and the working culling resource is kept
- With auto selection, only an active WebGPU loss falls back to WebGL2; WebGL2 context restore uses its own resource rebuild path; if the fallback setup also fails, the lost backend is released and the renderer reference stays null
- Renderer exceptions do not silently break the frame loop; a suitable fallback is tried, or the engine stops in a controlled way and reports `renderer-error`
- Renderer loss errors carry `backend`, `phase`/`reason` and `recoverable` metadata; an exception in the `onStatus` observer cannot break the fallback, restore or teardown flow
- Direct WebGL2/WebGPU `init()` failures also do an idempotent teardown; missing host event APIs do not break cleanup again
- Concurrent engine `init()` calls share a single setup; a failed setup cleans up renderer/input/listener resources and a retry requires a new engine. Input binding validation is done before listener registration.
- Scene/update/render/pointer callback exceptions do not leave the engine locked in `running: true`; the loop stops, a `runtime-error` status is published and a manual `step()` passes the error to the caller
- Safe scene transitions with `engine.setScene(scene, camera?)`, atomically clearing the prepared render queue and old pointer capture/hover targets
- An HUD/UI scene with `overlayScene`/`setOverlay()` that is independent of the main camera and drawn as a second pass without clearing in WebGL2/WebGPU; overlay pointer targets take priority
- left/top/right/bottom, responsive anchors and nested viewport layout for overlay Nodes with `setLayout()`; applied only to the overlay scene during a resize
- Keyboard UI focus without a DOM dependency outside the canvas with `focusable`, `tabIndex`, `engine.focus()`/`focusNext()` and bubbling `onKeyDown`
- A texture-based panel/frame on a single render node with `NineSliceSprite`; border UVs adapt to the texture and target size in bounded form, it reuses nine quads and resize scratch memory and uses the normal Sprite batch path
- A fixed-timestep game loop, keyboard/pointer/gamepad input, multi-pointer/wheel, multi-button pointer state, pointer capture/cancel release and mobile visibility/pagehide reset
- A controlled lifecycle with `engine.pause()`/`resume()`; the default `pauseOnHidden: true` stops RAF, fixed-step accumulation and the active Web Audio context in a hidden tab or on a bfcache `pagehide`; on `pageshow`/visibility return only the loop the engine stopped automatically restarts, and audio can keep playing with `pauseAudio: false`
- Managing the fixed-step simulation as slow motion or fast-forward in the 0..16 range with `timeScale`/`setTimeScale()`; the effective delta does not exceed the safety ceiling
- Smoothing the remaining time between fixed-step updates with transform snapshots during rendering with `interpolate: true`; off by default, and game state is restored after rendering
- Opt-in `PhysicsWorld.step(fixedStep)` integration with `physics: physicsWorld`; if a world is given it is bound to the engine scene and removes manual `onUpdate` boilerplate, and the default path is unaffected
- Opt-in `Animator.update(fixedStep)` integration with `animator: animator`; the fixed-step order is applied as `scene → animator → physics → onUpdate` and removes manual update boilerplate
- An allocation-free action layer that combines keyboard, pointer and gamepad bindings into a single `down/pressed/released` API with `Input.bindAction()`
- The pointer dispatch path, hit/hover results and pick predicates reuse engine scratch memory in drag/move flows; scene/overlay transitions clear old target references (`npm run bench -- pointer`)
- Direct `isGamepadButtonDown()`, `wasGamepadButtonPressed()` and `wasGamepadButtonReleased()` queries without using an action map
- Combining keyboard pairs and gamepad analog axes into an allocation-free `getAxis()` API with deadzone/scale clamping via `Input.bindAxis()`
- Moving validated action/axis maps to JSON/SaveStore settings with `Input.getBindings()`/`setBindings()`; the import is atomic and a bad entry does not corrupt the existing map
- Converting the active or selected pointer/touch coordinate to world coordinates with a reusable scratch point via `Input.getPointerWorld(camera, out, pointerId)`
- World-space pointer/touch hit testing with `Scene.pick(worldX, worldY)` and `Node.containsPoint()`; z-order and optional predicate support
- A finite rectangular `hitArea` for interactive `Node`s that are not renderables; defining UI hit zones without changing sprite/graphics bounds
- Converting the active or selected pointer from camera to world and finding the topmost hit-testable node in a single call with `engine.pickPointer(predicate, pointerId)`
- `onPointerDown`, `onPointerUp`, `onPointerCancel`, `onPointerMove`, `onPointerEnter` and `onPointerLeave` on opt-in `interactive: true` nodes; a separate capture/hover target per pointer ID, correct `button`/`buttons` info, parent bubbling (`currentTarget`) and a reused transient world event
- Passing world-coordinate `wheelX`/`wheelY` deltas to UI and camera controls with `onWheel` in the same interactive API
- An optional native `ResizeObserver` and `visualViewport.resize` listener for canvas layout changes; the `window.resize` fallback is kept for older browsers
- Input and engine teardown choose the event target safely; an early `destroy()` does not break in worker/SSR test environments without `window`
- If an audio decode completes after engine teardown or `unload()`, a generation check rejects the late buffer write; concurrent loads with the same name and URL share a single decode job, and a race with a different URL is rejected
- If backend init runs past engine teardown, the late renderer is destroyed; auto selection does not start a fallback on a closed canvas
- Lowering the fill-rate budget on high-DPI mobile devices with `maxPixelRatio`; the profiler metric snapshot is updated on a fixed object
- The same canvas clear/transparency contract on both backends with `backgroundColor`, `backgroundAlpha` and `clearBeforeRender`; an alpha canvas opens with the right context option in WebGL2 and in `premultiplied` mode in WebGPU
- WebGL2/WebGPU renderer metrics and `prepare()` byte totals are updated in a single batch pass; there is no per-frame `filter()`/`reduce()` callback/intermediate array work
- WebGL2 `MAX_TEXTURE_SIZE` is read once during context setup/restore and reused in `getInfo()` and texture limit checks; the profiler makes no per-frame driver query
- The renderer `getInfo()` snapshot is also updated on a fixed object; the engine profiler does not produce a new backend info wrapper each frame
- `ExiEngine.getInfo()` also updates a fixed engine/canvas wrapper; per-frame telemetry queries such as the demo HUD produce no top-level objects
- Gamepad snapshot input; a one-frame `released` signal on disconnect, a bounded `rumbleGamepad()` haptics fallback, camera culling and `culledCount`/texture resource measurements
- `Input`/`ExiEngine` gamepad hot-plug callbacks; `onGamepadConnected` and `onGamepadDisconnected` only give a bounded snapshot and do not carry the native Gamepad object into game code
- Alpha-blended rect/circle/line/polygon primitives and a bounded particle pool
- ParticleEmitter runs by default with a reused instanced buffer and a bounded particle object pool; screen-space quad culling takes visible records into a packed stream, `gpuCulling: true` leaves the 16-float source stream to compute culling on WebGPU, and `instanced: false` is the CPU quad fallback.
- `Tween`/`Animator` with finite duration/delta/loop limits and a default tween budget; AABB collision, raycast and an opt-in lightweight axis-separated `PhysicsWorld`; a hitbox independent of the visual node with `Collider({ bounds: { x, y, width, height } })`, one-way platforms/walls with `oneWay: "up" | "down" | "left" | "right"`; 32-bit `layer`/`mask` filtering and `overlaps()` for trigger/dynamic contacts
- Opt-in contact begin/stay/end events with `PhysicsWorld({ onBeginContact, onStayContact, onEndContact })`; the third callback argument carries transient `PhysicsContact` normal/penetration metadata, no contact polling/tracking cost is added without callbacks, and `remove()` and `clear()` report `end` cleanup for active pairs
- An allocation-safe, distance-limited line-of-sight/projectile query with `CollisionWorld.raycast()`; reuses the spatial broadphase
- `AnimatedSprite` with texture arrays and frame-rate/loop/ping-pong control; optional `onLoop`, `onFrameChange` and `onComplete` callbacks
- A same-origin, size-limited `AssetLoader`; a default 16 MiB response byte budget, an absolute 64 MiB ceiling and JSON byte/node/depth budgets
- Web Crypto-based asset integrity verification with the optional `integrity: "sha256-..."`; verified textures are not written to the cache, and a separate `atlasIntegrity` can be used for atlas metadata
- `AssetLoader.loadMany()` processes the manifest within a limit of 4096 entries/256-character keys; it supports the `texture`, `json`, `bytes`, `atlas` and `ktx2` (requires an explicit decoder) types (for `atlas`, `url` is the texture and `atlasUrl` the JSON metadata); atlas frame names are limited to 256 characters and kept in null-prototype records
- Web Audio `AudioManager` (compressed/decoded PCM limits, a bounded `loadMany()` preload/progress/abort flow, tied to the existing AssetLoader verification with `integrity: "sha256-..."`, a default budget of 64 active voices, volume-preserving bus mute and `fadeBus()` automation, optional `pan: -1..1`, active voice volume/pan control and the `suspend()`/`resume()` lifecycle API), a bounded `SaveStore` and a runtime `Profiler`
- Returning unused decoded buffers and live voice nodes to the budget with `AudioManager.unload()`/`stopAll()`; when the same sound key is successfully reloaded, the old buffer's voices are also safely stopped
- Progress, abort, error policy and a concurrency limit with `AssetLoader.loadMany()`
- `AssetLoader.loadAtlas()` starts the texture and JSON metadata sources independently in parallel; the shared abort and byte/JSON limits are kept
- Safe KTX2 header/range inspection, dependency-free uncompressed RGBA8 KTX2 loading, and an explicit decoder adapter (`loadKTX2()`) for compressed KTX2 flows such as Basis/UASTC; the decoder only returns a `CanvasImageSource` and the loader keeps ownership
- URL/signal-based deduplication for concurrent same-origin asset requests; a render-item cache for unchanged Graphics geometry, and reuse of item/positions/bounds memory on dirty rebuilds
- Reuse of the item, positions and UV array on frame/texture/size/flip changes in single-Sprite render geometry; tint/alpha updates make no allocations (`npm run bench -- sprite`)
- The Sprite geometry key uses a scalar cache; `SpriteBatch.setSprite()` changes the existing record in place on hot updates
- Instanced `SpriteBatch` and `TileMap` camera/world caches are compared with scalar fields without producing template strings each frame
- Static `Graphics`, regular `SpriteBatch` and CPU `TileMap` cache/culling keys also reuse the same numeric version state; no long key string is built in a stable frame
- The CPU instance path is recomputed when the camera changes even with `cullable: false`; nested scissor clip intersections reuse a per-node scratch rect
- Engine interpolation roots and WebGL2/WebGPU RenderGroup traversal lists are reused as persistent scratch across frames; the scene reference is cleared on transitions (`npm run bench -- frame-scratch`)
- JSON scene documents with `serializeScene()`/`deserializeScene()` in the same `{ type, options, children }` shape as MCP `exi_build_scene`; textures are referenced by id, callbacks are never stored, and loading validates types, option keys, numbers and node/depth limits without evaluating code
- Optional rotating rigid bodies with `RigidBodyWorld`/`RigidBody`: circle, box and convex polygon shapes, SAT manifolds with up to two points, sequential impulses with warm starting and a two-point block solver, friction, restitution, damping, sensors, layer/mask filtering, node sync and deterministic fixed steps, anti-tunneling (velocity-scaled speculative contacts and automatic substeps), plus `RevoluteJoint` and `DistanceJoint` (rod or rope) with warm starting and direct position correction; usable as `ExiEngine({ physics })`
- AngelCode BMFont support with `BitmapFont` (text `.fnt` and JSON, kerning, single page) and `BitmapText`, a `SpriteBatch` subclass that lays out glyph quads with alignment, word wrap, letter spacing, anchors, tint and `?` fallback
- Audio sprites (`addSprites`/`play(name)`), slices (`offset`/`duration`), loop regions (`loopStart`/`loopEnd`), `playbackRate` pitch control and deterministic 2D spatial audio (`setListener`, `configureSpatial`, `setVoicePosition`) on `AudioManager`
- Transport-agnostic rollback netcode with `RollbackSession`: input delay, prediction, rollback and re-simulation, unacknowledged-input resend, stall protection and checksum-based desync detection for 1-8 players
- Cheap 2D lighting with `LightLayer`: a low-resolution light map (ambient fill + additive radial point lights) multiplied over a world rectangle, with world-space light objects synced every update
- Free-form JSON `node.data` metadata stored in scene documents, and `watchScene()` hot reload from a polled file and/or the editor's BroadcastChannel; the editor gains a live Play window with rigid-body preview from `data.body` and direct-to-file saving
- LDtk project import: `tileMapFromLDtk` (Tiles/AutoLayer with flips, offsets, opacity), `ldtkIntGrid` (collision/pathfinding grid) and `ldtkEntities` (positions, sizes, tags, custom fields)
- Canvas UI widgets `Button`, `Slider`, `TextInput` (with a hidden DOM input for IME, paste and mobile keyboards) and `ScrollView` (wheel/drag scrolling, clipping, off-screen culling) on the engine's pointer capture and focus order
- Prefabs: named node trees stored in scene documents, editor make/insert/apply-to-all, and `instantiatePrefab()` for runtime spawning
- A dependency-free TypeScript API contract with the root `index.d.ts`
- Vertex/instance buffers whose capacity is kept in WebGL2, and narrowed in WebGPU according to a 64 MB global limit and the device limit

## Quick start

```js
import { ExiEngine, Scene, Sprite, Camera, RenderTexture } from "exi-engine";

const scene = new Scene();
scene.add(new Sprite({ x: 100, y: 100, width: 64, height: 64, tint: 0x6fffc0 }));

const engine = await ExiEngine.create({
  canvas: document.querySelector("canvas"),
  renderer: "auto",
  backgroundColor: "#060912",
  backgroundAlpha: 1,
  scene,
  camera: new Camera(),
  inputActions: { jump: ["Space", { type: "gamepad", button: 0 }] },
  inputAxes: { moveX: { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" } },
});
engine.start();
```

You can define node behavior directly on the node instead of moving it into the global update callback:

```js
const player = new Sprite({
  width: 32, height: 32,
  onUpdate: (delta, node) => { node.position.x += 120 * delta; },
});
scene.add(player);
```

For an offscreen render target, the camera viewport is kept the same size as the target; if the target is used as a texture in the same render pass, a feedback loop error is raised:

```js
const target = new RenderTexture({ width: 320, height: 180 });
const targetCamera = new Camera({ width: 320, height: 180 });
engine.renderToTexture(target, scene, targetCamera);
```

To draw children in an independent offscreen pass every frame and compose them as a single quad in the main scene, use `RenderGroup`; nested groups are processed inside-out first:

```js
import { RenderGroup, Sprite } from "exi-engine";

const group = new RenderGroup({ width: 320, height: 180, x: 160, y: 90, filter: "brightness", filterAmount: 0.15 });
group.add(new Sprite({ x: 40, y: 40, width: 32, height: 32, tint: 0x6fffc0 }));
scene.add(group);
```

A short effect chain:

```js
group.setEffects([
  { filter: "grayscale", amount: 0.4 },
  { filter: "brightness", amount: 0.1 },
]);
```

Camera follow:

```js
camera.follow(player, { smoothing: 0.15 });
camera.setBounds({ x: 0, y: 0, width: 4096, height: 2048 });
camera.shake(8, 0.2, { frequency: 24 });
```

`player` can be a point carrying `x/y` directly or a Node with a `.position` field.

When changing scenes, the old scene stays owned by the user; the engine only clears the render preparation and old pointer targets:

```js
engine.setScene(menuScene, menuCamera);
engine.setScene(gameScene, gameCamera);
```

For a HUD, the overlay scene is drawn above the main world in its own camera coordinates. If no camera is given, the engine sets up a screen-centered camera; overlay `pointerdown`/`move`/`wheel` targets are selected before the game scene:

```js
const hud = new Scene();
hud.add(new Sprite({ x: 80, y: 32, width: 160, height: 48, interactive: true,
  onPointerDown: () => console.log("HUD button") }));
engine.setOverlay(hud);
// To close: engine.setOverlay(null);
```

The overlay is updated after the main scene in the fixed step and composed with `load` after the main render pass; therefore it does not change the global `clearBeforeRender` setting.

To place overlay elements so they survive resizes, use `setLayout()`. The `right`/`bottom` edges and the `anchorX`/`anchorY` 0..1 range are evaluated in the CSS-pixel overlay viewport:

```js
const score = new Text({ text: "SCORE 000", width: 140, height: 24 });
score.setLayout({ right: 16, top: 16 });
hud.add(score);
```

Canvas UI focus and Tab order:

```js
const play = new Sprite({ width: 180, height: 48, focusable: true, tabIndex: 0,
  onKeyDown: ({ key, preventDefault }) => {
    if (key === "Enter" || key === " ") { preventDefault(); startGame(); }
  } });
hud.add(play);
engine.focus(play);
```

`Tab` and `Shift+Tab` cycle through visible nodes with `tabIndex >= 0`; overlay nodes are scanned before the main scene.

A nine-slice sprite can be used for a texture-based panel/frame:

```js
const panel = new NineSliceSprite({
  texture: panelTexture,
  width: 420, height: 180,
  left: 12, right: 12, top: 12, bottom: 12,
});
hud.add(panel);
```

For deterministic/custom loop use, `step(deltaSeconds)` can be called after the renderer is ready; the fixed-timestep update, render, profiler and input frame cleanup go through the same flow:

```js
await engine.init();
engine.step(1 / 60);
```

If `engine.stop()` or `destroy()` is called inside `onUpdate`, the same frame's catch-up fixed-step loop is also cut immediately.

While `engine.start()` is running, a `step()` call is rejected; this way two separate game loops cannot advance the same state at the same time.
In SSR/Worker environments without a native `requestAnimationFrame`, `start()` is explicitly rejected; use `step()` in these environments.

When the tab or application becomes hidden, and also on a bfcache `pagehide`, the engine pauses by default; on `pageshow` or when visibility returns it continues automatically. This behavior can be turned off with `pauseOnHidden: false`:

```js
const engine = await ExiEngine.create({ canvas, pauseOnHidden: true });
engine.pause();
engine.resume();
engine.setTimeScale(0.5); // slow-motion
engine.setTimeScale(1);
```

Games that want to smooth fixed-step movement on the render side can opt in:

```js
const engine = await ExiEngine.create({ canvas, interpolate: true });
```

Input action example:

```js
if (engine.input?.wasActionPressed("jump")) player.jump();
const moveX = engine.input?.getAxis("moveX") || 0;
```

Pointer handler example:

```js
const button = new Sprite({
  width: 160,
  height: 48,
  interactive: true,
  onPointerDown: ({ target, worldX, worldY }) => target.setTint(0xffd166),
});
scene.add(button);
```

Pointer events bubble from child to parent; `pointerenter`/`pointerleave` do not bubble. To stop the parent flow or mark the event as handled by the application, use `event.stopPropagation()` and `event.preventDefault()`:

```js
const panel = new Node({ onPointerDown: ({ currentTarget }) => currentTarget.setAlpha(1) });
panel.add(button);
```

Lightweight kinematic physics:

```js
const physics = new PhysicsWorld({ scene, gravityY: 980 });
physics.add(new PhysicsBody(floor, { static: true }));
physics.add(new PhysicsBody(player, { layer: 1, mask: 0xffffffff }));
const engine = await ExiEngine.create({ canvas, scene, physics });
```

`PhysicsBody`/`Collider` use layer `1` and all masks by default. For a contact to be accepted, each body's mask must include the other body's layer bit; `overlaps()` applies this fast mutual mask before the game filter.

You can opt in to contact events:

```js
const physics = new PhysicsWorld({
  scene,
  onBeginContact: (body, other) => console.log(body.collider.tag, other.collider.tag),
  onStayContact: (body, other) => applyDamageOverTime(body, other),
  onEndContact: (body, other) => console.log("separated", other.collider.tag),
});
```

## Development

Node.js is all you need:

```text
npm test
npm run verify
npm run dev
npm run bench -- streaming
npm run bench -- instanced
npm run bench -- regular
npm run bench -- culling
npm run bench -- sprite-culling
npm run bench -- graphics:culling
npm run bench -- subtree-culling
npm run bench -- transform
npm run bench -- text
npm run bench -- glyph
npm run bench -- particles
npm run bench -- particles:cpu
npm run bench -- particles:culling
npm run bench -- particles:gpu-culling
npm run bench -- input
npm run bench -- tilemap
npm run bench -- queue
npm run bench -- collision
npm run bench -- physics
```

In addition to the static dependency/security scan, `npm test` also runs a real HTTP server smoke test; CSP, `nosniff`, traversal and method limits are verified with live requests.

`npm run verify` combines the `npm test` scope with all allocation/streaming benchmarks and is the single-command, dependency-free acceptance gate before a release. Real browser/GPU and physical device runs do not replace this command; `test/hardware-soak.html` and the physical matrix are run separately.

`npm run bench -- input`, `npm run bench -- tilemap`, `npm run bench -- tilemap:regular` and `npm run bench -- queue` measure the reuse of gamepad state, action queries, TileMap instance/regular streams and the renderer batch/upload queue across frames. Renderer prepare measurements use a single scalar pass per queue.
`npm run bench -- particles:culling` measures that off-screen particles do not enter the packed instance stream and that the visible fixed stream view is not reallocated.
`npm run bench -- particles:gpu-culling` measures that no CPU world→screen transform is done on the `gpuCulling: true` particle source stream, and the 16-float WebGPU contract.

Demo: `http://127.0.0.1:4173/`

`AssetLoader.release()` does single-texture cache eviction; in-flight loads are not written back to the cache with the old URL generation.
`AssetLoader` starts the general response byte budget at 16 MiB by default; the safe upper ceiling is 64 MiB.
In addition to the general asset byte budget, `AssetLoader.loadJSON()` enforces a default limit of 4 MiB of JSON, 100,000 nodes and depth 64; `maxJSONBytes`, `maxJSONNodes` and `maxJSONDepth` can be chosen narrower per call, and the loader ceiling cannot be exceeded.
`AssetLoader.destroy()` aborts pending fetches during engine teardown; calls using different signals for the same byte/texture share a single fetch/decode job, and a caller abort only cancels that call's promise. `clear()`, on the other hand, changes the cache generation without cancelling in-flight loads.
`engine.start()` prepares textures and vertex buffers before the first visible frame; if needed this can be checked with `engine.prepare()` and the `textureUploads` metrics.
`maxTextureBytes` defaults to 128 MiB and `maxTextureCount` to 4096; WebGL2/WebGPU apply this total budget before texture and RenderTexture allocations and report `textureBytes` and the limits in `getInfo()`.
`backgroundColor` accepts a number or a `#rgb`/`#rrggbb` string; `backgroundAlpha` is clamped to 0..1. `clearBeforeRender: false` turns off the clear call and enables `preserveDrawingBuffer` in WebGL2 to keep the canvas content; if clean content is needed on the first frame, keep the default `true`.
`maxPixelRatio` limits the physical canvas resolution; the engine also uses the camera `pixelRatio` at the same time, so a high-DPI device only gets a sharper image and the world viewport does not grow. With manual `Camera` use, `setPixelRatio()` explicitly chooses the same transform contract.
The size, resize, pixel-ratio, texture budget and fixed-step fields of the engine runtime configuration are tied to the constructor snapshot; use the official `setLogicalSize()`/`setResizeMode()` paths.
Unchanged `Graphics` rect/circle/line geometry uses an opt-in static GPU buffer cache with `staticCache: true` so it does not create extra draws in small scenes.
To specifically use the CPU screen-space path for unchanged large tilemaps, `TileMap({ staticCache: true, instanced: false })` caches the static vertex transform across frames; on the instanced path, the GPU transform is preferred.
The WebGL2/CPU instanced TileMap path, with the default `cullTiles: true`, does not write tiles outside the camera's visible local range into the instance stream; use `cullTiles: false` to deliberately send all tiles, and `cullable: false` to also turn off node-level culling.
The `TileMap({ instanced: false })` regular CPU/WebGL2 fallback reuses render item, positions and UV arrays on dirty updates; `npm run bench -- tilemap:regular` measures this identity contract.
In chunk streaming, `setRegion(x, y, width, height, values)` only changes the region atomically; an invalid tile index is rejected without changing the whole region.
For TileMap physics, use `createStaticBodies(physics, { solidTiles: new Set([0, 1]) })`; when the tile data changes, the controller's `rebuild()` is called. Solid rect generation merges adjacent cells and creates no colliders for empty tiles.
SpriteBatch and TileMap apply coarse bounds culling before producing render items/vertices when off-screen.
Single Sprites and Text are culled early with local bounds when off-screen; visible objects use the same scratch transform flow for bounds corners and render corners. `npm run bench -- sprite-culling` verifies this path with 2000 off-screen sprites.
The Graphics primitive culling path is verified with 2000 off-screen commands by `npm run bench -- graphics:culling`.
Scene graph world matrices are not recomputed for an unchanged local transform and parent version; `npm run bench -- transform` measures this path.
The render queue reuses the global z-sort list across frames while the same renderable membership/`worldZ` order is kept; if the z-order or sibling order changes, it safely rebuilds.
The persistent renderer batch state also reuses the render queue result wrapper; `npm run bench -- queue` reports queue/batch/data reallocations separately.
When the scene shrinks, old static owner, texture, mask and GPU resource references in the batch pool are released; only a bounded reuse window is kept.
Render queue clip merging does not produce a string key for each drawable; it compares equal scissor values with four numeric fields and merges separate clip objects into a single batch.
Dense SpriteBatches are split into chunks of 256 by default; `chunkSize` can be tuned for the visibility/memory balance, and chunks with the same texture merge into a single draw.
For many entries at startup, use `addSprites([...])`; nothing is written to the batch until all texture and sprite limits are validated.
A SpriteBatch is limited to 100,000 sprites in total; for larger scenes, use several batches/chunks.
For irregular large worlds that keep insertion order, `spatialCulling: true` and `cellSize` use a spatial index.
Spatial culling reuses the visible index list and bounds scratch areas across frames; by reducing the camera's visible area to a local cell range, it does not scan distant spatial cells every frame. `npm run bench -- culling` measures the scratch/bounds and cell visibility.
`CollisionWorld({ spatial: true, cellSize: 128 })` uses an optional broadphase; when a generic collider transform changes, you can update only the related entry on a clean index with `syncCollider(collider)` or call `rebuild()` after bulk changes. If `autoSync: true` is chosen, this check is done automatically before queries and carries an O(n) cost. The default `spatial: false` path keeps its order and API behavior.
`PhysicsWorld` only runs when it is used; it provides `gravity`, velocity, static/kinematic/trigger colliders, 32-bit `layer`/`mask`, bounded fixed substeps, X/Y axis resolution, the `grounded` state and a reused `overlaps()` list. `PhysicsBody({ kinematic: true })` receives no gravity; it moves first with its velocity and carries dynamic bodies that are grounded on it by the same bounded delta, so moving platforms can be built. `Collider`/`PhysicsBody` can use a smaller foot box or an offset hitbox than the sprite visual with an optional finite local `bounds` override; on a static/kinematic collider, `oneWay: "up"` lets things pass from below and only stops movement coming down from above, and the other directions follow the same contract. `setBounds(null)` returns to the node's own local bounds. Axis resolution scans the movement path with a single-pass scratch filter on a swept-AABB broadphase, stops at the closest solid contact and keeps the existing correction fallback for unexpected end-position overlaps; this way fast bodies do not skip thin colliders. Dynamic body movement now only updates the cell entries of the related collider incrementally; the whole broadphase is not rebuilt every frame. `autoSync: true` also catches non-transform geometry changes of static colliders before queries; this opt-in path does an O(n) stale-shape check. Dynamic bodies are resolved kinematically against static/kinematic bodies; a full rigid-body impulse/rotation solver was deliberately not added to the core.
`Sprite.getLocalBounds()` and `Collider.bounds` reuse the same object for as long as the geometry/transform is unchanged; `npm run bench -- collision` reports bounds and query list reallocations separately.
`instanced: true` removes CPU quad generation; transform, atlas UV and tint/alpha go to the GPU through the instance buffer. Instance buffer capacity is reused and has a 64 MB safety limit.
On the WebGL2 CPU-instanced fallback, a same-size instance buffer is also reused across frames; `npm run bench -- instanced` measures this path separately.
The CPU/WebGL2 regular SpriteBatch benchmark also measures that chunk position/UV/color arrays are kept across updates; `npm run bench -- regular` expects 0 buffer reallocations over a 1000-sprite / 60-frame run.
`gpuCulling: true` produces the visible instance list with a compute shader on WebGPU; `gpuCulling` alone does not bypass the CPU fallback, and no compute emulation is done on WebGL2.
On the GPU culling path, the CPU only packs the local sprite record; world/camera transform, rotation, visibility and compact output are left to the compute stage.
GPU culling input/output capacity is limited per batch and in the renderer total; an invalid instance count is rejected before GPU allocation.
The GPU culling source stream reuses its typed-array memory across frames as long as it stays the same size; `npm run bench -- streaming` verifies this contract independently of hardware.
`SpriteBatch.setFrame()` changes a synchronized animation frame within the same atlas with a single invalidation; the GPU source buffer is reused.
`SpriteBatch.addAnimatedSprite()`/`setSpriteAnimation()` advance independent frame animations within the same atlas inside a single batch; `updateAnimations()` makes a single invalidation only when a frame changes and keeps the instanced GPU source buffer. `npm run bench -- animation` measures frame progress and buffer reallocation in this flow.
High-frequency code that changes `SpriteBatch.sprites` records directly can call `markDirty()` after finishing its changes; this path keeps the instance buffer capacity and does not do an automatic O(n) change scan every frame.

The demo shows 37 render nodes, an atlased background, the collision state and backend/FPS/draw/node measurements. The `Auto`, `WebGL2` and `WebGPU` options switch the same scene.

For a real browser/GPU/audio soak test, use `http://127.0.0.1:4173/test/hardware-soak.html`; the output reports backend limits, GPU culling memory, texture/render-target counts, the Graphics polygon path, a real AudioContext voice/pan probe, an input axis listener probe, RenderTexture offscreen pass/resize counters, RenderGroup/post-process passes, TextCache/GlyphAtlas sharing, the complex text shaping fallback and the device-loss/runtime-error state. For an automated short run use `EXI_PLAYWRIGHT_CHANNEL=chrome npm run test:e2e:browser`, and additionally `EXI_PLAYWRIGHT_SECONDS=30` for a 30-second run. A manual loss does not count as successful until it verifies a real `WEBGL_lose_context` restore on WebGL, and the WebGL2 backend and continuing frames after fallback on WebGPU.
To collect physical iOS/Android/WebView results, use the matrix, acceptance criteria and Android USB `adb reverse` preparation in [test/HARDWARE_MATRIX.md](test/HARDWARE_MATRIX.md); no physical result is claimed without a connected device.

## Security contract

- Runtime shader code is never accepted from outside; shaders are fixed in the source.
- `AssetLoader` only allows its own origin by default, rejects credential-bearing URLs and redirects, checks known raster header sizes before the decoder, and limits image sizes and the total texture cache with an absolute 64 MiB response byte ceiling; the demo server is locked down with CSP `frame-ancestors`, `X-Frame-Options` and `Permissions-Policy`.
- The KTX2 parser only accepts bounded 2D/single-face ranges; it validates mip level, 64-bit offset, pixel and uncompressed byte limits before the decoder. A compressed KTX2/Basis decoder is never loaded automatically; only an adapter the application explicitly provides is run.
- Asset textures enforce a maximum size and total pixel budget; the renderer upload layer validates the GPU size/pixel limit again.
- The renderer's total GPU texture memory and texture count are also limited by `maxTextureBytes`/`maxTextureCount`; atlas subtextures share the same `baseTexture` GPU resource. Public texture/device-limit fields are tied to the constructor/device snapshot; direct enlargement is rejected.
- TileMap allocation is also limited to 500,000 tiles; invalid grid/frame indexes are rejected before GPU allocation.
- Atlas JSON is not used until the frame count and bounds are validated.
- Save data is bounded by namespace, JSON and a maximum size; there is no executable data.
- Input action names, binding counts and keyboard/gamepad indexes are bounded; bindings are kept only as fixed data and run no callbacks/eval/scripts.
- The local server only listens on `127.0.0.1`, blocks traversal and sends CSP/`nosniff`/CORP/referrer headers.
- External engine imports, `eval` or `new Function` in the source are rejected by the static test.

See [SECURITY.md](SECURITY.md) for the detailed threat model and [RESEARCH_GAPS.md](docs/internal/RESEARCH_GAPS.md) for the research gap matrix.

## Deliberate limits

Audio decode is subject to the browser's user-interaction policy. The device-loss cleanup and fallback contract is verified in a simulated smoke test; real GPU memory soak, driver reset and a physical device matrix are needed separately. In production deployments, HTTPS and server-side security headers must still be maintained.
