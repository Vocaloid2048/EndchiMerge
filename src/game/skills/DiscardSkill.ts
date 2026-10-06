/**
 * 「當棄即棄！」：點選容器內其中一顆方團團，將它移除。
 * "Discard It Right Now!": pick one dumpling inside the container and remove it.
 *
 * 選取方式＝**點選 1 顆**（design.md §5.5）。移除之後其餘方團團自然落下補位 —— 那是物理
 * 的事，這裡不做任何「補位」計算，否則會與引擎打架。
 * Targeting is **pick one** (design.md §5.5). The rest then fall in on their own; that is
 * physics' job, and computing a "fill-in" here would only fight the engine.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

export class DiscardSkill extends Skill {
  override apply(board: SkillBoard, targets: readonly BoardTarget[]): void {
    const target = targets[0];

    /*
     * 沒有目標就什麼都不做。呼叫端在扣費前已經確認過有得選，這是第二層保險 —— 技能類別
     * 不該因為少傳一個目標而把整局弄壞。
     * No target means no-op. The caller already ensured a target exists before charging; this
     * is a second layer so a skill can never wreck a run over a missing argument.
     */
    if (target === undefined) return;

    board.removeTarget(target.id);
  }
}
