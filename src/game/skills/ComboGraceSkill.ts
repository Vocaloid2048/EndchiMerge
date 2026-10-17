/**
 * 「連勢不墜」：接下來幾次投放即使沒有合成，也不會打斷連擊（即時生效）。
 * "Chain Ward": the next few drops keep the combo chain alive even without a merge (immediate).
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時保護的投放次數。 / The default number of drops to protect. */
const DEFAULT_DROPS = 3;

export class ComboGraceSkill extends Skill {
  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const requested = this.params.drops ?? DEFAULT_DROPS;

    /* 次數必須是正整數；0 次等於沒有效果，所以下限取 1。 */
    const drops = Math.max(1, Math.floor(requested));

    board.protectCombo(drops);
  }
}
