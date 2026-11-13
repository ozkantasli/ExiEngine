// ExiEngine preview e2e — starts the loopback server and verifies HTTP 200 + security headers.
// Runs in CI (preview-e2e job) and locally. No dependencies.
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
    } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server was not ready within ${timeoutMs}ms. stderr: ${stderr.slice(0, 500)}`);
}

let failures = 0;
try {
  await waitForServer();
  console.log(`[preview-e2e] Server ready: ${baseUrl}`);

  const home = await fetch(baseUrl + "/");
  if (!home.ok) throw new Error(`GET / → ${home.status}`);
  const html = await home.text();
  if (!html.includes("exi-runtime")) throw new Error("index.html does not contain 'exi-runtime'");
  console.log("[preview-e2e] GET / → 200, exi-runtime present");

  const headers = await fetch(baseUrl + "/", { method: "HEAD" });
  for (const name of ["content-security-policy", "x-content-type-options", "cross-origin-resource-policy", "referrer-policy", "x-frame-options"]) {
    if (!headers.headers.has(name)) {
      failures += 1;
      console.error(`  FAIL ${name} header missing`);
    }
  }
  console.log("[preview-e2e] Security headers verified");

  const notFound = await fetch(baseUrl + "/missing-xyz.html");
  if (notFound.status !== 404) {
    failures += 1;
    console.error(`  FAIL missing file → ${notFound.status} (expected 404)`);
  }
  console.log("[preview-e2e] 404 behavior verified");
} catch (error) {
  failures += 1;
  console.error(`[preview-e2e] ERROR: ${error.message}`);
} finally {
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (failures > 0) {
  console.error(`[preview-e2e] ${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("[preview-e2e] passed");
}
