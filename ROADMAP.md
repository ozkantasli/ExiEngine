# ExiEngine — Release roadmap

Sources: `PRD.md` (scope), `ENGINE_GAP_ANALYSIS.md` (gaps), Kanban board
**"ExiEngine Roadmap"** (canonical tracking surface). Milestones are sequential; each one
lives on the board with its acceptance criteria.

| Order | Milestone | Scope | Acceptance criteria (board checks) |
| --- | --- | --- | --- |
| 0 | **MVP** | Zero-dependency 2D WebGL2/WebGPU core; scene graph (Scene/Node/Sprite/Graphics/Text/Container), camera, input, animation; reflection-manifest MCP bridge (`exi_api`, `exi_scaffold`, `exi_build_scene`, `exi_preview_*`) | `npm run doctor`; `npm test`; agent generates/runs/verifies end to end over MCP |
| 1 | **v0.2** | Hardening: bounded 2D physics/collision, deterministic fixed-step ordering + A*, asset pipeline (Texture/atlas/loader/save/KTX2), security/lifecycle bounds, benchmark + verify gate | `npm run verify`; determinism snapshot; `npm run test:static` (no API drift) |
| 2 | **v1.0** | Full release: built-in Web Audio, in-browser visual editor + scene serialization round-trip, hot reload, frame-graph/GPU profiling, asset determinism, onboarding docs + examples, mobile-web real-device matrix | Audio/`exi://types` manifest; editor round-trip snapshot equality; mobile device `exi://runtime` telemetry |

## Out of scope (for this roadmap)

- 3D rendering (gap #3) — 2D-first core; a long-term goal.
- Console distribution (gap #10) and native desktop/mobile binaries.
- C# scripting ecosystem (gap #9).

## Tracking

Kanban board: **ExiEngine Roadmap** (`6b2264d3-999d-4b4f-a7c6-0de7fcb25f61`).
MVP and v0.2 reflect the core covered by the current `0.2.0` package; v1.0 is the
forward-looking plan. Acceptance criteria of type `command` can be machine-verified with
`verify_completion`; those of type `manual` require human/agent verification.
