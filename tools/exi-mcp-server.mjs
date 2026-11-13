import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, lstat, mkdir, open as openFile, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isAgentCallableExport, isPublicMethod } from "../src/ai/public-methods.js";
import * as engineExports from "../src/index.js";

const configuredRoot = process.env.EXI_MCP_ROOT || process.env.CLAUDE_PROJECT_DIR;
const ROOT = path.resolve(configuredRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SERVER_VERSION = "0.3.0"; // keep in sync with package.json (checked by test/static-smoke.mjs)
const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const PROTOCOL_VERSION = MODERN_PROTOCOL_VERSION;
const SUPPORTED_PROTOCOLS = Object.freeze([MODERN_PROTOCOL_VERSION, LEGACY_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05"]);
const LEGACY_PROTOCOL_SET = new Set(SUPPORTED_PROTOCOLS.filter((version) => version !== MODERN_PROTOCOL_VERSION));
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_VALUE_DEPTH = 32;
const MAX_VALUE_KEYS = 128;
const MAX_VALUE_ITEMS = 4096;
const MAX_STRING_LENGTH = 64 * 1024;
const MAX_BINARY_BYTES = 512 * 1024;
const MAX_ASSET_READ_BYTES = 32 * 1024;
const MAX_BASE64_STRING_LENGTH = Math.ceil(MAX_BINARY_BYTES / 3) * 4;
const MAX_CHUNKED_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_ASSET_UPLOADS = 8;
const MAX_UPLOAD_IDLE_MS = 15 * 60_000;
const MAX_PROJECT_FILE_BYTES = 64 * 1024;
const MAX_PROJECT_PATCH_TEXT_BYTES = 64 * 1024;
const MAX_PROJECT_APPLY_FILES = 16;
const MAX_PROJECT_APPLY_BYTES = 512 * 1024;
const MAX_PROJECT_READ_BYTES = 48 * 1024;
const MAX_CHUNKED_PROJECT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PENDING_PROJECT_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_FILE_UPLOADS = 8;
const MAX_PROJECT_FILE_CHUNK_BYTES = 48 * 1024;
const MAX_PROJECT_JSON_NODES = 16_384;
const MAX_PROJECT_JSON_DEPTH = 32;
const MAX_PROJECT_LIST_ENTRIES = 1_024;
const MAX_PROJECT_DEPTH = 32;
const MAX_PROJECT_CHECK_FILES = 128;
const MAX_PROJECT_CHECK_FAILURES = 32;
const MAX_PROJECT_CHECK_ERROR_BYTES = 1_024;
const MAX_HANDLES = 4096;
const MAX_SCENE_NODES = 1024;
const MAX_SCENE_DEPTH = 32;
const MAX_OUTPUT_BYTES = 64 * 1024;
// exi_api returns the engine's own reflection manifest (no caller or project
// data), which grows with the public API; it gets a separate, larger bound.
const MAX_API_OUTPUT_BYTES = 256 * 1024;
const MAX_RUNTIME_TELEMETRY_BYTES = 4 * 1024;
const MAX_RUNTIME_COMMAND_BYTES = 768 * 1024;
const MAX_RUNTIME_RESULT_BYTES = 64 * 1024;
const MAX_RUNTIME_COMMAND_WAIT_MS = 10_000;
const MAX_RUNTIME_BATCH_CALLS = 8;
const MAX_INLINE_BINARY_BYTES = 32 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024;
const MAX_PREVIEWS = 4;
const MAX_PREVIEW_STARTUP_MS = 10_000;
const handles = new Map();
const objectHandles = new WeakMap();
const protectedHandles = new Set();
const previews = new Map();
const scaffoldDirectories = new Set();
const assetUploads = new Map();
const projectFileUploads = new Map();
const activeRequests = new Map();
let nextHandleId = 1;
let nextPreviewId = 1;
let nextAssetUploadId = 1;
let nextProjectFileUploadId = 1;
let nextWriteId = 1;
let nextRuntimeCommandId = 1;
let toolQueue = Promise.resolve();

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const sceneSpecFields = new Set(["type", "options", "children"]);
const protectedObjects = new WeakSet();
for (const exported of Object.values(engineExports)) {
  if (typeof exported !== "function") continue;
  for (const property of Object.getOwnPropertyNames(exported)) {
    if (["length", "name", "prototype", "caller", "arguments"].includes(property)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(exported, property);
    if (descriptor && "value" in descriptor && descriptor.value && typeof descriptor.value === "object") protectedObjects.add(descriptor.value);
  }
}

function fail(message, code = "EXI_MCP_INPUT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function cancellationError() {
  const error = new Error("MCP request was cancelled.");
  error.code = "EXI_MCP_CANCELLED";
  return error;
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw cancellationError();
}

function isProgressToken(value) {
  return (typeof value === "string" && value.length > 0 && value.length <= 256) || (Number.isSafeInteger(value) && value >= 0);
}

function sendProgress(progressToken, progress, total, message) {
  if (!isProgressToken(progressToken)) return;
  send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken, progress, ...(total === undefined ? {} : { total }), ...(message ? { message } : {}) } });
}

function assertPublicName(value, label) {
  if (typeof value !== "string" || !value || value.length > 256 || value.startsWith("_") || forbiddenKeys.has(value)) fail(`${label} is invalid.`);
  return value;
}

function assertSafeData(value, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail("Request data depth limit exceeded.");
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) fail("Request text limit exceeded.");
    return value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("Request number must be finite.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_VALUE_ITEMS) fail("Request array limit exceeded.");
    for (const item of value) assertSafeData(item, depth + 1);
    return value;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && Object.hasOwn(value, "$bytes")) {
      if (Array.isArray(value.$bytes)) {
        if (value.$bytes.length > MAX_BINARY_BYTES) fail("Byte array limit exceeded.");
        for (const byte of value.$bytes) {
          if (!Number.isInteger(byte) || byte < 0 || byte > 255) fail("Byte array must only contain integers 0..255.");
        }
      } else if (typeof value.$bytes === "string") {
        if (value.$bytes.length > MAX_BASE64_STRING_LENGTH) fail("Base64 byte text limit exceeded.");
      } else fail("$bytes must be base64 text or a byte array.");
      return value;
    }
    if (keys.length > MAX_VALUE_KEYS) fail("Request object field limit exceeded.");
    for (const key of keys) {
      if (forbiddenKeys.has(key)) fail(`Unsafe field name: ${key}`);
      assertSafeData(value[key], depth + 1);
    }
    return value;
  }
  fail("Request may only contain JSON data.");
}

function resolvePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.length > 240 || path.isAbsolute(relativePath)) fail("Path must be relative to the repository root.");
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..")) fail("Path escaping the repository was rejected.");
  const resolved = path.resolve(ROOT, normalized);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) fail("Path is outside the repository bounds.");
  return { resolved, relative: path.relative(ROOT, resolved).replaceAll("\\", "/") };
}

async function assertSafeScaffoldTarget(target, fileNames) {
  let current = ROOT;
  for (const segment of target.relative.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Scaffold cannot write through a symlink.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Scaffold path must be a directory.");
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  for (const fileName of fileNames) {
    const filePath = path.join(target.resolved, fileName);
    try {
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink()) fail("Scaffold cannot write through a symlink.", "EXI_MCP_PATH_LINK");
      if (!entry.isFile()) fail(`Scaffold target must be a file: ${fileName}`);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
  }
}

function isClass(value) {
  return typeof value === "function" && Function.prototype.toString.call(value).startsWith("class ");
}

const projectFileExtensions = new Set([".css", ".html", ".js", ".json", ".mjs", ".md", ".svg", ".ts", ".txt"]);
const assetFileExtensions = new Set([".aac", ".avif", ".bmp", ".flac", ".gif", ".jpeg", ".jpg", ".ktx2", ".m4a", ".mp3", ".ogg", ".otf", ".png", ".ttf", ".wav", ".webp", ".woff", ".woff2"]);
const syntaxCheckExtensions = new Set([".js", ".mjs"]);
const htmlCheckExtensions = new Set([".html"]);

function assertProjectJSONBudget(text) {
  let depth = 0;
  let nodes = 0;
  let inString = false;
  let escaped = false;
  const recordNode = () => {
    nodes += 1;
    if (nodes > MAX_PROJECT_JSON_NODES) fail("Project JSON node limit exceeded.", "EXI_MCP_FILE_LIMIT");
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      recordNode();
      continue;
    }
    if (character === " " || character === "\n" || character === "\r" || character === "\t" || character === "," || character === ":") continue;
    if (character === "{" || character === "[") {
      depth += 1;
      if (depth > MAX_PROJECT_JSON_DEPTH) fail("Project JSON depth limit exceeded.", "EXI_MCP_FILE_LIMIT");
      recordNode();
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) fail("Project JSON structure is invalid.", "EXI_MCP_FILE_TYPE");
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9") || character === "t" || character === "f" || character === "n") {
      recordNode();
      while (index + 1 < text.length && ![" ", "\n", "\r", "\t", ",", "]", "}"].includes(text[index + 1])) index += 1;
    }
  }
}

function resolveProjectFile(relativePath) {
  const target = resolvePath(relativePath);
  if (target.resolved === ROOT) fail("Project file cannot be the repository root.");
  const name = path.basename(target.relative).toLowerCase();
  if (name.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(name)) fail("Secret/credential files cannot be opened with the MCP file tools.", "EXI_MCP_FILE_DENIED");
  if (!projectFileExtensions.has(path.extname(name))) fail("Only allowlisted text files can be used.", "EXI_MCP_FILE_TYPE");
  return target;
}

function resolveAssetFile(relativePath) {
  const target = resolvePath(relativePath);
  if (target.resolved === ROOT) fail("Asset file cannot be the repository root.");
  const name = path.basename(target.relative).toLowerCase();
  if (name.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(name)) fail("Secret/credential assets cannot be opened over MCP.", "EXI_MCP_FILE_DENIED");
  if (!assetFileExtensions.has(path.extname(name))) fail("Only allowlisted game asset extensions can be used.", "EXI_MCP_FILE_TYPE");
  return target;
}

async function writeProjectTarget(target, data, existing) {
  const id = `w${nextWriteId++}`;
  const tempPath = `${target.resolved}.exi-write-${process.pid}-${id}`;
  try {
    await writeFile(tempPath, data, { flag: "wx" });
    return await replaceUploadedFile({ id, target, tempPath }, existing);
  } catch (error) {
    if (!error?.restoreError) {
      try { await unlink(tempPath); } catch { /* write cleanup remains best effort */ }
    }
    throw error;
  }
}

function assertScaffoldDirectory(target) {
  const firstSegment = target.relative.split("/")[0]?.toLowerCase();
  if ([".agents", ".codex", ".git", "src", "test", "tools"].includes(firstSegment)) fail("Scaffold cannot write to the engine/test/tool directories.", "EXI_MCP_FILE_DENIED");
}

function requireScaffoldFile(target) {
  if (!findScaffoldRoot(target) || !target.relative.includes("/")) fail("File tools only work in a scaffold project created in this session.", "EXI_MCP_FILE_SCOPE");
}

function findScaffoldRoot(target) {
  return [...scaffoldDirectories]
    .filter((directory) => target.relative === directory || target.relative.startsWith(`${directory}/`))
    .sort((left, right) => right.length - left.length)[0] || null;
}

function requireScaffoldDirectory(target) {
  if (!findScaffoldRoot(target)) fail("File tools only work in a scaffold project created in this session.", "EXI_MCP_FILE_SCOPE");
}

async function inspectProjectFile(target, { allowMissingParent = false } = {}) {
  const segments = target.relative.split("/");
  let current = ROOT;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Project file cannot be opened through a symlink.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Project file parent path must be a directory.");
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (allowMissingParent) return null;
        fail("Project file parent directory does not exist.", "EXI_MCP_FILE_PATH");
      }
      throw error;
    }
  }
  try {
    const entry = await lstat(target.resolved);
    if (entry.isSymbolicLink()) fail("Project file cannot be opened through a symlink.", "EXI_MCP_PATH_LINK");
    if (!entry.isFile()) fail("Project target must be a file.", "EXI_MCP_FILE_PATH");
    return entry;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function projectVersion(entry) {
  return entry ? { bytes: entry.size, mtimeMs: entry.mtimeMs } : null;
}

function normalizeExpectedSha256(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) fail(`${label} sha256 must be a 64-character hexadecimal string.`, "EXI_MCP_ARGUMENT_INVALID");
  return value.toLowerCase();
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSha256Match(expectedSha256, actualSha256, label) {
  if (expectedSha256 !== undefined && expectedSha256 !== actualSha256) fail(`${label} sha256 verification failed.`, "EXI_MCP_UPLOAD_INTEGRITY");
}

function assertExpectedVersion(existing, expectedVersion, label) {
  if (expectedVersion === undefined) return;
  if (!isRecord(expectedVersion) || !Number.isSafeInteger(expectedVersion.bytes) || expectedVersion.bytes < 0 || typeof expectedVersion.mtimeMs !== "number" || !Number.isFinite(expectedVersion.mtimeMs) || expectedVersion.mtimeMs < 0) {
    fail(`${label} expectedVersion must be { bytes, mtimeMs }.`, "EXI_MCP_ARGUMENT_INVALID");
  }
  if (!existing || existing.size !== expectedVersion.bytes || existing.mtimeMs !== expectedVersion.mtimeMs) {
    fail(`${label} changed before the call; retry with the current version.`, "EXI_MCP_FILE_CONFLICT");
  }
}

async function ensureProjectParent(target, createdDirectories = null) {
  const segments = target.relative.split("/").slice(0, -1);
  let current = ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Project file cannot be opened through a symlink.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Project file parent path must be a directory.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current);
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) fail("Project parent directory could not be created safely.", "EXI_MCP_PATH_LINK");
      createdDirectories?.push(current);
    }
  }
}

function isUtf8Continuation(byte) {
  return (byte & 0xc0) === 0x80;
}

function readUtf8Range(data, offset, limit) {
  if (offset < data.length && isUtf8Continuation(data[offset])) fail("file_read offset cannot be in the middle of a UTF-8 character.", "EXI_MCP_FILE_OFFSET");
  let end = Math.min(data.length, offset + limit);
  while (end < data.length && end > offset && isUtf8Continuation(data[end])) end -= 1;
  if (end === offset && offset < data.length) fail("file_read limit did not produce a valid UTF-8 range.", "EXI_MCP_FILE_OFFSET");
  try {
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(offset, end)), nextOffset: end };
  } catch {
    fail("Project file is not valid UTF-8.", "EXI_MCP_FILE_TYPE");
  }
}

async function readProjectFile(args = {}) {
  const { path: filePath } = args;
  const paged = Object.hasOwn(args, "offset") || Object.hasOwn(args, "limit");
  const offset = args.offset === undefined ? 0 : args.offset;
  const limit = args.limit === undefined ? (paged ? MAX_PROJECT_READ_BYTES : MAX_PROJECT_FILE_BYTES) : args.limit;
  if (!Number.isSafeInteger(offset) || offset < 0) fail("file_read offset must be a safe integer.", "EXI_MCP_FILE_OFFSET");
  const maxLimit = paged ? MAX_PROJECT_READ_BYTES : MAX_PROJECT_FILE_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maxLimit) fail(`file_read limit must be between 1 and ${maxLimit}.`, "EXI_MCP_FILE_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const entry = await inspectProjectFile(target);
  if (!entry) fail(`Project file not found: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  if (!paged && entry.size > MAX_PROJECT_READ_BYTES) fail(`For large files read at most ${MAX_PROJECT_READ_BYTES} bytes with offset/limit.`, "EXI_MCP_FILE_PAGING");
  const data = await readFile(target.resolved);
  if (data.byteLength > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  const current = await inspectProjectFile(target);
  if (!current || current.size !== entry.size || current.mtimeMs !== entry.mtimeMs || current.size !== data.byteLength) fail("Project file changed while reading; version could not be taken.", "EXI_MCP_FILE_CONFLICT");
  if (offset > data.byteLength) fail("file_read offset cannot exceed the file size.", "EXI_MCP_FILE_OFFSET");
  const range = readUtf8Range(data, offset, limit);
  return { path: target.relative, offset, nextOffset: range.nextOffset, totalBytes: data.byteLength, bytes: Buffer.byteLength(range.content, "utf8"), version: projectVersion(current), complete: range.nextOffset === data.byteLength, content: range.content };
}

async function listProjectFiles({ path: directoryPath } = {}) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Project directory cannot be the repository root.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const rootEntry = await lstat(target.resolved);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) fail("Project listing target must be a directory.", "EXI_MCP_FILE_PATH");
  const files = [];
  const visit = async (currentPath, currentRelative, depth) => {
    if (depth > MAX_PROJECT_DEPTH) fail("Project directory depth limit exceeded.", "EXI_MCP_FILE_LIMIT");
    const entries = (await readdir(currentPath)).sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const childPath = path.join(currentPath, name);
      const childRelative = `${currentRelative}/${name}`;
      const entry = await lstat(childPath);
      if (entry.isSymbolicLink()) fail("Project listing cannot go through a symlink.", "EXI_MCP_PATH_LINK");
      if (entry.isDirectory()) {
        await visit(childPath, childRelative, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(lowerName)) continue;
      if (!projectFileExtensions.has(path.extname(lowerName))) continue;
      files.push({ path: childRelative, bytes: entry.size, version: projectVersion(entry) });
      if (files.length > MAX_PROJECT_LIST_ENTRIES) fail("Project file listing limit exceeded.", "EXI_MCP_FILE_LIMIT");
    }
  };
  await visit(target.resolved, target.relative, 0);
  return { directory: target.relative, files };
}

async function listProjectAssets({ path: directoryPath } = {}) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Asset directory cannot be the repository root.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const rootEntry = await lstat(target.resolved);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) fail("Asset listing target must be a directory.", "EXI_MCP_FILE_PATH");
  const assets = [];
  const visit = async (currentPath, currentRelative, depth) => {
    if (depth > MAX_PROJECT_DEPTH) fail("Asset directory depth limit exceeded.", "EXI_MCP_FILE_LIMIT");
    const entries = (await readdir(currentPath)).sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const childPath = path.join(currentPath, name);
      const childRelative = `${currentRelative}/${name}`;
      const entry = await lstat(childPath);
      if (entry.isSymbolicLink()) fail("Asset listing cannot go through a symlink.", "EXI_MCP_PATH_LINK");
      if (entry.isDirectory()) {
        await visit(childPath, childRelative, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(lowerName)) continue;
      const extension = path.extname(lowerName);
      if (!assetFileExtensions.has(extension)) continue;
      assets.push({ path: childRelative, bytes: entry.size, type: extension.slice(1), version: projectVersion(entry) });
      if (assets.length > MAX_PROJECT_LIST_ENTRIES) fail("Asset listing limit exceeded.", "EXI_MCP_FILE_LIMIT");
    }
  };
  await visit(target.resolved, target.relative, 0);
  return { directory: target.relative, assets };
}

async function readProjectAsset({ path: filePath, offset = 0, limit = MAX_ASSET_READ_BYTES } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Asset read offset must be a safe integer.", "EXI_MCP_FILE_OFFSET");
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_ASSET_READ_BYTES) fail(`Asset read limit must be between 1 and ${MAX_ASSET_READ_BYTES}.`, "EXI_MCP_FILE_LIMIT");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const entry = await inspectProjectFile(target);
  if (!entry) fail(`Asset file not found: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_ASSET_BYTES) fail("Asset file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  if (offset > entry.size) fail("Asset read offset cannot exceed the file size.", "EXI_MCP_FILE_OFFSET");
  const length = Math.min(limit, entry.size - offset);
  const data = Buffer.alloc(length);
  const file = await openFile(target.resolved, "r");
  try {
    const { bytesRead } = await file.read(data, 0, length, offset);
    await file.close();
    const current = await inspectProjectFile(target);
    if (!current || current.size !== entry.size || current.mtimeMs !== entry.mtimeMs) fail("Asset changed while reading; version could not be taken.", "EXI_MCP_FILE_CONFLICT");
    return { path: target.relative, offset, nextOffset: offset + bytesRead, totalBytes: entry.size, bytes: bytesRead, version: projectVersion(current), complete: offset + bytesRead === entry.size, data: { $bytes: data.subarray(0, bytesRead).toString("base64") } };
  } finally {
    try { await file.close(); } catch { /* already closed or best-effort cleanup */ }
  }
}

async function writeProjectAsset({ path: filePath, bytes, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (typeof overwrite !== "boolean") fail("overwrite must be a boolean.");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Asset ${target.relative}`);
  const data = resolveArgument(bytes);
  if (!(data instanceof Uint8Array)) fail("Asset bytes must only be {$bytes: [...]} or {$bytes: base64}.");
  if (data.byteLength > MAX_BINARY_BYTES) fail("Asset byte limit exceeded.", "EXI_MCP_FILE_LIMIT");
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Asset ${target.relative}`);
  if (existing && !overwrite) fail(`Asset file already exists: ${target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = sha256Bytes(data);
  assertSha256Match(normalizedSha256, actualSha256, `Asset ${target.relative}`);
  const overwritten = await writeProjectTarget(target, data, existing);
  return { path: target.relative, bytes: data.byteLength, type: path.extname(target.relative).slice(1), sha256: actualSha256, overwritten };
}

function requireAssetUpload(uploadId) {
  if (typeof uploadId !== "string" || !/^u[1-9][0-9]*$/.test(uploadId) || !assetUploads.has(uploadId)) fail(`Asset upload not found: ${uploadId}`, "EXI_MCP_UPLOAD_NOT_FOUND");
  return assetUploads.get(uploadId);
}

function assertChunkedAssetSize(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CHUNKED_ASSET_BYTES) fail(`Chunked asset size must be a safe integer between 0 and ${MAX_CHUNKED_ASSET_BYTES}.`, "EXI_MCP_FILE_LIMIT");
  return value;
}

async function removeAssetUpload(upload) {
  if (!upload) return;
  assetUploads.delete(upload.id);
  try { await unlink(upload.tempPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function pruneAssetUploads() {
  const deadline = Date.now() - MAX_UPLOAD_IDLE_MS;
  for (const upload of [...assetUploads.values()]) {
    if ((upload.lastActivityAt || upload.createdAt || 0) >= deadline) continue;
    try { await removeAssetUpload(upload); } catch { /* stale upload cleanup is best effort */ }
  }
}

// Ghost temps from a previously killed process would make the next `wx` temp create fail with
// EEXIST forever, so every upload-begins/open unlinks untracked `.exi-upload-*` / `.exi-file-upload-*`
// leftovers in the affected directory. Tracked in-flight temps (and `.exi-backup-*`, a deliberate
// recovery affordance) are never touched.
async function sweepStaleUploadTemps(parentDir) {
  const protectedPaths = new Set();
  for (const upload of assetUploads.values()) protectedPaths.add(upload.tempPath);
  for (const upload of projectFileUploads.values()) protectedPaths.add(upload.tempPath);
  let entries;
  try { entries = await readdir(parentDir, { withFileTypes: true }); } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.exi-(?:upload|file-upload)-/.test(entry.name)) continue;
    const tempPath = path.join(parentDir, entry.name);
    if (protectedPaths.has(tempPath)) continue;
    try { await unlink(tempPath); } catch { /* stale temp cleanup is best effort */ }
  }
}

async function writeUploadTempExclusive(tempPath, data, options = {}) {
  const optionsWithFlag = { ...options, flag: "wx" };
  try {
    await writeFile(tempPath, data, optionsWithFlag);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try { await unlink(tempPath); } catch { throw error; }
    await writeFile(tempPath, data, optionsWithFlag);
  }
}

async function beginAssetUpload({ path: filePath, size, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  await pruneAssetUploads();
  if (assetUploads.size >= MAX_ASSET_UPLOADS) fail("Active asset upload limit exceeded.", "EXI_MCP_UPLOAD_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite must be a boolean.");
  const expectedBytes = assertChunkedAssetSize(size);
  const pendingBytes = [...assetUploads.values()].reduce((total, upload) => total + upload.expectedBytes, 0);
  if (pendingBytes + expectedBytes > MAX_PENDING_ASSET_BYTES) fail("Pending asset upload byte budget exceeded.", "EXI_MCP_UPLOAD_LIMIT");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Asset ${target.relative}`);
  await ensureProjectParent(target);
  await sweepStaleUploadTemps(path.dirname(target.resolved));
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Asset ${target.relative}`);
  if (existing && !overwrite) fail(`Asset file already exists: ${target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const id = `u${nextAssetUploadId++}`;
  const tempPath = `${target.resolved}.exi-upload-${process.pid}-${id}`;
  try {
    await writeUploadTempExclusive(tempPath, new Uint8Array());
    assetUploads.set(id, { id, target, tempPath, expectedBytes, receivedBytes: 0, state: expectedBytes === 0 ? "complete" : "receiving", createdAt: Date.now(), lastActivityAt: Date.now(), overwrite: Boolean(overwrite), expectedVersion, expectedSha256: normalizedSha256, hash: normalizedSha256 ? createHash("sha256") : null });
  } catch (error) {
    try { await unlink(tempPath); } catch { /* cleanup best effort */ }
    throw error;
  }
  return { uploadId: id, path: target.relative, expectedBytes, receivedBytes: 0, state: expectedBytes === 0 ? "complete" : "receiving", complete: expectedBytes === 0, chunkBytes: MAX_BINARY_BYTES, ...(normalizedSha256 ? { expectedSha256: normalizedSha256 } : {}) };
}

async function writeAssetChunk({ uploadId, offset, bytes } = {}) {
  await pruneAssetUploads();
  const upload = requireAssetUpload(uploadId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== upload.receivedBytes) fail("Asset chunk offset must equal the previous receivedBytes.", "EXI_MCP_UPLOAD_ORDER");
  const data = resolveArgument(bytes);
  if (!(data instanceof Uint8Array) || data.byteLength === 0) fail("Asset chunk must be a non-empty {$bytes: [...]} or {$bytes: base64}.");
  if (data.byteLength > MAX_BINARY_BYTES) fail("Single asset chunk byte limit exceeded.", "EXI_MCP_FILE_LIMIT");
  if (upload.receivedBytes + data.byteLength > upload.expectedBytes) fail("Asset chunk exceeds the expected total size.", "EXI_MCP_UPLOAD_SIZE");
  await appendFile(upload.tempPath, data);
  upload.hash?.update(data);
  // Disk is the authority: verify with lstat instead of the counter (same pattern as file upload — #105).
  const entry = await lstat(upload.tempPath);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size !== upload.receivedBytes + data.byteLength) fail("Asset upload size could not be verified.", "EXI_MCP_UPLOAD_SIZE");
  upload.receivedBytes = entry.size;
  upload.lastActivityAt = Date.now();
  upload.state = upload.receivedBytes === upload.expectedBytes ? "complete" : "receiving";
  return { uploadId, path: upload.target.relative, receivedBytes: upload.receivedBytes, expectedBytes: upload.expectedBytes, remainingBytes: upload.expectedBytes - upload.receivedBytes, complete: upload.state === "complete", state: upload.state };
}

async function replaceUploadedFile(upload, existing) {
  if (!existing) {
    await rename(upload.tempPath, upload.target.resolved);
    return false;
  }
  const backupPath = `${upload.target.resolved}.exi-backup-${process.pid}-${upload.id}`;
  await rename(upload.target.resolved, backupPath);
  try {
    await rename(upload.tempPath, upload.target.resolved);
  } catch (error) {
    try {
      await rename(backupPath, upload.target.resolved);
    } catch (restoreError) {
      error.restoreError = restoreError instanceof Error ? restoreError.message : String(restoreError);
    }
    throw error;
  }
  // ponytail: backup cleanup is best effort; preserve the old source rather than delete it if the filesystem is temporarily unavailable.
  try { await unlink(backupPath); } catch (error) { if (error?.code !== "ENOENT") { /* keep the private backup */ } }
  return true;
}

async function commitAssetUpload({ uploadId } = {}) {
  await pruneAssetUploads();
  const upload = requireAssetUpload(uploadId);
  if (upload.state !== "complete" || upload.receivedBytes !== upload.expectedBytes) fail(`Asset upload is not complete: ${upload.receivedBytes}/${upload.expectedBytes} bytes.`, "EXI_MCP_UPLOAD_INCOMPLETE");
  const tempEntry = await lstat(upload.tempPath);
  if (tempEntry.isSymbolicLink() || !tempEntry.isFile()) fail("Asset temporary upload file is not safe.", "EXI_MCP_PATH_LINK");
  const existing = await inspectProjectFile(upload.target);
  assertExpectedVersion(existing, upload.expectedVersion, `Asset ${upload.target.relative}`);
  if (existing && !upload.overwrite) fail(`Asset file already exists: ${upload.target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = upload.hash ? upload.hash.digest("hex") : null;
  assertSha256Match(upload.expectedSha256, actualSha256, `Asset ${upload.target.relative}`);
  const overwritten = await replaceUploadedFile(upload, existing);
  assetUploads.delete(upload.id);
  return { uploadId, path: upload.target.relative, bytes: upload.expectedBytes, type: path.extname(upload.target.relative).slice(1), ...(actualSha256 ? { sha256: actualSha256 } : {}), overwritten };
}

async function abortAssetUpload({ uploadId } = {}) {
  const upload = requireAssetUpload(uploadId);
  await removeAssetUpload(upload);
  return { uploadId, aborted: true };
}

async function checkHTMLReferences(target, content, signal) {
  const references = [];
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      throwIfCancelled(signal);
      const rawReference = match[1].trim();
      let reference;
      try { reference = decodeURIComponent(rawReference).split(/[?#]/, 1)[0]; }
      catch { return { ok: false, code: 1, stdout: "", stderr: `Invalid HTML asset URL: ${rawReference}` }; }
      if (!reference || reference.startsWith("#")) continue;
      if (/^(?:data|blob|javascript|https?):/i.test(reference)) {
        return { ok: false, code: 1, stdout: "", stderr: `HTML contains an external/executable reference: ${rawReference}` };
      }
      const relativeReference = reference.startsWith("/")
        ? reference.slice(1)
        : [...target.relative.split("/").slice(0, -1), ...reference.replaceAll("\\", "/").split("/")].join("/");
      let referencedTarget;
      try { referencedTarget = resolvePath(relativeReference); }
      catch (error) { return { ok: false, code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }; }
      const entry = await inspectProjectFile(referencedTarget);
      if (!entry) return { ok: false, code: 1, stdout: "", stderr: `HTML reference not found: ${referencedTarget.relative}` };
      references.push(referencedTarget.relative);
    }
  }
  return { ok: true, code: 0, stdout: "", stderr: "", references: [...new Set(references)].sort() };
}

async function writeProjectFile({ path: filePath, content, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (typeof content !== "string") fail("Project file content must be a string.");
  if (Buffer.byteLength(content, "utf8") > MAX_PROJECT_FILE_BYTES) fail("Project file size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite must be a boolean.");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Project file ${target.relative}`);
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Project file ${target.relative}`);
  if (existing && !overwrite) fail(`Project file already exists: ${target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = sha256Bytes(Buffer.from(content, "utf8"));
  assertSha256Match(normalizedSha256, actualSha256, `Project file ${target.relative}`);
  const overwritten = await writeProjectTarget(target, content, existing);
  return { path: target.relative, bytes: Buffer.byteLength(content, "utf8"), sha256: actualSha256, overwritten };
}

async function patchProjectFile({ path: filePath, find, replace } = {}) {
  if (typeof find !== "string" || find.length === 0) fail("Patch find must be a non-empty string.", "EXI_MCP_PATCH_MATCH");
  if (typeof replace !== "string") fail("Patch replace must be a string.", "EXI_MCP_PATCH_REPLACE");
  if (Buffer.byteLength(find, "utf8") > MAX_PROJECT_PATCH_TEXT_BYTES || Buffer.byteLength(replace, "utf8") > MAX_PROJECT_PATCH_TEXT_BYTES) fail("Patch find/replace byte limit exceeded.", "EXI_MCP_FILE_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const existing = await inspectProjectFile(target);
  if (!existing) fail(`Project file not found: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (existing.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  const data = await readFile(target.resolved);
  if (data.byteLength > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { fail("Project file is not valid UTF-8.", "EXI_MCP_FILE_TYPE"); }
  const matchIndex = content.indexOf(find);
  if (matchIndex < 0) fail(`Patch text not found: ${target.relative}`, "EXI_MCP_PATCH_NOT_FOUND");
  if (content.indexOf(find, matchIndex + find.length) >= 0) fail(`Patch text matched more than once: ${target.relative}`, "EXI_MCP_PATCH_AMBIGUOUS");
  const nextContent = `${content.slice(0, matchIndex)}${replace}${content.slice(matchIndex + find.length)}`;
  const nextBytes = Buffer.byteLength(nextContent, "utf8");
  if (nextBytes > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded after patch.", "EXI_MCP_FILE_LIMIT");
  const overwritten = await writeProjectTarget(target, nextContent, existing);
  return { path: target.relative, bytes: nextBytes, replacedBytes: Buffer.byteLength(replace, "utf8"), matchCount: 1, overwritten };
}

async function applyProjectFiles({ path: directoryPath, files, overwrite = false } = {}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PROJECT_APPLY_FILES) fail(`Project apply must have between 1 and ${MAX_PROJECT_APPLY_FILES} files.`, "EXI_MCP_PROJECT_APPLY_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite must be a boolean.");
  const directory = resolvePath(directoryPath);
  requireScaffoldDirectory(directory);
  const directoryEntry = await lstat(directory.resolved);
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) fail("Project apply target must be a directory.", "EXI_MCP_PATH_LINK");
  const seen = new Set();
  let totalBytes = 0;
  const entries = [];
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== "string" || !file.path.trim()) fail("Project apply file must contain a path.", "EXI_MCP_PROJECT_APPLY_INPUT");
    if (typeof file.content !== "string") fail("Project apply file content must be a string.", "EXI_MCP_PROJECT_APPLY_INPUT");
    const relativeFile = file.path.replaceAll("\\", "/");
    if (path.isAbsolute(file.path) || relativeFile.startsWith("/") || relativeFile.includes("\0") || relativeFile.split("/").some((part) => part === "..")) fail("Project apply file path must be relative and traversal-free.", "EXI_MCP_FILE_PATH");
    const target = resolveProjectFile(`${directory.relative}/${relativeFile}`);
    const key = target.relative.toLowerCase();
    if (seen.has(key)) fail(`Project apply contains the same file more than once: ${target.relative}`, "EXI_MCP_PROJECT_APPLY_DUPLICATE");
    seen.add(key);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_PROJECT_FILE_BYTES) fail(`Project apply single file byte limit exceeded: ${target.relative}`, "EXI_MCP_FILE_LIMIT");
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_APPLY_BYTES) fail(`Project apply total byte limit ${MAX_PROJECT_APPLY_BYTES} exceeded.`, "EXI_MCP_PROJECT_APPLY_LIMIT");
    requireScaffoldFile(target);
    const existing = await inspectProjectFile(target, { allowMissingParent: true });
    const expectedVersion = file.expectedVersion;
    assertExpectedVersion(existing, expectedVersion, `Project apply ${target.relative}`);
    if (existing && !overwrite) fail(`Project file already exists: ${target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
    entries.push({ target, content: file.content, bytes, existing, expectedVersion, id: `a${nextWriteId++}`, tempPath: null, backupPath: null, committed: false });
  }

  const createdDirectories = [];
  const staged = [];
  const assertUnchanged = async (entry) => {
    const current = await inspectProjectFile(entry.target);
    const expectedVersion = entry.expectedVersion || projectVersion(entry.existing);
    if (expectedVersion) {
      if (!current || current.size !== expectedVersion.bytes || current.mtimeMs !== expectedVersion.mtimeMs) fail(`Project apply target changed during the call: ${entry.target.relative}`, "EXI_MCP_FILE_CONFLICT");
    } else if (current) {
      fail(`Project apply target was created during the call: ${entry.target.relative}`, "EXI_MCP_FILE_CONFLICT");
    }
  };
  try {
    for (const entry of entries) {
      await ensureProjectParent(entry.target, createdDirectories);
      await assertUnchanged(entry);
      entry.tempPath = `${entry.target.resolved}.exi-apply-${process.pid}-${entry.id}`;
      staged.push(entry);
      await writeFile(entry.tempPath, entry.content, { encoding: "utf8", flag: "wx" });
      const tempEntry = await lstat(entry.tempPath);
      if (tempEntry.isSymbolicLink() || !tempEntry.isFile() || tempEntry.size !== entry.bytes) fail("Project apply temporary file is not safe.", "EXI_MCP_PATH_LINK");
    }
    for (const entry of staged) {
      await assertUnchanged(entry);
      if (entry.existing) {
        entry.backupPath = `${entry.target.resolved}.exi-apply-backup-${process.pid}-${entry.id}`;
        await rename(entry.target.resolved, entry.backupPath);
      }
      await rename(entry.tempPath, entry.target.resolved);
      entry.committed = true;
    }
    for (const entry of staged) {
      if (!entry.backupPath) continue;
      // ponytail: backup cleanup is best effort; a private backup is safer than deleting the previous source on filesystem trouble.
      try { await unlink(entry.backupPath); } catch (error) { if (error?.code !== "ENOENT") { /* keep the private backup */ } }
    }
    return { directory: directory.relative, applied: entries.length, bytes: totalBytes, files: entries.map((entry) => ({ path: entry.target.relative, bytes: entry.bytes, overwritten: Boolean(entry.existing) })) };
  } catch (error) {
    const restoreErrors = [];
    for (const entry of [...staged].reverse()) {
      try {
        if (entry.committed) await unlink(entry.target.resolved);
        if (entry.backupPath) await rename(entry.backupPath, entry.target.resolved);
      } catch (restoreError) {
        restoreErrors.push(`${entry.target.relative}: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
      }
      try { if (entry.tempPath) await unlink(entry.tempPath); } catch (cleanupError) { if (cleanupError?.code !== "ENOENT") restoreErrors.push(`${entry.target.relative} temp: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`); }
    }
    for (const createdDirectory of [...createdDirectories].reverse()) {
      try { await rmdir(createdDirectory); } catch (cleanupError) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(cleanupError?.code)) restoreErrors.push(`${createdDirectory} directory: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`); }
    }
    if (restoreErrors.length > 0) error.restoreError = restoreErrors.join("; ");
    throw error;
  }
}

function assertChunkedProjectFileSize(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CHUNKED_PROJECT_FILE_BYTES) fail(`Chunked project file size must be a safe integer between 0 and ${MAX_CHUNKED_PROJECT_FILE_BYTES}.`, "EXI_MCP_FILE_LIMIT");
  return value;
}

function requireProjectFileUpload(uploadId) {
  if (typeof uploadId !== "string" || !/^f[1-9][0-9]*$/.test(uploadId) || !projectFileUploads.has(uploadId)) fail(`Project file upload not found: ${uploadId}`, "EXI_MCP_UPLOAD_NOT_FOUND");
  return projectFileUploads.get(uploadId);
}

function assertProjectFileChunk(content) {
  if (typeof content !== "string" || content.length === 0) fail("Project file chunk must be a non-empty UTF-8 string.");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_PROJECT_FILE_CHUNK_BYTES) fail("Single project file chunk byte limit exceeded.", "EXI_MCP_FILE_LIMIT");
  return { content, bytes };
}

async function removeProjectFileUpload(upload) {
  if (!upload) return;
  projectFileUploads.delete(upload.id);
  try { await unlink(upload.tempPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function pruneProjectFileUploads() {
  const deadline = Date.now() - MAX_UPLOAD_IDLE_MS;
  for (const upload of [...projectFileUploads.values()]) {
    if ((upload.lastActivityAt || upload.createdAt || 0) >= deadline) continue;
    try { await removeProjectFileUpload(upload); } catch { /* stale upload cleanup is best effort */ }
  }
}

async function beginProjectFileUpload({ path: filePath, size, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  await pruneProjectFileUploads();
  if (projectFileUploads.size >= MAX_PROJECT_FILE_UPLOADS) fail("Active project file upload limit exceeded.", "EXI_MCP_UPLOAD_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite must be a boolean.");
  const expectedBytes = assertChunkedProjectFileSize(size);
  const pendingBytes = [...projectFileUploads.values()].reduce((total, upload) => total + upload.expectedBytes, 0);
  if (pendingBytes + expectedBytes > MAX_PENDING_PROJECT_FILE_BYTES) fail("Pending project file upload byte budget exceeded.", "EXI_MCP_UPLOAD_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Project file ${target.relative}`);
  await ensureProjectParent(target);
  await sweepStaleUploadTemps(path.dirname(target.resolved));
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Project file ${target.relative}`);
  if (existing && !overwrite) fail(`Project file already exists: ${target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const id = `f${nextProjectFileUploadId++}`;
  const tempPath = `${target.resolved}.exi-file-upload-${process.pid}-${id}`;
  try {
    await writeUploadTempExclusive(tempPath, "", { encoding: "utf8" });
    projectFileUploads.set(id, { id, target, tempPath, expectedBytes, receivedBytes: 0, state: expectedBytes === 0 ? "complete" : "receiving", createdAt: Date.now(), lastActivityAt: Date.now(), overwrite: Boolean(overwrite), expectedVersion, expectedSha256: normalizedSha256, hash: normalizedSha256 ? createHash("sha256") : null });
  } catch (error) {
    try { await unlink(tempPath); } catch { /* cleanup best effort */ }
    throw error;
  }
  return { fileUploadId: id, path: target.relative, expectedBytes, receivedBytes: 0, state: expectedBytes === 0 ? "complete" : "receiving", complete: expectedBytes === 0, chunkBytes: MAX_PROJECT_FILE_CHUNK_BYTES, ...(normalizedSha256 ? { expectedSha256: normalizedSha256 } : {}) };
}

async function writeProjectFileChunk({ fileUploadId, offset, content } = {}) {
  await pruneProjectFileUploads();
  const upload = requireProjectFileUpload(fileUploadId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== upload.receivedBytes) fail("Project file chunk offset must equal the previous receivedBytes.", "EXI_MCP_UPLOAD_ORDER");
  const chunk = assertProjectFileChunk(content);
  if (upload.receivedBytes + chunk.bytes > upload.expectedBytes) fail("Project file chunk exceeds the expected total size.", "EXI_MCP_UPLOAD_SIZE");
  await appendFile(upload.tempPath, chunk.content, { encoding: "utf8" });
  upload.hash?.update(Buffer.from(chunk.content, "utf8"));
  const entry = await lstat(upload.tempPath);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size !== upload.receivedBytes + chunk.bytes) fail("Project file upload size could not be verified.", "EXI_MCP_UPLOAD_SIZE");
  upload.receivedBytes = entry.size;
  upload.lastActivityAt = Date.now();
  upload.state = upload.receivedBytes === upload.expectedBytes ? "complete" : "receiving";
  return { fileUploadId, path: upload.target.relative, receivedBytes: upload.receivedBytes, expectedBytes: upload.expectedBytes, remainingBytes: upload.expectedBytes - upload.receivedBytes, complete: upload.state === "complete", state: upload.state };
}

async function commitProjectFileUpload({ fileUploadId } = {}) {
  await pruneProjectFileUploads();
  const upload = requireProjectFileUpload(fileUploadId);
  if (upload.state !== "complete" || upload.receivedBytes !== upload.expectedBytes) fail(`Project file upload is not complete: ${upload.receivedBytes}/${upload.expectedBytes} bytes.`, "EXI_MCP_UPLOAD_INCOMPLETE");
  const tempEntry = await lstat(upload.tempPath);
  if (tempEntry.isSymbolicLink() || !tempEntry.isFile() || tempEntry.size !== upload.expectedBytes) fail("Project file temporary upload file is not safe.", "EXI_MCP_PATH_LINK");
  const existing = await inspectProjectFile(upload.target);
  assertExpectedVersion(existing, upload.expectedVersion, `Project file ${upload.target.relative}`);
  if (existing && !upload.overwrite) fail(`Project file already exists: ${upload.target.relative}. overwrite=true is required.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = upload.hash ? upload.hash.digest("hex") : null;
  assertSha256Match(upload.expectedSha256, actualSha256, `Project file ${upload.target.relative}`);
  const overwritten = await replaceUploadedFile(upload, existing);
  projectFileUploads.delete(upload.id);
  return { fileUploadId, path: upload.target.relative, bytes: upload.expectedBytes, ...(actualSha256 ? { sha256: actualSha256 } : {}), overwritten };
}

async function abortProjectFileUpload({ fileUploadId } = {}) {
  const upload = requireProjectFileUpload(fileUploadId);
  await removeProjectFileUpload(upload);
  return { fileUploadId, aborted: true };
}

async function checkProjectFile({ path: filePath } = {}, signal) {
  throwIfCancelled(signal);
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const entry = await inspectProjectFile(target);
  if (!entry) fail(`Project file not found: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
  const extension = path.extname(target.relative).toLowerCase();
  if (extension === ".json") {
    const content = await readFile(target.resolved, { encoding: "utf8", signal });
    throwIfCancelled(signal);
    if (Buffer.byteLength(content, "utf8") > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
    assertProjectJSONBudget(content);
    try {
      JSON.parse(content);
      return { path: target.relative, kind: "json", ok: true, code: 0, stdout: "", stderr: "" };
    } catch (error) {
      return { path: target.relative, kind: "json", ok: false, code: 1, stdout: "", stderr: String(error?.message || error).slice(-MAX_OUTPUT_BYTES) };
    }
  }
  if (htmlCheckExtensions.has(extension)) {
    const content = await readFile(target.resolved, { encoding: "utf8", signal });
    throwIfCancelled(signal);
    if (Buffer.byteLength(content, "utf8") > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Project file chunked size limit exceeded.", "EXI_MCP_FILE_LIMIT");
    return { path: target.relative, kind: "html", ...await checkHTMLReferences(target, content, signal) };
  }
  if (!syntaxCheckExtensions.has(extension)) fail("Syntax check only works on .js, .mjs or .json files.", "EXI_MCP_FILE_TYPE");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", target.resolved], {
      cwd: ROOT,
      env: { ...process.env, NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (value, chunk) => `${value}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    const finishAfterCleanup = (callback) => {
      void terminateProcessTree(child).catch(() => {}).finally(callback);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      finishAfterCleanup(() => reject(cancellationError()));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      finishAfterCleanup(() => resolve({ path: target.relative, kind: "javascript", ok: false, code: 1, signal: "SIGTERM", stdout, stderr: `${stderr}\nsyntax check timed out.`.slice(-MAX_OUTPUT_BYTES) }));
    }, 30_000);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.once("exit", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ path: target.relative, kind: "javascript", ok: code === 0, code: code ?? 1, signal: exitSignal || null, stdout, stderr });
    });
  });
}

async function checkProject({ path: directoryPath } = {}, signal, progressToken) {
  throwIfCancelled(signal);
  const listing = await listProjectFiles({ path: directoryPath });
  throwIfCancelled(signal);
  const checkable = listing.files.filter((file) => [".html", ".js", ".json", ".mjs"].includes(path.extname(file.path).toLowerCase()));
  if (checkable.length > MAX_PROJECT_CHECK_FILES) fail(`At most ${MAX_PROJECT_CHECK_FILES} project files can be checked in one call.`, "EXI_MCP_FILE_LIMIT");
  sendProgress(progressToken, 0, checkable.length, "Project static check started.");
  const failures = [];
  let failureCount = 0;
  for (const [index, file] of checkable.entries()) {
    throwIfCancelled(signal);
    let result;
    try {
      result = await checkProjectFile({ path: file.path }, signal);
    } catch (error) {
      if (error?.code === "EXI_MCP_CANCELLED") throw error;
      result = { path: file.path, kind: path.extname(file.path).slice(1), ok: false, code: error?.code || "EXI_MCP_FILE_CHECK", stderr: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok) {
      failureCount += 1;
      if (failures.length < MAX_PROJECT_CHECK_FAILURES) failures.push({ path: result.path, kind: result.kind, code: result.code ?? 1, stderr: String(result.stderr || "").slice(-MAX_PROJECT_CHECK_ERROR_BYTES) });
    }
    sendProgress(progressToken, index + 1, checkable.length, `Checked: ${file.path}`);
  }
  throwIfCancelled(signal);
  return { directory: listing.directory, ok: failureCount === 0, files: listing.files.length, checked: checkable.length, skipped: listing.files.length - checkable.length, failureCount, failures };
}

function publicPrototypeMethods(value) {
  const names = new Set();
  let prototype = value?.prototype;
  while (prototype && prototype !== Object.prototype) {
    const ownerName = prototype.constructor?.name;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor" || !isPublicMethod(ownerName, name) || forbiddenKeys.has(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (typeof descriptor?.value === "function") names.add(name);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return [...names].sort();
}

function publicStaticMethods(value) {
  if (typeof value !== "function") return [];
  return Object.getOwnPropertyNames(value)
    .filter((name) => !["length", "name", "prototype", "caller", "arguments"].includes(name) && !name.startsWith("_") && !forbiddenKeys.has(name))
    .filter((name) => typeof Object.getOwnPropertyDescriptor(value, name)?.value === "function")
    .sort();
}

function publicObjectMembers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value)
    .filter((name) => !name.startsWith("_") && !forbiddenKeys.has(name))
    .map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      const kind = descriptor && "value" in descriptor ? typeof descriptor.value : "accessor";
      return { name, kind, route: kind === "function" ? "exi_export_call" : "exi_export_get" };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function publicStaticProperties(value) {
  if (typeof value !== "function") return [];
  return Object.getOwnPropertyNames(value)
    .filter((name) => !["length", "name", "prototype", "caller", "arguments"].includes(name) && !name.startsWith("_") && !forbiddenKeys.has(name))
    .map((name) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (descriptor && "value" in descriptor && typeof descriptor.value === "function") return null;
      return { name, kind: descriptor && "value" in descriptor ? typeof descriptor.value : "accessor", route: "exi_export_get" };
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function manifest() {
  return Object.entries(engineExports)
    .filter(([name]) => !name.startsWith("_") && !forbiddenKeys.has(name) && isAgentCallableExport(name))
    .map(([name, value]) => {
      const kind = typeof value === "function" ? (isClass(value) ? "class" : "function") : typeof value;
      const methods = publicPrototypeMethods(value);
      const staticMethods = publicStaticMethods(value);
      return {
        name,
        kind,
        route: kind === "class" ? "exi_create" : kind === "function" ? "exi_function" : "exi_export_get",
        methods,
        methodRoutes: Object.fromEntries(methods.map((method) => [method, "exi_call"])),
        staticMethods,
        staticMethodRoutes: Object.fromEntries(staticMethods.map((method) => [method, "exi_static_call"])),
        members: publicObjectMembers(value),
        staticProperties: publicStaticProperties(value),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

const apiLimits = Object.freeze({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxStringLength: MAX_STRING_LENGTH,
  maxBinaryBytes: MAX_BINARY_BYTES,
  maxAssetReadBytes: MAX_ASSET_READ_BYTES,
  maxChunkedAssetBytes: MAX_CHUNKED_ASSET_BYTES,
  maxPendingAssetBytes: MAX_PENDING_ASSET_BYTES,
  maxAssetUploads: MAX_ASSET_UPLOADS,
  maxProjectFileBytes: MAX_PROJECT_FILE_BYTES,
  maxProjectPatchTextBytes: MAX_PROJECT_PATCH_TEXT_BYTES,
  maxProjectApplyFiles: MAX_PROJECT_APPLY_FILES,
  maxProjectApplyBytes: MAX_PROJECT_APPLY_BYTES,
  maxProjectReadBytes: MAX_PROJECT_READ_BYTES,
  maxChunkedProjectFileBytes: MAX_CHUNKED_PROJECT_FILE_BYTES,
  maxPendingProjectFileBytes: MAX_PENDING_PROJECT_FILE_BYTES,
  maxProjectFileUploads: MAX_PROJECT_FILE_UPLOADS,
  maxProjectFileChunkBytes: MAX_PROJECT_FILE_CHUNK_BYTES,
  maxProjectListEntries: MAX_PROJECT_LIST_ENTRIES,
  maxProjectDepth: MAX_PROJECT_DEPTH,
  maxProjectCheckFiles: MAX_PROJECT_CHECK_FILES,
  maxHandles: MAX_HANDLES,
  maxSceneNodes: MAX_SCENE_NODES,
  maxSceneDepth: MAX_SCENE_DEPTH,
  maxGridPathCells: engineExports.MAX_GRID_PATH_CELLS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  maxApiOutputBytes: MAX_API_OUTPUT_BYTES,
  maxRuntimeTelemetryBytes: MAX_RUNTIME_TELEMETRY_BYTES,
  maxRuntimeCommandBytes: MAX_RUNTIME_COMMAND_BYTES,
  maxRuntimeResultBytes: MAX_RUNTIME_RESULT_BYTES,
  maxRuntimeCommandWaitMs: MAX_RUNTIME_COMMAND_WAIT_MS,
  maxRuntimeBatchCalls: MAX_RUNTIME_BATCH_CALLS,
  maxInlineBinaryBytes: MAX_INLINE_BINARY_BYTES,
  maxResourceBytes: MAX_RESOURCE_BYTES,
  maxPreviews: MAX_PREVIEWS,
  maxPreviewStartupMs: MAX_PREVIEW_STARTUP_MS,
});

function apiContract() {
  return {
    protocol: PROTOCOL_VERSION,
    supportedProtocols: SUPPORTED_PROTOCOLS,
    mcpEra: "dual",
    server: SERVER_VERSION,
    transport: "stdio",
    resources: { api: "exi://api", types: "exi://types", guide: "exi://guide", security: "exi://security", runtime: "exi://runtime", clients: "exi://clients" },
    callRoutes: { constructor: "exi_create", function: "exi_function", nestedExport: "exi_export_call", staticMethod: "exi_static_call", instanceMethod: "exi_call", inspect: "exi_inspect", propertyRead: "exi_get", propertyWrite: "exi_set", staticValue: "exi_export_get", browserRuntime: "exi_preview_call", browserRuntimeBatch: "exi_preview_batch", sessionStatus: "exi_session_status", projectStatus: "exi_project_status", projectPreview: "exi_project_preview" },
    toolInput: { topLevelAdditionalProperties: false, objectRequired: true, unknownArgumentCode: "EXI_MCP_ARGUMENT_UNKNOWN", typeErrorCode: "EXI_MCP_ARGS_TYPE", nestedTypeErrorCode: "EXI_MCP_ARGUMENT_TYPE", requiredArgumentCode: "EXI_MCP_ARGUMENT_REQUIRED", enumArgumentCode: "EXI_MCP_ARGUMENT_ENUM", limitArgumentCode: "EXI_MCP_ARGUMENT_LIMIT", invalidArgumentCode: "EXI_MCP_ARGUMENT_INVALID", binaryPayload: "{ $bytes: byte[] | base64 }", versioning: { outputField: "version", inputField: "expectedVersion", fields: ["bytes", "mtimeMs"], conflictCode: "EXI_MCP_FILE_CONFLICT", writeTools: ["exi_file_write", "exi_file_begin", "exi_asset_write", "exi_asset_begin", "exi_project_apply"] }, integrity: { inputField: "expectedSha256", algorithm: "SHA-256", format: "64 hexadecimal characters", mismatchCode: "EXI_MCP_UPLOAD_INTEGRITY", uploadTools: ["exi_file_write", "exi_file_begin", "exi_asset_write", "exi_asset_begin"] } },
    limits: apiLimits,
    workflow: {
      create: ["exi_api", "exi_scaffold", "exi_project_apply", "exi_file_write", "exi_file_patch", "exi_file_begin", "exi_file_chunk", "exi_file_commit", "exi_file_abort", "exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort", "exi_project_status", "exi_project_check", "exi_project_preview", "exi_preview_start", "exi_preview_call", "exi_preview_batch", "exi_preview_probe", "exi_preview_stop", "exi_check"],
      open: ["exi_api", "exi_project_open", "exi_file_list", "exi_file_read", "exi_project_apply", "exi_file_write", "exi_file_patch", "exi_file_begin", "exi_file_chunk", "exi_file_commit", "exi_file_abort", "exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort", "exi_project_status", "exi_project_check", "exi_project_preview", "exi_preview_start", "exi_preview_call", "exi_preview_batch", "exi_preview_probe", "exi_preview_stop"],
      assets: ["exi_asset_list", "exi_asset_read", "exi_asset_write", "exi_asset_begin", "exi_asset_chunk", "exi_asset_commit", "exi_asset_abort"],
      session: ["exi_session_status", "exi_session_reset"],
      cleanup: ["exi_release", "exi_session_reset"],
    },
    exports: manifest(),
  };
}

function assertPublicPath(value, label = "path") {
  if (typeof value !== "string" || !value || value.length > 512) fail(`${label} is invalid.`);
  const segments = value.split(".");
  if (segments.some((segment) => !segment || segment.startsWith("_") || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail(`${label} must be a public export path.`);
  return segments;
}

function resolveExportPath(value) {
  const segments = assertPublicPath(value);
  let current = isAgentCallableExport(segments[0]) ? engineExports[segments[0]] : undefined;
  if (current === undefined) fail(`Public export not found: ${value}`);
  let parent = null;
  for (const segment of segments.slice(1)) {
    if ((current === null || (typeof current !== "object" && typeof current !== "function")) || !Object.hasOwn(current, segment)) fail(`Public export path not found: ${value}`);
    parent = current;
    current = current[segment];
  }
  return { value: current, parent };
}

function registerHandle(value, protectedValue = false) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return null;
  protectedValue = protectedValue || protectedObjects.has(value);
  const existing = objectHandles.get(value);
  if (existing && handles.has(existing)) {
    if (protectedValue) protectedHandles.add(existing);
    return existing;
  }
  if (handles.size >= MAX_HANDLES) fail("Active engine handle limit exceeded.", "EXI_MCP_HANDLE_LIMIT");
  const handle = `h${nextHandleId++}`;
  handles.set(handle, value);
  if (protectedValue) protectedHandles.add(handle);
  objectHandles.set(value, handle);
  return handle;
}

function isHandleable(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof Map || value instanceof Set) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== null && prototype !== Object.prototype;
}

function requireHandle(value) {
  if (typeof value !== "string" || !/^h[1-9][0-9]*$/.test(value)) fail("Invalid engine handle.");
  const object = handles.get(value);
  if (!object) fail(`Engine handle not found: ${value}`);
  return object;
}

function resolveBytes(value) {
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "$bytes")) return null;
  if (Array.isArray(value.$bytes)) {
    if (value.$bytes.length > MAX_BINARY_BYTES) fail("Byte array limit exceeded.");
    if (value.$bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) fail("Byte array must only contain integers 0..255.");
    return Uint8Array.from(value.$bytes);
  }
  if (typeof value.$bytes !== "string") fail("$bytes must be base64 text or a byte array.");
  const encoded = value.$bytes;
  if (encoded.length > MAX_BASE64_STRING_LENGTH) fail("Base64 byte text limit exceeded.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("$bytes must be valid base64.");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength > MAX_BINARY_BYTES) fail("Byte data limit exceeded.");
  return bytes;
}

function resolveArgument(value, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail("Argument data depth limit exceeded.");
  if (Array.isArray(value)) return value.map((item) => resolveArgument(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const bytes = resolveBytes(value);
  if (bytes) return bytes;
  if (Object.keys(value).length === 1 && typeof value.$handle === "string") return requireHandle(value.$handle);
  const resolved = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) fail(`Unsafe argument field: ${key}`);
    resolved[key] = resolveArgument(item, depth + 1);
  }
  return resolved;
}

function resolveArgs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("args must be an array.", "EXI_MCP_ARGS_TYPE");
  return value.map((item) => resolveArgument(item));
}

function serialize(value, depth = 0, seen = new Set()) {
  if (value === undefined) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "symbol") return { type: "symbol" };
  if (typeof value === "function") return { type: "function" };
  const knownHandle = objectHandles.get(value);
  if (knownHandle && handles.has(knownHandle)) return { $handle: knownHandle, type: getHandleType(value) };
  if (depth >= 4) return { type: getHandleType(value) };
  if (isHandleable(value)) {
    const handle = registerHandle(value);
    return { $handle: handle, type: getHandleType(value) };
  }
  if (seen.has(value)) return { type: "circular" };
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 64).map((item) => serialize(item, depth + 1, seen));
  if (ArrayBuffer.isView(value)) return serializeTypedArray(value);
  if (value instanceof Map) return { type: "Map", size: value.size };
  if (value instanceof Set) return { type: "Set", size: value.size };
  const result = { type: getHandleType(value) };
  const keys = Object.keys(value).slice(0, 32);
  for (const key of keys) {
    if (forbiddenKeys.has(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) result[key] = serialize(descriptor.value, depth + 1, seen);
  }
  return result;
}

function serializeTypedArray(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const sample = value instanceof DataView ? bytes.slice(0, 16) : value.slice(0, 16);
  const result = {
    type: getHandleType(value),
    length: Number.isSafeInteger(value.length) ? value.length : null,
    byteLength: bytes.byteLength,
    sample: Array.from(sample, (item) => typeof item === "bigint" ? String(item) : item),
  };
  result.bytes = bytes.byteLength <= MAX_INLINE_BINARY_BYTES
    ? { $bytes: Buffer.from(bytes).toString("base64") }
    : { truncated: true, maxInlineBytes: MAX_INLINE_BINARY_BYTES };
  return result;
}

function resultValue(value) {
  const handle = isHandleable(value) ? registerHandle(value) : null;
  return handle ? { $handle: handle, type: getHandleType(value) } : serialize(value);
}

function protectedResultValue(value) {
  const handle = isHandleable(value) ? registerHandle(value, true) : null;
  return handle ? { $handle: handle, type: getHandleType(value) } : serialize(value);
}

function findPropertyDescriptor(object, property) {
  let target = object;
  while (target && target !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor) return descriptor;
    target = Object.getPrototypeOf(target);
  }
  return null;
}

function getPublicMethod(object, method) {
  assertPublicName(method, "method");
  // Callback-valued instance fields are application code, not engine methods.
  let prototype = Object.getPrototypeOf(object);
  while (prototype && prototype !== Object.prototype) {
    const ownerName = prototype.constructor?.name;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (descriptor) {
      if (!isPublicMethod(ownerName, method)) fail(`Not a public method: ${method}`);
      if (typeof descriptor.value !== "function") fail(`Not a public method: ${method}`);
      return descriptor.value;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  fail(`Engine method not found: ${method}`);
}

function getPublicStaticMethod(Constructor, method) {
  assertPublicName(method, "method");
  const descriptor = Object.getOwnPropertyDescriptor(Constructor, method);
  if (!descriptor || typeof descriptor.value !== "function") fail(`Static method not found: ${Constructor.name}.${method}`);
  return descriptor.value;
}

function getPublicProperty(object, property) {
  assertPublicName(property, "property");
  if (!findPropertyDescriptor(object, property)) fail(`Engine property not found: ${property}`);
  return object[property];
}

function inspectHandle(object, handle) {
  const methods = new Set();
  const properties = new Map();
  let target = object;
  while (target && target !== Object.prototype) {
    const ownerName = target.constructor?.name;
    for (const name of Object.getOwnPropertyNames(target)) {
      if (name === "constructor" || !isPublicMethod(ownerName, name) || forbiddenKeys.has(name) || methods.has(name) || properties.has(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, name);
      if (!descriptor) continue;
      if (typeof descriptor.value === "function") {
        if (target === object) continue;
        methods.add(name);
        continue;
      }
      properties.set(name, {
        name,
        kind: "value" in descriptor ? typeof descriptor.value : "accessor",
        readable: "value" in descriptor || typeof descriptor.get === "function",
        writable: "value" in descriptor ? descriptor.writable === true : typeof descriptor.set === "function",
      });
    }
    target = Object.getPrototypeOf(target);
  }
  return {
    handle,
    type: getHandleType(object),
    methods: [...methods].sort(),
    properties: [...properties.values()].sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function createExported(name, args) {
  assertPublicName(name, "type");
  const Constructor = engineExports[name];
  if (!isClass(Constructor)) fail(`Constructible public class not found: ${name}`);
  return new Constructor(...args);
}

async function buildScene(spec, state, depth = 0) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail("Scene spec must be an object.");
  if (depth > MAX_SCENE_DEPTH) fail("Scene depth limit exceeded.", "EXI_MCP_SCENE_LIMIT");
  for (const key of Object.keys(spec)) if (!sceneSpecFields.has(key)) fail(`Unknown scene spec field: ${key}`, "EXI_MCP_SCENE_SCHEMA");
  state.nodes += 1;
  if (state.nodes > MAX_SCENE_NODES) fail("Scene node limit exceeded.", "EXI_MCP_SCENE_LIMIT");
  const type = assertPublicName(spec.type, "scene.type");
  if (spec.options !== undefined && !isRecord(spec.options)) fail("Scene options must be an object.", "EXI_MCP_SCENE_SCHEMA");
  const options = spec.options === undefined ? [] : [resolveArgument(spec.options)];
  const object = createExported(type, options);
  const handle = registerHandle(object);
  state.created.push(handle);
  const children = spec.children === undefined ? [] : spec.children;
  if (!Array.isArray(children) || children.length > MAX_SCENE_NODES) fail("Scene children field is invalid.", "EXI_MCP_SCENE_SCHEMA");
  if (children.length) {
    const add = getPublicMethod(object, "add");
    for (const child of children) await buildScene(child, state, depth + 1).then((built) => add.call(object, requireHandle(built.$handle)));
  }
  return { $handle: handle, type: getHandleType(object) || type };
}

function scaffoldFiles(relativeDirectory) {
  const safeDirectory = relativeDirectory || "ai-game";
  const projectName = path.basename(safeDirectory).replace(/[^a-zA-Z0-9_-]/g, "-") || "ai-game";
  const projectUrl = `/${safeDirectory.replaceAll("\\", "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
  return {
    "index.html": `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${projectName}</title></head><body><canvas id="game" width="960" height="540"></canvas><output id="exi-runtime" aria-label="ExiEngine runtime" hidden></output><script type="module" src="${projectUrl}/game.js"></script></body></html>\n`,
    "game.js": `import * as Exi from "/src/index.js";\nimport { RuntimeAgent } from "/src/ai/runtime-agent.js";\n\nconst { ExiEngine, Graphics, Scene } = Exi;\nconst canvas = document.querySelector("#game");\nconst runtimeNode = document.querySelector("#exi-runtime");\nconst runtimeToken = await fetch("/__exi/runtime-token").then((response) => response.ok ? response.text() : "").then((value) => value.trim()).catch(() => "");\nlet lastEvent = "starting";\nlet lastTelemetryAt = 0;\nconst scene = new Scene();\nconst player = new Graphics({ x: 432, y: 222 }).rect(0, 0, 96, 96, { fill: 0x5eead4 });\nscene.add(player);\nconst publishRuntime = (currentEngine) => {\n  const info = currentEngine.getInfo();\n  const state = { ready: true, status: currentEngine.running ? "running" : "stopped", event: lastEvent, backend: info.backend || "unknown", fps: Math.round(info.profiler?.fps || 0), draws: info.drawCalls || 0, nodes: info.nodeCount || 0 };\n  for (const [key, value] of Object.entries(state)) runtimeNode.dataset[key] = String(value);\n  runtimeNode.dataset.ready = "true";\n  runtimeNode.textContent = JSON.stringify(state);\n  const now = performance.now();\n  if (runtimeToken && (now - lastTelemetryAt >= 250 || state.status !== "running")) {\n    lastTelemetryAt = now;\n    void fetch("/__exi/runtime", { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": runtimeToken }, body: JSON.stringify(state), keepalive: true }).catch(() => {});\n  }\n};\nconst engine = await ExiEngine.create({\n  canvas,\n  scene,\n  width: 960,\n  height: 540,\n  inputAxes: { moveX: { type: "key-axis", positive: "ArrowRight", negative: "ArrowLeft" }, moveY: { type: "key-axis", positive: "ArrowDown", negative: "ArrowUp" } },\n  onStatus: (event) => { lastEvent = event.type; },\n  onUpdate: (delta, currentEngine) => {\n    const direction = currentEngine.input?.getVector("moveX", "moveY");\n    if (!direction) return;\n    player.position.x = Math.max(0, Math.min(864, player.position.x + direction.x * 180 * delta));\n    player.position.y = Math.max(0, Math.min(444, player.position.y + direction.y * 180 * delta));\n  },\n  onRender: publishRuntime,\n});\nengine.start();\nconst runtimeAgent = new RuntimeAgent({ api: Exi, roots: { engine, scene }, token: runtimeToken });\nruntimeAgent.start();\n\n// The starter is playable with the arrow keys; add your own Nodes, Sprites and rules here.\nwindow.game = { engine, scene, player, runtimeAgent };\n`,
    "README.md": `# ${projectName}\n\nThis game was scaffolded by ExiEngine's AI tool bridge.\n\nRun from the repository root with \`npm run dev\`, then open ${projectUrl}/index.html.\n\nThe starter includes an arrow-key controlled square so a browser-capable AI CLI can verify input → fixed-step → scene movement immediately. The hidden \`#exi-runtime\` output publishes bounded status/backend/fps/draws/nodes telemetry; after a real browser load, MCP can read the matching token-managed report with \`exi_preview_probe({ path: "/__exi/runtime" })\`. See the \`exi://runtime\` MCP resource.\n\nThe engine has no runtime dependency on another game engine.\n`,
  };
}

async function scaffold({ directory = "ai-game", overwrite = false } = {}) {
  const target = resolvePath(directory);
  if (target.resolved === ROOT) fail("Scaffold must write to a separate subdirectory, not the repository root.");
  assertScaffoldDirectory(target);
  const files = scaffoldFiles(target.relative);
  files["game.js"] = files["game.js"].replace(
    "const runtimeAgent = new RuntimeAgent({ api: Exi, roots: { engine, scene }, token: runtimeToken });",
    "const runtimeCallbacks = Object.create(null);\n// Register reviewed game callbacks here; MCP may reference them with {\"$callback\":\"name\"}.\nconst runtimeAgent = new RuntimeAgent({ api: Exi, roots: { engine, scene }, callbacks: runtimeCallbacks, token: runtimeToken });",
  );
  files["game.js"] = files["game.js"]
    .replace("import { RuntimeAgent } from \"/src/ai/runtime-agent.js\";", "import { createEngineObserver, RuntimeAgent } from \"/src/ai/runtime-agent.js\";")
    .replace("callbacks: runtimeCallbacks, token: runtimeToken });", "callbacks: runtimeCallbacks, observe: createEngineObserver(engine), token: runtimeToken });");
  const fileNames = Object.keys(files);
  await assertSafeScaffoldTarget(target, fileNames);
  const targetExisted = await lstat(target.resolved).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  await mkdir(target.resolved, { recursive: true });
  await assertSafeScaffoldTarget(target, fileNames);
  if (!overwrite) {
    for (const name of fileNames) {
      try { await lstat(path.join(target.resolved, name)); }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      fail(`Scaffold file already exists: ${target.relative}/${name}. overwrite=true is required.`);
    }
  }
  const entries = Object.entries(files).map(([name, content]) => ({ name, content, targetPath: path.join(target.resolved, name), tempPath: null, backupPath: null, backedUp: false, committed: false }));
  try {
    for (const entry of entries) {
      const id = `s${nextWriteId++}`;
      entry.tempPath = `${entry.targetPath}.exi-scaffold-${process.pid}-${id}`;
      await writeFile(entry.tempPath, entry.content, { encoding: "utf8", flag: "wx" });
    }
    for (const entry of entries) {
      const existing = await lstat(entry.targetPath).catch((error) => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      if (existing) {
        if (existing.isSymbolicLink()) fail("Scaffold cannot write through a symlink.", "EXI_MCP_PATH_LINK");
        if (!existing.isFile()) fail(`Scaffold target must be a file: ${entry.name}`);
        entry.backupPath = `${entry.targetPath}.exi-scaffold-backup-${process.pid}-${nextWriteId++}`;
        await rename(entry.targetPath, entry.backupPath);
        entry.backedUp = true;
      }
      try {
        await rename(entry.tempPath, entry.targetPath);
      } catch (error) {
        if (entry.backedUp) {
          try { await rename(entry.backupPath, entry.targetPath); entry.backedUp = false; } catch (restoreError) { error.restoreError = restoreError instanceof Error ? restoreError.message : String(restoreError); }
        }
        throw error;
      }
      entry.committed = true;
    }
    for (const entry of entries) {
      if (!entry.backupPath) continue;
      try { await unlink(entry.backupPath); } catch (error) { if (error?.code !== "ENOENT") { /* keep private backup */ } }
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.committed) {
        try { await unlink(entry.targetPath); } catch (cleanupError) { if (cleanupError?.code !== "ENOENT") error.restoreError ||= cleanupError instanceof Error ? cleanupError.message : String(cleanupError); }
      }
      if (entry.backedUp && entry.backupPath) {
        try { await rename(entry.backupPath, entry.targetPath); entry.backedUp = false; } catch (restoreError) { error.restoreError ||= restoreError instanceof Error ? restoreError.message : String(restoreError); }
      }
    }
    for (const entry of entries) {
      if (!entry.tempPath) continue;
      try { await unlink(entry.tempPath); } catch (cleanupError) { if (cleanupError?.code !== "ENOENT") error.restoreError ||= cleanupError instanceof Error ? cleanupError.message : String(cleanupError); }
    }
    if (!targetExisted) {
      try { await rmdir(target.resolved); } catch { /* keep an empty directory if another process populated it */ }
    }
    throw error;
  }
  scaffoldDirectories.add(target.relative);
  return { directory: target.relative, files: entries.map((entry) => `${target.relative}/${entry.name}`), overwrite: Boolean(overwrite) };
}

async function openProject({ path: directoryPath } = {}, signal, progressToken) {
  throwIfCancelled(signal);
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Project directory cannot be the repository root.", "EXI_MCP_FILE_SCOPE");
  assertScaffoldDirectory(target);
  await assertSafeScaffoldTarget(target, []);
  const entry = await lstat(target.resolved);
  if (entry.isSymbolicLink() || !entry.isDirectory()) fail("Project path to open must be a directory.", "EXI_MCP_FILE_PATH");
  await sweepStaleUploadTemps(target.resolved);
  scaffoldDirectories.add(target.relative);
  try {
    const check = await checkProject({ path: target.relative }, signal, progressToken);
    throwIfCancelled(signal);
    if (check.checked === 0) fail("No checkable HTML/JS/JSON file was found in the project to open.", "EXI_MCP_FILE_SCOPE");
    return { directory: target.relative, opened: true, ...check };
  } catch (error) {
    scaffoldDirectories.delete(target.relative);
    throw error;
  }
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 1_500);
    child.once("exit", finish);
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("error", () => { try { child.kill(); } catch { /* best effort */ } });
      killer.once("exit", () => { if (child.exitCode !== null) finish(); });
    } else {
      child.kill("SIGTERM");
    }
  });
}

function runCheck(mode, signal, progressToken) {
  const commands = { doctor: ["run", "doctor"], test: ["test"], verify: ["run", "verify"] };
  if (!Object.hasOwn(commands, mode)) fail("check mode can only be doctor, test or verify.");
  throwIfCancelled(signal);
  sendProgress(progressToken, 0, 1, `check ${mode} started.`);
  const timeoutMs = { doctor: 60_000, test: 180_000, verify: 300_000 }[mode];
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const command = windows ? (process.env.ComSpec || "cmd.exe") : "npm";
    const commandArgs = windows ? ["/d", "/s", "/c", ["npm.cmd", ...commands[mode]].join(" ")] : commands[mode];
    const child = spawn(command, commandArgs, { cwd: ROOT, env: { ...process.env, EXI_MCP_ROOT: ROOT }, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const append = (target, chunk) => `${target}${chunk}`.slice(-MAX_OUTPUT_BYTES);
    const rejectAfterCleanup = (error) => {
      void terminateProcessTree(child).catch(() => {}).finally(() => reject(error));
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectAfterCleanup(cancellationError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      rejectAfterCleanup(new Error(`check ${mode} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(error); } });
    child.once("exit", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      sendProgress(progressToken, 1, 1, `check ${mode} completed.`);
      resolve({ mode, ok: code === 0, code: code ?? 1, signal: exitSignal || null, stdout, stderr });
    });
  });
}

const resourceDefinitions = [
  { uri: "exi://api", name: "ExiEngine public API manifest", description: "Reflection manifest of public exports, methods, static methods and canonical tool routes.", mimeType: "application/json" },
  { uri: "exi://types", name: "ExiEngine TypeScript contract", description: "Public TypeScript declarations and option shapes.", mimeType: "text/plain" },
  { uri: "exi://guide", name: "ExiEngine AI authoring guide", description: "Canonical workflow, constraints and completion evidence for coding agents.", mimeType: "text/markdown" },
  { uri: "exi://security", name: "ExiEngine security contract", description: "Trust boundaries, limits and lifecycle rules.", mimeType: "text/markdown" },
  { uri: "exi://runtime", name: "ExiEngine browser runtime contract", description: "Stable bounded DOM selectors, token-managed runtime operations and page-registered callback references for browser-capable AI verification.", mimeType: "application/json" },
  { uri: "exi://clients", name: "ExiEngine AI client setup contract", description: "Verified Codex, Claude Code, OpenCode, Gemini CLI, Cursor CLI, Cline CLI and Windsurf MCP configuration shapes.", mimeType: "application/json" },
];
const runtimeContract = {
  version: 10,
  selector: "#exi-runtime",
  attributes: { ready: "data-ready", status: "data-status", event: "data-event", backend: "data-backend", fps: "data-fps", draws: "data-draws", nodes: "data-nodes" },
  healthy: { ready: "true", status: "running", backend: ["webgpu", "webgl2"], minFps: 1, warmupMs: 2000 },
  telemetry: { endpoint: "/__exi/runtime", tokenEndpoint: "/__exi/runtime-token", maxBytes: MAX_RUNTIME_TELEMETRY_BYTES, probe: "exi_preview_probe({ previewId, path: \"/__exi/runtime\" })" },
  commands: { endpoint: "/__exi/runtime-command", resultEndpoint: "/__exi/runtime-result", maxCommandBytes: MAX_RUNTIME_COMMAND_BYTES, maxResultBytes: MAX_RUNTIME_RESULT_BYTES, maxBatchCalls: MAX_RUNTIME_BATCH_CALLS, maxInlineBinaryBytes: MAX_INLINE_BINARY_BYTES, waitMs: MAX_RUNTIME_COMMAND_WAIT_MS, pollMs: 100, operations: ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario", "batch"], roots: ["engine", "scene"], snapshot: { maxNodesPerPage: 64, maxVisited: 4096, maxDepth: 32, maxOffset: 4095 }, input: { maxEvents: 128, maxKeyLength: 64, maxPointerTypeLength: 32, maxCoordinate: 10000000, maxPointerId: 2147483647, maxButton: 30 }, scenario: { maxFrames: 16, maxEvents: 512, maxFrameEvents: 128, maxObserveCells: 1024, maxSnapshotNodes: 16 } },
  callbacks: { reference: "$callback", source: "page-registered", inspectField: "callbacks", maxNameLength: 256, maxCallbacks: 256, codeSerialized: false },
  evidence: "A browser-capable agent must load the demo or game and wait warmupMs; the page posts bounded telemetry to the token-protected endpoint, which MCP can read. exi_preview_call/exi_preview_batch reach only the page RuntimeAgent allowlist and cannot evaluate arbitrary code. Callback arguments select a function registered by page code; callback bodies are never serialized or evaluated by MCP. A static index response or an MCP-generated synthetic POST is not GPU/browser evidence.",
};
const clientContract = {
  version: 3,
  transport: "stdio",
  mcp: { era: "dual", modernProtocol: MODERN_PROTOCOL_VERSION, legacyProtocol: LEGACY_PROTOCOL_VERSION, modernDiscovery: "server/discover", legacyHandshake: "initialize" },
  command: { executable: "node", args: ["tools/exi-mcp-server.mjs"], rootEnv: "EXI_MCP_ROOT" },
  clients: {
    cursor: { add: "edit .cursor/mcp.json", file: ".cursor/mcp.json", config: { mcpServers: { "exi-engine": { command: "node", args: ["tools/exi-mcp-server.mjs"], env: { EXI_MCP_ROOT: "." } } } } },
    cline: { add: "edit .cline/mcp.json", file: ".cline/mcp.json", config: { mcpServers: { "exi-engine": { command: "node", args: ["tools/exi-mcp-server.mjs"], env: { EXI_MCP_ROOT: "." } } } } },
    codex: { add: "codex mcp add exi-engine -- node tools/exi-mcp-server.mjs", file: ".codex/config.toml", config: { table: "[mcp_servers.exi-engine]", command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: ".", startup_timeout_sec: 20, tool_timeout_sec: 360, default_tools_approval_mode: "writes" } },
    claude: { add: "claude mcp add --transport stdio exi-engine -- node tools/exi-mcp-server.mjs", file: ".mcp.json", config: { mcpServers: { "exi-engine": { type: "stdio", command: "node", args: ["${CLAUDE_PROJECT_DIR:-.}/tools/exi-mcp-server.mjs"], env: { EXI_MCP_ROOT: "${CLAUDE_PROJECT_DIR:-.}" }, timeout: 360000 } } } },
    opencode: { add: "opencode mcp add", file: "opencode.json", config: { mcp: { servers: { "exi-engine": { type: "local", command: ["node", "tools/exi-mcp-server.mjs"], cwd: ".", codemode: false, timeout: 360000 } } } } },
    gemini: { add: "gemini mcp add exi-engine node tools/exi-mcp-server.mjs", file: ".gemini/settings.json", config: { mcpServers: { "exi-engine": { command: "node", args: ["tools/exi-mcp-server.mjs"], cwd: ".", env: { EXI_MCP_ROOT: "." }, timeout: 360000 } } } },
    windsurf: { add: "copy the stdio JSON into ~/.codeium/windsurf/mcp_config.json", file: "~/.codeium/windsurf/mcp_config.json", config: { mcpServers: { "exi-engine": { command: "node", args: ["tools/exi-mcp-server.mjs"], env: { EXI_MCP_ROOT: "<repo-root>" } } } } },
  },
  nativeProbe: "npm run test:clients:native",
  nativeProbeStatuses: ["passed", "skipped", "unavailable", "failed", "spawn-error", "timeout"],
  fallback: "Other MCP clients should start { command: \"node\", args: [\"tools/exi-mcp-server.mjs\"], cwd: \"<repo-root>\", env: { EXI_MCP_ROOT: \"<repo-root>\" } } over stdio. Modern clients should send server/discover with _meta.io.modelcontextprotocol/protocolVersion=2026-07-28 and _meta.io.modelcontextprotocol/clientCapabilities; legacy clients should use initialize -> notifications/initialized. Both eras then use tools/list/resources/list/prompts/list. Client-specific config files are convenience wrappers; the stdio JSON-RPC contract is the compatibility boundary.",
};
const resourceFiles = new Map([
  ["exi://types", "index.d.ts"],
  ["exi://guide", "AI_ENGINE_GUIDE.md"],
  ["exi://security", "SECURITY.md"],
]);
const promptDefinitions = [
  { name: "exi_create_game", description: "Create and validate an ExiEngine browser game with the safe AI workflow.", arguments: [{ name: "goal", description: "Short game goal or mechanic to implement.", required: false }] },
  { name: "exi_verify_runtime", description: "Verify a scaffolded ExiEngine game through static preview and browser runtime telemetry.", arguments: [{ name: "path", description: "Preview path to the game index.html.", required: false }] },
];

async function readResource(uri) {
  const definition = resourceDefinitions.find((resource) => resource.uri === uri);
  if (!definition) fail(`MCP resource not found: ${uri}`, "EXI_MCP_RESOURCE_NOT_FOUND");
  let text;
  if (uri === "exi://api") text = JSON.stringify(apiContract(), null, 2);
  else if (uri === "exi://runtime") text = JSON.stringify(runtimeContract, null, 2);
  else if (uri === "exi://clients") text = JSON.stringify(clientContract, null, 2);
  else text = await readFile(path.join(ROOT, resourceFiles.get(uri)), "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_RESOURCE_BYTES) fail("MCP resource size limit exceeded.", "EXI_MCP_RESOURCE_LIMIT");
  return { contents: [{ uri, mimeType: definition.mimeType, text }] };
}

function getPrompt(name, rawArguments = {}) {
  assertSafeData(rawArguments);
  const definition = promptDefinitions.find((prompt) => prompt.name === name);
  if (!definition) fail(`MCP prompt not found: ${name}`, "EXI_MCP_PROMPT_NOT_FOUND");
  if (!isRecord(rawArguments)) fail("MCP prompt arguments must be an object.", "EXI_MCP_PROMPT_ARGS_TYPE");
  const allowedArguments = new Set(definition.arguments.map((argument) => argument.name));
  for (const key of Object.keys(rawArguments)) if (!allowedArguments.has(key)) fail(`Unknown MCP prompt argument: ${key}`, "EXI_MCP_ARGUMENT_UNKNOWN");
  if (name === "exi_create_game" && rawArguments.goal !== undefined && typeof rawArguments.goal !== "string") fail("Prompt goal must be a string.", "EXI_MCP_ARGUMENT_TYPE");
  if (name === "exi_verify_runtime" && rawArguments.path !== undefined && typeof rawArguments.path !== "string") fail("Prompt path must be a string.", "EXI_MCP_ARGUMENT_TYPE");
  const goal = typeof rawArguments.goal === "string" && rawArguments.goal.trim() ? rawArguments.goal.trim() : "a small playable 2D game";
  const previewPath = typeof rawArguments.path === "string" && rawArguments.path.trim() ? rawArguments.path.trim() : "/ai-game/index.html";
  const text = name === "exi_create_game"
    ? [
      "Build an ExiEngine game using the repository workflow.",
      `Game goal: ${goal}`,
      "1. Read exi://clients, exi://guide, exi://api, exi://types and exi://security.",
      "2. Call exi_api before guessing public names.",
      "3. Use exi_scaffold in a new relative directory, or exi_project_open for an existing relative game directory; use exi_project_apply for a bounded multi-file text change, exi_file_patch for one known unique change, and the normal file/chunk tools for other sources; use exi_asset_list/exi_asset_write or exi_asset_begin/chunk/commit for binary assets.",
      "4. Keep callbacks and gameplay code in reviewed project files; register reviewed callbacks in runtimeCallbacks and pass {\"$callback\":\"name\"} only when a browser API requires a function; do not serialize callback bodies in JSON MCP arguments.",
      "5. Run exi_project_status after file/asset edits when you need one bounded project map (files, assets, static check and matching preview telemetry); then use exi_project_preview for the safe check → index.html preview result (or exi_project_check + exi_preview_start separately). Use exi_file_check for one focused source iteration. If exi_project_preview returns ok=true, use its preview.previewId/pageUrl. If RuntimeAgent is loaded, use exi_preview_call or exi_preview_batch for browser engine operations; create an AssetLoader there and call loadTexture/loadAtlas/loadJSON for project assets before wiring Sprite/TextureAtlas handles; use exi_preview_probe for static/telemetry checks.",
      "6. If browser control exists, read exi://runtime and verify #exi-runtime after the backend warmup for WebGL2 and WebGPU; then read exi_preview_probe({ previewId, path: \"/__exi/runtime\" }) and compare the browser-posted report. A synthetic POST or static response is not GPU evidence.",
      "7. Call exi_session_status to confirm handles, uploads and previews are understood; stop the preview, release temporary handles and finish with exi_session_reset.",
    ].join("\n")
    : [
      "Verify an ExiEngine browser game end to end.",
      `Index path: ${previewPath}`,
      "1. Read exi://runtime and note its selector, attributes and warmupMs.",
      "2. Start a loopback preview and use exi_preview_probe for static HTTP/index checks.",
      "3. If browser control exists, open the index path and wait at least warmupMs after load/backend changes.",
      "4. Read #exi-runtime: ready=true, status=running, backend=webgpu or webgl2, positive fps, draws and nodes.",
      "5. If RuntimeAgent is loaded, use exi_preview_call/exi_preview_batch inspect/get for live handle evidence; select WebGL2 and WebGPU separately when supported, collect console error/warning output, wait warmupMs, then read exi_preview_probe({ previewId, path: \"/__exi/runtime\" }).",
      "6. Compare the server telemetry with the DOM and report static HTTP, browser DOM, server telemetry and GPU evidence separately; never treat a synthetic telemetry POST as GPU evidence.",
      "7. Run exi_check test and stop the preview and release all temporary resources.",
    ].join("\n");
  return { description: definition.description, messages: [{ role: "user", content: { type: "text", text } }] };
}

function resolveBatchResultPath(result, resultPath) {
  if (typeof resultPath !== "string" || !resultPath || resultPath.length > 128) fail("Batch result path is invalid.");
  const segments = resultPath.split(".");
  if (segments.some((segment) => !segment || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail("Batch result path must be a safe property path.");
  let current = result;
  for (const segment of segments) {
    if (current === null || (typeof current !== "object" && typeof current !== "function") || !Object.hasOwn(current, segment)) fail(`Batch result property not found: ${resultPath}.`);
    current = current[segment];
  }
  return current;
}

function resolveBatchReferences(value, results, depth = 0, key = "") {
  if (depth > MAX_VALUE_DEPTH) fail("Batch reference data depth limit exceeded.");
  if (Array.isArray(value)) return value.map((item) => resolveBatchReferences(item, results, depth + 1));
  if (!value || typeof value !== "object") return value;
  const referenceKeys = Object.keys(value);
  const hasResultReference = Number.isSafeInteger(value.$result) && (referenceKeys.length === 1 || (referenceKeys.length === 2 && referenceKeys.includes("$path")));
  if (hasResultReference) {
    const reference = results[value.$result];
    if (!reference || !reference.ok) fail(`Batch result reference is invalid: ${value.$result}.`);
    const result = Object.hasOwn(value, "$path") ? resolveBatchResultPath(reference.result, value.$path) : reference.result;
    if (result && typeof result === "object" && typeof result.$handle === "string") {
      return key === "handle" ? result.$handle : { $handle: result.$handle };
    }
    return result;
  }
  const resolved = {};
  for (const [property, item] of Object.entries(value)) {
    if (forbiddenKeys.has(property)) fail(`Unsafe batch field: ${property}`);
    resolved[property] = resolveBatchReferences(item, results, depth + 1, property);
  }
  return resolved;
}

async function runBatch({ calls, stopOnError = true } = {}, signal, progressToken) {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 128) fail("Batch calls must be between 1 and 128.");
  if (typeof stopOnError !== "boolean") fail("Batch stopOnError must be a boolean.");
  const results = [];
  sendProgress(progressToken, 0, calls.length, "Batch started.");
  for (let index = 0; index < calls.length; index += 1) {
    throwIfCancelled(signal);
    const call = calls[index];
    if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.name !== "string" || !call.name) fail(`Batch call ${index} is invalid.`);
    try {
      if (call.name === "exi_batch") fail("Nested exi_batch call was rejected.");
      const batchArguments = Object.hasOwn(call, "arguments") ? call.arguments : {};
      const result = await callTool(call.name, resolveBatchReferences(batchArguments, results), { signal, progressToken });
      results.push({ index, name: call.name, ok: true, result });
    } catch (error) {
      results.push({ index, name: call.name, ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code || "EXI_MCP_BATCH_ERROR" });
      if (stopOnError) break;
    }
    sendProgress(progressToken, index + 1, calls.length, `Batch call completed: ${call.name}`);
  }
  return { completed: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length, stopped: results.length < calls.length, results };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function requirePreview(previewId) {
  if (typeof previewId !== "string" || !/^p[1-9][0-9]*$/.test(previewId) || !previews.has(previewId)) fail(`Preview not found: ${previewId}`);
  return previews.get(previewId);
}

function previewState(preview) {
  if (preview.state === "stopping") return "stopping";
  if (preview.exited || preview.child?.exitCode !== null) return "exited";
  return preview.state === "ready" ? "ready" : "starting";
}

function pruneExitedPreviews() {
  for (const [previewId, preview] of previews) {
    if (previewState(preview) === "exited") previews.delete(previewId);
  }
}

async function waitForPreview(preview, timeoutMs = MAX_PREVIEW_STARTUP_MS, signal, pagePath = "/") {
  const deadline = Date.now() + timeoutMs;
  const targetUrl = new URL(pagePath, preview.url).href;
  while (Date.now() < deadline) {
    throwIfCancelled(signal);
    if (preview.exited) return false;
    try {
      const response = await fetch(targetUrl, { redirect: "error", signal: AbortSignal.timeout(250) });
      if (response.ok) return true;
      if (response.status === 404) return false;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throwIfCancelled(signal);
  return false;
}

function inferPreviewDirectory(pagePath) {
  const segments = pagePath.replace(/^\/+/, "").split("/");
  if (segments.length < 2) return null;
  segments.pop();
  const candidate = segments.join("/");
  if (!candidate) return null;
  let target;
  try { target = resolvePath(candidate); } catch { return null; }
  return findScaffoldRoot(target);
}

async function startPreview({ port = null, path: pagePath = "/", directory = null } = {}, signal, progressToken) {
  throwIfCancelled(signal);
  sendProgress(progressToken, 0, 1, "Preview starting.");
  pruneExitedPreviews();
  if (previews.size >= MAX_PREVIEWS) fail(`At most ${MAX_PREVIEWS} previews can run at the same time.`, "EXI_MCP_PREVIEW_LIMIT");
  const safePagePath = safePreviewPath(pagePath);
  const previewDirectory = directory ?? inferPreviewDirectory(safePagePath);
  const requestedPort = port === null || port === undefined ? await findFreePort() : Number(port);
  throwIfCancelled(signal);
  if (!Number.isSafeInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65_535) fail("Preview port is invalid.");
  const previewId = `p${nextPreviewId++}`;
  const runtimeToken = randomBytes(18).toString("base64url");
  const preview = { id: previewId, directory: previewDirectory, pagePath: safePagePath, port: requestedPort, url: `http://127.0.0.1:${requestedPort}/`, runtimeToken, child: null, state: "starting", exited: false, stopPromise: null, stdout: "", stderr: "" };
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--port", String(requestedPort)], { cwd: ROOT, env: { ...process.env, EXI_RUNTIME_TOKEN: runtimeToken }, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  preview.child = child;
  const append = (target, chunk) => `${target}${chunk}`.slice(-MAX_OUTPUT_BYTES);
  child.stdout.on("data", (chunk) => { preview.stdout = append(preview.stdout, chunk.toString()); });
  child.stderr.on("data", (chunk) => { preview.stderr = append(preview.stderr, chunk.toString()); });
  child.once("exit", () => { preview.exited = true; if (preview.state !== "stopping") preview.state = "exited"; });
  child.once("error", (error) => { preview.exited = true; preview.state = "exited"; preview.stderr = append(preview.stderr, error.message); });
  previews.set(previewId, preview);
  let ready;
  try {
    ready = await waitForPreview(preview, MAX_PREVIEW_STARTUP_MS, signal, safePagePath);
    throwIfCancelled(signal);
  } catch (error) {
    try { await stopPreview(previewId); } catch { /* cancellation cleanup remains best effort */ }
    throw error;
  }
  if (!ready) {
    await stopPreview(previewId);
    fail(`Preview could not be started: ${preview.stderr || "server did not become ready"}`, "EXI_MCP_PREVIEW_START");
  }
  preview.state = "ready";
  sendProgress(progressToken, 1, 1, "Preview ready.");
  return { previewId, url: preview.url, pagePath: safePagePath, pageUrl: new URL(safePagePath, preview.url).href, port: preview.port, state: "ready", ready: true, runtime: { path: "/__exi/runtime", tokenManaged: true } };
}

async function projectPreview({ path: directoryPath, port = null } = {}, signal, progressToken) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Project directory cannot be the repository root.", "EXI_MCP_FILE_SCOPE");
  const projectCheck = await checkProject({ path: target.relative }, signal, progressToken);
  if (!projectCheck.ok) return { ok: false, phase: "project-check", directory: target.relative, projectCheck, preview: null };
  const entryPath = `${target.relative}/index.html`;
  const entry = await inspectProjectFile(resolveProjectFile(entryPath));
  if (!entry) return { ok: false, phase: "entry", directory: target.relative, entryPath, projectCheck, preview: null, error: { code: "EXI_MCP_ENTRY_NOT_FOUND", message: `Preview entry not found: ${entryPath}` } };
  const preview = await startPreview({ port, path: `/${entryPath}`, directory: target.relative }, signal, progressToken);
  return { ok: true, phase: "preview", directory: target.relative, entryPath, projectCheck, preview };
}

async function projectStatus({ path: directoryPath } = {}, signal, progressToken) {
  throwIfCancelled(signal);
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Project directory cannot be the repository root.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const files = await listProjectFiles({ path: target.relative });
  throwIfCancelled(signal);
  const assets = await listProjectAssets({ path: target.relative });
  throwIfCancelled(signal);
  const projectCheck = await checkProject({ path: target.relative }, signal, progressToken);
  pruneExitedPreviews();
  const activePreviews = [];
  for (const preview of previews.values()) {
    if (preview.directory !== target.relative) continue;
    throwIfCancelled(signal);
    const state = previewState(preview);
    let runtime = null;
    try {
      const probe = await probePreview({ previewId: preview.id, path: "/__exi/runtime" }, signal);
      let telemetry = null;
      try {
        const parsed = JSON.parse(probe.body);
        if (isRecord(parsed)) telemetry = parsed;
      } catch { /* static preview may not have browser telemetry yet */ }
      runtime = { status: probe.status, ok: probe.ok, telemetry };
    } catch (error) {
      if (error?.code === "EXI_MCP_CANCELLED") throw error;
      runtime = { status: null, ok: false, telemetry: null, error: { code: error?.code || "EXI_MCP_PREVIEW_PROBE", message: String(error?.message || error) } };
    }
    activePreviews.push({ previewId: preview.id, directory: preview.directory, pagePath: preview.pagePath, pageUrl: new URL(preview.pagePath, preview.url).href, port: preview.port, state, ready: state === "ready", runtime });
  }
  return { directory: target.relative, ok: projectCheck.ok, projectCheck, files: files.files, assets: assets.assets, previews: activePreviews };
}

function sessionStatus() {
  pruneExitedPreviews();
  return {
    handleCount: handles.size,
    protectedHandleCount: protectedHandles.size,
    handles: [...handles].map(([handle, value]) => ({
      handle,
      type: getHandleType(value),
      protected: protectedHandles.has(handle),
      destroyable: typeof findPropertyDescriptor(value, "destroy")?.value === "function",
    })),
    scopes: [...scaffoldDirectories].sort(),
    assetUploads: [...assetUploads.values()].map((upload) => ({
      uploadId: upload.id,
      path: upload.target.relative,
      expectedBytes: upload.expectedBytes,
      receivedBytes: upload.receivedBytes,
      remainingBytes: upload.expectedBytes - upload.receivedBytes,
      complete: upload.state === "complete",
      state: upload.state,
      createdAt: upload.createdAt,
      lastActivityAt: upload.lastActivityAt,
    })),
    projectFileUploads: [...projectFileUploads.values()].map((upload) => ({
      fileUploadId: upload.id,
      path: upload.target.relative,
      expectedBytes: upload.expectedBytes,
      receivedBytes: upload.receivedBytes,
      remainingBytes: upload.expectedBytes - upload.receivedBytes,
      complete: upload.state === "complete",
      state: upload.state,
      createdAt: upload.createdAt,
      lastActivityAt: upload.lastActivityAt,
    })),
    previews: [...previews.values()].map((preview) => ({
      previewId: preview.id,
      directory: preview.directory,
      pagePath: preview.pagePath,
      pageUrl: new URL(preview.pagePath, preview.url).href,
      port: preview.port,
      state: previewState(preview),
      ready: previewState(preview) === "ready",
      runtime: { tokenManaged: true },
    })),
  };
}

function getHandleType(value) {
  const prototype = value && (typeof value === "object" || typeof value === "function") ? Object.getPrototypeOf(value) : null;
  const constructor = findPropertyDescriptor(value, "constructor")?.value || (prototype === Object.prototype ? Object : null);
  return typeof constructor?.name === "string" && constructor.name ? constructor.name : "object";
}

async function readResponseLimited(response, maxBytes = MAX_OUTPUT_BYTES) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) fail("Preview response size limit exceeded.", "EXI_MCP_PREVIEW_LIMIT");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) { await reader.cancel(); fail("Preview response size limit exceeded.", "EXI_MCP_PREVIEW_LIMIT"); }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

const runtimeOperations = new Set(["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario", "batch"]);
const binaryPayloadSchema = { type: "object", required: ["$bytes"], additionalProperties: false, properties: { "$bytes": { oneOf: [{ type: "array", minItems: 0, maxItems: MAX_BINARY_BYTES, items: { type: "integer", minimum: 0, maximum: 255 } }, { type: "string", maxLength: MAX_BASE64_STRING_LENGTH, description: "RFC 4648 base64" }] } } };

async function cancelPreviewRuntimeCommand(preview, commandId) {
  try {
    await fetch(`${preview.url}__exi/runtime-command?id=${encodeURIComponent(commandId)}`, { method: "DELETE", headers: { "x-exi-runtime-token": preview.runtimeToken }, signal: AbortSignal.timeout(1_000) });
  } catch { /* preview may already be gone */ }
}

async function callPreviewRuntime({ previewId, operation, ...command } = {}, signal) {
  throwIfCancelled(signal);
  const preview = requirePreview(previewId);
  if (typeof operation !== "string" || !runtimeOperations.has(operation)) fail(`Runtime operation is not supported: ${operation}`, "EXI_MCP_RUNTIME_OPERATION");
  if (operation === "batch" && (!Array.isArray(command.calls) || command.calls.length === 0 || command.calls.length > MAX_RUNTIME_BATCH_CALLS)) fail(`Runtime batch calls must be between 1 and ${MAX_RUNTIME_BATCH_CALLS}.`, "EXI_MCP_RUNTIME_BATCH_LIMIT");
  const commandId = `r${nextRuntimeCommandId++}`;
  const payload = { id: commandId, operation, ...command };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_RUNTIME_COMMAND_BYTES) fail("Runtime command size limit exceeded.", "EXI_MCP_RUNTIME_LIMIT");
  let completed = false;
  try {
    const accepted = await fetch(`${preview.url}__exi/runtime-command`, { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": preview.runtimeToken }, body, signal: signal || AbortSignal.timeout(5_000) });
    if (accepted.status !== 202) fail(`Runtime command was not accepted: HTTP ${accepted.status}`, "EXI_MCP_RUNTIME_UNAVAILABLE");
    const deadline = Date.now() + MAX_RUNTIME_COMMAND_WAIT_MS;
    while (Date.now() < deadline) {
      throwIfCancelled(signal);
      const resultResponse = await fetch(`${preview.url}__exi/runtime-result?id=${encodeURIComponent(commandId)}`, { headers: { "x-exi-runtime-token": preview.runtimeToken }, signal: AbortSignal.timeout(1_000) }).catch((error) => {
        if (error?.name === "TimeoutError") return null;
        throw error;
      });
      if (resultResponse?.status === 200) {
        const result = JSON.parse(await readResponseLimited(resultResponse, MAX_RUNTIME_RESULT_BYTES));
        if (result.id !== commandId) fail("Runtime result id did not match.", "EXI_MCP_RUNTIME_RESULT");
        completed = true;
        if (!result.ok) {
          const error = new Error(result.error?.message || "Browser runtime command failed.");
          error.code = result.error?.code || "EXI_MCP_RUNTIME_ERROR";
          throw error;
        }
        return result.value;
      }
      if (resultResponse && resultResponse.status !== 404) fail(`Runtime result could not be retrieved: HTTP ${resultResponse.status}`, "EXI_MCP_RUNTIME_UNAVAILABLE");
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    fail("Browser runtime command timed out.", "EXI_MCP_RUNTIME_TIMEOUT");
  } finally {
    if (!completed) await cancelPreviewRuntimeCommand(preview, commandId);
  }
}

function safePreviewPath(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) fail("Preview path is invalid.");
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { fail("Preview path encoding is invalid."); }
  if (!decoded.startsWith("/") || decoded.split("/").some((part) => part === "..") || decoded.includes("\\")) fail("Preview path traversal was rejected.");
  return decoded;
}

async function probePreview({ previewId, path: requestPath = "/" } = {}, signal) {
  throwIfCancelled(signal);
  const preview = requirePreview(previewId);
  const pathname = safePreviewPath(requestPath);
  const url = new URL(pathname, preview.url);
  if (url.origin !== preview.url.slice(0, -1)) fail("Preview origin is invalid.");
  const headers = pathname === "/__exi/runtime" ? { "x-exi-runtime-token": preview.runtimeToken } : undefined;
  const response = await fetch(url, { redirect: "error", headers, signal: AbortSignal.timeout(5_000) });
  throwIfCancelled(signal);
  const text = await readResponseLimited(response);
  return { previewId, url: url.href, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") || "", body: text };
}

async function stopPreview(previewId) {
  if (typeof previewId !== "string" || !/^p[1-9][0-9]*$/.test(previewId)) fail(`Preview not found: ${previewId}`);
  const preview = previews.get(previewId);
  if (!preview) return { stopped: previewId, alreadyStopped: true, state: "exited" };
  if (preview.stopPromise) {
    await preview.stopPromise;
    return { stopped: previewId, alreadyStopped: true, state: "exited" };
  }
  const wasActive = Boolean(preview.child && !preview.exited && preview.child.exitCode === null);
  preview.state = "stopping";
  const stopPromise = (async () => {
    try {
      if (wasActive) await terminateProcessTree(preview.child);
    } finally {
      preview.exited = true;
      preview.state = "exited";
      previews.delete(previewId);
    }
  })();
  preview.stopPromise = stopPromise;
  await stopPromise;
  return { stopped: previewId, alreadyStopped: !wasActive, state: "exited" };
}

const expectedVersionSchema = { type: "object", required: ["bytes", "mtimeMs"], additionalProperties: false, properties: { bytes: { type: "integer", minimum: 0 }, mtimeMs: { type: "number", minimum: 0 } }, description: "Version from a previous read/list result; used to reject a stale overwrite." };
const expectedSha256Schema = { type: "string", maxLength: 64, description: "Optional SHA-256 hex digest; must match the upload commit content." };

const tools = [
  { name: "exi_api", description: "Returns the manifest of ExiEngine public classes, functions, methods and constants.", inputSchema: { type: "object", properties: {} }, annotations: { title: "ExiEngine API manifest", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_session_status", description: "Returns this MCP session's handle, scope, pending upload and preview metadata in bounded form without running getters; does not reveal the token.", inputSchema: { type: "object", properties: {} }, annotations: { title: "Inspect engine session", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_session_reset", description: "Safely releases all engine handles in this MCP session.", inputSchema: { type: "object", properties: {} }, annotations: { title: "Reset engine session", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_create", description: "Creates a handle from an ExiEngine public class.", inputSchema: { type: "object", required: ["type"], properties: { type: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Create engine object", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_function", description: "Calls an ExiEngine public function with handle arguments.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine function", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_export_get", description: "Reads an allowlisted constant or static value from the src/index.js export tree.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Read engine export", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_export_call", description: "Calls an allowlisted public function from the src/index.js export tree asynchronously.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine export", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_static_call", description: "Calls a static method on a public class.", inputSchema: { type: "object", required: ["type", "method"], properties: { type: { type: "string" }, method: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call static engine method", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_call", description: "Calls a public method on an engine handle.", inputSchema: { type: "object", required: ["handle", "method"], properties: { handle: { type: "string" }, method: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine method", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_inspect", description: "Returns an engine handle's public method and property metadata without reading values, so an AI can build a reliable call plan.", inputSchema: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } }, annotations: { title: "Inspect engine handle", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_get", description: "Reads a public property/getter value on an engine handle.", inputSchema: { type: "object", required: ["handle", "property"], properties: { handle: { type: "string" }, property: { type: "string" } } }, annotations: { title: "Read engine property", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_set", description: "Replaces a public data field on an engine handle with a JSON value.", inputSchema: { type: "object", required: ["handle", "property", "value"], properties: { handle: { type: "string" }, property: { type: "string" }, value: {} } }, annotations: { title: "Set engine property", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_release", description: "Releases the handle and runs its destroy() lifecycle if present.", inputSchema: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } }, annotations: { title: "Release engine handle", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_build_scene", description: "Builds a bounded, safe ExiEngine node tree from a JSON declaration.", inputSchema: { type: "object", required: ["scene"], properties: { scene: { type: "object" } } }, annotations: { title: "Build scene graph", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_scaffold", description: "Creates a minimal, traversal-protected browser game project inside the repository.", inputSchema: { type: "object", properties: { directory: { type: "string" }, overwrite: { type: "boolean" } } }, annotations: { title: "Scaffold browser game", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_project_apply", description: "Writes up to 16 bounded text files to a game folder in the same session scope in one transactional flow; rolls back earlier files on a preflight or commit error. If a read/list version is given for each file, a stale overwrite is rejected.", inputSchema: { type: "object", required: ["path", "files"], properties: { path: { type: "string" }, files: { type: "array", minItems: 1, maxItems: MAX_PROJECT_APPLY_FILES, items: { type: "object", required: ["path", "content"], additionalProperties: false, properties: { path: { type: "string", minLength: 1 }, content: { type: "string", maxLength: MAX_PROJECT_FILE_BYTES }, expectedVersion: expectedVersionSchema } } }, overwrite: { type: "boolean", default: false } } }, annotations: { title: "Apply project text files", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_read", description: "Reads an allowlisted text project file under the repository root with bounded content; uses UTF-8 offset/limit paging for large files.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_PROJECT_READ_BYTES } } }, annotations: { title: "Read project text file", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_list", description: "Lists the allowlisted text files in a project folder scaffolded in the same session or opened with exi_project_open, with bounded metadata.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "List project files", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_write", description: "Creates an allowlisted text project file under the repository root with bounded UTF-8 content, or updates it with explicit overwrite; expectedVersion rejects a stale overwrite and expectedSha256 rejects corrupted content.", inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string", maxLength: MAX_PROJECT_FILE_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Write project text file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_patch", description: "Atomically replaces exactly one exact match of the find text in an existing allowlisted text project file; with zero or several matches the file is not touched.", inputSchema: { type: "object", required: ["path", "find", "replace"], properties: { path: { type: "string" }, find: { type: "string", minLength: 1, maxLength: MAX_PROJECT_PATCH_TEXT_BYTES }, replace: { type: "string", maxLength: MAX_PROJECT_PATCH_TEXT_BYTES } } }, annotations: { title: "Patch project text file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_begin", description: "Starts a sequential chunk upload for an allowlisted text project file over 64 KiB; the temporary file is kept inside the project scope, expectedVersion rejects a stale commit and expectedSha256 rejects corrupted content.", inputSchema: { type: "object", required: ["path", "size"], properties: { path: { type: "string" }, size: { type: "integer", minimum: 0, maximum: MAX_CHUNKED_PROJECT_FILE_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Begin chunked project file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_chunk", description: "Appends a sequential UTF-8 text chunk to a chunk upload; offset must equal the previous receivedBytes.", inputSchema: { type: "object", required: ["fileUploadId", "offset", "content"], properties: { fileUploadId: { type: "string" }, offset: { type: "integer", minimum: 0 }, content: { type: "string", maxLength: MAX_PROJECT_FILE_CHUNK_BYTES } } }, annotations: { title: "Write project file chunk", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_commit", description: "Commits a completed text upload to the verified target file.", inputSchema: { type: "object", required: ["fileUploadId"], properties: { fileUploadId: { type: "string" } } }, annotations: { title: "Commit project file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_abort", description: "Cleans up the temporary file of a chunked text upload.", inputSchema: { type: "object", required: ["fileUploadId"], properties: { fileUploadId: { type: "string" } } }, annotations: { title: "Abort project file", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_list", description: "Lists the allowlisted game assets in a folder scaffolded in the same session or opened with exi_project_open, with bounded metadata.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "List game assets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_read", description: "Reads a byte range of at most 32 KiB of an allowlisted game asset in the same session as base64; the whole file is not loaded into memory.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_ASSET_READ_BYTES } } }, annotations: { title: "Read game asset bytes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_write", description: "Uploads a bounded binary game asset to a folder scaffolded in the same session or opened with exi_project_open; expectedVersion rejects a stale overwrite and expectedSha256 rejects corrupted content.", inputSchema: { type: "object", required: ["path", "bytes"], properties: { path: { type: "string" }, bytes: binaryPayloadSchema, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Upload game asset", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_begin", description: "Starts a sequential chunk upload for an allowlisted asset over 512 KiB; the temporary file is kept inside the project scope, expectedVersion rejects a stale commit and expectedSha256 rejects corrupted content.", inputSchema: { type: "object", required: ["path", "size"], properties: { path: { type: "string" }, size: { type: "integer", minimum: 0, maximum: MAX_CHUNKED_ASSET_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Begin chunked asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_chunk", description: "Appends a sequential bounded byte chunk to a chunk upload; offset must equal the previous receivedBytes.", inputSchema: { type: "object", required: ["uploadId", "offset", "bytes"], properties: { uploadId: { type: "string" }, offset: { type: "integer", minimum: 0 }, bytes: binaryPayloadSchema } }, annotations: { title: "Write asset chunk", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_commit", description: "Moves a completed chunk upload to the verified target asset name; replaces an existing file only if overwrite is given explicitly.", inputSchema: { type: "object", required: ["uploadId"], properties: { uploadId: { type: "string" } } }, annotations: { title: "Commit asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_abort", description: "Cleans up the temporary file of a chunk upload.", inputSchema: { type: "object", required: ["uploadId"], properties: { uploadId: { type: "string" } } }, annotations: { title: "Abort asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_check", description: "Runs a bounded static check, without executing code, on a .html/.js/.mjs/.json project file scaffolded in the same session or opened with exi_project_open.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Check project file syntax", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_status", description: "Returns the same-session project in one bounded read-only result with files, assets, the static check and a summary of the project's preview telemetry; explicitly separates the case with no browser/GPU.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Inspect game project status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_check", description: "Checks the allowlisted text files of a game scaffolded in the same session or opened with exi_project_open in one bounded flow; does not run arbitrary code.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Check whole game project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_preview", description: "Statically checks the game in the same session scope first; if all checkable files pass, starts a loopback preview for index.html and returns pageUrl. Does not produce browser/GPU evidence.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, port: { type: "integer", minimum: 1, maximum: 65535 } } }, annotations: { title: "Check and preview game", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_project_open", description: "Statically checks an existing game folder in the repository first, then opens it to the same session's bounded file/asset scope; does not run arbitrary code.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Open existing game project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_check", description: "Runs the doctor, test or verify release check without running an arbitrary shell.", inputSchema: { type: "object", required: ["mode"], properties: { mode: { enum: ["doctor", "test", "verify"] } } }, annotations: { title: "Run ExiEngine checks", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_preview_start", description: "Starts the repository server.mjs on a safe loopback port; does not report ready until the requested game page path returns HTTP 200, and returns pageUrl.", inputSchema: { type: "object", properties: { port: { type: "integer", minimum: 1, maximum: 65535 }, path: { type: "string", minLength: 1, maxLength: 512, description: "Game page inside the repository, e.g. /ai-game/index.html" } } }, annotations: { title: "Start local preview", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_preview_call", description: "Calls the browser engine API running behind the token-protected demo or scaffold RuntimeAgent with an allowlisted operation; observe gives a bounded canvas grid/hash, snapshot a bounded scene graph/hash, and scenario a bounded input → fixed-step → observe/snapshot flow; APIs that take callbacks can only use a {\"$callback\":\"name\"} reference registered on the page; does not run eval or arbitrary scripts. Use exi_preview_batch for batches.", inputSchema: { type: "object", required: ["previewId", "operation"], properties: { previewId: { type: "string" }, operation: { enum: ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario"] }, name: { type: "string" }, path: { type: "string" }, type: { type: "string" }, method: { type: "string" }, handle: { type: "string" }, property: { type: "string" }, value: {}, args: { type: "array", description: "JSON arguments; {columns,rows} for observe, [{offset,limit}] for snapshot, [{frames:[{delta,input,observe,snapshot}],resume?}] for scenario; browser APIs that need a callback accept a {\"$callback\":\"name\"} reference registered on the page." } } }, annotations: { title: "Call browser engine runtime", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_preview_batch", description: "Runs up to 8 allowlisted operations in order on the browser RuntimeAgent; observe gives a bounded canvas grid/hash, snapshot a bounded scene graph/hash, scenario a bounded input/step observation; earlier results can be passed to later calls with $result, and APIs that take callbacks use a {\"$callback\":\"name\"} reference registered on the page.", inputSchema: { type: "object", required: ["previewId", "calls"], properties: { previewId: { type: "string" }, calls: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", required: ["operation"], additionalProperties: false, properties: { operation: { enum: ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario"] }, name: { type: "string" }, path: { type: "string" }, type: { type: "string" }, method: { type: "string" }, handle: {}, property: { type: "string" }, value: {}, args: { type: "array", description: "JSON arguments; {columns,rows} for observe, [{offset,limit}] for snapshot, [{frames:[{delta,input,observe,snapshot}],resume?}] for scenario; callbacks use a {\"$callback\":\"name\"} reference registered on the page, and no callback body is carried." } } } }, stopOnError: { type: "boolean", default: true } } }, annotations: { title: "Batch browser engine runtime", readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: "exi_preview_probe", description: "Verifies a GET resource inside a started loopback preview with a bounded response; the /__exi/runtime path returns token-managed browser telemetry.", inputSchema: { type: "object", required: ["previewId"], properties: { previewId: { type: "string" }, path: { type: "string" } } }, annotations: { title: "Probe local preview", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_preview_stop", description: "Stops the loopback preview process started by this MCP session.", inputSchema: { type: "object", required: ["previewId"], properties: { previewId: { type: "string" } } }, annotations: { title: "Stop local preview", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_batch", description: "Runs up to 128 public ExiEngine tool calls in order on the same session queue; handle results and {$result:0,$path:\"fileUploadId\"} field references can be used in later calls.", inputSchema: { type: "object", required: ["calls"], properties: { calls: { type: "array", maxItems: 128, items: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string" }, arguments: { type: "object" } } } }, stopOnError: { type: "boolean", default: true } } }, annotations: { title: "Batch engine calls", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
];

for (const tool of tools) tool.inputSchema.additionalProperties = false;

function schemaTypeMatches(value, type) {
  if (type === "object") return isRecord(value);
  if (type === "array") return Array.isArray(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return true;
}

function validateToolSchema(value, schema, path) {
  if (!schema || Object.keys(schema).length === 0) return;
  if (Array.isArray(schema.oneOf)) {
    for (const branch of schema.oneOf) {
      try {
        validateToolSchema(value, branch, path);
        return;
      } catch {
        // Another bounded schema branch may match.
      }
    }
    fail(`${path} does not match the MCP schema.`, "EXI_MCP_ARGUMENT_INVALID");
  }
  if (schema.type && !schemaTypeMatches(value, schema.type)) fail(`${path} must be ${schema.type}.`, path === "arguments.args" ? "EXI_MCP_ARGS_TYPE" : "EXI_MCP_ARGUMENT_TYPE");
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail(`${path} is not a valid enum value.`, "EXI_MCP_ARGUMENT_ENUM");
  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) fail(`${path} is below the minimum.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (Number.isFinite(schema.maximum) && value > schema.maximum) fail(`${path} exceeds the maximum.`, "EXI_MCP_ARGUMENT_LIMIT");
  }
  if (typeof value === "string" && Number.isSafeInteger(schema.maxLength) && value.length > schema.maxLength) fail(`${path} length limit exceeded.`, "EXI_MCP_ARGUMENT_LIMIT");
  if (Array.isArray(value)) {
    if (Number.isSafeInteger(schema.minItems) && value.length < schema.minItems) fail(`${path} must contain at least ${schema.minItems} items.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (Number.isSafeInteger(schema.maxItems) && value.length > schema.maxItems) fail(`${path} must contain at most ${schema.maxItems} items.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (schema.items) for (let index = 0; index < value.length; index += 1) validateToolSchema(value[index], schema.items, `${path}[${index}]`);
  }
  if (isRecord(value) && schema.properties) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required) || value[required] === undefined) fail(`${path}.${required} zorunlu.`, "EXI_MCP_ARGUMENT_REQUIRED");
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail(`${path}.${key} is an unknown field.`, "EXI_MCP_ARGUMENT_UNKNOWN");
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) validateToolSchema(value[key], childSchema, `${path}.${key}`);
    }
  }
}

async function callTool(name, rawArguments = {}, context = {}) {
  assertSafeData(rawArguments);
  const definition = tools.find((tool) => tool.name === name);
  if (!definition) fail(`MCP tool not found: ${name}`, "EXI_MCP_TOOL_NOT_FOUND");
  const signal = context?.signal;
  const progressToken = context?.progressToken;
  throwIfCancelled(signal);
  const args = rawArguments === undefined ? {} : rawArguments;
  if (!isRecord(args)) fail("MCP tool arguments must be an object.", "EXI_MCP_ARGS_TYPE");
  if (name === "exi_preview_call" && args.operation === "batch") fail("Use the exi_preview_batch tool for runtime batches.", "EXI_MCP_RUNTIME_BATCH_ROUTE");
  if (name === "exi_preview_call" && typeof args.operation === "string" && !runtimeOperations.has(args.operation)) fail(`Runtime operation is not supported: ${args.operation}`, "EXI_MCP_RUNTIME_OPERATION");
  if (name === "exi_preview_batch" && Array.isArray(args.calls) && (args.calls.length === 0 || args.calls.length > MAX_RUNTIME_BATCH_CALLS)) fail(`Runtime batch calls must be between 1 and ${MAX_RUNTIME_BATCH_CALLS}.`, "EXI_MCP_RUNTIME_BATCH_LIMIT");
  validateToolSchema(args, definition.inputSchema, "arguments");
  if (name === "exi_api") return apiContract();
  if (name === "exi_session_status") return sessionStatus();
  if (name === "exi_session_reset") {
    for (const previewId of [...previews.keys()]) {
      try { await stopPreview(previewId); } catch { /* session reset remains best effort */ }
    }
    for (const [handle, value] of handles) {
      if (!protectedHandles.has(handle) && typeof value?.destroy === "function") {
        try { value.destroy(); } catch { /* release remains best effort */ }
      }
      objectHandles.delete(value);
    }
    handles.clear();
    protectedHandles.clear();
    scaffoldDirectories.clear();
    for (const upload of [...assetUploads.values()]) {
      try { await removeAssetUpload(upload); } catch { /* upload cleanup remains best effort */ }
    }
    for (const upload of [...projectFileUploads.values()]) {
      try { await removeProjectFileUpload(upload); } catch { /* upload cleanup remains best effort */ }
    }
    return { released: true };
  }
  if (name === "exi_create") return resultValue(await createExported(args.type, resolveArgs(args.args)));
  if (name === "exi_function") {
    const functionName = assertPublicName(args.name, "name");
    const fn = isAgentCallableExport(functionName) ? engineExports[functionName] : undefined;
    if (typeof fn !== "function" || isClass(fn)) fail(`Public function not found: ${args.name}`);
    return resultValue(await fn(...resolveArgs(args.args)));
  }
  if (name === "exi_export_get") return protectedResultValue(await resolveExportPath(args.path).value);
  if (name === "exi_export_call") {
    const resolved = resolveExportPath(args.path);
    if (typeof resolved.value !== "function") fail(`Public export is not a function: ${args.path}`);
    return resultValue(await resolved.value.apply(resolved.parent, resolveArgs(args.args)));
  }
  if (name === "exi_static_call") {
    const type = assertPublicName(args.type, "type");
    const Constructor = engineExports[type];
    if (!isClass(Constructor)) fail(`Static method not found: ${type}.${args.method}`);
    return resultValue(await getPublicStaticMethod(Constructor, args.method).apply(Constructor, resolveArgs(args.args)));
  }
  if (name === "exi_call") {
    const object = requireHandle(args.handle);
    return resultValue(await getPublicMethod(object, args.method).apply(object, resolveArgs(args.args)));
  }
  if (name === "exi_inspect") return inspectHandle(requireHandle(args.handle), args.handle);
  if (name === "exi_get") return resultValue(await getPublicProperty(requireHandle(args.handle), args.property));
  if (name === "exi_set") {
    const object = requireHandle(args.handle);
    const property = assertPublicName(args.property, "property");
    const descriptor = findPropertyDescriptor(object, property);
    if (!descriptor) fail(`Engine property not found: ${property}`);
    if (typeof descriptor.value === "function") fail(`Method cannot be written as a property: ${property}`);
    if ("value" in descriptor && descriptor.writable !== true) fail(`Property is not writable: ${property}`);
    if (!("value" in descriptor) && typeof descriptor.set !== "function") fail(`Property is not writable: ${property}`);
    const current = object[property];
    if (Array.isArray(current) || current instanceof Map || current instanceof Set) fail(`Collection property cannot be written directly: ${property}`);
    const next = resolveArgument(args.value);
    if (current && typeof current === "object" && next && typeof next === "object" && !objectHandles.has(next)) fail(`Object property must be changed through a handle: ${property}`);
    object[property] = next;
    return { handle: args.handle, property, value: serialize(object[property]) };
  }
  if (name === "exi_release") {
    const object = requireHandle(args.handle);
    if (!protectedHandles.has(args.handle) && typeof object.destroy === "function") object.destroy();
    handles.delete(args.handle);
    protectedHandles.delete(args.handle);
    objectHandles.delete(object);
    return { released: args.handle };
  }
  if (name === "exi_build_scene") {
    const state = { nodes: 0, created: [] };
    try { return await buildScene(args.scene, state); } catch (error) {
      for (const handle of state.created.reverse()) {
        const value = handles.get(handle);
        try { if (typeof value?.destroy === "function") value.destroy(); } catch { /* rollback best effort */ }
        if (value) objectHandles.delete(value);
        handles.delete(handle);
      }
      throw error;
    }
  }
  if (name === "exi_scaffold") return scaffold(args);
  if (name === "exi_project_apply") return applyProjectFiles(args);
  if (name === "exi_file_read") return readProjectFile(args);
  if (name === "exi_file_list") return listProjectFiles(args);
  if (name === "exi_file_write") return writeProjectFile(args);
  if (name === "exi_file_patch") return patchProjectFile(args);
  if (name === "exi_file_begin") return beginProjectFileUpload(args);
  if (name === "exi_file_chunk") return writeProjectFileChunk(args);
  if (name === "exi_file_commit") return commitProjectFileUpload(args);
  if (name === "exi_file_abort") return abortProjectFileUpload(args);
  if (name === "exi_asset_list") return listProjectAssets(args);
  if (name === "exi_asset_read") return readProjectAsset(args);
  if (name === "exi_asset_write") return writeProjectAsset(args);
  if (name === "exi_asset_begin") return beginAssetUpload(args);
  if (name === "exi_asset_chunk") return writeAssetChunk(args);
  if (name === "exi_asset_commit") return commitAssetUpload(args);
  if (name === "exi_asset_abort") return abortAssetUpload(args);
  if (name === "exi_file_check") return checkProjectFile(args, signal);
  if (name === "exi_project_status") return projectStatus(args, signal, progressToken);
  if (name === "exi_project_check") return checkProject(args, signal, progressToken);
  if (name === "exi_project_preview") return projectPreview(args, signal, progressToken);
  if (name === "exi_project_open") return openProject(args, signal, progressToken);
  if (name === "exi_check") return runCheck(args.mode, signal, progressToken);
  if (name === "exi_preview_start") return startPreview(args, signal, progressToken);
  if (name === "exi_preview_call") {
    if (args.operation === "batch") fail("Use the exi_preview_batch tool for runtime batches.", "EXI_MCP_RUNTIME_BATCH_ROUTE");
    return callPreviewRuntime(args, signal);
  }
  if (name === "exi_preview_batch") return callPreviewRuntime({ ...args, operation: "batch" }, signal);
  if (name === "exi_preview_probe") return probePreview(args, signal);
  if (name === "exi_preview_stop") return stopPreview(args.previewId);
  if (name === "exi_batch") return runBatch(args, signal, progressToken);
  fail(`MCP tool not found: ${name}`, "EXI_MCP_TOOL_NOT_FOUND");
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const SERVER_INFO = Object.freeze({ name: "exi-engine", version: SERVER_VERSION });
const MODERN_PROTOCOL_META_KEY = "io.modelcontextprotocol/protocolVersion";
const MODERN_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";
const MODERN_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
const MODERN_SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestEra(message) {
  const params = isRecord(message?.params) ? message.params : null;
  const meta = isRecord(params?._meta) ? params._meta : null;
  const requestedVersion = meta?.[MODERN_PROTOCOL_META_KEY];
  if (requestedVersion === undefined) return { modern: false };
  try { assertSafeData(meta); } catch (error) {
    return { modern: true, error: errorResponse(message.id, -32602, error instanceof Error ? error.message : String(error)) };
  }
  if (requestedVersion !== MODERN_PROTOCOL_VERSION) {
    return { modern: true, error: unsupportedProtocolResponse(message.id, requestedVersion) };
  }
  if (!isRecord(meta[MODERN_CLIENT_CAPABILITIES_META_KEY])) {
    return { modern: true, error: errorResponse(message.id, -32602, "clientCapabilities is required in a modern MCP request.") };
  }
  if (meta[MODERN_CLIENT_INFO_META_KEY] !== undefined && !isRecord(meta[MODERN_CLIENT_INFO_META_KEY])) {
    return { modern: true, error: errorResponse(message.id, -32602, "Modern MCP clientInfo must be an object.") };
  }
  if (Object.hasOwn(message, "id") && (message.id === null || (typeof message.id !== "string" && !Number.isSafeInteger(message.id)))) {
    return { modern: true, error: errorResponse(null, -32600, "Modern MCP request id must be a non-null string or a safe integer.") };
  }
  return { modern: true, meta };
}

function unsupportedProtocolResponse(id, requested) {
  return errorResponse(id, -32022, "Unsupported MCP protocol version.", { supported: SUPPORTED_PROTOCOLS, requested });
}

function modernResult(result) {
  const base = isRecord(result) ? result : { value: result };
  const existingMeta = isRecord(base._meta) ? base._meta : {};
  return { ...base, resultType: "complete", _meta: { ...existingMeta, [MODERN_SERVER_INFO_META_KEY]: SERVER_INFO } };
}

function response(id, result, modern = false) {
  send({ jsonrpc: "2.0", id, result: modern ? modernResult(result) : result });
}

function assertOutputSize(value, limit = MAX_OUTPUT_BYTES) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > limit) fail("MCP tool output size limit exceeded.", "EXI_MCP_OUTPUT_LIMIT");
  return value;
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

async function handleMessage(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
    send(errorResponse(null, -32600, "MCP message size limit exceeded."));
    return;
  }
  let message;
  try { message = JSON.parse(line); } catch { send(errorResponse(null, -32700, "Invalid JSON.")); return; }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    send(errorResponse(message?.id, -32600, "Invalid JSON-RPC request."));
    return;
  }
  if (message.method === "notifications/cancelled") {
    const requestId = message.params?.requestId;
    const active = activeRequests.get(requestId);
    if (active) {
      active.cancelled = true;
      active.controller.abort();
    }
    return;
  }
  if (message.method === "notifications/initialized") return;
  if (!Object.hasOwn(message, "id")) return;
  const era = requestEra(message);
  if (era.error) { send(era.error); return; }
  if (message.method === "ping") { response(message.id, {}, era.modern); return; }
  if (message.method === "server/discover") {
    response(message.id, {
      supportedVersions: SUPPORTED_PROTOCOLS,
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
      _meta: { [MODERN_SERVER_INFO_META_KEY]: SERVER_INFO },
      instructions: "ExiEngine is dependency-free and uses its own WebGL2/WebGPU core. Call exi_api first; use exi_scaffold for new games or exi_project_open for existing games before exi_file_* or exi_asset_*; run exi_project_check before preview. exi_preview_probe is static HTTP unless a browser has posted /__exi/runtime. Handles, uploads, and previews are explicit bounded process-local resources; release or reset them. No arbitrary shell, eval, or dynamic code is available.",
      ttlMs: 300_000,
      cacheScope: "private",
    }, era.modern);
    return;
  }
  if (message.method === "initialize") {
    const requestedVersion = message.params?.protocolVersion;
    if (requestedVersion === MODERN_PROTOCOL_VERSION) {
      send(unsupportedProtocolResponse(message.id, requestedVersion));
      return;
    }
    const negotiatedVersion = LEGACY_PROTOCOL_SET.has(requestedVersion) ? requestedVersion : LEGACY_PROTOCOL_VERSION;
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: negotiatedVersion, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: "ExiEngine is dependency-free and uses its own WebGL2/WebGPU core. Call exi_api first; use exi_scaffold for new games or exi_project_open for existing games before exi_file_* or exi_asset_*; run exi_project_check before preview. exi_preview_probe is static HTTP unless a browser has posted /__exi/runtime. Handles, uploads, and previews are explicit bounded process-local resources; release or reset them. No arbitrary shell, eval, or dynamic code is available." } });
    return;
  }
  if (message.method === "tools/list") {
    response(message.id, { tools, ...(era.modern ? { ttlMs: 300_000, cacheScope: "private" } : {}) }, era.modern);
    return;
  }
  if (message.method === "resources/list") {
    response(message.id, { resources: resourceDefinitions, ...(era.modern ? { ttlMs: 300_000, cacheScope: "private" } : {}) }, era.modern);
    return;
  }
  if (message.method === "prompts/list") {
    response(message.id, { prompts: promptDefinitions, ...(era.modern ? { ttlMs: 300_000, cacheScope: "private" } : {}) }, era.modern);
    return;
  }
  if (message.method === "prompts/get") {
    try {
      const promptArguments = message.params && Object.hasOwn(message.params, "arguments") ? message.params.arguments : {};
      response(message.id, getPrompt(message.params?.name, promptArguments), era.modern);
    } catch (error) {
      send(errorResponse(message.id, -32602, error instanceof Error ? error.message : String(error), error?.code ? { code: error.code } : undefined));
    }
    return;
  }
  if (message.method === "resources/read") {
    try {
      response(message.id, { ...(await readResource(message.params?.uri)), ...(era.modern ? { ttlMs: 60_000, cacheScope: "private" } : {}) }, era.modern);
    } catch (error) {
      send(errorResponse(message.id, -32602, error instanceof Error ? error.message : String(error), error?.code ? { code: error.code } : undefined));
    }
    return;
  }
  if (message.method === "tools/call") {
    if (activeRequests.has(message.id)) {
      send(errorResponse(message.id, -32600, "An MCP request with the same request id is already running."));
      return;
    }
    const progressToken = message.params?._meta?.progressToken;
    const request = { controller: new AbortController(), cancelled: false };
    activeRequests.set(message.id, request);
    const run = toolQueue.then(async () => {
      try {
        throwIfCancelled(request.controller.signal);
        const rawArguments = message.params && Object.hasOwn(message.params, "arguments") ? message.params.arguments : {};
        const result = assertOutputSize(await callTool(message.params?.name, rawArguments, { signal: request.controller.signal, progressToken }), message.params?.name === "exi_api" ? MAX_API_OUTPUT_BYTES : MAX_OUTPUT_BYTES);
        throwIfCancelled(request.controller.signal);
        if (request.cancelled) return;
        const text = JSON.stringify(result);
        const structuredContent = era.modern ? result : result !== null && typeof result === "object" && !Array.isArray(result) ? result : { value: result };
        response(message.id, { content: [{ type: "text", text }], structuredContent }, era.modern);
      } catch (error) {
        if (request.cancelled || error?.code === "EXI_MCP_CANCELLED") return;
        const messageText = error instanceof Error ? error.message : String(error);
        if (error?.code === "EXI_MCP_TOOL_NOT_FOUND") send(errorResponse(message.id, -32602, messageText));
        else response(message.id, { isError: true, content: [{ type: "text", text: JSON.stringify({ error: messageText, code: error?.code || "EXI_MCP_TOOL_ERROR" }) }] }, era.modern);
      } finally {
        activeRequests.delete(message.id);
      }
    });
    toolQueue = run.catch(() => {});
    return;
  }
  send(errorResponse(message.id, -32601, `Method not found: ${message.method}`));
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => { void handleMessage(line).catch((error) => { console.error(`[exi-mcp] ${error?.stack || error}`); }); });
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const request of activeRequests.values()) {
    request.cancelled = true;
    request.controller.abort();
  }
  for (const previewId of [...previews.keys()]) {
    try { await stopPreview(previewId); } catch { /* process teardown is best effort */ }
  }
  for (const upload of [...assetUploads.values()]) {
    try { await removeAssetUpload(upload); } catch { /* process teardown is best effort */ }
  }
  for (const upload of [...projectFileUploads.values()]) {
    try { await removeProjectFileUpload(upload); } catch { /* process teardown is best effort */ }
  }
  process.exitCode = 0;
}
input.on("close", () => { void shutdown(); });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void shutdown().finally(() => process.exit(0)); });
}
