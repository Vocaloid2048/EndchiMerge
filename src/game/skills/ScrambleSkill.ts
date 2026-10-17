/**
 * 「乾坤挪移」：把場上所有方團團的位置隨機重排（即時生效）。
 * "Shifting Ground": randomly permute the positions of every dumpling on the board (immediate).
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

export class ScrambleSkill extends Skill {
  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    board.scrambleTargets();
  }
}
