// ExiEngine zero-dependency bundler.
// Produces single-file builds of src/index.js without any npm tooling:
//   dist/exi-engine.js         ES module (import { ExiEngine } from ".../exi-engine.js")
//   dist/exi-engine.global.js  classic script that sets globalThis.Exi
// Each source module is wrapped in its own function scope (so private top-level
// names never collide) and modules are emitted in dependency order. Only the
// static `import { a, b as c } from "./x.js"` / `export class|function|const`
// / `export { a } from "./x.js"` forms used by src/ are supported; anything
// else fails the build loudly instead of producing a broken bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";?\s*$/;
const REEXPORT_RE = /^export\s*\{([^}]*)\}\s*from\s*"([^"]+)";?\s*$/;
const DECL_EXPORT_RE = /^export\s+(?:async\s+)?(class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function parseSpecifiers(list) {
  return list.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
    if (!match) throw new Error(`build: unsupported specifier "${part}"`);
    return { imported: match[1], local: match[2] || match[1] };
  });
}

function loadGraph(entry) {
  const modules = new Map();
  const order = [];
  const visiting = new Set();
  const visit = (file) => {
    if (modules.has(file)) return;
    if (visiting.has(file)) throw new Error(`build: circular import through ${path.relative(root, file)}`);
    visiting.add(file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    const imports = [];
    const reexports = [];
    const exportNames = [];
    const body = [];
    for (const line of lines) {
      let match;
      if ((match = IMPORT_RE.exec(line))) {
        imports.push({ file: path.resolve(path.dirname(file), match[2]), specifiers: parseSpecifiers(match[1]) });
      } else if ((match = REEXPORT_RE.exec(line))) {
        const target = path.resolve(path.dirname(file), match[2]);
        reexports.push({ file: target, specifiers: parseSpecifiers(match[1]) });
      } else if ((match = DECL_EXPORT_RE.exec(line))) {
        exportNames.push(match[2]);
        body.push(line.replace(/^export\s+/, ""));
      } else if (/^\s*(import|export)\b/.test(line) && !/^\s*import\s*\(/.test(line)) {
        throw new Error(`build: unsupported module syntax in ${path.relative(root, file)}: ${line.trim()}`);
      } else {
        body.push(line);
      }
    }
    for (const dependency of [...imports, ...reexports]) visit(dependency.file);
    visiting.delete(file);
    modules.set(file, { file, imports, reexports, exportNames, body });
    order.push(file);
  };
  visit(path.resolve(root, entry));
  return { modules, order };
}

function moduleId(index) { return `__exi_m${index}`; }

export function bundle(entry = "src/index.js") {
  const { modules, order } = loadGraph(entry);
  const ids = new Map(order.map((file, index) => [file, moduleId(index)]));
  const chunks = [];
  for (const file of order) {
    const mod = modules.get(file);
    const head = mod.imports.map(({ file: dependency, specifiers }) => {
      const target = modules.get(dependency);
      for (const { imported } of specifiers) {
        const provided = target.exportNames.includes(imported) || target.reexports.some((entry) => entry.specifiers.some((spec) => spec.local === imported));
        if (!provided) throw new Error(`build: ${path.relative(root, file)} imports missing "${imported}" from ${path.relative(root, dependency)}`);
      }
      return `const { ${specifiers.map(({ imported, local }) => imported === local ? imported : `${imported}: ${local}`).join(", ")} } = ${ids.get(dependency)};`;
    });
    const exported = [...mod.exportNames];
    const tail = [];
    for (const { file: dependency, specifiers } of mod.reexports) {
      for (const { imported, local } of specifiers) {
        tail.push(`${local}: ${ids.get(dependency)}.${imported}`);
      }
    }
    const members = [...exported, ...tail];
    chunks.push(`// ${path.relative(root, file).replaceAll("\\", "/")}\nconst ${ids.get(file)} = (() => {\n${head.join("\n")}${head.length ? "\n" : ""}${mod.body.join("\n").trimEnd()}\nreturn Object.freeze({ ${members.join(", ")} });\n})();`);
  }
  const entryId = ids.get(path.resolve(root, entry));
  const entryModule = modules.get(path.resolve(root, entry));
  const publicNames = [...entryModule.exportNames, ...entryModule.reexports.flatMap((item) => item.specifiers.map((spec) => spec.local))];
  return { code: chunks.join("\n\n"), entryId, publicNames };
}

export function build({ outDir = path.join(root, "dist") } = {}) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const { code, entryId, publicNames } = bundle();
  const banner = `/*! ExiEngine v${pkg.version} | ${pkg.license} License | zero-dependency WebGL2/WebGPU 2D engine */`;
  const esm = `${banner}\n${code}\n\nexport const { ${publicNames.join(", ")} } = ${entryId};\n`;
  const global = `${banner}\n(function (global) {\n"use strict";\n${code}\n\nglobal.Exi = ${entryId};\n})(typeof globalThis !== "undefined" ? globalThis : this);\n`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "exi-engine.js"), esm);
  fs.writeFileSync(path.join(outDir, "exi-engine.global.js"), global);
  return { files: ["exi-engine.js", "exi-engine.global.js"].map((name) => path.join(outDir, name)), publicNames, bytes: Buffer.byteLength(esm) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const result = build(outIndex > 0 ? { outDir: path.resolve(process.argv[outIndex + 1]) } : {});
  process.stdout.write(`[build] ${result.publicNames.length} exports, ${(result.bytes / 1024).toFixed(1)} KiB -> ${result.files.map((file) => path.relative(root, file)).join(", ")}\n`);
}
