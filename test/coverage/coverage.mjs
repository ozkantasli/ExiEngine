// ExiEngine coverage runner — runs the unit suite with --experimental-test-coverage,
// compares each module's line coverage with thresholds.mjs and reports a summary.
// No dependencies. Uses a file list instead of a glob for Node 20 compatibility.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { thresholds } from "./thresholds.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function listUnitFiles() {
  const entries = await readdir(path.join(root, "test", "unit"));
  return entries.filter((entry) => entry.endsWith(".test.mjs")).sort().map((entry) => path.join("test", "unit", entry));
}

function runUnitWithCoverage() {
  return new Promise(async (resolve) => {
    const files = await listUnitFiles();
    const child = spawn(process.execPath, ["--experimental-test-coverage", "--test", ...files], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, stdout, stderr, error }));
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function parseCoverage(text) {
  const files = new Map();
  const lines = text.split("\n");
  let inTable = false;
  for (const line of lines) {
    // Reporters prefix diagnostic lines with "ℹ" (spec) or "#" (TAP); strip either.
    const trimmed = line.trim().replace(/^(?:ℹ|#)\s*/, "");
    // Table header: "file | line % | branch % | funcs %"
    if (trimmed.includes("line %") && trimmed.includes("funcs %")) { inTable = true; continue; }
    if (!inTable) continue;
    if (trimmed.startsWith("all files")) break;
    // Split columns on "|": [path, line%, branch%, funcs%]
    if (!trimmed.includes("|")) continue;
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length < 4) continue;
    const fileName = parts[0];
    const linePercent = parseFloat(parts[1]);
    if (fileName && Number.isFinite(linePercent)) files.set(fileName, linePercent);
  }
  return files;
}

const result = await runUnitWithCoverage();
if (result.error) {
  console.error(`[coverage] Could not run the unit suite: ${result.error.message}`);
  process.exitCode = 1;
  throw result.error;
}
if (result.code !== 0) {
  console.error(result.stdout.slice(-4_000));
  console.error(result.stderr.slice(-4_000));
  console.error(`##[error][coverage] Unit suite failed (exit ${result.code}): ${result.stderr.trim().split("\n").slice(-4).join(" | ").slice(0, 600)}`);
  process.exitCode = 1;
  throw new Error("unit suite failed");
}

const coverage = parseCoverage(result.stdout + "\n" + result.stderr);
console.log(`[coverage] Parsed files: ${coverage.size} (stdout ${result.stdout.length} bytes, stderr ${result.stderr.length} bytes)`);
// The coverage table uses relative basenames (e.g. "math.js"); thresholds use full paths (e.g. "src/core/math.js").
// Matching: compare the threshold key's basename with the table basename.
const byBasename = new Map();
for (const [file, percent] of coverage) {
  const base = file.split(/[\\/]/).pop();
  byBasename.set(base, Math.max(byBasename.get(base) ?? 0, percent));
}
console.log("\n[coverage] Line coverage per module:");
let failures = 0;
let checked = 0;
for (const [file, minimum] of Object.entries(thresholds)) {
  const base = file.split("/").pop();
  const actual = byBasename.get(base) ?? 0;
  checked += 1;
  const ok = actual >= minimum;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${file.padEnd(34)} %${String(actual).padStart(6)}  (threshold %${minimum})`);
}
console.log(`\n[coverage] ${checked - failures}/${checked} modules meet their threshold.`);
if (failures > 0) {
  console.error(`[coverage] ${failures} module(s) below their threshold.`);
  process.exitCode = 1;
} else {
  console.log("[coverage] All thresholds met.");
}
