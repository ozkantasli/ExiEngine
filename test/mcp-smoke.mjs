import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as engineExports from "../src/index.js";
import { createCanvasObserver, createEngineObserver, RuntimeAgent } from "../src/ai/runtime-agent.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "tools", "exi-mcp-server.mjs");
const scaffoldRelative = `mcp-smoke-${process.pid}-${Date.now()}`;
const scaffoldPath = path.join(root, scaffoldRelative);
const modernRelative = `${scaffoldRelative}-modern`;
const modernPath = path.join(root, modernRelative);
const conflictRelative = `${scaffoldRelative}-conflict`;
const conflictPath = path.join(root, conflictRelative);
const openRelative = `${scaffoldRelative}-open`;
const openPath = path.join(root, openRelative);
const notesRelative = `${scaffoldRelative}-notes`;
const notesPath = path.join(root, notesRelative);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const REQUEST_TIMEOUT_MS = 30_000;
let previewId = null;
let runtimeAgent = null;
const scenarioCanvas = { width: 100, height: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), addEventListener() {}, removeEventListener() {} };
class ScenarioEngine {
  constructor() { this.input = new engineExports.Input(scenarioCanvas); this.scene = new engineExports.Scene(); this.fixedStep = 1 / 60; this.running = true; this.steps = 0; }
  stop() { this.running = false; return this; }
  start() { this.running = true; return this; }
  step(delta) { this.steps += 1; this.lastDelta = delta; return this; }
}
const mcpEnvironment = { ...process.env, CLAUDE_PROJECT_DIR: root };
delete mcpEnvironment.EXI_MCP_ROOT;
const child = spawn(process.execPath, [serverPath], { cwd: root, env: mcpEnvironment, stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
let nextId = 1;
let stderr = "";
const unsolicited = [];
const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
stdout.on("line", (line) => {
  let message;
  try { message = JSON.parse(line); } catch (error) {
    for (const reject of pending.values()) reject(error);
    pending.clear();
    return;
  }
  const waiter = pending.get(message.id);
  if (!waiter) { unsolicited.push(message); return; }
  pending.delete(message.id);
  waiter.resolve(message);
});

function request(method, params = {}) {
  const id = nextId++;
  const label = method === "tools/call" && params?.name ? `${method}:${params.name}` : method;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timeout: ${label}`)); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function toolResult(response) {
  assert.equal(response.jsonrpc, "2.0");
  assert.ok(response.result, JSON.stringify(response));
  assert.equal(response.result.isError, undefined, response.result.content?.[0]?.text || "MCP tool error");
  const structured = response.result.structuredContent;
  if (structured && Object.keys(structured).length === 1 && Object.hasOwn(structured, "value")) return structured.value;
  return structured ?? JSON.parse(response.result.content?.[0]?.text || "null");
}

try {
  const initialized = await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  assert.equal(initialized.result.capabilities.prompts.listChanged, false);
  assert.match(initialized.result.instructions, /exi_api first/);
  assert.match(initialized.result.instructions, /exi_project_open/);
  assert.ok(initialized.result.instructions.length <= 512);
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":99}}\n');
  assert.deepEqual((await request("ping")).result, {});
  assert.equal(unsolicited.length, 0, JSON.stringify(unsolicited));

  const modernMeta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientInfo": { name: "modern-smoke", version: "1" },
    "io.modelcontextprotocol/clientCapabilities": {},
  };
  const modernRequest = (method, params = {}) => request(method, { ...params, _meta: modernMeta });
  const modernRequestWithProgress = (method, params, progressToken) => request(method, { ...params, _meta: { ...modernMeta, progressToken } });
  const discovery = await modernRequest("server/discover");
  assert.equal(discovery.result.resultType, "complete");
  assert.ok(discovery.result.supportedVersions.includes("2026-07-28"));
  assert.equal(discovery.result._meta["io.modelcontextprotocol/serverInfo"].name, "exi-engine");
  const modernTools = await modernRequest("tools/list");
  assert.equal(modernTools.result.resultType, "complete");
  assert.equal(modernTools.result._meta["io.modelcontextprotocol/serverInfo"].version, "0.2.0");
  assert.equal(modernTools.result.cacheScope, "private");
  const modernResources = await modernRequest("resources/list");
  assert.equal(modernResources.result.resultType, "complete");
  const modernResource = await modernRequest("resources/read", { uri: "exi://runtime" });
  assert.equal(modernResource.result.resultType, "complete");
  assert.equal(modernResource.result.cacheScope, "private");
  const modernCall = await modernRequest("tools/call", { name: "exi_function", arguments: { name: "clamp", args: [2, 0, 1] } });
  assert.equal(modernCall.result.resultType, "complete");
  assert.equal(modernCall.result.structuredContent, 1);
  const modernScaffold = toolResult(await modernRequest("tools/call", { name: "exi_scaffold", arguments: { directory: modernRelative } }));
  assert.equal(modernScaffold.directory, modernRelative);
  const modernWrite = toolResult(await modernRequest("tools/call", { name: "exi_file_write", arguments: { path: `${modernRelative}/agent-note.txt`, content: "modern MCP\n" } }));
  assert.equal(modernWrite.path, `${modernRelative}/agent-note.txt`);
  const modernProgressStart = unsolicited.length;
  const modernCheck = toolResult(await modernRequestWithProgress("tools/call", { name: "exi_project_check", arguments: { path: modernRelative } }, "modern-project-check"));
  assert.equal(modernCheck.ok, true, JSON.stringify(modernCheck));
  assert.ok(unsolicited.slice(modernProgressStart).some((message) => message.method === "notifications/progress" && message.params?.progressToken === "modern-project-check"));
  const malformedModern = await request("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } });
  assert.equal(malformedModern.error.code, -32602);
  const unsupportedModern = await request("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01", "io.modelcontextprotocol/clientCapabilities": {} } });
  assert.equal(unsupportedModern.error.code, -32022);
  assert.ok(unsupportedModern.error.data.supported.includes("2026-07-28"));
  const modernInitialize = await request("initialize", { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "modern-smoke", version: "1" } });
  assert.equal(modernInitialize.error.code, -32022);

  const cancelledRequestId = 9001;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: cancelledRequestId, method: "tools/call", params: { name: "exi_check", arguments: { mode: "verify" } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: cancelledRequestId, reason: "smoke test" } })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(unsolicited.some((message) => message.id === cancelledRequestId), false, JSON.stringify(unsolicited));
  assert.deepEqual((await request("ping")).result, {});

  const prompts = await request("prompts/list");
  assert.ok(prompts.result.prompts.some((prompt) => prompt.name === "exi_create_game"));
  assert.ok(prompts.result.prompts.some((prompt) => prompt.name === "exi_verify_runtime"));
  const createPrompt = await request("prompts/get", { name: "exi_create_game", arguments: { goal: "top-down arena" } });
  assert.match(createPrompt.result.messages[0].content.text, /top-down arena/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_scaffold/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_project_apply/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_file_check/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_project_check/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_project_status/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_session_status/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_asset_write/);
  assert.match(createPrompt.result.messages[0].content.text, /exi_asset_begin\/chunk\/commit/);
  assert.match(createPrompt.result.messages[0].content.text, /loadTexture\/loadAtlas\/loadJSON/);
  const verifyPrompt = await request("prompts/get", { name: "exi_verify_runtime", arguments: { path: "/games/demo/index.html" } });
  assert.match(verifyPrompt.result.messages[0].content.text, /games\/demo\/index\.html/);
  const nullPromptArguments = await request("prompts/get", { name: "exi_create_game", arguments: null });
  assert.equal(nullPromptArguments.error.code, -32602);
  assert.equal(nullPromptArguments.error.data.code, "EXI_MCP_PROMPT_ARGS_TYPE");
  const unknownPromptArgument = await request("prompts/get", { name: "exi_create_game", arguments: { unexpected: true } });
  assert.equal(unknownPromptArgument.error.code, -32602);
  assert.equal(unknownPromptArgument.error.data.code, "EXI_MCP_ARGUMENT_UNKNOWN");
  const missingPrompt = await request("prompts/get", { name: "exi_missing" });
  assert.equal(missingPrompt.error.code, -32602);

  const listed = await request("tools/list");
  const toolNames = listed.result.tools.map((tool) => tool.name);
  const dispatchSource = await readFile(serverPath, "utf8");
  const runtimeAgentSource = await readFile(path.join(root, "src", "ai", "runtime-agent.js"), "utf8");
  assert.equal(new Set(toolNames).size, toolNames.length);
  assert.match(dispatchSource, /function getHandleType\(value\)/);
  assert.doesNotMatch(dispatchSource, /value\?\.constructor\?\.name/);
  assert.doesNotMatch(dispatchSource, /object\?\.constructor\?\.name/);
  assert.match(runtimeAgentSource, /function objectType\(object\)/);
  assert.doesNotMatch(runtimeAgentSource, /value\?\.constructor\?\.name/);
  assert.doesNotMatch(runtimeAgentSource, /object\?\.constructor\?\.name/);
  for (const name of toolNames) assert.match(dispatchSource, new RegExp(`name === \\"${name}\\"`), `Tool dispatch missing: ${name}`);
  assert.ok(listed.result.tools.every((tool) => tool.inputSchema?.type === "object" && tool.description && tool.annotations?.title));
  assert.ok(listed.result.tools.every((tool) => tool.inputSchema.additionalProperties === false));
  const assertNestedObjectSchemasStrict = (schema, schemaPath) => {
    if (!schema || typeof schema !== "object") return;
    for (const [index, branch] of (schema.oneOf || []).entries()) assertNestedObjectSchemasStrict(branch, `${schemaPath}.oneOf[${index}]`);
    if (schema.type === "object" && schema.properties && schema.additionalProperties !== false) assert.fail(`${schemaPath} nested object schema is not strict`);
    for (const [name, child] of Object.entries(schema.properties || {})) assertNestedObjectSchemasStrict(child, `${schemaPath}.${name}`);
    if (schema.items) assertNestedObjectSchemasStrict(schema.items, `${schemaPath}.items`);
  };
  for (const tool of listed.result.tools) assertNestedObjectSchemasStrict(tool.inputSchema, `tools.${tool.name}`);
  const assetWriteSchema = listed.result.tools.find((tool) => tool.name === "exi_asset_write").inputSchema;
  assert.deepEqual(assetWriteSchema.properties.bytes.required, ["$bytes"]);
  assert.equal(assetWriteSchema.properties.bytes.additionalProperties, false);
  assert.equal(assetWriteSchema.properties.bytes.properties.$bytes.oneOf.length, 2);
  for (const name of ["exi_file_write", "exi_file_begin", "exi_asset_write", "exi_asset_begin"]) {
    const versionSchema = listed.result.tools.find((tool) => tool.name === name).inputSchema.properties.expectedVersion;
    assert.deepEqual(versionSchema.required, ["bytes", "mtimeMs"]);
    assert.equal(versionSchema.additionalProperties, false);
    assert.equal(listed.result.tools.find((tool) => tool.name === name).inputSchema.properties.expectedSha256.maxLength, 64);
  }
  const applyVersionSchema = listed.result.tools.find((tool) => tool.name === "exi_project_apply").inputSchema.properties.files.items.properties.expectedVersion;
  assert.deepEqual(applyVersionSchema.required, ["bytes", "mtimeMs"]);
  assert.equal(applyVersionSchema.additionalProperties, false);
  assert.equal(listed.result.tools.find((tool) => tool.name === "exi_api").annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find((tool) => tool.name === "exi_inspect").annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find((tool) => tool.name === "exi_session_status").annotations.readOnlyHint, true);
  assert.equal(listed.result.tools.find((tool) => tool.name === "exi_set").annotations.destructiveHint, true);
  assert.ok(toolNames.includes("exi_api"));
  assert.ok(toolNames.includes("exi_build_scene"));
  assert.ok(toolNames.includes("exi_scaffold"));
  assert.ok(toolNames.includes("exi_project_open"));
  assert.ok(toolNames.includes("exi_file_list"));
  assert.ok(toolNames.includes("exi_file_read"));
  assert.ok(toolNames.includes("exi_file_write"));
  assert.ok(toolNames.includes("exi_file_patch"));
  assert.ok(toolNames.includes("exi_project_apply"));
  assert.ok(toolNames.includes("exi_file_begin"));
  assert.ok(toolNames.includes("exi_file_chunk"));
  assert.ok(toolNames.includes("exi_file_commit"));
  assert.ok(toolNames.includes("exi_file_abort"));
  assert.ok(toolNames.includes("exi_inspect"));
  assert.ok(toolNames.includes("exi_asset_list"));
  assert.ok(toolNames.includes("exi_asset_read"));
  assert.ok(toolNames.includes("exi_asset_write"));
  assert.ok(toolNames.includes("exi_asset_begin"));
  assert.ok(toolNames.includes("exi_asset_chunk"));
  assert.ok(toolNames.includes("exi_asset_commit"));
  assert.ok(toolNames.includes("exi_asset_abort"));
  assert.ok(toolNames.includes("exi_file_check"));
  assert.ok(toolNames.includes("exi_session_status"));
  assert.ok(toolNames.includes("exi_project_status"));
  assert.ok(toolNames.includes("exi_project_check"));
  assert.ok(toolNames.includes("exi_project_preview"));
  assert.ok(toolNames.includes("exi_check"));
  assert.ok(toolNames.includes("exi_preview_start"));
  assert.ok(toolNames.includes("exi_preview_call"));
  assert.ok(toolNames.includes("exi_preview_batch"));
  assert.ok(toolNames.includes("exi_batch"));
  const previewBatchTool = listed.result.tools.find((tool) => tool.name === "exi_preview_batch");
  assert.deepEqual(previewBatchTool.inputSchema.properties.calls.items.required, ["operation"]);
  assert.deepEqual(previewBatchTool.inputSchema.properties.calls.items.properties.operation.enum, ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario"]);
  assert.equal(previewBatchTool.inputSchema.properties.calls.items.additionalProperties, false);
  const wrongRuntimeBatchRoute = await request("tools/call", { name: "exi_preview_call", arguments: { operation: "batch", calls: [{ operation: "function", name: "clamp", args: [0, 0, 1] }] } });
  assert.equal(wrongRuntimeBatchRoute.result.isError, true);
  assert.match(wrongRuntimeBatchRoute.result.content[0].text, /EXI_MCP_RUNTIME_BATCH_ROUTE/);
  const fileScopeBeforeScaffold = await request("tools/call", { name: "exi_file_read", arguments: { path: "package.json" } });
  assert.equal(fileScopeBeforeScaffold.result.isError, true);
  const listScopeBeforeScaffold = await request("tools/call", { name: "exi_file_list", arguments: { path: "src" } });
  assert.equal(listScopeBeforeScaffold.result.isError, true);

  const resources = await request("resources/list");
  assert.ok(resources.result.resources.some((resource) => resource.uri === "exi://api"));
  assert.ok(resources.result.resources.some((resource) => resource.uri === "exi://types"));
  assert.ok(resources.result.resources.some((resource) => resource.uri === "exi://runtime"));
  assert.ok(resources.result.resources.some((resource) => resource.uri === "exi://clients"));
  const typesResource = await request("resources/read", { uri: "exi://types" });
  assert.match(typesResource.result.contents[0].text, /class ExiEngine/);
  const runtimeResource = await request("resources/read", { uri: "exi://runtime" });
  const runtimeContract = JSON.parse(runtimeResource.result.contents[0].text);
  assert.equal(runtimeContract.selector, "#exi-runtime");
  assert.equal(runtimeContract.telemetry.endpoint, "/__exi/runtime");
  assert.equal(runtimeContract.version, 10);
  assert.equal(runtimeContract.commands.endpoint, "/__exi/runtime-command");
  assert.ok(runtimeContract.commands.operations.includes("export_call"));
  assert.ok(runtimeContract.commands.operations.includes("observe"));
  assert.ok(runtimeContract.commands.operations.includes("snapshot"));
  assert.ok(runtimeContract.commands.operations.includes("scenario"));
  assert.ok(runtimeContract.commands.operations.includes("batch"));
  assert.deepEqual(runtimeContract.commands.snapshot, { maxNodesPerPage: 64, maxVisited: 4096, maxDepth: 32, maxOffset: 4095 });
  assert.deepEqual(runtimeContract.commands.input, { maxEvents: 128, maxKeyLength: 64, maxPointerTypeLength: 32, maxCoordinate: 10000000, maxPointerId: 2147483647, maxButton: 30 });
  assert.deepEqual(runtimeContract.commands.scenario, { maxFrames: 16, maxEvents: 512, maxFrameEvents: 128, maxObserveCells: 1024, maxSnapshotNodes: 16 });
  assert.equal(runtimeContract.commands.maxBatchCalls, 8);
  assert.equal(runtimeContract.commands.maxInlineBinaryBytes, 32 * 1024);
  assert.deepEqual(runtimeContract.callbacks, { reference: "$callback", source: "page-registered", inspectField: "callbacks", maxNameLength: 256, maxCallbacks: 256, codeSerialized: false });
  const clientsResource = await request("resources/read", { uri: "exi://clients" });
  const clients = JSON.parse(clientsResource.result.contents[0].text);
  assert.deepEqual(Object.keys(clients.clients).sort(), ["claude", "cline", "codex", "cursor", "gemini", "opencode", "windsurf"]);
  assert.equal(clients.version, 3);
  assert.equal(clients.clients.cursor.file, ".cursor/mcp.json");
  assert.equal(clients.clients.cline.file, ".cline/mcp.json");
  assert.equal(clients.clients.windsurf.file, "~/.codeium/windsurf/mcp_config.json");
  assert.match(clients.clients.claude.config.mcpServers["exi-engine"].args[0], /CLAUDE_PROJECT_DIR/);
  assert.equal(clients.clients.claude.config.mcpServers["exi-engine"].timeout, 360000);
  assert.equal(clients.clients.opencode.add, "opencode mcp add");
  assert.equal(clients.clients.opencode.config.mcp.servers["exi-engine"].codemode, false);
  assert.equal(clients.clients.opencode.config.mcp.servers["exi-engine"].timeout, 360000);
  assert.equal(clients.clients.codex.config.tool_timeout_sec, 360);
  assert.equal(clients.clients.codex.config.default_tools_approval_mode, "writes");
  assert.equal(clients.clients.gemini.config.mcpServers["exi-engine"].timeout, 360000);
  assert.equal(clients.nativeProbe, "npm run test:clients:native");
  assert.deepEqual(clients.nativeProbeStatuses, ["passed", "skipped", "unavailable", "failed", "spawn-error", "timeout"]);
  const missingResource = await request("resources/read", { uri: "exi://missing" });
  assert.equal(missingResource.error.code, -32602);
  assert.equal(missingResource.error.data.code, "EXI_MCP_RESOURCE_NOT_FOUND");

  const api = toolResult(await request("tools/call", { name: "exi_api", arguments: {} }));
  const runtimeExportNames = Object.keys(engineExports).filter((name) => !name.startsWith("_")).sort();
  assert.deepEqual(api.exports.map((entry) => entry.name).sort(), runtimeExportNames);
  assert.ok(api.exports.some((entry) => entry.name === "Scene" && entry.route === "exi_create" && entry.methods.includes("add")));
  assert.ok(api.exports.some((entry) => entry.name === "TextureAtlas" && entry.staticMethods.includes("fromGrid")));
  assert.ok(api.exports.some((entry) => entry.name === "clamp" && entry.route === "exi_function"));
  assert.ok(api.exports.some((entry) => entry.name === "easing" && entry.route === "exi_export_get" && entry.members.some((member) => member.name === "linear" && member.kind === "function" && member.route === "exi_export_call")));
  assert.ok(api.exports.some((entry) => entry.name === "Texture" && entry.staticProperties.some((property) => property.name === "white" && property.route === "exi_export_get")));
  assert.equal(api.transport, "stdio");
  assert.equal(api.protocol, "2026-07-28");
  assert.equal(api.mcpEra, "dual");
  assert.ok(api.supportedProtocols.includes("2025-11-25"));
  assert.equal(api.resources.types, "exi://types");
  assert.equal(api.resources.api, "exi://api");
  assert.equal(api.callRoutes.instanceMethod, "exi_call");
  assert.equal(api.callRoutes.staticValue, "exi_export_get");
  assert.equal(api.callRoutes.browserRuntime, "exi_preview_call");
  assert.equal(api.callRoutes.browserRuntimeBatch, "exi_preview_batch");
  assert.equal(api.callRoutes.sessionStatus, "exi_session_status");
  assert.equal(api.callRoutes.projectStatus, "exi_project_status");
  assert.equal(api.callRoutes.projectPreview, "exi_project_preview");
  assert.deepEqual(api.toolInput, { topLevelAdditionalProperties: false, objectRequired: true, unknownArgumentCode: "EXI_MCP_ARGUMENT_UNKNOWN", typeErrorCode: "EXI_MCP_ARGS_TYPE", nestedTypeErrorCode: "EXI_MCP_ARGUMENT_TYPE", requiredArgumentCode: "EXI_MCP_ARGUMENT_REQUIRED", enumArgumentCode: "EXI_MCP_ARGUMENT_ENUM", limitArgumentCode: "EXI_MCP_ARGUMENT_LIMIT", invalidArgumentCode: "EXI_MCP_ARGUMENT_INVALID", binaryPayload: "{ $bytes: byte[] | base64 }", versioning: { outputField: "version", inputField: "expectedVersion", fields: ["bytes", "mtimeMs"], conflictCode: "EXI_MCP_FILE_CONFLICT", writeTools: ["exi_file_write", "exi_file_begin", "exi_asset_write", "exi_asset_begin", "exi_project_apply"] }, integrity: { inputField: "expectedSha256", algorithm: "SHA-256", format: "64 hexadecimal characters", mismatchCode: "EXI_MCP_UPLOAD_INTEGRITY", uploadTools: ["exi_file_write", "exi_file_begin", "exi_asset_write", "exi_asset_begin"] } });
  const availableTools = new Set(toolNames);
  for (const entry of api.exports) {
    assert.ok(availableTools.has(entry.route), `MCP export route is not listed: ${entry.name}`);
    assert.deepEqual(Object.keys(entry.methodRoutes).sort(), entry.methods, `MCP instance method routes drift: ${entry.name}`);
    assert.deepEqual(Object.keys(entry.staticMethodRoutes).sort(), entry.staticMethods, `MCP static method routes drift: ${entry.name}`);
    for (const route of Object.values(entry.methodRoutes)) assert.ok(availableTools.has(route), `MCP instance method tool missing: ${entry.name}`);
    for (const route of Object.values(entry.staticMethodRoutes)) assert.ok(availableTools.has(route), `MCP static method tool missing: ${entry.name}`);
    for (const member of entry.members) assert.ok(availableTools.has(member.route), `MCP member tool missing: ${entry.name}.${member.name}`);
    for (const property of entry.staticProperties) assert.ok(availableTools.has(property.route), `MCP static property tool missing: ${entry.name}.${property.name}`);
  }
  for (const route of Object.values(api.callRoutes)) assert.ok(availableTools.has(route), `MCP call route tool missing: ${route}`);
  assert.equal(api.limits.maxChunkedAssetBytes, 64 * 1024 * 1024);
  assert.equal(api.limits.maxChunkedProjectFileBytes, 4 * 1024 * 1024);
  assert.equal(api.limits.maxProjectReadBytes, 48 * 1024);
  assert.equal(api.limits.maxRuntimeTelemetryBytes, 4 * 1024);
  assert.equal(api.limits.maxRuntimeCommandWaitMs, 10_000);
  assert.equal(api.limits.maxRuntimeBatchCalls, 8);
  assert.equal(api.limits.maxInlineBinaryBytes, 32 * 1024);
  assert.equal(api.limits.maxAssetReadBytes, 32 * 1024);
  assert.equal(api.limits.maxGridPathCells, engineExports.MAX_GRID_PATH_CELLS);
  assert.equal(api.limits.maxPreviewStartupMs, 10_000);
  assert.deepEqual(api.workflow.open, ["exi_api", "exi_project_open", "exi_file_list", "exi_file_read", "exi_project_apply", "exi_file_write", "exi_file_patch", "exi_file_begin", "exi_file_chunk", "exi_file_commit", "exi_file_abort", "exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort", "exi_project_status", "exi_project_check", "exi_project_preview", "exi_preview_start", "exi_preview_call", "exi_preview_batch", "exi_preview_probe", "exi_preview_stop"]);
  assert.deepEqual(api.workflow.create, ["exi_api", "exi_scaffold", "exi_project_apply", "exi_file_write", "exi_file_patch", "exi_file_begin", "exi_file_chunk", "exi_file_commit", "exi_file_abort", "exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort", "exi_project_status", "exi_project_check", "exi_project_preview", "exi_preview_start", "exi_preview_call", "exi_preview_batch", "exi_preview_probe", "exi_preview_stop", "exi_check"]);
  assert.deepEqual(api.workflow.assets, ["exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort"]);
  assert.deepEqual(api.workflow.session, ["exi_session_status", "exi_session_reset"]);
  assert.deepEqual(api.workflow.cleanup, ["exi_release", "exi_session_reset"]);
  for (const name of ["clamp", "degToRad", "getAABB", "inspectKTX2", "intersectsAABB", "lerp"]) assert.equal(api.exports.find((entry) => entry.name === name).kind, "function");
  const forbiddenManifestNames = new Set(["constructor", "__proto__", "prototype"]);
  const expectedMethods = (value) => {
    const names = new Set();
    let prototype = value?.prototype;
    while (prototype && prototype !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(prototype)) {
        if (name === "constructor" || name.startsWith("_") || forbiddenManifestNames.has(name)) continue;
        if (typeof Object.getOwnPropertyDescriptor(prototype, name)?.value === "function") names.add(name);
      }
      prototype = Object.getPrototypeOf(prototype);
    }
    return [...names].sort();
  };
  const expectedStaticMethods = (value) => typeof value !== "function" ? [] : Object.getOwnPropertyNames(value)
    .filter((name) => !["length", "name", "prototype", "caller", "arguments"].includes(name) && !name.startsWith("_") && !forbiddenManifestNames.has(name))
    .filter((name) => typeof Object.getOwnPropertyDescriptor(value, name)?.value === "function")
    .sort();
  for (const [name, value] of Object.entries(engineExports)) {
    const entry = api.exports.find((candidate) => candidate.name === name);
    assert.ok(entry, `MCP manifest export missing: ${name}`);
    const kind = typeof value === "function" ? (Function.prototype.toString.call(value).startsWith("class ") ? "class" : "function") : typeof value;
    assert.equal(entry.route, kind === "class" ? "exi_create" : kind === "function" ? "exi_function" : "exi_export_get", `MCP manifest route drift: ${name}`);
    if (typeof value === "function") {
      assert.deepEqual(entry.methods, expectedMethods(value), `MCP manifest methods drift: ${name}`);
      assert.deepEqual(entry.staticMethods, expectedStaticMethods(value), `MCP manifest static methods drift: ${name}`);
    }
  }
  assert.equal(toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "clamp", args: [2, 0, 1] } })), 1);
  assert.equal(toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "degToRad", args: [180] } })).toFixed(6), Math.PI.toFixed(6));
  assert.equal(toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "lerp", args: [0, 10, 0.25] } })), 2.5);
  const mcpPath = toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "findGridPath", args: [[[0, 0, 1], [1, 0, 0], [0, 0, 0]], { x: 0, y: 0 }, { x: 2, y: 2 }] } }));
  assert.equal(mcpPath.reached, true);
  assert.deepEqual({ x: mcpPath.path.at(-1).x, y: mcpPath.path.at(-1).y }, { x: 2, y: 2 });
  const invalidArgs = await request("tools/call", { name: "exi_function", arguments: { name: "clamp", args: {} } });
  assert.equal(invalidArgs.result.isError, true);
  assert.match(invalidArgs.result.content[0].text, /EXI_MCP_ARGS_TYPE/);
  const nullArgs = await request("tools/call", { name: "exi_create", arguments: null });
  assert.equal(nullArgs.result.isError, true);
  assert.match(nullArgs.result.content[0].text, /EXI_MCP_ARGS_TYPE/);
  const missingRequired = await request("tools/call", { name: "exi_create", arguments: {} });
  assert.equal(missingRequired.result.isError, true);
  assert.match(missingRequired.result.content[0].text, /EXI_MCP_ARGUMENT_REQUIRED/);
  const invalidEnum = await request("tools/call", { name: "exi_check", arguments: { mode: "lint" } });
  assert.equal(invalidEnum.result.isError, true);
  assert.match(invalidEnum.result.content[0].text, /EXI_MCP_ARGUMENT_ENUM/);
  const invalidBinaryShape = await request("tools/call", { name: "exi_asset_write", arguments: { path: "missing/assets/a.png", bytes: { $bytes: [1], extra: true } } });
  assert.equal(invalidBinaryShape.result.isError, true);
  assert.match(invalidBinaryShape.result.content[0].text, /EXI_MCP_ARGUMENT_UNKNOWN|EXI_MCP_ARGUMENT_INVALID/);
  const unknownToolArgument = await request("tools/call", { name: "exi_function", arguments: { name: "clamp", args: [1, 0, 2], extra: true } });
  assert.equal(unknownToolArgument.result.isError, true);
  assert.match(unknownToolArgument.result.content[0].text, /EXI_MCP_ARGUMENT_UNKNOWN/);
  const callableNode = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Node" } }));
  const callableNodeInspection = toolResult(await request("tools/call", { name: "exi_inspect", arguments: { handle: callableNode.$handle } }));
  assert.equal(callableNodeInspection.handle, callableNode.$handle);
  assert.ok(callableNodeInspection.methods.includes("add"));
  assert.ok(callableNodeInspection.properties.some((property) => property.name === "position" && property.readable));
  const callableCollider = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Collider", args: [{ $handle: callableNode.$handle }] } }));
  const callableColliderInspection = toolResult(await request("tools/call", { name: "exi_inspect", arguments: { handle: callableCollider.$handle } }));
  const layerProperty = callableColliderInspection.properties.find((property) => property.name === "layer");
  assert.deepEqual(layerProperty, { name: "layer", kind: "accessor", readable: true, writable: true });
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: callableCollider.$handle } }));
  const nodeBounds = toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "getAABB", args: [{ $handle: callableNode.$handle }] } }));
  assert.equal(nodeBounds.type, "Object");
  assert.equal(toolResult(await request("tools/call", { name: "exi_function", arguments: { name: "intersectsAABB", args: [{ left: 0, top: 0, right: 2, bottom: 2 }, { left: 1, top: 1, right: 3, bottom: 3 }] } })), true);
  const invalidKTX2 = await request("tools/call", { name: "exi_function", arguments: { name: "inspectKTX2", args: [{ $bytes: [0, 1] }] } });
  assert.equal(invalidKTX2.result.isError, true);
  assert.match(invalidKTX2.result.content[0].text, /header eksik/);
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: callableNode.$handle } }));

  const callbackNode = new engineExports.Node({ onUpdate: () => "application callback" });
  const callbackChild = new engineExports.Node({ name: "target" });
  callbackNode.add(callbackChild);
  let callbackVisits = 0;
  const callbackRuntime = new RuntimeAgent({ api: engineExports, roots: { callbackNode }, callbacks: { visit: () => { callbackVisits += 1; } } });
  const callbackInspection = callbackRuntime.inspectHandle(callbackNode, "callbackNode");
  assert.ok(callbackInspection.methods.includes("setAlpha"));
  assert.ok(!callbackInspection.methods.includes("onUpdate"));
  assert.deepEqual(callbackInspection.callbacks, ["visit"]);
  await assert.rejects(callbackRuntime.execute({ operation: "call", handle: "callbackNode", method: "onUpdate", args: [] }), /Runtime method bulunamadı/);
  assert.equal(await callbackRuntime.execute({ operation: "call", handle: "callbackNode", method: "traverse", args: [{ $callback: "visit" }] }), null);
  assert.equal(callbackVisits, 2);
  await assert.rejects(callbackRuntime.execute({ operation: "call", handle: "callbackNode", method: "find", args: [{ $callback: "missing" }] }), (error) => error?.code === "EXI_RUNTIME_CALLBACK");
  const callbackBatch = await callbackRuntime.execute({ operation: "batch", calls: [{ operation: "call", handle: "callbackNode", method: "traverse", args: [{ $callback: "visit" }] }] });
  assert.equal(callbackBatch.completed, 1);
  assert.equal(callbackVisits, 4);
  const serializedBytes = callbackRuntime.serialize(new Uint8Array([1, 2, 3, 255]));
  assert.equal(serializedBytes.byteLength, 4);
  assert.equal(serializedBytes.bytes.$bytes, Buffer.from([1, 2, 3, 255]).toString("base64"));
  const serializedView = callbackRuntime.serialize(new DataView(Uint8Array.from([9, 8, 7]).buffer));
  assert.deepEqual(serializedView.sample, [9, 8, 7]);
  const serializedBigInts = callbackRuntime.serialize(new BigInt64Array([1n, -2n]));
  assert.deepEqual(serializedBigInts.sample, ["1", "-2"]);
  assert.equal(callbackRuntime.serialize(9007199254740993n), "9007199254740993");
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;
  try {
    globalThis.OffscreenCanvas = class FakeOffscreenCanvas {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() {
        return {
          drawImage() {},
          getImageData: () => {
            const data = new Uint8ClampedArray(this.width * this.height * 4);
            for (let index = 0; index < data.length; index += 4) { data[index] = 255; data[index + 3] = 255; }
            return { data };
          },
        };
      }
    };
    const observeCanvas = createCanvasObserver({ width: 320, height: 180 });
    const firstObservation = await observeCanvas({ columns: 4, rows: 2 });
    const secondObservation = await observeCanvas({ columns: 4, rows: 2 });
    assert.equal(firstObservation.type, "canvas-grid");
    assert.equal(firstObservation.changed, true);
    assert.equal(secondObservation.changed, false);
    assert.equal(firstObservation.grid.join("\n"), "::::\n::::");
    const observeEngine = createEngineObserver({ captureFrame: async () => ({ width: 2, height: 2, format: "rgba8", flipY: false, pixels: Uint8Array.from([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]) }) }, { columns: 2, rows: 2 });
    const engineObservation = await observeEngine();
    assert.equal(engineObservation.type, "canvas-grid");
    assert.equal(engineObservation.nonEmpty, 4);
    assert.equal((await observeEngine()).changed, false);
  } finally {
    if (originalOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
  assert.throws(() => new RuntimeAgent({ api: engineExports, callbacks: { invalid: "not-a-function" } }), /callback/);
  callbackNode.destroy();

  assert.equal(toolResult(await request("tools/call", { name: "exi_export_call", arguments: { path: "easing.linear", args: [0.25] } })), 0.25);
  const inheritedStaticMethod = await request("tools/call", { name: "exi_static_call", arguments: { type: "Node", method: "toString" } });
  assert.equal(inheritedStaticMethod.result.isError, true);
  const batched = toolResult(await request("tools/call", { name: "exi_batch", arguments: { calls: [
    { name: "exi_create", arguments: { type: "Node", args: [{ x: 7 }] } },
    { name: "exi_get", arguments: { handle: { $result: 0 }, property: "position" } },
    { name: "exi_set", arguments: { handle: { $result: 1 }, property: "x", value: 42 } },
    { name: "exi_export_call", arguments: { path: "clamp", args: [2, 0, 1] } },
  ] } }));
  assert.equal(batched.completed, 4);
  assert.equal(batched.failed, 0);
  assert.match(batched.results[0].result.$handle, /^h[0-9]+$/);
  assert.match(batched.results[1].result.$handle, /^h[0-9]+$/);
  assert.equal(batched.results[3].result, 1);
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: batched.results[0].result.$handle } }));
  const stoppedBatch = toolResult(await request("tools/call", { name: "exi_batch", arguments: { calls: [
    { name: "exi_missing", arguments: {} },
    { name: "exi_export_call", arguments: { path: "clamp", args: [2, 0, 1] } },
  ] } }));
  assert.equal(stoppedBatch.completed, 0);
  assert.equal(stoppedBatch.failed, 1);
  assert.equal(stoppedBatch.stopped, true);
  const continuingBatch = toolResult(await request("tools/call", { name: "exi_batch", arguments: { stopOnError: false, calls: [
    { name: "exi_missing", arguments: {} },
    { name: "exi_export_call", arguments: { path: "clamp", args: [2, 0, 1] } },
  ] } }));
  assert.equal(continuingBatch.completed, 1);
  assert.equal(continuingBatch.failed, 1);
  assert.equal(continuingBatch.stopped, false);
  assert.equal(continuingBatch.results[1].result, 1);
  const nestedBatch = toolResult(await request("tools/call", { name: "exi_batch", arguments: { calls: [{ name: "exi_batch", arguments: { calls: [] } }] } }));
  assert.equal(nestedBatch.failed, 1);
  const white = toolResult(await request("tools/call", { name: "exi_export_get", arguments: { path: "Texture.white" } }));
  assert.match(white.$handle, /^h[0-9]+$/);
  const whiteSprite = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Sprite", args: [{ texture: { $handle: white.$handle }, width: 8, height: 8 }] } }));
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: whiteSprite.$handle } }));
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: white.$handle } }));
  const atlasTexture = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Texture", args: [{ width: 2, height: 2 }] } }));
  const gridAtlas = toolResult(await request("tools/call", { name: "exi_static_call", arguments: { type: "TextureAtlas", method: "fromGrid", args: [{ $handle: atlasTexture.$handle }, { frameWidth: 1, frameHeight: 1, columns: 2, rows: 2 }] } }));
  assert.equal(gridAtlas.type, "TextureAtlas");
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: gridAtlas.$handle } }));
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: atlasTexture.$handle } }));

  const scene = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Scene" } }));
  const childNode = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Node", args: [{ x: 10, y: 20 }] } }));
  const added = toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: scene.$handle, method: "add", args: [{ $handle: childNode.$handle }] } }));
  assert.equal(added.$handle, childNode.$handle);
  const children = toolResult(await request("tools/call", { name: "exi_get", arguments: { handle: scene.$handle, property: "children" } }));
  assert.equal(children.length, 1);
  assert.equal(children[0].$handle, childNode.$handle);
  const position = toolResult(await request("tools/call", { name: "exi_get", arguments: { handle: childNode.$handle, property: "position" } }));
  const x = toolResult(await request("tools/call", { name: "exi_get", arguments: { handle: position.$handle, property: "x" } }));
  assert.equal(x, 10);
  toolResult(await request("tools/call", { name: "exi_set", arguments: { handle: position.$handle, property: "x", value: 42 } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_get", arguments: { handle: position.$handle, property: "x" } })), 42);

  const built = toolResult(await request("tools/call", { name: "exi_build_scene", arguments: { scene: { type: "Scene", children: [{ type: "Node", options: { x: 4 } }, { type: "Node", options: { y: 8 }, children: [{ type: "Node" }] }] } } }));
  assert.match(built.$handle, /^h[0-9]+$/);
  const invalidSceneField = await request("tools/call", { name: "exi_build_scene", arguments: { scene: { type: "Scene", metadata: true } } });
  assert.equal(invalidSceneField.result.isError, true);
  assert.match(invalidSceneField.result.content[0].text, /EXI_MCP_SCENE_SCHEMA/);
  const invalidSceneChildren = await request("tools/call", { name: "exi_build_scene", arguments: { scene: { type: "Scene", children: null } } });
  assert.equal(invalidSceneChildren.result.isError, true);
  assert.match(invalidSceneChildren.result.content[0].text, /EXI_MCP_SCENE_SCHEMA/);

  const doctorProgressStart = unsolicited.length;
  const doctor = toolResult(await request("tools/call", { name: "exi_check", arguments: { mode: "doctor" }, _meta: { progressToken: "doctor-smoke" } }));
  assert.equal(doctor.ok, true, doctor.stderr || doctor.stdout);
  const doctorProgress = unsolicited.slice(doctorProgressStart).filter((message) => message.method === "notifications/progress");
  assert.ok(doctorProgress.some((message) => message.params?.progressToken === "doctor-smoke" && message.params?.progress === 0));
  assert.ok(doctorProgress.some((message) => message.params?.progressToken === "doctor-smoke" && message.params?.progress === 1));

  const previewStart = request("tools/call", { name: "exi_preview_start", arguments: { path: "/index.html" } });
  const previewProbeQueued = request("tools/call", { name: "exi_preview_probe", arguments: { previewId: "p1", path: "/index.html" } });
  const preview = toolResult(await previewStart);
  previewId = preview.previewId;
  assert.equal(previewId, "p1");
  assert.equal(preview.ready, true);
  assert.equal(preview.pagePath, "/index.html");
  assert.equal(new URL(preview.pageUrl).pathname, "/index.html");
  assert.deepEqual(preview.runtime, { path: "/__exi/runtime", tokenManaged: true });
  const runtimeTokenResponse = await fetch(new URL("__exi/runtime-token", preview.url));
  assert.equal(runtimeTokenResponse.status, 200);
  const runtimeToken = (await runtimeTokenResponse.text()).trim();
  assert.ok(runtimeToken.length >= 20);
  const deniedRuntime = await fetch(new URL("__exi/runtime", preview.url), { headers: { "x-exi-runtime-token": "wrong-token" } });
  assert.equal(deniedRuntime.status, 403);
  const deniedRuntimeCommand = await fetch(new URL("__exi/runtime-command", preview.url), { headers: { "x-exi-runtime-token": "wrong-token" } });
  assert.equal(deniedRuntimeCommand.status, 403);
  runtimeAgent = new RuntimeAgent({ api: engineExports, roots: { engine: new ScenarioEngine() }, observe: () => ({ type: "canvas-grid", width: 960, height: 540, columns: 8, rows: 4, grid: ["########", "#......#", "#......#", "########"], hash: 42, changed: true, previousHash: null, nonEmpty: 32, averageLuma: 128 }), token: runtimeToken, baseUrl: preview.url, pollMs: 25 });
  runtimeAgent.start();
  const deniedRuntimeCall = await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "eval" } });
  assert.equal(deniedRuntimeCall.result.isError, true);
  assert.match(deniedRuntimeCall.result.content[0].text, /EXI_MCP_RUNTIME_OPERATION/);
  const deniedRootRelease = await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "release", handle: "engine" } });
  assert.equal(deniedRootRelease.result.isError, true);
  assert.match(deniedRootRelease.result.content[0].text, /EXI_RUNTIME_ROOT_HANDLE/);
  assert.equal(toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "function", name: "clamp", args: [2, 0, 1] } })), 1);
  const runtimeObservation = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "observe", args: [{ columns: 8, rows: 4 }] } }));
  assert.equal(runtimeObservation.type, "canvas-grid");
  assert.equal(runtimeObservation.grid.length, 4);
  assert.equal(runtimeObservation.changed, true);
  const runtimeSnapshot = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "snapshot", handle: "engine", args: [{ limit: 1 }] } }));
  assert.equal(runtimeSnapshot.type, "scene-snapshot");
  assert.equal(runtimeSnapshot.total, 1);
  assert.equal(runtimeSnapshot.nodes[0].handle, "engine");
  const repeatedRuntimeSnapshot = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "snapshot", handle: "engine", args: [{ limit: 1 }] } }));
  assert.equal(repeatedRuntimeSnapshot.changed, false);
  const runtimeScenario = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "scenario", handle: "engine", args: [{ frames: [{ input: [{ type: "keydown", code: "ArrowRight" }], observe: { columns: 4, rows: 2 }, snapshot: true }, { input: [{ type: "keyup", code: "ArrowRight" }] }] }] } }));
  assert.equal(runtimeScenario.type, "runtime-scenario");
  assert.equal(runtimeScenario.frameCount, 2);
  assert.equal(runtimeScenario.frames[0].observe.type, "canvas-grid");
  assert.ok(Array.isArray(runtimeScenario.frames[0].observe.grid));
  assert.ok(runtimeScenario.frames[0].observe.grid.length > 0);
  assert.equal(runtimeScenario.frames[0].snapshot.type, "scene-snapshot");
  assert.ok(runtimeScenario.frames[0].snapshot.nodes.length > 0);
  assert.equal(runtimeScenario.resumed, true);
  const runtimeNode = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "create", type: "Node" } }));
  assert.match(runtimeNode.$handle, /^[A-Za-z][A-Za-z0-9_-]*$/);
  const runtimeInspection = toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "inspect", handle: runtimeNode.$handle } }));
  assert.ok(runtimeInspection.methods.includes("setAlpha"));
  toolResult(await request("tools/call", { name: "exi_preview_call", arguments: { previewId, operation: "release", handle: runtimeNode.$handle } }));
  const runtimeBatch = toolResult(await request("tools/call", { name: "exi_preview_batch", arguments: { previewId, calls: [
    { operation: "create", type: "Node" },
    { operation: "inspect", handle: { $result: 0 } },
    { operation: "call", handle: { $result: 1, $path: "handle" }, method: "setAlpha", args: [0.25] },
    { operation: "release", handle: { $result: 0 } },
  ] } }));
  assert.equal(runtimeBatch.completed, 4);
  assert.equal(runtimeBatch.failed, 0);
  const continuingRuntimeBatch = toolResult(await request("tools/call", { name: "exi_preview_batch", arguments: { previewId, stopOnError: false, calls: [
    { operation: "create", type: "Node" },
    { operation: "call", handle: { $result: 0 }, method: "missingMethod" },
    { operation: "function", name: "clamp", args: [2, 0, 1] },
    { operation: "release", handle: { $result: 0 } },
  ] } }));
  assert.equal(continuingRuntimeBatch.completed, 3);
  assert.equal(continuingRuntimeBatch.failed, 1);
  assert.equal(continuingRuntimeBatch.stopped, false);
  assert.equal(continuingRuntimeBatch.results[2].value, 1);
  const oversizedRuntimeBatch = await request("tools/call", { name: "exi_preview_batch", arguments: { previewId, calls: Array.from({ length: 9 }, () => ({ operation: "function", name: "clamp", args: [0, 0, 1] })) } });
  assert.equal(oversizedRuntimeBatch.result.isError, true);
  assert.match(oversizedRuntimeBatch.result.content[0].text, /EXI_MCP_RUNTIME_BATCH_LIMIT/);
  runtimeAgent.stop();
  runtimeAgent = null;
  const runtimePost = await fetch(new URL("__exi/runtime", preview.url), { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": runtimeToken }, body: JSON.stringify({ ready: true, status: "running", event: "smoke", backend: "webgl2", fps: 60, draws: 1, nodes: 2 }) });
  assert.equal(runtimePost.status, 204);
  const runtimeProbe = toolResult(await request("tools/call", { name: "exi_preview_probe", arguments: { previewId, path: "/__exi/runtime" } }));
  assert.equal(JSON.parse(runtimeProbe.body).backend, "webgl2");
  const probe = toolResult(await previewProbeQueued);
  assert.equal(probe.status, 200);
  assert.match(probe.body, /<canvas/i);
  assert.match(probe.body, /id="exi-runtime"/);
  const loader = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "AssetLoader", args: [{ baseURL: preview.url }] } }));
  const loadedJSON = toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: loader.$handle, method: "loadJSON", args: ["package.json"] } }));
  assert.equal(loadedJSON.name, "exi-engine");
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: loader.$handle } }));
  const previewTraversal = await request("tools/call", { name: "exi_preview_probe", arguments: { previewId, path: "/%2e%2e/package.json" } });
  assert.equal(previewTraversal.result.isError, true);
  toolResult(await request("tools/call", { name: "exi_preview_stop", arguments: { previewId } }));
  previewId = null;
  const modernPreview = toolResult(await modernRequest("tools/call", { name: "exi_preview_start", arguments: {} }));
  previewId = modernPreview.previewId;
  assert.equal(modernPreview.ready, true);
  const modernProbe = toolResult(await modernRequest("tools/call", { name: "exi_preview_probe", arguments: { previewId: modernPreview.previewId, path: `/${modernRelative}/index.html` } }));
  assert.equal(modernProbe.status, 200);
  toolResult(await modernRequest("tools/call", { name: "exi_preview_stop", arguments: { previewId: modernPreview.previewId } }));
  previewId = null;
  const rejectedPreviewPath = await request("tools/call", { name: "exi_preview_start", arguments: { path: "/%2e%2e/package.json" } });
  assert.equal(rejectedPreviewPath.result.isError, true);
  assert.match(rejectedPreviewPath.result.content[0].text, /Repo dışına çıkan yol|traversal/);

  const scaffold = toolResult(await request("tools/call", { name: "exi_scaffold", arguments: { directory: scaffoldRelative } }));
  assert.equal(scaffold.files.length, 3);
  const initialFiles = toolResult(await request("tools/call", { name: "exi_file_list", arguments: { path: scaffoldRelative } }));
  assert.ok(initialFiles.files.some((file) => file.path === `${scaffoldRelative}/game.js`));
  assert.ok(initialFiles.files.some((file) => file.path === `${scaffoldRelative}/index.html`));
  const initialAssets = toolResult(await request("tools/call", { name: "exi_asset_list", arguments: { path: scaffoldRelative } }));
  assert.deepEqual(initialAssets.assets, []);
  const appliedProject = toolResult(await request("tools/call", { name: "exi_project_apply", arguments: { path: scaffoldRelative, files: [
    { path: "src/generated/README.md", content: "# generated\n" },
    { path: "src/generated/theme.css", content: ":root { --accent: teal; }\n" },
  ] } }));
  assert.equal(appliedProject.applied, 2);
  assert.equal(appliedProject.bytes, Buffer.byteLength("# generated\n:root { --accent: teal; }\n", "utf8"));
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "README.md"), "utf8"), "# generated\n");
  const rejectedProjectApply = await request("tools/call", { name: "exi_project_apply", arguments: { path: scaffoldRelative, files: [
    { path: "src/generated/README.md", content: "# should not replace\n" },
    { path: "src/generated/not-written.txt", content: "not written\n" },
  ] } });
  assert.equal(rejectedProjectApply.result.isError, true);
  assert.match(rejectedProjectApply.result.content[0].text, /EXI_MCP_FILE_EXISTS/);
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "README.md"), "utf8"), "# generated\n");
  await assert.rejects(() => stat(path.join(scaffoldPath, "src", "generated", "not-written.txt")));
  const overwrittenProject = toolResult(await request("tools/call", { name: "exi_project_apply", arguments: { path: scaffoldRelative, overwrite: true, files: [
    { path: "src/generated/README.md", content: "# updated\n" },
    { path: "src/generated/theme.css", content: ":root { --accent: rebeccapurple; }\n" },
  ] } }));
  assert.equal(overwrittenProject.files.every((file) => file.overwritten), true);
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "README.md"), "utf8"), "# updated\n");
  await mkdir(openPath, { recursive: true });
  await writeFile(path.join(openPath, "index.html"), '<!doctype html><script type="module" src="./game.js"></script>\n', "utf8");
  await writeFile(path.join(openPath, "game.js"), "export const existing = true;\n", "utf8");
  const opened = toolResult(await request("tools/call", { name: "exi_project_open", arguments: { path: openRelative } }));
  assert.equal(opened.directory, openRelative);
  assert.equal(opened.opened, true);
  assert.equal(opened.ok, true, JSON.stringify(opened));
  assert.equal(opened.checked, 2);
  const openedRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${openRelative}/game.js` } }));
  assert.equal(openedRead.content, "export const existing = true;\n");
  const versionedPath = `${scaffoldRelative}/src/generated/versioned.js`;
  const versionedInitialContent = "export const initial = true;\n";
  const versionedInitialWrite = toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: versionedPath, content: versionedInitialContent, expectedSha256: sha256(versionedInitialContent) } }));
  assert.equal(versionedInitialWrite.sha256, sha256(versionedInitialContent));
  const versionedRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: versionedPath } }));
  assert.deepEqual(Object.keys(versionedRead.version).sort(), ["bytes", "mtimeMs"]);
  const externalVersionedContent = "export const externalVersionedChange = true;\n";
  await writeFile(path.join(scaffoldPath, "src", "generated", "versioned.js"), externalVersionedContent, "utf8");
  const staleVersionedWrite = await request("tools/call", { name: "exi_file_write", arguments: { path: versionedPath, content: "export const stale = true;\n", overwrite: true, expectedVersion: versionedRead.version } });
  assert.equal(staleVersionedWrite.result.isError, true);
  assert.match(staleVersionedWrite.result.content[0].text, /EXI_MCP_FILE_CONFLICT/);
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "versioned.js"), "utf8"), externalVersionedContent);
  const currentVersionedRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: versionedPath } }));
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: versionedPath, content: "export const versioned = true;\n", overwrite: true, expectedVersion: currentVersionedRead.version } }));
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${openRelative}/game.js`, content: "export const edited = true;\n", overwrite: true } }));
  assert.equal(await readFile(path.join(openPath, "game.js"), "utf8"), "export const edited = true;\n");
  await mkdir(notesPath, { recursive: true });
  await writeFile(path.join(notesPath, "README.md"), "notes only\n", "utf8");
  const notesOpen = await request("tools/call", { name: "exi_project_open", arguments: { path: notesRelative } });
  assert.equal(notesOpen.result.isError, true);
  const uploadedAssetBytes = Array.from({ length: 4097 }, (_, index) => index % 256);
  const uploadedAssetDigest = sha256(Buffer.from(uploadedAssetBytes));
  const uploadedAsset = toolResult(await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/player.png`, bytes: { $bytes: uploadedAssetBytes }, expectedSha256: uploadedAssetDigest } }));
  assert.equal(uploadedAsset.bytes, uploadedAssetBytes.length);
  assert.equal(uploadedAsset.type, "png");
  assert.equal(uploadedAsset.sha256, uploadedAssetDigest);
  const invalidDigestAsset = await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/integrity.png`, bytes: { $bytes: [1, 2, 3] }, expectedSha256: "0".repeat(64) } });
  assert.equal(invalidDigestAsset.result.isError, true);
  assert.match(invalidDigestAsset.result.content[0].text, /EXI_MCP_UPLOAD_INTEGRITY/);
  await assert.rejects(() => stat(path.join(scaffoldPath, "assets", "integrity.png")));
  const encodedAsset = toolResult(await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/ui.mp3`, bytes: { $bytes: Buffer.from([1, 2, 3, 4]).toString("base64") } } }));
  assert.equal(encodedAsset.bytes, 4);
  assert.equal(encodedAsset.type, "mp3");
  const listedAssets = toolResult(await request("tools/call", { name: "exi_asset_list", arguments: { path: scaffoldRelative } }));
  assert.deepEqual(listedAssets.assets.map(({ path: assetPath, bytes, type }) => ({ path: assetPath, bytes, type })), [
    { path: `${scaffoldRelative}/assets/player.png`, bytes: uploadedAssetBytes.length, type: "png" },
    { path: `${scaffoldRelative}/assets/ui.mp3`, bytes: 4, type: "mp3" },
  ]);
  assert.ok(listedAssets.assets.every((asset) => asset.version && Number.isFinite(asset.version.mtimeMs)));
  const readAsset = toolResult(await request("tools/call", { name: "exi_asset_read", arguments: { path: `${scaffoldRelative}/assets/player.png`, limit: 4097 } }));
  assert.equal(readAsset.bytes, uploadedAssetBytes.length);
  assert.equal(readAsset.complete, true);
  assert.deepEqual(Object.keys(readAsset.version).sort(), ["bytes", "mtimeMs"]);
  assert.deepEqual([...Buffer.from(readAsset.data.$bytes, "base64")], uploadedAssetBytes);
  assert.equal((await readFile(path.join(scaffoldPath, "assets", "player.png"))).length, uploadedAssetBytes.length);
  await writeFile(path.join(scaffoldPath, "assets", "player.png"), Buffer.from([7, 7, 7]), { flag: "w" });
  const staleAssetWrite = await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/player.png`, bytes: { $bytes: [6, 6] }, overwrite: true, expectedVersion: readAsset.version } });
  assert.equal(staleAssetWrite.result.isError, true);
  assert.match(staleAssetWrite.result.content[0].text, /EXI_MCP_FILE_CONFLICT/);
  const currentAssetRead = toolResult(await request("tools/call", { name: "exi_asset_read", arguments: { path: `${scaffoldRelative}/assets/player.png`, limit: 32 } }));
  toolResult(await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/player.png`, bytes: { $bytes: uploadedAssetBytes }, overwrite: true, expectedVersion: currentAssetRead.version } }));
  toolResult(await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, bytes: { $bytes: [1, 2, 3] } } }));
  const replacementAssetRead = toolResult(await request("tools/call", { name: "exi_asset_read", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, limit: 32 } }));
  const replacementAsset = toolResult(await request("tools/call", { name: "exi_asset_begin", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, size: 2, overwrite: true, expectedVersion: replacementAssetRead.version } }));
  toolResult(await request("tools/call", { name: "exi_asset_chunk", arguments: { uploadId: replacementAsset.uploadId, offset: 0, bytes: { $bytes: [9, 8] } } }));
  await writeFile(path.join(scaffoldPath, "assets", "replaced.png"), Buffer.from([4, 4, 4]), { flag: "w" });
  const staleAssetCommit = await request("tools/call", { name: "exi_asset_commit", arguments: { uploadId: replacementAsset.uploadId } });
  assert.equal(staleAssetCommit.result.isError, true);
  assert.match(staleAssetCommit.result.content[0].text, /EXI_MCP_FILE_CONFLICT/);
  assert.equal(toolResult(await request("tools/call", { name: "exi_asset_abort", arguments: { uploadId: replacementAsset.uploadId } })).aborted, true);
  const currentReplacementRead = toolResult(await request("tools/call", { name: "exi_asset_read", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, limit: 32 } }));
  toolResult(await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, bytes: { $bytes: [1, 2, 3] }, overwrite: true, expectedVersion: currentReplacementRead.version } }));
  const replacementAssetRetryRead = toolResult(await request("tools/call", { name: "exi_asset_read", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, limit: 32 } }));
  const replacementAssetRetry = toolResult(await request("tools/call", { name: "exi_asset_begin", arguments: { path: `${scaffoldRelative}/assets/replaced.png`, size: 2, overwrite: true, expectedVersion: replacementAssetRetryRead.version } }));
  toolResult(await request("tools/call", { name: "exi_asset_chunk", arguments: { uploadId: replacementAssetRetry.uploadId, offset: 0, bytes: { $bytes: [9, 8] } } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_asset_commit", arguments: { uploadId: replacementAssetRetry.uploadId } })).overwritten, true);
  assert.deepEqual([...await readFile(path.join(scaffoldPath, "assets", "replaced.png"))], [9, 8]);
  const chunkedSize = 600_000;
  const chunkedFirstBytes = Buffer.alloc(400_000, 7);
  const chunkedSecondBytes = Buffer.alloc(200_000, 8);
  const chunkedDigest = sha256(Buffer.concat([chunkedFirstBytes, chunkedSecondBytes]));
  const chunkedUpload = toolResult(await request("tools/call", { name: "exi_asset_begin", arguments: { path: `${scaffoldRelative}/assets/large.ktx2`, size: chunkedSize, expectedSha256: chunkedDigest } }));
  assert.match(chunkedUpload.uploadId, /^u[0-9]+$/);
  const chunkedFirst = toolResult(await request("tools/call", { name: "exi_asset_chunk", arguments: { uploadId: chunkedUpload.uploadId, offset: 0, bytes: { $bytes: chunkedFirstBytes.toString("base64") } } }));
  assert.equal(chunkedFirst.receivedBytes, 400_000);
  const wrongOffset = await request("tools/call", { name: "exi_asset_chunk", arguments: { uploadId: chunkedUpload.uploadId, offset: 0, bytes: { $bytes: [1] } } });
  assert.equal(wrongOffset.result.isError, true);
  const chunkedSecond = toolResult(await request("tools/call", { name: "exi_asset_chunk", arguments: { uploadId: chunkedUpload.uploadId, offset: 400_000, bytes: { $bytes: chunkedSecondBytes.toString("base64") } } }));
  assert.equal(chunkedSecond.complete, true);
  const committedAsset = toolResult(await request("tools/call", { name: "exi_asset_commit", arguments: { uploadId: chunkedUpload.uploadId } }));
  assert.equal(committedAsset.bytes, chunkedSize);
  assert.equal(committedAsset.sha256, chunkedDigest);
  const abortedUpload = toolResult(await request("tools/call", { name: "exi_asset_begin", arguments: { path: `${scaffoldRelative}/assets/aborted.png`, size: 1 } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_asset_abort", arguments: { uploadId: abortedUpload.uploadId } })).aborted, true);
  const assetsAfterChunk = toolResult(await request("tools/call", { name: "exi_asset_list", arguments: { path: scaffoldRelative } }));
  assert.ok(assetsAfterChunk.assets.some((asset) => asset.path === `${scaffoldRelative}/assets/large.ktx2` && asset.bytes === chunkedSize));
  assert.ok(!assetsAfterChunk.assets.some((asset) => asset.path === `${scaffoldRelative}/assets/aborted.png`));
  const deniedAsset = await request("tools/call", { name: "exi_asset_write", arguments: { path: `${scaffoldRelative}/assets/player.exe`, bytes: { $bytes: [1, 2, 3] } } });
  assert.equal(deniedAsset.result.isError, true);
  const scaffoldGame = await readFile(path.join(scaffoldPath, "game.js"), "utf8");
  const authoredGame = `${scaffoldGame}\n// AI-authored gameplay marker\n`;
  const authoredGameWrite = toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/game.js`, content: authoredGame, overwrite: true } }));
  assert.equal(authoredGameWrite.overwritten, true);
  assert.equal(await readFile(path.join(scaffoldPath, "game.js"), "utf8"), authoredGame);
  const patchedGame = toolResult(await request("tools/call", { name: "exi_file_patch", arguments: { path: `${scaffoldRelative}/game.js`, find: "// AI-authored gameplay marker", replace: "// AI-authored gameplay marker\nconst PATCHED = true;" } }));
  assert.equal(patchedGame.matchCount, 1);
  assert.match(await readFile(path.join(scaffoldPath, "game.js"), "utf8"), /const PATCHED = true/);
  const patchedGameSource = authoredGame.replace("// AI-authored gameplay marker", "// AI-authored gameplay marker\nconst PATCHED = true;");
  const patchNotFound = await request("tools/call", { name: "exi_file_patch", arguments: { path: `${scaffoldRelative}/game.js`, find: "// missing patch", replace: "never" } });
  assert.equal(patchNotFound.result.isError, true);
  assert.match(patchNotFound.result.content[0].text, /EXI_MCP_PATCH_NOT_FOUND/);
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/ambiguous.txt`, content: "const marker = true;\nconst other = \"const marker = true;\";\n" } }));
  const patchAmbiguous = await request("tools/call", { name: "exi_file_patch", arguments: { path: `${scaffoldRelative}/ambiguous.txt`, find: "const marker = true;", replace: "const marker = false;" } });
  assert.equal(patchAmbiguous.result.isError, true);
  assert.match(patchAmbiguous.result.content[0].text, /EXI_MCP_PATCH_AMBIGUOUS/);
  const htmlCheck = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/index.html` } }));
  assert.equal(htmlCheck.kind, "html");
  assert.equal(htmlCheck.ok, true, htmlCheck.stderr);
  assert.ok(htmlCheck.references.includes(`${scaffoldRelative}/game.js`));
  const projectCheck = toolResult(await request("tools/call", { name: "exi_project_check", arguments: { path: scaffoldRelative } }));
  assert.equal(projectCheck.ok, true, JSON.stringify(projectCheck));
  assert.equal(projectCheck.checked, 3);
  const validScaffoldGame = await readFile(path.join(scaffoldPath, "game.js"), "utf8");
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/game.js`, content: "export const broken = ;\n", overwrite: true } }));
  const rejectedProjectPreview = toolResult(await request("tools/call", { name: "exi_project_preview", arguments: { path: scaffoldRelative } }));
  assert.equal(rejectedProjectPreview.ok, false);
  assert.equal(rejectedProjectPreview.phase, "project-check");
  assert.equal(rejectedProjectPreview.preview, null);
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/game.js`, content: validScaffoldGame, overwrite: true } }));
  const projectPreview = toolResult(await request("tools/call", { name: "exi_project_preview", arguments: { path: scaffoldRelative } }));
  assert.equal(projectPreview.ok, true);
  assert.equal(projectPreview.phase, "preview");
  assert.equal(projectPreview.projectCheck.checked, 3);
  assert.equal(projectPreview.preview.pagePath, `/${scaffoldRelative}/index.html`);
  assert.equal(toolResult(await request("tools/call", { name: "exi_preview_probe", arguments: { previewId: projectPreview.preview.previewId, path: projectPreview.preview.pagePath } })).status, 200);
  const projectStatus = toolResult(await request("tools/call", { name: "exi_project_status", arguments: { path: scaffoldRelative } }));
  assert.equal(projectStatus.ok, true, JSON.stringify(projectStatus));
  assert.equal(projectStatus.projectCheck.checked, 3);
  assert.ok(projectStatus.files.some((file) => file.path === `${scaffoldRelative}/game.js`));
  assert.ok(projectStatus.assets.some((asset) => asset.path === `${scaffoldRelative}/assets/player.png`));
  assert.equal(projectStatus.previews.length, 1);
  assert.equal(projectStatus.previews[0].previewId, projectPreview.preview.previewId);
  assert.equal(projectStatus.previews[0].pagePath, `/${scaffoldRelative}/index.html`);
  assert.equal(projectStatus.previews[0].ready, true);
  assert.equal(projectStatus.previews[0].runtime.ok, false);
  toolResult(await request("tools/call", { name: "exi_preview_stop", arguments: { previewId: projectPreview.preview.previewId } }));
  const applyVersionPath = `${scaffoldRelative}/src/generated/apply-version.js`;
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: applyVersionPath, content: "export const applyInitial = true;\n" } }));
  const applyVersionRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: applyVersionPath } }));
  const externalApplyContent = "export const externalApplyChange = true;\n";
  await writeFile(path.join(scaffoldPath, "src", "generated", "apply-version.js"), externalApplyContent, "utf8");
  const staleApply = await request("tools/call", { name: "exi_project_apply", arguments: { path: scaffoldRelative, overwrite: true, files: [{ path: "src/generated/apply-version.js", content: "export const staleApply = true;\n", expectedVersion: applyVersionRead.version }] } });
  assert.equal(staleApply.result.isError, true);
  assert.match(staleApply.result.content[0].text, /EXI_MCP_FILE_CONFLICT/);
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "apply-version.js"), "utf8"), externalApplyContent);
  const staleChunkPath = `${scaffoldRelative}/src/generated/stale-chunk.js`;
  const staleChunkInitial = "export const chunkInitial = true;\n";
  const staleChunkNext = "export const chunkNext = true;\n";
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: staleChunkPath, content: staleChunkInitial } }));
  const staleChunkRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: staleChunkPath } }));
  const staleChunkUpload = toolResult(await request("tools/call", { name: "exi_file_begin", arguments: { path: staleChunkPath, size: Buffer.byteLength(staleChunkNext, "utf8"), overwrite: true, expectedVersion: staleChunkRead.version } }));
  toolResult(await request("tools/call", { name: "exi_file_chunk", arguments: { fileUploadId: staleChunkUpload.fileUploadId, offset: 0, content: staleChunkNext } }));
  await writeFile(path.join(scaffoldPath, "src", "generated", "stale-chunk.js"), "export const externalChunkChange = true;\n", "utf8");
  const staleChunkCommit = await request("tools/call", { name: "exi_file_commit", arguments: { fileUploadId: staleChunkUpload.fileUploadId } });
  assert.equal(staleChunkCommit.result.isError, true);
  assert.match(staleChunkCommit.result.content[0].text, /EXI_MCP_FILE_CONFLICT/);
  assert.equal(toolResult(await request("tools/call", { name: "exi_file_abort", arguments: { fileUploadId: staleChunkUpload.fileUploadId } })).aborted, true);
  const originalGenerated = "export const original = true;\n";
  const replacementGenerated = "export const replacement = true;\n";
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/src/generated/replaced.js`, content: originalGenerated } }));
  const replacementFile = toolResult(await request("tools/call", { name: "exi_file_begin", arguments: { path: `${scaffoldRelative}/src/generated/replaced.js`, size: Buffer.byteLength(replacementGenerated, "utf8"), overwrite: true } }));
  toolResult(await request("tools/call", { name: "exi_file_chunk", arguments: { fileUploadId: replacementFile.fileUploadId, offset: 0, content: replacementGenerated } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_file_commit", arguments: { fileUploadId: replacementFile.fileUploadId } })).overwritten, true);
  assert.equal(await readFile(path.join(scaffoldPath, "src", "generated", "replaced.js"), "utf8"), replacementGenerated);
  const batchedFileContent = "export const batched = true;\n";
  const batchedFileFlow = toolResult(await request("tools/call", { name: "exi_batch", arguments: { calls: [
    { name: "exi_file_begin", arguments: { path: `${scaffoldRelative}/src/generated/batched.js`, size: Buffer.byteLength(batchedFileContent, "utf8") } },
    { name: "exi_file_chunk", arguments: { fileUploadId: { $result: 0, $path: "fileUploadId" }, offset: 0, content: batchedFileContent } },
    { name: "exi_file_commit", arguments: { fileUploadId: { $result: 0, $path: "fileUploadId" } } },
  ] } }));
  assert.equal(batchedFileFlow.completed, 3);
  assert.equal(batchedFileFlow.failed, 0);
  assert.equal((await readFile(path.join(scaffoldPath, "src", "generated", "batched.js"), "utf8")), batchedFileContent);
  const largeSource = `export const generated = true;\n/*${"x".repeat(119_000)}*/\n`;
  const largeDigest = sha256(Buffer.from(largeSource, "utf8"));
  const largeFileBegin = toolResult(await request("tools/call", { name: "exi_file_begin", arguments: { path: `${scaffoldRelative}/src/generated/large.js`, size: Buffer.byteLength(largeSource, "utf8"), expectedSha256: largeDigest } }));
  assert.match(largeFileBegin.fileUploadId, /^f[0-9]+$/);
  const largeChunks = [largeSource.slice(0, 40_000), largeSource.slice(40_000, 80_000), largeSource.slice(80_000)];
  let largeOffset = 0;
  for (const largeChunk of largeChunks) {
    const largeChunkResult = toolResult(await request("tools/call", { name: "exi_file_chunk", arguments: { fileUploadId: largeFileBegin.fileUploadId, offset: largeOffset, content: largeChunk } }));
    largeOffset = largeChunkResult.receivedBytes;
  }
  const largeFileCommit = toolResult(await request("tools/call", { name: "exi_file_commit", arguments: { fileUploadId: largeFileBegin.fileUploadId } }));
  assert.equal(largeFileCommit.bytes, Buffer.byteLength(largeSource, "utf8"));
  assert.equal(largeFileCommit.sha256, largeDigest);
  const badDigestSource = "export const badDigest = true;\n";
  const badDigestUpload = toolResult(await request("tools/call", { name: "exi_file_begin", arguments: { path: `${scaffoldRelative}/src/generated/bad-digest.js`, size: Buffer.byteLength(badDigestSource, "utf8"), expectedSha256: "f".repeat(64) } }));
  toolResult(await request("tools/call", { name: "exi_file_chunk", arguments: { fileUploadId: badDigestUpload.fileUploadId, offset: 0, content: badDigestSource } }));
  const badDigestCommit = await request("tools/call", { name: "exi_file_commit", arguments: { fileUploadId: badDigestUpload.fileUploadId } });
  assert.equal(badDigestCommit.result.isError, true);
  assert.match(badDigestCommit.result.content[0].text, /EXI_MCP_UPLOAD_INTEGRITY/);
  assert.equal(toolResult(await request("tools/call", { name: "exi_file_abort", arguments: { fileUploadId: badDigestUpload.fileUploadId } })).aborted, true);
  await assert.rejects(() => stat(path.join(scaffoldPath, "src", "generated", "bad-digest.js")));
  const largePage1 = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/src/generated/large.js`, offset: 0, limit: 48 * 1024 } }));
  assert.equal(largePage1.complete, false);
  const largePage2 = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/src/generated/large.js`, offset: largePage1.nextOffset, limit: 48 * 1024 } }));
  const largePage3 = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/src/generated/large.js`, offset: largePage2.nextOffset, limit: 48 * 1024 } }));
  assert.equal(largePage3.complete, true);
  assert.equal(largePage1.content + largePage2.content + largePage3.content, largeSource);
  const largeSyntax = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/src/generated/large.js` } }));
  assert.equal(largeSyntax.ok, true, largeSyntax.stderr);
  const abortedFileUpload = toolResult(await request("tools/call", { name: "exi_file_begin", arguments: { path: `${scaffoldRelative}/src/generated/aborted.js`, size: 4 } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_file_abort", arguments: { fileUploadId: abortedFileUpload.fileUploadId } })).aborted, true);
  await assert.rejects(() => stat(path.join(scaffoldPath, "src", "generated", "aborted.js")));
  await stat(path.join(scaffoldPath, "game.js"));
  assert.match(authoredGame, /engine\.start\(\)/);
  assert.match(authoredGame, /new Graphics/);
  assert.match(authoredGame, /#exi-runtime/);
  assert.match(authoredGame, /getInfo\(\)/);
  const bridgeRead = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/game.js` } }));
  assert.equal(bridgeRead.content, patchedGameSource);
  const gameSyntax = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/game.js` } }));
  assert.equal(gameSyntax.kind, "javascript");
  assert.equal(gameSyntax.ok, true, gameSyntax.stderr);
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/config.json`, content: '{"quality":"high"}\n' } }));
  const jsonSyntax = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/config.json` } }));
  assert.equal(jsonSyntax.kind, "json");
  assert.equal(jsonSyntax.ok, true, jsonSyntax.stderr);
  const nestedSource = "export const ready = true;\n";
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/src/game/main.js`, content: nestedSource } }));
  const nestedSyntax = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/src/game/main.js` } }));
  assert.equal(nestedSyntax.ok, true, nestedSyntax.stderr);
  assert.equal((await readFile(path.join(scaffoldPath, "src", "game", "main.js"), "utf8")), nestedSource);
  const listedFiles = toolResult(await request("tools/call", { name: "exi_file_list", arguments: { path: scaffoldRelative } }));
  assert.ok(listedFiles.files.some((file) => file.path === `${scaffoldRelative}/src/game/main.js`));
  assert.ok(listedFiles.files.some((file) => file.path === `${scaffoldRelative}/config.json`));
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/broken.html`, content: '<script type="module" src="./missing.js"></script>\n' } }));
  const brokenHTML = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/broken.html` } }));
  assert.equal(brokenHTML.kind, "html");
  assert.equal(brokenHTML.ok, false);
  const brokenProjectCheck = toolResult(await request("tools/call", { name: "exi_project_check", arguments: { path: scaffoldRelative } }));
  assert.equal(brokenProjectCheck.ok, false);
  assert.ok(brokenProjectCheck.failures.some((failure) => failure.path.endsWith("/broken.html")));
  const assetPreview = toolResult(await request("tools/call", { name: "exi_preview_start", arguments: { path: `/${scaffoldRelative}/index.html` } }));
  previewId = assetPreview.previewId;
  const inferredProjectStatus = toolResult(await request("tools/call", { name: "exi_project_status", arguments: { path: scaffoldRelative } }));
  assert.ok(inferredProjectStatus.previews.some((preview) => preview.previewId === previewId && preview.directory === scaffoldRelative), JSON.stringify(inferredProjectStatus));
  const generatedGameProbe = toolResult(await request("tools/call", { name: "exi_preview_probe", arguments: { previewId, path: `/${scaffoldRelative}/index.html` } }));
  assert.equal(generatedGameProbe.status, 200);
  assert.match(generatedGameProbe.body, /id="exi-runtime"/);
  const generatedGameSource = toolResult(await request("tools/call", { name: "exi_preview_probe", arguments: { previewId, path: `/${scaffoldRelative}/game.js` } }));
  assert.match(generatedGameSource.body, /RuntimeAgent/);
  assert.match(generatedGameSource.body, /\/src\/ai\/runtime-agent\.js/);
  assert.match(generatedGameSource.body, /runtimeCallbacks/);
  assert.match(generatedGameSource.body, /\$callback/);
  const uploadedAssetProbe = toolResult(await request("tools/call", { name: "exi_preview_probe", arguments: { previewId, path: `/${scaffoldRelative}/assets/player.png` } }));
  assert.equal(uploadedAssetProbe.contentType, "image/png");
  const assetLoader = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "AssetLoader", args: [{ baseURL: assetPreview.url }] } }));
  const loadedUploadedAsset = toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: assetLoader.$handle, method: "loadBytes", args: [`${scaffoldRelative}/assets/player.png`] } }));
  assert.equal(loadedUploadedAsset.type, "Uint8Array");
  assert.equal(loadedUploadedAsset.length, uploadedAssetBytes.length);
  assert.equal(loadedUploadedAsset.byteLength, uploadedAssetBytes.length);
  assert.equal(loadedUploadedAsset.bytes.$bytes, Buffer.from(uploadedAssetBytes).toString("base64"));
  assert.deepEqual(loadedUploadedAsset.sample, Array.from(uploadedAssetBytes.slice(0, 16)));
  const loadedChunkedAsset = toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: assetLoader.$handle, method: "loadBytes", args: [`${scaffoldRelative}/assets/large.ktx2`] } }));
  assert.equal(loadedChunkedAsset.type, "Uint8Array");
  assert.equal(loadedChunkedAsset.length, chunkedSize);
  assert.equal(loadedChunkedAsset.byteLength, chunkedSize);
  assert.deepEqual(loadedChunkedAsset.bytes, { truncated: true, maxInlineBytes: 32 * 1024 });
  const typedResultBatch = toolResult(await request("tools/call", { name: "exi_batch", arguments: { calls: [
    { name: "exi_call", arguments: { handle: assetLoader.$handle, method: "loadBytes", args: [`${scaffoldRelative}/assets/player.png`] } },
    { name: "exi_function", arguments: { name: "inspectKTX2", args: [{ $result: 0, $path: "bytes" }] } },
  ], stopOnError: false } }));
  assert.equal(typedResultBatch.completed, 1);
  assert.equal(typedResultBatch.failed, 1);
  assert.match(typedResultBatch.results[1].error, /KTX2/);
  const loadedProjectJSON = toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: assetLoader.$handle, method: "loadJSON", args: [`${scaffoldRelative}/config.json`] } }));
  assert.equal(loadedProjectJSON.quality, "high");
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: assetLoader.$handle } }));
  toolResult(await request("tools/call", { name: "exi_preview_stop", arguments: { previewId } }));
  previewId = null;
  const deepJson = `${"[".repeat(40)}0${"]".repeat(40)}\n`;
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/deep.json`, content: deepJson } }));
  const deepSyntax = await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/deep.json` } });
  assert.equal(deepSyntax.result.isError, true);
  assert.match(deepSyntax.result.content[0].text, /EXI_MCP_FILE_LIMIT/);
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/broken.js`, content: "const = broken\n" } }));
  const brokenSyntax = toolResult(await request("tools/call", { name: "exi_file_check", arguments: { path: `${scaffoldRelative}/broken.js` } }));
  assert.equal(brokenSyntax.kind, "javascript");
  assert.equal(brokenSyntax.ok, false);
  toolResult(await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/agent-note.md`, content: "# agent note\n" } }));
  const bridgeWrite = toolResult(await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/agent-note.md` } }));
  assert.equal(bridgeWrite.content, "# agent note\n");
  const deniedProjectFile = await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/.env` } });
  assert.equal(deniedProjectFile.result.isError, true);
  const deniedBinaryFile = await request("tools/call", { name: "exi_file_write", arguments: { path: `${scaffoldRelative}/sprite.png`, content: "not an image" } });
  assert.equal(deniedBinaryFile.result.isError, true);
  await mkdir(conflictPath, { recursive: true });
  await writeFile(path.join(conflictPath, "game.js"), "sentinel", "utf8");
  const scaffoldConflict = await request("tools/call", { name: "exi_scaffold", arguments: { directory: conflictRelative } });
  assert.equal(scaffoldConflict.result.isError, true);
  await assert.rejects(stat(path.join(conflictPath, "index.html")));
  assert.equal(await readFile(path.join(conflictPath, "game.js"), "utf8"), "sentinel");
  const overwrittenScaffold = toolResult(await request("tools/call", { name: "exi_scaffold", arguments: { directory: conflictRelative, overwrite: true } }));
  assert.equal(overwrittenScaffold.files.length, 3);
  assert.notEqual(await readFile(path.join(conflictPath, "game.js"), "utf8"), "sentinel");
  await stat(path.join(conflictPath, "index.html"));
  await stat(path.join(conflictPath, "README.md"));
  const traversal = await request("tools/call", { name: "exi_scaffold", arguments: { directory: "../mcp-escape" } });
  assert.equal(traversal.result.isError, true);
  const protectedScaffold = await request("tools/call", { name: "exi_scaffold", arguments: { directory: "src/ai-game" } });
  assert.equal(protectedScaffold.result.isError, true);
  const rootScaffold = await request("tools/call", { name: "exi_scaffold", arguments: { directory: "." } });
  assert.equal(rootScaffold.result.isError, true);
  const protectedOpen = await request("tools/call", { name: "exi_project_open", arguments: { path: "src" } });
  assert.equal(protectedOpen.result.isError, true);
  const rootOpen = await request("tools/call", { name: "exi_project_open", arguments: { path: "." } });
  assert.equal(rootOpen.result.isError, true);
  const invalidMethod = await request("tools/call", { name: "exi_call", arguments: { handle: scene.$handle, method: "_private" } });
  assert.equal(invalidMethod.result.isError, true);
  const objectPrototypeMethod = await request("tools/call", { name: "exi_call", arguments: { handle: scene.$handle, method: "toString" } });
  assert.equal(objectPrototypeMethod.result.isError, true);
  const destroyedNode = toolResult(await request("tools/call", { name: "exi_create", arguments: { type: "Node" } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_call", arguments: { handle: destroyedNode.$handle, method: "destroy" } })), null);
  toolResult(await request("tools/call", { name: "exi_export_get", arguments: { path: "Texture.white" } }));
  const resetPreview = toolResult(await request("tools/call", { name: "exi_preview_start", arguments: {} }));
  const sessionBeforeReset = toolResult(await request("tools/call", { name: "exi_session_status", arguments: {} }));
  assert.ok(sessionBeforeReset.handleCount > 0);
  assert.ok(sessionBeforeReset.previews.some((preview) => preview.previewId === resetPreview.previewId));
  const resetResult = toolResult(await request("tools/call", { name: "exi_session_reset", arguments: {} }));
  assert.equal(resetResult.released, true);
  await assert.rejects(() => fetch(resetPreview.url));
  const sessionAfterReset = toolResult(await request("tools/call", { name: "exi_session_status", arguments: {} }));
  assert.equal(sessionAfterReset.handleCount, 0);
  assert.equal(sessionAfterReset.protectedHandleCount, 0);
  assert.deepEqual(sessionAfterReset.scopes, []);
  assert.deepEqual(sessionAfterReset.previews, []);
  const resetScope = await request("tools/call", { name: "exi_file_read", arguments: { path: `${scaffoldRelative}/game.js` } });
  assert.equal(resetScope.result.isError, true);
  const freshWhite = toolResult(await request("tools/call", { name: "exi_export_get", arguments: { path: "Texture.white" } }));
  assert.equal(toolResult(await request("tools/call", { name: "exi_get", arguments: { handle: freshWhite.$handle, property: "destroyed" } })), false);
  toolResult(await request("tools/call", { name: "exi_release", arguments: { handle: freshWhite.$handle } }));

  console.log("ExiEngine MCP smoke: passed");
} finally {
  runtimeAgent?.stop();
  await rm(scaffoldPath, { recursive: true, force: true });
  await rm(modernPath, { recursive: true, force: true });
  await rm(conflictPath, { recursive: true, force: true });
  await rm(openPath, { recursive: true, force: true });
  await rm(notesPath, { recursive: true, force: true });
  if (previewId) {
    try { await request("tools/call", { name: "exi_preview_stop", arguments: { previewId } }); } catch { /* cleanup best effort */ }
  }
  child.kill();
  stdout.close();
  for (const waiter of pending.values()) waiter.reject(new Error("MCP process closed"));
}
