# ExiEngine fiziksel cihaz matrisi

Bu liste, `hardware-soak.html` çıktısını gerçek cihazlarda karşılaştırmak için kullanılır. Her satır ayrı bir cihaz/OS/tarayıcı kombinasyonudur. `result` alanı yalnızca test süresi boyunca hata, uncaptured GPU error veya beklenmeyen fallback yoksa `passed` olur.

## Test akışı

1. Demo ve `test/hardware-soak.html` HTTPS üzerinden veya aynı güvenilir yerel ağdaki bir test hostundan açılır.
2. WebGL2 ve WebGPU ayrı ayrı seçilir; 500 sprite ile 30 saniye, ardından 2.000 sprite ile 30 saniye çalıştırılır.
3. WebGPU destekliyse çalışma sırasında `Manuel loss` bir kez tetiklenir. Beklenen sonuç `passed-with-loss` ve kaynak sayaçlarının temizlenmesidir.
4. Sonuç JSON’u, tarayıcı konsolunda hata olup olmadığıyla birlikte aşağıdaki tabloya eklenir.

JSON içindeki `environment` alanı platform/user-agent, secure context, WebGPU/WebGL2 erişimi, DPR, viewport, font availability ve Canvas `measureText("سلام")` shaping ölçümünü taşır; tabloya aktarırken bu alanı tarih/not sütununda özetleyin.

### Android USB hazırlığı

Sunucu varsayılan olarak yalnızca `127.0.0.1` üzerinde dinler; fiziksel cihaza LAN portu açılmaz. USB hata ayıklama açık ve yetkilendirilmiş Android cihaz bağlandıktan sonra host üzerinde:

```powershell
node server.mjs --port 4173
C:\Users\Public\platform-tools\adb.exe reverse tcp:4173 tcp:4173
C:\Users\Public\platform-tools\adb.exe shell am start -a android.intent.action.VIEW -d http://127.0.0.1:4173/test/hardware-soak.html
```

`adb devices -l` cihaz göstermiyorsa Android satırı kanıtlanmış sayılmaz. Bu çalışma snapshot’ında ADB kurulu (`37.0.0-14910828`) ancak bağlı cihaz yok; bu nedenle fiziksel Android sonucu eklenmedi. iOS Safari ve uygulama içi WebView için kullanıcı sertifikalı HTTPS test hostu ve cihaz logu ayrıca gerekir.

## Güncel platform notu (15 Ağustos 2026)

Bu bölüm tarayıcı üreticilerinin yayınladığı yetenek bilgisidir; fiziksel cihaz smoke sonucu değildir.

- Safari/WebKit: WebGPU, Safari 26 ile iOS/iPadOS/macOS/visionOS tarafında sevkiyata girdi. Safari 26.2 için WebKit issue kayıtlarında iOS GPU canvas flicker raporu bulunduğu için iOS satırında WebGPU varsayılan güvenilir backend kabul edilmez; fiziksel soak ve WebGL2 fallback birlikte test edilir. Kaynaklar: [WebKit Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [WebKit Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [WebKit issue 301627](https://bugs.webkit.org/show_bug.cgi?id=301627).
- Android Chrome: Chrome 121 ile Android 12+ ve Qualcomm/ARM GPU kombinasyonlarında WebGPU varsayılan açıldı; cihaz/driver kapsamı tek bir Android satırıyla kanıtlanmış sayılmaz. Kaynak: [Chrome 121 WebGPU](https://developer.chrome.com/blog/new-in-webgpu-121).
- Android WebView: WebView Chromium tabanlı ve aylık güncellenir, ancak uygulamanın kullandığı System WebView sürümü ve cihaz GPU sürücüsü fiziksel testte kaydedilmelidir. Native `androidx.webgpu` kütüphanesi WebView JavaScript API’siyle aynı kanıt değildir. Kaynaklar: [Android WebView güncelleme modeli](https://developer.android.com/develop/ui/views/layout/webapps/jetpack-webkit-overview), [Android WebGPU](https://developer.android.com/develop/ui/views/graphics/webgpu).

## Matris

| Cihaz / OS | Tarayıcı / sürüm | Backend | 500 / 30 sn | 2.000 / 30 sn | Loss fallback | max texture | peak GPU cull | peak texture | Shaping fallback | Konsol hatası | Tarih / not |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Windows masaüstü | Chromium tabanlı güncel | WebGPU |  |  |  |  |  |  |  |  |  |
| Windows masaüstü | Chromium tabanlı güncel | WebGL2 |  |  | Uygulanamaz |  | 0 |  |  |  |  |
| iPhone / iPad | iOS Safari güncel | WebGPU |  |  |  |  |  |  |  |  |  |
| iPhone / iPad | iOS Safari güncel | WebGL2 |  |  | Uygulanamaz |  | 0 |  |  |  |  |
| Android telefon | Chrome güncel | WebGPU |  |  |  |  |  |  |  |  |  |
| Android telefon | Chrome güncel | WebGL2 |  |  | Uygulanamaz |  | 0 |  |  |  |  |
| Android WebView | Uygulama içi güncel WebView | WebGL2 |  |  | Uygulanamaz |  | 0 |  |  |  |  |

## Güncel masaüstü smoke kanıtı

15 Ağustos 2026 tarihinde yerel test hostunda, Chrome 151 / Windows / secure context / DPR 1.25 ile çalıştırıldı. ResizeObserver intrinsic-canvas düzeltmesi sonrasında kısa tekrar koşusunda canvas `1200x675`, WebGPU `device-error: 0`, WebGL2 konsol hatası `0` gözlendi. Bu sonuçlar aşağıdaki 30 saniyelik kabul sütunlarının yerine geçmez; fiziksel cihaz ve uzun süreli koşu öncesi canlı regresyon kanıtıdır.

| Backend | Sprite / süre | Sonuç / frame | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Not |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | WebGL2 yolu, text cache ve glyph fallback çalıştı |
| WebGPU | 500 / 2 sn | `passed` / 110 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | WebGPU compute culling ve buffer yaşam döngüsü çalıştı; resize düzeltmesi sonrası `device-error: 0` |
| WebGL2 | 500 / 1 sn | `passed` / 60 | Uygulanmadı | 16384 | 0 B | 4 | 1 | Kaynak yaşam döngüsü değişiklikleri sonrası `environment.shapingProbe`: width 20.569, rtl; `device-error: 0` |
| WebGPU | 500 / 1 sn | `passed` / 44 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | Kaynak yaşam döngüsü değişiklikleri sonrası `environment.shapingProbe`: width 20.569, rtl; `device-error: 0` |
| WebGPU | 513 / 2 sn | `passed` / 106 | Uygulanmadı | 8192 | 114688 B / 2 buffer | 4 | 1 | GPU culling kaynak/çıktı stride sınır regresyonu; Chrome 151 Windows |
| WebGPU | 500 / 5 sn | `passed-with-loss` / 300 | `lossObserved: true` | 8192 | 81920 B / 2 buffer | 4 | 1 | `device-lost` → `renderer-error (manual-soak)`; tarayıcı yeniden başlatılmadan test tamamlandı |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | Hot-path allocation ve static buffer yaşam döngüsü değişiklikleri sonrası Chrome 151 Windows smoke; `device-error: false` |
| WebGPU | 500 / 2 sn | `passed` / 110 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | Hot-path allocation ve static buffer yaşam döngüsü değişiklikleri sonrası Chrome 151 Windows smoke; `device-error: false` |
| WebGPU | 500 / 2 sn manuel loss | `passed-with-loss` / 24 | `lossObserved: true` | 8192 | 81920 B / 2 buffer | 4 | 1 | `manual-soak` loss sonrası soak sonucu artık açıkça finalize ediliyor; `device-error: false` |
| WebGL2 | 500 / 2 sn | `passed` / 113 | Uygulanmadı | 16384 | 0 B | 4 | 1 | Normal SpriteBatch/Text/profiler allocation iyileştirmeleri sonrası Chrome 151 Windows; `device-error: false` |
| WebGPU | 500 / 2 sn | `passed` / 100 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | Normal SpriteBatch/Text/profiler allocation iyileştirmeleri sonrası Chrome 151 Windows; `device-error: false` |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 tekrar koşusu; clip batch scalar karşılaştırması ve asset/atlas güvenlik sınırları sonrası, konsol warning/error yok |
| WebGPU | 500 / 2 sn | `passed` / 74 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 tekrar koşusu; clip batch scalar karşılaştırması ve asset/atlas güvenlik sınırları sonrası, konsol warning/error yok |
| WebGL2 | 500 / 2 sn | `passed` / 120 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 güncel kaynak tekrar koşusu; instanced kamera invalidation ve nested clip scratch rect sonrası, Chrome 151 Windows secure context DPR 1.25, konsol logu boş |
| WebGPU | 500 / 2 sn | `passed` / 95 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 güncel kaynak tekrar koşusu; instanced kamera invalidation ve nested clip scratch rect sonrası, Chrome 151 Windows secure context DPR 1.25, konsol logu boş |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 TileMap CPU görünür-range culling sonrası tekrar koşu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGPU | 500 / 2 sn | `passed` / 108 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 TileMap culling entegrasyonu sonrası tekrar koşu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 statik render key’leri sayısal cache sürümüne alındıktan sonra güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGPU | 500 / 2 sn | `passed` / 90 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 statik render key’leri sayısal cache sürümüne alındıktan sonra güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 TileMap culling closure’ı scratch belleğine taşındıktan sonra güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGPU | 500 / 2 sn | `passed` / 103 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 TileMap culling closure’ı scratch belleğine taşındıktan sonra güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGL2 | 500 / 2 sn | `passed` / 121 | Uygulanmadı | 16384 | 0 B | 4 | 1 | 15 Ağustos 2026 renderer scissor rect scratch değişikliği sonrası güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |
| WebGPU | 500 / 2 sn | `passed` / 100 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | 15 Ağustos 2026 renderer scissor rect scratch değişikliği sonrası güncel kaynak tekrar koşusu; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, konsol logu boş |

Bu snapshot için konsol çıktısı ayrı dosya olarak arşivlenmedi; fiziksel matristeki her koşuda konsol hatası ayrıca doğrulanmalıdır.

Blend mode koşularında sahne aynı anda `normal`, `additive` ve `multiply` yollarını kullandı; WebGL2 state değişimi ve WebGPU pipeline varyantları bu smoke akışında render edildi.

## 16 Ağustos 2026 headless fallback tekrar koşusu

Ayrı bir yerel Chromium 151 headless oturumunda (`Windows`, secure context, DPR 1, GPU kapalı) 500 sprite / 2 saniye koşusu tekrarlandı. Explicit WebGL2 `passed` / 120 frame ve hata/kayıp gözlenmedi. Explicit WebGPU, `navigator.gpu` görünür olmasına rağmen `requestAdapter()` aşamasında `WebGPU adapter bulunamadı` ile başlamadı; bu sonuç WebGPU backend kanıtı sayılmaz. `auto` seçimi aynı ortamda bu hatayı `fallback` status’iyle raporlayıp WebGL2’ye geçti ve `passed` / 121 frame tamamlandı. Bu headless sonuç fiziksel GPU, iOS, Android veya WebView kanıtının yerine geçmez.

## 16 Ağustos 2026 Chromium 151 loopback tekrar koşusu

İzole `127.0.0.1:43173` hostunda gerçek Chromium 151 oturumunda, secure context ve DPR 1.25 ile 500 sprite / 5 saniye koşusu tekrarlandı. Her iki backend’de de `deviceErrorObserved: false`, konsol warning/error yok, `textCacheShared: true` ve `glyphComplexScriptFallbacks: 1` gözlendi. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sprite / süre | Sonuç / frame | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Not |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 500 / 5 sn | `passed` / 300 | Uygulanmadı | 16384 | 0 B | 4 | 1 | Chrome 151 Windows secure context; izole loopback; konsol logu boş |
| WebGPU | 500 / 5 sn | `passed` / 272 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | Chrome 151 Windows secure context; izole loopback; konsol logu boş |

## 16 Ağustos 2026 Chromium 151 viewport regression koşusu

390×844 viewport override ve DPR 1.25 ile aynı loopback harness tekrarlandı. Bu oturumda `maxTouchPoints: 0` olduğu için sonuç dokunmatik cihaz veya fiziksel mobil GPU kanıtı değildir; yalnızca responsive canvas, yüksek DPI dünya ölçeği ve backend regression kanıtıdır.

| Backend | Viewport / sprite / süre | Sonuç / frame | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Not |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 390×844 / 300 / 3 sn | `passed` / 181 | Uygulanmadı | 16384 | 0 B | 4 | 1 | Chrome 151 Windows; `deviceErrorObserved: false`; konsol logu boş |
| WebGPU | 390×844 / 300 / 3 sn | `passed` / 169 | Uygulanmadı | 8192 | 81920 B / 2 buffer | 4 | 1 | Chrome 151 Windows; `deviceErrorObserved: false`; konsol logu boş |

## 16 Ağustos 2026 RenderTexture offscreen koşusu

İzole `127.0.0.1:43173` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 2.000 sprite ve 1 saniyelik koşuda mini sahne ayrı RenderTexture’a çizildi, hedef texture ana sahnede Sprite olarak örneklendi ve bir kez 160×90’dan 128×72’ye resize edildi. Browser console warning/error listesi boştu.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | offscreen pass | target resize | device error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 39 | 8192 | 286720 B / 3 buffer | 5 | 1 | 38 | 1 | false |
| WebGL2 | `passed` / 61 | 16384 | 0 B | 4 | 1 | 60 | 1 | false |

Bu kısa masaüstü browser koşusu iki-pass RenderTexture entegrasyonunu kanıtlar; 30 saniyelik kabul koşusu veya fiziksel iOS/Android/WebView sonucu yerine geçmez.

Aynı Chromium 151 / Windows oturumunda 16 Ağustos 2026 validation-error ayrımı sonrası izole `127.0.0.1:43175` hostunda 2.000 sprite / 3 saniye tekrarlandı: WebGPU `passed` / 167 frame, 166 offscreen pass, 1 target resize, `deviceErrorObserved: false`; WebGL2 `passed` / 181 frame, 180 offscreen pass, 1 target resize, `deviceErrorObserved: false`. Bu kısa tekrar `EXI_RENDER_INPUT` Node regression’ının gerçek backend soak’ı bozmadığını gösterir; fiziksel cihaz kanıtı değildir.

## 16 Ağustos 2026 texture-mask/filter koşusu

İzole `127.0.0.1:43179` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 2.000 sprite ve 3 saniyelik koşuda `grayscale`, `invert`, `brightness`, `maskRect` ve `maskTexture` aynı sahnede çalıştırıldı. `maskTexture` hem normal texture hem de RenderTexture preview üzerinde kullanıldı; browser console warning/error ve device error gözlenmedi.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | offscreen pass | target resize | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 165 | 8192 | 286720 B / 3 buffer | 6 | 1 | 164 | 1 | false |
| WebGL2 | `passed` / 179 | 16384 | 0 B | 4 | 1 | 178 | 1 | false |

## 16 Ağustos 2026 RenderGroup nested-pass koşusu

İzole `127.0.0.1:43179` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 2.000 sprite ve 3 saniyelik koşuda bir parent `RenderGroup` içine bir nested `RenderGroup` yerleştirildi. Her frame iki grup post-order offscreen pass’inde, ayrıca mevcut mini sahne `renderToTexture()` pass’inde çizildi; grup hedefleri ana sahnede composite quad olarak örneklendi. Her iki backend’de `renderGroupPasses: 2`, `peakRenderTargetCount: 3`, `renderTargetResizes: 1`, `deviceErrorObserved: false` ve browser warning/error listesi boş kaldı. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | RenderGroup pass/frame | explicit offscreen pass | target resize | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 164 | 8192 | 303104 B / 5 buffer | 8 | 3 | 2 | 163 | 1 | false |
| WebGL2 | `passed` / 181 | 16384 | 0 B | 4 | 3 | 2 | 180 | 1 | false |

## 16 Ağustos 2026 RenderGroup ping-pong effect koşusu

İzole `127.0.0.1:43183` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 2.000 sprite ve 3 saniyelik koşuda parent grup iki efekt (`sepia` + `contrast`), nested grup bir efekt (`saturate`) çalıştırdı. Zincir toplam üç post-process pass/frame kullandı; iki ara hedef sınırı ve grup başına 16 MiB ara pixel bütçesi korundu. `peakRenderTargetCount: 6`, `renderTargetResizes: 1`, `deviceErrorObserved: false` ve browser warning/error listesi boş kaldı. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | RenderGroup pass/frame | post-process pass/frame | explicit offscreen pass | target resize | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 161 | 8192 | 303104 B / 5 buffer | 11 | 6 | 2 | 3 | 160 | 1 | false |
| WebGL2 | `passed` / 178 | 16384 | 0 B | 4 | 6 | 2 | 3 | 177 | 1 | false |

## 16 Ağustos 2026 RenderGroup ping-pong 30 saniye soak

Aynı izole loopback/Chromium 151 / Windows / secure context / DPR 1.25 koşusu yeni `sepia`, `contrast` ve `saturate` shader’larıyla 2.000 sprite üzerinden 30 saniyeye uzatıldı. Parent/nested RenderGroup ve toplam üç post-process pass/frame boyunca iki backend’de de kaynak sayaçları sabit kaldı; loss, device error ve browser warning/error oluşmadı. Bu fiziksel cihaz veya mobil WebView kanıtı değildir.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | RenderGroup pass/frame | post-process pass/frame | explicit offscreen pass | target resize | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 1781 | 8192 | 303104 B / 5 buffer | 11 | 6 | 2 | 3 | 1780 | 1 | false |
| WebGL2 | `passed` / 1771 | 16384 | 0 B | 4 | 6 | 2 | 3 | 1770 | 1 | false |

## 16 Ağustos 2026 SpriteBatch GPU animation koşusu

İzole `127.0.0.1:43187` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 2.000 sprite aynı atlasın iki frame’iyle `addAnimatedSprite()` üzerinden 3 saniye çalıştırıldı. Animasyon frame state’i aynı SpriteBatch içinde ilerledi; WebGPU compute culling/indirect draw ve WebGL2 instanced fallback ile render edildi. WebGPU’da 34, WebGL2’de 36 frame değişimi gözlendi; `deviceErrorObserved: false`, RenderGroup/post-process ve offscreen sayaçları mevcut soak ile birlikte sağlıklı kaldı. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | max texture | peak GPU cull | peak texture | peak render target | animation frame changes | RenderGroup pass/frame | post-process pass/frame | explicit offscreen pass | target resize | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 165 | 8192 | 303104 B / 5 buffer | 11 | 6 | 34 | 2 | 3 | 164 | 1 | false |
| WebGL2 | `passed` / 181 | 16384 | 0 B | 4 | 6 | 36 | 2 | 3 | 180 | 1 | false |

## 16 Ağustos 2026 GPU texture residency/bütçe koşusu

İzole `127.0.0.1:43189` hostunda aynı 2.000 sprite / 3 saniye RenderGroup, atlas animasyonu ve RenderTexture sahnesi yeni `baseTexture` residency ve toplam GPU texture bütçesi telemetrisiyle tekrarlandı. Varsayılan toplam bütçe 128 MiB / 4096 kaynak olarak raporlandı; atlas frame’leri ayrı GPU texture oluşturmadı. Her iki backend `passed`, device error ve kayıp gözlenmedi. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | peak texture count | peak texture bytes | max texture bytes | max texture count | peak render target | animation changes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 164 | 11 | 269440 B | 134217728 B | 4096 | 6 | 34 | false |
| WebGL2 | `passed` / 181 | 4 | 269436 B | 134217728 B | 4096 | 6 | 36 | false |

## 16 Ağustos 2026 Texture lifecycle validation koşusu

İzole `127.0.0.1:43191` hostunda lifecycle guard değişikliği sonrası aynı 2.000 sprite / 3 saniye atlas animasyonu, RenderGroup ve RenderTexture senaryosu yeniden çalıştırıldı. Chromium 151 / Windows / secure context / DPR 1.25 koşusunda destroy edilmiş texture girişleri için `EXI_TEXTURE_INPUT` smoke assertion’ları da Node engine smoke içinde geçti. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | peak texture count | peak texture bytes | max texture bytes | peak render target | animation changes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 165 | 11 | 269440 B | 134217728 B | 6 | 34 | false | false |
| WebGL2 | `passed` / 180 | 4 | 269436 B | 134217728 B | 6 | 36 | false | false |

## 16 Ağustos 2026 Graphics polygon koşusu

İzole `127.0.0.1:43192` hostunda yeni `Graphics.polygon()` ear-clipping yolu, 2.000 sprite / 3 saniye atlas animasyonu, RenderGroup ve RenderTexture senaryosuyla birlikte Chromium 151 / Windows / secure context / DPR 1.25 üzerinde çalıştırıldı. `graphicsPolygonTested: true`, browser backend’lerinde device error/loss yok ve offscreen pass akışı tamamlandı. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | graphics polygon | peak texture count | peak texture bytes | peak render target | animation changes | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 165 | true | 11 | 269440 B | 6 | 34 | 164 | false | false |
| WebGL2 | `passed` / 181 | true | 5 | 269440 B | 6 | 36 | 180 | false | false |

## 16 Ağustos 2026 Gerçek Web Audio voice + pan koşusu

İzole `127.0.0.1:43194` hostunda hardware soak başlatma etkileşimi içinden gerçek `AudioContext` oluşturuldu; 10 ms sessiz `AudioBuffer`, aktif voice volume güncellemesi, merkez dışı `StereoPannerNode` graph’ının lazy oluşturulması, tekrar merkez pan’a dönüş, voice sayımı, `stopAll()` ve context teardown çalıştırıldı. Aynı koşuda Graphics polygon, atlas animasyonu, RenderGroup ve RenderTexture akışı da korundu. Chromium 151 / Windows / secure context / DPR 1.25 sonucu aşağıdadır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | audio voice tested | audio pan tested | audio peak voices | audio error | graphics polygon | animation changes | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | 1 | null | true | 31 | 149 | false | false |
| WebGL2 | `passed` / 179 | true | true | 1 | null | true | 36 | 178 | false | false |

## 16 Ağustos 2026 Güvenli scene switch koşusu

İzole `127.0.0.1:43195` hostunda engine hazırlandıktan sonra boş bir probe scene’e, ardından ana stress scene’e `ExiEngine.setScene()` ile geçildi. Geçişten sonra atlas animasyonu, Graphics polygon, RenderGroup, RenderTexture ve audio probe akışı sürdü. Chromium 151 / Windows / secure context / DPR 1.25 sonucu aşağıdadır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | scene switch tested | graphics polygon | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 141 | true | true | true | 140 | false | false |
| WebGL2 | `passed` / 179 | true | true | true | 178 | false | false |

## 16 Ağustos 2026 Input axis browser koşusu

İzole `127.0.0.1:43196` hostunda çalışan engine listener’larına gerçek `KeyboardEvent` gönderilerek `key-axis` binding’i pozitif ve nötr değerlerde test edildi. Aynı koşuda `setScene()` geçişi, AudioContext voice/pan, Graphics polygon, RenderGroup ve RenderTexture akışı korundu. Chromium 151 / Windows / secure context / DPR 1.25 sonucu aşağıdadır; fiziksel gamepad veya iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | true | 149 | false | false |
| WebGL2 | `passed` / 180 | true | true | true | 179 | false | false |

## 16 Ağustos 2026 Bounded keyboard state koşusu

İzole `127.0.0.1:43197` hostunda input listener zinciri ve bounded keyboard state hardening’i, `inputAxisTested: true` ile birlikte gerçek WebGPU/WebGL2 render koşusunda tekrarlandı. 3 saniyelik koşuda scene switch, audio voice/pan, polygon, RenderGroup ve offscreen pass akışı korunmuştur. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 149 | true | true | true | 148 | false | false |
| WebGL2 | `passed` / 179 | true | true | true | 178 | false | false |

## 16 Ağustos 2026 Camera shake koşusu

İzole `127.0.0.1:43198` hostunda bounded `Camera.shake()` başlatıldı, bir frame ilerletildi ve `clearShake()` ile kamera merkezi geri doğrulandı. Aynı gerçek render koşusunda scene switch, input axis, AudioContext voice/pan, Graphics polygon ve offscreen pass akışı korundu. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | true | true | 149 | false | false |
| WebGL2 | `passed` / 177 | true | true | true | true | 176 | false | false |

## 16 Ağustos 2026 Lifecycle pause/resume koşusu

İzole `127.0.0.1:43199` hostunda gerçek Chromium render akışı başlatıldı; `engine.start()` sonrası `pause()` ile RAF durduruldu, `resume()` ile yeniden başlatıldı ve fixed-step state’in devam ettiği doğrulandı. Soak harness ayrıca `pauseOnHidden` sözleşmesini gerçek engine instance üzerinde kontrol etti. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; document görünürlük geçişi tarayıcı otomasyonu tarafından zorlanmadığı için bu satır manuel lifecycle API ve gerçek backend kanıtıdır; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 118 | true | true | true | true | true | 117 | false | false |

## 16 Ağustos 2026 Time scale koşusu

İzole `127.0.0.1:43200` hostunda gerçek engine instance’ında `setTimeScale(0.5)` ve tekrar `setTimeScale(1)` çağrıları yapıldı; `getInfo().timeScale` değerleri doğrulandı. Aynı koşuda pause/resume, scene switch, camera shake, input axis, audio pan, RenderGroup ve RenderTexture akışları korundu. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | time scale tested | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 120 | true | true | true | true | true | true | 119 | false | false |

## 16 Ağustos 2026 Transform interpolation koşusu

İzole `127.0.0.1:43201` hostunda engine `interpolate: true` ile çalıştırıldı. Fixed-step transform snapshot/restore yolu gerçek WebGPU/WebGL2 render akışında test edilirken timeScale, pause/resume, scene switch, camera shake, input axis, audio pan ve offscreen pass kontrolleri korundu. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | interpolation tested | time scale tested | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 119 | true | true | true | true | true | true | true | 118 | false | false |

## 16 Ağustos 2026 Interpolation world-matrix restore retest

İzole `127.0.0.1:43202` hostunda interpolation restore sonrasında güncel world matrix’in yeniden hesaplanması gereken cache invalidation değişikliği tekrar çalıştırıldı. WebGPU ve WebGL2 gerçek render akışında `interpolateTested: true`, device error/loss yok ve offscreen pass tamamlandı. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | interpolation tested | time scale tested | lifecycle tested | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 81 | true | true | true | 80 | false | false |
| WebGL2 | `passed` / 119 | true | true | true | 118 | false | false |

## 16 Ağustos 2026 Page Lifecycle bfcache koşusu

İzole `127.0.0.1:43203` hostunda güncel engine instance’ına synthetic `pagehide` ve `pageshow` olayları gönderildi. `pagehide` sonrası RAF/fixed-step/audio lifecycle pause, `pageshow` sonrası yalnızca engine kaynaklı pause’un geri açılması gerçek WebGPU/WebGL2 render akışında doğrulandı. Chromium 151 / Windows / secure context / DPR 1.25 sonucudur; gerçek bfcache navigasyonu ve fiziksel mobil cihaz sonucu değildir.

| Backend | Sonuç / frame | lifecycle tested | page lifecycle tested | responsive resize | logical size | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 127 | true | true | true | true | false | false |
| WebGL2 | `passed` / 133 | true | true | true | true | false | false |

## 16 Ağustos 2026 TileMap hücre flip koşusu

İzole `127.0.0.1:43006` hostunda 500 sprite / 2 saniye gerçek Chromium 151 / Windows / secure context / DPR 1.25 koşusu yapıldı. `TileMap.setTile(..., { flipX: true, flipY: true })` aynı atlas üzerinde WebGL2 CPU instance yolu ve WebGPU GPU-source yolu ile doğrulandı; `tileFlipTested`, Sprite flip ve `roundPixels` kontrolleri iki backend’de de `true` kaldı. Browser tanı logu boş, `deviceErrorObserved: false`, kayıp yoktur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | tile flip tested | sprite flip tested | round pixels | peak texture bytes | peak render target | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 58 | true | true | true | 266440 B | 6 | 57 | false | false |
| WebGL2 | `passed` / 55 | true | true | true | 266440 B | 6 | 54 | false | false |

## 16 Ağustos 2026 AnimatedSprite/SpriteBatch ping-pong koşusu

İzole `127.0.0.1:43007` hostunda 500 sprite / 2 saniye gerçek Chromium 151 / Windows / secure context / DPR 1.25 koşusu yapıldı. İlk `SpriteBatch` animasyonuna `pingPong: true` verilerek frame yönünün uçta `-1` yönüne geçtiği gerçek engine update döngüsünde ölçüldü; WebGL2 ve WebGPU sonuçlarında `pingPongTested: true`, browser tanı logu boş, device error/loss yoktur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | ping-pong tested | animation frame changes | peak texture bytes | peak render target | explicit offscreen pass | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 42 | true | 20 | 266440 B | 6 | 41 | false | false |
| WebGL2 | `passed` / 55 | true | 21 | 266440 B | 6 | 54 | false | false |

## 16 Ağustos 2026 Animasyon loop/frame callback koşusu

İzole `127.0.0.1:43009` hostunda 500 sprite / 2 saniye gerçek Chromium 151 / Windows / secure context / DPR 1.25 koşusu yapıldı. İlk `SpriteBatch` animasyonuna döngü sınırını bildiren `onLoop` ve yalnızca gerçek frame geçişlerinde çağrılan `onFrameChange` callback’leri bağlandı; WebGL2 ve WebGPU sonuçlarında `loopTested: true`, `frameChangeTested: true`, `pingPongTested: true` ve browser tanı logu boştur. Harness başlangıç zamanını engine başlatıldıktan sonra alıyor; böylece kısa koşular hazırlık süresine göre hatalı biçimde tek frame’de sonlanmıyor. Offscreen render, texture yaşam döngüsü ve device error/loss kontrolleri de aynı koşuda geçti. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen pass | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 83 | true | true | true | 25 | 82 | 106496 B | false | false |
| WebGL2 | `passed` / 82 | true | true | true | 24 | 81 | 0 B | false | false |

## 16 Ağustos 2026 TextureAtlas getClip koşusu

İzole `127.0.0.1:43010` hostunda hardware soak animasyon frame’leri doğrudan `TextureAtlas.fromGrid()` ve `getClip()` ile üretildi; aynı clip hem WebGL2 hem WebGPU `SpriteBatch.addAnimatedSprite()` yoluna verildi. 500 sprite / 2 saniye koşusunda atlas frame cache’i, loop/ping-pong, frame-change callback, GPU kaynak akışı ve offscreen pass birlikte doğrulandı. Browser tanı logu boş, device error/loss yoktur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen pass | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 61 | true | true | true | 25 | 60 | 106496 B | false | false |
| WebGL2 | `passed` / 85 | true | true | true | 24 | 84 | 0 B | false | false |

## 16 Ağustos 2026 TextureAtlas JSON array importer koşusu

İzole `127.0.0.1:43012` hostunda hardware soak animasyon atlası TexturePacker tarzı `frames` array metadata’sından (`filename`, `frame`, `rotated: false`, `trimmed: false`) oluşturuldu. Aynı `getClip()` çıktısı WebGL2 ve WebGPU `SpriteBatch` yollarında 500 sprite / 2 saniye çalıştı; loop/ping-pong, frame-change callback, GPU kaynak akışı ve offscreen pass geçti. Browser tanı logu boş, device error/loss yoktur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen pass | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 86 | true | true | true | 24 | 85 | 106496 B | false | false |
| WebGL2 | `passed` / 69 | true | true | true | 24 | 68 | 0 B | false | false |

## 16 Ağustos 2026 mevcut kaynak + manuel loss tekrar koşusu

Bu çalışma turunda Codex in-app Chromium 151 / Windows / secure context / DPR 1.25 üzerinde `127.0.0.1:4173` loopback hostunda 500 sprite ile 3 saniyelik normal koşu ve ayrı 5 saniyelik manuel loss koşusu çalıştırıldı. Normal koşuda iki backend `deviceErrorObserved: false` ile tamamlandı; manuel loss koşusunda WebGPU `device-lost`, WebGL2 `context-lost` status’ü aldı ve her iki koşu da beklenen `passed-with-loss` sonucu verdi. Browser warning/error listesi tüm koşularda boştur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Normal sonuç / frame | Peak GPU cull | Peak texture | Peak render target | Offscreen pass | Target resize | Manuel loss sonucu / frame | Device error | Console warning/error |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| WebGPU | `passed` / 124 | 106496 B / 5 buffer | 266440 B | 6 | 123 | 1 | `passed-with-loss` / 32 | false | 0 |
| WebGL2 | `passed` / 120 | 0 B | 266440 B | 6 | 119 | 1 | `passed-with-loss` / 39 | false | 0 |

## 16 Ağustos 2026 RenderGroup steady-state sync koşusu

`RenderGroup` effect target cache değişikliği sonrası aynı `127.0.0.1:4173` loopback hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 500 sprite ve 3 saniyelik WebGPU/WebGL2 koşusu tekrarlandı. Her iki backend’de iki RenderGroup pass’i ve üç post-process pass’i korundu; target sayısı 6’da sabit kaldı, yalnızca ilk resize gerçekleşti. Node engine smoke ayrıca sabit target count/boyut/filter durumunda `setFilter` çağrısının tekrarlanmadığını doğrudan doğruladı. Browser warning/error listesi boştur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | RenderGroup pass/frame | post-process pass/frame | peak render target | explicit offscreen pass | target resize | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 123 | 2 | 3 | 6 | 122 | 1 | false | 0 |
| WebGL2 | `passed` / 126 | 2 | 3 | 6 | 125 | 1 | false | 0 |

## 16 Ağustos 2026 Node inherited-state fast-path regression koşusu

Node alpha/filter/mask ve inherited-state fast-path’leri sonrası izole `127.0.0.1:43124` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile her backend’de 500 sprite ve 3 saniyelik koşu tekrarlandı. WebGPU ve WebGL2’de sahne geçişi, input axis, lifecycle, overlay, RenderGroup/nested RenderGroup, üç post-process pass’i, RenderTexture resize ve audio pan probe’ları geçti. Browser warning/error listesi ve device error yoktur. Bu masaüstü Chromium kanıtıdır; fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | RenderGroup pass/frame | post-process pass/frame | peak GPU cull | peak texture | peak render target | explicit offscreen pass | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 105 | 2 | 3 | 106496 B / 5 buffer | 266440 B | 6 | 104 | false | 0 |
| WebGL2 | `passed` / 127 | 2 | 3 | 0 B | 266440 B | 6 | 126 | false | 0 |

## 16 Ağustos 2026 Asset integrity değişikliği sonrası renderer soak koşusu

İsteğe bağlı Web Crypto `sha256` asset integrity yolu ve doğrulanmış texture cache bypass’ı eklendikten sonra izole `127.0.0.1:43125` hostunda Chromium 151 / Windows / secure context / DPR 1.25 ile 500 sprite ve 3 saniyelik normal koşu tekrarlandı. Integrity verilmemiş varsayılan render akışında WebGPU/WebGL2 sonuçları, RenderGroup/nested RenderGroup, üç post-process pass’i, lifecycle, responsive resize, texture ve offscreen kaynak sayaçlarıyla birlikte geçti. Browser warning/error listesi boştur; bu masaüstü Chromium kanıtıdır, fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Sonuç / frame | RenderGroup pass/frame | post-process pass/frame | peak GPU cull | peak texture | peak render target | explicit offscreen pass | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 88 | 2 | 3 | 106496 B / 5 buffer | 266440 B | 6 | 87 | false | 0 |
| WebGL2 | `passed` / 134 | 2 | 3 | 0 B | 266440 B | 6 | 133 | false | 0 |

## 17 Ağustos 2026 gerçek browser MCP RuntimeAgent koşusu

Codex in-app Chromium oturumunda MCP bridge’in başlattığı loopback preview gerçek tarayıcıda açıldı. Root demo artık token varsa `/src/ai/runtime-agent.js` yükleyip `engine` ve `scene` köklerini sunuyor; token yoksa normal demo yolu değişmiyor. `exi_preview_probe({ path: "/__exi/runtime" })` ile `ready: true`, `status: "running"`, `fps: 60`, `draws: 6`, `nodes: 37` okundu. Aynı MCP stdio oturumunda `exi_preview_call` ile `clamp`, `Node` create/inspect/call/release ve `engine.running` çağrıları geçti; root `engine` release denemesi `EXI_RUNTIME_ROOT_HANDLE` ile reddedildi. `exi_preview_batch` gerçek browser üzerinde create → call → inspect → release zincirini tek round-trip’te `completed: 4`, `failed: 0` ile tamamladı. Browser console warning/error listesi boştur. WebGPU ve WebGL2 ayrı ayrı seçildi; iki backend’de de DOM runtime `Çalışıyor`, `60 FPS`, `6 DRAW`, `37 NODE` gösterdi ve telemetry backend değeri sırasıyla `webgpu`/`webgl2` oldu. Bu gerçek masaüstü browser + MCP transport kanıtıdır; uzun süreli soak veya fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Browser runtime | MCP function call | Handle lifecycle | Protected root | Telemetry | Console warning/error |
| --- | --- | --- | --- | --- | --- | --- |
| WebGPU | `passed` / 60 FPS | `clamp(2,0,1) -> 1` | create → inspect → call → release; batch `4/0` | `engine` release reddedildi | `ready=true`, `6 draw`, `37 node` | 0 |
| WebGL2 | `passed` / 60 FPS | `clamp(0,0,1) -> 0` | RuntimeAgent yeniden başlatıldı | `engine` root koruması mevcut | `ready=true`, `6 draw`, `37 node` | 0 |

## 17 Ağustos 2026 gerçek browser MCP asset → texture → atlas → sprite koşusu

MCP stdio bridge üzerinden başlatılan `127.0.0.1:64603` loopback preview, Codex in-app Browser gerçek Chromium oturumunda açıldı. Aynı MCP oturumunda browser RuntimeAgent ile `AssetLoader` oluşturuldu, `/assets/demo.svg` yüklendi ve gerçek browser `Texture` sonucu 64×64 olarak doğrulandı. `TextureAtlas.fromGrid()` 2×2 atlas oluşturdu; bir frame `Sprite` constructor’ına handle olarak verildi ve `scene.add()` ile canlı sahneye eklendi. `exi_preview_batch` ile frame alma → Sprite oluşturma zinciri `completed: 2`, `failed: 0` döndürdü. WebGPU koşusunda telemetry `ready=true`, `running`, `60 FPS`, `7 draw`, `38 node`; WebGL2 koşusunda aynı asset zinciri yeniden çalıştırıldı ve `ready=true`, `running`, `60 FPS`, `8 draw`, `39 node` okundu. Her iki backend’de browser console warning/error listesi boştur. Bu gerçek masaüstü browser + MCP transport + asset lifecycle kanıtıdır; uzun süreli soak veya fiziksel iOS/Android/WebView sonucu değildir.

| Backend | Asset load | Atlas/Sprite | MCP batch | Telemetry | Console warning/error |
| --- | --- | --- | --- | --- | ---: |
| WebGPU | `/assets/demo.svg` → `Texture 64×64` | `fromGrid 2×2` → frame → `Sprite` → `Scene.add` | `2/0` | `60 FPS / 7 draw / 38 node` | 0 |
| WebGL2 | `/assets/demo.svg` → `Texture 64×64` | `fromGrid 2×2` → frame → `Sprite` → `Scene.add` | `2/0` | `60 FPS / 8 draw / 39 node` | 0 |

## 18 Ağustos 2026 snapshot + deterministic input MCP koşusu

Codex in-app Browser gerçek Chromium oturumunda `127.0.0.1:4173` loopback preview üzerinde yeni `snapshot` ve `Input.inject` sözleşmesi çalıştırıldı. Her backend warmup sonrasında DOM ve GPU runtime `ready=true`, `status=running`, `60 FPS`, `6 DRAW`, `37 NODE` verdi; scene snapshot root handle üzerinden `total=38` ve WebGPU’da 64/64, WebGL2’da ilk 2/64 page doğrulandı. WebGPU koşusunda `engine.stop()` → `Input.inject(keydown)` → `engine.step(1/60)` → `isKeyDown=true` → `inject(keyup)` zinciri geçti. WebGL2 koşusunda `captureFrame(2×2)` sonucu 16 raw byte olarak döndü. Browser console warning/error listesi boştur. Bu gerçek masaüstü browser + MCP transport kanıtıdır; fiziksel iOS/Android/WebView veya uzun süreli soak sonucu değildir.

| Backend | DOM runtime | Snapshot | Input tape / step | Capture | Console warning/error |
| --- | --- | --- | --- | --- | ---: |
| WebGPU | `ready=true / running / 60 FPS / 6 draw / 37 node` | `scene total=38`, `38/64`, `truncated=false` | `stop → keydown → step(1/60) → isKeyDown=true → keyup` | offscreen observer active | 0 |
| WebGL2 | `ready=true / running / 60 FPS / 6 draw / 37 node` | `scene total=38`, `2/64`, `truncated=false` | runtime input controls available | `2×2`, `16 bytes` | 0 |

## 18 Ağustos 2026 bounded scenario round-trip koşusu

Aynı gerçek Codex in-app Browser oturumunda yeni `scenario` operasyonu iki backend’de çalıştırıldı: input event → fixed-step `engine.step()` → bounded canvas grid → bounded scene snapshot. WebGPU’da iki frame, WebGL2’da bir frame koşusu `resumed=true` ile tamamlandı; iki backend’de de gözlem `4×2` grid, snapshot `4 node` ve console warning/error `0` verdi. WebGPU örneğinde DOM telemetry `ready=true / running / 60 FPS / 6 draw / 37 node`; WebGL2 örneğinde senaryo anındaki örnek `ready=true / running / 60 FPS / 5 draw / 37 node` idi. Draw sayısı senaryo sırasında ölçülen anlık değerdir; bu satır uzun süreli performans veya fiziksel cihaz kanıtı değildir.

| Backend | Scenario | Observe / snapshot | Resume | Console warning/error |
| --- | --- | --- | --- | ---: |
| WebGPU | `2 frame`, keydown → step → keyup | `4×2 grid`, `4 node` | `true` | 0 |
| WebGL2 | `1 frame`, pointer/input → step | `4×2 grid`, `4 node` | `true` | 0 |

## 18 Ağustos 2026 scaffold → asset → gerçek browser E2E koşusu

Fresh `ai-e2e-runtime-20260818b` scaffold klasörü aynı MCP stdio oturumunda oluşturuldu; 68 byte PNG asset `exi_asset_write` ile yüklendi ve `exi_project_preview({ path, port: 4187 })` `ok=true`, `checked=2`, `previewId=p1`, hedef HTTP 200 verdi. Gerçek Codex in-app Browser sayfayı açtı; DOM telemetry `ready=true`, `status=running`, `backend=webgpu`, `fps=60`, `draws=1`, `nodes=1`, browser warning/error `0` okundu. Aynı uzun MCP/browser oturumunda `AssetLoader.loadTexture()` 1×1 `Texture` (`h2`), `TextureAtlas.fromGrid()` (`h3`), `get("0")` frame (`h4`), `Sprite` (`h5`) ve `scene.add()` çağrıları tamamlandı. Son bounded snapshot `total=3`, `Scene + Graphics + Sprite`, `truncated=false` verdi; ardından `exi_preview_probe` `ready=true`, `status=running`, `backend=webgpu` telemetry’sini döndürdü. Preview stop, browser tab reset, test klasörü ve port cleanup da tamamlandı. Bu, gerçek browser + MCP transport + asset lifecycle zincirinin kanıtıdır; native host CLI’nin kendi UI/cancellation davranışı ve fiziksel cihaz sonucu değildir.

## Kabul kriterleri

- `result` değeri normal koşuda `passed`, manuel kayıpta `passed-with-loss` olmalı.
- `device-error`, shader derleme hatası, context/device kaybından sonra sürekli render hatası veya artan kaynak sayaçları başarısızlık sayılır.
- `textCacheShared` tekrar eden iki label için `true` kalmalı; `peakTextureCount` testin sabit texture setiyle açıklanabilir olmalı.
- `glyphComplexScriptFallbacks` sıfırdan büyük olmalı; bu, Arapça örneğinin GlyphAtlas yerine Canvas shaping yoluna kontrollü geçtiğini kanıtlar.
- WebGPU’da `peakGpuCullBytes` cihaz limitinin altında kalmalı; WebGL2’da GPU culling sayacı `0` olmalı.
- Fiziksel cihaz satırları doldurulmadan performans veya güvenilirlik iddiası masaüstü browser sonucu ile sınırlı tutulmalı.
