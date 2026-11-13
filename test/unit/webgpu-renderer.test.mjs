// ExiEngine unit test — WebGPURenderer (with a fake device)
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebGPURenderer } from "../../src/render/webgpu-renderer.js";
import { Scene, Camera, RenderTexture, Texture, Sprite, SpriteBatch } from "../../src/index.js";

function fakeDevice(options = {}) {
  const destroyedBuffers = options.destroyedBuffers || [];
  return {
    limits: options.limits || {},
    createBuffer: (descriptor) => {
      const buffer = { ...descriptor, destroy: () => destroyedBuffers.push(descriptor.size) };
      if (options.failCreateBuffer) throw options.failCreateBuffer;
      return buffer;
    },
    createBindGroup: () => ({}),
    createTexture: (descriptor) => ({ ...descriptor, createView: () => ({}), destroy() {} }),
    queue: { writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, submit() {} },
    removeEventListener() {},
    ...options.extra,
  };
}

test("webgpu: frameValues and gpuCullParams", () => {
  const probe = new WebGPURenderer({ canvas: null });
  const frameValues = probe.frameValues;
  const gpuCullParams = probe.gpuCullParams;
  assert.ok(frameValues instanceof Float32Array);
  assert.ok(gpuCullParams instanceof Float32Array);
  assert.equal(gpuCullParams.length, 20);
  assert.equal(probe.frameValues, frameValues);
  assert.equal(probe.gpuCullParams, gpuCullParams);
});

test("webgpu: refreshDeviceLimits and buffer limits", () => {
  const destroyedBuffers = [];
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({ destroyedBuffers, extra: { limits: { maxBufferSize: 4096, maxStorageBufferBindingSize: 4096 } } });
  probe.refreshDeviceLimits();
  const info = probe.getInfo();
  assert.equal(probe.getInfo(), info);
  assert.equal(info.maxBufferSize, 4096);
  assert.throws(() => probe.ensureVertexBuffer(4097), /device/);
  assert.throws(() => probe.ensureVertexBuffer(Infinity), /device/);
  probe.maxBufferSize = 8192;
  assert.throws(() => probe.ensureVertexBuffer(1), (error) => error?.code === "EXI_RENDER_CONFIG");
  probe.destroy();
  const mutationProbe = new WebGPURenderer({ canvas: null });
  mutationProbe.maxTexturePixels = Number.MAX_SAFE_INTEGER;
  assert.throws(() => mutationProbe.assertTextureBudget(4), (error) => error?.code === "EXI_RENDER_CONFIG");
  mutationProbe.destroy();
});

test("webgpu: vertex/instance buffer growth", () => {
  const destroyedBuffers = [];
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({ destroyedBuffers });
  probe.refreshDeviceLimits();
  probe.cullLayout = {};
  probe.indirectLayout = {};
  probe.ensureVertexBuffer(128);
  probe.ensureVertexBuffer(4096);
  probe.ensureVertexBuffer(4097);
  assert.equal(probe.vertexBufferSize, 8192);
  assert.deepEqual(destroyedBuffers, [4096]);
  assert.equal(probe.getInfo().vertexBufferResizes, 2);
  probe.ensureInstanceBuffer(128);
  assert.equal(probe.getInfo().instanceBufferResizes, 1);
  assert.throws(() => probe.ensureInstanceBuffer(NaN), /device/);
  probe.destroy();
});

test("webgpu: gpu cull resource growth, rollback, stride", () => {
  const destroyedBuffers = [];
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({ destroyedBuffers });
  probe.refreshDeviceLimits();
  const owner = { destroyed: false };
  const resource = probe.ensureGpuCullResources({ gpuOwner: owner, instanceData: new Float32Array(16), instanceCount: 1, instanceStride: 16 });
  assert.equal(resource.inputSize, 4096);
  assert.equal(probe.gpuCullBytes, 8192);
  assert.equal(probe.getInfo().gpuCullBufferResizes, 1);
  assert.equal(probe.ensureGpuCullResources({ gpuOwner: owner, instanceData: new Float32Array(16), instanceCount: 1, instanceStride: 16 }), resource);
  assert.equal(probe.getInfo().gpuCullBufferResizes, 1);
  assert.ok(probe.gpuCullResources.has(owner));
  assert.throws(() => probe.ensureGpuCullResources({ gpuOwner: owner, instanceData: new Float32Array(16), instanceCount: 0, instanceStride: 16 }), /count/);

  // Bind group failure → rollback (yeni nesneler destroy, mevcut korunur)
  const originalCreateBindGroup = probe.device.createBindGroup;
  let failBindGroup = false;
  probe.device.createBindGroup = (...args) => {
    if (failBindGroup) throw new Error("gpu cull bind group failed");
    return originalCreateBindGroup(...args);
  };
  const failedOwner = { destroyed: false };
  const failedBytes = probe.gpuCullBytes;
  const failedDestroyStart = destroyedBuffers.length;
  failBindGroup = true;
  assert.throws(() => probe.ensureGpuCullResources({ gpuOwner: failedOwner, instanceData: new Float32Array(16), instanceCount: 1, instanceStride: 16 }), /bind group/);
  failBindGroup = false;
  assert.equal(probe.gpuCullResources.has(failedOwner), false);
  assert.equal(probe.gpuCullBytes, failedBytes);
  assert.ok(destroyedBuffers.length > failedDestroyStart);
  probe.destroy();
});

test("webgpu: gpu cull stride and limit validation", () => {
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice();
  probe.refreshDeviceLimits();
  assert.throws(() => probe.ensureGpuCullResources({ gpuOwner: { destroyed: false }, instanceData: new Float32Array(8), instanceCount: 1, instanceStride: 8 }), /stride/);
  assert.equal(probe.gpuCullResources.size, 0);
  probe.destroy();
});

test("webgpu: static buffer upload failure guard", () => {
  const destroyedBuffers = [];
  let uploadFailure = false;
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({
    destroyedBuffers,
    extra: {
      createBuffer: ({ size }) => ({ size, destroy: () => { destroyedBuffers.push(size); } }),
      queue: { writeBuffer: () => { if (uploadFailure) throw new Error("static buffer upload failed"); } },
    },
  });
  probe.refreshDeviceLimits();
  const owner = { destroyed: false };
  const batch = { staticOwner: owner, staticKey: "first", data: new Float32Array(1024) };
  const stable = probe.ensureStaticBuffer(batch);
  uploadFailure = true;
  assert.throws(() => probe.ensureStaticBuffer({ ...batch, staticKey: "larger", data: new Float32Array(2048) }), /upload failed/);
  assert.equal(probe.staticBuffers.get(owner).buffer, stable);
  assert.equal(destroyedBuffers.length, 1);
  probe.destroy();
});

test("webgpu: filter buffer bind group failure", () => {
  const destroyedBuffers = [];
  let failBindGroup = false;
  const probe = new WebGPURenderer({ canvas: null });
  probe.filterLayout = {};
  probe.device = fakeDevice({
    destroyedBuffers,
    extra: {
      createBuffer: ({ size }) => ({ size, destroy: () => { destroyedBuffers.push(size); } }),
      createBindGroup: () => { if (failBindGroup) throw new Error("filter bind group failed"); return {}; },
    },
  });
  probe.ensureFilterBuffer(1);
  const stable = probe.filterBuffer;
  const stableSize = probe.filterBufferSize;
  failBindGroup = true;
  assert.throws(() => probe.ensureFilterBuffer(2), /filter bind group failed/);
  assert.equal(probe.filterBuffer, stable);
  assert.equal(probe.filterBufferSize, stableSize);
  assert.equal(destroyedBuffers.length, 1);
  probe.destroy();
});

test("webgpu: texture create/update/atlas/lifecycle", () => {
  let usage = 0;
  let textureSize = null;
  const bindGroups = [];
  const uploads = [];
  let failTargetAllocation = false;
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({
    extra: {
      limits: { maxTextureDimension2D: 64 },
      createTexture: (options) => {
        if (failTargetAllocation && options.size?.[0] === 8) throw new Error("target allocation failure");
        usage = options.usage;
        textureSize = options.size;
        return { createView: () => ({}), destroy() {} };
      },
      createBindGroup: (descriptor) => { bindGroups.push(descriptor); return {}; },
      queue: { copyExternalImageToTexture: (...args) => uploads.push(args), writeTexture() {}, writeBuffer() {} },
    },
  });
  probe.textureLayout = {};
  probe.sampler = {};
  probe.samplers.linear = { filter: "linear" };
  probe.samplers.nearest = { filter: "nearest" };
  const stream = new Texture({ source: { width: 4, height: 4 } });
  const value = probe.createTexture(stream);
  assert.ok(usage & 0x0010);
  stream.markDirty();
  probe.updateTexture(stream, value);
  probe.updateTexture(stream, value);
  assert.equal(uploads.length, 2);
  assert.equal(probe.getInfo().textureUploads, 2);
  assert.equal(probe.getInfo().textureUploadBytes, 128);

  const atlasBase = new Texture({ id: "atlas-base", source: { width: 8, height: 4 } });
  const frameA = atlasBase.subTexture({ x: 0, y: 0, width: 4, height: 4 });
  const frameB = atlasBase.subTexture({ x: 4, y: 0, width: 4, height: 4 });
  assert.equal(probe.getTextureValue(frameA), probe.getTextureValue(frameB));
  assert.equal(probe.getInfo().textureCount, 2);
  const atlasUploads = probe.getInfo().textureUploads;
  frameB.markDirty();
  probe.getTextureValue(frameA);
  assert.equal(probe.getInfo().textureUploads, atlasUploads + 1);

  const virtualTexture = new Texture({ id: "virtual-white", width: 4, height: 4 });
  probe.createTexture(virtualTexture);
  assert.deepEqual(textureSize, [1, 1, 1]);

  const nearest = new Texture({ id: "nearest", sourceWidth: 4, sourceHeight: 4, filter: "nearest" });
  probe.createTexture(nearest);
  assert.equal(bindGroups.at(-1).entries[1].resource.filter, "nearest");
  stream.setFilter("nearest");
  probe.updateTexture(stream, value);
  assert.equal(bindGroups.at(-1).entries[1].resource.filter, "nearest");

  const lifecycle = new Texture({ id: "lifecycle", source: { width: 2, height: 2 } });
  const lifecycleValue = probe.getTextureValue(lifecycle);
  lifecycle.destroy();
  assert.throws(() => probe.getTextureValue(lifecycle), (error) => error?.code === "EXI_TEXTURE_INPUT");
  assert.throws(() => probe.updateTexture(lifecycle, lifecycleValue), (error) => error?.code === "EXI_TEXTURE_INPUT");
  probe.pruneDestroyedTextures();
  assert.throws(() => probe.createTexture(lifecycle), (error) => error?.code === "EXI_TEXTURE_INPUT");
  const destroyedFrame = atlasBase.subTexture({ x: 0, y: 0, width: 2, height: 2 });
  destroyedFrame.destroy();
  assert.throws(() => probe.getTextureValue(destroyedFrame), (error) => error?.code === "EXI_TEXTURE_INPUT");
});

test("webgpu: texture budget and failed bind group cleanup", () => {
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({ extra: { limits: { maxTextureDimension2D: 64 } } });
  probe.textureLayout = {};
  probe.samplers.linear = { filter: "linear" };
  probe.samplers.nearest = { filter: "nearest" };
  probe.sampler = probe.samplers.linear;
  const budgetProbe = new WebGPURenderer({ canvas: null, maxTextureBytes: 16, maxTextureCount: 1 });
  budgetProbe.device = probe.device;
  budgetProbe.textureLayout = {};
  budgetProbe.samplers.linear = { filter: "linear" };
  budgetProbe.samplers.nearest = { filter: "nearest" };
  budgetProbe.sampler = budgetProbe.samplers.linear;
  budgetProbe.createTexture(new Texture({ id: "budget-first", source: { width: 2, height: 2 } }));
  let budgetError = null;
  try { budgetProbe.createTexture(new Texture({ id: "budget-second" })); }
  catch (error) { budgetError = error; }
  assert.equal(budgetError?.code, "EXI_TEXTURE_BUDGET");
  budgetProbe.destroy();

  let destroyed = false;
  const failureProbe = new WebGPURenderer({ canvas: null });
  failureProbe.device = fakeDevice({
    extra: {
      limits: { maxTextureDimension2D: 64 },
      createTexture: () => ({ destroy: () => { destroyed = true; } }),
      queue: { writeTexture() {} },
    },
  });
  failureProbe.createTextureBindGroup = () => { throw new Error("bind group failed"); };
  assert.throws(() => failureProbe.createTexture(new Texture({ sourceWidth: 4, sourceHeight: 4 })), /bind group/);
  assert.equal(destroyed, true);
});

test("webgpu: render target lifecycle, feedback, allocation failure", () => {
  let usage = 0;
  let failTargetAllocation = false;
  const probe = new WebGPURenderer({ canvas: null });
  probe.device = fakeDevice({
    extra: {
      limits: { maxTextureDimension2D: 64 },
      createTexture: (options) => {
        if (failTargetAllocation && options.size?.[0] === 8) throw new Error("target allocation failure");
        usage = options.usage;
        return { createView: () => ({}), destroy() {} };
      },
    },
  });
  const target = new RenderTexture({ width: 16, height: 8 });
  const entry = probe.ensureRenderTarget(target);
  assert.deepEqual(entry.width, 16);
  assert.deepEqual(entry.height, 8);
  assert.equal(probe.getInfo().renderTargetCount, 1);
  assert.ok(usage & 0x0010);
  const stable = probe.renderTargets.get(target);
  failTargetAllocation = true;
  target.resize(8, 4);
  assert.throws(() => probe.ensureRenderTarget(target), /target allocation failure/);
  assert.equal(probe.renderTargets.get(target), stable);
  failTargetAllocation = false;
  assert.notEqual(probe.ensureRenderTarget(target), stable);
  target.destroy();
  probe.pruneDestroyedTextures();
  assert.equal(probe.getInfo().renderTargetCount, 0);

  const feedbackTarget = new RenderTexture({ width: 16, height: 8 });
  const feedbackScene = new Scene();
  feedbackScene.add(new Sprite({ texture: feedbackTarget, width: 4, height: 4 }));
  probe.canvas = { width: 16, height: 8 };
  probe.context = {};
  assert.throws(() => probe.render(0, feedbackScene, new Camera({ width: 16, height: 8 }), feedbackTarget), /feedback loop/);
  const maskScene = new Scene();
  maskScene.add(new Sprite({ maskTexture: feedbackTarget, width: 4, height: 4 }));
  assert.throws(() => probe.render(0, maskScene, new Camera({ width: 16, height: 8 }), feedbackTarget), /feedback loop/);
  probe.destroy();
});

test("webgpu: render EXI_RENDER_INPUT and pixel limit", () => {
  const losses = [];
  const renderInputProbe = new WebGPURenderer({ canvas: { width: 64, height: 64 }, onLost: (error) => losses.push(error) });
  renderInputProbe.device = fakeDevice();
  renderInputProbe.context = {};
  renderInputProbe.frameBuffer = {};
  renderInputProbe.ensureVertexBuffer = () => { throw new RangeError("vertex input limit"); };
  const scene = new Scene();
  scene.add(new Sprite({ width: 8, height: 8 }));
  let error = null;
  try { renderInputProbe.render(0, scene, new Camera({ width: 64, height: 64 })); }
  catch (caught) { error = caught; }
  assert.match(error?.message || "", /vertex input limit/);
  assert.equal(error?.code, "EXI_RENDER_INPUT");
  assert.equal(renderInputProbe.lost, false);
  assert.equal(losses.length, 0);
  renderInputProbe.destroy();

  const tooLargeProbe = new WebGPURenderer({ canvas: null });
  tooLargeProbe.device = fakeDevice({ extra: { limits: { maxTextureDimension2D: 64 } } });
  assert.throws(() => tooLargeProbe.createTexture(new Texture({ source: { width: 65, height: 65 } })), /pixel/);
  tooLargeProbe.destroy();
});

test("webgpu: device lost cleanup and duplicate guard", () => {
  const statuses = [];
  const errors = [];
  const errorObjects = [];
  const released = [];
  const probe = new WebGPURenderer({ canvas: null, onStatus: (status) => statuses.push(status.type), onLost: (error) => { errors.push(error.message); errorObjects.push(error); } });
  probe.device = fakeDevice();
  probe.cullLayout = {};
  probe.indirectLayout = {};
  probe.textureBinds.set({}, { texture: { destroy: () => released.push("texture") } });
  probe.staticBuffers.set({}, { buffer: { destroy: () => released.push("static") } });
  probe.frameBuffer = { destroy: () => released.push("frame") };
  probe.vertexBuffer = { destroy: () => released.push("vertex") };
  probe.instanceBuffer = { destroy: () => released.push("instance") };
  probe.ensureGpuCullResources({ gpuOwner: { destroyed: false }, instanceData: new Float32Array(16), instanceCount: 1, instanceStride: 16 });
  assert.ok(probe.gpuCullBytes > 0);
  probe.handleDeviceLost({ reason: "test" });
  assert.equal(probe.gpuCullResources.size, 0);
  assert.equal(probe.gpuCullBytes, 0);
  assert.equal(probe.textureBinds.size, 0);
  assert.equal(probe.staticBuffers.size, 0);
  assert.equal(probe.frameBuffer, null);
  assert.equal(probe.vertexBuffer, null);
  assert.equal(probe.instanceBuffer, null);
  assert.deepEqual(released.sort(), ["frame", "instance", "static", "texture", "vertex"]);
  assert.equal(errorObjects[0].backend, "webgpu");
  assert.equal(errorObjects[0].recoverable, false);
  assert.equal(errorObjects[0].reason, "test");
  probe.handleDeviceLost({ reason: "duplicate" });
  assert.deepEqual(statuses, ["device-lost"]);
  assert.equal(errors.length, 1);
  probe.handleUncapturedError({ error: { message: "before-destroy" } });
  assert.deepEqual(statuses, ["device-lost", "device-error"]);
  probe.destroy();
  probe.handleUncapturedError({ error: { message: "after-destroy" } });
  assert.deepEqual(statuses, ["device-lost", "device-error"]);
});

test("webgpu: render failure → device lost", () => {
  const errors = [];
  const errorObjects = [];
  const probe = new WebGPURenderer({ canvas: { width: 320, height: 180 }, onLost: (error) => { errors.push(error.message); errorObjects.push(error); } });
  probe.device = fakeDevice({ extra: { queue: { writeBuffer() { throw new Error("render failure"); } } } });
  probe.context = {};
  probe.frameBuffer = { destroy() {} };
  probe.render(0, new Scene(), new Camera({ width: 320, height: 180 }));
  assert.equal(probe.lost, true);
  assert.deepEqual(errors, ["render failure"]);
  assert.equal(errorObjects[0].backend, "webgpu");
  assert.equal(errorObjects[0].recoverable, false);
  assert.equal(errorObjects[0].phase, "render");
  assert.equal(probe.frameBuffer, null);
  probe.destroy();
});

test("webgpu: buildResources failure cleanup", async () => {
  const destroyed = [];
  let popCount = 0;
  const probe = new WebGPURenderer({ canvas: null });
  probe.format = "rgba8unorm";
  probe.device = fakeDevice({
    destroyedBuffers: destroyed,
    extra: {
      pushErrorScope() {},
      popErrorScope: async () => { popCount += 1; return null; },
      createShaderModule: () => ({}),
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createRenderPipeline: () => ({}),
      createComputePipeline: () => ({}),
      createBuffer: (options) => ({ ...options, destroy: () => destroyed.push(options.size) }),
      createBindGroup: () => { throw new Error("bind group failure"); },
      createSampler: () => ({}),
    },
  });
  await assert.rejects(probe.buildResources(), /bind group failure/);
  assert.equal(popCount, 1);
  assert.deepEqual(destroyed, [16]);
  assert.equal(probe.frameBuffer, null);
  probe.destroy();
});

test("webgpu: init failure → destroyed state", async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const initDevice = { limits: {}, addEventListener() {}, removeEventListener() {}, lost: Promise.resolve({}) };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { gpu: {
    requestAdapter: async () => ({ requestDevice: async () => initDevice }),
    getPreferredCanvasFormat: () => "rgba8unorm",
  } } });
  const probe = new WebGPURenderer({ canvas: { getContext: () => ({}) } });
  probe.configure = () => {};
  probe.buildResources = async () => { throw new Error("webgpu init failure"); };
  await assert.rejects(probe.init(), /webgpu init failure/);
  assert.equal(probe.destroyed, true);
  assert.equal(probe.device, null);
  if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
  else delete globalThis.navigator;
});

test("webgpu: prepare prewarm", () => {
  const probe = new WebGPURenderer({ canvas: null });
  const texture = new Texture({ source: { width: 4, height: 4 } });
  probe.device = fakeDevice({ extra: { limits: { maxTextureDimension2D: 64 } } });
  probe.textureLayout = {};
  probe.samplers.linear = { filter: "linear" };
  probe.samplers.nearest = { filter: "nearest" };
  probe.sampler = probe.samplers.linear;
  probe.canvas = { width: 320, height: 180 };
  probe.context = {};
  const scene = new Scene();
  const batch = new SpriteBatch({ texture });
  batch.addSprite({ x: 0, y: 0, width: 12, height: 12 });
  scene.add(batch);
  probe.width = 320;
  probe.height = 180;
  // First prepare: the texture is uploaded for the first time
  const result = probe.prepare(scene, new Camera({ width: 320, height: 180 }));
  assert.equal(result.batches, 1);
  assert.equal(result.uploads, 1);
  assert.equal(probe.staticBuffers.size, 1);
  // Second prepare: cache hit → no upload
  const second = probe.prepare(scene, new Camera({ width: 320, height: 180 }));
  assert.equal(second.batches, 1);
  assert.equal(second.uploads, 0);
  probe.destroy();
});

// A fake device that supports buildResources and records every pass command,
// so the full render loop runs in Node (no GPU; the browser soak is the GPU evidence).
function recordingDevice(log, options = {}) {
  const pass = (kind) => new Proxy({}, { get: (_, name) => (...args) => { log.push([kind, name, ...args]); } });
  return {
    limits: { maxTextureDimension2D: 4096, maxBufferSize: 1 << 28, ...options.limits },
    pushErrorScope() {},
    popErrorScope: async () => null,
    createShaderModule: ({ code }) => ({ code, getCompilationInfo: async () => ({ messages: options.compileErrors?.(code) ? [{ type: "error", message: "bad" }] : [] }) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor) => ({ entry: descriptor.vertex.entryPoint }),
    createComputePipeline: () => ({}),
    createSampler: (descriptor) => ({ filter: descriptor.magFilter }),
    createBindGroup: () => ({}),
    createBuffer: (descriptor) => ({ ...descriptor, destroy() { log.push(["buffer", "destroy", descriptor.size]); }, mapAsync: async () => {}, getMappedRange: () => options.mapped?.(descriptor.size) ?? new ArrayBuffer(descriptor.size), unmap() {} }),
    createTexture: (descriptor) => ({ ...descriptor, createView: () => ({ view: descriptor.size }), destroy() { log.push(["texture", "destroy"]); } }),
    createCommandEncoder: () => ({
      beginRenderPass: (descriptor) => { log.push(["encoder", "beginRenderPass", descriptor.colorAttachments[0].loadOp]); return pass("render"); },
      beginComputePass: () => pass("compute"),
      copyTextureToBuffer: (...args) => log.push(["encoder", "copyTextureToBuffer", ...args]),
      finish: () => ({}),
    }),
    queue: { writeBuffer: (...args) => log.push(["queue", "writeBuffer", args[1]]), writeTexture() {}, copyExternalImageToTexture() {}, submit: () => log.push(["queue", "submit"]), onSubmittedWorkDone: async () => {} },
    addEventListener() {},
    removeEventListener() {},
  };
}

async function builtRenderer(log, options) {
  const renderer = new WebGPURenderer({ canvas: { width: 64, height: 32 } });
  renderer.device = recordingDevice(log, options);
  renderer.format = "rgba8unorm";
  renderer.context = { getCurrentTexture: () => ({ createView: () => ({ view: "canvas" }) }) };
  await renderer.buildResources();
  return renderer;
}

test("webgpu: the render loop draws regular, static, masked, clipped and GPU-culled instanced batches", async () => {
  const { Graphics, Node } = await import("../../src/index.js");
  const log = [];
  const renderer = await builtRenderer(log);
  const scene = new Scene();
  scene.add(new Sprite({ x: 10, y: 10, width: 8, height: 8 }));
  const shape = new Graphics({ staticCache: true });
  shape.rect(0, 0, 10, 10, { fill: 0xff0000 });
  scene.add(shape);
  const mask = new Texture({ source: { width: 4, height: 4 } });
  scene.add(new Sprite({ x: 30, y: 10, width: 8, height: 8, maskTexture: mask, filter: { type: "grayscale", amount: 1 } }));
  const clipped = new Node({ clipRect: { x: 0, y: 0, width: 16, height: 16 } });
  clipped.add(new Sprite({ x: 4, y: 4, width: 8, height: 8, blendMode: "additive" }));
  scene.add(clipped);
  const batch = new SpriteBatch({ texture: Texture.white, instanced: true, gpuCulling: true });
  for (let index = 0; index < 5; index += 1) batch.addSprite({ x: index * 6, y: 20, width: 4, height: 4 });
  scene.add(batch);
  const plainInstanced = new SpriteBatch({ texture: Texture.white, instanced: true });
  plainInstanced.addSprite({ x: 40, y: 20, width: 4, height: 4 });
  scene.add(plainInstanced);

  renderer.render(0, scene, new Camera({ width: 64, height: 32, x: 32, y: 16 }));
  assert.equal(renderer.lost, false);
  const calls = (name) => log.filter((entry) => entry[0] === "render" && entry[1] === name);
  assert.ok(calls("draw").length >= 4, "regular, static and plain instanced batches draw");
  assert.equal(calls("drawIndirect").length, 1, "the GPU-culled batch draws indirectly");
  assert.ok(log.some((entry) => entry[0] === "compute" && entry[1] === "dispatchWorkgroups"), "GPU culling dispatches compute work");
  assert.ok(calls("setScissorRect").some((entry) => entry[4] === 16 && entry[5] === 16), "the clip rect becomes a scissor");
  assert.ok(calls("setBindGroup").some((entry) => entry[2] === 3), "masked batches bind the mask texture");
  assert.equal(log.filter((entry) => entry[1] === "submit").length, 1);
  assert.ok(renderer.getInfo().drawCalls >= 5);

  // A second frame reuses the static buffer; destroying owners prunes their GPU resources.
  log.length = 0;
  renderer.render(1, scene, new Camera({ width: 64, height: 32, x: 32, y: 16 }));
  assert.equal(renderer.staticBuffers.size, 1);
  shape.destroy(); batch.destroy(); mask.destroy();
  renderer.render(2, scene, new Camera({ width: 64, height: 32, x: 32, y: 16 }));
  assert.equal(renderer.staticBuffers.size, 0, "static buffers of destroyed owners are released");
  assert.equal(renderer.gpuCullResources.size, 0, "GPU cull resources of destroyed batches are released");
  assert.equal(renderer.lost, false);
  renderer.destroy();
});

test("webgpu: readRenderTarget strips row padding from the mapped buffer", async () => {
  const log = [];
  const width = 3; const height = 2; const bytesPerRow = 256;
  const renderer = await builtRenderer(log, {
    mapped: (size) => {
      const bytes = new Uint8Array(size);
      for (let row = 0; row < height; row += 1) for (let index = 0; index < width * 4; index += 1) bytes[row * bytesPerRow + index] = row * 100 + index;
      return bytes.buffer;
    },
  });
  const target = new RenderTexture({ width, height });
  const result = await renderer.readRenderTarget(target);
  assert.equal(result.width, 3); assert.equal(result.height, 2); assert.equal(result.flipY, false);
  assert.equal(result.pixels.length, 24);
  assert.equal(result.pixels[0], 0); assert.equal(result.pixels[11], 11); assert.equal(result.pixels[12], 100); assert.equal(result.pixels[23], 111);
  assert.ok(log.some((entry) => entry[1] === "copyTextureToBuffer"));
  assert.ok(log.some((entry) => entry[0] === "buffer" && entry[1] === "destroy" && entry[2] === bytesPerRow * height), "the readback buffer is released");
  renderer.lost = true;
  await assert.rejects(renderer.readRenderTarget(target), /not available/);
  renderer.destroy();
});

test("webgpu: custom filters are compiled in the background and broken ones are disabled", async () => {
  const { registerFilter, listFilters } = await import("../../src/index.js");
  const log = [];
  const renderer = await builtRenderer(log, { compileErrors: (code) => code.includes("BROKEN_WGSL") });
  const glsl = "return color;";
  const existing = new Set(listFilters());
  const good = existing.has("gpu-good") ? "gpu-good" : registerFilter("gpu-good", { glsl, wgsl: "return color;" }).name;
  const broken = existing.has("gpu-broken") ? "gpu-broken" : registerFilter("gpu-broken", { glsl, wgsl: "let BROKEN_WGSL = 1.0; return color;" }).name;
  const before = renderer.pipelines;
  renderer.syncCustomFilters();
  assert.ok(renderer.customFilterSync, "a background rebuild starts");
  renderer.syncCustomFilters(); // a second call while it runs does nothing
  await renderer.customFilterSync;
  const status = renderer.getCustomFilterStatus();
  assert.equal(status[good].status, "ok");
  assert.equal(status[broken].status, "error");
  assert.match(status[broken].error, /did not compile/);
  assert.notEqual(renderer.pipelines, before, "the pipelines were rebuilt");
  assert.equal(renderer.getRenderPipeline(false, "unknown-mode"), renderer.pipelines.normal, "unknown modes fall back to normal");
  renderer.destroy();
});
