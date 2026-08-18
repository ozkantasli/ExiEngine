# ADR-001 — Programlama dili ve grafik API'si seçimi

Durum: **Kabul edildi (kodda uygulanmış)** · Tarih: 2026-08-17 · Aşama: Architecture & Tech Stack Selection

## Karar

1. **Dil:** TypeScript/JavaScript. Runtime, bağımlılıksız ES modülleri (`src/index.js`) olarak
   dağıtılır; public API'nin tip yüzeyi elle yazılan `index.d.ts` ile taşınır. Node.js yalnızca
   dev/test/MCP sunucusu içindir; tarayıcı runtime'ında gerekmez.
2. **Grafik API'si:** **WebGPU (birincil) + WebGL2 (fallback)**. İki backend de kendi dosyasında
   (`src/render/webgpu-renderer.js`, `src/render/webgl2-renderer.js`); ortak boru hattı modülleri
   (`batch.js`, `instanced.js`, `clear.js`, `scissor.js`, `post-process.js`) ikisini de besler.

## Değerlendirilen ve elenen alternatifler

| Aday | Neden elendi |
| --- | --- |
| C++ + Vulkan/OpenGL/Direct3D | Tarayıcıda çalışamaz. PRD hedefi web-öncelikli (canvas); native API tarayıcı canvas'ına erişemez. Ayrıca dependency-free + ajan-öncelikli MCP döngüsünü kırar. |
| Rust + Vulkan/OpenGL/wgpu (native) | Aynı native erişim engeli; Rust→wasm yolu (bevy_macroquad gibi) build toolchain'i ve WASM runtime bağımlılığı getirir. |
| Rust→wasm (Bevy tarzı) | Build adımı + wasm toolchain'i ekler; reflection-manifest (`exi_api`) JS own-property descriptor okuması üzerine kurulu, native/wasm'a taşımak maliyetli. |
| WebGL2 tek başına | WebGPU compute/indirect culling avantajından (bknz. gap: GPU culling) vazgeçirir; yeni cihazlarda geride kalır. |
| WebGPU tek başına | Safari/eski cihaz desteği eksik; WebGL2 fallback olmadan hedef kitle daralır. |
| Three.js / PixiJS gibi harici grafik kütüphanesi | "Sıfır runtime bağımlılık" sözleşmesini ihlal eder; çekirdek backend'i kendisi yönetme kararıyla çelişir. |

## Gerekçe (PRD hedeflerine göre)

1. **Hedef platform tarayıcı.** PRD §2: modern tarayıcılar + WebGPU/WebGL2. Tarayıcıda yalnızca
   JS (doğrudan) ve WASM (dolaylı) çalışır. Native API'ler (Vulkan/OpenGL/Direct3D) kategorik
   olarak uygulanamaz — bu bir "tradeoff" değil, platform kısıtı.
2. **Sıfır runtime bağımlılık** (PRD §4). JS, tarayıcının global `WebGPU`/`WebGL2` API'lerine
   npm bağımlılığı olmadan konuşabilir; harici kütüphane gerekmez.
3. **Ajan-öncelikli API** (PRD §4, farklılaştırıcı #1). `exi_api` reflection manifest'i JS
   own-property/descriptor'larını getter çalıştırmadan okur — bu JS'de doğrudan, native/wasm'da
   zor. Ajan döngüsü (scaffold → preview → verify) aynı dili paylaşınca araç zinciri tekdüze kalır.
4. **Deterministik bounded çekirdek** (PRD §4). Fixed-step sıralama ve bounded buffer'lar JS'te
   gerçeklenebilir; ağır yük GPU'ya (WebGPU compute culling) taşınır.

## Tradeoff'lar ve sonuçları

- **Performans:** JS, native C++/Rust'tan yavaş; ancak 2D scope + GPU-ayak işi (WebGPU compute,
  indirect draw) ile denge kabul edildi. `bench:*` kapıları sıcak yolları korur.
- **Native dağıtım yok:** konsol/masaüstü binary imkânsız (gap #10). Web-öncelikli PRD'de kabul.
- **WebGPU destek boşluğu:** eski tarayıcılar için WebGL2 fallback ile azaltılır (çift backend).
- **Tip güvenliği:** elle yazılan `index.d.ts`; drift `npm run test:static` ile kilitlenir.

## Kanıt

- `src/render/webgl2-renderer.js`, `src/render/webgpu-renderer.js`
- `src/index.js` (public export yüzeyi), `index.d.ts` (tip bildirimi)
- `package.json`: `"description": "A dependency-free 2D WebGL2/WebGPU renderer core."`
- `AI_ENGINE_GUIDE.md`: "Motor başka bir oyun motoruna import edilmez; çekirdek WebGL2/WebGPU
  backend'lerini kendisi yönetir."
