// ExiEngine typecheck — index.d.ts ve TS consumer fixture'ını doğrular.
// Node 22.6+ --experimental-strip-types ile çalışır; eski Node'da SKIP (açık raporlanır).
// Bağımlılık yoktur (tsc yok; kontrat: devDependency eklenemez).
//
// Strateji:
//  1) index.d.ts boş değil ve kritik tip imzalarını içeriyor (regex ile, static-smoke'u tamamlar).
//  2) test/fixtures/typecheck.ts'yi --experimental-strip-types ile GERÇEKTEN çalıştırır:
//     tip importları runtime'da kaldırılır, kalan JS çalışır; sözdizimi/import hataları yakalanır.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dtsPath = path.join(root, "index.d.ts");
const fixturePath = path.join(root, "test", "fixtures", "typecheck.ts");

// 1) index.d.ts bütünlüğü
const dts = await readFile(dtsPath, "utf8");
if (dts.trim().length < 100) throw new Error("index.d.ts çok kısa veya boş.");
const requiredTypeTokens = ["export class ExiEngine", "export class Node", "export class Scene", "export class Sprite", "export class Camera", "export type ResizeMode", "export type BlendMode", "export type FilterKind", "export class PhysicsWorld", "export class TextureAtlas"];
const missing = requiredTypeTokens.filter((token) => !dts.includes(token));
if (missing.length > 0) throw new Error(`index.d.ts kritik tip eksik: ${missing.join(", ")}`);

// 2) TS fixture'ını strip-types ile çalıştır
function runTsFixture() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", fixturePath], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", (error) => resolve({ supported: false, message: error.message }));
    child.once("exit", (code) => resolve({ supported: true, ok: code === 0, message: output.trim() }));
  });
}

const fixture = await runTsFixture();
if (!fixture.supported) {
  console.log("[typecheck] SKIP — Node 22.6+ gerekir (--experimental-strip-types desteklenmiyor).");
} else if (!fixture.ok) {
  console.error(`[typecheck] typecheck.ts hatası:\n${fixture.message}`);
  process.exitCode = 1;
} else {
  console.log(`[typecheck] index.d.ts bütünlüğü OK; typecheck.ts consumer çalıştı (${fixture.message || "temiz"})`);
}
