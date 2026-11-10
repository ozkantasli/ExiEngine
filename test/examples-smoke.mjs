// ExiEngine examples smoke — every examples/<name>/ game must stay in sync with the
// public API without a browser: syntax-valid, imports only real src/index.js exports,
// strict CSP page shell, and bundled Tiled levels must import with TileMap.fromTiled.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Exi from "../src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const examplesRoot = path.join(root, "examples");
const examples = fs.readdirSync(examplesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.ok(examples.length >= 3, "expected at least three examples");
const indexHtml = fs.readFileSync(path.join(examplesRoot, "index.html"), "utf8");

for (const name of examples) {
  const dir = path.join(examplesRoot, name);
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const mainPath = path.join(dir, "main.js");
  const main = fs.readFileSync(mainPath, "utf8");
  assert.match(html, /Content-Security-Policy[^>]*script-src 'self'/, `${name}: strict CSP meta`);
  assert.doesNotMatch(html, /frame-ancestors/, `${name}: frame-ancestors is ignored in <meta> and logs a console error`);
  assert.match(html, /<script type="module" src="\.\/main\.js"><\/script>/, `${name}: module entry`);
  assert.ok(indexHtml.includes(`./${name}/`), `${name}: linked from examples/index.html`);
  execFileSync(process.execPath, ["--check", mainPath]);
  assert.doesNotMatch(main, /\beval\s*\(|new\s+Function\s*\(/, `${name}: no dynamic code`);
  const imports = [...main.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/gm)];
  assert.ok(imports.length > 0, `${name}: imports the engine`);
  for (const [, names, from] of imports) {
    assert.equal(from, "../../src/index.js", `${name}: only imports the public entry`);
    for (const imported of names.split(",").map((part) => part.trim()).filter(Boolean)) assert.ok(imported in Exi, `${name}: ${imported} is not a public export`);
  }
  for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
    const level = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!Array.isArray(level.layers)) continue;
    const texture = new Exi.Texture({ sourceWidth: level.tilesets[0].imagewidth || 1024, sourceHeight: level.tilesets[0].imageheight || 1024 });
    for (const layer of level.layers.filter((entry) => entry.type === "tilelayer")) {
      const map = Exi.TileMap.fromTiled(level, { texture, layer: layer.name });
      assert.equal(map.columns, level.width, `${name}/${file}: ${layer.name}`);
      map.destroy();
    }
    assert.ok(Exi.TileMap.tiledTileIdsWithProperty(level, "solid").size > 0, `${name}/${file}: solid tiles`);
  }
}
// The browser editor lives in editor/ and follows the same page contract.
const editorDir = path.join(root, "editor");
const editorHtml = fs.readFileSync(path.join(editorDir, "index.html"), "utf8");
const editorMain = fs.readFileSync(path.join(editorDir, "editor.js"), "utf8");
assert.match(editorHtml, /Content-Security-Policy[^>]*script-src 'self'/, "editor: strict CSP meta");
assert.doesNotMatch(editorHtml, /frame-ancestors/, "editor: frame-ancestors is ignored in <meta>");
execFileSync(process.execPath, ["--check", path.join(editorDir, "editor.js")]);
assert.doesNotMatch(editorMain, /\beval\s*\(|new\s+Function\s*\(|innerHTML\s*=/, "editor: no dynamic code or innerHTML");
const editorImport = /^import\s*\{([^}]*)\}\s*from\s*"\.\.\/src\/index\.js";/m.exec(editorMain);
assert.ok(editorImport, "editor: imports the public entry");
for (const imported of editorImport[1].split(",").map((part) => part.trim()).filter(Boolean)) assert.ok(imported in Exi, `editor: ${imported} is not a public export`);
console.log(`[examples] OK: ${examples.join(", ")} + editor`);
