/**
 * 連擊的單元測試。
 * Unit tests for combos.
 *
 * 這裡釘住兩件事：
 * 1. **倍率曲線**：`y = min(e^(0.25x)/10, 9) + 1`（使用者指定），單調上升、`x = 18` 封頂。
 * 2. **窗口的邊界**：窗口**不是時間**，而是「上一顆有沒有合成」——所以時鐘完全不出現在這份
 *    測試裡，唯一能結束一串連勝的動作是 `reset()`（由「零合成」那次投放呼叫）。
 *
 * 這兩件都是「看畫面看不出來、改壞了也很難察覺」的東西：倍率錯了只會讓人覺得分數怪怪的，
 * 而窗口若不小心接回時間，玩家連續合成時會隨機斷連。
 *
 * Two things are pinned here:
 * 1. the **multiplier curve** — `y = min(e^(0.25x)/10, 9) + 1` (the user's formula), monotonic,
 *    capping at x = 18;
 * 2. the **window's edges** — the window is *not* time but "did the previous drop merge", so no
 *    clock appears in this suite at all and the only thing that can end a streak is `reset()`.
 *
 * Both are the kind of thing a screen cannot show you: a wrong multiplier just makes the score
 * feel off, and a window that quietly grew a clock back would break streaks at random.
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
    expect(comboMultiplier(1)).toBeCloseTo(1.1284, 4);
  });

  it('reads ×1.3 at x = 4, exactly as the user\'s example showed', () => {
    /*
     * 使用者舉的示例是「4 / + 18 (×1.3)」，這條測試就是那個示例。
     * `e^(0.25·4) = e^1`，`e^1 / 10 = 0.2718`，`+ 1 = 1.2718`，四捨五入到小數一位 = ×1.3。
     *
     * 順帶把 `max` 寫法的問題釘死：`max(e^(0.25·4)/10, 9) + 1` 會是 ×10.0，與示例矛盾 ——
     * 所以曲線必須是 `min`。若有人把 `Math.min` 改成 `Math.max`，這條會先爆。
     * The user's own example is "4 / + 18 (×1.3)", and this test *is* that example:
     * `e^1 / 10 = 0.2718`, `+ 1 = 1.2718`, which rounds to ×1.3.
     *
     * It also nails down why the curve must be `min`: `max(e^(0.25·4)/10, 9) + 1` would be
     * ×10.0, contradicting the example. Anyone swapping `Math.min` for `Math.max` fails here
     * first.
     */
    expect(comboMultiplier(4)).toBeCloseTo(1.2718, 4);
    expect(Math.round(comboMultiplier(4) * 10) / 10).toBe(1.3);
  });

  it('climbs steeply, pinned at known points of the user curve', () => {
    /* y = min(e^(0.25x)/10, 9) + 1：每 +4 就跳 e 倍，指數項成長很快。 */
    expect(comboMultiplier(8)).toBeCloseTo(1.7389, 4);
    expect(comboMultiplier(12)).toBeCloseTo(3.0086, 4);
    expect(comboMultiplier(16)).toBeCloseTo(6.4598, 4);
  });

  it('caps at ×10.0 so one long cascade cannot blow the score up', () => {
    /* e^(0.25·18)/10 = 9.0017 ≥ 9，天花板從 x = 18 起生效。 */
    expect(comboMultiplier(17)).toBeLessThan(CEILING);
    expect(comboMultiplier(18)).toBe(CEILING);
    expect(comboMultiplier(19)).toBe(CEILING);
    expect(comboMultiplier(500)).toBe(CEILING);
  });

  it('rises monotonically', () => {
    for (let count = 1; count <= 40; count += 1) {
      expect(comboMultiplier(count)).toBeGreaterThanOrEqual(comboMultiplier(count - 1));
    }
  });

  it('treats a non-finite count as no bonus rather than producing NaN', () => {
    /*
     * `Infinity` 也走 base：與其讓「無限連擊」變成一個巨大的倍率，不如把它當成壞輸入，
     * 因為真正的連勝不可能無限長（`cap` 早就封頂了）。
     * `Infinity` falls back to base too: rather than turn "an infinite chain" into a huge
     * multiplier, it is treated as bad input — a real chain can never be infinite because the
     * cap already stops it long before.
     */
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
    /*
     * 同一物理步的多場合併在舊設計裡要被「同一批」判準壓成一次，現在不必了 ——
     * 判準是「有沒有合成」，所以它們只要落在同一串裡就各自遞增（使用者定案）。
     * Merges sharing one physics step used to be collapsed by a "same batch" rule; they no
     * longer need one, because the test is "did it merge" and each merge climbs the curve.
     */
    const combo = new ComboTracker();

    expect(combo.record().count).toBe(1);
    expect(combo.record().count).toBe(2);
    expect(combo.record().count).toBe(3);
  });

  it('never ends a streak on its own — only reset does', () => {
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

  it('breaks the streak on reset — the "this drop merged nothing" signal', () => {
    /*
     * `reset()` 名字上很通用，但呼叫端只有一個：`drop()` 在「上一顆零合成」時呼叫它。
     * 所以「reset 會斷連」等同於「零合成會斷連」，這是連勝唯一的斷法。
     * `reset()` is a generic name, but it has exactly one caller: `drop()`, on "the previous
     * drop merged nothing". So "reset breaks the streak" *is* "a zero-merge drop breaks it",
     * the only way a streak can end.
     */
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
