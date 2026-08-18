// ExiEngine unit test — Profiler
import { test } from "node:test";
import assert from "node:assert/strict";
import { Profiler } from "../../src/index.js";

test("profiler: ölçüm ve snapshot davranışı", () => {
  const profiler = new Profiler();
  profiler.begin(0);
  profiler.end(16, { drawCalls: 1, stale: true });
  const metrics = profiler.metrics;
  profiler.end(32, { drawCalls: 2 });
  assert.equal(profiler.metrics, metrics);
  assert.deepEqual(profiler.metrics, { drawCalls: 2 });
  const snapshot = profiler.snapshot();
  profiler.begin(32);
  profiler.end(48, { drawCalls: 3, batchCount: 1 });
  assert.equal(profiler.snapshot(), snapshot);
  assert.deepEqual(profiler.snapshot(), { fps: 0, frameMs: 16, drawCalls: 3, batchCount: 1 });
  profiler.begin(48);
  profiler.end(64, { drawCalls: 4 });
  assert.deepEqual(profiler.snapshot(), { fps: 0, frameMs: 16, drawCalls: 4 });
});

test("profiler: sınırlandırılmış geçmiş (bounded ring)", () => {
  const profiler = new Profiler();
  for (let frame = 0; frame < 300; frame += 1) {
    profiler.begin(frame);
    profiler.end(frame + 1, { drawCalls: 1 });
  }
  const snapshot = profiler.snapshot();
  assert.ok(Number.isFinite(snapshot.frameMs));
  assert.equal(snapshot.drawCalls, 1);
});
