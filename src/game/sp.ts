/**
 * 技力（SP）資源：一局之內有上限、會累加、上限可臨時覆寫的計數器，本身不含任何遊戲規則。
 * The skill-point (SP) resource: a per-run counter with a cap that skills may temporarily override.
 */

import { SP_MAX_CEILING, SP_MIN } from '../core/constants';

export interface SpResourceOptions {
  /** 上限（來自 `skills.json → sp.max`；已由載入器鉗制過）。
   * Cap (from `skills.json → sp.max`, already clamped by the loader). */
  max: number;
  initial: number;
  gainPerDrop: number;
  gainPerCombo: number;
  overflowAllowed: boolean;
}

export class SpResource {
  private value: number;
  private readonly baseMax: number;
  private readonly initial: number;
  private readonly gainPerDrop: number;
  private readonly gainPerCombo: number;
  private readonly overflowAllowed: boolean;

  /**
   * 臨時覆寫的上限；`null` ＝ 用 `baseMax`。
   * A temporary cap override; `null` means use `baseMax`.
   */
  private overrideMax: number | null = null;

  /**
   * 這一局累計消耗的技力（供累計消耗型技能解鎖）。
   * SP spent this run, used to unlock cumulative-spend skills.
   */
  private spentTotal = 0;

  constructor(options: SpResourceOptions) {
    this.baseMax = clampToCeiling(options.max);
    this.initial = Math.max(0, options.initial);
    this.gainPerDrop = Math.max(0, options.gainPerDrop);
    this.gainPerCombo = Math.max(0, options.gainPerCombo);
    this.overflowAllowed = options.overflowAllowed;
    this.value = this.clampValue(this.initial);
  }

  get current(): number {
    return this.value;
  }

  get max(): number {
    return this.overrideMax ?? this.baseMax;
  }

  get baseCeiling(): number {
    return this.baseMax;
  }

  get hasMaxOverride(): boolean {
    return this.overrideMax !== null;
  }

  get cumulativeSpent(): number {
    return this.spentTotal;
  }

  get dropGain(): number {
    return this.gainPerDrop;
  }

  get comboGain(): number {
    return this.gainPerCombo;
  }

  get ratio(): number {
    if (this.max <= 0) return 0;
    return Math.min(1, this.value / this.max);
  }

  /**
   * 累積技力；未開啟溢出時會夾在上限之內。
   * Accrue SP, clamped to the cap unless overflow is allowed.
   */
  gain(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.value = this.clampValue(this.value + amount);
  }

  gainForDrop(): void {
    this.gain(this.gainPerDrop);
  }

  gainForCombo(): void {
    this.gain(this.gainPerCombo);
  }

  /**
   * 現在付得起嗎；`cost <= 0`（免費）永遠為真。
   * Whether the cost is affordable; a free (`cost <= 0`) skill always is.
   */
  canAfford(cost: number): boolean {
    if (!Number.isFinite(cost) || cost <= 0) return true;
    return this.value + 1e-9 >= cost;
  }

  /**
   * 扣費；付不起就**不動任何狀態**並回傳 `false`，呼叫端因此可以「先問再扣」。
   * Charge a skill; when unaffordable nothing changes and `false` is returned.
   */
  spend(cost: number): boolean {
    if (cost <= 0) return true;
    if (!this.canAfford(cost)) return false;

    this.value = Math.max(0, this.value - cost);
    this.spentTotal += cost;
    return true;
  }

  /**
   * 臨時把上限改成指定值，傳 `null` 還原成 `sp.max`。
   * Temporarily substitute the cap; pass `null` to restore `sp.max`.
   *
   * 指定值夾在 `[0, SP_MAX_CEILING]`；上限被調低時目前值也跟著夾下來（除非允許溢出）。
   * The substitute is clamped to `[0, SP_MAX_CEILING]`; lowering the cap also clamps the value.
   */
  setMaxOverride(value: number | null): void {
    if (value === null || !Number.isFinite(value)) {
      this.overrideMax = null;
      this.value = this.clampValue(this.value);
      return;
    }

    this.overrideMax = clampOverride(value);
    this.value = this.clampValue(this.value);
  }

  /**
   * 把累計消耗歸零（免費技能用完後重新上鎖）；**不動**目前值與臨時上限。
   * Clear the cumulative-spend total; leaves the current value and any temporary cap alone.
   */
  resetSpent(): void {
    this.spentTotal = 0;
  }

  /** 開新局：值回到 `initial`，累計消耗歸零，臨時上限清除。
   * Start a new run: value back to `initial`, cumulative spend cleared, override removed. */
  reset(): void {
    this.overrideMax = null;
    this.spentTotal = 0;
    this.value = this.clampValue(this.initial);
  }

  /**
   * 依目前上限夾制；允許溢出時只擋負值。
   * Clamp to the current cap; when overflow is allowed only negatives are floored.
   */
  private clampValue(value: number): number {
    const floored = Math.max(0, value);
    if (this.overflowAllowed) return floored;
    return Math.min(floored, this.max);
  }
}

/**
 * 把任意數值夾進 `[SP_MIN, SP_MAX_CEILING]`。
 * Clamp any value into `[SP_MIN, SP_MAX_CEILING]`.
 */
function clampToCeiling(value: number): number {
  if (!Number.isFinite(value)) return SP_MIN;
  return Math.min(Math.max(value, SP_MIN), SP_MAX_CEILING);
}

/**
 * 臨時上限夾在 `[0, SP_MAX_CEILING]`：可壓到 0（暫時封鎖技能欄）但不可超過硬上限。
 * A temporary cap clamps to `[0, SP_MAX_CEILING]`: it may squash the ceiling to zero, not exceed it.
 */
function clampOverride(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), SP_MAX_CEILING);
}
