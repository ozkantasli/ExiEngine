// ExiEngine browser e2e — demo render + telemetry verification in real Chromium.
// Playwright is NOT added as a repo dependency: `@playwright/test` is installed into a temporary folder.
// This test closes the gap in the "green Node ≠ browser/GPU evidence" contract:
// WebGL2/WebGPU canvas rendering + #exi-runtime telemetry are verified in real Chrome.
//
// Usage:
//   node test/e2e/browser-e2e.mjs            # starts the server, runs the spec with playwright test
// Chromium install (a separate step in CI):
//   npx -y playwright@latest install chromium --with-deps
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 4175;
const baseUrl = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ["server.mjs", "--port", String(PORT)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
let serverStderr = "";
server.stderr.on("data", (chunk) => { serverStderr += chunk; });
let mcp = null;
let scaffoldRelative = null;

async function waitForServer(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) return;
    } catch { /* not ready yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`server did not become ready. stderr: ${serverStderr.slice(0, 500)}`);
}

function runCommand(executable, args, workDir) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: workDir, stdio: ["inherit", "pipe", "pipe"], shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => resolve({ ok: false, output: `${error.message}\n${output}` }));
    child.once("exit", (code) => resolve({ ok: code === 0, output }));
  });
}

function startMcp() {
  const child = spawn(process.execPath, ["tools/exi-mcp-server.mjs"], { cwd: root, env: { ...process.env, EXI_MCP_ROOT: root }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    }
  });
  child.once("error", (error) => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); } pending.clear(); });
  child.once("exit", (code) => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`MCP bridge exited: ${code}; ${stderr.slice(0, 500)}`)); } pending.clear(); });
  return {
    child,
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timeout: ${method}`)); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    stop() { child.kill(); },
  };
}

function mcpToolResult(response) {
  if (response.error) throw new Error(response.error.message || "MCP JSON-RPC error");
  if (response.result?.isError) throw new Error(response.result.content?.[0]?.text || "MCP tool error");
  const text = response.result?.content?.find((entry) => entry.type === "text")?.text;
  return text === undefined ? response.result : JSON.parse(text);
}

async function scaffoldForBrowser(relativeDirectory) {
  mcp = startMcp();
  await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "exi-browser-e2e", version: "1" } });
  mcp.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  const result = mcpToolResult(await mcp.request("tools/call", { name: "exi_scaffold", arguments: { directory: relativeDirectory } }));
  const checked = mcpToolResult(await mcp.request("tools/call", { name: "exi_project_check", arguments: { path: relativeDirectory } }));
  if (!checked.ok) throw new Error(`Scaffold project check failed: ${JSON.stringify(checked)}`);
  return result.directory;
}

async function runPlaywright(workDir) {
  const windows = process.platform === "win32";
  const npm = windows ? (process.env.ComSpec || "cmd.exe") : "npm";
  const installArgs = windows
    ? ["/d", "/s", "/c", "npm install --no-save --no-package-lock --ignore-scripts @playwright/test@latest"]
    : ["install", "--no-save", "--no-package-lock", "--ignore-scripts", "@playwright/test@latest"];
  const install = await runCommand(npm, installArgs, workDir);
  if (!install.ok) return install;
  const cliPath = path.join(workDir, "node_modules", "@playwright", "test", "cli.js");
  const runner = await runCommand(process.execPath, [cliPath, "test", "--reporter=line"], workDir);
  return { ...runner, output: `${install.output}${runner.output}` };
}

let failures = 0;
try {
  await waitForServer();
  console.log(`[browser-e2e] Server ready: ${baseUrl}`);
  scaffoldRelative = `browser-e2e-scaffold-${process.pid}-${Date.now()}`;
  scaffoldRelative = await scaffoldForBrowser(scaffoldRelative);
  console.log(`[browser-e2e] MCP scaffold ready: ${scaffoldRelative}`);

  const workDir = await mkdtemp(path.join(tmpdir(), "exi-browser-e2e-"));
  const specPath = path.join(workDir, "browser-e2e.spec.mjs");
  await writeFile(specPath, `
import { test, expect, chromium } from "@playwright/test";

const baseUrl = ${JSON.stringify(baseUrl)};
const scaffoldUrl = baseUrl + "/" + ${JSON.stringify(scaffoldRelative)} + "/index.html";
const backends = (process.env.EXI_PLAYWRIGHT_BACKENDS || "webgpu,webgl2")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (backends.length === 0) throw new Error("EXI_PLAYWRIGHT_BACKENDS must list at least one backend.");
const requestedSoakSeconds = Number.parseInt(process.env.EXI_PLAYWRIGHT_SECONDS || "1", 10);
const soakSecondsForTimeout = Number.isSafeInteger(requestedSoakSeconds) && requestedSoakSeconds > 0
  ? Math.min(600, requestedSoakSeconds)
  : 1;

test("demo render + WebGPU/WebGL2 hardware soak", async () => {
  test.setTimeout((soakSecondsForTimeout * backends.length + 30) * 1_000);
  const launchOptions = { args: ["--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist"] };
  if (process.env.EXI_PLAYWRIGHT_CHANNEL) launchOptions.channel = process.env.EXI_PLAYWRIGHT_CHANNEL;
  if (process.env.EXI_PLAYWRIGHT_EXECUTABLE) launchOptions.executablePath = process.env.EXI_PLAYWRIGHT_EXECUTABLE;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });

  let telemetry = null;
  let readyAt = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    telemetry = await page.evaluate(() => {
      const node = document.querySelector("#exi-runtime");
      if (!node) return null;
      return {
        ready: node.dataset.ready,
        status: node.dataset.status,
        backend: node.dataset.backend,
        fps: node.dataset.fps,
        errors: node.dataset.errors,
      };
    });
    if (telemetry && telemetry.ready === "true" && (telemetry.status === "running" || telemetry.status === "stopped")) {
      readyAt ||= Date.now();
      if (Date.now() - readyAt >= 2_000 && Number(telemetry.fps || 0) > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  expect(telemetry, "demo telemetry must be ready: " + JSON.stringify(telemetry)).not.toBeNull();
  expect(telemetry.ready).toBe("true");
  expect(["webgpu", "webgl2"]).toContain(telemetry.backend);
  const fps = Number(telemetry.fps || 0);
  expect(Number.isFinite(fps) && fps > 0, "expected a positive fps, got: " + telemetry.fps).toBe(true);
  if (telemetry.errors && telemetry.errors !== "0" && telemetry.errors !== "") {
    throw new Error("console errors: " + telemetry.errors);
  }
  console.log("OK: demo rendered backend=" + telemetry.backend + " fps=" + telemetry.fps);

  const beforeSnapshot = await page.evaluate(() => window.game.runtimeAgent.execute({ operation: "snapshot", handle: "scene", args: [{ limit: 64 }] }));
  const beforeCursor = beforeSnapshot.nodes.find((node) => node.type === "AnimatedSprite");
  expect(beforeCursor, "demo AnimatedSprite must appear in the snapshot").not.toBeUndefined();
  const movementScenario = await page.evaluate(() => window.game.runtimeAgent.execute({
    operation: "scenario",
    handle: "engine",
    args: [{
      frames: [
        { input: [{ type: "keydown", code: "ArrowRight" }] },
        {}, {}, {}, {}, {},
        { input: [{ type: "keyup", code: "ArrowRight" }] },
      ],
      resume: true,
    }],
  }));
  expect(movementScenario.frameCount).toBe(7);
  const afterSnapshot = await page.evaluate(() => window.game.runtimeAgent.execute({ operation: "snapshot", handle: "scene", args: [{ limit: 64 }] }));
  const afterCursor = afterSnapshot.nodes.find((node) => node.type === "AnimatedSprite");
  expect(afterCursor.x).toBeGreaterThan(beforeCursor.x);
  console.log("OK: RuntimeAgent scenario input moved x=" + beforeCursor.x + "→" + afterCursor.x);

  await page.goto(scaffoldUrl, { waitUntil: "domcontentloaded" });
  let scaffoldTelemetry = null;
  const scaffoldDeadline = Date.now() + 30_000;
  while (Date.now() < scaffoldDeadline) {
    scaffoldTelemetry = await page.evaluate(() => {
      const node = document.querySelector("#exi-runtime");
      return node ? { ready: node.dataset.ready, status: node.dataset.status, backend: node.dataset.backend, fps: node.dataset.fps } : null;
    });
    if (scaffoldTelemetry?.ready === "true" && Number(scaffoldTelemetry.fps || 0) > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(scaffoldTelemetry?.ready).toBe("true");
  expect(Number(scaffoldTelemetry?.fps || 0)).toBeGreaterThan(0);
  const scaffoldBefore = await page.evaluate(() => window.game.runtimeAgent.execute({ operation: "snapshot", handle: "scene", args: [{ limit: 8 }] }));
  const scaffoldPlayerBefore = scaffoldBefore.nodes.find((node) => node.type === "Graphics");
  expect(scaffoldPlayerBefore, "scaffold player must appear in the snapshot").not.toBeUndefined();
  await page.evaluate(() => window.game.runtimeAgent.execute({ operation: "scenario", handle: "engine", args: [{ frames: [{ input: [{ type: "keydown", code: "ArrowRight" }] }, {}, {}, {}, {}, { input: [{ type: "keyup", code: "ArrowRight" }] }] }] }));
  const scaffoldAfter = await page.evaluate(() => window.game.runtimeAgent.execute({ operation: "snapshot", handle: "scene", args: [{ limit: 8 }] }));
  const scaffoldPlayerAfter = scaffoldAfter.nodes.find((node) => node.type === "Graphics");
  expect(scaffoldPlayerAfter.x).toBeGreaterThan(scaffoldPlayerBefore.x);
  console.log("OK: MCP scaffold browser game moved x=" + scaffoldPlayerBefore.x + "→" + scaffoldPlayerAfter.x);

  const soakSeconds = process.env.EXI_PLAYWRIGHT_SECONDS || "1";
  const soakSprites = process.env.EXI_PLAYWRIGHT_SPRITES || "200";
  for (const backend of backends) {
    consoleErrors.length = 0;
    await page.goto(baseUrl + "/test/hardware-soak.html", { waitUntil: "domcontentloaded" });
    await page.selectOption("#renderer", backend);
    await page.fill("#sprites", soakSprites);
    await page.fill("#seconds", soakSeconds);
    await page.locator("#start").click();
    await expect.poll(async () => page.locator("#output").textContent(), { timeout: soakSecondsForTimeout * 1_000 + 15_000 })
      .toContain('"result": "passed"');
    const soak = JSON.parse(await page.locator("#output").textContent());
    expect(soak.result).toBe("passed");
    expect(soak.backend).toBe(backend);
    expect(soak.frames).toBeGreaterThan(0);
    expect(soak.offscreenRenderFrames).toBeGreaterThan(0);
    expect(soak.deviceErrorObserved).toBe(false);
    if (consoleErrors.length > 0) {
      throw new Error(backend + " hardware-soak console hatalari: " + consoleErrors.slice(0, 10).join(" | "));
    }
    console.log("OK: hardware-soak ran backend=" + soak.backend + " frames=" + soak.frames);
  }
  await browser.close();
});
`, "utf8");

  const result = await runPlaywright(workDir);
  console.log(result.output.trim().split("\n").slice(-20).join("\n"));
  if (!result.ok) {
    failures += 1;
    console.error("[browser-e2e] Playwright test failed.");
  }
  await rm(workDir, { recursive: true, force: true });
} catch (error) {
  failures += 1;
  console.error(`[browser-e2e] ERROR: ${error.message}`);
} finally {
  if (mcp) {
    try { mcpToolResult(await mcp.request("tools/call", { name: "exi_session_reset", arguments: {} })); } catch { /* cleanup best effort */ }
    mcp.stop();
  }
  if (scaffoldRelative) await rm(path.join(root, scaffoldRelative), { recursive: true, force: true });
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
}

if (failures > 0) {
  console.error(`[browser-e2e] ${failures} check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("[browser-e2e] All checks passed.");
}
