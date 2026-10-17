/**
 * 「一步登天」：點選一顆方團團，直接升到下一級（點選 1 顆，僅限下一級已解鎖）。
 * "One Step Up": pick one dumpling and promote it a level (pick-one, only when the next level is unlocked).
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

export class AscendSkill extends Skill {
  /**
   * 只收「還有下一級，而且那一級已在圖鑑解鎖」的目標。
   * Only accepts targets that have a next level and that level is already unlocked.
   *
   * 這一層是**收下點擊之前**的過濾：玩家點到不能升的顆粒時什麼都不會發生，選取模式保持，
   * 也就不會出現「扣了技力但沒有效果」。
   * This is the filter **before the tap is accepted**: tapping an ineligible dumpling does
   * nothing and selection stays open, so SP is never spent on a no-op.
   */
  override canPick(target: BoardTarget): boolean {
    return target.nextLevelId !== null && target.nextLevelUnlocked;
  }

  override apply(board: SkillBoard, targets: readonly BoardTarget[]): void {
    const target = targets[0];

    /* 沒有目標就什麼都不做：第二層保險，呼叫端已用 `canPick()` 擋過。 */
    if (target === undefined) return;

    board.upgradeTarget(target.id);
  }
}
