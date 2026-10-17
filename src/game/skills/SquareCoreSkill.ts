/**
 * 「以方代圓」：本局改用核心正方形判定合成邊緣，取代 sprite 輪廓（即時生效）。
 * "Square Rule": this run judges merge edges by the core square instead of the sprite outline (immediate).
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

export class SquareCoreSkill extends Skill {
  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    board.useSquareMerge();
  }
}
