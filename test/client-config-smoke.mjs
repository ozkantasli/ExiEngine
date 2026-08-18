import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJSON(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

const cursor = await readJSON(".cursor/mcp.json");
assert.deepEqual(cursor.mcpServers?.["exi-engine"], {
  command: "node",
  args: ["tools/exi-mcp-server.mjs"],
  env: { EXI_MCP_ROOT: "." },
});

const cline = await readJSON(".cline/mcp.json");
assert.deepEqual(cline.mcpServers?.["exi-engine"], {
  command: "node",
  args: ["tools/exi-mcp-server.mjs"],
  env: { EXI_MCP_ROOT: "." },
});

const claude = await readJSON(".mcp.json");
assert.deepEqual(claude.mcpServers?.["exi-engine"], {
  type: "stdio",
  command: "node",
  args: ["${CLAUDE_PROJECT_DIR:-.}/tools/exi-mcp-server.mjs"],
  env: { EXI_MCP_ROOT: "${CLAUDE_PROJECT_DIR:-.}" },
  timeout: 360000,
});

const openCode = await readJSON("opencode.json");
assert.deepEqual(openCode.mcp?.servers?.["exi-engine"], {
  type: "local",
  command: ["node", "tools/exi-mcp-server.mjs"],
  cwd: ".",
  codemode: false,
  timeout: 360000,
});

const gemini = await readJSON(".gemini/settings.json");
assert.deepEqual(gemini.mcpServers?.["exi-engine"], {
  command: "node",
  args: ["tools/exi-mcp-server.mjs"],
  cwd: ".",
  env: { EXI_MCP_ROOT: "." },
  timeout: 360000,
});

const codex = await readFile(path.join(root, ".codex/config.toml"), "utf8");
assert.match(codex, /^\[mcp_servers\.exi-engine\]$/m);
assert.match(codex, /^command = "node"$/m);
assert.match(codex, /^args = \["tools\/exi-mcp-server\.mjs"\]$/m);
assert.match(codex, /^cwd = "\."$/m);
assert.match(codex, /^enabled = true$/m);
assert.match(codex, /^required = false$/m);
assert.match(codex, /^startup_timeout_sec = 20$/m);
assert.match(codex, /^tool_timeout_sec = 360$/m);
assert.match(codex, /^default_tools_approval_mode = "writes"$/m);
assert.equal(openCode.mcp?.timeout, undefined);

for (const relativePath of [".cursor/mcp.json", ".cline/mcp.json", ".mcp.json", "opencode.json", ".gemini/settings.json", ".codex/config.toml"]) {
  const content = await readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(content, /(?:api[_-]?key|secret|token|password)\s*[:=]/i, `${relativePath} secret içermemeli`);
  assert.doesNotMatch(content, /(?:^|[\\/])(?:\.env|credentials|id_rsa|.*\.(?:pem|key|p12|pfx))(?=$|[\\/"])/i, `${relativePath} credential yolu içermemeli`);
}

function runBridge({ command, args, cwd, env }) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";
  let stdout = "";
  let exited = false;
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch (error) { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); continue; }
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      waiter.resolve(message);
    }
    stdout = stdout.split(/\r?\n/).at(-1) || "";
  });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8 * 1024); });
  child.once("error", (error) => { exited = true; for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
  child.once("exit", () => { exited = true; });
  const request = (method, params = {}) => {
    if (exited) return Promise.reject(new Error("MCP bridge exited."));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP client config request timeout: ${method}`)); }, 5_000);
      pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  return { child, request, getStderr: () => stderr };
}

const clientLaunches = {
  cursor: { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: root, env: { EXI_MCP_ROOT: root } },
  cline: { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: root, env: { EXI_MCP_ROOT: root } },
  codex: { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: root, env: { EXI_MCP_ROOT: root } },
  claude: { command: "node", args: [path.join(root, "tools", "exi-mcp-server.mjs")], cwd: root, env: { CLAUDE_PROJECT_DIR: root, EXI_MCP_ROOT: root } },
  opencode: { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: root, env: {} },
  gemini: { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: root, env: { EXI_MCP_ROOT: root } },
};

for (const [client, launch] of Object.entries(clientLaunches)) {
  const bridge = runBridge(launch);
  try {
    const modernMeta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: `${client}-config-smoke`, version: "1" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };
    const discovery = await bridge.request("server/discover", { _meta: modernMeta });
    assert.equal(discovery.result.resultType, "complete", `${client} modern discovery`);
    assert.ok(discovery.result.supportedVersions.includes("2026-07-28"), `${client} modern protocol`);
    const modernTools = await bridge.request("tools/list", { _meta: modernMeta });
    assert.equal(modernTools.result.resultType, "complete", `${client} modern tools`);
    const modernPrompt = await bridge.request("prompts/get", { _meta: modernMeta, name: "exi_create_game", arguments: { goal: `${client} compatibility game` } });
    assert.equal(modernPrompt.result.resultType, "complete", `${client} modern prompt`);
    assert.match(modernPrompt.result.messages[0].content.text, new RegExp(`${client} compatibility game`), `${client} modern prompt content`);
    const modernResource = await bridge.request("resources/read", { _meta: modernMeta, uri: "exi://clients" });
    assert.equal(modernResource.result.resultType, "complete", `${client} modern resource`);
    const modernFunctionCall = await bridge.request("tools/call", { _meta: modernMeta, name: "exi_function", arguments: { name: "clamp", args: [2, 0, 1] } });
    assert.equal(modernFunctionCall.result.resultType, "complete", `${client} modern tool call`);
    assert.equal(modernFunctionCall.result.structuredContent, 1, `${client} modern tool result`);
    const initialized = await bridge.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: `${client}-config-smoke`, version: "1" } });
    assert.equal(initialized.result.protocolVersion, "2025-11-25", `${client} initialize`);
    const tools = await bridge.request("tools/list");
    assert.ok(tools.result.tools.some((tool) => tool.name === "exi_preview_batch"), `${client} tool discovery`);
    const functionCall = await bridge.request("tools/call", { name: "exi_function", arguments: { name: "clamp", args: [2, 0, 1] } });
    const functionValue = functionCall.result.structuredContent?.value ?? functionCall.result.structuredContent;
    assert.equal(functionValue, 1, `${client} tool call`);
    assert.equal(bridge.getStderr(), "", `${client} MCP stderr temiz olmalı`);
  } finally {
    bridge.child.kill();
    await Promise.race([once(bridge.child, "exit"), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  }
}

async function findHostCli(name) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const child = spawn(locator, [name], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (chunk) => { output = `${output}${chunk.toString()}`.slice(0, 2 * 1024); });
  const [exitCode] = await new Promise((resolve) => {
    let settled = false;
    const finish = (code) => { if (settled) return; settled = true; resolve([code]); };
    child.once("error", () => finish(1));
    child.once("exit", (code) => finish(code));
  });
  const paths = output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  return { installed: exitCode === 0, path: paths.join("\n") || null, paths };
}

const hostCli = {};
const hostCommandNames = { cursor: "cursor-agent", cline: "cline", codex: "codex", claude: "claude", opencode: "opencode", gemini: "gemini" };
for (const name of Object.keys(clientLaunches)) hostCli[name] = await findHostCli(hostCommandNames[name] || name);

async function terminateProcessTree(child) {
  if (typeof child.pid !== "number") return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    const timer = setTimeout(finish, 1_000);
    killer.once("error", () => { clearTimeout(timer); finish(); });
    killer.once("exit", () => { clearTimeout(timer); finish(); });
  });
}

async function runNativeProbe(command, args) {
  let child;
  try {
    child = spawn(command, args, { cwd: root, env: { ...process.env, EXI_MCP_ROOT: root, CLAUDE_PROJECT_DIR: root }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  } catch (error) {
    const errorCode = error.code || null;
    const unavailable = process.platform === "win32" && ["EPERM", "EACCES"].includes(errorCode);
    return { status: unavailable ? "unavailable" : "spawn-error", command: [command, ...args].join(" "), exitCode: null, signal: null, reason: unavailable ? "host-executable-permission" : null, error: errorCode || error.message, stdout: "", stderr: "" };
  }
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk.toString()}`.slice(-8 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString()}`.slice(-8 * 1024); });
  const result = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; resolve(value); };
    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateProcessTree(child);
      finish({ exitCode: null, signal: "SIGTERM" });
    }, 5_000);
    child.once("error", (error) => { clearTimeout(timer); finish({ error: error.message, code: error.code || "SPAWN_ERROR" }); });
    child.once("exit", (exitCode, signal) => { clearTimeout(timer); finish({ exitCode, signal }); });
  });
  const output = `${stdout}\n${stderr}`;
  const unavailable = process.platform === "win32" && ["EPERM", "EACCES"].includes(result.code);
  return {
    status: timedOut ? "timeout" : unavailable ? "unavailable" : result.error ? "spawn-error" : result.exitCode === 0 && /exi-engine/i.test(output) ? "passed" : "failed",
    command: [command, ...args].join(" "),
    exitCode: result.exitCode ?? null,
    signal: result.signal || null,
    reason: unavailable ? "host-executable-permission" : null,
    error: result.error || null,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

const nativeMode = process.argv.includes("--native");
const nativeCommands = {
  cursor: ["cursor-agent", ["mcp", "list"]],
  codex: ["codex", ["mcp", "list"]],
  claude: ["claude", ["mcp", "list"]],
  opencode: ["opencode", ["mcp", "list"]],
  gemini: ["gemini", ["mcp", "list"]],
};
function resolvedNativeCommand(name, fallback) {
  const candidates = hostCli[name]?.paths || [];
  if (process.platform === "win32") return candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe")) || candidates[0] || fallback;
  return candidates[0] || fallback;
}
const nativeProbe = {};
for (const [name, [fallbackCommand, args]] of Object.entries(nativeCommands)) {
  const command = resolvedNativeCommand(name, fallbackCommand);
  if (!nativeMode) {
    nativeProbe[name] = { status: "not-run", command: [command, ...args].join(" ") };
  } else if (!hostCli[name].installed) {
    nativeProbe[name] = { status: "skipped", command: [command, ...args].join(" "), reason: "executable-not-found" };
  } else {
    nativeProbe[name] = await runNativeProbe(command, args);
  }
}

console.log(`ExiEngine client config + runtime smoke: passed (${Object.keys(clientLaunches).join(", ")}); hostCli=${JSON.stringify(hostCli)}; nativeProbe=${JSON.stringify(nativeProbe)}`);
if (nativeMode && Object.values(nativeProbe).some((probe) => ["failed", "spawn-error", "timeout"].includes(probe.status))) process.exitCode = 1;
