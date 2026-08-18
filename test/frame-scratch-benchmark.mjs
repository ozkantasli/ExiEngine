import { ExiEngine, Node, Scene } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
const scene = new Scene();
const node = new Node();
node.update = () => {};
scene.add(node);
const engine = new ExiEngine({ canvas: { getContext() {} }, scene, interpolate: true });
engine.renderer = { render() {}, getInfo: () => ({}), destroy() {} };
engine.input = { beginFrame() {}, endFrame() {}, destroy() {} };
engine.running = true;
const scratch = engine.interpolationRoots;
let sameScratchFrames = 0;
const started = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  engine._advance(1 / 60, frame * (1000 / 60));
  if (engine.interpolationRoots === scratch) sameScratchFrames += 1;
}
const elapsedMs = performance.now() - started;
engine.destroy();
const result = {
  frames: frameCount,
  sameInterpolationScratchFrames: sameScratchFrames,
  scratchReallocations: frameCount - sameScratchFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  note: "Node engine frame-scratch identity sözleşme ölçümü; gerçek GPU/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (sameScratchFrames !== frameCount || engine.interpolationRoots.length !== 0) process.exitCode = 1;
