/**
 * 連擊的單元測試。
 * Unit tests for combos.
 *
 * 這裡釘住兩件事：
 * 1. **倍率曲線**：`y = min(e^(0.05x)/10, 9) + 1`（使用者指定），單調上升、`x = 90` 封頂。
 * 2. **窗口的邊界**：窗口**不是時間**，而是「本次投放」——所以時鐘完全不出現在這份測試裡，
 *    唯一能結束一串連擊的動作是 `reset()`。
 *
 * 這兩件都是「看畫面看不出來、改壞了也很難察覺」的東西：倍率錯了只會讓人覺得分數怪怪的，
 * 而窗口若不小心接回時間，玩家連續合成時會隨機斷連。
 *
 * Two things are pinned here:
 * 1. the **multiplier curve** — `y = min(e^(0.05x)/10, 9) + 1` (the user's formula), monotonic,
 *    capping at x = 90;
 * 2. the **window's edges** — the window is *not* time but "this drop", so no clock appears in
 *    this suite at all and the only thing that can end a chain is `reset()`.
 *
 * Both are the kind of thing a screen cannot show you: a wrong multiplier just makes the score
 * feel off, and a window that quietly grew a clock back would break chains at random.
 */

import { describe, expect, it } from 'vitest';
import { COMBO_CURVE, comboMultiplier, ComboTracker } from '../src/game/combo';

/** 曲線天花板 ＝ `cap + base` ＝ ×10.0。 */
const CEILING = COMBO_CURVE.cap + COMBO_CURVE.base;

describe('comboMultiplier — 指數曲線 / the exponential curve', () => {
  it('gives no bonus when there is no chain', () => {
    /* 靜止狀態顯示 ×1.1 會讓玩家以為一直有加成，所以 0 特別回 ×1.0。 */
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(-3)).toBe(1);
  });

  it('starts just above ×1.1 on the first merge', () => {
    expect(comboMultiplier(1)).toBeCloseTo(1.1051, 4);
  });

  it('climbs slowly, pinned at known points of the user curve', () => {
    /* y = min(e^(0.05x)/10, 9) + 1；×1.3 剛好落在 x = 22。 */
    expect(comboMultiplier(4)).toBeCloseTo(1.1221, 4);
    expect(comboMultiplier(22)).toBeCloseTo(1.3004, 4);
    expect(comboMultiplier(44)).toBeCloseTo(1.9025, 4);
    expect(comboMultiplier(60)).toBeCloseTo(3.0086, 4);
  });

  it('caps at ×10.0 so one long cascade cannot blow the score up', () => {
    /* e^(0.05·90)/10 = 9.0017 ≥ 9，天花板從 x = 90 起生效。 */
    expect(comboMultiplier(89)).toBeLessThan(CEILING);
    expect(comboMultiplier(90)).toBe(CEILING);
    expect(comboMultiplier(91)).toBe(CEILING);
    expect(comboMultiplier(500)).toBe(CEILING);
  });

  it('rises monotonically', () => {
    for (let count = 1; count <= 95; count += 1) {
      expect(comboMultiplier(count)).toBeGreaterThanOrEqual(comboMultiplier(count - 1));
    }
  });

  it('treats a non-finite count as no bonus rather than producing NaN', () => {
    /*
     * `Infinity` 也走 base：與其讓「無限連擊」變成一個巨大的倍率，不如把它當成壞輸入，
     * 因為真正的連擊不可能無限長（`cap` 早就封頂了）。
     * `Infinity` falls back to base too: rather than turn "an infinite chain" into a huge
     * multiplier, it is treated as bad input — a real chain can never be infinite because the
     * cap already stops it long before.
     */
    expect(comboMultiplier(Number.NaN)).toBe(1);
    expect(comboMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('ComboTracker — 窗口就是一次投放 / the window is the drop', () => {
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
    /*
     * 同一物理步的多場合併在舊設計裡要被「同一批」判準壓成一次，現在不必了 ——
     * 窗口是投放，所以它們只要落在同一串裡就各自遞增（使用者定案）。
     * Merges sharing one physics step used to be collapsed by a "same batch" rule; they no
     * longer need one, because the window is the drop and each merge climbs the curve.
     */
    const combo = new ComboTracker();

    expect(combo.record().count).toBe(1);
    expect(combo.record().count).toBe(2);
    expect(combo.record().count).toBe(3);
  });

  it('never ends a chain on its own — only reset does', () => {
    /*
     * 這條是模組的靈魂：沒有時鐘。反覆查詢、甚至把 tracker 放很久（模擬上就是什麼都不做）
     * 都不會讓串長掉下來。
     * This is the module's soul: there is no clock. Querying repeatedly, or letting the
     * tracker sit untouched, must never shrink the chain.
     */
    const combo = new ComboTracker();
    combo.record();
    combo.record();

    for (let i = 0; i < 100; i += 1) combo.snapshot();

    expect(combo.count).toBe(2);
  });

  it('reports the latest merge\'s multiplier without consuming anything', () => {
    /*
     * `snapshot()` 是無副作用查詢：`multiplier` 永遠是「最後一次合成所用的」，查幾次都一樣，
     * 串長也不會被推進。
     * `snapshot()` is a side-effect-free poll: `multiplier` is always the latest merge's, the
     * same however often it is read, and the chain never advances by asking.
     */
    const combo = new ComboTracker();

    expect(combo.snapshot()).toEqual({ count: 0, multiplier: 1 });

    combo.record();
    expect(combo.snapshot()).toEqual({ count: 1, multiplier: comboMultiplier(1) });

    combo.record();
    expect(combo.snapshot()).toEqual({ count: 2, multiplier: comboMultiplier(2) });
    expect(combo.count).toBe(2);
  });

  it('resets the chain on drop', () => {
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
