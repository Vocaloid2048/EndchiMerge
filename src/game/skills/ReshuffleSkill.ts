/**
 * 「天翻地覆」：清空整個容器，再降下指定數量的方團團（即時生效）。
 * "Clean Slate": wipe the container and rain down a given number of dumplings (immediate).
 *
 * 降下的顆粒允許正常碰撞與合成 —— 沒有額外的「不許合成」限制。
 * The fallen dumplings collide and merge like any other; no extra "no merging" restriction applies.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時降下的顆數。 / The default number of dumplings to rain down. */
const DEFAULT_COUNT = 30;

export class ReshuffleSkill extends Skill {
  /**
   * 空盤也可以發動：它本來就會先清空，再自己補滿。
   * It may fire on an empty board: it clears first and refills by itself.
   */
  override get allowsEmptyBoard(): boolean {
    return true;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const requested = this.params.count ?? DEFAULT_COUNT;

    /* 顆數必須是正整數：小數會讓「降幾顆」變成浮點累加。 */
    const count = Math.max(1, Math.floor(requested));

    board.reshuffle(count);
  }
}
