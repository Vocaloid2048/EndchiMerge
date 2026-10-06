/**
 * 技能抽象基底類別。
 * The abstract base class for a skill.
 *
 * 新增一個技能 ＝ **在這個資料夾新增一個 class 檔 ＋ 在 `skills.json` 加一條**，核心迴圈
 * 不必改（design.md §3.3 的設計原則）。共用行為（讀參數、申報消耗與解鎖條件、需不需要
 * 選取目標）全在這裡，子類別只需要回答兩件事：
 * Adding a skill means **a new class file in this folder plus one entry in `skills.json`** —
 * the core loop never changes (design.md §3.3). Everything shared lives here (reading params,
 * declaring cost and unlock condition, whether a target is needed); a subclass answers only two
 * questions:
 *
 * 1. **要作用多久**（`durationMs`）—— 0 表示瞬發。
 * 2. **要做什麼**（`apply`）。
 * 1. **How long does it act** (`durationMs`) — 0 means instant.
 * 2. **What does it do** (`apply`).
 *
 * 「作用中」是一個**狀態**，不是風格：作用期間 `GameSession` 會禁止投放（使用者定案）。
 * "Acting" is a *state*, not styling: while a skill is acting, `GameSession` blocks dropping
 * (the user's decision).
 */

import type { SkillDef, SkillParams, SkillTargeting, SkillUnlock } from '../../core/types';
import type { BoardTarget, SkillBoard } from './board';

export abstract class Skill {
  /** `skills.json` 的那條定義；子類別只讀不改。 */
  protected readonly def: SkillDef;

  constructor(definition: SkillDef) {
    this.def = definition;
  }

  /** 穩定識別碼（對應 `skills.json → id`）。 */
  get id(): string {
    return this.def.id;
  }

  /** 顯示名稱。 */
  get name(): string {
    return this.def.name;
  }

  /** 消耗技力；0 ＝ 免費（以累計消耗解鎖）。 */
  get cost(): number {
    return this.def.cost;
  }

  /** 選取方式。 */
  get targeting(): SkillTargeting {
    return this.def.targeting;
  }

  /** 解鎖條件。 */
  get unlock(): SkillUnlock {
    return this.def.unlock;
  }

  /** 需要依序點選幾顆；`immediate` 為 0。 */
  get pickCount(): number {
    return this.def.pickCount;
  }

  /** 行為參數。 */
  get params(): SkillParams {
    return this.def.params;
  }

  /** 這個技能是否需要玩家點選目標。 */
  get requiresTargets(): boolean {
    return this.def.targeting === 'user_pick' && this.def.pickCount > 0;
  }

  /**
   * 「作用中」的時長，毫秒。預設 0（瞬發）。
   * How long the effect stays active, in ms. Defaults to 0 (instant).
   */
  get durationMs(): number {
    return 0;
  }

  /**
   * 執行效果。`targets` 是已經選好的目標（`immediate` 技能為空陣列），順序與玩家點選的
   * 順序一致 —— 需要兩個目標的技能因此不必自己記狀態。
   * Run the effect. `targets` holds the already-picked targets in the order the player picked
   * them (empty for `immediate` skills), so a two-target skill needs no state of its own.
   */
  abstract apply(board: SkillBoard, targets: readonly BoardTarget[]): void;
}
