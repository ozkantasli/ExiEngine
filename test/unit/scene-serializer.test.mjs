// ExiEngine unit test — serializeScene / deserializeScene (Canvas 2D stub for Text)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Graphics, MAX_SERIALIZED_NODES, NineSliceSprite, Node, ParticleEmitter, Scene, SCENE_FORMAT, Sprite, Text, Texture, TileMap, deserializeScene, serializeScene } from "../../src/index.js";

const previousOffscreenCanvas = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() { return { font: "", measureText: (value) => ({ width: String(value).length * 8 }), clearRect() {}, setTransform() {}, fillText() {}, strokeText() {}, drawImage() {} }; }
};
test.after(() => {
  if (previousOffscreenCanvas) globalThis.OffscreenCanvas = previousOffscreenCanvas;
  else delete globalThis.OffscreenCanvas;
});

function buildSample() {
  const tiles = new Texture({ id: "tiles", sourceWidth: 32, sourceHeight: 16 });
  const scene = new Scene({ name: "level" });
  const shapes = new Graphics({ name: "shapes", x: 5, rotation: 0.5, alpha: 0.8, filter: "grayscale", blendMode: "additive" })
    .rect(0, 0, 10, 10, { fill: 0xff0000 })
    .circle(5, 5, 3, { fill: "#00ff00", alpha: 0.5, segments: 12 })
    .ellipse(1, 2, 3, 4)
    .line(0, 0, 9, 9, 2, { fill: 0x123456 })
    .triangle(0, 0, 4, 0, 2, 3)
    .polygon([0, 0, 10, 0, 10, 10, 5, 4, 0, 10], { fill: 0x0000ff });
  const map = new TileMap({ name: "ground", texture: tiles, tileWidth: 16, tileHeight: 16, columns: 2, rows: 1 });
  map.setTiles([1, -1]);
  map.setTile(0, 0, 1, { flipX: true, flipY: true });
  const sprite = new Sprite({ name: "hero", texture: tiles, width: 20, height: 10, x: 3, y: -4, scaleX: -1, tint: "#abcdef", flipX: true, anchorX: 0, hitArea: { x: 0, y: 0, width: 4, height: 4 }, interactive: true, zIndex: 3 });
  const label = new Text({ name: "label", text: "Hello", font: "12px sans-serif", fill: "#ffcc00", anchorX: 0, wordWrap: true, maxWidth: 100, layout: { left: 4, top: 6, anchorX: 0.5 } });
  const panel = new NineSliceSprite({ name: "panel", left: 3, right: 4, top: 5, bottom: 6, width: 50, height: 30, clipRect: { x: 0, y: 0, width: 40, height: 20 } });
  const group = new Node({ name: "group", focusable: true, tabIndex: 2, visible: false });
  scene.add(shapes, map, group);
  group.add(sprite, panel);
  shapes.add(label);
  return { scene, tiles };
}

test("scene serializer: round-trips every supported node type through JSON", () => {
  const { scene, tiles } = buildSample();
  const document = serializeScene(scene);
  assert.equal(document.format, SCENE_FORMAT);
  assert.equal(document.version, 1);
  const json = JSON.stringify(document);
  const report = {};
  const restored = deserializeScene(JSON.parse(json), { textures: { tiles }, report });
  assert.deepEqual(report, { nodes: 7, missingTextures: [] });
  assert.ok(restored instanceof Scene);
  assert.equal(JSON.stringify(serializeScene(restored)), json);
  const hero = restored.findByName("hero");
  assert.ok(hero instanceof Sprite);
  assert.equal(hero.texture, tiles);
  assert.equal(hero.position.x, 3);
  assert.equal(hero.scale.x, -1);
  assert.equal(hero.zIndex, 3);
  assert.deepEqual(hero.hitArea, { x: 0, y: 0, width: 4, height: 4 });
  const ground = restored.findByName("ground");
  assert.deepEqual(Array.from(ground.tiles), [1, -1]);
  assert.equal(ground.tileFlags[0], 3);
  assert.ok(restored.findByName("label") instanceof Text);
  assert.equal(restored.findByName("label").text, "Hello");
  assert.equal(restored.findByName("shapes").commands.length, 6);
  assert.equal(restored.findByName("group").visible, false);
});

test("scene serializer: textures resolve through a Map, a function or fall back to white", () => {
  const { scene, tiles } = buildSample();
  const document = serializeScene(scene);
  assert.equal(deserializeScene(document, { textures: new Map([["tiles", tiles]]) }).findByName("hero").texture, tiles);
  assert.equal(deserializeScene(document, { resolveTexture: (id) => (id === "tiles" ? tiles : null) }).findByName("hero").texture, tiles);
  const report = {};
  const withoutTextures = deserializeScene(document, { report });
  const placeholder = withoutTextures.findByName("hero").texture;
  assert.equal(placeholder.id, "tiles");
  assert.equal(placeholder.source, null);
  assert.deepEqual(report.missingTextures, ["tiles"]);
  // Saving a scene with unresolved textures must not rewrite their ids.
  assert.deepEqual(serializeScene(withoutTextures), document);
  assert.ok(withoutTextures.findByName("ground").texture.sourceWidth >= 32);
  assert.throws(() => deserializeScene(document, { strict: true }), /could not be resolved/);
  assert.throws(() => deserializeScene(document, { textures: { tiles: "nope" } }), /live Texture/);
});

test("scene serializer: rejects unsupported nodes unless skipped", () => {
  const scene = new Scene();
  scene.add(new Node({ name: "keep" }), new ParticleEmitter());
  assert.throws(() => serializeScene(scene), /cannot be serialized/);
  const document = serializeScene(scene, { unsupported: "skip" });
  assert.equal(document.root.children.length, 1);
  assert.deepEqual(document.skipped, ["ParticleEmitter"]);
  assert.throws(() => serializeScene({}), /expects a Node/);
});

test("scene serializer: loading validates shape, types, limits and never runs code", () => {
  const ok = { format: SCENE_FORMAT, version: 1, root: { type: "Node" } };
  assert.ok(deserializeScene(ok) instanceof Node);
  assert.throws(() => deserializeScene(null), /object/);
  assert.throws(() => deserializeScene({ ...ok, format: "other" }), /format/);
  assert.throws(() => deserializeScene({ ...ok, version: 2 }), /version/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "ParticleEmitter" } }), /type must be one of/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", options: { onUpdate: "alert(1)" } } }), /unknown option: onUpdate/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", script: "x" } }), /unknown option: script/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", options: { x: "1" } } }), /finite number/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", options: { x: Infinity } } }), /finite number/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", options: { name: "x".repeat(300) } } }), /at most 256/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Graphics", options: { commands: [{ type: "path" }] } } }), /not a supported Graphics command/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Graphics", options: { commands: [{ type: "polygon", points: [0, 0, "a"] }] } } }), /finite numbers/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "TileMap", options: { tileWidth: 8, tileHeight: 8, columns: 2, rows: 1, tiles: [0] } } }), /array of 2 integers/);
  assert.throws(() => deserializeScene({ ...ok, root: { type: "Node", children: {} } }), /children must be an array/);
  let deep = { type: "Node" };
  for (let index = 0; index < 70; index += 1) deep = { type: "Node", children: [deep] };
  assert.throws(() => deserializeScene({ ...ok, root: deep }), /depth limit/);
  const wide = { type: "Node", children: Array.from({ length: 5 }, () => ({ type: "Node" })) };
  assert.throws(() => deserializeScene({ ...ok, root: wide }, { maxNodes: 3 }), /node limit/);
  assert.throws(() => deserializeScene(ok, { maxNodes: MAX_SERIALIZED_NODES + 1 }), /maxNodes/);
  assert.throws(() => serializeScene(new Node(), { unsupported: "keep" }), /unsupported/);
});

test("scene serializer: document shape matches the exi_build_scene { type, options, children } spec", () => {
  const scene = new Scene();
  scene.add(new Sprite({ name: "box", width: 4, height: 4 }));
  const { root } = serializeScene(scene);
  assert.deepEqual(Object.keys(root).sort(), ["children", "options", "type"]);
  assert.equal(root.children[0].type, "Sprite");
  assert.equal(root.children[0].options.texture, "white");
});
