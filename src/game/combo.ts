/**
 * 連擊（Combo）追蹤。
 * Combo tracking.
 *
 * **計數語意（使用者定案）**：一串連擊 ＝ **連續成功的投放**。窗口不是時間，而是「這次
 * 投放有沒有合成」—— 在下一次投放前，**若果上一顆什麼都沒合成，才重新由 0 開始**。
 * 一旦某顆有合成過，串長就跨投放累積下去；倍率按「累積到第幾次」計算。
 * **Counting semantics** (the user's decision): one chain is a **run of successful drops**.
 * The window is not a duration but "did this drop merge anything" — before the next drop, the
 * counter returns to 0 **only if the previous drop merged nothing**. Once a drop merges
 * something the chain carries across drops, and the multiplier follows the accumulated count.
 *
 * 這是「連勝」而不是「單次投放」：`drop()` 會先問「上一顆有沒有合成」，有的話保留串長。
 * That is a streak, not a per-drop counter: `drop()` first asks "did the previous drop merge
 * anything?" and keeps the chain when it did.
 *
 * 為什麼**不是**時間窗口：舊版用 `comboWindowMs`（1 秒），但投放本身已經有冷卻間隔，
 * 兩個時間概念會互相打架。改成「有沒有合成」這個事件判準之後，時間完全退出這條規則，
 * 連擊只由物理結果決定。
 * Why **not** a time window: the older version used `comboWindowMs`, but drops are already
 * spaced by a cooldown so the two notions fought each other. Keying on "did it merge" removes
 * time from the rule entirely — physics alone decides the chain.
 *
 * 這個模組不碰物理、不碰分數，所以「第幾次合成拿幾倍」可以在單元測試裡逐條釘住。
 * This module touches neither physics nor score, so "which merge gets which multiplier" can be
 * pinned down test by test.
 */

/**
 * Combo 倍率曲線。
 * The combo-multiplier curve.
 *
 * 使用者指定（第三次定案）：`y = min(e^(0.075x) / 1.5 − 1/1.5, 9) + 1`，`x` 是當下的串長，
 * 結果四捨五入到**小數兩位**。示例即驗收：`x = 25` → `×4.68`、`x = 10` → `×1.74`。
 * 舊版 `min(e^(0.25x)/10, 9) + 1` 上升太急（`x = 12` 就 ×3），新係數 `0.075` 把成長放緩：
 * `×1.30` 在 `x = 5`（`e^0.375/1.5 − 2/3 + 1 ≈ 1.3033`），×10 天花板從 `x = 36` 起生效
 * （`e^(0.075·36)/1.5 − 1/1.5 = 9.253 ≥ 9`）。
 * The user's formula (third decision): `y = min(e^(0.075x) / 1.5 − 1/1.5, 9) + 1` with `x` the
 * current chain length, rounded to **two decimals**. The user's examples double as acceptance:
 * `x = 25` → `×4.68`, `x = 10` → `×1.74`. The old `min(e^(0.25x)/10, 9) + 1` climbed far too
 * fast (×3 by `x = 12`); the new coefficient `0.075` slows the climb: `×1.30` lands at `x = 5`,
 * and the ×10 ceiling takes effect from `x = 36`.
 *
 * 註：更早的使用者訊息曾寫 `max(...)`，但 `max` 寫法在到達上限前恆等於天花板值，與示例
 * 直接矛盾 —— 故維持 `min` 結構。若真的要 `max`，把 `Math.min` 換成 `Math.max` 即可。
 * Note: an earlier message wrote `max(...)`, but the `max` form equals the ceiling for every
 * `x` below the cap, contradicting the examples — the `min` structure stands. If `max` really
 * is wanted, swap `Math.min` for `Math.max`.
 *
 * `count = 0`（沒有連擊）時直接回傳 `×1.0`，而不是公式算出的值（`x = 0` 時公式給
 * `1/1.5 − 1/1.5 + 1 = ×1.0`，恰好相同，但語意上「沒有連擊」不該依賴公式巧合）：這格
 * 由明確的早退分支負責。
 * At `count = 0` this returns ×1.0 explicitly rather than trusting the formula (which happens
 * to give ×1.0 at `x = 0`): "no combo" is an early exit, not a coincidence of the curve.
 */
export const COMBO_CURVE = {
  /** 指數係數；越小上升越慢。 */
  coefficient: 0.075,
  /** 除數，把指數拉回 1 附近；`−1/divisor` 是曲線的截距項。 */
  divisor: 1.5,
  /** 指數項的上限。 */
  cap: 9,
  /** 加的基數；`cap + base` ＝ 倍率天花板（×10.00）。 */
  base: 1,
  /** 倍率顯示與計分共用的小數位數（使用者定案：兩位）。 */
  decimals: 2,
} as const;

/** 依 `COMBO_CURVE.decimals` 四捨五入，讓顯示與計分用同一個值。 */
function roundToCurve(value: number): number {
  const factor = 10 ** COMBO_CURVE.decimals;

  return Math.round(value * factor) / factor;
}

/** 由串長算出倍率。`count <= 0` 回傳 `1`（見上方說明）。 */
export function comboMultiplier(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 1;

  const raw = Math.exp(COMBO_CURVE.coefficient * count) / COMBO_CURVE.divisor - 1 / COMBO_CURVE.divisor;

  return roundToCurve(Math.min(raw, COMBO_CURVE.cap) + COMBO_CURVE.base);
}

/** 某一刻的連擊狀態快照。 */
export interface ComboSnapshot {
  /** 這串連勝累積到第幾次合成；尚未合成為 0。 */
  count: number;
  /** 目前串長對應的倍率（＝最後一次合成所用的）；尚未合成為 `1`。 */
  multiplier: number;
}

/**
 * 連擊計數器。
 * The combo counter.
 *
 * 只認識兩個事件：**這一步發生了一場合併**（`record`）與**上一顆什麼都沒合成**
 * （`reset`）。因為窗口是「有沒有合成」這個事件，所以不需要時鐘。
 * It knows two events only: **a merge happened on this step** (`record`) and **the previous
 * drop merged nothing** (`reset`). Because the window is that event, no clock is needed.
 */
export class ComboTracker {
  private chain = 0;

  /** 這串連勝累積到第幾次。 */
  get count(): number {
    return this.chain;
  }

  /**
   * 記錄一次合成，回傳記錄後的狀態。
   * Record one merge and return the resulting state.
   *
   * 回傳的 `multiplier` 是**這次**合成所用的倍率（當下串長對應的曲線值），
   * 呼叫端直接拿它去乘分數即可，不必自己推導。
   * The returned `multiplier` is the one **this** merge used (the curve value at the new
   * chain length), so the caller can multiply the score straight away without deriving
   * anything.
   */
  record(): ComboSnapshot {
    this.chain += 1;

    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /**
   * 目前狀態。無副作用，HUD 可以每幀查詢。
   * Current state. Side-effect free, so the HUD may poll it every frame.
   *
   * `multiplier` 是**最後一次**合成所用的倍率 —— COMBO 卡第二行 `(×1.74)` 顯示的就是它；
   * 尚未合成時為 `1`。
   * `multiplier` is what the **latest** merge used — exactly what the card's `(×1.74)` shows;
   * `1` before any merge.
   */
  snapshot(): ComboSnapshot {
    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /**
   * 歸零。**只由「上一顆零合成」驅動**，不是時間、也不是每次投放。
   * Reset. Driven **only by "the previous drop merged nothing"** — not by time, not by dropping.
   */
  reset(): void {
    this.chain = 0;
  }
}
