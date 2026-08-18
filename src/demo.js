import { ExiEngine } from "./core/exi-engine.js";
import { Animator, Tween } from "./core/animation.js";
import { Camera } from "./core/camera.js";
import { CollisionWorld, Collider, getAABB } from "./core/collision.js";
import { Scene } from "./core/node.js";
import { Sprite } from "./core/sprite.js";
import { Text, TextCache } from "./core/text.js";
import { AnimatedSprite } from "./core/animated-sprite.js";
import { SpriteBatch } from "./core/sprite-batch.js";
import { Texture } from "./assets/texture.js";
import { TextureAtlas } from "./assets/texture-atlas.js";
import { AssetLoader } from "./assets/asset-loader.js";
import { Graphics } from "./core/graphics.js";
import { ParticleEmitter } from "./core/particle-emitter.js";
import * as Exi from "./index.js";
import { createEngineObserver, RuntimeAgent } from "./ai/runtime-agent.js";

const statusNode = document.querySelector("#status");
const backendNode = document.querySelector("#backend");
const fpsNode = document.querySelector("#fps");
const drawNode = document.querySelector("#draws");
const nodeNode = document.querySelector("#nodes");
const assetNode = document.querySelector("#asset");
const messageNode = document.querySelector("#message");
const runtimeNode = document.querySelector("#exi-runtime");
const scene = new Scene();
const runtimeToken = await fetch("/__exi/runtime-token", { cache: "no-store" }).then((response) => response.ok ? response.text() : "").then((value) => value.trim()).catch(() => "");
const runtimeCallbacks = Object.create(null);
// Register reviewed demo callbacks here when testing callback-taking APIs through MCP.
const camera = new Camera({ x: 0, y: 0, zoom: 1 });
const animator = new Animator();
const collisions = new CollisionWorld();
const alternateTexture = new Texture({ id: "demo-alternate-white" });
const demoLoader = new AssetLoader({ baseURL: location.href });
const aura = new Graphics({ zIndex: 0 }).circle(0, 0, 390, { fill: 0x101d3d, alpha: 0.65, segments: 32 });
const makeTile = (color) => {
  const canvas = document.createElement("canvas");
  canvas.width = 8; canvas.height = 8;
  const context = canvas.getContext("2d");
  context.fillStyle = color;
  context.fillRect(0, 0, 8, 8);
  return canvas;
};
const packedDemoAtlas = TextureAtlas.pack([
  { name: "violet", source: makeTile("#6b39d8") },
  { name: "mint", source: makeTile("#6fffc0") },
], { padding: 1, maxWidth: 32, maxHeight: 32, id: "demo-packed-atlas" });
const backdropFrames = [packedDemoAtlas.get("violet"), packedDemoAtlas.get("mint")];
const backdrop = new SpriteBatch({ texture: packedDemoAtlas.texture, zIndex: -1, cullable: false, instanced: true, gpuCulling: true });
for (let index = 0; index < 64; index += 1) {
  const column = index % 8;
  const row = Math.floor(index / 8);
  backdrop.addSprite({ texture: backdropFrames[index % 2], x: (column - 3.5) * 112, y: (row - 3.5) * 86, width: 6, height: 6, tint: 0xffffff, alpha: 0.18, rotation: index * 0.12 });
}
scene.add(backdrop);
scene.add(aura);
const textCache = new TextCache({ maxEntries: 32, maxPixels: 256 * 1024 });
scene.add(new Text({ text: "EXI // GPU CORE", font: "bold 18px sans-serif", fill: "#b8fff0", padding: 6, cache: textCache, x: -430, y: -252, anchorX: 0, anchorY: 0, zIndex: 5 }));
let engine = null;
let runtimeAgent = null;
let lastTelemetryAt = 0;
let lastRuntimeEvent = "starting";

const blocks = [];
for (let index = 0; index < 32; index += 1) {
  const column = index % 8;
  const row = Math.floor(index / 8);
  const block = new Sprite({ texture: index >= 16 ? alternateTexture : Texture.white, width: 72, height: 48, x: (column - 3.5) * 88, y: (row - 1.5) * 70, tint: index % 2 ? 0x2c6fff : 0x6b39d8, zIndex: 1 });
  scene.add(block);
  blocks.push(block);
  collisions.add(new Collider(block, { tag: "block" }));
}

const cursor = new AnimatedSprite({ frames: [Texture.white, alternateTexture], frameRate: 4, width: 32, height: 32, tint: 0x6fffc0, zIndex: 4 });
scene.add(cursor);
const particles = new ParticleEmitter({ zIndex: 3, clipRect: { x: 120, y: 80, width: 720, height: 380 }, rate: 24, maxParticles: 160, lifetime: 1.8, size: 5, tint: 0xffd36f, gravityY: 8 });
particles.emit(32, { x: 0, y: 0, vx: 0, vy: -20 });
scene.add(particles);
animator.add(new Tween(cursor.scale, "x", 1.2, 1.1, { loop: Infinity, yoyo: true }));
animator.add(new Tween(cursor.scale, "y", 1.2, 1.1, { loop: Infinity, yoyo: true }));

demoLoader.loadTexture("/assets/demo.svg", { mimeType: "image/svg+xml" }).then((texture) => {
  for (const block of blocks.slice(16)) block.setTexture(texture);
  assetNode.textContent = "ASSET LOCAL OK";
}).catch(() => {
  assetNode.textContent = "ASSET FALLBACK";
});

function showStatus(message, tone = "neutral") {
  statusNode.textContent = message;
  statusNode.dataset.tone = tone;
}

function handleStatus(event) {
  lastRuntimeEvent = event.type;
  runtimeNode.dataset.event = event.type;
  if (event.type === "backend-selected") backendNode.textContent = event.backend.toUpperCase();
  if (event.type === "fallback") showStatus(`Fallback: ${event.to.toUpperCase()}`, "warn");
  if (event.type === "context-lost" || event.type === "device-lost") showStatus("GPU bağlantısı kaybedildi; fallback deneniyor.", "warn");
  if (event.type === "renderer-error") showStatus(`Renderer hatası: ${event.message}`, "error");
}

function update(delta, currentEngine) {
  animator.update(delta);
  const speed = 260 * delta;
  if (currentEngine.input.isKeyDown("ArrowLeft")) cursor.position.x -= speed;
  if (currentEngine.input.isKeyDown("ArrowRight")) cursor.position.x += speed;
  if (currentEngine.input.isKeyDown("ArrowUp")) cursor.position.y -= speed;
  if (currentEngine.input.isKeyDown("ArrowDown")) cursor.position.y += speed;
  if (currentEngine.input.wasKeyPressed("Space")) camera.zoom = camera.zoom > 1 ? 1 : 1.25;
  scene.updateWorldMatrix();
  const hit = collisions.firstHit(getAABB(cursor));
  cursor.setTint(hit ? 0xffcf70 : 0x6fffc0);
  messageNode.textContent = hit ? "Çarpışma algılandı · Space ile zoom" : "Ok tuşlarıyla hareket · Space ile zoom";
}

function render(currentEngine) {
  const info = currentEngine.getInfo();
  backendNode.textContent = info.backend?.toUpperCase() || "—";
  fpsNode.textContent = `${info.profiler.fps || 60} FPS`;
  drawNode.textContent = `${info.drawCalls || 0} DRAW`;
  nodeNode.textContent = `${info.nodeCount || 0} NODE`;
  const runtimeState = { ready: true, status: currentEngine.running ? "running" : "stopped", event: lastRuntimeEvent, backend: info.backend || "unknown", fps: Math.round(info.profiler?.fps || 0), draws: info.drawCalls || 0, nodes: info.nodeCount || 0 };
  for (const [key, value] of Object.entries(runtimeState)) runtimeNode.dataset[key] = String(value);
  runtimeNode.textContent = JSON.stringify(runtimeState);
  const now = performance.now();
  if (runtimeToken && (now - lastTelemetryAt >= 250 || runtimeState.status !== "running")) {
    lastTelemetryAt = now;
    void fetch("/__exi/runtime", { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": runtimeToken }, body: JSON.stringify(runtimeState), keepalive: true }).catch(() => {});
  }
}

async function boot(preference = "auto") {
  runtimeAgent?.stop();
  engine?.destroy();
  engine = null;
  runtimeAgent = null;
  const previousCanvas = document.querySelector("#game-canvas");
  const canvas = previousCanvas.cloneNode(false);
  canvas.width = previousCanvas.width;
  canvas.height = previousCanvas.height;
  previousCanvas.parentNode.replaceChild(canvas, previousCanvas);
  backendNode.textContent = "YÜKLENİYOR";
  showStatus(`${preference.toUpperCase()} başlatılıyor…`);
  try {
    engine = await ExiEngine.create({ canvas, renderer: preference, scene, camera, onStatus: handleStatus, onUpdate: update, onRender: render });
    engine.start();
    runtimeAgent = new RuntimeAgent({ api: Exi, roots: { engine, scene }, callbacks: runtimeCallbacks, observe: createEngineObserver(engine), token: runtimeToken });
    runtimeAgent.start();
    window.game = { engine, scene, runtimeAgent };
    showStatus("Çalışıyor", "ok");
  } catch (error) {
    backendNode.textContent = "KULLANILAMIYOR";
    showStatus(error.message, "error");
    messageNode.textContent = "Bu cihazda seçilen backend yok; Auto seçeneğini deneyin.";
  }
}

document.querySelectorAll("[data-renderer]").forEach((button) => button.addEventListener("click", () => boot(button.dataset.renderer)));
boot();
