/**
 * 時長格式化。
 * Duration formatting.
 *
 * 這一支的邊界比它看起來多：時長要出現在 HUD 分數旁邊那一小段（空間最緊）與結算卡的一格，
 * 而一局的長度可以從 5 秒（撞線後清理失敗就直接結束）到兩小時（無盡模式的上限），所以
 * **格式換段的界線**（剛滿 60 秒、剛滿 1 小時）與**壞輸入**都要釘住。
 * This has more edges than it looks: the duration appears in the tight note beside the HUD score and
 * in a cell of the game-over card, and a run can last anywhere from 5 seconds (failing to clear the
 * line) to two hours (the endless-mode ceiling), so both **shape transitions** (exactly 60 seconds,
 * exactly one hour) and **bad input** are pinned here.
 */

import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/ui/duration';

describe('formatDuration — 時長格式 / duration format', () => {
  it('uses m:ss below an hour and pads the seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(7_000)).toBe('0:07');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(754_000)).toBe('12:34');
  });

  it('floors to whole seconds, so a partial second never rounds up', () => {
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(1_999)).toBe('0:01');
    expect(formatDuration(59_999)).toBe('0:59');
  });

  /*
   * 分鐘**不進位成 60**：75 分鐘是 `1:15:00` 而不是 `75:00`。少了這一條，兩種格式的界線
   * 會變成靠「分鐘有沒有超過 59」去猜。
   * Minutes **never reach 60**: 75 minutes prints `1:15:00`, not `75:00`. Without this the boundary
   * between the two shapes would come down to guessing from the minute field.
   */
  it('grows an hours field exactly at one hour', () => {
    expect(formatDuration(3_599_999)).toBe('59:59');
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(4_500_000)).toBe('1:15:00');
    expect(formatDuration(8 * 3_600_000 + 30_000)).toBe('8:00:30');
  });

  /* 負值、NaN、Infinity 都當 0：壞值不該讓 HUD 印出 `NaN:NaN`。 */
  it('treats negative and non-finite input as zero', () => {
    expect(formatDuration(-5_000)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
