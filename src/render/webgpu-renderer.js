import { buildRenderBatches, collectRenderGroups, createRenderBatchState } from "./batch.js";
import { getScissorRect } from "./scissor.js";
import { GPU_SOURCE_STRIDE, INSTANCE_STRIDE } from "./instanced.js";
import { clearColorChannels, DEFAULT_CLEAR_COLOR, normalizeClearAlpha, normalizeClearColor } from "./clear.js";
import { filterMode } from "../core/node.js";
import { Texture } from "../assets/texture.js";
import { renderGroupWithPostProcess } from "./post-process.js";

const shaderSource = `
struct Frame { values: vec4f, };
struct Filter { values: vec4f, maskRect: vec4f, };
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var spriteTexture: texture_2d<f32>;
@group(1) @binding(1) var spriteSampler: sampler;
@group(2) @binding(0) var<uniform> filterParams: Filter;
@group(3) @binding(0) var maskTexture: texture_2d<f32>;
@group(3) @binding(1) var maskSampler: sampler;

@vertex
fn vertexMain(@location(0) position: vec2f, @location(1) uv: vec2f, @location(2) color: vec4f) -> VertexOutput {
  var output: VertexOutput;
  var clip = (position / frame.values.xy) * 2.0 - vec2f(1.0, 1.0);
  clip.y = -clip.y;
  output.position = vec4f(clip, 0.0, 1.0);
  output.uv = uv;
  output.color = color;
  return output;
}

@vertex
fn instancedVertexMain(@builtin(vertex_index) vertexIndex: u32, @location(0) origin: vec2f, @location(1) axisX: vec2f, @location(2) axisY: vec2f, @location(3) uvRect: vec4f, @location(4) color: vec4f) -> VertexOutput {
  let corners = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  let corner = corners[vertexIndex];
  let position = origin + axisX * corner.x + axisY * corner.y;
  var output: VertexOutput;
  var clip = (position / frame.values.xy) * 2.0 - vec2f(1.0, 1.0);
  clip.y = -clip.y;
  output.position = vec4f(clip, 0.0, 1.0);
  output.uv = mix(uvRect.xy, uvRect.zw, corner);
  output.color = color;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var color = textureSample(spriteTexture, spriteSampler, input.uv) * input.color;
  if (filterParams.values.x > 0.5 && filterParams.values.x < 1.5) {
    let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    color = vec4f(mix(color.rgb, vec3f(luminance), filterParams.values.y), color.a);
  } else if (filterParams.values.x > 1.5 && filterParams.values.x < 2.5) {
    color = vec4f(mix(color.rgb, vec3f(1.0) - color.rgb, filterParams.values.y), color.a);
  } else if (filterParams.values.x > 2.5 && filterParams.values.x < 3.5) {
    color = vec4f(color.rgb * (1.0 + filterParams.values.y), color.a);
  } else if (filterParams.values.x > 3.5 && filterParams.values.x < 4.5) {
    let sepia = vec3f(
      dot(color.rgb, vec3f(0.393, 0.769, 0.189)),
      dot(color.rgb, vec3f(0.349, 0.686, 0.168)),
      dot(color.rgb, vec3f(0.272, 0.534, 0.131))
    );
    color = vec4f(mix(color.rgb, sepia, filterParams.values.y), color.a);
  } else if (filterParams.values.x > 4.5 && filterParams.values.x < 5.5) {
    color = vec4f(clamp((color.rgb - vec3f(0.5)) * (1.0 + filterParams.values.y) + vec3f(0.5), vec3f(0.0), vec3f(1.0)), color.a);
  } else if (filterParams.values.x > 5.5) {
    let luminance = dot(color.rgb, vec3f(0.2126, 0.7152, 0.0722));
    color = vec4f(clamp(vec3f(luminance) + (color.rgb - vec3f(luminance)) * (1.0 + filterParams.values.y), vec3f(0.0), vec3f(1.0)), color.a);
  }
  if (filterParams.maskRect.z > 0.0 && filterParams.maskRect.w > 0.0) {
    let maskUv = (input.position.xy - filterParams.maskRect.xy) / filterParams.maskRect.zw;
    if (maskUv.x >= 0.0 && maskUv.x <= 1.0 && maskUv.y >= 0.0 && maskUv.y <= 1.0) {
      color *= textureSampleLevel(maskTexture, maskSampler, maskUv, 0.0).a;
    } else {
      color = vec4f(0.0);
    }
  }
  return color;
}
`;

const cullShaderSource = `
struct Params {
  viewport: vec4f,
  camera: vec4f,
  worldA: vec4f,
  worldB: vec4f,
  cameraPosition: vec2f,
  count: u32,
};
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read_write> outputData: array<f32>;
@group(0) @binding(2) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(3) var<uniform> params: Params;

fn project(point: vec2f) -> vec2f {
  let world = vec2f(params.worldA.x * point.x + params.worldA.y * point.y + params.worldA.z, params.worldB.x * point.x + params.worldB.y * point.y + params.worldB.z);
  let delta = world - params.cameraPosition;
  return params.viewport.zw + params.viewport.xy * 0.5 + vec2f((delta.x * params.camera.y - delta.y * params.camera.z) * params.camera.x, (delta.x * params.camera.z + delta.y * params.camera.y) * params.camera.x);
}

@compute @workgroup_size(64)
fn cullMain(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= params.count) { return; }
  let base = index * 16u;
  let spriteX = source[base]; let spriteY = source[base + 1u];
  let width = source[base + 2u]; let height = source[base + 3u];
  let anchorX = source[base + 4u]; let anchorY = source[base + 5u];
  let spriteCos = cos(source[base + 6u]); let spriteSin = sin(source[base + 6u]);
  let left = -width * anchorX; let top = -height * anchorY;
  let right = width * (1.0 - anchorX); let bottom = height * (1.0 - anchorY);
  let topLeft = project(vec2f(spriteX + left * spriteCos - top * spriteSin, spriteY + left * spriteSin + top * spriteCos));
  let topRight = project(vec2f(spriteX + right * spriteCos - top * spriteSin, spriteY + right * spriteSin + top * spriteCos));
  let bottomLeft = project(vec2f(spriteX + left * spriteCos - bottom * spriteSin, spriteY + left * spriteSin + bottom * spriteCos));
  let axisX = topRight - topLeft; let axisY = bottomLeft - topLeft; let corner = topLeft + axisX + axisY;
  let minX = min(topLeft.x, min(corner.x, min(topRight.x, bottomLeft.x)));
  let minY = min(topLeft.y, min(corner.y, min(topRight.y, bottomLeft.y)));
  let maxX = max(topLeft.x, max(corner.x, max(topRight.x, bottomLeft.x)));
  let maxY = max(topLeft.y, max(corner.y, max(topRight.y, bottomLeft.y)));
  if (maxX < params.viewport.z || minX > params.viewport.z + params.viewport.x || maxY < params.viewport.w || minY > params.viewport.w + params.viewport.y) { return; }
  let outputBase = atomicAdd(&visibleCount, 1u) * 14u;
  outputData[outputBase] = topLeft.x; outputData[outputBase + 1u] = topLeft.y;
  outputData[outputBase + 2u] = axisX.x; outputData[outputBase + 3u] = axisX.y;
  outputData[outputBase + 4u] = axisY.x; outputData[outputBase + 5u] = axisY.y;
  outputData[outputBase + 6u] = source[base + 8u]; outputData[outputBase + 7u] = source[base + 9u];
  outputData[outputBase + 8u] = source[base + 10u]; outputData[outputBase + 9u] = source[base + 11u];
  outputData[outputBase + 10u] = source[base + 12u]; outputData[outputBase + 11u] = source[base + 13u];
  outputData[outputBase + 12u] = source[base + 14u]; outputData[outputBase + 13u] = source[base + 7u];
}
`;

const indirectShaderSource = `
@group(0) @binding(0) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> arguments: array<u32>;

@compute @workgroup_size(1)
fn writeIndirectMain() {
  arguments[0] = 6u;
  arguments[1] = atomicLoad(&visibleCount);
  arguments[2] = 0u;
  arguments[3] = 0u;
  arguments[4] = 0u;
}
`;

const bufferUsage = globalThis.GPUBufferUsage || { MAP_READ: 0x0001, COPY_DST: 0x0008, VERTEX: 0x0020, UNIFORM: 0x0040, STORAGE: 0x0080, INDIRECT: 0x0100 };
const textureUsage = globalThis.GPUTextureUsage || { COPY_SRC: 0x0001, COPY_DST: 0x0002, TEXTURE_BINDING: 0x0004, RENDER_ATTACHMENT: 0x0010 };
const MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 512 * 1024 * 1024;
const MAX_TEXTURE_COUNT = 4_096;
const MAX_INSTANCE_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_GPU_CULL_MEMORY_BYTES = 64 * 1024 * 1024;
const FILTER_UNIFORM_STRIDE = 256;
const MAX_FILTER_BUFFER_BYTES = 16 * 1024 * 1024;
const RENDER_INPUT_ERROR = "EXI_RENDER_INPUT";

function isRenderInputError(error) {
  return error?.code === RENDER_INPUT_ERROR || error?.code === "EXI_RENDER_TARGET_INPUT" || error?.code === "EXI_RENDER_TEXTURE_FEEDBACK" || error?.code === "EXI_TEXTURE_INPUT" || error?.code === "EXI_TEXTURE_BUDGET" || error instanceof RangeError;
}

function assertLiveTexture(texture) {
  if (!texture || texture.destroyed || texture.baseTexture?.destroyed) {
    const error = new TypeError("Canlı Texture gerekli.");
    error.code = "EXI_TEXTURE_INPUT";
    throw error;
  }
  return texture.baseTexture || texture;
}

export class WebGPURenderer {
  constructor({ canvas, onLost = () => {}, onStatus = () => {}, clearColor = DEFAULT_CLEAR_COLOR, clearAlpha = 1, clearBeforeRender = true, maxTextureBytes = 128 * 1024 * 1024, maxTextureCount = 4_096 }) {
    this.canvas = canvas;
    this.onLost = onLost;
    this.onStatus = onStatus;
    this.clearColor = normalizeClearColor(clearColor);
    this.clearAlpha = normalizeClearAlpha(clearAlpha);
    this.clearBeforeRender = clearBeforeRender !== false;
    this.clearRGBA = clearColorChannels(this.clearColor, this.clearAlpha);
    this.adapter = null;
    this.device = null;
    this.context = null;
    this.pipeline = null;
    this.instancedPipeline = null;
    this.pipelines = { normal: null, additive: null, multiply: null };
    this.instancedPipelines = { normal: null, additive: null, multiply: null };
    this.cullPipeline = null;
    this.indirectPipeline = null;
    this.cullLayout = null;
    this.indirectLayout = null;
    this.frameBuffer = null;
    this.filterBuffer = null;
    this.filterBufferSize = 0;
    this.filterBufferResizes = 0;
    this.filterBindGroup = null;
    this.filterValues = new Float32Array(8);
    this.vertexBuffer = null;
    this.vertexBufferSize = 0;
    this.vertexBufferResizes = 0;
    this.instanceBuffer = null;
    this.instanceBufferSize = 0;
    this.instanceBufferResizes = 0;
    this.gpuCullResources = new Map();
    this.gpuCullBytes = 0;
    this.gpuCullBufferResizes = 0;
    this.frameBindGroup = null;
    this.filterLayout = null;
    this.textureLayout = null;
    this.sampler = null;
    this.samplers = { linear: null, nearest: null };
    this.textureBinds = new Map();
    this.renderTargets = new Map();
    if (!Number.isSafeInteger(maxTextureBytes) || maxTextureBytes <= 0 || maxTextureBytes > MAX_TEXTURE_BYTES) throw new RangeError("WebGPU texture byte bütçesi geçersiz.");
    if (!Number.isSafeInteger(maxTextureCount) || maxTextureCount <= 0 || maxTextureCount > MAX_TEXTURE_COUNT) throw new RangeError("WebGPU texture sayısı bütçesi geçersiz.");
    this.maxTextureBytes = maxTextureBytes;
    this.maxTextureCount = maxTextureCount;
    this.textureBytes = 0;
    this.textureByteSizes = new Map();
    this.maxTexturePixels = MAX_TEXTURE_PIXELS;
    this.maxBufferSize = MAX_INSTANCE_BUFFER_BYTES;
    this.maxStorageBufferBindingSize = MAX_INSTANCE_BUFFER_BYTES;
    this.maxVertexBufferBytes = MAX_INSTANCE_BUFFER_BYTES;
    this.maxInstanceBufferBytes = MAX_INSTANCE_BUFFER_BYTES;
    this.maxGpuCullBufferBytes = MAX_INSTANCE_BUFFER_BYTES;
    this.maxGpuCullMemoryBytes = MAX_GPU_CULL_MEMORY_BYTES;
    this._maxTextureBytesCapacity = maxTextureBytes;
    this._maxTextureCountCapacity = maxTextureCount;
    this._maxTexturePixelsCapacity = MAX_TEXTURE_PIXELS;
    this._deviceLimitSnapshot = null;
    this.textureUploads = 0;
    this.textureUploadBytes = 0;
    this.staticBuffers = new Map();
    this.staticBufferResizes = 0;
    this.frameValues = new Float32Array(4);
    this.gpuCullCounterValue = new Uint32Array(1);
    this.gpuCullParams = new Float32Array(20);
    this.gpuCullInstanceCount = new Uint32Array(1);
    this.scissorRect = { x: 0, y: 0, width: 0, height: 0 };
    this.format = null;
    this.destroyed = false;
    this.lost = false;
    this.batchState = createRenderBatchState();
    this.renderGroups = this.batchState.renderGroups;
    this.metrics = { drawCalls: 0, batchCount: 0, vertexCount: 0, instanceCount: 0, instancedBatchCount: 0, gpuCullingBatchCount: 0, instanceDataBytes: 0, nodeCount: 0, culledCount: 0, scissorCount: 0, renderGroupPassCount: 0, postProcessPassCount: 0 };
    this.info = {};
    this.handleDeviceLost = (info = {}) => {
      if (this.destroyed || this.lost) return;
      this.lost = true;
      this.releaseGpuResources();
      const reason = info.message || info.reason || "unknown";
      this.onStatus({ type: "device-lost", backend: "webgpu", reason });
      const error = new Error(`WebGPU device kaybedildi: ${reason}`);
      error.backend = "webgpu";
      error.recoverable = false;
      error.reason = reason;
      this.onLost(error);
    };
    this.handleUncapturedError = (event) => {
      if (this.destroyed) return;
      this.onStatus({ type: "device-error", backend: "webgpu", message: event.error?.message || "GPU hatası" });
    };
  }

  async init() {
    try {
    if (this.destroyed) throw new Error("WebGPU renderer yok edilmiş.");
    if (!globalThis.navigator?.gpu) throw new Error("WebGPU bu tarayıcıda kullanılamıyor.");
    this.adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (this.destroyed) throw new Error("WebGPU renderer yok edilmiş.");
    if (!this.adapter) throw new Error("WebGPU adapter bulunamadı.");
    this.device = await this.adapter.requestDevice();
    if (this.destroyed) throw new Error("WebGPU renderer yok edilmiş.");
    this.refreshDeviceLimits();
    this.device.addEventListener("uncapturederror", this.handleUncapturedError);
    this.device.lost.then(this.handleDeviceLost);
    this.context = this.canvas.getContext("webgpu");
    if (!this.context) throw new Error("WebGPU canvas context oluşturulamadı.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.configure();
    await this.buildResources();
    if (this.destroyed) throw new Error("WebGPU renderer yok edilmiş.");
    this.onStatus({ type: "backend-ready", backend: "webgpu" });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  configure() { this.context.configure({ device: this.device, format: this.format, alphaMode: this.clearAlpha < 1 ? "premultiplied" : "opaque" }); }

  refreshDeviceLimits() {
    const limits = this.device?.limits || {};
    const safeLimit = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
    this.maxBufferSize = Math.min(MAX_INSTANCE_BUFFER_BYTES, safeLimit(limits.maxBufferSize, MAX_INSTANCE_BUFFER_BYTES));
    this.maxStorageBufferBindingSize = Math.min(MAX_INSTANCE_BUFFER_BYTES, safeLimit(limits.maxStorageBufferBindingSize, MAX_INSTANCE_BUFFER_BYTES));
    this.maxVertexBufferBytes = this.maxBufferSize;
    this.maxInstanceBufferBytes = Math.min(MAX_INSTANCE_BUFFER_BYTES, this.maxBufferSize);
    this.maxGpuCullBufferBytes = Math.min(MAX_INSTANCE_BUFFER_BYTES, this.maxBufferSize, this.maxStorageBufferBindingSize);
    this.maxGpuCullMemoryBytes = Math.min(MAX_GPU_CULL_MEMORY_BYTES, this.maxGpuCullBufferBytes * 2);
    this._deviceLimitSnapshot = {
      maxBufferSize: this.maxBufferSize,
      maxStorageBufferBindingSize: this.maxStorageBufferBindingSize,
      maxVertexBufferBytes: this.maxVertexBufferBytes,
      maxInstanceBufferBytes: this.maxInstanceBufferBytes,
      maxGpuCullBufferBytes: this.maxGpuCullBufferBytes,
      maxGpuCullMemoryBytes: this.maxGpuCullMemoryBytes,
    };
  }

  async buildResources() {
    let errorScopeOpen = false;
    this.device.pushErrorScope("validation");
    errorScopeOpen = true;
    try {
    const module = this.device.createShaderModule({ code: shaderSource });
    const frameLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 1, buffer: { type: "uniform" } }] });
    this.textureLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: "float" } },
      { binding: 1, visibility: 2, sampler: { type: "filtering" } },
    ] });
    const filterLayout = this.device.createBindGroupLayout({ entries: [{ binding: 0, visibility: 2, buffer: { type: "uniform", hasDynamicOffset: true } }] });
    this.filterLayout = filterLayout;
    const pipelineLayout = this.device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.textureLayout, filterLayout, this.textureLayout] });
    const blendStates = {
      normal: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
      additive: { color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
      multiply: { color: { srcFactor: "dst", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } },
    };
    const regularVertex = {
      module,
      entryPoint: "vertexMain",
      buffers: [{ arrayStride: 32, attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x4" },
      ] }],
    };
    const instancedVertex = {
      module,
      entryPoint: "instancedVertexMain",
      buffers: [{ arrayStride: INSTANCE_STRIDE, stepMode: "instance", attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x2" },
        { shaderLocation: 1, offset: 8, format: "float32x2" },
        { shaderLocation: 2, offset: 16, format: "float32x2" },
        { shaderLocation: 3, offset: 24, format: "float32x4" },
        { shaderLocation: 4, offset: 40, format: "float32x4" },
      ] }],
    };
    this.pipelines = { normal: null, additive: null, multiply: null };
    this.instancedPipelines = { normal: null, additive: null, multiply: null };
    for (const [mode, blend] of Object.entries(blendStates)) {
      this.pipelines[mode] = this.device.createRenderPipeline({ layout: pipelineLayout, vertex: regularVertex, fragment: { module, entryPoint: "fragmentMain", targets: [{ format: this.format, blend }] }, primitive: { topology: "triangle-list" } });
      this.instancedPipelines[mode] = this.device.createRenderPipeline({ layout: pipelineLayout, vertex: instancedVertex, fragment: { module, entryPoint: "fragmentMain", targets: [{ format: this.format, blend }] }, primitive: { topology: "triangle-list" } });
    }
    this.pipeline = this.pipelines.normal;
    this.instancedPipeline = this.instancedPipelines.normal;
    const cullModule = this.device.createShaderModule({ code: cullShaderSource });
    const indirectModule = this.device.createShaderModule({ code: indirectShaderSource });
    this.cullLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 4, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: 4, buffer: { type: "storage" } },
      { binding: 2, visibility: 4, buffer: { type: "storage" } },
      { binding: 3, visibility: 4, buffer: { type: "uniform" } },
    ] });
    this.indirectLayout = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 4, buffer: { type: "storage" } },
      { binding: 1, visibility: 4, buffer: { type: "storage" } },
    ] });
    this.cullPipeline = this.device.createComputePipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.cullLayout] }), compute: { module: cullModule, entryPoint: "cullMain" } });
    this.indirectPipeline = this.device.createComputePipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.indirectLayout] }), compute: { module: indirectModule, entryPoint: "writeIndirectMain" } });
    this.frameBuffer = this.device.createBuffer({ size: 16, usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST });
    this.frameBindGroup = this.device.createBindGroup({ layout: frameLayout, entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }] });
    this.samplers.linear = this.device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.samplers.nearest = this.device.createSampler({ magFilter: "nearest", minFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
    this.sampler = this.samplers.linear;
    const error = await this.device.popErrorScope();
    errorScopeOpen = false;
    if (error) throw new Error(`WebGPU pipeline doğrulanamadı: ${error.message}`);
    } catch (error) {
      if (errorScopeOpen) {
        try { await this.device.popErrorScope(); } catch {}
      }
      try { this.releaseGpuResources(); } catch {}
      throw error;
    }
  }

  resize() { if (this.device && this.context && this.format) this.configure(); }

  pruneDestroyedTextures() {
    for (const [texture, value] of this.textureBinds) {
      if (!texture.destroyed) continue;
      value.texture.destroy();
      this.textureBinds.delete(texture);
      this.renderTargets.delete(texture);
      this.textureBytes = Math.max(0, this.textureBytes - (this.textureByteSizes.get(texture) || 0));
      this.textureByteSizes.delete(texture);
    }
  }

  getSampler(filter) { return this.samplers?.[filter === "nearest" ? "nearest" : "linear"] || this.sampler; }

  createTextureBindGroup(gpuTexture, filter) {
    return this.device.createBindGroup({ layout: this.textureLayout, entries: [
      { binding: 0, resource: gpuTexture.createView() },
      { binding: 1, resource: this.getSampler(filter) },
    ] });
  }

  getRenderPipeline(instanced, mode) {
    const pipelines = instanced ? this.instancedPipelines : this.pipelines;
    return pipelines?.[mode] || pipelines?.normal || (instanced ? this.instancedPipeline : this.pipeline);
  }

  pruneStaticBuffers() {
    for (const [owner, entry] of this.staticBuffers) {
      if (!owner.destroyed) continue;
      entry.buffer.destroy();
      this.staticBuffers.delete(owner);
    }
  }

  ensureVertexBuffer(bytes) {
    this.assertResourceBudget();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("WebGPU vertex buffer device limit exceeded.");
    if (bytes <= this.vertexBufferSize) return;
    if (bytes > this.maxVertexBufferBytes) throw new RangeError("WebGPU vertex buffer device limit exceeded.");
    const size = Math.min(this.maxVertexBufferBytes, Math.max(4096, 2 ** Math.ceil(Math.log2(bytes))));
    if (size > this.maxVertexBufferBytes) throw new RangeError("WebGPU vertex buffer device limit exceeded.");
    if (size < bytes) throw new Error("WebGPU batch buffer limiti aşıldı.");
    const nextBuffer = this.device.createBuffer({ size, usage: bufferUsage.VERTEX | bufferUsage.COPY_DST });
    this.vertexBuffer?.destroy();
    this.vertexBuffer = nextBuffer;
    this.vertexBufferSize = size;
    this.vertexBufferResizes += 1;
  }

  ensureInstanceBuffer(bytes) {
    this.assertResourceBudget();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("WebGPU instanced batch device limit exceeded.");
    if (bytes <= this.instanceBufferSize) return;
    if (bytes > MAX_INSTANCE_BUFFER_BYTES) throw new RangeError("WebGPU instanced batch buffer limiti aÅŸÄ±ldÄ±.");
    if (bytes > this.maxInstanceBufferBytes) throw new RangeError("WebGPU instanced batch device limit exceeded.");
    const size = Math.min(this.maxInstanceBufferBytes, Math.max(4096, 2 ** Math.ceil(Math.log2(bytes))));
    if (size > this.maxInstanceBufferBytes) throw new RangeError("WebGPU instanced batch device limit exceeded.");
    if (size < bytes) throw new Error("WebGPU instanced batch buffer limiti aÅŸÄ±ldÄ±.");
    const nextBuffer = this.device.createBuffer({ size, usage: bufferUsage.VERTEX | bufferUsage.COPY_DST });
    this.instanceBuffer?.destroy();
    this.instanceBuffer = nextBuffer;
    this.instanceBufferSize = size;
    this.instanceBufferResizes += 1;
  }

  ensureFilterBuffer(batchCount) {
    this.assertResourceBudget();
    if (!Number.isSafeInteger(batchCount) || batchCount < 0) throw new RangeError("WebGPU filter batch sayısı geçersiz.");
    const required = batchCount * FILTER_UNIFORM_STRIDE;
    if (required === 0) return;
    const maxBytes = Math.min(MAX_FILTER_BUFFER_BYTES, this.maxBufferSize);
    if (!Number.isSafeInteger(required) || required > maxBytes) throw new RangeError("WebGPU filter buffer limiti aşıldı.");
    if (required <= this.filterBufferSize && this.filterBindGroup) return;
    const size = Math.min(maxBytes, Math.max(FILTER_UNIFORM_STRIDE, 2 ** Math.ceil(Math.log2(required))));
    if (size < required) throw new RangeError("WebGPU filter buffer limiti aşıldı.");
    let nextBuffer = null;
    let nextBindGroup = null;
    try {
      nextBuffer = this.device.createBuffer({ size, usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST });
      nextBindGroup = this.device.createBindGroup({ layout: this.filterLayout, entries: [{ binding: 0, resource: { buffer: nextBuffer, size: 32 } }] });
    } catch (error) {
      nextBuffer?.destroy?.();
      throw error;
    }
    this.filterBuffer?.destroy();
    this.filterBuffer = nextBuffer;
    this.filterBindGroup = nextBindGroup;
    this.filterBufferSize = size;
    this.filterBufferResizes += 1;
  }

  releaseGpuCullResources() {
    for (const resource of this.gpuCullResources.values()) {
      resource.input?.destroy(); resource.output?.destroy(); resource.counter?.destroy(); resource.arguments?.destroy(); resource.params?.destroy();
    }
    this.gpuCullResources.clear();
    this.gpuCullBytes = 0;
  }

  releaseGpuResources() {
    this.releaseGpuCullResources();
    for (const value of this.textureBinds.values()) value.texture?.destroy?.();
    for (const entry of this.staticBuffers.values()) entry.buffer?.destroy?.();
    this.frameBuffer?.destroy?.();
    this.filterBuffer?.destroy?.();
    this.vertexBuffer?.destroy?.();
    this.instanceBuffer?.destroy?.();
    this.textureBinds.clear();
    this.renderTargets.clear();
    this.textureByteSizes.clear();
    this.textureBytes = 0;
    this.staticBuffers.clear();
    this.frameBuffer = null;
    this.filterBuffer = null;
    this.filterBufferSize = 0;
    this.filterBindGroup = null;
    this.vertexBuffer = null;
    this.instanceBuffer = null;
    this.vertexBufferSize = 0;
    this.instanceBufferSize = 0;
    this.frameBindGroup = null;
    this.sampler = null;
    this.samplers.linear = null;
    this.samplers.nearest = null;
    this.textureLayout = null;
    this.filterLayout = null;
    this.cullLayout = null;
    this.indirectLayout = null;
    this.pipeline = null;
    this.instancedPipeline = null;
    this.pipelines = { normal: null, additive: null, multiply: null };
    this.instancedPipelines = { normal: null, additive: null, multiply: null };
    this.cullPipeline = null;
    this.indirectPipeline = null;
  }

  pruneGpuCullResources() {
    for (const [owner, resource] of this.gpuCullResources) {
      if (!owner.destroyed) continue;
      resource.input?.destroy(); resource.output?.destroy(); resource.counter?.destroy(); resource.arguments?.destroy(); resource.params?.destroy();
      this.gpuCullBytes -= resource.inputSize + resource.outputSize;
      this.gpuCullResources.delete(owner);
    }
  }

  ensureGpuCullResources(batch) {
    this.assertResourceBudget();
    if (!Number.isSafeInteger(batch.instanceCount) || batch.instanceCount <= 0) throw new RangeError("WebGPU GPU culling instance sayÄ±sÄ± geÃ§ersiz.");
    const owner = batch.gpuOwner || batch;
    if (!(batch.instanceData instanceof Float32Array)) throw new TypeError("WebGPU GPU culling instance data must be Float32Array.");
    const sourceStride = batch.instanceStride === undefined ? GPU_SOURCE_STRIDE / Float32Array.BYTES_PER_ELEMENT : batch.instanceStride;
    const sourceBytes = batch.instanceCount * sourceStride * Float32Array.BYTES_PER_ELEMENT;
    const outputBytes = batch.instanceCount * INSTANCE_STRIDE;
    if (sourceStride !== GPU_SOURCE_STRIDE / Float32Array.BYTES_PER_ELEMENT) throw new RangeError("WebGPU GPU culling instance stride invalid.");
    if (!Number.isSafeInteger(sourceBytes) || !Number.isSafeInteger(outputBytes) || sourceBytes <= 0 || outputBytes <= 0) throw new RangeError("WebGPU GPU culling batch size invalid.");
    if (sourceBytes > this.maxGpuCullBufferBytes || outputBytes > this.maxGpuCullBufferBytes) throw new RangeError("WebGPU GPU culling device limit exceeded.");
    if (sourceBytes !== batch.instanceData.byteLength) throw new RangeError("WebGPU GPU culling instance stride invalid.");
    let resource = this.gpuCullResources.get(owner);
    const isNewResource = !resource;
    if (!resource) {
      resource = { input: null, output: null, counter: null, arguments: null, params: null, inputSize: 0, outputSize: 0, cullBindGroup: null, indirectBindGroup: null };
    }
    if (sourceBytes !== batch.instanceData.byteLength) throw new RangeError("WebGPU GPU culling instance stride geÃ§ersiz.");
    if (sourceBytes > this.maxGpuCullBufferBytes || outputBytes > this.maxGpuCullBufferBytes) throw new RangeError("WebGPU GPU culling device limiti aÅŸÄ±ldÄ±.");
    const needsNewBuffers = sourceBytes > resource.inputSize || outputBytes > resource.outputSize;
    const inputSize = needsNewBuffers ? Math.min(this.maxGpuCullBufferBytes, Math.max(4096, 2 ** Math.ceil(Math.log2(sourceBytes)))) : resource.inputSize;
    const outputSize = needsNewBuffers ? Math.min(this.maxGpuCullBufferBytes, Math.max(4096, 2 ** Math.ceil(Math.log2(outputBytes)))) : resource.outputSize;
    if (inputSize < sourceBytes || outputSize < outputBytes) throw new RangeError("WebGPU GPU culling device limit exceeded.");
    const projectedBytes = this.gpuCullBytes - resource.inputSize - resource.outputSize + inputSize + outputSize;
    if (projectedBytes > this.maxGpuCullMemoryBytes) throw new RangeError("WebGPU toplam GPU culling bellek limiti aÅŸÄ±ldÄ±.");
    const previousInput = resource.input;
    const previousOutput = resource.output;
    const previousCounter = resource.counter;
    const previousArguments = resource.arguments;
    const previousParams = resource.params;
    let nextInput = previousInput;
    let nextOutput = previousOutput;
    let nextCounter = previousCounter;
    let nextArguments = previousArguments;
    let nextParams = previousParams;
    let nextCullBindGroup = resource.cullBindGroup;
    let nextIndirectBindGroup = resource.indirectBindGroup;
    const created = [];
    try {
      if (needsNewBuffers) {
        nextInput = this.device.createBuffer({ size: inputSize, usage: bufferUsage.STORAGE | bufferUsage.COPY_DST });
        created.push(nextInput);
        nextOutput = this.device.createBuffer({ size: outputSize, usage: bufferUsage.STORAGE | bufferUsage.VERTEX | bufferUsage.COPY_DST });
        created.push(nextOutput);
        nextCullBindGroup = null;
      }
      if (!nextCounter) { nextCounter = this.device.createBuffer({ size: 4, usage: bufferUsage.STORAGE | bufferUsage.COPY_DST }); created.push(nextCounter); }
      if (!nextArguments) { nextArguments = this.device.createBuffer({ size: 20, usage: bufferUsage.STORAGE | bufferUsage.INDIRECT | bufferUsage.COPY_DST }); created.push(nextArguments); }
      if (!nextParams) { nextParams = this.device.createBuffer({ size: 80, usage: bufferUsage.UNIFORM | bufferUsage.COPY_DST }); created.push(nextParams); }
      if (!nextCullBindGroup) nextCullBindGroup = this.device.createBindGroup({ layout: this.cullLayout, entries: [
        { binding: 0, resource: { buffer: nextInput } },
        { binding: 1, resource: { buffer: nextOutput } },
        { binding: 2, resource: { buffer: nextCounter } },
        { binding: 3, resource: { buffer: nextParams } },
      ] });
      if (!nextIndirectBindGroup) nextIndirectBindGroup = this.device.createBindGroup({ layout: this.indirectLayout, entries: [
        { binding: 0, resource: { buffer: nextCounter } },
        { binding: 1, resource: { buffer: nextArguments } },
      ] });
    } catch (error) {
      for (const handle of created) handle?.destroy?.();
      throw error;
    }
    if (needsNewBuffers) {
      previousInput?.destroy?.(); previousOutput?.destroy?.();
      this.gpuCullBytes = projectedBytes;
      this.gpuCullBufferResizes += 1;
    }
    resource.input = nextInput; resource.output = nextOutput;
    resource.counter = nextCounter; resource.arguments = nextArguments; resource.params = nextParams;
    resource.inputSize = inputSize; resource.outputSize = outputSize;
    resource.cullBindGroup = nextCullBindGroup; resource.indirectBindGroup = nextIndirectBindGroup;
    if (isNewResource) this.gpuCullResources.set(owner, resource);
    return resource;
  }

  encodeGpuCull(encoder, batch, camera, width = this.canvas.width, height = this.canvas.height) {
    const resource = this.ensureGpuCullResources(batch);
    this.device.queue.writeBuffer(resource.input, 0, batch.instanceData);
    this.gpuCullCounterValue[0] = 0;
    this.device.queue.writeBuffer(resource.counter, 0, this.gpuCullCounterValue);
    const cameraCos = Math.cos(-camera.rotation); const cameraSin = Math.sin(-camera.rotation);
    const params = this.gpuCullParams;
    params[0] = Number(camera.viewportWidth) || width; params[1] = Number(camera.viewportHeight) || height; params[2] = Number(camera.viewportX) || 0; params[3] = Number(camera.viewportY) || 0;
    params[4] = camera.zoom * (Number(camera.pixelRatio) || 1); params[5] = cameraCos; params[6] = cameraSin; params[7] = 0;
    params[8] = batch.gpuOwner.worldMatrix.a; params[9] = batch.gpuOwner.worldMatrix.c; params[10] = batch.gpuOwner.worldMatrix.tx; params[11] = 0;
    params[12] = batch.gpuOwner.worldMatrix.b; params[13] = batch.gpuOwner.worldMatrix.d; params[14] = batch.gpuOwner.worldMatrix.ty; params[15] = 0;
    params[16] = camera.position.x; params[17] = camera.position.y; params[18] = 0; params[19] = 0;
    this.device.queue.writeBuffer(resource.params, 0, params);
    this.gpuCullInstanceCount[0] = batch.instanceCount;
    this.device.queue.writeBuffer(resource.params, 72, this.gpuCullInstanceCount);
    const cullPass = encoder.beginComputePass();
    cullPass.setPipeline(this.cullPipeline);
    cullPass.setBindGroup(0, resource.cullBindGroup);
    cullPass.dispatchWorkgroups(Math.ceil(batch.instanceCount / 64));
    cullPass.end();
    const indirectPass = encoder.beginComputePass();
    indirectPass.setPipeline(this.indirectPipeline);
    indirectPass.setBindGroup(0, resource.indirectBindGroup);
    indirectPass.dispatchWorkgroups(1);
    indirectPass.end();
    return resource;
  }

  ensureStaticBuffer(batch) {
    this.assertResourceBudget();
    const bytes = batch.data.byteLength;
    if (!Number.isSafeInteger(bytes) || bytes > this.maxVertexBufferBytes) throw new RangeError("WebGPU static batch buffer device limit exceeded.");
    let entry = this.staticBuffers.get(batch.staticOwner);
    if (!entry) entry = { buffer: null, size: 0, key: null };
    if (!entry.buffer || bytes > entry.size) {
      const size = Math.min(this.maxVertexBufferBytes, Math.max(4096, 2 ** Math.ceil(Math.log2(bytes))));
      if (size > this.maxVertexBufferBytes) throw new RangeError("WebGPU static batch buffer device limit exceeded.");
      if (size < bytes) throw new Error("WebGPU static batch buffer limiti aÅŸÄ±ldÄ±.");
      let nextBuffer = null;
      try {
        nextBuffer = this.device.createBuffer({ size, usage: bufferUsage.VERTEX | bufferUsage.COPY_DST });
        this.device.queue.writeBuffer(nextBuffer, 0, batch.data);
      } catch (error) {
        nextBuffer?.destroy?.();
        throw error;
      }
      entry.buffer?.destroy();
      entry.buffer = nextBuffer;
      entry.size = size;
      entry.key = batch.staticKey;
      this.staticBuffers.set(batch.staticOwner, entry);
      this.staticBufferResizes += 1;
    } else if (entry.key !== batch.staticKey) {
      this.device.queue.writeBuffer(entry.buffer, 0, batch.data);
      entry.key = batch.staticKey;
    }
    return entry.buffer;
  }

  createTexture(texture) {
    this.assertResourceBudget();
    if (texture?.renderTarget) return this.ensureRenderTarget(texture);
    const baseTexture = assertLiveTexture(texture);
    const existing = this.textureBinds.get(baseTexture);
    if (existing) return existing;
    const width = Number(baseTexture.sourceWidth); const height = Number(baseTexture.sourceHeight);
    const maxSize = Number(this.device.limits?.maxTextureDimension2D) || Infinity;
    if (baseTexture.source && (Number(baseTexture.source.width) !== width || Number(baseTexture.source.height) !== height)) throw new RangeError("WebGPU texture source size mismatch.");
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > maxSize || height > maxSize || width * height > this.maxTexturePixels) throw new RangeError("WebGPU texture boyutu/pixel limiti aÅŸÄ±ldÄ±.");
    const hasSource = Boolean(baseTexture.source);
    const allocationBytes = hasSource ? width * height * 4 : 4;
    this.assertTextureBudget(allocationBytes);
    const gpuTexture = this.device.createTexture({ size: hasSource ? [baseTexture.sourceWidth, baseTexture.sourceHeight, 1] : [1, 1, 1], format: "rgba8unorm", usage: textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST | textureUsage.RENDER_ATTACHMENT });
    try {
      if (baseTexture.source) this.device.queue.copyExternalImageToTexture({ source: baseTexture.source }, { texture: gpuTexture }, { width: baseTexture.sourceWidth, height: baseTexture.sourceHeight });
      else this.device.queue.writeTexture({ texture: gpuTexture }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, { width: 1, height: 1, depthOrArrayLayers: 1 });
      const filter = baseTexture.filter === "nearest" ? "nearest" : "linear";
      const bindGroup = this.createTextureBindGroup(gpuTexture, filter);
      const value = { texture: gpuTexture, bindGroup, version: baseTexture.version, filter };
      this.textureBinds.set(baseTexture, value);
      this.textureByteSizes.set(baseTexture, allocationBytes);
      this.textureBytes += allocationBytes;
      this.textureUploads += 1;
      this.textureUploadBytes += hasSource ? width * height * 4 : 4;
      return value;
    } catch (error) {
      gpuTexture?.destroy?.();
      throw error;
    }
  }

  updateTexture(texture, value) {
    const baseTexture = assertLiveTexture(texture);
    const filter = baseTexture.filter === "nearest" ? "nearest" : "linear";
    if (value.filter !== filter) {
      value.bindGroup = this.createTextureBindGroup(value.texture, filter);
      value.filter = filter;
    }
    if (value.version === baseTexture.version) return;
    if (baseTexture.source && (Number(baseTexture.source.width) !== baseTexture.sourceWidth || Number(baseTexture.source.height) !== baseTexture.sourceHeight)) throw new RangeError("WebGPU texture source size mismatch.");
    if (baseTexture.source) {
      this.device.queue.copyExternalImageToTexture({ source: baseTexture.source }, { texture: value.texture }, { width: baseTexture.sourceWidth, height: baseTexture.sourceHeight });
      this.textureUploads += 1;
      this.textureUploadBytes += baseTexture.sourceWidth * baseTexture.sourceHeight * 4;
    }
    value.version = baseTexture.version;
  }

  getTextureValue(texture) {
    const key = texture?.renderTarget ? texture : assertLiveTexture(texture);
    const value = this.textureBinds.get(key) || this.createTexture(texture);
    this.updateTexture(key, value);
    return value;
  }

  assertTextureBudget(addBytes, replaceBytes = 0, replaceCount = 0) {
    this.assertResourceBudget();
    const projectedBytes = this.textureBytes - replaceBytes + addBytes;
    const projectedCount = this.textureBinds.size - replaceCount + 1;
    if (!Number.isSafeInteger(projectedBytes) || projectedBytes > this.maxTextureBytes || projectedCount > this.maxTextureCount) {
      const error = new RangeError("WebGPU toplam texture bütçesi aşıldı.");
      error.code = "EXI_TEXTURE_BUDGET";
      throw error;
    }
  }

  ensureRenderTarget(target) {
    this.assertResourceBudget();
    if (!target?.renderTarget || target.destroyed) {
      const error = new TypeError("Geçerli bir RenderTexture gerekli.");
      error.code = "EXI_RENDER_TARGET_INPUT";
      throw error;
    }
    const width = Number(target.width); const height = Number(target.height);
    const maxSize = Number(this.device?.limits?.maxTextureDimension2D) || Infinity;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > maxSize || height > maxSize || width * height > this.maxTexturePixels) {
      const error = new RangeError("WebGPU RenderTexture boyutu/pixel limiti aşıldı.");
      error.code = "EXI_RENDER_TARGET_INPUT";
      throw error;
    }
    const current = this.renderTargets.get(target);
    if (current && current.width === width && current.height === height) return current;
    const currentBytes = current ? (this.textureByteSizes.get(target) || current.width * current.height * 4) : 0;
    const allocationBytes = width * height * 4;
    this.assertTextureBudget(allocationBytes, currentBytes, current ? 1 : 0);
    let gpuTexture = null;
    try {
      gpuTexture = this.device.createTexture({ size: [width, height, 1], format: this.format || "rgba8unorm", usage: textureUsage.COPY_SRC | textureUsage.TEXTURE_BINDING | textureUsage.COPY_DST | textureUsage.RENDER_ATTACHMENT });
      const filter = target.filter === "nearest" ? "nearest" : "linear";
      const value = { texture: gpuTexture, bindGroup: this.createTextureBindGroup(gpuTexture, filter), version: target.version, filter };
      const entry = { ...value, view: gpuTexture.createView(), width, height };
      if (current) {
        current.texture.destroy();
        this.renderTargets.delete(target);
        this.textureBinds.delete(target);
        this.textureBytes = Math.max(0, this.textureBytes - currentBytes);
        this.textureByteSizes.delete(target);
      }
      this.renderTargets.set(target, entry);
      this.textureBinds.set(target, entry);
      this.textureByteSizes.set(target, allocationBytes);
      this.textureBytes += allocationBytes;
      return entry;
    } catch (error) {
      gpuTexture?.destroy?.();
      throw error;
    }
  }

  prepare(scene, camera) {
    if (this.destroyed || this.lost || !this.device || !this.context) return { batches: 0, uploads: 0 };
    this.assertResourceBudget();
    const before = this.textureUploads;
    const prepareQueue = (queue) => {
      let totalBytes = 0;
      let instanceBytes = 0;
      for (const batch of queue.batches) {
        if (!batch.staticOwner && !batch.instanced) totalBytes += batch.data.byteLength;
        if (batch.instanced && !batch.gpuCulling) instanceBytes += batch.instanceData.byteLength;
      }
      if (totalBytes > 0) this.ensureVertexBuffer(totalBytes);
      if (instanceBytes > 0) this.ensureInstanceBuffer(instanceBytes);
      for (const batch of queue.batches) {
        const value = this.getTextureValue(batch.texture);
        if (batch.staticOwner) this.ensureStaticBuffer(batch);
        if (batch.gpuCulling) this.ensureGpuCullResources(batch);
      }
      return queue.batches.length;
    };
    const queue = buildRenderBatches(scene, camera, this.canvas.width, this.canvas.height, { gpuCulling: true, state: this.batchState });
    const mainBatchCount = prepareQueue(queue);
    const renderGroups = this.renderGroups;
    renderGroups.length = 0;
    collectRenderGroups(scene, renderGroups);
    for (const group of renderGroups) {
      const state = group.getPostProcessState?.();
      prepareQueue(buildRenderBatches(group, group.getRenderCamera(), group.width, group.height, { gpuCulling: true, state: this.batchState, offscreenRoot: true }));
      const targets = state ? [group.target, ...state.targets] : [group.target];
      for (const target of targets) {
        this.getTextureValue(target);
      }
    }
    return { batches: mainBatchCount, uploads: this.textureUploads - before };
  }

  render(time, scene, camera, target = null, processGroups = true, offscreenRoot = false, clear = this.clearBeforeRender, accumulateMetrics = false) {
    if (this.destroyed || this.lost || !this.device || !this.context) return;
    this.assertResourceBudget();
    try {
      if (processGroups && !accumulateMetrics) { this.metrics.renderGroupPassCount = 0; this.metrics.postProcessPassCount = 0; }
      if (processGroups) {
        const renderGroups = this.renderGroups;
        renderGroups.length = 0;
        collectRenderGroups(scene, renderGroups);
        for (const group of renderGroups) {
          if (group.destroyed || !group.target) continue;
          this.metrics.renderGroupPassCount += 1;
          this.metrics.postProcessPassCount += renderGroupWithPostProcess(this, time, group);
          if (this.lost) return;
        }
      }
      const targetEntry = target ? this.ensureRenderTarget(target) : null;
      const renderWidth = targetEntry?.width || this.canvas.width;
      const renderHeight = targetEntry?.height || this.canvas.height;
      this.pruneDestroyedTextures();
      this.pruneStaticBuffers();
      this.pruneGpuCullResources();
      const queue = buildRenderBatches(scene, camera, renderWidth, renderHeight, { gpuCulling: true, state: this.batchState, offscreenRoot });
      if (target && queue.batches.some((batch) => batch.texture === target || batch.maskTexture === target)) {
        const error = new Error("RenderTexture aynı render pass içinde örneklenemez (feedback loop).");
        error.code = "EXI_RENDER_TEXTURE_FEEDBACK";
        throw error;
      }
      const usesFilters = Boolean(this.filterLayout);
      const metrics = this.metrics;
      let vertexCount = 0; let instanceCount = 0; let instancedBatchCount = 0; let gpuCullingBatchCount = 0; let instanceDataBytes = 0; let totalBytes = 0; let instanceBytes = 0;
      for (const batch of queue.batches) {
        vertexCount += batch.vertexCount;
        if (batch.instanced) {
          instancedBatchCount += 1;
          if (batch.gpuCulling) gpuCullingBatchCount += 1;
          instanceCount += batch.instanceCount || 0;
          instanceDataBytes += batch.instanceData?.byteLength || 0;
          if (!batch.gpuCulling) instanceBytes += batch.instanceData?.byteLength || 0;
        } else if (!batch.staticOwner) totalBytes += batch.data?.byteLength || 0;
      }
      if (processGroups || accumulateMetrics) {
        const drawCalls = accumulateMetrics ? metrics.drawCalls : 0;
        const batchCount = accumulateMetrics ? metrics.batchCount : 0;
        const previousVertexCount = accumulateMetrics ? metrics.vertexCount : 0;
        const previousInstanceCount = accumulateMetrics ? metrics.instanceCount : 0;
        const previousInstancedBatchCount = accumulateMetrics ? metrics.instancedBatchCount : 0;
        const previousGpuCullingBatchCount = accumulateMetrics ? metrics.gpuCullingBatchCount : 0;
        const previousInstanceDataBytes = accumulateMetrics ? metrics.instanceDataBytes : 0;
        const previousNodeCount = accumulateMetrics ? metrics.nodeCount : 0;
        const previousCulledCount = accumulateMetrics ? metrics.culledCount : 0;
        const previousScissorCount = accumulateMetrics ? metrics.scissorCount : 0;
        metrics.drawCalls = drawCalls + queue.batches.length; metrics.batchCount = batchCount + queue.batches.length; metrics.vertexCount = previousVertexCount + vertexCount; metrics.instanceCount = previousInstanceCount + instanceCount; metrics.instancedBatchCount = previousInstancedBatchCount + instancedBatchCount; metrics.gpuCullingBatchCount = previousGpuCullingBatchCount + gpuCullingBatchCount; metrics.instanceDataBytes = previousInstanceDataBytes + instanceDataBytes; metrics.nodeCount = previousNodeCount + queue.nodeCount; metrics.culledCount = previousCulledCount + queue.culledCount; metrics.scissorCount = previousScissorCount + queue.scissorCount; metrics.staticBufferCount = this.staticBuffers.size;
      }
      this.frameValues[0] = renderWidth; this.frameValues[1] = renderHeight; this.frameValues[2] = time; this.frameValues[3] = 0;
      this.device.queue.writeBuffer(this.frameBuffer, 0, this.frameValues);
      if (totalBytes > 0) this.ensureVertexBuffer(totalBytes);
      if (instanceBytes > 0) this.ensureInstanceBuffer(instanceBytes);
      if (usesFilters) this.ensureFilterBuffer(queue.batches.length);
      const encoder = this.device.createCommandEncoder();
      for (const batch of queue.batches) if (batch.gpuCulling) batch.gpuResource = this.encodeGpuCull(encoder, batch, camera, renderWidth, renderHeight);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targetEntry?.view || this.context.getCurrentTexture().createView(), clearValue: this.clearRGBA, loadOp: clear ? "clear" : "load", storeOp: "store" }] });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.frameBindGroup);
      let byteOffset = 0;
      let instanceOffset = 0;
      let filterOffset = 0;
      for (const batch of queue.batches) {
        const scissor = getScissorRect(batch.clip, renderWidth, renderHeight, this.scissorRect);
        if (scissor) pass.setScissorRect(scissor.x, scissor.y, scissor.width, scissor.height);
        else pass.setScissorRect(0, 0, renderWidth, renderHeight);
        const hasMask = Boolean(batch.maskTexture);
        const maskRect = batch.maskRect;
        const maskX = maskRect?.x ?? 0; const maskY = maskRect?.y ?? 0;
        const maskWidth = maskRect?.width ?? renderWidth; const maskHeight = maskRect?.height ?? renderHeight;
        if (usesFilters) {
          this.filterValues[0] = filterMode(batch.filterType);
          this.filterValues[1] = batch.filterAmount;
          this.filterValues[2] = 0;
          this.filterValues[3] = 0;
          this.filterValues[4] = hasMask ? maskX : 0;
          this.filterValues[5] = hasMask ? maskY : 0;
          this.filterValues[6] = hasMask ? maskWidth : 0;
          this.filterValues[7] = hasMask ? maskHeight : 0;
          this.device.queue.writeBuffer(this.filterBuffer, filterOffset, this.filterValues);
          pass.setBindGroup(2, this.filterBindGroup, [filterOffset]);
        }
        if (batch.instanced) {
          pass.setPipeline(this.getRenderPipeline(true, batch.blendMode));
          if (batch.gpuCulling) {
            const resource = batch.gpuResource;
            pass.setVertexBuffer(0, resource.output, 0, batch.instanceCount * INSTANCE_STRIDE);
          } else {
            this.device.queue.writeBuffer(this.instanceBuffer, instanceOffset, batch.instanceData);
            pass.setVertexBuffer(0, this.instanceBuffer, instanceOffset, batch.instanceData.byteLength);
          }
        } else {
          pass.setPipeline(this.getRenderPipeline(false, batch.blendMode));
          const vertexBuffer = batch.staticOwner ? this.ensureStaticBuffer(batch) : this.vertexBuffer;
          const vertexOffset = batch.staticOwner ? 0 : byteOffset;
          if (!batch.staticOwner) this.device.queue.writeBuffer(vertexBuffer, vertexOffset, batch.data);
          pass.setVertexBuffer(0, vertexBuffer, vertexOffset, batch.data.byteLength);
        }
        const textureValue = this.getTextureValue(batch.texture);
        pass.setBindGroup(1, textureValue.bindGroup);
        if (usesFilters) {
          const maskValueTexture = batch.maskTexture || Texture.white;
          const maskValue = this.getTextureValue(maskValueTexture);
          pass.setBindGroup(3, maskValue.bindGroup);
        }
        if (batch.instanced) {
          if (batch.gpuCulling) pass.drawIndirect(batch.gpuResource.arguments, 0);
          else { pass.draw(6, batch.instanceCount); instanceOffset += batch.instanceData.byteLength; }
        } else {
          pass.draw(batch.vertexCount);
          if (!batch.staticOwner) byteOffset += batch.data.byteLength;
        }
        if (usesFilters) filterOffset += FILTER_UNIFORM_STRIDE;
      }
      pass.end();
      this.device.queue.submit([encoder.finish()]);
    } catch (error) {
      if (isRenderInputError(error)) {
        if (error instanceof RangeError && !error.code) error.code = RENDER_INPUT_ERROR;
        throw error;
      }
      this.lost = true;
      this.releaseGpuResources();
      const lossError = error instanceof Error ? error : new Error(String(error));
      lossError.backend = "webgpu";
      lossError.recoverable = false;
      lossError.phase = "render";
      this.onLost(lossError);
    }
  }

  async readRenderTarget(target) {
    if (this.destroyed || this.lost || !this.device) throw new Error("WebGPU readback kullanılamıyor.");
    const entry = this.ensureRenderTarget(target);
    const bytesPerRow = Math.ceil((entry.width * 4) / 256) * 256;
    const size = bytesPerRow * entry.height;
    const buffer = this.device.createBuffer({ size, usage: bufferUsage.MAP_READ | bufferUsage.COPY_DST });
    try {
      const encoder = this.device.createCommandEncoder();
      encoder.copyTextureToBuffer({ texture: entry.texture }, { buffer, bytesPerRow, rowsPerImage: entry.height }, { width: entry.width, height: entry.height, depthOrArrayLayers: 1 });
      this.device.queue.submit([encoder.finish()]);
      await this.device.queue.onSubmittedWorkDone?.();
      await buffer.mapAsync((globalThis.GPUMapMode?.READ || 1));
      const mapped = new Uint8Array(buffer.getMappedRange());
      const pixels = new Uint8Array(entry.width * entry.height * 4);
      for (let row = 0; row < entry.height; row += 1) pixels.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + entry.width * 4), row * entry.width * 4);
      buffer.unmap();
      return { width: entry.width, height: entry.height, format: this.format || "rgba8unorm", pixels, flipY: false };
    } finally { buffer.destroy?.(); }
  }

  getInfo() {
    const info = this.info;
    info.backend = "webgpu";
    info.format = this.format;
    info.maxTextureDimension2D = Number(this.device?.limits?.maxTextureDimension2D) || 0;
    info.maxBufferSize = this.maxBufferSize;
    info.maxStorageBufferBindingSize = this.maxStorageBufferBindingSize;
    info.maxVertexBufferBytes = this.maxVertexBufferBytes;
    info.maxInstanceBufferBytes = this.maxInstanceBufferBytes;
    info.maxGpuCullMemoryBytes = this.maxGpuCullMemoryBytes;
    info.textureCount = this.textureBinds.size;
    info.renderTargetCount = this.renderTargets.size;
    info.textureBytes = this.textureBytes;
    info.maxTextureBytes = this.maxTextureBytes;
    info.maxTextureCount = this.maxTextureCount;
    info.textureUploads = this.textureUploads;
    info.textureUploadBytes = this.textureUploadBytes;
    info.staticBufferCount = this.staticBuffers.size;
    info.staticBufferResizes = this.staticBufferResizes;
    info.vertexBufferBytes = this.vertexBufferSize;
    info.vertexBufferResizes = this.vertexBufferResizes;
    info.instanceBufferBytes = this.instanceBufferSize;
    info.instanceBufferResizes = this.instanceBufferResizes;
    info.filterBufferBytes = this.filterBufferSize;
    info.filterBufferResizes = this.filterBufferResizes;
    info.gpuCullBufferCount = this.gpuCullResources.size;
    info.gpuCullBytes = this.gpuCullBytes;
    info.gpuCullBufferResizes = this.gpuCullBufferResizes;
    Object.assign(info, this.metrics);
    return info;
  }

  assertResourceBudget() {
    const snapshot = this._deviceLimitSnapshot;
    if (
      this.maxTextureBytes !== this._maxTextureBytesCapacity ||
      this.maxTextureCount !== this._maxTextureCountCapacity ||
      this.maxTexturePixels !== this._maxTexturePixelsCapacity ||
      (snapshot && (
        this.maxBufferSize !== snapshot.maxBufferSize ||
        this.maxStorageBufferBindingSize !== snapshot.maxStorageBufferBindingSize ||
        this.maxVertexBufferBytes !== snapshot.maxVertexBufferBytes ||
        this.maxInstanceBufferBytes !== snapshot.maxInstanceBufferBytes ||
        this.maxGpuCullBufferBytes !== snapshot.maxGpuCullBufferBytes ||
        this.maxGpuCullMemoryBytes !== snapshot.maxGpuCullMemoryBytes
      ))
    ) {
      const error = new RangeError("WebGPU GPU bütçe ayarları doğrudan değiştirilemez.");
      error.code = "EXI_RENDER_CONFIG";
      throw error;
    }
  }

  destroy() {
    this.destroyed = true;
    this.device?.removeEventListener?.("uncapturederror", this.handleUncapturedError);
    this.releaseGpuResources();
    this.gpuCullBufferResizes = 0;
    this.vertexBufferResizes = 0;
    this.instanceBufferResizes = 0;
    this.staticBufferResizes = 0;
    this.renderGroups.length = 0;
    this.device = null; this.context = null; this.adapter = null;
  }
}
