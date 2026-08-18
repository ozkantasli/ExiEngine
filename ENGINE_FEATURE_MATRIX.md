# ExiEngine — rakip motor özellik matrisi

Bu doküman, GitHub API (`game engine`, yıldıza göre sıralı, 40 repo) sonuçlarından
derlenen 27 gerçek açık-kaynak motorun alt-sistem karşılaştırmasını içerir.
Yıldız sayıları 2026-08-17 itibarıyladır ve sıralama ölçüsü değil bağlam verisidir.
Hücreler terse tutulmuştur; "—" yerleşik desteğin olmadığını, "dış" ise harici
plugin/kütüphaneyle sağlandığını gösterir. "custom" lisans, özel/izine bağlı lisansı ifade eder.

## A. Kimlik ve hedef platform

| Motor | Dil | Yıldız | Lisans | Platformlar |
| --- | --- | --- | --- | --- |
| [Godot](https://github.com/godotengine/godot) | C++ | 115k | MIT | Win/macOS/Linux/Android/iOS/Web (+konsol 3P) |
| [Bevy](https://github.com/bevyengine/bevy) | Rust | 47k | Apache-2.0 | Win/macOS/Linux/Web |
| [PixiJS](https://github.com/pixijs/pixijs) | TypeScript | 48k | MIT | Web |
| [Babylon.js](https://github.com/BabylonJS/Babylon.js) | TypeScript | 25k | Apache-2.0 | Web (+Babylon Native) |
| [GDevelop](https://github.com/4ian/GDevelop) | JavaScript/C++ | 25k | custom | Web/Win/macOS/Linux/Android/iOS |
| [Pyxel](https://github.com/kitao/pyxel) | Rust | 17k | custom | Win/macOS/Linux/Web |
| [OpenRA](https://github.com/OpenRA/OpenRA) | C# | 17k | GPL-3.0 | Win/macOS/Linux |
| [openage](https://github.com/SFTtech/openage) | Python/C++ | 14k | custom | Linux/macOS/Win (deneysel) |
| [Ebiten](https://github.com/hajimehoshi/ebiten) | Go | 13k | Apache-2.0 | Win/macOS/Linux/Web/Android/iOS |
| [Flame](https://github.com/flame-engine/flame) | Dart | 10k | MIT | iOS/Android/Web/Masaüstü |
| [Cocos Engine](https://github.com/cocos/cocos-engine) | C++/TS | 9.7k | custom | Win/macOS/Linux/Android/iOS/Web/konsol/mini-oyun |
| [Fyrox](https://github.com/FyroxEngine/Fyrox) | Rust | 9.5k | MIT | Win/macOS/Linux |
| [Stride](https://github.com/stride3d/stride) | C# | 7.7k | MIT | Win/Linux/Android/iOS/Web (deneysel) |
| [Flax Engine](https://github.com/FlaxEngine/FlaxEngine) | C++/C# | 6.9k | custom | Win/konsol/Linux (deneysel) |
| [Piccolo](https://github.com/BoomingTech/Piccolo) | C++ | 6.6k | MIT | Win/Linux (eğitim amaçlı) |
| [OpenMW](https://github.com/OpenMW/openmw) | C++ | 6.5k | GPL-3.0 | Win/macOS/Linux/Android |
| [s&box](https://github.com/Facepunch/sbox-public) | C# | 6.4k | custom | Windows (Steam) |
| [melonJS](https://github.com/melonjs/melonJS) | JavaScript | 6.3k | MIT | Web |
| [Defold](https://github.com/defold/defold) | C++/Lua | 6.2k | custom | Win/macOS/Linux/Android/iOS/Web/konsol (uzantı) |
| [Redot](https://github.com/Redot-Engine/redot-engine) | C++ | 5.9k | MIT | Godot ile aynı (fork) |
| [Panda3D](https://github.com/panda3d/panda3d) | C++/Python | 5.2k | custom | Win/macOS/Linux/Web |
| [FXGL](https://github.com/AlmasB/FXGL) | Kotlin | 4.8k | MIT | Masaüstü (JVM)/Android |
| [mach](https://github.com/hexops/mach) | Zig | 4.8k | custom | Win/macOS/Linux/Web (erken, WIP) |
| [Urho3D](https://github.com/urho3d/urho3d) | C++ | 4.7k | MIT | Win/macOS/Linux/Android/iOS/Web |
| [Piston](https://github.com/PistonDevelopers/piston) | Rust | 4.6k | MIT | Win/macOS/Linux |
| [ggez](https://github.com/ggez/ggez) | Rust | 4.6k | MIT | Win/macOS/Linux/Web |
| [macroquad](https://github.com/not-fl3/macroquad) | Rust | 4.5k | Apache-2.0 | Win/macOS/Linux/Web/Android/iOS |

## B. Alt-sistemler

| Motor | Rendering | Fizik | Ses | Scripting | Editör | Asset pipeline |
| --- | --- | --- | --- | --- | --- | --- |
| Godot | 2D+3D (Vulkan/GL/Metal/WebGL) | yerleşik 2D/3D (+Jolt) | yerleşik | GDScript/C#/GDExtension | tam görsel | import + .godot cache |
| Bevy | 2D+3D (wgpu) | dış (bevy_rapier/xpbd) | yerleşik (rodio) | Rust (ECS) | deneysel | asset server + hot-reload |
| PixiJS | 2D (WebGL+WebGPU) | dış (matter.js vb.) | — | JS/TS | — | loader (texture/spritesheet) |
| Babylon.js | 3D (WebGL+WebGPU) | yerleşik (Havok/Cannon/Ammo) | yerleşik (Web Audio) | JS/TS | inspector/node-material/GUI | glTF + asset container |
| GDevelop | 2D (+temel 3D) | yerleşik (Box2D) | yerleşik | görsel event + JS uzantı | tam no-code | yerleşik + asset store |
| Pyxel | 2D retro (16 renk) | — | yerleşik (synt) | Python benzeri API | görüntü/ses/tile editörleri | gömülü editörler |
| OpenRA | 2D izometrik (SDL/GL) | — (RTS kuralı) | yerleşik (OpenAL) | Lua + C# (mod) | harita editörü | mod dosyaları |
| openage | 2D izometrik (OpenGL) | — | yerleşik | Python mod API | — | dönüştürücü |
| Ebiten | 2D (GL/Metal/DX) | — (dış lib) | yerleşik | Go | — | embed |
| Flame | 2D (Flutter canvas) | dış (forge2d) | Flame Audio | Dart | — | Flutter assets |
| Cocos | 2D+3D (Vulkan/Metal/GL) | yerleşik (Box2D/Bullet) | yerleşik | TS/JS/C++ | Cocos Creator | Creator pipeline |
| Fyrox | 3D+2D (OpenGL) | yerleşik (rapier) | yerleşik | Rust | tam editör | yerleşik |
| Stride | 3D+2D (Vulkan/DX/Metal/GL) | yerleşik (Bepu) | yerleşik | C# (+görsel) | Stride Game Studio | yerleşik |
| Flax | 3D (Vulkan/DX/Metal) | yerleşik (PhysX) | yerleşik | C#/C++/görsel | tam editör | yerleşik |
| Piccolo | 3D (Vulkan) | minimal | minimal | C++ (öğrenme) | minimal runtime | minimal |
| OpenMW | 3D (OSG/OpenGL) | yerleşik (Bullet) | yerleşik (OpenAL) | MWScript + Lua | OpenMW-CS | Morrowind varlıkları |
| s&box | 3D (Source 2) | yerleşik | yerleşik | C# | tam (Source 2) | Source 2 asset |
| melonJS | 2D (WebGL) | yerleşik (basit) | yerleşik (Web Audio) | JS | — (Tiled destek) | loader |
| Defold | 2D (+sınırlı 3D) | yerleşik (Box2D/Bullet) | yerleşik | Lua | tam editör | yerleşik |
| Redot | Godot ile aynı | aynı | aynı | aynı | aynı | aynı |
| Panda3D | 3D (GL/DX/Metal/Vulkan) | yerleşik (Bullet) | yerleşik | Python/C++ | — (topluluk) | egg/bam |
| FXGL | 2D (JavaFX) | yerleşik (jbox2d) | yerleşik | Kotlin/Java | — | yerleşik |
| mach | 2D+3D (WebGPU) | modüler | modüler | Zig | — (erken) | erken |
| Urho3D | 2D+3D (GL/DX) | yerleşik (Bullet) | yerleşik | AngelScript/Lua | Urho3D Editor | yerleşik |
| Piston | 2D+3D (modüler) | dış (nphysics) | dış (rodio) | Rust | — | — (modüler) |
| ggez | 2D (wgpu) | — | yerleşik (rodio) | Rust | — | basit loader |
| macroquad | 2D+3D (OpenGL) | dış (rapier) | yerleşik (miniaudio) | Rust | — | basit loader |

## Desenler ve ExiEngine için sinyaller

- **Rust** motorlarının (Bevy, Fyrox, ggez, macroquad, Piston) ivmesi en yüksek; ECS
  mimarisi (Bevy, Fyrox) güncel farklılaştırıcı. Ancak çoğu Rust motorunda fizik ve
  varlık pipeline'ı "dış" — yani eklentiye bırakılmış.
- **C++** olgun/özellik-dolu katmanı domine ediyor (Godot, Cocos, Flax, Panda3D, Urho3D).
- **Editör** eksikliği, hafif kütüphane tipi motorların (PixiJS, Ebiten, ggez, macroquad,
  FXGL) ortak boşluğu; "tam editör" ise Godot/Flax/Stride/Cocos/Defold/s&box kümesine özgü.
- **Web hedefi** neredeyse evrensel; buna karşın konsol dağıtımı genelde third-party/lisans
  engelli (Godot, Defold) veya kapalı (s&box, Flax).
- ExiEngine'in kendi konumu (bağımlılıksız TS çekirdek, WebGPU/WebGL2, tarayıcıda tam çalışan)
  PixiJS/Babylon/melonJS'in web-grafik boşluğu ile Godot'un tam editör beklentisi arasında
  farklı bir niş — bağımlılıksız runtime + agent erişimi vurgusu bu matriste doğrudan rakip
  kümesinde yok.
