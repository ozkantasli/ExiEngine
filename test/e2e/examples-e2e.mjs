// ExiEngine examples browser e2e — opens every examples/<name>/ page in real Chromium,
// drives a few inputs and checks that the engine runs, draws and logs no errors.
// Needs Playwright (globally or locally installed). EXI_PLAYWRIGHT_EXECUTABLE or
// EXI_PLAYWRIGHT_CHANNEL can point at a specific browser. Without Playwright it SKIPs.
import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch {
  try { ({ chromium } = require(path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright"))); } catch {
    console.log("[examples-e2e] SKIP: Playwright is not installed (npm i -g playwright).");
    process.exit(0);
  }
}

const port = 4300 + (process.pid % 500);
const server = spawn(process.execPath, ["server.mjs", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const base = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { if ((await fetch(`${base}/examples/`)).ok) break; } catch {}
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const inputs = {
  platformer: [["ArrowRight", 700], ["Space", 150], ["ArrowRight", 400]],
  "top-down": [["ArrowDown", 500], ["ArrowRight", 500]],
  "ui-menu": [["Tab", 80], ["Enter", 80]],
  physics: [["Space", 80], ["Space", 80], ["ArrowRight", 600], ["KeyF", 200]],
  shooter: [["Space", 900], ["ArrowLeft", 300], ["KeyR", 60]],
  runner: [["Space", 60], ["Space", 300]],
  match3: [["ArrowRight", 60], ["ArrowDown", 60], ["Space", 60], ["ArrowRight", 60], ["KeyR", 60]],
  lighting: [["ArrowLeft", 300], ["KeyH", 60], ["KeyN", 60], ["KeyN", 60]],
  "ui-widgets": [["KeyE", 60], ["KeyX", 60], ["KeyI", 60], ["Enter", 60], ["Tab", 60], ["ArrowRight", 60]],
};
const launchOptions = { args: ["--no-sandbox", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
if (process.env.EXI_PLAYWRIGHT_EXECUTABLE) launchOptions.executablePath = process.env.EXI_PLAYWRIGHT_EXECUTABLE;
if (process.env.EXI_PLAYWRIGHT_CHANNEL) launchOptions.channel = process.env.EXI_PLAYWRIGHT_CHANNEL;
const browser = await chromium.launch(launchOptions);
let failures = 0;
try {
  const examples = fs.readdirSync(path.join(root, "examples"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of examples) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 680 } });
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/examples/${name}/`);
    await page.waitForFunction(() => window.game?.engine?.running === true, null, { timeout: 10_000 }).catch(() => {});
    await page.locator("canvas").click();
    for (const [key, ms] of inputs[name] || []) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
    await page.waitForTimeout(400);
    const info = await page.evaluate(() => {
      const engine = window.game?.engine;
      if (!engine) return null;
      const data = engine.getInfo();
      return { running: engine.running, backend: data.backend, drawCalls: data.drawCalls, nodes: data.nodeCount };
    });
    const ok = info && info.running && info.drawCalls > 0 && errors.length === 0;
    if (!ok) failures += 1;
    console.log(`[examples-e2e] ${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(info)}${errors.length ? ` errors=${JSON.stringify(errors)}` : ""}`);
    await page.close();
  }
  failures += await checkEditor();
  failures += await checkPlayWindow();
} finally {
  await browser.close();
  server.kill();
}
async function checkEditor() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/editor/`);
  await page.waitForFunction(() => window.editor?.engine?.running === true, null, { timeout: 10_000 }).catch(() => {});
  const toClient = (x, y) => page.evaluate(([wx, wy]) => {
    const canvas = window.editor.engine.canvas;
    const rect = canvas.getBoundingClientRect();
    const point = window.editor.camera.worldToScreen(wx, wy);
    return { x: rect.left + (point.x * rect.width) / canvas.width, y: rect.top + (point.y * rect.height) / canvas.height };
  }, [x, y]);
  const result = {};
  try {
    await page.evaluate(() => { localStorage.clear(); window.editor.load(window.editor.serialize()); });
    const player = await page.evaluate(() => { const node = window.editor.root.findByName("player"); return { x: node.position.x, y: node.position.y }; });
    const start = await toClient(player.x, player.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y - 40, { steps: 6 });
    await page.mouse.up();
    result.dragged = await page.evaluate(([x, y]) => { const node = window.editor.root.findByName("player"); return node.position.x !== x || node.position.y !== y; }, [player.x, player.y]);
    result.selected = await page.evaluate(() => window.editor.root.children[window.editor.selection?.[0]]?.name === "player");
    const before = await page.evaluate(() => window.editor.root.children.length);
    await page.click("[data-add=Rect]");
    result.added = (await page.evaluate(() => window.editor.root.children.length)) === before + 1;
    await page.click("[data-action=undo]");
    result.undone = (await page.evaluate(() => window.editor.root.children.length)) === before;
    await page.evaluate(() => window.editor.select([0]));
    await page.fill("#field-paint-tile", "5");
    await page.press("#field-paint-tile", "Tab");
    await page.keyboard.press("KeyP");
    const ground = await page.evaluate(() => { const map = window.editor.root.children[0]; return { x: map.position.x + map.tileWidth / 2, y: map.position.y + map.tileHeight / 2 }; });
    const cell = await toClient(ground.x, ground.y);
    await page.mouse.click(cell.x, cell.y);
    result.painted = await page.evaluate(() => window.editor.root.children[0].getTile(0, 0) === 5);
    result.roundTrip = await page.evaluate(() => { const json = JSON.stringify(window.editor.serialize()); window.editor.load(JSON.parse(json)); return JSON.stringify(window.editor.serialize()) === json; });
    result.prefabs = await page.evaluate(() => {
      const editor = window.editor;
      editor.select([1]);                        // the player sprite
      editor.makePrefab("hero");
      editor.insertPrefab("hero");
      const copies = () => editor.root.children.filter((node) => node.data?.prefab === "hero");
      if (copies().length !== 2) return false;
      editor.select([editor.root.children.length - 1]);
      editor.setOption("tint", 0xff0000);
      editor.applyPrefab();
      const tints = copies().map((node) => node.tint);
      const positions = new Set(copies().map((node) => node.position.x));
      const document = editor.serialize();
      return tints.every((tint) => tint === 0xff0000) && positions.size === 2 && Boolean(document.prefabs?.hero) && document.prefabs.hero.options.x === undefined;
    });
    // Behaviours + timeline: two keys, then scrubbing between them interpolates.
    result.timeline = await page.evaluate(() => {
      const editor = window.editor;
      const index = editor.root.children.findIndex((node) => node.name === "sun");
      editor.select([index]);
      editor.setBehaviors([{ type: "keyframes", duration: 2, tracks: {} }, { type: "rotate", speed: 1 }]);
      editor.setTimelineTime(0); editor.recordKey();
      editor.setTimelineTime(1);
      const sun = editor.root.children[index];
      sun.position.x += 100;
      editor.recordKey();
      editor.setTimelineTime(0.5);
      const start = editor.serialize().root.children[index].options.data.behaviors[0].tracks.x[0][1];
      return Math.abs(editor.root.children[index].position.x - (start + 50)) < 0.01 && editor.root.children[index].data.behaviors.length === 2;
    });
    // Asset browser: dragging a texture into the view adds a sprite with it.
    const assetsBefore = await page.evaluate(() => window.editor.root.children.length);
    const viewport = await page.locator(".viewport").boundingBox();
    await page.locator("#textures li.asset").first().dragTo(page.locator(".viewport"), { targetPosition: { x: viewport.width * 0.3, y: viewport.height * 0.3 } });
    result.assets = await page.evaluate((count) => { const nodes = window.editor.root.children; return nodes.length === count + 1 && nodes.at(-1).texture?.id === "editor:tiles"; }, assetsBefore);
  } catch (error) {
    errors.push(error.message);
  }
  await page.close();
  const ok = errors.length === 0 && Object.values(result).every(Boolean) && Object.keys(result).length === 9;
  console.log(`[examples-e2e] ${ok ? "PASS" : "FAIL"} editor ${JSON.stringify(result)}${errors.length ? ` errors=${JSON.stringify(errors)}` : ""}`);
  return ok ? 0 : 1;
}

async function checkPlayWindow() {
  const context = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  const errors = [];
  const result = {};
  try {
    const editor = await context.newPage();
    editor.on("pageerror", (error) => errors.push(`editor: ${error.message}`));
    await editor.goto(`${base}/editor/`);
    await editor.waitForFunction(() => window.editor?.engine?.running === true, null, { timeout: 10_000 });
    // The authored start height: the player can land within the first frames of the
    // Play window, so the fall is measured from the document, not from a later read.
    const startY = await editor.evaluate(() => {
      localStorage.clear();
      window.editor.load(window.editor.serialize());
      window.editor.select([0]); window.editor.setOption("data", { body: "static" });
      window.editor.select([1]); window.editor.setOption("data", { body: "dynamic" });
      const find = (node) => node.options?.name === "player" ? node : (node.children || []).map(find).find(Boolean);
      return find(window.editor.serialize().root).options.y;
    });
    const play = await context.newPage();
    play.on("pageerror", (error) => errors.push(`play: ${error.message}`));
    play.on("console", (message) => { if (message.type() === "error") errors.push(`play: ${message.text()}`); });
    await play.goto(`${base}/editor/play.html?name=scene`);
    await play.waitForFunction(() => window.play?.reloads > 0, null, { timeout: 10_000 });
    await play.waitForTimeout(1_200);
    result.physics = await play.evaluate(([y]) => { const node = window.play.engine.scene.findByName("player"); return node.position.y > y && window.play.world.bodies.length === 2; }, [startY]);
    await editor.evaluate(() => { window.editor.select([3]); window.editor.setOption("text", "Edited live!"); });
    await play.waitForFunction(() => window.play.engine.scene.findByName("title")?.text === "Edited live!", null, { timeout: 5_000 });
    result.live = true;
  } catch (error) {
    errors.push(error.message);
  }
  await context.close();
  const ok = errors.length === 0 && result.physics === true && result.live === true;
  console.log(`[examples-e2e] ${ok ? "PASS" : "FAIL"} editor-play ${JSON.stringify(result)}${errors.length ? ` errors=${JSON.stringify(errors)}` : ""}`);
  return ok ? 0 : 1;
}

if (failures) { console.error(`[examples-e2e] ${failures} example(s) failed.`); process.exit(1); }
console.log("[examples-e2e] All examples run in a real browser.");
