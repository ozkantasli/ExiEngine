import { Input } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Number(process.argv[2]) || 120));
const previousWindow = globalThis.window;
const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const windowListeners = new Map();
const pad = { index: 0, id: "benchmark-pad", axes: [0, 0, 0, 0], buttons: [{ pressed: false }, { pressed: false }] };
globalThis.window = {
  addEventListener: (type, listener) => windowListeners.set(type, listener),
  removeEventListener: (type) => windowListeners.delete(type),
};
Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads: () => [pad] } });
const input = new Input({
  width: 320,
  height: 180,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 320, height: 180 }),
  addEventListener() {},
  removeEventListener() {},
});
input.bindAction("fire", { type: "gamepad", button: 0 });
input.bindAxis("moveX", { type: "gamepad-axis", axis: 0, deadzone: 0.15 });

input.beginFrame();
const first = input.getGamepad(0);
if (!first) throw new Error("Input benchmark gamepad snapshot üretmedi.");
const axes = first.axes;
const buttons = first.buttons;
const pressed = first.pressed;
const released = first.released;
let sameAxesFrames = 0;
let sameButtonFrames = 0;
let samePressedFrames = 0;
let sameReleasedFrames = 0;
let actionMatches = 0;
let axisMatches = 0;
const start = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  pad.axes[0] = frame % 2 ? 1 : -1;
  pad.buttons[0].pressed = frame % 2 === 0;
  input.beginFrame();
  const snapshot = input.getGamepad(0);
  if (snapshot?.axes === axes) sameAxesFrames += 1;
  if (snapshot?.buttons === buttons) sameButtonFrames += 1;
  if (snapshot?.pressed === pressed) samePressedFrames += 1;
  if (snapshot?.released === released) sameReleasedFrames += 1;
  if (input.isActionDown("fire") === pad.buttons[0].pressed) actionMatches += 1;
  if (input.getAxis("moveX") === pad.axes[0]) axisMatches += 1;
}
const elapsedMs = performance.now() - start;
input.destroy();
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
else delete globalThis.navigator;

const result = {
  frames: frameCount,
  sameAxesFrames,
  sameButtonFrames,
  samePressedFrames,
  sameReleasedFrames,
  actionMatches,
  axisMatches,
  arrayReallocations: (frameCount - sameAxesFrames) + (frameCount - sameButtonFrames) + (frameCount - samePressedFrames) + (frameCount - sameReleasedFrames),
  elapsedMs: Number(elapsedMs.toFixed(2)),
  simulatedFramesPerSecond: Number((frameCount / Math.max(elapsedMs / 1000, Number.EPSILON)).toFixed(2)),
  note: "Node input sözleşme ölçümü; gerçek cihaz gamepad sürücüsü ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameAxesFrames !== frameCount || sameButtonFrames !== frameCount || samePressedFrames !== frameCount || sameReleasedFrames !== frameCount || actionMatches !== frameCount || axisMatches !== frameCount) process.exitCode = 1;
