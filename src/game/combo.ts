/**
 * 連擊（Combo）追蹤。
 * Combo tracking.
 *
 * **計數語意（使用者定案）**：一串連擊 ＝ **一次投放**。窗口不是時間，而是「本次投放到
 * 下次投放之間」—— 因此 `reset()` 只在投放時被呼叫，不會因為時間過去而歸零。
 * 一次投放裡合成了幾次，就是 `count`；每一次合成各自拿一個**遞增**的倍率
 * （第 1 次 ×1、第 2 次 ×2…），這也是本模組唯一的輸出。
 * **Counting semantics** (the user's decision): one chain *is* one drop. The window is not a
 * duration but "this drop until the next drop", so `reset()` is driven by `drop()` and time
 * alone never ends a chain. `count` is how many merges happened inside that drop, and each
 * merge takes a **stepped** multiplier (the 1st ×1, the 2nd ×2, …). That is the module's only
 * output.
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
 * Combo 倍率的階梯。
 * The combo-multiplier ladder.
 *
 * 使用者定案的語意是「每一次合成各自拿一個遞增的倍率」：
 * 一次投放裡第 1 場合併 ×1、第 2 場 ×2、第 3 場 ×3……而不是像指數曲線那樣平滑爬升。
 * The user's semantics are "each merge takes its own stepped multiplier": inside one drop the
 * 1st merge is ×1, the 2nd ×2, the 3rd ×3, … rather than a smooth exponential climb.
 *
 * `step` 是每一場合併往上加多少；`cap` 是天花板，避免一次超長連鎖把分數炸開。
 * `step` is how much each merge adds and `cap` is the ceiling, so one very long cascade cannot
 * blow the score up.
 */
export const COMBO_LADDER = {
  /** 開頭倍率（第一場合併）。 */
  base: 1,
  /** 每一場合併往上加的量。 */
  step: 1,
  /** 倍率上限。 */
  cap: 10,
} as const;

/** 由「本次投放的第幾場合併」算出倍率。`count <= 0` 回傳 `1`。 */
export function comboMultiplier(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return COMBO_LADDER.base;

  const raw = COMBO_LADDER.base + (count - 1) * COMBO_LADDER.step;

  return Math.min(raw, COMBO_LADDER.cap);
}

/** 某一刻的連擊狀態快照。 */
export interface ComboSnapshot {
  /** 本次投放已經合成過幾次；尚未合成為 0。 */
  count: number;
  /** 下一場合併會拿到的倍率；尚未合成為 `1`。 */
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
 * inside the same drop and simply step the ladder.
 */
export class ComboTracker {
  private chain = 0;

  /** 本次投放目前合成過幾次。 */
  get count(): number {
    return this.chain;
  }

  /** 下一場合併會用到的倍率（＝目前串長 + 1 對應的倍率）。 */
  get pendingMultiplier(): number {
    return comboMultiplier(this.chain + 1);
  }

  /**
   * 記錄一次合成，回傳記錄後的狀態。
   * Record one merge and return the resulting state.
   *
   * 回傳的 `multiplier` 是**這次**合成所用的倍率（第 1 次 ×1、第 2 次 ×2…），
   * 呼叫端直接拿它去乘分數即可，不必自己推導。
   * The returned `multiplier` is the one **this** merge used (the 1st ×1, the 2nd ×2, …), so
   * the caller can multiply the score straight away without deriving anything.
   */
  record(): ComboSnapshot {
    this.chain += 1;

    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /** 目前狀態。無副作用，HUD 可以每幀查詢。 */
  snapshot(): ComboSnapshot {
    return { count: this.chain, multiplier: this.pendingMultiplier };
  }

  /**
   * 歸零。**由投放驅動**，不是時間 —— 這是「窗口＝本次投放」的落點。
   * Reset. Driven by **dropping**, not by time — the point of "the window is the drop".
   */
  reset(): void {
    this.chain = 0;
  }
}
