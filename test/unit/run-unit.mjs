// ExiEngine unit runner — test/unit/*.test.mjs dosyalarını node:test ile çalıştırır.
// Node 20 uyumluluğu için glob yerine programatik dosya listesi kullanır.
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const entries = await readdir(path.join(root, "test", "unit"));
const files = entries.filter((entry) => entry.endsWith(".test.mjs")).sort().map((entry) => path.join("test", "unit", entry));
if (files.length === 0) {
  console.log("[unit] test/unit içinde test dosyası yok.");
  process.exit(0);
}
const child = spawn(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
child.once("error", (error) => { console.error(error); process.exit(1); });
child.once("exit", (code) => process.exit(code ?? 1));
