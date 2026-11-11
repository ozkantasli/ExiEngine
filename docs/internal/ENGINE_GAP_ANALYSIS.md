# ExiEngine — web 2D competitor gap analysis

ExiEngine is a dependency-free 2D engine for the browser with an AI-agent (MCP) bridge.
Its real alternatives are therefore the engines people pick for **2D games that run in a
browser**, not general-purpose desktop/3D engines. The broad 27-engine survey in
[ENGINE_FEATURE_MATRIX.md](ENGINE_FEATURE_MATRIX.md) stays as background; this document
compares against the web-2D set and lists what to build next.

Competitor descriptions are deliberately coarse (capability present / plugin / absent) and
reflect the projects' public documentation at the time of writing; re-check details before
quoting them externally.

## 1. The comparison set

| Engine | Model | Typical user |
| --- | --- | --- |
| **Phaser** | JS/TS framework, MIT | Code-first web games; the default choice, very large example/tutorial base |
| **PixiJS** | Rendering library, MIT | Apps and games that bring their own game logic; fastest-moving renderer (WebGL/WebGPU) |
| **Excalibur** | TypeScript engine, BSD | TS-first developers wanting an engine (scenes, physics, Tiled) rather than a renderer |
| **KAPLAY** (Kaboom successor) | JS library, MIT | Beginners and jams; tiny API surface, component style |
| **melonJS** | JS engine, MIT | Tiled-centric 2D games |
| **GDevelop** | Open-source no-code editor | Non-programmers; event sheets, one-click web export |
| **Construct 3** | Commercial browser editor | Non-programmers and education; polished editor, subscription |
| **Godot (web export)** | Full engine + editor, MIT | Developers who want an editor and also ship to desktop/mobile; web build is a large WASM download |

## 2. Capability matrix (after the current round of work)

Legend: ✅ built in · 🔌 official/common plugin or companion package · ➖ partial · — absent

| Capability | ExiEngine | Phaser | PixiJS | Excalibur | KAPLAY | melonJS | GDevelop | Construct | Godot web |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Zero runtime dependencies | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| WebGPU backend | ✅ (+WebGL2 fallback) | ➖ | ✅ | — | — | — | — | ➖ | — |
| GPU culling / instancing | ✅ compute culling + indirect draw | ➖ | ➖ | — | — | — | — | ➖ | ✅ |
| Arcade / AABB physics | ✅ `PhysicsWorld` | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rigid bodies with rotation | ✅ `RigidBodyWorld` | ✅ (Matter) | — | ✅ | — | ➖ | ✅ | ✅ | ✅ |
| Joints / constraints | ✅ revolute + distance/rope | ✅ | — | — | — | — | ✅ | ✅ | ✅ |
| Tiled import | ✅ `TileMap.fromTiled` | ✅ | 🔌 | 🔌 | ➖ | ✅ | ➖ | ➖ | 🔌 |
| LDtk import | ✅ tiles, IntGrid, entities | 🔌 | 🔌 | 🔌 | — | — | — | — | 🔌 |
| Bitmap fonts (BMFont) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Filters / post FX (blur, glow, outline…) | ✅ fixed catalogue | ✅ | ✅ (+custom) | ➖ | ➖ (custom shaders) | ➖ | ✅ | ✅ | ✅ |
| User-written shaders | ✅ `registerFilter` bodies (local code only) | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ | ✅ |
| 2D lighting / normal maps | ✅ `LightLayer` point lights + normal maps (no shadows yet) | ✅ | 🔌 | — | — | — | ✅ | ✅ | ✅ |
| Skeletal animation (Spine/DragonBones) | — | 🔌 | 🔌 | 🔌 | — | 🔌 | ✅ | ✅ | ✅ |
| Audio sprites / spatial audio | ✅ (2D, deterministic) | ✅ | 🔌 | ✅ | ➖ | ✅ | ✅ | ✅ | ✅ |
| Scene file format | ✅ `serializeScene` JSON | ➖ | — | — | — | — | ✅ | ✅ | ✅ |
| Visual editor | ➖ first browser editor | — (commercial 3rd party) | — | — | — | — | ✅ | ✅ | ✅ |
| Hot reload / play-in-editor | ✅ `watchScene` + live Play window | ➖ (dev servers) | — | — | — | — | ✅ | ✅ | ✅ |
| Prefabs / asset manager in editor | ➖ prefabs (no asset browser) | — | — | — | — | — | ✅ | ✅ | ✅ |
| UI widgets (input, scroll, slider, layout) | ✅ Button, Slider, TextInput (IME), ScrollView, Checkbox, Dropdown, Stack/Grid | ➖ | 🔌 | ➖ | ➖ | ➖ | ✅ | ✅ | ✅ |
| Netcode helpers | ✅ `RollbackSession` (rollback, transport-agnostic) | — | — | — | — | — | ➖ | ✅ | ✅ |
| npm package + CDN bundle | ✅ ready (not yet published) | ✅ | ✅ | ✅ | ✅ | ✅ | n/a | n/a | n/a |
| Playable examples | ➖ 6 examples + editor | ✅ (hundreds) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Determinism (fixed step, replay-safe physics) | ✅ | ➖ | n/a | ➖ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Security budgets (asset size/integrity, bounded inputs) | ✅ | — | — | — | — | — | — | — | — |
| AI-agent API (MCP bridge, runtime telemetry) | ✅ | — | — | — | — | — | — | — | — |

## 3. Where ExiEngine is ahead

1. **AI-agent-first surface.** A reflective, bounded MCP bridge with scaffold, file/asset
   tools, browser runtime calls, `observe`/`snapshot`/`scenario` verification. No
   competitor offers an agent a contract like this; it is the main differentiator.
2. **Modern GPU path with a safe fallback.** WebGPU first with compute culling and
   indirect draws, automatic WebGL2 fallback, device-loss recovery.
3. **Determinism and safety budgets.** Fixed-step ordering, deterministic physics (both
   modules), bounded asset/JSON/audio/text budgets and SHA-256 asset integrity — useful for
   replays, lockstep and running untrusted content.
4. **One JSON shape for scenes** shared by the editor, `serializeScene` and the MCP
   `exi_build_scene` tool, so humans and agents edit the same documents.

## 4. Where ExiEngine is behind (prioritized)

**P0 — adoption blockers**
1. **Not on npm yet and little content.** The package is ready (`npm pack` works, dist
   bundles build) but unpublished; four examples versus hundreds for Phaser. Publishing and
   growing examples/tutorials matters more than any single feature.
2. **Editor is still light.** Editing, saving, a live Play window and hot reload exist; prefabs,
   an asset browser, animation timelines and behaviours/events (what makes GDevelop and
   Construct attractive to non-programmers) do not.

**P1 — common feature requests**
3. **Skeletal animation (Spine/DragonBones).** Expected by artists; usually solved with a
   runtime adapter.
4. **More joint types** for `RigidBodyWorld` (✅ revolute and distance/rope joints and
   anti-tunneling via speculative contacts + substeps shipped; prismatic/weld/motor joints open).
5. **Shadows.** ✅ `LightLayer` point lights and normal-mapped sprites shipped; shadow casting is
   still open.
6. ~~UI widgets~~ ✅ Button, Slider, TextInput (IME via hidden input), ScrollView, Checkbox,
   Dropdown and Stack/Grid layout containers shipped. Rich text and tooltips remain open.
7. ~~LDtk import~~ ✅ shipped (tiles, IntGrid, entities).

**P2 — strategic**
8. **Custom shaders.** ✅ `registerFilter` shipped as a bounded, local-only API (hidden from
   agents). Custom vertex shaders and multi-pass materials remain out of scope.
9. **Netcode.** ✅ `RollbackSession` shipped (rollback over any transport). Still open: a
   reference WebSocket/WebRTC transport, lobby/matchmaking and an example game.
10. **Real-device evidence.** Mobile/GPU hardware matrix is still mostly empty.

## 5. Recommended next steps

1. Publish to npm (owner action) and announce the CDN path.
2. Grow examples: shooter, puzzle, endless runner, physics puzzle; one tutorial per example.
3. Editor v3: prefabs, asset browser, simple data-driven behaviours (play/hot reload ✅).
4. More joint types (prismatic, weld, motors) in `RigidBodyWorld`.
5. Spine runtime adapter as an optional package (keeps the core dependency-free).
6. ~~Custom-shader policy~~ ✅ decided: local `registerFilter`, denied to agents.
7. ~~Normal-mapped sprites~~ ✅; simple shadow casting on top of `LightLayer` is next.
8. Netcode example (two browser tabs over a local WebSocket relay) on top of `RollbackSession`.

## 6. Status of earlier gaps from the previous analysis

The previous version compared against desktop/Rust/C# engines (Bevy, Fyrox, Stride…).
Its relevant items are now: visual editor (first version shipped), deterministic 2D physics
(shipped, two modules), web as first-class target (core design), hot reload (open),
asset pipeline (Tiled, BMFont, KTX2 shipped; LDtk/Spine open), debugging/profiling (profiler
and runtime telemetry exist; GPU timing open). C# scripting and console distribution are out
of scope for a JavaScript web engine.
