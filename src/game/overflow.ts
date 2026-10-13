/**
 * 溢位判定與寬限倒數。
 * Overflow detection and grace countdown.
 */

/**
 * 溢位判定所需的剛體資訊：看它的上緣，而且只看已入堆的。
 * What overflow detection needs to know about a body: its top edge, and only if it has joined the pile.
 */
export interface OverflowBody {
  id: number;
  x: number;
  y: number;
  radius: number;
  /**
   * 這顆是否已經入堆（曾經碰到其他方團團）。由呼叫端單向設真；一旦入堆，
   * 之後就算被擠到最頂端仍然算數。
   * Whether the body has joined the pile (it has touched another dumpling). The caller latches it
   * one-way; once piled, a body keeps counting even if the stack later squeezes it to the top.
   */
  entered: boolean;
}

/**
 * 溢位判定參數；調參入口是 `graceMs`（來自 `levels.json`）。
 * Overflow-detection parameters; the tuning entry point is `graceMs` (from `levels.json`).
 */
export interface OverflowSettleOptions {
  /**
   * @deprecated 停定門檻已移除；已入堆的越線顆粒立即起算。保留欄位只為相容舊呼叫端。
   * @deprecated The settle gate is gone; a piled breach counts immediately. Kept for signature compatibility only.
   */
  settleDistance?: number;
  /**
   * @deprecated 見 `settleDistance`。
   * @deprecated See `settleDistance`.
   */
  settleMs?: number;
}

/**
 * 舊版停定門檻的預設值；僅供既有測試引用。
 * The old settle thresholds' defaults; kept only for existing tests.
 */
export const OVERFLOW_SETTLE_DEFAULTS = {
  settleDistance: 0.6,
  settleMs: 200,
} as const;

/**
 * 溢位監視器：只讀 `entered` 標記與上緣位置，不含幾何與渲染（`lineY` 每步由呼叫端提供）。
 * The overflow monitor reads only the `entered` flag and top edges — no geometry, no rendering
 * (`lineY` arrives from the caller each step).
 *
 * 倒數連續而非累計；一旦起算就不被運動打斷，唯一歸零條件是場上沒有越線的已入堆顆粒。
 * The countdown is continuous, never cumulative; once started it is not interrupted by movement,
 * and the only reset is "no piled body is over the line".
 */
export class OverflowMonitor {
  private readonly graceMs: number;

  private elapsedMs = 0;
  /** 是否曾經起算（一旦為真，倒數就不再被運動打斷，直到退線歸零）。 */
  private counting = false;
  private over = false;

  constructor(graceMs: number, _settle: OverflowSettleOptions = {}) {
    this.graceMs = Math.max(0, graceMs);
  }

  get elapsed(): number {
    return this.elapsedMs;
  }

  /**
   * 目前是否有已入堆的顆粒越線（＝倒數正在跑），畫面靠它決定要不要亮紅線與倒數徽章。
   * Whether a piled body is over the line (the countdown is running); the view lights the line and badge from this.
   */
  get settled(): boolean {
    return this.counting;
  }

  /**
   * 寬限進度 `0..1`，給 UI 顯示「剩下多少時間」。
   * Grace progress `0..1`, for the UI's remaining-time display.
   */
  get progress(): number {
    if (this.graceMs <= 0) return this.over ? 1 : 0;

    return Math.min(1, this.elapsedMs / this.graceMs);
  }

  get remainingMs(): number {
    return Math.max(0, this.graceMs - this.elapsedMs);
  }

  /**
   * 剩餘秒數，無條件進位到整數（顯示 5 到 1，不會出現 0）；沒有越線顆粒時回 0。
   * Whole seconds remaining, rounded up (5, 4, … 1, never 0); returns 0 while nothing is over the line.
   */
  get remainingSeconds(): number {
    if (!this.settled || this.graceMs <= 0) return 0;

    return Math.ceil(this.remainingMs / 1000);
  }

  /**
   * 是否已判定結束；一旦成立就不會自己回復（要 `reset()`）。
   * Whether the run is over; once true it never clears by itself (only `reset()`).
   */
  get isOver(): boolean {
    return this.over;
  }

  /**
   * 以目前場上的剛體推進一步，回傳這一步是否有已入堆顆粒越線。
   * Advances one step with the current bodies; returns whether a piled body is over the line.
   */
  update(deltaMs: number, bodies: readonly OverflowBody[], lineY: number): boolean {
    const dt = Math.max(0, deltaMs);

    /* 只有入堆、而且上緣還在線之上的顆粒才算越線。 */
    const breaching = bodies.filter((body) => body.entered && body.y - body.radius < lineY);

    if (breaching.length === 0) {
      /* 退線就完全歸零 —— 下一次越線要從頭倒數。 */
      this.elapsedMs = 0;
      this.counting = false;
      return false;
    }

    /*
     * 越線即起算，一直到退線為止；刻意沒有任何運動或停定判斷 ——
     * 入堆與否已由接觸判定把關，已入堆且越線的顆粒就是貨真價實的溢位。
     * Count immediately on the breach and keep counting until it clears; there is deliberately no
     * movement or settle test — contact already gates "piled", so a piled breach is a real overflow.
     */
    this.counting = true;
    this.elapsedMs += dt;
    if (this.elapsedMs >= this.graceMs) this.over = true;

    return true;
  }

  /** 歸零；開新局時呼叫。 */
  reset(): void {
    this.elapsedMs = 0;
    this.over = false;
    this.counting = false;
  }
}
