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
import {
  createCircleBody,
  createPolygonBody,
  createStaticRect,
  lockRotation,
  Physics,
  pushBody,
} from '../core/physics';
import {
  CEILING_THICKNESS,
  FLOAT_OVERFLOW_BUFFER_MS,
  MERGE_OUTLINE_GAP,
  MERGE_PUSH_FACTOR,
  MERGE_PUSH_MAX_DEPTH,
  MERGE_PUSH_SPEED,
  MERGE_SETTLE_MAX_DROP,
  POP_ANIMATION_MS,
  POP_PEAK_SCALE,
  SHAKE_BODY_ACCEL_COUPLING,
  SHAKE_MAX_BODY_SPEED,
  WALL_THICKNESS,
} from '../core/constants';
import { computeContainerBounds, computeWallOverhang, createContainerBodies } from './containerBox';
import { ComboTracker } from './combo';
import { mergeResultId } from './merge';
import { boundsOf, circleMass, distanceToSupport, inheritMomentum } from './mergeSettle';
import { outlinePenetration, outlinesWithinReach, toWorldPolygon } from './outlineProximity';
import { OverflowMonitor } from './overflow';
import { createSkills, type BoardTarget, type FloatRequest, type ShakeRequest, type SkillBoard } from './skills';
import type { Skill } from './skills';
import { SpResource } from './sp';
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

/**
 * 點選目標的容差係數：命中範圍 ＝ 碰撞半徑 × 這個值。
 * The pick tolerance: the hit area is the collision radius times this factor.
 *
 * 大於 1 是因為玩家看到的是方形 sprite 加裝飾（比碰撞圓稍大），半徑乘 1.15 讓「看起來點到了」
 * 與「真的點到了」盡量一致，同時不會大到誤選隔壁那顆。
 * Above 1 because the player sees a square sprite with decorations (slightly larger than the
 * collision circle); 1.15 keeps "it looked like a hit" and "it was a hit" in step without
 * straying so far that the neighbour gets picked instead.
 */
const HIT_SLACK = 1.15;

/**
 * 浮動追趕帶：顆粒的**上緣**仍比技能天花板低這麼多時，每步被強制維持一個最低上升速度
 * （見 `applyFloatCatchup()`）。帶寬取一次身位，讓顆粒在貼住天花板前先失去追趕速度，
 * 不會對平面抖動。
 * The float catch-up band: a body whose **top edge** is still this far below the skill ceiling is
 * forced to keep a minimum upward speed each step (see `applyFloatCatchup()`). One body-height of
 * band lets a body shed the catch-up just before settling on the plane, so it never jitters against
 * it.
 */
const FLOAT_CATCHUP_BAND = 40;

/**
 * 浮動追趕的最低上升速度基準，虛擬單位／步。
 * The baseline minimum upward speed for a float catch-up, in virtual units per step.
 *
 * 翻轉重力只能「推」整堆向上，力得靠接觸一顆傳一顆；輪廓多邊形偶爾在角落被卡住，或被鄰居
 * 的接觸抵住，求解器每步把向上的力抵消掉，畫面上就是「完全沒動」。位置式的速度地板繞過接觸
 * 鏈：只要還在帶下方，就直接把垂直速度設成至少 `-riseSpeed`，每步都重新設，被鄰居擋住的顆粒
 * 會像棘輪一樣一格格被推上去，直到進帶為止 —— 「整堆都升上去」由機制保證。
 * Flipping gravity only *pushes* the pile; the force travels body to body. With outline polygons a
 * body occasionally wedges in a corner, or is braced by a neighbour, and the solver cancels the
 * upward force every step — on screen it reads as "completely motionless". A positional velocity
 * floor bypasses the contact chain: any body still below the band has its vertical velocity forced
 * to at least `-riseSpeed` every step, so a wedged body ratchets upward past its neighbours until
 * it enters the band — "the whole pile rises" is guaranteed by mechanism, not luck.
 *
 * 實際速度再乘 `catchupFactor`：預設 2 即每步至少升 `4 × 2 = 8` 虛擬單位（容器高約 700，
 * 1.5 秒浮動足足跨越），調大 `catchupFactor` 就追得更快。
 * The actual speed is multiplied by `catchupFactor`: the default 2 forces at least `4 × 2 = 8`
 * units/step (a ~700 unit container is crossed comfortably within the 1.5 s float), and a larger
 * `catchupFactor` chases faster.
 */
const FLOAT_CATCHUP_RISE_SPEED = 4;

/**
 * 天花板每步夾回的穿透餘裕，虛擬單位。
 * The per-step ceiling containment's penetration slack, in virtual units.
 *
 * 貼住平面的顆粒允許有少許求解器穿透（這是 Matter 的正常現象，硬夾會抖）；但穿透超過這個
 * 餘裕——多半是被下面的堆疊像擠西瓜籽一樣往上擠——就立刻被壓回平面下方。餘裕取小於
 * 溢位測試的 5 單位容忍，寧可早夾。
 * A body resting on the plane is allowed the solver's normal sliver of penetration (clamping it
 * hard would jitter); past this slack — usually because the pile below is squeezing it upward
 * like a watermelon seed — it is pressed straight back under the plane. Smaller than the 5-unit
 * tolerance the overflow test uses; clamp early rather than late.
 */
const CEILING_CONTAIN_SLACK = 4;

/**
 * 技能結束、天花板收走之後的「落底協助」時長與最低下沉速度。
 * How long after a skill tears the ceiling down the fall-back assist lasts, and the minimum
 * sink speed it enforces.
 *
 * 浮動／搖晃把整堆壓在平面上，收走平面之後，貼着側牆的小顆粒可能與大顆粒、牆壁之間架起
 * 摩擦拱——光靠重力鬆不開，畫面上就是「小隻卡在頂部邊界，要靠其他大隻施力才慢慢下來」。
 * 收走後的短暫窗口內，容器上半的每顆顆粒都被保證一個最低下沉速度，把拱直接拉垮。
 * Float and shake press the whole pile against the plane; once it is torn down, a small body
 * near the wall can be bridged into a friction arch between a big neighbour and the wall —
 * gravity alone cannot open it, which reads as "the small one is stuck at the top boundary and
 * only comes down when the big ones push it". For a short window after the teardown every body
 * in the container's upper half is guaranteed a minimum sink speed, collapsing the arch.
 */
const CEILING_RELEASE_ASSIST_MS = 600;
const CEILING_RELEASE_SINK = 2.2;

/** 技能卡要顯示的狀態（給 `ui/skillBar.ts`）。 */
export interface SkillCardState {
  id: string;
  name: string;
  /** 消耗技力；0 ＝ 免費。 */
  cost: number;
  targeting: 'user_pick' | 'immediate';
  /** 需要點選幾顆。 */
  pickCount: number;
  /** 現在可不可以按（技力夠／累計消耗夠）。 */
  unlocked: boolean;
  /** 解鎖進度 `0..1`，供遮罩顯示還差多少。 */
  progress: number;
  /**
   * 這個技能靠什麼解鎖。`sp` ＝ 技力足夠；`cumulativeSpent` ＝ 累計消耗達標（免費技能）。
   * What gates this skill: `sp` (enough SP) or `cumulativeSpent` (a free skill whose running
   * total must reach a threshold).
   *
   * UI 靠它決定徽章要顯示什麼：收費技能顯示消耗數字，累計型顯示 `n/m` 進度。
   * The UI uses it to decide the badge: a paid skill shows its cost, a cumulative one shows
   * `n/m` progress.
   */
  unlockKind: 'sp' | 'cumulativeSpent';
  /** 累計消耗型：當前累計值（分子 `n`）；其餘為 0。 */
  cumulativeSpent: number;
  /** 累計消耗型：解鎖門檻（分母 `m`）；其餘為 0。 */
  unlockThreshold: number;
  /** 這個技能是否正在選取中。 */
  active: boolean;
  /** 選取中已經點了幾顆。 */
  selectedCount: number;
}

/** 把內部項目轉成技能看得懂的目標（只暴露它需要的欄位）。 */
function toBoardTarget(entry: Entry): BoardTarget {
  return {
    id: entry.body.id,
    levelId: entry.level.id,
    x: entry.body.position.x,
    y: entry.body.position.y,
    radius: entry.level.radius,
  };
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

export class GameSession implements SkillBoard {
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

  /* ---------------------------------------------------------------- 技力與技能 */
  /** 技力資源（累積、扣費、臨時上限）。 */
  private readonly sp: SpResource;
  /** 技能清單，順序由 `configLoader` 排好（前三個收費、免費技能殿後）。 */
  private readonly skills: readonly Skill[];
  private readonly skillsById: ReadonlyMap<string, Skill>;
  /**
   * 選取中的技能（＝玩家已按下、正在等點目標）。`null` ＝ 不在選取模式。
   * The skill being targeted — pressed and waiting for picks. `null` means not selecting.
   */
  private activeSkill: Skill | null = null;
  /** 已點選的目標 id，依點選順序。 */
  private selectedIds: number[] = [];
  /** 浮動：開始時刻與時長；`durationMs <= 0` ＝ 不在浮動。 */
  private floatStartedAtMs = 0;
  private floatDurationMs = 0;
  /** 浮動追趕倍率（`FloatRequest.catchupFactor`），0 ＝ 關閉。 */
  private floatCatchupFactor = 0;
  private floatLiftFactor = 0;
  /**
   * 浮動天花板那片**隱形靜態平面**；不在浮動時為 `null`。
   * The invisible static plane that is the float's ceiling; `null` whenever nothing floats.
   *
   * 使用者定案「警戒區下方加一片透明的平面 border」：有了實體接觸面，顆粒是**撞到**才停，
   * 而不是被每步傳送回線下 —— 前者會自然疊成「壓在杯蓋下」的形狀，後者會抖。
   * The user's decision: "add a transparent plane border below the warning zone". With a real
   * contact surface the bodies **hit** the ceiling rather than being teleported back under it
   * every step — the former stacks them naturally under a lid, the latter jitters.
   */
  private ceilingBody: Matter.Body | null = null;
  /**
   * 天花板收走後「落底協助」的截止時刻；0 ＝ 沒有窗口。
   * When the post-teardown fall-back assist ends; 0 means no window.
   */
  private ceilingReleaseUntilMs = 0;
  /** 搖晃：開始時刻、時長、圈數、幅度（世界單位）、擺動軸傾角（弧度）與持續向上力比例。 */
  private shakeStartedAtMs = 0;
  private shakeDurationMs = 0;
  private shakeRevolutions = 0;
  private shakeRadius = 0;
  private shakeAxisTiltRad = 0;
  private shakeUpwardFactor = 0;
  /** 目前的容器位移（虛擬單位）；畫與牆都用它。 */
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  /** 已經套到牆上的位移，用來只搬動差量。 */
  private appliedShakeX = 0;
  private appliedShakeY = 0;
  /** 目前寫進引擎的重力（浮動時會變成負值）。 */
  private appliedGravityY: number;
  /** 溢位暫停到這個時刻為止（浮動期間 ＋ 結束後緩衝）。 */
  private overflowPauseUntilMs = 0;

  private geometry: ContainerGeometry;
  private cavity: Rect;
  private wallBodies: Matter.Body[] = [];

  private entries: Entry[] = [];
  private readonly byBodyId = new Map<number, Entry>();
  /** 合成後播放彈跳動畫的剛體：body.id → 起始模擬毫秒。 */
  private readonly pops = new Map<number, number>();
  /** 碰撞事件收集到的合成，等物理步跑完才執行。 */
  private pendingMerges: PendingMerge[] = [];
  /**
   * 本次物理步已經被配走的剛體 id。碰撞路徑（`collectMerges`）與近接掃描
   * （`collectProximityMerges`）**共用同一個集合**，所以一顆每步最多只參與一次合成 ——
   * 兩條路徑先後執行時不會把同一顆配給兩對。
   * Body ids already paired in this physics step. The collision path (`collectMerges`) and the
   * proximity sweep (`collectProximityMerges`) **share this one set**, so a body joins at most
   * one merge per step no matter which path finds it first.
   *
   * 每步在 `step()` 開頭清空；`collectMerges` 由碰撞事件在物理步**之中**回呼，所以清空
   * 必須早於 `physics.step()`。
   * Cleared at the top of `step()`; `collectMerges` is called back by the engine *during*
   * `physics.step()`, so the clear has to happen before it.
   */
  private stepClaimed = new Set<number>();
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
   * **本次投放**累積的分數。串長與倍率由 `combo` 直接提供，不另記一份，以免兩個
   * 計數器各說各話。
   * The score earned **by this drop**. The chain length and multiplier come straight from
   * `combo` rather than a second counter that could disagree with it.
   *
   * 它由 `drop()` 歸零，所以「本次投放」的邊界與連擊一致。
   * `drop()` zeroes it, so "this drop" spans the same window as the combo chain.
   */
  private dropScoreValue = 0;

  /**
   * **本次投放**已經合成過幾次。這是連勝中斷的**唯一**判準：`drop()` 會先看這個值，
   * 只有「上一顆什麼都沒合成」才把 `combo` 歸零。
   * How many merges **this drop** has made. This is the sole signal for breaking a streak:
   * `drop()` reads it and resets `combo` only when the previous drop merged nothing.
   *
   * 必須由 `merge()` 加、由 `drop()` 讀再清 —— 順序反了會把「這顆自己的合成」也算進
   * 「上一顆的成績」，等於自己中斷自己。
   * `merge()` must increment it and `drop()` must read-then-clear it; clearing first would let
   * a drop count its own merges as the previous drop's record and break itself.
   */
  private dropMergeCountValue = 0;

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

    /* 技力與技能：技力是一局之內的資源，技能實作由 JSON 決定。 */
    this.sp = new SpResource({ ...this.config.skills.sp });
    this.skills = createSkills(this.config.skills.skills);
    this.skillsById = new Map(this.skills.map((skill) => [skill.id, skill]));
    this.appliedGravityY = this.config.levels.settings.gravityY;

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

  /**
   * 目前的容器線框幾何；渲染器直接使用。
   * The current container geometry, consumed directly by the renderer.
   *
   * 搖晃期間會疊上位移：容器（連同溢位線、警戒區）整體沿斜線晃動，而方團團留在世界座標系
   * —— 因此畫面上看到的是「容器在動、球被晃到」，而不是「整張圖平移」。
   * During a shake the offset is folded in: the container — along with the overflow line and the
   * warning zone — slides along the tilted line, while the dumplings stay in world coordinates.
   * On screen that reads as "the container is moving and the balls get rattled", not as "the
   * whole picture slid".
   *
   * **只動 `frame`，`display` 不動。** 裁切範圍若跟着晃，貼在另一側牆邊的方團團就會被切掉
   * 半邊；`display` 固定為外框＋左右餘裕（見 `ContainerGeometry`），所以一顆都切不到，
   * 而搖晃幅度本身也被夾在那個餘裕內，容器邊線同樣不會被畫布切到。
   * **Only `frame` moves; `display` does not.** A clip region that shook along would slice the
   * wall-hugging dumplings on the opposite side. `display` stays at the box plus both margins
   * (see `ContainerGeometry`), so nothing is cut — and the shake amplitude is itself clamped
   * inside that margin, so the outline is never cut by the canvas either.
   */
  get containerGeometry(): ContainerGeometry {
    if (this.shakeOffsetX === 0 && this.shakeOffsetY === 0) return this.geometry;

    return {
      ...this.geometry,
      frame: {
        ...this.geometry.frame,
        x: this.geometry.frame.x + this.shakeOffsetX,
        y: this.geometry.frame.y + this.shakeOffsetY,
      },
    };
  }

  /** 空腔邊界；除錯與測試用。 */
  get playArea(): Rect {
    return this.cavity;
  }

  /**
   * 溢位線的 Y（虛擬單位）：U 形**頂緣上方** `overflowAboveRim`。
   * The overflow line's Y: `overflowAboveRim` **above** the U's rim.
   *
   * 用 `containerGeometry` 而非 `geometry`，所以搖晃時它跟著容器走 —— 這條線是容器的一部分。
   * Uses `containerGeometry` rather than `geometry` so it travels with the container during a
   * shake; the line is part of the container.
   */
  get overflowLineY(): number {
    return this.containerGeometry.frame.y - Math.max(0, this.config.container.overflowAboveRim);
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

  /**
   * 換掉牆壁：先移除舊的再加新的，避免 resize 後留下兩套重疊的牆。
   * Replace the walls: remove the old set before adding the new one, so a resize never leaves
   * two overlapping sets behind.
   *
   * 牆高由 `computeWallOverhang()` 依**容器頂緣、投放點與溢位線**推導，而不是用一個寫死的
   * 常數 —— 這樣改 `container.json` 的 `topOffset` / `dropAboveRim` / `overflowAboveRim`
   * 之後，牆會自動跟著長高，不會出現「投放點跑到牆頂之上」這種縫隙。
   * The wall height comes from `computeWallOverhang()`, derived from the **rim, the drop point
   * and the overflow line** rather than a hardcoded constant, so changing `topOffset`,
   * `dropAboveRim` or `overflowAboveRim` in `container.json` grows the walls on its own and no
   * gap can open up above the drop point.
   */
  private applyWalls(): void {
    if (this.wallBodies.length > 0) {
      this.physics.remove(...this.wallBodies);
    }

    const overhang = computeWallOverhang(
      this.geometry.frame.y,
      this.spawnYValue,
      this.overflowLineY,
    );
    const bounds = computeContainerBounds(this.geometry.frame, WALL_THICKNESS, overhang);

    this.wallBodies = createContainerBodies(bounds.walls);
    this.physics.add(...this.wallBodies);

    /*
     * 牆是全新的，位置就是基準位置，所以「已套用的晃動位移」要歸零 —— 否則下一步會拿舊的
     * 位移去算差量，把牆多推一次。
     * The walls are brand new and sit at their base positions, so the "already applied shake
     * offset" must reset; otherwise the next step computes a delta against a stale value and
     * shoves them twice.
     */
    this.appliedShakeX = 0;
    this.appliedShakeY = 0;
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
     * 連勝（streak）：**上一顆什麼都沒合成才中斷**。
     *
     * 使用者定案「在下一次投放前，若果這次投放沒有做成 combo，則重新由 0 開始」——
     * 所以這裡的判準是「上一顆有沒有合成」，不是「有沒有投放」。上一顆有合成，串長就
     * 跨投放累積下去，倍率繼續往上爬。
     *
     * 順序：先讀 `dropMergeCountValue`（上一顆的成績），再歸零（這顆從空白開始）。
     * 反過來寫會讓這顆自己中斷自己。
     *
     * Streak: **the chain breaks only when the previous drop merged nothing.**
     *
     * The user's rule is "before the next drop, if this drop made no combo, restart from 0" —
     * so the signal is "did the previous drop merge", not "was a drop made". A previous drop
     * with merges carries the chain across drops and the multiplier keeps climbing.
     *
     * Order: read `dropMergeCountValue` (the previous drop's record) *before* zeroing it (this
     * drop starts blank). Clearing first would let a drop break its own streak.
     */
    this.lastDropAtMs = this.elapsedMs;
    if (this.dropMergeCountValue === 0) this.combo.reset();
    this.dropMergeCountValue = 0;
    this.dropScoreValue = 0;

    /*
     * 技力來源之一是**投放**（使用者定案：每投放一次 +0.05），不是合成。掛在這裡而不是
     * 合成處，是因為「投放」的定義就是這一支成功跑完 —— 冷卻中被擋掉的呼叫不會走到這裡。
     * One source of SP is the **drop** itself (the user's decision: +0.05 per drop), not merging.
     * It hangs here rather than on the merge path because "a drop happened" is exactly this
     * method completing successfully; calls blocked by the cooldown never reach it.
     */
    this.sp.gainForDrop();

    return true;
  }

  /**
   * 現在可以投放嗎（＝這一局還在進行、沒有技能在作用、且已過投放冷卻）。
   * Whether a drop is accepted right now: the run is live, no skill is acting, and the cooldown
   * has elapsed.
   *
   * **技能作用期間禁止投放**（使用者定案）：浮動與搖晃的持續時間內、以及選取目標的等待期間，
   * 一併擋掉。這條規則在**這一處**成立，所以滑鼠、鍵盤、觸控都不可能繞過它。
   * **Dropping is blocked while a skill acts** (the user's decision): during a float or a shake,
   * and while a target selection is pending. The rule lives in **this one place**, so no input
   * path — mouse, keyboard or touch — can bypass it.
   *
   * 輸入層靠它決定要不要把點擊當成投放，HUD 也可以拿它顯示冷卻狀態。
   * The input layer uses this to decide whether a click counts as a drop, and the HUD can use
   * it to show the cooldown.
   */
  get canDrop(): boolean {
    if (this.over) return false;
    if (this.isSkillBusy) return false;
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

  /* ---------------------------------------------------------------- 技力 */

  /** 目前技力值（可為小數）。 */
  get spValue(): number {
    return this.sp.current;
  }

  /** 目前技力上限（考慮臨時覆寫）。 */
  get spMax(): number {
    return this.sp.max;
  }

  /** 技力填充比例 `0..1`。 */
  get spRatio(): number {
    return this.sp.ratio;
  }

  /** 這一局累計消耗的技力量（累計消耗型技能的進度來源）。 */
  get spCumulativeSpent(): number {
    return this.sp.cumulativeSpent;
  }

  /**
   * 臨時把技力上限改成指定值（技能滿足條件時使用）；傳 `null` 還原。
   * Temporarily substitute the SP cap (used when a skill's condition holds); `null` restores it.
   */
  setSpMaxOverride(value: number | null): void {
    this.sp.setMaxOverride(value);
  }

  /* ---------------------------------------------------------------- 技能 */

  /** 這一局可用的技能卡狀態（給技能欄 UI）。 */
  get skillCards(): readonly SkillCardState[] {
    return this.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      cost: skill.cost,
      targeting: skill.targeting,
      pickCount: skill.pickCount,
      unlocked: this.isUnlocked(skill),
      progress: this.unlockProgress(skill),
      unlockKind: skill.unlock.kind,
      cumulativeSpent: skill.unlock.kind === 'cumulativeSpent' ? this.sp.cumulativeSpent : 0,
      unlockThreshold: skill.unlock.kind === 'cumulativeSpent' ? skill.unlock.threshold : 0,
      active: this.activeSkill === skill,
      selectedCount: this.activeSkill === skill ? this.selectedIds.length : 0,
    }));
  }

  /**
   * 技能是否正在**佔用棋盤**：選取中等候點目標，或浮動／搖晃尚未結束。
   * Whether a skill currently **owns the board**: a selection is pending, or a float / shake is
   * still running.
   *
   * 這正是「技能作用期間禁止投放」的判準，也是 UI 決定要不要把畫布切成「選球模式」的依據。
   * This is the predicate behind "no dropping while a skill acts", and what the UI uses to decide
   * whether the canvas is in "pick a dumpling" mode.
   */
  get isSkillBusy(): boolean {
    return this.activeSkill !== null || this.isFloating || this.isShaking;
  }

  /** 是否正在選取目標（等待玩家點球）。 */
  get isSelecting(): boolean {
    return this.activeSkill !== null && this.activeSkill.requiresTargets;
  }

  /** 選取狀態：正在選的技能與已點選的目標 id，供畫面標示「」。 */
  get skillSelection(): { skillId: string; pickedIds: readonly number[] } | null {
    if (this.activeSkill === null) return null;
    return { skillId: this.activeSkill.id, pickedIds: this.selectedIds };
  }

  /**
   * 按下技能格。需要選目標的技能會進入選取模式；即時技能立刻生效。
   * Press a skill slot. A targeting skill enters selection mode; an immediate skill fires at once.
   *
   * @returns 這次按下是否被接受（進入選取或已生效）。
   */
  activateSkill(id: string): boolean {
    if (this.over) return false;

    /*
     * 再按同一個技能鍵 ＝ 取消（design.md §5.5）。這個判斷必須排在「技能忙碌中就拒絕」之前，
     * 否則選取模式一開，同一個鍵就再也按不動，玩家只能靠 Esc 或點空白處退出。
     * Pressing the same slot again cancels (design.md §5.5). This check must come **before** the
     * "busy means refuse" guard, or entering selection mode would lock the very button that opened
     * it and the player could only leave via Esc or empty space.
     */
    if (this.activeSkill !== null && this.activeSkill.id === id) {
      this.cancelSkill();
      return true;
    }

    if (this.isSkillBusy) return false;

    const skill = this.skillsById.get(id);
    if (skill === undefined) return false;
    if (!this.isUnlocked(skill)) return false;

    /*
     * 場上沒有方團團時任何技能都沒有意義（浮動／搖晃沒有對象、當棄即棄沒有目標），
     * 所以一律不受理 —— 免得白白扣掉技力。
     * With an empty board no skill means anything (nothing to float, shake or discard), so every
     * one of them is refused rather than silently charging SP for nothing.
     */
    if (this.entries.length === 0) return false;

    if (skill.requiresTargets) {
      this.activeSkill = skill;
      this.selectedIds = [];
      return true;
    }

    this.castSkill(skill, []);
    return true;
  }

  /** 取消選取（再按同一技能鍵／按 Esc／點空白處）。選取中不扣技力，取消也不退。 */
  cancelSkill(): void {
    this.activeSkill = null;
    this.selectedIds = [];
  }

  /**
   * 畫布上的一次點擊：選取模式中就是選目標，否則就是投放。
   * One canvas tap: pick a target while selecting, otherwise drop.
   *
   * 由輸入層呼叫，是「點擊要當成選球還是投放」的**唯一**分岔點。
   * Called by the input layer; this is the **only** fork between "pick" and "drop".
   */
  canvasPointerAction(x: number, y: number): void {
    if (this.isSelecting) {
      this.pickTargetAt(x, y);
      return;
    }

    this.drop();
  }

  /**
   * 點選一顆方團團。點到第 `pickCount` 顆就立刻生效。
   * Pick a dumpling; once `pickCount` targets are in hand the skill fires immediately.
   *
   * 取消規則（design.md §5.5）：點空白處或再點同一顆都視為取消。
   * Cancelling (design.md §5.5): tapping empty space, or tapping the same body twice, cancels.
   */
  pickTargetAt(x: number, y: number): void {
    const skill = this.activeSkill;
    if (skill === null || !skill.requiresTargets) return;

    const hit = this.hitTest(x, y);

    if (hit === null) {
      this.cancelSkill();
      return;
    }

    if (this.selectedIds.includes(hit.body.id)) {
      this.cancelSkill();
      return;
    }

    this.selectedIds.push(hit.body.id);
    if (this.selectedIds.length < skill.pickCount) return;

    const picks = this.selectedIds
      .map((id) => this.entryByBodyId(id))
      .filter((entry): entry is Entry => entry !== undefined)
      .map((entry) => toBoardTarget(entry));

    this.castSkill(skill, picks);
  }

  /**
   * 執行技能：**先扣費，成功才作用**。扣費時機是「效果成功執行時」—— 選取中不扣、取消不退。
   * Cast a skill: **charge first, act only if the charge succeeds**. Charging happens when the
   * effect actually runs — selecting costs nothing and cancelling refunds nothing.
   */
  private castSkill(skill: Skill, targets: readonly BoardTarget[]): void {
    if (!this.sp.spend(skill.cost)) return;

    skill.apply(this, targets);

    /*
     * 以累計消耗解鎖的免費技能（命運互換）用掉之後，累計歸零 → 重新上鎖（使用者定案）。
     * A free skill gated by cumulative spend (fate swap) resets the running total once used, so
     * it locks again (the user's decision).
     */
    if (skill.unlock.kind === 'cumulativeSpent') this.sp.resetSpent();

    this.activeSkill = null;
    this.selectedIds = [];
  }

  /** 這個技能現在可不可以按。 */
  private isUnlocked(skill: Skill): boolean {
    if (skill.unlock.kind === 'cumulativeSpent') {
      return this.sp.cumulativeSpent + 1e-9 >= skill.unlock.threshold;
    }
    return this.sp.canAfford(skill.cost);
  }

  /** 解鎖進度 `0..1`，給技能卡的遮罩顯示「還差多少」。 */
  private unlockProgress(skill: Skill): number {
    if (skill.unlock.kind === 'cumulativeSpent') {
      const threshold = skill.unlock.threshold;
      if (threshold <= 0) return 1;
      return Math.min(1, this.sp.cumulativeSpent / threshold);
    }
    if (skill.cost <= 0) return 1;
    return Math.min(1, this.sp.current / skill.cost);
  }

  /**
   * 找出點擊位置下的方團團：取**圓心最近**且在容差內的那一顆。
   * Find the dumpling under a tap: the one whose centre is **closest** within tolerance.
   *
   * 容差用碰撞半徑（乘一個寬容係數），因為玩家看到的是方形 sprite 加裝飾；用圓心有系統性
   * 偏差，用矩形又會漏掉圓角處的點擊。
   * Tolerance is the collision radius times a slack factor: the player sees a square sprite with
   * decorations, so a pure centre-radius test feels biased and a bounding box would miss taps on
   * the rounded corners.
   */
  private hitTest(x: number, y: number): Entry | null {
    let best: Entry | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const entry of this.entries) {
      const dx = entry.body.position.x - x;
      const dy = entry.body.position.y - y;
      const distance = Math.hypot(dx, dy);
      const reach = entry.level.radius * HIT_SLACK;

      if (distance > reach) continue;
      if (distance >= bestDistance) continue;

      best = entry;
      bestDistance = distance;
    }

    return best;
  }

  private entryByBodyId(id: number): Entry | undefined {
    return this.byBodyId.get(id);
  }

  /* ---------------------------------------------------------------- SkillBoard */

  /** 場上所有可被選取的方團團（`SkillBoard` 的視角）。 */
  get targets(): readonly BoardTarget[] {
    return this.entries.map((entry) => toBoardTarget(entry));
  }

  /** 容器寬度（搖晃半徑的基準）。 */
  get containerWidth(): number {
    return this.geometry.frame.width;
  }

  /** 移除一顆方團團（「當棄即棄！」）。 */
  removeTarget(id: number): boolean {
    const entry = this.byBodyId.get(id);
    if (entry === undefined) return false;

    this.removeEntry(entry);
    this.physics.remove(entry.body);

    /*
     * **叫醒其餘全部**，這是「上面的方團團會掉下來」的全部關鍵。
     *
     * Matter 開了休眠（`ENGINE_ENABLE_SLEEPING`），而引擎對休眠剛體是**完全跳過**的：
     * `Engine._bodiesApplyGravity` 與 `Engine._bodiesUpdate` 都 `if (body.isSleeping) continue;`。
     * 更糟的是 `Sleeping.afterCollisions` 只會在「撞到一顆 motion 夠大的移動物體」時喚醒，
     * 移除支撐**不產生任何碰撞事件**，所以那一疊永遠醒不過來、就懸在半空。
     * **Wake everything else** — this is the whole reason "the dumplings above fall down".
     * Matter runs with sleeping on, and the engine **skips** sleeping bodies outright:
     * `Engine._bodiesApplyGravity` and `Engine._bodiesUpdate` both `continue` on `isSleeping`,
     * and `Sleeping.afterCollisions` only wakes a body when it is hit by a body moving fast
     * enough. Removing a support produces no collision at all, so the stack above never wakes
     * and hangs in mid-air.
     *
     * 代價是 O(n) 一次（n 是場上顆粒數，幾十），可忽略 —— 遠比每顆掛一個每幀觸發的
     * listener 便宜，而且後者根本修不好這個問題。
     * The cost is one O(n) pass (n is a few dozen), which is negligible — far cheaper than
     * attaching a per-frame listener to every body, which would not fix this anyway.
     */
    this.wakeAll();
    return true;
  }

  /**
   * 交換兩顆方團團的位置，並對周邊施加擾動（「命運互換」）。
   * Swap two dumplings and disturb the neighbourhood (fate swap).
   *
   * 位置與速度**一起**交換：只換位置的話，兩顆會立刻往原本的慣性跑回去，看起來像沒換成功。
   * Position and velocity are swapped **together**: swapping only positions makes both bodies
   * immediately drift back along their old momentum, which reads as "the swap failed".
   */
  /**
   * 把一個目的點夾回空腔內（邊界內縮一個碰撞半徑）。
   * Clamp a destination point back inside the cavity, inset by one collider radius.
   *
   * 互換是 `Body.setPosition` 的瞬間傳送：把大顆粒傳進小顆原本貼牆的位置，大顆的碰撞體會
   * **深深插進牆裡**，求解器把它往最近的出口擠 —— 就是「對調後穿過邊界」的由來。夾制保證
   * 傳送落點的整個包絡圓都在空腔內，牆永遠不會被插進去；與鄰居的重疊則交給求解器在腔內
   * 正常推開（那本來就是互換擾動的一部分）。
   * A swap is an instant `Body.setPosition` teleport: sending a big body into a small body's
   * wall-hugging spot buries the big collider **deep inside the wall**, and the solver ejects it
   * through the nearest face — exactly the "swapped through the boundary" report. The clamp
   * keeps the whole bounding circle of the landing spot inside the cavity, so a wall can never
   * be entered in the first place; overlap with neighbours is left to the solver to resolve
   * inside the cavity (that is part of the swap's disturbance anyway).
   */
  private clampIntoCavity(radius: number, position: { x: number; y: number }): {
    x: number;
    y: number;
  } {
    const r = Math.max(0, radius);
    return {
      x: Math.min(Math.max(position.x, this.cavity.x + r), this.cavity.x + this.cavity.width - r),
      y: Math.min(Math.max(position.y, this.cavity.y + r), this.cavity.y + this.cavity.height - r),
    };
  }

  swapTargets(a: number, b: number, disturbance: number): void {
    const first = this.byBodyId.get(a);
    const second = this.byBodyId.get(b);
    if (first === undefined || second === undefined || first === second) return;

    const firstPosition = { x: first.body.position.x, y: first.body.position.y };
    const secondPosition = { x: second.body.position.x, y: second.body.position.y };
    const firstVelocity = { x: first.body.velocity.x, y: first.body.velocity.y };
    const secondVelocity = { x: second.body.velocity.x, y: second.body.velocity.y };

    /* 目的地各自按**抵達那顆**的半徑夾回空腔 —— 半徑不同時大顆不會被塞進貼牆的小位。 */
    Matter.Body.setPosition(
      first.body,
      this.clampIntoCavity(first.level.radius, secondPosition),
    );
    Matter.Body.setPosition(
      second.body,
      this.clampIntoCavity(second.level.radius, firstPosition),
    );
    Matter.Body.setVelocity(first.body, secondVelocity);
    Matter.Body.setVelocity(second.body, firstVelocity);

    /*
     * 被交換的兩顆與被推到的鄰居都必須是醒的：`Body.setPosition`／`setVelocity` 不會改變
     * `isSleeping`，而引擎跳過休眠剛體，所以不叫醒它們的話，這次互換在畫面上等於沒發生。
     * **在擾動 early-return 之前叫**：擾動為 0 也是一次真正的互換，一樣要叫醒。
     * The two swapped bodies and whoever they landed on must all be awake: `setPosition` /
     * `setVelocity` do not clear `isSleeping`, and the engine skips sleeping bodies, so without
     * this the swap would be invisible. **Called before the disturbance early-return**: a swap
     * with zero disturbance is still a real swap and still needs the wake-up.
     */
    this.wakeAll();

    if (disturbance <= 0) return;

    /*
     * 周邊擾動：把壓在兩個新位置上的鄰居推開（原位置忽然空出、新位置忽然擠進，兩邊都會
     * 產生重疊）。用與合成推力同一套「沿連心線推」的處理，行為一致。
     * Neighbour disturbance: shove whoever the two new positions landed on. The old spots opened
     * up and the new ones squeeze into overlapping bodies, so the same "push along the centre line"
     * routine the merge push uses keeps the behaviour consistent.
     */
    for (const entry of this.entries) {
      if (entry === first || entry === second) continue;

      for (const moved of [first, second]) {
        const dx = entry.body.position.x - moved.body.position.x;
        const dy = entry.body.position.y - moved.body.position.y;
        const distance = Math.hypot(dx, dy);
        const reach = entry.level.radius + moved.level.radius;

        if (distance >= reach) continue;

        if (distance === 0) {
          pushBody(entry.body, 1, 0, 0, disturbance);
        } else {
          pushBody(entry.body, dx / distance, dy / distance, 0, disturbance);
        }
        break;
      }
    }
  }

  /**
   * 讓**每一顆**方團團向上浮起（「協議：浮動」），以警戒區下方的隱形平面為天花板。
   * Float **every** dumpling, with an invisible plane below the warning zone as the ceiling.
   *
   * 使用者定案：「像杯口被壓住」—— 誰都不可以升到溢位線。實作有三部分：
   * 1. 重力翻成向上的淨加速度（`liftFactor` 倍重力），見 `applyFloatGravity()`；
   * 2. 一片**隱形靜態平面**擋在 `floatCeilingBelowRim` 的深度上（見 `syncCeiling()`；這片平面與
   *    搖晃！共用）；
   * 3. 浮動期間每步叫醒全部顆粒（見 `step()`）—— 少了這一步，只有剛動過的顆粒會浮，
   *    因為休眠剛體收不到重力（`Engine._bodiesApplyGravity` 會跳過它們）。
   * The user's decision: "like a lid pressed on a cup" — nothing may rise into the overflow line.
   * Three parts: (1) gravity flipped into a net upward acceleration (`liftFactor` times gravity,
   * see `applyFloatGravity()`); (2) an **invisible static plane** parked at `floatCeilingBelowRim`
   * (see `syncCeiling()`; the plate is shared with Shake!); (3) waking every body each step while
   * afloat (see `step()`) — without that last part only the recently-moved bodies would rise,
   * because sleeping bodies receive no gravity (`Engine._bodiesApplyGravity` skips them).
   */
  floatAll(request: FloatRequest): void {
    this.floatStartedAtMs = this.elapsedMs;
    this.floatDurationMs = Math.max(0, request.durationMs);
    this.floatLiftFactor = Math.max(0, request.liftFactor);
    this.floatCatchupFactor = Math.max(0, request.catchupFactor ?? 0);

    /*
     * 浮動期間（以及結束後的緩衝）完全不計算溢位：浮起來本來就會逼近警戒線，若照常計時，
     * 這個技能等於自殺。（使用者定案：結束後 0.5 秒緩衝再恢復計算。）
     * Overflow is not evaluated at all while floating (nor for the buffer afterwards): floating
     * necessarily approaches the warning line, so counting normally would make the skill
     * self-defeating. (The user's decision: a 0.5 s buffer before evaluation resumes.)
     */
    this.overflowPauseUntilMs = this.elapsedMs + this.floatDurationMs + FLOAT_OVERFLOW_BUFFER_MS;

    /*
     * 先把**已經在天花板之上**的顆粒壓回平面下方，再放上平面。順序反過來的話，那幾顆會
     * 卡在平面內部，被求解器往最近的出口擠 —— 而最短路徑往往是「往上」，等於被彈出容器。
     * Press anything **already above the ceiling** back under the plane *before* installing it.
     * The other order leaves those bodies inside the plane, and the solver pushes them out of the
     * nearest face — usually the top, i.e. straight out of the container.
     */
    this.clampCeiling();
    this.syncCeiling();
  }

  /**
   * 震動容器（「搖晃！」）：改成**地震** —— 容器沿一條斜線往復，顆粒也被真的甩動。
   * Shake the container — as an **earthquake**: it oscillates along a tilted line, and the
   * dumplings are genuinely thrown around.
   *
   * 使用者 2026-10-06 定案：不再是順時針圓周晃動，改成水平地震，但擺動軸斜 15°、另加 10%
   * 的持續向上力。幅度以容器寬度為基準，但**再被展示餘裕夾一次**（見下）。
   * The user's 2026-10-06 decision: no more clockwise orbit — a horizontal quake, but with the
   * oscillation axis tilted 15° and an extra steady 10% upward force. The amplitude is relative to
   * the container width, then **clamped again by the display margin** (see below).
   *
   * **牆只是畫面**：把牆搬來搬去並不會讓顆粒跟着動 —— 牆是靜態剛體，`Body.translate` 不帶
   * 速度，而且 `Sleeping.afterCollisions` 對「靜態 vs 休眠」直接 `continue`，所以牆掃過去
   * 也叫不醒它們。真正讓顆粒動起來的是 `applyShakeImpulse()`（對每顆施加慣性力）。
   * **The walls are only the picture**: moving them does not move the dumplings — they are static
   * bodies, `Body.translate` carries no velocity, and `Sleeping.afterCollisions` `continue`s
   * outright for "static vs sleeping", so a sweeping wall cannot even wake them. What actually
   * moves the pile is `applyShakeImpulse()`.
   *
   * **幅度必須塞得進展示餘裕。** 容器左右各只有 `leftOffset` / `rightOffset` 的活動空間
   * （見 `ContainerConfig`），超過就會被畫布切掉邊線。所以水平峰值位移被夾在兩側餘裕的
   * 較小值內：`shakeRadius × cos(傾角) ≤ min(left, right)`。想搖得更遠就調大餘裕，而不是
   * 讓容器被切一半。傾角 90°（純垂直）時水平位移本來就是 0，此時不設限。
   * **The amplitude has to fit the display margin.** The container only has `leftOffset` /
   * `rightOffset` of room to move (see `ContainerConfig`), and overshooting it means the canvas
   * slices its outline. The peak horizontal displacement is therefore clamped inside the smaller
   * of the two margins: `shakeRadius × cos(tilt) ≤ min(left, right)`. To shake further, widen the
   * margin rather than letting the box get cut in half. At a 90° tilt (pure vertical) the
   * horizontal displacement is zero anyway, so no limit applies.
   */
  shakeContainer(request: ShakeRequest): void {
    this.shakeStartedAtMs = this.elapsedMs;
    this.shakeDurationMs = Math.max(1, request.durationMs);
    this.shakeRevolutions = Math.max(1, request.revolutions);
    this.shakeAxisTiltRad = (Math.max(0, request.axisTiltDeg) * Math.PI) / 180;
    this.shakeUpwardFactor = Math.max(0, request.upwardFactor);

    const requestedRadius = Math.max(0, request.radiusFactor) * this.geometry.frame.width;
    const horizontal = Math.abs(Math.cos(this.shakeAxisTiltRad));
    const margin = Math.min(this.displayMargin.left, this.displayMargin.right);
    const fit = horizontal > 1e-6 ? margin / horizontal : Number.POSITIVE_INFINITY;

    this.shakeRadius = Math.min(requestedRadius, fit);

    /*
     * 一樣要叫醒：睡着的顆粒既收不到重力也不吃衝量，整箱會像沒被搖到。
     * 另外先把衝到天花板之上的顆粒壓回平面下方，再讓平面接手（理由與 `floatAll()` 相同：
     * 平面是「加進世界」的，搶先佔位的顆粒會被求解器從最近的出口擠出去）。
     * Wake everything too: a sleeping body receives neither gravity nor an impulse, so the box
     * would look untouched. Anything already above the ceiling is pressed back under it first,
     * for the same reason as in `floatAll()`: installing a plane is not the same as stopping
     * bodies that were already above it, and those get squeezed out of its nearest face.
     */
    this.wakeAll();
    this.clampCeiling();
    this.syncCeiling();
  }

  /** 是否正在浮動。 */
  get isFloating(): boolean {
    return this.floatDurationMs > 0 && this.elapsedMs < this.floatStartedAtMs + this.floatDurationMs;
  }

  /** 是否正在搖晃。 */
  get isShaking(): boolean {
    return this.shakeDurationMs > 0 && this.elapsedMs < this.shakeStartedAtMs + this.shakeDurationMs;
  }

  /**
   * 更新搖晃位移：沿**與水平成 `axisTiltDeg` 的斜線**往復（地震），不再繞圈。
   * Update the shake offset: it oscillates along a **line `axisTiltDeg` above the horizontal**
   * (an earthquake), instead of going round in circles.
   *
   * 用正弦包絡（`sin(πt)`）讓幅度從 0 起、回到 0 —— 容器不會在技能開始或結束的瞬間「跳」
   * 一下。位移只影響**畫面與牆**；顆粒的受力在 `applyShakeImpulse()`。
   * A sine envelope (`sin(πt)`) ramps the amplitude from 0 and back to 0, so the container never
   * jumps at the start or the end. This offset only drives **the picture and the walls**; the
   * forces on the bodies live in `applyShakeImpulse()`.
   */
  private updateShakeOffset(): void {
    if (!this.isShaking) {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      return;
    }

    const t = (this.elapsedMs - this.shakeStartedAtMs) / this.shakeDurationMs;
    const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const phase = 2 * Math.PI * this.shakeRevolutions * t;
    const swing = Math.sin(phase) * envelope * this.shakeRadius;

    /*
     * 沿斜線分解：水平吃 cos、垂直吃 sin，垂直取負號代表「往上」。
     * Resolve along the tilted axis: the horizontal takes cos, the vertical sin, and the negative
     * sign means "upward".
     */
    this.shakeOffsetX = Math.cos(this.shakeAxisTiltRad) * swing;
    this.shakeOffsetY = -Math.sin(this.shakeAxisTiltRad) * swing;
  }

  /**
   * 搖晃時對**每一顆**方團團施加慣性力（地震的本體）。
   * Apply the inertial force to **every** dumpling while the shake runs — the earthquake proper.
   *
   * 站在震動地面上的物體，感受到的是與地面**相同的加速度**；容器位移是
   * `A·sin(ωt)`（`A` ＝ `shakeRadius`，`ω` ＝ 圈數換算的角頻率），所以加速度是
   * `−A·ω²·sin(ωt)`。這裡把它換算成「每步的速度增量」：Matter 的速度是**每步位移**，
   * 因此 `Δv = a · Δt²`（`a` 為每毫秒平方的加速度）。再乘上一個手感耦合係數
   * （`SHAKE_BODY_ACCEL_COUPLING`），否則全量耦合會把整箱甩飛。
   * A body on shaking ground feels the **same acceleration** as the ground. The container's
   * displacement is `A·sin(ωt)` (`A` = `shakeRadius`, `ω` from the cycle count), so its
   * acceleration is `−A·ω²·sin(ωt)`. That becomes a per-step velocity increment here: Matter's
   * velocity is displacement **per step**, so `Δv = a · Δt²` for an acceleration `a` in units per
   * ms². A feel coupling (`SHAKE_BODY_ACCEL_COUPLING`) scales it down; full coupling flings the
   * whole box.
   *
   * 垂直方向有兩份：傾角帶來的**交替**上下（與水平反相），以及一個固定的向上托力
   * （`upwardFactor` × 水平衝量峰值，使用者定案 10%）。
   * The vertical has two parts: the alternation that comes from the tilt (out of phase with the
   * horizontal), and a constant upward bias (`upwardFactor` × the peak horizontal impulse — the
   * user's 10%).
   *
   * @param deltaMs 這一步的毫秒數 / This step's duration in ms.
   */
  private applyShakeImpulse(deltaMs: number): void {
    if (!this.isShaking) return;

    /* 施力前必須先醒：休眠剛體既收不到重力，也不會被衝量推走。 */
    this.wakeAll();

    const elapsed = this.elapsedMs - this.shakeStartedAtMs;
    const t = elapsed / this.shakeDurationMs;
    const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    const omega = (2 * Math.PI * this.shakeRevolutions) / this.shakeDurationMs;
    const dt = Math.max(0, deltaMs);

    const peak = this.shakeRadius * omega * omega * dt * dt * SHAKE_BODY_ACCEL_COUPLING;
    const impulse = peak * envelope * Math.sin(omega * elapsed);

    const dvx = impulse * Math.cos(this.shakeAxisTiltRad);
    const dvy =
      -impulse * Math.sin(this.shakeAxisTiltRad) - peak * envelope * this.shakeUpwardFactor;

    for (const entry of this.entries) {
      const { x, y } = entry.body.velocity;
      Matter.Body.setVelocity(entry.body, { x: x + dvx, y: y + dvy });
    }
  }

  /**
   * 叫醒場上所有方團團。
   * Wake every dumpling on the board.
   *
   * Matter 開了休眠，而引擎對休眠剛體是**完全跳過**的（`_bodiesApplyGravity`、
   * `_bodiesUpdate`），而且 `Sleeping.afterCollisions` 只認「被移動物體撞到」——
   * 靜態牆移動、支撐被移除、重力改變都不會喚醒任何東西。所以「技能生效後物理要跟上」的
   * 唯一做法就是在技能碰到棋盤時把全部叫醒。O(n) 一次，n 是幾十。
   * Matter runs with sleeping on and the engine **skips** sleeping bodies entirely
   * (`_bodiesApplyGravity`, `_bodiesUpdate`), while `Sleeping.afterCollisions` only recognises
   * "hit by a moving body" — a static wall sliding, a support being removed, or gravity changing
   * wakes nothing. So the only way for physics to follow a skill is to wake everything the moment
   * the skill touches the board. One O(n) pass, n in the tens.
   */
  private wakeAll(): void {
    for (const entry of this.entries) Matter.Sleeping.set(entry.body, false);
  }

  /** 把位移差量套到牆上（牆是靜態剛體，只有位置要搬）。 */
  private applyShakeToWalls(): void {
    const dx = this.shakeOffsetX - this.appliedShakeX;
    const dy = this.shakeOffsetY - this.appliedShakeY;
    if (dx === 0 && dy === 0) return;

    for (const wall of this.wallBodies) Matter.Body.translate(wall, { x: dx, y: dy });

    this.appliedShakeX = this.shakeOffsetX;
    this.appliedShakeY = this.shakeOffsetY;
  }

  /**
   * 依浮動狀態設定重力：浮動時翻成向上的淨加速度，其餘時候還原。
   * Set gravity from the float state: flipped to a net upward acceleration while floating,
   * restored otherwise.
   */
  private applyFloatGravity(): void {
    const base = this.config.levels.settings.gravityY;
    const desired = this.isFloating ? base * (1 - this.floatLiftFactor) : base;

    if (desired === this.appliedGravityY) return;
    this.physics.setGravity(desired);
    this.appliedGravityY = desired;
  }

  /**
   * 浮動追趕：仍落在天花板帶下方的顆粒，每步被強制維持一個最低上升速度（`catchupFactor`
   * 倍 `FLOAT_CATCHUP_RISE_SPEED`）。
   * Float catch-up: any body still below the ceiling band is forced to keep a minimum upward speed
   * (`catchupFactor` times `FLOAT_CATCHUP_RISE_SPEED`) every step.
   *
   * 翻轉重力只能「推」整堆向上，力得靠接觸一顆傳一顆。輪廓多邊形（帶耳朵的不規則形狀）偶爾
   * 有一顆在角落被卡住，或被鄰居的接觸抵住，求解器每步把向上的力抵消掉，1.5 秒走不完全程，
   * 畫面上就是「大家都貼住天花板了，就它還在地板上完全沒動」。位置式的速度地板繞過接觸鏈：
   * 只要還在帶下方，就直接把垂直速度設成至少 `-riseSpeed`，每步重設，被擋住的顆粒像棘輪一樣
   * 一格格被推上去，直到進帶為止 —— 「整堆都升上去」由機制保證，而不是靠調強度碰運氣。
   * Flipping gravity only *pushes* the pile; the force travels body to body through contacts. With
   * outline polygons (irregular shapes with ears) a body occasionally wedges in a corner or is
   * braced by a neighbour, and the solver cancels the upward force every step, so it never finishes
   * the trip in 1.5 s — on screen it reads as "everyone is on the ceiling except this one, frozen
   * on the floor". A positional velocity floor bypasses the contact chain: any body still below the
   * band has its vertical velocity forced to at least `-riseSpeed` every step, so a blocked body
   * ratchets up past its neighbours until it enters the band — "the whole pile rises" is guaranteed
   * by mechanism, not by luck with strength tuning.
   */
  private applyFloatCatchup(): void {
    if (!this.isFloating || this.floatCatchupFactor <= 0) return;

    const ceilingY = this.ceilingY;
    const bandBottom = ceilingY + FLOAT_CATCHUP_BAND;
    const riseSpeed = FLOAT_CATCHUP_RISE_SPEED * this.floatCatchupFactor;

    for (const entry of this.entries) {
      const body = entry.body;
      /* 上緣仍低於帶底 ＝ 還沒抵達天花板，補一把最低上升速度。 */
      if (body.position.y - entry.level.radius <= bandBottom) continue;

      /* 叫醒：syncCeiling 每步已叫醒一次，這裡再補一道，確保這一步的速度會被積分。 */
      if (body.isSleeping) Matter.Sleeping.set(body, false);

      /*
       * 速度地板：只在「向上速度還不夠快」時設。已經升得比這更快的顆粒（包含被浮動帶著跑的
       * 整堆）維持原速，只有落後的才被拉到最低速度 —— 被鄰居擋住的顆粒每步都被重新推一把，
       * 棘輪式地升上去，不會卡死在地板。
       * Velocity floor: only set when the body is not already rising fast enough. Bodies already
       * rising faster (including the pile carried by the float) keep their speed; only laggards are
       * pulled up to the minimum, so a wedged body is re-pushed every step and ratchets up instead
       * of freezing on the floor.
       */
      if (body.velocity.y > -riseSpeed) {
        Matter.Body.setVelocity(body, { x: body.velocity.x, y: -riseSpeed });
      }
    }
  }

  /**
   * 天花板每步夾回：穿透超過餘裕的顆粒立刻被壓回平面下方。
   * Per-step ceiling containment: any body that has penetrated past the slack is pressed
   * straight back under the plane.
   *
   * 施放那一刻的 `clampCeiling()` 只跑一次，之後靠靜態平面擋住；但浮動時整堆被追趕速度地板
   * 從下面頂住平面，最輕的顆粒可能被擠進平面（西瓜籽效應）。這裡每步巡一次，誰的上緣鑽進
   * 平面超過 `CEILING_CONTAIN_SLACK`，就傳送回「上緣貼住平面」並歸零向上速度 —— 「沒有任何
   * 顆粒能浮到容器口之外」由機制保證，而不是指望求解器每次都站對邊。
   * The cast-time `clampCeiling()` runs once; the static plane takes over from there. But during
   * a float the whole pile is rammed against the plane from below by the catch-up velocity
   * floor, and the lightest body can be squeezed into it (the watermelon-seed effect). This
   * sweep runs every step: any body whose top edge has tunnelled more than
   * `CEILING_CONTAIN_SLACK` into the plane is teleported back to "top edge touching the plane"
   * with its upward velocity cancelled — "nothing can float outside the container mouth" is
   * guaranteed by mechanism rather than by trusting the solver to pick the right side every
   * time.
   *
   * 在 `physics.step()` **之後**跑：穿透是求解器在這一步裡造成的，當步就壓回，畫面上不會
   * 出現「冒出頭」的一幀。
   * It runs **after** `physics.step()`: the penetration is produced by the solver within that
   * step, so correcting in the same step keeps an escaping head from ever being drawn.
   */
  private containAtCeiling(): void {
    if (!this.ceilingNeeded) return;

    const ceilingY = this.ceilingY;

    for (const entry of this.entries) {
      const body = entry.body;
      /* 上緣仍在餘裕內（或根本在平面下方）＝ 貼住或遠離，不動。 */
      if (body.position.y - entry.level.radius >= ceilingY - CEILING_CONTAIN_SLACK) continue;

      Matter.Body.setPosition(body, { x: body.position.x, y: ceilingY + entry.level.radius });
      Matter.Body.setVelocity(body, {
        x: body.velocity.x,
        y: Math.max(0, body.velocity.y),
      });
    }
  }

  /**
   * 落底協助：天花板收走後的短暫窗口內，容器上半的顆粒保證一個最低下沉速度。
   * The fall-back assist: for a short window after the ceiling is torn down, every body in the
   * container's upper half is guaranteed a minimum sink speed.
   *
   * 見 `CEILING_RELEASE_SINK` 的說明 —— 這是針對「浮動結束後小顆粒卡在頂部邊界，要靠其他
   * 大顆粒施力才慢慢下來」的解法：摩擦拱撐得住重力，但撐不住一個每步都重新設定的下沉速度。
   * See `CEILING_RELEASE_SINK` — this answers "after a float, small dumplings hang at the top
   * boundary and only descend when the big ones push them": a friction arch can balance gravity,
   * but not a sink speed that is re-forced every step.
   */
  private applyCeilingReleaseAssist(): void {
    if (this.elapsedMs >= this.ceilingReleaseUntilMs) return;

    const midY = this.cavity.y + this.cavity.height / 2;

    for (const entry of this.entries) {
      const body = entry.body;
      /* 只協助上半的顆粒 —— 下半本來就在落地路上，不需要幫忙。 */
      if (body.position.y > midY) continue;

      if (body.isSleeping) Matter.Sleeping.set(body, false);

      if (body.velocity.y < CEILING_RELEASE_SINK) {
        Matter.Body.setVelocity(body, { x: body.velocity.x, y: CEILING_RELEASE_SINK });
      }
    }
  }

  /**
   * 技能天花板的 Y：容器頂緣**下方** `floatCeilingBelowRim`，虛擬單位。
   * The skill ceiling's Y, `floatCeilingBelowRim` **below** the container's rim.
   *
   * 取頂緣下方而不是直接取溢位線（溢位線在頂緣**上方** 30）：使用者定案要「警戒區下方」一片
   * 透明的平面，而警戒區的下緣就是頂緣，再往下一段是為了讓 sprite 的美術也不那麼容易冒出
   * 容器口。因為天花板一定在溢位線之下，技能期間的上緣永遠不可能觸發溢位判定。
   * Below the rim rather than at the overflow line (which sits 30 **above** the rim): the user
   * asked for a transparent plane "below the warning zone", and that band's lower edge *is* the
   * rim; the extra depth keeps the artwork from poking out of the mouth. Because the ceiling is
   * always under the line, a body's top edge can never trip the overflow test during a skill.
   */
  private get ceilingY(): number {
    return this.geometry.frame.y + Math.max(0, this.config.container.floatCeilingBelowRim);
  }

  /**
   * 容器左右兩側的展示餘裕，已扣掉 `computeContainerGeometry()` 的 40% 上限。
   * The container's left/right display margins, net of `computeContainerGeometry()`'s 40% cap.
   *
   * 從幾何推導而不是直接讀配置：幾何才是畫面上真正生效的那一組，萬一配置被夾制，這裡也會
   * 跟着夾 —— 否則搖晃會以為自己還有不存在的空間可走。
   * Derived from the geometry rather than read from the config: the geometry is what actually took
   * effect, so if the config was clamped this follows it. Otherwise the shake would believe it has
   * room that does not exist.
   */
  private get displayMargin(): { left: number; right: number } {
    const { frame, display } = this.geometry;
    return {
      left: Math.max(0, frame.x - display.x),
      right: Math.max(0, display.x + display.width - (frame.x + frame.width)),
    };
  }

  /**
   * 現在是否有技能需要那片隱形天花板（協議：浮動或搖晃！）。
   * Whether a skill currently needs the invisible ceiling (Protocol: Float, or Shake!).
   */
  private get ceilingNeeded(): boolean {
    return this.isFloating || this.isShaking;
  }

  /**
   * 建立／移除技能天花板那片隱形平面，並在技能作用期間持續叫醒所有顆粒。
   * Create or remove the invisible skill-ceiling plane, and keep every body awake while a skill
   * needs it.
   *
   * **兩個技能共用同一片。** 浮動要的是「像杯口被壓住」，搖晃要的是「別被甩出容器口」——
   * 幾何上完全一樣，所以是一份平面、一個開關（`ceilingNeeded`），而不是兩套會漂移的副本。
   * **Both skills share one plate.** Float wants "like a lid pressed on a cup" and the shake wants
   * "don't get thrown out of the mouth" — geometrically identical, so there is one plane and one
   * switch (`ceilingNeeded`) rather than two copies that drift.
   *
   * 每步都呼叫，但它只在狀態**改變**時動世界：由真轉假時把平面移出世界，並叫醒全部 ——
   * 貼在天花板上的顆粒若還在睡，就會繼續懸空。
   * Called every step, but it only touches the world on a **change**: when the need goes true to
   * false the plane leaves the world and everything is woken, because a body resting on the
   * ceiling would otherwise stay asleep — and therefore hanging.
   */
  private syncCeiling(): void {
    if (this.ceilingNeeded) {
      if (this.ceilingBody === null) {
        /*
         * 平面橫跨**整個可繪製範圍**（`display`）而不是外框：搖晃時容器會左右跑，而這片平面
         * 是靜態的（不跟着晃），只蓋住外框寬度的話，容器移到極左／極右時容器口就會露出一段
         * 沒被蓋住，顆粒正好從那裡飛出去。多出來的寬度看不見，所以沒有代價。
         * The plane spans the whole drawable region (`display`) rather than the box: the container
         * slides sideways during a shake while this plane is static (it does not shake), so
         * covering only the box's width would leave a strip of the mouth uncovered at either
         * extreme — exactly where a body would escape. The extra width is invisible, so it is free.
         */
        const { display } = this.geometry;
        const ceiling = this.ceilingY;

        this.ceilingBody = createStaticRect(
          display.x + display.width / 2,
          ceiling - CEILING_THICKNESS / 2,
          display.width,
          CEILING_THICKNESS,
        );
        this.physics.add(this.ceilingBody);
      }

      /*
       * 技能期間每步都叫醒：顆粒在平面上壓穩之後會進入休眠，而休眠剛體收不到重力 ——
       * 一旦重力翻回向下，它們就不會掉回來。
       * Wake every step while a skill needs the plane: a body pressed against it falls asleep, and
       * sleeping bodies receive no gravity — so once gravity flips back down, it would never come
       * back.
       */
      this.wakeAll();
      return;
    }

    if (this.ceilingBody === null) return;

    this.physics.remove(this.ceilingBody);
    this.ceilingBody = null;
    /*
     * 收走平面＝落底協助開窗：貼牆的小顆粒可能與鄰居架起摩擦拱（見 `CEILING_RELEASE_SINK`
     * 的說明），窗口內保證的最低下沉速度把它拉垮。
     * Tearing the plane down opens the fall-back assist window: a small body near the wall may
     * be bridged into a friction arch with its neighbours (see `CEILING_RELEASE_SINK`), and the
     * window's guaranteed minimum sink speed collapses it.
     */
    this.ceilingReleaseUntilMs = this.elapsedMs + CEILING_RELEASE_ASSIST_MS;
    this.wakeAll();
  }

  /**
   * 技能天花板的一次性夾制：把已經在平面上方的顆粒壓回平面下方，並抵銷向上的速度。
   * The skill ceiling's one-shot clamp: press any body already above the plane back under it and
   * cancel its upward velocity.
   *
   * **只在技能施放的那一刻跑一次**（見 `floatAll()` 與 `shakeContainer()`），之後由那片靜態
   * 平面接手。之所以還留著它，是因為平面是「加進世界」而不是「無中生有地擋住」—— 施放前就
   * 在天花板之上的顆粒會直接卡在平面內部，被求解器往最近的出口（通常是上方）擠出去。
   * It runs **once, at cast time** (see `floatAll()` and `shakeContainer()`), after which the
   * static plane takes over. It survives because installing a plane is not the same as stopping
   * bodies that were already above it: those would sit inside the plane and be squeezed out of its
   * nearest face — usually the top.
   *
   * 只夾**上緣**（`y - radius`），與溢位判定同一套定義，這樣「浮到貼住平面」與「越線」
   * 在畫面與規則上是同一件事。
   * Only the **top edge** is clamped (`y - radius`), matching the overflow test, so "floating right
   * up to the plane" and "crossing the line" mean the same thing in the picture and in the rules.
   */
  private clampCeiling(): void {
    const ceilingY = this.ceilingY;

    for (const entry of this.entries) {
      const ceiling = ceilingY + entry.level.radius;
      const { y } = entry.body.position;
      if (y >= ceiling) continue;

      Matter.Body.translate(entry.body, { x: 0, y: ceiling - y });
      Matter.Body.setVelocity(entry.body, {
        x: entry.body.velocity.x,
        y: Math.max(0, entry.body.velocity.y),
      });
    }
  }

  /**
   * 把剛體速度夾在一個上限內（搖晃的穩定性護欄，見 `SHAKE_MAX_BODY_SPEED`）。
   * Clamp body speeds to a ceiling — the shake's stability guard (see `SHAKE_MAX_BODY_SPEED`).
   */
  private clampBodySpeeds(limit: number): void {
    for (const entry of this.entries) {
      const { x, y } = entry.body.velocity;
      const speed = Math.hypot(x, y);
      if (speed <= limit) continue;

      const k = limit / speed;
      Matter.Body.setVelocity(entry.body, { x: x * k, y: y * k });
    }
  }

  /** 這一刻是否暫停溢位判定（浮動期間與其後的緩衝）。 */
  private get overflowPaused(): boolean {
    return this.elapsedMs < this.overflowPauseUntilMs;
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
   *
   * **這一支只收集碰撞對**；近接掃描由 `step()` 每步執行（見 `collectProximityMerges` 的
   * 說明：它不能掛在碰撞回呼裡，否則「相鄰但沒碰上」的兩顆永遠不會被檢查）。
   * **This one collects collision pairs only**; the proximity sweep runs every step from
   * `step()` (see `collectProximityMerges`: it cannot live in the collision callback, or two
   * adjacent-but-not-touching dumplings would never be examined).
   */
  private readonly collectMerges = (pairs: readonly Matter.Pair[]): void => {
    if (this.over) return;

    const atMs = this.elapsedMs;

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

      /* 已經在本步被配走（碰撞或近接）就不再排一次。 */
      if (this.stepClaimed.has(a.body.id) || this.stepClaimed.has(b.body.id)) continue;
      if (mergeResultId(a.level, b.level) === null) continue;
      /* 剛生成（投下或剛合成）的方團團先冷卻一下，避免鏈式合成一次跑完。 */
      if (atMs - a.bornAtMs < this.mergeCooldownMs) continue;
      if (atMs - b.bornAtMs < this.mergeCooldownMs) continue;

      this.stepClaimed.add(a.body.id);
      this.stepClaimed.add(b.body.id);
      this.pendingMerges.push({ a, b, atMs });
    }
  };

  /**
   * 掃出「輪廓相接或幾乎相接」的同級配對（使用者定案：改用輪廓實際接觸判定）。
   * Sweep for same-level pairs whose outlines touch or nearly touch (the user's decision:
   * judge by the outlines actually meeting).
   *
   * **為什麼不能掛在碰撞回呼裡**：碰撞事件（`collisionStart`）只在「兩顆從不接觸變成接觸」
   * 的那一瞬間發射。兩顆方團團滾到相鄰位置卻始終差一點沒碰上時，事件永遠不會來 —— 掃描也
   * 就跟著永遠不跑。輪廓碰撞體讓這個縫隙變成常態（方形身體＋頭飾尖角使圓身之間留縫），
   * 所以近接掃描必須**每步都跑**，而不是等碰撞來敲門。
   * **Why it cannot live in the collision callback**: `collisionStart` fires only at the instant
   * a pair goes from not-touching to touching. Two dumplings that settle adjacent but never
   * quite touch would never fire it, and the sweep would never run. Outline colliders make that
   * seam the normal case (a square body with pointed decorations leaves a gap between round
   * middles), so the sweep must run **every step** rather than wait to be called.
   *
   * 因此它在 `step()` 裡、物理跑完之後執行，與 `flushMerges()` 同一拍；`collectMerges`
   * 仍然只在碰撞時收集，兩條路徑共用 `claimed` 去重（在 `step()` 裡一次配一個集合）。
   * It therefore runs in `step()`, after physics, on the same tick as `flushMerges()`;
   * `collectMerges` still collects only on collision, and the two paths share one `claimed`
   * set (paired per step in `step()`).
   *
   * **判定用輪廓邊緣間隙，不是圓心距離**（使用者定案）。圓心距離法對**不同尺寸**的配對會
   * 系統性失準：一顆小顆粒夾在兩顆大顆粒之間時視覺上已經相依，圓心距離卻被「自己的半徑 ＋
   * 鄰居的半徑」綁死。改用輪廓就沒有這個偏誤 —— 見 `game/outlineProximity.ts`。
   * **The test is the outline edge gap, not the centre distance** (the user's decision). A
   * centre-radius rule is systematically wrong for **mixed-size** pairs: a small dumpling
   * wedged between larger ones is visually adjacent, but its centre distance is pinned by
   * "my radius + their radius". Outlines have no such bias — see `game/outlineProximity.ts`.
   *
   * **沒有輪廓時退回圓形**：測試環境與素材載入失敗時 `silhouettes` 為空或該級為 `null`，
   * 這時退回「圓心距離 < (r₁+r₂)」的舊判定，讓純圓形碰撞體仍然可以合成（圓形本來就會真的
   * 接觸，所以退回的判定不會漏掉）。
   * **Falls back to circles when no outline exists**: in tests, or when a sprite fails to
   * load, `silhouettes` is empty or the level maps to `null`; the old "centre distance <
   * r₁+r₂" test then applies, so plain circle colliders still merge (they genuinely touch, so
   * the fallback never misses).
   *
   * 兩兩比對是 O(n²)，但 `maxBodies` 上限是 80（見 `levels.json`）—— 每步都在做也不太需要
   * 最佳化，而空間切分帶來的複雜度與維護成本遠高於它省下的時間。
   * The pairwise scan is O(n²), but `maxBodies` caps the field at 80 (see `levels.json`) — not
   * worth a spatial index whose complexity and maintenance would cost far more than it saves.
   *
   * @param claimed 本次物理步已經被配走的剛體 id（由碰撞路徑先填）。
   */
  private collectProximityMerges(claimed: Set<number>, atMs: number): void {
    const entries = this.entries;

    for (let i = 0; i < entries.length; i += 1) {
      const a = entries[i];
      if (a === undefined || claimed.has(a.body.id)) continue;
      /* 剛生成的要先冷卻，否則一次投放會連鎖合成到頂。 */
      if (atMs - a.bornAtMs < this.mergeCooldownMs) continue;

      for (let j = i + 1; j < entries.length; j += 1) {
        const b = entries[j];
        if (b === undefined || claimed.has(b.body.id)) continue;
        /* 等級不同就不可能合成，先篩掉再算幾何。 */
        if (mergeResultId(a.level, b.level) === null) continue;
        if (atMs - b.bornAtMs < this.mergeCooldownMs) continue;

        if (!this.outlinesReach(a, b)) continue;

        claimed.add(a.body.id);
        claimed.add(b.body.id);
        this.pendingMerges.push({ a, b, atMs });
        /* 這顆已經配掉了，不必再跟後面的顆粒比。 */
        break;
      }
    }
  }

  /**
   * 兩顆方團團的輪廓是否相接（或幾乎相接）到足以合成。
   * Whether two dumplings' outlines meet — or nearly meet — closely enough to merge.
   *
   * 先把**局部**輪廓轉到世界座標（用剛體目前的位置與角度），再交給純幾何判定。沒有輪廓的
   * 那顆退回圓形路徑。
   * Local outlines are first brought into world space using each body's current position and
   * angle, then handed to the pure-geometry test. A body with no outline takes the circle path.
   */
  private outlinesReach(a: Entry, b: Entry): boolean {
    const polyA = this.silhouettes?.get(a.level.id);
    const polyB = this.silhouettes?.get(b.level.id);

    const hasA = polyA !== undefined && polyA !== null;
    const hasB = polyB !== undefined && polyB !== null;

    /*
     * 兩顆都有輪廓：用真實輪廓邊緣間隙判定 —— 這是使用者要的「看畫面上有沒有接觸」。
     */
    if (hasA && hasB) {
      const worldA = toWorldPolygon(
        polyA,
        a.body.position.x,
        a.body.position.y,
        a.body.angle,
      );
      const worldB = toWorldPolygon(
        polyB,
        b.body.position.x,
        b.body.position.y,
        b.body.angle,
      );

      return outlinesWithinReach(worldA, worldB, MERGE_OUTLINE_GAP);
    }

    /*
     * 只要有一顆沒有輪廓，就退回圓形判定。混用兩套座標系沒有意義：一邊是圓、一邊是多邊形
     * 時，「邊緣間隙」沒有共同的定義，而圓形那顆本來就會真的接觸，所以圓心距離就夠。
     */
    const dx = a.body.position.x - b.body.position.x;
    const dy = a.body.position.y - b.body.position.y;
    const reach = a.level.radius + b.level.radius;

    return dx * dx + dy * dy <= reach * reach;
  }

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
   * 把兩顆合成一顆：移除原本兩顆，在質心生成下一級、繼承動量、向下投影找支撐，加分並記錄連擊。
   * Merge two into one: remove both, spawn the next level at their midpoint, inherit momentum,
   * project down onto the nearest support, score it, and register the combo.
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

    /*
     * 繼承動量（使用者定案：質心 ＋ 動量平均）。
     *
     * 兩顆原料的動量不該因為合成而消失 —— 否則一顆正在下墜、或正被鄰居推擠的顆粒，合成後
     * 會「憑空靜止」出現在質心，玩家看得出這不自然。這裡用質量加權平均把動量接過來，讓新顆粒
     * 沿著原本的運動方向繼續走。
     * Inherit momentum (the user's decision: midpoint plus averaged momentum).
     *
     * The inputs' momentum must not vanish on merging, or a falling or shoving dumpling would
     * reappear motionless at the midpoint, which reads as unnatural. A mass-weighted average
     * carries the momentum over so the new body keeps travelling the way its inputs did.
     */
    const velocity = inheritMomentum(
      a.body.velocity,
      circleMass(a.level.density, a.level.radius),
      b.body.velocity,
      circleMass(b.level.density, b.level.radius),
    );
    Matter.Body.setVelocity(body, velocity);

    /*
     * 向下投影找支撐（使用者定案：避免貿然凌空）。
     *
     * 質心中點有時落在半空中（兩顆原料原本堆在高處，或被推開後才合成）。這時把新顆粒往下
     * 吸附到最近的支撐上，而不是讓它在空中定格等物理拉 —— 那會有肉眼可見的停頓。腳下沒有
     * 夠近的支撐時不動它，維持自由落體。
     * Project down onto support (the user's decision: avoid freezing in mid-air).
     *
     * The midpoint sometimes sits in mid-air (inputs stacked high, or pushed apart before the
     * merge). Snapping the body down onto the nearest support avoids the visible stall of hanging
     * there until physics pulls it down. When nothing close enough lies below, leave it to free
     * fall.
     *
     * **浮動期間跳過**：重力已翻向上，合體剛體本就會上浮；若仍向下吸附到最近支撐，會把它
     * 卡在浮動堆疊的最下方（離天花板最遠），看起來就像「最大／剛合併的那隻沒飛起來」。
     * 浮動時交給上浮的重力處理，讓它隨堆疊一起升上去。
     * **Skipped while floating**: gravity is already upward, so the merged body would rise on its
     * own. Snapping it down would pin it to the bottom of the floating pile (farthest from the
     * ceiling) — the "the largest / just-merged one didn't float" look. Leave it to the upward
     * gravity so it rises with the rest.
     */
    if (!this.isFloating) this.settleOntoSupport(body, level);

    /*
     * 推開被壓到的鄰居（使用者定案：按重疊深度推開）。
     *
     * 新顆粒比兩顆原料都大，卻生成在質心 —— 多出來的面積會陷進旁邊的方團團。這裡在生成後
     * **立刻**把重疊的鄰居沿連心線推開，位移量按重疊深度算，不讓穿模留到下一幀被玩家看到。
     * Push aside the neighbours that got crushed (the user's decision: push by overlap depth).
     *
     * The new body is larger than either input yet spawns at the midpoint, so its extra area
     * sinks into the surrounding dumplings. This immediately displaces every overlapping
     * neighbour along the centre line by its overlap depth, so the interpenetration never
     * survives to the next frame where the player would see it.
     *
     * **順序要緊**：先吸附到支撐、再推鄰居。反過來的話，推力會把新顆粒推離支撐面，接著的
     * 吸附又把它拉回去，兩個修正互相抵銷。
     * **Order matters**: settle onto support first, then push neighbours. The other way round, the
     * push would shove the body off its support and the settle would drag it back — the two
     * corrections cancel out.
     */
    this.pushNeighboursApart(body, level);

    /* 彈跳動畫：新生成的那顆從峰值縮回原尺寸。 */
    this.pops.set(body.id, atMs);

    this.mergedCountValue += 1;

    /*
     * 技力來源之二是**合成**（使用者定案：每次 combo +0.05）。放在這裡而不是 `combo` 追蹤器
     * 裡，是因為技力是「這一局的資源」，而 tracker 只管曲線。
     * The second SP source is the **merge** (the user's decision: +0.05 per combo). It lives here
     * rather than in the `combo` tracker because SP is a run resource while the tracker owns only
     * the curve.
     */
    this.sp.gainForCombo();

    /*
     * 連擊：每一次合成拿「當下串長」對應的曲線倍率（`COMBO_CURVE`）。倍率由 tracker 算，
     * 這裡只管把它乘上等級分數 —— 「第幾次拿幾倍」的規則全在 `game/combo.ts`，可以在
     * 單元測試裡逐條釘住。
     * Combo: each merge takes the curve multiplier at its chain length (`COMBO_CURVE`). The
     * tracker owns the curve; this only multiplies the level score by it, so "which merge gets
     * which multiplier" stays in `game/combo.ts` where it can be pinned down test by test.
     */
    const snapshot = this.combo.record();
    const gain = level.score * snapshot.multiplier;

    this.scoreValue += gain;

    /* 本次投放的計分；倍率曲線全在 `game/combo.ts`，這裡只累加。 */
    this.dropScoreValue += gain;

    /*
     * 連勝中斷判準：數「這顆有沒有合成」。`drop()` 讀這個值決定是否歸零。
     * The streak-break signal: record that *this* drop merged, which `drop()` reads.
     */
    this.dropMergeCountValue += 1;

    this.registerUnlock(level.id);
  }

  /**
   * 把與新顆粒重疊的鄰居沿連心線推開（使用者定案：按重疊深度推開）。
   * Push neighbours overlapping a freshly merged body outward along the centre line (the user's
   * decision: push by overlap depth).
   *
   * 每個鄰居各自處理，深度取 `outlinePenetration()` 的結果，並且：
   *  - **位移 ＝ 深度 × `MERGE_PUSH_FACTOR`**（略為過推，否則下一幀又疊回去）
   *  - **速度增量 ＝ 深度 × `MERGE_PUSH_SPEED`**（讓分開看起來是滑開，不是瞬移）
   *  - **深度上限 `MERGE_PUSH_MAX_DEPTH`**（否則「小顆粒完全在大顆粒內」會把鄰居彈飛）
   * Each neighbour is handled on its own, with the depth from `outlinePenetration()`, and:
   *  - **position shift = depth × `MERGE_PUSH_FACTOR`** (a slight overshoot, or it re-overlaps
   *    next frame)
   *  - **velocity kick = depth × `MERGE_PUSH_SPEED`** (so separation reads as sliding, not a
   *    teleport)
   *  - **depth capped at `MERGE_PUSH_MAX_DEPTH`** (or "small wholly inside large" would fling
   *    the neighbour away)
   *
   * **只推鄰居、不推自己**：新顆粒剛生成，位置由合成規則決定（兩顆原料的質心）；把它也推走
   * 會讓合成結果「跳」到玩家預期之外的地方。鄰居被推開才是玩家要的效果。
   * **Only neighbours move, never the new body**: the merge result's position is dictated by the
   * rule (the inputs' midpoint), and shoving it too would make it jump somewhere the player did
   * not expect. Displacing the neighbours is the effect that was asked for.
   *
   * **沒有輪廓時退回「圓心距離 vs 半徑和」**：與合併判定同一套退路，讓純圓形碰撞體也能運作。
   * **Falls back to "centre distance vs radii sum" without outlines**: the same fallback as the
   * merge predicate, so plain circle colliders still work.
   */
  private pushNeighboursApart(body: Matter.Body, level: LevelDef): void {
    const newPolygon = this.silhouettes?.get(level.id);
    const hasNew = newPolygon !== undefined && newPolygon !== null;

    const worldNew = hasNew
      ? toWorldPolygon(newPolygon, body.position.x, body.position.y, body.angle)
      : null;

    for (const entry of this.entries) {
      /* 自己不算鄰居。 */
      if (entry.body.id === body.id) continue;

      let nx: number;
      let ny: number;
      let depth: number;

      const otherPolygon = this.silhouettes?.get(entry.level.id);
      const hasOther = otherPolygon !== undefined && otherPolygon !== null;

      if (worldNew !== null && hasOther) {
        const worldOther = toWorldPolygon(
          otherPolygon,
          entry.body.position.x,
          entry.body.position.y,
          entry.body.angle,
        );
        ({ nx, ny, depth } = outlinePenetration(worldNew, worldOther));
      } else {
        /*
         * 退路：用圓心距離與半徑和算深度。深度 = 半徑和 − 圓心距離（沒重疊就是 0）。
         * Fallback: depth from centre distance versus the radii sum.
         */
        const dx = entry.body.position.x - body.position.x;
        const dy = entry.body.position.y - body.position.y;
        const distance = Math.hypot(dx, dy);
        const radiiSum = level.radius + entry.level.radius;

        if (distance === 0) {
          nx = 0;
          ny = 1;
          depth = radiiSum;
        } else {
          nx = dx / distance;
          ny = dy / distance;
          depth = radiiSum - distance;
        }
      }

      if (depth <= 0) continue;

      /* 上限：避免極端深度把鄰居彈到容器另一頭。 */
      const capped = Math.min(depth, MERGE_PUSH_MAX_DEPTH);

      pushBody(
        entry.body,
        nx,
        ny,
        capped * MERGE_PUSH_FACTOR,
        capped * MERGE_PUSH_SPEED,
      );
    }
  }

  /**
   * 把新合成的顆粒往下吸附到最近的支撐（使用者定案：避免貿然凌空）。
   * Snap a freshly merged body down onto the nearest support (the user's decision: avoid
   * freezing in mid-air).
   *
   * 合成位置取質心中點，這個點有時半空 —— 兩顆原料原本堆在高處、或被推開後才合成，頭頂
   * 忽然空掉。這時新顆粒若原地出現就會在空中「定格」一下才落下。補救是把它的圓底吸附到
   * 底下最近的支撐上緣。
   * The merge position is the inputs' midpoint, which is sometimes mid-air — inputs stacked high,
   * or pushed apart before merging, so the space below opened up. A body appearing there would
   * stall for a moment before dropping. The fix snaps its bottom onto the nearest support below.
   *
   * **支撐包含兩類**：容器地板（靜態），以及其他方團團（用包圍盒近似）。兩者都是「可以墊在
   * 下面的東西」。
   * **Two kinds of support**: the container floor (static) and the other dumplings (approximated
   * by their bounding boxes). Both are things a body can rest on.
   *
   * **只在夠近時才吸附**：門檻是 `MERGE_SETTLE_MAX_DROP`。太遠的支撐不吸 —— 否則一顆在高處
   * 合成的顆粒會「瞬移」到地面，那比凌空更怪異。
   * **Only snap when close enough**, the `MERGE_SETTLE_MAX_DROP` threshold. A distant support is
   * left alone, or a body merged high up would teleport to the floor — stranger than hovering.
   *
   * **吸附只改位置、不動速度**：動量由 `inheritMomentum` 決定，這裡若也動速度就會重複計。
   * **Only position moves, never velocity**: momentum is already set by `inheritMomentum`, and
   * touching velocity here would double-count it.
   */
  private settleOntoSupport(body: Matter.Body, level: LevelDef): void {
    const bodies = this.entries.map((entry) => entry.body);

    /* 其他方團團的包圍盒。 */
    const supports = boundsOf(bodies, body.id);

    /*
     * 加上容器地板：一條橫跨整個遊戲區的厚板。
     *
     * **地板的上緣是 `cavity` 的底部，不是 `frame` 的底部** —— 牆體本身有厚度
     * （`WALL_THICKNESS`），物理地板剛體就坐在 `cavity` 之下，所以「可站的平面」比外框底部
     * 高一個牆厚。用外框底部會把顆粒塞進地板裡。
     * **The floor's top is the cavity bottom, not the frame bottom** — the wall has thickness
     * (`WALL_THICKNESS`) and the physics floor body sits below the cavity, so the surface to
     * stand on is one wall-thickness above the frame's bottom. Using the frame bottom would push
     * the body into the floor.
     */
    const floorTop = this.cavity.y + this.cavity.height;
    supports.push({ x: this.cavity.x, y: floorTop, width: this.cavity.width, height: 1 });

    const drop = distanceToSupport(
      body.position.x,
      body.position.y,
      level.radius,
      supports,
      MERGE_SETTLE_MAX_DROP,
    );

    /* 沒有夠近的支撐（`Infinity`）→ 維持自由落體。 */
    if (!Number.isFinite(drop) || drop <= 0) return;

    Matter.Body.translate(body, { x: 0, y: drop });
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
   *
   * **近接掃描在物理跑完之後、`flushMerges()` 之前執行**，並且與碰撞路徑共用 `stepClaimed`：
   *   - 碰撞對在 `physics.step()` **之中**由事件回呼收集（那時剛體位置還是碰撞前的）；
   *   - 近接掃描在**之後**讀剛體位置，拿到的是這一步解算完的座標，判定才與畫面一致。
   * 兩者都寫進 `pendingMerges`，`flushMerges()` 一次套用，所以同一批合併共用同一個時間戳、
   * 算同一次連擊。
   * **The proximity sweep runs after physics and before `flushMerges()`**, sharing `stepClaimed`
   * with the collision path:
   *   - collision pairs are collected *during* `physics.step()`, when positions are pre-solve;
   *   - the sweep reads positions *afterwards*, so its geometry matches what is on screen.
   * Both write into `pendingMerges`, which `flushMerges()` applies in one pass, so the batch
   * shares one timestamp and one combo entry.
   */
  step(deltaMs: number): void {
    const dt = Math.max(0, deltaMs);
    this.elapsedMs += dt;

    /*
     * 技能在自己的一小段前置之後才跑物理：先算好容器位移並搬到牆上、維護技能天花板那片平面、
     * 依浮動狀態設定重力、再把搖晃的慣性衝量加到顆粒上，這一刻的 `physics.step()` 才會反映
     * 它們。順序反過來的話，效果會慢整整一幀。
     * Skills run their physics prep before stepping: the container offset is computed and moved
     * onto the walls, the skill ceiling plane is created or torn down, gravity is set from the
     * float state, and the shake's inertial impulse is added to the bodies — so *this*
     * `physics.step()` already reflects them. The other order would lag the effect by a whole
     * frame.
     */
    this.updateShakeOffset();
    this.applyShakeToWalls();
    this.syncCeiling();
    this.applyFloatGravity();
    this.applyFloatCatchup();
    this.applyCeilingReleaseAssist();
    this.applyShakeImpulse(dt);

    /* 清空必須早於 `physics.step()` —— 碰撞回呼在那之中就會填它。 */
    this.stepClaimed.clear();

    this.physics.step(dt);

    /* 搖晃的速度上限在物理之後夾，畫面上不會出現超速的一幀。 */
    if (this.isShaking) this.clampBodySpeeds(SHAKE_MAX_BODY_SPEED);

    /*
     * 天花板夾回同樣在物理之後：穿透是這一步的求解器造成的，當步壓回，畫面上不會出現
     * 「冒出頭」的一幀（見 `containAtCeiling()`）。
     * Ceiling containment likewise runs after the physics: the penetration was produced by this
     * step's solver, so correcting in the same step keeps an escaping head from being drawn
     * (see `containAtCeiling()`).
     */
    this.containAtCeiling();

    if (!this.over) this.collectProximityMerges(this.stepClaimed, this.elapsedMs);
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

    /*
     * 浮動期間與其後的緩衝完全不判定溢位（使用者定案）：浮起本來就會逼近警戒線，照常計時
     * 等於技能一用就自殺。這裡直接跳過，連計時器都不推進 —— 凍結而不是歸零，因為歸零會
     * 讓緩衝結束後「從頭倒數」，而那既不是玩家的意圖也不是原本的狀態。
     * Overflow is not evaluated while floating nor during the buffer afterwards (the user's
     * decision): floating necessarily approaches the warning line, so counting would make the
     * skill self-defeating. The call is skipped outright, so not even the timer advances —
     * frozen rather than reset, because resetting would restart the countdown after the buffer,
     * which is neither what the player did nor what the state was.
     */
    if (this.overflowPaused) return;

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
    this.stepClaimed.clear();
    this.combo.reset();
    this.overflow.reset();

    /*
     * 技力與技能狀態屬於「這一局」，與分數一起歸零：開新局時技力條是空的、選取模式關掉、
     * 浮動與搖晃的效果也一併停掉。重力必須還原 —— 上一局可能在浮動狀態結束，若不還原，
     * 新的這一局會一開始就反重力。
     * SP and skill state belong to the run and reset along with the score: the meter starts empty,
     * selection is off, and any float or shake stops. Gravity must be restored too — the previous
     * run may have ended mid-float, and without this the new run would start anti-gravity.
     */
    this.sp.reset();
    this.activeSkill = null;
    this.selectedIds = [];
    this.floatStartedAtMs = 0;
    this.floatDurationMs = 0;
    this.floatLiftFactor = 0;
    this.floatCatchupFactor = 0;
    /*
     * 浮動天花板那片平面是**靜態**剛體，所以 `removeDynamicBodies()` 不會帶走它，必須自己
     * 收掉 —— 否則上一局留下的隱形平面會讓新的一局從一開始就撞到一道看不見的天花板。
     * The ceiling plane is a **static** body, so `removeDynamicBodies()` leaves it behind; it has
     * to be removed here, or the leftover invisible plane would make the new run hit a ceiling
     * from the very first frame.
     */
    if (this.ceilingBody !== null) {
      this.physics.remove(this.ceilingBody);
      this.ceilingBody = null;
    }
    this.ceilingReleaseUntilMs = 0;
    this.shakeStartedAtMs = 0;
    this.shakeDurationMs = 0;
    this.shakeRevolutions = 0;
    this.shakeRadius = 0;
    this.shakeAxisTiltRad = 0;
    this.shakeUpwardFactor = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    /*
     * 把牆搬回基準位置。上一局可能在搖晃中結束，牆還帶著位移；若只把 `shakeOffset` 歸零，
     * 下一步會拿「0 − 舊位移」當差量再把牆推一次，容器就從此歪掉。`applyShakeToWalls()`
     * 依差量搬牆，這裡正好用它把差量補回來（位移已是 0，等於搬回原點）。
     * Move the walls back to their base positions. The previous run may have ended mid-shake with
     * the walls still offset; zeroing `shakeOffset` alone would make the next step treat
     * "0 − old offset" as the delta and shove them again, tilting the container for good.
     * `applyShakeToWalls()` moves them by the delta, so calling it here absorbs that delta.
     */
    this.applyShakeToWalls();
    this.overflowPauseUntilMs = 0;
    this.physics.setGravity(this.config.levels.settings.gravityY);
    this.appliedGravityY = this.config.levels.settings.gravityY;

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
    this.spawnQueue.reset();
    this.aimX = this.clampAimX(this.aimX, this.pendingLevel().radius);
  }

  /* ------------------------------------------------------------------ 輸出 */

  /** 場上所有方團團的畫面資料（含彈跳縮放與選取標記）。 */
  get bodies(): RenderBody[] {
    return this.entries.map((entry) => {
      const pickIndex = this.selectedIds.indexOf(entry.body.id);

      return {
        levelId: entry.level.id,
        x: entry.body.position.x,
        y: entry.body.position.y,
        radius: entry.level.radius,
        angle: entry.body.angle,
        scale: this.popScale(entry.body.id),
        velocity: { x: entry.body.velocity.x, y: entry.body.velocity.y },
        ...(pickIndex >= 0 ? { pickIndex: pickIndex + 1 } : {}),
      };
    });
  }

  /**
   * **除錯用**：每一顆方團團的碰撞體頂點（世界座標），依實際用來碰撞的多邊形拆解。
   *
   * 這是給 `?debug=1` 的：畫面上標成「藍點 ＋ 紅線」，讓人一眼看出物理引擎實際拿什麼
   * 在碰撞 —— 這正是輪廓追蹤（`render/silhouette.ts`）那套工具的畫面版本。
   * Debug-only: each dumpling's collider vertices in world space, split the way the engine
   * actually collides.
   *
   * **為什麼是「拆解後」的形狀**：`Bodies.fromVertices` 把凹多邊形分解成多個**凸**部件
   * 才能做碰撞。父體（`parts[0]`）的 `vertices` 是**凸包**，畫出來會是一個把凹角填滿的
   * 多邊形 —— 那不是實際碰撞的形狀。所以取 `parts.slice(1)`：那才是真正在跑的凸塊。
   * 圓形後備路徑（`createCircleBody`）沒有 `parts`，退回父體本身即可。
   *
   * **為什麼回傳副本**：`vertices` 雖說是唯讀陣列，但把 Matter 的內部結構直接交出去，
   * 等於讓渲染層能改到物理狀態。複製一份淺層頂點，兩邊就互不干涉。
   *
   * **Why the *decomposed* shape**: `Bodies.fromVertices` splits a concave polygon into convex
   * parts because that is all the engine can collide. The parent (`parts[0]`) holds the
   * **convex hull**, whose vertices trace a filled-in polygon that is *not* the collision shape.
   * `parts.slice(1)` is what actually runs. The circle fallback has no `parts`, so it falls back
   * to the parent.
   *
   * **Why copies**: `vertices` is nominally read-only, but handing out Matter's internals lets the
   * renderer mutate physics. A shallow copy per vertex keeps the two layers independent.
   */
  get colliderOutlines(): { levelId: number; parts: { x: number; y: number }[][] }[] {
    return this.entries.map((entry) => {
      /* `isConvex` 的複合體有 `parts`；單一圓形（`circleRadius` 定義）則沒有。 */
      const parts = entry.body.parts.length > 1 ? entry.body.parts.slice(1) : [entry.body];

      return {
        levelId: entry.level.id,
        parts: parts.map((part) =>
          part.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        ),
      };
    });
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

  /**
   * 投放預覽；`spawnYValue` 就是預覽圓心的高度。
   *
   * **冷卻中回傳 `null`**（使用者定案）：投放之後、冷卻結束之前不顯示「即將投放」——
   * 那個位置本來就是剛剛掉下去的那一顆還沒走開，再畫一顆「即將投放」等於在欺騙眼睛。
   * 等 `dropCooldownMs` 走完，下一個順位的方團團才會出現。
   *
   * 用 `null` 而不是「畫成透明」是刻意的：透明度是**風格**，可空是**狀態**。用透明的話，
   * renderer 與 HUD 每個消費端都得自己記得處理 alpha=0 的情況；`null` 則讓「此刻沒有預覽」
   * 成為型別層面的事實，`drawStage` 的 `aim` 參數本來就宣告成 `RenderAim | null`。
   * The aim preview, `spawnYValue` being the circle's centre height.
   *
   * **`null` while the cooldown runs** (the user's decision): between a drop and the end of the
   * cooldown no "next" dumpling is shown — that spot is still occupied by the one just dropped,
   * so drawing a preview there would simply lie to the eye. The following queue entry appears
   * only once `dropCooldownMs` has elapsed.
   *
   * `null` rather than "draw it transparent" is deliberate: opacity is *styling*, nullability
   * is *state*. Transparency would make every consumer remember to handle alpha = 0, while
   * `null` makes "no preview right now" a fact at the type level — `drawStage`'s `aim`
   * parameter is already declared `RenderAim | null`.
   */
  get aimPreview(): RenderAim | null {
    /* 冷卻中（以及遊戲結束後）沒有預覽。 */
    if (!this.canDrop) return null;

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
   * 這串連勝累積到第幾次合成。
   * How many merges this winning streak has accumulated.
   *
   * **跨投放累積**（使用者定案）：只有「上一顆什麼都沒合成」才歸零，所以這個數字會隨連勝
   * 一直往上爬。它是 COMBO 卡中間那個大數字。
   * **Accumulates across drops** (the user's decision): it only resets when the previous drop
   * merged nothing, so the number climbs for as long as the streak lives. This is the big
   * number in the middle of the COMBO card.
   */
  get comboCount(): number {
    return this.combo.count;
  }

  /**
   * **本次投放**累積的總分（每次合成各自乘上當下的曲線倍率後相加）。
   * The total score **this drop** has earned, each merge multiplied by the curve value at its
   * own chain length.
   *
   * 這是 COMBO 卡第二行的 `+ 18`：使用者定案「展示本次投放合共賺了多少分」。注意它
   * **仍是單顆的成績**，只是倍率的來源（串長）跨顆累積 —— 分母不變、分子變長。
   * This is the COMBO card's `+ 18` on the second line — still **one drop's** earnings, but the
   * multiplier feeding it (the streak length) now carries across drops.
   */
  get dropScore(): number {
    return Math.round(this.dropScoreValue);
  }

  /**
   * 這串連勝累積到目前為止所用的倍率；尚未合成過為 `1`。
   * The multiplier this streak has reached; `1` before any merge.
   *
   * COMBO 卡第二行的 `(×1.74)` 顯示的就是它。因為串長跨投放累積，這個倍率會**一路沿著曲線
   * 往上爬**，直到某顆完全沒合成才被重設回 ×1.0。
   * Exactly what the card's `(×1.74)` renders. Because the chain accumulates across drops, this
   * multiplier climbs the curve for as long as the streak survives and only drops back to ×1.0
   * when a drop merges nothing at all.
   */
  get comboMultiplier(): number {
    return this.combo.snapshot().multiplier;
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
    return !this.over && !this.overflowPaused && this.overflow.settled;
  }

  /** 溢位倒數剩餘秒數（整數，1 起跳）；未起算時為 0。 */
  get overflowSecondsLeft(): number {
    if (this.overflowPaused) return 0;
    return this.overflow.settled ? this.overflow.remainingSeconds : 0;
  }

  /** 這一步是否處於「已越線且已停定」的危險狀態。 */
  get overflowDanger(): boolean {
    return !this.over && !this.overflowPaused && this.overflow.settled;
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
