# ExiEngine — Release roadmap

Sources: [PRD](docs/internal/PRD.md) (scope) and [web 2D gap analysis](docs/internal/ENGINE_GAP_ANALYSIS.md) (gaps).
Milestones are sequential; each one has its own acceptance criteria.

| Order | Milestone | Scope | Acceptance criteria |
| --- | --- | --- | --- |
| 0 | **MVP** ✅ | Zero-dependency 2D WebGL2/WebGPU core; scene graph (Scene/Node/Sprite/Graphics/Text/Container), camera, input, animation; reflection-manifest MCP bridge (`exi_api`, `exi_scaffold`, `exi_build_scene`, `exi_preview_*`) | `npm run doctor`; `npm test`; agent generates/runs/verifies end to end over MCP |
| 1 | **v0.2** ✅ | Hardening: bounded 2D physics/collision, deterministic fixed-step ordering + A*, asset pipeline (Texture/atlas/loader/save/KTX2), security/lifecycle bounds, benchmark + verify gate | `npm run verify`; determinism snapshot; `npm run test:static` (no API drift) |
| 2 | **v0.3** ✅ (implemented on this branch, not yet released; package.json is still 0.2.0) | Content and authoring basics: npm-ready package + dist bundles, Tiled import, examples, JSON scene serialization, first browser editor, rotating rigid bodies, post-process filters, BitmapText, audio sprites + 2D spatial audio, English error messages | `npm test` (incl. build + examples stages); `npm run test:e2e:examples` in Chromium |
| 3 | **v1.0** | Publish to npm; editor v2 (play-in-editor, hot reload, prefabs); joints + CCD; Spine adapter; custom-filter policy; lighting; GPU profiling; mobile real-device matrix; more examples/tutorials | Editor round-trip snapshot equality; hot reload in a running example; mobile device `exi://runtime` telemetry |

## Out of scope (for this roadmap)

- 3D rendering — 2D-first core; a long-term goal.
- Console distribution and native desktop/mobile binaries.
- C# scripting.
