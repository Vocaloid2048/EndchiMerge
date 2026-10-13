/**
 * 「當棄即棄！」：點選一顆方團團並移除（點選 1 顆）。
 * "Discard It Right Now!": pick one dumpling and remove it (pick-one targeting).
 *
 * 其餘方團團自然塌落由物理負責；「塌落前提是堆疊醒著」由 `GameSession.removeTarget()` 處理。
 * The rest fall in on their own — physics' job; the "stack must be awake" precondition is `GameSession.removeTarget()`'s.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

export class DiscardSkill extends Skill {
  override apply(board: SkillBoard, targets: readonly BoardTarget[]): void {
    const target = targets[0];

    /*
     * 沒有目標就什麼都不做：呼叫端扣費前已確認過，這是第二層保險。
     * No target means no-op: the caller already checked before charging; this is a second layer.
     */
    if (target === undefined) return;

    board.removeTarget(target.id);
  }
}
