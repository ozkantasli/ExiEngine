import { ExiEngine, Node, Scene } from "../src/index.js";

const frameCount = Math.min(600, Math.max(1, Math.floor(Number(process.argv[2]) || 60)));
let enterCount = 0;
let moveCount = 0;
const scene = new Scene();
scene.add(new Node({ interactive: true, hitArea: { x: -20, y: -20, width: 40, height: 40 }, onPointerEnter: () => { enterCount += 1; }, onPointerMove: () => { moveCount += 1; } }));
const engine = new ExiEngine({ canvas: { getContext() {} }, scene });
engine.renderer = { getInfo: () => ({}), destroy() {} };
const pointer = { pointerId: 1, type: "mouse", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: true, wheelX: 0, wheelY: 0, button: -1 };
engine.input = {
  pointer,
  activePointerId: 1,
  getPointer: () => pointer,
  getPointerWorld: (camera, out) => { out.x = 0; out.y = 0; return out; },
  destroy() {},
};
const path = engine.pointerEventPath;
const hit = engine.pointerHitResult;
const hoverHit = engine.pointerHoverHitResult;
const pickPredicate = engine.pointerPickPredicate;
const hoverPredicate = engine.pointerHoverPredicate;
let samePathFrames = 0;
let sameHitFrames = 0;
let sameHoverHitFrames = 0;
let samePickPredicateFrames = 0;
let sameHoverPredicateFrames = 0;
let emptyPathFrames = 0;
const started = performance.now();
for (let frame = 0; frame < frameCount; frame += 1) {
  engine.dispatchPointerState(1, pointer);
  if (engine.pointerEventPath === path) samePathFrames += 1;
  if (engine.pointerHitResult === hit) sameHitFrames += 1;
  if (engine.pointerHoverHitResult === hoverHit) sameHoverHitFrames += 1;
  if (engine.pointerPickPredicate === pickPredicate) samePickPredicateFrames += 1;
  if (engine.pointerHoverPredicate === hoverPredicate) sameHoverPredicateFrames += 1;
  if (engine.pointerEventPath.length === 0) emptyPathFrames += 1;
}
const elapsedMs = performance.now() - started;
engine.destroy();
const result = {
  frames: frameCount,
  enterCount,
  moveCount,
  samePathFrames,
  sameHitFrames,
  sameHoverHitFrames,
  samePickPredicateFrames,
  sameHoverPredicateFrames,
  emptyPathFrames,
  elapsedMs: Number(elapsedMs.toFixed(2)),
  note: "Node pointer dispatch scratch identity sözleşme ölçümü; gerçek cihaz input/FPS ölçümü değildir.",
};
console.log(JSON.stringify(result, null, 2));
if (enterCount !== 1 || moveCount !== frameCount || [samePathFrames, sameHitFrames, sameHoverHitFrames, samePickPredicateFrames, sameHoverPredicateFrames, emptyPathFrames].some((value) => value !== frameCount) || engine.pointerEventPath.length !== 0) process.exitCode = 1;
