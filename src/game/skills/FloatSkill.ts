/**
 * 「協議：浮動」：讓**所有**方團團向上浮起一段時間。
 * "Protocol: Float": lift **every** dumpling for a while.
 *
 * 選取方式＝**即時生效**（design.md §5.5）。浮起期間同級接觸即合成，所以這是一個「製造合成
 * 機會」的技能。
 * Targeting is **immediate** (design.md §5.5). Same-level contacts still merge while they
 * float, so this is a "create merge chances" skill.
 *
 * **以「警戒區下方的一片隱形平面」為天花板**（使用者 2026-10-06 定案）：像杯口被壓住一樣，
 * 不能讓任何一顆升到溢位線。平面由 `GameSession` 建立與移除（它才知道容器幾何與溢位線在
 * 哪），這裡只把參數傳下去。
 * **The ceiling is an invisible plane below the warning zone** (the user's 2026-10-06 decision):
 * like a lid pressed on a cup, nothing may rise into the overflow line. `GameSession` builds and
 * removes the plane — it is the only thing that knows the container geometry and where the line
 * is — while this class just passes the parameters along.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時的預設：1.5 秒、向上加速度 1.6 倍重力。 */
const DEFAULT_DURATION_MS = 1500;
const DEFAULT_LIFT_FACTOR = 1.6;

export class FloatSkill extends Skill {
  /** 浮動的作用時間；未設定時用預設值。 */
  override get durationMs(): number {
    return this.params.durationMs ?? DEFAULT_DURATION_MS;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    board.floatAll({
      durationMs: this.durationMs,
      liftFactor: this.params.liftFactor ?? DEFAULT_LIFT_FACTOR,
    });
  }
}
