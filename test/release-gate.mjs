import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [
  "test/static-smoke.mjs",
  "test/server-smoke.mjs",
  "test/doctor.mjs",
  "test/client-config-smoke.mjs",
  "test/mcp-smoke.mjs",
  "test/engine-smoke.mjs",
  "test/gpu-streaming-benchmark.mjs",
  "test/cpu-instanced-benchmark.mjs",
  "test/regular-streaming-benchmark.mjs",
  "test/spatial-culling-benchmark.mjs",
  "test/sprite-culling-benchmark.mjs",
  "test/graphics-culling-benchmark.mjs",
  "test/graphics-streaming-benchmark.mjs",
  "test/sprite-streaming-benchmark.mjs",
  "test/subtree-culling-benchmark.mjs",
  "test/transform-streaming-benchmark.mjs",
  "test/text-streaming-benchmark.mjs",
  "test/glyph-atlas-benchmark.mjs",
  "test/particle-streaming-benchmark.mjs",
  "test/particle-cpu-streaming-benchmark.mjs",
  "test/particle-culling-benchmark.mjs",
  "test/particle-gpu-culling-benchmark.mjs",
  "test/input-streaming-benchmark.mjs",
  "test/pointer-dispatch-benchmark.mjs",
  "test/tilemap-streaming-benchmark.mjs",
  "test/tilemap-regular-streaming-benchmark.mjs",
  "test/queue-streaming-benchmark.mjs",
  "test/frame-scratch-benchmark.mjs",
  "test/animation-streaming-benchmark.mjs",
  "test/collision-query-benchmark.mjs",
  "test/physics-streaming-benchmark.mjs",
];

function run(relativePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, relativePath)], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

for (const check of checks) {
  console.log(`\n[release-gate] ${check}`);
  const result = await run(check);
  if (result.code !== 0) throw new Error(`${check} başarısız oldu (${result.signal || result.code}).`);
}

console.log("\nExiEngine release gate: passed");
