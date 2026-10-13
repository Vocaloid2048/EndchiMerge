/**
 * 連擊倍率曲線與連擊窗口（「上一顆有沒有合成」）的單元測試。
 * Unit tests for the combo multiplier curve and the combo window ("did the previous drop merge").
 */

import { describe, expect, it } from 'vitest';
import { COMBO_CURVE, comboMultiplier, ComboTracker } from '../src/game/combo';

/**
 * 曲線天花板 ＝ `cap + base` ＝ ×10.00。
 * The curve's ceiling is `cap + base`, i.e. ×10.00.
 */
const CEILING = COMBO_CURVE.cap + COMBO_CURVE.base;

describe('comboMultiplier — 指數曲線 / the exponential curve', () => {
  it('gives no bonus when there is no chain', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(-3)).toBe(1);
  });

  it('starts at ×1.05 on the first merge', () => {
    expect(comboMultiplier(1)).toBe(1.05);
  });

  it('matches the user\'s examples exactly: ×1.74 at 10, ×4.68 at 25', () => {
    expect(comboMultiplier(10)).toBe(1.74);
    expect(comboMultiplier(25)).toBe(4.68);
  });

  it('climbs gently, pinned at known points of the user curve', () => {
    expect(comboMultiplier(5)).toBe(1.3);
    expect(comboMultiplier(8)).toBe(1.55);
    expect(comboMultiplier(12)).toBe(1.97);
    expect(comboMultiplier(16)).toBe(2.55);
    expect(comboMultiplier(20)).toBe(3.32);
  });

  it('caps at ×10.00 so one long cascade cannot blow the score up', () => {
    /* e^(0.075·36)/1.5 − 1/1.5 = 9.25 ≥ 9，所以封頂正好從 x = 36 起。 */
    /* The raw value reaches the cap of 9 at x = 36, which is where the ceiling starts. */
    expect(comboMultiplier(35)).toBe(9.54);
    expect(comboMultiplier(35)).toBeLessThan(CEILING);
    expect(comboMultiplier(36)).toBe(CEILING);
    expect(comboMultiplier(37)).toBe(CEILING);
    expect(comboMultiplier(500)).toBe(CEILING);
  });

  it('rises monotonically', () => {
    for (let count = 1; count <= 40; count += 1) {
      expect(comboMultiplier(count)).toBeGreaterThanOrEqual(comboMultiplier(count - 1));
    }
  });

  it('treats a non-finite count as no bonus rather than producing NaN', () => {
    expect(comboMultiplier(Number.NaN)).toBe(1);
    expect(comboMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('ComboTracker — 窗口＝上一顆有沒有合成 / the window is "did it merge"', () => {
  it('starts a chain at 1 on the first merge', () => {
    const combo = new ComboTracker();

    expect(combo.record()).toEqual({ count: 1, multiplier: comboMultiplier(1) });
    expect(combo.count).toBe(1);
  });

  it('climbs the curve on each merge inside the same drop', () => {
    const combo = new ComboTracker();

    const first = combo.record().multiplier;
    const second = combo.record().multiplier;
    const third = combo.record().multiplier;

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(combo.count).toBe(3);
  });

  it('counts every merge separately even when they share a physics step', () => {
    const combo = new ComboTracker();

    expect(combo.record().count).toBe(1);
    expect(combo.record().count).toBe(2);
    expect(combo.record().count).toBe(3);
  });

  it('never ends a streak on its own — only reset does', () => {
    const combo = new ComboTracker();
    combo.record();
    combo.record();

    for (let i = 0; i < 100; i += 1) combo.snapshot();

    expect(combo.count).toBe(2);
  });

  it('reports the latest merge\'s multiplier without consuming anything', () => {
    const combo = new ComboTracker();

    expect(combo.snapshot()).toEqual({ count: 0, multiplier: 1 });

    combo.record();
    expect(combo.snapshot()).toEqual({ count: 1, multiplier: comboMultiplier(1) });

    combo.record();
    expect(combo.snapshot()).toEqual({ count: 2, multiplier: comboMultiplier(2) });
    expect(combo.count).toBe(2);
  });

  it('breaks the streak on reset — the "this drop merged nothing" signal', () => {
    const combo = new ComboTracker();
    combo.record();
    combo.record();

    combo.reset();

    expect(combo.count).toBe(0);
    expect(combo.snapshot()).toEqual({ count: 0, multiplier: 1 });
  });

  it('starts a fresh chain after a reset', () => {
    const combo = new ComboTracker();
    combo.record();
    combo.record();
    combo.record();

    combo.reset();

    expect(combo.record()).toEqual({ count: 1, multiplier: comboMultiplier(1) });
    expect(combo.record().multiplier).toBeCloseTo(comboMultiplier(2), 12);
  });
});
