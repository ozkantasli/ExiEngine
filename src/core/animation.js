import { clamp, lerp } from "./math.js";

const MAX_TWEEN_DURATION = 3_600;
const MAX_TWEEN_DELTA = 5;
const MAX_TWEEN_LOOPS = 1_000_000;
const MAX_ANIMATOR_TWEENS = 65_536;

const bounceOut = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const t2 = t - 1.5 / d1;
    return n1 * t2 * t2 + 0.75;
  }
  if (t < 2.5 / d1) {
    const t2 = t - 2.25 / d1;
    return n1 * t2 * t2 + 0.9375;
  }
  const t2 = t - 2.625 / d1;
  return n1 * t2 * t2 + 0.984375;
};

export const easing = {
  linear: (value) => value,
  smooth: (value) => value * value * (3 - 2 * value),
  inQuad: (value) => value * value,
  outQuad: (value) => value * (2 - value),
  inOutQuad: (value) => value < 0.5 ? 2 * value * value : -1 + (4 - 2 * value) * value,
  inCubic: (value) => value * value * value,
  outCubic: (value) => 1 - (1 - value) ** 3,
  inOutCubic: (value) => value < 0.5 ? 4 * value * value * value : (value - 1) * (2 * value - 2) * (2 * value - 2) + 1,
  inSine: (value) => 1 - Math.cos((value * Math.PI) / 2),
  outSine: (value) => Math.sin((value * Math.PI) / 2),
  inOutSine: (value) => (1 - Math.cos(Math.PI * value)) / 2,
  inExpo: (value) => value === 0 ? 0 : 2 ** (10 * (value - 1)),
  outExpo: (value) => value === 1 ? 1 : 1 - 2 ** (-10 * value),
  inOutExpo: (value) => {
    if (value === 0) return 0;
    if (value === 1) return 1;
    return value < 0.5 ? 2 ** (20 * value - 10) / 2 : (2 - 2 ** (-20 * value + 10)) / 2;
  },
  inBounce: (value) => 1 - bounceOut(1 - value),
  outBounce: bounceOut,
  inOutBounce: (value) => value < 0.5 ? (1 - bounceOut(1 - 2 * value)) / 2 : (1 + bounceOut(2 * value - 1)) / 2,
  inElastic: (value) => {
    if (value === 0) return 0;
    if (value === 1) return 1;
    return -(2 ** (10 * (value - 1))) * Math.sin((value - 1.1) * 5 * Math.PI);
  },
  outElastic: (value) => {
    if (value === 0) return 0;
    if (value === 1) return 1;
    return 2 ** (-10 * value) * Math.sin((value - 0.1) * 5 * Math.PI) + 1;
  },
};

export class Tween {
  constructor(target, property, to, duration, { from = target[property], ease = easing.smooth, loop = 0, yoyo = false, onComplete = null } = {}) {
    if (!target || typeof property !== "string") throw new TypeError("Tween hedefi ve property gerekli.");
    if (typeof ease !== "function") throw new TypeError("Tween easing fonksiyonu gerekli.");
    if (onComplete !== null && typeof onComplete !== "function") throw new TypeError("Tween onComplete fonksiyonu gerekli.");
    this.target = target;
    this.property = property;
    const requestedFrom = Number(from); const requestedTo = Number(to); const requestedDuration = Number(duration);
    this.from = Number.isFinite(requestedFrom) ? requestedFrom : 0;
    this.to = Number.isFinite(requestedTo) ? requestedTo : 0;
    this.duration = Number.isFinite(requestedDuration) && requestedDuration > 0 ? Math.min(MAX_TWEEN_DURATION, Math.max(0.0001, requestedDuration)) : 0.0001;
    this.ease = ease;
    const requestedLoops = Number(loop);
    this.loop = requestedLoops === Infinity ? Infinity : Number.isFinite(requestedLoops) ? Math.min(MAX_TWEEN_LOOPS, Math.max(0, Math.floor(requestedLoops))) : 0;
    this.yoyo = yoyo;
    this.onComplete = onComplete;
    this.elapsed = 0;
    this.finished = false;
    target[property] = this.from;
  }

  update(delta) {
    if (this.finished) return false;
    const requestedDelta = Number(delta);
    this.elapsed += Number.isFinite(requestedDelta) ? Math.min(MAX_TWEEN_DELTA, Math.max(0, requestedDelta)) : 0;
    const progress = clamp(this.elapsed / this.duration, 0, 1);
    const easedValue = Number(this.ease(progress));
    const eased = Number.isFinite(easedValue) ? easedValue : progress;
    this.target[this.property] = lerp(this.from, this.to, eased);
    if (progress < 1) return true;
    if (this.loop > 0 || this.loop === Infinity) {
      if (this.loop !== Infinity) this.loop -= 1;
      this.elapsed = 0;
      if (this.yoyo) { const from = this.from; this.from = this.to; this.to = from; }
      return true;
    }
    this.finished = true;
    this.target[this.property] = this.to;
    this.onComplete?.();
    return false;
  }
}

export class Animator {
  constructor({ maxTweens = 4_096 } = {}) {
    const requestedLimit = Number(maxTweens);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit <= 0 || requestedLimit > MAX_ANIMATOR_TWEENS) throw new RangeError(`Animator tween limiti 1-${MAX_ANIMATOR_TWEENS} arasında olmalı.`);
    this._tweenCapacity = requestedLimit;
    this.maxTweens = requestedLimit;
    this.tweens = new Set();
  }
  assertTweenLimit() {
    if (this.maxTweens !== this._tweenCapacity || this.tweens.size > this._tweenCapacity) throw new RangeError(`Animator tween limiti ${this._tweenCapacity}.`);
  }
  add(tween) {
    if (!(tween instanceof Tween)) throw new TypeError("Tween bekleniyor.");
    this.assertTweenLimit();
    if (!this.tweens.has(tween) && this.tweens.size >= this._tweenCapacity) throw new RangeError(`Animator en fazla ${this._tweenCapacity} tween destekler.`);
    this.tweens.add(tween);
    return tween;
  }
  remove(tween) { return this.tweens.delete(tween); }
  update(delta) { this.assertTweenLimit(); for (const tween of this.tweens) if (!tween.update(delta)) this.tweens.delete(tween); }
  clear() { this.tweens.clear(); }
}
