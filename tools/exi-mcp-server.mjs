import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFile, lstat, mkdir, open as openFile, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import * as engineExports from "../src/index.js";

const configuredRoot = process.env.EXI_MCP_ROOT || process.env.CLAUDE_PROJECT_DIR;
const ROOT = path.resolve(configuredRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const SERVER_VERSION = "0.2.0";
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
  const error = new Error("MCP isteği iptal edildi.");
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
  if (typeof value !== "string" || !value || value.length > 256 || value.startsWith("_") || forbiddenKeys.has(value)) fail(`${label} geçersiz.`);
  return value;
}

function assertSafeData(value, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail("İstek veri derinliği limiti aşıldı.");
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) fail("İstek metin limiti aşıldı.");
    return value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    if (typeof value === "number" && !Number.isFinite(value)) fail("İstek sayısı sonlu olmalı.");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_VALUE_ITEMS) fail("İstek dizi limiti aşıldı.");
    for (const item of value) assertSafeData(item, depth + 1);
    return value;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 1 && Object.hasOwn(value, "$bytes")) {
      if (Array.isArray(value.$bytes)) {
        if (value.$bytes.length > MAX_BINARY_BYTES) fail("Byte array limiti aşıldı.");
        for (const byte of value.$bytes) {
          if (!Number.isInteger(byte) || byte < 0 || byte > 255) fail("Byte array yalnızca 0..255 tamsayıları içermeli.");
        }
      } else if (typeof value.$bytes === "string") {
        if (value.$bytes.length > MAX_BASE64_STRING_LENGTH) fail("Base64 byte metni limiti aşıldı.");
      } else fail("$bytes base64 metni veya byte array olmalı.");
      return value;
    }
    if (keys.length > MAX_VALUE_KEYS) fail("İstek nesne alanı limiti aşıldı.");
    for (const key of keys) {
      if (forbiddenKeys.has(key)) fail(`Güvenli olmayan alan adı: ${key}`);
      assertSafeData(value[key], depth + 1);
    }
    return value;
  }
  fail("İstek yalnızca JSON verisi içerebilir.");
}

function resolvePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.length > 240 || path.isAbsolute(relativePath)) fail("Yol repo köküne göre göreli olmalı.");
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..")) fail("Repo dışına çıkan yol reddedildi.");
  const resolved = path.resolve(ROOT, normalized);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) fail("Yol repo sınırları dışında.");
  return { resolved, relative: path.relative(ROOT, resolved).replaceAll("\\", "/") };
}

async function assertSafeScaffoldTarget(target, fileNames) {
  let current = ROOT;
  for (const segment of target.relative.split("/").filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Scaffold symlink üzerinden yazamaz.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Scaffold yolu klasör olmalı.");
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  for (const fileName of fileNames) {
    const filePath = path.join(target.resolved, fileName);
    try {
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink()) fail("Scaffold symlink üzerinden yazamaz.", "EXI_MCP_PATH_LINK");
      if (!entry.isFile()) fail(`Scaffold hedefi dosya olmalı: ${fileName}`);
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
    if (nodes > MAX_PROJECT_JSON_NODES) fail("Proje JSON düğüm limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
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
      if (depth > MAX_PROJECT_JSON_DEPTH) fail("Proje JSON derinlik limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
      recordNode();
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) fail("Proje JSON yapısı geçersiz.", "EXI_MCP_FILE_TYPE");
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
  if (target.resolved === ROOT) fail("Proje dosyası repo kökü olamaz.");
  const name = path.basename(target.relative).toLowerCase();
  if (name.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(name)) fail("Gizli/credential dosyası MCP file tool ile açılamaz.", "EXI_MCP_FILE_DENIED");
  if (!projectFileExtensions.has(path.extname(name))) fail("Yalnızca allowlisted text dosyaları kullanılabilir.", "EXI_MCP_FILE_TYPE");
  return target;
}

function resolveAssetFile(relativePath) {
  const target = resolvePath(relativePath);
  if (target.resolved === ROOT) fail("Asset dosyası repo kökü olamaz.");
  const name = path.basename(target.relative).toLowerCase();
  if (name.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(name)) fail("Gizli/credential asset MCP ile açılamaz.", "EXI_MCP_FILE_DENIED");
  if (!assetFileExtensions.has(path.extname(name))) fail("Yalnızca allowlisted oyun asset uzantıları kullanılabilir.", "EXI_MCP_FILE_TYPE");
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
  if ([".agents", ".codex", ".git", "src", "test", "tools"].includes(firstSegment)) fail("Scaffold engine/test/tool klasörlerine yazamaz.", "EXI_MCP_FILE_DENIED");
}

function requireScaffoldFile(target) {
  if (!findScaffoldRoot(target) || !target.relative.includes("/")) fail("File tool yalnızca bu session’da oluşturulmuş scaffold projesinde çalışır.", "EXI_MCP_FILE_SCOPE");
}

function findScaffoldRoot(target) {
  return [...scaffoldDirectories]
    .filter((directory) => target.relative === directory || target.relative.startsWith(`${directory}/`))
    .sort((left, right) => right.length - left.length)[0] || null;
}

function requireScaffoldDirectory(target) {
  if (!findScaffoldRoot(target)) fail("File tool yalnızca bu session’da oluşturulmuş scaffold projesinde çalışır.", "EXI_MCP_FILE_SCOPE");
}

async function inspectProjectFile(target, { allowMissingParent = false } = {}) {
  const segments = target.relative.split("/");
  let current = ROOT;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Proje dosyası symlink üzerinden açılamaz.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Proje dosyasının parent yolu klasör olmalı.");
    } catch (error) {
      if (error?.code === "ENOENT") {
        if (allowMissingParent) return null;
        fail("Proje dosyasının parent klasörü yok.", "EXI_MCP_FILE_PATH");
      }
      throw error;
    }
  }
  try {
    const entry = await lstat(target.resolved);
    if (entry.isSymbolicLink()) fail("Proje dosyası symlink üzerinden açılamaz.", "EXI_MCP_PATH_LINK");
    if (!entry.isFile()) fail("Proje hedefi dosya olmalı.", "EXI_MCP_FILE_PATH");
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
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) fail(`${label} sha256 64 karakterlik hexadecimal string olmalı.`, "EXI_MCP_ARGUMENT_INVALID");
  return value.toLowerCase();
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSha256Match(expectedSha256, actualSha256, label) {
  if (expectedSha256 !== undefined && expectedSha256 !== actualSha256) fail(`${label} sha256 doğrulaması başarısız.`, "EXI_MCP_UPLOAD_INTEGRITY");
}

function assertExpectedVersion(existing, expectedVersion, label) {
  if (expectedVersion === undefined) return;
  if (!isRecord(expectedVersion) || !Number.isSafeInteger(expectedVersion.bytes) || expectedVersion.bytes < 0 || typeof expectedVersion.mtimeMs !== "number" || !Number.isFinite(expectedVersion.mtimeMs) || expectedVersion.mtimeMs < 0) {
    fail(`${label} expectedVersion { bytes, mtimeMs } olmalı.`, "EXI_MCP_ARGUMENT_INVALID");
  }
  if (!existing || existing.size !== expectedVersion.bytes || existing.mtimeMs !== expectedVersion.mtimeMs) {
    fail(`${label} çağrıdan önce değişti; güncel version ile yeniden dene.`, "EXI_MCP_FILE_CONFLICT");
  }
}

async function ensureProjectParent(target, createdDirectories = null) {
  const segments = target.relative.split("/").slice(0, -1);
  let current = ROOT;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) fail("Proje dosyası symlink üzerinden açılamaz.", "EXI_MCP_PATH_LINK");
      if (!entry.isDirectory()) fail("Proje dosyasının parent yolu klasör olmalı.");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current);
      const created = await lstat(current);
      if (created.isSymbolicLink() || !created.isDirectory()) fail("Proje parent klasörü güvenli oluşturulamadı.", "EXI_MCP_PATH_LINK");
      createdDirectories?.push(current);
    }
  }
}

function isUtf8Continuation(byte) {
  return (byte & 0xc0) === 0x80;
}

function readUtf8Range(data, offset, limit) {
  if (offset < data.length && isUtf8Continuation(data[offset])) fail("file_read offset UTF-8 karakterinin ortasında olamaz.", "EXI_MCP_FILE_OFFSET");
  let end = Math.min(data.length, offset + limit);
  while (end < data.length && end > offset && isUtf8Continuation(data[end])) end -= 1;
  if (end === offset && offset < data.length) fail("file_read limit geçerli bir UTF-8 aralığı üretmedi.", "EXI_MCP_FILE_OFFSET");
  try {
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(offset, end)), nextOffset: end };
  } catch {
    fail("Proje dosyası geçerli UTF-8 değil.", "EXI_MCP_FILE_TYPE");
  }
}

async function readProjectFile(args = {}) {
  const { path: filePath } = args;
  const paged = Object.hasOwn(args, "offset") || Object.hasOwn(args, "limit");
  const offset = args.offset === undefined ? 0 : args.offset;
  const limit = args.limit === undefined ? (paged ? MAX_PROJECT_READ_BYTES : MAX_PROJECT_FILE_BYTES) : args.limit;
  if (!Number.isSafeInteger(offset) || offset < 0) fail("file_read offset güvenli tamsayı olmalı.", "EXI_MCP_FILE_OFFSET");
  const maxLimit = paged ? MAX_PROJECT_READ_BYTES : MAX_PROJECT_FILE_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > maxLimit) fail(`file_read limit 1 ile ${maxLimit} arasında olmalı.`, "EXI_MCP_FILE_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const entry = await inspectProjectFile(target);
  if (!entry) fail(`Proje dosyası bulunamadı: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  if (!paged && entry.size > MAX_PROJECT_READ_BYTES) fail(`Büyük dosya için offset/limit ile en fazla ${MAX_PROJECT_READ_BYTES} byte okunmalı.`, "EXI_MCP_FILE_PAGING");
  const data = await readFile(target.resolved);
  if (data.byteLength > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  const current = await inspectProjectFile(target);
  if (!current || current.size !== entry.size || current.mtimeMs !== entry.mtimeMs || current.size !== data.byteLength) fail("Proje dosyası okunurken değişti; version alınamadı.", "EXI_MCP_FILE_CONFLICT");
  if (offset > data.byteLength) fail("file_read offset dosya boyutunu aşamaz.", "EXI_MCP_FILE_OFFSET");
  const range = readUtf8Range(data, offset, limit);
  return { path: target.relative, offset, nextOffset: range.nextOffset, totalBytes: data.byteLength, bytes: Buffer.byteLength(range.content, "utf8"), version: projectVersion(current), complete: range.nextOffset === data.byteLength, content: range.content };
}

async function listProjectFiles({ path: directoryPath } = {}) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Proje klasörü repo kökü olamaz.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const rootEntry = await lstat(target.resolved);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) fail("Proje listeleme hedefi klasör olmalı.", "EXI_MCP_FILE_PATH");
  const files = [];
  const visit = async (currentPath, currentRelative, depth) => {
    if (depth > MAX_PROJECT_DEPTH) fail("Proje klasör derinliği limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
    const entries = (await readdir(currentPath)).sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const childPath = path.join(currentPath, name);
      const childRelative = `${currentRelative}/${name}`;
      const entry = await lstat(childPath);
      if (entry.isSymbolicLink()) fail("Proje listeleme symlink üzerinden yapılamaz.", "EXI_MCP_PATH_LINK");
      if (entry.isDirectory()) {
        await visit(childPath, childRelative, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const lowerName = name.toLowerCase();
      if (lowerName.startsWith(".env") || /(?:\.pem|\.key|\.p12|\.pfx|\.secret)$/.test(lowerName)) continue;
      if (!projectFileExtensions.has(path.extname(lowerName))) continue;
      files.push({ path: childRelative, bytes: entry.size, version: projectVersion(entry) });
      if (files.length > MAX_PROJECT_LIST_ENTRIES) fail("Proje dosya listeleme limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
    }
  };
  await visit(target.resolved, target.relative, 0);
  return { directory: target.relative, files };
}

async function listProjectAssets({ path: directoryPath } = {}) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Asset klasörü repo kökü olamaz.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const rootEntry = await lstat(target.resolved);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) fail("Asset listeleme hedefi klasör olmalı.", "EXI_MCP_FILE_PATH");
  const assets = [];
  const visit = async (currentPath, currentRelative, depth) => {
    if (depth > MAX_PROJECT_DEPTH) fail("Asset klasör derinliği limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
    const entries = (await readdir(currentPath)).sort((left, right) => left.localeCompare(right));
    for (const name of entries) {
      const childPath = path.join(currentPath, name);
      const childRelative = `${currentRelative}/${name}`;
      const entry = await lstat(childPath);
      if (entry.isSymbolicLink()) fail("Asset listeleme symlink üzerinden yapılamaz.", "EXI_MCP_PATH_LINK");
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
      if (assets.length > MAX_PROJECT_LIST_ENTRIES) fail("Asset listeleme limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
    }
  };
  await visit(target.resolved, target.relative, 0);
  return { directory: target.relative, assets };
}

async function readProjectAsset({ path: filePath, offset = 0, limit = MAX_ASSET_READ_BYTES } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0) fail("Asset read offset güvenli tamsayı olmalı.", "EXI_MCP_FILE_OFFSET");
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_ASSET_READ_BYTES) fail(`Asset read limit 1 ile ${MAX_ASSET_READ_BYTES} arasında olmalı.`, "EXI_MCP_FILE_LIMIT");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const entry = await inspectProjectFile(target);
  if (!entry) fail(`Asset dosyası bulunamadı: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_ASSET_BYTES) fail("Asset dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  if (offset > entry.size) fail("Asset read offset dosya boyutunu aşamaz.", "EXI_MCP_FILE_OFFSET");
  const length = Math.min(limit, entry.size - offset);
  const data = Buffer.alloc(length);
  const file = await openFile(target.resolved, "r");
  try {
    const { bytesRead } = await file.read(data, 0, length, offset);
    await file.close();
    const current = await inspectProjectFile(target);
    if (!current || current.size !== entry.size || current.mtimeMs !== entry.mtimeMs) fail("Asset okunurken değişti; version alınamadı.", "EXI_MCP_FILE_CONFLICT");
    return { path: target.relative, offset, nextOffset: offset + bytesRead, totalBytes: entry.size, bytes: bytesRead, version: projectVersion(current), complete: offset + bytesRead === entry.size, data: { $bytes: data.subarray(0, bytesRead).toString("base64") } };
  } finally {
    try { await file.close(); } catch { /* already closed or best-effort cleanup */ }
  }
}

async function writeProjectAsset({ path: filePath, bytes, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (typeof overwrite !== "boolean") fail("overwrite boolean olmalı.");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Asset ${target.relative}`);
  const data = resolveArgument(bytes);
  if (!(data instanceof Uint8Array)) fail("Asset bytes yalnızca {$bytes: [...]} veya {$bytes: base64} olmalı.");
  if (data.byteLength > MAX_BINARY_BYTES) fail("Asset byte limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Asset ${target.relative}`);
  if (existing && !overwrite) fail(`Asset dosyası zaten var: ${target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = sha256Bytes(data);
  assertSha256Match(normalizedSha256, actualSha256, `Asset ${target.relative}`);
  const overwritten = await writeProjectTarget(target, data, existing);
  return { path: target.relative, bytes: data.byteLength, type: path.extname(target.relative).slice(1), sha256: actualSha256, overwritten };
}

function requireAssetUpload(uploadId) {
  if (typeof uploadId !== "string" || !/^u[1-9][0-9]*$/.test(uploadId) || !assetUploads.has(uploadId)) fail(`Asset upload bulunamadı: ${uploadId}`, "EXI_MCP_UPLOAD_NOT_FOUND");
  return assetUploads.get(uploadId);
}

function assertChunkedAssetSize(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CHUNKED_ASSET_BYTES) fail(`Chunked asset boyutu 0 ile ${MAX_CHUNKED_ASSET_BYTES} arasında güvenli tamsayı olmalı.`, "EXI_MCP_FILE_LIMIT");
  return value;
}

async function removeAssetUpload(upload) {
  if (!upload) return;
  assetUploads.delete(upload.id);
  try { await unlink(upload.tempPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function beginAssetUpload({ path: filePath, size, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (assetUploads.size >= MAX_ASSET_UPLOADS) fail("Aktif asset upload limiti aşıldı.", "EXI_MCP_UPLOAD_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite boolean olmalı.");
  const expectedBytes = assertChunkedAssetSize(size);
  const pendingBytes = [...assetUploads.values()].reduce((total, upload) => total + upload.expectedBytes, 0);
  if (pendingBytes + expectedBytes > MAX_PENDING_ASSET_BYTES) fail("Bekleyen asset upload byte bütçesi aşıldı.", "EXI_MCP_UPLOAD_LIMIT");
  const target = resolveAssetFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Asset ${target.relative}`);
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Asset ${target.relative}`);
  if (existing && !overwrite) fail(`Asset dosyası zaten var: ${target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
  const id = `u${nextAssetUploadId++}`;
  const tempPath = `${target.resolved}.exi-upload-${process.pid}-${id}`;
  try {
    await writeFile(tempPath, new Uint8Array(), { flag: "wx" });
    assetUploads.set(id, { id, target, tempPath, expectedBytes, receivedBytes: 0, overwrite: Boolean(overwrite), expectedVersion, expectedSha256: normalizedSha256, hash: normalizedSha256 ? createHash("sha256") : null });
  } catch (error) {
    try { await unlink(tempPath); } catch { /* cleanup best effort */ }
    throw error;
  }
  return { uploadId: id, path: target.relative, expectedBytes, receivedBytes: 0, chunkBytes: MAX_BINARY_BYTES, ...(normalizedSha256 ? { expectedSha256: normalizedSha256 } : {}) };
}

async function writeAssetChunk({ uploadId, offset, bytes } = {}) {
  const upload = requireAssetUpload(uploadId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== upload.receivedBytes) fail("Asset chunk offset önceki receivedBytes ile aynı olmalı.", "EXI_MCP_UPLOAD_ORDER");
  const data = resolveArgument(bytes);
  if (!(data instanceof Uint8Array) || data.byteLength === 0) fail("Asset chunk boş olmayan {$bytes: [...]} veya {$bytes: base64} olmalı.");
  if (data.byteLength > MAX_BINARY_BYTES) fail("Tek asset chunk byte limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  if (upload.receivedBytes + data.byteLength > upload.expectedBytes) fail("Asset chunk beklenen toplam boyutu aşıyor.", "EXI_MCP_UPLOAD_SIZE");
  await appendFile(upload.tempPath, data);
  upload.hash?.update(data);
  upload.receivedBytes += data.byteLength;
  return { uploadId, path: upload.target.relative, receivedBytes: upload.receivedBytes, expectedBytes: upload.expectedBytes, remainingBytes: upload.expectedBytes - upload.receivedBytes, complete: upload.receivedBytes === upload.expectedBytes };
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
  const upload = requireAssetUpload(uploadId);
  if (upload.receivedBytes !== upload.expectedBytes) fail(`Asset upload tamamlanmadı: ${upload.receivedBytes}/${upload.expectedBytes} byte.`, "EXI_MCP_UPLOAD_INCOMPLETE");
  const tempEntry = await lstat(upload.tempPath);
  if (tempEntry.isSymbolicLink() || !tempEntry.isFile()) fail("Asset geçici upload dosyası güvenli değil.", "EXI_MCP_PATH_LINK");
  const existing = await inspectProjectFile(upload.target);
  assertExpectedVersion(existing, upload.expectedVersion, `Asset ${upload.target.relative}`);
  if (existing && !upload.overwrite) fail(`Asset dosyası zaten var: ${upload.target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
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
      catch { return { ok: false, code: 1, stdout: "", stderr: `Geçersiz HTML asset URL'si: ${rawReference}` }; }
      if (!reference || reference.startsWith("#")) continue;
      if (/^(?:data|blob|javascript|https?):/i.test(reference)) {
        return { ok: false, code: 1, stdout: "", stderr: `HTML dış/çalıştırılabilir referans içeriyor: ${rawReference}` };
      }
      const relativeReference = reference.startsWith("/")
        ? reference.slice(1)
        : [...target.relative.split("/").slice(0, -1), ...reference.replaceAll("\\", "/").split("/")].join("/");
      let referencedTarget;
      try { referencedTarget = resolvePath(relativeReference); }
      catch (error) { return { ok: false, code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) }; }
      const entry = await inspectProjectFile(referencedTarget);
      if (!entry) return { ok: false, code: 1, stdout: "", stderr: `HTML referansı bulunamadı: ${referencedTarget.relative}` };
      references.push(referencedTarget.relative);
    }
  }
  return { ok: true, code: 0, stdout: "", stderr: "", references: [...new Set(references)].sort() };
}

async function writeProjectFile({ path: filePath, content, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (typeof content !== "string") fail("Proje dosyası content string olmalı.");
  if (Buffer.byteLength(content, "utf8") > MAX_PROJECT_FILE_BYTES) fail("Proje dosyası boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite boolean olmalı.");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Proje dosyası ${target.relative}`);
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Proje dosyası ${target.relative}`);
  if (existing && !overwrite) fail(`Proje dosyası zaten var: ${target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = sha256Bytes(Buffer.from(content, "utf8"));
  assertSha256Match(normalizedSha256, actualSha256, `Proje dosyası ${target.relative}`);
  const overwritten = await writeProjectTarget(target, content, existing);
  return { path: target.relative, bytes: Buffer.byteLength(content, "utf8"), sha256: actualSha256, overwritten };
}

async function patchProjectFile({ path: filePath, find, replace } = {}) {
  if (typeof find !== "string" || find.length === 0) fail("Patch find boş olmayan string olmalı.", "EXI_MCP_PATCH_MATCH");
  if (typeof replace !== "string") fail("Patch replace string olmalı.", "EXI_MCP_PATCH_REPLACE");
  if (Buffer.byteLength(find, "utf8") > MAX_PROJECT_PATCH_TEXT_BYTES || Buffer.byteLength(replace, "utf8") > MAX_PROJECT_PATCH_TEXT_BYTES) fail("Patch find/replace byte limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const existing = await inspectProjectFile(target);
  if (!existing) fail(`Proje dosyası bulunamadı: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (existing.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  const data = await readFile(target.resolved);
  if (data.byteLength > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  let content;
  try { content = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { fail("Proje dosyası geçerli UTF-8 değil.", "EXI_MCP_FILE_TYPE"); }
  const matchIndex = content.indexOf(find);
  if (matchIndex < 0) fail(`Patch metni bulunamadı: ${target.relative}`, "EXI_MCP_PATCH_NOT_FOUND");
  if (content.indexOf(find, matchIndex + find.length) >= 0) fail(`Patch metni birden fazla eşleşti: ${target.relative}`, "EXI_MCP_PATCH_AMBIGUOUS");
  const nextContent = `${content.slice(0, matchIndex)}${replace}${content.slice(matchIndex + find.length)}`;
  const nextBytes = Buffer.byteLength(nextContent, "utf8");
  if (nextBytes > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Patch sonrası proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  const overwritten = await writeProjectTarget(target, nextContent, existing);
  return { path: target.relative, bytes: nextBytes, replacedBytes: Buffer.byteLength(replace, "utf8"), matchCount: 1, overwritten };
}

async function applyProjectFiles({ path: directoryPath, files, overwrite = false } = {}) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_PROJECT_APPLY_FILES) fail(`Project apply 1 ile ${MAX_PROJECT_APPLY_FILES} dosya arasında olmalı.`, "EXI_MCP_PROJECT_APPLY_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite boolean olmalı.");
  const directory = resolvePath(directoryPath);
  requireScaffoldDirectory(directory);
  const directoryEntry = await lstat(directory.resolved);
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) fail("Project apply hedefi klasör olmalı.", "EXI_MCP_PATH_LINK");
  const seen = new Set();
  let totalBytes = 0;
  const entries = [];
  for (const file of files) {
    if (!isRecord(file) || typeof file.path !== "string" || !file.path.trim()) fail("Project apply dosyası path içermeli.", "EXI_MCP_PROJECT_APPLY_INPUT");
    if (typeof file.content !== "string") fail("Project apply dosyası content string olmalı.", "EXI_MCP_PROJECT_APPLY_INPUT");
    const relativeFile = file.path.replaceAll("\\", "/");
    if (path.isAbsolute(file.path) || relativeFile.startsWith("/") || relativeFile.includes("\0") || relativeFile.split("/").some((part) => part === "..")) fail("Project apply dosya yolu relative ve traversal’sız olmalı.", "EXI_MCP_FILE_PATH");
    const target = resolveProjectFile(`${directory.relative}/${relativeFile}`);
    const key = target.relative.toLowerCase();
    if (seen.has(key)) fail(`Project apply aynı dosyayı birden fazla içeriyor: ${target.relative}`, "EXI_MCP_PROJECT_APPLY_DUPLICATE");
    seen.add(key);
    const bytes = Buffer.byteLength(file.content, "utf8");
    if (bytes > MAX_PROJECT_FILE_BYTES) fail(`Project apply tek dosya byte limiti aşıldı: ${target.relative}`, "EXI_MCP_FILE_LIMIT");
    totalBytes += bytes;
    if (totalBytes > MAX_PROJECT_APPLY_BYTES) fail(`Project apply toplam byte limiti ${MAX_PROJECT_APPLY_BYTES} aşıldı.`, "EXI_MCP_PROJECT_APPLY_LIMIT");
    requireScaffoldFile(target);
    const existing = await inspectProjectFile(target, { allowMissingParent: true });
    const expectedVersion = file.expectedVersion;
    assertExpectedVersion(existing, expectedVersion, `Project apply ${target.relative}`);
    if (existing && !overwrite) fail(`Proje dosyası zaten var: ${target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
    entries.push({ target, content: file.content, bytes, existing, expectedVersion, id: `a${nextWriteId++}`, tempPath: null, backupPath: null, committed: false });
  }

  const createdDirectories = [];
  const staged = [];
  const assertUnchanged = async (entry) => {
    const current = await inspectProjectFile(entry.target);
    const expectedVersion = entry.expectedVersion || projectVersion(entry.existing);
    if (expectedVersion) {
      if (!current || current.size !== expectedVersion.bytes || current.mtimeMs !== expectedVersion.mtimeMs) fail(`Project apply hedefi çağrı sırasında değişti: ${entry.target.relative}`, "EXI_MCP_FILE_CONFLICT");
    } else if (current) {
      fail(`Project apply hedefi çağrı sırasında oluşturuldu: ${entry.target.relative}`, "EXI_MCP_FILE_CONFLICT");
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
      if (tempEntry.isSymbolicLink() || !tempEntry.isFile() || tempEntry.size !== entry.bytes) fail("Project apply geçici dosyası güvenli değil.", "EXI_MCP_PATH_LINK");
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
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CHUNKED_PROJECT_FILE_BYTES) fail(`Chunked proje dosyası boyutu 0 ile ${MAX_CHUNKED_PROJECT_FILE_BYTES} arasında güvenli tamsayı olmalı.`, "EXI_MCP_FILE_LIMIT");
  return value;
}

function requireProjectFileUpload(uploadId) {
  if (typeof uploadId !== "string" || !/^f[1-9][0-9]*$/.test(uploadId) || !projectFileUploads.has(uploadId)) fail(`Proje file upload bulunamadı: ${uploadId}`, "EXI_MCP_UPLOAD_NOT_FOUND");
  return projectFileUploads.get(uploadId);
}

function assertProjectFileChunk(content) {
  if (typeof content !== "string" || content.length === 0) fail("Proje file chunk boş olmayan UTF-8 string olmalı.");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_PROJECT_FILE_CHUNK_BYTES) fail("Tek proje file chunk byte limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  return { content, bytes };
}

async function removeProjectFileUpload(upload) {
  if (!upload) return;
  projectFileUploads.delete(upload.id);
  try { await unlink(upload.tempPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

async function beginProjectFileUpload({ path: filePath, size, overwrite = false, expectedVersion, expectedSha256 } = {}) {
  if (projectFileUploads.size >= MAX_PROJECT_FILE_UPLOADS) fail("Aktif proje file upload limiti aşıldı.", "EXI_MCP_UPLOAD_LIMIT");
  if (typeof overwrite !== "boolean") fail("overwrite boolean olmalı.");
  const expectedBytes = assertChunkedProjectFileSize(size);
  const pendingBytes = [...projectFileUploads.values()].reduce((total, upload) => total + upload.expectedBytes, 0);
  if (pendingBytes + expectedBytes > MAX_PENDING_PROJECT_FILE_BYTES) fail("Bekleyen proje file upload byte bütçesi aşıldı.", "EXI_MCP_UPLOAD_LIMIT");
  const target = resolveProjectFile(filePath);
  requireScaffoldFile(target);
  const normalizedSha256 = normalizeExpectedSha256(expectedSha256, `Proje dosyası ${target.relative}`);
  await ensureProjectParent(target);
  const existing = await inspectProjectFile(target);
  assertExpectedVersion(existing, expectedVersion, `Proje dosyası ${target.relative}`);
  if (existing && !overwrite) fail(`Proje dosyası zaten var: ${target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
  const id = `f${nextProjectFileUploadId++}`;
  const tempPath = `${target.resolved}.exi-file-upload-${process.pid}-${id}`;
  try {
    await writeFile(tempPath, "", { encoding: "utf8", flag: "wx" });
    projectFileUploads.set(id, { id, target, tempPath, expectedBytes, receivedBytes: 0, overwrite: Boolean(overwrite), expectedVersion, expectedSha256: normalizedSha256, hash: normalizedSha256 ? createHash("sha256") : null });
  } catch (error) {
    try { await unlink(tempPath); } catch { /* cleanup best effort */ }
    throw error;
  }
  return { fileUploadId: id, path: target.relative, expectedBytes, receivedBytes: 0, chunkBytes: MAX_PROJECT_FILE_CHUNK_BYTES, ...(normalizedSha256 ? { expectedSha256: normalizedSha256 } : {}) };
}

async function writeProjectFileChunk({ fileUploadId, offset, content } = {}) {
  const upload = requireProjectFileUpload(fileUploadId);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset !== upload.receivedBytes) fail("Proje file chunk offset önceki receivedBytes ile aynı olmalı.", "EXI_MCP_UPLOAD_ORDER");
  const chunk = assertProjectFileChunk(content);
  if (upload.receivedBytes + chunk.bytes > upload.expectedBytes) fail("Proje file chunk beklenen toplam boyutu aşıyor.", "EXI_MCP_UPLOAD_SIZE");
  await appendFile(upload.tempPath, chunk.content, { encoding: "utf8" });
  upload.hash?.update(Buffer.from(chunk.content, "utf8"));
  const entry = await lstat(upload.tempPath);
  if (entry.isSymbolicLink() || !entry.isFile() || entry.size !== upload.receivedBytes + chunk.bytes) fail("Proje file upload boyutu doğrulanamadı.", "EXI_MCP_UPLOAD_SIZE");
  upload.receivedBytes = entry.size;
  return { fileUploadId, path: upload.target.relative, receivedBytes: upload.receivedBytes, expectedBytes: upload.expectedBytes, remainingBytes: upload.expectedBytes - upload.receivedBytes, complete: upload.receivedBytes === upload.expectedBytes };
}

async function commitProjectFileUpload({ fileUploadId } = {}) {
  const upload = requireProjectFileUpload(fileUploadId);
  if (upload.receivedBytes !== upload.expectedBytes) fail(`Proje file upload tamamlanmadı: ${upload.receivedBytes}/${upload.expectedBytes} byte.`, "EXI_MCP_UPLOAD_INCOMPLETE");
  const tempEntry = await lstat(upload.tempPath);
  if (tempEntry.isSymbolicLink() || !tempEntry.isFile() || tempEntry.size !== upload.expectedBytes) fail("Proje file geçici upload dosyası güvenli değil.", "EXI_MCP_PATH_LINK");
  const existing = await inspectProjectFile(upload.target);
  assertExpectedVersion(existing, upload.expectedVersion, `Proje dosyası ${upload.target.relative}`);
  if (existing && !upload.overwrite) fail(`Proje dosyası zaten var: ${upload.target.relative}. overwrite=true gerekli.`, "EXI_MCP_FILE_EXISTS");
  const actualSha256 = upload.hash ? upload.hash.digest("hex") : null;
  assertSha256Match(upload.expectedSha256, actualSha256, `Proje dosyası ${upload.target.relative}`);
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
  if (!entry) fail(`Proje dosyası bulunamadı: ${target.relative}`, "EXI_MCP_FILE_NOT_FOUND");
  if (entry.size > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
  const extension = path.extname(target.relative).toLowerCase();
  if (extension === ".json") {
    const content = await readFile(target.resolved, { encoding: "utf8", signal });
    throwIfCancelled(signal);
    if (Buffer.byteLength(content, "utf8") > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
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
    if (Buffer.byteLength(content, "utf8") > MAX_CHUNKED_PROJECT_FILE_BYTES) fail("Proje dosyası chunked boyut limiti aşıldı.", "EXI_MCP_FILE_LIMIT");
    return { path: target.relative, kind: "html", ...await checkHTMLReferences(target, content, signal) };
  }
  if (!syntaxCheckExtensions.has(extension)) fail("Syntax check yalnızca .js, .mjs veya .json dosyalarında çalışır.", "EXI_MCP_FILE_TYPE");
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
      finishAfterCleanup(() => resolve({ path: target.relative, kind: "javascript", ok: false, code: 1, signal: "SIGTERM", stdout, stderr: `${stderr}\nsyntax check zaman aşımı.`.slice(-MAX_OUTPUT_BYTES) }));
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
  if (checkable.length > MAX_PROJECT_CHECK_FILES) fail(`Tek çağrıda en fazla ${MAX_PROJECT_CHECK_FILES} proje dosyası kontrol edilebilir.`, "EXI_MCP_FILE_LIMIT");
  sendProgress(progressToken, 0, checkable.length, "Proje statik kontrolü başladı.");
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
    sendProgress(progressToken, index + 1, checkable.length, `Kontrol edildi: ${file.path}`);
  }
  throwIfCancelled(signal);
  return { directory: listing.directory, ok: failureCount === 0, files: listing.files.length, checked: checkable.length, skipped: listing.files.length - checkable.length, failureCount, failures };
}

function publicPrototypeMethods(value) {
  const names = new Set();
  let prototype = value?.prototype;
  while (prototype && prototype !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === "constructor" || name.startsWith("_") || forbiddenKeys.has(name)) continue;
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
    .filter(([name]) => !name.startsWith("_") && !forbiddenKeys.has(name))
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
  if (typeof value !== "string" || !value || value.length > 512) fail(`${label} geçersiz.`);
  const segments = value.split(".");
  if (segments.some((segment) => !segment || segment.startsWith("_") || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail(`${label} public export yolu olmalı.`);
  return segments;
}

function resolveExportPath(value) {
  const segments = assertPublicPath(value);
  let current = engineExports[segments[0]];
  if (current === undefined) fail(`Public export bulunamadı: ${value}`);
  let parent = null;
  for (const segment of segments.slice(1)) {
    if ((current === null || (typeof current !== "object" && typeof current !== "function")) || !Object.hasOwn(current, segment)) fail(`Public export yolu bulunamadı: ${value}`);
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
  if (handles.size >= MAX_HANDLES) fail("Aktif engine handle limiti aşıldı.", "EXI_MCP_HANDLE_LIMIT");
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
  if (typeof value !== "string" || !/^h[1-9][0-9]*$/.test(value)) fail("Geçersiz engine handle.");
  const object = handles.get(value);
  if (!object) fail(`Engine handle bulunamadı: ${value}`);
  return object;
}

function resolveBytes(value) {
  if (Object.keys(value).length !== 1 || !Object.hasOwn(value, "$bytes")) return null;
  if (Array.isArray(value.$bytes)) {
    if (value.$bytes.length > MAX_BINARY_BYTES) fail("Byte array limiti aşıldı.");
    if (value.$bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) fail("Byte array yalnızca 0..255 tamsayıları içermeli.");
    return Uint8Array.from(value.$bytes);
  }
  if (typeof value.$bytes !== "string") fail("$bytes base64 metni veya byte array olmalı.");
  const encoded = value.$bytes;
  if (encoded.length > MAX_BASE64_STRING_LENGTH) fail("Base64 byte metni limiti aşıldı.");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) fail("$bytes geçerli base64 olmalı.");
  const bytes = Uint8Array.from(Buffer.from(encoded, "base64"));
  if (bytes.byteLength > MAX_BINARY_BYTES) fail("Byte verisi limiti aşıldı.");
  return bytes;
}

function resolveArgument(value, depth = 0) {
  if (depth > MAX_VALUE_DEPTH) fail("Argüman veri derinliği limiti aşıldı.");
  if (Array.isArray(value)) return value.map((item) => resolveArgument(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const bytes = resolveBytes(value);
  if (bytes) return bytes;
  if (Object.keys(value).length === 1 && typeof value.$handle === "string") return requireHandle(value.$handle);
  const resolved = {};
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) fail(`Güvenli olmayan argüman alanı: ${key}`);
    resolved[key] = resolveArgument(item, depth + 1);
  }
  return resolved;
}

function resolveArgs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("args array olmalı.", "EXI_MCP_ARGS_TYPE");
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
    const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
    if (descriptor) {
      if (typeof descriptor.value !== "function") fail(`Public method değil: ${method}`);
      return descriptor.value;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  fail(`Engine method bulunamadı: ${method}`);
}

function getPublicStaticMethod(Constructor, method) {
  assertPublicName(method, "method");
  const descriptor = Object.getOwnPropertyDescriptor(Constructor, method);
  if (!descriptor || typeof descriptor.value !== "function") fail(`Static method bulunamadı: ${Constructor.name}.${method}`);
  return descriptor.value;
}

function getPublicProperty(object, property) {
  assertPublicName(property, "property");
  if (!findPropertyDescriptor(object, property)) fail(`Engine property bulunamadı: ${property}`);
  return object[property];
}

function inspectHandle(object, handle) {
  const methods = new Set();
  const properties = new Map();
  let target = object;
  while (target && target !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(target)) {
      if (name === "constructor" || name.startsWith("_") || forbiddenKeys.has(name) || methods.has(name) || properties.has(name)) continue;
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
  if (!isClass(Constructor)) fail(`Oluşturulabilir public class bulunamadı: ${name}`);
  return new Constructor(...args);
}

async function buildScene(spec, state, depth = 0) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) fail("Sahne spec nesne olmalı.");
  if (depth > MAX_SCENE_DEPTH) fail("Sahne derinliği limiti aşıldı.", "EXI_MCP_SCENE_LIMIT");
  for (const key of Object.keys(spec)) if (!sceneSpecFields.has(key)) fail(`Sahne spec alanı bilinmiyor: ${key}`, "EXI_MCP_SCENE_SCHEMA");
  state.nodes += 1;
  if (state.nodes > MAX_SCENE_NODES) fail("Sahne node limiti aşıldı.", "EXI_MCP_SCENE_LIMIT");
  const type = assertPublicName(spec.type, "scene.type");
  if (spec.options !== undefined && !isRecord(spec.options)) fail("Sahne options object olmalı.", "EXI_MCP_SCENE_SCHEMA");
  const options = spec.options === undefined ? [] : [resolveArgument(spec.options)];
  const object = createExported(type, options);
  const handle = registerHandle(object);
  state.created.push(handle);
  const children = spec.children === undefined ? [] : spec.children;
  if (!Array.isArray(children) || children.length > MAX_SCENE_NODES) fail("Sahne children alanı geçersiz.", "EXI_MCP_SCENE_SCHEMA");
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
    "game.js": `import * as Exi from "/src/index.js";\nimport { RuntimeAgent } from "/src/ai/runtime-agent.js";\n\nconst { ExiEngine, Graphics, Scene } = Exi;\nconst canvas = document.querySelector("#game");\nconst runtimeNode = document.querySelector("#exi-runtime");\nconst runtimeToken = await fetch("/__exi/runtime-token").then((response) => response.ok ? response.text() : "").then((value) => value.trim()).catch(() => "");\nlet lastEvent = "starting";\nlet lastTelemetryAt = 0;\nconst scene = new Scene();\nscene.add(new Graphics({ x: 432, y: 222 }).rect(0, 0, 96, 96, { fill: 0x5eead4 }));\nconst publishRuntime = (currentEngine) => {\n  const info = currentEngine.getInfo();\n  const state = { ready: true, status: currentEngine.running ? "running" : "stopped", event: lastEvent, backend: info.backend || "unknown", fps: Math.round(info.profiler?.fps || 0), draws: info.drawCalls || 0, nodes: info.nodeCount || 0 };\n  for (const [key, value] of Object.entries(state)) runtimeNode.dataset[key] = String(value);\n  runtimeNode.dataset.ready = "true";\n  runtimeNode.textContent = JSON.stringify(state);\n  const now = performance.now();\n  if (runtimeToken && (now - lastTelemetryAt >= 250 || state.status !== "running")) {\n    lastTelemetryAt = now;\n    void fetch("/__exi/runtime", { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": runtimeToken }, body: JSON.stringify(state), keepalive: true }).catch(() => {});\n  }\n};\nconst engine = await ExiEngine.create({ canvas, scene, width: 960, height: 540, onStatus: (event) => { lastEvent = event.type; }, onRender: publishRuntime });\nengine.start();\nconst runtimeAgent = new RuntimeAgent({ api: Exi, roots: { engine, scene }, token: runtimeToken });\nruntimeAgent.start();\n\n// Add your own Nodes, Sprites, input and game loop here.\nwindow.game = { engine, scene, runtimeAgent };\n`,
    "README.md": `# ${projectName}\n\nThis game was scaffolded by ExiEngine's AI tool bridge.\n\nRun from the repository root with \`npm run dev\`, then open ${projectUrl}/index.html.\n\nThe hidden \`#exi-runtime\` output publishes bounded status/backend/fps/draws/nodes telemetry for browser-capable AI CLI verification; after a real browser load, MCP can read the matching token-managed report with \`exi_preview_probe({ path: "/__exi/runtime" })\`. See the \`exi://runtime\` MCP resource.\n\nThe engine has no runtime dependency on another game engine.\n`,
  };
}

async function scaffold({ directory = "ai-game", overwrite = false } = {}) {
  const target = resolvePath(directory);
  if (target.resolved === ROOT) fail("Scaffold repo köküne değil, ayrı bir alt klasöre yazmalı.");
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
      fail(`Scaffold dosyası zaten var: ${target.relative}/${name}. overwrite=true gerekli.`);
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
        if (existing.isSymbolicLink()) fail("Scaffold symlink üzerinden yazamaz.", "EXI_MCP_PATH_LINK");
        if (!existing.isFile()) fail(`Scaffold hedefi dosya olmalı: ${entry.name}`);
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
  if (target.resolved === ROOT) fail("Proje klasörü repo kökü olamaz.", "EXI_MCP_FILE_SCOPE");
  assertScaffoldDirectory(target);
  await assertSafeScaffoldTarget(target, []);
  const entry = await lstat(target.resolved);
  if (entry.isSymbolicLink() || !entry.isDirectory()) fail("Açılacak proje yolu klasör olmalı.", "EXI_MCP_FILE_PATH");
  scaffoldDirectories.add(target.relative);
  try {
    const check = await checkProject({ path: target.relative }, signal, progressToken);
    throwIfCancelled(signal);
    if (check.checked === 0) fail("Açılacak projede kontrol edilebilir HTML/JS/JSON dosyası bulunamadı.", "EXI_MCP_FILE_SCOPE");
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
  if (!Object.hasOwn(commands, mode)) fail("check mode yalnızca doctor, test veya verify olabilir.");
  throwIfCancelled(signal);
  sendProgress(progressToken, 0, 1, `check ${mode} başladı.`);
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
      rejectAfterCleanup(new Error(`check ${mode} zaman aşımına uğradı.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk.toString()); });
    child.once("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(error); } });
    child.once("exit", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      sendProgress(progressToken, 1, 1, `check ${mode} tamamlandı.`);
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
  if (!definition) fail(`MCP resource bulunamadı: ${uri}`, "EXI_MCP_RESOURCE_NOT_FOUND");
  let text;
  if (uri === "exi://api") text = JSON.stringify(apiContract(), null, 2);
  else if (uri === "exi://runtime") text = JSON.stringify(runtimeContract, null, 2);
  else if (uri === "exi://clients") text = JSON.stringify(clientContract, null, 2);
  else text = await readFile(path.join(ROOT, resourceFiles.get(uri)), "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_RESOURCE_BYTES) fail("MCP resource boyutu limiti aşıldı.", "EXI_MCP_RESOURCE_LIMIT");
  return { contents: [{ uri, mimeType: definition.mimeType, text }] };
}

function getPrompt(name, rawArguments = {}) {
  assertSafeData(rawArguments);
  const definition = promptDefinitions.find((prompt) => prompt.name === name);
  if (!definition) fail(`MCP prompt bulunamadı: ${name}`, "EXI_MCP_PROMPT_NOT_FOUND");
  if (!isRecord(rawArguments)) fail("MCP prompt arguments object olmalı.", "EXI_MCP_PROMPT_ARGS_TYPE");
  const allowedArguments = new Set(definition.arguments.map((argument) => argument.name));
  for (const key of Object.keys(rawArguments)) if (!allowedArguments.has(key)) fail(`Bilinmeyen MCP prompt argümanı: ${key}`, "EXI_MCP_ARGUMENT_UNKNOWN");
  if (name === "exi_create_game" && rawArguments.goal !== undefined && typeof rawArguments.goal !== "string") fail("Prompt goal string olmalı.", "EXI_MCP_ARGUMENT_TYPE");
  if (name === "exi_verify_runtime" && rawArguments.path !== undefined && typeof rawArguments.path !== "string") fail("Prompt path string olmalı.", "EXI_MCP_ARGUMENT_TYPE");
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
  if (typeof resultPath !== "string" || !resultPath || resultPath.length > 128) fail("Batch result path geçersiz.");
  const segments = resultPath.split(".");
  if (segments.some((segment) => !segment || forbiddenKeys.has(segment) || !/^[A-Za-z][A-Za-z0-9_$]*$/.test(segment))) fail("Batch result path güvenli property yolu olmalı.");
  let current = result;
  for (const segment of segments) {
    if (current === null || (typeof current !== "object" && typeof current !== "function") || !Object.hasOwn(current, segment)) fail(`Batch result property bulunamadı: ${resultPath}.`);
    current = current[segment];
  }
  return current;
}

function resolveBatchReferences(value, results, depth = 0, key = "") {
  if (depth > MAX_VALUE_DEPTH) fail("Batch reference veri derinliği limiti aşıldı.");
  if (Array.isArray(value)) return value.map((item) => resolveBatchReferences(item, results, depth + 1));
  if (!value || typeof value !== "object") return value;
  const referenceKeys = Object.keys(value);
  const hasResultReference = Number.isSafeInteger(value.$result) && (referenceKeys.length === 1 || (referenceKeys.length === 2 && referenceKeys.includes("$path")));
  if (hasResultReference) {
    const reference = results[value.$result];
    if (!reference || !reference.ok) fail(`Batch result referansı geçersiz: ${value.$result}.`);
    const result = Object.hasOwn(value, "$path") ? resolveBatchResultPath(reference.result, value.$path) : reference.result;
    if (result && typeof result === "object" && typeof result.$handle === "string") {
      return key === "handle" ? result.$handle : { $handle: result.$handle };
    }
    return result;
  }
  const resolved = {};
  for (const [property, item] of Object.entries(value)) {
    if (forbiddenKeys.has(property)) fail(`Güvenli olmayan batch alanı: ${property}`);
    resolved[property] = resolveBatchReferences(item, results, depth + 1, property);
  }
  return resolved;
}

async function runBatch({ calls, stopOnError = true } = {}, signal, progressToken) {
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > 128) fail("Batch calls 1 ile 128 arasında olmalı.");
  if (typeof stopOnError !== "boolean") fail("Batch stopOnError boolean olmalı.");
  const results = [];
  sendProgress(progressToken, 0, calls.length, "Batch başladı.");
  for (let index = 0; index < calls.length; index += 1) {
    throwIfCancelled(signal);
    const call = calls[index];
    if (!call || typeof call !== "object" || Array.isArray(call) || typeof call.name !== "string" || !call.name) fail(`Batch call ${index} geçersiz.`);
    try {
      if (call.name === "exi_batch") fail("Nested exi_batch çağrısı reddedildi.");
      const batchArguments = Object.hasOwn(call, "arguments") ? call.arguments : {};
      const result = await callTool(call.name, resolveBatchReferences(batchArguments, results), { signal, progressToken });
      results.push({ index, name: call.name, ok: true, result });
    } catch (error) {
      results.push({ index, name: call.name, ok: false, error: error instanceof Error ? error.message : String(error), code: error?.code || "EXI_MCP_BATCH_ERROR" });
      if (stopOnError) break;
    }
    sendProgress(progressToken, index + 1, calls.length, `Batch çağrısı tamamlandı: ${call.name}`);
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
  if (typeof previewId !== "string" || !/^p[1-9][0-9]*$/.test(previewId) || !previews.has(previewId)) fail(`Preview bulunamadı: ${previewId}`);
  return previews.get(previewId);
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
  sendProgress(progressToken, 0, 1, "Preview başlatılıyor.");
  if (previews.size >= MAX_PREVIEWS) fail(`Aynı anda en fazla ${MAX_PREVIEWS} preview çalışabilir.`, "EXI_MCP_PREVIEW_LIMIT");
  const safePagePath = safePreviewPath(pagePath);
  const previewDirectory = directory ?? inferPreviewDirectory(safePagePath);
  const requestedPort = port === null || port === undefined ? await findFreePort() : Number(port);
  throwIfCancelled(signal);
  if (!Number.isSafeInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65_535) fail("Preview portu geçersiz.");
  const previewId = `p${nextPreviewId++}`;
  const runtimeToken = randomBytes(18).toString("base64url");
  const preview = { id: previewId, directory: previewDirectory, pagePath: safePagePath, port: requestedPort, url: `http://127.0.0.1:${requestedPort}/`, runtimeToken, child: null, exited: false, stdout: "", stderr: "" };
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs"), "--port", String(requestedPort)], { cwd: ROOT, env: { ...process.env, EXI_RUNTIME_TOKEN: runtimeToken }, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  preview.child = child;
  const append = (target, chunk) => `${target}${chunk}`.slice(-MAX_OUTPUT_BYTES);
  child.stdout.on("data", (chunk) => { preview.stdout = append(preview.stdout, chunk.toString()); });
  child.stderr.on("data", (chunk) => { preview.stderr = append(preview.stderr, chunk.toString()); });
  child.once("exit", () => { preview.exited = true; });
  child.once("error", (error) => { preview.exited = true; preview.stderr = append(preview.stderr, error.message); });
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
    fail(`Preview başlatılamadı: ${preview.stderr || "server hazır olmadı"}`, "EXI_MCP_PREVIEW_START");
  }
  sendProgress(progressToken, 1, 1, "Preview hazır.");
  return { previewId, url: preview.url, pagePath: safePagePath, pageUrl: new URL(safePagePath, preview.url).href, port: preview.port, ready: true, runtime: { path: "/__exi/runtime", tokenManaged: true } };
}

async function projectPreview({ path: directoryPath, port = null } = {}, signal, progressToken) {
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Proje klasörü repo kökü olamaz.", "EXI_MCP_FILE_SCOPE");
  const projectCheck = await checkProject({ path: target.relative }, signal, progressToken);
  if (!projectCheck.ok) return { ok: false, phase: "project-check", directory: target.relative, projectCheck, preview: null };
  const entryPath = `${target.relative}/index.html`;
  const entry = await inspectProjectFile(resolveProjectFile(entryPath));
  if (!entry) return { ok: false, phase: "entry", directory: target.relative, entryPath, projectCheck, preview: null, error: { code: "EXI_MCP_ENTRY_NOT_FOUND", message: `Preview entry bulunamadı: ${entryPath}` } };
  const preview = await startPreview({ port, path: `/${entryPath}`, directory: target.relative }, signal, progressToken);
  return { ok: true, phase: "preview", directory: target.relative, entryPath, projectCheck, preview };
}

async function projectStatus({ path: directoryPath } = {}, signal, progressToken) {
  throwIfCancelled(signal);
  const target = resolvePath(directoryPath);
  if (target.resolved === ROOT) fail("Proje klasörü repo kökü olamaz.", "EXI_MCP_FILE_SCOPE");
  requireScaffoldDirectory(target);
  const files = await listProjectFiles({ path: target.relative });
  throwIfCancelled(signal);
  const assets = await listProjectAssets({ path: target.relative });
  throwIfCancelled(signal);
  const projectCheck = await checkProject({ path: target.relative }, signal, progressToken);
  const activePreviews = [];
  for (const preview of previews.values()) {
    if (preview.directory !== target.relative) continue;
    throwIfCancelled(signal);
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
    activePreviews.push({ previewId: preview.id, directory: preview.directory, pagePath: preview.pagePath, pageUrl: new URL(preview.pagePath, preview.url).href, port: preview.port, ready: !preview.exited, runtime });
  }
  return { directory: target.relative, ok: projectCheck.ok, projectCheck, files: files.files, assets: assets.assets, previews: activePreviews };
}

function sessionStatus() {
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
      complete: upload.receivedBytes === upload.expectedBytes,
    })),
    projectFileUploads: [...projectFileUploads.values()].map((upload) => ({
      fileUploadId: upload.id,
      path: upload.target.relative,
      expectedBytes: upload.expectedBytes,
      receivedBytes: upload.receivedBytes,
      remainingBytes: upload.expectedBytes - upload.receivedBytes,
      complete: upload.receivedBytes === upload.expectedBytes,
    })),
    previews: [...previews.values()].map((preview) => ({
      previewId: preview.id,
      directory: preview.directory,
      pagePath: preview.pagePath,
      pageUrl: new URL(preview.pagePath, preview.url).href,
      port: preview.port,
      ready: !preview.exited && preview.child?.exitCode === null,
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
  if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) fail("Preview response boyutu limiti aşıldı.", "EXI_MCP_PREVIEW_LIMIT");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) { await reader.cancel(); fail("Preview response boyutu limiti aşıldı.", "EXI_MCP_PREVIEW_LIMIT"); }
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
  if (typeof operation !== "string" || !runtimeOperations.has(operation)) fail(`Runtime operation desteklenmiyor: ${operation}`, "EXI_MCP_RUNTIME_OPERATION");
  if (operation === "batch" && (!Array.isArray(command.calls) || command.calls.length === 0 || command.calls.length > MAX_RUNTIME_BATCH_CALLS)) fail(`Runtime batch calls 1 ile ${MAX_RUNTIME_BATCH_CALLS} arasında olmalı.`, "EXI_MCP_RUNTIME_BATCH_LIMIT");
  const commandId = `r${nextRuntimeCommandId++}`;
  const payload = { id: commandId, operation, ...command };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_RUNTIME_COMMAND_BYTES) fail("Runtime command boyutu limiti aşıldı.", "EXI_MCP_RUNTIME_LIMIT");
  let completed = false;
  try {
    const accepted = await fetch(`${preview.url}__exi/runtime-command`, { method: "POST", headers: { "content-type": "application/json", "x-exi-runtime-token": preview.runtimeToken }, body, signal: signal || AbortSignal.timeout(5_000) });
    if (accepted.status !== 202) fail(`Runtime command kabul edilmedi: HTTP ${accepted.status}`, "EXI_MCP_RUNTIME_UNAVAILABLE");
    const deadline = Date.now() + MAX_RUNTIME_COMMAND_WAIT_MS;
    while (Date.now() < deadline) {
      throwIfCancelled(signal);
      const resultResponse = await fetch(`${preview.url}__exi/runtime-result?id=${encodeURIComponent(commandId)}`, { headers: { "x-exi-runtime-token": preview.runtimeToken }, signal: AbortSignal.timeout(1_000) }).catch((error) => {
        if (error?.name === "TimeoutError") return null;
        throw error;
      });
      if (resultResponse?.status === 200) {
        const result = JSON.parse(await readResponseLimited(resultResponse, MAX_RUNTIME_RESULT_BYTES));
        if (result.id !== commandId) fail("Runtime result id eşleşmedi.", "EXI_MCP_RUNTIME_RESULT");
        completed = true;
        if (!result.ok) {
          const error = new Error(result.error?.message || "Browser runtime command başarısız.");
          error.code = result.error?.code || "EXI_MCP_RUNTIME_ERROR";
          throw error;
        }
        return result.value;
      }
      if (resultResponse && resultResponse.status !== 404) fail(`Runtime result alınamadı: HTTP ${resultResponse.status}`, "EXI_MCP_RUNTIME_UNAVAILABLE");
      await new Promise((resolve) => setTimeout(resolve, 75));
    }
    fail("Browser runtime command zaman aşımına uğradı.", "EXI_MCP_RUNTIME_TIMEOUT");
  } finally {
    if (!completed) await cancelPreviewRuntimeCommand(preview, commandId);
  }
}

function safePreviewPath(value) {
  if (typeof value !== "string" || !value || value.length > 512 || value.includes("\0")) fail("Preview path geçersiz.");
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { fail("Preview path encoding geçersiz."); }
  if (!decoded.startsWith("/") || decoded.split("/").some((part) => part === "..") || decoded.includes("\\")) fail("Preview path traversal reddedildi.");
  return decoded;
}

async function probePreview({ previewId, path: requestPath = "/" } = {}, signal) {
  throwIfCancelled(signal);
  const preview = requirePreview(previewId);
  const pathname = safePreviewPath(requestPath);
  const url = new URL(pathname, preview.url);
  if (url.origin !== preview.url.slice(0, -1)) fail("Preview origini geçersiz.");
  const headers = pathname === "/__exi/runtime" ? { "x-exi-runtime-token": preview.runtimeToken } : undefined;
  const response = await fetch(url, { redirect: "error", headers, signal: AbortSignal.timeout(5_000) });
  throwIfCancelled(signal);
  const text = await readResponseLimited(response);
  return { previewId, url: url.href, status: response.status, ok: response.ok, contentType: response.headers.get("content-type") || "", body: text };
}

async function stopPreview(previewId) {
  const preview = requirePreview(previewId);
  previews.delete(previewId);
  if (!preview.child || preview.exited || preview.child.exitCode !== null) return { stopped: previewId };
  await terminateProcessTree(preview.child);
  return { stopped: previewId };
}

const expectedVersionSchema = { type: "object", required: ["bytes", "mtimeMs"], additionalProperties: false, properties: { bytes: { type: "integer", minimum: 0 }, mtimeMs: { type: "number", minimum: 0 } }, description: "Önceki read/list sonucundaki version; stale overwrite'ı reddetmek için kullanılır." };
const expectedSha256Schema = { type: "string", maxLength: 64, description: "İsteğe bağlı SHA-256 hex digest; upload commit içeriğiyle eşleşmelidir." };

const tools = [
  { name: "exi_api", description: "ExiEngine public class, function, method ve sabit manifestini döndürür.", inputSchema: { type: "object", properties: {} }, annotations: { title: "ExiEngine API manifest", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_session_status", description: "Bu MCP oturumundaki handle, scope, bekleyen upload ve preview metadata’sını getter çalıştırmadan bounded biçimde döndürür; token değerini açmaz.", inputSchema: { type: "object", properties: {} }, annotations: { title: "Inspect engine session", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_session_reset", description: "Bu MCP oturumundaki tüm engine handle'larını güvenli biçimde bırakır.", inputSchema: { type: "object", properties: {} }, annotations: { title: "Reset engine session", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_create", description: "ExiEngine public class'ından handle oluşturur.", inputSchema: { type: "object", required: ["type"], properties: { type: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Create engine object", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_function", description: "ExiEngine public fonksiyonunu handle argümanlarıyla çağırır.", inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine function", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_export_get", description: "src/index.js export ağacındaki allowlisted sabit veya static değeri okur.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Read engine export", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_export_call", description: "src/index.js export ağacındaki allowlisted public fonksiyonu async olarak çağırır.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine export", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_static_call", description: "Public class üzerindeki static metodu çağırır.", inputSchema: { type: "object", required: ["type", "method"], properties: { type: { type: "string" }, method: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call static engine method", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_call", description: "Bir engine handle üzerindeki public metodu çağırır.", inputSchema: { type: "object", required: ["handle", "method"], properties: { handle: { type: "string" }, method: { type: "string" }, args: { type: "array" } } }, annotations: { title: "Call engine method", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_inspect", description: "Bir engine handle’ın değer okumadan public method ve property metadata’sını döndürür; AI çağrı planını güvenilir kurabilir.", inputSchema: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } }, annotations: { title: "Inspect engine handle", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_get", description: "Bir engine handle üzerindeki public property/getter değerini okur.", inputSchema: { type: "object", required: ["handle", "property"], properties: { handle: { type: "string" }, property: { type: "string" } } }, annotations: { title: "Read engine property", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_set", description: "Bir engine handle üzerindeki public veri alanını JSON değeriyle değiştirir.", inputSchema: { type: "object", required: ["handle", "property", "value"], properties: { handle: { type: "string" }, property: { type: "string" }, value: {} } }, annotations: { title: "Set engine property", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_release", description: "Handle'ı bırakır ve varsa destroy() yaşam döngüsünü çalıştırır.", inputSchema: { type: "object", required: ["handle"], properties: { handle: { type: "string" } } }, annotations: { title: "Release engine handle", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_build_scene", description: "JSON deklarasyonundan sınırlı ve güvenli bir ExiEngine node ağacı kurar.", inputSchema: { type: "object", required: ["scene"], properties: { scene: { type: "object" } } }, annotations: { title: "Build scene graph", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_scaffold", description: "Repo içinde traversal korumalı minimal tarayıcı oyun projesi oluşturur.", inputSchema: { type: "object", properties: { directory: { type: "string" }, overwrite: { type: "boolean" } } }, annotations: { title: "Scaffold browser game", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_project_apply", description: "Aynı session scope’undaki oyun klasörüne en fazla 16 bounded text dosyasını tek transactional akışta yazar; preflight veya commit hatasında önceki dosyaları rollback eder. Her dosyada read/list version verilirse stale overwrite reddedilir.", inputSchema: { type: "object", required: ["path", "files"], properties: { path: { type: "string" }, files: { type: "array", minItems: 1, maxItems: MAX_PROJECT_APPLY_FILES, items: { type: "object", required: ["path", "content"], additionalProperties: false, properties: { path: { type: "string", minLength: 1 }, content: { type: "string", maxLength: MAX_PROJECT_FILE_BYTES }, expectedVersion: expectedVersionSchema } } }, overwrite: { type: "boolean", default: false } } }, annotations: { title: "Apply project text files", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_read", description: "Repo kökü altındaki allowlisted text proje dosyasını bounded içerikle okur; büyük dosyalarda UTF-8 offset/limit paging kullanır.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_PROJECT_READ_BYTES } } }, annotations: { title: "Read project text file", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_list", description: "Aynı session’da scaffold edilen veya exi_project_open ile açılan proje klasöründeki allowlisted text dosyalarını bounded metadata ile listeler.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "List project files", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_write", description: "Repo kökü altındaki allowlisted text proje dosyasını bounded UTF-8 içerikle oluşturur veya açık overwrite ile günceller; expectedVersion stale overwrite'ı, expectedSha256 ise içerik bozulmasını reddeder.", inputSchema: { type: "object", required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string", maxLength: MAX_PROJECT_FILE_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Write project text file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_patch", description: "Allowlisted mevcut text proje dosyasında find metninin tam bir eşleşmesini atomik olarak replace eder; sıfır veya birden fazla eşleşmede dosyaya dokunmaz.", inputSchema: { type: "object", required: ["path", "find", "replace"], properties: { path: { type: "string" }, find: { type: "string", minLength: 1, maxLength: MAX_PROJECT_PATCH_TEXT_BYTES }, replace: { type: "string", maxLength: MAX_PROJECT_PATCH_TEXT_BYTES } } }, annotations: { title: "Patch project text file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_begin", description: "64 KiB üzeri allowlisted text proje dosyası için sıralı chunk upload başlatır; geçici dosya proje scope’u içinde tutulur, expectedVersion stale commit'i ve expectedSha256 bozuk içeriği reddeder.", inputSchema: { type: "object", required: ["path", "size"], properties: { path: { type: "string" }, size: { type: "integer", minimum: 0, maximum: MAX_CHUNKED_PROJECT_FILE_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Begin chunked project file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_chunk", description: "Chunk upload’a sıralı UTF-8 text parçası ekler; offset önceki receivedBytes ile eşleşmelidir.", inputSchema: { type: "object", required: ["fileUploadId", "offset", "content"], properties: { fileUploadId: { type: "string" }, offset: { type: "integer", minimum: 0 }, content: { type: "string", maxLength: MAX_PROJECT_FILE_CHUNK_BYTES } } }, annotations: { title: "Write project file chunk", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_commit", description: "Tamamlanan text upload’ı doğrulanmış hedef dosyaya commit eder.", inputSchema: { type: "object", required: ["fileUploadId"], properties: { fileUploadId: { type: "string" } } }, annotations: { title: "Commit project file", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_file_abort", description: "Chunked text upload geçici dosyasını temizler.", inputSchema: { type: "object", required: ["fileUploadId"], properties: { fileUploadId: { type: "string" } } }, annotations: { title: "Abort project file", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_list", description: "Aynı session’da scaffold edilen veya exi_project_open ile açılan klasördeki allowlisted oyun asset’lerini bounded metadata ile listeler.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "List game assets", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_read", description: "Aynı session’daki allowlisted oyun asset’inin en fazla 32 KiB byte aralığını base64 olarak okur; tam dosya belleğe alınmaz.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_ASSET_READ_BYTES } } }, annotations: { title: "Read game asset bytes", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_asset_write", description: "Aynı session’da scaffold edilen veya exi_project_open ile açılan klasöre bounded binary oyun asset’i yükler; expectedVersion stale overwrite'ı, expectedSha256 ise içerik bozulmasını reddeder.", inputSchema: { type: "object", required: ["path", "bytes"], properties: { path: { type: "string" }, bytes: binaryPayloadSchema, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Upload game asset", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_begin", description: "512 KiB üstü allowlisted asset için sıralı chunk upload başlatır; geçici dosya proje scope’u içinde tutulur, expectedVersion stale commit'i ve expectedSha256 bozuk içeriği reddeder.", inputSchema: { type: "object", required: ["path", "size"], properties: { path: { type: "string" }, size: { type: "integer", minimum: 0, maximum: MAX_CHUNKED_ASSET_BYTES }, overwrite: { type: "boolean", default: false }, expectedVersion: expectedVersionSchema, expectedSha256: expectedSha256Schema } }, annotations: { title: "Begin chunked asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_chunk", description: "Chunk upload’a sıralı bounded byte parçası ekler; offset önceki receivedBytes ile eşleşmelidir.", inputSchema: { type: "object", required: ["uploadId", "offset", "bytes"], properties: { uploadId: { type: "string" }, offset: { type: "integer", minimum: 0 }, bytes: binaryPayloadSchema } }, annotations: { title: "Write asset chunk", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_commit", description: "Tamamlanan chunk upload’ı doğrulanmış hedef asset adına taşır; overwrite açıkça verilmişse mevcut dosyayı değiştirir.", inputSchema: { type: "object", required: ["uploadId"], properties: { uploadId: { type: "string" } } }, annotations: { title: "Commit asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_asset_abort", description: "Chunk upload geçici dosyasını temizler.", inputSchema: { type: "object", required: ["uploadId"], properties: { uploadId: { type: "string" } } }, annotations: { title: "Abort asset upload", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_file_check", description: "Aynı session’da scaffold edilen veya exi_project_open ile açılan .html/.js/.mjs/.json proje dosyasını kod çalıştırmadan bounded statik kontrolünden geçirir.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Check project file syntax", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_status", description: "Aynı session’daki projeyi tek bounded read-only sonuçta dosya, asset, statik kontrol ve projeye bağlı preview telemetry özetiyle döndürür; browser/GPU yoksa bunu açıkça ayırır.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Inspect game project status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_check", description: "Aynı session’da scaffold edilen veya exi_project_open ile açılan oyunun allowlisted text dosyalarını tek bounded akışta kontrol eder; arbitrary code çalıştırmaz.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Check whole game project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_project_preview", description: "Aynı session scope’undaki oyunu önce statik kontrol eder; tüm checkable dosyalar geçerse index.html için loopback preview başlatır ve pageUrl döndürür. Browser/GPU kanıtı üretmez.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" }, port: { type: "integer", minimum: 1, maximum: 65535 } } }, annotations: { title: "Check and preview game", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_project_open", description: "Repo içindeki mevcut oyun klasörünü önce statik kontrol edip aynı session’ın bounded file/asset scope’una açar; arbitrary code çalıştırmaz.", inputSchema: { type: "object", required: ["path"], properties: { path: { type: "string" } } }, annotations: { title: "Open existing game project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_check", description: "Arbitrary shell çalıştırmadan doctor, test veya verify release kontrolü yapar.", inputSchema: { type: "object", required: ["mode"], properties: { mode: { enum: ["doctor", "test", "verify"] } } }, annotations: { title: "Run ExiEngine checks", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_preview_start", description: "Repo server.mjs'yi güvenli loopback portunda başlatır; istenen oyun page path'i HTTP 200 olmadan hazır dönmez ve pageUrl döndürür.", inputSchema: { type: "object", properties: { port: { type: "integer", minimum: 1, maximum: 65535 }, path: { type: "string", minLength: 1, maxLength: 512, description: "Repo içindeki oyun sayfası, örn. /ai-game/index.html" } } }, annotations: { title: "Start local preview", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
  { name: "exi_preview_call", description: "Token-korumalı demo veya scaffold RuntimeAgent üzerinden çalışan browser engine API'sini allowlisted operation ile çağırır; observe bounded canvas grid/hash, snapshot sınırlı scene graph/hash, scenario ise bounded input → fixed-step → observe/snapshot akışı verir; callback isteyen API'lerde yalnızca sayfada kayıtlı {\"$callback\":\"name\"} referansı kullanılabilir; eval veya arbitrary script çalıştırmaz. Batch için exi_preview_batch kullanılır.", inputSchema: { type: "object", required: ["previewId", "operation"], properties: { previewId: { type: "string" }, operation: { enum: ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario"] }, name: { type: "string" }, path: { type: "string" }, type: { type: "string" }, method: { type: "string" }, handle: { type: "string" }, property: { type: "string" }, value: {}, args: { type: "array", description: "JSON argümanları; observe için {columns,rows}, snapshot için [{offset,limit}], scenario için [{frames:[{delta,input,observe,snapshot}],resume?}], callback gereken browser API'leri için sayfada kayıtlı {\"$callback\":\"name\"} referansı desteklenir." } } }, annotations: { title: "Call browser engine runtime", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
  { name: "exi_preview_batch", description: "Browser RuntimeAgent üzerinde en fazla 8 allowlisted operation'ı sırayla çalıştırır; observe bounded canvas grid/hash, snapshot sınırlı scene graph/hash, scenario bounded input/step gözlemi verir; önceki sonuçlar $result ile sonraki çağrılara bağlanabilir, callback isteyen API'ler sayfada kayıtlı {\"$callback\":\"name\"} referansı kullanır.", inputSchema: { type: "object", required: ["previewId", "calls"], properties: { previewId: { type: "string" }, calls: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", required: ["operation"], additionalProperties: false, properties: { operation: { enum: ["function", "create", "export_get", "export_call", "static_call", "call", "inspect", "get", "set", "release", "observe", "snapshot", "scenario"] }, name: { type: "string" }, path: { type: "string" }, type: { type: "string" }, method: { type: "string" }, handle: {}, property: { type: "string" }, value: {}, args: { type: "array", description: "JSON argümanları; observe için {columns,rows}, snapshot için [{offset,limit}], scenario için [{frames:[{delta,input,observe,snapshot}],resume?}], callback için sayfada kayıtlı {\"$callback\":\"name\"} referansı kullanılır, callback gövdesi taşınmaz." } } } }, stopOnError: { type: "boolean", default: true } } }, annotations: { title: "Batch browser engine runtime", readOnlyHint: false, destructiveHint: true, openWorldHint: false } },
  { name: "exi_preview_probe", description: "Başlatılmış loopback preview içindeki GET kaynağını bounded response ile doğrular; /__exi/runtime yolu token-managed browser telemetry döndürür.", inputSchema: { type: "object", required: ["previewId"], properties: { previewId: { type: "string" }, path: { type: "string" } } }, annotations: { title: "Probe local preview", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  { name: "exi_preview_stop", description: "Bu MCP oturumunun başlattığı loopback preview process'ini durdurur.", inputSchema: { type: "object", required: ["previewId"], properties: { previewId: { type: "string" } } }, annotations: { title: "Stop local preview", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
  { name: "exi_batch", description: "En fazla 128 public ExiEngine tool çağrısını aynı session kuyruğunda sırayla çalıştırır; handle sonuçları ve {$result:0,$path:\"fileUploadId\"} alan referansları sonraki çağrılarda kullanılabilir.", inputSchema: { type: "object", required: ["calls"], properties: { calls: { type: "array", maxItems: 128, items: { type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string" }, arguments: { type: "object" } } } }, stopOnError: { type: "boolean", default: true } } }, annotations: { title: "Batch engine calls", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } },
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
    fail(`${path} MCP şemasına uymuyor.`, "EXI_MCP_ARGUMENT_INVALID");
  }
  if (schema.type && !schemaTypeMatches(value, schema.type)) fail(`${path} ${schema.type} olmalı.`, path === "arguments.args" ? "EXI_MCP_ARGS_TYPE" : "EXI_MCP_ARGUMENT_TYPE");
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail(`${path} geçerli bir enum değeri değil.`, "EXI_MCP_ARGUMENT_ENUM");
  if ((schema.type === "integer" || schema.type === "number") && typeof value === "number") {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) fail(`${path} minimum sınırının altında.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (Number.isFinite(schema.maximum) && value > schema.maximum) fail(`${path} maximum sınırını aşıyor.`, "EXI_MCP_ARGUMENT_LIMIT");
  }
  if (typeof value === "string" && Number.isSafeInteger(schema.maxLength) && value.length > schema.maxLength) fail(`${path} uzunluk limiti aşıldı.`, "EXI_MCP_ARGUMENT_LIMIT");
  if (Array.isArray(value)) {
    if (Number.isSafeInteger(schema.minItems) && value.length < schema.minItems) fail(`${path} en az ${schema.minItems} öğe içermeli.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (Number.isSafeInteger(schema.maxItems) && value.length > schema.maxItems) fail(`${path} en fazla ${schema.maxItems} öğe içermeli.`, "EXI_MCP_ARGUMENT_LIMIT");
    if (schema.items) for (let index = 0; index < value.length; index += 1) validateToolSchema(value[index], schema.items, `${path}[${index}]`);
  }
  if (isRecord(value) && schema.properties) {
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required) || value[required] === undefined) fail(`${path}.${required} zorunlu.`, "EXI_MCP_ARGUMENT_REQUIRED");
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail(`${path}.${key} bilinmeyen alan.`, "EXI_MCP_ARGUMENT_UNKNOWN");
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) validateToolSchema(value[key], childSchema, `${path}.${key}`);
    }
  }
}

async function callTool(name, rawArguments = {}, context = {}) {
  assertSafeData(rawArguments);
  const definition = tools.find((tool) => tool.name === name);
  if (!definition) fail(`MCP tool bulunamadı: ${name}`, "EXI_MCP_TOOL_NOT_FOUND");
  const signal = context?.signal;
  const progressToken = context?.progressToken;
  throwIfCancelled(signal);
  const args = rawArguments === undefined ? {} : rawArguments;
  if (!isRecord(args)) fail("MCP tool arguments object olmalı.", "EXI_MCP_ARGS_TYPE");
  if (name === "exi_preview_call" && args.operation === "batch") fail("Runtime batch için exi_preview_batch aracı kullanılmalı.", "EXI_MCP_RUNTIME_BATCH_ROUTE");
  if (name === "exi_preview_call" && typeof args.operation === "string" && !runtimeOperations.has(args.operation)) fail(`Runtime operation desteklenmiyor: ${args.operation}`, "EXI_MCP_RUNTIME_OPERATION");
  if (name === "exi_preview_batch" && Array.isArray(args.calls) && (args.calls.length === 0 || args.calls.length > MAX_RUNTIME_BATCH_CALLS)) fail(`Runtime batch calls 1 ile ${MAX_RUNTIME_BATCH_CALLS} arasında olmalı.`, "EXI_MCP_RUNTIME_BATCH_LIMIT");
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
    const fn = engineExports[assertPublicName(args.name, "name")];
    if (typeof fn !== "function" || isClass(fn)) fail(`Public function bulunamadı: ${args.name}`);
    return resultValue(await fn(...resolveArgs(args.args)));
  }
  if (name === "exi_export_get") return protectedResultValue(await resolveExportPath(args.path).value);
  if (name === "exi_export_call") {
    const resolved = resolveExportPath(args.path);
    if (typeof resolved.value !== "function") fail(`Public export function değil: ${args.path}`);
    return resultValue(await resolved.value.apply(resolved.parent, resolveArgs(args.args)));
  }
  if (name === "exi_static_call") {
    const type = assertPublicName(args.type, "type");
    const Constructor = engineExports[type];
    if (!isClass(Constructor)) fail(`Static method bulunamadı: ${type}.${args.method}`);
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
    if (!descriptor) fail(`Engine property bulunamadı: ${property}`);
    if (typeof descriptor.value === "function") fail(`Method property olarak yazılamaz: ${property}`);
    if ("value" in descriptor && descriptor.writable !== true) fail(`Property yazılabilir değil: ${property}`);
    if (!("value" in descriptor) && typeof descriptor.set !== "function") fail(`Property yazılabilir değil: ${property}`);
    const current = object[property];
    if (Array.isArray(current) || current instanceof Map || current instanceof Set) fail(`Collection property doğrudan yazılamaz: ${property}`);
    const next = resolveArgument(args.value);
    if (current && typeof current === "object" && next && typeof next === "object" && !objectHandles.has(next)) fail(`Object property handle ile değiştirilmelidir: ${property}`);
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
    if (args.operation === "batch") fail("Runtime batch için exi_preview_batch aracı kullanılmalı.", "EXI_MCP_RUNTIME_BATCH_ROUTE");
    return callPreviewRuntime(args, signal);
  }
  if (name === "exi_preview_batch") return callPreviewRuntime({ ...args, operation: "batch" }, signal);
  if (name === "exi_preview_probe") return probePreview(args, signal);
  if (name === "exi_preview_stop") return stopPreview(args.previewId);
  if (name === "exi_batch") return runBatch(args, signal, progressToken);
  fail(`MCP tool bulunamadı: ${name}`, "EXI_MCP_TOOL_NOT_FOUND");
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
    return { modern: true, error: errorResponse(message.id, -32602, "Modern MCP isteğinde clientCapabilities zorunlu.") };
  }
  if (meta[MODERN_CLIENT_INFO_META_KEY] !== undefined && !isRecord(meta[MODERN_CLIENT_INFO_META_KEY])) {
    return { modern: true, error: errorResponse(message.id, -32602, "Modern MCP clientInfo nesne olmalı.") };
  }
  if (Object.hasOwn(message, "id") && (message.id === null || (typeof message.id !== "string" && !Number.isSafeInteger(message.id)))) {
    return { modern: true, error: errorResponse(null, -32600, "Modern MCP request id null olmayan string veya safe integer olmalı.") };
  }
  return { modern: true, meta };
}

function unsupportedProtocolResponse(id, requested) {
  return errorResponse(id, -32022, "Desteklenmeyen MCP protokol sürümü.", { supported: SUPPORTED_PROTOCOLS, requested });
}

function modernResult(result) {
  const base = isRecord(result) ? result : { value: result };
  const existingMeta = isRecord(base._meta) ? base._meta : {};
  return { ...base, resultType: "complete", _meta: { ...existingMeta, [MODERN_SERVER_INFO_META_KEY]: SERVER_INFO } };
}

function response(id, result, modern = false) {
  send({ jsonrpc: "2.0", id, result: modern ? modernResult(result) : result });
}

function assertOutputSize(value) {
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (bytes > MAX_OUTPUT_BYTES) fail("MCP tool output boyutu limiti aşıldı.", "EXI_MCP_OUTPUT_LIMIT");
  return value;
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

async function handleMessage(line) {
  if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
    send(errorResponse(null, -32600, "MCP mesaj boyutu limiti aşıldı."));
    return;
  }
  let message;
  try { message = JSON.parse(line); } catch { send(errorResponse(null, -32700, "Geçersiz JSON.")); return; }
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    send(errorResponse(message?.id, -32600, "Geçersiz JSON-RPC isteği."));
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
      send(errorResponse(message.id, -32600, "Aynı request id ile çalışan MCP isteği var."));
      return;
    }
    const progressToken = message.params?._meta?.progressToken;
    const request = { controller: new AbortController(), cancelled: false };
    activeRequests.set(message.id, request);
    const run = toolQueue.then(async () => {
      try {
        throwIfCancelled(request.controller.signal);
        const rawArguments = message.params && Object.hasOwn(message.params, "arguments") ? message.params.arguments : {};
        const result = assertOutputSize(await callTool(message.params?.name, rawArguments, { signal: request.controller.signal, progressToken }));
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
  send(errorResponse(message.id, -32601, `Method bulunamadı: ${message.method}`));
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
