/**
 * 「搖晃！」：容器沿斜軸往復擺動（地震），把卡住的方團團抖散（即時生效）。
 * "Shake!": the container oscillates along a tilted axis (an earthquake) to loosen jammed dumplings (immediate targeting).
 *
 * 這裡只把參數夾到合法範圍；實際的晃動與顆粒受力由 `GameSession` 執行。
 * This class only clamps the parameters into legal ranges; `GameSession` performs the shake and applies the forces.
 */

import { SHAKE_RADIUS_FACTOR_MAX } from '../../core/constants';
import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/**
 * 未提供參數時的預設：2 秒、5 圈、幅度 0.12 × 容器寬、擺動軸斜 15°、向上力 0.1。
 * Defaults when params are absent: 2 s, 5 revolutions, 0.12 × width, 15° tilt, 0.1 upward force.
 */
const DEFAULT_DURATION_MS = 2000;
const DEFAULT_REVOLUTIONS = 5;
/*
 * 幅度預設刻意遠低於硬上限（1/3）：1/3 × 容器寬配上 2 秒 5 圈會把整箱甩飛；1/3 是上限不是預設。
 * The default amplitude sits well below the hard cap (1/3): a third of the width at 5 cycles per 2 s flings the box — the cap is not a default.
 */
const DEFAULT_RADIUS_FACTOR = 0.12;
const DEFAULT_AXIS_TILT_DEG = 15;
const DEFAULT_UPWARD_FACTOR = 0.1;

/**
 * 傾角的硬上限；超過它擺動就變成「上下猛震」，與技能語意不符。
 * The tilt hard cap; beyond it the swing becomes a vertical battering, which is not this skill's intent.
 */
const MAX_AXIS_TILT_DEG = 60;

/**
 * 向上力的硬上限；再多就會蓋過重力，整個箱子變成失重。
 * The upward-force hard cap; beyond it gravity is overwhelmed and the box goes weightless.
 */
const MAX_UPWARD_FACTOR = 0.5;

export class ShakeSkill extends Skill {
  /**
   * 搖晃的作用時間；未設定時用預設值。
   * The shake duration; falls back to the default when unset.
   */
  override get durationMs(): number {
    return this.params.durationMs ?? DEFAULT_DURATION_MS;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const revolutions = Math.max(1, this.params.revolutions ?? DEFAULT_REVOLUTIONS);
    const requested = this.params.radiusFactor ?? DEFAULT_RADIUS_FACTOR;

    /*
     * 幅度比例一律夾在 `[0, 1/3]`：寫進 JSON 的大數字不能把容器晃出畫面（硬規則屬於程式）。
     * The amplitude ratio is always clamped to `[0, 1/3]`: an oversized JSON value cannot shake the container off-screen (a hard rule belongs in code).
     */
    const radiusFactor = Math.min(Math.max(requested, 0), SHAKE_RADIUS_FACTOR_MAX);

    const axisTiltDeg = clamp(
      this.params.axisTiltDeg ?? DEFAULT_AXIS_TILT_DEG,
      0,
      MAX_AXIS_TILT_DEG,
    );
    const upwardFactor = clamp(
      this.params.upwardFactor ?? DEFAULT_UPWARD_FACTOR,
      0,
      MAX_UPWARD_FACTOR,
    );

    board.shakeContainer({
      durationMs: this.durationMs,
      revolutions,
      radiusFactor,
      axisTiltDeg,
      upwardFactor,
    });
  }
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  return Math.min(Math.max(value, low), high);
}
