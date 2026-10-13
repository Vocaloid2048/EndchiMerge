/**
 * 「協議：浮動」：讓所有方團團向上浮起一段時間（即時生效）。
 * "Protocol: Float": lifts every dumpling for a while (immediate targeting).
 *
 * 天花板是警戒區下方的一片隱形平面，由 `GameSession` 建立與移除；這裡只把參數傳下去。
 * The ceiling is an invisible plane below the overflow line, built and removed by `GameSession`; this class only passes the parameters along.
 */

import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/**
 * 未提供參數時的預設：1.5 秒、向上加速度 1.6 倍重力、追趕力 2 倍重力。
 * Defaults when params are absent: 1.5 s, 1.6 gravities of lift, 2 gravities of catch-up.
 */
const DEFAULT_DURATION_MS = 1500;
const DEFAULT_LIFT_FACTOR = 1.6;
const DEFAULT_CATCHUP_FACTOR = 2;

export class FloatSkill extends Skill {
  /**
   * 浮動的作用時間；未設定時用預設值。
   * The float duration; falls back to the default when unset.
   */
  override get durationMs(): number {
    return this.params.durationMs ?? DEFAULT_DURATION_MS;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    board.floatAll({
      durationMs: this.durationMs,
      liftFactor: this.params.liftFactor ?? DEFAULT_LIFT_FACTOR,
      /*
       * 追趕力：翻轉重力只能「推」整堆向上，輪廓多邊形偶爾會有一顆卡在角落不動；
       * 對仍落在天花板帶下方的顆粒每步再加一把向上的力，保證整堆都升上去。
       * Catch-up force: flipping gravity only pushes the pile and the odd body wedges in a
       * corner; an extra upward force per step for bodies below the ceiling band brings the whole pile up.
       */
      catchupFactor: this.params.catchupFactor ?? DEFAULT_CATCHUP_FACTOR,
    });
  }
}
