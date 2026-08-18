# ExiEngine

ExiEngine, çalışma zamanında başka bir oyun motoruna bağlı olmayan, kendi 2D çekirdeğini kullanan WebGPU/WebGL2 motorudur. Runtime dependency yoktur; Node.js yalnızca yerel demo sunucusu ve test komutları için kullanılır.

## AI CLI ile hızlı ve güvenilir kullanım

Repo kökündeki `AGENTS.md`, `CLAUDE.md` ve `GEMINI.md` dosyaları ilgili coding agent’a tek canonical [AI_ENGINE_GUIDE.md](AI_ENGINE_GUIDE.md) sözleşmesini gösterir. Codex/OpenCode için `AGENTS.md`, Claude Code için `CLAUDE.md`, Gemini CLI için `GEMINI.md` keşif noktasıdır; diğer agent’lar için [CONTRIBUTING.md](CONTRIBUTING.md) aynı akışı taşır.

```powershell
npm run doctor   # hızlı ortam, export ve agent-contract kontrolü
npm test         # statik/server/engine smoke + unit + typecheck (bağımsız aşamalı)
npm run lint     # zero-dep sözdizimi ve anti-pattern taraması
npm run test:coverage   # unit suite coverage eşikleri
npm run bench:regression  # benchmark baseline drift kapısı
npm run verify   # release gate ve benchmark’lar
node tools/exi-mcp-server.mjs  # JSON-RPC stdio MCP bridge
```

CI: `.github/workflows/ci.yml` — push/PR'da Node 20+22 test, verify, coverage ve preview-e2e job'ları çalışır.

İlk değişiklikten önce `AI_ENGINE_GUIDE.md` okunmalı. Public API değişiklikleri `src/index.js`, `index.d.ts`, smoke testi ve ilgili dokümantasyonla birlikte güncellenir; Node testleri WebGPU/WebGL2 donanım kanıtının yerine geçmez.

Tam örnekli runtime API ve MCP referansı için [API.md](API.md) dosyasına bakın. Bu dosyada engine lifecycle, scene graph, renderable’lar, asset/audio/input/physics/save API’leri, handle/async MCP çağrıları, resource URI’leri, scaffold/preview akışı ve güvenlik limitleri birlikte açıklanır.

AI CLI’ların motoru keşfetmesi ve oyun kurması için doğrudan `node tools/exi-mcp-server.mjs` ile sıfır-dependency MCP bridge başlatılabilir. MCP stdio command’ı olarak `npm run mcp` kullanılmamalıdır; npm script başlığı stdout’a karışabilir. Bridge güncel MCP `2026-07-28` modern `server/discover`/per-request metadata akışını ve eski `initialize` istemcilerini birlikte destekler. `exi_api`/MCP resources (`exi://clients` dahil) API ve istemci sözleşmesini, `exi_inspect` ve `exi_*` handle çağrıları motor state’ini, bounded `exi_build_scene` ve `exi_scaffold`/`exi_project_open` oyun üretimi veya mevcut oyuna katılımı, transactional `exi_project_apply` ile çok dosyalı text üretimini, `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch`/`exi_file_check` MCP-only proje keşif, düzenleme ve syntax kontrolünü, `exi_preview_start({ path: "/ai-game/index.html" })` hedef sayfa HTTP 200 readiness ve doğrudan `pageUrl` sonucunu, `exi_preview_call`/`exi_preview_batch` demo veya scaffold RuntimeAgent üzerinden gerçek browser engine handle çağrılarını, loopback preview araçları da sonucu doğrulamayı sağlar. Callback isteyen browser API’leri için callback gövdesi JSON’a serileştirilmez; sayfada kayıtlı fonksiyon `{"$callback":"name"}` referansıyla seçilir. Codex/Claude/OpenCode/Gemini/Cursor/Cline/Windsurf ayar örnekleri [MCP.md](MCP.md), ayrıntılı istemci sözleşmesi [AI_ENGINE_GUIDE.md](AI_ENGINE_GUIDE.md) içindedir; modern ve legacy uçtan uca MCP smoke testi `npm run test:mcp` ile çalışır.

Repo ayrıca Codex, Claude Code, OpenCode, Gemini CLI, Cursor CLI ve Cline CLI için proje kökü yapılandırmalarını hazır taşır: `.codex/config.toml`, `.mcp.json`, `opencode.json`, `.gemini/settings.json`, `.cursor/mcp.json` ve `.cline/mcp.json`. Windsurf/Cascade için kullanıcı seviyesindeki config yolu [MCP.md](MCP.md) içinde verilir. İstemci MCP’yi otomatik keşfetmiyorsa [MCP.md](MCP.md) içindeki doğrudan Node komutunu kullanın. `npm run test:clients` her repo config’inin gerçek stdio bridge handshake/tool-call akışını ve host CLI keşif durumunu raporlar; `npm run test:clients:native` kurulu CLI’ların kendi read-only `mcp list` komutuyla `exi-engine` server’ını 5 saniyelik bounded probe ile denetler. WindowsApps erişim kısıtı gibi host binary başlatma sorunları `unavailable` olarak ayrıştırılır. Binary API sonuçları da typed-array metadata ve en fazla 32 KiB inline `bytes.$bytes` olarak AI batch zincirine taşınır; büyük asset’ler `exi_asset_read` ile sayfalanır.

MCP-only ajanlar text dosyalarının yanında `exi_asset_list`/`exi_asset_write` ile allowlisted image, audio, font ve KTX2 asset’lerini 512 KiB bounded payload ile; daha büyük dosyaları `exi_asset_begin`/`exi_asset_chunk`/`exi_asset_commit` akışıyla oyun klasörüne yükleyebilir.

Yeni oyunlarda `exi_scaffold`, mevcut oyunlarda `exi_project_open` kullanılır. Düzenleme döngüsünde `exi_project_status({ path: "ai-game" })` dosya, asset, statik kontrol ve eşleşen preview durumunu tek bounded response’ta toplar. Uzun/reconnect edilen AI CLI oturumlarında `exi_session_status({})` handle, upload ve preview lifecycle durumunu token açmadan raporlar; cleanup öncesi kullanılır. Normal hızlı akışta `exi_project_preview({ path: "ai-game" })` tek çağrıda önce HTML referanslarını, JavaScript syntax’ını ve JSON bütçesini kontrol eder; hata varsa preview açmaz, başarıda `preview.pageUrl` döndürür. Loopback preview, gerçek browser runtime ve `/__exi/runtime` telemetry kanıtı ayrı ayrı alınır. Sentetik telemetry veya static HTTP yanıtı GPU kanıtı değildir.

## Dahil olan çekirdek

- `Scene`, `Node`, `Sprite`, `Text`, `AnimatedSprite`, `Graphics`, `ParticleEmitter` ve `TileMap` scene graph’ı
- `Node.add()` toplu reparenting öncesi tüm girdileri doğrular; geçersiz veya yinelenen node hatasında scene graph kısmen değişmez
- `destroy()` edilmiş Node yeniden graph’a eklenemez ve `update()` callback’i çalışmaz; `ExiEngine.setScene()`/`setOverlay()` yok edilmiş scene’leri reddeder
- `Node({ onUpdate })` ile her node’a opt-in fixed-step davranışı; parent callback’i child’lardan önce çalışır, callback yokken traversal davranışı değişmez (`setUpdateHandler()` ile sonradan atanabilir)
- `SpriteBatch` ile tek texture kullanan yüksek yoğunluklu statik sprite layer’ı; per-sprite tint/alpha/rotation
- Aynı SpriteBatch içinde `addAnimatedSprite()` ile atlas frame animasyonu; her sprite kendi sınırlı frame state’ini taşır, `pingPong: true` ile uçlarda tekrarsız ileri/geri döner, `onLoop` döngü sınırında, `onFrameChange` yalnızca gerçek frame geçişlerinde çağrılır, node çoğaltmadan regular/instanced/WebGPU GPU-culling akışına girer
- `addSprites()` ile güvenlik limitli, atomik toplu sprite ekleme; büyük layer kurulumunda tek cache/spatial invalidation
- Sıcak in-place `sprites[index]` düzenlemeleri sonrasında `markDirty()` ile cache/spatial index’i O(n) otomatik tarama olmadan yenileme
- CPU/WebGL2 regular `SpriteBatch` yolunda chunk geometri, bounds ve renk hesapları mevcut kayıtlar üzerinde güncellenir; frame başı geçici köşe/renk dizileri üretilmez
- Tekil `Sprite`/`Text` render item’ları mevcut local bounds cache’iyle world→screen köşe dönüşümünden önce cull edilir; `SpriteBatch`/`TileMap` coarse culling yolu korunur
- `Graphics` rect/circle/line render item’ları da komut tipine göre local bounds taşır; ekran dışı primitive’ler vertex world→screen dönüşümünden önce elenir
- `Graphics.polygon()` ile içbükey/dışbükey çokgenler; ear-clipping komut eklenirken bir kez yapılır ve 256 nokta sınırında tutulur
- Büyük container/subtree’ler için opsiyonel local `cullBounds`; dal ekran dışındaysa çocuk renderable’ları scene queue’ya girmeden kesilir
- Node/container `alpha` değeri çocuklara `worldAlpha` olarak miras kalır; regular, static ve instanced/WebGPU kaynak akışlarında cache anahtarları alpha değişimini izler
- Node/container `filter` değeri çocuklara miras kalır; hafif `grayscale`, `invert`, `brightness`, `sepia`, `contrast` ve `saturate` shader filtreleri regular/static/instanced WebGL2/WebGPU draw’larında uygulanır
- Ortak `MAX_WORLD_COORDINATE` sınırıyla finite ama aşırı büyük transform/geometri değerlerinin matris ve GPU stream taşmasına karşı korunması
- `SpriteBatch({ instanced: true })` ile WebGL2/WebGPU instanced draw yolu; CPU yalnızca 14-float sprite instance kaydı üretir ve aynı boyutlu stream buffer’ı yeniden kullanır
- `SpriteBatch({ instanced: true, gpuCulling: true })` ile WebGPU compute culling ve indirect draw; WebGL2 aynı API’de güvenli instanced fallback kullanır
- `TextureAtlas` frame’lerini aynı `SpriteBatch` içinde tek draw ile kullanma; farklı base texture’lar açıkça ayrılır
- `TextureAtlas.getFrames()` ile adlandırılmış frame dizisi, `getClip()` ile doğrudan `AnimatedSprite` veya `SpriteBatch.addAnimatedSprite()` seçenekleri üretme
- `TextureAtlas.fromJSON()` object veya TexturePacker tarzı `frames` array metadata’sını güvenli biçimde normalize eder; desteklenmeyen `rotated`/`trimmed` frame’leri sessizce bozmak yerine reddeder
- Renderer atlas frame’lerini `baseTexture` başına tek GPU residency olarak paylaşır; `maxTextureBytes`/`maxTextureCount` toplam GPU texture bütçesiyle doğrudan Texture/RenderTexture tahsisleri de sınırlandırılır; ortak base filter state’i tüm frame’lerde aynı görünür ve destroy edilmiş texture girişleri `EXI_TEXTURE_INPUT` ile reddedilir
- Atlasın dışarıdan aldığı base texture yok edilirse atlas ilk erişimde lazy biçimde geçersizleşir ve cache’lenmiş frame’lerini bırakır; atlas dış base texture’ın sahipliğini üstlenmez
- Düzenli spritesheet’ler için JSON gerektirmeyen `TextureAtlas.fromGrid()` helper’ı
- `TextureAtlas.pack()` ile Canvas/OffscreenCanvas kaynaklarını güvenlik limitli tek atlas texture’ına dönüştürme
- `TextureAtlas.pack()` mevcut `Texture` ve atlas subtexture girişlerini de doğrudan birleştirir; elle `.source`/crop hesabı gerekmez
- `Vec2`, `Mat3`, kamera, zoom ve world/screen dönüşümleri
- `Camera({ roundPixels: true })` ile pixel-art render’ında world→screen koordinatlarını fiziksel piksele yuvarlama; varsayılan kapalıdır
- `Camera.follow()` ile Point/Node.position hedefi, offset, smoothing ve isteğe bağlı `deadzoneWidth/deadzoneHeight`; `zoomAt()` ile imleç merkezli zoom ve `setBounds()` ile zoom/rotation-aware dünya sınırı
- `ExiEngine({ width, height, resizeMode: "contain" | "cover" })` ile sabit mantıksal çözünürlük; Camera screen viewport’u, pointer dönüşümü, CPU culling, WebGPU culling ve responsive overlay layout aynı viewport sözleşmesini kullanır; contain letterbox alanı etkileşime kapalıdır (`resize` varsayılandır)
- `engine.setLogicalSize(width, height)` ile orientation veya oyun modu değişiminde tasarım çözünürlüğünü doğrulayıp tek geçişte resize etme; `resize()` chainable olarak aynı ölçüm akışını yeniden kullanır
- `Camera.shake()` ile bounded süre/genlik/frequency kullanan allocation-free hit/explosion kamera geri bildirimi; `clearShake()` aktif offset’i güvenle geri alır
- Texture, atlas frame ve texture-bazlı batch çizimi
- `Sprite` ve `SpriteBatch` için UV düzeyinde `flipX`/`flipY`; geometri, anchor ve instanced buffer formatı değişmeden yön değiştirme
- `RenderTexture` ile aynı çekirdekte örneklenebilir WebGL2 framebuffer/WebGPU render target; minimap, portal ve UI kompozisyonu için `engine.renderToTexture()`; resize tahsisi başarısız olursa önceki çalışan hedef korunur
- `RenderGroup` ile çocuk scene graph’ını bağımsız `RenderTexture` pass’inde çizip tek kompozit quad olarak ana sahneye almak; nested group sırası post-order işlenir ve WebGL2/WebGPU aynı yaşam döngüsünü kullanır
- `RenderGroup({ effects: [{ filter, amount }] })` ile en fazla dört allowlist shader efektini iki ara hedefli sınırlı ping-pong zincirinde çalıştırma; efekt pass’leri mevcut WebGL2/WebGPU filtre shader’larını yeniden kullanır (`grayscale`, `invert`, `brightness`, `sepia`, `contrast`, `saturate`)
- `engine.prepare()` ana sahnenin yanında görünür RenderGroup çocuklarını, grup hedeflerini ve ping-pong ara hedeflerini de önceden ısıtır; ilk frame GPU allocation/upload sıçraması ölçülebilir hale gelir
- `Texture({ filter: "nearest" })` ile pixel-art nearest sampling; varsayılan linear filtering
- Node tabanlı `blendMode: "normal" | "additive" | "multiply"`; WebGL2 blend state ve WebGPU pipeline varyantları aynı API’de
- `Texture.markDirty()`/`updateSource()` ile aynı boyuttaki canvas texture’larını GPU’ya yalnızca değişince yeniden yükleme
- Kaynaksız sanal texture’lar WebGL2 ve WebGPU’da deterministik 1×1 beyaz fallback olarak yüklenir; mantıksal sprite boyutu GPU texture belleğini şişirmez
- Harici UI/runtime bağımlılığı olmadan Canvas 2D kaynaklı `Text`; aynı metin veya normalize edilmiş stil tekrarında redraw atlanır, aynı boyutlu metin değişiminde texture yeniden kullanılır, boyut ve karakter/pixel bütçeleri sınırlandırılır
- `Text({ wordWrap: true, maxWidth })` ile uzun HUD/menü metinlerini Canvas 2D ölçümüyle bounded satırlara bölme; varsayılanı kapalıdır ve uzun tek kelimeler karakter sınırında güvenle kırılır
- Text satır ölçümü stack-spread ve ara `map` dizisi kullanmadan yapılır; uzun çok-satırlı içerik güvenli biçimde limit kontrolüne ulaşır
- Tekrarlanan label/HUD metinleri için sınırlı ve referans sayımlı `TextCache`; entry/pixel bütçeleri constructor snapshot’ına bağlıdır, `clear()` yalnızca artık kullanılmayan texture’ları temizler
- İsteğe bağlı `GlyphAtlas`; boyut/padding/entry/pixel bütçeleri snapshot’lıdır, grapheme kümelerini tekrar kullanır, glyph rasterizasyonunu azaltır ve karmaşık scriptlerde Canvas fallback’i korur
- TileMap için tek renderable batch; tile başına Node/Sprite üretmez
- `TileMap.getCollisionRects()` ile solid tile’ları yatay/dikey birleştirerek az sayıda AABB üretme; `createStaticBodies()` ile bunları `PhysicsWorld` static body’lerine bağlama
- `TileMap.setRegion()` ile güvenli atomik chunk/bölge güncellemesi; typed-array bulk/region yolları doğrulama sonrası geçici kopya üretmez, normal dizilerde atomiklik korunur
- TileMap varsayılan olarak instanced çizilir; WebGPU’da `gpuCulling` ile tile transform/culling GPU’ya taşınır, WebGL2 CPU fallback’inde `cullTiles` görünür satır/sütun aralığını paketler
- `TileMap.setTile(x, y, index, { flipX, flipY })` ile sprite atlas UV’lerini geometri/instance stride’ını büyütmeden hücre bazında aynalama
- Ekran koordinatlı, iç içe geçebilen hafif scissor clip rect’leri
- `maskRect` ile aynı allocation-free scissor kesişim yolunu kullanan hızlı dikdörtgen maskeleri ve `maskTexture` ile screen-space alpha maskeleri; `RenderTexture` mask olarak kullanılabilir
- WebGPU-first seçim, WebGL2 fallback ve context/device kaybı bildirimi
- WebGL2/WebGPU shader/program/pipeline/buffer/texture ve GPU-culling yardımcı kaynak oluşturma hatalarında atomik GPU kaynak cleanup’i; validation scope kapanır, başarısız handle cache’e yazılmaz ve çalışan culling kaynağı korunur
- Auto seçimde yalnızca aktif WebGPU kaybı WebGL2’ye fallback yapar; WebGL2 context restore kendi kaynak yeniden kurulum yolunu kullanır; fallback kurulumu da başarısız olursa kayıp backend bırakılır ve renderer referansı null kalır
- Renderer exception’ları frame loop’unu sessizce koparmaz; uygun fallback denenir veya motor kontrollü biçimde durup `renderer-error` bildirir
- Renderer loss hataları `backend`, `phase`/`reason` ve `recoverable` metadata’sı taşır; `onStatus` gözlemcisinin exception’ı fallback, restore veya teardown akışını bozamaz
- Doğrudan WebGL2/WebGPU `init()` başarısızlıkları da idempotent teardown yapar; eksik host event API’leri cleanup’i tekrar bozmaz
- Scene/update/render/pointer callback exception’ları da motoru `running: true` kilitli bırakmaz; loop durur, `runtime-error` status’i yayınlanır ve manuel `step()` hatayı caller’a taşır
- `engine.setScene(scene, camera?)` ile hazırlanmış render kuyruğu ve eski pointer capture/hover hedefleri atomik biçimde temizlenerek güvenli sahne geçişi
- `overlayScene`/`setOverlay()` ile ana kameradan bağımsız, WebGL2/WebGPU’da temizlemeden ikinci pass olarak çizilen HUD/UI sahnesi; overlay pointer hedefleri önceliklidir
- Overlay Node’ları için `setLayout()` ile left/top/right/bottom, responsive anchor ve nested viewport yerleşimi; resize sırasında yalnızca overlay sahnesine uygulanır
- `focusable`, `tabIndex`, `engine.focus()`/`focusNext()` ve bubbling `onKeyDown` ile canvas dışı DOM bağımlılığı olmadan klavye UI odağı
- `NineSliceSprite` ile tek render node üzerinde texture tabanlı panel/çerçeve; border UV’leri texture ve hedef boyutuna bounded biçimde uyar, dokuz quad ve resize scratch belleğini yeniden kullanarak normal Sprite batch yolunu kullanır
- Fixed timestep oyun döngüsü, klavye/pointer/gamepad input, çoklu pointer/wheel, çok düğmeli pointer state, pointer capture/cancel release ve mobil görünürlük/pagehide reset’i
- `engine.pause()`/`resume()` ile kontrollü lifecycle; varsayılan `pauseOnHidden: true` görünmez sekmede veya bfcache `pagehide` geçişinde RAF, fixed-step birikimi ve aktif Web Audio context’ini durdurur; `pageshow`/görünürlük dönüşünde yalnızca engine’in otomatik durdurduğu loop yeniden başlar, `pauseAudio: false` ile ses devam ettirilebilir
- `timeScale`/`setTimeScale()` ile fixed-step simülasyonunu 0..16 aralığında slow-motion veya fast-forward olarak yönetme; efektif delta güvenlik tavanını aşmaz
- `interpolate: true` ile fixed-step update’leri arasındaki kalan zamanı render sırasında transform snapshot’larıyla yumuşatma; varsayılan kapalıdır ve oyun state’i render sonrasında geri yüklenir
- `physics: physicsWorld` ile opt-in `PhysicsWorld.step(fixedStep)` entegrasyonu; dünya verilirse engine scene’ine bağlanır ve manuel `onUpdate` boilerplate’i kaldırır, varsayılan yol etkilenmez
- `animator: animator` ile opt-in `Animator.update(fixedStep)` entegrasyonu; fixed-step sırası `scene → animator → physics → onUpdate` olarak uygulanır ve manuel update boilerplate’i kaldırır
- `Input.bindAction()` ile klavye, pointer ve gamepad binding’lerini tek `down/pressed/released` API’sinde birleştiren allocation-free action katmanı
- Pointer dispatch path’i, hit/hover sonucu ve pick predicate’leri drag/move akışında engine scratch belleğini yeniden kullanır; scene/overlay geçişleri eski hedef referanslarını temizler (`npm run bench:pointer`)
- Action map kullanmadan doğrudan `isGamepadButtonDown()`, `wasGamepadButtonPressed()` ve `wasGamepadButtonReleased()` sorguları
- `Input.bindAxis()` ile klavye çiftlerini ve gamepad analog eksenlerini deadzone/scale clamp’li, allocation-free `getAxis()` API’sinde birleştirme
- `Input.getBindings()`/`setBindings()` ile doğrulanmış action/axis map’lerini JSON/SaveStore ayarlarına taşıma; import atomiktir ve hatalı kayıt mevcut map’i bozmaz
- `Input.getPointerWorld(camera, out, pointerId)` ile aktif veya seçilen pointer/touch koordinatını yeniden kullanılabilir scratch noktayla dünya koordinatına çevirme
- `Scene.pick(worldX, worldY)` ve `Node.containsPoint()` ile world-space pointer/touch hit testing; z-order ve isteğe bağlı predicate desteği
- Renderable olmayan interactive `Node`’lar için finite dikdörtgen `hitArea`; sprite/graphics bounds’ını değiştirmeden UI hit-zone tanımlama
- `engine.pickPointer(predicate, pointerId)` ile aktif veya seçilen pointer’ı kameradan dünyaya çevirip en üstteki hit-testable node’u tek çağrıda bulma
- Opt-in `interactive: true` node’larda `onPointerDown`, `onPointerUp`, `onPointerCancel`, `onPointerMove`, `onPointerEnter`, `onPointerLeave`; her pointer ID için ayrı capture/hover hedefi, doğru `button`/`buttons` bilgisi, parent bubbling (`currentTarget`) ve yeniden kullanılan transient world event
- Aynı interactive API’de `onWheel` ile world koordinatlı `wheelX`/`wheelY` delta’larını UI ve kamera kontrollerine aktarma
- Canvas layout değişimleri için isteğe bağlı native `ResizeObserver` ve `visualViewport.resize` dinleyicisi; eski tarayıcılarda `window.resize` fallback’i korunur
- Input ve engine teardown event hedefini güvenli seçer; `window` olmayan worker/SSR test ortamlarında erken `destroy()` kırılmaz
- Audio decode tamamlanması engine teardown veya `unload()` sonrasına sarkarsa generation kontrolü geç buffer yazımını reddeder; aynı isim ve URL’deki eşzamanlı load tek decode işini paylaşır, farklı URL yarışını reddeder
- Backend init engine teardown sonrasına sarkarsa geç renderer yok edilir; auto seçim kapanmış canvas üzerinde fallback başlatmaz
- `maxPixelRatio` ile yüksek DPI mobil cihazlarda fill-rate bütçesini düşürme; profiler metrik snapshot’ı sabit nesne üzerinde güncellenir
- `backgroundColor`, `backgroundAlpha` ve `clearBeforeRender` ile iki backend’de aynı canvas temizleme/şeffaflık sözleşmesi; alpha kanvas WebGL2’de doğru context seçeneği, WebGPU’da `premultiplied` mode ile açılır
- WebGL2/WebGPU renderer metrikleri ve `prepare()` byte toplamları tek batch dolaşımıyla güncellenir; frame başı `filter()`/`reduce()` callback/ara dizi işi yoktur
- WebGL2 `MAX_TEXTURE_SIZE` context kurulumu/restore sırasında bir kez okunup `getInfo()` ve texture limit kontrollerinde yeniden kullanılır; profiler frame başı driver query yapmaz
- Renderer `getInfo()` snapshot’ı da sabit nesne üzerinde güncellenir; engine profiler her frame yeni backend bilgi wrapper’ı üretmez
- `ExiEngine.getInfo()` da sabit engine/canvas wrapper’ını günceller; demo HUD gibi per-frame telemetri sorguları üst seviye nesne üretmez
- Gamepad snapshot input; bağlantı kopmasında bir frame’lik `released` sinyali, bounded `rumbleGamepad()` haptics fallback’i, kamera culling'i ve `culledCount`/texture kaynak ölçümleri
- `Input`/`ExiEngine` gamepad hot-plug callback’leri; `onGamepadConnected` ve `onGamepadDisconnected` yalnızca bounded snapshot verir, native Gamepad nesnesini oyun koduna taşımaz
- Alpha-blended rect/circle/line/polygon primitive’leri ve limitli particle pool’u
- ParticleEmitter varsayılan olarak yeniden kullanılan instanced buffer ve bounded particle object pool yolu ile çalışır; screen-space quad culling görünür kayıtları packed stream’e alır, `gpuCulling: true` WebGPU’da 16-float source stream’i compute culling’e bırakır, `instanced: false` CPU quad fallback’idir.
- Finite süre/delta/loop sınırları ve varsayılan tween bütçeli `Tween`/`Animator`; AABB collision, raycast ve opt-in hafif axis-separated `PhysicsWorld`; `Collider({ bounds: { x, y, width, height } })` ile görsel node’dan bağımsız hitbox, `oneWay: "up" | "down" | "left" | "right"` ile tek yönlü platform/duvar; 32-bit `layer`/`mask` filtreleme ve trigger/dynamic temasları için `overlaps()`
- `PhysicsWorld({ onBeginContact, onStayContact, onEndContact })` ile opt-in temas başlangıç/sürekli/bitiş olayları; üçüncü callback argümanı geçici `PhysicsContact` normal/penetration metadata’sı taşır, callback yokken temas polling/tracking maliyeti eklenmez; `remove()` ve `clear()` aktif çiftler için `end` cleanup bildirir
- `CollisionWorld.raycast()` ile allocation-safe, mesafe limitli line-of-sight/projektil sorgusu; spatial broadphase’i yeniden kullanır
- Texture dizileriyle frame-rate/loop/ping-pong kontrollü `AnimatedSprite`; isteğe bağlı `onLoop`, `onFrameChange` ve `onComplete` callback’leri
- Aynı-origin ve boyut limitli `AssetLoader`; varsayılan 16 MiB response byte bütçesi, mutlak 64 MiB tavan ve JSON byte/düğüm/derinlik bütçeleri
- İsteğe bağlı `integrity: "sha256-..."` ile Web Crypto tabanlı asset bütünlük doğrulaması; doğrulanmış texture cache’e yazılmaz, atlas metadata’sı için ayrı `atlasIntegrity` kullanılabilir
- `AssetLoader.loadMany()` manifesti 4096 kayıt/256 karakter anahtar sınırında işler; `texture`, `json`, `bytes`, `atlas` ve açık decoder gerektiren `ktx2` türlerini destekler (`atlas` için `url` texture, `atlasUrl` JSON metadata’dır); atlas frame adları 256 karakterle sınırlı ve null-prototype kayıtlarla tutulur
- Web Audio `AudioManager` (compressed/decoded PCM limitli, bounded `loadMany()` preload/progress/abort akışlı, `integrity: "sha256-..."` ile mevcut AssetLoader doğrulamasına bağlı, varsayılan 64 aktif voice bütçeli, volume-preserving bus mute ve `fadeBus()` otomasyonu, isteğe bağlı `pan: -1..1`, aktif voice volume/pan kontrolü ve `suspend()`/`resume()` lifecycle API’si), sınırlı `SaveStore` ve runtime `Profiler`
- `AudioManager.unload()`/`stopAll()` ile kullanılmayan decoded buffer ve canlı voice node’larını bütçeye geri bırakma; aynı ses anahtarı başarılı biçimde yeniden yüklendiğinde eski buffer voice’ları da güvenle durdurulur
- `AssetLoader.loadMany()` ile progress, abort, hata politikası ve concurrency sınırı
- `AssetLoader.loadAtlas()` texture ve JSON metadata kaynaklarını bağımsız biçimde paralel başlatır; ortak abort ve byte/JSON limitleri korunur
- Güvenli KTX2 header/range inspection, bağımlılıksız uncompressed RGBA8 KTX2 yükleme ve Basis/UASTC gibi sıkıştırılmış KTX2 akışları için açık decoder adaptörü (`loadKTX2()`); decoder yalnızca `CanvasImageSource` döndürür, loader sahipliği korur
- Eşzamanlı aynı-origin asset isteklerinde URL/sinyal bazlı deduplikasyon; değişmeyen Graphics geometrisinde render-item cache’i, dirty rebuild’de item/positions/bounds belleği yeniden kullanımı
- Tekil Sprite render geometrisinde frame/texture/size/flip değişimlerinde item, positions ve UV dizisi yeniden kullanımı; tint/alpha güncellemeleri allocation yapmaz (`npm run bench:sprite`)
- Sprite geometri anahtarı scalar cache kullanır; `SpriteBatch.setSprite()` sıcak güncellemede mevcut kaydı yerinde değiştirir
- Instanced `SpriteBatch` ve `TileMap` kamera/world cache’leri frame başı template-string üretmeden scalar alanlarla karşılaştırılır
- Static `Graphics`, regular `SpriteBatch` ve CPU `TileMap` cache/culling anahtarları da aynı sayısal sürüm durumunu yeniden kullanır; sabit frame’de uzun key string’i oluşturulmaz
- CPU instance yolu `cullable: false` olsa bile kamera değişince yeniden hesaplanır; nested scissor clip kesişimleri node başına scratch rect’i yeniden kullanır
- Engine interpolation kökleri ve WebGL2/WebGPU RenderGroup traversal listeleri frame’ler arasında kalıcı scratch olarak yeniden kullanılır; geçişlerde scene referansı temizlenir (`npm run bench:frame-scratch`)
- Kök `index.d.ts` ile bağımlılıksız TypeScript API sözleşmesi
- WebGL2’de kapasitesi korunan, WebGPU’da 64 MB global ve cihaz limitine göre daralan vertex/instance buffer’ları

## Hızlı başlangıç

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

Node davranışını global update callback’ine taşımadan doğrudan node üzerinde tanımlayabilirsiniz:

```js
const player = new Sprite({
  width: 32, height: 32,
  onUpdate: (delta, node) => { node.position.x += 120 * delta; },
});
scene.add(player);
```

Offscreen render hedefi için kamera viewport’u hedefle aynı boyutta tutulur; hedef aynı render pass içinde texture olarak kullanılmaya çalışılırsa feedback loop hatası verilir:

```js
const target = new RenderTexture({ width: 320, height: 180 });
const targetCamera = new Camera({ width: 320, height: 180 });
engine.renderToTexture(target, scene, targetCamera);
```

Çocuklarını her frame bağımsız offscreen pass’inde çizip ana sahnede tek quad olarak kompoze etmek için `RenderGroup` kullanılabilir; nested gruplar önce içten dışa işlenir:

```js
import { RenderGroup, Sprite } from "exi-engine";

const group = new RenderGroup({ width: 320, height: 180, x: 160, y: 90, filter: "brightness", filterAmount: 0.15 });
group.add(new Sprite({ x: 40, y: 40, width: 32, height: 32, tint: 0x6fffc0 }));
scene.add(group);
```

Kısa efekt zinciri:

```js
group.setEffects([
  { filter: "grayscale", amount: 0.4 },
  { filter: "brightness", amount: 0.1 },
]);
```

Kamera takibi:

```js
camera.follow(player, { smoothing: 0.15 });
camera.setBounds({ x: 0, y: 0, width: 4096, height: 2048 });
camera.shake(8, 0.2, { frequency: 24 });
```

`player` doğrudan `x/y` taşıyan bir nokta veya `.position` alanı olan bir Node olabilir.

Sahne değiştirirken eski scene kullanıcıya ait kalır; engine yalnızca render hazırlığını ve eski pointer hedeflerini temizler:

```js
engine.setScene(menuScene, menuCamera);
engine.setScene(gameScene, gameCamera);
```

HUD için overlay sahnesi ana dünyanın üstünde, kendi kamera koordinatında çizilir. Kamera verilmezse engine ekran merkezli bir kamera kurar; overlay `pointerdown`/`move`/`wheel` hedefleri oyun sahnesinden önce seçilir:

```js
const hud = new Scene();
hud.add(new Sprite({ x: 80, y: 32, width: 160, height: 48, interactive: true,
  onPointerDown: () => console.log("HUD button") }));
engine.setOverlay(hud);
// Kapatmak için: engine.setOverlay(null);
```

Overlay fixed-step içinde ana sahneden sonra güncellenir ve ana render pass’inden sonra `load` olarak kompoze edilir; bu nedenle `clearBeforeRender` global ayarını değiştirmez.

Overlay elemanlarını resize’a dayanıklı yerleştirmek için `setLayout()` kullanılabilir. `right`/`bottom` kenarları ve `anchorX`/`anchorY` 0..1 aralığı, CSS piksel karşılığı overlay viewport’unda değerlendirilir:

```js
const score = new Text({ text: "SCORE 000", width: 140, height: 24 });
score.setLayout({ right: 16, top: 16 });
hud.add(score);
```

Canvas UI odağı ve Tab sırası:

```js
const play = new Sprite({ width: 180, height: 48, focusable: true, tabIndex: 0,
  onKeyDown: ({ key, preventDefault }) => {
    if (key === "Enter" || key === " ") { preventDefault(); startGame(); }
  } });
hud.add(play);
engine.focus(play);
```

`Tab` ve `Shift+Tab` görünür `tabIndex >= 0` node’lar arasında döner; overlay node’ları ana sahneden önce taranır.

Texture tabanlı panel/çerçeve için dokuz parçalı sprite kullanılabilir:

```js
const panel = new NineSliceSprite({
  texture: panelTexture,
  width: 420, height: 180,
  left: 12, right: 12, top: 12, bottom: 12,
});
hud.add(panel);
```

Deterministik/custom loop kullanımı için renderer hazırlandıktan sonra `step(deltaSeconds)` çağrılabilir; fixed-timestep update, render, profiler ve input frame temizliği aynı akıştan geçer:

```js
await engine.init();
engine.step(1 / 60);
```

`onUpdate` içinde `engine.stop()` veya `destroy()` çağrılırsa aynı frame’in catch-up fixed-step döngüsü de hemen kesilir.

`engine.start()` çalışırken `step()` çağrısı reddedilir; böylece iki ayrı oyun loop’u aynı state’i eşzamanlı ilerletemez.
SSR/Worker ortamında native `requestAnimationFrame` yoksa `start()` açıkça reddedilir; bu ortamlar için `step()` kullanılmalıdır.

Sekme veya uygulama görünmez olduğunda, ayrıca bfcache geçişinde `pagehide` geldiğinde engine varsayılan olarak duraklar; `pageshow` veya görünürlük dönüşünde otomatik olarak devam eder. `pauseOnHidden: false` ile bu davranış kapatılabilir:

```js
const engine = await ExiEngine.create({ canvas, pauseOnHidden: true });
engine.pause();
engine.resume();
engine.setTimeScale(0.5); // slow-motion
engine.setTimeScale(1);
```

Fixed-step hareketini render tarafında yumuşatmak isteyen oyunlar bunu opt-in açabilir:

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

Pointer olayları child’dan parent’a bubble eder; `pointerenter`/`pointerleave` bubble etmez. Parent akışını kesmek veya olayın uygulama tarafından işlendiğini işaretlemek için `event.stopPropagation()` ve `event.preventDefault()` kullanılabilir:

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

`PhysicsBody`/`Collider` varsayılan olarak layer `1` ve tüm maskeleri kullanır. Bir temasın kabul edilmesi için iki body’nin maskesi de karşı body’nin layer bitini içermelidir; `overlaps()` oyun filtresinden önce bu hızlı karşılıklı maskeyi uygular.

Temas olaylarını isteğe bağlı açabilirsiniz:

```js
const physics = new PhysicsWorld({
  scene,
  onBeginContact: (body, other) => console.log(body.collider.tag, other.collider.tag),
  onStayContact: (body, other) => applyDamageOverTime(body, other),
  onEndContact: (body, other) => console.log("ayrıldı", other.collider.tag),
});
```

## Geliştirme

Node.js yeterlidir:

```text
npm test
npm run verify
npm run dev
npm run bench:streaming
npm run bench:instanced
npm run bench:regular
npm run bench:culling
npm run bench:sprite-culling
npm run bench:graphics:culling
npm run bench:subtree-culling
npm run bench:transform
npm run bench:text
npm run bench:glyph
npm run bench:particles
npm run bench:particles:cpu
npm run bench:particles:culling
npm run bench:particles:gpu-culling
npm run bench:input
npm run bench:tilemap
npm run bench:queue
npm run bench:collision
npm run bench:physics
```

`npm test`, statik bağımlılık/güvenlik taramasına ek olarak gerçek HTTP server smoke testini de çalıştırır; CSP, `nosniff`, traversal ve yöntem sınırları canlı isteklerle doğrulanır.

`npm run verify`, `npm test` kapsamını tüm allocation/streaming benchmarklarıyla birleştirir ve release öncesi tek komutluk bağımlılıksız kabul kapısıdır. Gerçek tarayıcı/GPU ve fiziksel cihaz koşuları bu komutun yerine geçmez; `test/hardware-soak.html` ve fiziksel matris ayrıca çalıştırılır.

`bench:input`, `bench:tilemap`, `bench:tilemap:regular` ve `bench:queue`; gamepad state, action sorguları, TileMap instance/regular stream’leri ve renderer batch/upload queue’sunun frame’ler arasında yeniden kullanımını ölçer. Renderer prepare ölçümleri queue başına tek scalar dolaşım kullanır.
`bench:particles:culling`, ekran dışı particle’ların packed instance stream’e girmediğini ve görünür sabit stream view’inin yeniden tahsis edilmediğini ölçer.
`bench:particles:gpu-culling`, `gpuCulling: true` particle source stream’inde CPU world→screen dönüşümünün yapılmadığını ve 16-float WebGPU sözleşmesini ölçer.

Demo: `http://127.0.0.1:4173/`

`AssetLoader.release()` tekil texture cache eviction yapar; devam eden yükler eski URL nesliyle cache’e geri yazılmaz.
`AssetLoader` genel response byte bütçesini varsayılan 16 MiB ile başlatır; güvenli üst tavan 64 MiB’dir.
`AssetLoader.loadJSON()` genel asset byte bütçesine ek olarak varsayılan 4 MiB JSON, 100.000 düğüm ve 64 derinlik limitini uygular; çağrı bazında `maxJSONBytes`, `maxJSONNodes` ve `maxJSONDepth` daha dar seçilebilir, loader tavanı aşılamaz.
`AssetLoader.destroy()` engine teardown sırasında pending fetch’leri abort eder; aynı byte/texture için farklı signal kullanan çağrılar tek fetch/decode işini paylaşır ve caller abort’u yalnızca o çağrının promise’ini keser. `clear()` ise devam eden yükleri iptal etmeden cache neslini değiştirir.
`engine.start()` görünür ilk frame öncesi texture ve vertex buffer’larını hazırlar; gerektiğinde `engine.prepare()` ve `textureUploads` metrikleriyle kontrol edilebilir.
`maxTextureBytes` varsayılan 128 MiB, `maxTextureCount` varsayılan 4096’dır; WebGL2/WebGPU bu toplam bütçeyi texture ve RenderTexture tahsislerinden önce uygular, `getInfo()` içinde `textureBytes` ve limitleri raporlar.
`backgroundColor` number veya `#rgb`/`#rrggbb` string kabul eder; `backgroundAlpha` 0..1 aralığına clamp edilir. `clearBeforeRender: false` clear çağrısını kapatır ve WebGL2’de canvas içeriğini korumak için `preserveDrawingBuffer` açar; ilk frame’de temiz içerik gerekiyorsa varsayılan `true` korunmalıdır.
`maxPixelRatio` fiziksel canvas çözünürlüğünü sınırlar; engine kamera `pixelRatio` değerini de aynı anda kullanarak yüksek DPI cihazda yalnızca görüntüyü keskinleştirir, dünya viewport’unu büyütmez. Manuel `Camera` kullanımında `setPixelRatio()` aynı dönüşüm sözleşmesini açıkça seçer.
Engine çalışma konfigürasyonunun boyut, resize, pixel-ratio, texture bütçesi ve fixed-step alanları constructor snapshot’ına bağlıdır; resmi `setLogicalSize()`/`setResizeMode()` yolları kullanılmalıdır.
Değişmeyen `Graphics` rect/circle/line geometrisi, küçük sahnelerde ekstra draw oluşturmaması için `staticCache: true` ile opt-in statik GPU buffer cache’i kullanır.
Değişmeyen büyük tilemap’lerde CPU screen-space yolunu özellikle kullanmak için `TileMap({ staticCache: true, instanced: false })` static vertex dönüşümünü frame’ler arasında cache’ler; instanced yolunda GPU transform tercih edilir.
WebGL2/CPU instanced TileMap yolu varsayılan `cullTiles: true` ile kamera görünür local aralığı dışındaki tile’ları instance stream’e yazmaz; tüm tile’ları bilinçli göndermek için `cullTiles: false`, node-level culling’i de kapatmak için `cullable: false` kullanılabilir.
`TileMap({ instanced: false })` regular CPU/WebGL2 fallback’i dirty güncellemelerde render item, positions ve UV dizilerini yeniden kullanır; `npm run bench:tilemap:regular` bu identity sözleşmesini ölçer.
Chunk streaming’de `setRegion(x, y, width, height, values)` yalnızca bölgeyi atomik biçimde değiştirir; geçersiz tile index’i tüm bölgeyi değiştirmeden reddedilir.
TileMap fiziği için `createStaticBodies(physics, { solidTiles: new Set([0, 1]) })` kullanılır; tile verisi değişince controller `rebuild()` çağrılır. Solid rect üretimi bitişik hücreleri birleştirir ve boş tile’lar için collider oluşturmaz.
SpriteBatch ve TileMap ekran dışındaysa render item/vertex üretmeden önce coarse bounds culling uygular.
Tekil Sprite ve Text ekran dışındaysa local bounds ile erken cull edilir; görünür nesnelerde bounds köşeleri ve render köşeleri aynı scratch dönüşüm akışını kullanır. `npm run bench:sprite-culling` bu yolu 2000 offscreen sprite ile doğrular.
Graphics primitive culling yolu `npm run bench:graphics:culling` ile 2000 ekran dışı komutta doğrulanır.
Scene graph world matrix’leri değişmemiş local transform ve parent sürümü için yeniden hesaplanmaz; `npm run bench:transform` bu yolu ölçer.
Render queue, aynı renderable üyeliği/`worldZ` sırası korunurken global z-sort listesini frame’ler arasında yeniden kullanır; z-order veya kardeş sırası değişirse güvenli biçimde yeniden kurar.
Kalıcı renderer batch state’i render queue sonuç wrapper’ını da yeniden kullanır; `npm run bench:queue` queue/batch/data reallocasyonlarını ayrı raporlar.
Sahne küçüldüğünde batch pool’undaki eski static owner, texture, mask ve GPU resource referansları bırakılır; yalnızca sınırlı bir yeniden kullanım penceresi tutulur.
Render queue clip birleşimi her çizilebilir nesne için string anahtar üretmez; eşit scissor değerlerini dört sayısal alanla karşılaştırır ve ayrı clip nesnelerini tek batch’te birleştirir.
Yoğun SpriteBatch’ler varsayılan 256’lık chunk’lara bölünür; `chunkSize` görünürlük/memory dengesi için ayarlanabilir ve aynı texture chunk’ları tek draw’da birleşir.
Başlangıçta çok sayıda kayıt için `addSprites([...])` kullanılabilir; tüm texture ve sprite sınırları doğrulanmadan batch’e yazılmaz.
SpriteBatch toplamı 100.000 sprite ile sınırlıdır; daha büyük sahneler için birden fazla batch/chunk kullanılır.
Eklenme sırasını koruyan düzensiz büyük dünyalar için `spatialCulling: true` ve `cellSize` spatial index kullanır.
Spatial culling görünür index listesi ve bounds scratch alanlarını frame’ler arasında yeniden kullanır; kamera görünür alanını local cell aralığına indirerek uzak spatial hücreleri her frame taramaz. `npm run bench:culling` scratch/bounds ve cell visibility ölçümünü yapar.
`CollisionWorld({ spatial: true, cellSize: 128 })` isteğe bağlı broadphase kullanır; generic collider transformı değiştiğinde temiz index üzerinde yalnızca ilgili kaydı `syncCollider(collider)` ile güncelleyebilir veya toplu değişiklik sonrası `rebuild()` çağırabilirsiniz. `autoSync: true` seçilirse bu kontrol sorgu öncesi otomatik yapılır ve O(n) maliyet taşır. Varsayılan `spatial: false` yolu sırasını ve API davranışını korur.
`PhysicsWorld` yalnızca kullanıldığı zaman çalışır; `gravity`, velocity, static/kinematic/trigger collider, 32-bit `layer`/`mask`, sınırlı fixed substep, X/Y eksenli çözümleme, `grounded` durumu ve yeniden kullanılan `overlaps()` listesi sağlar. `PhysicsBody({ kinematic: true })` gravity almaz; velocity ile önce hareket eder ve üzerinde grounded olan dynamic body’leri aynı bounded delta ile taşır, böylece hareketli platform kurulabilir. `Collider`/`PhysicsBody` isteğe bağlı finite local `bounds` override’ı ile sprite görselinden küçük ayak kutusu veya offset’li hitbox kullanabilir; static/kinematic collider’da `oneWay: "up"` aşağıdan geçişe izin verip yalnızca üstten aşağı gelen hareketi durdurur, diğer yönler aynı sözleşmeyi izler. `setBounds(null)` ile node’un kendi local bounds’ına geri döner. Axis çözümlemesi hareket yolunu swept-AABB broadphase üzerinde tek geçişli scratch filtreyle tarar, en yakın solid temasta durur ve beklenmeyen son-konum overlap’i için mevcut düzeltme fallback’ini korur; böylece hızlı body’ler ince collider’ları atlamaz. Dynamic body hareketleri artık yalnızca ilgili collider’ın hücre kayıtlarını incremental günceller; her frame tüm broadphase yeniden kurulmaz. `autoSync: true`, statik collider’ın transform dışı geometri değişikliklerini de sorgu öncesi yakalar; bu opt-in yol O(n) stale-shape kontrolü yapar. Dynamic body’ler kinematic olarak static/kinematic body’lere çözülür; tam rigid-body impulse/rotation solver’ı bilinçli olarak çekirdeğe eklenmedi.
`Sprite.getLocalBounds()` ve `Collider.bounds` sabit geometri/transform süresince aynı nesneyi yeniden kullanır; `npm run bench:collision` bounds ve query listesi reallocasyonlarını ayrı raporlar.
`instanced: true` CPU quad üretimini kaldırır; dönüşüm, atlas UV’si ve tint/alpha instance buffer üzerinden GPU’ya gider. Instance buffer kapasitesi yeniden kullanılır ve 64 MB güvenlik sınırı vardır.
WebGL2 CPU-instanced fallback’inde de aynı boyuttaki instance buffer frame’ler arasında yeniden kullanılır; `npm run bench:instanced` bu yolu ayrı ölçer.
CPU/WebGL2 regular SpriteBatch benchmark’ı da chunk pozisyon/UV/renk dizilerinin güncellemeler arasında korunmasını ölçer; `npm run bench:regular` 1000 sprite / 60 frame koşusunda 0 buffer reallocation bekler.
`gpuCulling: true` WebGPU’da görünür instance listesini compute shader ile üretir; `gpuCulling` tek başına CPU fallback’i aşmaz ve WebGL2’da compute taklidi yapılmaz.
GPU culling yolunda CPU yalnızca yerel sprite kaydı paketler; world/camera transform, rotation, görünürlük ve compact output compute aşamasına bırakılır.
GPU culling input/output kapasitesi batch başına ve renderer toplamında sınırlandırılır; geçersiz instance sayısı GPU allocation’ından önce reddedilir.
GPU culling kaynak stream’i aynı boyutta kaldığı sürece typed-array belleğini frame’ler arasında yeniden kullanır; `npm run bench:streaming` bu sözleşmeyi donanımdan bağımsız doğrular.
`SpriteBatch.setFrame()` aynı atlas içindeki senkron animasyon frame’ini tek invalidation ile değiştirir; GPU source buffer yeniden kullanılır.
`SpriteBatch.addAnimatedSprite()`/`setSpriteAnimation()` aynı atlas içindeki bağımsız frame animasyonlarını tek batch içinde ilerletir; `updateAnimations()` yalnızca frame değiştiğinde tek invalidation yapar ve instanced GPU source buffer’ı korur. `npm run bench:animation` bu akışta frame ilerlemesini ve buffer reallocasyonunu ölçer.
`SpriteBatch.sprites` kayıtlarını doğrudan değiştiren yüksek frekanslı kod, değişiklikleri bitirdikten sonra `markDirty()` çağırabilir; bu yol instance buffer kapasitesini korur ve her frame otomatik O(n) değişiklik taraması yapmaz.

Demo, 37 render node'u, atlaslanmış arka planı, collision durumu ve backend/FPS/draw/node ölçümlerini gösterir. `Auto`, `WebGL2` ve `WebGPU` seçenekleri aynı sahneyi değiştirir.

Gerçek tarayıcı/GPU/audio soak testi için `http://127.0.0.1:4173/test/hardware-soak.html` kullanılabilir; çıktı backend limitlerini, GPU culling belleğini, texture/render-target sayısını, Graphics polygon yolunu, gerçek AudioContext voice/pan probe’unu, input axis listener probe’unu, RenderTexture offscreen pass/resize sayaçlarını, RenderGroup/post-process pass’lerini, TextCache/GlyphAtlas paylaşımını, karmaşık yazı shaping fallback’ini ve device-loss/runtime-error durumunu raporlar. Manuel loss, WebGL’de gerçek `WEBGL_lose_context` restore’unu; WebGPU’da fallback sonrası WebGL2 backend ve devam eden frame’leri doğrulamadan başarılı sayılmaz.
Fiziksel iOS/Android/WebView sonuçlarını toplamak için [test/HARDWARE_MATRIX.md](test/HARDWARE_MATRIX.md) içindeki matris, kabul kriterleri ve Android USB `adb reverse` hazırlığı kullanılır; bağlı cihaz yokken fiziksel sonuç iddiası yapılmaz.

## Güvenlik sözleşmesi

- Runtime shader kodu dışarıdan kabul edilmez; shader’lar kaynak içinde sabittir.
- `AssetLoader` varsayılan olarak yalnızca kendi origin’ine izin verir, credential-bearing URL’leri ve redirect’i reddeder, bilinen raster header boyutlarını decoder öncesi kontrol eder ve 64 MiB mutlak response byte tavanı ile image boyutlarını ve toplam texture cache’ini sınırlar; demo sunucusu CSP `frame-ancestors`, `X-Frame-Options` ve `Permissions-Policy` ile kapatılmıştır.
- KTX2 parser yalnızca bounded 2D/tek-face range’leri kabul eder; mip level, 64-bit offset, pixel ve uncompressed-byte limitlerini decoder’dan önce doğrular. Sıkıştırılmış KTX2/Basis decoder’ı otomatik yüklenmez; yalnızca uygulamanın açıkça verdiği adaptör çalıştırılır.
- Asset texture’larında maksimum boyut ve toplam pixel bütçesi uygulanır; renderer upload katmanı da GPU boyut/pixel sınırını tekrar doğrular.
- Renderer toplam GPU texture belleği ve texture sayısı da `maxTextureBytes`/`maxTextureCount` ile sınırlandırılır; atlas subtexture’ları aynı `baseTexture` GPU kaynağını paylaşır. Public texture/cihaz-limit alanları constructor/device snapshot’ına bağlıdır; doğrudan büyütme reddedilir.
- TileMap allocation’ı da 500.000 tile ile sınırlıdır; geçersiz grid/frame index’leri GPU allocation’ından önce reddedilir.
- Atlas JSON’u frame sayısı ve sınırları doğrulanmadan kullanılmaz.
- Save verisi namespace, JSON ve maksimum boyut ile sınırlandırılır; executable veri yoktur.
- Input action adları, binding sayısı ve klavye/gamepad indeksleri sınırlıdır; binding’ler yalnızca sabit veri olarak tutulur, callback/eval/script çalıştırmaz.
- Yerel sunucu yalnızca `127.0.0.1` üzerinde dinler, traversal’ı engeller ve CSP/`nosniff`/CORP/referrer başlıkları gönderir.
- Kaynakta harici motor import’u, `eval` veya `new Function` statik testte reddedilir.

Ayrıntılı tehdit modeli için [SECURITY.md](SECURITY.md) dosyasına, araştırma-gap matrisi için [RESEARCH_GAPS.md](RESEARCH_GAPS.md) dosyasına bakın.

## Bilinçli sınırlar

Audio decode tarayıcıdaki kullanıcı etkileşimi politikasına tabidir. Device-loss cleanup ve fallback sözleşmesi simüle smoke testte doğrulanır; gerçek GPU memory soak, driver reset ve fiziksel cihaz matrisi ayrıca gerekir. Production dağıtımında HTTPS ve sunucu tarafı güvenlik başlıkları ayrıca korunmalıdır.
