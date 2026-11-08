# ExiEngine — competitor engine gap analysis

This document is a **prioritized** list of gaps derived from the intersection of the
subsystem table of the 27 engines in `ENGINE_FEATURE_MATRIX.md` and community
issue/discussion records. A "gap" means a capability that is either missing in several
engines, weakly/half implemented, or frequently requested but immature.

Priority scale: **P0** critical (broad user pain, missing in several engines at once),
**P1** high (weak or frequently requested), **P2** medium (niche/strategic). Each row lists
the engines it affects and the opportunity for ExiEngine.

## P0 — Critical gaps

1. **Lightweight/2D engines lack a full visual editor.**
   None of PixiJS, Ebiten, ggez, macroquad, FXGL, Piston or melonJS has an editor;
   editors are specific to the Godot/Flax/Stride/Cocos/Defold/s&box cluster. An editor is
   the biggest barrier to entry for non-coders and the most frequently requested feature.
   *Opportunity:* a dependency-free editor that runs in the browser (same language as the runtime) opens a niche at low cost.

2. **The Rust ecosystem has no built-in physics.**
   In Bevy, Piston, ggez and macroquad physics is "external" (bevy_rapier/xpbd, rapier, nphysics).
   Plugin fragmentation and version conflicts (rapier vs xpbd) are a lasting source of
   friction for new users. Only Fyrox offers built-in physics.
   *Opportunity:* embedding a deterministic 2D physics core in the runtime fills the Rust engines' gap.

3. **Unified 2D+3D in one engine is rare.**
   Most engines are either 2D (PixiJS, Ebiten, ggez, melonJS, Flame, FXGL) or 3D (Babylon,
   Panda3D, Flax, s&box). Only Godot, Stride, Fyrox and Urho3D do both well.
   *Opportunity:* switching between 2D/3D on the same core removes the cost of changing engines as the game genre changes.

4. **Web/WebAssembly is not a first-class target.**
   Many desktop engines treat the web as an afterthought/experimental (Bevy's WebGPU web path
   is unfinished; Stride/Flax/Fyrox web is experimental). The engines that are mature on the web
   (PixiJS, Babylon, melonJS, GDevelop) lack an editor or full features.
   *Opportunity:* treating the web as the native first target (which ExiEngine already does) captures both ends.

## P1 — High-priority gaps

5. **Hot reload / live editing is rare and incomplete.**
   Defold (Lua) and Bevy (assets) partly offer it; Godot's is limited. Seeing scene/code
   changes without a restart is frequently requested but rarely delivered.

6. **Asset pipelines and import formats are inconsistent.**
   glTF has become common, but FBX/GLB/atlas support is uneven across engines; lightweight
   engines have simple loaders and no scene format. Deterministic and extensible asset import
   is a recurring community request.

7. **Editor UX and documentation are lacking.**
   The Fyrox and Bevy editors are immature; the documentation/onboarding gap is visible in Rust
   engines and new C++ engines (Piccolo). The lack of "a working example + a clear API guide"
   lowers adoption.

8. **Debugging/profiling tools are weak.**
   Lightweight engines mostly lack a frame graph, GPU timing and memory tracking. Users build
   their own tools to diagnose performance bottlenecks.

9. **C# scripting maturity is uneven for people moving from Unity.**
   Godot C# is second-class (GDScript comes first); Stride/Flax C# is good but their user
   bases are small. Unity migrants look for a consistent C# + editor experience.

## P2 — Medium / strategic gaps

10. **Console distribution is mostly third-party or license-gated.**
    Godot/Defold use third parties, s&box/Flax are closed. The console path is expensive for independent engines.

11. **Cross-platform determinism is missing.**
    Getting identical physics/animation results across platforms (for multiplayer/replays)
    is not guaranteed in most engines; it is often raised but rarely solved.

12. **No engine has an agent/LLM-first API surface.**
    No competitor offers the engine through a reflective/bounded API + MCP bridge that an AI
    agent can discover and drive directly. This is ExiEngine's current differentiator and is
    unmatched in the matrix. Its strategic priority is high; its short-term user base is small.

## Summary table

| # | Gap | Priority | Affected engines | ExiEngine opportunity |
| --- | --- | --- | --- | --- |
| 1 | No full visual editor | P0 | PixiJS, Ebiten, ggez, macroquad, FXGL, Piston, melonJS | Same-language editor in the browser |
| 2 | No built-in physics in Rust | P0 | Bevy, Piston, ggez, macroquad | Embedded deterministic 2D physics |
| 3 | Unified 2D+3D is rare | P0 | Most single-focus engines | 2D/3D on one core |
| 4 | Web is not first-class | P0 | Bevy, Stride, Flax, Fyrox | Web-native runtime |
| 5 | Hot reload rare/incomplete | P1 | General | Live editing |
| 6 | Inconsistent asset pipeline | P1 | Lightweight engines | Deterministic import |
| 7 | Weak editor UX + docs | P1 | Fyrox, Bevy, Piccolo | Working example + API guide |
| 8 | Weak debug/profiling | P1 | Lightweight engines | Frame graph + GPU timing |
| 9 | Uneven C# scripting maturity | P1 | Godot (C#), Stride, Flax | Consistent C#/editor |
| 10 | Console distribution gated | P2 | Godot, Defold, s&box, Flax | — |
| 11 | Cross-platform determinism | P2 | General | Deterministic core |
| 12 | No agent/LLM API surface | P2 | None | ExiEngine differentiator |
