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

  const module = await fetch(`${base}/test/hardware-soak.mjs`);
  assert.equal(module.status, 200);
  assert.match(module.headers.get("content-type") || "", /^text\/javascript/);

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

const runtimePort = await getFreePort();
const runtimeChild = spawn(process.execPath, [path.join(root, "server.mjs"), "--port", String(runtimePort)], {
  cwd: root,
  env: {
    ...process.env,
    EXI_RUNTIME_TOKEN: "runtime-smoke-token",
    EXI_RUNTIME_STATE_TTL_MS: "150",
    EXI_RUNTIME_COMMAND_LEASE_MS: "150",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let runtimeStderr = "";
runtimeChild.stderr.setEncoding("utf8");
runtimeChild.stderr.on("data", (chunk) => { runtimeStderr += chunk; });

try {
  await Promise.race([
    once(runtimeChild.stdout, "data"),
    once(runtimeChild, "exit").then(() => { throw new Error(`runtime server exited: ${runtimeStderr}`); }),
  ]);
  const runtimeBase = `http://127.0.0.1:${runtimePort}`;
  const tokenHeaders = { "x-exi-runtime-token": "runtime-smoke-token" };
  const commandURL = `${runtimeBase}/__exi/runtime-command`;
  const resultURL = `${runtimeBase}/__exi/runtime-result`;
  assert.equal((await fetch(`${runtimeBase}/__exi/runtime`)).status, 403);
  assert.equal((await fetch(`${runtimeBase}/__exi/runtime`, { headers: tokenHeaders })).status, 404);
  const telemetryPost = await fetch(`${runtimeBase}/__exi/runtime`, {
    method: "POST",
    headers: { ...tokenHeaders, "content-type": "application/json" },
    body: JSON.stringify({ ready: true, status: "running", event: "smoke", backend: "webgl2", fps: 60, draws: 1, nodes: 2 }),
  });
  assert.equal(telemetryPost.status, 204);
  const telemetry = await fetch(`${runtimeBase}/__exi/runtime`, { headers: tokenHeaders });
  assert.equal(telemetry.status, 200);
  assert.equal((await telemetry.json()).backend, "webgl2");
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal((await fetch(`${runtimeBase}/__exi/runtime`, { headers: tokenHeaders })).status, 404);

  const command = { id: "r1", operation: "function", name: "clamp", args: [1, 0, 2] };
  const commandPost = await fetch(commandURL, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: JSON.stringify(command) });
  assert.equal(commandPost.status, 202);
  let commands = await (await fetch(commandURL, { headers: tokenHeaders })).json();
  assert.deepEqual(commands.commands, [command]);
  commands = await (await fetch(commandURL, { headers: tokenHeaders })).json();
  assert.deepEqual(commands.commands, []);
  await new Promise((resolve) => setTimeout(resolve, 220));
  commands = await (await fetch(commandURL, { headers: tokenHeaders })).json();
  assert.deepEqual(commands.commands, [command]);

  const resultPost = await fetch(resultURL, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: JSON.stringify({ id: "r1", ok: true, value: 1 }) });
  assert.equal(resultPost.status, 204);
  const duplicateCommand = await fetch(commandURL, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: JSON.stringify({ id: "r1", operation: "function", name: "clamp", args: [] }) });
  assert.equal(duplicateCommand.status, 400);
  const result = await fetch(`${resultURL}?id=r1`, { headers: tokenHeaders });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { id: "r1", ok: true, value: 1 });
  assert.equal((await fetch(`${resultURL}?id=r1`, { headers: tokenHeaders })).status, 404);

  assert.equal((await fetch(commandURL, { method: "POST", headers: { ...tokenHeaders, "content-type": "application/json" }, body: JSON.stringify({ id: "r2", operation: "function", name: "clamp", args: [] }) })).status, 202);
  commands = await (await fetch(commandURL, { headers: tokenHeaders })).json();
  assert.equal(commands.commands.length, 1);
  assert.equal((await fetch(`${commandURL}?id=r2`, { method: "DELETE", headers: tokenHeaders })).status, 204);
  await new Promise((resolve) => setTimeout(resolve, 220));
  commands = await (await fetch(commandURL, { headers: tokenHeaders })).json();
  assert.deepEqual(commands.commands, []);
  assert.equal((await fetch(commandURL, { headers: { "x-exi-runtime-token": "wrong" } })).status, 403);
} finally {
  runtimeChild.kill();
  if (runtimeChild.exitCode === null) await once(runtimeChild, "exit").catch(() => {});
}

console.log("ExiEngine server smoke: passed");
