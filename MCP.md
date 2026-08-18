# ExiEngine MCP bridge

Örnekli tam API ve MCP referansı: [API.md](API.md).

ExiEngine exposes a local, dependency-free MCP stdio server for coding agents. Start it from the repository root with:

```powershell
node tools/exi-mcp-server.mjs
```

MCP stdio command’ı olarak `npm run mcp` kullanmayın: npm script başlığı stdout’a yazılabilir ve JSON-RPC handshake’ini bozabilir. `npm run mcp` yalnızca insanın terminalden manuel başlatması içindir; istemci config’lerinde doğrudan `node tools/exi-mcp-server.mjs` kullanılır.

Uzun veya yeniden bağlanan AI CLI oturumlarında `exi_session_status({})` salt-okunur bir reconnect haritasıdır: handle descriptor metadata’sı, project scope’ları, pending upload byte ilerlemesi ve preview readiness/page URL’si döner; runtime token’ları, temp path’leri, getter değerleri ve dosya içerikleri döndürülmez. Cleanup öncesi sıra `exi_session_status` → gerekirse `exi_preview_stop`/`exi_release` → `exi_session_reset` olmalıdır.

The process writes only newline-delimited JSON-RPC responses to stdout. Logs, if any, go to stderr. It is a dual-era server: modern MCP `2026-07-28` clients use `server/discover` plus per-request `_meta`, while legacy clients negotiate `2025-11-25`, `2025-06-18`, `2025-03-26` or `2024-11-05` through `initialize`. Modern result responses include `resultType: "complete"` and server identity in result `_meta`; legacy response shapes remain unchanged. JSON-RPC notifications, including cancellation/progress notifications, are consumed without producing an invalid response.

It also exposes standard `resources/list` and `resources/read` entries: `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime` and `exi://clients`. These resources are fixed allowlisted documents. The `initialize` and `server/discover` responses include a short server-wide workflow instruction so clients that honor MCP `instructions` receive the same safety order before tool discovery. `prompts/list`/`prompts/get` expose `exi_create_game` and `exi_verify_runtime` as bounded workflow instructions. `exi_inspect` describes a live handle without invoking getters, while `exi_batch` reduces round-trips for scene/asset preparation while preserving sequential session ordering. `exi_project_open` adopts an existing repo-local game directory only after bounded static checks; `exi_project_apply` then writes up to 16 text files in one transactional scope with rollback on staging/commit failure. `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch`/`exi_file_check` then give MCP-only agents a bounded project text-file discovery, edit and static syntax-check loop for either opened or scaffolded projects. `exi_file_patch` requires exactly one `find` match and reuses the atomic temp/backup replacement path. `exi_project_check` checks the whole project in one call. `exi_asset_list`/`exi_asset_write` add bounded binary game-asset discovery/upload and `exi_asset_begin`/`exi_asset_chunk`/`exi_asset_commit`/`exi_asset_abort` support larger sequential uploads. None are arbitrary filesystem or shell tools. Engine-mutating `tools/call` requests are serialized per MCP process; tool results are bounded to 64 KiB.
Long `exi_check`, `exi_project_check`, `exi_project_open`, preview-start and batch calls emit standard `notifications/progress` when the client sends `_meta.progressToken`; progress is advisory and does not replace the final tool result. Cancellation uses `notifications/cancelled` with the same request id and produces no response for the cancelled request.

JSON tool argümanlarında binary veri için yalnızca `{"$bytes":[0,1,255]}` veya bounded base64 `{"$bytes":"..."}` kullanılır; bridge bunu `Uint8Array` yapar ve 512 KiB mutlak byte sınırı uygular. `exi_file_read`/`exi_file_write`/`exi_file_patch` yalnızca aynı session’da `exi_scaffold` ile oluşturulmuş veya `exi_project_open` ile açılmış proje klasörlerinde çalışır; `exi_file_write` eksik parent klasörleri yalnızca bu proje scope’u içinde oluşturur, `exi_file_patch` ise mevcut dosya ister.

Binary döndüren `exi_call`/`exi_function` sonuçları da AI tarafından yeniden kullanılabilir: typed array ve `DataView` değerlerinde inline `bytes.$bytes` payload’ı `exi_api.limits.maxInlineBinaryBytes` (32 KiB) altında tutulur. Büyük sonuçlar `bytes.truncated` ile işaretlenir; tam dosya için `exi_asset_read` sayfalaması kullanılmalıdır. `exi_batch` içindeki `{"$result":0,"$path":"bytes"}` referansı bu base64 alanını tekrar güvenli `Uint8Array` argümanına çevirir.

`exi_api` manifestindeki her export `route` alanı ile kanonik tool’unu bildirir: class → `exi_create`, top-level function → `exi_function`, diğer export → `exi_export_get`. `methodRoutes` instance method adını `exi_call` ile, `staticMethodRoutes` static method adını `exi_static_call` ile eşler; ajan bu route’ları tahmin etmemelidir. `members` alanı `easing.linear` gibi nested public functions ve her member’ın `route` alanını; `staticProperties` alanı `Texture.white` gibi static değerleri ve `exi_export_get` route’unu gösterir. Keşif manifesti descriptor’lardan üretildiği için nested/static getter’ları çalıştırmaz; gerçek getter yalnızca açıkça `exi_export_get` veya ilgili çağrı istendiğinde değerlendirilir. Nested function’lar `exi_export_call` ile erişilir. `exi_static_call` yalnızca class own-property static method’larını çağırır; export path’leri ve static method’lar prototype zinciri üzerinden genişletilemez. `tools/list` içindeki her tool şeması üst seviyede `additionalProperties:false` taşır; bridge de aynı sözleşmeyi uygular. Bilinmeyen alan `EXI_MCP_ARGUMENT_UNKNOWN`, object olmayan üst seviye argüman `EXI_MCP_ARGS_TYPE`, nested type hatası `EXI_MCP_ARGUMENT_TYPE`, eksik zorunlu alan `EXI_MCP_ARGUMENT_REQUIRED`, enum/limit/şema ihlalleri de canonical hata kodlarıyla reddedilir. Böylece istemci keşif şeması ile gerçek dispatch yüzeyi drift etmez.

`exi_api` ayrıca `limits`, `toolInput` ve `workflow` döndürür. Ajan, `maxBinaryBytes`/`maxAssetReadBytes`/`maxChunkedAssetBytes`/`maxRuntimeCommandBytes`/`maxRuntimeBatchCalls` gibi limitleri, strict input kodlarını ve `workflow.create`, `workflow.open`, `workflow.assets`, `workflow.cleanup` sıralarını bu yanıttan okuyup doğrudan uygulamalıdır; sabitleri tahmin etmemelidir.

Top-level `findGridPath` fonksiyonu `exi_function` route’unda keşfedilir. Grid’i JSON dizi olarak gönder; `MAX_GRID_PATH_CELLS`/`exi_api.limits.maxGridPathCells` sınırına uy, `reached` ve `truncated` alanlarını doğrula. Bu çağrı yalnızca navigasyon path’i üretir; Node, collider veya scene oluşturmaz.

`exi_build_scene` deklaratif spec’i yalnızca `type`, `options` ve `children` alanlarını kabul eder; `options` object, `children` array olmalıdır. Tanımsız alanlar veya yanlış tipler `EXI_MCP_SCENE_SCHEMA` ile reddedilir ve kısmi scene oluşturma hatasında yaratılmış handle’lar rollback edilir.

`exi_api.resources` canonical MCP resource URI eşlemesini, `exi_api.callRoutes` ise API şekline göre kullanılacak tool route’unu verir. Örneğin constructor için `callRoutes.constructor`, instance method için `callRoutes.instanceMethod`, nested export function için `callRoutes.nestedExport`, static değer için `callRoutes.staticValue` kullanılır. Ajanlar bu iki alanı okuyarak tool adı veya resource URI tahmin etmeden ilerlemelidir.

Browser runtime’da `exi_preview_call({ previewId, operation: "observe", args: [{ columns, rows }] })` veya aynı operation’ı `exi_preview_batch` içinde kullan. Scaffold/demo `createEngineObserver(engine)` bağladığı için sonuç WebGL2/WebGPU offscreen readback’inden gelen bounded `canvas-grid` nesnesidir: ASCII `grid`, `hash`, `changed`, `previousHash`, `nonEmpty` ve `averageLuma` alanlarını karşılaştır. Bu, screenshot veya arbitrary DOM/state erişimi değildir; amaç text-only AI CLI’ın gerçek GPU frame’inde hızlı görsel regresyon kontrolü yapmasıdır. Özel sayfalar için `createCanvasObserver(canvas)` fallback’i vardır, ancak swapchain readback taşınabilir olmadığından engine observer tercih edilir.

Sahne yapısını anlamak için `exi_preview_call({ previewId, operation: "snapshot", handle: "scene", args: [{ limit: 64 }] })` kullan. `snapshot`, yalnızca doğrudan veri alanlarını okuyarak node’ları pre-order listeler; getter/callback/eval çalıştırmaz. Sonuç 64 node/page, 4.096 ziyaret ve 32 derinlik ile bounded’dir; `offset`/`limit`, `nextOffset`, `truncated`, `hash`, `changed` ve node parent/handle/transform/state alanları AI’ye deterministic scene perception sağlar. Snapshot handle’ları sonraki `exi_preview_call`/`exi_preview_batch` `call/get/set` operasyonlarında kullanılabilir; geçici handle’ları iş bitince release et.

Browser test/replay akışında `engine` root’tan `input` handle’ını al, `engine.stop()` çağır, ardından `Input.inject([{ type: "keydown", code: "ArrowRight" }])` ve `engine.step(1 / 60)` gibi bounded public yöntemlerle simülasyonu ilerlet. `Input.inject` en fazla 128 event alır; sonuçları `snapshot` ve `observe` ile karşılaştır. Bu, OS input’u değil sayfanın kendi Input state’ine kontrollü bir test beslemesidir.

Tekrarlanabilir kısa testleri daha az round-trip ile çalıştırmak için `exi_preview_call({ previewId, operation: "scenario", handle: "engine", args: [{ frames: [{ input: [{ type: "keydown", code: "ArrowRight" }], observe: { columns: 8, rows: 4 }, snapshot: true }, { input: [{ type: "keyup", code: "ArrowRight" }] }] }] })` kullan. `scenario` en fazla 16 frame/512 toplam event alır; her frame fixed-step ile ilerler, isteğe bağlı observe/snapshot sonucu döner ve başlangıçta çalışan engine’i varsayılan olarak geri başlatır. Bu operation yalnızca sabit engine lifecycle + Input yollarını çağırır; generic method dispatch yerine AI test akışı için daraltılmış güvenli bir workflow’dur.

`prompts/get` için `arguments` object olmalıdır; prompt’a tanımlanmamış alanlar `EXI_MCP_ARGUMENT_UNKNOWN`, object olmayan prompt argümanları `EXI_MCP_PROMPT_ARGS_TYPE`, yanlış `goal`/`path` tipi `EXI_MCP_ARGUMENT_TYPE` ile reddedilir. JSON-RPC prompt/resource hatalarında canonical code ayrıca `error.data.code` alanında taşınır.

## Client setup

Run these commands from the repo root when the CLI supports MCP management commands:

```powershell
codex mcp add exi-engine -- node tools/exi-mcp-server.mjs
claude mcp add --transport stdio exi-engine -- node tools/exi-mcp-server.mjs
opencode mcp add
gemini mcp add exi-engine node tools/exi-mcp-server.mjs
```

For Codex project/user TOML:

```toml
[mcp_servers.exi-engine]
command = "node"
args = ["tools/exi-mcp-server.mjs"]
cwd = "."
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 360
default_tools_approval_mode = "writes"
```

`default_tools_approval_mode = "writes"`, Codex’in read-only araçları akışta kullanmasına izin verirken dosya/asset/engine mutasyonu yapan araçlarda onay istemesini sağlar. `startup_timeout_sec`, `tool_timeout_sec`, `command`, `args`, `cwd` ve project-scoped `.codex/config.toml` kullanımı resmi Codex MCP yapılandırma sözleşmesiyle uyumludur; proje ayarının Codex tarafından yüklenmesi için proje güvenilir olmalıdır ([resmi Codex MCP dokümantasyonu](https://developers.openai.com/codex/mcp/)).

Bridge’in `exi_check` üst sınırı `doctor=60s`, `test=180s`, `verify=300s` olduğu için Codex/Gemini/OpenCode örneklerinde 360 saniyelik istemci timeout’u kullanılır; bu gecikme hedefi değil, bounded üst sınırdır.

Güncel MCP istemcileri önce modern discovery yapabilir:

```json
{"jsonrpc":"2.0","id":"discover-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"my-agent","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
```

Sonraki her modern istekte aynı protokol sürümü ve `clientCapabilities` alanları `params._meta` altında taşınır; `clientInfo` isteğe bağlıdır. Modern yanıtlar `resultType: "complete"` ve server identity `_meta` alanı taşır. Modern istemci discovery kullanamıyorsa veya legacy akış istiyorsa aşağıdaki `initialize` akışı çalışmaya devam eder.

For Claude Code project scope (`.mcp.json`), use Claude's stable project-root placeholder:

```json
{
  "mcpServers": {
    "exi-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR:-.}/tools/exi-mcp-server.mjs"],
      "env": { "EXI_MCP_ROOT": "${CLAUDE_PROJECT_DIR:-.}" },
      "timeout": 360000
    }
  }
}
```

For Gemini CLI project scope (`.gemini/settings.json`), use Gemini's `mcpServers` shape; `type` is not needed for a stdio command:

```json
{
  "mcpServers": {
    "exi-engine": {
      "command": "node",
      "args": ["tools/exi-mcp-server.mjs"],
      "cwd": ".",
      "env": { "EXI_MCP_ROOT": "." },
      "timeout": 360000
    }
  }
}
```

Gemini CLI eşdeğer yönetim komutu: `gemini mcp add exi-engine node tools/exi-mcp-server.mjs`. Güncel OpenCode CLI yönetim komutu `opencode mcp add` ile etkileşimli local server ekler; repo içindeki `opencode.json` aynı ayarı doğrudan ve tekrarlanabilir biçimde taşır.

Generic stdio MCP istemcileri için eşdeğer şekil:

```json
{
  "mcpServers": {
    "exi-engine": {
      "command": "node",
      "args": ["tools/exi-mcp-server.mjs"],
      "cwd": ".",
      "env": { "EXI_MCP_ROOT": "." }
    }
  }
}
```

İstemci yalnızca `command`/`args` kabul ediyorsa `cwd` yerine repo kökünden başlatın; farklı bir çalışma dizininden başlatıyorsa `EXI_MCP_ROOT` için repo kökünün absolute yolunu verin. Bu şekil, istemci adından bağımsız stdio JSON-RPC sözleşmesidir.

Cursor CLI için proje dosyası `.cursor/mcp.json`, Cline CLI için proje dosyası `.cline/mcp.json` olarak hazır gelir. İkisi de aynı minimal şekli kullanır:

```json
{
  "mcpServers": {
    "exi-engine": {
      "command": "node",
      "args": ["tools/exi-mcp-server.mjs"],
      "env": { "EXI_MCP_ROOT": "." }
    }
  }
}
```

Cursor CLI proje içindeki `.cursor/mcp.json` dosyasını, Cline CLI proje kökündeki `.cline/mcp.json` dosyasını kullanır. Windsurf/Cascade için resmi kullanıcı dosyası `~/.codeium/windsurf/mcp_config.json` veya kurulumun gösterdiği `mcp_config.json` dosyasıdır; içine aynı `mcpServers.exi-engine` kaydını koyun. Windsurf kullanıcı dosyası repo dışında olduğundan `EXI_MCP_ROOT` değerini repo kökünün absolute yolu yapın:

```json
{
  "mcpServers": {
    "exi-engine": {
      "command": "node",
      "args": ["D:/github/ExiEngine/tools/exi-mcp-server.mjs"],
      "env": { "EXI_MCP_ROOT": "D:/github/ExiEngine" }
    }
  }
}
```

Windows path’lerini kendi repo yolunuzla değiştirin. Üç istemcide de transport komutu doğrudan `node tools/exi-mcp-server.mjs` olmalı; `npm run mcp` stdout framing’ini bozabilir.

For OpenCode project configuration:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "exi-engine": {
        "type": "local",
        "command": ["node", "tools/exi-mcp-server.mjs"],
        "cwd": ".",
        "codemode": false,
        "timeout": 360000
      }
    }
  }
}
```

Bu yedi yapılandırma yolu repo içinde hazır veya belgeli gelir: Codex için `.codex/config.toml`, Claude Code için `.mcp.json`, Gemini CLI için `.gemini/settings.json`, OpenCode için `opencode.json`, Cursor CLI için `.cursor/mcp.json`, Cline CLI için `.cline/mcp.json` ve Windsurf için kullanıcı seviyesindeki `~/.codeium/windsurf/mcp_config.json`. İlgili CLI proje kökünde başlatıldığında `exi-engine` stdio sunucusunu keşfedebilir. Bunlar yalnızca yerel `node tools/exi-mcp-server.mjs` sürecini başlatır; kullanmadan önce kendi istemcinizin proje-config politikasını kontrol edin. Yapılandırmaların köprü sözleşmesiyle aynı kaldığı `npm run test:clients` ile, kurulu host CLI’ın kendi list yolunun `exi-engine` gördüğü ise `npm run test:clients:native` ile doğrulanır.

Güncel istemci referansları: [Codex MCP](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [OpenCode MCP](https://opencode.ai/v2/docs/mcp-servers), [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md), [Cursor MCP](https://docs.cursor.com/context/model-context-protocol), [Cline CLI reference](https://docs.cline.bot/cli/cli-reference) ve [Windsurf Cascade MCP](https://docs.windsurf.com/windsurf/cascade/mcp). CLI sürümleri kurulum komutlarını değiştirebildiği için config dosyası şekli ve stdio handshake asıl sözleşmedir.

### Callback isteyen engine API’leri

Browser RuntimeAgent callback gövdelerini almaz ve çalıştırmak için `eval` kullanmaz. Scaffold edilen `game.js` içindeki `runtimeCallbacks` nesnesine review edilmiş callback’i kaydet; browser `inspect` sonucundaki `callbacks` listesinden adı okuyup `exi_preview_call`/`exi_preview_batch` argümanında `{"$callback":"name"}` referansı kullan. İsim çözümlemesi sayfa içindeki registry ile sınırlıdır (en fazla 256 callback, isim başına 256 karakter); bilinmeyen referans kontrollü hata döndürür. Bu yol `Node.traverse`/`find`, `Scene.pick` ve callback/predicate kabul eden browser API’lerini destekler. Direct MCP engine araçları JSON-only kalır; callback gövdesi dosya araçlarıyla projeye yazılmalı, sonra `exi_project_check` ile statik kontrol edilmelidir.

Örnek sıra: `exi_preview_call({ previewId, operation: "inspect", handle: "scene" })` sonucundaki `callbacks` alanını oku; ardından `exi_preview_call({ previewId, operation: "call", handle: "scene", method: "traverse", args: [{ "$callback": "visit" }] })` gönder. `traverse` dönüşü `null` olabilir; callback’in oyun state’ine yaptığı bounded etkileri ikinci `inspect`/`exi_preview_probe` veya browser DOM üzerinden doğrula. Browser agent yoksa bu akış static-only olarak raporlanmalıdır.

### Gerçek browser asset zinciri

Asset dosyası MCP ile projeye yazıldıktan sonra texture decode işlemi process-side Node’da değil, `exi_preview_call` ile gerçek browser RuntimeAgent içinde yapılmalıdır. `exi_preview_start` sonucundaki `url` değerini `AssetLoader` constructor’ına `baseURL` olarak ver; dönen handle’ları sonraki çağrılarda taşı:

```json
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"create","type":"AssetLoader","args":[{"baseURL":"http://127.0.0.1:64603/"}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"call","handle":"h1","method":"loadTexture","args":["/assets/player.svg",{"mimeType":"image/svg+xml"}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"static_call","type":"TextureAtlas","method":"fromGrid","args":[{"$handle":"h2"},{"frameWidth":32,"frameHeight":32,"columns":2,"rows":2}]}}
{"name":"exi_preview_batch","arguments":{"previewId":"p1","calls":[{"operation":"call","handle":"h3","method":"get","args":["0"]},{"operation":"create","type":"Sprite","args":[{"texture":{"$result":0},"width":96,"height":96}]}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"call","handle":"scene","method":"add","args":[{"$handle":"h4"}]}}
```

Bu örnekteki `h1`–`h4` değerleri açıklama amaçlıdır; gerçek sonuçlardaki `$handle` değerlerini kullan. `loadTexture`/`loadAtlas` CanvasImageSource gerektirdiği için Node-side `exi_call` yalnızca bytes/JSON gibi browser bağımsız asset işlemleri için kullanılabilir. Gerçek kanıt sırası: browser DOM’da `data-ready="true"`, `data-status="running"`, backend ve pozitif FPS; ardından `exi_preview_probe({"path":"/__exi/runtime"})`; son olarak browser console warning/error listesinin boş olmasıdır. Sentetik telemetry bu zincirin yerine geçmez.

## Verification levels

`npm run test:clients` altı repo config’inin beklenen komutu taşıdığını ve her config’in ürettiği gerçek stdio bridge süreciyle `initialize` → `tools/list` → `exi_function` akışını çalıştırabildiğini doğrular; aynı çıktı host’ta `codex`/`claude`/`opencode`/`gemini`/`cursor-agent`/`cline` executable keşif durumunu da raporlar. Windsurf kullanıcı dosyası repo dışında olduğu için onun shape’i `exi://clients` ve doküman örneğiyle doğrulanır. `npm run test:clients:native` kurulu istemcilerde sırasıyla `cursor-agent mcp list`, `codex mcp list`, `claude mcp list`, `opencode mcp list` ve `gemini mcp list` komutlarını repo kökünde read-only ve 5 saniyelik sınırla çalıştırır; `exi-engine` çıktıda yoksa başarısız raporlar, kurulu olmayanları atlar. WindowsApps gibi host executable’ı `EPERM`/`EACCES` ile başlatılamayan ortamlar `unavailable` olarak raporlanır; bu bridge handshake başarısızlığı değildir ve native probe’u tek başına kırmızıya çevirmez. Cline için resmi CLI yalnızca `cline mcp` yönetim komutunu garanti ettiği için native probe varsayımsal bir `list` alt komutu çalıştırmaz. `npm run test:mcp` ise modern ve legacy JSON-RPC akışında discovery, metadata, public function, scaffold, file write, project check, progress, preview/probe ve cleanup’ı doğrular. Bunlar host CLI’nin kendi iç cancellation/UI davranışını veya browser GPU’yu kanıtlamaz. Gerçek host kanıtı için ilgili CLI’nin projeyi açıp `exi://api` okuduğu, `exi_scaffold`/`exi_project_check` çağırdığı ve preview’ı probe ettiği ayrıca kaydedilmelidir; browser/GPU kanıtı da `exi://runtime` sözleşmesine göre ayrı raporlanır.

On Windows, use the repository as the client working directory. If the client cannot set `cwd`, replace the relative script argument with the absolute path to `tools/exi-mcp-server.mjs` and set `EXI_MCP_ROOT` to the repository path. Claude Code ayrıca `CLAUDE_PROJECT_DIR` ile kökü otomatik aktarabilir; bridge bunu fallback olarak kabul eder.

## Recommended agent flow

1. Call `exi_api` and use its manifest instead of guessing method names.
2. Create a `Scene`/`Node` graph with `exi_build_scene` or `exi_create`.
3. Keep returned `$handle` values; pass them back as `{ "$handle": "h1" }`.
4. Use `exi_inspect` before `exi_call`/`exi_get`/`exi_set` when the handle surface is unknown; it reads metadata without invoking getters. Release temporary objects with `exi_release` when finished.
5. Use `exi_scaffold` for a new safe minimal game folder, or `exi_project_open` to adopt an existing repo-local game folder after static checks; then edit the project files.
6. If the client has no native file editor, use `exi_file_list` to discover, `exi_project_apply` for a new multi-file text change, and `exi_file_read`/`exi_file_write` for small individual files; use `exi_file_patch` for a known unique text change (one `find` match is required and zero/multiple matches leave the file unchanged); use `exi_file_begin` → `exi_file_chunk` → `exi_file_commit` for larger source files and `exi_file_abort` for incomplete transfers. Use `exi_asset_list`/`exi_asset_write` for assets up to 512 KiB and `exi_asset_begin` → `exi_asset_chunk` → `exi_asset_commit` for larger assets. Abort incomplete asset transfers with `exi_asset_abort`.
7. After edits, use `exi_project_status({ path: "ai-game" })` when the agent needs one bounded project map: text files, asset metadata, static check and matching preview telemetry are returned together. A missing browser report remains `runtime.ok=false`/`telemetry:null`; this is not GPU evidence. Then run `exi_project_preview({ path: "ai-game" })` for the normal one-call static-check → `/index.html` preview flow; it returns `ok:false` and no preview when a checkable source fails, or `ok:true` with nested `preview.previewId/pageUrl` when the target page is ready. Use `exi_project_check` separately when you only need diagnostics, and `exi_file_check` when iterating on one file. `exi_scaffold` starter dosyalarını staged multi-file commit ile yazar; commit yarıda kalırsa rollback/restore uygular.
8. Use `exi_preview_start({ path: "/ai-game/index.html" })`, then `exi_preview_call`, `exi_preview_batch`, `exi_preview_probe` and `exi_preview_stop` to run, control and inspect the selected game page without inventing a shell command. `exi_preview_start` returns both the server `url` and target `pageUrl`; target page HTTP 200 olmadan hazır dönmez. `exi_preview_call` demo veya scaffold RuntimeAgent’ın public engine allowlist’ine gider; `exi_preview_batch` en fazla 8 sıralı browser operation’ını tek round-trip’te çalıştırır, `$result` ve güvenli `$path` referanslarını destekler, `stopOnError:false` ile kalan çağrılara devam edebilir ama transaction değildir. Browser agent yoksa 10 saniyelik bounded timeout sonrası command temizlenir. Preview startup has a bounded 10-second readiness window; a failed start is cleaned up automatically.
9. Or request `prompts/get` for `exi_create_game` or `exi_verify_runtime` to load the canonical workflow.
10. If the client has browser control, read `exi://runtime`, open the preview page, then inspect `#exi-runtime` after load and after each WebGL2/WebGPU selection. After the real page has posted its report, call `exi_preview_probe` with `path: "/__exi/runtime"` and compare the bounded server telemetry; a synthetic POST is not browser/GPU evidence.
11. Finish with `exi_check({"mode":"doctor"})`, `exi_check({"mode":"test"})` and, before release, `exi_check({"mode":"verify"})`. Uzun check/preview çağrısını bırakman gerekirse aynı id ile `notifications/cancelled` gönder; bridge response üretmez, check child process ağacını temizler ve iptal edilen preview başlangıcını kapatır.

For many small engine operations, prefer one `exi_batch` call with at most 128 entries. Use `{"$result":0}` to reference a previous result without guessing a handle ID; use `{"$result":0,"$path":"fileUploadId"}` to select a safe field from a previous result (for example, to begin/chunk/commit a file in one batch). It is sequential but not transactional; release handles and abort uploads even when a later entry fails.

Binary asset için `exi_asset_list` ve `exi_asset_write` kullanılır. Bu araçlar aynı session’da scaffold edilen veya `exi_project_open` ile açılan proje scope’larında yalnızca allowlisted image/audio/font/KTX2 uzantılarına izin verir; `$bytes` array veya base64 payload’ı 512 KiB ile, listeleme 1.024 asset/32 klasör derinliği ile sınırlıdır. Binary tool executable, secret, traversal veya symlink yazamaz; mevcut asset’i değiştirmek için `overwrite: true` gerekir.

Küçük mevcut asset byte’larını `exi_asset_read` ile `offset`/`limit` sayfalayarak okuyup gerekirse `exi_function({ name: "inspectKTX2", args: [{ "$bytes": "..." }] })` ile inceleyebilirsin. 512 KiB üzeri asset’lerde `exi_asset_begin` beklenen toplam byte sayısını alır. Her `exi_asset_chunk` çağrısı bir önceki `receivedBytes` offset’iyle sıralı olmalı; son parça geldikten sonra `exi_asset_commit` geçici dosyayı hedefe taşır. `exi_asset_abort`, `exi_session_reset` veya MCP process kapanışı geçici upload’ı temizler. Chunked upload tek asset için 64 MiB, bekleyen toplam için 64 MiB ve 8 aktif transfer ile sınırlıdır.

Yeni proje için `exi_scaffold`, mevcut proje için `exi_project_open` çağrısından sonra `exi_project_check({"path":"ai-game"})` `.html` referanslarını, `.js`/`.mjs` syntax’ını ve `.json` bütçesini tek akışta doğrular. En fazla 128 checkable dosya taranır ve 32 hata özeti döndürülür; bu kontrol HTTP veya gerçek GPU/browser çalışmasının yerine geçmez.

`exi_project_status({"path":"ai-game"})` aynı scope’ta `files[]`, `assets[]`, `projectCheck` ve eşleşen `previews[]` sonuçlarını tek response’ta toplar. `exi_project_preview` ile başlatılan preview’ın yanında, `exi_preview_start({ path: "/ai-game/index.html" })` gibi doğrudan başlatılan preview da path session scope’u içindeyse eşlenir. `previews[].runtime` yalnızca MCP’nin daha önce başlattığı preview’a ait bounded `/__exi/runtime` GET raporudur; browser telemetry yoksa bunu static-only olarak raporla.

`exi_session_status({})` aynı MCP process’inin handle, protected handle, scaffold/open scope, tamamlanmamış text/binary upload ve preview metadata’sını getter çalıştırmadan tek bounded response’ta verir. Token ve temp path açılmadığı için reconnect sonrası stale id veya unutulmuş upload teşhisi yapılabilir; `exi_session_reset` sonrasında tüm listeler boş olmalıdır.

`exi_file_begin`/`exi_file_chunk`/`exi_file_commit` yalnızca scaffold veya `exi_project_open` ile açılmış proje scope’undaki text dosyalarına yazar; tek dosya 4 MiB, bekleyen toplam 16 MiB ve aktif transfer 8 ile sınırlıdır. Her chunk UTF-8 string olarak en fazla 48 KiB ve offset sıralı olmalıdır; commit öncesi geçici dosya boyutu tekrar doğrulanır. `exi_session_reset` handle’ların yanında bekleyen upload’ları ve aynı session’ın preview child process’lerini de temizler. `tools/list` annotations tell clients which tools are read-only or destructive; they are advisory hints, not the security boundary. `exi_scaffold` ve `exi_project_open` never write outside the workspace root, reject symlinked path/file entries, and protect engine/test/tool roots. Preview binds only to `127.0.0.1`, shutdown signals clean up preview children, and `exi_check` does not accept arbitrary shell commands. Each MCP-started preview receives a random per-preview token; the page fetches it locally and posts a whitelisted, 4 KiB-bounded runtime report to `/__exi/runtime`. The same token protects `/__exi/runtime-command` and `/__exi/runtime-result`; `RuntimeAgent` consumes only the bounded allowlisted engine operations exposed by `exi_preview_call`/`exi_preview_batch`, with at most 8 calls per batch. The MCP server injects the token only for its own preview requests; it is not returned by `exi_preview_start`. The bridge is a local tool boundary, not a sandbox or an authentication system; keep MCP server access limited to trusted agents.
### Optimistic file versions

`exi_file_read`/`exi_file_list` ve `exi_asset_read`/`exi_asset_list` sonuçlarındaki `version` alanı `{ bytes, mtimeMs }` içerir. Mevcut text veya asset overwrite’ında bu nesneyi `expectedVersion` olarak `exi_file_write`, `exi_file_begin`, `exi_asset_write`, `exi_asset_begin` ya da `exi_project_apply` çağrısına taşı. Dosya okuma sonrasında değişmişse bridge `EXI_MCP_FILE_CONFLICT` döndürür; chunk upload commit’i de hedefi tekrar kontrol eder. Bu optimistic guard kilit değildir: son kontrol ile filesystem rename arasında dış yarış penceresi kalabilir.
### Upload bütünlüğü

`exi_file_write`/`exi_file_begin` ve `exi_asset_write`/`exi_asset_begin` için `expectedSha256` alanı isteğe bağlıdır. AI CLI büyük source veya asset byte’larını kendi tarafında SHA-256 ile hesaplayıp gönderirse bridge hash’i direct write ya da chunk commit öncesi doğrular; eşleşmezse `EXI_MCP_UPLOAD_INTEGRITY` döner ve hedefe rename yapılmaz. Başarılı direct write/commit sonuçları `sha256` alanını taşır. Mevcut hedefi yarıştan korumak için bunu `expectedVersion` ile birlikte kullan.
