import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

async function getFreePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  probe.close();
  await once(probe, "close");
  return port;
}

const port = await getFreePort();
const child = spawn(process.execPath, [path.join(root, "server.mjs"), "--port", String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr += chunk; });

try {
  await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => { throw new Error(`server exited: ${stderr}`); }),
  ]);

  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/index.html`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(await response.text(), /ExiEngine/);

  const head = await fetch(`${base}/index.html`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const method = await fetch(`${base}/index.html`, { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET, HEAD");

  const missing = await fetch(`${base}/does-not-exist`);
  assert.equal(missing.status, 404);

  const hidden = await fetch(`${base}/.mcp.json`);
  assert.equal(hidden.status, 404);

  const unsupported = await fetch(`${base}/AGENTS.md`);
  assert.equal(unsupported.status, 404);

  const traversal = await fetch(`${base}/%2e%2e%2fpackage.json`);
  assert.equal(traversal.status, 400);

  const runtimeToken = await fetch(`${base}/__exi/runtime-token`);
  assert.equal(runtimeToken.status, 404);
  assert.equal((await fetch(`${base}/__exi/runtime-command`)).status, 404);
  assert.equal((await fetch(`${base}/__exi/runtime-result?id=r1`)).status, 404);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, "exit").catch(() => {});
}

console.log("ExiEngine server smoke: passed");
