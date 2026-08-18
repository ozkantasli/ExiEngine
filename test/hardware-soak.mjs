import { AudioManager, Camera, ExiEngine, GlyphAtlas, Graphics, NineSliceSprite, RenderGroup, RenderTexture, Scene, Sprite, SpriteBatch, Text, TextCache, Texture, TextureAtlas, TileMap } from "../src/index.js";

const output = document.querySelector("#output");
let canvas = document.querySelector("#canvas");
const rendererInput = document.querySelector("#renderer");
const spriteInput = document.querySelector("#sprites");
const secondsInput = document.querySelector("#seconds");
const startButton = document.querySelector("#start");
const lossButton = document.querySelector("#loss");
let engine = null;
let audio = null;
let runToken = 0;
let manualLossRequested = false;

function positiveInteger(input, fallback, maximum) {
  const value = Number(input.value);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(maximum, value) : fallback;
}

function print(value) {
  output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function limitsOf(info) {
  return {
    maxTextureDimension2D: info.maxTextureDimension2D || info.maxTextureSize || 0,
    maxBufferSize: info.maxBufferSize || 0,
    maxStorageBufferBindingSize: info.maxStorageBufferBindingSize || 0,
    maxVertexBufferBytes: info.maxVertexBufferBytes || 0,
    maxInstanceBufferBytes: info.maxInstanceBufferBytes || 0,
    maxGpuCullMemoryBytes: info.maxGpuCullMemoryBytes || 0,
    maxTextureBytes: info.maxTextureBytes || 0,
    maxTextureCount: info.maxTextureCount || 0,
  };
}

function environmentOf() {
  let webgl2Available = false;
  try {
    const probe = document.createElement("canvas");
    webgl2Available = Boolean(probe.getContext("webgl2"));
  } catch {}
  const fonts = document.fonts;
  let shapingProbe = null;
  try {
    const probeCanvas = document.createElement("canvas");
    const context = probeCanvas.getContext("2d");
    if (context) {
      context.font = "14px sans-serif";
      context.direction = "rtl";
      const metrics = context.measureText("سلام");
      shapingProbe = {
        width: Number.isFinite(metrics.width) ? Number(metrics.width.toFixed(3)) : 0,
        actualBoundingBoxAscent: Number.isFinite(metrics.actualBoundingBoxAscent) ? Number(metrics.actualBoundingBoxAscent.toFixed(3)) : 0,
        actualBoundingBoxDescent: Number.isFinite(metrics.actualBoundingBoxDescent) ? Number(metrics.actualBoundingBoxDescent.toFixed(3)) : 0,
        direction: context.direction,
      };
    }
  } catch {}
  return {
    userAgent: navigator.userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || "unknown",
    secureContext: globalThis.isSecureContext === true,
    webgpuAvailable: Boolean(navigator.gpu),
    webgl2Available,
    devicePixelRatio: Number(globalThis.devicePixelRatio) || 1,
    viewport: { width: globalThis.innerWidth || 0, height: globalThis.innerHeight || 0 },
    touch: {
      maxTouchPoints: Number(navigator.maxTouchPoints) || 0,
      pointerEvents: typeof globalThis.PointerEvent === "function",
      visualViewport: globalThis.visualViewport ? {
        width: Number(globalThis.visualViewport.width) || 0,
        height: Number(globalThis.visualViewport.height) || 0,
        scale: Number(globalThis.visualViewport.scale) || 1,
      } : null,
    },
    orientation: globalThis.screen?.orientation?.type || "unknown",
    fontChecks: fonts?.check ? { sansSerif: fonts.check("14px sans-serif"), arabic: fonts.check("14px sans-serif", "سلام"), status: fonts.status || "unknown" } : null,
    shapingProbe,
  };
}

function resetCanvas() {
  const current = document.querySelector("#canvas") || canvas;
  const replacement = current.cloneNode(false);
  replacement.width = current.width;
  replacement.height = current.height;
  current.replaceWith(replacement);
  canvas = replacement;
}

function makeScene(count) {
  const scene = new Scene();
  const atlas = new Texture({ id: "hardware-soak-atlas", sourceWidth: 64, sourceHeight: 16 });
  const animationAtlas = TextureAtlas.fromJSON(atlas, { frames: [
    { filename: "hardware-soak-a", frame: { x: 0, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
    { filename: "hardware-soak-b", frame: { x: 16, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
    { filename: "hardware-soak-c", frame: { x: 32, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
    { filename: "hardware-soak-d", frame: { x: 48, y: 0, w: 16, h: 16 }, rotated: false, trimmed: false },
  ] });
  const frameA = animationAtlas.get("hardware-soak-a");
  const frameB = animationAtlas.get("hardware-soak-b");
  const animationClip = animationAtlas.getClip(["hardware-soak-a", "hardware-soak-b"], { frameRate: 12 });
  const frameChangeProbe = { count: 0, lastFrame: -1, loopCount: 0 };
  const batch = new SpriteBatch({ texture: atlas, instanced: true, gpuCulling: true, cullable: false, maskTexture: atlas, maskRect: { x: 0, y: 0, width: 1200, height: 700 }, blendMode: "additive", filter: "grayscale", filterAmount: 0.35 });
  for (let index = 0; index < count; index += 1) batch.addAnimatedSprite({ ...animationClip, pingPong: index === 0, onLoop: index === 0 ? () => { frameChangeProbe.loopCount += 1; } : null, onFrameChange: index === 0 ? (_batch, _index, frame) => { frameChangeProbe.count += 1; frameChangeProbe.lastFrame = frame; } : null, x: (index % 100) * 18, y: Math.floor(index / 100) * 18, width: 12, height: 12, flipX: index === 0, flipY: index === 0 });
  const tileMap = new TileMap({ texture: atlas, tileWidth: 16, tileHeight: 16, columns: 16, rows: 8, x: -128, y: -64, blendMode: "multiply", filter: "invert", filterAmount: 0.25 });
  tileMap.setTiles(new Int32Array(tileMap.columns * tileMap.rows).map((_, index) => index % 4));
  tileMap.setTile(0, 0, 0, { flipX: true, flipY: true });
  const textCache = new TextCache({ maxEntries: 32, maxPixels: 128 * 1024 });
  const hudOptions = { text: "EXI SOAK", font: "bold 14px sans-serif", fill: "#b8fff0", padding: 4, cache: textCache, anchorX: 0, anchorY: 0, zIndex: 2 };
  const hudA = new Text({ ...hudOptions, x: -460, y: -250 });
  const hudB = new Text({ ...hudOptions, x: -460, y: -225 });
  const glyphAtlas = new GlyphAtlas({ width: 512, height: 512, maxEntries: 256, maxPixels: 512 * 512 });
  const glyphLabel = new Text({ text: "SCORE 00 😀", font: "bold 14px sans-serif", fill: "#ffd166", padding: 4, glyphAtlas, anchorX: 0, anchorY: 0, x: -460, y: -200, zIndex: 2 });
  const complexGlyphLabel = new Text({ text: "سلام", font: "bold 14px sans-serif", fill: "#ff8fab", padding: 4, glyphAtlas, anchorX: 0, anchorY: 0, x: -460, y: -175, zIndex: 2 });
  const polygon = new Graphics({ x: 300, y: -160, zIndex: 2, filter: "sepia", filterAmount: 0.2 }).polygon([0, 0, 90, 0, 120, 45, 62, 24, 20, 80, -20, 42], { fill: 0x6fffc0, alpha: 0.85 });
  const flippedSprite = new Sprite({ texture: frameA, width: 24, height: 24, x: 420, y: -190, zIndex: 2, flipX: true, flipY: true });
  const renderTarget = new RenderTexture({ id: "hardware-soak-render-target", width: 160, height: 90 });
  const renderTargetCamera = new Camera({ width: 160, height: 90 });
  const renderTargetScene = new Scene();
  const renderTargetBatch = new SpriteBatch({ texture: atlas, instanced: true, gpuCulling: true, cullable: false, filter: "brightness", filterAmount: 0.2 });
  for (let index = 0; index < 32; index += 1) renderTargetBatch.addSprite({ texture: index % 2 ? frameA : frameB, x: (index % 8 - 3.5) * 18, y: (Math.floor(index / 8) - 1.5) * 18, width: 12, height: 12, tint: index % 2 ? 0x6fffc0 : 0xffd166 });
  renderTargetScene.add(renderTargetBatch);
  const renderTargetPreview = new Sprite({ texture: renderTarget, maskTexture: renderTarget, maskRect: { x: 260, y: 110, width: 180, height: 110 }, width: 160, height: 90, x: 300, y: 150, zIndex: 3, cullable: false });
  const renderGroup = new RenderGroup({ width: 160, height: 90, x: -300, y: 150, zIndex: 3, filter: "brightness", filterAmount: 0.15, effects: [{ filter: "sepia", amount: 0.25 }, { filter: "contrast", amount: 0.1 }] });
  const renderGroupBatch = new SpriteBatch({ texture: atlas, instanced: true, gpuCulling: true, cullable: false });
  for (let index = 0; index < 32; index += 1) renderGroupBatch.addSprite({ texture: index % 2 ? frameA : frameB, x: (index % 8 - 3.5) * 18, y: (Math.floor(index / 8) - 1.5) * 18, width: 12, height: 12, tint: index % 2 ? 0x8be9fd : 0xff79c6 });
  const nestedRenderGroup = new RenderGroup({ width: 64, height: 36, x: 48, y: 18, filter: "invert", filterAmount: 0.2, effects: [{ filter: "saturate", amount: 0.15 }] });
  const nestedRenderBatch = new SpriteBatch({ texture: atlas, instanced: true, gpuCulling: true, cullable: false });
  for (let index = 0; index < 8; index += 1) nestedRenderBatch.addSprite({ texture: frameB, x: (index % 4 - 1.5) * 14, y: (Math.floor(index / 4) - 0.5) * 14, width: 10, height: 10, tint: 0xffd166 });
  nestedRenderGroup.add(nestedRenderBatch);
  renderGroup.add(renderGroupBatch, nestedRenderGroup);
  const overlayScene = new Scene();
  const overlayFrame = new NineSliceSprite({ texture: atlas, width: 180, height: 52, left: 4, right: 4, top: 4, bottom: 4, layout: { left: 8, top: 8 }, zIndex: -1 });
  const overlayFocusA = new Graphics({ focusable: true, tabIndex: 0, layout: { left: 16, top: 16 }, interactive: true }).rect(0, 0, 140, 28, { fill: 0x6fffc0, alpha: 0.75 });
  const overlayFocusB = new Graphics({ focusable: true, tabIndex: 1, layout: { right: 16, top: 16 }, interactive: true }).rect(0, 0, 140, 28, { fill: 0xffd166, alpha: 0.75 });
  overlayScene.add(overlayFrame, overlayFocusA, overlayFocusB);
  scene.add(batch, tileMap, hudA, hudB, glyphLabel, complexGlyphLabel, polygon, flippedSprite);
  scene.add(renderTargetPreview, renderGroup);
  return { scene, overlayScene, overlayFrame, overlayFocusA, overlayFocusB, batch, tileMap, frameA, frameB, polygon, flippedSprite, frameChangeProbe, textCache, textCacheShared: hudA.texture === hudB.texture, glyphAtlas, glyphLabel, renderTarget, renderTargetCamera, renderTargetScene, renderTargetPreview, renderGroup };
}

async function startSoak() {
  const token = ++runToken;
  engine?.destroy();
  engine = null;
  resetCanvas();
  const spriteCount = positiveInteger(spriteInput, 2000, 10000);
  const durationMs = positiveInteger(secondsInput, 30, 600) * 1000;
  const { scene, overlayScene, overlayFrame, overlayFocusA, overlayFocusB, batch, tileMap, frameA, frameB, polygon, flippedSprite, frameChangeProbe, textCache, textCacheShared, glyphAtlas, glyphLabel, renderTarget, renderTargetCamera, renderTargetScene, renderTargetPreview, renderGroup } = makeScene(spriteCount);
  audio?.destroy();
  audio = new AudioManager({ maxVoices: 8 });
  let audioVoiceTested = false;
  let audioPanTested = false;
  let audioVoiceError = null;
  let audioPeakVoices = 0;
  let sceneSwitchTested = false;
  let inputAxisTested = false;
  let cameraShakeTested = false;
  let lifecycleTested = false;
  let pageLifecycleTested = false;
  let timeScaleTested = false;
  let interpolateTested = false;
  let overlayTested = false;
  let layoutTested = false;
  let focusTested = false;
  let responsiveResizeTested = false;
  let logicalSizeTested = false;
  let nineSliceTested = false;
  let flipTested = false;
  let tileFlipTested = false;
  let pingPongTested = false;
  let loopTested = false;
  let frameChangeTested = false;
  let roundPixelsTested = false;
  const camera = new Camera({ width: canvas.width, height: canvas.height, roundPixels: true });
  const environment = environmentOf();
  const statuses = [];
  let startedAt = 0;
  let frames = 0;
  let animationFrame = 0;
  let animatedBatchFrameChanges = 0;
  let lastAnimatedBatchFrame = -1;
  let peakGpuCullBytes = 0;
  let peakGpuCullBuffers = 0;
  let peakTextureCount = 0;
  let peakTextureBytes = 0;
  let maxTextureBytes = 0;
  let peakRenderTargetCount = 0;
  let peakHeapBytes = 0;
  let offscreenRenderFrames = 0;
  let renderGroupPasses = 0;
  let postProcessPasses = 0;
  let renderTargetResizes = 0;
  let renderTargetResized = false;
  let completed = false;
  let lossObserved = false;
  let contextRestoredObserved = false;
  let fallbackObserved = false;
  let backendAfterLoss = null;
  let deviceErrorObserved = false;
  manualLossRequested = false;

  const finish = (result) => {
    if (token !== runToken || completed) return;
    completed = true;
    engine?.stop();
    audio?.destroy();
    audio = null;
    lossButton.disabled = true;
    try {
      const info = engine?.getInfo() || {};
      const glyphInfo = glyphAtlas.getInfo();
        const lossRecoveryTested = !manualLossRequested || contextRestoredObserved || (fallbackObserved && backendAfterLoss === "webgl2");
        const finalResult = (!flipTested || !tileFlipTested || !pingPongTested || !loopTested || !frameChangeTested || !roundPixelsTested || !lossRecoveryTested) ? "failed" : result;
        print({ result: finalResult, frames, backend: info.backend, lossObserved, contextRestoredObserved, fallbackObserved, backendAfterLoss, lossRecoveryTested, manualLossRequested, deviceErrorObserved, audioVoiceTested, audioPanTested, audioPeakVoices, audioVoiceError, sceneSwitchTested, inputAxisTested, cameraShakeTested, pageLifecycleTested, lifecycleTested, timeScaleTested, interpolateTested, overlayTested, layoutTested, focusTested, responsiveResizeTested, logicalSizeTested, nineSliceTested, flipTested, tileFlipTested, pingPongTested, loopTested, frameChangeTested, roundPixelsTested, blendModesTested: ["normal", "additive", "multiply"], filtersTested: ["grayscale", "invert", "brightness", "sepia", "contrast", "saturate"], graphicsPolygonTested: Boolean(polygon?.commands?.some((command) => command.type === "polygon")), spriteBatchAnimationTested: Boolean(batch?.sprites?.[0]?.animation), animatedBatchFrameChanges, maskRectTested: true, maskTextureTested: true, renderGroupTested: Boolean(renderGroup?.isRenderGroup), nestedRenderGroupTested: Boolean(renderGroup?.children?.some((child) => child.isRenderGroup)), renderGroupPasses, postProcessPasses, environment, limits: limitsOf(info), textCacheEntries: textCache.size, textCacheShared, glyphAtlasEntries: glyphInfo.size, glyphAtlasUsedPixels: glyphInfo.usedPixels, glyphComplexScriptFallbacks: glyphInfo.complexScriptFallbacks, peakGpuCullBytes, peakGpuCullBuffers, peakTextureBytes, maxTextureBytes, peakRenderTargetCount, offscreenRenderFrames, renderTargetResizes, statuses });
    } catch (error) {
      print({ result: "soak-harness-error", message: error?.message || String(error), frames, statuses });
    }
  };

  print(`Başlatılıyor: ${spriteCount} sprite / ${durationMs / 1000} sn`);
  try {
    try { await audio.unlock(); } catch (error) { audioVoiceError = error?.message || String(error); }
    try {
      const context = audio.ensureContext();
      const buffer = context.createBuffer(1, Math.max(1, Math.floor(context.sampleRate * 0.01)), context.sampleRate);
      const voice = audio.play(buffer, { volume: 0, loop: true });
      audioPeakVoices = audio.voiceCount;
      audio.setVoiceVolume(voice, 0);
      audio.setVoicePan(voice, -0.25);
      audio.setVoicePan(voice, 0);
      audio.stopAll();
      audioVoiceTested = audio.voiceCount === 0;
      audioPanTested = true;
    } catch (error) {
      audioVoiceError = error?.message || String(error);
    }
    const createdEngine = await ExiEngine.create({
      canvas,
      renderer: rendererInput.value,
      scene,
      camera,
      width: 800,
      height: 600,
      resizeMode: "contain",
      overlayScene,
      interpolate: true,
      onStatus: (status) => {
        if (token !== runToken) return;
        statuses.push({ type: status.type, backend: status.backend, reason: status.reason, message: status.message });
        if (status.type === "device-lost" || status.type === "context-lost") lossObserved = true;
        if (status.type === "context-restored") contextRestoredObserved = true;
        if (status.type === "fallback") fallbackObserved = true;
        if (status.type === "backend-selected" && lossObserved) backendAfterLoss = status.backend;
        if (status.type === "device-error") deviceErrorObserved = true;
        if (status.type === "runtime-error" || status.type === "renderer-error") finish("failed");
        if ((status.type === "device-lost" || status.type === "context-lost") && !manualLossRequested) finish("failed");
      },
      onUpdate: () => {
        animationFrame += 1;
        const currentAnimatedFrame = batch.sprites[0]?.animation?.currentFrame ?? -1;
        if (batch.sprites[0]?.animation?.pingPong === true && batch.sprites[0]?.animation?.direction === -1) pingPongTested = true;
        loopTested = frameChangeProbe.loopCount > 0;
        frameChangeTested = frameChangeProbe.count > 0 && Number.isInteger(frameChangeProbe.lastFrame);
        if (currentAnimatedFrame !== lastAnimatedBatchFrame) {
          animatedBatchFrameChanges += 1;
          lastAnimatedBatchFrame = currentAnimatedFrame;
        }
        batch.setSprite(0, { x: animationFrame % 120 });
        const animatedTileX = animationFrame % tileMap.columns;
        tileMap.setTile(animatedTileX, 0, animationFrame % 4, { flipX: animatedTileX === 0, flipY: animatedTileX === 0 });
        glyphLabel.setText(`SCORE ${String(animationFrame % 100).padStart(2, "0")} 😀`);
      },
      onRender: (current) => {
        if (token !== runToken) return;
        frames += 1;
        const info = current.getInfo();
        peakGpuCullBytes = Math.max(peakGpuCullBytes, info.gpuCullBytes || 0);
        peakGpuCullBuffers = Math.max(peakGpuCullBuffers, info.gpuCullBufferCount || 0);
        peakTextureCount = Math.max(peakTextureCount, info.textureCount || 0);
        peakTextureBytes = Math.max(peakTextureBytes, info.textureBytes || 0);
        maxTextureBytes = Math.max(maxTextureBytes, info.maxTextureBytes || 0);
        peakRenderTargetCount = Math.max(peakRenderTargetCount, info.renderTargetCount || 0);
        renderGroupPasses = Math.max(renderGroupPasses, info.renderGroupPassCount || 0);
        postProcessPasses = Math.max(postProcessPasses, info.postProcessPassCount || 0);
        peakHeapBytes = Math.max(peakHeapBytes, globalThis.performance?.memory?.usedJSHeapSize || 0);
        if (performance.now() - startedAt >= durationMs && !completed) {
          finish(deviceErrorObserved || (lossObserved && !manualLossRequested) ? "failed" : lossObserved ? "passed-with-loss" : "passed");
        } else {
          if (!renderTargetResized && frames >= 30) {
            renderTarget.resize(128, 72);
            renderTargetCamera.setViewport(128, 72);
            renderTargetPreview.width = 128;
            renderTargetPreview.height = 72;
            renderTargetResized = true;
            renderTargetResizes += 1;
          }
          try {
            current.renderToTexture(renderTarget, renderTargetScene, renderTargetCamera, performance.now());
            offscreenRenderFrames += 1;
          } catch (error) {
            statuses.push({ type: "offscreen-error", message: error?.message || String(error) });
            finish("failed");
            return;
          }
          if (frames % 15 === 0) print({ running: true, frames, backend: info.backend, fps: info.profiler?.fps, gpuCullBytes: info.gpuCullBytes || 0, gpuCullBufferCount: info.gpuCullBufferCount || 0, renderTargetCount: info.renderTargetCount || 0, offscreenRenderFrames, renderTargetResizes });
        }
      },
    });
    if (token !== runToken || completed) { createdEngine.destroy(); return; }
    const emptySceneProbe = new Scene();
    createdEngine.setScene(emptySceneProbe, camera);
    createdEngine.setScene(scene, camera);
    sceneSwitchTested = createdEngine.scene === scene;
    const containViewport = { x: camera.viewportX, y: camera.viewportY, width: camera.viewportWidth, height: camera.viewportHeight, pixelRatio: camera.pixelRatio };
    createdEngine.setResizeMode("cover");
    const coverViewport = { x: camera.viewportX, y: camera.viewportY, width: camera.viewportWidth, height: camera.viewportHeight, pixelRatio: camera.pixelRatio };
    createdEngine.setResizeMode("contain");
    responsiveResizeTested = containViewport.width > 0 && containViewport.height > 0 && coverViewport.width >= containViewport.width && coverViewport.height >= containViewport.height && createdEngine.getInfo().resizeMode === "contain" && Number.isFinite(camera.screenToWorld(camera.worldToScreen(0, 0).x, camera.worldToScreen(0, 0).y).x);
    createdEngine.setLogicalSize(640, 360);
    const logicalSizeInfo = createdEngine.getInfo();
    createdEngine.setLogicalSize(800, 600);
    logicalSizeTested = logicalSizeInfo.logicalWidth === 640 && logicalSizeInfo.logicalHeight === 360 && createdEngine.getInfo().logicalWidth === 800 && createdEngine.getInfo().logicalHeight === 600;
    overlayTested = createdEngine.getInfo().overlay === true && createdEngine.overlayScene === overlayScene;
    nineSliceTested = overlayFrame.getRenderItems().length === 9;
    const flippedItems = flippedSprite.getRenderItems()[0];
    flipTested = batch.sprites[0]?.flipX === true && batch.sprites[0]?.flipY === true && flippedItems.uvs[0] === flippedSprite.texture.u1 && flippedItems.uvs[1] === flippedSprite.texture.v1;
    const tileItems = tileMap.getInstanceItems(camera, canvas.width, canvas.height, { gpuCulling: true })[0];
    const tileFrame = tileMap.getFrame(0);
    tileFlipTested = tileMap.tileFlags?.[0] === 3 && tileItems?.gpuSource === true && tileItems.instanceData[8] === tileFrame.u1 && tileItems.instanceData[9] === tileFrame.v1 && tileItems.instanceData[10] === tileFrame.u0 && tileItems.instanceData[11] === tileFrame.v0;
    const roundedPoint = camera.worldToScreen(0.123, 0.456);
    roundPixelsTested = camera.roundPixels === true && Number.isInteger(roundedPoint.x) && Number.isInteger(roundedPoint.y);
    layoutTested = overlayFocusA.position.x === 16 && overlayFocusA.position.y === 16 && overlayFocusB.position.x > overlayFocusA.position.x;
    createdEngine.focus(overlayFocusA);
    createdEngine.focusNext();
    focusTested = createdEngine.focusedNode === overlayFocusB;
    createdEngine.input?.bindAxis("soakMoveX", { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" });
    globalThis.window?.dispatchEvent?.(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    const axisPressed = createdEngine.input?.getAxis("soakMoveX") === 1;
    globalThis.window?.dispatchEvent?.(new KeyboardEvent("keyup", { code: "ArrowRight" }));
    inputAxisTested = axisPressed && createdEngine.input?.getAxis("soakMoveX") === 0;
    const shakeBaseX = camera.position.x;
    const shakeBaseY = camera.position.y;
    camera.shake(2, 0.08);
    camera.update(1 / 60);
    const shakeActive = camera.isShaking;
    camera.clearShake();
    cameraShakeTested = shakeActive && camera.position.x === shakeBaseX && camera.position.y === shakeBaseY;
    createdEngine.setTimeScale(0.5);
    const slowMotionScale = createdEngine.getInfo().timeScale;
    createdEngine.setTimeScale(1);
    timeScaleTested = slowMotionScale === 0.5 && createdEngine.getInfo().timeScale === 1;
    interpolateTested = createdEngine.getInfo().interpolate === true;
    engine = createdEngine;
    lossButton.disabled = false;
    startedAt = performance.now();
    engine.start();
    const started = engine.running && !engine.paused;
    engine.pause();
    const paused = !engine.running && engine.paused;
    engine.resume();
    const resumed = engine.running && !engine.paused;
    globalThis.window?.dispatchEvent?.(new Event("pagehide"));
    const pageHidden = !engine.running && engine.paused && engine.visibilityPaused;
    globalThis.window?.dispatchEvent?.(new Event("pageshow"));
    const pageShown = engine.running && !engine.paused && !engine.visibilityPaused;
    pageLifecycleTested = pageHidden && pageShown;
    lifecycleTested = started && paused && resumed && pageLifecycleTested;
  } catch (error) {
    if (token !== runToken) return;
    audio?.destroy();
    audio = null;
    lossButton.disabled = true;
    print({ result: "error", message: error.message, statuses });
  }
}

startButton.addEventListener("click", () => { startSoak(); });
lossButton.addEventListener("click", () => {
  manualLossRequested = true;
  lossButton.disabled = true;
  const renderer = engine?.renderer;
  if (renderer?.handleDeviceLost) renderer.handleDeviceLost({ reason: "manual-soak" });
  else if (renderer?.handleContextLost) {
    const extension = renderer.gl?.getExtension?.("WEBGL_lose_context");
    if (extension?.loseContext) {
      extension.loseContext();
      globalThis.setTimeout(() => extension.restoreContext?.(), 250);
    } else renderer.handleContextLost({ preventDefault() {} });
  }
});
