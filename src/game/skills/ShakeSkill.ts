/**
 * 「搖晃！」：震動整個容器，把卡住的方團團抖散。
 * "Shake!": rattle the whole container to loosen jammed dumplings.
 *
 * 選取方式＝**即時生效**（design.md §5.5）。
 * Targeting is **immediate** (design.md §5.5).
 *
 * 使用者 2026-10-06 定案：**畫面整體位移，物理也要按照畫面幅度動** —— 容器沿圓周晃動，
 * 幅度大約「2 秒 5 圈，位移不超過容器寬度的 1/3」。這裡負責把這三個參數夾到合法的範圍
 * （圈數為正、半徑比例不超過硬上限），實際的晃動由 `GameSession` 執行。
 * The user's 2026-10-06 decision: **the picture translates as a whole and physics must follow
 * the same amplitude** — the container orbits, roughly "5 revolutions in 2 s, displacement no
 * more than 1/3 of the container width". This class only keeps the three parameters legal
 * (positive revolutions, radius at or below the hard cap); `GameSession` performs the shake.
 */

import { SHAKE_RADIUS_FACTOR_MAX } from '../../core/constants';
import type { BoardTarget, SkillBoard } from './board';
import { Skill } from './Skill';

/** 未提供參數時的預設：2 秒、5 圈、半徑 0.12 × 容器寬。 */
const DEFAULT_DURATION_MS = 2000;
const DEFAULT_REVOLUTIONS = 5;
/*
 * 半徑預設刻意遠低於硬上限（1/3）：1/3 × 容器寬配上 2 秒 5 圈，牆壁的線速度會把整箱方團團
 * 甩飛。使用者給的 1/3 是**上限**，不是預設值，所以這裡取一個可玩的起始值，待試玩調整。
 * The default radius sits well below the hard cap (1/3): 1/3 of the width at 5 revolutions per
 * 2 s gives the walls enough linear speed to fling the whole box. The user's 1/3 is a **cap**,
 * not a default, so this starts from a playable value to be tuned by feel.
 */
const DEFAULT_RADIUS_FACTOR = 0.12;

export class ShakeSkill extends Skill {
  /** 搖晃的作用時間；未設定時用預設值。 */
  override get durationMs(): number {
    return this.params.durationMs ?? DEFAULT_DURATION_MS;
  }

  override apply(board: SkillBoard, _targets: readonly BoardTarget[]): void {
    const revolutions = Math.max(1, this.params.revolutions ?? DEFAULT_REVOLUTIONS);
    const requested = this.params.radiusFactor ?? DEFAULT_RADIUS_FACTOR;

    /*
     * 半徑比例一律夾在 `[0, 1/3]`。寫進 JSON 的大數字不會把容器晃出畫面 —— 這條上限是
     * 使用者定案的，所以它屬於程式而不是配置。
     * The radius ratio is always clamped to `[0, 1/3]`; an oversized JSON value cannot shake the
     * container off-screen. The cap is the user's decision, so it is code, not config.
     */
    const radiusFactor = Math.min(Math.max(requested, 0), SHAKE_RADIUS_FACTOR_MAX);

    board.shakeContainer({
      durationMs: this.durationMs,
      revolutions,
      radiusFactor,
    });
  }
}
