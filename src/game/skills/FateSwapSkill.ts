/**
 * 「命運互換」：依序點選兩顆方團團，互換位置並擾動周邊（點選 2 顆）。
 * "Fate Swap": pick two dumplings in order, swap their positions and disturb the neighbours (pick-two targeting).
 *
 * 特殊技能，以「累計消耗滿 6 點技力」解鎖；扣費與解鎖都在 `GameSession`／`SpResource`，這裡只做交換。
 * A free skill unlocked by 6 cumulative SP spent; charging and unlocking live in `GameSession`/`SpResource` — this class only swaps.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/**
 * 未提供參數時，交換瞬間對鄰居的擾動衝量（世界單位／步）。
 * The disturbance impulse applied to neighbours on swap when params are absent (world units per step).
 */
const DEFAULT_DISTURBANCE = 6;

export class FateSwapSkill extends Skill {
  override apply(board: SkillBoard, targets: readonly BoardTarget[]): void {
    const first = targets[0];
    const second = targets[1];

    /* 要有兩顆不同的目標才成立；少一個或同一顆就什麼都不做。 */
    if (first === undefined || second === undefined || first.id === second.id) return;

    board.swapTargets(first.id, second.id, this.params.disturbance ?? DEFAULT_DISTURBANCE);
  }
}
