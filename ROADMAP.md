# ExiEngine — Sürüm yol haritası

Kaynaklar: `PRD.md` (kapsam), `ENGINE_GAP_ANALYSIS.md` (boşluklar), Kanban board
**"ExiEngine Roadmap"** (canonical takip yüzeyi). Milestones sıralıdır; her biri
kabul kriterleriyle board'da durur.

| Sıra | Milestone | Kapsam | Kabul kriterleri (board checks) |
| --- | --- | --- | --- |
| 0 | **MVP** | Sıfır-bağımlılıklı 2D WebGL2/WebGPU çekirdek; sahne grafiği (Scene/Node/Sprite/Graphics/Text/Container), kamera, input, animasyon; reflection-manifest MCP köprüsü (`exi_api`, `exi_scaffold`, `exi_build_scene`, `exi_preview_*`) | `npm run doctor`; `npm test`; ajan MCP ile uçtan uca üret/çalıştır/doğrula |
| 1 | **v0.2** | Sertleştirme: bounded 2D fizik/çarpışma, deterministik fixed-step sıralama + A*, asset pipeline (Texture/atlas/loader/save/KTX2), güvenlik/yaşam döngüsü sınırları, benchmark + verify kapısı | `npm run verify`; determinizm snapshot; `npm run test:static` (API drift'i yok) |
| 2 | **v1.0** | Tam sürüm: yerleşik Web Audio, tarayıcı görsel editörü + scene serialization round-trip, hot-reload, frame-graf/GPU profiling, asset determinizmi, onboarding doküman + örnek, mobil-web gerçek cihaz matrisi | Audio/`exi://types` manifest; editör round-trip snapshot eşitliği; mobil cihaz `exi://runtime` telemetrisi |

## Kapsam dışı (bu yol haritasında)

- 3D render (gap #3) — 2D-öncelikli çekirdek; uzun vadeli hedef.
- Konsol dağıtımı (gap #10) ve native masaüstü/mobil binary.
- C# script ekosistemi (gap #9).

## Takip

Kanban board: **ExiEngine Roadmap** (`6b2264d3-999d-4b4f-a7c6-0de7fcb25f61`).
MVP ve v0.2, mevcut `0.2.0` paketinin kapsadığı çekirdeği yansıtır; v1.0 ileriye dönük
plandır. Kabul kriterlerinin `command` tipi olanları `verify_completion` ile makine
tarafından doğrulanabilir; `manual` olanlar insan/ajan doğrulaması gerektirir.
