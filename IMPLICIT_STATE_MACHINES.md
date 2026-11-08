# Implicit State Machines — ExiEngine Inventory

Full audit of the implicit state machines in this repository: state whose set of valid values and
legal transitions is implied by scattered code (booleans, counters, sentinels, empty strings,
promise ordering) instead of being formalized in one place with guarded transitions.

- **Canonical audit date:** Nov 2026 (generated from a full-source scan; all cited line numbers verified against the working tree).
- **Coverage:** `src/**` (36 files), `tools/exi-mcp-server.mjs`, `server.mjs`. Tests were consulted only as corroboration.
- **Result: 115 implicit state machines** (see §1–§7), plus 7 recurring patterns (§8) and 8 sharpest-edge deep dives with transition tables and proposed guards (§9).
- Characterization shorthand used below: ⚠️ = a representable path to silent corruption, a stuck state, or a leak.
- Notation: `(v)` = flagged potential reviewer follow-up; all other entries were verified during the scan.

> Landing note (Nov 2026): all eight §9 guards (9.1–9.7 fully; 9.8 limited to the `unlock()` wiring) are now
> implemented in production code, each with its own tests — see the **Status — LANDED** block under each §9
> heading and the ledger in §11. On audit, one original §9.8 claim proved wrong (`connectedGamepadIndices`
> is actually read at `input.js:559` and was NOT deleted; for symmetry the same correction applies below
> in rows #36/#38). Full `npm test` run: all stages green (unit 217/217, including the new guards' hooks).
> Nothing was weakened to get there.

---

## 1. Engine core — `src/core/exi-engine.js`, `node.js`, `camera.js`, `profiler.js`, `demo.js`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 1 | Run lifecycle | `exi-engine.js:121-132, 633-639` | `{running, paused, visibilityPaused}` booleans ⊗ `_lifecycleState` string ⊗ `destroyed` ⊗ `initialized` | `start/pause/stop/resume` + visibility/pagehide + destroy | ⚠️ `"ready"` derived but never stored; flags writable directly (invalid combos representable); `stop()` not guarded by `destroyed` |
| 2 | Async init | `exi-engine.js:131-133, 250-293` | `initialized` + `_initPromise` (null / pending) | `init()` coalesces concurrent callers; failure → destroy + rethrow | ⚠️ after a failed init, re-init rejects forever |
| 3 | Renderer-loss recovery | `exi-engine.js:98-111, 206-227` | healthy / lost-idle / lost-paused via `_rendererLost` + `_rendererLostPaused` | `context-lost → err → context-restored` | ⚠️ plain `context-lost` leaves the engine "running" on a dead context; `_rendererLost` is write-only inside engine code |
| 4 | Backend fallback | `exi-engine.js:55, 100, 218-226, 262-268, 295-334` | `preference` ⊗ `fallbackUsed` latch ⊗ `_fallbackPromise` in-flight gate ⊗ transient `renderer === null` | WebGPU→WebGL2 fallback; loss routing via `instanceof WebGL2Renderer` | ⚠️ one-way: `fallbackUsed` never resets, WebGPU is never retried after a non-recoverable loss |
| 5 | Prepare latch | `exi-engine.js:116, 413-416, 616, 654` | `prepared` boolean | invalidated by setScene/setOverlay/backend switch/destroy | scene-content edits do not invalidate — stale `prepared` accepted silently |
| 6 | Frame clock | `exi-engine.js:124-125, 568-598, 614-616, 643-666` | `raf === 0` (no frame scheduled), `lastTime === 0` (first frame), `accumulator` backlog, per-frame `renderFailed` | RAF loop and manual `step()` are alternatives guarded on `!this.running` | backlog overflow silently drops updates; any callback throw lands the engine in `stopped` |
| 7 | Audio-suspend mirror | `exi-engine.js:127-128, 529-558` | `audioSuspendedByEngine` + `audioLifecycleGeneration` counter vs the real `AudioContext.state` | `suspendAudio/resumeAudio` on pause/stop/start/destroy | ⚠️ three sources of truth can disagree; the generation counter makes races lose silently |
| 8 | Pointer capture | `exi-engine.js:139-140, 894-949` | per pointerId: null ⇄ `{target, scope:"scene"\|"overlay"}` (+ singular `pointerTarget` mirror) | down/up/cancel; bulk-clear on setScene/setOverlay/fallback/destroy | ⚠️ captured-then-destroyed node kept in the map until release; `scope` string is a 2-value mode |
| 9 | Pointer hover | `exi-engine.js:907-922, 957-962` | per pointerId `{target, scope, type}`; change detected by value-compare | move / touch-release / vanished-pointer sweep | ⚠️ mouse hover survives pointer-up implicitly; destroyed hover targets no-op silently |
| 10 | Keyboard focus | `exi-engine.js:703-768` | `focusedNode` ⇄ `node.focused` (same phase stored twice) | focus/blur/focusNext/pointerdown autofocus/lazy blur on key dispatch | ⚠️ destroyed focused node keeps `focused === true` until the next key event |
| 11 | Config kernel | `exi-engine.js:82-89, 230-236, 391-403` | snapshot-vs-live compare; only sanctioned setters re-snapshot | `setLogicalSize/setResizeMode` | mutation detected only on the next guarded call — invalid window in between |
| 12 | Scene-graph membership | `node.js:209, 234-263, 384, 504, 540-555` | `parent` null ⇄ node ⊗ `destroyed` latch | add/remove/reparent/destroy | add validates-then-mutates atomically; post-destroy nodes retain stale `visible/world*/focused` |
| 13 | World-matrix dirty | `node.js:211-218, 469-482, 500` | `_worldVersion` counter + `-1`/`undefined` "never computed" sentinels | recompute-vs-skip decided by version/field compare | correctness rests on the version bumping on every matrix touch |
| 14 | Lazy z-sort | `node.js:250, 260, 519-522, 531-534` | `childrenDirty` boolean, cleared by whichever collector runs first | add/remove → sort on collect | ⚠️ direct `zIndex` changes never set the flag; two collectors race for one flag |
| 15 | RenderGroup-subtree flag | `node.js:205, 251, 261, 265-281` | `_renderGroupSubtree` recomputed bottom-up, early-return on equal | add/remove/destroy propagate | ⚠️ foreign mutation of `children` leaves the flag wrong |
| 16 | Interpolation | `node.js:219, 335-378` + `exi-engine.js:574-599` | per engine: enabled → captured → applied → restored | capture/apply/restore sequenced by the fixed-step loop, restore in `finally` | live `position` is transiently "wrong" mid-frame by design |
| 17 | Traversal stamp | `node.js:5, 230, 10-18` + every DFS entry | module-global `nextTraversalStamp` + per-node `_lastTraversalStamp` visited marker | all DFS funnels through `beginTraversal` | wraps at `MAX_SAFE_INTEGER` → theoretical false cycle |
| 18 | Property self-repair | `node.js:465-499` | raw invalid values (alpha>1, junk filter string, fake mask) between frames | repaired inside `updateWorldMatrix` | ⚠️ silent repair; unrepairable input throws inconsistently |
| 19 | Camera shake | `camera.js:44-48, 163-186, 189-219` | idle (`shakeDuration===0`) ⇄ active; applied offset stored inline in `position` | shake/update/clearShake | ⚠️ invalid args silently cancel; the position↔offset pairing is a fragile invariant |
| 20 | Camera follow | `camera.js:150-212` | `followTarget` null ⇄ set (+ 4-branch deadzone per axis) | follow/clearFollow/update | destroyed target followed forever, updates silently skipped |
| 21 | Profiler window | `profiler.js:2-21` | `started` flag; 1-second FPS window counter | first `begin` → rollover every 1 s | silent; `fps` stale until first rollover |
| 22 | Demo boot | `demo.js:59-62, 127-156` | `engine`/`runtimeAgent` null ⇄ live; `runtimeToken === ""` disables telemetry | destroy-and-reboot on renderer pick; 250 ms telemetry throttle | failure state visible only in DOM labels |

## 2. Collision & physics — `src/core/collision.js`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 23 | Collider bounds cache | `collision.js:206-222, 243-251` | never-built (`null` + `-1` + NaN) / fresh / stale — three sentinel styles for one state | `setBounds` push invalidation + version/field-compare pull rebuild | no throws; `enabled` toggling deliberately does not stale the geometry (convention only) |
| 24 | Spatial index lifecycle | `collision.js:268, 285-296, 335-344, 367-396, 413-415, 829-837` | `spatialDirty` + per-collider snapshot signature: never-built / clean / dirty-with-stale-index | add/remove/bounds/type changes → auto-rebuild on guarded queries | ⚠️ direct cell inspection bypasses the rebuild window; "never built" ≡ "built empty" |
| 25 | Query token | `collision.js:269-270, 381, 398-411, 545` | `queryToken` + `candidateStamp` per-collider visited marker | bump per query; wrap resets the epoch | wrap handled; one meaning ("visit epoch") spread across two fields |
| 26 | Body type exclusivity | `collision.js:556-599, 638, 930, 937` | dynamic / static / kinematic = 2 booleans (3 valid states, 1 invalid combo) | constructor + `setStatic/setKinematic` throw on conflict | ⚠️ direct field writes can silently produce the invalid combo |
| 27 | Grounded memory | `collision.js:565-568, 929-941, 985-1011, 895` | `grounded` × `_wasGrounded` (4 combos) + `_stepDelta*` platform carry | per-step snapshot → Y-resolution hit → `finally` wipe | ⚠️ early-return paths skip the snapshot → stale grounded with fresh `_wasGrounded` |
| 28 | Contact diff graph | `collision.js:629-632, 88-96, 685-696, 843-877, 1013-1032` | per pair {absent, live} over two generations → `"begin"/"stay"/"end"` by map diff | step diff; forced end on remove/destroy/clear | ⚠️ all callbacks share ONE reused `contactInfo` scratch object (see §9.7) |
| 29 | Query slots & sweep | `collision.js:617-648, 716-795, 941-942, 1006` | `activeBody` slot; `sweepNearestDistance === Infinity` = "no hit"; filter context | save/restore around every query API; per-body slot in step, one outer `finally` | implicit parameters via mutable fields; single-copy scratch clobbers on re-entry |
| 30 | Graphics item cache | `graphics.js:96-99, 102-146, 207-299` | `itemsDirty` + `boundsCache` null: dirty/built chain | every draw bumps the trio; rebuild clears | ⚠️ the invalidate-pair is written by hand at 6 sites; `destroy()` leaves flags describing pre-destroy state |
| 31 | Nine-slice geometry | `nine-slice-sprite.js:56-64, 83-130, 135-147` | 10-field signature; only 4 mirrors initialized (NaN), the rest `undefined` (see §9.6) | lazy rebuild on draw; material refresh every frame | ⚠️ two sentinel flavors for "never built" — correctness rests on them never colliding |
| 32 | RenderGroup effect targets | `render-group.js:45-107, 111-130, 154-163` | `effectTargetCount === -1` never-synced; targets 0-2; scene null/built | signature compare → grow/shrink; 0 targets → scene teardown | pull-based compare only; the "0 effects but stale live scene" combo is caught defensively at one site |

(`math.js` carries no machines: pure value transforms, `MAX_WORLD_COORDINATE` clamping only.)

## 3. Input, audio, animation game-feel — `input.js`, `audio-manager.js`, `animation.js`, `animated-sprite.js`, `particle-emitter.js`, `text.js`, `sprite.js`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 33 | Key phase | `input.js:176-204, 321-329, 603-604` | held / just-pressed / just-released = membership across 3 Sets | keydown/up; edges wiped per `endFrame`; blur → release-all | correctness rides entirely on `endFrame()` in the engine `finally` |
| 34 | Pointer button mask | `input.js:183-199, 263-318, 330-343, 609-625` | per button 4 bitmasks (buttons/pressed/released/cancelled) + `moved` + wheel deltas; "drag" never stored | down/up/cancel/leave/move/wheel; endFrame zeroes edges | ⚠️ `button: 0` means both "button 0" and "no button" |
| 35 | Pointer election | `input.js:184-186, 222-239, 288, 341-343, 626` | primary (`this.pointer`) vs secondary record; `activePointerId` | promote-on-first-event / never switch mid-drag / promote-on-release | ⚠️ wheel can synthesize a record for a pointer that never sent an event; two truths reconciled only at endFrame |
| 36 | Gamepad poll | `input.js:179-180, 344-351, 523-568, 600-608` | missing → connected → disconnected-but-remembered → deleted (Map entry phases) | per-frame poll diffs buttons into edges | ✅ audit correction (§9.8): `connectedGamepadIndices` is NOT write-only — it is read at `input.js:559` as the disconnect sweep's ground truth |
| 37 | `destroyed` latch family | `input.js:187, 630-631`; `audio-manager.js:74, 79`; `text.js:256, 274, 367` | boolean latch; handlers become no-op sinks | destroy → silent forever | one-way, no error signal afterwards |
| 38 | AudioContext phase | `audio-manager.js:58, 74-96, 124, 169-177, 424-431` | `null` → constructed → running/suspended (platform string) | lazy ensure; `unlock()`; `suspend/resume` | ✅ OK (§9.8 landed): the engine's gesture listeners now call `unlock()` — no longer a dead caller |
| 39 | Audio load pipeline | `audio-manager.js:62-75, 265-267, 288-326, 425-427` | absent / loading / decoded per key across 4 Maps + `keyGenerations` counter | enter-load → commit → settle; unload/destroy invalidates in-flight continuations | ⚠️ "loading" invisible to `has(name)`; generation-mismatch throws mid-callback |
| 40 | Voice lifecycle | `audio-manager.js:67-72, 181-258, 377-419` | alive / ended-pending / stopped across 6 parallel collections; panner attach sub-phase | start → `ended` cleanup (double-registered) → wipe | `activeVoices` membership duplicates the `cleaned` latch (two truths); capacity throws |
| 41 | Bus volume/mute/fade | `audio-manager.js:114-164` | `bus.volume`, `bus.muted`, real gain node value, invisible in-flight ramp | setVolume/setMuted/fadeBus | ⚠️ JS reports the fade *target* while the node still ramps |
| 42 | Tween playhead | `animation.js:74-98, 120` | `elapsed/duration`, `finished`, self-decrementing `loop` counter, yoyo direction = swapped `from`/`to` | update → loop turn → terminal | ⚠️ Animator membership ≡ `!finished` — same phase stored twice |
| 43 | AnimatedSprite playhead | `animated-sprite.js:23-97` | playing / completed / direction ±1 / currentFrame / elapsed; `frameRate <= 0` = frozen-but-playing | play (replay-vs-resume decided by `completed`), stop, pause, gotoFrame (keeps `playing`) | ⚠️ `playing=false && completed=false` (user-stopped) is ambiguous vs terminal |
| 44 | Particle emission | `particle-emitter.js:54, 74, 120-123` | integer+fractional `spawnAccumulator`: owed spawns / sub-spawn residue; `rate === 0` = hidden pause | accumulate → floor → emit; `clear()` resets | rate-0 backlog is still owed; capacity drops are silent |
| 45 | Particle alive↔pool | `particle-emitter.js:52-53, 101-132, 243-244` | pool membership = dead; compaction write is the transition; fading computed, not stored | emit (revive) → age ≥ life (retire) | safe today; new particle fields must be mirrored in revival or pool corpses leak stale values |
| 46 | Render-data handoff | `particle-emitter.js:55-64, 138-142, 163-173, 202-212` + `batch.js:252, 275` | `lastCulledCount` one-shot producer→consumer flag (consumer zeroes it); `gpuCulling`/`gpuSource` path flags | produce → consume → reset | producer-owned variable with a second writer outside the file |
| 47 | Sprite geometry cache | `sprite.js:23-38, 57-116, 120-130` | NaN/null sentinels; no dirty flag — staleness derived at draw | 12-mirror compare → rebuild or minimal refresh | anchor/size stored in two mirror families that must be kept aligned by the compare logic |
| 48 | Text data ownership | `text.js:385-387, 405, 437-503` | borrowed (cacheEntry) / self-owned-new (`ownsNewCanvas`) / stale (key mismatch); `text === null` forces first redraw | redraw → borrow or fallback → release/return-to-own | budget-blocked fallback is silent; three paths reach the same pixel data |
| 49 | TextCache LRU + refs | `text.js:163-165, 181-194, 204-216, 227-231` | 0-refs-evictable / pinned / dead-texture; `clock` as LRU scalar | acquire/release/evict/hard-remove | no-victim → `null` silently degrades to uncached rendering |
| 50 | GlyphAtlas cursor | `text.js:251-256, 278-315, 319-370` | shelf-packer cursors; "full-but-alive"; destroyed poisoning; `complexScriptFallbacks` counter | hit → row-wrap → stamp; misses → canvas fallback forever | capacity rejections per-render silent, retry-free |

## 4. Rendering — `src/render/webgl2-renderer.js`, `webgpu-renderer.js`, `batch.js`, small pass modules

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 51 | GL context lifecycle | `webgl2-renderer.js:203, 211-231, 310-334` | live → lost → restored (boolean + rebuild-all) | context events + `buildResources()` | loss frames silently no-op; restore-fail classified non-recoverable |
| 52 | GL buffer growth | `webgl2-renderer.js:157-161, 555-568, 573-595` | `bufferSize === 0` → pow2 ladder | draw → compare → grow | `bufferSize` is a second truth for "buffer exists" |
| 53 | GL static upload key | `webgl2-renderer.js:600-628, 545-551` | per-owner `entry.key` vs batch `staticKey` | same key → skip upload | ⚠️ key is the only invalidation for GPU bytes (see §9.4) |
| 54 | GL texture caches | `webgl2-renderer.js:365-396, 424-428, 481` | version / filter / byte-size across 4 parallel Maps | version bump → re-upload; prune on destroy | `textureBytes` counter vs per-entry map can drift via a missed prune |
| 55 | GL render targets | `webgl2-renderer.js:498-541` | size-equality cache-compare; FBO completeness | first use / resize → destroy + recreate | byte accounting silently recomputed if the map misses |
| 56 | Clear-mode fork | `webgl2-renderer.js:238, 665, 714` | `clearBeforeRender` baked into the GL context at creation | per-frame read | ⚠️ runtime mutation of the flag silently diverges from `preserveDrawingBuffer` |
| 57 | Scissor per-pass | `webgl2-renderer.js:726-728, 773`; `scissor.js:1-2`; `webgpu-renderer.js:885-887` | enabled+set vs disabled (GL) / full-rect (WebGPU), from a `null` sentinel | per batch; GL finally always disables | shared scratch rect object; two coordinate conventions for the same state |
| 58 | Config snapshots (both backends) | `webgl2-renderer.js:191-194, 253, 407-418, 829`; `webgpu-renderer.js:302-309, 1006-1024` | init-time freeze of limits | compare → throw on drift | GL snapshot survives `destroy()` unreset (healed only by re-snapshot) |
| 59 | GL attribute-enable leakage | `webgl2-renderer.js:653-662, 755-757` | attrib 3..4 stay enabled+divisor 1 with no `disableVertexAttribArray` anywhere | instanced draw enables; regular draw re-enables 0..2 only | ⚠️ silent; relies on location overlap being harmless |
| 60 | WebGPU device lost | `webgpu-renderer.js:243-259, 277, 490-525, 939-954` | live → lost (one-way); pipelines/buffers/bind groups all nulled | `device.lost.then` OR conservative render-throw escalation | WebGPU treats *any* unexpected render error as fatal device loss — no GL-style recovery exists |
| 61 | Canvas configure | `webgpu-renderer.js:280-291, 390` | presence of `device && context && format` = configured (no change detection) | init → configure; every `resize()` reconfigures | ⚠️ device loss does not clear these — post-loss resize configures a dead device |
| 62 | Pipeline table | `webgpu-renderer.js:187-188, 351-358, 412-415` | `{normal, additive, multiply}` + `this.pipeline` alias + fallback chain | blend mode → lookup | ⚠️ unknown mode silently falls back to `normal`; alias duplicates a table entry |
| 63 | Bind groups per texture | `webgpu-renderer.js:690, 706-717` | `{bindGroup, version, filter}` = three staleness axes on one record | filter change → rebuild bindGroup only; version bump → copy only | record shared between `renderTargets` and `textureBinds` maps (GL factors the same state into 3 maps — differently split truths) |
| 64 | Filter buffer + offsets | `webgpu-renderer.js:443-469, 479, 883-934` | `usesFilters = layout presence`; buffer+bindGroup twin; per-batch offset ring at 256-byte stride | first filter → allocate; growth → recreate both | validity needs BOTH size and bind group non-null (two truths for "usable") |
| 65 | GPU-cull cache | `webgpu-renderer.js:527-588, 595-608, 614-626` | 5 buffers + 2 bind groups per owner; "new buffers ⇒ rebuild bind groups by nulling" | first/growth/reuse/prune | creation failure rolls back created handles; memory counters self-healing |
| 66 | Error scope pair | `webgpu-renderer.js:313-315, 378-384` | `errorScopeOpen` boolean around push/pop | open → pop (success or defensive swallow) | micro-machine inside `buildResources` |
| 67 | **Static render key/version (shared, 4 consumers)** | `batch.js:17-43, 225, 228, 246-249` | compare ~25 fields incl. `contentVersion`; wrap at `MAX_SAFE_INTEGER`; empty-cache sentinel `{key, texture: null, vertexCount: 0}` | any drift → version++ → new key consumed by GL (`:625`) and WebGPU (`:664`) | ⚠️ CPU cache key and GPU buffer key validated independently — cross-layer stale window (see §9.4) |
| 68 | Open batch strip-mining | `batch.js:212, 227-315` | `current` pointer: no-open ⇄ open (first-item zero-copy vs force-copy sub-state) | per-item compare clause merge-or-flush | fully silent merge/flush |
| 69 | Batch pool | `batch.js:69-74, 114-130` | soft-clear within cursor+16 (`BATCH_POOL_RETENTION`), hard-clear beyond | per-frame cursor reset → alloc → trim | wastage window rather than hazard |
| 70 | Materialize → compact | `batch.js:336-363` | JS values arrays → typed `data` → in-place compacted batches | finalization only | silent |
| 71 | Render-order sort cache | `batch.js:167-184` | reusable sorted output vs rebuild, via order/Set/Z compare | rebuild re-sorts and re-seeds maps | `renderableZ` staleness caught only for present values |
| 72 | Post-process ping-pong | `post-process.js:3-17` | source alternator over `targets[0] ⇄ targets[1] ⇄ group.target`; parity picks destination | per effect pass; `sprite` is a mutated shared carrier | fragile but order is engine-enforced; feedback guard below |
| 73 | Feedback-loop guard | `webgl2-renderer.js:687`; `webgpu-renderer.js:840-844` | "target already referenced as a texture in this pass" | scan → throw | throw-based (the good one); WebGPU adds an error code GL lacks |

## 5. Assets & SpriteBatch — `src/assets/*`, `src/core/sprite-batch.js`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 74 | Loader destroyed state | `asset-loader.js:286-287, 295-526, 605-610` | destroyed ⊗ `pendingControllers` membership | destroy aborts in-flight, closes decoders | ⚠️ transient unguarded window between decode completion and `waitForAbort` settle |
| 75 | Request dedupe | `asset-loader.js:282-283, 320-326, 405, 442, 506` | queued / in-flight / settled-and-forgotten keyed by composite descriptor | settle deletes itself on either outcome | failed loads leave **no record** — next caller silently refetches |
| 76 | Texture cache admission | `asset-loader.js:278-281, 357-362, 440-476, 592-603` | cached / raced-out / declined; `cacheGeneration` + per-URL generations | decode-race resolution at publish time | budget vs reality drifts silently by design |
| 77 | Sealed config guards | `asset-loader.js:258-293`; `save-store.js:47-53`; `texture-atlas.js:80-87` | snapshot mirrors vs live values | compare → throw | illegal writes detected only at next call — invalid live window |
| 78 | Abort race | `asset-loader.js:244-258` | first-settle-wins `settled` latch | operation vs abort signal | aborted caller's underlying load keeps running as a ghost and still counts against the budget |
| 79 | loadMany worker pool | `asset-loader.js:544-586` | cursor overshoot `[total, total+workers)`; `stopOnError` as pool-freeze | `finally` increments `loaded` on every worker attempt | ⚠️ progress counts attempts, not successes (`loaded == total` with errors pending) |
| 80 | Texture version → GPU | `texture.js:47-105`; `webgl2-renderer.js:381-389`; `webgpu-renderer.js:690-717` | authoritative `baseTexture.version` mirrored into both renderers; `source === null && version === 0` = placeholder-white | `markDirty/updateSource` bump; renderers compare-and-skip | dual-filter truth for aliased sub-textures; no bump on destroy — liveness handled by a separate guard |
| 81 | Atlas pack loop | `texture-atlas.js:209-233` | attempt → widen → retry → publish; transient `placements` becomes immutable `frames` | collision retry loop | bounded widening; safe |
| 82 | Atlas death mirror | `texture-atlas.js:80-107, 129, 138-139` | lazily-synced death discovered per access | `invalidateIfTextureDestroyed` → `destroyed = true` | ⚠️ `get()` throws on discovered death, `has()` silently returns false — same state, two outcomes |
| 83 | SaveStore fallback | `save-store.js:43-71` | storage-backed vs fallback decode paths; write-through, no dirty layer | falls back on absence/oversize/malform | non-normalized native quota errors propagate |
| 84 | JSON scanner | `asset-loader.js:160-214`; `save-store.js:14-40` | depth/node/string-escape states; explicit per-frame `"key"\|"value"` mini-enum in the stack walk | char-stream walking | throw-based, clean |
| 85 | RenderTexture lock | `render-texture.js:24-41` | target-locked subclass narrows base transitions (`subTexture/updateSource` forever forbidden) | resize bumps `version` | throw-based, clean |
| 86 | SpriteBatch dirty trio | `sprite-batch.js:121-123, 156-158, 166-176, 703, 708` | `itemsDirty` + `contentVersion` + nulled memo keys — three channels of one phase | mutating ops → all three; consumers clear | redundant channels must be co-written by hand at every site |
| 87 | SpriteBatch per-index animation | `sprite-batch.js:244-306` | per-sprite playhead mirroring the public AnimatedSprite (`playSprite/stopSprite/gotoSpriteFrame`, direction, loop, onComplete) | same shape as #43 | ⚠️ `sprite.texture` is a re-synced copy of `frames[currentFrame]` — a missed sync draws stale UVs, no throw |
| 88 | SpriteBatch instance cache | `sprite-batch.js:123-145, 406-446` | camera-fingerprint validity folded with GPU-culling mode in one snapshot record | compare-all → save | mode flip fully invalidates one transition |
| 89 | SpriteBatch spatial index | `sprite-batch.js:148-151, 535-583, 664-687` | `spatialIndexVersion` vs contentVersion; `visibleToken` Uint32 rotation = "seen this frame" | build → stamp → overflow refill | ⚠️ world-transform changes do not auto-invalidate — callers must `invalidate()`; degenerate camera falls back to scan-everything |
| 90 | Staged addSprites | `sprite-batch.js:191-214` | two-phase validate-then-mutate with a temporary `pending` array; `MAX_SPRITES` as insert gate | commit → invalidate | throw-clean rollback |

## 6. Tilemap & AI runtime — `src/core/tilemap.js`, `src/ai/runtime-agent.js`, `public-methods.js`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 91 | Tile cell sentinel | `tilemap.js:68, 123-132, 148, 35` | any-negative = erased ("empty" checked as both `=== -1` and `< 0`) | setTile/setTiles/setRegion | ⚠️ out-of-bounds writes silently ignored while bad indices throw |
| 92 | **TileMap dirty pair (cross-consumer)** | `tilemap.js:73, 143-144, 166, 194-195, 200-201, 371-374, 438, 463` | `itemsDirty` + `contentVersion` (same phase, two truths, consumed at different times) | setters bump both; instance and render consumers each clear | ⚠️ **verified corruption path**: `getInstanceItems` clears the flag without building `renderItems` → `getRenderItems` returns stale geometry (see §9.1) |
| 93 | TileMap instance cache | `tilemap.js:88-105, 306-319, 321-334, 370-377` | ~20-field camera fingerprint; CPU validity vs GPU-culling mode in one snapshot | rebuild → save; hit short-circuit | raced transitions double-rebuild (perf only); `lastCulledCount` leaks rebuild info |
| 94 | TileMap frameCache | `tilemap.js:70, 423-435, 472-473` | miss → create → hold, keyed by tile index only | getFrame | ⚠️ no texture identity in the key — reassigning `this.texture` silently serves sub-textures of the old atlas |
| 95 | Static-body controller | `tilemap.js:242-296, 265-285, 470-471` | attached → rebuilding → destroyed with per-stage rollback arrays | swap previous↔next bodies with rollback | a throw inside `add` mid-swap leaves a half-detached world (in-flight locals only) |
| 96 | Run-length scan | `tilemap.js:208-236` | `runStart === -1` open/closed runs; `active`↔`current` row-swap maps | per-row scan | output array unquestioningly `length = 0`-cleared — caller-shared data destroyed silently |
| 97 | ActiveTileIndices aliasing | `tilemap.js:81, 85, 338-342` | culling-off/degenerate signaled by *which array identity* is returned | fall back to `activeTileIndices` | callers holding the return value across frames get recycled storage unmarked |
| 98 | RuntimeAgent poll scheduler | `runtime-agent.js:429, 438-441, 465-519` | idle → scheduled (`timer`) → polling (`polling` + `controller`) | start/stop/schedule; poll re-arms itself in `finally` | ⚠️ 4 variables encode one phase; `stop()` forces `polling = false` without identity-aware reset; an await that never resolves wedges the loop silently (see §9.2) |
| 99 | RuntimeAgent handle table | `runtime-agent.js:431-437, 523-537, 714, 791-797` | unregistered → registered → protected-root → released; `MAX_HANDLES` budget | register/release/auto-register | a throwing `destroy()` leaves a half-released handle; reverse/forward maps can drift (re-checked at every use) |
| 100 | Observation hash store | `runtime-agent.js:24-27, 199, 233, 239-246, 302, 327-328, 346-358` | per-key `snapshotHashes` Map + closure `previousHash = null`; pagination `{offset, nextOffset: null}` | observe → hash → dedupe; first observation always `changed` | ⚠️ map never evicted — survives handles and page navigations (see §9.3); overlapping observe calls can dedupe each other |
| 101 | Scenario steering | `runtime-agent.js:177, 660-696` | `wasRunning` snapshot → per-frame step(s) → `finally` resume | validate → stop → step/observe/snapshot | ⚠️ `resumed` can false-report if `start()` itself throws (resume lives in `finally`) |
| 102 | executeBatch pipeline | `runtime-agent.js:406, 635-650` | per-index result slots carried into later args; `stopOnError`; `stopped` derived from `results.length < calls.length` | sequence with early stop | reference resolution conflates "not-yet-run" and "failed" into one error |
| 103 | Public-methods gate | `public-methods.js:3-28` | static allowlist (TileMap dirty machinery deliberately not AI-callable) | n/a | config, not a machine |

## 7. MCP server & dev server — `tools/exi-mcp-server.mjs`, `server.mjs`

| # | Machine | Evidence | Hidden states | Transitions | Risk |
|---|---------|----------|---------------|-------------|------|
| 104 | Session scope | `exi-mcp-server.mjs:64, 278-290, 1434, 1446-1453, 2112-2118` | `scaffoldDirectories` Set membership (longest-prefix match) | scaffold/open success adds; failed append deletes; reset clears | scope rollback deletes membership but leaves files from a failed check on disk |
| 105 | Asset upload `u#` | `exi-mcp-server.mjs:552-618, 63-70, 510-532, 549` | begin → receiving → complete; done-ness triply encoded (`state` string, `receivedBytes === expected`, `state === "complete"`) | chunk offset must equal `receivedBytes` (counter trusted, never re-lstat'd) | ⚠️ temp registered only after first write; process death orphans `.exi-upload-*`; stale temp makes `wx`-able begin fail on retry (see §9.5) |
| 106 | File upload `f#` | `exi-mcp-server.mjs:809-871, 801-807` | same lifecycle; disk-authoritative variant (each chunk cross-checks `lstat` size) | same | same leak window; deliberate asymmetry vs #105 |
| 107 | Atomic single-file write | `exi-mcp-server.mjs:259-294, 576-615` | temp `.exi-write-*` → backup `.exi-backup-*` → rename → unlink | recoverable vs unrecoverable failure stages | restore failure deliberately persists the backup + `restoreError` |
| 108 | project_apply transaction | `exi-mcp-server.mjs:699-775` | per-entry `{tempPath, backupPath, committed}` = 4-phase | stage-all → commit → cleanup / rollback | reverse-order rollback; backup-unlink failures aggregated into `restoreError`, never silent |
| 109 | Scaffold transaction | `exi-mcp-server.mjs:1356-1434` | twin of #108 + `targetExisted` latch for dir-removal rollback | shared monotonic `nextWriteId` | collision-free only by sequence |
| 110 | Preview process `p#` | `exi-mcp-server.mjs:63, 1695-1771, 1962-1984` | starting / ready / stopping / exited (`exited` × live `exitCode` × `state` string) | poll-until-ready; idempotent stop | ⚠️ exited children linger in the map until the next prune call; port probe has a TOCTOU window |
| 111 | Preview token handshake | `exi-mcp-server.mjs:1746-1748, 1955`; `server.mjs:44-70, 166-171` | token minted → env → fetched once by the page (`.catch(() => "")` disables telemetry in perpetuity) | 3-party supply chain | token endpoint is unauthenticated; loopback-only is the entire security boundary |
| 112 | Runtime command `r#` | `exi-mcp-server.mjs:1895-1939` | pending → poll → completed / deadline | 10 s deadline → cancellation DELETE | completion-race latch; id mismatch throws |
| 113 | server.mjs command mailbox | `server.mjs:51-64, 129-142, 176-238` | `runtimeCommands[]` → `runtimeInFlight` (leased, expiring) → `runtimeResults` (answered, consumed exactly-once on read) | POST/GET/DELETE flows | ⚠️ expired leases re-enter at queue *head* — a slow page can receive a command twice; the id check is the only defense |
| 114 | server.mjs telemetry state | `server.mjs:45-59, 263-269, 275-288` | `runtimeState` null ⇄ record + TTL (GET itself nulls expired state) | POST refreshes; GET burns | 404 fires even when ready was posted earlier — freshness dual-encoded |
| 115 | MCP stdio request lifecycle | `exi-mcp-server.mjs:2357-2412` | `activeRequests` cancel map + `toolQueue` serialization chain + `shuttingDown` latch | cancel → suppress response; shutdown → abort-all → exit 0 | post-call cancel silently ignored; queue slots fixed by ids freed in execution order |

---

## 8. Cross-cutting patterns (root causes)

1. **Same phase stored twice (or three times)** — engine lifecycle flags vs `_lifecycleState` (#1), focus mirror (#10), Tween/Animator membership (#42), TileMap `itemsDirty` + `contentVersion` (#92), audio `cleaned` latch vs `activeVoices` (#40). Every one can drift.
2. **Sentinel soup** — `-1`, `0`, `NaN`, `undefined`, `null`, `""`, `Infinity` all mean "unset/never" in different caches (#23, #31, #47, #52, #91). A shared "EMPTY" convention would remove the ambiguity class.
3. **Generation counters** invalidate async races — `cacheGeneration` (#76), `keyGenerations` (#39), `audioLifecycleGeneration` (#7), traversal stamps (#17), `visibleToken` (#89). Three of them wrap at `MAX_SAFE_INTEGER`/Uint32 boundaries (#17, #67, #89).
4. **One-shot consumption flags** — producer sets, renderer zeroes (#46, #101).
5. **In-flight serialization by null/promise** — `_initPromise` (#2), `_fallbackPromise` (#4), `pendingLoads` (#39), `pendingBytes/pendingTextures` (#75), preview `stopPromise` (#110). Implicit mutexes.
6. **Counters as state** — loading invisible to `has()` (#39), loadMany counts attempts (#79), loader does not record failures (#75).
7. **Channel-as-state** — array identity as a mode flag (#97), `scope` strings (#8), CPU-vs-GPU double key truth (#67).

## 9. The 8 sharpest edges — transition tables + proposed guards

Each item below: *(a)* verified evidence, *(b)* the state/transition table, *(c)* the failure
sequence, *(d)* a minimal in-style fix (the repo is dependency-free and allocation-sensitive, so
proposals prefer one-field changes, pathological-path guards, and stale-temp sweeps over resolvers),
*(e)* the test hook, which the fix must extend (never weakened).

### 9.1 TileMap render/instance dirty cross-consumer ⚠️⚡ — LANDED
**Status — LANDED:** Option A as preferred in the original proposal — consumers split (`renderItemsDirty` /
`instanceItemsDirty`, both bumped by `setTile`/`setTiles`/`setRegion`/`rebuild`; each consumer clears only its
own), plus destroyed early-return guards that make post-destroy reads safe (the destroy-audit bullet), and a
`this.texture?.baseTexture?.version ?? -1` argument handed to the §9.4 static-key update from
`getStaticRenderKey`. Existing `engine-smoke.mjs` offscreen-tilemap assert was adapted to pin **both** split
flags (field was renamed by design, invariant intact — not a weakening).
**Evidence (verified):** `tilemap.js:143-144` (both bump), `371-374` (instance path clears the
flag), `438` (render guard checks the flag only), `463` (render path clears the flag).

| # | Trigger | Guard today | Effect |
|---|---------|-------------|--------|
| T1 | `setTile` with changed value/flags (`131-145`) | index throws (`127`); out-of-bounds silently ignored (`132`) | `itemsDirty = true; contentVersion += 1` |
| T2 | `setTiles` (`150-168`) | shape throws; silent no-op if unchanged | same, only on change |
| T3 | `setRegion` (`170-197`) | shape throws | same |
| T4 | `rebuild()` force-invalidate (`199-203`) | — | same |
| T5 | `getInstanceItems` clean hit (`370`) | `!itemsDirty && hasInstanceCache(...)` (compares `contentVersion`) | return cached instance items |
| T6 | `getInstanceItems` rebuild (`371-374`) | `itemsDirty` | rebuilds `activeTileIndices`; **`itemsDirty = false`; `renderItems` NOT rebuilt** |
| T7 | `getRenderItems` (`437-465`) | `!itemsDirty → return this.renderItems` | ⚠️ stale array returned after T6 |
| T8 | `getRenderItems` rebuild → clear (`463`) | `itemsDirty` | consistent |

**Failure sequence:** any of T1-T4 → T6 runs first (every batched/instanced consumer requests
instance data first) → next `getRenderItems()` (T7) sees `itemsDirty === false` and returns the
pre-mutation geometry. `contentVersion` was bumped but is never consulted on this path.

**Proposed fix (pick one, A preferred):**
- **A — per-consumer flags (clearest):** add `renderItemsDirty` and `instanceItemsDirty`;
  T1-T4 set both; T6 clears only its own; T7/T8 likewise. Mirrors how SpriteBatch already splits
  memo keys (#86).
- **B — smallest diff:** stamp `this.renderItemsVersion = this.contentVersion` at `463` and change
  the guard at `438` to `if (!this.itemsDirty || this.renderItemsVersion === this.contentVersion) …`.
- Either way: audit `destroy()` (`469-478`) — it empties `renderItems` without marking dirty, so a
  post-destroy `getRenderItems` re-enters `getFrame` against a destroyed texture; make destroy
  idempotent-guarded or mark dirty before clearing.

**Test hook:** `test/unit/tilemap.test.mjs` — new case: `setTile` → `getInstanceItems()` →
`getRenderItems()` must reflect the new tile (assert item count/positions changed).

### 9.2 RuntimeAgent poll scheduler ⚠️ — LANDED
**Status — LANDED:** `pollEpoch` field as originally proposed, plus an entry guard that also requires
`!this.controller` (so a stop-aborted poll can never re-enter while in flight) and an epoch-aware
`finally`. One deliberate deviation: `stop()` still resets `polling = false` synchronously **and** bumps
the epoch — the existing test asserts `polling === false` right after `stop()`, and keeping that contract
is the smaller observable change; the epoch makes the in-flight `finally` a no-op anyway. Also landed:
ctor option `executeTimeoutMs` (default 10 000 ms, clamped 250–60 000, `Number.isSafeInteger`-checked) and
a module-level `raceWithTimeout` producing `EXI_RUNTIME_COMMAND_TIMEOUT`. Recorded implementation trap:
`fail()` **throws** synchronously, so `reject(fail(...))` inside a `setTimeout` callback never reaches
`reject` — the timer callback wraps `fail` in try/catch and rejects the caught error (this initially
surfaced as an uncaught-exception test failure).
**Evidence (verified):** `runtime-agent.js:438-441` (four fields), `465-470` (`start`),
`472-480` (`stop`), `482-488` (`schedule` re-arm), `490-494` + `517-519` (`poll` latching/reset),
`491` (`polling` check with no identity), `508` (mid-loop stop), `515` (comment: MCP caller
time-outs when the page is gone).

| # | Trigger | Guard today | Effect |
|---|---------|-------------|--------|
| T1 | `start()` (`465-470`) | `running ⇢ true` requires `token !== ""`; silent no-op otherwise | `schedule()` |
| T2 | `schedule()` (`483`) | `running && timer === null` + overtime window | `timer = setTimeout(poll, pollMs)` |
| T3 | timer fires (`485-486`) | — | poll promise finally re-arms (`finally(() => this.schedule())`) |
| T4 | `poll()` enter (`491-494`) | `!running || polling → return` (`polling` checked **without identity**) | `polling = true; controller set` |
| T5 | network fail / non-ok / bad JSON (`500-506`) | — | silent `return` → `finally` resets → re-arm |
| T6 | mid-loop stop (`508`) | `!running` | silently abandons remaining commands — MCP caller hangs to its own timeout |
| T7 | `stop()` (`472-480`) | none | `running = false; polling = false` (reset **not identity-aware**); clearTimeout; abort current controller |
| T8 | poll `finally` (`517-519`) | controller identity check | clears controller; `polling = false` (second unguarded reset) |

**Failure sequences:**
- **Double-poll:** T7 while a poll is in flight → `polling === false` but the old poll body keeps
  running → quick `stop(); start()` succeeds → T2 schedules a second poll → two concurrent
  `poll()` bodies share `this.controller` (second overwrites first at `494`) — old poll now
  survives `stop()` aborts.
- **Silent wedge:** a command whose `execute()` await never resolves → the `finally` at `517` never
  runs → no re-arm, `polling` stuck — polling dies with no watchdog.

**Proposed fix:**
- At constructor add `this.pollEpoch = 0;`. In `poll()`: `const epoch = ++this.pollEpoch;` and in
  `finally { if (epoch === this.pollEpoch) { …; this.polling = false; } }`. In `stop()`: remove the
  `polling = false` line and add `this.pollEpoch += 1;` (abort still kills the live fetch).
- Bound each command: `await Promise.race([this.execute(command), failAfter(EXECUTE_TIMEOUT_MS,
  "EXI_RUNTIME_COMMAND_TIMEOUT")])` so a wedged callback cannot kill the loop silently.
- Optional: on result POST failure at `515`, at least `this.stop()` so the dead page is detected
  instead of re-polling forever at `pollMs` cadence.

**Test hook:** `test/unit/runtime-agent.test.mjs` — case: `stop()` mid-flight then `start()` must
not produce two concurrent polls (assert via a fetch mock counting in-flight GETs), and a never-
resolving `execute` must reject into a bounded error rather than freeze the loop.

### 9.3 `snapshotHashes` never evicted ⚠️ — LANDED
**Status — LANDED:** all three proposed bullets: `release` sweeps every `snapshotHashes` key prefixed with
`${released-handle}:` (single Map scan over the always-small key set), `stop()` clears the whole map as the
page-lifecycle belt, and both closure observers (`createCanvasObserver` / `createEngineObserver`) serialize
their observe calls through an internal queued promise chain, so overlapping observes can no longer
dedupe each other's measurement.
**Evidence (verified):** `runtime-agent.js:243-246` (`sceneSnapshot` stores per
`${rootHandle}:${offset}:${limit}`, never read on release), `791-797` (`release` deletes handle
state only), `346-358` (engine observer closure reads/overwrites `previousHash` around an `await
captureFrame` — two overlapping observes can dedupe each other's measurement).

**Hazards:** unbounded growth (bounded only by distinct keys actually visited); after page
navigation/re-registering the same root, the first snapshot compares against the dead page's
hash (false-dedup on the *new* content); overlap races can under-report `changed`.

**Proposed fix:**
- In `release` (`791-797`): iterate `this.snapshotHashes` keys and delete every key whose
  `handle ===` segment matches the released handle (single Map scan, keys always small).
- Belt: clear `this.snapshotHashes.clear()` in `stop()` (page lifecycle boundary).
- For the closure observers: capture the previous hash *before* awaiting the capture, or serialize
  observe calls via a queued promise chain (`this._observeQueue = this._observeQueue.then(run)`).

**Test hook:** `runtime-agent.test.mjs` — observe → release handle → re-register a new object
under the same handle → first observe must report `changed: true`.

### 9.4 GPU static upload keyed only by `staticKey` ⚠️ — LANDED
**Status — LANDED:** `updateStaticRenderKey` gained a compare+store slot for
`textureVersion = -1` (texture-content axis), and the TileMap / SpriteBatch providers now pass
`this.texture?.baseTexture?.version ?? -1` (Graphics keeps no texture; left untouched). As the belt, both
`ensureStaticBuffer` implementations (WebGL2 and WebGPU) now also store and compare `entry.vertexCount`
besides `entry.key`, so an equal-key/shorter-data mismatch cannot skip an upload. Deviation from the
proposal: `batch.data?.byteLength` was NOT added as a compared field — `vertexCount` already constrains the
upload length for vertex data, and the belt catches any residual mismatch at the GPU boundary. The landed
test hook is `test/unit/render-helpers.test.mjs` (the doc originally suggested `render-pipeline.test.mjs`).
**Evidence:** providers `graphics.js:274-277`, `sprite-batch.js:345-348`, `tilemap.js:301-315`;
consumer `batch.js:225`; GPU compare `webgl2-renderer.js:625-627`, `webgpu-renderer.js:664-671`.
`updateStaticRenderKey` (`batch.js:17-43`) compares ~25 fields (incl. `contentVersion`) but
**not** the texture's version nor the data length/vertex count.

**Hazards:**
- Texture *contents* mutated via `markDirty()` (version bump) with no other compared field changed
  → both CPU static cache and GPU static buffer keep rendering the old pixels.
- Any future provider whose key misses a mutation axis corrupts GPU bytes silently — the GL path
  has no size/hash validation, `entry.key === batch.staticKey` is the single gate.

**Proposed fix (bounded, cheap):**
- Extend the compare/store field list in `updateStaticRenderKey` with:
  `batch.data?.byteLength ?? 0`, `batch.vertexCount`, and
  `batch.texture?.baseTexture?.version ?? -1` (texture-content axis).
- Belt in the GL renderer: store `entry.vertexCount` next to `entry.key` and treat a mismatch as
  "needs re-upload" even when keys are equal. WebGPU can compare `value.version` analogously.
- Note: contentVersion is already inside the compare, so TileMap edits are safe *today* only
  because `setTile` bumps it (#92 T1) — that dependency is worth a comment near `tilemap.js:301`.

**Test hook:** `render-pipeline.test.mjs` — mutate a texture's source pixels between two renders
with identical transform state → second render must not skip the upload (assert via a mocked GL
call log).

### 9.5 Upload temps can orphan and then deadlock later uploads ⚠️ — LANDED
**Status — LANDED:** `sweepStaleUploadTemps(parentDir)` runs at `assetUploadBegin` and
`projectFileUploadBegin` (sweeping the target's parent directory) and at `project_open` (sweeping the
project root). It matches `.exi-upload-` / `.exi-file-upload-` **file names** only (never
`.exi-backup-*`), protects every currently tracked in-flight temp path, is ENOENT-tolerant on `readdir`,
and unlinks best-effort. On top of the sweep, temp creation goes through `writeUploadTempExclusive` —
a `wx` create with a single unlink-and-retry on `EEXIST` — so a ghost that appears mid-call cannot wedge
begin. As proposed, no mtime gating: at these entry points any untracked scratch of both prefixes is
garbage by definition. Test hook landed in `test/mcp-smoke.mjs` exactly as suggested (planted ghosts are
swept by the next begin / open).
**Evidence (verified):** `assetUploadBegin` `534-558` and `projectFileUploadBegin` `809-833`
register the temp in the Map only **after** the `wx` `writeFile` (`551-552` / `824-827`); nothing
sweeps stray `.exi-upload-*` / `.exi-file-upload-*` files at startup; `shutdown()` (`2394-2403`)
removes only *tracked* temps; prune is time-based on live entries (`526-532` / `801-807`).

**Failure sequence:** process killed mid-upload (SIGKILL/crash) → temp remains on disk → a later
begin for the same target creates the identical temp name (`pid` likely reused long-term,
counter restarts at 1) → `wx` fails with EEXIST → the target is upload-locked by a ghost.

**Proposed fix:**
- Small `sweepStaleScratch(parentDirOf(target))` at `assetUploadBegin` / `projectFileUploadBegin` /
  `project_open` entry: `readdir` the single directory, match `/^\.exi-(upload|file-upload)-/`
  (carefully **not** `.exi-backup-*`, which is a deliberate recovery affordance), unlink entries
  older than the existing idle prune (15 min). One bounded directory listing per call.
- On `wx` EEXIST inside begin: delete the conflicting stale temp once (after the same mtime check)
  and retry the create exactly once, then surface the error.

**Test hook:** `mcp-smoke.mjs` — plant a stale temp; assert begin succeeds and the file is gone.

### 9.6 NineSliceSprite sentinel mix (NaN + `undefined`) ⚠️ — LANDED
**Status — LANDED:** the constructor now stamps all mirrors explicitly. Audit correction: the proposal
counted "10" mirrors, but the `sameGeometry` conjunction actually has **11** fields —
`renderGeometryTexture = null`, `…Width/Height/AnchorX/AnchorY = NaN`, `…Left/Right/Top/Bottom = NaN`,
`…FlipX/FlipY = null` — and all 11 are now stamped. `test/unit/sprite.test.mjs`
asserts every one of them is own-initialized and never `undefined` right after construction.
**Evidence (verified):** constructor `56-64` initializes only `renderGeometryLeft/Right/Top/Bottom = NaN`;
`renderGeometryTexture/Width/Height/AnchorX/AnchorY/FlipX/FlipY` are left `undefined` until the
first build stamps them (`124-129`); the compare (`83-89`) relies on `undefined !== <real value>`.

**Hazard class:** today this works. The break is one refactor away: if any live field ever takes
`undefined`/`NaN` as a legal value (an optional width, a defaulted accessor), the first-compare
state becomes indistinguishable from cached, so a gamer silently skips rebuilds — or NaN-vs-an
undefined mirror spuriously alternates, rebuilding every frame.

**Proposed fix:**
- Stamp all 10 mirrors explicitly in the constructor: `this.renderGeometryTexture = null;`
  `this.renderGeometryWidth = NaN; … this.renderGeometryFlipX = null; this.renderGeometryFlipY = null;`
- Add an invariant test asserting every field read in the `sameGeometry` conjunction is
  initialized in the constructor (either hard-assert each field, or name the list once).

**Test hook:** `test/unit/sprite.test.mjs` (or a new nine-slice case under it) — after construction,
the two sentinel families must both be defined-valued.

### 9.7 Physics contact callbacks share one mutable record ⚠️ — LANDED
**Status — LANDED:** the preferred safe default was taken: `writePhysicsContact(body, other, phase)`
allocates a fresh `{ body, other, phase, normal: {x, y}, penetration: 0 }` per event and fills it, so every
begin/stay/end callback receives its own record; all six callback call sites were updated and the shared
`contactInfo` field plus its `clear()` reset block were deleted. Public callback shape unchanged. The
zero-alloc alternative and the transient-scratch documentation requirement became moot. The §9.4-era
re-entrancy note stands (callbacks must not call `step()`). Test hook: `test/unit/physics.test.mjs`
("contact kayıtları retained kabul edilebilir (paylaşılmaz)") — retained record survives later events;
also pins that a zero-overlap "touching" pair produces no `begin` (strict AABB).
**Evidence (verified):** single record at `collision.js:632`
(`this.contactInfo = { body, other, phase, normal: {x, y}, penetration }`), overwritten per event
by `writePhysicsContact` (`88-96`), passed identically to every callback at `871-873` and
`688/692`, and reused again by `clear()` (`1017-1032`).

**Hazards:** a callback that retains `info` (storing `normal.x`, `phase`) reads later contacts'
values; a callback that re-enters physics or mutates `info.normal` corrupts subsequent events of
the same step. All three callback types (begin/stay/end) write-then-alias the same object.

**Proposed fix:**
- Preferred (safe default): `writePhysicsContact` allocates a fresh plain object per event —
  contacts per step are bounded by the pairs in the build pass, so the allocation remains bounded
  by `MAX_PHYSICS_BODIES` scale. Keeps the public shape exactly.
- Zero-alloc alternative (if allocation budgets reject it): keep sharing but
  (i) document loudly on the callback signature that `contact` is transient scratch valid only for
  the duration of the call, and (ii) under a dev flag, `Object.freeze` a *copy* handed to callbacks
  so accidental retention is caught early.
- In neither variant re-entrancy is currently safe mid-event (the `filterSolid` closure chain reads
  the shared sweep scratch `contactInfo`-independently — verify callbacks do not call `step()`).

**Test hook:** `physics.test.mjs` — retain the `contact` object from a `begin` event, let a second
pair start, assert the retained object's values are unchanged.

### 9.8 Dead transition: `unlock()` never called; `connectedGamepadIndices` (claimed write-only) ⚠️ — LANDED (unlock only; second claim withdrawn)
**Evidence — corrected on audit:**
- Real: `audio-manager.js:177` — `unlock()` existed with zero callers repo-wide; the gesture-unlock path was dead.
- **Withdrawn:** the draft claimed `connectedGamepadIndices` (filled `523-528`, cleared in `destroy()` `646`) was never read. It **is** read at `input.js:558-559` — the per-frame disconnect sweep iterates `this.gamepads` and uses `connected.has(index)` as its ground truth. Deleting the field (as originally proposed) would have silently broken disconnect detection, so nothing was removed there.

**Impact (unlock):** autoplay policy was never handled at the engine level, so after a context-loss pause or an audio-locked page, first interaction had to route through user code calling `resume()`.

**Landed fix (unlock wiring only):**
- `exi-engine.js` ctor: `handleAudioUnlockGesture` removes both listeners, guards `destroyed`, then runs `Promise.resolve(this.audio?.unlock?.()).catch(...)` surfacing failures as one `audio-error` status (sync throw included).
- `init()`: only when `pauseAudio !== false`, registers `pointerdown` (passive) + `keydown` on `globalThis.document`; `destroy()` removes both. Document-level was chosen deliberately: it is the canonical web-audio unlock surface, and per the smoke harness the event surface the engine shares (`globalThis.window`) also receives Input's own `keydown` listener — document-level keeps the two concerns collision-free.
- The listeners are `{ once }`-like by construction: the handler removes both document listeners before unlocking, so the first successful gesture reaps both.

**Test hooks (landed):** `test/engine-smoke.mjs` — via the `documentListeners` stub: keydown gesture calls `unlock()` exactly once and self-removes both listeners; a `pauseAudio: false` engine registers nothing (and its `unlock()` is never called when Input's keydown fires); a gesture-less engine still removes both listeners on `destroy()` without calling `unlock()`. `input.test.mjs` needed no change — the gamepad Set stays put. No existing asset was weakened: the engine-smoke offscreen-tilemap row was the only pre-existing line touched in these fixes, adapted to the renamed (split) dirty fields with the identical invariant.

---

## 10. Explicit-but-related machines (excluded from the implicit list)

- Engine `lifecycleState` getter vocabulary (`exi-engine.js:625-639`) — explicit strings, but the
  boolean trio beneath them is the implicit machine (#1).
- Contact phase literals `"begin"/"stay"/"end"` (`collision.js:90`) — explicit vocabulary over an
  implicit double-map diff (#28).
- Tile flip 2-bit flags and their composition/decode (`tilemap.js:8-9, 39-43, 397-400`).
- Allowlist tables (`public-methods.js`), resize/filter/blend whitelists, JSON scanner's
  per-context `"key"/"value"` mini-enum (`asset-loader.js:191-207`) — explicit enums.
- `updateStaticRenderKey` itself is an explicit ~25-field table — it is the *implicit transition
  edges* feeding key consumers that make it an implicit machine (#67).
- Serializer value-kind chain (Map/Set/typedArray/`$handle`/circular) — explicit type ladder.

## 11. Follow-up ledger (updated after the §9 landing)

1. ✅ §9.1 — TileMap split dirty flags + destroyed guards (+ `textureVersion` arg to the static key).
2. ✅ §9.2 — poll epoch identity + entry/finally guards + `EXI_RUNTIME_COMMAND_TIMEOUT` belt (`executeTimeoutMs`, `raceWithTimeout`).
3. ✅ §9.3 — snapshot-hash eviction on `release` and `stop()`; serialized closure observers.
4. ✅ §9.4 — `textureVersion` compare/store in `updateStaticRenderKey`; `entry.vertexCount` belt in the WebGL2 and WebGPU `ensureStaticBuffer`.
5. ✅ §9.5 — `sweepStaleUploadTemps` at both upload begins and `project_open`; `writeUploadTempExclusive` (`wx` + one EEXIST unlink-retry).
6. ✅ §9.6 — all 11 nine-slice mirror fields stamped in the constructor.
7. ✅ §9.7 — fresh contact record allocated per physics callback event; shared scratch removed.
8. ✅ §9.8 — `unlock()` wired (document-level gesture listeners, `pauseAudio` opt-out respected). The gamepad part of the original proposal was withdrawn as an audit error: `connectedGamepadIndices` is live (read at `input.js:559`) and was left untouched.
9. Still open: per-family "EMPTY" sentinel convention (§8.2) — the drift-class hygiene item predates this pass and remains unimplemented. The §9.4 proposal's `batch.data?.byteLength` compare field was likewise left out (the `vertexCount` belt covers the upload length at the GPU boundary).

Full `npm test` after the landing: static, server, doctor, clients, mcp, engine, unit (217/217, including every new hook above) and typecheck — all green.

*Maintainer note: updated in place after the §9 landing (Nov 2026) — the "analysis only / no code changed"
header, inventory rows #36/#38 and every §9 status were corrected; rows were annotated rather than deleted
because the inventory doubles as a verification checklist. On the next full audit, regenerate the file and
prune the resolved rows.*
