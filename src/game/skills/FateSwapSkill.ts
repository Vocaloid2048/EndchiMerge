/**
 * 「命運互換」：依序點選兩顆方團團，互換位置，並牽動周邊的物理狀態。
 * "Fate Swap": pick two dumplings in order, swap their positions, and disturb the neighbours.
 *
 * 選取方式＝**依序點選 2 顆**（design.md §5.5）。
 * Targeting is **pick two, in order** (design.md §5.5).
 *
 * **這個技能是免費的**（使用者 2026-10-06 定案）：解鎖條件不是「當前技力值 ≥ 消耗」，而是
 * 「累計消耗滿 6 點技力」，用掉之後累計歸零、重新上鎖。所以它的 `cost` 是 0，而且
 * `unlock.kind` 是 `cumulativeSpent` —— 扣費與解鎖的判斷都在 `GameSession`／`SpResource`，
 * 這裡只負責「把兩顆換過去」。
 * **This skill is free** (the user's 2026-10-06 decision): its unlock condition is not "current
 * SP ≥ cost" but "6 SP points spent in total", resetting to locked once used. Its `cost` is
 * therefore 0 and its `unlock.kind` is `cumulativeSpent` — charging and unlocking live in
 * `GameSession` / `SpResource`, and this class only performs the swap.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時，交換瞬間對鄰居的擾動衝量（世界單位／步）。 */
const DEFAULT_DISTURBANCE = 6;

export class FateSwapSkill extends Skill {
  override apply(board: SkillBoard, targets: readonly BoardTarget[]): void {
    const first = targets[0];
    const second = targets[1];

    /* 要有**兩顆不同**的目標才成立；少一個就什麼都不做。 */
    if (first === undefined || second === undefined || first.id === second.id) return;

    board.swapTargets(first.id, second.id, this.params.disturbance ?? DEFAULT_DISTURBANCE);
  }
}
