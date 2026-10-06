/**
 * 「搖晃！」：震動整個容器，把卡住的方團團抖散。
 * "Shake!": rattle the whole container to loosen jammed dumplings.
 *
 * 選取方式＝**即時生效**（design.md §5.5）。
 * Targeting is **immediate** (design.md §5.5).
 *
 * 使用者 2026-10-06 定案：**改成地震**（不再是順時針圓周晃動）—— 容器沿一條與水平成
 * 15° 的軸往復，另加一個持續向上的托力（水平衝量峰值的 10%），讓堆疊被抬起、更容易鬆開。
 * 這裡只負責把參數夾到合法範圍（圈數為正、傾角不超過 60°、向上力不超過半個水平衝量、
 * 幅度不超過硬上限），實際的晃動與顆粒受力由 `GameSession` 執行。
 * The user's 2026-10-06 decision: **make it an earthquake** rather than a clockwise orbit — the
 * container oscillates along an axis 15° above the horizontal, with an extra steady upward force
 * (10% of the peak horizontal impulse) so the pile lifts and loosens. This class only keeps the
 * parameters legal (positive cycles, tilt at most 60°, upward force at most half the horizontal
 * impulse, amplitude at or below the hard cap); `GameSession` performs the shake and applies the
 * forces to the bodies.
 */

import { SHAKE_RADIUS_FACTOR_MAX } from '../../core/constants';
import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時的預設：2 秒、5 圈、幅度 0.12 × 容器寬、擺動軸斜 15°、向上力 0.1。 */
const DEFAULT_DURATION_MS = 2000;
const DEFAULT_REVOLUTIONS = 5;
/*
 * 幅度預設刻意遠低於硬上限（1/3）：1/3 × 容器寬配上 2 秒 5 圈，牆壁的線速度會把整箱方團團
 * 甩飛。使用者給的 1/3 是**上限**，不是預設值，所以這裡取一個可玩的起始值，待試玩調整。
 * The default amplitude sits well below the hard cap (1/3): 1/3 of the width at 5 cycles per 2 s
 * gives the walls enough linear speed to fling the whole box. The user's 1/3 is a **cap**, not a
 * default, so this starts from a playable value to be tuned by feel.
 */
const DEFAULT_RADIUS_FACTOR = 0.12;
/** 使用者定案：擺動軸相對水平線斜 15°。 */
const DEFAULT_AXIS_TILT_DEG = 15;
/** 使用者定案：持續向上的托力 ＝ 水平衝量峰值的 10%。 */
const DEFAULT_UPWARD_FACTOR = 0.1;
/** 傾角的硬上限。超過它擺動就變成「上下猛震」，與技能語意不符。 */
const MAX_AXIS_TILT_DEG = 60;
/** 向上力的硬上限。再多就會蓋過重力，整個箱子變成失重。 */
const MAX_UPWARD_FACTOR = 0.5;

export class ShakeSkill extends Skill {
  /** 搖晃的作用時間；未設定時用預設值。 */
  override get durationMs(): number {
    return this.params.durationMs ?? DEFAULT_DURATION_MS;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const revolutions = Math.max(1, this.params.revolutions ?? DEFAULT_REVOLUTIONS);
    const requested = this.params.radiusFactor ?? DEFAULT_RADIUS_FACTOR;

    /*
     * 幅度比例一律夾在 `[0, 1/3]`。寫進 JSON 的大數字不會把容器晃出畫面 —— 這條上限是
     * 使用者定案的，所以它屬於程式而不是配置。
     * The amplitude ratio is always clamped to `[0, 1/3]`; an oversized JSON value cannot shake the
     * container off-screen. The cap is the user's decision, so it is code, not config.
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
