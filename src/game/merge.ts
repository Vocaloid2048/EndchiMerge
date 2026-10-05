/**
 * 合成規則。
 * The merge rule.
 *
 * 規則只有一條：**兩顆方團團的等級相同**時，合成為該等級 `mergeResult` 所指的下一級；
 * 最高級的 `mergeResult` 是 `null`，代表不再合成。
 * There is exactly one rule: two dumplings **of the same level** merge into the level named
 * by that level's `mergeResult`. The top level's `mergeResult` is `null`, meaning no merge.
 *
 * 刻意獨立成一支純函式而不是寫進 `GameSession`：合成是整個遊戲的計分來源，它值得有一份
 * 不需要引擎、不需要畫布就能斷言的定義。`GameSession` 只負責「什麼時候問它」。
 * It is a standalone pure function rather than a method on `GameSession` because merging is
 * where all the score comes from, and it deserves a definition that can be asserted without
 * an engine or a canvas. The session only decides *when* to ask.
 */

import type { LevelDef } from '../core/types';

/**
 * 兩顆方團團合成後的等級編號；不能合成時回傳 `null`。
 * The level id two dumplings merge into, or `null` when they cannot merge.
 *
 * 不能合成的情形有三種，全部收斂成同一個回傳值：等級不同、其中一顆是終端等級、
 * 或作者沒有給出下一級。
 * Three cases collapse into the same answer: different levels, a terminal level, or an
 * author who left the next level unset.
 */
export function mergeResultId(a: LevelDef, b: LevelDef): number | null {
  if (a.id !== b.id) return null;

  return a.mergeResult;
}
