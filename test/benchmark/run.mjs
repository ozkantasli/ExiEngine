// Runs a single named benchmark: `npm run bench -- <name>`.
// Without a name it lists the available benchmarks. `npm run verify` still runs all of them,
// and `npm run bench:regression` compares them against the local baseline.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const benchmarks = {
  "streaming": "test/gpu-streaming-benchmark.mjs",
  "instanced": "test/cpu-instanced-benchmark.mjs",
  "regular": "test/regular-streaming-benchmark.mjs",
  "culling": "test/spatial-culling-benchmark.mjs",
  "sprite-culling": "test/sprite-culling-benchmark.mjs",
  "graphics:culling": "test/graphics-culling-benchmark.mjs",
  "graphics": "test/graphics-streaming-benchmark.mjs",
  "sprite": "test/sprite-streaming-benchmark.mjs",
  "subtree-culling": "test/subtree-culling-benchmark.mjs",
  "transform": "test/transform-streaming-benchmark.mjs",
  "text": "test/text-streaming-benchmark.mjs",
  "glyph": "test/glyph-atlas-benchmark.mjs",
  "particles": "test/particle-streaming-benchmark.mjs",
  "particles:cpu": "test/particle-cpu-streaming-benchmark.mjs",
  "particles:culling": "test/particle-culling-benchmark.mjs",
  "particles:gpu-culling": "test/particle-gpu-culling-benchmark.mjs",
  "input": "test/input-streaming-benchmark.mjs",
  "pointer": "test/pointer-dispatch-benchmark.mjs",
  "tilemap": "test/tilemap-streaming-benchmark.mjs",
  "tilemap:regular": "test/tilemap-regular-streaming-benchmark.mjs",
  "queue": "test/queue-streaming-benchmark.mjs",
  "frame-scratch": "test/frame-scratch-benchmark.mjs",
  "animation": "test/animation-streaming-benchmark.mjs",
  "collision": "test/collision-query-benchmark.mjs",
  "physics": "test/physics-streaming-benchmark.mjs",
};

const name = process.argv[2];

if (!name) {
  console.log("Usage: npm run bench -- <name>\n\nAvailable benchmarks:");
  for (const key of Object.keys(benchmarks)) console.log(`  ${key}`);
  process.exit(0);
}

if (!Object.prototype.hasOwnProperty.call(benchmarks, name)) {
  console.error(`Unknown benchmark "${name}". Run "npm run bench" to list the available names.`);
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(root, benchmarks[name])], { cwd: root, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.once("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
