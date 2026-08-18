# ExiEngine — rakip motor boşluk analizi

Bu doküman, `ENGINE_FEATURE_MATRIX.md` içindeki 27 motorun alt-sistem tablosu ile
topluluk issue/discussion kayıtlarının kesişiminden çıkarılan, **önceliklendirilmiş**
boşluk listesidir. "Boşluk", ya birden fazla motorda ortak eksik, ya zayıf/yarım
uygulanmış, ya da sık talep edilen ama olgunlaşmamış bir yetenek anlamına gelir.

Öncelik ölçeği: **P0** kritik (geniş kullanıcı acısı, birkaç motorda birden eksik),
**P1** yüksek (zayıf veya sık talep), **P2** orta (niş/stratejik). Her satırda hangi
motorları etkilediği ve ExiEngine için fırsat belirtilir.

## P0 — Kritik boşluklar

1. **Hafif/2D motorlarda tam görsel editör yok.**
   PixiJS, Ebiten, ggez, macroquad, FXGL, Piston, melonJS hiçbirinde editör yok;
   Godot/Flax/Stride/Cocos/Defold/s&box kümesine özgü. Editör, kod-dışı kullanıcı
   kitlesi için en büyük giriş engeli ve en sık talep edilen özelliktir.
   *Fırsat:* tarayıcıda çalışan, bağımlılıksız bir editör (runtime ile aynı dil) düşük maliyetle niş açar.

2. **Rust ekosisteminde yerleşik fizik yok.**
   Bevy, Piston, ggez, macroquad'da fizik "dış" (bevy_rapier/xpbd, rapier, nphysics).
   Eklenti parçalanması ve sürüm çakışması (rapier vs xpbd) yeni kullanıcılar için
   kalıcı bir sürtünme. Yalnızca Fyrox yerleşik fizik sunar.
   *Fırsat:* belirleyici (deterministic) bir 2D fizik çekirdeğini runtime'a gömmek Rust motorlarının boşluğunu doldurur.

3. **Tek motorda birleşik 2D+3D nadir.**
   Çoğu motor ya 2D (PixiJS, Ebiten, ggez, melonJS, Flame, FXGL) ya 3D (Babylon,
   Panda3D, Flax, s&box). İkisini iyi yapan sadece Godot, Stride, Fyrox, Urho3D.
   *Fırsat:* aynı çekirdek üzerinde 2D/3D geçişi, oyun türü değiştikçe motor değiştirme maliyetini kaldırır.

4. **Web/WebAssembly birinci sınıf hedef değil.**
   Birçok masaüstü motoru web'i sonradan eklenmiş/deneysel tutar (Bevy WebGPU web yolu
   tamamlanmamış, Stride/Flax/Fyrox web deneysel). Web'de olgun olanlar (PixiJS, Babylon,
   melonJS, GDevelop) ise editör/tam özellik yönünden eksik.
   *Fırsat:* web'i doğuştan birinci hedef almak (ExiEngine zaten bunu yapıyor) iki ucu da yakalar.

## P1 — Yüksek öncelikli boşluklar

5. **Hot-reload / canlı düzenleme az ve yarım.**
   Defold (Lua) ve Bevy (asset) kısmen sunar; Godot sınırlı. Genel olarak sahne/kod
   değişikliğini yeniden başlatmadan görmek sık istenen ama seyrek teslim edilen bir özellik.

6. **Varlık pipeline'ı ve import formatı tutarsız.**
   glTF yaygınlaştı ama FBX/GLB/atlas desteği motorlar arası düzensiz; hafif motorlarda
   yükleyici basit ve sahne-formatı yok. Asset import'un deterministik ve genişletilebilir
   olması toplulukta tekrar eden talep.

7. **Editör UX'i ve dokümantasyon yetersiz.**
   Fyrox ve Bevy editörleri olgunlaşmamış; doküman/onboarding boşluğu Rust motorlarında ve
   yeni C++ motorlarında (Piccolo) belirgin. "Çalışan örnek + net API rehberi" eksikliği
   benimsemeyi düşürür.

8. **Hata ayıklama/profiling araçları zayıf.**
   Hafif motorlarda frame-graf, GPU zamanlama, bellek izleme çoğunlukla yok. Performans
   darboğazı teşhisi için kullanıcı kendi aracını kurar.

9. **Unity'den geçiş yapanlar için C# script olgunluğu düzensiz.**
   Godot C# ikinci sınıf konumda (GDScript öncelikli), Stride/Flax C# iyi ama kullanıcı
   tabanı küçük. Unity göçmenleri tutarlı bir C# + editör deneyimi arıyor.

## P2 — Orta / stratejik boşluklar

10. **Konsol dağıtımı çoğunlukla üçüncü taraf veya lisans kapılı.**
    Godot/Defold third-party, s&box/Flax kapalı. Bağımsız motorlar için konsol yolu pahalı.

11. **Platformlar arası determinizm eksik.**
    Fizik/animasyon sonucunun farklı platformlarda birebir aynı olması (multiplayer/kayıt
    tekrarı için) çoğu motorda garanti edilmez; sık dile getirilir ama nadiren çözülür.

12. **Ajan/LLM öncelikli API yüzeyi hiçbir motorda yok.**
    Hiçbir rakip, motoru bir AI agent'ın doğrudan keşfedip sürebileceği yansımalı/limitli
    bir API + MCP köprüsüyle sunmuyor. Bu ExiEngine'in mevcut farklılaştırıcısıdır; matriste
    rakipsizdir. Stratejik önceliği yüksek, kısa vadede kullanıcı tabanı düşüktür.

## Özet tablo

| # | Boşluk | Öncelik | Etkilenen motorlar | ExiEngine fırsatı |
| --- | --- | --- | --- | --- |
| 1 | Tam görsel editör eksikliği | P0 | PixiJS, Ebiten, ggez, macroquad, FXGL, Piston, melonJS | Tarayıcıda aynı-dil editör |
| 2 | Rust'ta yerleşik fizik yok | P0 | Bevy, Piston, ggez, macroquad | Gömülü deterministik 2D fizik |
| 3 | Birleşik 2D+3D nadir | P0 | Çoğu tek-odak motor | Tek çekirdekte 2D/3D |
| 4 | Web birinci sınıf değil | P0 | Bevy, Stride, Flax, Fyrox | Web-doğuştan runtime |
| 5 | Hot-reload az/yarım | P1 | Genel | Canlı düzenleme |
| 6 | Varlık pipeline tutarsız | P1 | Hafif motorlar | Deterministik import |
| 7 | Editör UX + doküman zayıf | P1 | Fyrox, Bevy, Piccolo | Çalışan örnek + API rehberi |
| 8 | Debug/profiling zayıf | P1 | Hafif motorlar | Frame-graf + GPU zamanlama |
| 9 | C# script olgunluğu düzensiz | P1 | Godot (C#), Stride, Flax | Tutarlı C#/editör |
| 10 | Konsol dağıtımı kapılı | P2 | Godot, Defold, s&box, Flax | — |
| 11 | Platformlar arası determinizm | P2 | Genel | Deterministik çekirdek |
| 12 | Ajan/LLM API yüzeyi yok | P2 | Hiçbiri | ExiEngine farklılaştırıcısı |
