// ExiEngine example: an endless runner.
// Shows a one-button game: jump with variable height (release early for a short
// hop), coyote time and jump buffering, procedurally generated obstacles and
// coins from a seeded random generator, a speed that ramps up, parallax
// background layers, dust particles, tweened coin pickups, a HUD overlay and a
// best distance kept in SaveStore. Keyboard, gamepad, mouse and touch all jump.
import { Animator, Camera, ExiEngine, Graphics, ParticleEmitter, SaveStore, Scene, Text, Texture, Tween, easing } from "../../src/index.js";

const WIDTH = 640;
const HEIGHT = 360;
const GROUND_Y = 300;
const GRAVITY = 2200;
const JUMP_SPEED = 760;
const JUMP_CUT = 0.45; // velocity kept when the button is released while rising
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
const START_SPEED = 260;
const MAX_SPEED = 620;
const PLAYER_X = 120;
const PLAYER_SIZE = 28;
const MAX_OBSTACLES = 12;
const MAX_COINS = 24;

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
const animator = new Animator({ maxTweens: 64 });
const save = new SaveStore({ namespace: "exi-runner" });
let random = createRandom(7);

// Parallax: each layer is two copies of the same strip placed side by side.
function parallaxLayer(color, baseY, height, bumps, factor, seed) {
  const seeded = createRandom(seed);
  // One shape for both copies; the last height repeats the first so the strips tile.
  const heights = Array.from({ length: bumps }, () => baseY - seeded() * height);
  heights.push(heights[0]);
  const strip = () => {
    const node = new Graphics({ zIndex: -20 + factor * 10 });
    const points = [0, HEIGHT];
    heights.forEach((y, index) => points.push((index / bumps) * WIDTH, y));
    points.push(WIDTH, HEIGHT);
    node.polygon(points, { fill: color });
    scene.add(node);
    return node;
  };
  return { nodes: [strip(), strip()], factor, offset: 0 };
}
const layers = [
  parallaxLayer(0x1e1b4b, 210, 90, 6, 0.15, 3),
  parallaxLayer(0x312e81, 250, 60, 9, 0.35, 5),
];
const ground = new Graphics({ zIndex: -1 }).rect(0, GROUND_Y, WIDTH, HEIGHT - GROUND_Y, { fill: 0x0f172a }).rect(0, GROUND_Y, WIDTH, 4, { fill: 0x5eead4 });
scene.add(ground);
const groundMarks = new Graphics({ zIndex: 0 });
for (let index = 0; index < 12; index += 1) groundMarks.rect(index * 64, GROUND_Y + 14, 22, 3, { fill: 0x334155 });
scene.add(groundMarks);

const player = new Graphics({ name: "player", x: PLAYER_X, y: GROUND_Y - PLAYER_SIZE })
  .roundedRect(0, 0, PLAYER_SIZE, PLAYER_SIZE, 7, { fill: 0xf472b6 })
  .rect(17, 8, 6, 6, { fill: 0x0f172a });
scene.add(player);

const obstacles = Array.from({ length: MAX_OBSTACLES }, () => {
  const node = new Graphics({ visible: false });
  scene.add(node);
  return { node, active: false, width: 0, height: 0, floating: false };
});
const coins = Array.from({ length: MAX_COINS }, () => {
  const node = new Graphics({ visible: false }).circle(0, 0, 7, { fill: 0xfacc15, segments: 14 }).rect(-1.5, -4, 3, 8, { fill: 0xa16207 });
  scene.add(node);
  return { node, active: false, collecting: false };
});

const dust = new ParticleEmitter({ texture: Texture.white, maxParticles: 256, lifetime: 0.35, size: 3, tint: 0x94a3b8, gravityY: 300, random: () => random() });
scene.add(dust);

const camera = new Camera({ x: WIDTH / 2, y: HEIGHT / 2, roundPixels: true });
const hud = new Scene();
const label = new Text({ x: 12, y: 10, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 15px system-ui, sans-serif", fill: "#e2e8f0" });
const banner = new Text({ x: WIDTH / 2, y: 120, resolution: 2, text: "", font: "bold 22px system-ui, sans-serif", fill: "#f8fafc", align: "center" });
hud.add(label, banner);

const state = { phase: "ready", speed: START_SPEED, distance: 0, coins: 0, best: save.get("best", 0), vy: 0, grounded: true, coyote: 0, buffer: 0, nextSpawn: 0, jumps: 0, overTime: 0 };

function playerBox() { return { x: player.position.x + 3, y: player.position.y + 3, width: PLAYER_SIZE - 6, height: PLAYER_SIZE - 3 }; }
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }

function spawnObstacle(x) {
  const obstacle = obstacles.find((item) => !item.active);
  if (!obstacle) return 0;
  const floating = state.distance > 1500 && random() < 0.3;
  const width = floating ? 70 + random() * 50 : 22 + Math.floor(random() * 3) * 16;
  const height = floating ? 18 : 30 + Math.floor(random() * 3) * 16;
  const y = floating ? GROUND_Y - PLAYER_SIZE - 26 - height : GROUND_Y - height;
  obstacle.node.clear().rect(0, 0, width, height, { fill: floating ? 0x60a5fa : 0xf97316 }).rect(0, 0, width, 4, { fill: floating ? 0x93c5fd : 0xfdba74 });
  obstacle.node.position.set(x, y);
  Object.assign(obstacle, { active: true, width, height, floating });
  obstacle.node.visible = true;
  // Coins arc over ground obstacles, and sit underneath floating ones.
  const count = 3 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const coin = coins.find((item) => !item.active);
    if (!coin) break;
    const t = count === 1 ? 0.5 : index / (count - 1);
    const cx = x + width / 2 + (t - 0.5) * 120;
    const cy = floating ? GROUND_Y - 16 : y - 30 - Math.sin(t * Math.PI) * 60;
    coin.node.position.set(cx, cy);
    coin.node.alpha = 1; coin.node.scale.set(1, 1);
    Object.assign(coin, { active: true, collecting: false });
    coin.node.visible = true;
  }
  return width;
}

function collectCoin(coin) {
  coin.collecting = true;
  state.coins += 1;
  animator.add(new Tween(coin.node.position, "y", coin.node.position.y - 40, 0.3, { ease: easing.outQuad }));
  animator.add(new Tween(coin.node, "alpha", 0, 0.3, { onComplete: () => { coin.active = false; coin.node.visible = false; } }));
}

function reset() {
  random = createRandom(7);
  for (const item of [...obstacles, ...coins]) { item.active = false; item.node.visible = false; }
  animator.clear();
  dust.clear();
  Object.assign(state, { phase: "ready", speed: START_SPEED, distance: 0, coins: 0, vy: 0, grounded: true, coyote: 0, buffer: 0, nextSpawn: 400, jumps: 0, overTime: 0 });
  player.position.set(PLAYER_X, GROUND_Y - PLAYER_SIZE);
  player.rotation = 0;
}

function crash() {
  state.phase = "over";
  camera.shake(7, 0.3);
  dust.burst(30, { x: player.position.x + PLAYER_SIZE / 2, y: player.position.y + PLAYER_SIZE / 2, minSpeed: 80, maxSpeed: 260, tint: 0xf472b6 });
  const meters = Math.floor(state.distance / 10);
  if (meters > state.best) { state.best = meters; save.set("best", meters); }
}

function update(delta, input) {
  const pressed = input?.wasActionPressed("jump") || input?.wasPointerPressed(0);
  const held = input?.isActionDown("jump") || input?.isPointerDown(0);
  if (state.phase === "ready") { if (pressed) state.phase = "running"; else return; }
  // A short pause after a crash so a held jump does not restart at once.
  if (state.phase === "over") { state.overTime += delta; if (pressed && state.overTime > 0.4) reset(); return; }

  state.speed = Math.min(MAX_SPEED, state.speed + delta * 9);
  const scroll = state.speed * delta;
  state.distance += scroll;

  // Jump: buffered presses and coyote time make the timing forgiving.
  state.buffer = pressed ? JUMP_BUFFER : Math.max(0, state.buffer - delta);
  state.coyote = state.grounded ? COYOTE_TIME : Math.max(0, state.coyote - delta);
  if (state.buffer > 0 && state.coyote > 0) {
    state.vy = -JUMP_SPEED; state.grounded = false; state.buffer = 0; state.coyote = 0; state.jumps += 1;
    dust.burst(8, { x: player.position.x + 6, y: GROUND_Y, minSpeed: 30, maxSpeed: 90 });
  }
  if (!held && state.vy < 0) state.vy *= JUMP_CUT ** (delta * 60);
  state.vy += GRAVITY * delta;
  player.position.y += state.vy * delta;
  if (player.position.y >= GROUND_Y - PLAYER_SIZE) {
    if (!state.grounded && state.vy > 300) dust.burst(10, { x: player.position.x + PLAYER_SIZE / 2, y: GROUND_Y, minSpeed: 30, maxSpeed: 120 });
    player.position.y = GROUND_Y - PLAYER_SIZE; state.vy = 0; state.grounded = true;
  } else {
    state.grounded = false;
  }
  player.rotation = state.grounded ? 0 : player.rotation + delta * 6;

  for (const layer of layers) {
    layer.offset = (layer.offset + scroll * layer.factor) % WIDTH;
    layer.nodes[0].position.x = -layer.offset; layer.nodes[1].position.x = WIDTH - layer.offset;
  }
  groundMarks.position.x = -(state.distance % 64);

  state.nextSpawn -= scroll;
  if (state.nextSpawn <= 0) {
    const width = spawnObstacle(WIDTH + 20);
    // Gaps grow with speed so every pattern stays jumpable.
    state.nextSpawn = width + state.speed * (0.75 + random() * 0.7);
  }
  const box = playerBox();
  for (const obstacle of obstacles) {
    if (!obstacle.active) continue;
    obstacle.node.position.x -= scroll;
    if (obstacle.node.position.x + obstacle.width < -10) { obstacle.active = false; obstacle.node.visible = false; continue; }
    if (overlaps(box, { x: obstacle.node.position.x, y: obstacle.node.position.y, width: obstacle.width, height: obstacle.height })) { crash(); return; }
  }
  for (const coin of coins) {
    if (!coin.active) continue;
    coin.node.position.x -= scroll;
    if (coin.node.position.x < -20) { coin.active = false; coin.node.visible = false; continue; }
    if (!coin.collecting && overlaps(box, { x: coin.node.position.x - 7, y: coin.node.position.y - 7, width: 14, height: 14 })) collectCoin(coin);
  }
}

reset();
const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#0b1026",
  scene,
  camera,
  animator,
  overlayScene: hud,
  inputActions: { jump: ["Space", "ArrowUp", "KeyW", { type: "gamepad", button: 0 }] },
  onUpdate(delta, currentEngine) {
    update(delta, currentEngine.input);
    const meters = Math.floor(state.distance / 10);
    label.setText(`${meters} m · ${state.coins} coins · best ${state.best} m`);
    banner.setText(state.phase === "ready" ? "Space / tap to run and jump\nHold for a higher jump" : state.phase === "over" ? `Crashed at ${meters} m\nSpace / tap to try again` : "");
  },
});
engine.start();

window.game = { engine, scene, player, state, obstacles, coins, reset };
