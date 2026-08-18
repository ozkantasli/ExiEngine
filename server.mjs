import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const realRoot = await fs.realpath(root);
const requestedPort = Number(process.argv[process.argv.indexOf("--port") + 1] || 4173);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65536 ? requestedPort : 4173;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".aac": "audio/aac",
  ".bmp": "image/bmp",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".ktx2": "image/ktx2",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".wav": "audio/wav",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const blockedFileNames = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
};
const runtimeToken = process.env.EXI_RUNTIME_TOKEN || "";
const MAX_RUNTIME_BODY_BYTES = 4 * 1024;
const MAX_RUNTIME_COMMAND_BODY_BYTES = 768 * 1024;
const MAX_RUNTIME_RESULT_BODY_BYTES = 64 * 1024;
const MAX_RUNTIME_COMMAND_QUEUE = 64;
const MAX_RUNTIME_COMMAND_BATCH = 8;
const MAX_RUNTIME_RESULTS = 64;
const RUNTIME_RESULT_TTL_MS = 30_000;
let runtimeState = null;
const runtimeCommands = [];
const runtimeResults = new Map();
const runtimeCommandFields = new Set(["id", "operation", "name", "path", "type", "method", "handle", "args", "property", "value", "calls", "stopOnError"]);
const runtimeResultFields = new Set(["id", "ok", "value", "error"]);

function runtimeAuthorized(request) {
  return Boolean(runtimeToken) && request.headers["x-exi-runtime-token"] === runtimeToken;
}

function readBoundedBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    request.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(new Error("Runtime telemetry body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", fail);
    request.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function readRuntimeBody(request) {
  return readBoundedBody(request, MAX_RUNTIME_BODY_BYTES);
}

function sendJSON(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, { ...securityHeaders, "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), "Content-Type": "application/json; charset=utf-8" });
  response.end(body);
}

function validRuntimeId(value) {
  return typeof value === "string" && /^r[1-9A-Za-z_-][0-9A-Za-z_-]{0,126}$/.test(value);
}

function normalizeRuntimeCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !validRuntimeId(value.id) || typeof value.operation !== "string" || value.operation.length > 32) return null;
  if (Object.keys(value).some((key) => !runtimeCommandFields.has(key))) return null;
  return value;
}

function normalizeRuntimeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !validRuntimeId(value.id) || typeof value.ok !== "boolean") return null;
  if (Object.keys(value).some((key) => !runtimeResultFields.has(key))) return null;
  return value;
}

function pruneRuntimeResults() {
  const deadline = Date.now() - RUNTIME_RESULT_TTL_MS;
  for (const [id, result] of runtimeResults) if (result.receivedAt < deadline) runtimeResults.delete(id);
  while (runtimeResults.size > MAX_RUNTIME_RESULTS) runtimeResults.delete(runtimeResults.keys().next().value);
}

function normalizeRuntimeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const integer = (candidate) => Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
  const text = (candidate, maxLength) => typeof candidate === "string" ? candidate.slice(0, maxLength) : "";
  return {
    ready: value.ready === true,
    status: text(value.status, 32),
    event: text(value.event, 64),
    backend: text(value.backend, 16),
    fps: integer(value.fps),
    draws: integer(value.draws),
    nodes: integer(value.nodes),
    receivedAt: Date.now(),
  };
}

async function handleRuntimeRequest(request, response, requestURL) {
  if (!runtimeToken) return false;
  if (requestURL.pathname === "/__exi/runtime-token" && request.method === "GET") {
    const body = `${runtimeToken}\n`;
    response.writeHead(200, { ...securityHeaders, "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), "Content-Type": "text/plain; charset=utf-8" });
    response.end(body);
    return true;
  }
  if (requestURL.pathname === "/__exi/runtime-command") {
    if (!runtimeAuthorized(request)) {
      response.writeHead(403, securityHeaders);
      response.end("Forbidden");
      return true;
    }
    if (request.method === "GET") {
      const commands = runtimeCommands.splice(0, MAX_RUNTIME_COMMAND_BATCH);
      sendJSON(response, 200, { commands });
      return true;
    }
    if (request.method === "POST") {
      try {
        if (runtimeCommands.length >= MAX_RUNTIME_COMMAND_QUEUE) throw new Error("Runtime command queue full.");
        const command = normalizeRuntimeCommand(JSON.parse(await readBoundedBody(request, MAX_RUNTIME_COMMAND_BODY_BYTES)));
        if (!command) throw new Error("Invalid runtime command.");
        if (runtimeCommands.some((entry) => entry.id === command.id) || runtimeResults.has(command.id)) throw new Error("Duplicate runtime command id.");
        runtimeCommands.push(command);
        sendJSON(response, 202, { accepted: true, id: command.id });
      } catch {
        response.writeHead(400, securityHeaders);
        response.end("Bad Runtime Command");
      }
      return true;
    }
    if (request.method === "DELETE") {
      const id = requestURL.searchParams.get("id");
      if (!validRuntimeId(id)) {
        response.writeHead(400, securityHeaders);
        response.end("Bad Runtime Command Id");
        return true;
      }
      for (let index = runtimeCommands.length - 1; index >= 0; index -= 1) if (runtimeCommands[index].id === id) runtimeCommands.splice(index, 1);
      response.writeHead(204, securityHeaders);
      response.end();
      return true;
    }
    response.writeHead(405, { Allow: "GET, POST, DELETE", ...securityHeaders });
    response.end("Method Not Allowed");
    return true;
  }
  if (requestURL.pathname === "/__exi/runtime-result") {
    if (!runtimeAuthorized(request)) {
      response.writeHead(403, securityHeaders);
      response.end("Forbidden");
      return true;
    }
    if (request.method === "POST") {
      try {
        const result = normalizeRuntimeResult(JSON.parse(await readBoundedBody(request, MAX_RUNTIME_RESULT_BODY_BYTES)));
        if (!result || (result.ok === false && (!result.error || typeof result.error !== "object"))) throw new Error("Invalid runtime result.");
        pruneRuntimeResults();
        runtimeResults.set(result.id, { ...result, receivedAt: Date.now() });
        response.writeHead(204, securityHeaders);
        response.end();
      } catch {
        response.writeHead(400, securityHeaders);
        response.end("Bad Runtime Result");
      }
      return true;
    }
    if (request.method === "GET") {
      const id = requestURL.searchParams.get("id");
      pruneRuntimeResults();
      const result = validRuntimeId(id) ? runtimeResults.get(id) : null;
      if (!result) {
        response.writeHead(404, securityHeaders);
        response.end("Runtime Result Not Ready");
        return true;
      }
      runtimeResults.delete(id);
      const { receivedAt, ...publicResult } = result;
      sendJSON(response, 200, publicResult);
      return true;
    }
    response.writeHead(405, { Allow: "GET, POST", ...securityHeaders });
    response.end("Method Not Allowed");
    return true;
  }
  if (requestURL.pathname !== "/__exi/runtime") return false;
  if (!runtimeAuthorized(request)) {
    response.writeHead(403, securityHeaders);
    response.end("Forbidden");
    return true;
  }
  if (request.method === "GET") {
    if (!runtimeState) {
      response.writeHead(404, securityHeaders);
      response.end("Runtime Not Ready");
      return true;
    }
    const body = `${JSON.stringify(runtimeState)}\n`;
    response.writeHead(200, { ...securityHeaders, "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body), "Content-Type": "application/json; charset=utf-8" });
    response.end(body);
    return true;
  }
  if (request.method === "POST") {
    try {
      const parsed = JSON.parse(await readRuntimeBody(request));
      const nextState = normalizeRuntimeState(parsed);
      if (!nextState) throw new Error("Invalid runtime telemetry.");
      runtimeState = nextState;
      response.writeHead(204, securityHeaders);
      response.end();
    } catch {
      response.writeHead(400, securityHeaders);
      response.end("Bad Runtime Telemetry");
    }
    return true;
  }
  response.writeHead(405, { Allow: "GET, POST", ...securityHeaders });
  response.end("Method Not Allowed");
  return true;
}

function resolveSafePath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }

  const relative = pathname.replace(/^\/+/, "") || "index.html";
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  return candidate;
}

function isPublicFile(filePath) {
  const relative = path.relative(root, filePath).replaceAll("\\", "/");
  const segments = relative.split("/");
  const fileName = segments.at(-1)?.toLowerCase() || "";
  if (segments.some((segment) => segment.startsWith("."))) return false;
  if (blockedFileNames.has(fileName)) return false;
  return Object.hasOwn(contentTypes, path.extname(fileName));
}

const server = createServer(async (request, response) => {
  let requestURL;
  try { requestURL = new URL(request.url || "/", "http://127.0.0.1"); }
  catch { response.writeHead(400, securityHeaders); response.end("Bad Request"); return; }
  if (await handleRuntimeRequest(request, response, requestURL)) return;
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD", ...securityHeaders });
    response.end("Method Not Allowed");
    return;
  }

  let filePath = resolveSafePath(request.url || "/");
  if (!filePath) {
    response.writeHead(400, securityHeaders);
    response.end("Bad Request");
    return;
  }

  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) filePath = path.join(filePath, "index.html");
    if (!isPublicFile(filePath)) {
      response.writeHead(404, securityHeaders);
      response.end("Not Found");
      return;
    }
    const fileStats = await fs.stat(filePath);
    const realFilePath = await fs.realpath(filePath);
    if (realFilePath !== realRoot && !realFilePath.startsWith(`${realRoot}${path.sep}`)) {
      response.writeHead(403, securityHeaders);
      response.end("Forbidden");
      return;
    }
    if (!isPublicFile(realFilePath)) {
      response.writeHead(404, securityHeaders);
      response.end("Not Found");
      return;
    }
    const headers = {
      ...securityHeaders,
      "Content-Length": fileStats.size,
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    };
    response.writeHead(200, headers);
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, securityHeaders);
    response.end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ExiEngine demo: http://127.0.0.1:${port}/`);
});
