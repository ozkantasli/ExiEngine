// ExiEngine example: a vertical space shooter.
// Shows axis + action input (keyboard, gamepad and pointer), pooled Graphics
// nodes for bullets and enemies (no allocation while playing), wave spawning
// from a seeded random generator, circle collision, particle explosions, camera
// shake, a scrolling starfield, a HUD overlay and a high score kept in SaveStore.
import { Camera, ExiEngine, Graphics, ParticleEmitter, SaveStore, Scene, Text, Texture } from "../../src/index.js";

const WIDTH = 640;
const HEIGHT = 360;
const PLAYER_SPEED = 260;
const PLAYER_RADIUS = 11;
const FIRE_INTERVAL = 0.14;
const BULLET_SPEED = 520;
const ENEMY_BULLET_SPEED = 190;
const MAX_BULLETS = 48;
const MAX_ENEMY_BULLETS = 64;
const MAX_ENEMIES = 32;

// Small seeded generator (mulberry32) so a run can be replayed in tests.
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
const save = new SaveStore({ namespace: "exi-shooter" });
let random = createRandom(1);

// Starfield: three layers of dots that scroll at different speeds and wrap.
const stars = [0.25, 0.5, 1].map((depth, layer) => {
  const node = new Graphics({ zIndex: -10 + layer, alpha: 0.35 + depth * 0.5 });
  const seeded = createRandom(100 + layer);
  for (let index = 0; index < 40; index += 1) node.rect(seeded() * WIDTH, seeded() * HEIGHT * 2 - HEIGHT, 1 + depth, 1 + depth, { fill: 0xe2e8f0 });
  scene.add(node);
  return { node, speed: 30 + depth * 60 };
});

const player = new Graphics({ name: "player", x: WIDTH / 2, y: HEIGHT - 40 })
  .triangle(0, -14, -12, 12, 12, 12, { fill: 0x5eead4 })
  .rect(-3, 8, 6, 8, { fill: 0xf472b6 });
scene.add(player);

function pool(count, draw) {
  return Array.from({ length: count }, () => {
    const node = draw(new Graphics({ visible: false }));
    scene.add(node);
    return { node, active: false, vx: 0, vy: 0, radius: 0, hp: 0, kind: 0, time: 0, fire: 0, baseX: 0 };
  });
}
const bullets = pool(MAX_BULLETS, (node) => node.rect(-2, -7, 4, 14, { fill: 0xfacc15 }));
const enemyBullets = pool(MAX_ENEMY_BULLETS, (node) => node.circle(0, 0, 4, { fill: 0xfb7185, segments: 10 }));
const ENEMY_KINDS = [
  { radius: 13, hp: 1, score: 10, color: 0xa78bfa, speed: 70, fires: false },
  { radius: 15, hp: 3, score: 30, color: 0x60a5fa, speed: 50, fires: true },
  { radius: 11, hp: 1, score: 20, color: 0xfb923c, speed: 120, fires: false },
];
const enemies = pool(MAX_ENEMIES, (node) => node);

const explosions = new ParticleEmitter({ texture: Texture.white, maxParticles: 512, lifetime: 0.5, size: 3, tint: 0xfacc15, random: () => random() });
scene.add(explosions);

const camera = new Camera({ x: WIDTH / 2, y: HEIGHT / 2, roundPixels: true });
const hud = new Scene();
const label = new Text({ x: 12, y: 10, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 15px system-ui, sans-serif", fill: "#e2e8f0" });
const banner = new Text({ x: WIDTH / 2, y: HEIGHT / 2, resolution: 2, text: "", font: "bold 22px system-ui, sans-serif", fill: "#f8fafc", align: "center" });
hud.add(label, banner);

const state = { score: 0, lives: 3, wave: 0, best: save.get("best", 0), fireTimer: 0, waveTimer: 0, invulnerable: 0, over: false, kills: 0 };

function take(list) { return list.find((item) => !item.active) || null; }
function release(item) { item.active = false; item.node.visible = false; }

function spawnEnemy(kindIndex, x, y) {
  const enemy = take(enemies);
  if (!enemy) return;
  const kind = ENEMY_KINDS[kindIndex];
  enemy.node.clear().circle(0, 0, kind.radius, { fill: kind.color, segments: 18 }).rect(-kind.radius * 0.6, -2, kind.radius * 1.2, 4, { fill: 0x0f172a });
  Object.assign(enemy, { active: true, kind: kindIndex, radius: kind.radius, hp: kind.hp, time: random() * 6, fire: 0.6 + random() * 1.4, baseX: x, vy: kind.speed + state.wave * 4 });
  enemy.node.position.set(x, y);
  enemy.node.visible = true;
}

function spawnWave() {
  state.wave += 1;
  const count = Math.min(MAX_ENEMIES, 5 + state.wave * 2);
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    const kind = state.wave > 2 && roll < 0.25 ? 1 : state.wave > 1 && roll < 0.5 ? 2 : 0;
    spawnEnemy(kind, 40 + random() * (WIDTH - 80), -20 - index * 28);
  }
}

function shoot(list, x, y, vx, vy) {
  const bullet = take(list);
  if (!bullet) return;
  Object.assign(bullet, { active: true, vx, vy });
  bullet.node.position.set(x, y);
  bullet.node.visible = true;
}

function explode(x, y, color, count = 28) {
  explosions.burst(count, { x, y, minSpeed: 40, maxSpeed: 220, tint: color });
}

function hitPlayer() {
  if (state.invulnerable > 0 || state.over) return;
  state.lives -= 1;
  state.invulnerable = 2;
  camera.shake(9, 0.4);
  explode(player.position.x, player.position.y, 0x5eead4, 40);
  if (state.lives <= 0) {
    state.over = true;
    player.visible = false;
    if (state.score > state.best) { state.best = state.score; save.set("best", state.best); }
  }
}

function restart() {
  random = createRandom(1);
  for (const list of [bullets, enemyBullets, enemies]) for (const item of list) release(item);
  explosions.clear();
  Object.assign(state, { score: 0, lives: 3, wave: 0, fireTimer: 0, waveTimer: 0.5, invulnerable: 0, over: false, kills: 0 });
  player.position.set(WIDTH / 2, HEIGHT - 40);
  player.visible = true;
}

function update(delta, input) {
  for (const layer of stars) {
    layer.node.position.y = (layer.node.position.y + layer.speed * delta) % HEIGHT;
  }
  if (state.over) {
    if (input?.wasActionPressed("restart") || input?.wasPointerPressed(0)) restart();
    return;
  }
  // Movement: keys/gamepad, or follow the pointer while it is held (touch).
  const move = input?.getVector("moveX", "moveY") ?? { x: 0, y: 0 };
  if (input?.isPointerDown(0)) {
    const target = input.getPointerWorld(camera);
    const dx = target.x - player.position.x; const dy = target.y - 30 - player.position.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 4) { move.x = dx / distance; move.y = dy / distance; }
  }
  player.position.x = Math.max(16, Math.min(WIDTH - 16, player.position.x + move.x * PLAYER_SPEED * delta));
  player.position.y = Math.max(40, Math.min(HEIGHT - 20, player.position.y + move.y * PLAYER_SPEED * delta));
  state.invulnerable = Math.max(0, state.invulnerable - delta);
  player.alpha = state.invulnerable > 0 && Math.floor(state.invulnerable * 12) % 2 ? 0.3 : 1;

  state.fireTimer -= delta;
  if ((input?.isActionDown("fire") || input?.isPointerDown(0)) && state.fireTimer <= 0) {
    state.fireTimer = FIRE_INTERVAL;
    shoot(bullets, player.position.x - 7, player.position.y - 6, 0, -BULLET_SPEED);
    shoot(bullets, player.position.x + 7, player.position.y - 6, 0, -BULLET_SPEED);
  }

  if (!enemies.some((enemy) => enemy.active)) {
    state.waveTimer -= delta;
    if (state.waveTimer <= 0) { spawnWave(); state.waveTimer = 1.2; }
  }

  for (const list of [bullets, enemyBullets]) {
    for (const bullet of list) {
      if (!bullet.active) continue;
      bullet.node.position.x += bullet.vx * delta;
      bullet.node.position.y += bullet.vy * delta;
      const { x, y } = bullet.node.position;
      if (y < -20 || y > HEIGHT + 20 || x < -20 || x > WIDTH + 20) release(bullet);
    }
  }

  for (const enemy of enemies) {
    if (!enemy.active) continue;
    const kind = ENEMY_KINDS[enemy.kind];
    enemy.time += delta;
    enemy.node.position.y += enemy.vy * delta;
    enemy.node.position.x = enemy.baseX + Math.sin(enemy.time * (enemy.kind === 2 ? 3 : 1.6)) * (enemy.kind === 2 ? 60 : 30);
    if (enemy.node.position.y > HEIGHT + 30) { enemy.node.position.y = -30; enemy.baseX = 40 + random() * (WIDTH - 80); }
    if (kind.fires && enemy.node.position.y > 0) {
      enemy.fire -= delta;
      if (enemy.fire <= 0) {
        enemy.fire = 1.6 + random();
        const dx = player.position.x - enemy.node.position.x; const dy = player.position.y - enemy.node.position.y;
        const length = Math.hypot(dx, dy) || 1;
        shoot(enemyBullets, enemy.node.position.x, enemy.node.position.y + kind.radius, (dx / length) * ENEMY_BULLET_SPEED, (dy / length) * ENEMY_BULLET_SPEED);
      }
    }
    for (const bullet of bullets) {
      if (!bullet.active) continue;
      if (Math.hypot(bullet.node.position.x - enemy.node.position.x, bullet.node.position.y - enemy.node.position.y) > enemy.radius + 4) continue;
      release(bullet);
      enemy.hp -= 1;
      enemy.node.alpha = 0.5;
      if (enemy.hp <= 0) {
        explode(enemy.node.position.x, enemy.node.position.y, kind.color);
        state.score += kind.score;
        state.kills += 1;
        release(enemy);
        break;
      }
    }
    if (enemy.active) {
      enemy.node.alpha = Math.min(1, enemy.node.alpha + delta * 4);
      if (Math.hypot(player.position.x - enemy.node.position.x, player.position.y - enemy.node.position.y) < enemy.radius + PLAYER_RADIUS) {
        explode(enemy.node.position.x, enemy.node.position.y, kind.color);
        release(enemy);
        hitPlayer();
      }
    }
  }
  for (const bullet of enemyBullets) {
    if (bullet.active && Math.hypot(player.position.x - bullet.node.position.x, player.position.y - bullet.node.position.y) < PLAYER_RADIUS + 3) {
      release(bullet);
      hitPlayer();
    }
  }
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
  overlayScene: hud,
  inputActions: { fire: ["Space", "KeyJ", { type: "gamepad", button: 0 }], restart: ["Enter", "KeyR", { type: "gamepad", button: 9 }] },
  inputAxes: {
    moveX: [{ type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" }, { type: "key-axis", positive: "KeyD", negative: "KeyA" }, { type: "gamepad-axis", axis: 0, deadzone: 0.2 }],
    moveY: [{ type: "key-axis", positive: "ArrowDown", negative: "ArrowUp" }, { type: "key-axis", positive: "KeyS", negative: "KeyW" }, { type: "gamepad-axis", axis: 1, deadzone: 0.2 }],
  },
  onUpdate(delta, currentEngine) {
    update(delta, currentEngine.input);
    label.setText(`Score ${state.score} · wave ${state.wave} · lives ${Math.max(0, state.lives)} · best ${state.best}`);
    banner.setText(state.over ? `Game over — ${state.score} points\nEnter / R / tap to play again` : "");
  },
});
engine.start();

window.game = { engine, scene, player, state, enemies, bullets, enemyBullets, restart };
