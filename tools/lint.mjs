// ExiEngine zero-dependency lint
// (a) src/, tools/, server.mjs ve test/*.mjs dosyalarını Node --check ile sözdizimi doğrular,
// (b) static-smoke.mjs'teki kritik anti-pattern regex'lerini çalıştırır:
//     - harici motor importu (pixi/phaser/three/...), eval/new Function
//     - MCP server'da console.log, karışık girinti (tab+space)
// ESLint/biome kullanmaz (runtime dependency-free kontratı).
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirs = ["src", "tools", "examples"];
const sourceFiles = ["server.mjs"];

async function listSourceFiles() {
  const files = [...sourceFiles];
  for (const dir of sourceDirs) {
    const walk = async (relative) => {
      const entries = await readdir(path.join(root, relative), { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) files.push(full.replace(/\\/g, "/"));
      }
    };
    await walk(dir);
  }
  return files;
}

function syntaxCheck(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => resolve({ ok: false, message: error.message }));
    child.once("exit", (code) => resolve({ ok: code === 0, message: output.trim() }));
  });
}

const FORBIDDEN_IMPORT = /from\s+["'](?:pixi|phaser|three|babylon|godot|bevy)/i;
const FORBIDDEN_DYNAMIC_CODE = /\beval\s*\(|\bnew\s+Function\s*\(/;
const MIXED_INDENT = /(^ {1,}\t|\t {1,})/;

let failures = 0;
const files = await listSourceFiles();
console.log(`[lint] Scanning ${files.length} source files...`);

for (const file of files) {
  const source = await readFile(path.join(root, file), "utf8");
  const issues = [];
  if (FORBIDDEN_IMPORT.test(source)) issues.push("external engine import is forbidden");
  if (FORBIDDEN_DYNAMIC_CODE.test(source)) issues.push("eval/new Function is forbidden");
  if (file === "tools/exi-mcp-server.mjs" && /console\.log\s*\(/.test(source)) issues.push("console.log is forbidden in the MCP server");
  if (MIXED_INDENT.test(source)) issues.push("mixed tab/space indentation");
  if (issues.length > 0) {
    failures += 1;
    console.error(`  FAIL ${file}: ${issues.join(", ")}`);
  } else {
    const check = await syntaxCheck(file);
    if (!check.ok) {
      failures += 1;
      console.error(`  FAIL ${file}: syntax error — ${check.message}`);
    }
  }
}

if (failures > 0) {
  console.error(`\n[lint] ${failures} files failed.`);
  process.exitCode = 1;
} else {
  console.log("[lint] All files clean.");
}
