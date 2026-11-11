// ExiEngine unit test — UI widgets (Button, Slider, ScrollView, TextInput) with a Canvas 2D stub
import { test } from "node:test";
import assert from "node:assert/strict";
import { Button, Camera, Node, Scene, ScrollView, Slider, Text, TextInput } from "../../src/index.js";

const previous = globalThis.OffscreenCanvas;
globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() { return { font: "", measureText: (value) => ({ width: String(value).length * 8 }), clearRect() {}, setTransform() {}, fillText() {}, strokeText() {}, drawImage() {} }; }
};
test.after(() => { if (previous) globalThis.OffscreenCanvas = previous; else delete globalThis.OffscreenCanvas; });

const pointer = (worldX, worldY) => ({ worldX, worldY, preventDefault() {} });
const key = (code, keyValue = code) => ({ code, key: keyValue, preventDefault() { this.defaultPrevented = true; } });

test("button: clicks on press+release inside, keyboard activation, disabled state", () => {
  const clicks = [];
  const scene = new Scene();
  const button = new Button({ label: "Play", x: 10, y: 20, width: 100, height: 30, onClick: (target) => clicks.push(target.label.text) });
  scene.add(button);
  scene.updateWorldMatrix();
  assert.equal(button.interactive && button.focusable, true);
  button.onPointerDown(pointer(15, 25));
  button.onPointerUp(pointer(15, 25));
  button.onPointerDown(pointer(15, 25));
  button.onPointerUp(pointer(500, 500)); // released outside: no click
  button.onKeyDown(key("Enter"));
  button.onKeyDown(key("KeyA", "a"));
  assert.deepEqual(clicks, ["Play", "Play"]);
  button.setDisabled(true);
  assert.equal(button.click(), false);
  button.setLabel("Resume");
  assert.equal(button.label.text, "Resume");
});

test("slider: pointer, drag, keyboard, stepping and clamping", () => {
  const values = [];
  const scene = new Scene();
  const slider = new Slider({ x: 100, y: 0, width: 200, min: 0, max: 10, step: 1, value: 3, onChange: (value) => values.push(value) });
  scene.add(slider);
  scene.updateWorldMatrix();
  assert.equal(slider.value, 3);
  slider.onPointerDown(pointer(200, 5)); // middle of the track
  assert.equal(slider.value, 5);
  slider.onPointerMove(pointer(400, 5));
  assert.equal(slider.value, 10, "clamped to max while dragging");
  slider.onPointerUp();
  slider.onPointerMove(pointer(100, 5));
  assert.equal(slider.value, 10, "no drag after release");
  slider.onKeyDown(key("ArrowLeft"));
  slider.onKeyDown(key("Home"));
  assert.equal(slider.value, 0);
  slider.value = 7.4;
  assert.equal(slider.value, 7);
  assert.deepEqual(values, [5, 10, 9, 0, 7]);
  assert.throws(() => new Slider({ min: 1, max: 1 }), /greater/);
});

test("scroll view: wheel and drag scrolling, bounds, culling and screen clip", () => {
  const camera = new Camera({ x: 320, y: 180, width: 640, height: 360 });
  const scene = new Scene();
  const view = new ScrollView({ x: 40, y: 50, width: 200, height: 100, camera });
  for (let index = 0; index < 10; index += 1) view.content.add(new Button({ label: `Item ${index}`, y: index * 40, width: 180, height: 32 }));
  scene.add(view);
  scene.update(1 / 60);
  assert.equal(view.maxScroll, 9 * 40 + 32 - 100);
  assert.deepEqual(view.content.children.map((child) => child.visible).slice(0, 5), [true, true, true, false, false]);
  view.onWheel({ wheelY: 90, preventDefault() {} });
  scene.update(1 / 60);
  assert.equal(view.scrollY, 90);
  assert.equal(view.content.children[0].visible, false, "scrolled-out items are hidden (not picked)");
  view.onPointerDown(pointer(50, 100));
  view.onPointerMove(pointer(50, 60));
  view.onPointerUp();
  assert.equal(view.scrollY, 130);
  view.scrollTo(1e6);
  assert.equal(view.scrollY, view.maxScroll);
  view.scrollTo(-5);
  assert.equal(view.scrollY, 0);
  scene.update(1 / 60);
  assert.deepEqual(view.clipRect, { x: 40, y: 50, width: 200, height: 100 }, "clip follows the camera mapping");
});

test("text input: typing, editing keys, limits, submit and change events", () => {
  const changes = []; const submits = [];
  const input = new TextInput({ placeholder: "Name", maxLength: 5, domProxy: false, onChange: (value) => changes.push(value), onSubmit: (value) => submits.push(value) });
  new Scene().add(input);
  assert.equal(input.text.text, "Name", "placeholder when empty");
  input.onFocus();
  for (const character of "Exi") input.onKeyDown(key(`Key${character.toUpperCase()}`, character));
  assert.equal(input.value, "Exi");
  input.onKeyDown(key("ArrowLeft"));
  input.onKeyDown(key("KeyX", "!"));
  assert.equal(input.value, "Ex!i");
  input.onKeyDown(key("Backspace"));
  input.onKeyDown(key("End"));
  input.onKeyDown(key("Digit1", "1"));
  input.onKeyDown(key("Digit2", "2"));
  input.onKeyDown(key("Digit3", "3"));
  assert.equal(input.value, "Exi12", "maxLength is enforced");
  input.onKeyDown({ ...key("KeyC", "c"), ctrlKey: true });
  assert.equal(input.value, "Exi12", "shortcuts are not typed");
  input.onKeyDown(key("Enter"));
  assert.deepEqual(submits, ["Exi12"]);
  input.setValue("a\nb");
  assert.equal(input.value, "a b", "single line");
  assert.ok(changes.length >= 6);
  input.destroy();
});

test("text input: a DOM proxy mirrors IME/mobile input when a document exists", () => {
  const appended = [];
  const listeners = {};
  const element = { style: {}, value: "", setAttribute() {}, addEventListener: (type, listener) => { listeners[type] = listener; }, focus() { this.focused = true; }, setSelectionRange() {}, remove() { this.removed = true; } };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => element, body: { appendChild: (node) => appended.push(node) }, activeElement: null };
  element.focus = function focus() { this.focused = true; globalThis.document.activeElement = this; };
  try {
    const input = new TextInput({ value: "hi" });
    input.focused = true;
    input.onFocus();
    assert.equal(appended.length, 1);
    assert.equal(element.value, "hi");
    assert.equal(element.focused, true);
    element.value = "日本語";
    listeners.input();
    assert.equal(input.value, "日本語", "composition result arrives through the proxy");
    input.onKeyDown(key("KeyA", "a"));
    assert.equal(input.value, "日本語", "keys are not typed twice while the proxy is active");
    globalThis.document.activeElement = null; // the canvas was clicked
    input.onKeyDown(key("KeyB", "b"));
    assert.equal(input.value, "日本語b", "keys still work when the proxy lost DOM focus");
    input.onPointerDown();
    assert.equal(globalThis.document.activeElement, element, "clicking the field refocuses the proxy");
    input.onBlur();
    assert.equal(element.removed, true);
    assert.equal(input.proxy, null);
  } finally {
    if (previousDocument) globalThis.document = previousDocument; else delete globalThis.document;
  }
});

test("widgets: callbacks are validated", () => {
  assert.throws(() => new Button({ onClick: 1 }), /function/);
  assert.throws(() => new Slider({ onChange: "x" }), /function/);
  assert.throws(() => new TextInput({ onSubmit: {} }), /function/);
  assert.ok(new Node() instanceof Node);
});

test("layout: Stack places children in a row or column with gap, padding and alignment", async () => {
  const { Stack, Grid } = await import("../../src/index.js");
  const column = new Stack({ gap: 10, padding: 4, align: "center" });
  const a = new Button({ width: 100, height: 30 });
  const b = new Button({ width: 60, height: 20 });
  const hidden = new Button({ width: 500, height: 500, visible: false });
  column.add(a, hidden, b);
  column.arrange();
  assert.deepEqual([a.position.x, a.position.y, b.position.x, b.position.y], [4, 4, 24, 44]);
  assert.deepEqual(column.getLocalBounds(), { x: 0, y: 0, width: 108, height: 68 }, "hidden children are skipped");
  const row = new Stack({ direction: "row", gap: 5, align: "end" });
  const label = new Text({ text: "Hi", font: "16px sans-serif" }); // anchored at its centre by default
  row.add(new Button({ width: 40, height: 40 }), label);
  row.arrange();
  const labelBox = label.getLocalBounds();
  assert.equal(label.position.x + labelBox.x, 45, "anchored children are placed by their top-left corner");
  assert.equal(label.position.y + labelBox.y + labelBox.height, 40, "end-aligned");
  assert.throws(() => new Stack({ direction: "diagonal" }), /direction/);
  const grid = new Grid({ columns: 2, cellWidth: 50, cellHeight: 40, gap: 10 });
  const cells = [0, 1, 2].map(() => new Button({ width: 30, height: 20 }));
  grid.add(...cells);
  new Scene().add(grid);
  grid.update(1 / 60);
  assert.deepEqual(cells.map((cell) => [cell.position.x, cell.position.y]), [[10, 10], [70, 10], [10, 60]]);
  assert.deepEqual([grid.width, grid.height], [110, 90]);
});

test("checkbox: toggles by pointer and keyboard and reports changes", async () => {
  const { Checkbox } = await import("../../src/index.js");
  const changes = [];
  const box = new Checkbox({ label: "Sound", checked: true, onChange: (value) => changes.push(value) });
  new Scene().add(box);
  box.updateWorldMatrix();
  box.onPointerUp(pointer(5, 5));
  box.onKeyDown(key("Space"));
  box.onPointerUp(pointer(-50, 5)); // released outside
  box.checked = true;
  assert.deepEqual(changes, [false, true]);
  assert.equal(box.checked, true);
  assert.ok(box.hitArea.width > 32, "the label is clickable too");
});

test("dropdown: opens, navigates, picks with pointer or keyboard and closes", async () => {
  const { Dropdown } = await import("../../src/index.js");
  const picks = [];
  const select = new Dropdown({ options: ["Easy", { label: "Normal", value: 2 }, "Hard"], value: 2, width: 120, height: 30, onChange: (value) => picks.push(value) });
  new Scene().add(select);
  select.updateWorldMatrix();
  assert.equal(select.value, 2);
  assert.equal(select.label.text, "Normal");
  select.onPointerUp(pointer(10, 10));
  assert.equal(select.open, true);
  assert.equal(select.list.visible, true);
  assert.ok(select.hitArea.height > 30, "the open list can be clicked");
  select.onPointerUp(pointer(10, 30 + 4 + 2 * 30 + 5)); // third row
  assert.equal(select.value, "Hard");
  assert.equal(select.open, false);
  select.onKeyDown(key("Enter"));
  select.onKeyDown(key("ArrowDown"));
  select.onKeyDown(key("Enter"));
  assert.equal(select.value, "Easy", "wraps around");
  select.onKeyDown(key("ArrowDown"));
  assert.equal(select.value, 2, "arrows change the value while closed");
  select.onKeyDown(key("Enter"));
  select.onKeyDown(key("Escape"));
  assert.equal(select.open, false);
  assert.deepEqual(picks, ["Hard", "Easy", 2]);
  select.setOptions(["A", "B"], "B");
  assert.equal(select.value, "B");
  assert.throws(() => new Dropdown({ options: [] }), /at least one/);
});

test("widgets: pointer math works when nested in a layout", async () => {
  const { Stack, Dropdown } = await import("../../src/index.js");
  const scene = new Scene();
  const stack = new Stack({ x: 400, y: 84, gap: 12 });
  const spacer = new Button({ width: 100, height: 60 });
  const select = new Dropdown({ options: ["a", "b"], width: 200, height: 36 });
  stack.add(spacer, select);
  scene.add(stack);
  scene.update(1 / 60);
  select.onPointerUp(pointer(450, 84 + 72 + 10));
  assert.equal(select.open, true, "click on the nested dropdown header opens it");
  const slider = new Slider({ width: 100, min: 0, max: 10 });
  stack.add(slider);
  scene.update(1 / 60);
  slider.onPointerDown(pointer(400 + 50, 84 + 72 + 36 + 12 + 5));
  assert.equal(slider.value, 5);
});
