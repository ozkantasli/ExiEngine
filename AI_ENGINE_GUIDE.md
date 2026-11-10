# ExiEngine agent guide

This file is the canonical repository contract for Codex, Claude Code, OpenCode, Gemini CLI and similar coding agents. The adapter files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) only point here; update this file before adding rules anywhere else.

Read [API.md](API.md) for the detailed API and MCP reference with examples; [index.d.ts](index.d.ts) is the source of the TypeScript signatures.

## Quick start

```powershell
npm run doctor   # environment, exports and repository contract
npm test         # fast static/server/engine smoke + unit + typecheck
npm run lint     # zero-dep syntax + anti-pattern scan
npm run build    # dist/exi-engine.js (ESM) + dist/exi-engine.global.js via tools/build.mjs
npm run test:typecheck  # index.d.ts integrity + TS consumer fixture
npm run test:coverage   # unit suite coverage thresholds
npm run bench:regression  # benchmark baseline drift gate
npm run test:e2e:browser  # real Chrome/Chromium canvas + runtime telemetry
npm run verify   # release gate and all benchmarks
node tools/exi-mcp-server.mjs  # AI CLI stdio bridge; stdout carries JSON-RPC only
npm run test:clients:native  # bounded mcp list probe for installed host CLIs
```

There are no runtime dependencies. Node.js is only used for tests and the local demo server. The engine is not imported into another game engine; the core manages its own WebGL2/WebGPU backends.

Minimal usage:

```js
import { ExiEngine, Scene, Sprite, Texture } from "./src/index.js";

const scene = new Scene();
scene.add(new Sprite({ texture: Texture.white, x: 320, y: 180, width: 64, height: 64 }));
const engine = await ExiEngine.create({ canvas: document.querySelector("canvas"), scene });
engine.start();
```

## AI CLI MCP bridge

`tools/exi-mcp-server.mjs` exposes a standard JSON-RPC stdio MCP surface without adding runtime dependencies. For Codex, Claude Code, OpenCode, Gemini CLI, Cursor CLI, Cline CLI, Windsurf/Cascade or any other MCP client, the working directory must be the repository root and the command must be `node tools/exi-mcp-server.mjs` directly; `npm run mcp` must not be used as the MCP transport command because npm can write its banner to stdout. MCP configuration examples are in [MCP.md](MCP.md). The bridge is dual-era: a current `2026-07-28` client starts with `server/discover` and carries the protocol version and `clientCapabilities` under `params._meta` on every request; a legacy client uses the `initialize` → `notifications/initialized` flow. Both flows then call `tools/list`, `resources/list`, `prompts/list` and `exi_api`. A modern result response carries `resultType: "complete"` and the server identity in `_meta`. `prompts/get` can request the `exi_create_game` or `exi_verify_runtime` workflow. Long-running `exi_check` or preview calls can be cancelled with JSON-RPC `notifications/cancelled` by request id; a cancelled tool produces no response and the child process it started is cleaned up.

Core tools:

- `exi_api`: manifest of `src/index.js` exports/classes/statics/public methods, a canonical `route` for every export/member/method, `methodRoutes`/`staticMethodRoutes`, descriptor reflection that never runs getters, the canonical URI map in `resources`, the API-operation/tool map in `callRoutes`, bridge limits and the canonical create/assets/cleanup workflow order; it prevents API drift, guessed tools/URIs and guessed limits.
- MCP `resources/list`/`resources/read`: reads the fixed `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime` and `exi://clients` contracts; there is no arbitrary filesystem resource.
- `prompts/list`/`prompts/get`: provides the `exi_create_game` and `exi_verify_runtime` workflows; prompt `arguments` must be an object and undefined fields must not be sent.
- `tools/list`: treat the tool input schemas as canonical; send no unknown top-level fields and fill in required fields. The bridge rejects arguments not in the schema with `EXI_MCP_ARGUMENT_UNKNOWN`, missing fields with `EXI_MCP_ARGUMENT_REQUIRED`, and type/enum/limit/schema violations with canonical codes; for binary uploads the `exi_asset_write`/`exi_asset_chunk` schema explicitly defines the `{ "$bytes": [...]|base64 }` field.
- `exi_create`, `exi_function`, `exi_export_get`, `exi_export_call`, `exi_static_call`: create/call a public engine object or an allowlisted export function; a static call only reaches the class's own-property static methods.
- `exi_function` decodes `{"$bytes":[0,1,255]}` or bounded base64 `{"$bytes":"..."}` values in JSON into `Uint8Array`, so binary APIs such as `inspectKTX2` can be used over MCP too. Typed-array/`DataView` results are carried inline in `bytes.$bytes` up to `exi_api.limits.maxInlineBinaryBytes` (32 KiB); inside `exi_batch` they can be passed back to the next binary API with `{"$result":0,"$path":"bytes"}`. Large results return `bytes.truncated`; use `exi_asset_read` for the full asset, and BigInt sample values are strings.
- `findGridPath` provides dependency-free, deterministic and bounded A* grid pathfinding; use the `diagonal`, `allowCornerCutting`, `blockedValues` and `maxNodes` options without exceeding `MAX_GRID_PATH_CELLS` and `exi_api.limits.maxGridPathCells`. Check the `reached`, `expanded` and `truncated` fields of the result; a pathfinding result is not a physics or navigation-mesh guarantee.
- `exi_inspect`, `exi_call`, `exi_get`, `exi_set`, `exi_release`: tools to discover session-scoped `$handle` values with metadata and to manage game state and lifecycle; `exi_inspect` lists only the callable public methods/properties on the prototype without running getter values, and does not expose game callback fields as methods. `exi_session_status` returns handle, protected handle, project scope, pending text/binary upload and preview metadata in bounded form without running getters; it does not reveal tokens or temporary file paths. `exi_session_reset` cleans up handles, uploads and the same session's preview processes together.
- `exi_batch`: runs up to 128 public tool calls in order; passes a result to later calls with `{"$result":0}` and a safe own-property field with `{"$result":0,"$path":"fileUploadId"}`; it is not a transaction.
- `exi_project_apply`: writes up to 16 bounded text files, 512 KiB in total, to a folder in the same session scope in a single transactional flow; it does not change existing files unless `overwrite` is set, rolls back completed files on a staging/commit error, and rejects stale-file conflicts with `expectedVersion`.
- `exi_build_scene`: builds a `Scene`/`Node` tree from a bounded JSON declaration; it accepts no callbacks or scripts.
- `exi_scaffold`: generates minimal browser game files without leaving the repository root; it first stages all starter files to unique temporary files, and if a commit is interrupted it tries to remove the new files and restore the old ones; it does not overwrite existing files by default.
- `exi_project_open`: runs an existing in-repo game folder through a bounded HTML/JS/JSON static check first and opens it to the file/asset tools in the same MCP session; traversal, symlinks, engine/test/tool roots and projects with no checkable file are rejected.
- `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch`: let MCP-only agents discover, read and update, as bounded UTF-8, the allowlisted `.js`, `.html`, `.css`, `.json`, `.svg`, `.md`, `.mjs`, `.ts` or `.txt` files of a game scaffolded in the same session or opened with `exi_project_open`; list/read results carry a `{ bytes, mtimeMs }` version, and passing that version in the `expectedVersion` field of `exi_file_write`/`exi_project_apply` stops a stale overwrite with `EXI_MCP_FILE_CONFLICT`. Single-call writes and exact-match patch texts are limited to 64 KiB. `exi_file_patch` performs an atomic overwrite only if the `find` text has exactly one exact match; with zero or several matches the file does not change.
- `exi_file_begin`/`exi_file_chunk`/`exi_file_commit`/`exi_file_abort`: safely write large text sources up to 4 MiB in sequential UTF-8 chunks; the limits are 48 KiB per chunk, 16 MiB pending and 8 active transfers. For an existing file, pass the read/list `version` value as `expectedVersion` to `exi_file_begin`; the target is checked again before commit. `exi_file_read` returns 48 KiB pages for large files with `offset`/`limit`. Missing parent folders are only created inside project folders in the session scope; engine/test/tool roots, binaries, secrets, traversal and symlinks are rejected.
- `exi_asset_list`/`exi_asset_read`/`exi_asset_write`: let MCP-only agents discover `.png`, `.jpg`, `.webp`, `.gif`, `.bmp`, `.avif`, `.ktx2`, `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`, `.woff`, `.woff2`, `.ttf` or `.otf` assets in a scaffolded or `exi_project_open`-opened project with `{ bytes, mtimeMs }` version metadata, read a range of up to 32 KiB of an existing asset as bounded base64, and upload with a `$bytes` payload; `expectedVersion` stops a stale overwrite with `EXI_MCP_FILE_CONFLICT`, and the byte limit of a single write call is 512 KiB.
- `exi_asset_begin`/`exi_asset_chunk`/`exi_asset_commit`/`exi_asset_abort`: upload assets larger than 512 KiB in sequential chunks to a temporary file in the same project scope and move it to the target at commit; `expectedVersion` can be given to `exi_asset_begin` for an existing asset and is re-verified before commit. A single asset is limited to 64 MiB, total pending uploads to 64 MiB and active uploads to 8. Secrets/traversal/symlinks and extensions outside the allowlist are rejected.
- `exi_file_check`: statically validates a `.html`, `.js`, `.mjs` or `.json` file in the same session scope without running code; it also checks HTML script/style references and is the first project-integrity gate for CLIs without browser access.
- `exi_project_check`: checks all allowlisted `.html`, `.js`, `.mjs` and `.json` files in the scaffolded or opened folder in a single bounded flow; it returns up to 128 checked files and 32 error summaries. `exi_file_check` is still available for large or targeted changes.
- `exi_project_status`: summarizes a project in the same session scope in one read-only bounded result with text files, binary asset metadata, the `exi_project_check` result and the HTTP/runtime telemetry state of previews started for that project; a same-scope preview started directly with `exi_preview_start({ path: "/ai-game/index.html" })` is also safely matched by path. Without runtime telemetry the static-only state stays explicit as `runtime.ok=false` or `telemetry:null`; it does not run a browser/GPU.
- `exi_project_preview`: validates all checkable files with `exi_project_check` in the same session scope; on failure it returns `{ ok:false, phase, projectCheck }` without starting a preview, on success it returns a loopback preview for `/index.html` and its `pageUrl`. This is a static check + HTTP readiness gate; for browser/GPU evidence, `pageUrl` must be opened in a real browser and compared with `exi://runtime`.
- `exi_check`: instead of an arbitrary shell, runs only `doctor`, `test` or `verify`.
- `exi_preview_start`, `exi_preview_call`, `exi_preview_batch`, `exi_preview_probe`, `exi_preview_stop`: start only the loopback `server.mjs` preview, run allowlisted browser engine operations through the demo or scaffold RuntimeAgent, verify with a bounded GET and stop. For a new game call `exi_preview_start({ path: "/ai-game/index.html" })`; `pageUrl` is handed directly to a browser agent, and the preview is not considered ready until the target page returns HTTP 200. After uploading an asset file, create an `AssetLoader` on the browser side, call `loadTexture`/`loadAtlas`/`loadJSON` and wire the returned handles into the `Sprite`/`TextureAtlas` flow; `exi_preview_batch` runs up to 8 sequential browser operations in one round trip, takes `$result`/safe `$path` references from earlier results and can continue with the remaining calls with `stopOnError:false`. In scaffolds/demos the `observe` operation gives a bounded ASCII grid/hash observation through the engine's temporary RenderTexture readback, and `snapshot` gives a paged scene graph/parent handle/transform state/hash without running getters; a text-only AI CLI can use these values to check real WebGL2/WebGPU frames and scene changes. A batch is not a transaction; completed temporary handles must be released separately. The preview readiness window is 10 seconds and a failed start is cleaned up automatically. After real browser execution, the demo and scaffold pages send bounded telemetry to the token-protected `/__exi/runtime` channel; `exi_preview_probe` can read this report, and `exi_preview_call`/`exi_preview_batch` can read browser handle, observe and snapshot results. Without a browser RuntimeAgent a call returns a cleaned-up timeout within 10 seconds.

Do not generate native DOM events in browser test/replay flows: take the `input` handle from the `engine` root, call `engine.stop()`, and advance with bounded public methods such as `Input.inject([{ type: "keydown", code: "ArrowRight" }])` and `engine.step(1 / 60)`. `Input.inject` accepts up to 128 events; compare the results with `snapshot` and `observe`. This is a controlled test feed into the page's own Input state, not OS input.

To verify several frames in one flow, use `scenario`: put `delta`, `input`, `observe` and `snapshot` fields into `frames[]`. The limits are 16 frames/512 events; an engine that was running at the start is restarted at the end of the scenario by default. First check the scene handles with `snapshot`, then the input/step result with `scenario`, and finally the `observe` hash/grid difference. This workflow is not a generic method call; it is a narrowed test path that speeds up the AI generation loop.

If `_meta: { progressToken: "..." }` is added to the MCP request metadata of a long `tools/call`, the bridge sends `notifications/progress` heartbeats. These are progress information only; the final tool result, and cancellation via `notifications/cancelled`, are handled on the same request id.

Browser-capable agents read the `#exi-runtime` output in the `exi://runtime` resource for runtime verification. After a backend change, wait at least `warmupMs`; `data-ready="true"`, `data-status="running"`, `data-backend="webgpu"` or `webgl2`, a positive `data-fps` and an empty console error/warning list are real canvas evidence. After the real page has loaded, the same page's server telemetry report can be compared with `exi_preview_probe({ path: "/__exi/runtime" })`. A synthetic MCP POST or a static index response is not browser/GPU evidence; a CLI without browser control must explicitly report this as "static-only".

The bridge and the browser RuntimeAgent reject `eval`, `new Function`, dynamic import, remote code, traversal, dangerous property names, unbounded JSON/scene/handle growth and stdout log pollution. The browser command channel only sees the `src/index.js` exports and the `engine`/`scene` roots; callback bodies/function source are never converted to JSON, only a `{"$callback":"name"}` reference registered on the page is accepted. `tools/call` is sequential within a session to prevent state races; the read-only/destructive annotations in `tools/list` give clients an intent hint. Files written by the tools must still go through human review; work is not done until `npm run doctor` and `npm test` have completed.

### APIs that take callbacks

For `Node.traverse`, `Node.find`, `Scene.pick`, input/physics filters and other APIs that take callbacks, do not put callback code in the MCP payload. Register a reviewed function in the `runtimeCallbacks` registry in the scaffold's `game.js`; read its name from the `callbacks` field of the browser `inspect` result and send `{"$callback":"name"}`. This only selects a function registered on the page; there is no body serialization/eval, and the registry is bounded to 256 callbacks and 256 characters per name. Direct process-side `exi_call`/`exi_function` is JSON-only; verify with `exi_project_check` first, then with a real preview.

## Test infrastructure

- `test/run-all.mjs`: the `npm test` orchestrator — runs every stage sequentially but independently; even if a stage fails, the following ones still run and a summary is reported. Stages: static, server, doctor, clients, mcp, engine-smoke, unit, typecheck, build, examples.
- `test/coverage/` + `test/coverage/thresholds.mjs`: unit suite coverage thresholds (after Phase 3, 20 files / ~210 tests; webgl2 %75+, webgpu %85+, unit modules %90+; GPU renderers verify the contract with a fake GL/device, hardware-soak is the real GPU evidence).
- `tools/lint.mjs`: zero-dep lint — `node --check` syntax + bans on engine imports/eval/console.log (MCP)/mixed indentation.
- `test/typecheck-syntax.mjs`: runs `index.d.ts` integrity + the `test/fixtures/typecheck.ts` consumer with `--experimental-strip-types` (Node 22.6+; SKIP on Node 22, fully runs on Node 24).
- `test/benchmark/benchmark-regression.mjs`: compares 25 benchmarks with the baseline (elapsed +50%, fps -40% tolerance). Creates `benchmark-baseline.json` on the first run.
- `test/examples-smoke.mjs` / `test/e2e/examples-e2e.mjs`: `examples/<name>/` games must import only real `src/index.js` exports, keep the strict CSP shell and load their Tiled levels; the e2e variant runs them in real Chromium (`npm run test:e2e:examples`). Update both when adding an example.
- `test/e2e/preview-e2e.mjs`: starts the loopback server and verifies HTTP 200 + security headers.
- `test/e2e/browser-e2e.mjs`: verifies real browser demo frame/FPS telemetry and a short WebGPU/WebGL2 hardware-soak run with on-demand Playwright; for a locally installed Chrome use `EXI_PLAYWRIGHT_CHANNEL=chrome npm run test:e2e:browser`. Set `EXI_PLAYWRIGHT_SECONDS=30` for a 30-second release soak.
- CI: `.github/workflows/ci.yml` — test (Node 22+24), verify (Node 24), coverage (Node 24) and preview-e2e (Node 24) jobs on push/PR. Node 20 was removed from the matrix because it is deprecated.

## Source map

- `src/index.js`: the public runtime export surface.
- `src/ai/public-methods.js`: the shared, class-based public method allowlist for MCP and the browser RuntimeAgent; renderer/cache/validation helpers do not enter the AI call surface.
- `src/ai/runtime-agent.js`: the token-protected, allowlisted browser runtime command client of the scaffold preview; it is not an arbitrary script runner.
- `index.d.ts`: the TypeScript declaration of the same API; updated together when the public API changes.
- `src/core/`: scene graph, camera, input, animation, physics, tilemap, text and 2D primitives.
- `src/assets/`: Texture, atlas, render target, loader, save and KTX2 bounds.
- `src/render/`: WebGL2/WebGPU backends with a shared batch/clip flow.
- `src/audio/`: Web Audio buses, bounded decode/voices and lifecycle.
- `src/core/scene-serializer.js`: `serializeScene`/`deserializeScene` scene documents (same `{ type, options, children }` shape as `exi_build_scene`); data only, never callbacks or code.
- `editor/`: the dependency-free browser scene editor (`/editor/`); every committed edit is serialize → change → deserialize, so engine validation applies. Attach editor DOM listeners to `.viewport`, not the canvas (the canvas is replaced on WebGPU→WebGL2 fallback).
- `examples/`: small complete games; keep `test/examples-smoke.mjs` and `test/e2e/examples-e2e.mjs` passing.
- `test/engine-smoke.mjs`: the main test of the behavior, security and lifecycle contract.
- `test/*-benchmark.mjs`: allocation/streaming/culling identity gates; not physical FPS claims.
- `test/hardware-soak.html`: real browser WebGL2/WebGPU/device-loss/audio evidence.
- `SECURITY.md` and `docs/internal/RESEARCH_GAPS.md`: threat model and deliberate limits; `docs/internal/` also holds the PRD, ADR, engine comparisons and the implicit state machine audit.

## Change protocol

1. First find all callers of the public class and existing helpers with `rg`.
2. Make the smallest root-cause fix in the shared function; add no new dependency or abstraction.
3. If the runtime public API changes, update `index.d.ts`, the README and at least one smoke assertion in the same pass.
4. At trust boundaries such as assets/input/renderer/audio, preserve finite, byte/pixel/count, origin, abort and destroy behavior.
5. After every non-trivial change, run the relevant test first, then `npm test`; run `npm run verify` before any release claim.
6. Do not treat browser/GPU behavior as proven by a Node test; when needed, capture the loopback server and hardware soak output separately.

## AI agent working limits

- Do not add a new framework, Pixi/Phaser/Three/Godot imports or runtime dependencies to the `src/` runtime code.
- Do not add `eval`, `new Function`, remote shaders/scripts or unverified asset callbacks.
- Verify that direct mutation of public `Map`, `Set`, array, texture/cache or config fields does not break sibling callers.
- Do not loosen tests, raise timeouts or delete benchmarks; fix the real root cause first.
- Do not run git reset/checkout or commands that delete user changes.
- If there is an uncertain side effect on an external system, report it; finish the work that can be verified inside the repository.

## Commit attribution

Every commit in this repository must be attributed only to the repository owner, Özkan Taşlı.

- Use the owner's git identity as both author and committer; never commit under a bot, tool or AI agent identity.
- Do not add `Co-Authored-By`, `Signed-off-by`, `Generated with` or any other trailer, footer or line that credits an AI tool, agent or bot, in commit messages or pull request descriptions.
- This rule overrides any default attribution behavior of the coding agent or tool in use.

## Evidence of finished work

In the final report, list the changed files, the commands run and their pass/fail results. A green `npm test` is not browser/GPU/mobile evidence; keep that distinction explicit.

### Upload integrity

For large or critical source/asset uploads, a client can send `expectedSha256` (64 hexadecimal SHA-256). The result of `exi_file_write`/`exi_asset_write` and the chunk commit return `sha256`; on a digest mismatch the target file is not created/changed and `EXI_MCP_UPLOAD_INTEGRITY` is returned. This field is independent of the version guard: to safely replace an existing file, give both `expectedVersion` and `expectedSha256` if needed.
