/**
 * 連擊（Combo）追蹤。
 * Combo tracking.
 *
 * 連擊只做兩件事：**判斷兩次合成是否屬於同一串**，以及**把串長換成倍率**。它不碰物理、
 * 不碰分數，所以可以在單元測試裡把「1 秒窗口的邊界」逐一釘住，而不必去猜畫面。
 * Combo does two things: decide whether two merges belong to one chain, and turn the chain
 * length into a multiplier. It touches neither physics nor score, so the window's edges can
 * be pinned in unit tests instead of guessed from the screen.
 *
 * **計數語意 / Counting semantics**
 *
 * `count` 是「目前這一串裡有幾次合成」，一串的第一顆就讓它變成 `1`，所以畫面上看到的是
 * 1、2、3…（而不是 0 起跳）。窗口一過就歸零，倍率跟著回到 `×1.0`。
 * `count` is how many merges the current chain contains; the first merge already makes it
 * `1`, so the card reads 1, 2, 3… rather than starting at zero. Letting the window lapse
 * resets it and the multiplier returns to `×1.0`.
 *
 * **同一物理步只算一次 / One count per physics step**
 *
 * 一次碰撞可能在同一物理步內同時觸發好幾場合併。舊草案用「相隔 <0.1 秒視為同一批」處理，
 * 但那會連合法的一串連鎖反應一起吞掉 —— 而草案自己的註解又說連鎖反應**應該**堆出高倍率，
 * 兩句互相矛盾。這裡改用**時間戳相同即同一批**：同一物理步的分析合併共用一個時間戳，
 * 因此只計一次；跨步的連鎖反應則正常累加。這正是「同批」真正要防的東西。
 * One collision can fire several merges inside the same physics step. The old draft treated
 * anything under 0.1 s as "the same batch", but that would also swallow a legitimate
 * multi-step cascade — and the draft's own note says cascades *should* build the multiplier,
 * so the two lines contradict each other. Instead, merges that share a timestamp (i.e. the
 * same physics step) count once, while a cascade spread over several steps accumulates
 * normally. That is what "same batch" is actually protecting against.
 */

/**
 * Combo 倍率曲線常數。
 * Combo-multiplier curve constants.
 *
 * ```
 * multiplier(n) = min( e^(coefficient × n) / divisor, cap ) + base
 * ```
 *
 * 依使用者指定：**緩慢上升**，`n = 60` 時到達上限 `×10.0`。
 * 想調手感就改這裡（`coefficient` 越小上升越慢；`cap + base` 就是天花板）。
 * Per the requested curve: it climbs slowly and reaches the `×10.0` ceiling at `n = 60`.
 * Tune the feel here — a smaller `coefficient` rises more slowly, and `cap + base` is the
 * ceiling.
 *
 * `n = 0`（沒有連擊）時直接回傳 `×1.0`，而不是公式算出的 `×1.1`：靜止狀態顯示 1.1 會讓
 * 玩家以為一直有加成。這是一處刻意偏離公式的地方，只影響「沒有連擊」那一格。
 * At `n = 0` (no chain) this returns `×1.0` rather than the formula's `×1.1`, because an
 * idle card reading 1.1 looks like a permanent bonus. That is a deliberate departure from
 * the raw formula and only affects the no-combo case.
 */
export const COMBO_CURVE = {
  /** 指數係數；越小上升越慢。 */
  coefficient: 0.075,
  /** 除數，把指數拉回 1 附近。 */
  divisor: 10,
  /** 指數項的上限。 */
  cap: 9,
  /** 加的基數；`cap + base` ＝ 倍率天花板。 */
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
  /** 串長；窗口外為 0。 */
  count: number;
  /** 對應倍率；窗口外為 1。 */
  multiplier: number;
}

/**
 * 連擊計數器。
 * The combo counter.
 *
 * 只認識兩個輸入：**這次合成發生在什麼時刻**，以及**窗口多長**。時間由外部（`GameSession`
 * 的模擬時鐘）提供，所以同一組種子與投放可以完全重播。
 * It knows two inputs only: when the merge happened and how long the window is. Time comes
 * from the outside (`GameSession`'s simulated clock), so a seed and a drop sequence replay
 * exactly.
 */
export class ComboTracker {
  private readonly windowMs: number;
  private chain = 0;
  private lastAtMs: number | null = null;

  constructor(windowMs: number) {
    this.windowMs = Math.max(0, windowMs);
  }

  /** 目前串長（未考慮窗口是否過期；要考慮請用 `snapshotAt()`）。 */
  get count(): number {
    return this.chain;
  }

  /**
   * 記錄一次合成，回傳記錄後的狀態。
   * Record one merge and return the resulting state.
   *
   * @param atMs 這次合成的模擬時刻（毫秒）/ Simulated time of the merge, in ms.
   */
  record(atMs: number): ComboSnapshot {
    /*
     * 時間戳相同＝同一物理步的多場合併。此時只更新「最後時刻」以外的東西都不動，
     * 直接回傳現況即可。
     */
    if (this.lastAtMs !== null && atMs === this.lastAtMs) return this.snapshotAt(atMs);

    const continues =
      this.lastAtMs !== null && atMs > this.lastAtMs && atMs - this.lastAtMs <= this.windowMs;

    this.chain = continues ? this.chain + 1 : 1;
    this.lastAtMs = atMs;

    return this.snapshotAt(atMs);
  }

  /**
   * 某一刻的連擊狀態。窗口已過的串視為 0，倍率回到 1。
   * The state at a given moment; a chain whose window has lapsed reads as zero.
   *
   * 這個查詢**不改變**內部狀態，所以 HUD 可以每幀問一次而不影響玩法。
   * The query is side-effect free, so the HUD can call it every frame.
   */
  snapshotAt(atMs: number): ComboSnapshot {
    const live =
      this.lastAtMs !== null && atMs >= this.lastAtMs && atMs - this.lastAtMs <= this.windowMs;

    if (!live) return { count: 0, multiplier: 1 };

    return { count: this.chain, multiplier: comboMultiplier(this.chain) };
  }

  /** 歸零；開新局時呼叫。 */
  reset(): void {
    this.chain = 0;
    this.lastAtMs = null;
  }
}
