/**
 * 連擊（Combo）追蹤：串長與倍率。
 * Combo tracking: chain length and multiplier.
 */

/**
 * 連擊倍率曲線的參數；`cap + base` 即倍率天花板（×10.00）。
 * Combo-multiplier curve parameters; `cap + base` is the multiplier ceiling (×10.00).
 */
export const COMBO_CURVE = {
  coefficient: 0.075,
  divisor: 1.5,
  cap: 9,
  base: 1,
  decimals: 2,
} as const;

function roundToCurve(value: number): number {
  const factor = 10 ** COMBO_CURVE.decimals;

  return Math.round(value * factor) / factor;
}

/**
 * 由串長算出倍率；`count <= 0` 回傳 `1`。
 * Multiplier for a chain length; returns `1` when `count <= 0`.
 */
export function comboMultiplier(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 1;

  const raw = Math.exp(COMBO_CURVE.coefficient * count) / COMBO_CURVE.divisor - 1 / COMBO_CURVE.divisor;

  return roundToCurve(Math.min(raw, COMBO_CURVE.cap) + COMBO_CURVE.base);
}

/**
 * 某一刻的連擊狀態快照；尚未合成時 `count = 0`、`multiplier = 1`。
 * A snapshot of the combo state; before any merge `count = 0` and `multiplier = 1`.
 */
export interface ComboSnapshot {
  count: number;
  multiplier: number;
}

/**
 * 連擊計數器：只認「這一步有合成」與「上一顆沒合成」兩個事件，因此不需要時鐘。
 * Combo counter: it only knows "a merge happened on this step" and "the previous drop merged
 * nothing", so it needs no clock.
 */
export class ComboTracker {
  private chain = 0;

  get count(): number {
    return this.chain;
  }

  /**
   * 記錄一次合成，回傳記錄後的狀態。
   * Records one merge and returns the resulting state.
   */
  record(): ComboSnapshot {
    this.chain += 1;

    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /**
   * 目前狀態；無副作用，HUD 可以每幀查詢。
   * Current state; side-effect free, so the HUD may poll it every frame.
   */
  snapshot(): ComboSnapshot {
    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /**
   * 歸零；只由「上一顆零合成」驅動，不是時間。
   * Resets the chain; driven only by "the previous drop merged nothing", never by time.
   */
  reset(): void {
    this.chain = 0;
  }
}
