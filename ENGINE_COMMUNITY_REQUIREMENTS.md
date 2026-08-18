# ExiEngine — topluluk gereksinim analizi (issue tracker madenciliği)

Kaynak: GitHub Issue Search API (`type:issue is:open`, `sort=reactions-+1` ve `sort=comments`).
Taranan depolar: Godot, Bevy, PixiJS, Babylon.js, GDevelop. `ebiten` ve `flame`
kimliksiz 403 (rate limit) döndürdü; sinyal beş motor üzerinden yeterli.
Sıklık, hem 👍 (thumbs-up) hem 💬 (yorum) hem de motorlar arası tekrar ile belirlendi.

Her satırda kanıt: `motor 👍x 💬y` ve issue bağlantısı. Bu doküman
`ENGINE_GAP_ANALYSIS.md` ile çapraz doğrulanabilir — issue verisi boşluk listesini
gerçek kullanıcı talepleriyle sabitler.

## Sıklık özeti

| Alt-sistem | Sıklık | En güçlü kanıt | ExiEngine ilgisi |
| --- | --- | --- | --- |
| Editör | Çok yüksek | Bevy Editor 👍250 | gap #1 |
| Web/platform erişimi | Yüksek | Godot C# web export 👍90 | gap #4 |
| Determinizm / frame zamanlaması | Orta-yüksek | Bevy frame rate limiting 👍95 | gap #11 |
| Scripting / dil ergonomisi | Orta | Godot GDScript typed-array 👍90 | genel |
| Asset pipeline / import | Orta | Bevy USD 👍40 · Pixi spritesheet reparse 👍9 | gap #6 |
| Dokümantasyon / onboarding | Orta | Pixi v8 migration guide 👍7 | gap #7 |
| 3D render iyileştirmesi | Orta (3D-özel) | Babylon SSAO/refraction · Bevy OpenXR 👍55 | kapsam dışı |
| Güvenlik | Orta | Godot arbitrary code exec 👍75 | ExiEngine güvenlik sözleşmesi |
| Input / çoklu-dokunma | Düşük-orta | Pixi multi-touch 👍5 | genel |
| Ses | Düşük | GDevelop spatial sound 👍3 | gap (hafif motor) |
| Fizik / pathfinding | Düşük | GDevelop pathfinding+tilemap 👍2 | genel |
| AI/Agent erişimi | Düşük (stratejik) | GDevelop BYOK AI Agent 👍3 | ExiEngine farklılaştırıcısı |

## Alt-sistem detayı

### 1. Editör — çok yüksek sıklık (gap #1 doğrulanıyor)
- Bevy **Editor** — 👍250 💬138 — https://github.com/bevyengine/bevy/issues/85
- Godot external editor'da signal kod üretmiyor — 👍56 — https://github.com/godotengine/godot/issues/41283
- Babylon Inspector v2 geri bildirim — 💬18 — https://github.com/BabylonJS/Babylon.js/issues/17293
- GDevelop LDtk tilemap editör entegrasyonu — 💬49 — https://github.com/4ian/GDevelop/issues/2991

### 2. Web/platform erişimi — yüksek sıklık (gap #4)
- Godot **C# web export** — 👍90 💬116 — https://github.com/godotengine/godot/issues/70796
- Godot HTML5 yükleme 1-2 dk (macOS) — 👍67 💬76 — https://github.com/godotengine/godot/issues/70691
- Bevy WebAssembly multithreading — 👍38 💬35 — https://github.com/bevyengine/bevy/issues/4078

### 3. Determinizm / frame zamanlaması — orta-yüksek (gap #11)
- Bevy **frame rate limiting** — 👍95 — https://github.com/bevyengine/bevy/issues/1343
- Bevy `Time` jitter — 👍32 — https://github.com/bevyengine/bevy/issues/4669
- Godot Forward Plus frame skip/jitter — 👍49 💬185 — https://github.com/godotengine/godot/issues/84137
- Babylon inertia frame-rate'e ölçeklensin — 👍2 — https://github.com/BabylonJS/Babylon.js/issues/12820

### 4. Scripting / dil ergonomisi — orta
- Godot `get_class()`/`is_class()` class_name döndürmüyor — 👍168 — https://github.com/godotengine/godot/issues/21789
- Godot typed-array `map`/`filter` — 👍90 — https://github.com/godotengine/godot/issues/72566
- Godot integer division uyarısı — 👍57 — https://github.com/godotengine/godot/issues/42966
- Bevy "panic varsayılan olmasın" API tartışması — 💬41 — https://github.com/bevyengine/bevy/issues/14275

### 5. Asset pipeline / import — orta (gap #6)
- Bevy Open USD desteği — 👍40 — https://github.com/bevyengine/bevy/issues/14464
- PixiJS spritesheet cache'te yeniden parse — 👍9 — https://github.com/pixijs/pixijs/issues/9316
- PixiJS TexturePacker multi-pack atlas — 💬25 — https://github.com/pixijs/pixijs/issues/7000

### 6. Dokümantasyon / onboarding — orta (gap #7)
- PixiJS v8 migration guide eksik — 👍7 — https://github.com/pixijs/pixijs/issues/10311
- PixiJS fontFamily dokümantasyonu belirsiz — 👍4 — https://github.com/pixijs/pixijs/issues/9412
- Bevy `.add_systems` kafa karışıklığı — 💬36 — https://github.com/bevyengine/bevy/issues/17130

### 7. 3D render — orta, 3D-özel (ExiEngine MVP kapsam dışı)
- Bevy OpenXR/VR — 👍55 — https://github.com/bevyengine/bevy/issues/115
- Bevy world-space UI — 👍36 — https://github.com/bevyengine/bevy/issues/5476
- Babylon SSAO/mirror/refraction — https://github.com/BabylonJS/Babylon.js/issues/12630
- Babylon Gaussian Splatting — 👍7 — https://github.com/BabylonJS/Babylon.js/issues/16671
- Babylon Frame Graph — 💬18 — https://github.com/BabylonJS/Babylon.js/issues/18108

### 8. Güvenlik — orta (ExiEngine güvenlik sözleşmesiyle hizalı)
- Godot `str_to_var`/`ConfigFile` arbitrary code execution — 👍75 — https://github.com/godotengine/godot/issues/80562

### 9. Input / çoklu-dokunma — düşük-orta
- PixiJS multi-touch — 👍5 — https://github.com/pixijs/pixijs/issues/10181
- PixiJS cursor değişimi fare hareketi gerektiriyor — 👍10 — https://github.com/pixijs/pixijs/issues/9767
- PixiJS pointerover/out çift tetikleme — 💬17 — https://github.com/pixijs/pixijs/issues/10131

### 10. Ses — düşük (hafif motor boşluğu)
- GDevelop spatial/directional sound — 👍3 — https://github.com/4ian/GDevelop/issues/6954

### 11. Fizik / pathfinding — düşük
- GDevelop pathfinding + TilemapMask — 👍2 — https://github.com/4ian/GDevelop/issues/4426
- GDevelop mesafe koşulları — 👍4 — https://github.com/4ian/GDevelop/issues/3815

### 12. AI/Agent erişimi — düşük ama stratejik
- GDevelop BYOK (Bring Your Own Key) AI Agent — 👍3 — https://github.com/4ian/GDevelop/issues/7932

## Sonuç

Topluluk talepleri boşluk analizini **bağımsız olarak doğruluyor**: editör (#1, Bevy 👍250),
web erişimi (Godot C# web 👍90), determinizm/frame zamanlaması (Bevy 👍95) ve asset
pipeline/dokümantasyon boşlukları gerçek kullanıcı oylarıyla sabit. ExiEngine için en
çarpıcı sinyal, **AI/Agent erişiminin** yalnızca GDevelop'da tek bir düşük-oyluk talep
olarak görünmesi — yani farklılaştırıcı, kullanıcı tabanı henüz talep etmeden sahiplenilmiş
bir niş. Güvenlik (Godot arbitrary code exec 👍75) da ExiEngine'in `eval`/keyfi-kod yasağını
haklı çıkarıyor.
