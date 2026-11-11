// ExiEngine editor Play window: runs the scene being edited and follows every
// committed edit live (watchScene over the editor's BroadcastChannel).
// Nodes whose data has body: "dynamic" or "static" get rigid-body physics so a
// level can be tried out; shape: "circle" uses a circle, otherwise the node's
// bounds become a box. Press R to restart from the latest edit.
import { Camera, ExiEngine, RigidBody, RigidBodyWorld, Texture, TileMap, getAABB, watchScene } from "../src/index.js";
import { AUTOSAVE_KEY, BUILTIN_TILES_ID, EDITOR_CHANNEL, createBuiltinTiles } from "./shared.js";

const name = new URLSearchParams(location.search).get("name");
const statusNode = document.querySelector("#play-status");
const textures = new Map([[BUILTIN_TILES_ID, createBuiltinTiles()]]);
const camera = new Camera();
let world = null;
let reloads = 0;

function buildPhysics(scene) {
  const physics = new RigidBodyWorld({ gravityY: Number(scene.data?.gravity ?? 980) });
  scene.updateWorldMatrix();
  let bodies = 0;
  for (const node of scene.children) {
    const kind = node.data?.body;
    if (kind !== "dynamic" && kind !== "static") continue;
    if (node instanceof TileMap) {
      // Tile maps become static boxes from their merged solid tiles.
      const solid = Array.isArray(node.data.solidTiles) ? new Set(node.data.solidTiles) : null;
      for (const rect of node.getCollisionRects(solid)) {
        physics.add(new RigidBody({ shape: { type: "box", width: rect.width, height: rect.height }, x: node.position.x + rect.x + rect.width / 2, y: node.position.y + rect.y + rect.height / 2, static: true }));
        bodies += 1;
      }
      continue;
    }
    const box = getAABB(node);
    if (!(box.width > 0 && box.height > 0)) continue;
    const shape = node.data.shape === "circle" ? { type: "circle", radius: Math.min(box.width, box.height) / 2 } : { type: "box", width: box.width / Math.abs(node.scale.x || 1), height: box.height / Math.abs(node.scale.y || 1) };
    physics.add(new RigidBody({
      shape, x: node.position.x, y: node.position.y, angle: node.rotation,
      static: kind === "static", node: kind === "dynamic" ? node : null,
      restitution: Number(node.data.restitution ?? 0.2), friction: Number(node.data.friction ?? 0.5), density: Number(node.data.density ?? 1),
    }));
    bodies += 1;
  }
  return { physics, bodies };
}

function frame(scene) {
  scene.updateWorldMatrix();
  let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
  for (const node of scene.children) {
    const box = getAABB(node);
    if (!(box.width > 0 || box.height > 0)) continue;
    left = Math.min(left, box.left); top = Math.min(top, box.top); right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  if (!Number.isFinite(left)) { left = 0; top = 0; right = 960; bottom = 540; }
  camera.position.set((left + right) / 2, (top + bottom) / 2);
  const view = camera.getVisibleBounds();
  camera.zoom = Math.max(0.05, Math.min(4, camera.zoom * Math.min(view.width / ((right - left) * 1.1 || 1), view.height / ((bottom - top) * 1.1 || 1))));
}

let engine = null;
function show(scene, document, source) {
  const { physics, bodies } = buildPhysics(scene);
  world = physics;
  const previous = engine.scene;
  engine.physics = physics;
  engine.setScene(scene, camera);
  if (previous && previous !== scene) previous.destroy();
  if (reloads === 0) frame(scene);
  reloads += 1;
  statusNode.textContent = `▶ ${scene.name || "scene"} · ${bodies} physics bodies · update #${reloads} (${source}) · R restarts`;
}

engine = await ExiEngine.create({ canvas: document.querySelector("#play-canvas"), backgroundColor: "#0b1020", camera, physics: new RigidBodyWorld() });
engine.start();

const watcher = watchScene({
  channel: EDITOR_CHANNEL,
  name,
  textures,
  onChange: (scene, document, report) => show(scene, document, report.source),
  onError: (error) => { statusNode.textContent = `Edit rejected: ${error.message}`; },
});

// Images imported in the editor arrive as ImageBitmaps.
const channel = new BroadcastChannel(EDITOR_CHANNEL);
channel.onmessage = (event) => {
  if (event.data?.type !== "exi-textures") return;
  for (const { id, bitmap } of event.data.items || []) {
    if (typeof id === "string" && bitmap && !textures.has(id)) textures.set(id, new Texture({ id, source: bitmap, filter: "nearest" }));
  }
};
// Ask the editor for the current scene and textures; fall back to its autosave.
channel.postMessage({ type: "exi-play-hello" });
setTimeout(() => {
  if (reloads > 0) return;
  try { const saved = localStorage.getItem(AUTOSAVE_KEY); if (saved) watcher.apply(JSON.parse(saved)); } catch { /* no autosave */ }
}, 300);

// R restarts from the latest edit: a reload asks the editor for its scene again.
window.addEventListener("keydown", (event) => { if (event.code === "KeyR") location.reload(); });

window.play = { engine, camera, get world() { return world; }, watcher, get reloads() { return reloads; } };
