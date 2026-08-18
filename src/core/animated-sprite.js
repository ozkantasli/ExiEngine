import { Sprite } from "./sprite.js";
import { Texture } from "../assets/texture.js";

const MAX_ANIMATION_FRAMES = 4_096;
const MAX_ANIMATION_RATE = 240;
const MAX_ANIMATION_DELTA = 5;
const MAX_ANIMATION_STEPS = 4_096;

function validateFrames(frames) {
  if (!Array.isArray(frames) || frames.length === 0 || frames.length > MAX_ANIMATION_FRAMES || frames.some((frame) => !(frame instanceof Texture))) throw new TypeError("AnimatedSprite frames Texture dizisi geçersiz veya limit dışı.");
  return frames.slice();
}

export class AnimatedSprite extends Sprite {
  constructor({ frames = [], frameRate = 12, loop = true, pingPong = false, playing = true, onComplete = null, onLoop = null, onFrameChange = null, ...options } = {}) {
    const normalizedFrames = validateFrames(frames);
    if (onComplete !== null && typeof onComplete !== "function") throw new TypeError("AnimatedSprite onComplete fonksiyonu gerekli.");
    if (onLoop !== null && typeof onLoop !== "function") throw new TypeError("AnimatedSprite onLoop fonksiyonu gerekli.");
    if (onFrameChange !== null && typeof onFrameChange !== "function") throw new TypeError("AnimatedSprite onFrameChange fonksiyonu gerekli.");
    super({ ...options, texture: normalizedFrames[0] });
    this.frames = normalizedFrames;
    const requestedRate = Number(frameRate);
    this.frameRate = Number.isFinite(requestedRate) ? Math.min(MAX_ANIMATION_RATE, Math.max(0, requestedRate)) : 0;
    this.loop = loop !== false;
    this.pingPong = Boolean(pingPong);
    this.playing = playing !== false;
    this.onComplete = onComplete;
    this.onLoop = onLoop;
    this.onFrameChange = onFrameChange;
    this.currentFrame = 0;
    this.direction = 1;
    this.elapsed = 0;
  }

  setFrames(frames) {
    const normalizedFrames = validateFrames(frames);
    const previousFrame = this.currentFrame;
    const previousTexture = this.texture;
    this.frames = normalizedFrames;
    this.currentFrame = Math.min(this.currentFrame, normalizedFrames.length - 1);
    this.direction = 1;
    this.elapsed = 0;
    this.setTexture(normalizedFrames[this.currentFrame]);
    if (previousFrame !== this.currentFrame || previousTexture !== this.texture) this.onFrameChange?.(this, this.currentFrame);
    return this;
  }

  assertFrameLimit() {
    if (!Array.isArray(this.frames) || this.frames.length === 0 || this.frames.length > MAX_ANIMATION_FRAMES) throw new RangeError(`AnimatedSprite frame limiti ${MAX_ANIMATION_FRAMES}.`);
  }

  gotoFrame(index) {
    this.assertFrameLimit();
    const nextFrame = Math.max(0, Math.min(this.frames.length - 1, index | 0));
    const changed = nextFrame !== this.currentFrame;
    this.currentFrame = nextFrame;
    this.direction = 1;
    this.elapsed = 0;
    this.setTexture(this.frames[this.currentFrame]);
    if (changed) this.onFrameChange?.(this, this.currentFrame);
    return this;
  }

  play() { this.playing = true; return this; }
  stop() { this.playing = false; return this; }

  update(delta) {
    this.assertFrameLimit();
    super.update(delta);
    if (!this.playing || this.frames.length < 2 || this.frameRate <= 0) return;
    const requestedDelta = Number(delta);
    this.elapsed += Number.isFinite(requestedDelta) ? Math.min(MAX_ANIMATION_DELTA, Math.max(0, requestedDelta)) : 0;
    const frameDuration = 1 / this.frameRate;
    let steps = 0;
    while (this.elapsed >= frameDuration && this.playing && steps < MAX_ANIMATION_STEPS) {
      this.elapsed -= frameDuration;
      steps += 1;
      if (this.pingPong && this.loop) {
        if (this.direction > 0) {
          if (this.currentFrame < this.frames.length - 1) this.currentFrame += 1;
          else { this.direction = -1; this.currentFrame -= 1; }
        } else if (this.currentFrame > 0) this.currentFrame -= 1;
        else { this.direction = 1; this.currentFrame += 1; this.onLoop?.(this); }
      } else if (this.currentFrame < this.frames.length - 1) this.currentFrame += 1;
      else if (this.loop) { this.currentFrame = 0; this.onLoop?.(this); }
      else { this.playing = false; this.onComplete?.(this); break; }
      this.setTexture(this.frames[this.currentFrame]);
      this.onFrameChange?.(this, this.currentFrame);
    }
    if (steps === MAX_ANIMATION_STEPS && this.elapsed >= frameDuration) this.elapsed %= frameDuration;
  }
}
