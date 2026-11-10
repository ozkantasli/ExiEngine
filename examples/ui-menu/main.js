// ExiEngine example: a game menu without DOM widgets.
// Shows an overlay UI scene, interactive + focusable nodes (mouse, touch, Tab,
// Shift+Tab, Enter/Space), tweened hover feedback with Animator, and screens
// driven by a StateMachine. The world scene keeps animating behind the menu.
import { Animator, Camera, ExiEngine, Graphics, Node, Scene, StateMachine, Text, Tween, easing } from "../../src/index.js";

const WIDTH = 640;
const HEIGHT = 360;
const BUTTON_WIDTH = 220;
const BUTTON_HEIGHT = 44;

const animator = new Animator({ maxTweens: 64 });
const screens = new StateMachine({
  name: "menu",
  initial: "main",
  states: {
    main: { on: { play: "playing", settings: "settings", credits: "credits" } },
    settings: { on: { back: "main" } },
    credits: { on: { back: "main" } },
    playing: { on: { back: "main" } },
  },
});

// Background world: a slow field of drifting squares.
const world = new Scene();
for (let index = 0; index < 40; index += 1) {
  const size = 6 + (index % 5) * 4;
  const square = new Graphics({
    x: (index * 97) % WIDTH,
    y: (index * 53) % HEIGHT,
    alpha: 0.25 + (index % 4) * 0.1,
    onUpdate(delta, node) {
      node.position.y -= (10 + size) * delta;
      node.rotation += delta * 0.4;
      if (node.position.y < -20) node.position.y = HEIGHT + 20;
    },
  }).rect(-size / 2, -size / 2, size, size, { fill: index % 3 ? 0x1e3a8a : 0x0e7490 });
  world.add(square);
}

const ui = new Scene();
const title = new Text({ x: WIDTH / 2, y: 64, resolution: 2, text: "EXI QUEST", font: "900 40px system-ui, sans-serif", fill: "#5eead4" });
const subtitle = new Text({ x: WIDTH / 2, y: 100, resolution: 2, text: "", font: "15px system-ui, sans-serif", fill: "#94a3b8" });
ui.add(title, subtitle);

const settings = { sound: true, shake: true };

function makeButton(label, onActivate) {
  const button = new Node({
    name: `button:${label}`,
    x: WIDTH / 2 - BUTTON_WIDTH / 2,
    interactive: true,
    focusable: true,
    hitArea: { x: 0, y: 0, width: BUTTON_WIDTH, height: BUTTON_HEIGHT },
  });
  const background = new Graphics().roundedRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 10, { fill: 0x1e293b });
  const highlight = new Graphics({ alpha: 0 }).roundedRect(0, 0, BUTTON_WIDTH, BUTTON_HEIGHT, 10, { fill: 0x0f766e });
  const caption = new Text({ x: BUTTON_WIDTH / 2, y: BUTTON_HEIGHT / 2, resolution: 2, text: label, font: "600 17px system-ui, sans-serif", fill: "#e2e8f0" });
  button.add(background, highlight, caption);
  let tween = null;
  const setHot = (hot) => {
    if (tween) animator.remove(tween);
    tween = animator.add(new Tween(highlight, "alpha", hot ? 1 : 0, 0.15, { ease: easing.outQuad }));
  };
  button.caption = caption;
  button.onPointerEnter = () => setHot(true);
  button.onPointerLeave = () => { if (!button.focused) setHot(false); };
  button.onFocus = () => setHot(true);
  button.onBlur = () => setHot(false);
  button.onPointerUp = () => onActivate(button);
  button.onKeyDown = (event) => {
    if (event.code === "Enter" || event.code === "Space") { event.preventDefault?.(); onActivate(button); }
  };
  return button;
}

const menus = {
  main: [
    makeButton("Play", () => screens.send("play")),
    makeButton("Settings", () => screens.send("settings")),
    makeButton("Credits", () => screens.send("credits")),
  ],
  settings: [
    makeButton("Sound: on", (button) => { settings.sound = !settings.sound; button.caption.setText(`Sound: ${settings.sound ? "on" : "off"}`); }),
    makeButton("Screen shake: on", (button) => { settings.shake = !settings.shake; button.caption.setText(`Screen shake: ${settings.shake ? "on" : "off"}`); }),
    makeButton("Back", () => screens.send("back")),
  ],
  credits: [makeButton("Back", () => screens.send("back"))],
  playing: [makeButton("Back to menu", () => screens.send("back"))],
};
const subtitles = {
  main: "Use the mouse, touch or Tab + Enter",
  settings: "Toggles are plain game state — no DOM involved",
  credits: "Made with ExiEngine · zero dependencies",
  playing: "This is where your game scene would start",
};

let engine = null;

function showScreen(name) {
  for (const list of Object.values(menus)) for (const button of list) if (button.parent) ui.remove(button);
  const buttons = menus[name];
  buttons.forEach((button, index) => {
    button.position.y = 150 + index * (BUTTON_HEIGHT + 14);
    button.alpha = 0;
    ui.add(button);
    animator.add(new Tween(button, "alpha", 1, 0.25, { ease: easing.outQuad }));
  });
  subtitle.setText(subtitles[name]);
  title.setText(name === "main" ? "EXI QUEST" : name.toUpperCase());
  engine?.focus(buttons[0]);
}

screens.onTransition(({ to }) => showScreen(to));

engine = await ExiEngine.create({
  canvas: document.querySelector("#game"),
  width: WIDTH,
  height: HEIGHT,
  resizeMode: "contain",
  backgroundColor: "#020617",
  scene: world,
  camera: new Camera({ x: WIDTH / 2, y: HEIGHT / 2 }), // world cameras center on their position
  overlayScene: ui,
  animator,
});
showScreen(screens.state);
engine.start();

window.game = { engine, ui, screens, settings };
