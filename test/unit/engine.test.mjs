// ExiEngine unit test — ExiEngine core
import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { ExiEngine, Scene, Node, Sprite, Camera, Animator, Tween, PhysicsWorld, RenderTexture, Texture } from "../../src/index.js";
import { WebGL2Renderer } from "../../src/render/webgl2-renderer.js";

function stubEngine(options = {}) {
  const engine = new ExiEngine({ canvas: { getContext() {} }, ...options });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render() {}, getInfo: () => ({}), destroy() {} };
  engine.input = { beginFrame() {}, endFrame() {}, destroy() {} };
  return engine;
}

test("engine: fixed-step order scene→animator→physics→onUpdate", () => {
  const scene = new Scene();
  const order = [];
  scene.update = () => order.push("scene");
  const target = { value: 0 };
  const animator = new Animator();
  animator.add(new Tween(target, "value", 60, 1, { ease: (value) => value }));
  const originalAnimatorUpdate = animator.update;
  animator.update = function (...args) { order.push("animator"); return originalAnimatorUpdate.apply(this, args); };
  const physics = { step() { order.push("physics"); } };
  const engine = new ExiEngine({ canvas: { getContext() {} }, scene, animator, physics, onUpdate: () => order.push("onUpdate") });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render() {}, getInfo: () => ({}), destroy() {} };
  engine.input = { beginFrame() {}, endFrame() {}, destroy() {} };
  engine.step(1 / 60);
  assert.deepEqual(order, ["scene", "animator", "physics", "onUpdate"]);
  assert.ok(target.value > 0);
  assert.equal(engine.getInfo().animator, true);
  assert.throws(() => new ExiEngine({ canvas: { getContext() {} }, animator: {} }), /Animator/);
  assert.throws(() => new ExiEngine({ canvas: { getContext() {} }, physics: {} }), /PhysicsWorld/);
  engine.destroy();
});

test("engine: timeScale and setTimeScale bounds", () => {
  let updates = 0;
  const scene = new Scene();
  scene.update = () => { updates += 1; };
  const engine = stubEngine({ scene, timeScale: 2 });
  assert.equal(engine.timeScale, 2);
  engine.step(1 / 60);
  assert.equal(updates, 2);
  engine.setTimeScale(0);
  engine.step(1);
  assert.equal(updates, 2);
  engine.setTimeScale(32);
  assert.equal(engine.timeScale, 16);
  engine.timeScale = Infinity;
  engine.step(1 / 60);
  assert.equal(engine.timeScale, 1);
  assert.equal(updates, 3);
  engine.destroy();
});

test("engine: maxPixelRatio and size bounds", () => {
  assert.equal(new ExiEngine({ canvas: { getContext() {} }, maxPixelRatio: 1 }).maxPixelRatio, 1);
  assert.equal(new ExiEngine({ canvas: { getContext() {} }, maxPixelRatio: 9 }).maxPixelRatio, 4);
  assert.equal(new ExiEngine({ canvas: { getContext() {} }, maxPixelRatio: 0 }).maxPixelRatio, 2);
  const bounded = new ExiEngine({ canvas: { getContext() {} }, width: Infinity, height: NaN, fixedStep: Infinity, maxFrameDelta: Infinity });
  assert.equal(bounded.width, 960);
  assert.equal(bounded.height, 540);
  assert.equal(bounded.fixedStep, 1 / 60);
  assert.equal(bounded.maxFrameDelta, 0.25);
  for (const [field, value] of [["width", 1], ["height", 1], ["resizeMode", "cover"], ["maxPixelRatio", 4], ["maxTextureBytes", 256 * 1024 * 1024], ["maxTextureCount", 1], ["fixedStep", 1 / 30], ["maxFrameDelta", 1]]) {
    const probe = new ExiEngine({ canvas: { getContext() {} } });
    probe[field] = value;
    assert.throws(() => probe.resize(), (error) => error?.code === "EXI_ENGINE_CONFIG");
    probe.destroy();
  }
  bounded.destroy();
});

test("engine: interpolate flow", () => {
  const scene = new Scene();
  const node = new Node({ x: 0, y: 0 });
  node.update = function updateNode() { this.position.x += 10; };
  scene.add(node);
  let renderedX = null;
  const engine = new ExiEngine({ canvas: { getContext() {} }, scene, interpolate: true });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render() { renderedX = node.position.x; }, getInfo: () => ({}), destroy() {} };
  engine.input = { beginFrame() {}, endFrame() {}, destroy() {} };
  const roots = engine.interpolationRoots;
  engine.running = true;
  engine._advance(1 / 60 + 1 / 120, 0);
  assert.equal(engine.interpolate, true);
  assert.equal(engine.interpolationRoots, roots);
  assert.ok(Math.abs(renderedX - 5) < 1e-9);
  assert.equal(node.position.x, 10);
  engine.running = false;
  engine.destroy();
});

test("engine: resize contain/cover and logical size", () => {
  const previousDPR = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
  Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
  const camera = new Camera();
  const canvas = { width: 200, height: 200, clientWidth: 400, clientHeight: 200, getContext() {} };
  const engine = new ExiEngine({ canvas, width: 200, height: 200, camera, resizeMode: "contain" });
  engine.resize();
  assert.deepEqual({ x: camera.viewportX, y: camera.viewportY, width: camera.viewportWidth, height: camera.viewportHeight, pixelRatio: camera.pixelRatio }, { x: 100, y: 0, width: 200, height: 200, pixelRatio: 1 });
  assert.deepEqual(camera.worldToScreen(0, 0), { x: 200, y: 100 });
  assert.equal(engine.getInfo().resizeMode, "contain");
  assert.throws(() => engine.setLogicalSize(0, 100), /logical size/);
  assert.throws(() => engine.setLogicalSize(100, Infinity), /logical size/);
  assert.equal(engine.setResizeMode("cover"), engine);
  assert.deepEqual({ x: camera.viewportX, y: camera.viewportY, width: camera.viewportWidth, height: camera.viewportHeight, pixelRatio: camera.pixelRatio }, { x: 0, y: -100, width: 400, height: 400, pixelRatio: 2 });
  assert.throws(() => engine.setResizeMode("stretch"), /resize/);
  engine.destroy();
  if (previousDPR) Object.defineProperty(globalThis, "devicePixelRatio", previousDPR);
  else delete globalThis.devicePixelRatio;
});

test("engine: oversized canvas clamp", () => {
  const canvas = { getContext() {}, clientWidth: 100_000, clientHeight: 100_000 };
  const engine = new ExiEngine({ canvas, maxPixelRatio: 4 });
  engine.resize();
  assert.equal(canvas.width, 16_384);
  assert.equal(canvas.height, 16_384);
  engine.destroy();
});

test("engine: manual step and running constraint", () => {
  let updates = 0;
  let renders = 0;
  const scene = new Scene();
  scene.update = () => { updates += 1; };
  const engine = new ExiEngine({ canvas: { getContext() {} }, scene, fixedStep: 1 / 60, onRender: () => { renders += 1; } });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render() {}, getInfo: () => ({}), destroy() {} };
  engine.input = { beginFrame() {}, endFrame() {}, destroy() {} };
  assert.equal(engine.step(1 / 30), engine);
  assert.equal(updates, 2);
  assert.equal(renders, 1);
  assert.throws(() => { engine.running = true; engine.step(0); }, /while running/);
  engine.running = false;
  engine.destroy();
});

test("engine: setScene clears pointer state", () => {
  const sceneA = new Scene();
  const sceneB = new Scene();
  const camera = new Camera({ width: 320, height: 180 });
  const engine = stubEngine({ scene: sceneA });
  const stale = new Node({ interactive: true });
  engine.pointerTarget = stale;
  engine.pointerHoverTarget = stale;
  engine.pointerTargets.set(1, stale);
  engine.pointerHoverTargets.set(1, stale);
  engine.pointerHoverTypes.set(1, "mouse");
  engine.prepared = true;
  assert.equal(engine.setScene(sceneB, camera), engine);
  assert.equal(engine.scene, sceneB);
  assert.equal(engine.camera, camera);
  assert.equal(engine.prepared, false);
  assert.equal(engine.pointerTarget, null);
  assert.equal(engine.pointerTargets.size, 0);
  assert.throws(() => engine.setScene(null), /scene/);
  assert.throws(() => engine.setScene(sceneA, null), /camera/);
  engine.destroy();
});

test("engine: renderer-error guard stops the engine", () => {
  const statuses = [];
  const engine = new ExiEngine({ canvas: { getContext() {} }, renderer: "webgl2", onStatus: (status) => statuses.push(status.type) });
  const renderer = new WebGL2Renderer({ canvas: null });
  renderer.prepare = () => ({ batches: 0, uploads: 0 });
  renderer.render = () => { throw new Error("render guard failure"); };
  renderer.getInfo = () => ({ backend: "webgl2" });
  engine.renderer = renderer;
  engine.input = { beginFrame() {}, endFrame() {} };
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => { callback(1); return 1; };
  engine.start();
  globalThis.requestAnimationFrame = previousRaf;
  assert.equal(engine.running, false);
  assert.deepEqual(statuses, ["renderer-error"]);
  renderer.destroy();
});

test("engine: callback error runtime-error + input endFrame", () => {
  const statuses = [];
  let inputEnds = 0;
  const engine = new ExiEngine({ canvas: { getContext() {} }, onStatus: (status) => statuses.push(status.type), onUpdate: () => { throw new Error("update callback failure"); } });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render() {}, getInfo: () => ({}), destroy() {} };
  engine.input = { beginFrame() {}, endFrame() { inputEnds += 1; }, destroy() {} };
  assert.throws(() => engine.step(1 / 60), /update callback failure/);
  assert.equal(engine.running, false);
  assert.deepEqual(statuses, ["runtime-error"]);
  assert.equal(inputEnds, 1);
  engine.destroy();
});

test("engine: concurrent init shares backend and input lifecycle", async (t) => {
  const canvas = Object.assign(new EventTarget(), { getContext() {} });
  const engine = new ExiEngine({ canvas, renderer: "webgl2" });
  t.after(() => engine.destroy());
  let backendCalls = 0;
  let releaseBackend;
  const ready = new Promise((resolve) => { releaseBackend = resolve; });
  engine.selectBackend = async () => {
    backendCalls += 1;
    await ready;
    engine.renderer = { resize() {}, getInfo: () => ({}), destroy() {} };
  };
  const first = engine.init();
  const second = engine.init();
  releaseBackend();
  assert.deepEqual(await Promise.all([first, second]), [engine, engine]);
  assert.equal(backendCalls, 1);
  assert.equal(getEventListeners(canvas, "pointerdown").length, 1);
  assert.equal(await engine.init(), engine);
  assert.equal(backendCalls, 1);
  engine.destroy();
  assert.equal(getEventListeners(canvas, "pointerdown").length, 0);
});

test("engine: late initialization failure releases partial resources", async (t) => {
  const canvas = Object.assign(new EventTarget(), { getContext() {} });
  const engine = new ExiEngine({ canvas, renderer: "webgl2" });
  t.after(() => engine.destroy());
  let rendererDestroys = 0;
  engine.selectBackend = async () => {
    engine.renderer = { resize() {}, getInfo: () => ({}), destroy() { rendererDestroys += 1; } };
  };
  const failure = new Error("pageshow registration failed");
  engine.eventTarget = new EventTarget();
  const addListener = engine.eventTarget.addEventListener;
  t.mock.method(engine.eventTarget, "addEventListener", function (type, ...args) {
    if (type === "pageshow") throw failure;
    return addListener.call(this, type, ...args);
  });
  const results = await Promise.allSettled([engine.init(), engine.init()]);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason === failure));
  assert.equal(rendererDestroys, 1);
  assert.equal(engine.renderer, null);
  assert.equal(engine.input, null);
  assert.equal(engine.destroyed, true);
  assert.equal(engine.initialized, false);
  assert.equal(engine.assets.destroyed, true);
  assert.equal(engine.audio.destroyed, true);
  assert.equal(engine.scene.destroyed, false);
  assert.equal(getEventListeners(canvas, "pointerdown").length, 0);
  assert.equal(getEventListeners(engine.eventTarget, "resize").length, 0);
  assert.equal(getEventListeners(engine.eventTarget, "pagehide").length, 0);
  await assert.rejects(engine.init(), /destroyed/);
});

test("engine: create cleans renderer when input configuration is invalid", async (t) => {
  let renderer;
  const canvas = Object.assign(new EventTarget(), { getContext() {} });
  t.mock.method(WebGL2Renderer.prototype, "init", function () { renderer = this; });
  await assert.rejects(ExiEngine.create({ canvas, renderer: "webgl2", inputActions: { jump: [] } }), /binding/);
  assert.equal(renderer.destroyed, true);
  assert.equal(getEventListeners(canvas, "pointerdown").length, 0);
});

test("engine: late-init destroy race", async () => {
  const previousInit = WebGL2Renderer.prototype.init;
  WebGL2Renderer.prototype.init = () => new Promise((resolve) => { setTimeout(resolve, 10); });
  const engine = new ExiEngine({ canvas: { getContext() {} }, renderer: "webgl2" });
  const init = engine.init();
  await Promise.resolve();
  engine.destroy();
  await assert.rejects(init, /destroyed/);
  WebGL2Renderer.prototype.init = previousInit;
});

test("engine: handleRendererLost fallback behavior", async () => {
  const engine = stubEngine({ renderer: "auto" });
  let fallbackCalls = 0;
  engine.fallbackToWebGL = async () => { fallbackCalls += 1; };
  engine.handleRendererLost(new Error("before-start"));
  await Promise.resolve();
  assert.equal(fallbackCalls, 1);

  const recoverable = stubEngine({ renderer: "auto" });
  let recoverableCalls = 0;
  recoverable.fallbackToWebGL = async () => { recoverableCalls += 1; };
  const error = new Error("recoverable");
  error.recoverable = true;
  recoverable.handleRendererLost(error);
  await Promise.resolve();
  assert.equal(recoverableCalls, 0);

  const destroyed = stubEngine({ renderer: "auto" });
  let destroyedCalls = 0;
  destroyed.fallbackToWebGL = async () => { destroyedCalls += 1; };
  destroyed.destroyed = true;
  destroyed.handleRendererLost(new Error("after-destroy"));
  await Promise.resolve();
  assert.equal(destroyedCalls, 0);
});

test("engine: lifecycleState transitions and stop audio suspend", () => {
  const engine = stubEngine({ renderer: "auto" });
  assert.equal(engine.lifecycleState, "created");
  engine.initialized = true;
  assert.equal(engine.lifecycleState, "ready");
  engine.running = true;
  assert.equal(engine.lifecycleState, "running");
  engine.running = false;
  engine.paused = true;
  assert.equal(engine.lifecycleState, "paused");
  engine.visibilityPaused = true;
  assert.equal(engine.lifecycleState, "visibility-paused");
  engine.visibilityPaused = false;
  engine.paused = false;
  let suspendCalls = 0;
  engine.audio.context = { state: "running", suspend() { suspendCalls += 1; return Promise.resolve(); } };
  engine.running = true;
  engine.stop();
  assert.equal(engine.lifecycleState, "stopped");
  assert.equal(engine.audioSuspendedByEngine, true);
  assert.equal(suspendCalls, 1);
  engine.destroy();
  assert.equal(engine.lifecycleState, "destroyed");
});

test("engine: recoverable renderer loss pause and context-restored resume", () => {
  const previousRaf = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const engine = stubEngine({ renderer: "auto" });
  engine.initialized = true;
  try {
    engine.start();
    assert.equal(engine.lifecycleState, "running");
    const recoverable = new Error("context lost");
    recoverable.recoverable = true;
    engine.handleRendererLost(recoverable);
    assert.equal(engine.lifecycleState, "paused");
    assert.equal(engine._rendererLost, true);
    assert.equal(engine._rendererLostPaused, true);
    engine.handleRendererStatus({ type: "context-restored" });
    assert.equal(engine.lifecycleState, "running");
    assert.equal(engine._rendererLost, false);
    assert.equal(engine._rendererLostPaused, false);
    engine.pause();
    const externallyPaused = new Error("context lost again");
    externallyPaused.recoverable = true;
    engine.handleRendererLost(externallyPaused);
    assert.equal(engine.lifecycleState, "paused");
    assert.equal(engine._rendererLostPaused, false);
    engine.handleRendererStatus({ type: "context-restored" });
    assert.equal(engine.lifecycleState, "paused");
  } finally {
    engine.destroy();
    if (previousRaf) globalThis.requestAnimationFrame = previousRaf; else delete globalThis.requestAnimationFrame;
    if (previousCancel) globalThis.cancelAnimationFrame = previousCancel; else delete globalThis.cancelAnimationFrame;
  }
});

test("engine: destroy asset cleanup and pauseAudio opt-out", () => {
  const engine = new ExiEngine({ canvas: { getContext() {} } });
  engine.destroy();
  assert.equal(engine.assets.destroyed, true);
  const optOut = new ExiEngine({ canvas: { getContext() {} }, pauseAudio: false });
  let suspendCalls = 0;
  optOut.audio.context = { state: "running", suspend() { suspendCalls += 1; return Promise.resolve(); } };
  assert.equal(optOut.getInfo().pauseAudio, false);
  optOut.suspendAudio();
  assert.equal(suspendCalls, 0);
  optOut.destroy();
});

test("engine: renderToTexture matching", () => {
  const calls = [];
  const camera = new Camera({ width: 32, height: 16 });
  const engine = stubEngine({ camera });
  engine.renderer = { prepare: () => ({ batches: 0, uploads: 0 }), render: (...args) => calls.push(args), getInfo: () => ({}), destroy() {} };
  const rt = new RenderTexture({ width: 32, height: 16 });
  assert.equal(engine.renderToTexture(rt), rt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], rt);
  assert.throws(() => engine.renderToTexture(new RenderTexture({ width: 16, height: 16 })), /does not match/);
  assert.throws(() => engine.renderToTexture(new Texture()), /RenderTexture/);
  engine.destroy();
});

test("engine: input edges reach exactly one fixed step per press", () => {
  let seen = 0;
  const engine = stubEngine({ fixedStep: 1 / 60, onUpdate: (delta, current) => { if (current.input.pressed) seen += 1; } });
  engine.input = {
    pressed: false,
    beginFrame() {}, destroy() {},
    clearKeyEdges() { this.pressed = false; },
    clearPointerEdges() {},
    endFrame({ keepKeyEdges = false } = {}) { if (!keepKeyEdges) this.pressed = false; },
  };
  // Slow frame: three fixed steps, the press is seen once.
  engine.input.pressed = true;
  engine.step(3 / 60);
  assert.equal(seen, 1);
  // Fast frame without a fixed step while running: the press survives to the next step.
  engine.running = true;
  engine.accumulator = 0;
  engine.input.pressed = true;
  engine._advance(1 / 240, 0);
  assert.equal(engine.input.pressed, true, "kept through a frame that ran no step");
  engine._advance(1 / 60, 0);
  assert.equal(seen, 2);
  assert.equal(engine.input.pressed, false);
  engine.running = false;
  engine.destroy();
});
