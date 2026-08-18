const MAX_ACTIONS = 256;
const MAX_ACTION_BINDINGS = 8;
const MAX_ACTION_NAME_LENGTH = 64;
const MAX_KEY_CODE_LENGTH = 64;
const MAX_KEYS = 256;
const MAX_POINTERS = 32;
const MAX_GAMEPAD_INDEX = 15;
const MAX_GAMEPAD_AXES = 32;
const MAX_GAMEPAD_BUTTONS = 64;
const MAX_GAMEPAD_ID_LENGTH = 128;
const MAX_INJECT_EVENTS = 128;
const MAX_INJECT_COORDINATE = 10_000_000;

function pointerIdOf(event) { return Number.isSafeInteger(event?.pointerId) ? event.pointerId : 0; }

function normalizeActionName(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_ACTION_NAME_LENGTH) {
    throw new TypeError(`Input action name must be 1-${MAX_ACTION_NAME_LENGTH} characters.`);
  }
  return name;
}

function normalizeActionIndex(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(`${label} is out of range.`);
  return value;
}

function normalizeKeyCode(code) {
  if (typeof code !== "string" || code.length === 0 || code.length > MAX_KEY_CODE_LENGTH) {
    throw new TypeError(`Keyboard code must be 1-${MAX_KEY_CODE_LENGTH} characters.`);
  }
  return code;
}

function normalizeAxisScale(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-1, Math.min(1, number)) : 1;
}

function normalizeDeadzone(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(0.99, number)) : 0.15;
}

function normalizeRumbleDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10_000, number)) : 100;
}

function normalizeRumbleMagnitude(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}

function normalizeInjectionOptions(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Input injection options nesne olmalı.");
  return value;
}

function normalizeInjectionKey(code, options = {}) {
  const normalizedCode = normalizeKeyCode(code);
  const key = options.key === undefined ? normalizedCode : options.key;
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_CODE_LENGTH) throw new TypeError("Injected keyboard key 1-64 karakter olmalı.");
  for (const property of ["repeat", "shiftKey", "ctrlKey", "altKey", "metaKey"]) {
    if (options[property] !== undefined && typeof options[property] !== "boolean") throw new TypeError(`Injected keyboard ${property} boolean olmalı.`);
  }
  return { type: "keydown", code: normalizedCode, key, repeat: options.repeat === true, shiftKey: options.shiftKey === true, ctrlKey: options.ctrlKey === true, altKey: options.altKey === true, metaKey: options.metaKey === true };
}

function normalizeInjectionPointer(type, options = {}) {
  if (!["pointermove", "pointerdown", "pointerup", "pointercancel", "wheel"].includes(type)) throw new TypeError("Injected pointer event type geçersiz.");
  const readNumber = (property, fallback, limit = MAX_INJECT_COORDINATE) => {
    const value = options[property] === undefined ? fallback : options[property];
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) throw new RangeError(`Injected pointer ${property} sınırında olmalı.`);
    return value;
  };
  const pointerId = options.pointerId === undefined ? 0 : options.pointerId;
  if (!Number.isSafeInteger(pointerId) || pointerId < 0 || pointerId > 0x7fffffff) throw new RangeError("Injected pointerId sınırında olmalı.");
  const button = options.button === undefined ? 0 : options.button;
  if (!Number.isSafeInteger(button) || button < -1 || button > 30) throw new RangeError("Injected pointer button sınırında olmalı.");
  const pointerType = options.pointerType === undefined ? "mouse" : options.pointerType;
  if (typeof pointerType !== "string" || pointerType.length === 0 || pointerType.length > 32) throw new TypeError("Injected pointerType geçersiz.");
  return { type, clientX: readNumber("x", 0), clientY: readNumber("y", 0), pointerId, pointerType, button, deltaX: readNumber("deltaX", 0), deltaY: readNumber("deltaY", 0) };
}

function normalizeInjectionEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("Input injection event nesne olmalı.");
  const options = normalizeInjectionOptions(event);
  if (event.type === "keydown") return normalizeInjectionKey(event.code, options);
  if (event.type === "keyup") return { type: "keyup", code: normalizeKeyCode(event.code) };
  return normalizeInjectionPointer(event.type, options);
}

function normalizeActionBinding(binding) {
  if (typeof binding === "string") binding = { type: "key", code: binding };
  if (!binding || typeof binding !== "object") throw new TypeError("Invalid input action binding.");
  if (binding.type === "key") {
    return { type: "key", code: normalizeKeyCode(binding.code) };
  }
  if (binding.type === "pointer") return { type: "pointer", button: normalizeActionIndex(binding.button, 30, "Pointer button") };
  if (binding.type === "gamepad") return {
    type: "gamepad",
    index: normalizeActionIndex(binding.index ?? 0, 15, "Gamepad index"),
    button: normalizeActionIndex(binding.button, 31, "Gamepad button"),
  };
  throw new TypeError("Input action binding type must be key, pointer, or gamepad.");
}

function normalizeAxisBinding(binding) {
  if (!binding || typeof binding !== "object") throw new TypeError("Invalid input axis binding.");
  if (binding.type === "key-axis") return {
    type: "key-axis",
    positive: normalizeKeyCode(binding.positive),
    negative: normalizeKeyCode(binding.negative),
    scale: normalizeAxisScale(binding.scale),
  };
  if (binding.type === "gamepad-axis") return {
    type: "gamepad-axis",
    index: normalizeActionIndex(binding.index ?? 0, MAX_GAMEPAD_INDEX, "Gamepad index"),
    axis: normalizeActionIndex(binding.axis, MAX_GAMEPAD_AXES - 1, "Gamepad axis"),
    deadzone: normalizeDeadzone(binding.deadzone),
    scale: normalizeAxisScale(binding.scale),
  };
  throw new TypeError("Input axis binding type must be key-axis or gamepad-axis.");
}

function normalizeBindingMap(source, normalizer, label) {
  if (source === null || source === undefined) return new Map();
  if (!source || typeof source !== "object" || Array.isArray(source)) throw new TypeError(`Input ${label} map nesne olmalı.`);
  const result = new Map();
  for (const name of Object.keys(source)) {
    const normalizedName = normalizeActionName(name);
    const bindings = Array.isArray(source[name]) ? source[name] : [source[name]];
    if (bindings.length === 0 || bindings.length > MAX_ACTION_BINDINGS) throw new RangeError(`Bir ${label} en fazla ${MAX_ACTION_BINDINGS} binding alabilir.`);
    const normalized = new Array(bindings.length);
    for (let index = 0; index < bindings.length; index += 1) normalized[index] = normalizer(bindings[index]);
    result.set(normalizedName, normalized);
  }
  return result;
}

function assertBindingList(bindings, label) {
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > MAX_ACTION_BINDINGS) throw new RangeError(`Bir ${label} en fazla ${MAX_ACTION_BINDINGS} binding alabilir.`);
}

function copyBindingMap(source, label) {
  const result = Object.create(null);
  for (const [name, bindings] of source) { assertBindingList(bindings, label); result[name] = bindings.map((binding) => ({ ...binding })); }
  return result;
}

function assertBindingCollections(actions, axes) {
  if (!(actions instanceof Map) || !(axes instanceof Map) || actions.size + axes.size > MAX_ACTIONS) throw new RangeError(`En fazla ${MAX_ACTIONS} Input action/axis desteklenir.`);
}

function assertInputCollections(input) {
  if (!(input.keys instanceof Set) || !(input.pressedKeys instanceof Set) || !(input.releasedKeys instanceof Set) || input.keys.size > MAX_KEYS || input.pressedKeys.size > MAX_KEYS || input.releasedKeys.size > MAX_KEYS) throw new RangeError(`Input keyboard state limiti ${MAX_KEYS}.`);
  if (!(input.pointers instanceof Map) || input.pointers.size > MAX_POINTERS) throw new RangeError(`Input pointer limiti ${MAX_POINTERS}.`);
  if (!(input.gamepads instanceof Map) || input.gamepads.size > MAX_GAMEPAD_INDEX + 1) throw new RangeError(`Input gamepad limiti ${MAX_GAMEPAD_INDEX + 1}.`);
  for (const [index, state] of input.gamepads) {
    if (!Number.isSafeInteger(index) || index < 0 || index > MAX_GAMEPAD_INDEX) throw new RangeError(`Input gamepad index limiti ${MAX_GAMEPAD_INDEX}.`);
    if (!state || !Array.isArray(state.axes) || !Array.isArray(state.buttons) || !Array.isArray(state.pressed) || !Array.isArray(state.released) || state.axes.length > MAX_GAMEPAD_AXES || state.buttons.length > MAX_GAMEPAD_BUTTONS || state.pressed.length > MAX_GAMEPAD_BUTTONS || state.released.length > MAX_GAMEPAD_BUTTONS) throw new RangeError("Input gamepad snapshot limiti aşıldı.");
  }
  assertBindingCollections(input.actions, input.axes);
}

export class Input {
  constructor(canvas, { actions = null, axes = null, onKeyDown = null, onGamepadConnected = null, onGamepadDisconnected = null } = {}) {
    this.canvas = canvas;
    if ([onKeyDown, onGamepadConnected, onGamepadDisconnected].some((callback) => callback !== null && typeof callback !== "function")) throw new TypeError("Input callback fonksiyonu gerekli.");
    this.onKeyDown = onKeyDown;
    this.onGamepadConnected = onGamepadConnected;
    this.onGamepadDisconnected = onGamepadDisconnected;
    this.eventTarget = globalThis.window || globalThis;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.releasedKeys = new Set();
    this.gamepads = new Map();
    this.connectedGamepadIndices = new Set();
    this.actions = new Map();
    this.axes = new Map();
    this.pointer = { pointerId: null, type: "mouse", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: false, wheelX: 0, wheelY: 0, button: 0 };
    this.pointerWorld = { x: 0, y: 0 };
    this.pointers = new Map();
    this.activePointerId = null;
    this.destroyed = false;
    this.handleKeyDown = (event) => {
      if (this.destroyed) return;
      const code = typeof event?.code === "string" && event.code.length > 0 && event.code.length <= MAX_KEY_CODE_LENGTH ? event.code : null;
      if (!code || (!this.keys.has(code) && this.keys.size >= MAX_KEYS)) return;
      if (!this.keys.has(code)) this.pressedKeys.add(code);
      this.keys.add(code);
      this.onKeyDown?.(event);
    };
    this.handleKeyUp = (event) => {
      if (this.destroyed) return;
      const code = typeof event?.code === "string" && event.code.length > 0 && event.code.length <= MAX_KEY_CODE_LENGTH ? event.code : null;
      if (!code || !this.keys.has(code)) return;
      this.keys.delete(code);
      this.releasedKeys.add(code);
    };
    this.pointerButtonMask = (button) => Number.isInteger(button) && button >= 0 && button < 31 ? 1 << button : 0;
    this.pointerEventButton = (button, fallback) => Number.isSafeInteger(button) && button >= -1 && button <= 30 ? button : fallback;
    this.updatePointerState = (state, event) => {
      const bounds = this.canvas.getBoundingClientRect();
      const left = Number(bounds.left); const top = Number(bounds.top);
      const width = Number(bounds.width); const height = Number(bounds.height);
      const scaleX = this.canvas.width / (Number.isFinite(width) ? Math.max(1, width) : 1);
      const scaleY = this.canvas.height / (Number.isFinite(height) ? Math.max(1, height) : 1);
      const x = (Number(event.clientX) - (Number.isFinite(left) ? left : 0)) * scaleX;
      const y = (Number(event.clientY) - (Number.isFinite(top) ? top : 0)) * scaleY;
      state.x = Number.isFinite(x) ? x : 0;
      state.y = Number.isFinite(y) ? y : 0;
    };
    this.updatePointer = (event) => this.updatePointerState(this.pointer, event);
    this.pointerStateFor = (event) => {
      const id = pointerIdOf(event);
      let state = this.pointers.get(id);
      if (state) return state;
      if (this.pointers.size >= MAX_POINTERS) return null;
      let canPromote = this.activePointerId === null;
      if (canPromote) for (const value of this.pointers.values()) {
        if (value.buttons !== 0) { canPromote = false; break; }
      }
      if (canPromote) {
        this.pointers.clear();
        this.pointer.pointerId = id;
        this.pointer.type = event.pointerType || "mouse";
        this.pointer.buttons = 0;
        this.pointer.pressed = 0;
        this.pointer.released = 0;
        this.pointer.cancelled = 0;
        this.pointer.moved = false;
        this.pointer.wheelX = 0;
        this.pointer.wheelY = 0;
        this.pointer.button = 0;
        state = this.pointer;
        this.activePointerId = id;
      } else {
        state = { pointerId: id, type: event.pointerType || "unknown", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: false, wheelX: 0, wheelY: 0, button: 0 };
      }
      this.pointers.set(id, state);
      return state;
    };
    this.handlePointerMove = (event) => {
      if (this.destroyed) return;
      const id = pointerIdOf(event);
      let state = this.pointers.get(id);
      if (!state) {
        if (this.pointers.size >= MAX_POINTERS) return;
        const usePrimaryState = this.activePointerId === null && this.pointers.size === 0;
        if (usePrimaryState) {
          this.pointer.pointerId = id;
          this.pointer.type = event.pointerType || "mouse";
          state = this.pointer;
        } else {
          state = { pointerId: id, type: event.pointerType || "unknown", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: false, wheelX: 0, wheelY: 0, button: 0 };
        }
        this.pointers.set(id, state);
      }
      this.updatePointerState(state, event);
      state.button = this.pointerEventButton(event.button, -1);
      state.moved = true;
    };
    this.handlePointerDown = (event) => {
      if (this.destroyed) return;
      const state = this.pointerStateFor(event);
      if (!state) return;
      this.updatePointerState(state, event);
      const mask = this.pointerButtonMask(event.button);
      state.button = this.pointerEventButton(event.button, 0);
      state.buttons |= mask;
      state.pressed |= mask;
      if (this.activePointerId === null && state === this.pointer) this.activePointerId = state.pointerId;
      try { this.canvas.setPointerCapture?.(state.pointerId); } catch {}
    };
    this.handlePointerUp = (event) => {
      if (this.destroyed) return;
      const state = this.pointers.get(pointerIdOf(event));
      if (!state) return;
      this.updatePointerState(state, event);
      const mask = this.pointerButtonMask(event.button);
      state.button = this.pointerEventButton(event.button, 0);
      state.buttons &= ~mask;
      state.released |= mask;
      try { this.canvas.releasePointerCapture?.(state.pointerId); } catch {}
      if (this.activePointerId === state.pointerId && state.buttons === 0) this.activePointerId = null;
    };
    this.handlePointerCancel = (event) => {
      if (this.destroyed) return;
      const state = this.pointers.get(pointerIdOf(event));
      if (!state) return;
      state.button = this.pointerEventButton(event.button, -1);
      state.cancelled |= state.buttons;
      state.released |= state.buttons;
      state.buttons = 0;
      try { this.canvas.releasePointerCapture?.(state.pointerId); } catch {}
      if (this.activePointerId === state.pointerId) this.activePointerId = null;
    };
    this.handleWheel = (event) => {
      if (this.destroyed) return;
      const id = this.activePointerId ?? this.pointer.pointerId ?? 0;
      let state = this.pointers.get(id);
      if (!state) {
        if (this.pointers.size >= MAX_POINTERS) return;
        if (this.activePointerId === null && this.pointers.size === 0) {
          this.pointer.pointerId = id;
          state = this.pointer;
        } else {
          state = { pointerId: id, type: event.pointerType || "mouse", x: 0, y: 0, buttons: 0, pressed: 0, released: 0, cancelled: 0, moved: false, wheelX: 0, wheelY: 0, button: 0 };
        }
        this.pointers.set(id, state);
      }
      this.updatePointerState(state, event);
      state.button = -1;
      state.wheelX += Number.isFinite(event.deltaX) ? event.deltaX : 0;
      state.wheelY += Number.isFinite(event.deltaY) ? event.deltaY : 0;
    };
    this.clearTransientState = () => {
      if (!(this.keys instanceof Set) || !(this.pressedKeys instanceof Set) || !(this.releasedKeys instanceof Set)) throw new TypeError("Input keyboard state koleksiyonu geçersiz.");
      if (this.keys.size > MAX_KEYS || this.pressedKeys.size > MAX_KEYS || this.releasedKeys.size > MAX_KEYS) {
        this.keys.clear();
        this.pressedKeys.clear();
        this.releasedKeys.clear();
      }
      assertInputCollections(this);
      for (const code of this.keys) this.releasedKeys.add(code);
      this.keys.clear();
      for (const state of this.pointers.values()) {
        state.pressed = 0;
        state.released |= state.buttons;
        state.cancelled |= state.buttons;
        state.moved = false;
        state.buttons = 0;
        state.wheelX = 0;
        state.wheelY = 0;
        state.button = 0;
        try { this.canvas.releasePointerCapture?.(state.pointerId); } catch {}
      }
      this.activePointerId = null;
      this.pointers.clear();
      this.pointer.pointerId = null;
      for (const state of this.gamepads.values()) {
        state.pressed.fill(false);
        for (let button = 0; button < state.buttons.length; button += 1) {
          const wasDown = state.buttons[button] === true;
          state.buttons[button] = false;
          state.released[button] = wasDown;
        }
      }
    };
    this.eventTarget.addEventListener?.("keydown", this.handleKeyDown, { passive: true });
    this.eventTarget.addEventListener?.("keyup", this.handleKeyUp, { passive: true });
    this.eventTarget.addEventListener?.("blur", this.clearTransientState, { passive: true });
    this.eventTarget.addEventListener?.("pagehide", this.clearTransientState, { passive: true });
    canvas.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    canvas.addEventListener("pointerdown", this.handlePointerDown, { passive: true });
    canvas.addEventListener("pointercancel", this.handlePointerCancel, { passive: true });
    canvas.addEventListener("lostpointercapture", this.handlePointerCancel, { passive: true });
    canvas.addEventListener("wheel", this.handleWheel, { passive: true });
    this.eventTarget.addEventListener?.("pointerup", this.handlePointerUp, { passive: true });
    if (globalThis.document?.addEventListener) globalThis.document.addEventListener("visibilitychange", this.clearTransientState, { passive: true });
    if (actions !== null && (typeof actions !== "object" || Array.isArray(actions))) throw new TypeError("Input actions must be an object.");
    if (axes !== null && (typeof axes !== "object" || Array.isArray(axes))) throw new TypeError("Input axes must be an object.");
    if (actions) for (const name of Object.keys(actions)) this.bindAction(name, actions[name]);
    if (axes) for (const name of Object.keys(axes)) this.bindAxis(name, axes[name]);
  }

  injectKeyDown(code, options = {}) {
    const event = normalizeInjectionKey(code, normalizeInjectionOptions(options));
    this.handleKeyDown({ ...event, preventDefault() {} });
    return this;
  }

  injectKeyUp(code) {
    this.handleKeyUp({ code: normalizeKeyCode(code) });
    return this;
  }

  injectPointer(type, options = {}) {
    const event = normalizeInjectionPointer(type, normalizeInjectionOptions(options));
    if (type === "pointermove") this.handlePointerMove(event);
    else if (type === "pointerdown") this.handlePointerDown(event);
    else if (type === "pointerup") this.handlePointerUp(event);
    else if (type === "pointercancel") this.handlePointerCancel(event);
    else this.handleWheel(event);
    return this;
  }

  inject(events) {
    if (!Array.isArray(events) || events.length > MAX_INJECT_EVENTS) throw new RangeError(`Input injection en fazla ${MAX_INJECT_EVENTS} event alabilir.`);
    const normalized = events.map(normalizeInjectionEvent);
    for (const event of normalized) {
      if (event.type === "keydown") this.injectKeyDown(event.code, event);
      else if (event.type === "keyup") this.injectKeyUp(event.code);
      else this.injectPointer(event.type, { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType, button: event.button, deltaX: event.deltaX, deltaY: event.deltaY });
    }
    return this;
  }

  bindAction(name, bindings) {
    const actionName = normalizeActionName(name);
    if (this.axes.has(actionName)) throw new Error(`Input action/axis adı zaten kullanılıyor: ${actionName}`);
    if (!this.actions.has(actionName) && this.actions.size + this.axes.size >= MAX_ACTIONS) throw new RangeError(`En fazla ${MAX_ACTIONS} Input action/axis desteklenir.`);
    const source = Array.isArray(bindings) ? bindings : [bindings];
    if (source.length === 0 || source.length > MAX_ACTION_BINDINGS) throw new RangeError(`Bir action en fazla ${MAX_ACTION_BINDINGS} binding alabilir.`);
    const normalized = new Array(source.length);
    for (let index = 0; index < source.length; index += 1) normalized[index] = normalizeActionBinding(source[index]);
    this.actions.set(actionName, normalized);
    return this;
  }

  unbindAction(name) { return this.actions.delete(String(name)); }
  bindAxis(name, bindings) {
    const axisName = normalizeActionName(name);
    if (this.actions.has(axisName)) throw new Error(`Input action/axis adı zaten kullanılıyor: ${axisName}`);
    if (!this.axes.has(axisName) && this.actions.size + this.axes.size >= MAX_ACTIONS) throw new RangeError(`En fazla ${MAX_ACTIONS} Input action/axis desteklenir.`);
    const source = Array.isArray(bindings) ? bindings : [bindings];
    if (source.length === 0 || source.length > MAX_ACTION_BINDINGS) throw new RangeError(`Bir axis en fazla ${MAX_ACTION_BINDINGS} binding alabilir.`);
    const normalized = new Array(source.length);
    for (let index = 0; index < source.length; index += 1) normalized[index] = normalizeAxisBinding(source[index]);
    this.axes.set(axisName, normalized);
    return this;
  }

  unbindAxis(name) { return this.axes.delete(String(name)); }

  getBindings() {
    assertBindingCollections(this.actions, this.axes);
    return { actions: copyBindingMap(this.actions, "action"), axes: copyBindingMap(this.axes, "axis") };
  }

  setBindings({ actions = null, axes = null } = {}) {
    const nextActions = normalizeBindingMap(actions, normalizeActionBinding, "action");
    const nextAxes = normalizeBindingMap(axes, normalizeAxisBinding, "axis");
    for (const name of nextActions.keys()) if (nextAxes.has(name)) throw new Error(`Input action/axis adı zaten kullanılıyor: ${name}`);
    if (nextActions.size + nextAxes.size > MAX_ACTIONS) throw new RangeError(`En fazla ${MAX_ACTIONS} Input action/axis desteklenir.`);
    this.actions.clear();
    this.axes.clear();
    for (const [name, bindings] of nextActions) this.actions.set(name, bindings);
    for (const [name, bindings] of nextAxes) this.axes.set(name, bindings);
    return this;
  }

  getAxis(name) {
    assertBindingCollections(this.actions, this.axes);
    const bindings = this.axes.get(String(name));
    if (!bindings) return 0;
    assertBindingList(bindings, "axis");
    let value = 0;
    for (const binding of bindings) {
      if (binding.type === "key-axis") value += ((this.keys.has(binding.positive) ? 1 : 0) - (this.keys.has(binding.negative) ? 1 : 0)) * binding.scale;
      else {
        const raw = Number(this.gamepads.get(binding.index)?.axes[binding.axis] ?? 0);
        const clamped = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
        const magnitude = Math.abs(clamped);
        const normalized = magnitude <= binding.deadzone ? 0 : Math.sign(clamped) * (magnitude - binding.deadzone) / (1 - binding.deadzone);
        value += normalized * binding.scale;
      }
    }
    return Math.max(-1, Math.min(1, value));
  }

  getActionAxis(name) { return this.getAxis(name); }

  getVector(xAxisName, yAxisName, out = { x: 0, y: 0 }, normalize = true) {
    const x = this.getAxis(xAxisName);
    const y = this.getAxis(yAxisName);
    if (normalize) {
      const length = Math.hypot(x, y);
      if (length > 1) {
        out.x = x / length;
        out.y = y / length;
        return out;
      }
    }
    out.x = x;
    out.y = y;
    return out;
  }

  actionState(name, phase) {
    assertBindingCollections(this.actions, this.axes);
    const bindings = this.actions.get(String(name));
    if (!bindings) return false;
    assertBindingList(bindings, "action");
    for (const binding of bindings) {
      if (binding.type === "key") {
        if (phase === "down" ? this.keys.has(binding.code) : phase === "pressed" ? this.pressedKeys.has(binding.code) : this.releasedKeys.has(binding.code)) return true;
      } else if (binding.type === "pointer") {
        const mask = 1 << binding.button;
        if (phase === "down" ? (this.pointer.buttons & mask) !== 0 : phase === "pressed" ? (this.pointer.pressed & mask) !== 0 : (this.pointer.released & mask) !== 0) return true;
      } else {
        const state = this.gamepads.get(binding.index);
        if (phase === "down" ? Boolean(state?.buttons[binding.button]) : phase === "pressed" ? Boolean(state?.pressed[binding.button]) : Boolean(state?.released[binding.button])) return true;
      }
    }
    return false;
  }
  isActionDown(name) { return this.actionState(name, "down"); }
  wasActionPressed(name) { return this.actionState(name, "pressed"); }
  wasActionReleased(name) { return this.actionState(name, "released"); }
  getPointer(pointerId) { return this.pointers.get(pointerId) || null; }
  getPointers() { assertInputCollections(this); return this.pointers; }
  getPointerWorld(camera, out = this.pointerWorld, pointerId = this.activePointerId) {
    if (!camera || typeof camera.screenToWorld !== "function") throw new TypeError("Input world pointer için Camera gerekli.");
    const state = pointerId === null || pointerId === undefined ? this.pointer : (this.pointers.get(pointerId) || this.pointer);
    return camera.screenToWorld(state.x, state.y, out);
  }
  isKeyDown(code) { return this.keys.has(code); }
  wasKeyPressed(code) { return this.pressedKeys.has(code); }
  wasKeyReleased(code) { return this.releasedKeys.has(code); }
  isPointerDown(button = 0) { return (this.pointer.buttons & (1 << button)) !== 0; }
  wasPointerPressed(button = 0) { return (this.pointer.pressed & (1 << button)) !== 0; }
  wasPointerReleased(button = 0) { return (this.pointer.released & (1 << button)) !== 0; }
  wasPointerCancelled(button = 0) { return (this.pointer.cancelled & (1 << button)) !== 0; }
  wasPointerMoved() { return this.pointer.moved === true; }
  updateGamepads() {
    if (this.destroyed) return;
    assertInputCollections(this);
    const pads = globalThis.navigator?.getGamepads?.() || [];
    const connected = this.connectedGamepadIndices;
    connected.clear();
    for (const pad of pads) {
      if (!pad) continue;
      if (!Number.isSafeInteger(pad.index) || pad.index < 0 || pad.index > MAX_GAMEPAD_INDEX) continue;
      connected.add(pad.index);
      let state = this.gamepads.get(pad.index);
      const wasConnected = state?.connected === true;
      if (!state) {
        state = { index: pad.index, id: "", connected: true, axes: [], buttons: [], pressed: [], released: [] };
        this.gamepads.set(pad.index, state);
      }
      state.id = String(pad.id || "").slice(0, MAX_GAMEPAD_ID_LENGTH);
      state.connected = true;
      const axes = pad.axes || [];
      const axisCount = Number.isSafeInteger(axes.length) ? Math.min(MAX_GAMEPAD_AXES, Math.max(0, axes.length)) : 0;
      state.axes.length = axisCount;
      for (let index = 0; index < axisCount; index += 1) {
        const value = Number(axes[index]);
        state.axes[index] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      }
      const buttons = pad.buttons || [];
      const buttonCount = Number.isSafeInteger(buttons.length) ? Math.min(MAX_GAMEPAD_BUTTONS, Math.max(0, buttons.length)) : 0;
      state.buttons.length = buttonCount;
      state.pressed.length = buttonCount;
      state.released.length = buttonCount;
      for (let index = 0; index < buttonCount; index += 1) {
        const previous = Boolean(state.buttons[index]);
        const current = Boolean(buttons[index]?.pressed);
        state.buttons[index] = current;
        state.pressed[index] = current && !previous;
        state.released[index] = !current && previous;
      }
      if (!wasConnected) this.onGamepadConnected?.(state);
    }
    for (const [index, state] of this.gamepads) {
      if (connected.has(index)) continue;
      if (!state.connected) { this.gamepads.delete(index); continue; }
      state.connected = false;
      state.pressed.fill(false);
      for (let button = 0; button < state.buttons.length; button += 1) {
        const wasDown = state.buttons[button] === true;
        state.buttons[button] = false;
        state.released[button] = wasDown;
      }
      this.onGamepadDisconnected?.(state);
    }
  }
  getGamepad(index = 0) { assertInputCollections(this); return this.gamepads.get(index) || null; }
  isGamepadButtonDown(index, button) { return Boolean(this.gamepads.get(index)?.buttons[button]); }
  wasGamepadButtonPressed(index, button) { return Boolean(this.gamepads.get(index)?.pressed[button]); }
  wasGamepadButtonReleased(index, button) { return Boolean(this.gamepads.get(index)?.released[button]); }
  getGamepadAxis(index, axis) { return this.gamepads.get(index)?.axes[axis] ?? 0; }
  async rumbleGamepad(index = 0, { duration = 100, strongMagnitude = 1, weakMagnitude = 1 } = {}) {
    if (this.destroyed) return false;
    const gamepadIndex = normalizeActionIndex(index, MAX_GAMEPAD_INDEX, "Gamepad index");
    const pads = globalThis.navigator?.getGamepads?.();
    const gamepad = pads?.[gamepadIndex];
    if (!gamepad) return false;
    const actuator = gamepad.vibrationActuator || gamepad.hapticActuators?.[0] || null;
    if (!actuator) return false;
    const effect = {
      duration: normalizeRumbleDuration(duration),
      strongMagnitude: normalizeRumbleMagnitude(strongMagnitude),
      weakMagnitude: normalizeRumbleMagnitude(weakMagnitude),
    };
    if (typeof actuator.playEffect === "function") {
      try {
        const result = await actuator.playEffect("dual-rumble", effect);
        return result === undefined || result === true || result === "complete";
      } catch {}
    }
    if (typeof actuator.pulse === "function") {
      try { return (await actuator.pulse(Math.max(effect.strongMagnitude, effect.weakMagnitude), effect.duration)) !== false; } catch {}
    }
    return false;
  }
  beginFrame() { this.updateGamepads(); }
  endFrame() {
    assertInputCollections(this);
    this.pressedKeys.clear();
    this.releasedKeys.clear();
    for (const state of this.gamepads.values()) {
      state.pressed.fill(false);
      state.released.fill(false);
    }
    for (const [id, state] of this.pointers) {
      state.pressed = 0;
      state.released = 0;
      state.cancelled = 0;
      state.moved = false;
      state.wheelX = 0;
      state.wheelY = 0;
      state.button = 0;
      if (state.buttons === 0 && id !== this.activePointerId) this.pointers.delete(id);
    }
    this.pointer.pressed = 0;
    this.pointer.released = 0;
    this.pointer.cancelled = 0;
    this.pointer.moved = false;
    this.pointer.wheelX = 0;
    this.pointer.wheelY = 0;
    this.pointer.button = 0;
    this.pointer.pointerId = this.activePointerId;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.eventTarget.removeEventListener?.("keydown", this.handleKeyDown);
    this.eventTarget.removeEventListener?.("keyup", this.handleKeyUp);
    this.eventTarget.removeEventListener?.("blur", this.clearTransientState);
    this.eventTarget.removeEventListener?.("pagehide", this.clearTransientState);
    this.canvas.removeEventListener?.("pointermove", this.handlePointerMove);
    this.canvas.removeEventListener?.("pointerdown", this.handlePointerDown);
    this.canvas.removeEventListener?.("pointercancel", this.handlePointerCancel);
    this.canvas.removeEventListener?.("lostpointercapture", this.handlePointerCancel);
    this.canvas.removeEventListener?.("wheel", this.handleWheel);
    this.eventTarget.removeEventListener?.("pointerup", this.handlePointerUp);
    globalThis.document?.removeEventListener?.("visibilitychange", this.clearTransientState);
    this.clearTransientState();
    this.pointers.clear();
    this.gamepads.clear();
    this.connectedGamepadIndices.clear();
    this.actions.clear();
    this.axes.clear();
  }
}
