# ExiEngine MCP bridge

Full API and MCP reference with examples: [API.md](API.md).

ExiEngine exposes a local, dependency-free MCP stdio server for coding agents. Start it from the repository root with:

```powershell
node tools/exi-mcp-server.mjs
```

Do not use `npm run mcp` as the MCP stdio command: the npm script banner can be written to stdout and break the JSON-RPC handshake. `npm run mcp` is only for a human starting the server manually from a terminal; client configs use `node tools/exi-mcp-server.mjs` directly.

In long or reconnecting AI CLI sessions, `exi_session_status({})` is a read-only reconnect map: it returns handle descriptor metadata, project scopes, pending upload byte progress/state and preview readiness/page URL; runtime tokens, temp paths, getter values and file contents are not returned. Chunk uploads that make no progress for 15 minutes are cleaned up on the next upload call. The order before cleanup should be `exi_session_status` → `exi_preview_stop`/`exi_release` if needed → `exi_session_reset`.

The process writes only newline-delimited JSON-RPC responses to stdout. Logs, if any, go to stderr. It is a dual-era server: modern MCP `2026-07-28` clients use `server/discover` plus per-request `_meta`, while legacy clients negotiate `2025-11-25`, `2025-06-18`, `2025-03-26` or `2024-11-05` through `initialize`. Modern result responses include `resultType: "complete"` and server identity in result `_meta`; legacy response shapes remain unchanged. JSON-RPC notifications, including cancellation/progress notifications, are consumed without producing an invalid response.

It also exposes standard `resources/list` and `resources/read` entries: `exi://api`, `exi://types`, `exi://guide`, `exi://security`, `exi://runtime` and `exi://clients`. These resources are fixed allowlisted documents. The `initialize` and `server/discover` responses include a short server-wide workflow instruction so clients that honor MCP `instructions` receive the same safety order before tool discovery. `prompts/list`/`prompts/get` expose `exi_create_game` and `exi_verify_runtime` as bounded workflow instructions. `exi_inspect` describes a live handle without invoking getters, while `exi_batch` reduces round-trips for scene/asset preparation while preserving sequential session ordering. `exi_project_open` adopts an existing repo-local game directory only after bounded static checks; `exi_project_apply` then writes up to 16 text files in one transactional scope with rollback on staging/commit failure. `exi_file_list`/`exi_file_read`/`exi_file_write`/`exi_file_patch`/`exi_file_check` then give MCP-only agents a bounded project text-file discovery, edit and static syntax-check loop for either opened or scaffolded projects. `exi_file_patch` requires exactly one `find` match and reuses the atomic temp/backup replacement path. `exi_project_check` checks the whole project in one call. `exi_asset_list`/`exi_asset_write` add bounded binary game-asset discovery/upload and `exi_asset_begin`/`exi_asset_chunk`/`exi_asset_commit`/`exi_asset_abort` support larger sequential uploads. None are arbitrary filesystem or shell tools. Engine-mutating `tools/call` requests are serialized per MCP process; tool results are bounded to 64 KiB.
Long `exi_check`, `exi_project_check`, `exi_project_open`, preview-start and batch calls emit standard `notifications/progress` when the client sends `_meta.progressToken`; progress is advisory and does not replace the final tool result. Cancellation uses `notifications/cancelled` with the same request id and produces no response for the cancelled request.

For binary data in JSON tool arguments, use only `{"$bytes":[0,1,255]}` or bounded base64 `{"$bytes":"..."}`; the bridge turns it into a `Uint8Array` and applies an absolute 512 KiB byte limit. `exi_file_read`/`exi_file_write`/`exi_file_patch` only work in project folders created with `exi_scaffold` or opened with `exi_project_open` in the same session; `exi_file_write` creates missing parent folders only inside this project scope, while `exi_file_patch` requires an existing file.

Binary results of `exi_call`/`exi_function` can also be reused by the AI: for typed arrays and `DataView` values, the inline `bytes.$bytes` payload is kept below `exi_api.limits.maxInlineBinaryBytes` (32 KiB). Large results are marked with `bytes.truncated`; use `exi_asset_read` paging for the full file. A `{"$result":0,"$path":"bytes"}` reference inside `exi_batch` turns this base64 field back into a safe `Uint8Array` argument.

Every export in the `exi_api` manifest declares its canonical tool in its `route` field: class → `exi_create`, top-level function → `exi_function`, other exports → `exi_export_get`. `methodRoutes` maps an instance method name to `exi_call`, and `staticMethodRoutes` maps a static method name to `exi_static_call`; agents must not guess these routes. The manifest and live `inspect` show the public methods in the class-based allowlist in `src/ai/public-methods.js`; they do not show internal renderer/cache/validation helpers. The `members` field shows nested public functions such as `easing.linear` and each member's `route`; the `staticProperties` field shows static values such as `Texture.white` and the `exi_export_get` route. Because the discovery manifest is built from descriptors, it does not run nested/static getters; a real getter is only evaluated when `exi_export_get` or the related call is explicitly requested. Nested functions are reached with `exi_export_call`. `exi_static_call` only calls a class's own-property static methods; export paths and static methods cannot be extended through the prototype chain. Every tool schema in `tools/list` carries `additionalProperties:false` at the top level, and the bridge enforces the same contract. An unknown field is rejected with `EXI_MCP_ARGUMENT_UNKNOWN`, a non-object top-level argument with `EXI_MCP_ARGS_TYPE`, a nested type error with `EXI_MCP_ARGUMENT_TYPE`, a missing required field with `EXI_MCP_ARGUMENT_REQUIRED`, and enum/limit/schema violations with canonical error codes. This keeps the client's discovery schema and the real dispatch surface from drifting.

`exi_api` also returns `limits`, `toolInput` and `workflow`. Agents should read limits such as `maxBinaryBytes`/`maxAssetReadBytes`/`maxChunkedAssetBytes`/`maxRuntimeCommandBytes`/`maxRuntimeBatchCalls`, the strict input codes and the `workflow.create`, `workflow.open`, `workflow.assets` and `workflow.cleanup` orders from this response and apply them directly; they must not guess constants.

The top-level `findGridPath` function is discovered on the `exi_function` route. Send the grid as a JSON array; respect the `MAX_GRID_PATH_CELLS`/`exi_api.limits.maxGridPathCells` limit and check the `reached` and `truncated` fields. This call only produces a navigation path; it creates no Node, collider or scene.

The declarative `exi_build_scene` spec accepts only the `type`, `options` and `children` fields; `options` must be an object and `children` an array. Undefined fields or wrong types are rejected with `EXI_MCP_SCENE_SCHEMA`, and on a partial scene creation error the created handles are rolled back.

`exi_api.resources` gives the canonical MCP resource URI map, and `exi_api.callRoutes` gives the tool route to use for each API shape. For example, use `callRoutes.constructor` for a constructor, `callRoutes.instanceMethod` for an instance method, `callRoutes.nestedExport` for a nested export function and `callRoutes.staticValue` for a static value. Agents should read these two fields and proceed without guessing tool names or resource URIs.

In the browser runtime, use `exi_preview_call({ previewId, operation: "observe", args: [{ columns, rows }] })` or the same operation inside `exi_preview_batch`. Because the scaffold/demo wires `createEngineObserver(engine)`, the result is a bounded `canvas-grid` object from the WebGL2/WebGPU offscreen readback: compare its ASCII `grid`, `hash`, `changed`, `previousHash`, `nonEmpty` and `averageLuma` fields. This is not a screenshot or arbitrary DOM/state access; its purpose is to let a text-only AI CLI do quick visual regression checks on a real GPU frame. A `createCanvasObserver(canvas)` fallback exists for custom pages, but the engine observer is preferred because swapchain readback is not portable.

To understand the scene structure, use `exi_preview_call({ previewId, operation: "snapshot", handle: "scene", args: [{ limit: 64 }] })`. `snapshot` lists nodes in pre-order by reading only direct data fields; it runs no getters/callbacks/eval. The result is bounded to 64 nodes per page, 4,096 visits and depth 32; `offset`/`limit`, `nextOffset`, `truncated`, `hash`, `changed` and the node parent/handle/transform/state fields give the AI deterministic scene perception. Snapshot handles can be used in later `exi_preview_call`/`exi_preview_batch` `call/get/set` operations; release temporary handles when finished.

In browser test/replay flows, take the `input` handle from the `engine` root, call `engine.stop()`, then advance the simulation with bounded public methods such as `Input.inject([{ type: "keydown", code: "ArrowRight" }])` and `engine.step(1 / 60)`. `Input.inject` accepts up to 128 events; compare the results with `snapshot` and `observe`. This is a controlled test feed into the page's own Input state, not OS input.

To run repeatable short tests with fewer round trips, use `exi_preview_call({ previewId, operation: "scenario", handle: "engine", args: [{ frames: [{ input: [{ type: "keydown", code: "ArrowRight" }], observe: { columns: 8, rows: 4 }, snapshot: true }, { input: [{ type: "keyup", code: "ArrowRight" }] }] }] })`. `scenario` accepts up to 16 frames/512 total events; each frame advances with a fixed step, returns optional observe/snapshot results, and by default restarts an engine that was running at the start. This operation only calls fixed engine lifecycle + Input paths; it is a narrowed, safe workflow for AI test flows instead of generic method dispatch.

For `prompts/get`, `arguments` must be an object; fields not defined for the prompt are rejected with `EXI_MCP_ARGUMENT_UNKNOWN`, non-object prompt arguments with `EXI_MCP_PROMPT_ARGS_TYPE`, and a wrong `goal`/`path` type with `EXI_MCP_ARGUMENT_TYPE`. In JSON-RPC prompt/resource errors, the canonical code is also carried in the `error.data.code` field.

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

`default_tools_approval_mode = "writes"` lets Codex use read-only tools in the flow while asking for approval on tools that mutate files/assets/the engine. `startup_timeout_sec`, `tool_timeout_sec`, `command`, `args`, `cwd` and the project-scoped `.codex/config.toml` follow the official Codex MCP configuration contract; the project must be trusted for Codex to load the project config ([official Codex MCP documentation](https://developers.openai.com/codex/mcp/)).

Because the bridge's `exi_check` upper limits are `doctor=60s`, `test=180s` and `verify=300s`, the Codex/Gemini/OpenCode examples use a 360-second client timeout; this is a bounded upper limit, not a latency target.

Current MCP clients can do modern discovery first:

```json
{"jsonrpc":"2.0","id":"discover-1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"my-agent","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}}}
```

Every later modern request carries the same protocol version and `clientCapabilities` fields under `params._meta`; `clientInfo` is optional. Modern responses carry `resultType: "complete"` and the server identity in `_meta`. If a modern client cannot use discovery or wants the legacy flow, the `initialize` flow below keeps working.

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

The equivalent Gemini CLI management command is `gemini mcp add exi-engine node tools/exi-mcp-server.mjs`. The current OpenCode CLI management command `opencode mcp add` adds a local server interactively; the `opencode.json` in the repository carries the same setting directly and reproducibly.

The equivalent shape for generic stdio MCP clients:

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

If the client only accepts `command`/`args`, start it from the repo root instead of using `cwd`; if it starts from a different working directory, give the absolute path of the repo root for `EXI_MCP_ROOT`. This shape is the stdio JSON-RPC contract, independent of the client's name.

For Cursor CLI the project file `.cursor/mcp.json`, and for Cline CLI the project file `.cline/mcp.json`, come ready-made. Both use the same minimal shape:

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

Cursor CLI uses `.cursor/mcp.json` inside the project, and Cline CLI uses `.cline/mcp.json` in the project root. For Windsurf/Cascade, the official user file is `~/.codeium/windsurf/mcp_config.json` or the `mcp_config.json` your installation points to; put the same `mcpServers.exi-engine` entry in it. Because the Windsurf user file lives outside the repository, set `EXI_MCP_ROOT` to the absolute path of the repo root:

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

Replace the Windows paths with your own repository path. In all three clients, the transport command must be `node tools/exi-mcp-server.mjs` directly; `npm run mcp` can break the stdout framing.

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

These seven configuration paths come ready-made or documented in the repository: `.codex/config.toml` for Codex, `.mcp.json` for Claude Code, `.gemini/settings.json` for Gemini CLI, `opencode.json` for OpenCode, `.cursor/mcp.json` for Cursor CLI, `.cline/mcp.json` for Cline CLI and the user-level `~/.codeium/windsurf/mcp_config.json` for Windsurf. When the relevant CLI is started in the project root, it can discover the `exi-engine` stdio server. They only start the local `node tools/exi-mcp-server.mjs` process; check your own client's project-config policy before using them. `npm run test:clients` verifies that the configurations stay identical to the bridge contract, and `npm run test:clients:native` verifies that the installed host CLI's own list path sees `exi-engine`.

Current client references: [Codex MCP](https://developers.openai.com/codex/mcp), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [OpenCode MCP](https://opencode.ai/v2/docs/mcp-servers), [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md), [Cursor MCP](https://docs.cursor.com/context/model-context-protocol), [Cline CLI reference](https://docs.cline.bot/cli/cli-reference) and [Windsurf Cascade MCP](https://docs.windsurf.com/windsurf/cascade/mcp). Because CLI versions can change their installation commands, the config file shape and the stdio handshake are the real contract.

### Engine APIs that take callbacks

The browser RuntimeAgent does not accept callback bodies and does not use `eval` to run them. Register a reviewed callback in the `runtimeCallbacks` object in the scaffolded `game.js`; read its name from the `callbacks` list in the browser `inspect` result and use a `{"$callback":"name"}` reference in the `exi_preview_call`/`exi_preview_batch` argument. Name resolution is limited to the registry inside the page (at most 256 callbacks, 256 characters per name); an unknown reference returns a controlled error. This path supports `Node.traverse`/`find`, `Scene.pick` and browser APIs that accept callbacks/predicates. Direct MCP engine tools stay JSON-only; callback bodies must be written to the project with the file tools and then statically checked with `exi_project_check`.

Example order: read the `callbacks` field of the `exi_preview_call({ previewId, operation: "inspect", handle: "scene" })` result; then send `exi_preview_call({ previewId, operation: "call", handle: "scene", method: "traverse", args: [{ "$callback": "visit" }] })`. `traverse` may return `null`; verify the callback's bounded effects on game state through a second `inspect`/`exi_preview_probe` or the browser DOM. Without a browser agent, this flow must be reported as static-only.

### Real browser asset chain

After an asset file has been written to the project over MCP, texture decoding must happen inside the real browser RuntimeAgent via `exi_preview_call`, not in process-side Node. Pass the `url` value from the `exi_preview_start` result to the `AssetLoader` constructor as `baseURL`; carry the returned handles into the following calls:

```json
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"create","type":"AssetLoader","args":[{"baseURL":"http://127.0.0.1:64603/"}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"call","handle":"h1","method":"loadTexture","args":["/assets/player.svg",{"mimeType":"image/svg+xml"}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"static_call","type":"TextureAtlas","method":"fromGrid","args":[{"$handle":"h2"},{"frameWidth":32,"frameHeight":32,"columns":2,"rows":2}]}}
{"name":"exi_preview_batch","arguments":{"previewId":"p1","calls":[{"operation":"call","handle":"h3","method":"get","args":["0"]},{"operation":"create","type":"Sprite","args":[{"texture":{"$result":0},"width":96,"height":96}]}]}}
{"name":"exi_preview_call","arguments":{"previewId":"p1","operation":"call","handle":"scene","method":"add","args":[{"$handle":"h4"}]}}
```

The `h1`–`h4` values in this example are illustrative; use the `$handle` values from the real results. Because `loadTexture`/`loadAtlas` require a CanvasImageSource, Node-side `exi_call` can only be used for browser-independent asset operations such as bytes/JSON. The real evidence order is: `data-ready="true"`, `data-status="running"`, the backend and a positive FPS in the browser DOM; then `exi_preview_probe({"path":"/__exi/runtime"})`; finally an empty browser console warning/error list. Synthetic telemetry does not replace this chain.

## Verification levels

`npm run test:clients` verifies that the six repo configs carry the expected command and that each config can run the `initialize` → `tools/list` → `exi_function` flow against the real stdio bridge process it produces; the same output also reports the executable discovery state of `codex`/`claude`/`opencode`/`gemini`/`cursor-agent`/`cline` on the host. Because the Windsurf user file lives outside the repository, its shape is verified through `exi://clients` and the documentation example. `npm run test:clients:native` runs `cursor-agent mcp list`, `codex mcp list`, `claude mcp list`, `opencode mcp list` and `gemini mcp list` in turn on installed clients, read-only in the repo root with a 5-second limit; it reports a failure if `exi-engine` is missing from the output and skips clients that are not installed. Environments where the host executable cannot start with `EPERM`/`EACCES`, such as WindowsApps, are reported as `unavailable`; this is not a bridge handshake failure and does not turn the native probe red on its own. Because the official Cline CLI only guarantees the `cline mcp` management command, the native probe does not run a hypothetical `list` subcommand. `npm run test:mcp` verifies discovery, metadata, public functions, scaffold, file writes, project check, progress, preview/probe and cleanup in both the modern and legacy JSON-RPC flows. None of these prove the host CLI's own internal cancellation/UI behavior or the browser GPU. For real host evidence, record separately that the CLI opened the project, read `exi://api`, called `exi_scaffold`/`exi_project_check` and probed the preview; browser/GPU evidence is also reported separately under the `exi://runtime` contract.

On Windows, use the repository as the client working directory. If the client cannot set `cwd`, replace the relative script argument with the absolute path to `tools/exi-mcp-server.mjs` and set `EXI_MCP_ROOT` to the repository path. Claude Code can also pass the root automatically through `CLAUDE_PROJECT_DIR`; the bridge accepts it as a fallback.

## Recommended agent flow

1. Call `exi_api` and use its manifest instead of guessing method names.
2. Create a `Scene`/`Node` graph with `exi_build_scene` or `exi_create`.
3. Keep returned `$handle` values; pass them back as `{ "$handle": "h1" }`.
4. Use `exi_inspect` before `exi_call`/`exi_get`/`exi_set` when the handle surface is unknown; it reads metadata without invoking getters. Release temporary objects with `exi_release` when finished.
5. Use `exi_scaffold` for a new safe minimal game folder, or `exi_project_open` to adopt an existing repo-local game folder after static checks; then edit the project files.
6. If the client has no native file editor, use `exi_file_list` to discover, `exi_project_apply` for a new multi-file text change, and `exi_file_read`/`exi_file_write` for small individual files; use `exi_file_patch` for a known unique text change (one `find` match is required and zero/multiple matches leave the file unchanged); use `exi_file_begin` → `exi_file_chunk` → `exi_file_commit` for larger source files and `exi_file_abort` for incomplete transfers. Use `exi_asset_list`/`exi_asset_write` for assets up to 512 KiB and `exi_asset_begin` → `exi_asset_chunk` → `exi_asset_commit` for larger assets. Abort incomplete asset transfers with `exi_asset_abort`.
7. After edits, use `exi_project_status({ path: "ai-game" })` when the agent needs one bounded project map: text files, asset metadata, static check and matching preview telemetry are returned together. A missing browser report remains `runtime.ok=false`/`telemetry:null`; this is not GPU evidence. Then run `exi_project_preview({ path: "ai-game" })` for the normal one-call static-check → `/index.html` preview flow; it returns `ok:false` and no preview when a checkable source fails, or `ok:true` with nested `preview.previewId/pageUrl` when the target page is ready. Use `exi_project_check` separately when you only need diagnostics, and `exi_file_check` when iterating on one file. `exi_scaffold` writes the starter files with a staged multi-file commit; the starter square moves with `ArrowLeft/Right/Up/Down`, so the browser RuntimeAgent can do a first input→step→snapshot check with `scenario`; if the commit is interrupted it applies rollback/restore.
8. Use `exi_preview_start({ path: "/ai-game/index.html" })`, then `exi_preview_call`, `exi_preview_batch`, `exi_preview_probe` and `exi_preview_stop` to run, control and inspect the selected game page without inventing a shell command. `exi_preview_start` returns both the server `url` and the target `pageUrl`; it does not return ready until the target page answers HTTP 200. `exi_preview_call` goes to the public engine allowlist of the demo or scaffold RuntimeAgent; `exi_preview_batch` runs up to 8 sequential browser operations in one round trip, supports `$result` and safe `$path` references, and can continue with the remaining calls with `stopOnError:false`, but it is not a transaction. Without a browser agent, the command is cleaned up after a bounded 10-second timeout. Preview startup has a bounded 10-second readiness window; a failed start is cleaned up automatically.
9. Or request `prompts/get` for `exi_create_game` or `exi_verify_runtime` to load the canonical workflow.
10. If the client has browser control, read `exi://runtime`, open the preview page, then inspect `#exi-runtime` after load and after each WebGL2/WebGPU selection. After the real page has posted its report, call `exi_preview_probe` with `path: "/__exi/runtime"` and compare the bounded server telemetry; a synthetic POST is not browser/GPU evidence.
11. Finish with `exi_check({"mode":"doctor"})`, `exi_check({"mode":"test"})` and, before release, `exi_check({"mode":"verify"})`. If you need to abandon a long check/preview call, send `notifications/cancelled` with the same id; the bridge produces no response, cleans up the check child process tree and shuts down the cancelled preview start.

For many small engine operations, prefer one `exi_batch` call with at most 128 entries. Use `{"$result":0}` to reference a previous result without guessing a handle ID; use `{"$result":0,"$path":"fileUploadId"}` to select a safe field from a previous result (for example, to begin/chunk/commit a file in one batch). It is sequential but not transactional; release handles and abort uploads even when a later entry fails.

Use `exi_asset_list` and `exi_asset_write` for binary assets. In project scopes scaffolded or opened with `exi_project_open` in the same session, these tools allow only allowlisted image/audio/font/KTX2 extensions; the `$bytes` array or base64 payload is limited to 512 KiB, and listing to 1,024 assets/32 folder levels. The binary tools cannot write executables, secrets, traversal or symlinks; `overwrite: true` is required to replace an existing asset.

You can read small existing asset bytes with `exi_asset_read` by paging with `offset`/`limit` and, if needed, inspect them with `exi_function({ name: "inspectKTX2", args: [{ "$bytes": "..." }] })`. For assets over 512 KiB, `exi_asset_begin` takes the expected total byte count. Each `exi_asset_chunk` call must follow the previous `receivedBytes` offset in order; after the last part arrives, `exi_asset_commit` moves the temporary file to the target. `exi_asset_abort`, `exi_session_reset` or MCP process shutdown cleans up the temporary upload. Chunked uploads are limited to 64 MiB per asset, 64 MiB pending in total and 8 active transfers.

After `exi_scaffold` for a new project or `exi_project_open` for an existing one, `exi_project_check({"path":"ai-game"})` verifies `.html` references, `.js`/`.mjs` syntax and the `.json` budget in one flow. At most 128 checkable files are scanned and 32 error summaries are returned; this check does not replace HTTP or real GPU/browser execution.

`exi_project_status({"path":"ai-game"})` collects `files[]`, `assets[]`, `projectCheck` and the matching `previews[]` results in the same scope in one response. Besides a preview started with `exi_project_preview`, a preview started directly, such as `exi_preview_start({ path: "/ai-game/index.html" })`, is also matched if its path is inside the session scope. `previews[].runtime` is only the bounded `/__exi/runtime` GET report of a preview the MCP started earlier; report it as static-only if there is no browser telemetry.

`exi_session_status({})` gives the same MCP process's handles, protected handles, scaffold/open scopes, incomplete text/binary uploads and preview metadata in one bounded response without running getters. Because no tokens or temp paths are revealed, stale ids or forgotten uploads can be diagnosed after a reconnect; after `exi_session_reset` all lists should be empty.

`exi_file_begin`/`exi_file_chunk`/`exi_file_commit` only write text files in a project scope opened by scaffold or `exi_project_open`; limits are 4 MiB per file, 16 MiB pending in total and 8 active transfers. Each chunk must be a UTF-8 string of at most 48 KiB in offset order; the temporary file size is verified again before commit. Besides handles, `exi_session_reset` also cleans up pending uploads and the same session's preview child processes. `tools/list` annotations tell clients which tools are read-only or destructive; they are advisory hints, not the security boundary. `exi_scaffold` and `exi_project_open` never write outside the workspace root, reject symlinked path/file entries, and protect engine/test/tool roots. Preview binds only to `127.0.0.1`, shutdown signals clean up preview children, and `exi_check` does not accept arbitrary shell commands. Each MCP-started preview receives a random per-preview token; the page fetches it locally and posts a whitelisted, 4 KiB-bounded runtime report to `/__exi/runtime`. The same token protects `/__exi/runtime-command` and `/__exi/runtime-result`; `RuntimeAgent` consumes only the bounded allowlisted engine operations exposed by `exi_preview_call`/`exi_preview_batch`, with at most 8 calls per batch. The MCP server injects the token only for its own preview requests; it is not returned by `exi_preview_start`. The bridge is a local tool boundary, not a sandbox or an authentication system; keep MCP server access limited to trusted agents.

### Optimistic file versions

The `version` field in the results of `exi_file_read`/`exi_file_list` and `exi_asset_read`/`exi_asset_list` contains `{ bytes, mtimeMs }`. When overwriting an existing text file or asset, carry this object as `expectedVersion` into the `exi_file_write`, `exi_file_begin`, `exi_asset_write`, `exi_asset_begin` or `exi_project_apply` call. If the file has changed since it was read, the bridge returns `EXI_MCP_FILE_CONFLICT`; a chunk upload commit also checks the target again. This optimistic guard is not a lock: an external race window can remain between the last check and the filesystem rename.

### Upload integrity

The `expectedSha256` field is optional for `exi_file_write`/`exi_file_begin` and `exi_asset_write`/`exi_asset_begin`. If an AI CLI computes SHA-256 over large source or asset bytes on its side and sends it, the bridge verifies the hash before the direct write or chunk commit; on a mismatch it returns `EXI_MCP_UPLOAD_INTEGRITY` and no rename to the target happens. Successful direct write/commit results carry a `sha256` field. Use it together with `expectedVersion` to protect an existing target from races.
