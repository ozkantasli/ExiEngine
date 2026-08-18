import { Node } from "./node.js";
import { Texture } from "../assets/texture.js";
import { GPU_SOURCE_FLOATS, INSTANCE_FLOATS } from "../render/instanced.js";

const MAX_PARTICLES = 100_000;
const MAX_PARTICLE_RATE = MAX_PARTICLES;
const MAX_PARTICLE_COORDINATE = 1_000_000_000_000;
const MAX_PARTICLE_VELOCITY = 1_000_000;
const MAX_PARTICLE_DELTA = 5;
const MAX_PARTICLE_LIFETIME = 3_600;
const MAX_PARTICLE_SIZE = 4_096;
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;

function particleLifetime(value, fallback) { return Math.min(MAX_PARTICLE_LIFETIME, Math.max(0.001, number(value, fallback))); }
function particleSize(value, fallback) { return Math.min(MAX_PARTICLE_SIZE, Math.max(0.1, number(value, fallback))); }
function bounded(value, fallback, limit) { return Math.max(-limit, Math.min(limit, number(value, fallback))); }

function writeParticlePoint(particle, x, y, offset, matrix, camera, worldPoint, screenPoint, data) {
  matrix.transformPoint(particle.x + x, particle.y + y, worldPoint);
  camera.worldToScreen(worldPoint.x, worldPoint.y, screenPoint);
  data[offset] = screenPoint.x;
  data[offset + 1] = screenPoint.y;
}

function writeParticleColor(data, offset, tint) {
  const rawTint = typeof tint === "string" ? Number.parseInt(tint.replace(/^#/, ""), 16) : tint;
  const color = Number.isFinite(rawTint) ? rawTint >>> 0 : 0xffffff;
  data[offset + 10] = (color >> 16 & 255) / 255;
  data[offset + 11] = (color >> 8 & 255) / 255;
  data[offset + 12] = (color & 255) / 255;
}

export class ParticleEmitter extends Node {
  constructor({ texture = Texture.white, maxParticles = 512, rate = 0, gravityX = 0, gravityY = 0, lifetime = 1, size = 8, tint = 0xffffff, alpha = 1, random = Math.random, instanced = true, gpuCulling = false, ...options } = {}) {
    super({ name: "particles", ...options });
    this.isRenderable = true;
    if (!(texture instanceof Texture)) throw new TypeError("ParticleEmitter texture bekleniyor.");
    this.texture = texture;
    const requestedMaxParticles = Number(maxParticles);
    if (!Number.isSafeInteger(requestedMaxParticles) || requestedMaxParticles < 1 || requestedMaxParticles > MAX_PARTICLES) throw new RangeError(`ParticleEmitter maxParticles limiti ${MAX_PARTICLES}.`);
    this._particleCapacity = requestedMaxParticles;
    this.maxParticles = requestedMaxParticles;
    this.rate = Math.min(MAX_PARTICLE_RATE, Math.max(0, number(rate, 0)));
    this.gravityX = bounded(gravityX, 0, MAX_PARTICLE_VELOCITY); this.gravityY = bounded(gravityY, 0, MAX_PARTICLE_VELOCITY);
    this.lifetime = particleLifetime(lifetime, 1);
    this.size = particleSize(size, 8);
    this.tint = tint; this.alpha = Math.max(0, Math.min(1, number(alpha, 1)));
    this.random = typeof random === "function" ? random : Math.random;
    this.instanced = Boolean(instanced);
    this.gpuCulling = Boolean(gpuCulling) && this.instanced;
    this.isInstancedBatch = this.instanced;
    this.particles = [];
    this.particlePool = [];
    this.spawnAccumulator = 0;
    this.instanceData = this.instanced ? new Float32Array(this._particleCapacity * Math.max(INSTANCE_FLOATS, GPU_SOURCE_FLOATS)) : null;
    this.instanceItem = this.instanced ? { texture: this.texture, instanceData: null, instanceCount: 0, bounds: null, gpuCulling: false, instanceStride: INSTANCE_FLOATS, gpuSource: false } : null;
    this.instanceView = this.instanced ? new Float32Array(0) : null;
    this.instanceItems = this.instanced ? [this.instanceItem] : [];
    this.instanceWorldPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.instanceScreenPoint = this.instanced ? { x: 0, y: 0 } : null;
    this.renderItems = [];
    this.renderItemPool = [];
    this.lastCulledCount = 0;
  }

  assertParticleLimit() {
    if (this.maxParticles !== this._particleCapacity || this.particles.length > this._particleCapacity) throw new RangeError(`ParticleEmitter particle limiti ${this._particleCapacity}.`);
  }

  get count() { return this.particles.length; }

  clear() {
    while (this.particles.length > 0) this.particlePool.push(this.particles.pop());
    this.spawnAccumulator = 0;
    return this;
  }

  burst(count = 16, { minSpeed = 20, maxSpeed = 100, x = 0, y = 0, size, lifetime, tint, alpha } = {}) {
    this.assertParticleLimit();
    const requestedCount = Number(count);
    const amount = Math.min(this._particleCapacity - this.particles.length, Number.isSafeInteger(requestedCount) ? Math.max(0, requestedCount) : 0);
    const minS = Math.max(0, number(minSpeed, 20));
    const maxS = Math.max(minS, number(maxSpeed, 100));
    for (let index = 0; index < amount; index += 1) {
      const angle = (number(this.random(), Math.random()) * Math.PI * 2);
      const speed = minS + number(this.random(), Math.random()) * (maxS - minS);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      this.emit(1, { x, y, vx, vy, size, lifetime, tint, alpha });
    }
    return amount;
  }

  emit(count = 1, options = {}) {
    this.assertParticleLimit();
    const requestedCount = Number(count);
    const amount = Math.min(this._particleCapacity - this.particles.length, Number.isSafeInteger(requestedCount) ? Math.max(0, requestedCount) : 0);
    const particleOptions = options && typeof options === "object" ? options : {};
    for (let index = 0; index < amount; index += 1) {
      const life = particleLifetime(particleOptions.lifetime, this.lifetime);
      const particle = this.particlePool.pop() || { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1, tint: 0xffffff, alpha: 1 };
      particle.x = bounded(particleOptions.x, 0, MAX_PARTICLE_COORDINATE);
      particle.y = bounded(particleOptions.y, 0, MAX_PARTICLE_COORDINATE);
      particle.vx = bounded(particleOptions.vx, 0, MAX_PARTICLE_VELOCITY);
      particle.vy = bounded(particleOptions.vy, 0, MAX_PARTICLE_VELOCITY);
      particle.age = 0;
      particle.life = life;
      particle.size = particleSize(particleOptions.size, this.size);
      particle.tint = particleOptions.tint ?? this.tint;
      particle.alpha = Math.max(0, Math.min(1, number(particleOptions.alpha, this.alpha)));
      this.particles.push(particle);
    }
    return amount;
  }

  update(delta) {
    this.assertParticleLimit();
    super.update(delta);
    const step = Math.min(MAX_PARTICLE_DELTA, Math.max(0, number(delta, 0)));
    if (this.rate > 0) {
      this.spawnAccumulator += step * this.rate;
      const amount = Math.floor(this.spawnAccumulator);
      if (amount > 0) { this.spawnAccumulator -= amount; const randomX = number(this.random(), 0.5); const randomY = number(this.random(), 0.5); this.emit(amount, { vx: (randomX - 0.5) * 40, vy: (randomY - 0.5) * 40 }); }
    }
    let writeIndex = 0;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      particle.age += step; particle.vx = bounded(particle.vx + this.gravityX * step, 0, MAX_PARTICLE_VELOCITY); particle.vy = bounded(particle.vy + this.gravityY * step, 0, MAX_PARTICLE_VELOCITY); particle.x = bounded(particle.x + particle.vx * step, 0, MAX_PARTICLE_COORDINATE); particle.y = bounded(particle.y + particle.vy * step, 0, MAX_PARTICLE_COORDINATE);
      if (particle.age < particle.life) this.particles[writeIndex++] = particle;
      else this.particlePool.push(particle);
    }
    this.particles.length = writeIndex;
  }

  getInstanceItems(camera, width = camera?.width, height = camera?.height, { cull = true, gpuCulling = false, alpha = this.worldAlpha } = {}) {
    this.assertParticleLimit();
    const renderAlpha = Number.isFinite(Number(alpha)) ? Math.max(0, Math.min(1, Number(alpha))) : 1;
    if (!this.instanced || !this.particles.length) {
      this.instanceItems.length = 0;
      this.lastCulledCount = 0;
      return this.instanceItems;
    }
    const data = this.instanceData;
    const viewportWidth = Number.isFinite(Number(width)) ? Number(width) : Number(camera?.width) || 0;
    const viewportHeight = Number.isFinite(Number(height)) ? Number(height) : Number(camera?.height) || 0;
    const shouldCull = cull !== false && viewportWidth > 0 && viewportHeight > 0;
    const useGpuCulling = this.gpuCulling && gpuCulling;
    if (useGpuCulling) {
      const data = this.instanceData;
      const stride = GPU_SOURCE_FLOATS;
      for (let index = 0; index < this.particles.length; index += 1) {
        const particle = this.particles[index];
        const offset = index * stride;
        const particleAlpha = particle.alpha * Math.max(0, 1 - particle.age / particle.life) * renderAlpha;
        data[offset] = particle.x; data[offset + 1] = particle.y;
        data[offset + 2] = particle.size; data[offset + 3] = particle.size;
        data[offset + 4] = 0.5; data[offset + 5] = 0.5; data[offset + 6] = 0; data[offset + 7] = particleAlpha;
        data[offset + 8] = this.texture.u0; data[offset + 9] = this.texture.v0; data[offset + 10] = this.texture.u1; data[offset + 11] = this.texture.v1;
        const rawTint = typeof particle.tint === "string" ? Number.parseInt(particle.tint.replace(/^#/, ""), 16) : particle.tint;
        const tint = Number.isFinite(rawTint) ? rawTint >>> 0 : 0xffffff;
        data[offset + 12] = (tint >> 16 & 255) / 255; data[offset + 13] = (tint >> 8 & 255) / 255; data[offset + 14] = (tint & 255) / 255; data[offset + 15] = particleAlpha;
      }
      const visibleFloats = this.particles.length * stride;
      if (this.instanceView.length !== visibleFloats || this.instanceView.buffer !== data.buffer) this.instanceView = data.subarray(0, visibleFloats);
      this.instanceItem.texture = this.texture;
      this.instanceItem.instanceData = this.instanceView;
      this.instanceItem.instanceCount = this.particles.length;
      this.instanceItem.gpuCulling = true;
      this.instanceItem.instanceStride = stride;
      this.instanceItem.gpuSource = true;
      this.lastCulledCount = 0;
      this.instanceItems[0] = this.instanceItem;
      this.instanceItems.length = 1;
      return this.instanceItems;
    }
    const worldPoint = this.instanceWorldPoint;
    const screenPoint = this.instanceScreenPoint;
    let visibleCount = 0;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const half = particle.size * 0.5;
      const offset = visibleCount * INSTANCE_FLOATS;
      writeParticlePoint(particle, -half, -half, offset, this.worldMatrix, camera, worldPoint, screenPoint, data);
      writeParticlePoint(particle, half, -half, offset + 2, this.worldMatrix, camera, worldPoint, screenPoint, data);
      writeParticlePoint(particle, -half, half, offset + 4, this.worldMatrix, camera, worldPoint, screenPoint, data);
      if (shouldCull) {
        const originX = data[offset]; const originY = data[offset + 1];
        const axisXX = data[offset + 2]; const axisXY = data[offset + 3];
        const axisYX = data[offset + 4]; const axisYY = data[offset + 5];
        const cornerX = axisXX + axisYX - originX; const cornerY = axisXY + axisYY - originY;
        const minX = Math.min(originX, axisXX, axisYX, cornerX); const maxX = Math.max(originX, axisXX, axisYX, cornerX);
        const minY = Math.min(originY, axisXY, axisYY, cornerY); const maxY = Math.max(originY, axisXY, axisYY, cornerY);
        if (maxX < 0 || minX > viewportWidth || maxY < 0 || minY > viewportHeight) continue;
      }
      data[offset + 2] -= data[offset]; data[offset + 3] -= data[offset + 1];
      data[offset + 4] -= data[offset]; data[offset + 5] -= data[offset + 1];
      data[offset + 6] = this.texture.u0; data[offset + 7] = this.texture.v0; data[offset + 8] = this.texture.u1; data[offset + 9] = this.texture.v1;
      writeParticleColor(data, offset, particle.tint);
      data[offset + 13] = particle.alpha * Math.max(0, 1 - particle.age / particle.life) * renderAlpha;
      visibleCount += 1;
    }
    const visibleFloats = visibleCount * INSTANCE_FLOATS;
    if (this.instanceView.length !== visibleFloats || this.instanceView.buffer !== data.buffer) this.instanceView = data.subarray(0, visibleFloats);
    this.instanceItem.texture = this.texture;
    this.instanceItem.instanceData = this.instanceView;
    this.instanceItem.instanceCount = visibleCount;
    this.instanceItem.gpuCulling = false;
    this.instanceItem.instanceStride = INSTANCE_FLOATS;
    this.instanceItem.gpuSource = false;
    this.lastCulledCount = shouldCull ? this.particles.length - visibleCount : 0;
    this.instanceItems[0] = this.instanceItem;
    this.instanceItems.length = visibleCount > 0 ? 1 : 0;
    return this.instanceItems;
  }

  getRenderItems() {
    this.assertParticleLimit();
    const items = this.renderItems;
    items.length = this.particles.length;
    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index];
      const half = particle.size * 0.5;
      const item = items[index] || this.renderItemPool[index] || { texture: this.texture, tint: particle.tint, alpha: 0, positions: new Array(12), bounds: { x: 0, y: 0, width: 0, height: 0 } };
      const positions = item.positions;
      positions[0] = particle.x - half; positions[1] = particle.y - half;
      positions[2] = particle.x + half; positions[3] = particle.y - half;
      positions[4] = particle.x + half; positions[5] = particle.y + half;
      positions[6] = particle.x - half; positions[7] = particle.y - half;
      positions[8] = particle.x + half; positions[9] = particle.y + half;
      positions[10] = particle.x - half; positions[11] = particle.y + half;
      item.texture = this.texture;
      item.tint = particle.tint;
      item.alpha = particle.alpha * Math.max(0, 1 - particle.age / particle.life);
      const bounds = item.bounds || (item.bounds = { x: 0, y: 0, width: 0, height: 0 });
      bounds.x = particle.x - half; bounds.y = particle.y - half; bounds.width = particle.size; bounds.height = particle.size;
      items[index] = item;
      this.renderItemPool[index] = item;
    }
    return items;
  }

  destroy() {
    this.particles.length = 0;
    this.particlePool.length = 0;
    this.renderItems.length = 0;
    this.renderItemPool.length = 0;
    this.instanceItems.length = 0;
    this.instanceData = null;
    this.instanceView = null;
    this.instanceItem = null;
    super.destroy();
  }
}
