// ExiEngine test orchestration — her test dosyasını sıralı ama bağımsız çalıştırır.
// Bir test başarısız olursa sonrakiler yine de koşar; tümü bitince özet raporlanır.
// Henüz var olmayan aşamalar (unit, typecheck) SKIP olarak raporlanır; dosya oluşturulunca otomatik aktifleşir.
// Bağımlılık yoktur: yalnızca Node built-in'leri.
import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Sıra önemli (engine-smoke en son; mcp-smoke child process bırakabilir).
// Her dosya kendi içinde tamamlanır; birinin başarısızlığı diğerlerini durdurmaz.
const stages = [
  { name: "static", file: "test/static-smoke.mjs", command: ["node", "test/static-smoke.mjs"] },
  { name: "server", file: "test/server-smoke.mjs", command: ["node", "test/server-smoke.mjs"] },
  { name: "doctor", file: "test/doctor.mjs", command: ["node", "test/doctor.mjs"] },
  { name: "clients", file: "test/client-config-smoke.mjs", command: ["node", "test/client-config-smoke.mjs"] },
  { name: "mcp", file: "test/mcp-smoke.mjs", command: ["node", "test/mcp-smoke.mjs"] },
  { name: "engine", file: "test/engine-smoke.mjs", command: ["node", "test/engine-smoke.mjs"] },
  { name: "unit", file: "test/unit/", command: ["node", "--test", "test/unit/*.test.mjs"], minFiles: [".test.mjs"] },
  { name: "typecheck", file: "test/typecheck-syntax.mjs", command: ["node", "test/typecheck-syntax.mjs"] },
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

console.log("\n[run-all] Özet:");
let failed = 0;
for (const result of results) {
  const { stage, code, signal, error, skipped, stderr } = result;
  if (skipped) {
    console.log(`  ${stage.name.padEnd(10)} SKIP (dosya yok: ${stage.file})`);
    continue;
  }
  const ok = code === 0;
  if (!ok) failed += 1;
  const status = ok ? "GEÇTİ" : `BAŞARISIZ (${signal || `exit ${code}`}${error ? `: ${error.message}` : ""})`;
  console.log(`  ${stage.name.padEnd(10)} ${status}`);
  if (!ok) {
    // GitHub Actions annotation'larına düşer (oturumsuz API'den okunabilir)
    const detail = (stderr || "").trim().split("\n").slice(-6).join(" | ");
    console.error(`##[error][run-all] ${stage.name} başarısız: exit ${code}${signal ? ` (${signal})` : ""}${error ? ` — ${error.message}` : ""}${detail ? ` — stderr: ${detail.slice(0, 600)}` : ""}`);
  }
}

if (failed > 0) {
  console.error(`\n[run-all] ${failed} aşama başarısız.`);
  process.exitCode = 1;
} else {
  console.log("\n[run-all] Tüm aşamalar geçti.");
}
