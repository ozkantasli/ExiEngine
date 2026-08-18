// ExiEngine unit test — Tween / Animator / easing
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tween, Animator, easing } from "../../src/index.js";

test("animation: easing fonksiyonları sözleşmesi", () => {
  for (const name of Object.keys(easing)) {
    const fn = easing[name];
    assert.equal(typeof fn, "function", `easing.${name} fonksiyon olmalı`);
    assert.equal(fn(0), 0, `easing.${name}(0) = 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-7, `easing.${name}(1) = 1`);
    assert.ok(Number.isFinite(fn(0.5)), `easing.${name}(0.5) finite`);
  }
});

test("animation: Tween ilerleme ve yoyo/loop", () => {
  const target = { value: 0 };
  const tween = new Tween(target, "value", 10, 1, { loop: 2, yoyo: true, ease: (value) => value });
  tween.update(1);
  assert.equal(target.value, 10);
  tween.update(0.5);
  assert.equal(target.value, 5);
  tween.update(0.5);
  assert.equal(target.value, 0);
  tween.update(1);
  assert.equal(target.value, 10);
});

test("animation: güvenli easing ve bounded değerler", () => {
  const target = { value: 0 };
  const unsafe = new Tween(target, "value", 10, 1, { ease: () => Infinity });
  unsafe.update(0.5);
  assert.equal(target.value, 5);
  const bounded = new Tween({ value: 0 }, "value", Infinity, Infinity);
  bounded.update(Infinity);
  assert.equal(Number.isFinite(bounded.target.value), true);
  assert.throws(() => new Tween({}, "value", 1, 1, { ease: "invalid" }), /easing/);
});

test("animation: Animator ekle/çıkar ve limitler", () => {
  const animator = new Animator();
  const target = { value: 0 };
  animator.add(new Tween(target, "value", 10, 1, { ease: (value) => value }));
  animator.update(0.5);
  assert.equal(target.value, 5);
  animator.update(0.5);
  assert.equal(target.value, 10);

  const limited = new Animator({ maxTweens: 1 });
  const a = new Tween({ value: 0 }, "value", 1, 1);
  const b = new Tween({ value: 0 }, "value", 1, 1);
  assert.equal(limited.add(a), a);
  assert.equal(limited.add(a), a);
  assert.throws(() => limited.add(b), /en fazla 1 tween/);
  assert.equal(limited.remove(a), true);
  assert.equal(limited.add(b), b);
  assert.throws(() => new Animator({ maxTweens: 0 }), /tween limiti/);
  assert.throws(() => new Animator({ maxTweens: 65_537 }), /tween limiti/);
});

test("animation: Animator doğrudan mutasyon koruması", () => {
  const limited = new Animator({ maxTweens: 1 });
  limited.tweens.add(new Tween({ value: 0 }, "value", 1, 1));
  assert.throws(() => limited.add(new Tween({ value: 0 }, "value", 1, 1)), /en fazla 1 tween/);
  limited.tweens.add(new Tween({ value: 0 }, "value", 1, 1));
  assert.throws(() => limited.update(0), /tween limiti/);
  const capacity = new Animator({ maxTweens: 1 });
  capacity.maxTweens = 2;
  assert.throws(() => capacity.add(new Tween({ value: 0 }, "value", 1, 1)), /tween limiti/);
});

test("animation: onComplete ve otomatik kaldırma", () => {
  let completions = 0;
  const animator = new Animator({ maxTweens: 1 });
  animator.add(new Tween({ value: 0 }, "value", 1, 1, { onComplete: () => { completions += 1; } }));
  animator.update(1);
  assert.equal(completions, 1);
  assert.equal(animator.tweens.size, 0);
});
