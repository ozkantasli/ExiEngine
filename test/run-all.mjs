// ExiEngine test orchestration — runs every test file in order but independently.
// If a test fails the following ones still run; a summary is reported at the end.
// Stages that do not exist yet are reported as SKIP; they activate once their file exists.
// No dependencies: Node built-ins only.
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Order matters (mcp-smoke may leave a child process behind).
// Each file completes on its own; one failing does not stop the others.
const stages = [
  { name: "static", file: "test/static-smoke.mjs", command: ["node", "test/static-smoke.mjs"] },
  { name: "server", file: "test/server-smoke.mjs", command: ["node", "test/server-smoke.mjs"] },
  { name: "doctor", file: "test/doctor.mjs", command: ["node", "test/doctor.mjs"] },
  { name: "clients", file: "test/client-config-smoke.mjs", command: ["node", "test/client-config-smoke.mjs"] },
  { name: "mcp", file: "test/mcp-smoke.mjs", command: ["node", "test/mcp-smoke.mjs"] },
  { name: "engine", file: "test/engine-smoke.mjs", command: ["node", "test/engine-smoke.mjs"] },
  { name: "unit", file: "test/unit/", command: ["node", "--test", "test/unit/*.test.mjs"], minFiles: [".test.mjs"] },
  { name: "typecheck", file: "test/typecheck-syntax.mjs", command: ["node", "test/typecheck-syntax.mjs"] },
  { name: "build", file: "test/build-smoke.mjs", command: ["node", "test/build-smoke.mjs"] },
  { name: "examples", file: "test/examples-smoke.mjs", command: ["node", "test/examples-smoke.mjs"] },
];

async function exists(relativePath, minFiles) {
  try {
    const info = await stat(path.join(root, relativePath));
    if (!info.isDirectory()) return true;
    if (!minFiles) return true;
    const entries = await readdir(path.join(root, relativePath));
    return entries.some((entry) => minFiles.some((suffix) => entry.endsWith(suffix)));
  } catch {
    return false;
  }
}

async function listUnitFiles() {
  const entries = await readdir(path.join(root, "test", "unit"));
  return entries.filter((entry) => entry.endsWith(".test.mjs")).sort().map((entry) => `test/unit/${entry}`);
}

async function buildStageCommand(stage) {
  if (stage.name !== "unit") return stage.command;
  const files = await listUnitFiles();
  if (files.length === 0) return null;
  return ["node", "--test", ...files];
}

function runStage(stage, command) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command.slice(1), { cwd: root, stdio: ["inherit", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ stage, code: 1, error, stderr }));
    child.once("exit", (code, signal) => resolve({ stage, code: code ?? 1, signal, stderr }));
  });
}

const results = [];
for (const stage of stages) {
  if (!(await exists(stage.file, stage.minFiles))) {
    results.push({ stage, code: null, skipped: true });
    continue;
  }
  const command = await buildStageCommand(stage);
  if (command === null) {
    results.push({ stage, code: null, skipped: true });
    continue;
  }
  results.push(await runStage(stage, command));
}

console.log("\n[run-all] Summary:");
let failed = 0;
for (const result of results) {
  const { stage, code, signal, error, skipped, stderr } = result;
  if (skipped) {
    console.log(`  ${stage.name.padEnd(10)} SKIP (missing file: ${stage.file})`);
    continue;
  }
  const ok = code === 0;
  if (!ok) failed += 1;
  const status = ok ? "PASSED" : `FAILED (${signal || `exit ${code}`}${error ? `: ${error.message}` : ""})`;
  console.log(`  ${stage.name.padEnd(10)} ${status}`);
  if (!ok) {
    // Ends up in GitHub Actions annotations (readable through the unauthenticated API)
    const detail = (stderr || "").trim().split("\n").slice(-6).join(" | ");
    console.error(`##[error][run-all] ${stage.name} failed: exit ${code}${signal ? ` (${signal})` : ""}${error ? ` — ${error.message}` : ""}${detail ? ` — stderr: ${detail.slice(0, 600)}` : ""}`);
  }
}

if (failed > 0) {
  console.error(`\n[run-all] ${failed} stage(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\n[run-all] All stages passed.");
}
