/**
 * 連擊（Combo）追蹤。
 * Combo tracking.
 *
 * **計數語意（使用者定案）**：一串連擊 ＝ **一次投放**。窗口不是時間，而是「本次投放到
 * 下次投放之間」—— 因此 `reset()` 只在投放時被呼叫，不會因為時間過去而歸零。
 * 一次投放裡合成了幾次，就是 `count`；每一次合成各自拿「當下串長」對應的倍率。
 * **Counting semantics** (the user's decision): one chain *is* one drop. The window is not a
 * duration but "this drop until the next drop", so `reset()` is driven by `drop()` and time
 * alone never ends a chain. `count` is how many merges happened inside that drop, and each
 * merge takes the multiplier of the chain length it lands on.
 *
 * 為什麼**不是**時間窗口：舊版用 `comboWindowMs`（1 秒），但投放本身已經有 1 秒間隔，
 * 兩個時間概念會互相打架 —— 「同一批」究柢是「同一次投放」，用投放當界線比用毫秒誠實。
 * Why **not** a time window: the older version used `comboWindowMs` (1 s), but drops are
 * already spaced 1 s apart, so the two notions fight each other. "The same batch" really means
 * "the same drop", and a drop boundary is more honest than a millisecond count.
 *
 * 這個模組不碰物理、不碰分數，所以「第幾次合成拿幾倍」可以在單元測試裡逐條釘住。
 * This module touches neither physics nor score, so "which merge gets which multiplier" can be
 * pinned down test by test.
 */

/**
 * Combo 倍率曲線。
 * The combo-multiplier curve.
 *
 * 使用者指定：`y = min(e^(0.05x) / 10, 9) + 1`，`x` 是當下的串長。原本的階梯
 * （第 1 次 ×1、第 2 次 ×2…）換成這條平滑曲線：起點貼著 ×1.1，之後緩慢上升，
 * `x = 90` 才碰到 `×10.0` 的天花板；`×1.3` 剛好落在 `x = 22`。
 * The user's curve: `y = min(e^(0.05x) / 10, 9) + 1` with `x` the current chain length. It
 * replaces the ×n ladder with a smooth climb that starts just above ×1.1 and only reaches the
 * ×10.0 ceiling at `x = 90`; ×1.3 lands exactly at `x = 22`.
 *
 * 註：使用者訊息裡寫的是 `max(...)`，但 `max(e^(0.05x)/10, 9) + 1` 在 `x ≤ 90` 時**恆等於
 * ×10**（e 項要 `x = 90` 才追上 9），與示例 `×1.3` 矛盾，也與「緩慢上升」的原設計相反；
 * 故按文檔原本的 `min` 結構實作。若真的要 `max`，把 `Math.min` 換成 `Math.max` 即可。
 * Note: the user's message wrote `max(...)`, but `max(e^(0.05x)/10, 9) + 1` is a flat ×10 for
 * every `x ≤ 90` (the exponential only overtakes 9 at x=90), which contradicts both the ×1.3
 * example and the original "climbs slowly" design; it is implemented as the documented `min`
 * form. If `max` really is wanted, swap `Math.min` for `Math.max`.
 *
 * `count = 0`（沒有連擊）時直接回傳 `×1.0`，而不是公式算出的 `×1.1`：靜止狀態顯示 1.1
 * 會讓玩家以為一直有加成。這是一處刻意偏離公式的地方，只影響「沒有連擊」那一格。
 * At `count = 0` this returns ×1.0 rather than the formula's ×1.1, because an idle card
 * reading 1.1 looks like a permanent bonus. Deliberate, and it only affects the no-combo case.
 */
export const COMBO_CURVE = {
  /** 指數係數；越小上升越慢。 */
  coefficient: 0.05,
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
  /** 本次投放已經合成過幾次；尚未合成為 0。 */
  count: number;
  /** 目前串長對應的倍率（＝最後一次合成所用的）；尚未合成為 `1`。 */
  multiplier: number;
}

/**
 * 連擊計數器。
 * The combo counter.
 *
 * 只認識一個事件：**這一步發生了一場合併**。因為窗口就是「本次投放」，所以不需要時鐘，
 * 也不需要「同一批」的判準 —— 同一物理步的多場合併自然就落在同一次投放裡，各自遞增。
 * It knows one event only: **a merge happened on this step**. Because the window *is* the
 * drop, no clock and no "same batch" test is needed — several merges in one physics step fall
 * inside the same drop and each climbs the curve.
 */
export class ComboTracker {
  private chain = 0;

  /** 本次投放目前合成過幾次。 */
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
   * 歸零。**由投放驅動**，不是時間 —— 這是「窗口＝本次投放」的落點。
   * Reset. Driven by **dropping**, not by time — the point of "the window is the drop".
   */
  reset(): void {
    this.chain = 0;
  }
}
