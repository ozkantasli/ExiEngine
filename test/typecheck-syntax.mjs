// ExiEngine typecheck — verifies index.d.ts and the TS consumer fixture.
// Runs with Node 22.6+ --experimental-strip-types; SKIP on older Node (reported explicitly).
// No dependencies (no tsc; contract: no devDependencies).
//
// Strateji:
//  1) index.d.ts is not empty and contains the critical type signatures (regex, complements static-smoke).
//  2) ACTUALLY runs test/fixtures/typecheck.ts with --experimental-strip-types:
//     type imports are stripped at runtime, the remaining JS runs; syntax/import errors are caught.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dtsPath = path.join(root, "index.d.ts");
const fixturePath = path.join(root, "test", "fixtures", "typecheck.ts");

// 1) index.d.ts integrity
const dts = await readFile(dtsPath, "utf8");
if (dts.trim().length < 100) throw new Error("index.d.ts is too short or empty.");
const requiredTypeTokens = ["export class ExiEngine", "export class Node", "export class Scene", "export class Sprite", "export class Camera", "export type ResizeMode", "export type BlendMode", "export type FilterKind", "export class PhysicsWorld", "export class TextureAtlas"];
const missing = requiredTypeTokens.filter((token) => !dts.includes(token));
if (missing.length > 0) throw new Error(`index.d.ts is missing critical types: ${missing.join(", ")}`);

// 2) Run the TS fixture with strip-types
function runTsFixture() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", fixturePath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => resolve({ supported: false, message: error.message }));
    child.once("exit", (code) => {
      // Versions such as Node 20 print "bad option" for the unknown flag — that counts as SKIP, not an error.
      if (output.includes("bad option") || output.includes("--experimental-strip-types")) {
        resolve({ supported: false, message: output.trim() });
        return;
      }
      resolve({ supported: true, ok: code === 0, message: output.trim() });
    });
  });
}

const fixture = await runTsFixture();
if (!fixture.supported) {
  console.log("[typecheck] SKIP — needs Node 22.6+ (--experimental-strip-types is not supported).");
} else if (!fixture.ok) {
  console.error(`[typecheck] typecheck.ts error:\n${fixture.message}`);
  process.exitCode = 1;
} else {
  console.log(`[typecheck] index.d.ts integrity OK; typecheck.ts consumer ran (${fixture.message || "clean"})`);
}
