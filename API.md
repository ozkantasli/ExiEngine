# ExiEngine API ve AI/MCP referansı

Bu dosya ExiEngine’in çalışma zamanı API’sini ve AI CLI bridge’ini tek yerde anlatır. JavaScript’in doğrulanmış export yüzeyi [src/index.js](src/index.js), TypeScript imzaları [index.d.ts](index.d.ts), güvenlik kuralları [SECURITY.md](SECURITY.md), MCP istemci ayarları [MCP.md](MCP.md) içindedir. Bu belge kavramsal başlangıç ve örnekli referanstır; imza değişikliklerinde `index.d.ts` esas alınır.

## 1. Tasarım sözleşmesi

ExiEngine başka bir oyun motoruna runtime import’u yapmaz. Çekirdek scene graph, 2D geometry, input, physics, audio, asset, batching ve WebGL2/WebGPU backend’leri repo içindedir.

- Runtime dependency yoktur.
- WebGPU tercih edilir; destek yoksa veya seçim `webgl2` ise WebGL2 kullanılır.
- Node.js test, MCP bridge ve yerel preview içindir; browser canvas ve Web Audio gerçek runtime’dır.
- Asset, JSON, URL, input, callback ve GPU kaynakları güvenilmeyen veya sınırlı sınır olarak ele alınır.
- Public koleksiyonlar ve config alanları doğrudan değiştirilebilir görünse bile hot path girişlerinde tekrar doğrulanır.
- Browser/GPU sonucu Node smoke testinden çıkarılamaz; gerçek cihaz kanıtı `test/hardware-soak.html` ile ayrıca alınır.

## 2. Kurulum ve ilk oyun

Repo kökünde Node.js ile:

```powershell
npm run doctor
npm test
npm run dev
```

`index.html` içindeki canvas’a veya kendi HTML sayfanıza aşağıdaki minimal oyun eklenebilir:

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

`ExiEngine.create()` renderer’ı kurar, canvas’ı boyutlandırır, scene’i bağlar ve hazır bir engine döndürür. Manuel lifecycle gerekiyorsa `new ExiEngine(options)`, `await engine.init()`, `engine.start()` kullanılabilir. `step(delta)` yalnızca engine çalışmıyorken deterministic/custom loop içindir.

## 3. Tipler ve ortak değerler

`RendererKind`: `"auto" | "webgpu" | "webgl2"`.

`ResizeMode`: `"resize" | "contain" | "cover"`.

`BlendMode`: `"normal" | "additive" | "multiply"`.

`FilterKind`: `"none" | "grayscale" | "invert" | "brightness" | "sepia" | "contrast" | "saturate"`.

`Point` `{ x, y }`, `ClipRect` `{ x, y, width, height }` ve `MAX_WORLD_COORDINATE` finite dünya koordinatı sınırını ifade eder. Tüm önemli sayısal değerler finite ve bounded olmalıdır.

`Vec2` mutable 2D vektördür: `set`, `copy`, `clone`, `add`, `subtract`, `multiplyScalar`, `length`, `lengthSquared`, `normalize`, `dot`, `distanceTo`, `distanceSquared`, `angle`, `rotate`, `equals`. `Mat3` 2D affine matristir: `identity`, `setTransform`, `multiply`, `transformPoint`.

Pointer, keyboard, focus ve gamepad callback tipleri `index.d.ts` içindeki `EnginePointerEvent`, `EngineKeyEvent`, `EngineFocusEvent`, `GamepadSnapshot` ile tanımlıdır. Event’ler transient’tir; callback dışında saklanmamalıdır.

Safely utility export’ları: `clamp(value, min, max)`, `lerp(from, to, amount)`, `degToRad(degrees)`, `radToDeg(radians)`, `getAABB(node, output?)`, `intersectsAABB(first, second)`, `pointInAABB(bounds, x, y)`, `containsAABB(parent, child)`. KTX2 için `inspectKTX2(bytes, options?)` ve `VK_FORMAT_R8G8B8A8_UNORM` export edilir. Bu top-level fonksiyonlar state tutmaz ve MCP’de `exi_function` ile çağrılır; nested export fonksiyonları `exi_export_call` kullanır.

`findGridPath(grid, start, goal, options?)` dikdörtgen bir grid üzerinde bağımlılıksız ve deterministik A* çalıştırır. Varsayılan olarak `1` hücreleri engeldir; `blockedValues`, `diagonal`, `allowCornerCutting` ve `maxNodes` seçenekleriyle davranış sınırlandırılabilir. `grid` değiştirilmez. Sonuç `{ path, reached, expanded, truncated }` döner; `path` başlangıç ve hedef dahil `{ x, y }` noktalarıdır. Grid en fazla `MAX_GRID_PATH_CELLS` hücre, `maxNodes` ise 1 ile hücre sayısı arasında olabilir. Başlangıç/hedef engelliyse veya limit nedeniyle erişilemiyorsa `reached:false` döner.

```js
const result = findGridPath(
  [[0, 0, 1], [1, 0, 0], [0, 0, 0]],
  { x: 0, y: 0 },
  { x: 2, y: 2 },
  { diagonal: false, maxNodes: 1000 },
);
// { reached: true, truncated: false, expanded: ..., path: [...] }
```

## 4. Engine lifecycle ve renderer

### `ExiEngine`

Constructor seçenekleri:

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

Ana lifecycle metotları:

- `static create(options): Promise<ExiEngine>`: browser’da async backend kurulumu.
- `init(): Promise<this>`: renderer ve input hazırlığı.
- `start(): this`, `stop(): this`: RAF loop yönetimi.
- `pause(): this`, `resume(): this`: simülasyonu kontrollü durdurma.
- `step(delta): this`: custom loop için tek bounded frame.
- `destroy(): void`: renderer, input, audio, asset ve event listener teardown’ı.
- `prepare(): { batches, uploads }`: ilk görünür frame allocation/upload hazırlığı.
- `getInfo(): Record<string, unknown>`: backend, limit, texture, batch, frame ve lifecycle metrikleri.
- `setScene(scene, camera?)`, `setOverlay(scene, camera?)`: sahne değişimini pointer/cache yaşam döngüsüyle atomik yapar.
- `setLogicalSize(width, height)`, `setResizeMode(mode)`, `resize()`: responsive canvas sözleşmesi.
- `setTimeScale(value)`: `0..16` bounded simulation scale.
- `focus(node?)`, `blur()`, `focusNext(reverse?)`: canvas UI odağı.
- `renderToTexture(target, scene?, camera?, time?)`: offscreen render pass.
- `captureFrame({ columns?, rows? })`: en fazla 64×64 geçici RenderTexture’a render edip GPU readback sonucu (`pixels`, `format`, `flipY`) döndürür; AI gözlemcisi bunu ham görüntü yerine bounded grid’e çevirir.

Renderer hataları `onStatus` ile `renderer-error`, `runtime-error`, `device-lost` gibi metadata’lı olaylar olarak bildirilir. Callback exception’ı lifecycle’ı bozmamalıdır.

## 5. Scene graph

### `Node` ve `Scene`

```js
const root = new Scene();
const player = new Node({ name: "player", x: 100, y: 80, interactive: true });
root.add(player);
player.setAlpha(0.9).setBlendMode("normal");
player.setCullBounds({ x: -32, y: -32, width: 64, height: 64 });
```

`Node` transform alanları `position`, `scale`, `rotation`, `zIndex`; görünürlük alanları `visible`, `alpha`, `filter`, `blendMode`; etkileşim alanları `interactive`, `hitArea`, focus ve pointer callback’leridir.

Temel metotlar:

- `add(...nodes)`: child ekler ve reparent eder; cycle, duplicate, destroyed node ve capacity kontrolü yapar.
- `remove(node)`: child’ı ayırır.
- `destroy()`: child graph ve bağlı kaynakları yaşam döngüsünden çıkarır.
- `setClipRect`, `setMaskRect`, `setMaskTexture`, `setCullBounds`, `setHitArea` ve ilgili `clear*` metotları.
- `setInteractive`, `setPointerHandlers`, `setUpdateHandler`, `setFocusHandlers`, `setFocusable`.
- `setLayout`, `clearLayout`, `applyLayout`: overlay viewport layout’ı.
- `traverse(callback)`, `find(predicate)`, `findByName(name)`: sahne grafiğinde güvenli arama ve dolaşma.
- `containsPoint(worldX, worldY)`, `isAncestorOf(node)`, `collectFocusables`.
- `update(delta)`, `updateWorldMatrix(...)`, `collectRenderables(...)`, `collectHitTestables(...)`: çoğunlukla engine tarafından çağrılır.

`Scene.pick(worldX, worldY, predicate?)` world transform ve z-order’a göre interactive node seçer. Pointer olayları child’dan parent’a bubble eder; `stopPropagation()` ve `preventDefault()` kullanılabilir.

### `Camera`

```js
const camera = new Camera({ width: 960, height: 540, zoom: 1, roundPixels: true });
camera.follow(player, { smoothing: 8, deadzoneWidth: 160, deadzoneHeight: 90 });
camera.setBounds({ x: 0, y: 0, width: 4000, height: 2000 });
camera.shake(8, 0.25, { frequency: 30 });
const visibleBounds = camera.getVisibleBounds();
```

`worldToScreen`, `screenToWorld`, `getVisibleBounds`, `setViewport`, `setScreenViewport`, `setPixelRatio`, `setRoundPixels`, `setBounds`, `zoomAt`, `follow`, `clearFollow`, `shake`, `clearShake`, `update` sağlar. `contain` modunda letterbox alanı pointer için geçersizdir.

## 6. Renderable sınıfları

### `Texture`, `RenderTexture`

```js
const white = Texture.white;
const spriteTexture = Texture.fromImage(image, { id: "player", filter: "nearest" });
const frame = spriteTexture.subTexture({ x: 0, y: 0, width: 32, height: 32 });
const target = new RenderTexture({ id: "minimap", width: 320, height: 180 });
```

`Texture` static `white`, `fromImage`, `subTexture`, `setFilter`, `markDirty`, `updateSource`, `destroy` içerir. `Texture` subtexture base GPU kaynağını paylaşır; subtexture destroy edilmesi base texture’ı sahiplenmez.

`RenderTexture` `resize`, `subTexture`, `updateSource` ile minimap/portal/UI hedefidir. `renderToTexture` sırasında kaynak hedefle aynı texture’a render edilmesi feedback loop olarak reddedilir.

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

`setTexture`, `setTint`, `setFlip`, `getLocalBounds` sağlar. `flipX/flipY` UV seviyesinde uygulanır; geometri stride’ını büyütmez.

### `NineSliceSprite`

Panel texture’ını `left/right/top/bottom` border’larıyla ölçekler. `setBorders`, `setSize`, `getLocalBounds` kullanılır.

### `Text`, `TextCache`, `GlyphAtlas`

```js
const score = new Text({ text: "SCORE 000", fontFamily: "sans-serif", fontSize: 24, fill: "#fff" });
score.setStyle({ wordWrap: true, maxWidth: 240 });
hud.add(score);
score.setText("SCORE 001");
```

`Text.setText`, `setStyle`, `redraw` Canvas 2D raster cache’ini yönetir. `TextCache` aynı stil/metin tekrarlarını bounded referans sayımıyla paylaşır. `GlyphAtlas` glyph rasterizasyonunu azaltır; `getInfo`, `clear`, `destroy` sağlar. Karmaşık shaping için Canvas fallback’i korunur.

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

`clear`, `rect`, `roundedRect`, `circle`, `ellipse`, `triangle`, `line`, `strokeRect`, `strokeCircle`, `polygon`, `getLocalBounds` vardır. Polygon ear-clipping ve komut/point limitleri engine tarafından bounded tutulur.

### `SpriteBatch`

Tek texture/atlas kullanan yoğun sprite layer’larında node başına overhead’i kaldırır:

```js
const batch = new SpriteBatch({ texture: Texture.white, instanced: true, gpuCulling: true });
const index = batch.addSprite({ x: 10, y: 20, width: 16, height: 16, tint: 0xffffff });
batch.setSprite(index, { x: 40 });
batch.markDirty();
```

`addSprite`, `addSprites`, `setSprite`, `removeSprite`, `clear`, `setTexture`, `setFrame`, `getLocalBounds` ve animasyon için `addAnimatedSprite`, `setSpriteAnimation`, `playSprite`, `stopSprite`, `gotoSpriteFrame`, `updateAnimations` sağlar. `instanced` WebGL2/WebGPU instancing; `gpuCulling` WebGPU compute/indirect yolu, WebGL2 güvenli CPU fallback’idir.

### `AnimatedSprite`

`setFrames`, `gotoFrame`, `play`, `stop`, `update` sağlar. `TextureAtlas.getClip()` çıktısı doğrudan constructor’a verilebilir; frame dizisi snapshot’lanır.

### `ParticleEmitter`

`emit(count, options?)`, `burst(count, options?)`, `clear()`, `count` ve `update(delta)` ile bounded object pool kullanır. `gpuCulling: true` WebGPU’da world/cull işini compute aşamasına bırakır.

### `TileMap`

```js
const map = new TileMap({ width: 100, height: 60, tileWidth: 16, tileHeight: 16, texture: atlasTexture });
map.setTile(4, 8, 2, { flipX: true });
map.setRegion(0, 0, 10, 10, values);
const staticBodies = map.createStaticBodies(physics, { solidTiles: new Set([1, 2]) });
```

`index`, `inBounds`, `setTile`, `getTile`, `setTiles`, `setRegion`, `rebuild`, `getCollisionRects`, `createStaticBodies` sağlar. Tile başına Sprite üretmez; typed-array ve region girişleri atomik doğrulanır.

### `RenderGroup`

Çocukları RenderTexture pass’inde toplar. `resize`, `setEffects`, `clearEffects`, `getEffects`, `getRenderCamera` sağlar. Effect listesi allowlist filtrelerden oluşur ve sınırlı ping-pong target kullanır.

## 7. Atlas ve asset yükleme

### `TextureAtlas`

```js
const atlas = TextureAtlas.fromGrid(texture, {
  frameWidth: 32, frameHeight: 32, columns: 8, rows: 4,
  names: ["idle-0", "idle-1" /* ... */],
});
const clip = atlas.getClip(["idle-0", "idle-1"], { frameRate: 8, loop: true });
```

`get`, `getFrames`, `getClip`, `has`, `destroy`, `fromJSON`, `fromGrid`, `pack` sağlar. Frame’ler atlas texture sınırları içinde olmalı; `rotated`/`trimmed` metadata bilinçli olarak reddedilir.

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

Metotlar: `resolve`, `loadBytes`, `loadJSON`, `loadTexture`, `loadAtlas`, `inspectKTX2`, `loadKTX2`, `loadMany`, `release`, `clear`, `destroy`.

`loadMany` entry biçimi `{ key, type, url, atlasUrl?, options?, decoder? }` şeklindedir. `type`: `texture`, `json`, `bytes`, `ktx2`, `atlas`. Aynı URL/sinyal işlerini paylaşır; caller abort yalnızca o caller promise’ini keser. Origin, redirect, credential URL, byte/image/pixel/JSON/cache limitleri ve optional integrity doğrulaması uygulanır.

### KTX2

`inspectKTX2(bytes)` bounded header/level bilgisi döndürür. `loadKTX2` RGBA8’i kendi yolu ile açabilir; sıkıştırılmış Basis/KTX2 için uygulama açıkça güvenilen `decoder` adaptörü vermelidir. Decoder dış asset kodu olarak otomatik yüklenmez.

## 8. Input, animation ve physics

### `Input`

Input engine tarafından canvas’a bağlanır; doğrudan kullanım için `new Input(canvas, options)` mümkündür. `bindAction`, `unbindAction`, `bindAxis`, `unbindAxis`, `getBindings`, `setBindings`, `getAxis`, `getActionAxis`, `getVector`, action/key/pointer/gamepad sorguları, `getPointerWorld`, `rumbleGamepad`, bounded `injectKeyDown`/`injectKeyUp`/`injectPointer`/`inject`, `beginFrame`, `endFrame`, `destroy` sağlar.

```js
engine.input.bindAction("jump", "Space");
engine.input.bindAxis("moveX", { type: "key-axis", positive: "KeyD", negative: "KeyA" });
engine.input.bindAxis("moveY", { type: "key-axis", positive: "KeyS", negative: "KeyW" });
if (engine.input.wasActionPressed("jump")) playerJump();
const move = engine.input.getVector("moveX", "moveY");
player.position.x += move.x * 240 * delta;
player.position.y += move.y * 240 * delta;
```

Binding ve raw state kapasitesi bounded’dir; gamepad hot-plug snapshot verir, native Gamepad nesnesini dışarı sızdırmaz.

AI testleri ve replay için native DOM event’i üretmeden deterministic input tape uygulanabilir:

```js
engine.stop();
engine.input.inject([{ type: "keydown", code: "ArrowRight" }]);
engine.step(1 / 60);
engine.input.inject([{ type: "keyup", code: "ArrowRight" }]);
engine.step(1 / 60);
```

`inject` en fazla 128 event alır; key code, pointer koordinatı, pointerId, button ve modifier alanları sınırlandırılır. Bu yöntem gerçek kullanıcı izni/OS input’u değildir; yalnızca sayfanın kendi Input state’ini kontrollü biçimde besler.

### `Tween`, `Animator`, `easing`

```js
const animator = new Animator({ maxTweens: 1024 });
animator.add(new Tween(player.position, "x", 600, 0.8, { ease: easing.outCubic }));
const engine = await ExiEngine.create({ canvas, scene, animator });
```

`Tween.update`, `Animator.add/remove/update/clear`, `easing` (linear, smooth, in/out/inOut quad, cubic, sine, expo, bounce, elastic) fonksiyonları vardır. Engine animator’ı fixed-step sırasına bağlarsa sıra `scene → animator → physics → onUpdate` olur.

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

`Collider` generic AABB, `CollisionWorld` broadphase/query/raycast/overlapCircle; `PhysicsBody` velocity/static/kinematic ayarı; `PhysicsWorld` add/remove/sync/overlaps/overlapCircle/step/clear ve begin/stay/end contact callback’leri sağlar. Layer/mask, one-way, trigger, local bounds, finite velocity ve body/cell kapasitesi uygulanır.

## 9. Save, audio ve profiler

### `SaveStore`

`new SaveStore({ namespace, storage, maxBytes })`, `key`, `get`, `set`, `remove` sağlar. Yalnızca JSON veri saklar; namespace/key/byte/node/depth sınırları vardır. Executable/script veri yoktur.

### `AudioManager`

`ensureContext`, `createBus`, `getBus`, `getBusNames`, `setBusVolume`, `getBusVolume`, `setBusMuted`, `isBusMuted`, `fadeBus`, `stopBus`, `unlock`, `load`, `loadMany`, `play`, `stopVoice`, `stopAll`, `suspend`, `resume`, `setVoiceVolume`, `setVoicePan`, `has`, `unload`, `destroy` sağlar.

AudioContext browser autoplay politikasına tabidir; `unlock()` kullanıcı gesture sonrasında çağrılmalıdır. Decode byte, decoded byte, voice, bus ve lifecycle sınırları uygulanır.

### `Profiler`

`begin(time)`, `end(time, metrics?)`, `snapshot()` ile frame/fps/frameMs ve renderer metriklerini taşır.

## 10. AI CLI MCP bridge

Bridge komutu (MCP stdio’da npm başlığı stdout’a karışmaması için doğrudan Node):

```powershell
node tools/exi-mcp-server.mjs
```

Transport yalnızca newline-delimited JSON-RPC stdio’dur. stdout’a log yazılmaz; hata tanısı stderr’dedir. Engine state’ine dokunan `tools/call` istekleri arrival sırasıyla tek kuyrukta işlenir; birden fazla asset yükünü tek çağrıda `loadMany()` ile toplamak önerilir. Uzun çalışan aktif veya kuyrukta bekleyen tool isteği, JSON-RPC cancellation bildirimiyle yanıt üretmeden iptal edilebilir:

```json
{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":42,"reason":"agent stopped waiting"}}
```

`requestId`, iptal edilecek `tools/call` id’siyle aynı olmalıdır. `exi_check`, `exi_project_check` ve `exi_project_open` child/syntax-check akışlarını; `exi_preview_start` ise başarısız/iptal başlangıç preview’ını bounded cleanup ile sonlandırır. Cancellation bir tool değildir ve response gönderilmez. MCP lifecycle sırası:

Uzun çağrılarda istemci request `params._meta.progressToken` verirse bridge `notifications/progress` gönderir; örneğin `exi_check` için `progress: 0` başlangıç, `progress: 1` tamamlanma bildirir. Progress yalnızca kullanıcı arayüzü/heartbeat bilgisidir; doğrulanabilir sonuç yine `tools/call` yanıtıdır.

Güncel MCP `2026-07-28` modern akışında `initialize` yoktur. İstemci önce `server/discover` çağırır; her modern request `params._meta` içinde `io.modelcontextprotocol/protocolVersion`, `io.modelcontextprotocol/clientCapabilities` ve isteğe bağlı `io.modelcontextprotocol/clientInfo` taşır:

```json
{"jsonrpc":"2.0","id":"discover-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"my-agent","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
```

Modern result yanıtlarında `resultType: "complete"` ve `result._meta["io.modelcontextprotocol/serverInfo"]` bulunur. Legacy istemciler aşağıdaki `initialize` akışını kullanmaya devam eder; bridge iki dönemi aynı stdio process içinde kabul eder.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"my-agent","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"resources/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/list"}
```

Server `2026-07-28` modern sürümünü ve `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` legacy sürümlerini destekler. Standard MCP kaynakları:

| URI | İçerik |
| --- | --- |
| `exi://api` | Runtime reflection manifesti |
| `exi://types` | `index.d.ts` |
| `exi://guide` | AI çalışma sözleşmesi |
| `exi://security` | Tehdit modeli ve limitler |
| `exi://runtime` | Browser runtime telemetry selector/attribute sözleşmesi |
| `exi://clients` | Codex/Claude/OpenCode/Gemini/Cursor/Cline/Windsurf stdio config sözleşmeleri |

### Prompt yüzeyi

`prompts/list` iki reusable workflow döndürür: `exi_create_game` (oyun oluşturma) ve `exi_verify_runtime` (static preview + gerçek browser telemetry doğrulaması). `prompts/get` yalnızca bounded text prompt üretir; shell, dosya yazma veya runtime mutation yapmaz.

```json
{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"exi_create_game","arguments":{"goal":"top-down arena"}}}
```

İstemci prompt içindeki adımları takip eder: `exi_api` → yeni proje için `exi_scaffold` veya mevcut proje için `exi_project_open` → normal AI CLI file editörü → `exi_asset_*` ile asset yükleme → `exi_project_preview` (veya ayrı `exi_project_check` + `exi_preview_start`) → browser içinde `AssetLoader.loadTexture`/`loadAtlas`/`loadJSON` → `exi://runtime` browser kanıtı → `exi_check` → cleanup. Browser yeteneği olmayan istemci runtime adımını static HTTP kanıtından ayrı raporlamalıdır.

### Tool tablosu

| Tool | Görev |
| --- | --- |
| `exi_api` | Export, class, instance method, static method, nested member ve kanonik route manifesti |
| `exi_create` | Public class constructor çağrısı |
| `exi_function` | Top-level public function çağrısı |
| `exi_export_get` | `Texture.white` veya başka allowlisted export/static property okuma |
| `exi_export_call` | `easing.linear` gibi nested export ağacı fonksiyonu |
| `exi_static_call` | Class static method çağrısı |
| `exi_call` | Handle üzerindeki public method; sync/async sonucu beklenir |
| `exi_inspect` | Handle’ın getter çalıştırmadan public method/property metadata’sını döndürme |
| `exi_get` | Handle property/getter okuma |
| `exi_set` | Public scalar veya başka handle ile property yazma; collection replacement yok |
| `exi_release` | Handle’ı bırakma ve owned `destroy()` lifecycle’ı |
| `exi_session_status` | Getter çalıştırmadan bounded handle, scope, upload ve preview session metadata’sı |
| `exi_session_reset` | Oturum handle’larını temizleme |
| `exi_build_scene` | Bounded JSON scene graph oluşturma |
| `exi_scaffold` | Güvenli starter browser game üretme; staged multi-file commit/rollback |
| `exi_project_open` | Mevcut repo-içi oyunu statik kontrol edip session scope’una açma |
| `exi_project_apply` | En fazla 16 bounded text dosyasını transactional staging/commit/rollback ile uygulama |
| `exi_file_list` | Scaffold edilen veya açılan proje içindeki allowlisted text dosyalarını bounded metadata ile listeleme |
| `exi_file_read` | Repo içindeki allowlisted text proje dosyasını bounded okuma |
| `exi_file_write` | Repo içindeki allowlisted text proje dosyasını oluşturma/güncelleme |
| `exi_file_patch` | Mevcut text proje dosyasında tekil `find` eşleşmesini atomik olarak değiştirme |
| `exi_file_begin` | 64 KiB üzeri text proje dosyası için sıralı chunk upload başlatma |
| `exi_file_chunk` | Text chunk upload’a UTF-8 parçası ekleme |
| `exi_file_commit` | Tamamlanan text upload’ı hedef dosyaya commit etme |
| `exi_file_abort` | Text upload geçici dosyasını temizleme |
| `exi_asset_list` | Scaffold edilen veya açılan proje içindeki allowlisted binary oyun asset’lerini metadata ile listeleme |
| `exi_asset_read` | Allowlisted asset’in 32 KiB’a kadar bounded byte aralığını okuma |
| `exi_asset_write` | Scaffold edilen veya açılan projeye bounded binary oyun asset’i yükleme |
| `exi_asset_begin` | 512 KiB üzeri asset için sıralı chunk upload başlatma |
| `exi_asset_chunk` | Chunk upload’a bounded byte parçası ekleme |
| `exi_asset_commit` | Tamamlanan chunk upload’ı hedef dosyaya commit etme |
| `exi_asset_abort` | Chunk upload geçici dosyasını temizleme |
| `exi_file_check` | Scaffold edilen veya açılan proje `.html`/`.js`/`.mjs`/`.json` dosyasında shell’siz statik kontrol |
| `exi_project_status` | Aynı session scope’undaki text dosyaları, asset metadata’sı, statik check ve eşleşen preview telemetry’sini tek read-only bounded sonuçta özetleme |
| `exi_project_check` | Scaffold edilen veya açılan oyunun tüm checkable text dosyalarını tek bounded akışta doğrulama |
| `exi_check` | Yalnızca `doctor`, `test`, `verify` |
| `exi_preview_start` | Repo server’ını loopback’te başlatma ve preview telemetry kanalını hazırlama |
| `exi_preview_call` | Token-korumalı demo veya scaffold browser RuntimeAgent üzerinden allowlisted engine işlemi çağırma |
| `exi_preview_batch` | En fazla 8 browser RuntimeAgent operation’ını tek round-trip’te sıralı çalıştırma |
| `exi_preview_probe` | Preview GET ile HTML/asset veya token-managed runtime telemetry doğrulama |
| `exi_preview_stop` | Preview process cleanup |
| `exi_batch` | En fazla 128 public tool çağrısını sırayla çalıştırma |

`tools/list` yanıtındaki MCP `annotations` alanları da güvenlik niyetini taşır: `exi_api`, `exi_inspect`, `exi_get`, `exi_session_status`, `exi_project_status`, `exi_project_check`, `exi_check` ve `exi_preview_probe` salt-okuma; `exi_set`, `exi_release`, `exi_scaffold`, `exi_preview_call`, `exi_preview_batch` ve `exi_preview_stop` destructive mutation olarak işaretlenir. Bunlar istemciye verilen hint’lerdir; gerçek güvenlik sınırı bridge doğrulamasıdır.

### Tool parametreleri ve sonuçları

| Tool | Girdi | Başarılı sonuç |
| --- | --- | --- |
| `exi_api` | `{}` | `{ protocol, supportedProtocols[], mcpEra, server, transport, resources, callRoutes, limits, workflow, exports[] }`; each export includes `route`, `methodRoutes`, `staticMethodRoutes`, `members[]` and `staticProperties[]` |
| `exi_session_status` | `{}` | `{ handleCount, protectedHandleCount, handles[], scopes[], assetUploads[], projectFileUploads[], previews[] }`; token ve temp path içermez |
| `exi_session_reset` | `{}` | `{ released: true }`; handle, upload ve aynı session preview process’lerini temizler |
| `exi_create` | `{ type, args? }` | `{$handle, type}` |
| `exi_function` | `{ name, args? }` | Fonksiyon sonucu |
| `exi_export_get` | `{ path }` | Sabit/static değer veya protected handle |
| `exi_export_call` | `{ path, args? }` | Async beklenmiş fonksiyon sonucu |
| `exi_static_call` | `{ type, method, args? }` | Async beklenmiş static method sonucu |
| `exi_call` | `{ handle, method, args? }` | Async beklenmiş instance method sonucu |
| `exi_inspect` | `{ handle }` | `{ handle, type, methods[], properties[] }`; getter değerleri okunmaz |
| `exi_get` | `{ handle, property }` | Property/getter sonucu |
| `exi_set` | `{ handle, property, value }` | `{ handle, property, value }` |
| `exi_release` | `{ handle }` | `{ released: handle }` |
| `exi_build_scene` | `{ scene: { type, options?, children? } }` | Root `{$handle, type}` |
| `exi_scaffold` | `{ directory?, overwrite? }` | `{ directory, files[] }` |
| `exi_project_apply` | `{ path, files: [{ path, content, expectedVersion? }], overwrite? }` | `{ directory, applied, bytes, files: [{ path, bytes, overwritten }] }`; 16 dosya/512 KiB toplam, hata halinde rollback ve stale version conflict |
| `exi_file_list` | `{ path }` | `{ directory, files: [{ path, bytes, version: { bytes, mtimeMs } }] }` |
| `exi_file_read` | `{ path, offset?, limit? }` | `{ path, offset, nextOffset, totalBytes, bytes, version: { bytes, mtimeMs }, complete, content }` |
| `exi_file_write` | `{ path, content, overwrite?, expectedVersion?, expectedSha256? }` | `{ path, bytes, sha256, overwritten }`; eksik parent klasörler scaffold içinde oluşturulur, version uyuşmazlığı `EXI_MCP_FILE_CONFLICT`, hash uyuşmazlığı `EXI_MCP_UPLOAD_INTEGRITY` döndürür |
| `exi_file_patch` | `{ path, find, replace }` | `{ path, bytes, replacedBytes, matchCount, overwritten }`; `find` tam olarak bir kez eşleşmelidir |
| `exi_file_begin` | `{ path, size, overwrite?, expectedVersion?, expectedSha256? }` | `{ fileUploadId, path, expectedBytes, receivedBytes, chunkBytes, expectedSha256? }`; commit sırasında version ve içerik hash’i tekrar doğrulanır |
| `exi_file_chunk` | `{ fileUploadId, offset, content }` | `{ fileUploadId, path, receivedBytes, expectedBytes, remainingBytes, complete }` |
| `exi_file_commit` | `{ fileUploadId }` | `{ fileUploadId, path, bytes, sha256?, overwritten }` |
| `exi_file_abort` | `{ fileUploadId }` | `{ fileUploadId, aborted: true }` |
| `exi_asset_list` | `{ path }` | `{ directory, assets: [{ path, bytes, type, version: { bytes, mtimeMs } }] }` |
| `exi_asset_read` | `{ path, offset?, limit? }` | `{ path, offset, nextOffset, totalBytes, bytes, version: { bytes, mtimeMs }, complete, data: { "$bytes": base64 } }`; aralık en fazla 32 KiB |
| `exi_asset_write` | `{ path, bytes: { "$bytes": [...]\|base64 }, overwrite?, expectedVersion?, expectedSha256? }` | `{ path, bytes, type, sha256, overwritten }`; eksik parent klasörler scaffold içinde oluşturulur, version uyuşmazlığı `EXI_MCP_FILE_CONFLICT`, hash uyuşmazlığı `EXI_MCP_UPLOAD_INTEGRITY` döndürür |
| `exi_asset_begin` | `{ path, size, overwrite?, expectedVersion?, expectedSha256? }` | `{ uploadId, path, expectedBytes, receivedBytes, chunkBytes, expectedSha256? }`; commit sırasında version ve içerik hash’i tekrar doğrulanır |
| `exi_asset_chunk` | `{ uploadId, offset, bytes: { "$bytes": [...]\|base64 } }` | `{ uploadId, path, receivedBytes, expectedBytes, remainingBytes, complete }` |
| `exi_asset_commit` | `{ uploadId }` | `{ uploadId, path, bytes, type, sha256?, overwritten }` |
| `exi_asset_abort` | `{ uploadId }` | `{ uploadId, aborted: true }` |
| `exi_file_check` | `{ path }` (`.html`, `.js`, `.mjs`, `.json`) | `{ path, kind, ok, code, stdout, stderr, references? }` |
| `exi_project_check` | `{ path }` | `{ directory, ok, files, checked, skipped, failureCount, failures[] }` |
| `exi_project_status` | `{ path }` | `{ directory, ok, projectCheck, files[], assets[], previews: [{ previewId, directory, pagePath, pageUrl, port, ready, runtime }] }`; aynı scope’taki `exi_project_preview` veya path’i bu proje altında olan doğrudan `exi_preview_start` preview’ları eşlenir, runtime report’u yoksa `runtime.ok=false` veya `telemetry:null` döner |
| `exi_project_preview` | `{ path, port? }` | `{ ok, phase, directory, projectCheck, preview? }`; önce statik check yapar, başarısızsa preview başlatmaz; başarılıysa `preview.previewId/pageUrl` döndürür |
| `exi_project_open` | `{ path }` | `{ directory, opened, ok, files, checked, skipped, failureCount, failures[] }`; statik kontrolden sonra aynı session file/asset scope’u |
| `exi_check` | `{ mode: "doctor" | "test" | "verify" }` | `{ ok, code, stdout, stderr }` |
| `exi_preview_start` | `{ port?, path? }` | `{ previewId, url, pagePath, pageUrl, port, ready, runtime: { path, tokenManaged } }`; `path` verilirse o repo-içi sayfa HTTP 200 olmadan hazır dönmez |
| `exi_preview_call` | `{ previewId, operation, name?, path?, type?, method?, handle?, property?, value?, args? }` | Browser RuntimeAgent sonucu; operation `function`, `create`, `export_get`, `export_call`, `static_call`, `call`, `inspect`, `get`, `set`, `release`, `observe`, `snapshot` veya `scenario` |
| `exi_preview_batch` | `{ previewId, calls, stopOnError? }` | `{ completed, failed, stopped, results[] }`; en fazla 8 call, her call `operation` alanı ile aynı operation listesinden seçim yapar; `observe` bounded canvas grid/hash, `snapshot` bounded scene graph/hash, `scenario` bounded input/step/observation döndürür; sonraki call içinde `{"$result":0}` veya `{"$result":0,"$path":"value"}` referansı |
| `exi_preview_probe` | `{ previewId, path? }` | `{ status, ok, contentType, body }`; `path: "/__exi/runtime"` token ile gerçek browser raporunu okur |
| `exi_preview_stop` | `{ previewId }` | `{ stopped: previewId }` |
| `exi_batch` | `{ calls: [{ name, arguments? }], stopOnError? }` | `{ completed, failed, stopped, results[] }` |

`args` her public function/constructor/static/instance çağrısında JSON array olmalıdır; eksikse boş array kullanılır, başka türler `EXI_MCP_ARGS_TYPE` ile reddedilir. Dizi içindeki handle referansı yalnızca tam olarak `{ "$handle": "hN" }` biçiminde çözülür; iç içe option nesneleri de recursive çözülür. Binary API’ler için `{ "$bytes": [0, 1, 255] }` veya bounded base64 `{ "$bytes": "..." }` `Uint8Array` olarak çözülür. `exi_set` method overwrite’ını, collection replacement’ını ve handle olmayan canlı object replacement’ını reddeder.

`tools/list` her MCP aracının üst seviye input schema’sını `additionalProperties:false` ile yayımlar. Bridge de aynı kapıyı uygular; şemada olmayan üst seviye alan `EXI_MCP_ARGUMENT_UNKNOWN`, tool argümanı object değilse `EXI_MCP_ARGS_TYPE`, eksik zorunlu alan `EXI_MCP_ARGUMENT_REQUIRED`, enum/type/limit/şema ihlalleri ise sırasıyla `EXI_MCP_ARGUMENT_ENUM`, `EXI_MCP_ARGUMENT_TYPE`/`EXI_MCP_ARGUMENT_LIMIT` ve `EXI_MCP_ARGUMENT_INVALID` olur. Asset upload şeması `$bytes` array veya base64 biçimini açıkça taşır; nested engine `args` JSON olduğu için handle/byte referansları yine recursive çözülür.

`exi_call`/`exi_function` sonucu bir typed array veya `DataView` ise bridge; `type`, `length`, `byteLength`, ilk 16 elemanlık `sample` ve byte’lar `bytes: { "$bytes": "base64" }` alanlarını döndürür. Inline byte payload’ı `exi_api.limits.maxInlineBinaryBytes` ile sınırlıdır (32 KiB); daha büyük sonuçlarda `bytes: { "truncated": true, "maxInlineBytes": 32768 }` gelir ve tam asset için `exi_asset_read` kullanılmalıdır. `exi_batch` içinde `{"$result":0,"$path":"bytes"}` bu bounded byte sonucunu sonraki binary API’ye yeniden `Uint8Array` olarak bağlar; bu sayede `AssetLoader.loadBytes()` sonucu AI çağrı zincirinde kaybolmaz. `DataView` sample’ı byte, BigInt typed-array sample değerleri JSON güvenliği için string olarak taşınır.

`exi_project_open({ path })` mevcut repo-içi klasörü symlink/engine/test/tool/traversal sınırlarında doğrular, kontrol edilebilir HTML/JS/JSON dosyalarını statik kontrol eder ve başarılı scope kaydı döndürür; hatalı proje de düzeltilebilmesi için `ok: false` raporuyla açılabilir, kontrol edilebilir dosyası olmayan/allowlist dışı klasör açılamaz. Bundan sonra `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch` aynı MCP session’ında `exi_scaffold` ile oluşturulmuş veya `exi_project_open` ile açılmış proje klasörlerindeki `.css`, `.html`, `.js`, `.json`, `.mjs`, `.md`, `.svg`, `.ts` ve `.txt` uzantılarını kabul eder. Tek çağrılı `exi_file_write` ve `exi_file_patch` metinleri 64 KiB UTF-8 sınırındadır; patch sıfır veya birden fazla `find` eşleşmesinde dosyaya dokunmaz. Daha büyük kaynaklar `exi_file_begin` → `exi_file_chunk` → `exi_file_commit` akışıyla 4 MiB’a kadar yazılabilir. `exi_file_read` normal dosyada doğrudan, büyük dosyada UTF-8 sınırlarını koruyan `offset`/`limit` sayfalarıyla en fazla 48 KiB döndürür. Listeleme en fazla 1.024 dosya/32 klasör derinliği döndürür ve her dosya için `{ path, bytes, version: { bytes, mtimeMs } }` metadata verir. Okunan/listelenen `version`, `exi_file_write`, `exi_file_begin` veya `exi_project_apply` içindeki `expectedVersion` alanına verildiğinde başka bir değişiklik varsa `EXI_MCP_FILE_CONFLICT` ile stale overwrite reddedilir; bu optimistic guard kilit değildir ve son kontrol/yazma arasında dış yarış penceresi kalabilir. `exi_file_write` ve chunk commit eksik parent klasörleri proje scope’u içinde oluşturur; `exi_file_patch` mevcut dosya ister. Engine/test/tool kökleri, `.env`, credential uzantıları, binary dosyalar, traversal ve symlink reddedilir. Mevcut dosyayı yalnızca `overwrite: true` ile değiştirir; direct/chunk overwrite ve unique patch yeni içeriği önce geçici dosyaya yazar, eski dosyayı backup ile korur ve rename başarısız olursa geri yükler.
`exi_asset_list`/`exi_asset_read`/`exi_asset_write` scaffold edilen veya `exi_project_open` ile açılan proje scope’unu ve symlink kontrollerini korur. Asset listesi yalnızca allowlisted image/audio/font/KTX2 uzantılarını metadata olarak döndürür ve her kaynağın `{ bytes, mtimeMs }` version’unu verir; `exi_asset_read` tam dosyayı belleğe almadan `offset`/`limit` ile en fazla 32 KiB byte aralığını `{ "$bytes": base64 }` olarak verir. Upload payload’ı `{ "$bytes": [0..255] }` veya bounded base64 olabilir ve mutlak 512 KiB ile sınırlıdır. Asset aracı arbitrary binary veya executable yazmaz; mevcut dosyayı `overwrite: true` ile değiştirirken `expectedVersion` verilirse stale asset overwrite’ı `EXI_MCP_FILE_CONFLICT` ile durdurur.
512 KiB üzeri dosyalarda `exi_asset_begin` → `exi_asset_chunk` (offset her zaman önceki `receivedBytes`) → `exi_asset_commit` sırası kullanılır. Hata veya vazgeçme durumunda `exi_asset_abort` çağrılmalıdır. Chunk upload geçici dosyaya yazar; commit edilmemiş dosyalar session reset veya MCP process kapanışında temizlenir. Tek asset 64 MiB, bekleyen upload toplamı 64 MiB ve aktif upload sayısı 8 ile sınırlıdır.

Örnek binary asset upload:

```json
{"name":"exi_asset_write","arguments":{"path":"ai-game/assets/player.png","bytes":{"$bytes":"iVBORw0KGgo="}}}
```

Bu örnekteki payload yalnızca akış biçimini gösterir; gerçek PNG/audio/KTX2 byte’ları uygulama tarafından sağlanmalıdır. Upload sonrası `exi_asset_list`, `exi_preview_probe` ve `AssetLoader.loadBytes()` ile sırasıyla metadata, HTTP MIME ve engine fetch kanıtı alınabilir.

Büyük asset akışı:

```json
{"name":"exi_asset_begin","arguments":{"path":"ai-game/assets/world.ktx2","size":600000}}
{"name":"exi_asset_chunk","arguments":{"uploadId":"u1","offset":0,"bytes":{"$bytes":"..."}}}
{"name":"exi_asset_chunk","arguments":{"uploadId":"u1","offset":400000,"bytes":{"$bytes":"..."}}}
{"name":"exi_asset_commit","arguments":{"uploadId":"u1"}}
```
`exi_file_check` aynı session kapsamını ve 64 KiB sınırını korur; `.js`/`.mjs` için Node’un `--check` parse yolunu, `.json` için önce 16.384 düğüm/32 derinlik metin bütçesini ve sonra `JSON.parse()` yolunu, `.html` için ise local script/style referansı ve traversal/dış URL kontrolünü kullanır. Kod çalıştırmaz, shell açmaz ve browser/API runtime doğrulamasının yerine geçmez.
`exi_project_check` aynı kontrolleri scaffold edilmiş veya `exi_project_open` ile açılmış klasördeki en fazla 128 checkable dosyaya uygular; dosya listesi, başarılı kontrol sayısı ve en fazla 32 hata özeti döndürür. Bu statik kapı browser runtime kanıtının yerine geçmez; sonrasında preview ve `#exi-runtime` kontrolü yapılmalıdır.

`exi_api.resources` canonical `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime` ve `exi://clients` belge URI’larını, `exi_api.callRoutes` ise constructor/function/nested export/static method/instance method/property/inspect ve browser runtime işlemlerinin tool eşlemesini verir. `exi_api.exports[]` içindeki export `route` alanı ile doğrudan kullanılacak tool’u, `methodRoutes`/`staticMethodRoutes` instance ve static method route’larını, nested `members[]` ve `staticProperties[]` alanları da kendi route’unu taşır; ajanlar bu alanları okuyarak isim ve URI tahmini yapmamalıdır. `exi_api.toolInput` strict üst seviye argüman politikasını, `EXI_MCP_ARGS_TYPE` üst seviye ve `EXI_MCP_ARGUMENT_TYPE` nested type hata kodlarını, diğer canonical hata kodlarını ve `$bytes` biçimini verir; `exi_api.limits` çalışma anındaki bridge sınırlarının canonical kaynağıdır. `exi_check` için timeout’lar `doctor=60s`, `test=180s`, `verify=300s`; `exi_preview_start` için readiness penceresi 10 saniyesidir. `exi_preview_start({ path: "/ai-game/index.html" })` ile hedef oyun sayfasını seç; sonuçtaki `pageUrl` doğrudan browser agent’a verilebilir ve sayfa HTTP 200 olmadan preview hazır kabul edilmez. Preview sunucusu yalnızca engine/game web uzantılarını servis eder, dot/credential ve dependency-lock dosyalarını dışarı vermez.

`exi_preview_call` ve `exi_preview_batch`, root demo veya `exi_scaffold` tarafından eklenen `/src/ai/runtime-agent.js` istemcisine token-korumalı command/result kuyruğu üzerinden ulaşır. `RuntimeAgent` başlangıçta `engine` ve `scene` handle’larını sağlar; bu kök handle’lar bırakılamaz, yeni nesneler browser tarafında handle olarak tutulur. `exi_preview_batch` en fazla 8 çağrıyı sıralı çalıştırır ve create sonucundaki handle’ı sonraki call’a `{"$result":0}` ile taşır; herhangi bir önceki sonuç nesnesinin güvenli own-property alanı `{"$result":1,"$path":"handle"}` ile seçilebilir. `stopOnError:false` sonraki çağrıları sürdürür ama transaction/rollback sağlamaz; geçici handle’lar yine release edilmelidir. Operation isimleri MCP engine çağrılarıyla aynıdır, ancak browser API’sine ait handle’lar MCP process handle’larından ayrıdır. Bu kanal yalnızca `src/index.js` export ağacının prototype method/property’lerini ve `engine`/`scene` köklerini kullanır; instance üzerindeki `onUpdate`/`onRender` gibi oyun callback’leri `inspect` içinde callable method olarak listelenmez ve `exi_call` ile çalıştırılamaz. Browser `inspect` sonucu ayrıca sayfada kayıtlı callback isimlerini `callbacks` alanında verir; bu isimler yalnızca `{"$callback":"name"}` referansında kullanılabilir. Eval, `new Function`, arbitrary script veya callback serileştirmesi yoktur. Runtime command payload’ı 768 KiB, result 64 KiB ve bekleme 10 saniyedir. RuntimeAgent yüklenmemişse çağrı bounded timeout ile başarısız olur; static preview veya synthetic telemetry GPU kanıtı sayılmaz.

`observe` operation’ı scaffold/demo sayfasının önceden bağladığı `createEngineObserver(engine)` ile çalışır. Motor, swapchain canvas readback yerine düşük çözünürlüklü geçici `RenderTexture` üretir ve WebGL2 `readPixels` veya WebGPU `copyTextureToBuffer` ile gerçek GPU sonucunu okur. En fazla 64×64 örnek hücreye küçültür ve `{ type: "canvas-grid", width, height, columns, rows, grid[], hash, changed, previousHash, nonEmpty, averageLuma }` döndürür. `grid` satırları ` .:-=+*#%@` luminance paletiyle metin olarak taşınır; ham screenshot, DOM veya arbitrary page state gönderilmez. Varsayılan çözünürlük 32×18’dir. Özel canvas sayfaları için `createCanvasObserver(canvas)` fallback olarak kullanılabilir; GPU swapchain readback desteği olmayan tarayıcılarda boş/uygunsuz sonuç verebileceği için scaffold ve demo engine observer kullanır.

`snapshot` operation’ı varsayılan `scene` root’unu veya açıkça verilen root handle’ı getter/callback çalıştırmadan pre-order sahne ağacı olarak döndürür. Her sayfa en fazla 64 node, toplam traversal 4.096 node ve derinlik 32 ile sınırlıdır; `args: [{ offset?, limit? }]` ile sayfalama yapılır. Sonuç `{ type: "scene-snapshot", root, offset, limit, total, nextOffset, truncated, nodes[], hash, changed, previousHash }` biçimindedir; node kayıtları handle, parent, type, name/id, transform ve görünür temel state alanlarını taşır. `hash` aynı sayfanın değişimini, `changed:false` ise tekrar eden gözlemde değişmediğini gösterir. Bu, AI’nin yalnızca piksel grid’i değil sahne yapısını da hızlı ve bounded biçimde anlamasını sağlar; raw object graph, getter, callback veya arbitrary script çalıştırılmaz.

`scenario` operation’ı AI test/replay round-trip’ini azaltır: `args: [{ frames: [{ delta?, input?, observe?, snapshot? }], resume? }]`. RuntimeAgent yalnızca `engine` root’un public `stop()`/`step()`/`start()` yollarını ve engine’in public `Input.inject()` yöntemini kullanır; arbitrary method adı, callback veya script çalıştırmaz. En fazla 16 frame, toplam 512 input event, frame başına 128 event, gözlemde 1.024 hücre ve snapshot’ta 16 node/page kabul edilir. Varsayılan olarak senaryo öncesi çalışan engine sonunda yeniden başlatılır; `resume:false` ile durdurulmuş bırakılabilir. Sonuç `{ type: "runtime-scenario", handle, frames[], frameCount, wasRunning, resumed }` biçimindedir. Bu bir transaction değildir; bir frame hata verirse önceki frame’ler geri alınmaz.

`prompts/get` için `arguments` object olmalıdır; prompt’a tanımlanmamış alanlar `EXI_MCP_ARGUMENT_UNKNOWN`, object olmayan prompt argümanları `EXI_MCP_PROMPT_ARGS_TYPE`, yanlış `goal`/`path` tipi `EXI_MCP_ARGUMENT_TYPE` ile reddedilir. JSON-RPC prompt/resource hatalarında canonical code `error.data.code` alanında taşınır.

### Callback referansları

Callback alan `Node.traverse`, `Node.find`, `Scene.pick`, input/physics filtreleri ve benzeri browser çağrıları için callback gövdesi MCP JSON’una konmaz. Scaffold `game.js` içinde `runtimeCallbacks` registry’sine insan/agent review’undan geçmiş fonksiyonu ekle; sonra `exi_preview_call` veya `exi_preview_batch` args içinde `{"$callback":"visit"}` kullan. Browser `inspect` sonucu kayıtlı isimleri `callbacks` alanında listeler; böylece ajan isim tahmin etmek zorunda kalmaz. RuntimeAgent yalnızca bu sayfada kayıtlı isimleri çözer; registry en fazla 256 callback ve isim başına 256 karakterdir. Bilinmeyen isim `EXI_RUNTIME_CALLBACK` ile reddedilir. Direct process-side `exi_call`/`exi_function` JSON-only kalır; callback kodu proje dosyasında yazılıp `exi_project_check` ve review’dan geçmelidir.

### Batch çağrıları

Scene, dosya veya asset hazırlığında round-trip sayısını azaltmak için `exi_batch` kullanılabilir. Çağrılar aynı MCP session kuyruğunda sıralı çalışır; önceki çağrının sonucu sonraki çağrıda `{"$result": 0}` biçiminde referanslanabilir. Bir sonuç nesnesinin alanı için `{"$result": 0, "$path": "fileUploadId"}` kullanılır; path yalnızca güvenli own-property zinciridir. Handle sonucu referanslanırsa bridge bunu güvenli `{ "$handle": "hN" }` biçimine çevirir ve gerçek handle’a çözer. Varsayılan `stopOnError: true` ilk hatada durur; `false` kalan çağrıları denemeye devam eder. Batch transaction değildir: başarısızlıkta daha önce tamamlanan çağrılar geri alınmaz, bu nedenle iş sonunda `exi_release` veya `exi_session_reset` çağrılmalıdır. Nested `exi_batch` reddedilir ve toplam 128 çağrı/64 KiB sonuç sınırı geçerlidir.

```json
{"name":"exi_batch","arguments":{"calls":[
  {"name":"exi_create","arguments":{"type":"Node","args":[{"x":80}]}},
  {"name":"exi_get","arguments":{"handle":{"$result":0},"property":"position"}},
  {"name":"exi_set","arguments":{"handle":{"$result":1},"property":"x","value":120}}
]}}
```

Chunked text upload’ı round-trip azaltarak batch içinde de yapılabilir:

```json
{"name":"exi_batch","arguments":{"calls":[
  {"name":"exi_file_begin","arguments":{"path":"ai-game/src/level.js","size":24}},
  {"name":"exi_file_chunk","arguments":{"fileUploadId":{"$result":0,"$path":"fileUploadId"},"offset":0,"content":"export const level = 1;\n"}},
  {"name":"exi_file_commit","arguments":{"fileUploadId":{"$result":0,"$path":"fileUploadId"}}}
]}}
```

### Handle ve async çağrı örneği

Tool çağrısı:

```json
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"exi_create","arguments":{"type":"Scene"}}}
```

Yanıt:

```json
{"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"{\"$handle\":\"h1\",\"type\":\"Scene\"}"}],"structuredContent":{"$handle":"h1","type":"Scene"}}}
```

Bir handle JSON’da `{ "$handle": "h1" }` olarak argümana verilir:

```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"exi_create","arguments":{"type":"Node","args":[{"x":80,"y":120}]}}}
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"exi_call","arguments":{"handle":"h1","method":"add","args":[{"$handle":"h2"}]}}}
```

`exi_call`, `exi_function`, `exi_export_call`, `exi_static_call` ve `exi_get` Promise döndürürse bridge sonucu bekler. Böylece asset/audio yüklemelerinde AI’ye Promise handle’ı değil gerçek sonuç gelir.

Asset yükleme akışı:

```json
{"name":"exi_create","arguments":{"type":"AssetLoader","args":[{"baseURL":"http://127.0.0.1:4173/"}]}}
{"name":"exi_call","arguments":{"handle":"h3","method":"loadJSON","args":["package.json"]}}
```

### Declarative scene örneği

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

`exi_build_scene` yalnızca `type`, `options` ve `children` alanlarını kabul eder; `options` object, `children` array olmalıdır. Callback, function, dynamic import veya script kabul etmez. Oluşturma sırasında hata olursa daha önce yaratılmış handle’lar rollback edilir. Callback gerektiren gameplay kodu scaffold edilen `game.js` içine normal JavaScript olarak yazılır; AI CLI dosya editörüyle bunu review edebilir, MCP preview ile sonucu kontrol eder.

### Starter game ve preview

```json
{"name":"exi_scaffold","arguments":{"directory":"games/space-demo"}}
{"name":"exi_preview_start","arguments":{"path":"/games/space-demo/index.html"}}
{"name":"exi_preview_probe","arguments":{"previewId":"p1","path":"/games/space-demo/index.html"}}
{"name":"exi_preview_stop","arguments":{"previewId":"p1"}}
```

Scaffold mevcut dosyaları varsayılan olarak ezmez, absolute/traversal path’i reddeder ve repo köküne doğrudan yazmaz. Üretilen sayfa, browser-capable AI CLI’ların okuyabileceği hidden `#exi-runtime` output’unda `data-ready`, `data-status`, `data-event`, `data-backend`, `data-fps`, `data-draws` ve `data-nodes` alanlarını bounded biçimde günceller. Aynı sayfa, `/__exi/runtime-token` üzerinden aldığı per-preview token ile en fazla 4 KiB’lik whitelist telemetry’yi `/__exi/runtime` adresine gönderir; `exi_preview_probe({ previewId, path: "/__exi/runtime" })` son raporu okur. `RuntimeAgent` aynı token ile `/__exi/runtime-command` kuyruğunu tüketir ve `/__exi/runtime-result` üzerinden `exi_preview_call`/`exi_preview_batch` sonuçlarını geri yollar; yalnızca `src/index.js` public API’sine ve `engine`/`scene` root handle’larına erişir. Backend değişiminden sonra `exi://runtime` içindeki `warmupMs` kadar beklenmelidir; profiler warmup penceresinde `data-fps="0"` döndürebilir. Preview `127.0.0.1` dışına bind olmaz; normal preview response 64 KiB, runtime telemetry body 4 KiB, runtime command 768 KiB ve result 64 KiB ile sınırlıdır. Sentetik POST veya static index yanıtı gerçek browser/GPU kanıtı değildir.

## 11. Codex, Claude, OpenCode, Gemini kurulumu

Detaylı config örnekleri [MCP.md](MCP.md) içindedir. Repo kökünden kullanılabilen kısa komutlar:

```powershell
codex mcp add exi-engine -- node tools/exi-mcp-server.mjs
claude mcp add --transport stdio exi-engine -- node tools/exi-mcp-server.mjs
opencode mcp add
gemini mcp add exi-engine node tools/exi-mcp-server.mjs
```

Gemini CLI için `.gemini/settings.json` içinde `mcpServers.exi-engine` ile `command: "node"`, `args: ["tools/exi-mcp-server.mjs"]`, `cwd: "."` kullanılır; stdio config’inde `type` gerekmez. Claude Code `.mcp.json` içinde `${CLAUDE_PROJECT_DIR:-.}` placeholder’ı kullanılabilir. Cursor CLI `.cursor/mcp.json`, Cline CLI `.cline/mcp.json` içinde aynı `mcpServers` stdio şeklini kullanır. Windsurf/Cascade için kullanıcı seviyesindeki `~/.codeium/windsurf/mcp_config.json` dosyasına aynı kayıt, absolute script path ve `EXI_MCP_ROOT` ile eklenir. Güncel OpenCode CLI yönetim komutu `opencode mcp add`; config şekli ise `mcp.servers` altındaki `type: "local"` ve array `command` alanlarıdır. Windows’ta istemci çalışma dizini repo kökü olmalı; değilse absolute script path ve `EXI_MCP_ROOT` verin.

Diğer stdio MCP istemcileri için minimum sözleşme `command: "node"`, `args: ["tools/exi-mcp-server.mjs"]`, repo kökü `cwd` ve gerekirse `EXI_MCP_ROOT` ortam değişkenidir. Modern istemci sırası `server/discover` → `_meta` taşıyan `tools/list`/`resources/list`/`prompts/list` → `exi_api`; legacy istemci sırası `initialize` → `notifications/initialized` → `tools/list`/`resources/list`/`prompts/list` → `exi_api` şeklindedir.

## 12. Hata yönetimi ve güvenlik

Known tool execution hataları MCP `result.isError=true` ve bounded text ile döner. Bilinmeyen method/resource için JSON-RPC error döner. AI her mutation’dan sonra `exi_get`/`exi_api` ile sonucu doğrulamalı ve iş sonunda `exi_release` veya `exi_session_reset` çağırmalıdır.

Result serialization, `exi_inspect`, `exi_session_status` ve browser `RuntimeAgent` nesne türünü prototype data descriptor’ından belirler; normal `constructor`/`destroy` property erişimiyle accessor çalıştırmaz. Getter içeren gerçek engine property’leri yalnızca açık `exi_get`, `exi_export_get` veya public method çağrısında okunur.

Bridge limitleri: 1 MiB JSON-RPC mesajı, 64 KiB string, 32 JSON derinliği, 128 object key, 4096 array item, 512 KiB binary argüman, 4096 active handle, 1024 scene node, 32 scene depth, 256 KiB resource, 64 KiB tool output, 64 KiB preview response, 4 KiB runtime telemetry body ve browser batch başına 8 call. Engine `exi_check` timeout’ları `doctor=60s`, `test=180s`, `verify=300s`; örnek Codex/Gemini/OpenCode istemci timeout’u 360 saniyedir. Engine method/property çözümü engine prototype zinciriyle ve static çağrılar own-property allowlist’iyle sınırlıdır; `Object.prototype`, `Function.prototype`, `__proto__`, `prototype`, `constructor`, private method, eval, `new Function`, dynamic import ve arbitrary shell yoktur.

MCP local process boundary’dir; authentication veya OS sandbox değildir. Yalnızca güvenilen AI CLI’lara bağlanmalı, production’da process/container izinleri ayrıca uygulanmalıdır. Tam tehdit modeli için [SECURITY.md](SECURITY.md) okunmalıdır.

## 13. Doğrulama akışı

```powershell
npm run doctor
npm test
npm run verify
```

`npm test`: static dependency/security, HTTP server, doctor, MCP protocol/asset/preview/scaffold ve engine smoke çalıştırır.

`npm run test:clients` Cursor/Cline dahil altı repo config şekliyle gerçek stdio bridge handshake/tool-call akışını ve host CLI keşif durumunu doğrular; Windsurf kullanıcı config’i repo dışında olduğu için `exi://clients` shape’i ve doküman örneğiyle denetlenir. Kurulu host istemcilerinin kendi MCP yönetim yolunu read-only denetlemek için `npm run test:clients:native` çalıştırılabilir; bu komut `mcp list` çıktısında `exi-engine` arar, 5 saniyede sınırlar ve kurulu olmayan istemcileri atlar. Native sonuç durumları `passed`, `skipped`, `unavailable`, `failed`, `spawn-error` ve `timeout` olarak ayrıştırılır; WindowsApps gibi host executable izin sorunları `unavailable` olur. `npm run test:mcp` ise modern/legacy MCP wire akışı ile AI oyun üretim workflow’unu doğrular. Bu testler host CLI’nin kendi executable izinleri/cancellation/UI davranışının tamamını veya fiziksel browser/GPU kanıtını sağlamaz; canlı host ve browser kanıtı ayrı kaydedilmelidir.

`npm run verify`: bunlara ek olarak allocation/streaming/culling/physics benchmark’larını çalıştırır. Benchmark FPS değerleri Node simülasyonudur; gerçek WebGL2/WebGPU driver veya mobil cihaz sonucu değildir.

Gerçek GPU/device kaybı, WebGPU fallback, WebGL2 restore, audio ve browser lifecycle için `test/hardware-soak.html` açılmalı; fiziksel cihazlar [test/HARDWARE_MATRIX.md](test/HARDWARE_MATRIX.md) ile ayrıca raporlanmalıdır.

AI CLI browser doğrulaması için `npm run dev` sonrası `/index.html` açılır. Önce görünür DOM’dan `BACKEND`, `FPS`, `DRAW`, `NODE` ve `ASSET LOCAL OK` alanları okunur; sonra `WebGL2` ve `WebGPU` seçimleri ayrı ayrı uygulanıp aynı alanlar tekrar okunur. Console error/warning listesi boş olmalıdır. MCP preview akışında gerçek sayfa yüklendikten ve `warmupMs` beklendikten sonra `exi_preview_probe({ previewId, path: "/__exi/runtime" })` ile token-korumalı server raporu da alınır. Bu test HTTP dosyasının geldiğini değil, canvas runtime’ının gerçekten backend kurup frame ürettiğini kanıtlar. Browser yeteneği olmayan CLI’lar için MCP `exi_preview_probe` yalnızca static HTTP veya daha önce browser tarafından gönderilmiş telemetry kanıtı verir; sentetik telemetry browser/GPU kanıtı sayılamaz.
### Upload bütünlüğü

`exi_file_write`, `exi_file_begin`, `exi_asset_write` ve `exi_asset_begin` isteğe bağlı `expectedSha256` alanı kabul eder. Değer 64 hexadecimal karakterlik SHA-256 digest olmalıdır; direct write/commit sonucu `sha256` döner, mismatch durumunda hedefe rename yapılmadan `EXI_MCP_UPLOAD_INTEGRITY` döndürülür. Chunk upload’ta hash her chunk ile incremental güncellenir; bütünlük kontrolü hedef commit’inden önce yapılır.
