// ExiEngine preview e2e — loopback server'ı başlatır, HTTP 200 + güvenlik başlıklarını doğrular.
// CI'da (preview-e2e job) ve yerelde çalışır. Bağımlılık yoktur.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4173;
const baseUrl = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ["server.mjs", "--port", String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
server.stderr.on("data", (chunk) => { stderr += chunk; });

async function waitForServer(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) return;
    } catch { /* henüz hazır değil */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server ${timeoutMs}ms içinde hazır olmadı. stderr: ${stderr.slice(0, 500)}`);
}

let failures = 0;
try {
  await waitForServer();
  console.log(`[preview-e2e] Server hazır: ${baseUrl}`);

  const home = await fetch(baseUrl + "/");
  if (!home.ok) throw new Error(`GET / → ${home.status}`);
  const html = await home.text();
  if (!html.includes("exi-runtime")) throw new Error("index.html 'exi-runtime' içermiyor");
  console.log("[preview-e2e] GET / → 200, exi-runtime mevcut");

  const headers = await fetch(baseUrl + "/", { method: "HEAD" });
  for (const name of ["content-security-policy", "x-content-type-options", "cross-origin-resource-policy", "referrer-policy", "x-frame-options"]) {
    if (!headers.headers.has(name)) {
      failures += 1;
      console.error(`  FAIL ${name} başlığı eksik`);
    }
  }
  console.log("[preview-e2e] Güvenlik başlıkları doğrulandı");

  const notFound = await fetch(baseUrl + "/missing-xyz.html");
  if (notFound.status !== 404) {
    failures += 1;
    console.error(`  FAIL eksik dosya → ${notFound.status} (404 bekleniyor)`);
  }
  console.log("[preview-e2e] 404 davranışı doğrulandı");
} catch (error) {
  failures += 1;
  console.error(`[preview-e2e] HATA: ${error.message}`);
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (failures > 0) {
  console.error(`[preview-e2e] ${failures} kontrol başarısız.`);
  process.exitCode = 1;
} else {
  console.log("[preview-e2e] passed");
}
