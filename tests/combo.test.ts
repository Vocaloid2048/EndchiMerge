/**
 * 連擊的單元測試。
 * Unit tests for combos.
 *
 * 這裡釘住兩件事：**倍率曲線的端點**（60 連擊剛好到 ×10.0），以及**窗口的邊界**（1 秒
 * 內算同一串、超過就歸零、同一物理步只算一次）。兩者都是「看畫面看不出來、改壞了也很難
 * 察覺」的那種東西。
 * Two things are pinned here: the curve's endpoints (60 combos lands exactly on ×10.0) and the
 * window's edges (inside one second it continues, beyond it resets, and one physics step
 * counts once). Both are the kind of thing a screen cannot show you.
 */

import { describe, expect, it } from 'vitest';
import { COMBO_CURVE, comboMultiplier, ComboTracker } from '../src/game/combo';

describe('comboMultiplier — 曲線 / the curve', () => {
  it('gives no bonus when there is no chain', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(-3)).toBe(1);
  });

  it('reaches the ceiling at 60 combos', () => {
    expect(comboMultiplier(60)).toBeCloseTo(10, 6);
  });

  it('never exceeds the ceiling', () => {
    const ceiling = COMBO_CURVE.cap + COMBO_CURVE.base;

    expect(comboMultiplier(61)).toBe(ceiling);
    expect(comboMultiplier(500)).toBe(ceiling);
  });

  it('rises slowly and monotonically', () => {
    /* 慢速上升是指數曲線的意義所在 —— 前 20 連擊的增幅應該遠小於後 20 連擊。 */
    const early = comboMultiplier(20) - comboMultiplier(0);
    const late = comboMultiplier(60) - comboMultiplier(40);

    expect(early).toBeLessThan(late);
    for (let count = 1; count <= 60; count += 1) {
      expect(comboMultiplier(count)).toBeGreaterThanOrEqual(comboMultiplier(count - 1));
    }
  });

  it('starts just above 1 so the first chain is barely a bonus', () => {
    expect(comboMultiplier(1)).toBeGreaterThan(1);
    expect(comboMultiplier(1)).toBeLessThan(1.2);
  });
});

describe('ComboTracker — 窗口 / the window', () => {
  it('starts a chain at 1 on the first merge', () => {
    const combo = new ComboTracker(1000);

    expect(combo.record(0)).toEqual({ count: 1, multiplier: comboMultiplier(1) });
  });

  it('extends the chain for merges inside the window', () => {
    const combo = new ComboTracker(1000);

    combo.record(0);
    combo.record(500);
    const third = combo.record(1000);

    expect(third.count).toBe(3);
  });

  it('counts a merge exactly on the window boundary as a continuation', () => {
    const combo = new ComboTracker(1000);

    combo.record(0);

    expect(combo.record(1000).count).toBe(2);
  });

  it('restarts the chain once the window lapses', () => {
    const combo = new ComboTracker(1000);

    combo.record(0);
    combo.record(200);

    expect(combo.record(1500).count).toBe(1);
  });

  it('counts several merges from one physics step only once', () => {
    const combo = new ComboTracker(1000);

    combo.record(120);
    combo.record(120);
    const sameStep = combo.record(120);

    expect(sameStep.count).toBe(1);
  });

  it('reports an expired chain as zero without mutating it', () => {
    const combo = new ComboTracker(1000);
    combo.record(0);

    expect(combo.snapshotAt(3000)).toEqual({ count: 0, multiplier: 1 });
    /* 查詢不改變狀態：窗口內的同一串仍然讀得到。 */
    expect(combo.snapshotAt(400).count).toBe(1);
  });

  it('treats a backwards timestamp as a new chain rather than growing one', () => {
    const combo = new ComboTracker(1000);
    combo.record(500);

    expect(combo.record(0).count).toBe(1);
  });

  it('clears everything on reset', () => {
    const combo = new ComboTracker(1000);
    combo.record(0);
    combo.record(100);

    combo.reset();

    expect(combo.count).toBe(0);
    expect(combo.snapshotAt(100)).toEqual({ count: 0, multiplier: 1 });
  });
});
