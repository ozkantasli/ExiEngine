// ExiEngine unit test — ParticleEmitter
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleEmitter, Scene, Camera, Texture, SpriteBatch } from "../../src/index.js";
import { buildRenderBatches } from "../../src/render/batch.js";

test("particles: emit ve update", () => {
  const emitter = new ParticleEmitter({ maxParticles: 4, random: () => 0.5 });
  assert.equal(emitter.emit(4, { size: 2 }), 4);
  assert.equal(emitter.particles.length, 4);
  emitter.update(0.1);
  emitter.update(2);
  assert.equal(emitter.particles.length, 0);
});

test("particles: limitler ve doğrudan mutasyon", () => {
  assert.throws(() => new ParticleEmitter({ maxParticles: 100_001 }), /limiti/);
  const probe = new ParticleEmitter({ maxParticles: 1 });
  probe.particles.length = 2;
  assert.throws(() => probe.emit(), /limiti/);
  assert.throws(() => probe.update(0), /limiti/);
  assert.throws(() => probe.getInstanceItems(null), /limiti/);
  assert.throws(() => probe.getRenderItems(), /limiti/);
  const capacity = new ParticleEmitter({ maxParticles: 1 });
  capacity.maxParticles = 2;
  assert.throws(() => capacity.emit(), /limiti/);
});

test("particles: bounded değerler", () => {
  const emitter = new ParticleEmitter({ rate: Infinity, lifetime: Infinity, size: Infinity, random: null });
  assert.equal(emitter.rate, 0);
  assert.equal(Number.isFinite(emitter.lifetime), true);
  assert.equal(Number.isFinite(emitter.size), true);
  emitter.update(Infinity);
  const huge = new ParticleEmitter({ maxParticles: 1, rate: Number.MAX_VALUE, gravityX: Number.MAX_VALUE, gravityY: -Number.MAX_VALUE });
  huge.emit(1, { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, vx: Number.MAX_VALUE, vy: -Number.MAX_VALUE });
  huge.update(5);
  assert.equal(huge.rate <= 100_000, true);
  assert.equal(huge.particles.every((particle) => Object.values(particle).filter((value) => typeof value === "number").every(Number.isFinite)), true);
});

test("particles: instanced stream ve gpuCulling", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const emitter = new ParticleEmitter({ maxParticles: 2, gpuCulling: true, x: 10_000, y: 10_000 });
  emitter.emit(2, { size: 4, tint: 0xff0000 });
  const scene = new Scene();
  scene.add(emitter);
  let transformCalls = 0;
  const original = emitter.worldMatrix.transformPoint.bind(emitter.worldMatrix);
  emitter.worldMatrix.transformPoint = (...args) => { transformCalls += 1; return original(...args); };
  const gpuQueue = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: true });
  assert.equal(gpuQueue.batches[0].gpuCulling, true);
  assert.equal(gpuQueue.batches[0].gpuSource, true);
  assert.equal(gpuQueue.batches[0].instanceStride, 16);
  assert.equal(gpuQueue.batches[0].instanceData.length, 32);
  assert.equal(transformCalls, 0);
  emitter.position.set(0, 0);
  const cpuQueue = buildRenderBatches(scene, camera, 320, 180, { gpuCulling: false });
  assert.equal(cpuQueue.batches[0].gpuCulling, false);
  assert.equal(cpuQueue.batches[0].instanceStride, 14);
  assert.ok(transformCalls > 0);
});

test("particles: culling ve instance reuse", () => {
  const camera = new Camera({ width: 320, height: 180 });
  const emitter = new ParticleEmitter({ maxParticles: 2, x: 10_000, y: 10_000 });
  emitter.emit(2, { size: 4 });
  const scene = new Scene();
  scene.add(emitter);
  const queue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(queue.culledCount, 2);
  assert.equal(queue.batches.length, 0);
  emitter.position.set(0, 0);
  assert.equal(buildRenderBatches(scene, camera, 320, 180).batches[0].instanceCount, 2);
  const noCull = new ParticleEmitter({ maxParticles: 1, x: 10_000, y: 10_000, cullable: false });
  noCull.emit(1, { size: 4 });
  scene.add(noCull);
  const noCullQueue = buildRenderBatches(scene, camera, 320, 180);
  assert.equal(noCull.instanceItem.instanceCount, 1);
  assert.equal(noCullQueue.batches.some((batch) => batch.instanceCount >= 3), true);
});

test("particles: CPU fallback pooling", () => {
  const emitter = new ParticleEmitter({ maxParticles: 2, lifetime: 0.05, instanced: false });
  emitter.emit(2, { size: 2 });
  const pooled = emitter.particles.slice();
  const items = emitter.getRenderItems();
  const positions = items[0].positions;
  emitter.update(0.1);
  assert.equal(emitter.getRenderItems(), items);
  assert.equal(emitter.getRenderItems().length, 0);
  assert.equal(emitter.particlePool.length, 2);
  emitter.emit(2, { size: 2 });
  assert.equal(emitter.particles.includes(pooled[0]), true);
  assert.equal(emitter.particles.includes(pooled[1]), true);
  assert.equal(emitter.getRenderItems()[0].positions, positions);
  emitter.destroy();
});
