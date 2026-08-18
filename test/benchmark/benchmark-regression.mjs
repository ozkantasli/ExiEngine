// ExiEngine benchmark regresyon eşiği
// 25 benchmark'ı sırayla çalıştırır, JSON çıktılarını yakalar, baseline ile karşılaştırır.
// - İlk koşu: test/benchmark/benchmark-baseline.json oluşturur (baseline modu).
// - Sonraki koşular: elapsedMs drift'ini (+%50 tolerans) ve simulatedFramesPerSecond
//   düşüşünü (-%40) kontrol eder. Bu bir FPS iddiası değil, belirgin regresyon kapısıdır.
// Mevcut 25 benchmark dosyası DEĞİŞMEZ (kontrat: benchmark silme/yumuşatma yok).
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const baselinePath = path.join(root, "test", "benchmark", "benchmark-baseline.json");
const allowedElapsedDrift = 0.5; // +%50 elapsed süresi
const allowedFpsDrop = 0.4; // -%40 simulated FPS

const benchmarks = [
  "gpu-streaming", "cpu-instanced", "regular-streaming", "spatial-culling", "sprite-culling",
  "graphics-culling", "graphics-streaming", "sprite-streaming", "subtree-culling", "transform-streaming",
  "text-streaming", "glyph-atlas", "particle-streaming", "particle-cpu-streaming", "particle-culling",
  "particle-gpu-culling", "input-streaming", "pointer-dispatch", "tilemap-streaming",
  "tilemap-regular-streaming", "queue-streaming", "frame-scratch", "animation-streaming",
  "collision-query", "physics-streaming",
];

function runBenchmark(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "test", `${name}-benchmark.mjs`)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ name, code: 1, error: error.message }));
    child.once("exit", (code) => resolve({ name, code: code ?? 1, stdout, stderr }));
  });
}

function parseResult(name, stdout) {
  try {
    // Benchmark çıktısı tek JSON nesnesidir; sondaki boşlukları temizleyip tümünü dener,
    // başarısızsa son satırı dener (bazı benchmark'lar log satırı ekleyebilir).
    const trimmed = stdout.trim();
    const candidates = [trimmed, trimmed.split("\n").filter(Boolean).pop()];
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        return { elapsedMs: Number(parsed.elapsedMs), simulatedFramesPerSecond: Number(parsed.simulatedFramesPerSecond) };
      } catch { /* sonraki aday */ }
    }
    return { elapsedMs: NaN, simulatedFramesPerSecond: NaN };
  } catch {
    return { elapsedMs: NaN, simulatedFramesPerSecond: NaN };
  }
}

let baseline = null;
try {
  baseline = JSON.parse(await readFile(baselinePath, "utf8"));
} catch {
  baseline = null;
}

const results = {};
let failures = 0;
for (const name of benchmarks) {
  const result = await runBenchmark(name);
  if (result.code !== 0) {
    failures += 1;
    console.error(`  FAIL ${name}: benchmark exit ${result.code}${result.error ? ` (${result.error})` : ""}${result.stderr ? ` — ${result.stderr.slice(0, 200)}` : ""}`);
    continue;
  }
  const parsed = parseResult(name, result.stdout);
  results[name] = parsed;
  const previous = baseline?.[name];
  if (previous && Number.isFinite(previous.elapsedMs)) {
    const elapsedDrift = (parsed.elapsedMs - previous.elapsedMs) / previous.elapsedMs;
    const fpsDrop = previous.simulatedFramesPerSecond > 0
      ? (previous.simulatedFramesPerSecond - parsed.simulatedFramesPerSecond) / previous.simulatedFramesPerSecond
      : 0;
    const ok = elapsedDrift <= allowedElapsedDrift && fpsDrop <= allowedFpsDrop;
    if (!ok) failures += 1;
    console.log(`  ${ok ? "OK  " : "FAIL"} ${name.padEnd(24)} elapsed %${(elapsedDrift * 100).toFixed(1)}  fps %${(-fpsDrop * 100).toFixed(1)}`);
  } else {
    console.log(`  BASE ${name.padEnd(24)} elapsed ${parsed.elapsedMs}ms  fps ${parsed.simulatedFramesPerSecond}`);
  }
}

if (!baseline) {
  await mkdir(path.dirname(baselinePath), { recursive: true });
  await writeFile(baselinePath, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`\n[benchmark] Baseline oluşturuldu: ${path.relative(root, baselinePath)}`);
} else if (failures > 0) {
  console.error(`\n[benchmark] ${failures} benchmark regresyon eşiğini aştı.`);
  process.exitCode = 1;
} else {
  console.log("\n[benchmark] Tüm benchmark'lar baseline içinde.");
}
