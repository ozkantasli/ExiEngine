import { buildRenderBatches, collectRenderGroups, createRenderBatchState } from "./batch.js";
import { getScissorRect } from "./scissor.js";
import { INSTANCE_STRIDE } from "./instanced.js";
import { renderGroupWithPostProcess } from "./post-process.js";
import { filterMode } from "../core/node.js";
import { clearColorChannels, DEFAULT_CLEAR_COLOR, normalizeClearAlpha, normalizeClearColor } from "./clear.js";

const vertexSource = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform highp vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;

void main() {
  vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}`;

const fragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform vec4 u_filter;
uniform sampler2D u_mask;
uniform vec4 u_mask_rect;
uniform highp vec2 u_resolution;
in vec2 v_uv;
in vec4 v_color;
out vec4 out_color;

void main() {
  vec4 color = texture(u_texture, v_uv) * v_color;
  if (u_filter.x > 0.5 && u_filter.x < 1.5) {
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(color.rgb, vec3(luminance), u_filter.y);
  } else if (u_filter.x > 1.5 && u_filter.x < 2.5) {
    color.rgb = mix(color.rgb, vec3(1.0) - color.rgb, u_filter.y);
  } else if (u_filter.x > 2.5 && u_filter.x < 3.5) {
    color.rgb *= 1.0 + u_filter.y;
  } else if (u_filter.x > 3.5 && u_filter.x < 4.5) {
    color.rgb = mix(color.rgb, vec3(
      dot(color.rgb, vec3(0.393, 0.769, 0.189)),
      dot(color.rgb, vec3(0.349, 0.686, 0.168)),
      dot(color.rgb, vec3(0.272, 0.534, 0.131))
    ), u_filter.y);
  } else if (u_filter.x > 4.5 && u_filter.x < 5.5) {
    color.rgb = clamp((color.rgb - vec3(0.5)) * (1.0 + u_filter.y) + vec3(0.5), vec3(0.0), vec3(1.0));
  } else if (u_filter.x > 5.5) {
    float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = clamp(vec3(luminance) + (color.rgb - vec3(luminance)) * (1.0 + u_filter.y), vec3(0.0), vec3(1.0));
  }
  if (u_mask_rect.z > 0.0 && u_mask_rect.w > 0.0) {
    vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    vec2 maskUv = (screen - u_mask_rect.xy) / u_mask_rect.zw;
    float maskAlpha = maskUv.x >= 0.0 && maskUv.x <= 1.0 && maskUv.y >= 0.0 && maskUv.y <= 1.0 ? texture(u_mask, maskUv).a : 0.0;
    color *= maskAlpha;
  }
  out_color = color;
}`;

const instancedVertexSource = `#version 300 es
in vec2 a_origin;
in vec2 a_axis_x;
in vec2 a_axis_y;
in vec4 a_uv_rect;
in vec4 a_color;
uniform highp vec2 u_resolution;
out vec2 v_uv;
out vec4 v_color;

void main() {
  const vec2 corners[6] = vec2[6](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
  vec2 corner = corners[gl_VertexID];
  vec2 position = a_origin + a_axis_x * corner.x + a_axis_y * corner.y;
  vec2 clip = (position / u_resolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = mix(a_uv_rect.xy, a_uv_rect.zw, corner);
  v_color = a_color;
}`;

const MAX_TEXTURE_PIXELS = 16 * 1024 * 1024;
const MAX_TEXTURE_BYTES = 512 * 1024 * 1024;
const MAX_TEXTURE_COUNT = 4_096;
const MAX_VERTEX_BUFFER_BYTES = 64 * 1024 * 1024;
const MAX_INSTANCE_BUFFER_BYTES = 64 * 1024 * 1024;

function assertLiveTexture(texture) {
  if (!texture || texture.destroyed || texture.baseTexture?.destroyed) {
    const error = new TypeError("Canlı Texture gerekli.");
    error.code = "EXI_TEXTURE_INPUT";
    throw error;
  }
  return texture.baseTexture || texture;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL shader oluşturulamadı.");
  try {
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || "bilinmeyen shader hatası";
      throw new Error(`WebGL shader derlenemedi: ${log}`);
    }
    return shader;
  } catch (error) {
    gl.deleteShader(shader);
    throw error;
  }
}

function createProgram(gl, vertex = vertexSource, fragment = fragmentSource) {
  let vertexShader = null;
  let fragmentShader = null;
  let program = null;
  try {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertex);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram();
    if (!program) throw new Error("WebGL program oluşturulamadı.");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "bilinmeyen program hatası";
      throw new Error(`WebGL program bağlanamadı: ${log}`);
    }
    return program;
  } catch (error) {
    if (program) gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}

export class WebGL2Renderer {
  constructor({ canvas, onLost = () => {}, onStatus = () => {}, clearColor = DEFAULT_CLEAR_COLOR, clearAlpha = 1, clearBeforeRender = true, maxTextureBytes = 128 * 1024 * 1024, maxTextureCount = 4_096 }) {
    this.canvas = canvas;
    this.onLost = onLost;
    this.onStatus = onStatus;
    this.clearColor = normalizeClearColor(clearColor);
    this.clearAlpha = normalizeClearAlpha(clearAlpha);
    this.clearBeforeRender = clearBeforeRender !== false;
    this.clearRGBA = clearColorChannels(this.clearColor, this.clearAlpha);
    this.gl = null;
    this.program = null;
    this.instancedProgram = null;
    this.buffer = null;
    this.bufferSize = 0;
    this.bufferResizes = 0;
    this.instanceBuffer = null;
    this.instanceBufferSize = 0;
    this.instanceBufferResizes = 0;
    this.positionLocation = -1;
    this.uvLocation = -1;
    this.colorLocation = -1;
    this.resolutionLocation = null;
    this.textureLocation = null;
    this.instanceOriginLocation = -1;
    this.instanceAxisXLocation = -1;
    this.instanceAxisYLocation = -1;
    this.instanceUvRectLocation = -1;
    this.instanceColorLocation = -1;
    this.instanceResolutionLocation = null;
    this.instanceTextureLocation = null;
    this.filterLocation = null;
    this.instanceFilterLocation = null;
    this.maskLocation = null;
    this.instanceMaskLocation = null;
    this.maskRectLocation = null;
    this.instanceMaskRectLocation = null;
    this.textures = new Map();
    this.renderTargets = new Map();
    this.textureVersions = new Map();
    this.textureFilters = new Map();
    if (!Number.isSafeInteger(maxTextureBytes) || maxTextureBytes <= 0 || maxTextureBytes > MAX_TEXTURE_BYTES) throw new RangeError("WebGL texture byte bütçesi geçersiz.");
    if (!Number.isSafeInteger(maxTextureCount) || maxTextureCount <= 0 || maxTextureCount > MAX_TEXTURE_COUNT) throw new RangeError("WebGL texture sayısı bütçesi geçersiz.");
    this.maxTextureBytes = maxTextureBytes;
    this.maxTextureCount = maxTextureCount;
    this.textureBytes = 0;
    this.textureByteSizes = new Map();
    this.maxTexturePixels = MAX_TEXTURE_PIXELS;
    this._maxTextureBytesCapacity = maxTextureBytes;
    this._maxTextureCountCapacity = maxTextureCount;
    this._maxTexturePixelsCapacity = MAX_TEXTURE_PIXELS;
    this._maxTextureSizeSnapshot = null;
    this.textureUploads = 0;
    this.textureUploadBytes = 0;
    this.staticBuffers = new Map();
    this.staticBufferResizes = 0;
    this.width = 1;
    this.height = 1;
    this.maxTextureSize = 0;
    this.scissorRect = { x: 0, y: 0, width: 0, height: 0 };
    this.lost = false;
    this.destroyed = false;
    this.batchState = createRenderBatchState();
    this.renderGroups = this.batchState.renderGroups;
    this.metrics = { drawCalls: 0, batchCount: 0, vertexCount: 0, instanceCount: 0, instancedBatchCount: 0, instanceDataBytes: 0, nodeCount: 0, culledCount: 0, scissorCount: 0, staticBufferCount: 0, renderGroupPassCount: 0, postProcessPassCount: 0 };
    this.info = {};
    this.handleContextLost = (event) => {
      if (this.destroyed) return;
      event.preventDefault();
      this.lost = true;
      this.onStatus({ type: "context-lost", backend: "webgl2" });
      const error = new Error("WebGL context kaybedildi.");
      error.backend = "webgl2";
      error.recoverable = true;
      this.onLost(error);
    };
    this.handleContextRestored = () => {
      if (this.destroyed) return;
      try {
        this.buildResources();
        this.lost = false;
        this.onStatus({ type: "context-restored", backend: "webgl2" });
      } catch (error) {
        const restoreError = error instanceof Error ? error : new Error(String(error));
        restoreError.backend = "webgl2";
        restoreError.recoverable = false;
        restoreError.phase = "context-restore";
        this.onLost(restoreError);
      }
    };
  }

  init() {
    try {
    if (!this.canvas || typeof this.canvas.getContext !== "function") throw new Error("Geçerli bir canvas gerekli.");
    this.gl = this.canvas.getContext("webgl2", { alpha: this.clearAlpha < 1, antialias: false, depth: false, powerPreference: "high-performance", preserveDrawingBuffer: !this.clearBeforeRender, stencil: false });
    if (!this.gl) throw new Error("WebGL2 bu tarayıcıda kullanılamıyor.");
    this.canvas.addEventListener("webglcontextlost", this.handleContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored, false);
    this.buildResources();
    this.onStatus({ type: "backend-ready", backend: "webgl2" });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  buildResources() {
    const gl = this.gl;
    this.maxTextureSize = typeof gl?.getParameter === "function" ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0 : 0;
    this._maxTextureSizeSnapshot = this.maxTextureSize;
    let program = null;
    let instancedProgram = null;
    let buffer = null;
    let instanceBuffer = null;
    try {
      program = createProgram(gl);
      instancedProgram = createProgram(gl, instancedVertexSource, fragmentSource);
      buffer = gl.createBuffer();
      instanceBuffer = gl.createBuffer();
      if (!buffer) throw new Error("WebGL vertex buffer oluşturulamadı.");
      if (!instanceBuffer) throw new Error("WebGL instanced vertex buffer oluşturulamadı.");
      const positionLocation = gl.getAttribLocation(program, "a_position");
      const uvLocation = gl.getAttribLocation(program, "a_uv");
      const colorLocation = gl.getAttribLocation(program, "a_color");
      const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      const textureLocation = gl.getUniformLocation(program, "u_texture");
      const filterLocation = gl.getUniformLocation(program, "u_filter");
      const maskLocation = gl.getUniformLocation(program, "u_mask");
      const maskRectLocation = gl.getUniformLocation(program, "u_mask_rect");
      const instanceOriginLocation = gl.getAttribLocation(instancedProgram, "a_origin");
      const instanceAxisXLocation = gl.getAttribLocation(instancedProgram, "a_axis_x");
      const instanceAxisYLocation = gl.getAttribLocation(instancedProgram, "a_axis_y");
      const instanceUvRectLocation = gl.getAttribLocation(instancedProgram, "a_uv_rect");
      const instanceColorLocation = gl.getAttribLocation(instancedProgram, "a_color");
      const instanceResolutionLocation = gl.getUniformLocation(instancedProgram, "u_resolution");
      const instanceTextureLocation = gl.getUniformLocation(instancedProgram, "u_texture");
      const instanceFilterLocation = gl.getUniformLocation(instancedProgram, "u_filter");
      const instanceMaskLocation = gl.getUniformLocation(instancedProgram, "u_mask");
      const instanceMaskRectLocation = gl.getUniformLocation(instancedProgram, "u_mask_rect");
      if (positionLocation < 0 || uvLocation < 0 || colorLocation < 0 || !resolutionLocation || !textureLocation || !filterLocation || !maskLocation || !maskRectLocation) throw new Error("WebGL shader konumları alınamadı.");
      if (instanceOriginLocation < 0 || instanceAxisXLocation < 0 || instanceAxisYLocation < 0 || instanceUvRectLocation < 0 || instanceColorLocation < 0 || !instanceResolutionLocation || !instanceTextureLocation || !instanceFilterLocation || !instanceMaskLocation || !instanceMaskRectLocation) throw new Error("WebGL instanced shader konumlarÄ± alÄ±namadÄ±.");
      this.positionLocation = positionLocation;
      this.uvLocation = uvLocation;
      this.colorLocation = colorLocation;
      this.resolutionLocation = resolutionLocation;
      this.textureLocation = textureLocation;
      this.instanceOriginLocation = instanceOriginLocation;
      this.instanceAxisXLocation = instanceAxisXLocation;
      this.instanceAxisYLocation = instanceAxisYLocation;
      this.instanceUvRectLocation = instanceUvRectLocation;
      this.instanceColorLocation = instanceColorLocation;
      this.instanceResolutionLocation = instanceResolutionLocation;
      this.instanceTextureLocation = instanceTextureLocation;
      this.filterLocation = filterLocation;
      this.instanceFilterLocation = instanceFilterLocation;
      this.maskLocation = maskLocation;
      this.instanceMaskLocation = instanceMaskLocation;
      this.maskRectLocation = maskRectLocation;
      this.instanceMaskRectLocation = instanceMaskRectLocation;
    } catch (error) {
      if (buffer) gl.deleteBuffer(buffer);
      if (instanceBuffer) gl.deleteBuffer(instanceBuffer);
      if (program) gl.deleteProgram(program);
      if (instancedProgram) gl.deleteProgram(instancedProgram);
      throw error;
    }
    for (const texture of this.textures.values()) gl.deleteTexture(texture);
    for (const entry of this.renderTargets.values()) { gl.deleteFramebuffer?.(entry.framebuffer); gl.deleteTexture(entry.texture); }
    for (const entry of this.staticBuffers.values()) gl.deleteBuffer(entry.buffer);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    if (this.instanceBuffer) gl.deleteBuffer(this.instanceBuffer);
    if (this.program) gl.deleteProgram(this.program);
    if (this.instancedProgram) gl.deleteProgram(this.instancedProgram);
    this.program = program;
    this.instancedProgram = instancedProgram;
    this.buffer = buffer;
    this.instanceBuffer = instanceBuffer;
    this.bufferSize = 0;
    this.bufferResizes = 0;
    this.instanceBufferSize = 0;
    this.instanceBufferResizes = 0;
    this.textures.clear();
    this.renderTargets.clear();
    this.textureVersions.clear();
    this.textureFilters.clear();
    this.textureBytes = 0;
    this.textureByteSizes.clear();
    this.textureUploads = 0;
    this.textureUploadBytes = 0;
    this.staticBuffers.clear();
    this.staticBufferResizes = 0;
  }

  createTexture(texture) {
    this.assertResourceBudget();
    if (texture?.renderTarget) return this.ensureRenderTarget(texture).texture;
    const baseTexture = assertLiveTexture(texture);
    const existing = this.textures.get(baseTexture);
    if (existing) return existing;
    const gl = this.gl;
    const width = Number(baseTexture.sourceWidth); const height = Number(baseTexture.sourceHeight);
    const maxSize = this.maxTextureSize || (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || Infinity);
    const hasSource = Boolean(baseTexture.source);
    if (hasSource && (Number(baseTexture.source.width) !== width || Number(baseTexture.source.height) !== height)) throw new RangeError("WebGL texture source size mismatch.");
    const allocationWidth = hasSource ? width : 1;
    const allocationHeight = hasSource ? height : 1;
    const allocationBytes = allocationWidth * allocationHeight * 4;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || allocationWidth > maxSize || allocationHeight > maxSize || allocationWidth * allocationHeight > this.maxTexturePixels) throw new RangeError("WebGL texture boyutu/pixel limiti aÅŸÄ±ldÄ±.");
    this.assertTextureBudget(allocationBytes);
    const gpuTexture = gl.createTexture();
    if (!gpuTexture) throw new Error("WebGL texture oluşturulamadı.");
    try {
      gl.bindTexture(gl.TEXTURE_2D, gpuTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const samplingFilter = baseTexture.filter === "nearest" ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, samplingFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, samplingFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (baseTexture.source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, baseTexture.source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      this.textures.set(baseTexture, gpuTexture);
      this.textureVersions.set(baseTexture, baseTexture.version);
      this.textureFilters.set(baseTexture, baseTexture.filter === "nearest" ? "nearest" : "linear");
      this.textureByteSizes.set(baseTexture, allocationBytes);
      this.textureBytes += allocationBytes;
      this.textureUploads += 1;
      this.textureUploadBytes += hasSource ? width * height * 4 : 4;
      return gpuTexture;
    } catch (error) {
      gl.deleteTexture(gpuTexture);
      throw error;
    }
  }

  updateTexture(texture, gpuTexture) {
    const baseTexture = assertLiveTexture(texture);
    if (this.textureVersions.get(baseTexture) === baseTexture.version) return;
    if (baseTexture.source && (Number(baseTexture.source.width) !== baseTexture.sourceWidth || Number(baseTexture.source.height) !== baseTexture.sourceHeight)) throw new RangeError("WebGL texture source size mismatch.");
    if (baseTexture.source) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, gpuTexture);
      this.gl.texSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, baseTexture.source);
      this.textureUploads += 1;
      this.textureUploadBytes += baseTexture.sourceWidth * baseTexture.sourceHeight * 4;
    }
    this.textureVersions.set(baseTexture, baseTexture.version);
  }

  getTexture(texture) {
    const key = texture?.renderTarget ? texture : assertLiveTexture(texture);
    const gpuTexture = texture?.renderTarget ? this.ensureRenderTarget(texture).texture : (this.textures.get(key) || this.createTexture(texture));
    const filter = key.filter === "nearest" ? "nearest" : "linear";
    if (this.textureFilters.get(key) !== filter) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, gpuTexture);
      const samplingFilter = filter === "nearest" ? this.gl.NEAREST : this.gl.LINEAR;
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, samplingFilter);
      this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, samplingFilter);
      this.textureFilters.set(key, filter);
    }
    this.updateTexture(key, gpuTexture);
    return gpuTexture;
  }

  assertResourceBudget() {
    if (
      this.maxTextureBytes !== this._maxTextureBytesCapacity ||
      this.maxTextureCount !== this._maxTextureCountCapacity ||
      this.maxTexturePixels !== this._maxTexturePixelsCapacity ||
      (this._maxTextureSizeSnapshot !== null && this.maxTextureSize !== this._maxTextureSizeSnapshot)
    ) {
      const error = new RangeError("WebGL GPU bütçe ayarları doğrudan değiştirilemez.");
      error.code = "EXI_RENDER_CONFIG";
      throw error;
    }
  }

  assertTextureBudget(addBytes, replaceBytes = 0, replaceCount = 0) {
    this.assertResourceBudget();
    const projectedBytes = this.textureBytes - replaceBytes + addBytes;
    const projectedCount = this.textures.size + this.renderTargets.size - replaceCount + 1;
    if (!Number.isSafeInteger(projectedBytes) || projectedBytes > this.maxTextureBytes || projectedCount > this.maxTextureCount) {
      const error = new RangeError("WebGL toplam texture bütçesi aşıldı.");
      error.code = "EXI_TEXTURE_BUDGET";
      throw error;
    }
  }

  prepare(scene, camera) {
    if (this.destroyed || this.lost || !this.gl) return { batches: 0, uploads: 0 };
    this.assertResourceBudget();
    const gl = this.gl;
    const before = this.textureUploads;
    const prepareQueue = (queue) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      let vertexBytes = 0;
      let instanceBytes = 0;
      for (const batch of queue.batches) {
        if (!batch.staticOwner && !batch.instanced) vertexBytes = Math.max(vertexBytes, batch.data.byteLength);
        if (batch.instanced) instanceBytes += batch.instanceData.byteLength;
      }
      this.ensureVertexBuffer(vertexBytes);
      this.ensureInstanceBuffer(instanceBytes);
      for (const batch of queue.batches) this.getTexture(batch.texture);
      for (const batch of queue.batches) if (batch.staticOwner) this.ensureStaticBuffer(batch);
      return queue.batches.length;
    };
    const queue = buildRenderBatches(scene, camera, this.width, this.height, { state: this.batchState });
    const mainBatchCount = prepareQueue(queue);
    const renderGroups = this.renderGroups;
    renderGroups.length = 0;
    collectRenderGroups(scene, renderGroups);
    for (const group of renderGroups) {
      const state = group.getPostProcessState?.();
      prepareQueue(buildRenderBatches(group, group.getRenderCamera(), group.width, group.height, { state: this.batchState, offscreenRoot: true }));
      this.getTexture(group.target);
      if (state) for (const target of state.targets) this.getTexture(target);
    }
    return { batches: mainBatchCount, uploads: this.textureUploads - before };
  }

  resize(width, height) { this.width = Math.max(1, width | 0); this.height = Math.max(1, height | 0); }

  setBlendMode(mode) {
    const gl = this.gl;
    if (!gl?.blendFunc) return;
    if (mode === "additive") gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    else if (mode === "multiply") gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  pruneDestroyedTextures() {
    for (const [texture, gpuTexture] of this.textures) {
      if (!texture.destroyed) continue;
      this.gl.deleteTexture(gpuTexture);
      this.textures.delete(texture);
      this.textureVersions.delete(texture);
      this.textureFilters.delete(texture);
      this.textureBytes = Math.max(0, this.textureBytes - (this.textureByteSizes.get(texture) || 0));
      this.textureByteSizes.delete(texture);
    }
    for (const [texture, entry] of this.renderTargets) {
      if (!texture.destroyed) continue;
      this.gl.deleteFramebuffer?.(entry.framebuffer);
      this.gl.deleteTexture(entry.texture);
      this.renderTargets.delete(texture);
      this.textureVersions.delete(texture);
      this.textureFilters.delete(texture);
      this.textureBytes = Math.max(0, this.textureBytes - (this.textureByteSizes.get(texture) || 0));
      this.textureByteSizes.delete(texture);
    }
  }

  ensureRenderTarget(target) {
    this.assertResourceBudget();
    if (!target?.renderTarget || target.destroyed) throw new TypeError("Geçerli bir RenderTexture gerekli.");
    const gl = this.gl;
    const width = Number(target.width); const height = Number(target.height);
    const maxSize = this.maxTextureSize || (Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || Infinity);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > maxSize || height > maxSize || width * height > this.maxTexturePixels) throw new RangeError("WebGL RenderTexture boyutu/pixel limiti aşıldı.");
    const current = this.renderTargets.get(target);
    if (current && current.width === width && current.height === height) return current;
    const currentBytes = current ? (this.textureByteSizes.get(target) || current.width * current.height * 4) : 0;
    const allocationBytes = width * height * 4;
    this.assertTextureBudget(allocationBytes, currentBytes, current ? 1 : 0);
    if (typeof gl.createFramebuffer !== "function" || typeof gl.framebufferTexture2D !== "function" || typeof gl.checkFramebufferStatus !== "function") throw new Error("WebGL RenderTexture framebuffer desteği eksik.");
    let texture = null; let framebuffer = null;
    try {
      texture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error("WebGL RenderTexture kaynağı oluşturulamadı.");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, target.filter === "nearest" ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, target.filter === "nearest" ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("WebGL RenderTexture framebuffer tamamlanamadı.");
      const entry = { texture, framebuffer, width, height };
      if (current) {
        gl.deleteFramebuffer?.(current.framebuffer);
        gl.deleteTexture(current.texture);
        this.renderTargets.delete(target);
        this.textureBytes = Math.max(0, this.textureBytes - currentBytes);
        this.textureByteSizes.delete(target);
      }
      this.renderTargets.set(target, entry);
      this.textureFilters.set(target, target.filter === "nearest" ? "nearest" : "linear");
      this.textureByteSizes.set(target, allocationBytes);
      this.textureBytes += allocationBytes;
      return entry;
    } catch (error) {
      if (framebuffer) gl.deleteFramebuffer?.(framebuffer);
      if (texture) gl.deleteTexture(texture);
      throw error;
    } finally {
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);
    }
  }

  pruneStaticBuffers() {
    for (const [owner, entry] of this.staticBuffers) {
      if (!owner.destroyed) continue;
      this.gl.deleteBuffer(entry.buffer);
      this.staticBuffers.delete(owner);
    }
  }

  ensureVertexBuffer(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("WebGL vertex buffer limiti aşıldı.");
    if (bytes <= this.bufferSize) return;
    if (bytes > MAX_VERTEX_BUFFER_BYTES) throw new RangeError("WebGL vertex buffer limiti aşıldı.");
    const size = Math.max(4096, 2 ** Math.ceil(Math.log2(bytes)));
    if (size > MAX_VERTEX_BUFFER_BYTES) throw new RangeError("WebGL vertex buffer limiti aşıldı.");
    const previousBuffer = this.buffer;
    const nextBuffer = this.gl.createBuffer();
    if (!nextBuffer) throw new Error("WebGL vertex buffer oluşturulamadı.");
    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, nextBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.DYNAMIC_DRAW);
    } catch (error) {
      this.gl.deleteBuffer?.(nextBuffer);
      if (previousBuffer) this.gl.bindBuffer?.(this.gl.ARRAY_BUFFER, previousBuffer);
      throw error;
    }
    if (previousBuffer) this.gl.deleteBuffer?.(previousBuffer);
    this.buffer = nextBuffer;
    this.bufferSize = size;
    this.bufferResizes += 1;
  }

  ensureInstanceBuffer(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("WebGL instanced batch buffer limiti aşıldı.");
    if (bytes <= this.instanceBufferSize) return;
    if (bytes > MAX_INSTANCE_BUFFER_BYTES) throw new RangeError("WebGL instanced batch buffer limiti aÅŸÄ±ldÄ±.");
    const size = Math.max(4096, 2 ** Math.ceil(Math.log2(bytes)));
    const previousBuffer = this.instanceBuffer;
    const nextBuffer = this.gl.createBuffer();
    if (!nextBuffer) throw new Error("WebGL instanced vertex buffer oluşturulamadı.");
    try {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, nextBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.DYNAMIC_DRAW);
    } catch (error) {
      this.gl.deleteBuffer?.(nextBuffer);
      if (previousBuffer) this.gl.bindBuffer?.(this.gl.ARRAY_BUFFER, previousBuffer);
      throw error;
    }
    if (previousBuffer) this.gl.deleteBuffer?.(previousBuffer);
    this.instanceBuffer = nextBuffer;
    this.instanceBufferSize = size;
    this.instanceBufferResizes += 1;
  }

  ensureStaticBuffer(batch) {
    if (!Number.isSafeInteger(batch.data?.byteLength) || batch.data.byteLength > MAX_VERTEX_BUFFER_BYTES) throw new RangeError("WebGL static vertex buffer limiti aşıldı.");
    let entry = this.staticBuffers.get(batch.staticOwner);
    const needsResize = !entry || batch.data.byteLength > entry.size;
    if (needsResize) {
      const size = Math.max(4096, 2 ** Math.ceil(Math.log2(batch.data.byteLength)));
      if (size > MAX_VERTEX_BUFFER_BYTES) throw new RangeError("WebGL static vertex buffer limiti aşıldı.");
      const nextBuffer = this.gl.createBuffer();
      if (!nextBuffer) throw new Error("WebGL static vertex buffer oluÅŸturulamadÄ±.");
      try {
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, nextBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, size, this.gl.DYNAMIC_DRAW);
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, batch.data);
      } catch (error) {
        this.gl.deleteBuffer?.(nextBuffer);
        if (entry?.buffer) this.gl.bindBuffer?.(this.gl.ARRAY_BUFFER, entry.buffer);
        throw error;
      }
      entry = entry || { buffer: null, size: 0, key: null };
      if (entry.buffer) this.gl.deleteBuffer?.(entry.buffer);
      entry.buffer = nextBuffer;
      entry.size = size;
      entry.key = batch.staticKey;
      this.staticBuffers.set(batch.staticOwner, entry);
      this.staticBufferResizes += 1;
    } else {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, entry.buffer);
      if (entry.key !== batch.staticKey) {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, batch.data);
        entry.key = batch.staticKey;
      }
    }
    return entry.buffer;
  }

  bindVertexBuffer(buffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 8 * Float32Array.BYTES_PER_ELEMENT;
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this.uvLocation, 2, gl.FLOAT, false, stride, 8);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(this.positionLocation, 0);
    gl.vertexAttribDivisor(this.uvLocation, 0);
    gl.vertexAttribDivisor(this.colorLocation, 0);
  }

  bindInstanceBuffer(buffer, offset = 0) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(this.instanceOriginLocation, 2, gl.FLOAT, false, INSTANCE_STRIDE, offset);
    gl.vertexAttribPointer(this.instanceAxisXLocation, 2, gl.FLOAT, false, INSTANCE_STRIDE, offset + 8);
    gl.vertexAttribPointer(this.instanceAxisYLocation, 2, gl.FLOAT, false, INSTANCE_STRIDE, offset + 16);
    gl.vertexAttribPointer(this.instanceUvRectLocation, 4, gl.FLOAT, false, INSTANCE_STRIDE, offset + 24);
    gl.vertexAttribPointer(this.instanceColorLocation, 4, gl.FLOAT, false, INSTANCE_STRIDE, offset + 40);
    gl.enableVertexAttribArray(this.instanceOriginLocation);
    gl.enableVertexAttribArray(this.instanceAxisXLocation);
    gl.enableVertexAttribArray(this.instanceAxisYLocation);
    gl.enableVertexAttribArray(this.instanceUvRectLocation);
    gl.enableVertexAttribArray(this.instanceColorLocation);
    gl.vertexAttribDivisor(this.instanceOriginLocation, 1);
    gl.vertexAttribDivisor(this.instanceAxisXLocation, 1);
    gl.vertexAttribDivisor(this.instanceAxisYLocation, 1);
    gl.vertexAttribDivisor(this.instanceUvRectLocation, 1);
    gl.vertexAttribDivisor(this.instanceColorLocation, 1);
  }

  render(time, scene, camera, target = null, processGroups = true, offscreenRoot = false, clear = this.clearBeforeRender, accumulateMetrics = false) {
    if (this.destroyed || this.lost || !this.gl) return;
    this.assertResourceBudget();
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
    const gl = this.gl;
    const targetEntry = target ? this.ensureRenderTarget(target) : null;
    const renderWidth = targetEntry?.width || this.width;
    const renderHeight = targetEntry?.height || this.height;
    this.pruneDestroyedTextures();
    this.pruneStaticBuffers();
    const queue = buildRenderBatches(scene, camera, renderWidth, renderHeight, { state: this.batchState, offscreenRoot });
      if (target && queue.batches.some((batch) => batch.texture === target || batch.maskTexture === target)) throw new Error("RenderTexture aynı render pass içinde örneklenemez (feedback loop).");
    const metrics = this.metrics;
    let vertexCount = 0; let instanceCount = 0; let instancedBatchCount = 0; let instanceDataBytes = 0; let regularBytes = 0; let instanceBytes = 0;
    for (const batch of queue.batches) {
      vertexCount += batch.vertexCount;
      if (batch.instanced) {
        instancedBatchCount += 1;
        instanceCount += batch.instanceCount || 0;
        instanceDataBytes += batch.instanceData?.byteLength || 0;
        instanceBytes += batch.instanceData?.byteLength || 0;
      } else regularBytes = Math.max(regularBytes, batch.data?.byteLength || 0);
    }
    if (processGroups || accumulateMetrics) {
      const drawCalls = accumulateMetrics ? metrics.drawCalls : 0;
      const batchCount = accumulateMetrics ? metrics.batchCount : 0;
      const previousVertexCount = accumulateMetrics ? metrics.vertexCount : 0;
      const previousInstanceCount = accumulateMetrics ? metrics.instanceCount : 0;
      const previousInstancedBatchCount = accumulateMetrics ? metrics.instancedBatchCount : 0;
      const previousInstanceDataBytes = accumulateMetrics ? metrics.instanceDataBytes : 0;
      const previousNodeCount = accumulateMetrics ? metrics.nodeCount : 0;
      const previousCulledCount = accumulateMetrics ? metrics.culledCount : 0;
      const previousScissorCount = accumulateMetrics ? metrics.scissorCount : 0;
      metrics.drawCalls = drawCalls + queue.batches.length; metrics.batchCount = batchCount + queue.batches.length; metrics.vertexCount = previousVertexCount + vertexCount; metrics.instanceCount = previousInstanceCount + instanceCount; metrics.instancedBatchCount = previousInstancedBatchCount + instancedBatchCount; metrics.instanceDataBytes = previousInstanceDataBytes + instanceDataBytes; metrics.nodeCount = previousNodeCount + queue.nodeCount; metrics.culledCount = previousCulledCount + queue.culledCount; metrics.scissorCount = previousScissorCount + queue.scissorCount; metrics.staticBufferCount = this.staticBuffers.size;
    }
    try {
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, targetEntry?.framebuffer || null);
      gl.viewport(0, 0, renderWidth, renderHeight);
      if (clear) {
        gl.clearColor(this.clearRGBA.r, this.clearRGBA.g, this.clearRGBA.b, this.clearRGBA.a);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.enable(gl.BLEND);
      this.setBlendMode("normal");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      this.ensureVertexBuffer(regularBytes);
      this.ensureInstanceBuffer(instanceBytes);
      let instanceOffset = 0;
      for (const batch of queue.batches) {
        this.setBlendMode(batch.blendMode);
        const scissor = getScissorRect(batch.clip, renderWidth, renderHeight, this.scissorRect);
        if (scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(scissor.x, renderHeight - scissor.y - scissor.height, scissor.width, scissor.height); }
        else gl.disable(gl.SCISSOR_TEST);
        const hasMask = Boolean(batch.maskTexture);
        const maskRect = batch.maskRect;
        const maskX = maskRect?.x ?? 0; const maskY = maskRect?.y ?? 0;
        const maskWidth = maskRect?.width ?? renderWidth; const maskHeight = maskRect?.height ?? renderHeight;
        if (batch.instanced) {
          gl.useProgram(this.instancedProgram);
          gl.uniform2f(this.instanceResolutionLocation, renderWidth, renderHeight);
          gl.uniform1i(this.instanceTextureLocation, 0);
          gl.uniform4f(this.instanceFilterLocation, filterMode(batch.filterType), batch.filterAmount, 0, 0);
          gl.uniform1i(this.instanceMaskLocation, hasMask ? 1 : 0);
          gl.uniform4f(this.instanceMaskRectLocation, hasMask ? maskX : 0, hasMask ? maskY : 0, hasMask ? maskWidth : 0, hasMask ? maskHeight : 0);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, instanceOffset, batch.instanceData);
          this.bindInstanceBuffer(this.instanceBuffer, instanceOffset);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.getTexture(batch.texture));
          if (hasMask) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.getTexture(batch.maskTexture)); gl.activeTexture(gl.TEXTURE0); }
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.instanceCount);
          instanceOffset += batch.instanceData.byteLength;
        } else {
          gl.useProgram(this.program);
          gl.uniform2f(this.resolutionLocation, renderWidth, renderHeight);
          gl.uniform1i(this.textureLocation, 0);
          gl.uniform4f(this.filterLocation, filterMode(batch.filterType), batch.filterAmount, 0, 0);
          gl.uniform1i(this.maskLocation, hasMask ? 1 : 0);
          gl.uniform4f(this.maskRectLocation, hasMask ? maskX : 0, hasMask ? maskY : 0, hasMask ? maskWidth : 0, hasMask ? maskHeight : 0);
          gl.enableVertexAttribArray(this.positionLocation);
          gl.enableVertexAttribArray(this.uvLocation);
          gl.enableVertexAttribArray(this.colorLocation);
          if (batch.staticOwner) {
            this.bindVertexBuffer(this.ensureStaticBuffer(batch));
          } else {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            this.bindVertexBuffer(this.buffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.data);
          }
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.getTexture(batch.texture));
          if (hasMask) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.getTexture(batch.maskTexture)); gl.activeTexture(gl.TEXTURE0); }
          gl.drawArrays(gl.TRIANGLES, 0, batch.vertexCount);
        }
      }
    } finally {
      this.setBlendMode("normal");
      gl.disable(gl.SCISSOR_TEST);
      gl.activeTexture?.(gl.TEXTURE0);
      gl.bindFramebuffer?.(gl.FRAMEBUFFER, null);
    }
  }

  readRenderTarget(target) {
    if (this.destroyed || this.lost || !this.gl) throw new Error("WebGL readback kullanılamıyor.");
    const entry = this.ensureRenderTarget(target);
    if (typeof this.gl.readPixels !== "function") {
      const error = new Error("WebGL readPixels desteği yok.");
      error.code = "EXI_RENDER_OBSERVE_UNAVAILABLE";
      throw error;
    }
    const pixels = new Uint8Array(entry.width * entry.height * 4);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, entry.framebuffer);
    try { this.gl.readPixels(0, 0, entry.width, entry.height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, pixels); }
    finally { this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null); }
    return { width: entry.width, height: entry.height, format: "rgba8", pixels, flipY: true };
  }

  getInfo() {
    const info = this.info;
    info.backend = "webgl2";
    info.maxTextureSize = this.maxTextureSize;
    info.textureCount = this.textures.size;
    info.renderTargetCount = this.renderTargets.size;
    info.textureBytes = this.textureBytes;
    info.maxTextureBytes = this.maxTextureBytes;
    info.maxTextureCount = this.maxTextureCount;
    info.textureUploads = this.textureUploads;
    info.textureUploadBytes = this.textureUploadBytes;
    info.staticBufferCount = this.staticBuffers.size;
    info.staticBufferResizes = this.staticBufferResizes;
    info.vertexBufferBytes = this.bufferSize;
    info.vertexBufferResizes = this.bufferResizes;
    info.instanceBufferBytes = this.instanceBufferSize;
    info.instanceBufferResizes = this.instanceBufferResizes;
    Object.assign(info, this.metrics);
    return info;
  }

  destroy() {
    this.destroyed = true;
    this.canvas?.removeEventListener?.("webglcontextlost", this.handleContextLost);
    this.canvas?.removeEventListener?.("webglcontextrestored", this.handleContextRestored);
    if (this.gl) {
      for (const texture of this.textures.values()) this.gl.deleteTexture(texture);
      for (const entry of this.renderTargets.values()) { this.gl.deleteFramebuffer?.(entry.framebuffer); this.gl.deleteTexture(entry.texture); }
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.instanceBuffer) this.gl.deleteBuffer(this.instanceBuffer);
      for (const entry of this.staticBuffers.values()) this.gl.deleteBuffer(entry.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
      if (this.instancedProgram) this.gl.deleteProgram(this.instancedProgram);
    }
    this.renderGroups.length = 0;
    this.textures.clear(); this.renderTargets.clear(); this.textureVersions.clear(); this.textureFilters.clear(); this.textureByteSizes.clear(); this.textureBytes = 0; this.staticBuffers.clear(); this.buffer = null; this.bufferSize = 0; this.instanceBuffer = null; this.instanceBufferSize = 0; this.program = null; this.instancedProgram = null; this.filterLocation = null; this.instanceFilterLocation = null; this.maskLocation = null; this.instanceMaskLocation = null; this.maskRectLocation = null; this.instanceMaskRectLocation = null; this.maxTextureSize = 0; this.gl = null;
  }
}
