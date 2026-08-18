// ExiEngine coverage runner — unit suite'ini --experimental-test-coverage ile çalıştırır,
// her modülün line coverage'ını thresholds.mjs ile karşılaştırır, özet raporlar.
// Bağımlılık yoktur. Node 20 uyumluluğu için glob yerine dosya listesi kullanılır.
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
    const trimmed = line.trim();
    // Tablo başlığı: "ℹ file | line % | branch % | funcs %" (ℹ öneki olabilir)
    if (trimmed.includes("line %") && trimmed.includes("funcs %")) { inTable = true; continue; }
    if (!inTable) continue;
    if (trimmed.startsWith("all files")) break;
    // Sütunları "|" ayracıyla ayır: [path, line%, branch%, funcs%]
    if (!trimmed.includes("|")) continue;
    const parts = trimmed.split("|").map((part) => part.trim());
    if (parts.length < 4) continue;
    // Dosya adı "ℹ   asset-loader.js" formatında gelebilir; ℹ öneki ve boşlukları temizle
    const fileName = parts[0].replace(/^ℹ\s*/, "");
    const linePercent = parseFloat(parts[1]);
    if (fileName && Number.isFinite(linePercent)) files.set(fileName, linePercent);
  }
  return files;
}

const result = await runUnitWithCoverage();
if (result.error) {
  console.error(`[coverage] Unit suite çalıştırılamadı: ${result.error.message}`);
  process.exitCode = 1;
  throw result.error;
}
if (result.code !== 0) {
  console.error(result.stdout.slice(-4_000));
  console.error(`[coverage] Unit suite başarısız (exit ${result.code}).`);
  process.exitCode = 1;
  throw new Error("unit suite failed");
}

const coverage = parseCoverage(result.stdout + "\n" + result.stderr);
console.log(`[coverage] Parse edilen dosya sayısı: ${coverage.size} (stdout ${result.stdout.length} bayt, stderr ${result.stderr.length} bayt)`);
// Coverage tablosu göreli basename kullanır (ör. "math.js"); threshold'lar tam yol (ör. "src/core/math.js").
// Eşleştirme: threshold anahtarının basename'i ile tablo basename'ini karşılaştır.
const byBasename = new Map();
for (const [file, percent] of coverage) {
  const base = file.split(/[\\/]/).pop();
  byBasename.set(base, Math.max(byBasename.get(base) ?? 0, percent));
}
console.log("\n[coverage] Modül bazlı line coverage:");
let failures = 0;
let checked = 0;
for (const [file, minimum] of Object.entries(thresholds)) {
  const base = file.split("/").pop();
  const actual = byBasename.get(base) ?? 0;
  checked += 1;
  const ok = actual >= minimum;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "OK  " : "FAIL"} ${file.padEnd(34)} %${String(actual).padStart(6)}  (eşik %${minimum})`);
}
console.log(`\n[coverage] ${checked - failures}/${checked} modül eşik üzerinde.`);
if (failures > 0) {
  console.error(`[coverage] ${failures} modül eşiğin altında.`);
  process.exitCode = 1;
} else {
  console.log("[coverage] Tüm eşikler karşılandı.");
}
