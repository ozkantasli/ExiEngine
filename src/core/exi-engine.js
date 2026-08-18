import { AudioManager } from "../audio/audio-manager.js";
import { AssetLoader } from "../assets/asset-loader.js";
import { Camera } from "./camera.js";
import { Input } from "./input.js";
import { Profiler } from "./profiler.js";
import { Scene } from "./node.js";
import { WebGL2Renderer } from "../render/webgl2-renderer.js";
import { WebGPURenderer } from "../render/webgpu-renderer.js";
import { RenderTexture } from "../assets/render-texture.js";
import { DEFAULT_CLEAR_COLOR, normalizeClearAlpha, normalizeClearColor } from "../render/clear.js";

const allowedRendererKinds = new Set(["auto", "webgl2", "webgpu"]);
const allowedResizeModes = new Set(["resize", "contain", "cover"]);
const MAX_VIEWPORT_SIZE = 16_384;
const MAX_FRAME_DELTA = 5;
const MAX_UPDATE_STEPS = 240;
const MAX_TIME_SCALE = 16;
const MAX_FOCUSABLE_NODES = 4_096;
const MAX_CAPTURE_COLUMNS = 64;
const MAX_CAPTURE_ROWS = 64;
const MAX_CAPTURE_CELLS = 4_096;
const pointerWithinViewport = (camera, pointer) => {
  if (typeof camera?.isScreenPointInViewport !== "function") return true;
  const x = Number(pointer?.x); const y = Number(pointer?.y);
  return !Number.isFinite(x) || !Number.isFinite(y) || camera.isScreenPointInViewport(x, y);
};

const normalizeTimeScale = (value, fallback = 1) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_TIME_SCALE, Math.max(0, number)) : fallback;
};

export class ExiEngine {
  static async create(options = {}) {
    const engine = new ExiEngine(options);
    await engine.init();
    return engine;
  }

  constructor({ canvas, renderer = "auto", width = 960, height = 540, resizeMode = "resize", maxPixelRatio = 2, maxTextureBytes = 128 * 1024 * 1024, maxTextureCount = 4_096, backgroundColor = DEFAULT_CLEAR_COLOR, backgroundAlpha = 1, clearBeforeRender = true, scene = new Scene(), camera = new Camera(), overlayScene = null, overlayCamera = null, animator = null, physics = null, fixedStep = 1 / 60, maxFrameDelta = 0.25, timeScale = 1, interpolate = false, pauseOnHidden = true, pauseAudio = true, inputActions = null, inputAxes = null, onGamepadConnected = null, onGamepadDisconnected = null, onStatus = () => {}, onUpdate = () => {}, onRender = () => {} } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") throw new Error("ExiEngine bir canvas ister.");
    if (!allowedRendererKinds.has(renderer)) throw new Error(`Bilinmeyen renderer seçimi: ${renderer}`);
    if (!allowedResizeModes.has(resizeMode)) throw new Error(`Bilinmeyen resize seçimi: ${resizeMode}`);
    if (resizeMode !== "resize" && typeof camera?.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için Camera setScreenViewport gerekli.");
    if (scene?.destroyed === true) throw new TypeError("ExiEngine scene yok edilmiş olamaz.");
    if (overlayScene !== null && (!overlayScene || overlayScene.destroyed === true || typeof overlayScene.update !== "function" || typeof overlayScene.collectRenderables !== "function")) throw new TypeError("ExiEngine overlayScene için Scene benzeri nesne gerekli.");
    if (overlayCamera !== null && (!overlayCamera || typeof overlayCamera.worldToScreen !== "function" || typeof overlayCamera.screenToWorld !== "function" || typeof overlayCamera.setViewport !== "function")) throw new TypeError("ExiEngine overlayCamera için Camera benzeri nesne gerekli.");
    if (resizeMode !== "resize" && overlayCamera !== null && typeof overlayCamera.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için overlayCamera setScreenViewport gerekli.");
    if (overlayScene === null && overlayCamera !== null) throw new TypeError("ExiEngine overlayCamera için overlayScene de gerekli.");
    if (animator !== null && (!animator || typeof animator.update !== "function")) throw new TypeError("ExiEngine animator için Animator benzeri nesne gerekli.");
    if (physics !== null && (!physics || typeof physics.step !== "function")) throw new TypeError("ExiEngine physics için PhysicsWorld benzeri nesne gerekli.");
    if (![onStatus, onUpdate, onRender].every((callback) => typeof callback === "function") || [onGamepadConnected, onGamepadDisconnected].some((callback) => callback !== null && typeof callback !== "function")) throw new TypeError("ExiEngine callback fonksiyonu gerekli.");
    this.canvas = canvas;
    this.eventTarget = globalThis.window || globalThis;
    this.preference = renderer;
    const requestedWidth = Number(width); const requestedHeight = Number(height);
    this.width = Number.isFinite(requestedWidth) && requestedWidth > 0 ? Math.min(MAX_VIEWPORT_SIZE, requestedWidth) : 960;
    this.height = Number.isFinite(requestedHeight) && requestedHeight > 0 ? Math.min(MAX_VIEWPORT_SIZE, requestedHeight) : 540;
    this.resizeMode = resizeMode;
    const requestedPixelRatio = Number(maxPixelRatio);
    this.maxPixelRatio = Number.isFinite(requestedPixelRatio) && requestedPixelRatio >= 1 ? Math.min(4, requestedPixelRatio) : 2;
    this.maxTextureBytes = maxTextureBytes;
    this.maxTextureCount = maxTextureCount;
    this.backgroundColor = normalizeClearColor(backgroundColor);
    this.backgroundAlpha = normalizeClearAlpha(backgroundAlpha);
    this.clearBeforeRender = clearBeforeRender !== false;
    this.scene = scene;
    this.camera = camera;
    this.overlayScene = overlayScene;
    this.overlayCameraAutoCenter = Boolean(overlayScene && overlayCamera === null);
    this.overlayCamera = overlayScene ? (overlayCamera || new Camera({ x: this.width * 0.5, y: this.height * 0.5 })) : null;
    this.animator = animator;
    this.physics = physics;
    if (this.physics?.scene === null) this.physics.scene = this.scene;
    this.inputActions = inputActions;
    this.inputAxes = inputAxes;
    this.onGamepadConnected = onGamepadConnected;
    this.onGamepadDisconnected = onGamepadDisconnected;
    const requestedFixedStep = Number(fixedStep); const requestedMaxFrameDelta = Number(maxFrameDelta);
    this.fixedStep = Number.isFinite(requestedFixedStep) && requestedFixedStep > 0 ? Math.min(1, Math.max(1 / 240, requestedFixedStep)) : 1 / 60;
    this.maxFrameDelta = Number.isFinite(requestedMaxFrameDelta) && requestedMaxFrameDelta > 0 ? Math.max(this.fixedStep, Math.min(MAX_FRAME_DELTA, requestedMaxFrameDelta)) : 0.25;
    this._widthSnapshot = this.width;
    this._heightSnapshot = this.height;
    this._resizeModeSnapshot = this.resizeMode;
    this._maxPixelRatioSnapshot = this.maxPixelRatio;
    this._maxTextureBytesSnapshot = this.maxTextureBytes;
    this._maxTextureCountSnapshot = this.maxTextureCount;
    this._fixedStepSnapshot = this.fixedStep;
    this._maxFrameDeltaSnapshot = this.maxFrameDelta;
    this.timeScale = normalizeTimeScale(timeScale);
    this.interpolate = interpolate === true;
    this.scene?._setInterpolationEnabled?.(this.interpolate);
    this.overlayScene?._setInterpolationEnabled?.(this.interpolate);
    this.pauseOnHidden = pauseOnHidden !== false;
    this.pauseAudio = pauseAudio !== false;
    this.onStatus = onStatus;
    this.emitStatus = (status) => { try { this.onStatus(status); } catch {} };
    this.onUpdate = onUpdate;
    this.onRender = onRender;
    this.renderer = null;
    this._captureTarget = null;
    this.prepared = false;
    this.input = null;
    this.assets = new AssetLoader();
    this.audio = new AudioManager({ loader: this.assets });
    this.profiler = new Profiler();
    this.running = false;
    this.paused = false;
    this.visibilityPaused = false;
    this.raf = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.audioSuspendedByEngine = false;
    this.audioLifecycleGeneration = 0;
    this.fallbackUsed = false;
    this.destroyed = false;
    this.initialized = false;
    this.info = {};
    this.infoRendererKeys = new Set();
    this.interpolationRoots = [];
    this.pointerPickWorld = { x: 0, y: 0 };
    this.pointerOverlayWorld = { x: 0, y: 0 };
    this.pointerTarget = null;
    this.pointerHoverTarget = null;
    this.pointerTargets = new Map();
    this.pointerTargetScopes = new Map();
    this.pointerHoverTargets = new Map();
    this.pointerHoverScopes = new Map();
    this.pointerHoverTypes = new Map();
    this.pointerEvent = {
      type: "", target: null, currentTarget: null, bubbles: false, defaultPrevented: false,
      propagationStopped: false, worldX: 0, worldY: 0, pointerId: null, pointerType: "mouse",
      button: 0, buttons: 0, wheelX: 0, wheelY: 0,
      stopPropagation() { this.propagationStopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    };
    this.pointerEventPath = [];
    this.pointerHitResult = { target: null, scope: "scene", point: this.pointerPickWorld };
    this.pointerHoverHitResult = { target: null, scope: "scene", point: this.pointerPickWorld };
    this.pointerPickHandlerName = "";
    this.pointerPickPredicate = (node) => node.interactive === true && typeof node[this.pointerPickHandlerName] === "function";
    this.pointerHoverPredicate = (node) => node.interactive === true && (typeof node.onPointerMove === "function" || typeof node.onPointerEnter === "function" || typeof node.onPointerLeave === "function");
    this.focusedNode = null;
    this.focusScratch = [];
    this.keyboardPath = [];
    this.keyboardEvent = {
      type: "keydown", target: null, currentTarget: null, bubbles: true, defaultPrevented: false, propagationStopped: false,
      key: "", code: "", repeat: false, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      stopPropagation() { this.propagationStopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    };
    this.focusEvent = { type: "focus", target: null, currentTarget: null };
    this.handleKeyDown = (nativeEvent) => {
      if (this.destroyed) return;
      try {
        const event = this.dispatchKeyEvent(nativeEvent);
        if (!event.defaultPrevented && nativeEvent?.key === "Tab" && this.focusNext(Boolean(nativeEvent.shiftKey))) nativeEvent.preventDefault?.();
        else if (event.defaultPrevented) nativeEvent.preventDefault?.();
      } catch (error) { this.reportRuntimeError(error, "keyboard"); }
    };
    this.handleResize = () => this.resize();
    this.handleVisibilityChange = () => {
      if (!this.pauseOnHidden) return;
      const hidden = globalThis.document?.visibilityState === "hidden";
      if (hidden) {
        if (this.running) {
          this.pause();
          this.visibilityPaused = true;
        }
      } else if (this.visibilityPaused) {
        this.visibilityPaused = false;
        this.start();
      }
    };
    this.handlePageHide = () => {
      this.input?.clearTransientState?.();
      if (!this.pauseOnHidden || !this.running) return;
      this.pause();
      this.visibilityPaused = true;
    };
    this.handlePageShow = () => {
      if (!this.pauseOnHidden || !this.visibilityPaused || globalThis.document?.visibilityState === "hidden") return;
      this.visibilityPaused = false;
      this.start();
    };
    this.resizeObserver = null;
    this.resizeObserverTarget = null;
    this.visualViewport = null;
    this.usesIntrinsicCanvasSize = false;
    this.handleRendererLost = (error) => {
      if (this.destroyed) return;
      if (error?.recoverable) return;
      if (this.preference === "webgpu" || this.fallbackUsed || this.renderer instanceof WebGL2Renderer) {
        this.stop();
        this.emitStatus({ type: "renderer-error", message: error?.message || String(error) });
        return;
      }
      this.fallbackToWebGL(error).catch((fallbackError) => this.emitStatus({ type: "renderer-error", message: fallbackError?.message || String(fallbackError) }));
    };
  }

  _assertConfiguration() {
    if (this.width !== this._widthSnapshot || this.height !== this._heightSnapshot || this.resizeMode !== this._resizeModeSnapshot || this.maxPixelRatio !== this._maxPixelRatioSnapshot || this.maxTextureBytes !== this._maxTextureBytesSnapshot || this.maxTextureCount !== this._maxTextureCountSnapshot || this.fixedStep !== this._fixedStepSnapshot || this.maxFrameDelta !== this._maxFrameDeltaSnapshot) {
      const error = new RangeError("ExiEngine çalışma konfigürasyonu doğrudan değiştirilemez.");
      error.code = "EXI_ENGINE_CONFIG";
      throw error;
    }
  }

  detectCanvasSizing() {
    const initialClientWidth = Number(this.canvas.clientWidth);
    const initialClientHeight = Number(this.canvas.clientHeight);
    const computedStyle = globalThis.getComputedStyle?.(this.canvas);
    const computedWidth = Number.parseFloat(computedStyle?.width);
    const computedHeight = Number.parseFloat(computedStyle?.height);
    this.usesIntrinsicCanvasSize = initialClientWidth > 0 && initialClientHeight > 0
      && initialClientWidth === this.canvas.width && initialClientHeight === this.canvas.height
      && (!Number.isFinite(computedWidth) || computedWidth === initialClientWidth)
      && (!Number.isFinite(computedHeight) || computedHeight === initialClientHeight);
  }

  async init() {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (this.initialized) return this;
    this._assertConfiguration();
    this.detectCanvasSizing();
    this.resize();
    if (this.preference === "webgl2") await this.selectBackend("webgl2");
    else if (this.preference === "webgpu") await this.selectBackend("webgpu");
    else {
      try { await this.selectBackend("webgpu"); }
      catch (webgpuError) {
        if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
        this.emitStatus({ type: "fallback", from: "webgpu", to: "webgl2", message: webgpuError.message });
        await this.selectBackend("webgl2");
      }
    }
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    this.input = new Input(this.canvas, { actions: this.inputActions, axes: this.inputAxes, onKeyDown: this.handleKeyDown, onGamepadConnected: this.onGamepadConnected, onGamepadDisconnected: this.onGamepadDisconnected });
    this.resize();
    this.eventTarget.addEventListener?.("resize", this.handleResize, { passive: true });
    const ResizeObserverClass = globalThis.ResizeObserver;
    this.resizeObserverTarget = this.canvas.parentElement || null;
    if (typeof ResizeObserverClass === "function" && this.resizeObserverTarget && !this.usesIntrinsicCanvasSize) {
      this.resizeObserver = new ResizeObserverClass(this.handleResize);
      this.resizeObserver.observe(this.resizeObserverTarget);
    }
    this.visualViewport = globalThis.visualViewport || null;
    this.visualViewport?.addEventListener?.("resize", this.handleResize, { passive: true });
    globalThis.document?.addEventListener?.("visibilitychange", this.handleVisibilityChange, { passive: true });
    this.eventTarget.addEventListener?.("pagehide", this.handlePageHide, { passive: true });
    this.eventTarget.addEventListener?.("pageshow", this.handlePageShow, { passive: true });
    this.initialized = true;
    this.emitStatus({ type: "engine-ready", info: this.getInfo() });
    return this;
  }

  async selectBackend(kind) {
    this._assertConfiguration();
    const next = kind === "webgpu"
      ? new WebGPURenderer({ canvas: this.canvas, onLost: this.handleRendererLost, onStatus: this.emitStatus, clearColor: this.backgroundColor, clearAlpha: this.backgroundAlpha, clearBeforeRender: this.clearBeforeRender, maxTextureBytes: this.maxTextureBytes, maxTextureCount: this.maxTextureCount })
      : new WebGL2Renderer({ canvas: this.canvas, onLost: this.handleRendererLost, onStatus: this.emitStatus, clearColor: this.backgroundColor, clearAlpha: this.backgroundAlpha, clearBeforeRender: this.clearBeforeRender, maxTextureBytes: this.maxTextureBytes, maxTextureCount: this.maxTextureCount });
    try { await next.init(); }
    catch (error) { next.destroy(); if (kind === "webgpu" && !this.destroyed) this.replaceCanvas(); throw error; }
    if (this.destroyed) { next.destroy(); throw new Error("ExiEngine yok edilmiş."); }
    this.renderer?.destroy();
    this.renderer = next;
    this.prepared = false;
    this.emitStatus({ type: "backend-selected", backend: kind });
  }

  async fallbackToWebGL(reason) {
    if (this.destroyed) return;
    this.fallbackUsed = true;
    const wasRunning = this.running;
    this.stop();
    this.pointerTarget = null;
    this.pointerHoverTarget = null;
    this.pointerTargets.clear();
    this.pointerTargetScopes.clear();
    this.pointerHoverTargets.clear();
    this.pointerHoverScopes.clear();
    this.pointerHoverTypes.clear();
    this.emitStatus({ type: "fallback", from: "webgpu", to: "webgl2", message: reason.message });
    this.input?.destroy();
    const previousRenderer = this.renderer;
    this.renderer = null;
    previousRenderer?.destroy?.();
    this.replaceCanvas();
    this.input = new Input(this.canvas, { actions: this.inputActions, axes: this.inputAxes, onKeyDown: this.handleKeyDown, onGamepadConnected: this.onGamepadConnected, onGamepadDisconnected: this.onGamepadDisconnected });
    await this.selectBackend("webgl2");
    if (this.destroyed) { this.renderer?.destroy(); this.renderer = null; return; }
    this.resize();
    if (wasRunning) this.start();
  }

  replaceCanvas() {
    const previous = this.canvas;
    const replacement = previous.cloneNode(false);
    replacement.width = previous.width;
    replacement.height = previous.height;
    previous.parentNode?.replaceChild(replacement, previous);
    this.canvas = replacement;
  }

  resize() {
    this._assertConfiguration();
    const intrinsicSize = this.usesIntrinsicCanvasSize && this.canvas.clientWidth === this.canvas.width && this.canvas.clientHeight === this.canvas.height;
    const cssWidth = intrinsicSize ? this.width : (this.canvas.clientWidth || this.width);
    const cssHeight = intrinsicSize ? this.height : (this.canvas.clientHeight || this.height);
    const devicePixelRatio = Number(globalThis.devicePixelRatio);
    const pixelRatio = Math.min(this.maxPixelRatio, Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1);
    const pixelWidth = Number(cssWidth) * pixelRatio;
    const pixelHeight = Number(cssHeight) * pixelRatio;
    this.canvas.width = Number.isFinite(pixelWidth) ? Math.min(MAX_VIEWPORT_SIZE, Math.max(1, Math.floor(pixelWidth))) : this.width;
    this.canvas.height = Number.isFinite(pixelHeight) ? Math.min(MAX_VIEWPORT_SIZE, Math.max(1, Math.floor(pixelHeight))) : this.height;
    const configureCamera = (camera, autoCenter = false) => {
      if (this.resizeMode === "resize") {
        camera.setPixelRatio?.(pixelRatio);
        camera.setViewport(this.canvas.width, this.canvas.height);
        camera.setScreenViewport?.(0, 0, this.canvas.width, this.canvas.height);
      } else {
        const widthScale = this.canvas.width / this.width;
        const heightScale = this.canvas.height / this.height;
        const requestedScale = this.resizeMode === "cover" ? Math.max(widthScale, heightScale) : Math.min(widthScale, heightScale);
        const scale = Number.isFinite(requestedScale) ? Math.min(4, Math.max(0.25, requestedScale)) : 1;
        const viewportWidth = Math.max(1, Math.floor(this.width * scale));
        const viewportHeight = Math.max(1, Math.floor(this.height * scale));
        camera.setPixelRatio?.(scale);
        camera.setViewport(viewportWidth, viewportHeight);
        camera.setScreenViewport((this.canvas.width - viewportWidth) * 0.5, (this.canvas.height - viewportHeight) * 0.5, viewportWidth, viewportHeight);
      }
      if (autoCenter) {
        const cameraScale = Number(camera.pixelRatio) || 1;
        camera.position.x = camera.viewportWidth / (2 * cameraScale);
        camera.position.y = camera.viewportHeight / (2 * cameraScale);
      }
    };
    configureCamera(this.camera);
    if (this.overlayCamera) {
      configureCamera(this.overlayCamera, this.overlayCameraAutoCenter);
      this.overlayScene?.applyLayout?.(this.overlayCamera.viewportWidth / this.overlayCamera.pixelRatio, this.overlayCamera.viewportHeight / this.overlayCamera.pixelRatio);
    }
    this.renderer?.resize?.(this.canvas.width, this.canvas.height);
    return this;
  }

  setLogicalSize(width, height) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    const requestedWidth = Number(width); const requestedHeight = Number(height);
    if (!Number.isFinite(requestedWidth) || requestedWidth <= 0 || !Number.isFinite(requestedHeight) || requestedHeight <= 0) throw new RangeError("ExiEngine mantıksal boyutu finite ve pozitif olmalı.");
    this.width = Math.min(MAX_VIEWPORT_SIZE, requestedWidth);
    this.height = Math.min(MAX_VIEWPORT_SIZE, requestedHeight);
    this._widthSnapshot = this.width;
    this._heightSnapshot = this.height;
    return this.resize();
  }

  setResizeMode(mode) {
    if (!allowedResizeModes.has(mode)) throw new Error(`Bilinmeyen resize seçimi: ${mode}`);
    if (mode !== "resize" && typeof this.camera?.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için Camera setScreenViewport gerekli.");
    if (mode !== "resize" && this.overlayCamera && typeof this.overlayCamera.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için overlayCamera setScreenViewport gerekli.");
    this.resizeMode = mode;
    this._resizeModeSnapshot = this.resizeMode;
    this.resize();
    return this;
  }

  prepare() {
    this._assertConfiguration();
    const result = this.renderer?.prepare(this.scene, this.camera) || { batches: 0, uploads: 0 };
    if (this.overlayScene && this.overlayCamera) {
      const overlayResult = this.renderer?.prepare(this.overlayScene, this.overlayCamera) || { batches: 0, uploads: 0 };
      this.prepared = true;
      return { batches: (result.batches || 0) + (overlayResult.batches || 0), uploads: (result.uploads || 0) + (overlayResult.uploads || 0) };
    }
    this.prepared = true;
    return result;
  }

  setScene(scene, camera = this.camera) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (!scene || scene.destroyed === true || typeof scene.update !== "function" || typeof scene.collectRenderables !== "function") throw new TypeError("ExiEngine scene için Scene benzeri nesne gerekli.");
    if (!camera || typeof camera.worldToScreen !== "function" || typeof camera.screenToWorld !== "function" || typeof camera.setViewport !== "function") throw new TypeError("ExiEngine camera için Camera benzeri nesne gerekli.");
    if (this.resizeMode !== "resize" && typeof camera.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için Camera setScreenViewport gerekli.");
    this.blur();
    this.interpolationRoots.length = 0;
    const previousScene = this.scene;
    this.scene = scene;
    this.camera = camera;
    if (this.physics?.scene === previousScene) this.physics.scene = scene;
    this.scene._setInterpolationEnabled?.(this.interpolate);
    this.pointerTarget = null;
    this.pointerHoverTarget = null;
    this.pointerHitResult.target = null;
    this.pointerHoverHitResult.target = null;
    this.pointerTargets.clear();
    this.pointerTargetScopes.clear();
    this.pointerHoverTargets.clear();
    this.pointerHoverScopes.clear();
    this.pointerHoverTypes.clear();
    this.prepared = false;
    this.resize();
    return this;
  }

  setOverlay(scene = null, camera = null) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (scene === null) {
      if (camera !== null) throw new TypeError("ExiEngine overlayCamera için overlayScene de gerekli.");
      this.blur();
      this.interpolationRoots.length = 0;
      this.overlayScene = null;
      this.overlayCamera = null;
      this.overlayCameraAutoCenter = false;
    } else {
      if (!scene || scene.destroyed === true || typeof scene.update !== "function" || typeof scene.collectRenderables !== "function") throw new TypeError("ExiEngine overlayScene için Scene benzeri nesne gerekli.");
      if (camera !== null && (!camera || typeof camera.worldToScreen !== "function" || typeof camera.screenToWorld !== "function" || typeof camera.setViewport !== "function")) throw new TypeError("ExiEngine overlayCamera için Camera benzeri nesne gerekli.");
      if (this.resizeMode !== "resize" && camera !== null && typeof camera.setScreenViewport !== "function") throw new TypeError("ExiEngine contain/cover için overlayCamera setScreenViewport gerekli.");
      this.blur();
      this.interpolationRoots.length = 0;
      this.overlayScene = scene;
      this.overlayCameraAutoCenter = camera === null;
      this.overlayCamera = camera || new Camera({ x: this.width * 0.5, y: this.height * 0.5 });
      this.overlayScene._setInterpolationEnabled?.(this.interpolate);
    }
    this.pointerTarget = null;
    this.pointerHoverTarget = null;
    this.pointerHitResult.target = null;
    this.pointerHoverHitResult.target = null;
    this.pointerTargets.clear();
    this.pointerTargetScopes.clear();
    this.pointerHoverTargets.clear();
    this.pointerHoverScopes.clear();
    this.pointerHoverTypes.clear();
    this.prepared = false;
    this.resize();
    return this;
  }

  renderToTexture(target, scene = this.scene, camera = this.camera, time = globalThis.performance?.now?.() || 0) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (!this.renderer) throw new Error("ExiEngine başlatılmadan önce init() gerekli.");
    if (!(target instanceof RenderTexture)) throw new TypeError("renderToTexture bir RenderTexture ister.");
    if (!scene || !camera) throw new TypeError("renderToTexture scene ve camera ister.");
    if (camera.width !== target.width || camera.height !== target.height) throw new RangeError("RenderTexture boyutu camera viewport ile eşleşmiyor.");
    this.renderer.render(time, scene, camera, target);
    return target;
  }

  async captureFrame({ columns = 32, rows = 18 } = {}) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (!this.renderer) throw new Error("ExiEngine başlatılmadan önce init() gerekli.");
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > MAX_CAPTURE_COLUMNS || !Number.isSafeInteger(rows) || rows < 1 || rows > MAX_CAPTURE_ROWS || columns * rows > MAX_CAPTURE_CELLS) {
      const error = new RangeError("ExiEngine captureFrame grid sınırları dışında.");
      error.code = "EXI_RENDER_OBSERVE_LIMIT";
      throw error;
    }
    if (typeof this.renderer.readRenderTarget !== "function") {
      const error = new Error("Seçili renderer düşük çözünürlüklü frame readback desteklemiyor.");
      error.code = "EXI_RENDER_OBSERVE_UNAVAILABLE";
      throw error;
    }
    const sourceCamera = this.camera;
    const sourceWidth = Math.max(1, Number(sourceCamera?.viewportWidth) || Number(this.canvas.width) || this.width);
    const sourceHeight = Math.max(1, Number(sourceCamera?.viewportHeight) || Number(this.canvas.height) || this.height);
    const scale = Math.min(columns / sourceWidth, rows / sourceHeight);
    const camera = new Camera({
      x: Number(sourceCamera?.position?.x) || 0,
      y: Number(sourceCamera?.position?.y) || 0,
      zoom: (Number(sourceCamera?.zoom) || 1) * scale,
      rotation: Number(sourceCamera?.rotation) || 0,
      width: columns,
      height: rows,
      pixelRatio: Number(sourceCamera?.pixelRatio) || 1,
      roundPixels: Boolean(sourceCamera?.roundPixels),
    });
    if (!this._captureTarget || this._captureTarget.destroyed) this._captureTarget = new RenderTexture({ width: columns, height: rows, filter: "nearest" });
    else this._captureTarget.resize(columns, rows);
    this.renderer.render(globalThis.performance?.now?.() || 0, this.scene, camera, this._captureTarget);
    return await this.renderer.readRenderTarget(this._captureTarget);
  }

  reportRuntimeError(error, phase = "frame") {
    this.stop();
    this.emitStatus({ type: "runtime-error", phase, message: error?.message || String(error) });
  }

  suspendAudio() {
    if (!this.pauseAudio || this.audioSuspendedByEngine || this.audio?.context?.state !== "running") return this;
    this.audioSuspendedByEngine = true;
    const generation = ++this.audioLifecycleGeneration;
    try {
      Promise.resolve(this.audio.suspend?.()).catch((error) => {
        if (generation !== this.audioLifecycleGeneration || this.destroyed) return;
        this.audioSuspendedByEngine = false;
        try { this.onStatus({ type: "audio-error", message: error?.message || String(error) }); } catch {}
      });
    } catch (error) {
      this.audioSuspendedByEngine = false;
      try { this.onStatus({ type: "audio-error", message: error?.message || String(error) }); } catch {}
    }
    return this;
  }

  resumeAudio() {
    if (!this.audioSuspendedByEngine) return this;
    this.audioSuspendedByEngine = false;
    const generation = ++this.audioLifecycleGeneration;
    try {
      Promise.resolve(this.audio.resume?.()).catch((error) => {
        if (generation !== this.audioLifecycleGeneration || this.destroyed) return;
        try { this.onStatus({ type: "audio-error", message: error?.message || String(error) }); } catch {}
      });
    } catch (error) {
      try { this.onStatus({ type: "audio-error", message: error?.message || String(error) }); } catch {}
    }
    return this;
  }

  _advance(delta, time) {
    this._assertConfiguration();
    const requestedDelta = Number(delta);
    const frameDelta = Number.isFinite(requestedDelta) ? Math.min(this.maxFrameDelta, Math.max(0, requestedDelta)) : 0;
    this.timeScale = normalizeTimeScale(this.timeScale);
    const simulationDelta = Math.min(this.maxFrameDelta, frameDelta * this.timeScale);
    const frameTime = Number.isFinite(Number(time)) ? Number(time) : (globalThis.performance?.now?.() || 0);
    this.accumulator += simulationDelta;
    const wasRunning = this.running;
    try {
      this.input?.beginFrame();
      this.dispatchPointerInput();
      let updateSteps = 0;
      while (this.accumulator >= this.fixedStep && updateSteps < MAX_UPDATE_STEPS && (!wasRunning || (this.running && !this.destroyed))) {
        if (this.interpolate) this.scene?._captureInterpolation?.();
        if (this.interpolate && this.overlayScene && this.overlayScene !== this.scene) this.overlayScene._captureInterpolation?.();
        this.scene.update(this.fixedStep);
        if (this.overlayScene && this.overlayScene !== this.scene) this.overlayScene.update(this.fixedStep);
        this.animator?.update(this.fixedStep);
        this.physics?.step(this.fixedStep);
        this.onUpdate(this.fixedStep, this);
        this.accumulator -= this.fixedStep;
        updateSteps += 1;
      }
      if (updateSteps === MAX_UPDATE_STEPS && this.accumulator >= this.fixedStep) this.accumulator = 0;
      this.camera.update?.(simulationDelta);
      if (this.overlayCamera && this.overlayCamera !== this.camera) this.overlayCamera.update?.(simulationDelta);
      this.profiler.begin(globalThis.performance?.now?.() || frameTime);
      let renderFailed = false;
      const interpolationRoots = this.interpolationRoots;
      interpolationRoots.length = 0;
      if (this.interpolate && typeof this.scene?._applyInterpolation === "function") interpolationRoots.push(this.scene);
      if (this.interpolate && this.overlayScene && this.overlayScene !== this.scene && typeof this.overlayScene._applyInterpolation === "function") interpolationRoots.push(this.overlayScene);
      const interpolationAlpha = interpolationRoots.length > 0 ? (wasRunning && this.running ? Math.max(0, Math.min(1, this.accumulator / this.fixedStep)) : 1) : 1;
      for (const root of interpolationRoots) root._applyInterpolation(interpolationAlpha);
      try {
        this.renderer?.render(frameTime, this.scene, this.camera);
        if (this.overlayScene && this.overlayCamera) this.renderer?.render(frameTime, this.overlayScene, this.overlayCamera, null, true, false, false, true);
      } catch (error) { renderFailed = true; this.handleRendererLost(error); }
      finally { for (let index = interpolationRoots.length - 1; index >= 0; index -= 1) interpolationRoots[index]._restoreInterpolation(); }
      this.profiler.end(globalThis.performance?.now?.() || frameTime, this.renderer?.getInfo() || {});
      if (!renderFailed && !this.destroyed) this.onRender(this, this.profiler);
    } catch (error) {
      this.reportRuntimeError(error);
      throw error;
    } finally {
      this.input?.endFrame();
    }
    return this;
  }

  step(delta) {
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    this._assertConfiguration();
    if (this.running) throw new Error("ExiEngine çalışırken step() çağrılamaz.");
    if (!this.renderer) throw new Error("ExiEngine başlatılmadan önce init() gerekli.");
    if (!this.prepared) this.prepare();
    return this._advance(delta, globalThis.performance?.now?.() || 0);
  }

  setTimeScale(value) {
    this.timeScale = normalizeTimeScale(value, this.timeScale);
    return this;
  }

  start() {
    if (this.running) return this;
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    this._assertConfiguration();
    if (!this.renderer) throw new Error("ExiEngine başlatılmadan önce init() gerekli.");
    if (typeof globalThis.requestAnimationFrame !== "function") throw new Error("ExiEngine start() için requestAnimationFrame gerekli; SSR/Worker ortamında step() kullanın.");
    this.prepare();
    this.running = true;
    this.paused = false;
    this.visibilityPaused = false;
    this.lastTime = 0;
    this.accumulator = 0;
    if (this.pauseOnHidden && globalThis.document?.visibilityState === "hidden") {
      this.running = false;
      this.paused = true;
      this.visibilityPaused = true;
      return this;
    }
    this.resumeAudio();
    const frame = (time) => {
      if (!this.running) return;
      if (!this.lastTime) this.lastTime = time;
      const delta = Math.min(this.maxFrameDelta, Math.max(0, (time - this.lastTime) / 1000));
      this.lastTime = time;
      try { this._advance(delta, time); } catch { return; }
      if (!this.running) return;
      this.raf = globalThis.requestAnimationFrame(frame);
    };
    this.raf = globalThis.requestAnimationFrame(frame);
    return this;
  }

  pause() {
    if (!this.running) return this;
    this.running = false;
    this.paused = true;
    this.visibilityPaused = false;
    if (this.raf) globalThis.cancelAnimationFrame?.(this.raf);
    this.raf = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    this.suspendAudio();
    return this;
  }

  resume() {
    if (!this.paused) return this;
    if (this.destroyed) throw new Error("ExiEngine yok edilmiş.");
    if (this.pauseOnHidden && globalThis.document?.visibilityState === "hidden") {
      this.visibilityPaused = true;
      return this;
    }
    this.visibilityPaused = false;
    return this.start();
  }

  stop() {
    this.running = false;
    this.paused = false;
    this.visibilityPaused = false;
    if (this.raf) globalThis.cancelAnimationFrame?.(this.raf);
    this.raf = 0;
    this.lastTime = 0;
    this.accumulator = 0;
    return this;
  }

  focus(node = null) {
    if (node === null) {
      const previous = this.focusedNode;
      this.focusedNode = null;
      if (previous) {
        previous.focused = false;
        if (typeof previous.onBlur === "function") {
          const event = this.focusEvent;
          event.type = "blur"; event.target = previous; event.currentTarget = previous;
          try { previous.onBlur.call(previous, event); } finally { event.currentTarget = null; }
        }
      }
      return this;
    }
    const ownsNode = (scene) => scene && (scene === node || typeof scene.isAncestorOf === "function" && scene.isAncestorOf(node));
    if (!node || node.destroyed || !node.visible || node.focusable !== true || (!ownsNode(this.scene) && !ownsNode(this.overlayScene))) throw new TypeError("ExiEngine focus için görünür ve sahneye bağlı focusable Node gerekli.");
    if (this.focusedNode === node) return this;
    this.focus(null);
    this.focusedNode = node;
    node.focused = true;
    if (typeof node.onFocus === "function") {
      const event = this.focusEvent;
      event.type = "focus"; event.target = node; event.currentTarget = node;
      try { node.onFocus.call(node, event); } finally { event.currentTarget = null; }
    }
    return this;
  }

  blur() { return this.focus(null); }

  focusNext(reverse = false) {
    const candidates = this.focusScratch;
    candidates.length = 0;
    this.overlayScene?.collectFocusables?.(candidates, true, MAX_FOCUSABLE_NODES);
    if (this.scene && this.scene !== this.overlayScene && candidates.length < MAX_FOCUSABLE_NODES) this.scene.collectFocusables?.(candidates, true, MAX_FOCUSABLE_NODES);
    let writeIndex = 0;
    for (const candidate of candidates) if (candidate.tabIndex >= 0) candidates[writeIndex++] = candidate;
    candidates.length = writeIndex;
    candidates.sort((left, right) => left.tabIndex - right.tabIndex);
    if (candidates.length === 0) { this.blur(); return false; }
    const currentIndex = candidates.indexOf(this.focusedNode);
    const nextIndex = currentIndex < 0
      ? (reverse ? candidates.length - 1 : 0)
      : (currentIndex + (reverse ? -1 : 1) + candidates.length) % candidates.length;
    this.focus(candidates[nextIndex]);
    return true;
  }

  dispatchKeyEvent(nativeEvent) {
    const event = this.keyboardEvent;
    event.type = "keydown";
    event.target = this.focusedNode;
    event.currentTarget = null;
    event.defaultPrevented = false;
    event.propagationStopped = false;
    event.key = typeof nativeEvent?.key === "string" ? nativeEvent.key.slice(0, 64) : "";
    event.code = typeof nativeEvent?.code === "string" ? nativeEvent.code.slice(0, 64) : "";
    event.repeat = nativeEvent?.repeat === true;
    event.shiftKey = nativeEvent?.shiftKey === true;
    event.ctrlKey = nativeEvent?.ctrlKey === true;
    event.altKey = nativeEvent?.altKey === true;
    event.metaKey = nativeEvent?.metaKey === true;
    const target = this.focusedNode;
    if (!target || target.destroyed || !target.visible || target.focusable !== true) {
      if (target) this.blur();
      return event;
    }
    const path = this.keyboardPath;
    path.length = 0;
    for (let current = target; current; current = current.parent) path.push(current);
    try {
      for (const currentTarget of path) {
        if (currentTarget.destroyed || !currentTarget.visible || typeof currentTarget.onKeyDown !== "function") continue;
        event.currentTarget = currentTarget;
        currentTarget.onKeyDown.call(currentTarget, event);
        if (event.propagationStopped) break;
      }
    } finally {
      event.currentTarget = null;
      path.length = 0;
    }
    return event;
  }

  add(...nodes) { return this.scene.add(...nodes); }
  pickPointer(predicate = null, pointerId = null) {
    if (predicate !== null && typeof predicate !== "function") throw new TypeError("ExiEngine pointer pick predicate fonksiyonu gerekli.");
    if (!this.input) return null;
    const pointer = pointerId === null || pointerId === undefined ? this.input.pointer : this.input.getPointer?.(pointerId) || this.input.pointer;
    const sceneInViewport = pointerWithinViewport(this.camera, pointer);
    const point = this.input.getPointerWorld(this.camera, this.pointerPickWorld, pointerId);
    if (this.overlayScene && this.overlayCamera && pointerWithinViewport(this.overlayCamera, pointer)) {
      const overlayPoint = this.input.getPointerWorld(this.overlayCamera, this.pointerOverlayWorld, pointerId);
      const overlayHit = this.overlayScene.pick(overlayPoint.x, overlayPoint.y, predicate);
      if (overlayHit) return overlayHit;
    }
    if (!sceneInViewport) return null;
    return this.scene.pick(point.x, point.y, predicate);
  }
  pointerHandlerName(type) {
    if (type === "pointerdown") return "onPointerDown";
    if (type === "pointerup") return "onPointerUp";
    if (type === "pointercancel") return "onPointerCancel";
    if (type === "pointermove") return "onPointerMove";
    if (type === "pointerenter") return "onPointerEnter";
    if (type === "wheel") return "onWheel";
    return "onPointerLeave";
  }
  pointerTargetFor(type, worldX, worldY, scene = this.scene) {
    this.pointerPickHandlerName = this.pointerHandlerName(type);
    return scene.pick(worldX, worldY, this.pointerPickPredicate);
  }
  pointerHoverTargetFor(worldX, worldY, scene = this.scene) {
    return scene.pick(worldX, worldY, this.pointerHoverPredicate);
  }
  resolvePointerHit(type, point, overlayPoint, overlayInViewport, sceneInViewport) {
    const hit = this.pointerHitResult;
    if (this.overlayScene && this.overlayCamera && overlayInViewport) {
      const overlayTarget = this.pointerTargetFor(type, overlayPoint.x, overlayPoint.y, this.overlayScene);
      if (overlayTarget) { hit.target = overlayTarget; hit.scope = "overlay"; hit.point = overlayPoint; return hit; }
    }
    hit.target = sceneInViewport ? this.pointerTargetFor(type, point.x, point.y, this.scene) : null;
    hit.scope = "scene";
    hit.point = point;
    return hit;
  }
  resolvePointerHoverHit(point, overlayPoint, overlayInViewport, sceneInViewport) {
    const hit = this.pointerHoverHitResult;
    if (this.overlayScene && this.overlayCamera && overlayInViewport) {
      const overlayTarget = this.pointerHoverTargetFor(overlayPoint.x, overlayPoint.y, this.overlayScene);
      if (overlayTarget) { hit.target = overlayTarget; hit.scope = "overlay"; hit.point = overlayPoint; return hit; }
    }
    hit.target = sceneInViewport ? this.pointerHoverTargetFor(point.x, point.y, this.scene) : null;
    hit.scope = "scene";
    hit.point = point;
    return hit;
  }
  dispatchPointerEvent(type, target, point, pointer = this.input?.pointer, wheelX = 0, wheelY = 0) {
    if (!target || target.destroyed || !target.visible) return;
    const handlerName = this.pointerHandlerName(type);
    const event = this.pointerEvent;
    event.type = type;
    event.target = target;
    event.currentTarget = null;
    event.bubbles = type !== "pointerenter" && type !== "pointerleave";
    event.defaultPrevented = false;
    event.propagationStopped = false;
    event.worldX = point.x;
    event.worldY = point.y;
    event.pointerId = pointer?.pointerId ?? null;
    event.pointerType = pointer?.type || "mouse";
    event.button = pointer?.button ?? 0;
    event.buttons = pointer?.buttons || 0;
    event.wheelX = wheelX;
    event.wheelY = wheelY;
    const path = this.pointerEventPath;
    for (let current = target; current; current = current.parent) {
      path.push(current);
      if (!event.bubbles) break;
    }
    try {
      for (const currentTarget of path) {
        if (currentTarget.destroyed || !currentTarget.visible) continue;
        const handler = currentTarget[handlerName];
        if (typeof handler !== "function") continue;
        event.currentTarget = currentTarget;
        handler.call(currentTarget, event);
        if (event.propagationStopped) break;
      }
    } finally {
      event.currentTarget = null;
      path.length = 0;
    }
  }
  dispatchPointerState(pointerId, pointer) {
    const input = this.input;
    const pressed = pointer.pressed !== 0;
    const released = pointer.released !== 0;
    const cancelled = pointer.cancelled !== 0;
    const moved = pointer.moved === true;
    const wheelX = Number.isFinite(pointer.wheelX) ? pointer.wheelX : 0;
    const wheelY = Number.isFinite(pointer.wheelY) ? pointer.wheelY : 0;
    const wheeled = wheelX !== 0 || wheelY !== 0;
    if (!pressed && !released && !cancelled && !moved && !wheeled) return;
    const point = input.getPointerWorld(this.camera, this.pointerPickWorld, pointerId);
    const overlayPoint = this.overlayScene && this.overlayCamera ? input.getPointerWorld(this.overlayCamera, this.pointerOverlayWorld, pointerId) : point;
    const sceneInViewport = pointerWithinViewport(this.camera, pointer);
    const overlayInViewport = this.overlayScene && this.overlayCamera ? pointerWithinViewport(this.overlayCamera, pointer) : false;
    let target = this.pointerTargets.get(pointerId) || null;
    let targetScope = this.pointerTargetScopes.get(pointerId) || "scene";
    let hoverTarget = this.pointerHoverTargets.get(pointerId) || null;
    let hoverScope = this.pointerHoverScopes.get(pointerId) || "scene";
    if (pressed) {
      const hit = this.resolvePointerHit("pointerdown", point, overlayPoint, overlayInViewport, sceneInViewport);
      target = hit.target;
      targetScope = hit.scope;
      if (target) { this.pointerTargets.set(pointerId, target); this.pointerTargetScopes.set(pointerId, targetScope); }
      else { this.pointerTargets.delete(pointerId); this.pointerTargetScopes.delete(pointerId); }
      this.dispatchPointerEvent("pointerdown", target, hit.point, pointer);
      if (target?.focusable === true) this.focus(target);
    }
    if (moved) {
      if (target) {
        this.dispatchPointerEvent("pointermove", target, targetScope === "overlay" ? overlayPoint : point, pointer);
      } else {
        const nextHover = this.resolvePointerHoverHit(point, overlayPoint, overlayInViewport, sceneInViewport);
        if (nextHover.target !== hoverTarget || nextHover.scope !== hoverScope) {
          this.dispatchPointerEvent("pointerleave", hoverTarget, hoverScope === "overlay" ? overlayPoint : point, pointer);
          hoverTarget = nextHover.target;
          hoverScope = nextHover.scope;
          if (hoverTarget) {
            this.pointerHoverTargets.set(pointerId, hoverTarget);
            this.pointerHoverScopes.set(pointerId, hoverScope);
            this.pointerHoverTypes.set(pointerId, pointer?.type || "mouse");
          } else {
            this.pointerHoverTargets.delete(pointerId);
            this.pointerHoverScopes.delete(pointerId);
            this.pointerHoverTypes.delete(pointerId);
          }
          this.dispatchPointerEvent("pointerenter", hoverTarget, nextHover.point, pointer);
        }
        this.dispatchPointerEvent("pointermove", hoverTarget, hoverScope === "overlay" ? overlayPoint : point, pointer);
      }
    }
    if (wheeled) {
      const wheelHit = this.resolvePointerHit("wheel", point, overlayPoint, overlayInViewport, sceneInViewport);
      this.dispatchPointerEvent("wheel", wheelHit.target, wheelHit.point, pointer, wheelX, wheelY);
    }
    if (cancelled) {
      this.pointerTargets.delete(pointerId);
      this.pointerHoverTargets.delete(pointerId);
      this.pointerTargetScopes.delete(pointerId);
      this.pointerHoverScopes.delete(pointerId);
      this.pointerHoverTypes.delete(pointerId);
      this.dispatchPointerEvent("pointercancel", target, targetScope === "overlay" ? overlayPoint : point, pointer);
    } else if (released) {
      const releaseHit = target ? this.pointerHitResult : this.resolvePointerHit("pointerup", point, overlayPoint, overlayInViewport, sceneInViewport);
      if (target) { releaseHit.target = target; releaseHit.scope = targetScope; releaseHit.point = targetScope === "overlay" ? overlayPoint : point; }
      this.pointerTargets.delete(pointerId);
      this.pointerTargetScopes.delete(pointerId);
      if (pointer?.type === "touch") this.pointerHoverTargets.delete(pointerId);
      if (pointer?.type === "touch") { this.pointerHoverScopes.delete(pointerId); this.pointerHoverTypes.delete(pointerId); }
      this.dispatchPointerEvent("pointerup", releaseHit.target, releaseHit.point, pointer);
    }
    if (pointerId === input.pointer?.pointerId || pointerId === input.activePointerId) {
      this.pointerTarget = this.pointerTargets.get(pointerId) || null;
      this.pointerHoverTarget = this.pointerHoverTargets.get(pointerId) || null;
    }
  }
  dispatchPointerInput() {
    const input = this.input;
    if (!input || !input.pointer || typeof input.getPointerWorld !== "function") return;
    const pointers = typeof input.getPointers === "function" ? input.getPointers() : null;
    if (pointers && typeof pointers[Symbol.iterator] === "function") {
      for (const [pointerId, pointer] of pointers) this.dispatchPointerState(pointerId, pointer);
      for (const [pointerId, pointerType] of this.pointerHoverTypes) {
        if (pointerType !== "touch" || pointers.has(pointerId)) continue;
        this.pointerHoverTypes.delete(pointerId);
        this.pointerHoverTargets.delete(pointerId);
        this.pointerHoverScopes.delete(pointerId);
      }
      return;
    }
    this.dispatchPointerState(input.pointer.pointerId ?? 0, input.pointer);
  }
  getInfo() {
    const info = this.info;
    const rendererInfo = this.renderer?.getInfo();
    const hasRendererInfo = Boolean(rendererInfo && typeof rendererInfo === "object");
    for (const key of this.infoRendererKeys) if (!hasRendererInfo || !(key in rendererInfo)) delete info[key];
    this.infoRendererKeys.clear();
    if (hasRendererInfo) for (const key in rendererInfo) {
      info[key] = rendererInfo[key];
      this.infoRendererKeys.add(key);
    }
    info.running = this.running;
    info.paused = this.paused;
    info.timeScale = this.timeScale;
    info.interpolate = this.interpolate;
    info.pauseOnHidden = this.pauseOnHidden;
    info.pauseAudio = this.pauseAudio;
    info.logicalWidth = this.width;
    info.logicalHeight = this.height;
    info.resizeMode = this.resizeMode;
    info.audioSuspendedByEngine = this.audioSuspendedByEngine;
    info.overlay = Boolean(this.overlayScene && this.overlayCamera);
    info.focused = Boolean(this.focusedNode && !this.focusedNode.destroyed);
    info.animator = Boolean(this.animator);
    info.physics = Boolean(this.physics);
    info.profiler = this.profiler.snapshot();
    const canvas = info.canvas || (info.canvas = { width: 0, height: 0 });
    canvas.width = this.canvas.width;
    canvas.height = this.canvas.height;
    return info;
  }

  destroy() {
    this.destroyed = true;
    try { this.blur(); } catch {}
    this.audioLifecycleGeneration += 1;
    this.audioSuspendedByEngine = false;
    this.pointerTarget = null;
    this.pointerHoverTarget = null;
    this.pointerEventPath.length = 0;
    this.pointerHitResult.target = null;
    this.pointerHoverHitResult.target = null;
    this.interpolationRoots.length = 0;
    this.stop();
    this.eventTarget.removeEventListener?.("resize", this.handleResize);
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    this.resizeObserverTarget = null;
    this.visualViewport?.removeEventListener?.("resize", this.handleResize);
    this.visualViewport = null;
    globalThis.document?.removeEventListener?.("visibilitychange", this.handleVisibilityChange);
    this.eventTarget.removeEventListener?.("pagehide", this.handlePageHide);
    this.eventTarget.removeEventListener?.("pageshow", this.handlePageShow);
    this.input?.destroy();
    this.pointerTargets.clear();
    this.pointerTargetScopes.clear();
    this.pointerHoverTargets.clear();
    this.pointerHoverScopes.clear();
    this.pointerHoverTypes.clear();
    this.assets.destroy();
    this.audio.destroy();
    this._captureTarget?.destroy();
    this._captureTarget = null;
    this.renderer?.destroy();
    this.renderer = null;
    this.prepared = false;
    this.input = null;
  }
}
