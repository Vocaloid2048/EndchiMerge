/**
 * 技能抽象基底類別：新增技能＝這個資料夾新增一個 class 檔＋`skills.json` 加一條，核心迴圈不變。
 * The abstract base class for a skill: adding one means a new class file here plus an entry in `skills.json` — the core loop never changes.
 */

import type { SkillDef, SkillParams, SkillTargeting, SkillUnlock } from '../../core/types';
import type { BoardTarget, SkillBoard } from './board';

export abstract class Skill {
  /**
   * `skills.json` 的那條定義；子類別只讀不改。
   * The definition entry from `skills.json`; subclasses read it, never write it.
   */
  protected readonly def: SkillDef;

  constructor(definition: SkillDef) {
    this.def = definition;
  }

  get id(): string {
    return this.def.id;
  }

  get name(): string {
    return this.def.name;
  }

  /**
   * 消耗技力；0 ＝ 免費（以累計消耗解鎖）。
   * The SP cost; 0 means free (unlocked by cumulative spending).
   */
  get cost(): number {
    return this.def.cost;
  }

  get targeting(): SkillTargeting {
    return this.def.targeting;
  }

  get unlock(): SkillUnlock {
    return this.def.unlock;
  }

  /**
   * 需要依序點選幾顆；`immediate` 為 0。
   * How many targets to pick in order; 0 for `immediate` skills.
   */
  get pickCount(): number {
    return this.def.pickCount;
  }

  get params(): SkillParams {
    return this.def.params;
  }

  /**
   * 這個技能是否需要玩家點選目標。
   * Whether the skill needs the player to pick targets.
   */
  get requiresTargets(): boolean {
    return this.def.targeting === 'user_pick' && this.def.pickCount > 0;
  }

  /**
   * 「作用中」的時長，毫秒；預設 0（瞬發）。作用期間 `GameSession` 會禁止投放。
   * How long the effect stays active, in ms; defaults to 0 (instant). While acting, `GameSession` blocks dropping.
   */
  get durationMs(): number {
    return 0;
  }

  /**
   * 這個目標能不能被點選。預設全部可選；收窄條件（例如「下一級必須已解鎖」）由子類別覆寫。
   * Whether a target may be picked. Everything is pickable by default; subclasses narrow it.
   *
   * 呼叫端在**收下點擊之前**問這個問題，所以不合格的目標不會進入選取名單，也不會扣費。
   * The caller asks this **before accepting a tap**, so an ineligible target never enters the
   * selection and nothing is charged.
   */
  canPick(_target: BoardTarget): boolean {
    return true;
  }

  /**
   * 空盤時能不能發動。預設不行 —— 浮動、搖晃、捨棄、互換都需要場上有東西；只有「先清空再
   * 補滿」的技能（天翻地覆）例外。
   * Whether this skill may fire on an empty board. Not by default: float, shake, discard and
   * swap all need bodies; only a skill that clears and refills the board is exempt.
   */
  get allowsEmptyBoard(): boolean {
    return false;
  }

  /**
   * 執行效果；`targets` 依玩家點選順序排列（`immediate` 為空陣列）。
   * Runs the effect; `targets` is in pick order (empty for `immediate` skills).
   */
  abstract apply(board: SkillBoard, targets: readonly BoardTarget[]): void;
}
