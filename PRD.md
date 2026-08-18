# ExiEngine — Ürün Gereksinim Dokümanı (PRD)

Sürüm: 0.2.0 hizalı · Kaynaklar: `AI_ENGINE_GUIDE.md` (canonical sözleşme),
`ENGINE_FEATURE_MATRIX.md`, `ENGINE_GAP_ANALYSIS.md`. Bu doküman "nereye gidiyoruz"
sorusunu, boşluk analizindeki P0/P1 sinyallerini ve mevcut çekirdeğin gerçek durumunu
birleştirerek yanıtlar. Durum sütunu **gemi** (v0.2.0'da var) / **plan** (MVP kapsamı)
/ **kapsam dışı** olarak işaretlenir.

## 1. Ürün özeti

ExiEngine, **sıfır runtime bağımlılıklı, web-öncelikli bir 2D oyun motoru çekirdeğidir**.
Tek farkı grafik değil; bir AI coding agent'ının motoru doğrudan keşfedip sürebileceği
yansımalı (reflection-manifest) bir API + MCP köprüsü sunmasıdır. Rakipler (Godot, PixiJS,
Bevy, Babylon, melonJS) arasında bu ajan-öncelikli yüzey **hiçbirinde yok** (gap #12) ve
ExiEngine'in tanımlayıcı farklılaştırıcısıdır.

## 2. Hedef platformlar

| Platform | Durum | Not |
| --- | --- | --- |
| Modern tarayıcılar (Chrome, Edge, Firefox, Safari) | **gemi** | WebGL2 + WebGPU çift backend |
| WebGPU (yeni cihazlar) | **gemi** | compute culling dahil |
| WebGL2 (geniş destek) | **gemi** | fallback yol |
| Node.js | **gemi** (yalnızca dev/test/MCP) | runtime'da gerekli değil |
| Mobil web (Android/iOS tarayıcı) | **plan** | gerçek cihaz matrisi açık |
| Masaüstü native (Electron/Tauri webview) | **plan** | webview üzerinden, native binary değil |
| Konsol dağıtımı | **kapsam dışı** | lisans kapısı; bkz. gap #10 |

## 3. Hedef kitle

1. **Birincil — AI coding agent'ları:** Codex, Claude Code, OpenCode, Gemini CLI, Cursor,
   Cline, Windsurf ve benzeri MCP istemcileri. Standart JSON-RPC stdio bridge üzerinden
   `exi_*` araçlarıyla oyun keşfetme, üretme, çalıştırma ve doğrulama.
2. **İkincil — JS/TS web oyun geliştiricileri:** `import { ExiEngine, Scene, Sprite }`
   ile bağımlılıksız, deterministik bir 2D çekirdek isteyenler.
3. **Üçüncül — hobi/öğrenme kullanıcıları:** tarayıcıda hızlı oyun/prototip üretenler.

## 4. Temel farklılaştırıcılar

1. **Ajan/LLM-öncelikli API yüzeyi** — reflection manifest (`exi_api`), limit/workflow
   sözleşmesi, MCP `resources`/`prompts`/`tools`, `exi_scaffold`/`exi_build_scene`/
   `exi_preview_*` döngüsü. Matriste rakipsiz.
2. **Sıfır runtime bağımlılık** — çekirdek WebGL2/WebGPU backend'lerini kendisi yönetir;
   başka motor import edilmez.
3. **Deterministik, bounded çekirdek** — fixed-step sıralama (`scene → animator → physics →
   onUpdate`), allocation-free traversal, boyut/derinlik/limit sınırları, deterministik A*.
4. **Web-öncelikli çift backend** — WebGPU compute/indirect culling + WebGL2 CPU fallback.
5. **Güvenlik/yaşam döngüsü sınırları** — `eval`/`new Function`/uzaktan kod yok; traversal,
   symlink, sınırsız JSON/scene/handle büyümesi, stdout kirliliği reddedilir; iptal + cleanup.

## 5. Minimal uygulanabilir özellik seti (MVP)

### 5.1 Zaten gemi (v0.2.0) — korunacak

- 2D sahne grafiği: `Scene`, `Node`, `Sprite`, `Graphics`, `Text`, `Container`.
- Kamera, input (klavye/fare/pointer), animasyon (`AnimatedSprite`, `Animator`/`Tween`).
- 2D fizik/çarpışma (bounded), `findGridPath` deterministik A*.
- `TileMap`, `SpriteBatch`, `ParticleEmitter`, `RenderTexture`, hafif efekt zinciri.
- Varlıklar: `Texture`, atlas, `AssetLoader`, kaydetme, KTX2 sınırları.
- MCP köprüsü, preview/RuntimeAgent, `doctor`/`test`/`verify`, benchmark süiti.

### 5.2 Plan (MVP kapsamı) — boşluklardan türetilmiş

| Özellik | Kaynak gap | Öncelik | Kabul kriteri |
| --- | --- | --- | --- |
| Yerleşik ses/audio backend'i (Web Audio) | matris: hafif motorlarda "—" | P0 | `Audio`/`Sound` API; `exi://types` manifest'e girer; `npm test` geçer |
| Deterministlik sözleşmesi (fixed-step + platformlar arası) | gap #11 | P0 | aynı input + aynı delta → aynı snapshot hash'i; test ile kilitli |
| Varlık pipeline determinizmi (import/save round-trip) | gap #6 | P1 | asset save/load byte kararlılığı; test ile kilitli |
| Hot-reload / canlı düzenleme (asset sahne yenileme) | gap #5 | P1 | değişen asset'in restart olmadan yansıması; preview ile doğrulanır |
| Frame-graf / GPU zamanlama / bellek izleme | gap #8 | P1 | `engine.getInfo()` + profiling raporu; benchmark kapısı |
| Doküman + çalışan örnek + onboarding | gap #7 | P1 | `AI_ENGINE_GUIDE.md` + API.md + çalışır örnek proje |
| Tarayıcı-içi görsel editör (aynı dil) | gap #1 | P1 | sahne düzenleme + scene serialization round-trip |
| Mobil web gerçek cihaz matrisi | gap #4 (web kapsamı) | P2 | fiziksel cihaz smoke + telemetry |

### 5.3 Kapsam dışı (bu MVP'de değil)

- **3D render** — ExiEngine 2D-öncelikli bir çekirdektir; birleşik 2D+3D (gap #3) uzun
  vadeli hedeftir, MVP'de değil.
- **Konsol dağıtımı** (gap #10) ve native masaüstü/mobil binary.
- **C# script** (gap #9) — ajan erişimi ve JS/TS dışındaki script ekosistemleri bu fazın
  dışındadır.

## 6. Başarı kriterleri

1. `npm run doctor` ve `npm test` temiz; `npm run verify` release gate'i geçer.
2. Bir AI agent, MCP bridge üzerinden bir oyunu **sıfır runtime bağımlılıkla** uçtan uca
   üretebilir, çalıştırabilir ve `exi://runtime` kanıtıyla doğrulayabilir.
3. 60fps benchmark kapıları (`bench:*`) ve determinizm snapshot testi yeşil.
4. `index.d.ts` ile `src/index.js` arasında public API drift'i yok (static smoke).

## 7. Sıradaki kararlar (açık)

- 3D render'ın ne zaman/ne şekilde gireceği (gap #3) — bu PRD'de kapsam dışı tutuldu.
- Konsol/mobil native dağıtımının iş modeli (gap #10) — kullanıcı tabanı verisine bağlı.
