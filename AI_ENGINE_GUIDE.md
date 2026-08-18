# ExiEngine agent guide

Bu dosya Codex, Claude Code, OpenCode, Gemini CLI ve benzeri coding agent’lar için canonical repo sözleşmesidir. Adapter dosyaları (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) yalnızca buraya yönlendirir; kural eklemeden önce bu dosyayı güncelle.

API ve MCP’nin örnekli ayrıntılı referansı için [API.md](API.md) okunmalıdır; TypeScript imzalarının kaynağı [index.d.ts](index.d.ts)’dir.

## Hızlı başlangıç

```powershell
npm run doctor   # ortam, export ve repo sözleşmesi
npm test         # hızlı statik/server/engine smoke + unit + typecheck
npm run lint     # zero-dep sözdizimi + anti-pattern taraması
npm run test:typecheck  # index.d.ts bütünlüğü + TS consumer fixture
npm run test:coverage   # unit suite coverage eşikleri
npm run bench:regression  # benchmark baseline drift kapısı
npm run verify   # release gate ve tüm benchmark’lar
node tools/exi-mcp-server.mjs  # AI CLI stdio bridge; stdout yalnızca JSON-RPC
npm run test:clients:native  # kurulu host CLI’lar için bounded mcp list probe
```

Runtime dependency yoktur. Node.js yalnızca test ve yerel demo sunucusu içindir. Motor başka bir oyun motoruna import edilmez; çekirdek WebGL2/WebGPU backend’lerini kendisi yönetir.

Minimal kullanım:

```js
import { ExiEngine, Scene, Sprite, Texture } from "./src/index.js";

const scene = new Scene();
scene.add(new Sprite({ texture: Texture.white, x: 320, y: 180, width: 64, height: 64 }));
const engine = await ExiEngine.create({ canvas: document.querySelector("canvas"), scene });
engine.start();
```

## AI CLI MCP bridge

`tools/exi-mcp-server.mjs`, runtime dependency eklemeden standart JSON-RPC stdio MCP yüzeyi sunar. Codex, Claude Code, OpenCode, Gemini CLI, Cursor CLI, Cline CLI, Windsurf/Cascade veya başka bir MCP istemcisi için çalışma dizini repo kökü olmalı ve command doğrudan `node tools/exi-mcp-server.mjs` olmalıdır; `npm run mcp` npm başlığını stdout’a yazabildiği için MCP transport command’ı olarak kullanılmamalıdır. MCP ayar örnekleri [MCP.md](MCP.md) içindedir. Bridge dual-era çalışır: güncel `2026-07-28` istemcisi `server/discover` ile başlar ve her request’te `params._meta` altında protokol sürümü ile `clientCapabilities` taşır; legacy istemci `initialize` → `notifications/initialized` akışını kullanır. Her iki akış da sonra `tools/list`, `resources/list`, `prompts/list` ve `exi_api` çağırır. Modern result yanıtı `resultType: "complete"` ve server identity `_meta` taşır. `prompts/get` ile `exi_create_game` veya `exi_verify_runtime` workflow’u istenebilir. Uzun çalışan `exi_check` veya preview çağrıları JSON-RPC `notifications/cancelled` ile request id üzerinden iptal edilebilir; iptal edilen tool yanıt üretmez ve başlattığı child process temizlenir.

Temel araçlar:

- `exi_api`: `src/index.js` export/class/static/public method manifesti, her export/member/method için kanonik `route`, `methodRoutes`/`staticMethodRoutes`, getter çalıştırmayan descriptor reflection, `resources` canonical URI eşlemesi, `callRoutes` API-işlem/tool eşlemesi, bridge limitleri ve canonical create/assets/cleanup workflow sırası; API drift’ini, tool/URI tahmini hatalarını ve limit tahmini hatalarını engeller.
- MCP `resources/list`/`resources/read`: fixed `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime`, `exi://clients` sözleşmelerini okur; arbitrary filesystem resource yoktur.
- `prompts/list`/`prompts/get`: `exi_create_game` ve `exi_verify_runtime` workflow’larını sunar; prompt `arguments` object olmalı, tanımsız alanlar gönderilmemelidir.
- `tools/list`: tool input schema’larını kanonik kabul et; üst seviye bilinmeyen alan gönderme ve zorunlu alanları doldur. Bridge şemada olmayan argümanları `EXI_MCP_ARGUMENT_UNKNOWN`, eksik alanları `EXI_MCP_ARGUMENT_REQUIRED`, tip/enum/limit/şema ihlallerini canonical kodlarla reddeder; binary upload için `exi_asset_write`/`exi_asset_chunk` şeması `{ "$bytes": [...]|base64 }` alanını açıkça tanımlar.
- `exi_create`, `exi_function`, `exi_export_get`, `exi_export_call`, `exi_static_call`: public engine nesnesi veya allowlisted export fonksiyonunu oluşturur/çağırır; static çağrı yalnızca class’ın own-property static method’larına gider.
- `exi_function` JSON içindeki `{"$bytes":[0,1,255]}` veya bounded base64 `{"$bytes":"..."}` değerlerini `Uint8Array` olarak çözer; böylece `inspectKTX2` gibi binary API’ler de MCP’den kullanılabilir. Typed-array/`DataView` sonuçları `bytes.$bytes` ile en fazla `exi_api.limits.maxInlineBinaryBytes` (32 KiB) inline taşınır; `exi_batch` içinde `{"$result":0,"$path":"bytes"}` ile sonraki binary API’ye geri verilebilir. Büyük sonuçlar `bytes.truncated` döndürür; tam asset için `exi_asset_read` kullanılır, BigInt sample değerleri string’dir.
- `findGridPath` bağımlılıksız, deterministik ve bounded A* grid pathfinding sağlar; `MAX_GRID_PATH_CELLS` ve `exi_api.limits.maxGridPathCells` sınırını aşmadan `diagonal`, `allowCornerCutting`, `blockedValues` ve `maxNodes` seçeneklerini kullan. Sonuçtaki `reached`, `expanded` ve `truncated` alanlarını kontrol et; pathfinding sonucu fizik veya navigation mesh garantisi değildir.
- `exi_inspect`, `exi_call`, `exi_get`, `exi_set`, `exi_release`: session-scoped `$handle` değerlerini metadata ile keşfetme, oyun state’i ve yaşam döngüsünü yönetme araçlarıdır; `exi_inspect` getter değerlerini çalıştırmadan yalnızca prototype üzerindeki callable public method/property listesini verir, oyun callback alanlarını method olarak açmaz. `exi_session_status` getter çalıştırmadan handle, protected handle, proje scope’u, bekleyen text/binary upload ve preview metadata’sını bounded biçimde döndürür; token ve geçici dosya yolu açmaz. `exi_session_reset` handle, upload ve aynı session preview process cleanup’ını birlikte yapar.
- `exi_batch`: en fazla 128 public tool çağrısını sırayla çalıştırır; `{"$result":0}` ile sonucu, `{"$result":0,"$path":"fileUploadId"}` ile güvenli bir own-property alanını sonraki çağrılara taşır; transaction değildir.
- `exi_project_apply`: aynı session scope’undaki klasöre en fazla 16 bounded text dosyasını toplam 512 KiB içinde tek transactional akışta yazar; `overwrite` açık değilse mevcut dosyaları değiştirmez, staging/commit hatasında tamamlanan dosyaları rollback eder ve `expectedVersion` ile stale dosya conflict’ini reddeder.
- `exi_build_scene`: bounded JSON deklarasyonundan `Scene`/`Node` ağacı kurar; callback veya script kabul etmez.
- `exi_scaffold`: repo kökü dışına çıkmadan minimal browser game dosyaları üretir; tüm starter dosyalarını önce benzersiz geçici dosyalara stage eder, commit yarıda kalırsa yeni dosyaları geri alıp eski dosyaları restore etmeye çalışır; mevcut dosyaları varsayılan olarak ezmez.
- `exi_project_open`: mevcut, repo-içi oyun klasörünü önce bounded HTML/JS/JSON statik kontrolden geçirir ve aynı MCP session’ında file/asset araçlarına açar; traversal, symlink, engine/test/tool kökü ve kontrol edilebilir dosyası olmayan proje reddedilir.
- `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch`: MCP-only ajanların aynı session’da scaffold edilen veya `exi_project_open` ile açılan oyunun allowlisted `.js`, `.html`, `.css`, `.json`, `.svg`, `.md`, `.mjs`, `.ts` veya `.txt` dosyalarını keşfetmesini, bounded UTF-8 olarak okuyup güncellemesini sağlar; list/read sonuçları `{ bytes, mtimeMs }` version taşır ve bu version `exi_file_write`/`exi_project_apply` içindeki `expectedVersion` alanına geçirilerek stale overwrite’ı `EXI_MCP_FILE_CONFLICT` ile durdurabilir. Tek çağrılı yazma ve exact-match patch metinleri 64 KiB’tır. `exi_file_patch` yalnızca `find` metninin tam bir eşleşmesi varsa atomik overwrite yapar; sıfır veya birden fazla eşleşmede dosya değişmez.
- `exi_file_begin`/`exi_file_chunk`/`exi_file_commit`/`exi_file_abort`: büyük text kaynaklarını sıralı UTF-8 chunk’larla 4 MiB’a kadar güvenli biçimde yazar; 48 KiB chunk, 16 MiB pending ve 8 aktif transfer limiti vardır. Mevcut dosya için `exi_file_begin` çağrısına read/list `version` değerini `expectedVersion` olarak ver; commit öncesi hedef tekrar kontrol edilir. `exi_file_read` büyük dosyalarda `offset`/`limit` ile 48 KiB sayfalar döndürür. Eksik parent klasörler yalnızca session scope’u içindeki proje klasörlerinde oluşturulur; engine/test/tool kökleri, binary, secret, traversal ve symlink reddedilir.
- `exi_asset_list`/`exi_asset_read`/`exi_asset_write`: MCP-only ajanların scaffold edilen veya `exi_project_open` ile açılan projedeki `.png`, `.jpg`, `.webp`, `.gif`, `.bmp`, `.avif`, `.ktx2`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.woff`, `.woff2`, `.ttf` veya `.otf` asset’lerini `{ bytes, mtimeMs }` version metadata’sıyla keşfetmesini, mevcut asset’in en fazla 32 KiB aralığını bounded base64 olarak okumasını ve `$bytes` payload’ı ile yüklemesini sağlar; `expectedVersion` stale overwrite’ı `EXI_MCP_FILE_CONFLICT` ile durdurur, tek yazma çağrısı byte limiti 512 KiB’dir.
- `exi_asset_begin`/`exi_asset_chunk`/`exi_asset_commit`/`exi_asset_abort`: 512 KiB üzeri asset’leri sıralı chunk’larla, aynı proje scope’undaki geçici dosyaya ve commit aşamasında hedefe taşıyarak yükler; mevcut asset için `exi_asset_begin` çağrısında `expectedVersion` verilebilir ve commit öncesi tekrar doğrulanır. Tek asset 64 MiB, bekleyen upload toplamı 64 MiB ve aktif upload sayısı 8 ile sınırlıdır. Secret/traversal/symlink ve allowlist dışı uzantılar reddedilir.
- `exi_file_check`: Aynı session scope’undaki `.html`, `.js`, `.mjs` veya `.json` dosyasını kod çalıştırmadan statik olarak doğrular; HTML script/style referanslarını da kontrol eder ve browser erişimi olmayan CLI için ilk proje bütünlüğü kapısıdır.
- `exi_project_check`: Scaffold edilen veya açılan klasördeki tüm allowlisted `.html`, `.js`, `.mjs` ve `.json` dosyalarını tek bounded akışta kontrol eder; en fazla 128 kontrol dosyası ve 32 hata özeti döndürür. Büyük veya hedefli değişikliklerde `exi_file_check` hâlâ kullanılabilir.
- `exi_project_status`: Aynı session scope’undaki projeyi tek read-only bounded sonuçta text dosyaları, binary asset metadata’sı, `exi_project_check` sonucu ve o proje için başlatılmış preview’ların HTTP/runtime telemetry durumuyla özetler; doğrudan `exi_preview_start({ path: "/ai-game/index.html" })` ile başlatılan aynı-scope preview da path’ten güvenli biçimde eşlenir. Runtime telemetry yoksa `runtime.ok=false` veya `telemetry:null` olarak static-only durumu açık kalır; browser/GPU çalıştırmaz.
- `exi_project_preview`: Aynı session scope’unda `exi_project_check` ile tüm checkable dosyaları doğrular; başarısızsa preview başlatmadan `{ ok:false, phase, projectCheck }` döndürür, başarılıysa `/index.html` için loopback preview ve `pageUrl` döndürür. Bu static check + HTTP readiness kapısıdır; browser/GPU kanıtı için `pageUrl` gerçek browser’da açılmalı ve `exi://runtime` ile karşılaştırılmalıdır.
- `exi_check`: arbitrary shell yerine yalnızca `doctor`, `test` veya `verify` çalıştırır.
- `exi_preview_start`, `exi_preview_call`, `exi_preview_batch`, `exi_preview_probe`, `exi_preview_stop`: yalnızca loopback `server.mjs` preview’ını başlatır, demo veya scaffold RuntimeAgent üzerinden allowlisted browser engine işlemi çalıştırır, bounded GET ile doğrular ve durdurur. Yeni oyun için `exi_preview_start({ path: "/ai-game/index.html" })` çağır; `pageUrl` doğrudan browser agent’a verilir ve hedef sayfa HTTP 200 olmadan preview hazır kabul edilmez. Asset dosyası yüklendikten sonra browser tarafında `AssetLoader` oluşturup `loadTexture`/`loadAtlas`/`loadJSON` çağır, dönen handle’ları `Sprite`/`TextureAtlas` akışına bağla; `exi_preview_batch` en fazla 8 sıralı browser operation’ını tek round-trip’te çalıştırır, önceki sonuçlardan `$result`/güvenli `$path` referansı alır ve `stopOnError:false` ile kalan çağrıları sürdürebilir. `observe` operation’ı scaffold/demo’da engine’in geçici RenderTexture readback’i üzerinden bounded ASCII grid/hash gözlemi, `snapshot` ise getter çalıştırmadan sayfalı scene graph/parent handle/transform state/hash verir; text-only AI CLI bu değerlerle gerçek WebGL2/WebGPU frame ve scene değişimini kontrol edebilir. Batch transaction değildir; tamamlanan geçici handle’lar ayrıca release edilmelidir. Preview hazır olma penceresi 10 saniyedir ve başarısız başlangıç otomatik temizlenir. Demo ve scaffold sayfaları, gerçek browser çalışmasından sonra token-korumalı `/__exi/runtime` kanalına bounded telemetry gönderir; `exi_preview_probe` bu raporu, `exi_preview_call`/`exi_preview_batch` ise browser handle, observe ve snapshot sonuçlarını okuyabilir. Browser RuntimeAgent yoksa call 10 saniye içinde temizlenmiş timeout döner.

Browser test/replay akışında native DOM event üretme: `engine` root’tan `input` handle’ını al, `engine.stop()` çağır, `Input.inject([{ type: "keydown", code: "ArrowRight" }])` ve `engine.step(1 / 60)` gibi bounded public yöntemlerle ilerle. `Input.inject` en fazla 128 event alır; sonuçları `snapshot` ve `observe` ile karşılaştır. Bu, OS input’u değil sayfanın kendi Input state’ine kontrollü bir test beslemesidir.

Birden fazla frame’i tek akışta doğrulamak için `scenario` kullan: `frames[]` içine `delta`, `input`, `observe` ve `snapshot` alanlarını koy. En fazla 16 frame/512 event vardır; başlangıçta çalışan engine varsayılan olarak senaryo sonunda yeniden başlatılır. Önce `snapshot` ile sahne handle’larını, sonra `scenario` ile input/step sonucu ve en sonda `observe` hash/grid farkını kontrol et. Bu workflow generic method çağrısı değildir; AI üretim döngüsünü hızlandıran daraltılmış bir test yoludur.

Uzun `tools/call` çağrılarında MCP request metadata’sine `_meta: { progressToken: "..." }` eklenirse bridge `notifications/progress` heartbeat’leri gönderir. Bunlar yalnızca ilerleme bilgisidir; final tool sonucu, cancellation ise `notifications/cancelled` ile aynı request id üzerinden yönetilir.

Browser-capable agent’lar runtime doğrulamasında `exi://runtime` kaynağındaki `#exi-runtime` output’unu okur. Backend değişiminden sonra en az `warmupMs` kadar beklenir; `data-ready="true"`, `data-status="running"`, `data-backend="webgpu"` veya `webgl2`, pozitif `data-fps` ve boş console error/warning listesi gerçek canvas kanıtıdır. Gerçek sayfa yüklendikten sonra `exi_preview_probe({ path: "/__exi/runtime" })` ile aynı sayfanın server telemetry raporu karşılaştırılabilir. Sentetik MCP POST’u veya statik index yanıtı browser/GPU kanıtı değildir; browser kontrolü olmayan CLI bunu açıkça “static-only” raporlamalıdır.

Bridge ve browser RuntimeAgent; `eval`, `new Function`, dinamik import, uzaktan kod, traversal, tehlikeli property adları, sınırsız JSON/scene/handle büyümesi ve stdout log kirliliğini reddeder. Browser command kanalı yalnızca `src/index.js` export’ları ile `engine`/`scene` köklerini görür; callback gövdesi/function source JSON’a dönüştürülmez, yalnızca sayfada kayıtlı `{"$callback":"name"}` referansı kabul edilir. `tools/call` state yarışlarını önlemek için session içinde sıralıdır; `tools/list` read-only/destructive annotation’ları istemciye niyet hint’i verir. Araçla yazılan dosyalar yine insan review’undan geçmeli; `npm run doctor` ve `npm test` tamamlanmadan iş bitmiş sayılmaz.

### Callback isteyen API’ler

`Node.traverse`, `Node.find`, `Scene.pick`, input/physics filtreleri ve diğer callback alan API’ler için callback kodunu MCP payload’ına koyma. Scaffold `game.js` içindeki `runtimeCallbacks` registry’sine review edilmiş fonksiyonu kaydet; browser `inspect` sonucundaki `callbacks` alanından adı okuyup `{"$callback":"name"}` gönder. Bu yalnızca sayfada kayıtlı fonksiyonu seçer; gövde serileştirme/eval yoktur, registry 256 callback ve isim başına 256 karakterle bounded’dır. Direct process-side `exi_call`/`exi_function` JSON-only’dir; önce `exi_project_check`, sonra gerçek preview ile doğrula.

## Test altyapısı

- `test/run-all.mjs`: `npm test` orchestrator'ü — her aşamayı sıralı ama bağımsız çalıştırır; bir aşama başarısız olsa da sonrakiler koşar ve özet raporlanır. Aşamalar: static, server, doctor, clients, mcp, engine-smoke, unit, typecheck.
- `test/unit/*.test.mjs`: `node:test` tabanlı modül unit testleri (alt-test adlarıyla). `engine-smoke.mjs`'in davranışını tekrarlamaz, tamamlar; coverage eşikleri `test/coverage/thresholds.mjs` ile yönetilir.
- `tools/lint.mjs`: zero-dep lint — `node --check` sözdizimi + motor importu/eval/console.log(MCP)/karışık girinti yasakları.
- `test/typecheck-syntax.mjs`: `index.d.ts` bütünlüğü + `test/fixtures/typecheck.ts` consumer'ını `--experimental-strip-types` ile çalıştırır (Node 22.6+; eski sürümde SKIP).
- `test/benchmark/benchmark-regression.mjs`: 25 benchmark'ı baseline ile karşılaştırır (elapsed +%50, fps -%40 tolerans). İlk koşuda `benchmark-baseline.json` oluşturur.
- `test/e2e/preview-e2e.mjs`: loopback server'ı başlatır, HTTP 200 + güvenlik başlıklarını doğrular.
- CI: `.github/workflows/ci.yml` — push/PR'da test (Node 20+22), verify, coverage ve preview-e2e job'ları.

## Kaynak haritası

- `src/index.js`: public runtime export yüzeyi.
- `src/ai/runtime-agent.js`: scaffold preview’ın token-korumalı, allowlisted browser runtime command client’ı; arbitrary script runner değildir.
- `index.d.ts`: aynı API’nin TypeScript bildirimi; public API değişirse birlikte güncellenir.
- `src/core/`: scene graph, camera, input, animation, physics, tilemap, text ve 2D primitives.
- `src/assets/`: Texture, atlas, render target, loader, save ve KTX2 sınırları.
- `src/render/`: ortak batch/clip akışı ile WebGL2/WebGPU backend’leri.
- `src/audio/`: Web Audio bus, bounded decode/voice ve lifecycle.
- `test/engine-smoke.mjs`: davranış, güvenlik ve lifecycle sözleşmesinin ana testi.
- `test/*-benchmark.mjs`: allocation/streaming/culling identity kapıları; fiziksel FPS iddiası değildir.
- `test/hardware-soak.html`: gerçek tarayıcı WebGL2/WebGPU/device-loss/audio kanıtı.
- `SECURITY.md` ve `RESEARCH_GAPS.md`: tehdit modeli ve bilinçli sınırlar.

## Değişiklik protokolü

1. Önce `rg` ile public sınıfın tüm caller’larını ve mevcut helper’ları bul.
2. En küçük kök neden düzeltmesini ortak fonksiyona yap; yeni dependency veya abstraction ekleme.
3. Runtime public API değişiyorsa aynı turda `index.d.ts`, README ve en az bir smoke assertion güncelle.
4. Asset/input/renderer/audio gibi trust boundary’lerinde finite, byte/pixel/count, origin, abort ve destroy davranışını koru.
5. Her non-trivial değişiklikten sonra önce ilgili test, sonra `npm test`; release iddiasından önce `npm run verify` çalıştır.
6. Browser/GPU davranışını Node testinden kanıtlanmış sayma; gerekli ise loopback sunucu ve hardware soak çıktısını ayrıca al.

## AI agent çalışma sınırları

- `src/` runtime koduna yeni framework, Pixi/Phaser/Three/Godot import’u veya runtime dependency ekleme.
- `eval`, `new Function`, uzaktan shader/script ve doğrulanmamış asset callback’i ekleme.
- Public `Map`, `Set`, array, texture/cache veya config alanlarının doğrudan mutation’ını sibling caller’ları bozmayacak şekilde doğrula.
- Testi gevşetme, timeout yükseltme veya benchmark’ı silme; önce gerçek kök nedeni düzelt.
- Git reset/checkout veya kullanıcı değişikliklerini silen komut çalıştırma.
- Belirsiz bir dış sistem side-effect’i varsa durumu raporla; repo içi doğrulanabilir işi tamamla.

## Tamamlanmış işin kanıtı

Final raporunda değişen dosyaları, çalıştırılan komutları ve geçti/kaldı sonucunu yaz. `npm test` yeşil olması browser/GPU/mobil kanıtı değildir; bu ayrımı açıkça koru.
### Upload integrity

Büyük veya kritik source/asset upload’larında istemci `expectedSha256` (64 hexadecimal SHA-256) gönderebilir. `exi_file_write`/`exi_asset_write` sonucu ve chunk commit’i `sha256` döndürür; digest uyuşmazlığında `EXI_MCP_UPLOAD_INTEGRITY` ile hedef dosya oluşturulmaz/değiştirilmez. Bu alan version guard’dan bağımsızdır: mevcut dosyayı güvenle değiştirmek için gerekirse hem `expectedVersion` hem `expectedSha256` ver.
