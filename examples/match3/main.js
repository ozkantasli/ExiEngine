// ExiEngine example: a match-3 puzzle.
// Shows a grid game built from Graphics nodes: tap/click two neighbours or drag
// a gem to swap, keyboard play with a cursor, tweened swaps, clears and falls
// awaited through Tween onComplete, cascades, a StateMachine that blocks input
// while the board settles, a move limit, a reshuffle when no move is left and
// a best score in SaveStore. Every gem type has its own shape as well as its
// own color, so the board is readable without color vision.
import { Animator, Camera, ExiEngine, Graphics, Node, ParticleEmitter, SaveStore, Scene, StateMachine, Text, Texture, Tween, easing } from "../../src/index.js";

const WIDTH = 640;
const HEIGHT = 360;
const SIZE = 8;
const CELL = 40;
const BOARD_X = 40;
const BOARD_Y = 20;
const MOVES = 20;
const TYPES = [
  { color: 0xf87171, draw: (g) => g.circle(0, 0, 14, { fill: 0xf87171, segments: 20 }) },
  { color: 0x60a5fa, draw: (g) => g.roundedRect(-13, -13, 26, 26, 5, { fill: 0x60a5fa }) },
  { color: 0xfacc15, draw: (g) => g.polygon([0, -16, 15, 0, 0, 16, -15, 0], { fill: 0xfacc15 }) },
  { color: 0x4ade80, draw: (g) => g.triangle(0, -15, 15, 12, -15, 12, { fill: 0x4ade80 }) },
  { color: 0xc084fc, draw: (g) => g.polygon([-7, -14, 7, -14, 15, 0, 7, 14, -7, 14, -15, 0], { fill: 0xc084fc }) },
  { color: 0xfb923c, draw: (g) => g.rect(-4, -15, 8, 30, { fill: 0xfb923c }).rect(-15, -4, 30, 8, { fill: 0xfb923c }) },
];

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const scene = new Scene();
const animator = new Animator({ maxTweens: 256 });
const save = new SaveStore({ namespace: "exi-match3" });
const flow = new StateMachine({
  name: "match3",
  initial: "idle",
  states: {
    idle: { on: { swap: "busy", end: "over" } },
    busy: { on: { settle: "idle", end: "over" } },
    over: { on: { restart: "idle" } },
  },
});
let random = createRandom(42);

const boardBack = new Graphics({ zIndex: -2 });
for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) boardBack.roundedRect(BOARD_X + x * CELL + 2, BOARD_Y + y * CELL + 2, CELL - 4, CELL - 4, 6, { fill: (x + y) % 2 ? 0x111a2e : 0x0f172a });
scene.add(boardBack);
// clipRect is in screen pixels, so it is refreshed from the camera each frame
// (it hides new gems while they drop in from above the board).
const gemLayer = new Node();
scene.add(gemLayer);
const cursor = new Graphics({ zIndex: 5 }).strokeRect(-CELL / 2 + 1, -CELL / 2 + 1, CELL - 2, CELL - 2, 3, { fill: 0xe2e8f0 });
const selection = new Graphics({ zIndex: 4, visible: false }).roundedRect(-CELL / 2 + 2, -CELL / 2 + 2, CELL - 4, CELL - 4, 6, { fill: 0xffffff, alpha: 0.18 });
scene.add(cursor, selection);
const sparks = new ParticleEmitter({ texture: Texture.white, maxParticles: 512, lifetime: 0.4, size: 3, random: () => random() });
scene.add(sparks);

const camera = new Camera({ x: WIDTH / 2, y: HEIGHT / 2, roundPixels: true });
const hud = new Scene();
const label = new Text({ x: 400, y: 40, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 18px system-ui, sans-serif", fill: "#e2e8f0", lineHeight: 28 });
const help = new Text({ x: 400, y: 200, anchorX: 0, anchorY: 0, resolution: 2, text: "Swap two neighbours to line up\nthree or more of a kind.\nClick, tap or drag; or arrows\n+ Space. R starts over.", font: "14px system-ui, sans-serif", fill: "#94a3b8", lineHeight: 21 });
hud.add(label, help);

const grid = Array.from({ length: SIZE }, () => new Array(SIZE).fill(null));
const state = { score: 0, moves: MOVES, best: save.get("best", 0), combo: 0, selected: null, cursor: { x: 0, y: 0 }, drag: null, shuffles: 0 };
const cellCenter = (x, y) => ({ x: BOARD_X + x * CELL + CELL / 2, y: BOARD_Y + y * CELL + CELL / 2 });

function makeGem(type, x, y) {
  const node = TYPES[type].draw(new Graphics());
  const center = cellCenter(x, y);
  node.position.set(center.x, center.y);
  gemLayer.add(node);
  return { type, node };
}

function tween(target, property, to, duration, ease = easing.outQuad) {
  return new Promise((resolve) => animator.add(new Tween(target, property, to, duration, { ease, onComplete: resolve })));
}

function wouldMatch(type, x, y) {
  const at = (cx, cy) => grid[cy]?.[cx]?.type;
  return (at(x - 1, y) === type && at(x - 2, y) === type) || (at(x, y - 1) === type && at(x, y - 2) === type);
}

function findMatches() {
  const matched = new Set();
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const type = grid[y][x]?.type;
      if (type === undefined) continue;
      let run = 1; while (x + run < SIZE && grid[y][x + run]?.type === type) run += 1;
      if (run >= 3) for (let index = 0; index < run; index += 1) matched.add(`${x + index},${y}`);
      run = 1; while (y + run < SIZE && grid[y + run][x]?.type === type) run += 1;
      if (run >= 3) for (let index = 0; index < run; index += 1) matched.add(`${x},${y + index}`);
    }
  }
  return [...matched].map((key) => key.split(",").map(Number));
}

function swapCells(a, b) {
  const first = grid[a.y][a.x];
  grid[a.y][a.x] = grid[b.y][b.x];
  grid[b.y][b.x] = first;
}

function hasMove() {
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        if (x + dx >= SIZE || y + dy >= SIZE) continue;
        swapCells({ x, y }, { x: x + dx, y: y + dy });
        const found = findMatches().length > 0;
        swapCells({ x, y }, { x: x + dx, y: y + dy });
        if (found) return true;
      }
    }
  }
  return false;
}

function fillBoard() {
  for (const node of [...gemLayer.children]) node.destroy();
  for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) grid[y][x] = null;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let type = Math.floor(random() * TYPES.length);
      while (wouldMatch(type, x, y)) type = (type + 1) % TYPES.length;
      grid[y][x] = makeGem(type, x, y);
    }
  }
  if (!hasMove()) { state.shuffles += 1; fillBoard(); }
}

async function resolveBoard() {
  state.combo = 0;
  for (let matches = findMatches(); matches.length; matches = findMatches()) {
    state.combo += 1;
    state.score += matches.length * 10 * state.combo;
    await Promise.all(matches.map(([x, y]) => {
      const gem = grid[y][x];
      grid[y][x] = null;
      sparks.burst(10, { x: gem.node.position.x, y: gem.node.position.y, minSpeed: 40, maxSpeed: 140, tint: TYPES[gem.type].color });
      return Promise.all([tween(gem.node.scale, "x", 0.1, 0.18), tween(gem.node.scale, "y", 0.1, 0.18)]).then(() => gem.node.destroy());
    }));
    const falls = [];
    for (let x = 0; x < SIZE; x += 1) {
      let write = SIZE - 1;
      for (let y = SIZE - 1; y >= 0; y -= 1) {
        const gem = grid[y][x];
        if (!gem) continue;
        if (write !== y) { grid[write][x] = gem; grid[y][x] = null; falls.push(tween(gem.node.position, "y", cellCenter(x, write).y, 0.08 * (write - y) + 0.1, easing.inQuad)); }
        write -= 1;
      }
      for (let y = write, spawned = 1; y >= 0; y -= 1, spawned += 1) {
        const gem = makeGem(Math.floor(random() * TYPES.length), x, y);
        gem.node.position.y = BOARD_Y - spawned * CELL + CELL / 2;
        grid[y][x] = gem;
        falls.push(tween(gem.node.position, "y", cellCenter(x, y).y, 0.08 * (write + 1) + 0.1, easing.inQuad));
      }
    }
    await Promise.all(falls);
  }
  if (!hasMove()) { state.shuffles += 1; fillBoard(); }
}

async function trySwap(a, b) {
  if (!flow.is("idle") || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  flow.send("swap");
  state.selected = null;
  const first = grid[a.y][a.x]; const second = grid[b.y][b.x];
  const move = (gem, cell) => Promise.all([tween(gem.node.position, "x", cellCenter(cell.x, cell.y).x, 0.15), tween(gem.node.position, "y", cellCenter(cell.x, cell.y).y, 0.15)]);
  await Promise.all([move(first, b), move(second, a)]);
  swapCells(a, b);
  if (findMatches().length === 0) {
    // Not a match: swap back and keep the move.
    await Promise.all([move(first, a), move(second, b)]);
    swapCells(a, b);
    flow.send("settle");
    return false;
  }
  state.moves -= 1;
  await resolveBoard();
  if (state.moves <= 0) {
    flow.send("end");
    if (state.score > state.best) { state.best = state.score; save.set("best", state.best); }
  } else {
    flow.send("settle");
  }
  return true;
}

function cellAt(point) {
  const x = Math.floor((point.x - BOARD_X) / CELL); const y = Math.floor((point.y - BOARD_Y) / CELL);
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null;
}

function select(cell) {
  if (!cell) { state.selected = null; return; }
  if (state.selected && (state.selected.x !== cell.x || state.selected.y !== cell.y)) {
    const from = state.selected;
    if (Math.abs(from.x - cell.x) + Math.abs(from.y - cell.y) === 1) { trySwap(from, cell); return; }
  }
  state.selected = state.selected && state.selected.x === cell.x && state.selected.y === cell.y ? null : cell;
}

function restart() {
  random = createRandom(42);
  animator.clear();
  sparks.clear();
  Object.assign(state, { score: 0, moves: MOVES, combo: 0, selected: null, drag: null, shuffles: 0 });
  if (flow.is("over")) flow.send("restart");
  fillBoard();
}

const pointer = { x: 0, y: 0 };
const clipA = { x: 0, y: 0 }; const clipB = { x: 0, y: 0 };
const DIRECTIONS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
function handleInput(input) {
  if (!input) return;
  if (input.wasActionPressed("restart") && !flow.is("busy")) { restart(); return; }
  if (!flow.is("idle")) return;
  input.getPointerWorld(camera, pointer);
  if (input.wasPointerPressed(0)) {
    const cell = cellAt(pointer);
    state.drag = cell ? { cell, x: pointer.x, y: pointer.y } : null;
    if (cell) state.cursor = { ...cell };
    select(cell);
  } else if (state.drag && input.isPointerDown(0)) {
    const dx = pointer.x - state.drag.x; const dy = pointer.y - state.drag.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > CELL / 2) {
      const from = state.drag.cell;
      const to = Math.abs(dx) > Math.abs(dy) ? { x: from.x + Math.sign(dx), y: from.y } : { x: from.x, y: from.y + Math.sign(dy) };
      state.drag = null;
      if (to.x >= 0 && to.y >= 0 && to.x < SIZE && to.y < SIZE) trySwap(from, to);
    }
  } else if (!input.isPointerDown(0)) {
    state.drag = null;
  }
  for (const [code, [dx, dy]] of Object.entries(DIRECTIONS)) {
    if (!input.wasKeyPressed(code)) continue;
    const next = { x: Math.max(0, Math.min(SIZE - 1, state.cursor.x + dx)), y: Math.max(0, Math.min(SIZE - 1, state.cursor.y + dy)) };
    if (state.selected) { if (next.x !== state.cursor.x || next.y !== state.cursor.y) trySwap(state.selected, next); }
    state.cursor = next;
  }
  if (input.wasActionPressed("select")) select({ ...state.cursor });
}

restart();
const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#020617",
  scene,
  camera,
  animator,
  overlayScene: hud,
  inputActions: { select: ["Space", "Enter"], restart: ["KeyR"] },
  onUpdate(delta, currentEngine) {
    handleInput(currentEngine.input);
    camera.worldToScreen(BOARD_X, BOARD_Y, clipA);
    camera.worldToScreen(BOARD_X + SIZE * CELL, BOARD_Y + SIZE * CELL, clipB);
    gemLayer.setClipRect({ x: clipA.x, y: clipA.y, width: clipB.x - clipA.x, height: clipB.y - clipA.y });
    const cursorCenter = cellCenter(state.cursor.x, state.cursor.y);
    cursor.position.set(cursorCenter.x, cursorCenter.y);
    selection.visible = Boolean(state.selected);
    if (state.selected) { const center = cellCenter(state.selected.x, state.selected.y); selection.position.set(center.x, center.y); }
    label.setText(`Score ${state.score}\nMoves ${state.moves}\nBest ${state.best}${state.combo > 1 ? `\nCombo ×${state.combo}` : ""}${flow.is("over") ? "\nOut of moves — R to replay" : ""}`);
  },
});
engine.start();

window.game = { engine, scene, state, grid, flow, trySwap, findMatches, hasMove, restart, cellCenter };
