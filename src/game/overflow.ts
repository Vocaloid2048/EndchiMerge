/**
 * 溢位判定與寬限倒數。
 * Overflow detection and grace countdown.
 *
 * 規則（使用者定案）：容器頂緣往上 `overflowAboveRim` 的高度畫一條線；只要有方團團的
 * **上緣**越過那條線，**而且在越線位置附近停定下來**，就開始倒數 `graceMs`。
 * The rule: a line sits `overflowAboveRim` above the container's rim. As soon as any
 * dumpling's **top edge** crosses it **and settles there**, a `graceMs` countdown starts.
 *
 * **為什麼要等停定**（使用者定案）：越線的瞬間幾乎都是「剛投下、還在往下掉」或
 * 「剛被彈起來」，那時候倒數毫無意義 —— 玩家還沒看到問題就先被警告。改成要「位移很少」
 * 才起算，倒數就只在堆疊真的卡住了才出現。
 * **Why wait for it to settle** (the user's decision): the instant of crossing is almost
 * always a dumpling still falling or freshly bounced, and starting the countdown then warns
 * the player before they can even see the problem. Requiring the breach to be nearly
 * stationary means the timer only appears when the stack is genuinely stuck.
 *
 * 停定的判準是**越線顆粒的每步位移**：連續 `settleMs` 都低於 `settleDistance` 才算停定。
 * 位移用每顆自己的上一幀位置比對，所以一顆靜止的顆粒不會被旁邊滾動的顆粒拖住
 * —— 「整堆都靜止」在堆滿時幾乎永遠不成立。
 * Settling is measured as the **per-step displacement of the breaching bodies**: every body
 * must stay under `settleDistance` for `settleMs` in a row. Displacement is compared against
 * each body's own previous position, so one still dumpling is not held up by a neighbour
 * rolling past — "the whole pile is still" is a condition that almost never holds once the
 * container is full.
 *
 * **為什麼倒數要「連續」而不是「累計」**：掉落下來的方團團本來就會短暫經過線上，若把那些
 * 瞬時穿越累加起來，正常遊玩也會被誤判出局。因此只要場上沒有東西越線，計時器立刻歸零。
 * **Why the countdown is continuous rather than cumulative**: a falling dumpling crosses the
 * line for a moment by design, and accumulating those instants would fail a perfectly normal
 * run. The timer snaps back to zero the moment nothing is above the line.
 *
 * **倒數起算後就不再被運動打斷**（使用者定案）：停定判定只決定「倒數**什麼時候開始**」，
 * 一旦開始，之後不論場上多吵（玩家繼續投放、新顆粒砸進堆疊把整堆推開），倒數都一路走到底。
 * 唯一能讓它歸零的條件是「完全沒有越線顆粒」—— 那才是「解除越界」。
 * 舊實作把 `elapsedMs` 也綁在 `anyMoving` 上，導致每投一顆就歸零、倒數永遠走不完。
 * **Once counting begins, movement can no longer interrupt it** (the user's decision): settling
 * only decides **when the countdown starts**. After that it runs to the end no matter how noisy
 * the board gets (the player keeps dropping, fresh dumplings slam into the pile and shove it
 * around). The one thing that resets it is "nothing is above the line" — that is what "clearing
 * the breach" means. The old code zeroed `elapsedMs` on movement too, so every drop reset the
 * timer and it could never finish.
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
  /** 剛體識別碼；用來追蹤同一顆的上一幀位置。 */
  id: number;
  /** 圓心 X，虛擬單位。停定判定要看二維位移，只看 Y 會漏掉橫向滾動。 */
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
 * 停定判定的參數。
 * Settling-detection parameters.
 *
 * **調參入口**：想讓警告更早或更晚出現就改這裡。
 * **The tuning entry point**: adjust these to make the warning appear sooner or later.
 */
export interface OverflowSettleOptions {
  /**
   * 每步位移低於這個值（虛擬單位）才算「沒有在動」。
   * Per-step displacement below this (virtual units) counts as "not moving".
   */
  settleDistance: number;
  /**
   * 要連續靜止多久（毫秒）才真的起算。給了它一段緩衝，抖動不會被當成停定。
   * How long (ms) the breach must stay still to actually start counting; the margin keeps
   * jitter from reading as settled.
   */
  settleMs: number;
}

/** 停定判定的預設值；數字與 `docs/gameplay.md` §4.3 的說明一致。 */
export const OVERFLOW_SETTLE_DEFAULTS: OverflowSettleOptions = {
  settleDistance: 0.6,
  settleMs: 200,
};

/** 一顆越線顆粒的追蹤狀態。 */
interface TrackedBody {
  x: number;
  y: number;
}

export class OverflowMonitor {
  private readonly graceMs: number;
  private readonly settleDistance: number;
  private readonly settleMs: number;

  private elapsedMs = 0;
  /** 越線且已在原地停留多久；未達 `settleMs` 前不倒數。 */
  private settledMs = 0;
  private over = false;
  /**
   * 倒數是否已經**起算**（=`settled` 曾為真）。起算之後就進入「不可被運動打斷」的狀態。
   * Whether the countdown has ever actually begun. Once it has, the timer becomes immune to
   * movement — see `update`.
   */
  private counting = false;

  /** 上一幀各顆的位置，用來算每步位移。 */
  private previous = new Map<number, TrackedBody>();

  constructor(graceMs: number, settle: Partial<OverflowSettleOptions> = {}) {
    this.graceMs = Math.max(0, graceMs);
    this.settleDistance = Math.max(0, settle.settleDistance ?? OVERFLOW_SETTLE_DEFAULTS.settleDistance);
    this.settleMs = Math.max(0, settle.settleMs ?? OVERFLOW_SETTLE_DEFAULTS.settleMs);
  }

  /** 目前已經連續溢位（且已停定）多久，毫秒。 */
  get elapsed(): number {
    return this.elapsedMs;
  }

  /**
   * 越線的顆粒是否已經停定（＝倒數真的開始了）。
   * Whether the breach has settled, i.e. the countdown has actually started.
   *
   * 畫面靠這個值決定要不要亮紅線：還在動的時候**完全不亮**，玩家就不會看到一個
   * 「還在掉就出現」的警告。
   * The view uses this to decide whether to light the line: while things are still moving it
   * stays completely dark, so the player never sees a warning about a dumpling still falling.
   */
  get settled(): boolean {
    return this.settledMs >= this.settleMs;
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
   * 尚未停定（＝倒數還沒真的開始）時回 0，呼叫端因此不需要自己判斷要不要顯示。
   * Returns 0 before the breach settles, so callers need no extra "should I show this?" test.
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
   * @returns 這一步是否處於「有東西越線」的狀態（尚未考慮停定）。
   */
  update(deltaMs: number, bodies: readonly OverflowBody[], lineY: number): boolean {
    const dt = Math.max(0, deltaMs);

    /* 只有入堆、而且上緣還在線之上的顆粒才算越線。 */
    const breaching = bodies.filter((body) => body.entered && body.y - body.radius < lineY);

    if (breaching.length === 0) {
      /* 退線就完全歸零，包括「停定了多久」—— 下一次越線要重新等它停。 */
      this.elapsedMs = 0;
      this.settledMs = 0;
      this.counting = false;
      this.previous.clear();
      return false;
    }

    /*
     * **倒數起算之後，運動不再打斷它**（使用者定案）。
     *
     * 舊實作裡 `anyMoving` 會把 `settledMs` 和 `elapsedMs` 一起歸零，於是每投一顆新方團團
     * 就重置一次：新顆粒掉進堆疊、碰到其他方團團 → `entered = true`，上緣又在線上 → 它成了
     * 新的「越線顆粒」，而第一次見到它沒有上一步可比較 → `anyMoving = true` → 倒數歸零。
     * 結果是**倒數永遠走不完**，玩家可以靠一直投放無限拖延（畫面上就是倒數反覆跳回 5）。
     *
     * 使用者的規則是「若果未有解除越界條件，請繼續倒數」—— 解除的唯一條件是「完全沒有
     * 越線顆粒」，那正是上面 `breaching.length === 0` 那一支。所以這裡直接跳過整段停定
     * 判定，讓倒數一路走到底。
     *
     * The countdown, once begun, is **immune to movement** (the user's decision).
     *
     * The old code zeroed both `settledMs` and `elapsedMs` whenever anything moved, so every
     * single drop reset it: the fresh dumpling touches the pile, `entered` goes true, its top
     * edge is over the line, and being seen for the first time it counts as moving — countdown
     * back to zero. The result was a timer that could **never** finish; the player could stall
     * forever by dropping repeatedly (visually: the badge keeps snapping back to 5).
     *
     * The user's rule is "keep counting unless the breach is cleared", and the only way to clear
     * it is "nothing is above the line" — exactly the `breaching.length === 0` branch above. So
     * the settling test is skipped from here on and the timer runs to the end.
     */
    if (this.counting) {
      this.elapsedMs += dt;
      if (this.elapsedMs >= this.graceMs) this.over = true;

      /* 仍然更新基準位置，萬一之後退線又重新越線，接續的判定才不會用舊資料。 */
      this.previous = new Map(breaching.map((body) => [body.id, { x: body.x, y: body.y }]));
      return true;
    }

    /*
     * 位移取「上一步位置 → 這一步位置」的歐氏距離。第一次見到一顆時沒有上一步可比較，
     * 直接當成「還在動」—— 剛越線的顆粒本來就多半在動，急著起算會反而更早誤判。
     * Displacement is the Euclidean distance from the previous step; a body seen for the
     * first time has nothing to compare against, so it counts as still moving — a freshly
     * breaching dumpling usually is, and assuming otherwise would warn too early.
     */
    let anyMoving = false;
    for (const body of breaching) {
      const last = this.previous.get(body.id);

      if (last === undefined) {
        anyMoving = true;
      } else if (Math.hypot(body.x - last.x, body.y - last.y) > this.settleDistance) {
        anyMoving = true;
      }
    }

    this.previous = new Map(breaching.map((body) => [body.id, { x: body.x, y: body.y }]));

    if (anyMoving) {
      /* 還在動：停定計時歸零，倒數尚未起算所以不動 elapsed。畫面上紅線因此完全不亮。 */
      this.settledMs = 0;
      this.elapsedMs = 0;
      return true;
    }

    this.settledMs += dt;

    /* 還沒停定就不起算；這是「停定後才提示」的落點。 */
    if (!this.settled) return true;

    /* 通過停定門檻的這一步就是倒數的起算點，從此刻起 `counting` 永為真。 */
    this.counting = true;
    this.elapsedMs += dt;
    if (this.elapsedMs >= this.graceMs) this.over = true;

    return true;
  }

  /** 歸零；開新局時呼叫。 */
  reset(): void {
    this.elapsedMs = 0;
    this.settledMs = 0;
    this.over = false;
    this.counting = false;
    this.previous.clear();
  }
}
