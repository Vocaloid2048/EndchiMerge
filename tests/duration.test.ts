/**
 * 時長格式化。
 * Duration formatting.
 *
 * 這個格式現在只有**一個**消費點：排行榜每一列、分類數值右邊那一格（使用者定案把這一局的時間
 * 從 HUD 與結算卡移走）。它要蓋的範圍沒變 —— 一局可以短到 5 秒（撞線後清理失敗就直接結束），
 * 也可以長到兩小時（無盡模式的上限）—— 所以**每個欄位的補零**與**壞輸入**都要釘住。
 * The format now has a single consumer: the cell to the right of the category value in each
 * leaderboard row (the user's decision moved a run's time out of the HUD and the game-over card).
 * Its range has not changed, though — a run can last anywhere from 5 seconds (failing to clear the
 * line) to two hours (the endless-mode ceiling) — so **every field's padding** and **bad input** are
 * pinned here.
 */

import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/ui/duration';

describe('formatDuration — 時長格式 / duration format', () => {
  it('always prints HH:mm:ss, with every field padded', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(7_000)).toBe('00:00:07');
    expect(formatDuration(60_000)).toBe('00:01:00');
    expect(formatDuration(754_000)).toBe('00:12:34');
  });

  it('floors to whole seconds, so a partial second never rounds up', () => {
    expect(formatDuration(999)).toBe('00:00:00');
    expect(formatDuration(1_999)).toBe('00:00:01');
    expect(formatDuration(59_999)).toBe('00:00:59');
  });

  /*
   * 分段換的是**欄位**而不是字串形狀：59 → 60 分鐘只是小時欄由 `00` 變 `01`，長度不變，
   * 所以榜上那一整欄時間永遠等寬（列上已有 `tabular-nums`，每一格字元都對齊）。
   * The boundary swaps a **field** rather than changing the string's shape: 59 → 60 minutes only
   * turns the hours field from `00` to `01` and leaves the length alone, so a whole column of times
   * stays the same width (the rows already carry `tabular-nums`, aligning every character).
   */
  it('carries at the hour boundary without changing the string length', () => {
    expect(formatDuration(3_599_999)).toBe('00:59:59');
    expect(formatDuration(3_600_000)).toBe('01:00:00');
    expect(formatDuration(4_500_000)).toBe('01:15:00');
    expect(formatDuration(8 * 3_600_000 + 30_000)).toBe('08:00:30');
  });

  /* 兩小時是無盡模式的上限，也就是實務上會看到的最長值。 */
  it('covers the endless-mode ceiling of two hours', () => {
    expect(formatDuration(2 * 3_600_000)).toBe('02:00:00');
    expect(formatDuration(2 * 3_600_000 - 1)).toBe('01:59:59');
  });

  /* 小時欄沒有上限：過了 100 小時長出第三位，而不是回繞成兩位數。 */
  it('lets the hours field grow past two digits instead of wrapping', () => {
    expect(formatDuration(100 * 3_600_000)).toBe('100:00:00');
  });

  /* 負值、NaN、Infinity 都當 0：壞值不該讓榜上印出 `NaN:NaN:NaN`。 */
  it('treats negative and non-finite input as zero', () => {
    expect(formatDuration(-5_000)).toBe('00:00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00:00');
  });
});
