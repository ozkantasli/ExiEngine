# ExiEngine — competitor engine feature matrix

This document contains a subsystem comparison of 27 real open-source engines compiled from
GitHub API results (`game engine`, sorted by stars, 40 repositories).
Star counts are as of 2026-08-17 and are context data, not a ranking measure.
Cells are kept terse; "—" means there is no built-in support, and "external" means it is
provided by an external plugin/library. A "custom" license means a proprietary/permission-based license.

## A. Identity and target platforms

| Engine | Language | Stars | License | Platforms |
| --- | --- | --- | --- | --- |
| [Godot](https://github.com/godotengine/godot) | C++ | 115k | MIT | Win/macOS/Linux/Android/iOS/Web (+console 3P) |
| [Bevy](https://github.com/bevyengine/bevy) | Rust | 47k | Apache-2.0 | Win/macOS/Linux/Web |
| [PixiJS](https://github.com/pixijs/pixijs) | TypeScript | 48k | MIT | Web |
| [Babylon.js](https://github.com/BabylonJS/Babylon.js) | TypeScript | 25k | Apache-2.0 | Web (+Babylon Native) |
| [GDevelop](https://github.com/4ian/GDevelop) | JavaScript/C++ | 25k | custom | Web/Win/macOS/Linux/Android/iOS |
| [Pyxel](https://github.com/kitao/pyxel) | Rust | 17k | custom | Win/macOS/Linux/Web |
| [OpenRA](https://github.com/OpenRA/OpenRA) | C# | 17k | GPL-3.0 | Win/macOS/Linux |
| [openage](https://github.com/SFTtech/openage) | Python/C++ | 14k | custom | Linux/macOS/Win (experimental) |
| [Ebiten](https://github.com/hajimehoshi/ebiten) | Go | 13k | Apache-2.0 | Win/macOS/Linux/Web/Android/iOS |
| [Flame](https://github.com/flame-engine/flame) | Dart | 10k | MIT | iOS/Android/Web/Desktop |
| [Cocos Engine](https://github.com/cocos/cocos-engine) | C++/TS | 9.7k | custom | Win/macOS/Linux/Android/iOS/Web/console/mini-games |
| [Fyrox](https://github.com/FyroxEngine/Fyrox) | Rust | 9.5k | MIT | Win/macOS/Linux |
| [Stride](https://github.com/stride3d/stride) | C# | 7.7k | MIT | Win/Linux/Android/iOS/Web (experimental) |
| [Flax Engine](https://github.com/FlaxEngine/FlaxEngine) | C++/C# | 6.9k | custom | Win/console/Linux (experimental) |
| [Piccolo](https://github.com/BoomingTech/Piccolo) | C++ | 6.6k | MIT | Win/Linux (educational) |
| [OpenMW](https://github.com/OpenMW/openmw) | C++ | 6.5k | GPL-3.0 | Win/macOS/Linux/Android |
| [s&box](https://github.com/Facepunch/sbox-public) | C# | 6.4k | custom | Windows (Steam) |
| [melonJS](https://github.com/melonjs/melonJS) | JavaScript | 6.3k | MIT | Web |
| [Defold](https://github.com/defold/defold) | C++/Lua | 6.2k | custom | Win/macOS/Linux/Android/iOS/Web/console (extension) |
| [Redot](https://github.com/Redot-Engine/redot-engine) | C++ | 5.9k | MIT | Same as Godot (fork) |
| [Panda3D](https://github.com/panda3d/panda3d) | C++/Python | 5.2k | custom | Win/macOS/Linux/Web |
| [FXGL](https://github.com/AlmasB/FXGL) | Kotlin | 4.8k | MIT | Desktop (JVM)/Android |
| [mach](https://github.com/hexops/mach) | Zig | 4.8k | custom | Win/macOS/Linux/Web (early, WIP) |
| [Urho3D](https://github.com/urho3d/urho3d) | C++ | 4.7k | MIT | Win/macOS/Linux/Android/iOS/Web |
| [Piston](https://github.com/PistonDevelopers/piston) | Rust | 4.6k | MIT | Win/macOS/Linux |
| [ggez](https://github.com/ggez/ggez) | Rust | 4.6k | MIT | Win/macOS/Linux/Web |
| [macroquad](https://github.com/not-fl3/macroquad) | Rust | 4.5k | Apache-2.0 | Win/macOS/Linux/Web/Android/iOS |

## B. Subsystems

| Engine | Rendering | Physics | Audio | Scripting | Editor | Asset pipeline |
| --- | --- | --- | --- | --- | --- | --- |
| Godot | 2D+3D (Vulkan/GL/Metal/WebGL) | built-in 2D/3D (+Jolt) | built-in | GDScript/C#/GDExtension | full visual | import + .godot cache |
| Bevy | 2D+3D (wgpu) | external (bevy_rapier/xpbd) | built-in (rodio) | Rust (ECS) | experimental | asset server + hot reload |
| PixiJS | 2D (WebGL+WebGPU) | external (matter.js etc.) | — | JS/TS | — | loader (texture/spritesheet) |
| Babylon.js | 3D (WebGL+WebGPU) | built-in (Havok/Cannon/Ammo) | built-in (Web Audio) | JS/TS | inspector/node-material/GUI | glTF + asset container |
| GDevelop | 2D (+basic 3D) | built-in (Box2D) | built-in | visual events + JS extensions | full no-code | built-in + asset store |
| Pyxel | 2D retro (16 colors) | — | built-in (synth) | Python-like API | image/sound/tile editors | embedded editors |
| OpenRA | 2D isometric (SDL/GL) | — (RTS rules) | built-in (OpenAL) | Lua + C# (mods) | map editor | mod files |
| openage | 2D isometric (OpenGL) | — | built-in | Python mod API | — | converter |
| Ebiten | 2D (GL/Metal/DX) | — (external lib) | built-in | Go | — | embed |
| Flame | 2D (Flutter canvas) | external (forge2d) | Flame Audio | Dart | — | Flutter assets |
| Cocos | 2D+3D (Vulkan/Metal/GL) | built-in (Box2D/Bullet) | built-in | TS/JS/C++ | Cocos Creator | Creator pipeline |
| Fyrox | 3D+2D (OpenGL) | built-in (rapier) | built-in | Rust | full editor | built-in |
| Stride | 3D+2D (Vulkan/DX/Metal/GL) | built-in (Bepu) | built-in | C# (+visual) | Stride Game Studio | built-in |
| Flax | 3D (Vulkan/DX/Metal) | built-in (PhysX) | built-in | C#/C++/visual | full editor | built-in |
| Piccolo | 3D (Vulkan) | minimal | minimal | C++ (learning) | minimal runtime | minimal |
| OpenMW | 3D (OSG/OpenGL) | built-in (Bullet) | built-in (OpenAL) | MWScript + Lua | OpenMW-CS | Morrowind assets |
| s&box | 3D (Source 2) | built-in | built-in | C# | full (Source 2) | Source 2 assets |
| melonJS | 2D (WebGL) | built-in (simple) | built-in (Web Audio) | JS | — (Tiled support) | loader |
| Defold | 2D (+limited 3D) | built-in (Box2D/Bullet) | built-in | Lua | full editor | built-in |
| Redot | same as Godot | same | same | same | same | same |
| Panda3D | 3D (GL/DX/Metal/Vulkan) | built-in (Bullet) | built-in | Python/C++ | — (community) | egg/bam |
| FXGL | 2D (JavaFX) | built-in (jbox2d) | built-in | Kotlin/Java | — | built-in |
| mach | 2D+3D (WebGPU) | modular | modular | Zig | — (early) | early |
| Urho3D | 2D+3D (GL/DX) | built-in (Bullet) | built-in | AngelScript/Lua | Urho3D Editor | built-in |
| Piston | 2D+3D (modular) | external (nphysics) | external (rodio) | Rust | — | — (modular) |
| ggez | 2D (wgpu) | — | built-in (rodio) | Rust | — | simple loader |
| macroquad | 2D+3D (OpenGL) | external (rapier) | built-in (miniaudio) | Rust | — | simple loader |

## Patterns and signals for ExiEngine

- **Rust** engines (Bevy, Fyrox, ggez, macroquad, Piston) have the most momentum; the ECS
  architecture (Bevy, Fyrox) is the current differentiator. However, in most Rust engines
  physics and the asset pipeline are "external" — left to plugins.
- **C++** dominates the mature, feature-rich tier (Godot, Cocos, Flax, Panda3D, Urho3D).
- The lack of an **editor** is the common gap of library-style lightweight engines (PixiJS,
  Ebiten, ggez, macroquad, FXGL); a "full editor" is specific to the Godot/Flax/Stride/Cocos/Defold/s&box cluster.
- The **web target** is nearly universal; console distribution, on the other hand, is usually
  third-party/license-gated (Godot, Defold) or closed (s&box, Flax).
- ExiEngine's own position (a dependency-free TS core, WebGPU/WebGL2, fully running in the
  browser) is a distinct niche between the web-graphics gap of PixiJS/Babylon/melonJS and the
  full-editor expectation of Godot — the emphasis on a dependency-free runtime + agent access has
  no direct competitor cluster in this matrix.
