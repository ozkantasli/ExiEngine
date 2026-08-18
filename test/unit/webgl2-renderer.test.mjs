// ExiEngine unit test — WebGL2Renderer (fake GL context ile)
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebGL2Renderer } from "../../src/render/webgl2-renderer.js";
import { Scene, Camera, RenderTexture, Texture, Sprite, SpriteBatch, RenderGroup } from "../../src/index.js";

test("webgl2: clear color normalizasyonu ve clear davranışı", () => {
  const renderer = new WebGL2Renderer({ canvas: null, clearColor: "#abc", clearAlpha: 0.5, clearBeforeRender: false });
  assert.equal(renderer.clearColor, 0xaabbcc);
  assert.deepEqual(renderer.clearRGBA, { r: 0xaa / 255, g: 0xbb / 255, b: 0xcc / 255, a: 0.5 });
  assert.equal(renderer.clearBeforeRender, false);

  let contextOptions = null;
  const contextProbe = new WebGL2Renderer({ canvas: { getContext: (kind, options) => { contextOptions = { kind, options }; return null; } }, clearBeforeRender: false });
  assert.throws(() => contextProbe.init(), /WebGL2/);
  assert.equal(contextOptions.kind, "webgl2");
  assert.equal(contextOptions.options.preserveDrawingBuffer, true);

  const clearCalls = [];
  const clearProbe = new WebGL2Renderer({ canvas: null, clearColor: 0x123456, clearAlpha: 0.75 });
  clearProbe.gl = {
    ARRAY_BUFFER: 1, COLOR_BUFFER_BIT: 2, BLEND: 3, SCISSOR_TEST: 4,
    viewport() {}, clearColor: (...values) => clearCalls.push(["color", ...values]), clear: (value) => clearCalls.push(["clear", value]), enable() {}, disable() {}, blendFunc() {}, bindBuffer() {},
  };
  clearProbe.width = 320;
  clearProbe.height = 180;
  clearProbe.render(0, new Scene(), new Camera({ width: 320, height: 180 }));
  assert.deepEqual(clearCalls.slice(0, 2), [["color", 0x12 / 255, 0x34 / 255, 0x56 / 255, 0.75], ["clear", 2]]);
  clearCalls.length = 0;
  clearProbe.clearBeforeRender = false;
  clearProbe.render(0, new Scene(), new Camera({ width: 320, height: 180 }));
  assert.equal(clearCalls.length, 0);
});

test("webgl2: vertex/instance buffer büyüme, limitler, atomic-fail", () => {
  const calls = [];
  let limitQueries = 0;
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    ARRAY_BUFFER: 34962, DYNAMIC_DRAW: 35048, MAX_TEXTURE_SIZE: 3379,
    bufferData: (...args) => calls.push(args), bufferSubData() {}, createBuffer: () => ({}), deleteBuffer() {}, bindBuffer() {}, getParameter: () => { limitQueries += 1; return 4096; },
  };
  probe.maxTextureSize = 4096;
  probe.ensureVertexBuffer(128);
  probe.ensureVertexBuffer(4096);
  probe.ensureVertexBuffer(4097);
  assert.throws(() => probe.ensureVertexBuffer(64 * 1024 * 1024 + 1), /limiti/);
  assert.throws(() => probe.ensureVertexBuffer(Infinity), /limiti/);
  assert.deepEqual(calls.map((call) => call[1]), [4096, 8192]);
  const info = probe.getInfo();
  assert.equal(probe.getInfo(), info);
  assert.equal(limitQueries, 0);
  assert.equal(info.vertexBufferResizes, 2);
  probe.ensureInstanceBuffer(128);
  assert.equal(probe.getInfo().instanceBufferResizes, 1);
  assert.throws(() => probe.ensureInstanceBuffer(NaN), /limiti/);

  // Atomic-fail: başarısız tahsiste mevcut buffer korunur + delete edilir
  let failBufferData = false;
  let bufferId = 0;
  const deleted = [];
  const atomicProbe = new WebGL2Renderer({ canvas: null });
  atomicProbe.gl = {
    ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2,
    createBuffer: () => ({ id: ++bufferId }),
    deleteBuffer: (buffer) => deleted.push(buffer),
    bindBuffer() {},
    bufferData: () => { if (failBufferData) throw new Error("webgl buffer allocation failed"); },
    bufferSubData() {},
  };
  atomicProbe.ensureVertexBuffer(128);
  const stable = atomicProbe.buffer;
  failBufferData = true;
  assert.throws(() => atomicProbe.ensureVertexBuffer(4097), /allocation failed/);
  assert.equal(atomicProbe.buffer, stable);
  assert.equal(atomicProbe.bufferSize, 4096);
  assert.equal(deleted.length, 1);
  failBufferData = false;
  atomicProbe.ensureInstanceBuffer(128);
  const stableInstance = atomicProbe.instanceBuffer;
  failBufferData = true;
  assert.throws(() => atomicProbe.ensureInstanceBuffer(4097), /allocation failed/);
  assert.equal(atomicProbe.instanceBuffer, stableInstance);
  assert.equal(deleted.length, 2);
});

test("webgl2: static buffer cache, key değişimi, prune", () => {
  const subDataCalls = [];
  const deletes = [];
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    ARRAY_BUFFER: 34962, DYNAMIC_DRAW: 35048,
    bufferData() {}, bufferSubData: (...args) => subDataCalls.push(args), createBuffer: () => ({}), deleteBuffer: (buffer) => deletes.push(buffer), bindBuffer() {},
  };
  const owner = { destroyed: false };
  const batch = { staticOwner: owner, staticKey: "first", data: new Float32Array(8) };
  const first = probe.ensureStaticBuffer(batch);
  // Aynı key cache hit → yeni upload yok
  assert.equal(probe.ensureStaticBuffer(batch), first);
  assert.equal(subDataCalls.length, 1);
  // Key değişimi aynı boyutta → in-place bufferSubData (yeni buffer YOK)
  batch.staticKey = "second";
  probe.ensureStaticBuffer(batch);
  assert.equal(subDataCalls.length, 2);
  // Büyüyen data → yeni buffer tahsisi + eski buffer delete
  batch.data = new Float32Array(8_192);
  probe.ensureStaticBuffer(batch);
  assert.equal(deletes.length, 1);
  owner.destroyed = true;
  probe.pruneStaticBuffers();
  assert.equal(deletes.length, 2);
  probe.destroy();
});

test("webgl2: texture upload, filter, atlas paylaşımı, lifecycle", () => {
  const uploads = [];
  const filterCalls = [];
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, NEAREST: 9728, CLAMP_TO_EDGE: 33071, UNPACK_FLIP_Y_WEBGL: 37440, MAX_TEXTURE_SIZE: 3379,
    ARRAY_BUFFER: 34962, DYNAMIC_DRAW: 35048,
    createTexture: () => ({}), createBuffer: () => ({}), bindTexture() {}, bindBuffer() {}, bufferData() {}, bufferSubData() {}, pixelStorei() {}, texParameteri: (...args) => filterCalls.push(args), texImage2D: (...args) => uploads.push(["create", args]), texSubImage2D: (...args) => uploads.push(["update", args]), deleteTexture() {}, deleteBuffer() {}, getParameter: () => 64,
  };
  const stream = new Texture({ source: { width: 4, height: 4 } });
  probe.getTexture(stream);
  stream.markDirty();
  probe.getTexture(stream);
  probe.getTexture(stream);
  assert.deepEqual(uploads.map(([kind]) => kind), ["create", "update"]);
  assert.equal(probe.getInfo().textureUploads, 2);
  assert.equal(probe.getInfo().textureUploadBytes, 128);
  const filterCount = filterCalls.length;
  stream.setFilter("nearest");
  probe.getTexture(stream);
  assert.equal(filterCalls.length, filterCount + 2);

  const virtualTexture = new Texture({ id: "virtual-white", width: 1024, height: 1024 });
  probe.getTexture(virtualTexture);
  assert.equal(probe.getInfo().textureUploadBytes, 132);

  const atlasBase = new Texture({ id: "atlas-base", source: { width: 8, height: 4 } });
  const frameA = atlasBase.subTexture({ x: 0, y: 0, width: 4, height: 4 });
  const frameB = atlasBase.subTexture({ x: 4, y: 0, width: 4, height: 4 });
  const handleA = probe.getTexture(frameA);
  const handleB = probe.getTexture(frameB);
  assert.equal(handleA, handleB);
  assert.equal(probe.getInfo().textureCount, 3);
  const atlasUploads = probe.getInfo().textureUploads;
  frameB.markDirty();
  probe.getTexture(frameA);
  assert.equal(probe.getInfo().textureUploads, atlasUploads + 1);

  const lifecycle = new Texture({ id: "lifecycle", source: { width: 2, height: 2 } });
  const lifecycleHandle = probe.getTexture(lifecycle);
  lifecycle.destroy();
  assert.throws(() => probe.getTexture(lifecycle), (error) => error?.code === "EXI_TEXTURE_INPUT");
  assert.throws(() => probe.updateTexture(lifecycle, lifecycleHandle), (error) => error?.code === "EXI_TEXTURE_INPUT");
  probe.pruneDestroyedTextures();
  assert.throws(() => probe.createTexture(lifecycle), (error) => error?.code === "EXI_TEXTURE_INPUT");
});

test("webgl2: texture budget ve doğrudan mutasyon koruması", () => {
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, NEAREST: 9728, CLAMP_TO_EDGE: 33071, UNPACK_FLIP_Y_WEBGL: 37440, MAX_TEXTURE_SIZE: 3379,
    ARRAY_BUFFER: 34962, DYNAMIC_DRAW: 35048,
    createTexture: () => ({}), createBuffer: () => ({}), bindTexture() {}, bindBuffer() {}, bufferData() {}, bufferSubData() {}, pixelStorei() {}, texParameteri() {}, texImage2D() {}, texSubImage2D() {}, deleteTexture() {}, deleteBuffer() {}, getParameter: () => 64,
  };
  const budgetProbe = new WebGL2Renderer({ canvas: null, maxTextureBytes: 16, maxTextureCount: 1 });
  budgetProbe.gl = probe.gl;
  budgetProbe.getTexture(new Texture({ id: "budget-first", source: { width: 2, height: 2 } }));
  let budgetError = null;
  try { budgetProbe.getTexture(new Texture({ id: "budget-second" })); }
  catch (error) { budgetError = error; }
  assert.equal(budgetError?.code, "EXI_TEXTURE_BUDGET");
  budgetProbe.destroy();
  const mutationProbe = new WebGL2Renderer({ canvas: null });
  mutationProbe.maxTextureBytes = Number.MAX_SAFE_INTEGER;
  assert.throws(() => mutationProbe.assertTextureBudget(4), (error) => error?.code === "EXI_RENDER_CONFIG");
  mutationProbe.destroy();
  assert.throws(() => probe.createTexture(new Texture({ source: { width: 65, height: 65 } })), /pixel/);
});

test("webgl2: başarısız texture upload'da delete", () => {
  const deleted = [];
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, CLAMP_TO_EDGE: 33071, UNPACK_FLIP_Y_WEBGL: 37440, MAX_TEXTURE_SIZE: 3379,
    createTexture: () => ({}), deleteTexture: (texture) => deleted.push(texture), bindTexture() {}, pixelStorei() {}, texParameteri() {}, texImage2D() { throw new Error("texture upload failure"); }, getParameter: () => 64,
  };
  assert.throws(() => probe.createTexture(new Texture({ source: { width: 4, height: 4 } })), /texture upload failure/);
  assert.equal(deleted.length, 1);
  assert.equal(probe.getInfo().textureCount, 0);
});

test("webgl2: render target lifecycle, resize, feedback loop", () => {
  const deletes = [];
  const binds = [];
  let failAllocation = false;
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, NEAREST: 9728, CLAMP_TO_EDGE: 33071, MAX_TEXTURE_SIZE: 3379,
    FRAMEBUFFER: 36160, COLOR_ATTACHMENT0: 36064, FRAMEBUFFER_COMPLETE: 36053,
    createTexture: () => { if (failAllocation) throw new Error("target allocation failure"); return { kind: "target-texture" }; }, createFramebuffer: () => ({ kind: "target-framebuffer" }),
    bindTexture() {}, bindFramebuffer: (...args) => binds.push(args), texParameteri() {}, texImage2D() {}, framebufferTexture2D() {}, checkFramebufferStatus: () => 36053,
    viewport() {}, bindBuffer() {}, enable() {}, disable() {}, blendFunc() {},
    deleteTexture: (value) => deletes.push(["texture", value]), deleteFramebuffer: (value) => deletes.push(["framebuffer", value]), getParameter: () => 64,
  };
  const target = new RenderTexture({ width: 32, height: 16 });
  const entry = probe.ensureRenderTarget(target);
  assert.equal(entry.width, 32);
  assert.equal(probe.getTexture(target), entry.texture);
  assert.equal(probe.getInfo().renderTargetCount, 1);
  target.resize(16, 8);
  const resized = probe.ensureRenderTarget(target);
  assert.equal(resized.width, 16);
  assert.notEqual(resized.texture, entry.texture);
  probe.clearBeforeRender = false;
  probe.render(0, new Scene(), new Camera({ width: 16, height: 8 }), target);
  assert.equal(binds.at(-2)[1], resized.framebuffer);
  assert.equal(binds.at(-1)[1], null);
  const stable = probe.renderTargets.get(target);
  failAllocation = true;
  target.resize(8, 4);
  assert.throws(() => probe.ensureRenderTarget(target), /target allocation failure/);
  assert.equal(probe.renderTargets.get(target), stable);
  failAllocation = false;
  assert.notEqual(probe.ensureRenderTarget(target), stable);
  target.destroy();
  probe.pruneDestroyedTextures();
  assert.equal(probe.getInfo().renderTargetCount, 0);
  assert.equal(deletes.length, 6);

  const feedbackTarget = new RenderTexture({ width: 32, height: 16 });
  const feedbackScene = new Scene();
  feedbackScene.add(new Sprite({ texture: feedbackTarget, width: 8, height: 8 }));
  assert.throws(() => probe.render(0, feedbackScene, new Camera({ width: 32, height: 16 }), feedbackTarget), /feedback loop/);
  const maskScene = new Scene();
  maskScene.add(new Sprite({ maskTexture: feedbackTarget, width: 8, height: 8 }));
  assert.throws(() => probe.render(0, maskScene, new Camera({ width: 32, height: 16 }), feedbackTarget), /feedback loop/);
  probe.destroy();
});

test("webgl2: program build failure cleanup", () => {
  const shaderDeletes = [];
  const programDeletes = [];
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: (type) => ({ type }), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => "shader failure", deleteShader: (shader) => shaderDeletes.push(shader),
    createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => false, getProgramInfoLog: () => "program failure", deleteProgram: (program) => programDeletes.push(program),
  };
  assert.throws(() => probe.buildResources(), /program failure/);
  assert.equal(shaderDeletes.length, 2);
  assert.equal(programDeletes.length, 1);
});

test("webgl2: prepare prewarm ve static upload", () => {
  const source = { width: 4, height: 4 };
  const texture = new Texture({ source });
  const probe = new WebGL2Renderer({ canvas: null });
  probe.gl = {
    ARRAY_BUFFER: 34962, DYNAMIC_DRAW: 35048, STATIC_DRAW: 35044, ELEMENT_ARRAY_BUFFER: 34963, COLOR_BUFFER_BIT: 16384, BLEND: 3042, SCISSOR_TEST: 3089,
    bufferData() {}, bufferSubData() {}, createBuffer: () => ({}), deleteBuffer() {}, bindBuffer() {},
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, LINEAR: 9729, NEAREST: 9728, CLAMP_TO_EDGE: 33071, UNPACK_FLIP_Y_WEBGL: 37440, MAX_TEXTURE_SIZE: 3379,
    createTexture: () => ({}), bindTexture() {}, pixelStorei() {}, texParameteri() {}, texImage2D() {}, deleteTexture() {}, getParameter: () => 64,
    viewport() {}, enable() {}, disable() {}, blendFunc() {}, clearColor() {}, clear() {},
    vertexAttribPointer() {}, vertexAttribDivisor() {}, enableVertexAttribArray() {}, drawElements() {}, drawArrays() {}, drawElementsInstanced() {}, drawArraysInstanced() {},
    useProgram() {}, uniform2f() {}, uniform4f() {}, uniform1i() {}, activeTexture() {}, createVertexArray: () => ({}), bindVertexArray() {}, deleteVertexArray() {},
  };
  const scene = new Scene();
  const batch = new SpriteBatch({ texture });
  batch.addSprite({ x: 0, y: 0, width: 12, height: 12 });
  scene.add(batch);
  probe.resize(320, 180);
  const result = probe.prepare(scene, new Camera({ width: 320, height: 180 }));
  assert.equal(result.batches, 1);
  assert.equal(probe.staticBuffers.size, 1);

  const groupTextures = [];
  const groupProbe = new WebGL2Renderer({ canvas: null });
  groupProbe.gl = { ARRAY_BUFFER: 1, bindBuffer() {} };
  groupProbe.ensureVertexBuffer = () => {};
  groupProbe.ensureInstanceBuffer = () => {};
  groupProbe.getTexture = (value) => { groupTextures.push(value); return null; };
  const group = new RenderGroup({ width: 16, height: 8, effects: [{ filter: "sepia" }, { filter: "contrast" }] });
  group.add(new Sprite({ width: 4, height: 4 }));
  const groupScene = new Scene();
  groupScene.add(group);
  const groupResult = groupProbe.prepare(groupScene, new Camera({ width: 16, height: 8 }));
  assert.equal(groupResult.batches, 1);
  assert.equal(groupTextures.includes(group.target), true);
  group.destroy();
  groupProbe.destroy();
  probe.destroy();
});

test("webgl2: context lost/restored ve init failure", () => {
  const statuses = [];
  const errors = [];
  const errorObjects = [];
  const initFailureProbe = new WebGL2Renderer({ canvas: { getContext: () => ({}), addEventListener() {}, removeEventListener() {} } });
  initFailureProbe.buildResources = () => { throw new Error("webgl init failure"); };
  assert.throws(() => initFailureProbe.init(), /webgl init failure/);
  assert.equal(initFailureProbe.destroyed, true);
  assert.equal(initFailureProbe.gl, null);

  const probe = new WebGL2Renderer({ canvas: null, onStatus: (status) => statuses.push(status.type), onLost: (error) => { errors.push(error.message); errorObjects.push(error); } });
  let prevented = false;
  probe.handleContextLost({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(probe.lost, true);
  assert.equal(errorObjects[0].backend, "webgl2");
  assert.equal(errorObjects[0].recoverable, true);
  probe.buildResources = () => {};
  probe.handleContextRestored();
  assert.equal(probe.lost, false);
  assert.deepEqual(statuses, ["context-lost", "context-restored"]);
  assert.equal(errors.length, 1);

  const restoreFailureErrors = [];
  const restoreFailureProbe = new WebGL2Renderer({ canvas: null, onLost: (error) => restoreFailureErrors.push(error) });
  restoreFailureProbe.handleContextLost({ preventDefault() {} });
  restoreFailureProbe.buildResources = () => { throw new Error("restore failure"); };
  restoreFailureProbe.handleContextRestored();
  assert.equal(restoreFailureProbe.lost, true);
  assert.equal(restoreFailureErrors[1].backend, "webgl2");
  assert.equal(restoreFailureErrors[1].recoverable, false);
  assert.equal(restoreFailureErrors[1].phase, "context-restore");
  restoreFailureProbe.destroy();
  probe.destroy();
  probe.handleContextLost({ preventDefault: () => { throw new Error("destroyed context should be ignored"); } });
  assert.deepEqual(statuses, ["context-lost", "context-restored"]);
});
