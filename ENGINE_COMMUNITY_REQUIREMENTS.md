# ExiEngine — community requirements analysis (issue tracker mining)

Source: GitHub Issue Search API (`type:issue is:open`, `sort=reactions-+1` and `sort=comments`).
Repositories scanned: Godot, Bevy, PixiJS, Babylon.js, GDevelop. `ebiten` and `flame`
returned an unauthenticated 403 (rate limit); the signal from five engines is sufficient.
Frequency was determined from 👍 (thumbs-up), 💬 (comments) and repetition across engines.

Each row carries evidence: `engine 👍x 💬y` and the issue link. This document can be
cross-checked against `ENGINE_GAP_ANALYSIS.md` — the issue data anchors the gap list to
real user requests.

## Frequency summary

| Subsystem | Frequency | Strongest evidence | ExiEngine relevance |
| --- | --- | --- | --- |
| Editor | Very high | Bevy Editor 👍250 | gap #1 |
| Web/platform reach | High | Godot C# web export 👍90 | gap #4 |
| Determinism / frame timing | Medium-high | Bevy frame rate limiting 👍95 | gap #11 |
| Scripting / language ergonomics | Medium | Godot GDScript typed-array 👍90 | general |
| Asset pipeline / import | Medium | Bevy USD 👍40 · Pixi spritesheet reparse 👍9 | gap #6 |
| Documentation / onboarding | Medium | Pixi v8 migration guide 👍7 | gap #7 |
| 3D rendering improvements | Medium (3D-specific) | Babylon SSAO/refraction · Bevy OpenXR 👍55 | out of scope |
| Security | Medium | Godot arbitrary code exec 👍75 | ExiEngine security contract |
| Input / multi-touch | Low-medium | Pixi multi-touch 👍5 | general |
| Audio | Low | GDevelop spatial sound 👍3 | gap (lightweight engines) |
| Physics / pathfinding | Low | GDevelop pathfinding+tilemap 👍2 | general |
| AI/agent access | Low (strategic) | GDevelop BYOK AI Agent 👍3 | ExiEngine differentiator |

## Subsystem detail

### 1. Editor — very high frequency (confirms gap #1)
- Bevy **Editor** — 👍250 💬138 — https://github.com/bevyengine/bevy/issues/85
- Godot external editor does not generate signal code — 👍56 — https://github.com/godotengine/godot/issues/41283
- Babylon Inspector v2 feedback — 💬18 — https://github.com/BabylonJS/Babylon.js/issues/17293
- GDevelop LDtk tilemap editor integration — 💬49 — https://github.com/4ian/GDevelop/issues/2991

### 2. Web/platform reach — high frequency (gap #4)
- Godot **C# web export** — 👍90 💬116 — https://github.com/godotengine/godot/issues/70796
- Godot HTML5 loading takes 1-2 min (macOS) — 👍67 💬76 — https://github.com/godotengine/godot/issues/70691
- Bevy WebAssembly multithreading — 👍38 💬35 — https://github.com/bevyengine/bevy/issues/4078

### 3. Determinism / frame timing — medium-high (gap #11)
- Bevy **frame rate limiting** — 👍95 — https://github.com/bevyengine/bevy/issues/1343
- Bevy `Time` jitter — 👍32 — https://github.com/bevyengine/bevy/issues/4669
- Godot Forward Plus frame skip/jitter — 👍49 💬185 — https://github.com/godotengine/godot/issues/84137
- Babylon: scale inertia with frame rate — 👍2 — https://github.com/BabylonJS/Babylon.js/issues/12820

### 4. Scripting / language ergonomics — medium
- Godot `get_class()`/`is_class()` do not return class_name — 👍168 — https://github.com/godotengine/godot/issues/21789
- Godot typed-array `map`/`filter` — 👍90 — https://github.com/godotengine/godot/issues/72566
- Godot integer division warning — 👍57 — https://github.com/godotengine/godot/issues/42966
- Bevy "panics should not be the default" API discussion — 💬41 — https://github.com/bevyengine/bevy/issues/14275

### 5. Asset pipeline / import — medium (gap #6)
- Bevy Open USD support — 👍40 — https://github.com/bevyengine/bevy/issues/14464
- PixiJS spritesheet re-parsed from cache — 👍9 — https://github.com/pixijs/pixijs/issues/9316
- PixiJS TexturePacker multi-pack atlas — 💬25 — https://github.com/pixijs/pixijs/issues/7000

### 6. Documentation / onboarding — medium (gap #7)
- PixiJS v8 migration guide missing — 👍7 — https://github.com/pixijs/pixijs/issues/10311
- PixiJS fontFamily documentation unclear — 👍4 — https://github.com/pixijs/pixijs/issues/9412
- Bevy `.add_systems` confusion — 💬36 — https://github.com/bevyengine/bevy/issues/17130

### 7. 3D rendering — medium, 3D-specific (out of ExiEngine MVP scope)
- Bevy OpenXR/VR — 👍55 — https://github.com/bevyengine/bevy/issues/115
- Bevy world-space UI — 👍36 — https://github.com/bevyengine/bevy/issues/5476
- Babylon SSAO/mirror/refraction — https://github.com/BabylonJS/Babylon.js/issues/12630
- Babylon Gaussian Splatting — 👍7 — https://github.com/BabylonJS/Babylon.js/issues/16671
- Babylon Frame Graph — 💬18 — https://github.com/BabylonJS/Babylon.js/issues/18108

### 8. Security — medium (aligned with the ExiEngine security contract)
- Godot `str_to_var`/`ConfigFile` arbitrary code execution — 👍75 — https://github.com/godotengine/godot/issues/80562

### 9. Input / multi-touch — low-medium
- PixiJS multi-touch — 👍5 — https://github.com/pixijs/pixijs/issues/10181
- PixiJS cursor change requires mouse movement — 👍10 — https://github.com/pixijs/pixijs/issues/9767
- PixiJS pointerover/out fires twice — 💬17 — https://github.com/pixijs/pixijs/issues/10131

### 10. Audio — low (lightweight engine gap)
- GDevelop spatial/directional sound — 👍3 — https://github.com/4ian/GDevelop/issues/6954

### 11. Physics / pathfinding — low
- GDevelop pathfinding + TilemapMask — 👍2 — https://github.com/4ian/GDevelop/issues/4426
- GDevelop distance conditions — 👍4 — https://github.com/4ian/GDevelop/issues/3815

### 12. AI/agent access — low but strategic
- GDevelop BYOK (Bring Your Own Key) AI Agent — 👍3 — https://github.com/4ian/GDevelop/issues/7932

## Conclusion

Community requests **independently confirm** the gap analysis: the editor (#1, Bevy 👍250),
web reach (Godot C# web 👍90), determinism/frame timing (Bevy 👍95) and the asset
pipeline/documentation gaps are anchored by real user votes. The most striking signal for
ExiEngine is that **AI/agent access** appears only as a single low-vote request in GDevelop —
meaning the differentiator is a niche claimed before the user base has asked for it. Security
(Godot arbitrary code exec 👍75) also justifies ExiEngine's ban on `eval`/arbitrary code.
