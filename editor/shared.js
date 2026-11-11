// Pieces shared by the editor and its live Play window.
import { EDITOR_CHANNEL, Texture } from "../src/index.js";

export const AUTOSAVE_KEY = "exi-editor:autosave";
export const BUILTIN_TILES_ID = "editor:tiles";
export { EDITOR_CHANNEL };

export function createBuiltinTiles() {
  const tile = 32;
  const colors = ["#4d7c0f", "#78350f", "#9a3412", "#1e3a8a", "#0e7490", "#6b21a8", "#a16207", "#334155"];
  const source = document.createElement("canvas");
  source.width = tile * colors.length;
  source.height = tile;
  const context = source.getContext("2d");
  colors.forEach((color, index) => {
    context.fillStyle = color; context.fillRect(index * tile, 0, tile, tile);
    context.fillStyle = "rgba(255,255,255,0.18)"; context.fillRect(index * tile, 0, tile, 4);
    context.fillStyle = "rgba(0,0,0,0.25)"; context.fillRect(index * tile, tile - 3, tile, 3);
    context.fillStyle = "rgba(255,255,255,0.85)"; context.font = "bold 12px system-ui, sans-serif"; context.fillText(String(index), index * tile + 4, 18);
  });
  return new Texture({ id: BUILTIN_TILES_ID, source, filter: "nearest" });
}
