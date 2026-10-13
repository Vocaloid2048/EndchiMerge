/**
 * 合成規則。
 * The merge rule.
 */

import type { LevelDef } from '../core/types';

/**
 * 兩顆方團團合成後的等級編號；不能合成時回傳 `null`。
 * The level id two dumplings merge into, or `null` when they cannot merge.
 */
export function mergeResultId(a: LevelDef, b: LevelDef): number | null {
  if (a.id !== b.id) return null;

  return a.mergeResult;
}
