// ExiEngine build smoke — tools/build.mjs single-file bundles must expose exactly
// the src/index.js API, keep class identity inside the bundle and run real engine code.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { build } from "../tools/build.mjs";
import * as source from "../src/index.js";

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "exi-build-"));
try {
  const result = build({ outDir });
  assert.equal(result.files.length, 2);
  const esmCode = fs.readFileSync(path.join(outDir, "exi-engine.js"), "utf8");
  assert.match(esmCode, /^\/\*! ExiEngine v\d+\.\d+\.\d+/);
  assert.doesNotMatch(esmCode, /^\s*import\s/m, "bundle must not contain import statements");
  assert.doesNotMatch(esmCode, /\beval\s*\(|\bnew\s+Function\s*\(/);

  const bundled = await import(pathToFileURL(path.join(outDir, "exi-engine.js")).href);
  assert.deepEqual(Object.keys(bundled).sort(), Object.keys(source).sort());
  for (const name of Object.keys(source)) assert.equal(typeof bundled[name], typeof source[name], name);

  const { Scene, Sprite, Node, Texture, TileMap, PhysicsWorld, PhysicsBody, Vec2, MAX_WORLD_COORDINATE } = bundled;
  assert.equal(MAX_WORLD_COORDINATE, source.MAX_WORLD_COORDINATE);
  const scene = new Scene();
  const sprite = new Sprite({ texture: Texture.white, width: 8, height: 8 });
  scene.add(sprite);
  assert.ok(sprite instanceof Node);
  assert.equal(new Vec2(3, 4).length(), 5);
  const map = TileMap.fromTiled({ width: 2, height: 1, tilewidth: 8, tileheight: 8, layers: [{ type: "tilelayer", data: [1, 2] }], tilesets: [{ firstgid: 1 }] }, { texture: new Texture({ sourceWidth: 16, sourceHeight: 8 }) });
  assert.deepEqual(Array.from(map.tiles), [0, 1]);
  const world = new PhysicsWorld({ scene, gravityY: 100 });
  const body = new PhysicsBody(new Node({ x: 0, y: 0 }), {});
  world.add(body);
  world.step(1 / 60);
  assert.ok(body.velocity.y > 0);

  const globalCode = fs.readFileSync(path.join(outDir, "exi-engine.global.js"), "utf8");
  const context = vm.createContext({ TextEncoder, TextDecoder, URL, AbortController, console, setTimeout, clearTimeout, queueMicrotask });
  vm.runInContext(globalCode, context);
  assert.equal(typeof context.Exi.ExiEngine, "function");
  assert.deepEqual(Object.keys(context.Exi).sort(), Object.keys(source).sort());
  console.log(`[build] OK: ${Object.keys(bundled).length} exports, ${(result.bytes / 1024).toFixed(1)} KiB ESM + global build`);
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
