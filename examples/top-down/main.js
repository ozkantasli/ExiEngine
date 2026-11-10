// ExiEngine example: a top-down arena.
// Shows a code-built TileMap with merged static wall bodies, zero-gravity physics,
// trigger pickups via PhysicsWorld.overlaps, A* (findGridPath) chasing enemies,
// a particle burst, camera shake and a HUD overlay.
import { Camera, ExiEngine, Graphics, ParticleEmitter, PhysicsBody, PhysicsWorld, Scene, Text, Texture, TileMap, findGridPath } from "../../src/index.js";

const CELL = 32;
const LAYOUT = [
  "####################",
  "#........#.........#",
  "#.##.###.#.###.###.#",
  "#.#......*......#..#",
  "#.#.###.###.###.#.##",
  "#...#.........#....#",
  "###.#.##.#.##.#.##.#",
  "#.......*#*........#",
  "#.###.##.#.##.###..#",
  "#..................#",
  "####################",
];
const COLUMNS = LAYOUT[0].length;
const ROWS = LAYOUT.length;
const GRID = LAYOUT.map((row) => [...row].map((cell) => (cell === "#" ? 1 : 0)));
const PLAYER_SPEED = 150;
const ENEMY_SPEED = 70;
const PLAYER_SIZE = 20;

function createWallTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = CELL;
  canvas.height = CELL;
  const context = canvas.getContext("2d");
  context.fillStyle = "#1e293b"; context.fillRect(0, 0, CELL, CELL);
  context.fillStyle = "#334155"; context.fillRect(2, 2, CELL - 4, CELL - 4);
  context.fillStyle = "#475569"; context.fillRect(4, 4, CELL - 8, 4);
  return new Texture({ source: canvas, filter: "nearest", id: "arena-wall" });
}

const scene = new Scene();
const physics = new PhysicsWorld({ scene, gravityY: 0 });

const walls = new TileMap({ texture: createWallTexture(), tileWidth: CELL, tileHeight: CELL, columns: COLUMNS, rows: ROWS });
walls.setTiles(GRID.flat().map((value) => (value ? 0 : -1)));
walls.createStaticBodies(physics, { tag: "wall" });
scene.add(walls);

const floor = new Graphics({ zIndex: -1 });
for (let y = 0; y < ROWS; y += 1) for (let x = 0; x < COLUMNS; x += 1) if (!GRID[y][x]) floor.rect(x * CELL, y * CELL, CELL, CELL, { fill: (x + y) % 2 ? 0x0f172a : 0x111a2e });
scene.add(floor);

const cellCenter = (x, y) => ({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 });
const cellOf = (node, size) => ({ x: Math.floor((node.position.x + size / 2) / CELL), y: Math.floor((node.position.y + size / 2) / CELL) });

const playerStart = cellCenter(1, 1);
const player = new Graphics({ name: "player", x: playerStart.x - PLAYER_SIZE / 2, y: playerStart.y - PLAYER_SIZE / 2 }).roundedRect(0, 0, PLAYER_SIZE, PLAYER_SIZE, 6, { fill: 0x5eead4 });
scene.add(player);
const playerBody = physics.add(new PhysicsBody(player, { tag: "player" }));

const gems = [];
LAYOUT.forEach((row, y) => [...row].forEach((cell, x) => {
  if (cell !== "*") return;
  const center = cellCenter(x, y);
  const gem = new Graphics({ name: "gem", x: center.x - 7, y: center.y - 7 }).polygon([7, 0, 14, 7, 7, 14, 0, 7], { fill: 0xfacc15 });
  scene.add(gem);
  gems.push(physics.add(new PhysicsBody(gem, { static: true, isTrigger: true, tag: "gem" })));
}));

const ENEMY_SIZE = 18;
const enemies = [cellCenter(18, 1), cellCenter(18, 9), cellCenter(9, 9)].map((start) => {
  const node = new Graphics({ name: "enemy", x: start.x - ENEMY_SIZE / 2, y: start.y - ENEMY_SIZE / 2 }).roundedRect(0, 0, ENEMY_SIZE, ENEMY_SIZE, 4, { fill: 0xf87171 });
  scene.add(node);
  return { node, start, path: [], repath: Math.random() * 0.4 };
});

const sparks = new ParticleEmitter({ texture: Texture.white, maxParticles: 256, lifetime: 0.45, size: 4, tint: 0xfacc15 });
scene.add(sparks);

const camera = new Camera({ roundPixels: true });
camera.setBounds({ x: 0, y: 0, width: COLUMNS * CELL, height: ROWS * CELL });
camera.follow(player, { smoothing: 0.12 });

const hud = new Scene();
const label = new Text({ x: 12, y: 10, anchorX: 0, anchorY: 0, resolution: 2, text: "", font: "bold 16px system-ui, sans-serif", fill: "#e2e8f0" });
hud.add(label);

let score = 0;
let lives = 3;
let invulnerable = 0;
const overlapScratch = [];

function resetPlayer() {
  player.position.set(playerStart.x - PLAYER_SIZE / 2, playerStart.y - PLAYER_SIZE / 2);
  playerBody.setVelocity(0, 0);
  physics.syncBody(playerBody);
}

function updateEnemy(enemy, delta) {
  enemy.repath -= delta;
  if (enemy.repath <= 0) {
    enemy.repath = 0.4;
    const result = findGridPath(GRID, cellOf(enemy.node, ENEMY_SIZE), cellOf(player, PLAYER_SIZE), { maxNodes: COLUMNS * ROWS });
    enemy.path = result.reached ? result.path.slice(1) : [];
  }
  const next = enemy.path[0];
  if (!next) return;
  const target = cellCenter(next.x, next.y);
  const dx = target.x - (enemy.node.position.x + ENEMY_SIZE / 2);
  const dy = target.y - (enemy.node.position.y + ENEMY_SIZE / 2);
  const distance = Math.hypot(dx, dy);
  const step = ENEMY_SPEED * delta;
  if (distance <= step) { enemy.path.shift(); return; }
  enemy.node.position.x += (dx / distance) * step;
  enemy.node.position.y += (dy / distance) * step;
}

const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: 640,
  height: 360,
  resizeMode: "contain",
  backgroundColor: "#020617",
  scene,
  camera,
  overlayScene: hud,
  physics,
  inputAxes: {
    moveX: [{ type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" }, { type: "key-axis", positive: "KeyD", negative: "KeyA" }, { type: "gamepad-axis", axis: 0, deadzone: 0.2 }],
    moveY: [{ type: "key-axis", positive: "ArrowDown", negative: "ArrowUp" }, { type: "key-axis", positive: "KeyS", negative: "KeyW" }, { type: "gamepad-axis", axis: 1, deadzone: 0.2 }],
  },
  onUpdate(delta, currentEngine) {
    const direction = currentEngine.input?.getVector("moveX", "moveY") ?? { x: 0, y: 0 };
    const playing = lives > 0 && gems.length > 0;
    playerBody.setVelocity(playing ? direction.x * PLAYER_SPEED : 0, playing ? direction.y * PLAYER_SPEED : 0);

    for (const hit of physics.overlaps(playerBody, (body) => body.collider.tag === "gem", overlapScratch)) {
      const index = gems.indexOf(hit);
      if (index < 0) continue;
      gems.splice(index, 1);
      physics.remove(hit);
      sparks.burst(24, { x: hit.node.position.x + 7, y: hit.node.position.y + 7, minSpeed: 40, maxSpeed: 160 });
      hit.node.parent?.remove(hit.node);
      hit.node.destroy();
      score += 1;
    }

    invulnerable = Math.max(0, invulnerable - delta);
    if (playing) {
      for (const enemy of enemies) {
        updateEnemy(enemy, delta);
        const ex = enemy.node.position.x; const ey = enemy.node.position.y;
        const px = player.position.x; const py = player.position.y;
        if (invulnerable === 0 && px < ex + ENEMY_SIZE && px + PLAYER_SIZE > ex && py < ey + ENEMY_SIZE && py + PLAYER_SIZE > ey) {
          lives -= 1;
          invulnerable = 1.5;
          camera.shake(8, 0.35);
          resetPlayer();
          for (const other of enemies) { other.node.position.set(other.start.x - ENEMY_SIZE / 2, other.start.y - ENEMY_SIZE / 2); other.path = []; }
        }
      }
    }
    player.alpha = invulnerable > 0 && Math.floor(invulnerable * 10) % 2 ? 0.35 : 1;
    label.setText(lives <= 0 ? `Game over · gems: ${score}` : gems.length === 0 ? `You win! · lives left: ${lives}` : `Gems ${score} · lives ${lives}`);
  },
});
engine.start();

window.game = { engine, scene, player, playerBody, physics, enemies };
