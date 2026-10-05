/**
 * 溢位判定與寬限倒數。
 * Overflow detection and grace countdown.
 *
 * 規則（使用者定案）：容器頂緣往上 `overflowAboveRim` 的高度畫一條線；只要有方團團的
 * **上緣**越過那條線，就開始倒數 `graceMs`。玩家在這段時間內把堆疊壓回去就沒事，
 * 一直不處理就結束這一局。
 * The rule: a line sits `overflowAboveRim` above the container's rim. As soon as any
 * dumpling's **top edge** crosses it, a `graceMs` countdown starts. Clearing the pile in
 * time is fine; leaving it there ends the run.
 *
 * **為什麼倒數要「連續」而不是「累計」**：掉落下來的方團團本來就會短暫經過線上，若把那些
 * 瞬時穿越累加起來，正常遊玩也會被誤判出局。因此只要場上沒有東西越線，計時器立刻歸零。
 * **Why the countdown is continuous rather than cumulative**: a falling dumpling crosses the
 * line for a moment by design, and accumulating those instants would fail a perfectly normal
 * run. The timer snaps back to zero the moment nothing is above the line.
 *
 * **為什麼只算「已入堆」的顆粒**：投放點刻意在溢位線**上方**（`dropAboveRim` 40 >
 * `overflowAboveRim` 30），所以每顆剛生成的方團團，上緣一開始就在線之上，要落 30 個單位
 * 才降到線下。連續投放時（間隔短於那段下墜時間）這些穿越會**首尾相接**，計時器一路爬滿
 * 3 秒 —— 容器根本沒滿，這一局就結束了。因此 `OverflowBody.entered` 是必要欄位。
 * **Why only *piled* bodies count**: the drop point sits deliberately **above** the
 * overflow line (`dropAboveRim` 40 > `overflowAboveRim` 30), so a freshly spawned dumpling
 * starts with its top edge over the line and needs to fall 30 units to clear it. When drops
 * come faster than that fall takes, those crossings **chain together** and the timer runs to
 * 3 s — ending a run whose container is nowhere near full. Hence the required
 * `OverflowBody.entered` flag.
 *
 * **「入堆」的定義是接觸**（使用者定案）：一顆方團團要**碰到其他方團團**才算入堆，光是被
 * 投下來、或撞到牆與地板都不算。標記由呼叫端（`game/session.ts` 的碰撞處理）單向設真；
 * 本類別只讀它，不看幾何、也不看速度。
 * **"Piled" means contact** (the user's decision): a dumpling joins the pile only once it
 * **touches another dumpling** — merely being dropped, or hitting a wall or the floor, does
 * not count. The caller (`game/session.ts`, in its collision handler) latches the flag; this
 * class only reads it, and looks at neither geometry nor velocity.
 *
 * 這一類別不含幾何也不含渲染：`lineY` 由呼叫端每幀提供，因為視窗尺寸一改，線就跟著動。
 * The class holds no geometry and no rendering: `lineY` arrives every frame, because
 * resizing the window moves the line with it.
 */

/**
 * 溢位判定所需的剛體資訊：只看上緣，而且只看已入堆的。
 * What overflow detection needs to know about a body: only its top edge, and only if it has
 * joined the pile.
 */
export interface OverflowBody {
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

export class OverflowMonitor {
  private readonly graceMs: number;
  private elapsedMs = 0;
  private over = false;

  constructor(graceMs: number) {
    this.graceMs = Math.max(0, graceMs);
  }

  /** 目前已經連續溢位多久，毫秒。 */
  get elapsed(): number {
    return this.elapsedMs;
  }

  /** 寬限進度 `0..1`；給 UI 顯示「剩下多少時間」。 */
  get progress(): number {
    if (this.graceMs <= 0) return this.over ? 1 : 0;

    return Math.min(1, this.elapsedMs / this.graceMs);
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
   * @returns 這一步是否處於「有東西越線」的狀態。
   */
  update(deltaMs: number, bodies: readonly OverflowBody[], lineY: number): boolean {
    /* 只有入堆、而且上緣還在線之上的顆粒才算越線。 */
    const breached = bodies.some((body) => body.entered && body.y - body.radius < lineY);

    if (!breached) {
      this.elapsedMs = 0;
      return false;
    }

    this.elapsedMs += Math.max(0, deltaMs);
    if (this.elapsedMs >= this.graceMs) this.over = true;

    return true;
  }

  /** 歸零；開新局時呼叫。 */
  reset(): void {
    this.elapsedMs = 0;
    this.over = false;
  }
}
