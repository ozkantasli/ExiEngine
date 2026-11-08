# ExiEngine — Product Requirements Document (PRD)

Version: aligned with 0.2.0 · Sources: `AI_ENGINE_GUIDE.md` (canonical contract),
`ENGINE_FEATURE_MATRIX.md`, `ENGINE_GAP_ANALYSIS.md`. This document answers "where are we
going" by combining the P0/P1 signals from the gap analysis with the actual state of the
current core. The status column is marked **shipped** (present in v0.2.0) / **planned**
(MVP scope) / **out of scope**.

## 1. Product summary

ExiEngine is a **web-first 2D game engine core with zero runtime dependencies**.
Its distinguishing feature is not graphics; it is a reflective (reflection-manifest) API +
MCP bridge that lets an AI coding agent discover and drive the engine directly. Among its
competitors (Godot, PixiJS, Bevy, Babylon, melonJS) **none** has this agent-first surface
(gap #12), and it is ExiEngine's defining differentiator.

## 2. Target platforms

| Platform | Status | Note |
| --- | --- | --- |
| Modern browsers (Chrome, Edge, Firefox, Safari) | **shipped** | WebGL2 + WebGPU dual backend |
| WebGPU (newer devices) | **shipped** | including compute culling |
| WebGL2 (broad support) | **shipped** | fallback path |
| Node.js | **shipped** (dev/test/MCP only) | not required at runtime |
| Mobile web (Android/iOS browsers) | **planned** | real device matrix still open |
| Native desktop (Electron/Tauri webview) | **planned** | via webview, not a native binary |
| Console distribution | **out of scope** | licensing gate; see gap #10 |

## 3. Target audience

1. **Primary — AI coding agents:** Codex, Claude Code, OpenCode, Gemini CLI, Cursor,
   Cline, Windsurf and similar MCP clients. They discover, generate, run and verify games
   with the `exi_*` tools over a standard JSON-RPC stdio bridge.
2. **Secondary — JS/TS web game developers:** people who want a dependency-free,
   deterministic 2D core via `import { ExiEngine, Scene, Sprite }`.
3. **Tertiary — hobbyists/learners:** people who build quick games/prototypes in the browser.

## 4. Key differentiators

1. **Agent/LLM-first API surface** — reflection manifest (`exi_api`), limit/workflow
   contract, MCP `resources`/`prompts`/`tools`, the `exi_scaffold`/`exi_build_scene`/
   `exi_preview_*` loop. Unmatched in the matrix.
2. **Zero runtime dependencies** — the core manages its own WebGL2/WebGPU backends;
   no other engine is imported.
3. **Deterministic, bounded core** — fixed-step ordering (`scene → animator → physics →
   onUpdate`), allocation-free traversal, size/depth/limit bounds, deterministic A*.
4. **Web-first dual backend** — WebGPU compute/indirect culling + WebGL2 CPU fallback.
5. **Security/lifecycle bounds** — no `eval`/`new Function`/remote code; traversal,
   symlinks, unbounded JSON/scene/handle growth and stdout pollution are rejected; cancellation + cleanup.

## 5. Minimum viable feature set (MVP)

### 5.1 Already shipped (v0.2.0) — to be preserved

- 2D scene graph: `Scene`, `Node`, `Sprite`, `Graphics`, `Text`, `Container`.
- Camera, input (keyboard/mouse/pointer), animation (`AnimatedSprite`, `Animator`/`Tween`).
- 2D physics/collision (bounded), deterministic A* via `findGridPath`.
- `TileMap`, `SpriteBatch`, `ParticleEmitter`, `RenderTexture`, lightweight effect chain.
- Assets: `Texture`, atlas, `AssetLoader`, saving, KTX2 bounds.
- MCP bridge, preview/RuntimeAgent, `doctor`/`test`/`verify`, benchmark suite.

### 5.2 Planned (MVP scope) — derived from the gaps

| Feature | Source gap | Priority | Acceptance criterion |
| --- | --- | --- | --- |
| Built-in sound/audio backend (Web Audio) | matrix: "—" in lightweight engines | P0 | `Audio`/`Sound` API; included in the `exi://types` manifest; `npm test` passes |
| Determinism contract (fixed-step + cross-platform) | gap #11 | P0 | same input + same delta → same snapshot hash; locked by a test |
| Asset pipeline determinism (import/save round-trip) | gap #6 | P1 | byte stability of asset save/load; locked by a test |
| Hot reload / live editing (asset scene refresh) | gap #5 | P1 | a changed asset shows up without a restart; verified via preview |
| Frame graph / GPU timing / memory tracking | gap #8 | P1 | `engine.getInfo()` + profiling report; benchmark gate |
| Documentation + working example + onboarding | gap #7 | P1 | `AI_ENGINE_GUIDE.md` + API.md + a working example project |
| In-browser visual editor (same language) | gap #1 | P1 | scene editing + scene serialization round-trip |
| Mobile web real-device matrix | gap #4 (web scope) | P2 | physical device smoke + telemetry |

### 5.3 Out of scope (not in this MVP)

- **3D rendering** — ExiEngine is a 2D-first core; unified 2D+3D (gap #3) is a long-term
  goal, not part of the MVP.
- **Console distribution** (gap #10) and native desktop/mobile binaries.
- **C# scripting** (gap #9) — agent access and scripting ecosystems other than JS/TS are
  outside this phase.

## 6. Success criteria

1. `npm run doctor` and `npm test` are clean; `npm run verify` passes the release gate.
2. An AI agent can generate, run and verify a game end to end over the MCP bridge with
   **zero runtime dependencies**, backed by `exi://runtime` evidence.
3. 60fps benchmark gates (`bench:*`) and the determinism snapshot test are green.
4. No public API drift between `index.d.ts` and `src/index.js` (static smoke).

## 7. Next decisions (open)

- When and how 3D rendering would come in (gap #3) — kept out of scope in this PRD.
- The business model for console/native mobile distribution (gap #10) — depends on user-base data.
