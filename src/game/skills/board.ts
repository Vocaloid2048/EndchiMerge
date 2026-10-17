/**
 * 技能與棋盤之間的介面：技能類別不認識 `GameSession` 也不認識 Matter.js，只看得到這幾個動作。
 * The interface between a skill and the board: skills know neither `GameSession` nor Matter.js — only these actions.
 */

/**
 * 一個可以被技能選取的目標（＝場上的一顆方團團）。
 * One target a skill can select — a single dumpling on the board.
 */
export interface BoardTarget {
  /**
   * 剛體識別碼；技能只把它當成不透明的代號傳回去。
   * The body id; skills pass it back as an opaque token.
   */
  id: number;
  levelId: number;
  x: number;
  y: number;
  radius: number;
  /**
   * 升一級之後的等級編號；已在合成鏈頂端時為 `null`。
   * The level id one step up; `null` at the top of the merge chain.
   */
  nextLevelId: number | null;
  /**
   * 下一級是否已解鎖（圖鑑）。升級技能只接受 `true` 的目標。
   * Whether the next level is unlocked in the collection; the upgrade skill only accepts `true`.
   */
  nextLevelUnlocked: boolean;
}

/**
 * 浮動的請求參數。
 * Parameters of a float request.
 */
export interface FloatRequest {
  durationMs: number;
  liftFactor: number;
  /**
   * 追趕倍率（可省略）：浮動期間仍落在天花板帶下方的顆粒，每步額外獲得此倍率重力的向上力。
   * Catch-up factor (optional): while afloat, bodies still below the ceiling band gain this many extra gravities upward each step.
   */
  catchupFactor?: number;
}

/**
 * 搖晃的請求參數。
 * Parameters of a shake request.
 */
export interface ShakeRequest {
  durationMs: number;
  revolutions: number;
  /**
   * 位移幅度相對容器寬度的比例（已由技能夾在硬上限內）。
   * The displacement amplitude as a fraction of the container width (already clamped by the skill).
   */
  radiusFactor: number;
  /**
   * 擺動軸相對水平線的傾角，度（0 ＝ 純水平地震）。
   * The swing axis' tilt from horizontal, in degrees (0 ＝ a purely horizontal quake).
   */
  axisTiltDeg: number;
  upwardFactor: number;
}

/**
 * 技能可以對棋盤做的動作；全部由 `GameSession` 實作，技能只決定「做什麼、用什麼參數」。
 * The actions a skill may perform on the board; `GameSession` implements them all — a skill only decides what to do and with which parameters.
 */
export interface SkillBoard {
  /**
   * 場上所有可以被選取的目標（＝已經落下的方團團）。
   * Every selectable target on the board (all dropped dumplings).
   */
  readonly targets: readonly BoardTarget[];
  /**
   * 移除一顆方團團；回傳是否真的移除了。
   * Removes one dumpling; returns whether it was actually removed.
   */
  removeTarget(id: number): boolean;
  /**
   * 交換兩顆方團團的位置，並對周邊施加 `disturbance` 的擾動。
   * Swaps two dumplings' positions and disturbs their surroundings by `disturbance`.
   */
  swapTargets(a: number, b: number, disturbance: number): void;
  /**
   * 讓所有方團團向上浮起一段時間；不得越過警戒線。
   * Lifts every dumpling for a while; none may cross the overflow line.
   */
  floatAll(request: FloatRequest): void;
  shakeContainer(request: ShakeRequest): void;
  /**
   * 把一顆方團團升一級（「一步登天」）；下一級未解鎖或已達頂級時回傳 `false`。
   * Upgrade one dumpling by a level ("One Step Up"); `false` when capped or the next level is locked.
   */
  upgradeTarget(id: number): boolean;
  /**
   * 隨機重排場上所有方團團的位置（「乾坤挪移」）。
   * Randomly permute the positions of every dumpling ("Shifting Ground").
   */
  scrambleTargets(): void;
  /**
   * 清空棋盤，再降下 `count` 顆（「天翻地覆」）。
   * Clear the board and rain down `count` dumplings ("Clean Slate").
   */
  reshuffle(count: number): void;
  /**
   * 接下來 `drops` 次投放即使沒有合成，也不會打斷連擊（「連勢不墜」）。
   * The next `drops` drops keep the combo chain alive even without a merge ("Chain Ward").
   */
  protectCombo(drops: number): void;
  /**
   * 把場上所有方團團縮到 `radius`（只縮不放）（「縮地成寸」）。
   * Shrink every dumpling on the board to `radius`, never enlarge ("Fold Space").
   */
  shrinkAll(radius: number): void;
  /**
   * 本局改用「核心正方形」判定合成邊緣（「以方代圓」）；重複呼叫無副作用。
   * Switch this run's merge-edge test to the core square ("Square Rule"); idempotent.
   */
  useSquareMerge(): void;
  /**
   * 溢位線的 Y（浮動的天花板），虛擬單位。
   * The overflow line's Y (the float ceiling), in virtual units.
   */
  readonly overflowLineY: number;
  /**
   * 容器寬度，虛擬單位（搖晃半徑的基準）。
   * The container width, in virtual units (the shake radius' basis).
   */
  readonly containerWidth: number;
}
