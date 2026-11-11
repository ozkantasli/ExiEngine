// ExiEngine unit test — watchScene hot reload (polling through a loader and BroadcastChannel)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Node, Scene, SCENE_FORMAT, serializeScene, watchScene } from "../../src/index.js";

const sceneDocument = (name, x = 0) => {
  const scene = new Scene({ name });
  scene.add(new Node({ name: "hero", x, data: { kind: "player" } }));
  return serializeScene(scene);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("watchScene: polls a url, reloads only on change and keeps the scene on bad documents", async () => {
  let current = sceneDocument("level", 1);
  const urls = [];
  const loader = { loadJSON: async (url) => { urls.push(url); return JSON.parse(JSON.stringify(current)); } };
  const changes = []; const errors = [];
  const watcher = watchScene({ url: "/levels/one.json", loader, interval: 100, onChange: (scene, document, report) => changes.push({ scene, report }), onError: (error) => errors.push(error.message) });
  await wait(30);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].scene.findByName("hero").position.x, 1);
  assert.equal(changes[0].scene.findByName("hero").data.kind, "player");
  assert.equal(changes[0].report.source, "url");
  await wait(130);
  assert.equal(changes.length, 1, "unchanged documents are ignored");
  current = sceneDocument("level", 5);
  await wait(130);
  assert.equal(changes.length, 2);
  assert.equal(changes[1].scene.findByName("hero").position.x, 5);
  current = { format: SCENE_FORMAT, version: 1, root: { type: "Node", options: { onUpdate: "x" } } };
  await wait(130);
  assert.equal(changes.length, 2, "an invalid document does not replace the scene");
  assert.ok(errors.some((message) => /unknown option/.test(message)));
  assert.ok(urls.every((url) => /\/levels\/one\.json\?exi-watch=\d+$/.test(url)), "cache-busting query");
  watcher.stop();
  const pollsAfterStop = urls.length;
  await wait(150);
  assert.equal(urls.length, pollsAfterStop, "stop() ends polling");
  assert.equal(watcher.stopped, true);
});

test("watchScene: receives editor documents over a BroadcastChannel, filtered by name", async () => {
  const changes = [];
  const watcher = watchScene({ channel: "exi-test-editor", name: "level", onChange: (scene) => changes.push(scene) });
  const editor = new BroadcastChannel("exi-test-editor");
  editor.postMessage({ type: "exi-scene", name: "other", document: sceneDocument("other") });
  editor.postMessage({ type: "exi-scene", name: "level", document: sceneDocument("level", 9) });
  editor.postMessage({ type: "something-else" });
  await wait(50);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].findByName("hero").position.x, 9);
  assert.equal(watcher.apply(sceneDocument("level", 9)), false, "same document again is a no-op");
  assert.equal(watcher.apply(sceneDocument("level", 10)), true);
  watcher.stop();
  editor.close();
});

test("watchScene: options are validated", () => {
  assert.throws(() => watchScene({ url: "/a.json" }), /onChange/);
  assert.throws(() => watchScene({ onChange() {} }), /url, a channel/);
  assert.throws(() => watchScene({ url: "/a.json", onChange() {} }), /AssetLoader/);
  assert.throws(() => watchScene({ url: "/a.json", loader: { loadJSON() {} }, interval: 10, onChange() {} }), /interval/);
  assert.throws(() => watchScene({ channel: "", onChange() {} }), /channel/);
});
