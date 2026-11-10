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
  } catch (error) {
    errors.push(error.message);
  }
  await page.close();
  const ok = errors.length === 0 && Object.values(result).every(Boolean) && Object.keys(result).length === 6;
  console.log(`[examples-e2e] ${ok ? "PASS" : "FAIL"} editor ${JSON.stringify(result)}${errors.length ? ` errors=${JSON.stringify(errors)}` : ""}`);
  return ok ? 0 : 1;
}

if (failures) { console.error(`[examples-e2e] ${failures} example(s) failed.`); process.exit(1); }
console.log("[examples-e2e] All examples run in a real browser.");
