/**
 * 技能與棋盤之間的介面。
 * The interface between a skill and the board.
 *
 * 技能類別**不認識** `GameSession`、也不認識 Matter.js：它們只看到這幾個動作。這樣
 * `src/game/skills/` 可以獨立測試（餵一個假的棋盤），而 `GameSession` 也可以在不改技能
 * 程式碼的情況下換掉實作細節。
 * Skill classes know **neither** `GameSession` nor Matter.js — only these few actions. That
 * keeps `src/game/skills/` testable with a fake board and lets `GameSession` change its
 * implementation details without touching a single skill.
 */

/**
 * 一個可以被技能選取的目標（＝場上的一顆方團團）。
 * One target a skill can select — a single dumpling on the board.
 */
export interface BoardTarget {
  /** 剛體識別碼；技能只把它當成不透明的代號傳回去。 */
  id: number;
  /** 等級編號（畫面與除錯用）。 */
  levelId: number;
  /** 圓心 X，虛擬單位。 */
  x: number;
  /** 圓心 Y，虛擬單位。 */
  y: number;
  /** 碰撞半徑，虛擬單位。 */
  radius: number;
}

/** 浮動的請求參數。 */
export interface FloatRequest {
  /** 作用時間，毫秒。 */
  durationMs: number;
  /** 向上加速度相對重力的倍率。 */
  liftFactor: number;
}

/** 搖晃的請求參數。 */
export interface ShakeRequest {
  /** 作用時間，毫秒。 */
  durationMs: number;
  /** 容器沿圓周轉動的圈數。 */
  revolutions: number;
  /** 位移半徑相對容器寬度的比例（已由技能夾在硬上限內）。 */
  radiusFactor: number;
}

/**
 * 技能可以對棋盤做的動作。
 * The actions a skill may perform on the board.
 *
 * 每一個動作都由 `GameSession` 實作；技能只負責「決定要做什麼、用什麼參數」。
 * `GameSession` implements every one of them; a skill only decides *what* to do and *with
 * which parameters*.
 */
export interface SkillBoard {
  /** 場上所有可以被選取的目標（＝已經落下的方團團）。 */
  readonly targets: readonly BoardTarget[];
  /** 移除一顆方團團；回傳是否真的移除了。 */
  removeTarget(id: number): boolean;
  /** 交換兩顆方團團的位置，並對周邊施加 `disturbance` 的擾動。 */
  swapTargets(a: number, b: number, disturbance: number): void;
  /** 讓所有方團團向上浮起一段時間；不得越過警戒線。 */
  floatAll(request: FloatRequest): void;
  /** 震動整個容器。 */
  shakeContainer(request: ShakeRequest): void;
  /** 溢位線的 Y（浮動的天花板），虛擬單位。 */
  readonly overflowLineY: number;
  /** 容器寬度，虛擬單位（搖晃半徑的基準）。 */
  readonly containerWidth: number;
}
