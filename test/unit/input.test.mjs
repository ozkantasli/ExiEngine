// ExiEngine unit test — Input
import { test } from "node:test";
import assert from "node:assert/strict";
import { Input, Camera } from "../../src/index.js";

const previousWindow = globalThis.window;
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

const windowListeners = new Map();
const documentListeners = new Map();
const canvasListeners = new Map();

globalThis.window = { addEventListener: (type, listener) => windowListeners.set(type, listener), removeEventListener: (type) => windowListeners.delete(type) };
globalThis.document = { addEventListener: (type, listener) => documentListeners.set(type, listener), removeEventListener: (type) => documentListeners.delete(type) };

function makeCanvas() {
  return {
    width: 100, height: 50, clientWidth: 100, clientHeight: 50,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
    releasePointerCapture() {},
    addEventListener: (type, listener) => canvasListeners.set(type, listener),
    removeEventListener: (type) => canvasListeners.delete(type),
  };
}

test.after(() => {
  if (previousWindow) globalThis.window = previousWindow;
  else delete globalThis.window;
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else delete globalThis.document;
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
  else delete globalThis.navigator;
});

test("input: temel binding ve axis davranışı", () => {
  const input = new Input(makeCanvas(), { axes: { keyboardAxis: { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" } } });
  input.bindAction("keyboardAction", "KeyB");
  input.bindAction("pointerAction", { type: "pointer", button: 0 });
  input.bindAction("gamepadAction", { type: "gamepad", button: 0 });
  input.bindAxis("gamepadAxis", { type: "gamepad-axis", axis: 0, deadzone: 0.2 });
  assert.throws(() => input.bindAction("invalidAction", { type: "unknown" }), TypeError);
  assert.throws(() => input.bindAction("invalidGamepad", { type: "gamepad", button: 32 }), RangeError);
  assert.throws(() => input.bindAction("tooMany", ["KeyA", "KeyB", "KeyC", "KeyD", "KeyE", "KeyF", "KeyG", "KeyH", "KeyI"]), RangeError);
  assert.throws(() => input.bindAxis("invalidAxis", { type: "unknown" }), /axis/);
  assert.throws(() => input.bindAxis("invalidIndex", { type: "gamepad-axis", axis: 32 }), /axis/);
  windowListeners.get("keydown")({ code: "ArrowRight" });
  assert.equal(input.getAxis("keyboardAxis"), 1);
  windowListeners.get("keydown")({ code: "ArrowLeft" });
  assert.equal(input.getActionAxis("keyboardAxis"), 0);
  windowListeners.get("keyup")({ code: "ArrowRight" });
  assert.equal(input.getAxis("keyboardAxis"), -1);
  windowListeners.get("keyup")({ code: "ArrowLeft" });
  assert.equal(input.getAxis("keyboardAxis"), 0);
  input.destroy();
});

test("input: getPointerWorld ve camera doğrulaması", () => {
  const input = new Input(makeCanvas());
  const camera = new Camera({ width: 100, height: 50, x: 10, y: 20 });
  const world = input.getPointerWorld(camera);
  assert.equal(world, input.pointerWorld);
  assert.deepEqual(world, { x: 10 - 50, y: 20 - 25 });
  const custom = { x: 0, y: 0 };
  assert.equal(input.getPointerWorld(camera, custom), custom);
  assert.throws(() => input.getPointerWorld(null), /Camera/);
  input.destroy();
});

test("input: aksiyon basma/bırakma ve frame semantiği", () => {
  const input = new Input(makeCanvas());
  input.bindAction("keyboardAction", "KeyB");
  windowListeners.get("keydown")({ code: "KeyB" });
  assert.equal(input.isActionDown("keyboardAction"), true);
  assert.equal(input.wasActionPressed("keyboardAction"), true);
  input.endFrame();
  assert.equal(input.wasActionPressed("keyboardAction"), false);
  windowListeners.get("keyup")({ code: "KeyB" });
  assert.equal(input.isActionDown("keyboardAction"), false);
  assert.equal(input.wasActionReleased("keyboardAction"), true);
  input.destroy();
});

test("input: pointer state ve multi-pointer", () => {
  const input = new Input(makeCanvas());
  canvasListeners.get("pointerdown")({ clientX: 10, clientY: 10, button: 0, pointerId: 6 });
  assert.equal(input.isPointerDown(0), true);
  canvasListeners.get("pointermove")({ clientX: 12, clientY: 12, pointerId: 6, pointerType: "mouse" });
  windowListeners.get("pointerup")({ clientX: 12, clientY: 12, button: 0, pointerId: 6, pointerType: "mouse" });
  assert.equal(input.activePointerId, null);
  assert.equal(input.wasPointerReleased(0), true);
  canvasListeners.get("pointerdown")({ clientX: 10, clientY: 10, button: 0, pointerId: 7 });
  canvasListeners.get("pointerdown")({ clientX: 20, clientY: 20, button: 0, pointerId: 8, pointerType: "touch" });
  canvasListeners.get("pointermove")({ clientX: NaN, clientY: Infinity, pointerId: 8 });
  assert.equal(Number.isFinite(input.getPointer(8).x), true);
  assert.equal(input.pointer.pointerId, 7);
  assert.equal(input.getPointers().size, 2);
  assert.equal(input.getPointer(8)?.type, "touch");
  // endFrame was* bayraklarını temizler; pointer state'i endFrame'de korunur (frame semantiği)
  input.endFrame();
  assert.equal(input.wasPointerReleased(0), false);
  windowListeners.get("pointerup")({ clientX: 20, clientY: 20, button: 0, pointerId: 8 });
  assert.equal(input.getPointer(8)?.released, 1);
  input.destroy();
});

test("input: wheel ve pointercancel", () => {
  const input = new Input(makeCanvas());
  canvasListeners.get("pointerdown")({ clientX: 10, clientY: 10, button: 0, pointerId: 7 });
  canvasListeners.get("wheel")({ clientX: 20, clientY: 20, deltaX: 0, deltaY: 12 });
  assert.equal(input.pointer.wheelY, 12);
  canvasListeners.get("pointercancel")({ pointerId: 7 });
  assert.equal(input.wasPointerCancelled(0), true);
  input.endFrame();
  assert.equal(input.wasPointerCancelled(0), false);
  input.destroy();
});

test("input: blur ve pagehide sıfırlama", () => {
  const input = new Input(makeCanvas());
  input.bindAction("keyboardAction", "KeyB");
  windowListeners.get("keydown")({ code: "KeyA" });
  canvasListeners.get("pointerdown")({ clientX: 10, clientY: 10, button: 0, pointerId: 8 });
  windowListeners.get("blur")();
  assert.equal(input.isKeyDown("KeyA"), false);
  assert.equal(input.wasKeyReleased("KeyA"), true);
  assert.equal(input.wasPointerReleased(0), true);
  assert.equal(input.activePointerId, null);
  assert.equal(input.getPointers().size, 0);
  input.endFrame();
  windowListeners.get("keydown")({ code: "KeyC" });
  canvasListeners.get("pointerdown")({ clientX: 10, clientY: 10, button: 0, pointerId: 9 });
  windowListeners.get("pagehide")();
  assert.equal(input.isKeyDown("KeyC"), false);
  assert.equal(input.wasKeyReleased("KeyC"), true);
  input.endFrame();
  input.destroy();
});

test("input: binding snapshot izolasyonu ve setBindings", () => {
  const input = new Input(makeCanvas());
  input.bindAction("keyboardAction", "KeyB");
  const snapshot = input.getBindings();
  snapshot.actions.confirm = [{ type: "key", code: "KeyX" }];
  assert.equal(input.getBindings().actions.keyboardAction[0].code, "KeyB");
  input.setBindings({ actions: { confirm: "Enter" }, axes: { move: { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft", scale: 0.75 } } });
  assert.equal(input.getBindings().actions.confirm[0].code, "Enter");
  assert.equal(input.getBindings().axes.move[0].scale, 0.75);
  assert.throws(() => input.setBindings({ actions: { safe: "KeyA" }, axes: { safe: { type: "key-axis", positive: "KeyD", negative: "KeyA" } } }), /zaten kullanılıyor/);
  assert.throws(() => input.setBindings({ actions: { invalid: { type: "unknown" } } }), /binding/);
  input.destroy();
});

test("input: unbind ve inject", () => {
  const input = new Input(makeCanvas());
  input.bindAction("keyboardAction", "KeyB");
  assert.equal(input.unbindAction("keyboardAction"), true);
  assert.equal(input.unbindAction("keyboardAction"), false);
  input.bindAxis("keyboardAxis", { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" });
  assert.equal(input.unbindAxis("keyboardAxis"), true);
  assert.equal(input.unbindAxis("keyboardAxis"), false);
  input.inject([{ type: "keydown", code: "KeyZ" }, { type: "pointerdown", x: 20, y: 30, pointerId: 4, button: 0 }]);
  assert.equal(input.isKeyDown("KeyZ"), true);
  assert.equal(input.wasKeyPressed("KeyZ"), true);
  assert.equal(input.getPointer(4)?.x, 20);
  assert.throws(() => input.inject([{ type: "keydown", code: "KeyA" }, { type: "invalid" }]), /event type|event nesne/);
  assert.throws(() => input.inject(Array.from({ length: 129 }, () => ({ type: "keyup", code: "KeyD" }))), /128/);
  input.destroy();
});

test("input: limitler ve doğrudan mutasyon koruması", () => {
  const input = new Input(makeCanvas());
  for (let index = 0; index < 32; index += 1) input.handlePointerMove({ clientX: 10, clientY: 10, pointerId: 100 + index, pointerType: "touch" });
  assert.equal(input.getPointers().size, 32);
  input.handlePointerMove({ clientX: 10, clientY: 10, pointerId: 9999, pointerType: "touch" });
  assert.equal(input.getPointer(9999), null);
  input.endFrame();
  for (let index = 0; index < 33; index += 1) input.pointers.set(2_000 + index, { pointerId: 2_000 + index, type: "touch", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: false, wheelX: 0, wheelY: 0, button: 0 });
  assert.throws(() => input.getPointers(), /pointer limiti/);
  input.pointers.clear();
  input.gamepads.set(16, { index: 16, axes: [], buttons: [], pressed: [], released: [] });
  assert.throws(() => input.beginFrame(), /gamepad.*limiti/);
  input.gamepads.delete(16);
  input.destroy();
});

test("input: gamepad bağlantı ve snapshot", () => {
  const events = [];
  const pad = { index: 0, id: "smoke-pad", axes: [0, 0], buttons: [{ pressed: false }] };
  let activePads = [pad];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads: () => activePads } });
  const input = new Input(makeCanvas(), {
    axes: { gamepadAxis: { type: "gamepad-axis", axis: 0, deadzone: 0.2 } },
    onGamepadConnected: (gamepad) => events.push(`connected:${gamepad.index}`),
    onGamepadDisconnected: (gamepad) => events.push(`disconnected:${gamepad.index}`),
  });
  input.bindAction("gamepadAction", { type: "gamepad", button: 0 });
  input.beginFrame();
  assert.deepEqual(events, ["connected:0"]);
  assert.equal(input.getGamepad(0).connected, true);
  pad.axes[0] = 1;
  pad.buttons[0].pressed = true;
  input.beginFrame();
  assert.equal(input.isActionDown("gamepadAction"), true);
  assert.equal(input.isGamepadButtonDown(0, 0), true);
  assert.equal(input.getAxis("gamepadAxis"), 1);
  pad.buttons[0].pressed = false;
  input.beginFrame();
  assert.equal(input.isActionDown("gamepadAction"), false);
  assert.equal(input.wasGamepadButtonReleased(0, 0), true);
  activePads = [];
  input.beginFrame();
  assert.equal(input.getGamepad(0).connected, false);
  assert.deepEqual(events, ["connected:0", "disconnected:0"]);
  input.endFrame();
  input.destroy();
});

test("input: destroy sonrası stale handler güvenli", () => {
  const input = new Input(makeCanvas());
  const keyDown = input.handleKeyDown;
  const pointerDown = input.handlePointerDown;
  input.destroy();
  assert.equal(input.destroyed, true);
  keyDown({ code: "KeyZ" });
  pointerDown({ clientX: 10, clientY: 10, button: 0, pointerId: 77, pointerType: "touch" });
  assert.equal(input.keys.size, 0);
  assert.equal(input.pointers.size, 0);
  input.destroy();
});

test("input: getVector ve injectKeyUp", () => {
  const canvas = makeCanvas();
  const input = new Input(canvas, {
    axes: {
      moveX: { type: "key-axis", positive: "KeyD", negative: "KeyA" },
      moveY: { type: "key-axis", positive: "KeyS", negative: "KeyW" },
    },
  });
  assert.deepEqual(input.getVector("moveX", "moveY"), { x: 0, y: 0 });
  input.handleKeyDown({ code: "KeyD" });
  input.handleKeyDown({ code: "KeyS" });
  const vec = input.getVector("moveX", "moveY");
  assert.ok(Math.abs(vec.x - Math.SQRT1_2) < 1e-7 && Math.abs(vec.y - Math.SQRT1_2) < 1e-7);
  input.endFrame();
  input.inject([{ type: "keydown", code: "KeyZ" }]);
  input.injectKeyUp("KeyZ");
  assert.equal(input.wasKeyReleased("KeyZ"), true);
  input.destroy();
});
