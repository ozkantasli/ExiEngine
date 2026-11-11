// ExiEngine example: built-in canvas UI widgets in an overlay scene.
// Shows Button, Slider, TextInput, ScrollView, Checkbox, Dropdown and a Stack
// layout with pointer, wheel, keyboard
// focus (Tab / Shift+Tab) and text entry; the world scene behind is a preview
// whose colour and speed follow the widgets.
import { Button, Camera, Checkbox, Dropdown, ExiEngine, Graphics, Scene, ScrollView, Slider, Stack, Text, TextInput } from "../../src/index.js";

const WIDTH = 960;
const HEIGHT = 540;

// World: a spinning shape that reacts to the controls.
const world = new Scene();
const shape = new Graphics({ x: 720, y: 270 }).roundedRect(-80, -80, 160, 160, 28, { fill: 0xffffff });
world.add(shape);
const state = { speed: 1, hue: 170, size: 1, spinning: true, corner: 28 };
shape.onUpdate = (delta, node) => {
  if (state.spinning) node.rotation += delta * state.speed;
  node.scale.set(state.size, state.size);
};
function hueToTint(hue) {
  const h = (hue % 360) / 60; const c = 0.85; const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  return (Math.round((r + 0.15) * 255) << 16) | (Math.round((g + 0.15) * 255) << 8) | Math.round((b + 0.15) * 255);
}
const applyColour = () => { shape.clear().roundedRect(-80, -80, 160, 160, state.corner, { fill: hueToTint(state.hue) }); };
applyColour();

// UI overlay.
const ui = new Scene();
const label = (text, x, y) => new Text({ text, x, y, anchorX: 0, anchorY: 0, font: "14px system-ui, sans-serif", fill: "#94a3b8", resolution: 2 });
const title = new Text({ text: "Hello, player", x: 40, y: 30, anchorX: 0, anchorY: 0, font: "bold 26px system-ui, sans-serif", fill: "#e2e8f0", resolution: 2 });
ui.add(title);

ui.add(label("Player name (type, Enter to apply)", 40, 84));
const nameInput = new TextInput({ x: 40, y: 106, width: 300, placeholder: "Your name", maxLength: 24, onSubmit: (value) => title.setText(value ? `Hello, ${value}` : "Hello, player") });
ui.add(nameInput);

ui.add(label("Rotation speed", 40, 170));
ui.add(new Slider({ x: 40, y: 192, width: 300, min: 0, max: 5, value: 1, onChange: (value) => { state.speed = value; } }));
ui.add(label("Colour", 40, 232));
ui.add(new Slider({ x: 40, y: 254, width: 300, min: 0, max: 360, step: 5, value: state.hue, onChange: (value) => { state.hue = value; applyColour(); } }));
ui.add(label("Size", 40, 294));
ui.add(new Slider({ x: 40, y: 316, width: 300, min: 0.4, max: 1.6, value: 1, onChange: (value) => { state.size = value; } }));

const reset = new Button({ label: "Reset", x: 40, y: 370, width: 140, onClick: () => { state.speed = 1; state.size = 1; shape.rotation = 0; } });
const log = [];
const logView = new ScrollView({ x: 400, y: 380, width: 520, height: 130 });
const pushLog = (message) => {
  const line = new Text({ text: `${String(log.length + 1).padStart(2, "0")}  ${message}`, y: log.length * 24, anchorX: 0, anchorY: 0, font: "14px ui-monospace, monospace", fill: "#cbd5e1", resolution: 2 });
  log.push(line);
  logView.content.add(line);
  logView.scrollTo(logView.maxScroll + 24);
};
const ping = new Button({ label: "Log event", x: 200, y: 370, width: 140, onClick: () => pushLog(`clicked at speed ${state.speed.toFixed(2)}, hue ${state.hue}`) });
ui.add(reset, ping, label("Event log (wheel or drag to scroll)", 400, 356), new Graphics({ x: 400, y: 380 }).roundedRect(0, 0, 520, 130, 8, { fill: 0x0f172a }), logView);
for (let index = 0; index < 8; index += 1) pushLog(`started widget ${index + 1}`);

// A Stack lays out a label, a checkbox and a dropdown in a column.
const options = new Stack({ x: 400, y: 84, gap: 12 });
const spin = new Checkbox({ label: "Spin", checked: true, onChange: (value) => { state.spinning = value; } });
const corners = new Dropdown({ width: 200, options: [{ label: "Rounded corners", value: 28 }, { label: "Sharp corners", value: 0 }, { label: "Circle", value: 80 }], value: 28, onChange: (value) => { state.corner = value; applyColour(); } });
options.add(label("Options", 0, 0), spin, corners);
ui.add(options);

const engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#020617",
  scene: world,
  camera: new Camera({ x: WIDTH / 2, y: HEIGHT / 2 }),
  overlayScene: ui,
});
logView.camera = engine.overlayCamera; // clip the log to its viewport
engine.start();
engine.focus(nameInput);

window.game = { engine, ui, state, nameInput, logView, title, spin, corners, options };
