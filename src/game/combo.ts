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
 * 使用者指定：`y = min(e^(0.25x) / 10, 9) + 1`，`x` 是當下的串長。原本的階梯
 * （第 1 次 ×1、第 2 次 ×2…）換成這條平滑曲線。係數由 `0.05` 調到 `0.25` 之後上升快得多：
 * `x = 4` 就剛好到 `×1.3`（`e^1 / 10 = 0.2718`），`x = 18` 碰到 `×10.0` 的天花板。
 * The user's curve: `y = min(e^(0.25x) / 10, 9) + 1` with `x` the current chain length. The
 * coefficient moved from `0.05` to `0.25`, so the climb is far steeper: ×1.3 lands exactly at
 * `x = 4` (`e^1 / 10 = 0.2718`) and the ×10.0 ceiling is reached at `x = 18`.
 *
 * 註：使用者訊息裡寫的是 `max(...)`，但 `max(e^(0.25x)/10, 9) + 1` 在 `x ≤ 18` 時**恆等於
 * ×10**（e 項要 `x = 18` 才追上 9），與他舉的示例「4 / + 18 (×1.3)」直接矛盾 ——
 * `x = 4` 時 `max` 會顯示 ×10 而不是 ×1.3。故按文檔原本的 `min` 結構實作。若真的要 `max`，
 * 把 `Math.min` 換成 `Math.max` 即可。
 * Note: the user's message wrote `max(...)`, but `max(e^(0.25x)/10, 9) + 1` is a flat ×10 for
 * every `x ≤ 18` (the exponential only overtakes 9 at x=18), which contradicts his own
 * example "4 / + 18 (×1.3)" — at `x = 4`, `max` would read ×10, not ×1.3. It is implemented
 * as the documented `min` form. If `max` really is wanted, swap `Math.min` for `Math.max`.
 *
 * `count = 0`（沒有連擊）時直接回傳 `×1.0`，而不是公式算出的 `×1.0`（`e^0 = 1`，
 * `1/10 + 1 = 1.1`）：靜止狀態顯示 1.1 會讓玩家以為一直有加成。這是一處刻意偏離公式
 * 的地方，只影響「沒有連擊」那一格。
 * At `count = 0` this returns ×1.0 rather than the formula's ×1.1, because an idle card reading
 * 1.1 looks like a permanent bonus. Deliberate, and it only affects the no-combo case.
 */
export const COMBO_CURVE = {
  /** 指數係數；越小上升越慢。 */
  coefficient: 0.25,
  /** 除數，把指數拉回 1 附近。 */
  divisor: 10,
  /** 指數項的上限。 */
  cap: 9,
  /** 加的基數；`cap + base` ＝ 倍率天花板（×10.0）。 */
  base: 1,
} as const;

/** 由串長算出倍率。`count <= 0` 回傳 `1`（見上方說明）。 */
export function comboMultiplier(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 1;

  const raw = Math.exp(COMBO_CURVE.coefficient * count) / COMBO_CURVE.divisor;

  return Math.min(raw, COMBO_CURVE.cap) + COMBO_CURVE.base;
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
   * `multiplier` 是**最後一次**合成所用的倍率 —— COMBO 卡第二行 `(×1.3)` 顯示的就是它；
   * 尚未合成時為 `1`。
   * `multiplier` is what the **latest** merge used — exactly what the card's `(×1.3)` shows;
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
