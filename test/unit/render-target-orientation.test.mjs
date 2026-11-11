// ExiEngine unit test — WebGL2 samples render targets with V flipped so RenderGroup,
// RenderTexture sprites and render-target masks have the same orientation as WebGPU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RenderTexture, Texture, TextureAtlas } from "../../src/index.js";
import { isRenderTargetTexture } from "../../src/render/webgl2-renderer.js";

test("render targets: textures rendered to are flagged for V flip, uploaded textures are not", () => {
  const target = new RenderTexture({ width: 32, height: 16 });
  assert.equal(isRenderTargetTexture(target), 1);
  assert.equal(isRenderTargetTexture({ baseTexture: target }), 1, "frames of a render target too");
  const plain = new Texture({ sourceWidth: 8, sourceHeight: 8 });
  assert.equal(isRenderTargetTexture(plain), 0);
  assert.equal(isRenderTargetTexture(TextureAtlas.fromGrid(plain, { frameWidth: 4, frameHeight: 4, columns: 2, rows: 2 }).get("0")), 0);
  assert.equal(isRenderTargetTexture(null), 0);
  target.destroy();
});

test("render targets: the WebGL2 fragment shader applies the flip to texture and mask sampling", () => {
  const source = readFileSync(new URL("../../src/render/webgl2-renderer.js", import.meta.url), "utf8");
  assert.match(source, /vec2 uv = u_filter\.z > 0\.5 \? vec2\(v_uv\.x, 1\.0 - v_uv\.y\) : v_uv;/);
  assert.match(source, /if \(u_filter\.w > 0\.5\) maskUv\.y = 1\.0 - maskUv\.y;/);
  assert.equal((source.match(/isRenderTargetTexture\(batch\.texture\), hasMask \? isRenderTargetTexture\(batch\.maskTexture\) : 0/g) || []).length, 2, "regular and instanced draws");
  assert.doesNotMatch(source.slice(source.indexOf("const fragmentSource"), source.indexOf("const instancedVertexSource")), /texture\(u_texture, v_uv\)/, "no unflipped sampling left");
});
