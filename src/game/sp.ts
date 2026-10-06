/**
 * 技力（SP）資源。
 * The skill-point (SP) resource.
 *
 * 技力是一局之內的資源（design.md §5.1，使用者 2026-10-06 定案）：
 * SP is a per-run resource (design.md §5.1, the user's 2026-10-06 decision):
 *
 * - **累積**：每投放一次 +`gainPerDrop`（0.05），每次合成 +`gainPerCombo`（0.05）。
 * - **上限**：來自 `skills.json → sp.max`，預設 3，而且是**正整數 1–10**；UI 的技力條
 *   「一點一條」，所以上限同時是段數。可以用 `setMaxOverride()` 臨時改成別的指定值，
 *   技能滿足條件時可以藉此短期加減上限。
 * - **消耗**：由技能自行申報（1／2／3），不是固定值；扣費的時機是「效果成功執行」，
 *   選取中不扣、取消不退。
 * - **累計消耗**：每次扣除都累加，供「命運互換」這類以累計消耗解鎖的免費技能使用。
 * - **Accrual**: `gainPerDrop` (0.05) per drop, `gainPerCombo` (0.05) per merge.
 * - **Cap**: from `skills.json → sp.max`, default 3, a **positive integer 1–10**, because the
 *   meter draws one pill per point. `setMaxOverride()` temporarily substitutes another value
 *   so a skill can raise or lower the ceiling while a condition holds.
 * - **Spending**: each skill declares its own cost (1 / 2 / 3) rather than a fixed 1.0, and is
 *   charged only when its effect actually runs — selecting costs nothing, cancelling refunds
 *   nothing.
 * - **Cumulative spend**: every charge adds up, feeding free skills gated by total spend
 *   (fate swap).
 *
 * 這一類別**不含任何遊戲規則**：它不知道有哪些技能，也不知道玩法。它只是一個有上限、
 * 會累加、可覆寫上限的計數器。
 * The class holds **no game rules**: it does not know which skills exist or what they do. It is
 * only a counter with a cap, an accrual rate and an overridable ceiling.
 */

import { SP_MAX_CEILING, SP_MIN } from '../core/constants';

export interface SpResourceOptions {
  /** 上限（來自 `skills.json → sp.max`；已由載入器鉗制過）。 */
  max: number;
  /** 開局值（來自 `skills.json → sp.initial`）。 */
  initial: number;
  /** 每次投放的累積量。 */
  gainPerDrop: number;
  /** 每次合成的累積量。 */
  gainPerCombo: number;
  /** 滿值後是否允許繼續累積。 */
  overflowAllowed: boolean;
}

export class SpResource {
  private value: number;
  private readonly baseMax: number;
  private readonly initial: number;
  private readonly gainPerDrop: number;
  private readonly gainPerCombo: number;
  private readonly overflowAllowed: boolean;

  /** 臨時覆寫的上限；`null` ＝ 用 `baseMax`。 */
  private overrideMax: number | null = null;

  /** 這一局累計消耗了多少點技力（供累計消耗型技能解鎖）。 */
  private spentTotal = 0;

  constructor(options: SpResourceOptions) {
    this.baseMax = clampToCeiling(options.max);
    this.initial = Math.max(0, options.initial);
    this.gainPerDrop = Math.max(0, options.gainPerDrop);
    this.gainPerCombo = Math.max(0, options.gainPerCombo);
    this.overflowAllowed = options.overflowAllowed;
    this.value = this.clampValue(this.initial);
  }

  /** 目前技力值（可為小數）。 */
  get current(): number {
    return this.value;
  }

  /** 目前生效的上限（考慮臨時覆寫）。 */
  get max(): number {
    return this.overrideMax ?? this.baseMax;
  }

  /** `sp.max` 的基準值（不受臨時覆寫影響）。 */
  get baseCeiling(): number {
    return this.baseMax;
  }

  /** 是否有生效中的臨時上限。 */
  get hasMaxOverride(): boolean {
    return this.overrideMax !== null;
  }

  /** 這一局累計消耗的技力總量。 */
  get cumulativeSpent(): number {
    return this.spentTotal;
  }

  /** 每次投放的技力量。 */
  get dropGain(): number {
    return this.gainPerDrop;
  }

  /** 每次合成的技力量。 */
  get comboGain(): number {
    return this.gainPerCombo;
  }

  /** 填充比例 `0..1`，供技力條與除錯使用。 */
  get ratio(): number {
    if (this.max <= 0) return 0;
    return Math.min(1, this.value / this.max);
  }

  /**
   * 累積技力。未開啟溢出時會夾在上限之內。
   * Accrue SP, clamped to the cap unless overflow is allowed.
   */
  gain(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.value = this.clampValue(this.value + amount);
  }

  /** 每投放一次要加的技力。 */
  gainForDrop(): void {
    this.gain(this.gainPerDrop);
  }

  /** 每合成一次要加的技力。 */
  gainForCombo(): void {
    this.gain(this.gainPerCombo);
  }

  /**
   * 現在付得起嗎。`cost <= 0`（免費）永遠為真。
   * Whether the cost is currently affordable; a free (`cost <= 0`) skill always is.
   */
  canAfford(cost: number): boolean {
    if (!Number.isFinite(cost) || cost <= 0) return true;
    return this.value + 1e-9 >= cost;
  }

  /**
   * 扣費。付不起就**不動任何狀態**並回傳 `false`，呼叫端因此可以「先問再扣」而不必擔心
   * 半扣的狀態。成功時累計消耗一併前進。
   * Charge for a skill. When unaffordable nothing changes and `false` is returned, so a caller
   * can "check then charge" without risking a half-applied state; a successful charge also
   * advances the cumulative-spend total.
   */
  spend(cost: number): boolean {
    if (cost <= 0) return true;
    if (!this.canAfford(cost)) return false;

    this.value = Math.max(0, this.value - cost);
    this.spentTotal += cost;
    return true;
  }

  /**
   * 臨時把上限改成指定值（技能滿足條件時使用）；傳 `null` 還原成 `sp.max`。
   * Temporarily substitute the cap (used by skills whose condition holds); pass `null` to
   * restore `sp.max`.
   *
   * 指定值會被鉗制到 `[0, SP_MAX_CEILING]`：超過硬上限會讓技力條畫出面板之外，低於 0 沒有
   * 意義。上限被調低時，目前值也會跟著夾下來（除非允許溢出），否則畫面會出現「第 4 條滿的
   * 但上限只有 3」這種矛盾。
   * The substitute is clamped to `[0, SP_MAX_CEILING]`: above the hard ceiling the meter would
   * draw outside its panel, and below zero is meaningless. Lowering the cap also clamps the
   * current value (unless overflow is allowed), or the frame would show "a full fourth pill
   * with a cap of three".
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
   * 把累計消耗歸零（免費技能用完後重新上鎖）。
   * Clear the cumulative-spend total (so a free skill locks again after use).
   *
   * 與 `reset()` 不同：這裡**不動**目前值與臨時上限。技能扣完費之後呼叫它，才不會把玩家
   * 剩下的技力一起抹掉。
   * Unlike `reset()` this leaves the current value and any temporary cap alone; a skill calls it
   * after charging, so the player's remaining SP is not wiped along with the counter.
   */
  resetSpent(): void {
    this.spentTotal = 0;
  }

  /** 開新局：值回到 `initial`，累計消耗歸零，臨時上限清除。 */
  reset(): void {
    this.overrideMax = null;
    this.spentTotal = 0;
    this.value = this.clampValue(this.initial);
  }

  /** 依目前上限夾制；允許溢出時只擋負值。 */
  private clampValue(value: number): number {
    const floored = Math.max(0, value);
    if (this.overflowAllowed) return floored;
    return Math.min(floored, this.max);
  }
}

/** 把任意數值夾進 `[SP_MIN, SP_MAX_CEILING]`。 */
function clampToCeiling(value: number): number {
  if (!Number.isFinite(value)) return SP_MIN;
  return Math.min(Math.max(value, SP_MIN), SP_MAX_CEILING);
}

/**
 * 臨時上限的夾制範圍是 `[0, SP_MAX_CEILING]`：技能可以把上限壓到 0（暫時封鎖技能欄），
 * 但不可以超過硬上限。
 * A temporary cap clamps to `[0, SP_MAX_CEILING]`: a skill may squash the ceiling to zero
 * (temporarily locking the bar) but may not exceed the hard ceiling.
 */
function clampOverride(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), SP_MAX_CEILING);
}
