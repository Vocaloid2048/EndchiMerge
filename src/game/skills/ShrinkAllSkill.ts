/**
 * 「縮地成寸」：把場上所有方團團縮到指定半徑（即時生效，只縮不放）。
 * "Fold Space": shrink every dumpling on the board to a given radius (immediate, shrink-only).
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/**
 * 未提供參數時的目標半徑（＝ Lv4「湯湯」的半徑），虛擬單位。
 * The default target radius (level 4's), in virtual units.
 */
const DEFAULT_RADIUS = 37.5;

export class ShrinkAllSkill extends Skill {
  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const requested = this.params.radius ?? DEFAULT_RADIUS;

    /* 半徑必須為正；寫成 0 或負數會產生零質量剛體，比不做事更糟。 */
    const radius = Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_RADIUS;

    board.shrinkAll(radius);
  }
}
