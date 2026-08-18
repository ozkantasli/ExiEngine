export class Profiler {
  constructor() { this.frames = 0; this.fps = 0; this.frameMs = 0; this.lastTime = 0; this.windowStart = 0; this.started = false; this.metrics = {}; this.snapshotValues = {}; }

  begin(time) { this.lastTime = time; if (!this.started) { this.windowStart = time; this.started = true; } }

  end(time, metrics = {}) {
    this.frames += 1;
    this.frameMs = Math.max(0, time - this.lastTime);
    const nextMetrics = metrics && typeof metrics === "object" ? metrics : {};
    for (const key in this.metrics) if (!(key in nextMetrics)) delete this.metrics[key];
    Object.assign(this.metrics, nextMetrics);
    if (time - this.windowStart >= 1000) { this.fps = this.frames * 1000 / (time - this.windowStart); this.frames = 0; this.windowStart = time; }
  }

  snapshot() {
    const snapshot = this.snapshotValues;
    snapshot.fps = Math.round(this.fps);
    snapshot.frameMs = Number(this.frameMs.toFixed(2));
    for (const key in snapshot) if (key !== "fps" && key !== "frameMs" && !(key in this.metrics)) delete snapshot[key];
    Object.assign(snapshot, this.metrics);
    return snapshot;
  }
}
