import { deserializeScene } from "../core/scene-serializer.js";

// Development hot reload for scene documents. A running game receives a fresh
// Scene whenever the document changes, from either source:
//  - url: the JSON file is polled through an AssetLoader (same-origin and size
//    budgets apply), so saving the file from the editor, a text editor or an AI
//    agent (MCP exi_file_write) updates the game;
//  - channel: a BroadcastChannel name the browser editor posts every committed
//    edit to, for instant updates between tabs without touching files.
// Unchanged documents are ignored; invalid ones go to onError and the running
// scene is kept.

export const EDITOR_CHANNEL = "exi-editor";
const MIN_INTERVAL = 100;
const MAX_INTERVAL = 60_000;

export function watchScene({ url = null, loader = null, channel = null, name = null, interval = 1_000, textures = null, resolveTexture = null, onChange, onError = null } = {}) {
  if (typeof onChange !== "function") throw new TypeError("watchScene onChange must be a function.");
  if (onError !== null && typeof onError !== "function") throw new TypeError("watchScene onError must be a function.");
  if (url === null && channel === null) throw new TypeError("watchScene needs a url, a channel or both.");
  if (url !== null && (typeof url !== "string" || !loader || typeof loader.loadJSON !== "function")) throw new TypeError("watchScene url needs an AssetLoader (loader).");
  if (!Number.isFinite(interval) || interval < MIN_INTERVAL || interval > MAX_INTERVAL) throw new RangeError(`watchScene interval must be between ${MIN_INTERVAL} and ${MAX_INTERVAL} ms.`);
  let stopped = false;
  let lastJSON = null;
  let timer = null;
  let inFlight = false;
  let polls = 0;
  let broadcast = null;
  const state = { reloads: 0, errors: 0 };

  const apply = (document, source) => {
    const json = JSON.stringify(document);
    if (json === lastJSON) return false;
    const report = {};
    let scene;
    try {
      scene = deserializeScene(document, { textures, resolveTexture, report });
    } catch (error) {
      state.errors += 1;
      onError?.(error, source);
      return false;
    }
    lastJSON = json;
    state.reloads += 1;
    onChange(scene, document, { ...report, source });
    return true;
  };

  const poll = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    polls += 1;
    try {
      // A unique query string defeats HTTP caches without changing the origin.
      const separator = url.includes("?") ? "&" : "?";
      const document = await loader.loadJSON(`${url}${separator}exi-watch=${polls}`);
      if (!stopped) apply(document, "url");
    } catch (error) {
      if (!stopped) { state.errors += 1; onError?.(error, "url"); }
    } finally {
      inFlight = false;
    }
  };

  if (channel !== null) {
    if (typeof channel !== "string" || !channel || channel.length > 128) throw new TypeError("watchScene channel must be a short string.");
    if (typeof BroadcastChannel !== "function") throw new Error("watchScene channel requires BroadcastChannel.");
    broadcast = new BroadcastChannel(channel);
    broadcast.onmessage = (event) => {
      const message = event?.data;
      if (stopped || !message || typeof message !== "object" || message.type !== "exi-scene") return;
      if (name !== null && message.name !== name) return;
      apply(message.document, "channel");
    };
  }
  if (url !== null) {
    void poll();
    timer = setInterval(() => { void poll(); }, interval);
  }

  return {
    get reloads() { return state.reloads; },
    get errors() { return state.errors; },
    get stopped() { return stopped; },
    // Feeds a document directly (e.g. the first load from somewhere else).
    apply: (document) => apply(document, "manual"),
    poll,
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearInterval(timer);
      broadcast?.close?.();
      broadcast = null;
    },
  };
}
