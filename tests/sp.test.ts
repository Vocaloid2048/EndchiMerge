/**
 * `SpResource` 的單元測試。
 * Unit tests for `SpResource`.
 *
 * 技力是「技能可不可用」的唯一判準，所以它的邊界（夾在上限、扣費時機、臨時上限）必須被
 * 逐條釘住 —— 這些錯誤只會在玩了一段時間之後才看得出來。
 * SP is the sole gate on skill availability, so its boundaries — clamping, charge timing, the
 * temporary ceiling — are pinned one by one; otherwise they only surface after a long session.
 */

import { describe, expect, it } from 'vitest';
import { SpResource, type SpResourceOptions } from '../src/game/sp';

const BASE: SpResourceOptions = {
  max: 3,
  initial: 0,
  gainPerDrop: 0.05,
  gainPerCombo: 0.05,
  overflowAllowed: false,
};

function makeSp(overrides: Partial<SpResourceOptions> = {}): SpResource {
  return new SpResource({ ...BASE, ...overrides });
}

describe('SpResource — 累積 / accrual', () => {
  it('adds 0.05 per drop and per combo', () => {
    const sp = makeSp();

    sp.gainForDrop();
    sp.gainForCombo();
    sp.gainForCombo();

    expect(sp.current).toBeCloseTo(0.15, 10);
  });

  it('clamps at the cap when overflow is not allowed', () => {
    const sp = makeSp({ max: 2 });
    for (let i = 0; i < 100; i += 1) sp.gainForDrop();

    expect(sp.current).toBe(2);
  });

  it('keeps accruing past the cap when overflow is allowed', () => {
    const sp = makeSp({ max: 1, overflowAllowed: true });
    for (let i = 0; i < 40; i += 1) sp.gainForDrop();

    expect(sp.current).toBeCloseTo(2, 10);
    /* 上限不變，所以填充比例可以超過 1 —— UI 自己夾。 */
    expect(sp.max).toBe(1);
  });

  it('ignores non-positive or non-finite amounts', () => {
    const sp = makeSp();
    sp.gain(0);
    sp.gain(-1);
    sp.gain(Number.NaN);

    expect(sp.current).toBe(0);
  });
});

describe('SpResource — 消耗與累計 / spending and the running total', () => {
  it('refuses a charge it cannot afford and leaves the state untouched', () => {
    const sp = makeSp({ initial: 1 });

    expect(sp.spend(2)).toBe(false);
    expect(sp.current).toBe(1);
    expect(sp.cumulativeSpent).toBe(0);
  });

  it('deducts and advances the cumulative total on success', () => {
    const sp = makeSp({ initial: 3 });

    expect(sp.spend(1)).toBe(true);
    expect(sp.spend(2)).toBe(true);
    expect(sp.current).toBe(0);
    expect(sp.cumulativeSpent).toBe(3);
  });

  it('treats a free skill as always affordable and never charges it', () => {
    const sp = makeSp();

    expect(sp.canAfford(0)).toBe(true);
    expect(sp.spend(0)).toBe(true);
    expect(sp.cumulativeSpent).toBe(0);
  });
});

describe('SpResource — 臨時上限 / temporary ceiling', () => {
  it('substitutes the cap and restores it', () => {
    const sp = makeSp();

    sp.setMaxOverride(5);
    expect(sp.max).toBe(5);
    expect(sp.hasMaxOverride).toBe(true);

    sp.setMaxOverride(null);
    expect(sp.max).toBe(3);
    expect(sp.hasMaxOverride).toBe(false);
  });

  it('clamps the temporary cap to [0, the hard ceiling]', () => {
    const sp = makeSp();

    sp.setMaxOverride(999);
    expect(sp.max).toBe(10);

    sp.setMaxOverride(-5);
    expect(sp.max).toBe(0);
  });

  it('pulls the current value down when the cap is lowered', () => {
    const sp = makeSp({ initial: 3 });

    sp.setMaxOverride(1);
    expect(sp.current).toBe(1);

    sp.setMaxOverride(4);
    /* 上限回去並不會把值補回來 —— 那是玩家自己賺的。 */
    expect(sp.current).toBe(1);
  });
});

describe('SpResource — 開新局 / reset', () => {
  it('restores the initial value, clears the total and drops the override', () => {
    const sp = makeSp({ initial: 2 });
    sp.gainForDrop();
    sp.spend(1);
    sp.setMaxOverride(5);

    sp.reset();

    expect(sp.current).toBe(2);
    expect(sp.cumulativeSpent).toBe(0);
    expect(sp.hasMaxOverride).toBe(false);
    expect(sp.max).toBe(3);
  });

  it('clamps an initial value above the cap', () => {
    const sp = makeSp({ initial: 99 });
    expect(sp.current).toBe(3);
  });
});
