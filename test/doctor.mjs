import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "AI_ENGINE_GUIDE.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CONTRIBUTING.md",
  "README.md", "API.md", "MCP.md", "SECURITY.md", "RESEARCH_GAPS.md", "index.d.ts", "src/index.js", "src/ai/runtime-agent.js", "tools/exi-mcp-server.mjs", "test/engine-smoke.mjs", "test/mcp-smoke.mjs",
];
const requiredExports = [
  "ExiEngine", "Scene", "Sprite", "SpriteBatch", "Texture", "TextureAtlas", "RenderTexture", "RenderGroup",
  "Input", "PhysicsWorld", "AudioManager", "AssetLoader", "Text", "AnimatedSprite", "TileMap",
];
const failures = [];
for (const relativePath of requiredFiles) {
  try { await access(path.join(root, relativePath)); } catch { failures.push(`missing:${relativePath}`); }
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (Object.keys(packageJson.dependencies || {}).length > 0) failures.push("runtime-dependencies-present");
if (!packageJson.scripts?.test || !packageJson.scripts?.verify || !packageJson.scripts?.doctor || !packageJson.scripts?.mcp || !packageJson.scripts?.["test:mcp"]) failures.push("required-scripts-missing");

const runtime = await import(pathToFileURL(path.join(root, "src/index.js")));
const publicExports = Object.keys(runtime).filter((name) => !name.startsWith("_")).sort();
for (const name of requiredExports) if (!(name in runtime)) failures.push(`missing-export:${name}`);

const guide = await readFile(path.join(root, "AI_ENGINE_GUIDE.md"), "utf8");
for (const token of ["npm test", "npm run verify", "index.d.ts", "WebGL2", "WebGPU", "SECURITY.md"]) {
  if (!guide.includes(token)) failures.push(`guide-missing:${token}`);
}
const apiDoc = await readFile(path.join(root, "API.md"), "utf8");
for (const name of ["ExiEngine", "Node", "Scene", "Camera", "Vec2", "Mat3", "Texture", "RenderTexture", "TextureAtlas", "Sprite", "NineSliceSprite", "Text", "TextCache", "GlyphAtlas", "AnimatedSprite", "SpriteBatch", "Graphics", "ParticleEmitter", "TileMap", "Input", "Tween", "Animator", "Collider", "CollisionWorld", "PhysicsBody", "PhysicsWorld", "AssetLoader", "SaveStore", "AudioManager", "Profiler", "clamp", "lerp", "degToRad", "radToDeg", "getAABB", "intersectsAABB", "pointInAABB", "containsAABB", "inspectKTX2"]) {
  if (!apiDoc.includes(name)) failures.push(`api-doc-missing:${name}`);
}

const result = {
  status: failures.length ? "fail" : "ok",
  node: process.version,
  package: packageJson.name,
  runtimeDependencies: Object.keys(packageJson.dependencies || {}),
  requiredFiles: requiredFiles.length,
  checkedExports: publicExports,
  failures,
};
console.log(JSON.stringify(result, null, 2));
assert.equal(failures.length, 0, failures.join(", "));
