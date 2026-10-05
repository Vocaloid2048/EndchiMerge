/**
 * 單局狀態。
 * One play session.
 *
 * 一局的所有狀態都活在這裡：**投放**、**瞄準**、**合成**、**連擊**、**溢位**，以及把
 * 物理狀態投影成畫面資料。`game/loop.ts` 每幀呼叫 `step()`，其餘模組只讀 getter。
 * Everything a run owns lives here: drops, aiming, merging, combos, overflow, and the
 * projection of physics into render data. `game/loop.ts` calls `step()` each frame; every
 * other module only reads getters.
 *
 * 刻意**不**在這裡做的兩件事 / Two things deliberately left out:
 *
 * 1. **管理掉落順序** —— 那屬於 `SpawnQueue`（D22 的單一真實來源）。這裡只呼叫
 *    `take()`／`peekAt()`，絕不自行抽取，否則 NEXT 卡又會和實際掉落不一致。
 *    Spawn ordering belongs to `SpawnQueue`; this only calls `take()`/`peekAt()`.
 * 2. **持久化解鎖** —— 那屬於 `game/progress.ts`。這裡只在「合成出新等級」時呼叫
 *    `unlocks.unlock()`，並在成功時刷新生成池。解鎖要跨局存活，而這個物件每局都會重建。
 *    Persisting unlocks belongs to `game/progress.ts`. This only calls `unlocks.unlock()`
 *    when a merge creates a new level, and refreshes the draw pool when it succeeds.
 *
 * 對外有**兩個**「下一顆」，名字刻意分開，因為搞混就是一個 bug：
 * Two different "next" values are exposed, deliberately with different names because
 * conflating them is a bug:
 *
 * - `pendingLevelId`：馬上要掉的那顆（＝手上這顆），驅動畫面預覽。
 * - `upcomingLevelId`：**放下之後**才上場的那顆，驅動 NEXT 卡。
 */

import Matter from 'matter-js';
import { createCircleBody, createPolygonBody, lockRotation, Physics } from '../core/physics';
import { POP_ANIMATION_MS, POP_PEAK_SCALE, WALL_THICKNESS } from '../core/constants';
import { computeContainerBounds, createContainerBodies } from './containerBox';
import { ComboTracker } from './combo';
import { mergeResultId } from './merge';
import { OverflowMonitor } from './overflow';
import { SpawnQueue } from './spawnQueue';
import { computeContainerGeometry, type ContainerGeometry } from '../render/container';
import { createRng, type Rng } from '../core/rng';
import type { AllConfig, LevelDef, Rect } from '../core/types';
import type { RenderAim, RenderBody } from '../render/stage';
import type { SilhouetteCache } from '../render/silhouetteLoader';

/**
 * 剛體離場多遠才算「真的不見了」。
 * How far outside the field a body must be before it counts as gone.
 *
 * 留一大段餘裕是為了不誤殺：被擠到牆上方（牆有 `DEFAULT_WALL_OVERHANG` 的延伸）
 * 或暫時被彈到高處的方團團都還算在場。
 */
const FALL_OUT_MARGIN = 400;

/**
 * 解鎖來源。
 * The unlock source.
 *
 * `game/progress.ts` 的 `ProgressStore` 在結構上滿足這個介面。刻意只取需要的一小部分，
 * 是為了讓 `GameSession` 不必知道「解鎖存在哪裡」——它只知道「問得到、也解得開」。
 * `ProgressStore` satisfies this structurally. Only the needed slice is taken so the session
 * never learns where unlocks live; it only needs to be able to ask and to unlock.
 */
export interface UnlockSource {
  readonly unlocked: ReadonlySet<number>;
  has(id: number): boolean;
  unlock(id: number): boolean;
}

/** 場上一顆方團團：物理剛體 ＋ 它的等級 ＋ 出生時刻 ＋ 是否進過槽。 */
interface Entry {
  body: Matter.Body;
  level: LevelDef;
  /**
   * 出生時刻（模擬毫秒）。同時服務兩件事：合成的**冷卻**，以及彈跳動畫的**起點**。
   * Birth time in simulated ms; it serves both the merge cooldown and the pop animation.
   */
  bornAtMs: number;
  /**
   * 這顆是否已經「入堆」（＝曾經碰到其他方團團）。
   * Whether the body has joined the pile, i.e. it has touched another dumpling.
   *
   * **單向**：一旦為真就不再變回假。溢位判定（`game/overflow.ts`）只把入堆的顆粒納入
   * 警戒，因為**下墜中的顆粒**不該觸發警告 —— 投放點在溢位線上方，若把下墜中的也算進去，
   * 連續投放會把寬限計時器自己填滿。使用者定案：必須「觸碰到其他方團團」才算入堆。
   * **One-way**: once true it never flips back. Overflow only counts piled bodies, because
   * **in-flight** dumplings must not raise the alarm — the drop point is above the overflow
   * line, so counting them would let rapid dropping fill the grace timer on its own. The
   * rule is the user's: only a dumpling that has touched another dumpling counts.
   */
  entered: boolean;
}

/** 一次待處理的合成；碰撞事件期間只收集，物理步結束後才真正執行。 */
interface PendingMerge {
  a: Entry;
  b: Entry;
  atMs: number;
}

export interface GameSessionOptions {
  config: AllConfig;
  /** 可注入的亂數來源；未提供時用固定種子以便重播。 */
  rng?: Rng;
  /** 覆寫亂數種子；只有未提供 `rng` 時有效。 */
  seed?: number;
  /** 初始虛擬寬度；之後由 `resize()` 更新。 */
  virtualWidth?: number;
  /** 虛擬高度；預設 1000。 */
  virtualHeight?: number;
  /**
   * 解鎖來源。未提供時**不套用**解鎖過濾、也不記錄解鎖（適合測試與無存檔的場合）。
   * The unlock source. When omitted, no gating and no unlock records happen.
   */
  unlocks?: UnlockSource;
  /**
   * 輪廓碰撞多邊形（依等級）。未提供時**一律用圓形**碰撞體 —— 測試與無素材的場合走這條。
   * Outline collision polygons by level. When omitted, **circles** are used throughout —
   * the path taken by tests and by any run without sprite assets.
   */
  silhouettes?: SilhouetteCache;
}

export class GameSession {
  private readonly config: AllConfig;
  private readonly physics: Physics;
  private readonly spawnQueue: SpawnQueue;
  private readonly levels: readonly LevelDef[];
  private readonly unlocks: UnlockSource | undefined;
  private readonly mergeCooldownMs: number;
  private readonly dropCooldownMs: number;
  private readonly silhouettes: SilhouetteCache | undefined;
  private readonly combo: ComboTracker;
  private readonly overflow: OverflowMonitor;

  private geometry: ContainerGeometry;
  private cavity: Rect;
  private wallBodies: Matter.Body[] = [];

  private entries: Entry[] = [];
  private readonly byBodyId = new Map<number, Entry>();
  /** 合成後播放彈跳動畫的剛體：body.id → 起始模擬毫秒。 */
  private readonly pops = new Map<number, number>();
  /** 碰撞事件收集到的合成，等物理步跑完才執行。 */
  private pendingMerges: PendingMerge[] = [];
  /** 取消碰撞訂閱；`destroy()` 用。 */
  private readonly unsubscribeCollisions: () => void;

  private virtualHeight: number;
  private aimX: number;
  private elapsedMs = 0;
  private scoreValue = 0;
  private mergedCountValue = 0;
  private over = false;

  /**
   * 最後一次投放的時刻；`-Infinity` 代表「還沒投過」，所以開局第一顆不受冷卻限制。
   * When the last drop happened; `-Infinity` means "never", so the opening drop is never
   * gated by the cooldown.
   */
  private lastDropAtMs = Number.NEGATIVE_INFINITY;

  /**
   * **本次投放**累積的分數，以及本次投放目前為止的合成次數。
   * The score earned **by this drop** so far, and how many merges it has produced.
   *
   * 這兩個數字就是 COMBO 卡要顯示的東西：大數字是本次投放的**合共得分**，下面一行是
   * 最近一次合成的加分與倍率。它們由 `drop()` 歸零，所以「本次投放」的邊界與連擊一致。
   * These are exactly what the COMBO card shows: the big number is this drop's **total
   * score** and the line below is the latest merge's gain and multiplier. `drop()` zeroes
   * them, so "this drop" spans the same window as the combo chain.
   */
  private dropScoreValue = 0;
  private dropMergeCountValue = 0;
  /** 最近一次合成的加分（未乘倍率前的等級分）與它拿到的倍率。 */
  private lastGainBase = 0;
  private lastGainMultiplier = 1;

  constructor(options: GameSessionOptions) {
    this.config = options.config;
    this.levels = options.config.levels.levels;
    this.unlocks = options.unlocks;
    this.silhouettes = options.silhouettes;
    this.virtualHeight = options.virtualHeight ?? 1000;
    this.mergeCooldownMs = Math.max(0, this.config.levels.settings.mergeCooldownMs);
    this.dropCooldownMs = Math.max(0, this.config.levels.settings.dropCooldownMs);

    this.physics = new Physics({ gravityY: this.config.levels.settings.gravityY });
    this.spawnQueue = new SpawnQueue({
      levels: this.levels,
      rng: options.rng ?? createRng(options.seed ?? 1),
      unlocked: this.unlocks?.unlocked,
    });
    this.combo = new ComboTracker();
    this.overflow = new OverflowMonitor(this.config.levels.settings.overflowGraceMs);

    /* 先建一次，讓 `aimX` 與牆壁在任何 resize 之前就有合法值。 */
    this.geometry = this.buildGeometry(options.virtualWidth ?? 500, this.virtualHeight);
    this.cavity = computeContainerBounds(this.geometry.frame, WALL_THICKNESS).cavity;
    this.aimX = this.cavity.x + this.cavity.width / 2;
    this.applyWalls();

    this.unsubscribeCollisions = this.physics.onCollisionStart(this.collectMerges);
  }

  /** 卸下碰撞訂閱；換局或卸載時呼叫，避免回呼指到已丟棄的 session。 */
  destroy(): void {
    this.unsubscribeCollisions();
  }

  /* ------------------------------------------------------------------ 幾何 */

  /** 目前的容器線框幾何；渲染器直接使用。 */
  get containerGeometry(): ContainerGeometry {
    return this.geometry;
  }

  /** 空腔邊界；除錯與測試用。 */
  get playArea(): Rect {
    return this.cavity;
  }

  /**
   * 溢位線的 Y（虛擬單位）：U 形**頂緣上方** `overflowAboveRim`。
   * The overflow line's Y: `overflowAboveRim` **above** the U's rim.
   */
  get overflowLineY(): number {
    return this.geometry.frame.y - Math.max(0, this.config.container.overflowAboveRim);
  }

  /**
   * 依新的虛擬尺寸重算幾何與牆壁。
   * Recompute geometry and walls for a new virtual size.
   *
   * **不動既有剛體的位置**：它們的座標本來就是虛擬單位，鎖虛擬高度下換裝置只改變可用
   * 寬度（design.md §2.4）。
   */
  resize(virtualWidth: number, virtualHeight: number): void {
    if (virtualWidth <= 0 || virtualHeight <= 0) return;

    this.virtualHeight = virtualHeight;
    this.geometry = this.buildGeometry(virtualWidth, virtualHeight);
    this.cavity = computeContainerBounds(this.geometry.frame, WALL_THICKNESS).cavity;
    this.applyWalls();
    this.aimX = this.clampAimX(this.aimX, this.pendingLevel().radius);
  }

  private buildGeometry(virtualWidth: number, virtualHeight: number): ContainerGeometry {
    return computeContainerGeometry(virtualWidth, virtualHeight, this.config.container);
  }

  /** 換掉牆壁：先移除舊的再加新的，避免 resize 後留下兩套重疊的牆。 */
  private applyWalls(): void {
    if (this.wallBodies.length > 0) {
      this.physics.remove(...this.wallBodies);
    }
    const bounds = computeContainerBounds(this.geometry.frame, WALL_THICKNESS);
    this.wallBodies = createContainerBodies(bounds.walls);
    this.physics.add(...this.wallBodies);
  }

  /* ------------------------------------------------------------------ 瞄準 */

  /** 目前瞄準的虛擬 X（已夾在投放範圍內）。 */
  get aimXValue(): number {
    return this.aimX;
  }

  /**
   * 投放高度（虛擬 Y）：U 形頂緣**上方** `dropAboveRim` 的位置。
   * Drop height (virtual Y): `dropAboveRim` **above** the U's rim.
   *
   * 由幾何推導而非另存一個常數，所以改 `container.json` 的 `topOffset` 或 `dropAboveRim`
   * 之後，投放線與預覽會自動跟著移動。
   */
  get spawnYValue(): number {
    return this.geometry.frame.y - Math.max(0, this.config.container.dropAboveRim);
  }

  /**
   * 設定瞄準位置。超出可用範圍時會夾到「方團團剛好貼牆」的位置。
   * Set the aim position, clamping so the dumpling just fits against the wall.
   */
  setAim(x: number): void {
    this.aimX = this.clampAimX(x, this.pendingLevel().radius);
  }

  /**
   * 把 X 夾到「容器左右邊緣各內縮 `spawnGap`，再各讓開一個半徑」的範圍。
   * Clamp X so the dumpling's outline stays `spawnGap` inside the container's left/right
   * edges, then a further radius in.
   *
   * **調參入口**：`spawnGap` 來自 `container.json`。想讓方團團緊貼牆的**內緣**（空腔），
   * 把下面的 `frame` 換成 `computeContainerBounds(...).cavity` 即可。
   */
  private clampAimX(x: number, radius: number): number {
    const gap = Math.max(0, this.config.container.spawnGap);
    const inset = gap + radius;
    const left = this.geometry.frame.x;
    const right = left + this.geometry.frame.width;
    const min = left + inset;
    const max = right - inset;

    /* 容器比直徑還窄時 min > max，此時置中比夾到某側合理。 */
    if (min > max) return left + this.geometry.frame.width / 2;

    return Math.min(Math.max(x, min), max);
  }

  /* ------------------------------------------------------------------ 投放 */

  /**
   * **馬上**要掉落的那顆等級編號（`spawnQueue.peekAt(0)`）。
   * The level that is about to drop.
   */
  get pendingLevelId(): number {
    return this.spawnQueue.peekAt(0);
  }

  /**
   * NEXT 卡要顯示的等級編號：**放下手上這顆之後**才會上場的那顆
   * （`spawnQueue.peekAt(1)`）。
   */
  get upcomingLevelId(): number {
    return this.spawnQueue.peekAt(1);
  }

  /** 馬上要掉落那顆的完整定義。 */
  pendingLevel(): LevelDef {
    return this.levelDef(this.pendingLevelId);
  }

  /** NEXT 卡那顆的完整定義。 */
  upcomingLevel(): LevelDef {
    return this.levelDef(this.upcomingLevelId);
  }

  /**
   * 投放一顆。座標取自目前瞄準位置，等級取自佇列最前面。
   * Drop one dumpling at the current aim position, using the front of the queue.
   *
   * 因為等級是 `take()` 出來的，**掉下來的必然就是 NEXT 卡顯示的那一顆**（D22）。
   * 這一局已結束（溢位逾時）時直接忽略，讓輸入層不必自己判斷遊戲狀態。
   *
   * **投放冷卻**：兩次投放至少相隔 `dropCooldownMs`，間隔內的呼叫直接回傳、不消耗佇列。
   * 這裡是唯一的閘門 —— 滑鼠、空白鍵、觸控都走同一條路，所以不可能出現「某個輸入管道
   * 繞過冷卻」的情況。
   * **Drop cooldown**: two drops must be `dropCooldownMs` apart; calls inside the gap return
   * without consuming the queue. This is the only gate — mouse, space bar and touch all come
   * through here, so no input path can bypass it.
   *
   * @returns 這次呼叫是否真的投下了一顆。
   */
  drop(): boolean {
    if (this.over) return false;
    if (!this.canDrop) return false;

    /*
     * 先 `take()` 再查定義：等級只讀一次，就不存在「peek 與 take 之間被換掉」的
     * 想像空間。掉下來的必然是最初預覽的那一顆。
     */
    const id = this.spawnQueue.take();
    const level = this.levelDef(id);
    const x = this.clampAimX(this.aimX, level.radius);
    const y = this.spawnYValue;

    const body = this.createBody(level, x, y, id);

    /*
     * 旋轉預設交給物理引擎（`settings.lockRotation = false`），只有配置要求直立時才把
     * 慣量鎖成無限大。
     */
    if (this.config.levels.settings.lockRotation) lockRotation(body);

    this.physics.add(body);
    this.addEntry({ body, level, bornAtMs: this.elapsedMs });

    /*
     * 開新一批：連擊歸零、本次投放的計分歸零。
     * 順序很重要 —— 先記時間再歸零，才不會把「這一顆」算進上一批的連擊。
     */
    this.lastDropAtMs = this.elapsedMs;
    this.combo.reset();
    this.dropScoreValue = 0;
    this.dropMergeCountValue = 0;
    this.lastGainBase = 0;
    this.lastGainMultiplier = 1;

    return true;
  }

  /**
   * 現在可以投放嗎（＝這一局還在進行，且已過投放冷卻）。
   * Whether a drop is accepted right now: the run is live and the cooldown has elapsed.
   *
   * 輸入層靠它決定要不要把點擊當成投放，HUD 也可以拿它顯示冷卻狀態。
   * The input layer uses this to decide whether a click counts as a drop, and the HUD can use
   * it to show the cooldown.
   */
  get canDrop(): boolean {
    if (this.over) return false;
    return this.elapsedMs - this.lastDropAtMs >= this.dropCooldownMs;
  }

  /**
   * 距離下一次可投放還剩多少毫秒；可以投放時為 0。
   * Milliseconds until the next drop is accepted, 0 when a drop is already allowed.
   */
  get dropCooldownRemainingMs(): number {
    if (this.over) return 0;
    return Math.max(0, this.dropCooldownMs - (this.elapsedMs - this.lastDropAtMs));
  }

  /**
   * 依等級建立剛體：**優先使用輪廓多邊形**，拿不到時退回圓形。
   * Build a body for a level: **prefer the outline polygon**, fall back to a circle.
   *
   * 兩條路徑共用同一份材質參數，所以退回圓形時手感仍由 `levels.json` 決定，不會因為形狀
   * 不同而換了一套摩擦與彈性。
   * Both paths share one material block, so the circle fallback still obeys `levels.json`
   * rather than silently swapping in a different friction and restitution.
   *
   * @param labelBodyId 標籤用的等級編號（除錯時看得出這顆是哪一級）。
   */
  private createBody(level: LevelDef, x: number, y: number, labelBodyId: number): Matter.Body {
    const material = {
      density: level.density,
      restitution: level.restitution,
      friction: level.friction,
      frictionAir: level.frictionAir,
      /* 標記起來，除錯時看得出這顆是哪一級。 */
      label: `level-${String(labelBodyId)}`,
    };

    const polygon = this.silhouettes?.get(level.id);
    if (polygon !== undefined && polygon !== null) {
      const body = createPolygonBody(x, y, polygon, material);
      /* 分解失敗（退化輪廓、引擎拒絕）時退回圓形，而不是把壞剛體丟進世界。 */
      if (body !== null) return body;
    }

    return createCircleBody(x, y, level.radius, material);
  }

  /* ------------------------------------------------------------------ 合成與入堆 */

  /**
   * 碰撞事件：標記「入堆」並收集合成候選。
   * Collision event: latch the piled flag and collect merge candidates.
   *
   * **入堆判定在使用者定案下是「接觸」而非「幾何」**：只要兩顆方團團發生碰撞，兩者都永久
   * 標記為已入堆；只有入堆的顆粒才納入溢位警戒（見 `game/overflow.ts`）。這正是「從頂部
   * 跌下的不應該觸發警戒，直至觸碰到其他方團團」那條規則的落點。
   * **The piled test is contact-based, per the user's decision**: any collision between two
   * dumplings latches both as piled, and only piled bodies feed overflow detection (see
   * `game/overflow.ts`). That is exactly the rule "a falling dumpling must not raise the
   * warning until it touches another dumpling".
   *
   * **合成只收集、不執行。** 在碰撞回呼裡新增／移除剛體等於在引擎解算途中改動世界；這裡把
   * 候選對記下來，等這一步的物理跑完再由 `flushMerges()` 一次處理。
   * **Merges collect only, never mutate.** Adding or removing bodies inside a collision
   * callback means editing the world mid-solve, so candidate pairs are recorded here and
   * applied by `flushMerges()` once the step has finished.
   *
   * 入堆標記則是**惰性可變**的（只把一個布林設為真），不牽動世界，所以可以就地做。
   * The piled latch is inert — it only flips a boolean and never touches the world — so it is
   * safe to apply inline.
   *
   * 同一次碰撞可能連續觸發多場合併，所以用 `claimed` 確保一顆只參與一次；同一物理步的
   * 多場合併共用同一個 `elapsedMs`，`ComboTracker` 因此會把它們算成同一批。
   */
  private readonly collectMerges = (pairs: readonly Matter.Pair[]): void => {
    if (this.over) return;

    const atMs = this.elapsedMs;
    const claimed = new Set<number>();

    for (const pair of pairs) {
      /*
       * 一定要走 `resolveEntry()`：輪廓碰撞體是**複合剛體**（`Bodies.fromVertices` 分解出的
       * 多個凸塊），碰撞事件給的是**子塊**而子塊有各自的 `id`，直接查 `byBodyId` 會全部 miss
       * —— 那會讓輪廓化的方團團永遠不入堆、也永遠不合成，而且沒有任何錯誤訊息。
       * Always resolve through `resolveEntry()`: an outline collider is a **compound body**
       * (several convex pieces from `Bodies.fromVertices`) and collision events carry the
       * **child parts**, which have their own ids. A direct `byBodyId` lookup would miss every
       * one of them — outline dumplings would never join the pile and never merge, with no
       * error anywhere.
       */
      const a = this.resolveEntry(pair.bodyA);
      const b = this.resolveEntry(pair.bodyB);

      /* 只有「兩顆都是方團團」的碰撞才算入堆；撞牆、撞地板不計。 */
      if (a === undefined || b === undefined || a === b) continue;

      a.entered = true;
      b.entered = true;

      if (claimed.has(a.body.id) || claimed.has(b.body.id)) continue;
      if (mergeResultId(a.level, b.level) === null) continue;
      /* 剛生成（投下或剛合成）的方團團先冷卻一下，避免鏈式合成一次跑完。 */
      if (atMs - a.bornAtMs < this.mergeCooldownMs) continue;
      if (atMs - b.bornAtMs < this.mergeCooldownMs) continue;

      claimed.add(a.body.id);
      claimed.add(b.body.id);
      this.pendingMerges.push({ a, b, atMs });
    }
  };

  /**
   * 把碰撞事件裡的剛體（可能是一個**子塊**）解析回它所屬的方團團。
   * Resolve a body from a collision event — possibly a **child part** — back to its entry.
   *
   * 複合剛體（輪廓碰撞體）在碰撞事件中是以子塊身分出現，子塊的 `id` 與父剛體不同，因此
   * 先看它有沒有 `parent`，有就沿著父層查。圓形剛體沒有 `parent`，會直接命中，所以兩條
   * 路徑共用這一個函式。
   * A compound body (outline collider) appears in collision events as a child part whose `id`
   * differs from the parent's. The lookup therefore follows `parent` when present. Circle
   * bodies have no `parent` and hit the map directly, so both paths share this one function.
   */
  private resolveEntry(body: Matter.Body): Entry | undefined {
    const direct = this.byBodyId.get(body.id);
    if (direct !== undefined) return direct;

    /* `parent` 在型別上是可選的；子塊一定有，父剛體則沒有（或指向自己）。 */
    const parent: Matter.Body | undefined = body.parent;
    if (parent !== undefined && parent !== body) return this.byBodyId.get(parent.id);

    return undefined;
  }

  /**
   * 執行在收集階段排定的合成。
   * Apply the merges queued during collection.
   *
   * 逐對重新確認「兩顆都還在場上」：同一批裡若有 A+B 與 A+C，A 只能被用掉一次。
   */
  private flushMerges(): void {
    if (this.pendingMerges.length === 0) return;

    const queue = this.pendingMerges;
    this.pendingMerges = [];

    for (const { a, b, atMs } of queue) {
      if (!this.byBodyId.has(a.body.id) || !this.byBodyId.has(b.body.id)) continue;
      this.merge(a, b, atMs);
    }
  }

  /**
   * 把兩顆合成一顆：移除原本兩顆，在質心生成下一級，加分並記錄連擊。
   * Merge two into one: remove both, spawn the next level at their midpoint, score it, and
   * register the combo.
   */
  private merge(a: Entry, b: Entry, atMs: number): void {
    const resultId = mergeResultId(a.level, b.level);
    /* 呼叫端已檢查過；這裡再確認一次是為了讓型別收窄，也讓這個方法自己站得住。 */
    if (resultId === null) return;

    const level = this.levelDef(resultId);
    const x = (a.body.position.x + b.body.position.x) / 2;
    const y = (a.body.position.y + b.body.position.y) / 2;

    this.removeEntry(a);
    this.removeEntry(b);
    this.physics.remove(a.body, b.body);

    const body = this.createBody(level, x, y, level.id);
    if (this.config.levels.settings.lockRotation) lockRotation(body);

    this.physics.add(body);
    this.addEntry({ body, level, bornAtMs: atMs });

    /* 彈跳動畫：新生成的那顆從峰值縮回原尺寸。 */
    this.pops.set(body.id, atMs);

    this.mergedCountValue += 1;

    /*
     * 連擊：一次投放裡的第 n 場合併拿 ×n（`COMBO_LADDER`）。倍率由 tracker 算，這裡只管
     * 把它乘上等級分數 —— 「第幾次拿幾倍」的規則全在 `game/combo.ts`，可以在單元測試裡
     * 逐條釘住。
     * Combo: the nth merge inside one drop takes ×n. The tracker owns the ladder; this only
     * multiplies the level score by it, so "which merge gets which multiplier" stays in
     * `game/combo.ts` where it can be pinned down test by test.
     */
    const snapshot = this.combo.record();
    const gain = level.score * snapshot.multiplier;

    this.scoreValue += gain;

    /* 本次投放的計分：大數字（合共）與下面一行（最近一次）都從這裡來。 */
    this.dropScoreValue += gain;
    this.dropMergeCountValue += 1;
    this.lastGainBase = level.score;
    this.lastGainMultiplier = snapshot.multiplier;

    this.registerUnlock(level.id);
  }

  /** 依世代註冊解鎖；成功時刷新生成池，讓新等級也能被抽到。 */
  private registerUnlock(levelId: number): void {
    if (this.unlocks === undefined) return;
    if (!this.unlocks.unlock(levelId)) return;

    /*
     * `unlocked` 是同一份活集合（`ProgressStore` 就地 mutate），所以這裡傳進去的參考
     * 已經包含剛解鎖的等級。
     */
    this.spawnQueue.setUnlocked(this.unlocks.unlocked);
  }

  /* ------------------------------------------------------------------ 推進 */

  /**
   * 前進一步物理：推進時鐘、跑物理、套用合成、回收離場剛體、更新溢位。
   * Advance one step: tick the clock, run physics, apply merges, recycle lost bodies, and
   * update overflow.
   *
   * 時鐘**先**加再跑物理，所以碰撞回呼看到的 `elapsedMs` 就是這一步的時刻 —— 同一物理步
   * 的多場合併因此共用時間戳，連擊才判得成「同一批」。
   */
  step(deltaMs: number): void {
    const dt = Math.max(0, deltaMs);
    this.elapsedMs += dt;

    this.physics.step(dt);
    this.flushMerges();
    this.prunePops();
    this.recycle();
    this.updateOverflow(dt);
  }

  /** 移除已經播完的彈跳動畫，避免 Map 隨局數無限長大。 */
  private prunePops(): void {
    for (const [id, startMs] of this.pops) {
      if (this.elapsedMs - startMs >= POP_ANIMATION_MS) this.pops.delete(id);
    }
  }

  private recycle(): void {
    const floor = this.geometry.frame.y + this.geometry.frame.height;
    const survivors: Entry[] = [];
    const removed: Matter.Body[] = [];

    for (const entry of this.entries) {
      const { y } = entry.body.position;
      const gone = y > floor + FALL_OUT_MARGIN || y < this.geometry.frame.y - FALL_OUT_MARGIN;

      if (gone) removed.push(entry.body);
      else survivors.push(entry);
    }

    if (removed.length === 0) return;

    this.physics.remove(...removed);
    for (const body of removed) {
      this.byBodyId.delete(body.id);
      this.pops.delete(body.id);
    }
    this.entries = survivors;
  }

  /**
   * 溢位判定：只要有一顆**已入堆**的方團團上緣越線就開始倒數，全部退回就立刻歸零。
   * Overflow: the countdown starts as soon as a **piled** dumpling's top edge crosses the
   * line, and snaps back to zero once nothing is above it.
   *
   * `entered` 的標記不在這裡做 —— 它由碰撞事件（`collectMerges`）標記，因為規則是「觸碰
   * 到其他方團團才算入堆」，那是接觸資訊，幾何看不出來。
   * The `entered` latch is **not** set here: it comes from collision events
   * (`collectMerges`), because "piled" is defined by contact, which geometry cannot see.
   */
  private updateOverflow(dt: number): void {
    if (this.over) return;

    const bodies = this.entries.map((entry) => ({
      id: entry.body.id,
      x: entry.body.position.x,
      y: entry.body.position.y,
      radius: entry.level.radius,
      entered: entry.entered,
    }));

    this.overflow.update(dt, bodies, this.overflowLineY);

    if (this.overflow.isOver) this.over = true;
  }

  /* ------------------------------------------------------------------ 開新局 */

  /**
   * 清空這一局並重設所有單局狀態，**保留解鎖與最高分**。
   * Clear the board and reset per-run state, **keeping unlocks and the high score**.
   *
   * 解鎖屬於 meta-progression（D5），不隨新局重設；這裡只碰「這一局的東西」。
   */
  reset(): void {
    this.physics.removeDynamicBodies();
    this.entries = [];
    this.byBodyId.clear();
    this.pops.clear();
    this.pendingMerges = [];
    this.combo.reset();
    this.overflow.reset();
    this.scoreValue = 0;
    this.mergedCountValue = 0;
    this.over = false;
    this.elapsedMs = 0;
    /*
     * 冷卻時間也歸零：新的一局第一顆不該被上一局的投放時間擋住。
     * The cooldown resets too, so a new run's opening drop is never blocked by the previous
     * run's last drop.
     */
    this.lastDropAtMs = Number.NEGATIVE_INFINITY;
    this.dropScoreValue = 0;
    this.dropMergeCountValue = 0;
    this.lastGainBase = 0;
    this.lastGainMultiplier = 1;
    this.spawnQueue.reset();
    this.aimX = this.clampAimX(this.aimX, this.pendingLevel().radius);
  }

  /* ------------------------------------------------------------------ 輸出 */

  /** 場上所有方團團的畫面資料（含彈跳縮放）。 */
  get bodies(): RenderBody[] {
    return this.entries.map((entry) => ({
      levelId: entry.level.id,
      x: entry.body.position.x,
      y: entry.body.position.y,
      radius: entry.level.radius,
      angle: entry.body.angle,
      scale: this.popScale(entry.body.id),
    }));
  }

  /**
   * 彈跳縮放：動畫期間從 `POP_PEAK_SCALE` 緩出回到 1。
   * Pop scale: eases from `POP_PEAK_SCALE` back to 1 during the animation.
   */
  private popScale(bodyId: number): number {
    const startMs = this.pops.get(bodyId);
    if (startMs === undefined || POP_ANIMATION_MS <= 0) return 1;

    const t = Math.min(1, Math.max(0, (this.elapsedMs - startMs) / POP_ANIMATION_MS));
    const eased = (1 - t) * (1 - t);

    return 1 + (POP_PEAK_SCALE - 1) * eased;
  }

  /** 投放預覽；`spawnYValue` 就是預覽圓心的高度。 */
  get aimPreview(): RenderAim {
    const level = this.pendingLevel();

    return {
      levelId: level.id,
      x: this.clampAimX(this.aimX, level.radius),
      y: this.spawnYValue,
      radius: level.radius,
    };
  }

  /** 已投放的顆數（＝目前在場上的顆數）。 */
  get dropCount(): number {
    return this.entries.length;
  }

  /** 目前分數（合成後等級的 `score` × 當下連擊倍率，累加後取整）。 */
  get score(): number {
    return Math.round(this.scoreValue);
  }

  /** 累計合成次數。 */
  get mergedCount(): number {
    return this.mergedCountValue;
  }

  /**
   * **本次投放**已經合成過幾次。投放時歸零。
   * How many merges **this drop** has produced; zeroed on each drop.
   */
  get comboCount(): number {
    return this.combo.count;
  }

  /**
   * **本次投放**累積的總分（每次合成各自乘上它的階梯倍率後相加）。
   * The total score **this drop** has earned, each merge multiplied by its own ladder step.
   *
   * 這是 COMBO 卡的大數字：使用者定案「展示本次投放合共賺了多少分」。
   * This is the COMBO card's big number — the user's "how much this drop earned in total".
   */
  get dropScore(): number {
    return Math.round(this.dropScoreValue);
  }

  /** 本次投放計分的原始值（未取整）；測試用。 */
  get dropScoreRaw(): number {
    return this.dropScoreValue;
  }

  /**
   * 最近一次合成的「加分 + 倍率」，例如 `{ base: 8, multiplier: 2, gain: 16 }`。
   * The latest merge's gain and multiplier, e.g. `{ base: 8, multiplier: 2, gain: 16 }`.
   *
   * `base` 是等級分數（未乘倍率），`gain` 是實際加進去的分數。HUD 用它渲染
   * `+16 (×2.0)` 這一行。
   * `base` is the level score before the multiplier and `gain` is what was actually added;
   * the HUD renders the `+16 (×2.0)` line from it.
   */
  get lastMergeGain(): { base: number; multiplier: number; gain: number } {
    return {
      base: this.lastGainBase,
      multiplier: this.lastGainMultiplier,
      gain: Math.round(this.lastGainBase * this.lastGainMultiplier),
    };
  }

  /** 本次投放已合成的次數；與 `comboCount` 同義，但語意上強調「本次投放」。 */
  get dropMergeCount(): number {
    return this.dropMergeCountValue;
  }

  /** 溢位寬限的進度 `0..1`；給 UI 顯示倒數。 */
  get overflowProgress(): number {
    return this.overflow.progress;
  }

  /**
   * 溢位警戒是否**已經起算**（＝越線而且停定了）。
   * Whether the overflow warning has actually **started**, i.e. the breach has settled.
   *
   * 畫面靠它決定要不要亮紅線與倒數：還在動的越線完全不出現提示（使用者定案）。
   * The view uses this to decide whether to show the line and countdown: a breach that is
   * still moving shows nothing at all (the user's decision).
   */
  get overflowSettled(): boolean {
    return !this.over && this.overflow.settled;
  }

  /** 溢位倒數剩餘秒數（整數，1 起跳）；未起算時為 0。 */
  get overflowSecondsLeft(): number {
    return this.overflow.settled ? this.overflow.remainingSeconds : 0;
  }

  /** 這一步是否處於「已越線且已停定」的危險狀態。 */
  get overflowDanger(): boolean {
    return !this.over && this.overflow.settled;
  }

  /** 這一局是否已結束（溢位逾時）。 */
  get isOver(): boolean {
    return this.over;
  }

  /** 目前的模擬時刻，毫秒。 */
  get elapsed(): number {
    return this.elapsedMs;
  }

  /** 目前虛擬高度。 */
  get virtualHeightValue(): number {
    return this.virtualHeight;
  }

  /* ------------------------------------------------------------------ 內部 */

  /**
   * 把一顆方團團登記進這一局。`entered` 一律從 `false` 起算 —— 剛生成的顆粒還沒碰到任何
   * 東西，要等它真的落到堆疊上（發生碰撞）才由 `collectMerges` 標記為入堆。
   * Register a dumpling. `entered` always starts `false`: a fresh dumpling has not touched
   * anything yet, and only becomes piled once it collides, when `collectMerges` latches it.
   */
  private addEntry(entry: Omit<Entry, 'entered'>): void {
    const full: Entry = { ...entry, entered: false };

    this.entries.push(full);
    this.byBodyId.set(full.body.id, full);
  }

  private removeEntry(entry: Entry): void {
    this.byBodyId.delete(entry.body.id);
    this.pops.delete(entry.body.id);
    const index = this.entries.indexOf(entry);
    if (index >= 0) this.entries.splice(index, 1);
  }

  /* 依等級編號取回定義；編號來自佇列或合成表，必然存在，所以找不到就代表有真 bug。 */
  private levelDef(id: number): LevelDef {
    const level = this.levels.find((entry) => entry.id === id);

    if (level === undefined) {
      throw new Error(`Level ${String(id)} is missing from the level table.`);
    }

    return level;
  }
}
