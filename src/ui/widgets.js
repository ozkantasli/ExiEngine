import { Node } from "../core/node.js";
import { Graphics } from "../core/graphics.js";
import { Text } from "../core/text.js";

// Canvas UI widgets built from engine nodes: Button, Slider, ScrollView and
// TextInput. They use the engine's pointer capture, focus (Tab/Shift+Tab) and
// keyboard events, so they work with mouse, touch, keyboard and gamepad-driven
// focus without DOM controls. They are meant for overlay (HUD/menu) scenes.

export const UI_THEME = Object.freeze({
  background: 0x1e293b, hover: 0x334155, active: 0x0f766e, accent: 0x5eead4, track: 0x334155,
  text: "#e2e8f0", muted: "#94a3b8", font: "16px system-ui, sans-serif", radius: 8,
});
const MAX_TEXT_INPUT_LENGTH = 1_024;

function theme(overrides) { return { ...UI_THEME, ...(overrides || {}) }; }
function finite(value, fallback) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function callback(value, label) {
  if (value !== null && value !== undefined && typeof value !== "function") throw new TypeError(`${label} must be a function.`);
  return value || null;
}
// World point -> this node's local coordinates (inverse of its world matrix).
function toLocal(node, worldX, worldY) {
  node.updateWorldMatrix?.();
  const m = node.worldMatrix;
  const determinant = m.a * m.d - m.b * m.c || 1;
  const dx = worldX - m.tx; const dy = worldY - m.ty;
  return { x: (m.d * dx - m.c * dy) / determinant, y: (-m.b * dx + m.a * dy) / determinant };
}

export class Button extends Node {
  constructor({ label = "Button", width = 160, height = 40, onClick = null, disabled = false, theme: themeOverrides = null, ...options } = {}) {
    super({ name: "button", ...options, interactive: true, focusable: true });
    this.theme = theme(themeOverrides);
    this.width = Math.max(1, finite(width, 160));
    this.height = Math.max(1, finite(height, 40));
    this.hitArea = { x: 0, y: 0, width: this.width, height: this.height };
    this.onClick = callback(onClick, "Button onClick");
    this.disabled = Boolean(disabled);
    this.hovered = false;
    this.pressed = false;
    this.background = new Graphics({ name: "button-background" });
    this.label = new Text({ name: "button-label", text: String(label), x: this.width / 2, y: this.height / 2, anchorX: 0.5, anchorY: 0.5, font: this.theme.font, fill: this.theme.text, resolution: 2 });
    this.add(this.background, this.label);
    this.onPointerEnter = () => { this.hovered = true; this.redraw(); };
    this.onPointerLeave = () => { this.hovered = false; this.pressed = false; this.redraw(); };
    this.onPointerDown = () => { if (!this.disabled) { this.pressed = true; this.redraw(); } };
    this.onPointerUp = (event) => {
      const inside = event && this.containsPoint(event.worldX, event.worldY);
      const fire = this.pressed && inside;
      this.pressed = false;
      this.redraw();
      if (fire) this.click();
    };
    this.onPointerCancel = () => { this.pressed = false; this.redraw(); };
    this.onFocus = () => this.redraw();
    this.onBlur = () => this.redraw();
    this.onKeyDown = (event) => {
      if (event.code === "Enter" || event.code === "Space" || event.code === "NumpadEnter") { event.preventDefault?.(); this.click(); }
    };
    this.redraw();
  }

  getLocalBounds() { return this.hitArea; }
  setLabel(value) { this.label.setText(String(value)); return this; }
  setDisabled(value) { this.disabled = Boolean(value); this.redraw(); return this; }

  click() {
    if (this.disabled) return false;
    this.onClick?.(this);
    return true;
  }

  redraw() {
    const { theme: style } = this;
    const fill = this.disabled ? style.background : this.pressed ? style.active : (this.hovered || this.focused) ? style.hover : style.background;
    this.background.clear().roundedRect(0, 0, this.width, this.height, style.radius, { fill, alpha: this.disabled ? 0.5 : 1 });
    if (this.focused && !this.disabled) this.background.strokeRect(1, 1, this.width - 2, this.height - 2, 2, { fill: style.accent });
    this.label.setStyle({ fill: this.disabled ? style.muted : style.text });
    return this;
  }
}

export class Slider extends Node {
  constructor({ width = 200, min = 0, max = 1, step = 0, value = min, onChange = null, theme: themeOverrides = null, ...options } = {}) {
    super({ name: "slider", ...options, interactive: true, focusable: true });
    this.theme = theme(themeOverrides);
    this.min = finite(min, 0);
    this.max = finite(max, 1);
    if (!(this.max > this.min)) throw new RangeError("Slider max must be greater than min.");
    this.step = Math.max(0, finite(step, 0));
    this.width = Math.max(1, finite(width, 200));
    this.height = 24;
    this.hitArea = { x: 0, y: 0, width: this.width, height: this.height };
    this.onChange = callback(onChange, "Slider onChange");
    this.dragging = false;
    this.graphics = new Graphics({ name: "slider-graphics" });
    this.add(this.graphics);
    this._value = this.clampValue(value);
    this.onPointerDown = (event) => { this.dragging = true; this.setFromWorld(event.worldX, event.worldY); };
    this.onPointerMove = (event) => { if (this.dragging) this.setFromWorld(event.worldX, event.worldY); };
    this.onPointerUp = () => { this.dragging = false; };
    this.onPointerCancel = () => { this.dragging = false; };
    this.onFocus = () => this.redraw();
    this.onBlur = () => this.redraw();
    this.onKeyDown = (event) => {
      const increment = this.step || (this.max - this.min) / 20;
      const keys = { ArrowRight: increment, ArrowUp: increment, ArrowLeft: -increment, ArrowDown: -increment, PageUp: increment * 5, PageDown: -increment * 5 };
      if (event.code in keys) { event.preventDefault?.(); this.setValue(this._value + keys[event.code]); }
      else if (event.code === "Home") { event.preventDefault?.(); this.setValue(this.min); }
      else if (event.code === "End") { event.preventDefault?.(); this.setValue(this.max); }
    };
    this.redraw();
  }

  get value() { return this._value; }
  set value(next) { this.setValue(next); }
  getLocalBounds() { return this.hitArea; }

  clampValue(value) {
    let next = Math.max(this.min, Math.min(this.max, finite(value, this.min)));
    if (this.step > 0) next = Math.min(this.max, this.min + Math.round((next - this.min) / this.step) * this.step);
    return Number(next.toFixed(10));
  }

  setValue(value) {
    const next = this.clampValue(value);
    if (next === this._value) return this;
    this._value = next;
    this.redraw();
    this.onChange?.(next, this);
    return this;
  }

  setFromWorld(worldX, worldY) {
    const local = toLocal(this, worldX, worldY);
    const ratio = Math.max(0, Math.min(1, local.x / this.width));
    return this.setValue(this.min + ratio * (this.max - this.min));
  }

  redraw() {
    const { theme: style } = this;
    const ratio = (this._value - this.min) / (this.max - this.min);
    const middle = this.height / 2;
    this.graphics.clear()
      .roundedRect(0, middle - 3, this.width, 6, 3, { fill: style.track })
      .roundedRect(0, middle - 3, Math.max(6, this.width * ratio), 6, 3, { fill: style.active })
      .circle(this.width * ratio, middle, this.focused ? 10 : 9, { fill: this.focused ? style.accent : 0xe2e8f0 });
    return this;
  }
}

// A clipped, scrollable area. Put children in `view.content`. Clipping needs the
// camera that draws this node (for overlay UI: engine.overlayCamera); content
// children fully outside the viewport are hidden so they are not drawn or picked.
export class ScrollView extends Node {
  constructor({ width = 240, height = 200, camera = null, scrollSpeed = 1, theme: themeOverrides = null, ...options } = {}) {
    super({ name: "scroll-view", ...options, interactive: true });
    this.theme = theme(themeOverrides);
    this.width = Math.max(1, finite(width, 240));
    this.height = Math.max(1, finite(height, 200));
    this.camera = camera;
    this.scrollSpeed = finite(scrollSpeed, 1);
    this.hitArea = { x: 0, y: 0, width: this.width, height: this.height };
    this.scrollY = 0;
    this.content = new Node({ name: "scroll-content" });
    this.scrollbar = new Graphics({ name: "scrollbar", zIndex: 10 });
    this.add(this.content, this.scrollbar);
    this.dragFrom = null;
    this.onWheel = (event) => { this.scrollBy(event.wheelY * this.scrollSpeed); event.preventDefault?.(); };
    this.onPointerDown = (event) => { this.dragFrom = { y: event.worldY, scroll: this.scrollY }; };
    this.onPointerMove = (event) => { if (this.dragFrom) this.scrollTo(this.dragFrom.scroll - (event.worldY - this.dragFrom.y)); };
    this.onPointerUp = () => { this.dragFrom = null; };
    this.onPointerCancel = () => { this.dragFrom = null; };
    this._screenA = { x: 0, y: 0 };
    this._screenB = { x: 0, y: 0 };
  }

  get contentHeight() {
    let bottom = 0;
    for (const child of this.content.children) {
      const bounds = child.getLocalBounds?.();
      const height = bounds ? bounds.y + bounds.height : 0;
      bottom = Math.max(bottom, child.position.y + height * child.scale.y);
    }
    return bottom;
  }

  getLocalBounds() { return this.hitArea; }

  get maxScroll() { return Math.max(0, this.contentHeight - this.height); }

  scrollTo(y) {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, finite(y, 0)));
    this.content.position.y = -this.scrollY;
    return this;
  }

  scrollBy(delta) { return this.scrollTo(this.scrollY + finite(delta, 0)); }

  update(delta, stamp, depth) {
    super.update(delta, stamp, depth);
    this.scrollTo(this.scrollY);
    this.updateWorldMatrix();
    // Hide content that is entirely outside the viewport (also stops picking it).
    const top = this.scrollY; const bottom = this.scrollY + this.height;
    for (const child of this.content.children) {
      const bounds = child.getLocalBounds?.() || { y: 0, height: 0 };
      const childTop = child.position.y + bounds.y * child.scale.y;
      const childBottom = childTop + bounds.height * child.scale.y;
      child.visible = childBottom > top && childTop < bottom;
    }
    if (this.camera) {
      const m = this.worldMatrix;
      this.camera.worldToScreen(m.tx, m.ty, this._screenA);
      this.camera.worldToScreen(m.tx + m.a * this.width + m.c * this.height, m.ty + m.b * this.width + m.d * this.height, this._screenB);
      const x = Math.min(this._screenA.x, this._screenB.x); const y = Math.min(this._screenA.y, this._screenB.y);
      this.setClipRect({ x, y, width: Math.abs(this._screenB.x - this._screenA.x), height: Math.abs(this._screenB.y - this._screenA.y) });
    }
    const max = this.maxScroll;
    this.scrollbar.clear();
    if (max > 0) {
      const barHeight = Math.max(16, (this.height * this.height) / (this.height + max));
      const barY = (this.scrollY / max) * (this.height - barHeight);
      this.scrollbar.roundedRect(this.width - 5, barY, 4, barHeight, 2, { fill: this.theme.accent, alpha: 0.7 });
    }
  }
}

// Single-line text field. Keyboard input arrives through the engine's focus
// system; when a DOM is available a hidden <input> mirrors the value so IME
// composition, paste and mobile virtual keyboards also work.
export class TextInput extends Node {
  constructor({ value = "", placeholder = "", width = 220, height = 40, maxLength = 128, onChange = null, onSubmit = null, domProxy = true, theme: themeOverrides = null, ...options } = {}) {
    super({ name: "text-input", ...options, interactive: true, focusable: true });
    this.theme = theme(themeOverrides);
    this.width = Math.max(1, finite(width, 220));
    this.height = Math.max(1, finite(height, 40));
    this.hitArea = { x: 0, y: 0, width: this.width, height: this.height };
    this.maxLength = Math.max(1, Math.min(MAX_TEXT_INPUT_LENGTH, Math.floor(finite(maxLength, 128))));
    this.placeholder = String(placeholder).slice(0, MAX_TEXT_INPUT_LENGTH);
    this.onChange = callback(onChange, "TextInput onChange");
    this.onSubmit = callback(onSubmit, "TextInput onSubmit");
    this.domProxy = Boolean(domProxy);
    this.proxy = null;
    this._value = "";
    this.caret = 0;
    this.blink = 0;
    this.background = new Graphics({ name: "text-input-background" });
    this.text = new Text({ name: "text-input-text", x: 10, y: this.height / 2, anchorX: 0, anchorY: 0.5, font: this.theme.font, fill: this.theme.text, resolution: 2 });
    this.caretGraphics = new Graphics({ name: "text-input-caret", visible: false });
    this.add(this.background, this.text, this.caretGraphics);
    this.onFocus = () => { this.caret = this._value.length; this.attachProxy(); this.redraw(); };
    this.onBlur = () => { this.detachProxy(); this.redraw(); };
    this.onKeyDown = (event) => this.handleKey(event);
    // Clicking the canvas moves DOM focus away from the proxy; take it back.
    this.onPointerDown = () => { if (this.focused) this.focusProxy(); };
    this.setValue(value, { silent: true });
  }

  get value() { return this._value; }
  set value(next) { this.setValue(next); }
  getLocalBounds() { return this.hitArea; }

  setValue(next, { silent = false } = {}) {
    const value = Array.from(String(next ?? "").replace(/[\r\n]+/g, " ")).slice(0, this.maxLength).join("");
    const changed = value !== this._value;
    this._value = value;
    this.caret = Math.min(this.caret, Array.from(value).length);
    if (this.proxy && this.proxy.value !== value) this.proxy.value = value;
    this.redraw();
    if (changed && !silent) this.onChange?.(value, this);
    return this;
  }

  handleKey(event) {
    const characters = Array.from(this._value);
    const key = event.key;
    if (event.code === "Enter" || event.code === "NumpadEnter") { event.preventDefault?.(); this.onSubmit?.(this._value, this); return; }
    // While the DOM proxy has focus, text editing (typing, IME, paste, deleting)
    // arrives through its input event; otherwise keys are handled here.
    if (this.proxy && globalThis.document?.activeElement === this.proxy) return;
    if (event.code === "Backspace") { if (this.caret > 0) { characters.splice(this.caret - 1, 1); this.caret -= 1; this.setValue(characters.join("")); } event.preventDefault?.(); return; }
    if (event.code === "Delete") { characters.splice(this.caret, 1); this.setValue(characters.join("")); event.preventDefault?.(); return; }
    if (event.code === "ArrowLeft") { this.caret = Math.max(0, this.caret - 1); this.redraw(); return; }
    if (event.code === "ArrowRight") { this.caret = Math.min(characters.length, this.caret + 1); this.redraw(); return; }
    if (event.code === "Home") { this.caret = 0; this.redraw(); return; }
    if (event.code === "End") { this.caret = characters.length; this.redraw(); return; }
    if (typeof key === "string" && Array.from(key).length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && characters.length < this.maxLength) {
      characters.splice(this.caret, 0, key);
      this.caret += 1;
      this.setValue(characters.join(""));
      event.preventDefault?.();
    }
  }

  attachProxy() {
    if (!this.domProxy || this.proxy || typeof document === "undefined" || !document?.createElement || !document.body) return;
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.maxLength = this.maxLength;
    input.value = this._value;
    input.setAttribute("aria-label", this.placeholder || this.name);
    // Kept on screen (but invisible) so mobile browsers open their keyboard; 16px avoids iOS zoom.
    Object.assign(input.style, { position: "fixed", left: "0", bottom: "0", width: "1px", height: "1px", opacity: "0", fontSize: "16px", border: "0", padding: "0" });
    input.addEventListener("input", () => { this.caret = Array.from(input.value).length; this.setValue(input.value); });
    document.body.appendChild(input);
    this.proxy = input;
    this.focusProxy();
  }

  focusProxy() {
    if (!this.proxy) { this.attachProxy(); return; }
    try { this.proxy.focus({ preventScroll: true }); this.proxy.setSelectionRange?.(this.proxy.value.length, this.proxy.value.length); } catch { /* focus is best effort */ }
  }

  detachProxy() {
    const input = this.proxy;
    if (!input) return;
    this.proxy = null;
    input.remove?.();
  }

  update(delta, stamp, depth) {
    super.update(delta, stamp, depth);
    if (!this.focused) return;
    this.blink = (this.blink + finite(delta, 0)) % 1;
    this.caretGraphics.visible = this.blink < 0.5;
  }

  redraw() {
    const { theme: style } = this;
    this.background.clear().roundedRect(0, 0, this.width, this.height, style.radius, { fill: style.background });
    this.background.strokeRect(1, 1, this.width - 2, this.height - 2, this.focused ? 2 : 1, { fill: this.focused ? style.accent : style.hover });
    const empty = this._value.length === 0;
    this.text.setText(empty ? this.placeholder : this._value);
    this.text.setStyle({ fill: empty ? style.muted : style.text });
    const before = Array.from(this._value).slice(0, this.caret).join("");
    const caretX = 10 + (before ? this.measure(before) : 0);
    this.caretGraphics.clear().line(caretX, this.height * 0.25, caretX, this.height * 0.75, 2, { fill: style.accent });
    this.caretGraphics.visible = this.focused;
    return this;
  }

  measure(text) {
    const context = this.text.canvas?.getContext?.("2d");
    if (!context?.measureText) return text.length * 8;
    context.font = this.text.font;
    return context.measureText(text).width;
  }

  destroy() {
    this.detachProxy();
    super.destroy();
  }
}

