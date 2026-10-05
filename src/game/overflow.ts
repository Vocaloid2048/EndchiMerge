/**
 * 溢位判定與寬限倒數。
 * Overflow detection and grace countdown.
 *
 * 規則（使用者定案）：容器頂緣往上 `overflowAboveRim` 的高度畫一條線；只要有**已入堆**的
 * 方團團，其上緣越過那條線，就立刻開始倒數 `graceMs`。
 * The rule: a line sits `overflowAboveRim` above the container's rim. As soon as any
 * **piled** dumpling's **top edge** crosses it, a `graceMs` countdown starts immediately.
 *
 * **為什麼不看「停定」**（使用者定案，第二版）：第一版要求越線顆粒在原地停定 `settleMs`
 * 才起算，用意是避免「剛投下、還在掉」的瞬間誤判。但 `entered`（已入堆＝碰過別的方團團）
 * 本身已經把「還在掉」排除掉了，停定判定於是變成多餘的門檻 —— 而且會開一個大洞：
 * **玩家持續投放時，堆頂那顆一直被擾動、位移永遠超過門檻，停定永不成立，紅線與倒數就
 * 永遠不出現**。場面看起來就是「堆到線上卻什麼都不發生」（使用者截圖的「卡住」）。
 * 既然入堆與否已由接觸判定把關，越線的已入堆顆粒就是貨真價實的溢位，直接起算。
 * **Why the settle gate was dropped** (the user's decision, revision 2): the first cut required
 * the breaching body to be stationary for `settleMs` before counting, to avoid tripping on a
 * dumpling still falling. But `entered` (piled = has touched another dumpling) already excludes
 * "still falling", so the settle gate became a redundant threshold — and it opened a large hole:
 * **while the player keeps dropping, the topmost body is constantly jostled, its displacement
 * never stays under the threshold, settling never holds, and the red line and countdown never
 * appear at all.** The board simply looks like "the stack reached the line and nothing happens"
 * (the "stuck" the user's screenshot showed). Since contact already gates "piled", a piled body
 * over the line is a genuine overflow and counts right away.
 *
 * **為什麼倒數要「連續」而不是「累計」**：掉落下來的方團團本來就會短暫經過線上，但因為
 * 未入堆不算數，這些瞬時穿越不會被計入。只要場上沒有**已入堆**的東西越線，計時器立刻歸零。
 * **Why the countdown is continuous rather than cumulative**: a falling dumpling crosses the
 * line for a moment by design, but since it is not piled those instants never count. The timer
 * snaps back to zero the moment nothing **piled** is above the line.
 *
 * **倒數起算後就不再被運動打斷**（使用者定案）：一旦開始，之後不論場上多吵（玩家繼續投放、
 * 新顆粒砸進堆疊把整堆推開），倒數都一路走到底。唯一能讓它歸零的條件是「完全沒有越線顆粒」
 * —— 那才是「解除越界」。
 * **Once counting begins, movement can no longer interrupt it** (the user's decision): after that
 * it runs to the end no matter how noisy the board gets (the player keeps dropping, fresh
 * dumplings slam into the pile and shove it around). The one thing that resets it is "nothing is
 * above the line" — that is what "clearing the breach" means.
 *
 * **「入堆」的定義是接觸**（使用者定案）：一顆方團團要**碰到其他方團團**才算入堆，光是被
 * 投下來、或撞到牆與地板都不算。標記由呼叫端（`game/session.ts` 的碰撞處理）單向設真；
 * 本類別只讀它，不看幾何、也不看速度。
 * **"Piled" means contact** (the user's decision): a dumpling joins the pile only once it
 * **touches another dumpling** — merely being dropped, or hitting a wall or the floor does
 * not count. The caller (`game/session.ts`, in its collision handler) latches the flag; this
 * class only reads it, and looks at neither geometry nor velocity.
 *
 * 這一類別不含幾何也不含渲染：`lineY` 由呼叫端每幀提供，因為視窗尺寸一改，線就跟著動。
 * The class holds no geometry and no rendering: `lineY` arrives every frame, because
 * resizing the window moves the line with it.
 */

/**
 * 溢位判定所需的剛體資訊：看它的上緣，而且只看已入堆的。
 * What overflow detection needs to know about a body: its top edge, and only if it has
 * joined the pile.
 */
export interface OverflowBody {
  /** 剛體識別碼；保留給呼叫端與除錯用途。 */
  id: number;
  /** 圓心 X，虛擬單位。 */
  x: number;
  /** 圓心 Y，虛擬單位。 */
  y: number;
  /** 半徑，虛擬單位。 */
  radius: number;
  /**
   * 這顆是否已經入堆（曾經碰到其他方團團）。
   * Whether the body has joined the pile (it has touched another dumpling at least once).
   *
   * 由呼叫端**單向**設為真；一旦入堆，之後就算被擠到最頂端仍然算數。
   * The caller latches it one-way; having joined the pile, a body keeps counting even if the
   * stack later squeezes it to the top.
   */
  entered: boolean;
}

/**
 * 溢位判定參數。
 * Overflow-detection parameters.
 *
 * **調參入口**：想改寬限秒數就改 `graceMs`（來自 `levels.json`）。舊版還有
 * `settleDistance` / `settleMs` 這兩個「停定」門檻，現已移除 —— 見檔頭說明。
 * **The tuning entry point**: `graceMs` comes from `levels.json`. The old `settleDistance` /
 * `settleMs` settle thresholds are gone — see the file header.
 */
export interface OverflowSettleOptions {
  /**
   * @deprecated 停定門檻已移除；已入堆的越線顆粒立即起算。保留欄位只為相容舊呼叫端。
   * @deprecated The settle gate is gone; a piled breach counts immediately. Kept for signature
   * compatibility only.
   */
  settleDistance?: number;
  /**
   * @deprecated 見 `settleDistance`。
   * @deprecated See `settleDistance`.
   */
  settleMs?: number;
}

/** 舊版停定門檻的預設值；保留僅供文件與既有測試引用。 */
export const OVERFLOW_SETTLE_DEFAULTS = {
  settleDistance: 0.6,
  settleMs: 200,
} as const;

export class OverflowMonitor {
  private readonly graceMs: number;

  private elapsedMs = 0;
  /** 是否曾經起算（一旦為真，倒數就不再被運動打斷，直到退線歸零）。 */
  private counting = false;
  private over = false;

  constructor(graceMs: number, _settle: OverflowSettleOptions = {}) {
    this.graceMs = Math.max(0, graceMs);
  }

  /** 目前已經連續溢位多久，毫秒。 */
  get elapsed(): number {
    return this.elapsedMs;
  }

  /**
   * 目前是否有**已入堆**的顆粒越線（＝倒數正在跑）。
   * Whether a **piled** body is over the line, i.e. the countdown is running.
   *
   * 畫面靠這個值決定要不要亮紅線與倒數徽章。舊版另外要求「停定」才為真，那個門檻已移除：
   * 它讓「持續投放時堆頂一直被擾動」的場面永遠不亮線，玩家只看到堆到頂卻毫無反應。
   * The view uses this to light the line and the countdown badge. The old "settled" gate is
   * gone: it kept the line dark whenever continuous dropping jostled the top of the stack, so
   * the player saw the pile reach the line and nothing happen at all.
   */
  get settled(): boolean {
    return this.counting;
  }

  /** 寬限進度 `0..1`；給 UI 顯示「剩下多少時間」。 */
  get progress(): number {
    if (this.graceMs <= 0) return this.over ? 1 : 0;

    return Math.min(1, this.elapsedMs / this.graceMs);
  }

  /** 剩餘的寬限時間，毫秒。畫面顯示倒數用。 */
  get remainingMs(): number {
    return Math.max(0, this.graceMs - this.elapsedMs);
  }

  /**
   * 剩餘秒數，無條件**進位**到整數 —— 顯示 5 到 1，不會出現 0。
   * Whole seconds remaining, rounded **up** so the display runs 5, 4, … 1 and never shows 0.
   *
   * 沒有越線顆粒時回 0，呼叫端因此不需要自己判斷要不要顯示。
   * Returns 0 while nothing is over the line, so callers need no extra "should I show this?".
   */
  get remainingSeconds(): number {
    if (!this.settled || this.graceMs <= 0) return 0;

    return Math.ceil(this.remainingMs / 1000);
  }

  /** 是否已判定結束。一旦成立就不會自己回復（要 `reset()`）。 */
  get isOver(): boolean {
    return this.over;
  }

  /**
   * 以目前場上的剛體推進一步。
   * Advance one step with the current bodies.
   *
   * @param deltaMs 這一步的毫秒 / Elapsed milliseconds for this step.
   * @param bodies 場上所有方團團，各自帶 `entered` 標記 / Every dumpling on the board,
   *   each carrying its `entered` flag.
   * @param lineY 溢位線的 Y（虛擬單位）/ The overflow line's Y in virtual units.
   * @returns 這一步是否處於「有已入堆顆粒越線」的狀態。
   */
  update(deltaMs: number, bodies: readonly OverflowBody[], lineY: number): boolean {
    const dt = Math.max(0, deltaMs);

    /* 只有入堆、而且上緣還在線之上的顆粒才算越線。 */
    const breaching = bodies.filter((body) => body.entered && body.y - body.radius < lineY);

    if (breaching.length === 0) {
      /* 退線就完全歸零 —— 下一次越線要從頭倒數。這是「解除越界」的唯一條件。 */
      this.elapsedMs = 0;
      this.counting = false;
      return false;
    }

    /*
     * 越線即起算，一直到退線為止。
     *
     * 這裡刻意**沒有任何運動或停定判斷**：入堆與否已由接觸判定把關（見檔頭），所以一顆
     * 已入堆且越線的顆粒，就是貨真價實的溢位，不論它當下是靜止還是被後續投放推得搖搖晃晃。
     * 舊版的「連續靜止 settleMs」門檻讓「玩家持續投放」的場面永遠起不了算 —— 越線顆粒一直在動、
     * 停定永不成立、紅線與倒數永不出現，看起來就像卡住。
     * Count immediately on the breach and keep counting until it clears.
     *
     * There is deliberately **no movement or settle test here**: contact already gates "piled"
     * (see the header), so a piled body over the line is a genuine overflow whether it is still
     * or being jostled by later drops. The old "stationary for `settleMs`" gate meant that while
     * the player kept dropping, the breaching body never stopped moving, settling never held,
     * and neither the line nor the countdown ever appeared — which read as being stuck.
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
