# ExiEngine physical device matrix

This list is used to compare `hardware-soak.html` output on real devices. Each row is a separate device/OS/browser combination. The `result` field is only `passed` if there was no error, uncaptured GPU error or unexpected fallback during the test.

## Test flow

1. Open the demo and `test/hardware-soak.html` over HTTPS or from a test host on the same trusted local network.
2. Select WebGL2 and WebGPU separately; run for 30 seconds with 500 sprites, then 30 seconds with 2,000 sprites.
3. If WebGPU is supported, trigger `Manual loss` once during the run. The expected result is `passed-with-loss` with the resource counters cleaned up.
4. Add the result JSON to the table below, together with whether there were errors in the browser console.

The `environment` field in the JSON carries platform/user-agent, secure context, WebGPU/WebGL2 access, DPR, viewport, font availability and the Canvas `measureText("سلام")` shaping measurement; summarize this field in the date/note column when transferring it to the table.

### Android USB setup

By default the server only listens on `127.0.0.1`; no LAN port is opened to the physical device. After connecting an Android device with USB debugging enabled and authorized, on the host:

```powershell
node server.mjs --port 4173
C:\Users\Public\platform-tools\adb.exe reverse tcp:4173 tcp:4173
C:\Users\Public\platform-tools\adb.exe shell am start -a android.intent.action.VIEW -d http://127.0.0.1:4173/test/hardware-soak.html
```

If `adb devices -l` shows no device, the Android row does not count as proven. In this run's snapshot ADB is installed (`37.0.0-14910828`) but no device is connected; therefore no physical Android result was added. iOS Safari and in-app WebView additionally need an HTTPS test host with a user certificate and device logs.

## Current platform note (August 15, 2026)

This section is capability information published by browser vendors; it is not a physical device smoke result.

- Safari/WebKit: WebGPU shipped with Safari 26 on iOS/iPadOS/macOS/visionOS. Because WebKit issue records for Safari 26.2 contain an iOS GPU canvas flicker report, WebGPU is not accepted as the default trusted backend in the iOS row; the physical soak and the WebGL2 fallback are tested together. Sources: [WebKit Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [WebKit Safari 26.2](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [WebKit issue 301627](https://bugs.webkit.org/show_bug.cgi?id=301627).
- Android Chrome: WebGPU was enabled by default with Chrome 121 on Android 12+ with Qualcomm/ARM GPU combinations; device/driver coverage does not count as proven by a single Android row. Source: [Chrome 121 WebGPU](https://developer.chrome.com/blog/new-in-webgpu-121).
- Android WebView: WebView is Chromium-based and updated monthly, but the System WebView version used by the app and the device GPU driver must be recorded in the physical test. The native `androidx.webgpu` library is not the same evidence as the WebView JavaScript API. Sources: [Android WebView update model](https://developer.android.com/develop/ui/views/layout/webapps/jetpack-webkit-overview), [Android WebGPU](https://developer.android.com/develop/ui/views/graphics/webgpu).

## Matrix

| Device / OS | Browser / version | Backend | 500 / 30 s | 2,000 / 30 s | Loss fallback | max texture | peak GPU cull | peak texture | Shaping fallback | Console error | Date / note |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Windows desktop | Current Chromium-based | WebGPU |  |  |  |  |  |  |  |  |  |
| Windows desktop | Current Chromium-based | WebGL2 |  |  | Not applicable |  | 0 |  |  |  |  |
| iPhone / iPad | Current iOS Safari | WebGPU |  |  |  |  |  |  |  |  |  |
| iPhone / iPad | Current iOS Safari | WebGL2 |  |  | Not applicable |  | 0 |  |  |  |  |
| Android phone | Current Chrome | WebGPU |  |  |  |  |  |  |  |  |  |
| Android phone | Current Chrome | WebGL2 |  |  | Not applicable |  | 0 |  |  |  |  |
| Android WebView | Current in-app WebView | WebGL2 |  |  | Not applicable |  | 0 |  |  |  |  |

## Current desktop smoke evidence

Run on August 15, 2026 on a local test host with Chrome 151 / Windows / secure context / DPR 1.25. In a short rerun after the ResizeObserver intrinsic-canvas fix, a canvas of `1200x675`, WebGPU `device-error: 0` and WebGL2 console errors `0` were observed. These results do not replace the 30-second acceptance columns below; they are live regression evidence before physical device and long-duration runs.

| Backend | Sprites / duration | Result / frames | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | The WebGL2 path, text cache and glyph fallback worked |
| WebGPU | 500 / 2 s | `passed` / 110 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | WebGPU compute culling and the buffer lifecycle worked; `device-error: 0` after the resize fix |
| WebGL2 | 500 / 1 s | `passed` / 60 | Not applied | 16384 | 0 B | 4 | 1 | After resource lifecycle changes, `environment.shapingProbe`: width 20.569, rtl; `device-error: 0` |
| WebGPU | 500 / 1 s | `passed` / 44 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | After resource lifecycle changes, `environment.shapingProbe`: width 20.569, rtl; `device-error: 0` |
| WebGPU | 513 / 2 s | `passed` / 106 | Not applied | 8192 | 114688 B / 2 buffers | 4 | 1 | GPU culling source/output stride limit regression; Chrome 151 Windows |
| WebGPU | 500 / 5 s | `passed-with-loss` / 300 | `lossObserved: true` | 8192 | 81920 B / 2 buffers | 4 | 1 | `device-lost` → `renderer-error (manual-soak)`; the test completed without restarting the browser |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | Chrome 151 Windows smoke after hot-path allocation and static buffer lifecycle changes; `device-error: false` |
| WebGPU | 500 / 2 s | `passed` / 110 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | Chrome 151 Windows smoke after hot-path allocation and static buffer lifecycle changes; `device-error: false` |
| WebGPU | 500 / 2 s manual loss | `passed-with-loss` / 24 | `lossObserved: true` | 8192 | 81920 B / 2 buffers | 4 | 1 | After a `manual-soak` loss the soak result is now explicitly finalized; `device-error: false` |
| WebGL2 | 500 / 2 s | `passed` / 113 | Not applied | 16384 | 0 B | 4 | 1 | Chrome 151 Windows after normal SpriteBatch/Text/profiler allocation improvements; `device-error: false` |
| WebGPU | 500 / 2 s | `passed` / 100 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | Chrome 151 Windows after normal SpriteBatch/Text/profiler allocation improvements; `device-error: false` |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 rerun; after the clip batch scalar comparison and asset/atlas security limits, no console warnings/errors |
| WebGPU | 500 / 2 s | `passed` / 74 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 rerun; after the clip batch scalar comparison and asset/atlas security limits, no console warnings/errors |
| WebGL2 | 500 / 2 s | `passed` / 120 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 current-source rerun; after instanced camera invalidation and the nested clip scratch rect, Chrome 151 Windows secure context DPR 1.25, console log empty |
| WebGPU | 500 / 2 s | `passed` / 95 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 current-source rerun; after instanced camera invalidation and the nested clip scratch rect, Chrome 151 Windows secure context DPR 1.25, console log empty |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 rerun after TileMap CPU visible-range culling; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGPU | 500 / 2 s | `passed` / 108 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 rerun after the TileMap culling integration; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 current-source rerun after static render keys moved to a numeric cache version; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGPU | 500 / 2 s | `passed` / 90 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 current-source rerun after static render keys moved to a numeric cache version; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 current-source rerun after the TileMap culling closure moved to scratch memory; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGPU | 500 / 2 s | `passed` / 103 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 current-source rerun after the TileMap culling closure moved to scratch memory; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGL2 | 500 / 2 s | `passed` / 121 | Not applied | 16384 | 0 B | 4 | 1 | August 15, 2026 current-source rerun after the renderer scissor rect scratch change; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |
| WebGPU | 500 / 2 s | `passed` / 100 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | August 15, 2026 current-source rerun after the renderer scissor rect scratch change; Chrome 151 Windows secure context DPR 1.25, `device-error: false`, console log empty |

The console output for this snapshot was not archived as a separate file; console errors must be verified separately on every run in the physical matrix.

In the blend mode runs, the scene used the `normal`, `additive` and `multiply` paths at the same time; WebGL2 state changes and WebGPU pipeline variants were rendered in this smoke flow.

## August 16, 2026 headless fallback rerun

In a separate local Chromium 151 headless session (`Windows`, secure context, DPR 1, GPU off), the 500-sprite / 2-second run was repeated. Explicit WebGL2 gave `passed` / 120 frames with no errors/loss observed. Explicit WebGPU did not start, failing at the `requestAdapter()` stage with `WebGPU adapter not found` even though `navigator.gpu` was visible; this result does not count as WebGPU backend evidence. In the same environment, `auto` selection reported this error with a `fallback` status, switched to WebGL2 and completed `passed` / 121 frames. This headless result does not replace physical GPU, iOS, Android or WebView evidence.

## August 16, 2026 Chromium 151 loopback rerun

On an isolated `127.0.0.1:43173` host, in a real Chromium 151 session with secure context and DPR 1.25, the 500-sprite / 5-second run was repeated. On both backends, `deviceErrorObserved: false`, no console warnings/errors, `textCacheShared: true` and `glyphComplexScriptFallbacks: 1` were observed. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Sprites / duration | Result / frames | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 500 / 5 s | `passed` / 300 | Not applied | 16384 | 0 B | 4 | 1 | Chrome 151 Windows secure context; isolated loopback; console log empty |
| WebGPU | 500 / 5 s | `passed` / 272 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | Chrome 151 Windows secure context; isolated loopback; console log empty |

## August 16, 2026 Chromium 151 viewport regression run

The same loopback harness was repeated with a 390×844 viewport override and DPR 1.25. Because `maxTouchPoints: 0` in this session, the result is not touch device or physical mobile GPU evidence; it is only evidence for the responsive canvas, high-DPI world scale and backend regressions.

| Backend | Viewport / sprites / duration | Result / frames | Loss | max texture | peak GPU cull | peak texture | Shaping fallback | Note |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| WebGL2 | 390×844 / 300 / 3 s | `passed` / 181 | Not applied | 16384 | 0 B | 4 | 1 | Chrome 151 Windows; `deviceErrorObserved: false`; console log empty |
| WebGPU | 390×844 / 300 / 3 s | `passed` / 169 | Not applied | 8192 | 81920 B / 2 buffers | 4 | 1 | Chrome 151 Windows; `deviceErrorObserved: false`; console log empty |

## August 16, 2026 RenderTexture offscreen run

On an isolated `127.0.0.1:43173` host with Chromium 151 / Windows / secure context / DPR 1.25, in a 2,000-sprite, 1-second run, a mini scene was drawn into a separate RenderTexture, the target texture was sampled as a Sprite in the main scene, and it was resized once from 160×90 to 128×72. The browser console warning/error list was empty.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | offscreen passes | target resizes | device error |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 39 | 8192 | 286720 B / 3 buffers | 5 | 1 | 38 | 1 | false |
| WebGL2 | `passed` / 61 | 16384 | 0 B | 4 | 1 | 60 | 1 | false |

This short desktop browser run proves the two-pass RenderTexture integration; it does not replace a 30-second acceptance run or a physical iOS/Android/WebView result.

In the same Chromium 151 / Windows session, after the August 16, 2026 validation-error separation, 2,000 sprites / 3 seconds were repeated on an isolated `127.0.0.1:43175` host: WebGPU `passed` / 167 frames, 166 offscreen passes, 1 target resize, `deviceErrorObserved: false`; WebGL2 `passed` / 181 frames, 180 offscreen passes, 1 target resize, `deviceErrorObserved: false`. This short rerun shows that the `EXI_RENDER_INPUT` Node regression did not break the real backend soak; it is not physical device evidence.

## August 16, 2026 texture-mask/filter run

On an isolated `127.0.0.1:43179` host with Chromium 151 / Windows / secure context / DPR 1.25, in a 2,000-sprite, 3-second run, `grayscale`, `invert`, `brightness`, `maskRect` and `maskTexture` ran in the same scene. `maskTexture` was used on both a normal texture and a RenderTexture preview; no browser console warnings/errors or device errors were observed.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | offscreen passes | target resizes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 165 | 8192 | 286720 B / 3 buffers | 6 | 1 | 164 | 1 | false |
| WebGL2 | `passed` / 179 | 16384 | 0 B | 4 | 1 | 178 | 1 | false |

## August 16, 2026 RenderGroup nested-pass run

On an isolated `127.0.0.1:43179` host with Chromium 151 / Windows / secure context / DPR 1.25, in a 2,000-sprite, 3-second run, a nested `RenderGroup` was placed inside a parent `RenderGroup`. Every frame, the two groups were drawn in post-order offscreen passes, plus the existing mini scene `renderToTexture()` pass; the group targets were sampled as composite quads in the main scene. On both backends `renderGroupPasses: 2`, `peakRenderTargetCount: 3`, `renderTargetResizes: 1`, `deviceErrorObserved: false`, and the browser warning/error list stayed empty. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | RenderGroup passes/frame | explicit offscreen passes | target resizes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 164 | 8192 | 303104 B / 5 buffers | 8 | 3 | 2 | 163 | 1 | false |
| WebGL2 | `passed` / 181 | 16384 | 0 B | 4 | 3 | 2 | 180 | 1 | false |

## August 16, 2026 RenderGroup ping-pong effect run

On an isolated `127.0.0.1:43183` host with Chromium 151 / Windows / secure context / DPR 1.25, in a 2,000-sprite, 3-second run, the parent group ran two effects (`sepia` + `contrast`) and the nested group one effect (`saturate`). The chain used three post-process passes per frame in total; the two-intermediate-target limit and the 16 MiB intermediate pixel budget per group were kept. `peakRenderTargetCount: 6`, `renderTargetResizes: 1`, `deviceErrorObserved: false`, and the browser warning/error list stayed empty. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | RenderGroup passes/frame | post-process passes/frame | explicit offscreen passes | target resizes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 161 | 8192 | 303104 B / 5 buffers | 11 | 6 | 2 | 3 | 160 | 1 | false |
| WebGL2 | `passed` / 178 | 16384 | 0 B | 4 | 6 | 2 | 3 | 177 | 1 | false |

## August 16, 2026 RenderGroup ping-pong 30-second soak

The same isolated loopback/Chromium 151 / Windows / secure context / DPR 1.25 run was extended to 30 seconds over 2,000 sprites with the new `sepia`, `contrast` and `saturate` shaders. Throughout the parent/nested RenderGroup and the three post-process passes per frame, the resource counters stayed constant on both backends; no loss, device errors or browser warnings/errors occurred. This is not physical device or mobile WebView evidence.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | RenderGroup passes/frame | post-process passes/frame | explicit offscreen passes | target resizes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 1781 | 8192 | 303104 B / 5 buffers | 11 | 6 | 2 | 3 | 1780 | 1 | false |
| WebGL2 | `passed` / 1771 | 16384 | 0 B | 4 | 6 | 2 | 3 | 1770 | 1 | false |

## August 16, 2026 SpriteBatch GPU animation run

On an isolated `127.0.0.1:43187` host with Chromium 151 / Windows / secure context / DPR 1.25, 2,000 sprites ran for 3 seconds through `addAnimatedSprite()` with two frames of the same atlas. The animation frame state advanced inside the same SpriteBatch; it was rendered with WebGPU compute culling/indirect draw and the WebGL2 instanced fallback. 34 frame changes were observed on WebGPU and 36 on WebGL2; `deviceErrorObserved: false`, and the RenderGroup/post-process and offscreen counters stayed healthy alongside the existing soak. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | max texture | peak GPU cull | peak texture | peak render target | animation frame changes | RenderGroup passes/frame | post-process passes/frame | explicit offscreen passes | target resizes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 165 | 8192 | 303104 B / 5 buffers | 11 | 6 | 34 | 2 | 3 | 164 | 1 | false |
| WebGL2 | `passed` / 181 | 16384 | 0 B | 4 | 6 | 36 | 2 | 3 | 180 | 1 | false |

## August 16, 2026 GPU texture residency/budget run

On an isolated `127.0.0.1:43189` host, the same 2,000-sprite / 3-second RenderGroup, atlas animation and RenderTexture scene was repeated with the new `baseTexture` residency and total GPU texture budget telemetry. The default total budget was reported as 128 MiB / 4096 resources; atlas frames created no separate GPU textures. Both backends `passed`, with no device errors or loss observed. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | peak texture count | peak texture bytes | max texture bytes | max texture count | peak render target | animation changes | device error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WebGPU | `passed` / 164 | 11 | 269440 B | 134217728 B | 4096 | 6 | 34 | false |
| WebGL2 | `passed` / 181 | 4 | 269436 B | 134217728 B | 4096 | 6 | 36 | false |

## August 16, 2026 texture lifecycle validation run

On an isolated `127.0.0.1:43191` host, after the lifecycle guard change, the same 2,000-sprite / 3-second atlas animation, RenderGroup and RenderTexture scenario was run again. In the Chromium 151 / Windows / secure context / DPR 1.25 run, the `EXI_TEXTURE_INPUT` smoke assertions for destroyed texture inputs also passed in the Node engine smoke. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | peak texture count | peak texture bytes | max texture bytes | peak render target | animation changes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 165 | 11 | 269440 B | 134217728 B | 6 | 34 | false | false |
| WebGL2 | `passed` / 180 | 4 | 269436 B | 134217728 B | 6 | 36 | false | false |

## August 16, 2026 Graphics polygon run

On an isolated `127.0.0.1:43192` host, the new `Graphics.polygon()` ear-clipping path ran together with the 2,000-sprite / 3-second atlas animation, RenderGroup and RenderTexture scenario on Chromium 151 / Windows / secure context / DPR 1.25. `graphicsPolygonTested: true`, no device errors/loss on the browser backends, and the offscreen pass flow completed. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | graphics polygon | peak texture count | peak texture bytes | peak render target | animation changes | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 165 | true | 11 | 269440 B | 6 | 34 | 164 | false | false |
| WebGL2 | `passed` / 181 | true | 5 | 269440 B | 6 | 36 | 180 | false | false |

## August 16, 2026 real Web Audio voice + pan run

On an isolated `127.0.0.1:43194` host, a real `AudioContext` was created from within the hardware soak start interaction; a 10 ms silent `AudioBuffer`, an active voice volume update, lazy creation of an off-center `StereoPannerNode` graph, a return to center pan, voice counting, `stopAll()` and context teardown were run. The Graphics polygon, atlas animation, RenderGroup and RenderTexture flow was also kept in the same run. The Chromium 151 / Windows / secure context / DPR 1.25 result is below; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | audio voice tested | audio pan tested | audio peak voices | audio error | graphics polygon | animation changes | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | 1 | null | true | 31 | 149 | false | false |
| WebGL2 | `passed` / 179 | true | true | 1 | null | true | 36 | 178 | false | false |

## August 16, 2026 safe scene switch run

On an isolated `127.0.0.1:43195` host, after the engine was prepared, it switched to an empty probe scene and then to the main stress scene with `ExiEngine.setScene()`. After the switch, the atlas animation, Graphics polygon, RenderGroup, RenderTexture and audio probe flow continued. The Chromium 151 / Windows / secure context / DPR 1.25 result is below; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | scene switch tested | graphics polygon | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 141 | true | true | true | 140 | false | false |
| WebGL2 | `passed` / 179 | true | true | true | 178 | false | false |

## August 16, 2026 input axis browser run

On an isolated `127.0.0.1:43196` host, real `KeyboardEvent`s were sent to the running engine's listeners to test a `key-axis` binding at positive and neutral values. The `setScene()` switch, AudioContext voice/pan, Graphics polygon, RenderGroup and RenderTexture flow was kept in the same run. The Chromium 151 / Windows / secure context / DPR 1.25 result is below; it is not a physical gamepad or iOS/Android/WebView result.

| Backend | Result / frames | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | true | 149 | false | false |
| WebGL2 | `passed` / 180 | true | true | true | 179 | false | false |

## August 16, 2026 bounded keyboard state run

On an isolated `127.0.0.1:43197` host, the input listener chain and the bounded keyboard state hardening were repeated in a real WebGPU/WebGL2 render run together with `inputAxisTested: true`. In the 3-second run, the scene switch, audio voice/pan, polygon, RenderGroup and offscreen pass flow was kept. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a physical mobile device result.

| Backend | Result / frames | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 149 | true | true | true | 148 | false | false |
| WebGL2 | `passed` / 179 | true | true | true | 178 | false | false |

## August 16, 2026 camera shake run

On an isolated `127.0.0.1:43198` host, a bounded `Camera.shake()` was started, one frame was advanced, and the camera center was verified again with `clearShake()`. In the same real render run, the scene switch, input axis, AudioContext voice/pan, Graphics polygon and offscreen pass flow was kept. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a physical mobile device result.

| Backend | Result / frames | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 150 | true | true | true | true | 149 | false | false |
| WebGL2 | `passed` / 177 | true | true | true | true | 176 | false | false |

## August 16, 2026 lifecycle pause/resume run

On an isolated `127.0.0.1:43199` host, a real Chromium render flow was started; after `engine.start()`, RAF was stopped with `pause()`, restarted with `resume()`, and it was verified that the fixed-step state continued. The soak harness also checked the `pauseOnHidden` contract on a real engine instance. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; because the document visibility transition was not forced by the browser automation, this row is evidence for the manual lifecycle API and a real backend; it is not a physical mobile device result.

| Backend | Result / frames | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 118 | true | true | true | true | true | 117 | false | false |

## August 16, 2026 time scale run

On an isolated `127.0.0.1:43200` host, `setTimeScale(0.5)` and then `setTimeScale(1)` were called on a real engine instance; the `getInfo().timeScale` values were verified. The pause/resume, scene switch, camera shake, input axis, audio pan, RenderGroup and RenderTexture flows were kept in the same run. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a physical mobile device result.

| Backend | Result / frames | time scale tested | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 120 | true | true | true | true | true | true | 119 | false | false |

## August 16, 2026 transform interpolation run

On an isolated `127.0.0.1:43201` host, the engine was run with `interpolate: true`. While the fixed-step transform snapshot/restore path was tested in a real WebGPU/WebGL2 render flow, the timeScale, pause/resume, scene switch, camera shake, input axis, audio pan and offscreen pass checks were kept. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a physical mobile device result.

| Backend | Result / frames | interpolation tested | time scale tested | lifecycle tested | camera shake tested | input axis tested | scene switch tested | audio pan tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 89 | true | true | true | true | true | true | true | 88 | false | false |
| WebGL2 | `passed` / 119 | true | true | true | true | true | true | true | 118 | false | false |

## August 16, 2026 interpolation world-matrix restore retest

On an isolated `127.0.0.1:43202` host, the cache invalidation change that requires the current world matrix to be recomputed after an interpolation restore was run again. In the real WebGPU and WebGL2 render flows, `interpolateTested: true`, no device errors/loss, and the offscreen passes completed. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a physical mobile device result.

| Backend | Result / frames | interpolation tested | time scale tested | lifecycle tested | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 81 | true | true | true | 80 | false | false |
| WebGL2 | `passed` / 119 | true | true | true | 118 | false | false |

## August 16, 2026 Page Lifecycle bfcache run

On an isolated `127.0.0.1:43203` host, synthetic `pagehide` and `pageshow` events were sent to the current engine instance. The RAF/fixed-step/audio lifecycle pause after `pagehide`, and reopening only the engine-originated pause after `pageshow`, were verified in a real WebGPU/WebGL2 render flow. This is a Chromium 151 / Windows / secure context / DPR 1.25 result; it is not a real bfcache navigation or physical mobile device result.

| Backend | Result / frames | lifecycle tested | page lifecycle tested | responsive resize | logical size | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 127 | true | true | true | true | false | false |
| WebGL2 | `passed` / 133 | true | true | true | true | false | false |

## August 16, 2026 TileMap cell flip run

On an isolated `127.0.0.1:43006` host, a 500-sprite / 2-second run was done on real Chromium 151 / Windows / secure context / DPR 1.25. `TileMap.setTile(..., { flipX: true, flipY: true })` was verified on the same atlas with the WebGL2 CPU instance path and the WebGPU GPU-source path; the `tileFlipTested`, Sprite flip and `roundPixels` checks stayed `true` on both backends. The browser diagnostic log is empty, `deviceErrorObserved: false`, and there is no loss. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | tile flip tested | sprite flip tested | round pixels | peak texture bytes | peak render target | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 58 | true | true | true | 266440 B | 6 | 57 | false | false |
| WebGL2 | `passed` / 55 | true | true | true | 266440 B | 6 | 54 | false | false |

## August 16, 2026 AnimatedSprite/SpriteBatch ping-pong run

On an isolated `127.0.0.1:43007` host, a 500-sprite / 2-second run was done on real Chromium 151 / Windows / secure context / DPR 1.25. `pingPong: true` was given to the first `SpriteBatch` animation, and the frame direction switching to `-1` at the end was measured in the real engine update loop; in the WebGL2 and WebGPU results `pingPongTested: true`, the browser diagnostic log is empty, and there are no device errors/loss. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | ping-pong tested | animation frame changes | peak texture bytes | peak render target | explicit offscreen passes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 42 | true | 20 | 266440 B | 6 | 41 | false | false |
| WebGL2 | `passed` / 55 | true | 21 | 266440 B | 6 | 54 | false | false |

## August 16, 2026 animation loop/frame callback run

On an isolated `127.0.0.1:43009` host, a 500-sprite / 2-second run was done on real Chromium 151 / Windows / secure context / DPR 1.25. An `onLoop` callback reporting the loop boundary and an `onFrameChange` callback called only on real frame transitions were attached to the first `SpriteBatch` animation; in the WebGL2 and WebGPU results `loopTested: true`, `frameChangeTested: true`, `pingPongTested: true`, and the browser diagnostic log is empty. The harness takes its start time after the engine has started, so short runs do not wrongly end after a single frame because of setup time. Offscreen rendering, the texture lifecycle and the device error/loss checks also passed in the same run. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen passes | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 83 | true | true | true | 25 | 82 | 106496 B | false | false |
| WebGL2 | `passed` / 82 | true | true | true | 24 | 81 | 0 B | false | false |

## August 16, 2026 TextureAtlas getClip run

On an isolated `127.0.0.1:43010` host, the hardware soak animation frames were produced directly with `TextureAtlas.fromGrid()` and `getClip()`; the same clip was given to both the WebGL2 and WebGPU `SpriteBatch.addAnimatedSprite()` paths. In the 500-sprite / 2-second run, the atlas frame cache, loop/ping-pong, the frame-change callback, the GPU resource flow and the offscreen pass were verified together. The browser diagnostic log is empty, and there are no device errors/loss. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen passes | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 61 | true | true | true | 25 | 60 | 106496 B | false | false |
| WebGL2 | `passed` / 85 | true | true | true | 24 | 84 | 0 B | false | false |

## August 16, 2026 TextureAtlas JSON array importer run

On an isolated `127.0.0.1:43012` host, the hardware soak animation atlas was built from TexturePacker-style `frames` array metadata (`filename`, `frame`, `rotated: false`, `trimmed: false`). The same `getClip()` output ran on the WebGL2 and WebGPU `SpriteBatch` paths with 500 sprites / 2 seconds; loop/ping-pong, the frame-change callback, the GPU resource flow and the offscreen pass passed. The browser diagnostic log is empty, and there are no device errors/loss. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | loop tested | frame-change tested | ping-pong tested | animation frame changes | explicit offscreen passes | peak GPU cull bytes | device error | loss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 86 | true | true | true | 24 | 85 | 106496 B | false | false |
| WebGL2 | `passed` / 69 | true | true | true | 24 | 68 | 0 B | false | false |

## August 16, 2026 current source + manual loss rerun

In this round of work, on Codex in-app Chromium 151 / Windows / secure context / DPR 1.25, on the `127.0.0.1:4173` loopback host, a 3-second normal run and a separate 5-second manual loss run were done with 500 sprites. In the normal run both backends completed with `deviceErrorObserved: false`; in the manual loss run WebGPU received a `device-lost` status and WebGL2 a `context-lost` status, and both runs gave the expected `passed-with-loss` result. The browser warning/error list is empty in all runs. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Normal result / frames | Peak GPU cull | Peak texture | Peak render target | Offscreen passes | Target resizes | Manual loss result / frames | Device error | Console warning/error |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| WebGPU | `passed` / 124 | 106496 B / 5 buffers | 266440 B | 6 | 123 | 1 | `passed-with-loss` / 32 | false | 0 |
| WebGL2 | `passed` / 120 | 0 B | 266440 B | 6 | 119 | 1 | `passed-with-loss` / 39 | false | 0 |

## August 16, 2026 RenderGroup steady-state sync run

After the `RenderGroup` effect target cache change, a 500-sprite, 3-second WebGPU/WebGL2 run was repeated on the same `127.0.0.1:4173` loopback host with Chromium 151 / Windows / secure context / DPR 1.25. Two RenderGroup passes and three post-process passes were kept on both backends; the target count stayed fixed at 6, and only the first resize happened. The Node engine smoke also directly verified that the `setFilter` call is not repeated when the target count/size/filter state is unchanged. The browser warning/error list is empty. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | RenderGroup passes/frame | post-process passes/frame | peak render target | explicit offscreen passes | target resizes | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 123 | 2 | 3 | 6 | 122 | 1 | false | 0 |
| WebGL2 | `passed` / 126 | 2 | 3 | 6 | 125 | 1 | false | 0 |

## August 16, 2026 Node inherited-state fast-path regression run

After the Node alpha/filter/mask and inherited-state fast paths, a 500-sprite, 3-second run on each backend was repeated on an isolated `127.0.0.1:43124` host with Chromium 151 / Windows / secure context / DPR 1.25. On WebGPU and WebGL2, the scene switch, input axis, lifecycle, overlay, RenderGroup/nested RenderGroup, three post-process passes, RenderTexture resize and audio pan probes passed. There are no browser warnings/errors and no device errors. This is desktop Chromium evidence; it is not a physical iOS/Android/WebView result.

| Backend | Result / frames | RenderGroup passes/frame | post-process passes/frame | peak GPU cull | peak texture | peak render target | explicit offscreen passes | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 105 | 2 | 3 | 106496 B / 5 buffers | 266440 B | 6 | 104 | false | 0 |
| WebGL2 | `passed` / 127 | 2 | 3 | 0 B | 266440 B | 6 | 126 | false | 0 |

## August 16, 2026 renderer soak run after the asset integrity change

After the optional Web Crypto `sha256` asset integrity path and the verified texture cache bypass were added, a 500-sprite, 3-second normal run was repeated on an isolated `127.0.0.1:43125` host with Chromium 151 / Windows / secure context / DPR 1.25. In the default render flow without integrity, the WebGPU/WebGL2 results passed together with RenderGroup/nested RenderGroup, three post-process passes, the lifecycle, responsive resize, and the texture and offscreen resource counters. The browser warning/error list is empty; this is desktop Chromium evidence, not a physical iOS/Android/WebView result.

| Backend | Result / frames | RenderGroup passes/frame | post-process passes/frame | peak GPU cull | peak texture | peak render target | explicit offscreen passes | device error | Console warning/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| WebGPU | `passed` / 88 | 2 | 3 | 106496 B / 5 buffers | 266440 B | 6 | 87 | false | 0 |
| WebGL2 | `passed` / 134 | 2 | 3 | 0 B | 266440 B | 6 | 133 | false | 0 |

## August 17, 2026 real browser MCP RuntimeAgent run

In a Codex in-app Chromium session, the loopback preview started by the MCP bridge was opened in a real browser. The root demo now loads `/src/ai/runtime-agent.js` when there is a token and exposes the `engine` and `scene` roots; without a token the normal demo path does not change. With `exi_preview_probe({ path: "/__exi/runtime" })`, `ready: true`, `status: "running"`, `fps: 60`, `draws: 6` and `nodes: 37` were read. In the same MCP stdio session, `exi_preview_call` passed `clamp`, `Node` create/inspect/call/release and `engine.running` calls; an attempt to release the root `engine` was rejected with `EXI_RUNTIME_ROOT_HANDLE`. `exi_preview_batch` completed a create → call → inspect → release chain on the real browser in a single round trip with `completed: 4`, `failed: 0`. The browser console warning/error list is empty. WebGPU and WebGL2 were selected separately; on both backends the DOM runtime showed `Running`, `60 FPS`, `6 DRAW` and `37 NODE`, and the telemetry backend value was `webgpu`/`webgl2` respectively. This is real desktop browser + MCP transport evidence; it is not a long-duration soak or a physical iOS/Android/WebView result.

| Backend | Browser runtime | MCP function call | Handle lifecycle | Protected root | Telemetry | Console warning/error |
| --- | --- | --- | --- | --- | --- | --- |
| WebGPU | `passed` / 60 FPS | `clamp(2,0,1) -> 1` | create → inspect → call → release; batch `4/0` | `engine` release rejected | `ready=true`, `6 draw`, `37 node` | 0 |
| WebGL2 | `passed` / 60 FPS | `clamp(0,0,1) -> 0` | RuntimeAgent restarted | `engine` root protection present | `ready=true`, `6 draw`, `37 node` | 0 |

## August 17, 2026 real browser MCP asset → texture → atlas → sprite run

The `127.0.0.1:64603` loopback preview started through the MCP stdio bridge was opened in a real Chromium session in the Codex in-app Browser. In the same MCP session, an `AssetLoader` was created with the browser RuntimeAgent, `/assets/demo.svg` was loaded, and the real browser `Texture` result was verified as 64×64. `TextureAtlas.fromGrid()` created a 2×2 atlas; a frame was passed as a handle to the `Sprite` constructor and added to the live scene with `scene.add()`. With `exi_preview_batch`, the get-frame → create-Sprite chain returned `completed: 2`, `failed: 0`. In the WebGPU run the telemetry was `ready=true`, `running`, `60 FPS`, `7 draw`, `38 node`; in the WebGL2 run the same asset chain was run again and `ready=true`, `running`, `60 FPS`, `8 draw`, `39 node` were read. The browser console warning/error list is empty on both backends. This is real desktop browser + MCP transport + asset lifecycle evidence; it is not a long-duration soak or a physical iOS/Android/WebView result.

| Backend | Asset load | Atlas/Sprite | MCP batch | Telemetry | Console warning/error |
| --- | --- | --- | --- | --- | ---: |
| WebGPU | `/assets/demo.svg` → `Texture 64×64` | `fromGrid 2×2` → frame → `Sprite` → `Scene.add` | `2/0` | `60 FPS / 7 draw / 38 node` | 0 |
| WebGL2 | `/assets/demo.svg` → `Texture 64×64` | `fromGrid 2×2` → frame → `Sprite` → `Scene.add` | `2/0` | `60 FPS / 8 draw / 39 node` | 0 |

## August 18, 2026 snapshot + deterministic input MCP run

In a real Chromium session in the Codex in-app Browser, the new `snapshot` and `Input.inject` contract was run on the `127.0.0.1:4173` loopback preview. After warmup on each backend, the DOM and GPU runtime gave `ready=true`, `status=running`, `60 FPS`, `6 DRAW` and `37 NODE`; the scene snapshot verified `total=38` through the root handle, with page 64/64 on WebGPU and the first 2/64 on WebGL2. In the WebGPU run, the `engine.stop()` → `Input.inject(keydown)` → `engine.step(1/60)` → `isKeyDown=true` → `inject(keyup)` chain passed. In the WebGL2 run, the `captureFrame(2×2)` result came back as 16 raw bytes. The browser console warning/error list is empty. This is real desktop browser + MCP transport evidence; it is not a physical iOS/Android/WebView or long-duration soak result.

| Backend | DOM runtime | Snapshot | Input tape / step | Capture | Console warning/error |
| --- | --- | --- | --- | --- | ---: |
| WebGPU | `ready=true / running / 60 FPS / 6 draw / 37 node` | `scene total=38`, `38/64`, `truncated=false` | `stop → keydown → step(1/60) → isKeyDown=true → keyup` | offscreen observer active | 0 |
| WebGL2 | `ready=true / running / 60 FPS / 6 draw / 37 node` | `scene total=38`, `2/64`, `truncated=false` | runtime input controls available | `2×2`, `16 bytes` | 0 |

## August 18, 2026 bounded scenario round-trip run

In the same real Codex in-app Browser session, the new `scenario` operation was run on both backends: input event → fixed-step `engine.step()` → bounded canvas grid → bounded scene snapshot. A two-frame run on WebGPU and a one-frame run on WebGL2 completed with `resumed=true`; on both backends the observation gave a `4×2` grid, the snapshot `4 node` and console warnings/errors `0`. In the WebGPU example the DOM telemetry was `ready=true / running / 60 FPS / 6 draw / 37 node`; in the WebGL2 example the sample at the moment of the scenario was `ready=true / running / 60 FPS / 5 draw / 37 node`. The draw count is the instantaneous value measured during the scenario; this row is not long-duration performance or physical device evidence.

| Backend | Scenario | Observe / snapshot | Resume | Console warning/error |
| --- | --- | --- | --- | ---: |
| WebGPU | `2 frame`, keydown → step → keyup | `4×2 grid`, `4 node` | `true` | 0 |
| WebGL2 | `1 frame`, pointer/input → step | `4×2 grid`, `4 node` | `true` | 0 |

## August 18, 2026 scaffold → asset → real browser E2E run

A fresh `ai-e2e-runtime-20260818b` scaffold folder was created in the same MCP stdio session; a 68-byte PNG asset was uploaded with `exi_asset_write`, and `exi_project_preview({ path, port: 4187 })` gave `ok=true`, `checked=2`, `previewId=p1` and target HTTP 200. The real Codex in-app Browser opened the page; DOM telemetry `ready=true`, `status=running`, `backend=webgpu`, `fps=60`, `draws=1`, `nodes=1` and browser warnings/errors `0` were read. In the same long MCP/browser session, the `AssetLoader.loadTexture()` 1×1 `Texture` (`h2`), `TextureAtlas.fromGrid()` (`h3`), `get("0")` frame (`h4`), `Sprite` (`h5`) and `scene.add()` calls completed. The final bounded snapshot gave `total=3`, `Scene + Graphics + Sprite`, `truncated=false`; then `exi_preview_probe` returned `ready=true`, `status=running`, `backend=webgpu` telemetry. Preview stop, browser tab reset, test folder and port cleanup were also completed. This is evidence of the real browser + MCP transport + asset lifecycle chain; it is not the native host CLI's own UI/cancellation behavior or a physical device result.

## Acceptance criteria

- The `result` value must be `passed` in a normal run and `passed-with-loss` on a manual loss.
- A `device-error`, a shader compile error, continuous render errors after a context/device loss, or growing resource counters count as a failure.
- `textCacheShared` must stay `true` for two repeated labels; `peakTextureCount` must be explainable by the test's fixed texture set.
- `glyphComplexScriptFallbacks` must be greater than zero; this proves that the Arabic sample switched to the Canvas shaping path instead of GlyphAtlas in a controlled way.
- On WebGPU, `peakGpuCullBytes` must stay below the device limit; on WebGL2 the GPU culling counter must be `0`.
- Until the physical device rows are filled in, performance or reliability claims must be limited to the desktop browser result.

## September 14, 2026 browser E2E runner + WebGPU/WebGL2 short soak

In line with the Council's separation of evidence from claims, the browser E2E run was repeated in the real system Chrome. The E2E runner's Playwright package resolution and `shell:true` call were fixed; a regression test was added for the existing server `.mjs` public-module path. `EXI_PLAYWRIGHT_CHANNEL=chrome EXI_PLAYWRIGHT_SECONDS=30 EXI_PLAYWRIGHT_SPRITES=200 npm run test:e2e:browser` gave `1 passed` on Windows with Chrome 153.0.8010.36; the demo ran WebGPU at `60 FPS`, real arrow-key movement passed with the RuntimeAgent `scenario`, and a 30-second / 200-sprite hardware soak passed on both selected backends; browser console warnings/errors stayed `0`.

| Backend | Demo FPS | Hardware soak | Frames | Device error | Console warning/error |
| --- | ---: | --- | ---: | --- | ---: |
| WebGPU | 60 | `passed` | 1788 | false | 0 |
| WebGL2 | — | `passed` | 1798 | false | 0 |

This is a bounded 30-second run on real desktop Chrome + GPU; for runs longer than 30 seconds and different sprite loads, `EXI_PLAYWRIGHT_SECONDS` / `EXI_PLAYWRIGHT_SPRITES` can be changed. In the same run, the root demo `RuntimeAgent scenario` movement was observed as `x=0→25.999999999999996`, and the scaffold game created over MCP as `x=432→447`. Manual device/context loss, physical mobile devices and native AI CLI behavior are not proven by this run.
