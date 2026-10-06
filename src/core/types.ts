/**
 * 全域型別定義。
 * Global type definitions.
 *
 * 這裡的形狀必須與 `public/config/*.json` 逐一對應。配置載入器會逐欄做型別與範圍
 * 檢查，任何缺失或非法的欄位都會退回內建預設值，因此這些型別描述的是「檢查通過後」
 * 的形狀，而非原始檔案的形狀。
 * These shapes mirror `public/config/*.json` one-to-one. The loader validates every
 * field and falls back to built-in defaults, so these types describe the shape
 * *after* validation rather than the raw file.
 */

/** 單一等級（方團團）的靜態定義。 */
export interface LevelDef {
  /** 1 為底的等級編號，也是合成鏈的索引。 */
  id: number;
  /** 顯示名稱。 */
  name: string;
  /** 相對於 `public/assets/` 的路徑，例如 `character/萊萬汀_img.webp`。 */
  sprite: string;
  /** 碰撞圓半徑，虛擬單位。 */
  radius: number;
  /** 密度；質量 = 密度 × 圓面積。 */
  density: number;
  /** 彈性係數。 */
  restitution: number;
  /** 接觸摩擦。 */
  friction: number;
  /** 空氣阻力。 */
  frictionAir: number;
  /** 由合成產生時獲得的分數；Lv1 永不經由合成產生，故為 0。 */
  score: number;
  /** 掉落抽取的相對權重；0 表示不作為掉落物。 */
  spawnWeight: number;
  /** 是否可被投放。 */
  droppable: boolean;
  /** 合成後的等級編號；最高級為 null。 */
  mergeResult: number | null;
}

/** 與等級無關的全域遊戲設定。 */
export interface GameSettings {
  /** 場上同時存在的物體上限，超過即視為溢出。 */
  maxBodies: number;
  /**
   * 重力加速度（Matter.js 的 `gravity.y`）。
   * Gravitational acceleration, passed to Matter.js as `gravity.y`.
   *
   * 放在這裡而非 `constants.ts`，因為它是**可調參數**：手感靠它調。物理常數一律以
   * 虛擬單位定義，`scale` 只用於投影，所以換裝置不會改變重力。
   * It lives in config rather than `constants.ts` because it is a tuning knob.
   * Physics constants are defined in virtual units, so changing devices never
   * changes gravity.
   */
  gravityY: number;
  /**
   * 是否鎖定方團團的旋轉。
   * Whether the dumplings' rotation is locked.
   *
   * `false`（預設）＝**依真實物理翻滾**：碰撞產生的力矩會讓方團團轉動、沿斜面滾落，
   * 堆疊因此自然。`true` ＝ 慣量設無限大，方團團永遠直立。
   * `false` (default) leaves rotation to the physics engine, so contact torques tumble and
   * roll the dumplings and piles settle naturally. `true` sets inertia to infinity and
   * keeps every sprite upright.
   *
   * 取捨：碰撞形狀是**圓**而畫面是**方**，自由旋轉時玩家看得出兩者不完全一致；
   * 鎖定旋轉則會讓方塊永遠像是「平放」而不受碰撞影響。
   * The trade-off: the collider is a **circle** while the art is a **square**, so free
   * rotation makes that mismatch visible; locking it makes square art sit as if nothing
   * could ever tip it.
   */
  lockRotation: boolean;
  /** 是否禁止在特定條件下繼續投放。 */
  spawnBlockEnabled: boolean;
  /** 溢出時是否直接扣分結束，或僅提示。 */
  overflowPenalty: boolean;
  /** 同一顆剛體生成後多久內不得合成，毫秒。 */
  mergeCooldownMs: number;
  /**
   * 堆疊越過溢位線後，玩家還有多少時間處理，毫秒。逾時即結束這一局。
   * How long the player has to clear a pile that crossed the overflow line, in ms. Running
   * out ends the run.
   */
  overflowGraceMs: number;
  /**
   * 兩次投放之間的最短間隔，毫秒。間隔內的投放輸入一律忽略。
   * Minimum spacing between two drops in milliseconds; drop input inside the gap is ignored.
   *
   * 這個數字同時是**連擊的界線**：一串連擊 ＝ 一次投放，所以「1 秒間隔」既防止連點，
   * 也決定了「同一批」的範圍，兩者共用同一個常數而不是各自為政。
   * The value doubles as the **combo boundary**: a chain *is* one drop, so the 1-second gap
   * both blocks spam-clicking and defines "the same batch" — one constant rather than two
   * notions that could drift apart.
   */
  dropCooldownMs: number;
}

export interface LevelsConfig {
  settings: GameSettings;
  levels: LevelDef[];
}

/** 技力（SP）經濟參數。 */
export interface SpSettings {
  /**
   * 配置上限；載入時鉗制到 `[SP_MIN, SP_MAX_CEILING]`（1–10 的正整數）。
   * The configured cap, clamped to `[SP_MIN, SP_MAX_CEILING]` (a positive integer 1–10).
   *
   * 它同時是**技力條的段數**（一點一條），所以改上限會直接改變 UI 寬度 —— 這也是
   * 使用者定案「只接受正整數 [1…10]」的理由。
   * It doubles as the meter's segment count (one pill per point), which is why the user
   * restricted it to a positive integer in 1–10.
   */
  max: number;
  /** 開局技力。 */
  initial: number;
  /** 每次成功投放累積的技力。 */
  gainPerDrop: number;
  /**
   * 每次**合成**（＝每次 combo）累積的技力（使用者定案）。
   * SP gained per **merge** (each combo step), per the user's decision.
   */
  gainPerCombo: number;
  /** 滿值後是否允許繼續累積。 */
  overflowAllowed: boolean;
}

/** 技能的選取方式。 */
export type SkillTargeting = 'user_pick' | 'immediate';

/**
 * 技能的解鎖條件（使用者定案）。
 * A skill's unlock condition (the user's decision).
 *
 * - `sp`：**當前技力值 ≥ 消耗**就解鎖，扣費後即時上鎖。三個消耗技能都是這一種。
 * - `cumulativeSpent`：**累計消耗滿 `threshold` 點技力**才解鎖，而且**免費**（消耗 0）；
 *   用掉之後累計歸零、重新上鎖。命運互換用的是這一種。
 * - `sp`: unlocked while the **current SP ≥ cost**, locked again the moment it is spent.
 * - `cumulativeSpent`: unlocked once **`threshold` SP points have been spent in total**, and
 *   then **free** (cost 0); using it resets the running total, locking it again.
 */
export type SkillUnlock = { kind: 'sp' } | { kind: 'cumulativeSpent'; threshold: number };

/** 技能行為參數；不同技能使用的欄位不同，未使用的欄位留空。 */
export interface SkillParams {
  /**
   * 「作用中」的持續時間，毫秒。浮動與搖晃會用到；瞬發技能（當棄即棄／命運互換）為 0。
   * How long the effect stays active, in ms. Used by float and shake; instant skills
   * (discard / fate swap) leave it at 0.
   *
   * 這段時間內**禁止繼續投放**方團團（使用者定案）。
   * Dropping is blocked for this whole window (the user's decision).
   */
  durationMs?: number;
  /**
   * 浮動的向上加速度，以**重力倍率**表示：> 1 才會淨上升（1.6 ≈ 淨 0.6g 向上）。
   * The float's upward acceleration as a **multiple of gravity**: above 1 gives a net rise
   * (1.6 ≈ 0.6g net upward).
   *
   * 用倍率而非絕對值，是因為它天生與重力同量級，換 `gravityY` 也不用重調。
   * A ratio rather than an absolute value because it is inherently the same order as gravity,
   * so retuning `gravityY` needs no follow-up here.
   */
  liftFactor?: number;
  /**
   * 搖晃時容器往復擺動的圈數（使用者定案：2 秒約 5 圈）。
   * Cycles the container oscillates through during a shake (the user's decision: about 5 in 2 s).
   */
  revolutions?: number;
  /**
   * 搖晃的位移幅度，以**容器寬度**為比例。硬上限 1/3（使用者定案）。
   * The shake's displacement amplitude as a fraction of the **container width**. Hard cap 1/3.
   */
  radiusFactor?: number;
  /**
   * 搖晃擺動軸相對水平線的傾角，度（使用者定案：15）。
   * How far the shake's oscillation axis tilts above the horizontal, in degrees (15, the user's
   * decision).
   *
   * 容器沿這條斜線往復，所以擺動天生帶一點垂直分量 —— 0 度是純水平地震，90 度是純上下震。
   * The container oscillates along that line, so the motion inherently carries a vertical
   * component: 0° is a purely horizontal quake, 90° a purely vertical one.
   */
  axisTiltDeg?: number;
  /**
   * 搖晃時持續施加的向上力，以**水平衝量的峰值**為比例（使用者定案：0.10）。
   * A steady upward force during the shake, as a fraction of the **peak horizontal impulse**
   * (0.10, the user's decision).
   *
   * 它與 `axisTiltDeg` 是兩件事：傾角讓擺動**交替**上下，這個則是固定往上的托力，讓堆疊
   * 稍微被抬起、更容易鬆開。
   * Distinct from `axisTiltDeg`: the tilt alternates up and down, while this is a constant upward
   * bias that slightly lifts the pile so it loosens more readily.
   */
  upwardFactor?: number;
  /** 命運互換時對鄰居的擾動衝量，世界單位／步。 */
  disturbance?: number;
}

export interface SkillDef {
  /** 穩定識別碼，對應 `src/game/skills/` 的處理器。 */
  id: string;
  /** 顯示名稱。 */
  name: string;
  /** 消耗技力，也決定技能格徽章的數字；免費技能為 0。 */
  cost: number;
  /** 選取方式。 */
  targeting: SkillTargeting;
  /** `user_pick` 需要依序點選幾顆；`immediate` 為 0。 */
  pickCount: number;
  /** 解鎖條件。 */
  unlock: SkillUnlock;
  /** 行為參數。 */
  params: SkillParams;
  /** 覆寫自動排序用的序號；未提供時按消耗技力排序。 */
  sortOrder?: number;
}

export interface SkillsConfig {
  sp: SpSettings;
  skills: SkillDef[];
}

/** 中央容器（平面 U 形）的外觀與擺位參數。物理不套用這些值。 */
export interface ContainerConfig {
  /** 底部兩個圓角的半徑，虛擬單位。 */
  cornerRadius: number;
  /** U 形線框粗細，虛擬單位。 */
  strokeWidth: number;
  /** U 形線框顏色。 */
  strokeColor: string;
  /** U 形內部的填充色。 */
  fill: string;
  /** U 形頂緣距畫布頂端的距離，虛擬單位。留出投放用的頭部空間。 */
  topOffset: number;
  /**
   * 投放留白，虛擬單位。決定瞄準範圍距離左右邊緣各內縮多少（再各讓開一個半徑）。
   * Drop padding in virtual units: how far the aim range is inset from the left/right edges
   * (plus one radius each). It no longer sets the drop height — that is `dropAboveRim`.
   */
  spawnGap: number;
  /**
   * 投放高度：方團團出現的位置距離 U 形**頂緣上方**多遠，虛擬單位。
   * Drop height: how far **above** the U's rim a dumpling appears, in virtual units.
   *
   * 需要它比預覽線更高的理由與溢位線相同 —— 預覽應該懸在容器之上，而不是藏在槽裡。
   * It needs its own knob so the preview can hover above the box rather than inside it.
   */
  dropAboveRim: number;
  /**
   * 溢位線距 U 形**頂緣上方**多遠，虛擬單位。
   * How far **above** the U's rim the overflow line sits, in virtual units.
   *
   * 一律比 `dropAboveRim` 小：投放點必須高於溢位線，否則每一顆一出現就立刻觸發溢位。
   * Always smaller than `dropAboveRim`: the drop point must sit above the line, or every
   * dumpling would trigger overflow the instant it appears.
   */
  overflowAboveRim: number;
  /**
   * 浮動天花板的深度：隱形平面距離 U 形**頂緣下方**多遠，虛擬單位（使用者定案：20）。
   * How far **below** the U's rim the float's invisible ceiling sits, in virtual units (20, the
   * user's decision).
   *
   * 使用者定案「警戒區下方加一片透明平面」。警戒區是頂緣與溢位線之間那條淺紅帶，所以它的
   * 下緣就是頂緣；再往下一段是為了連 sprite 的美術都不那麼容易冒出容器口（方團團的美術比
   * 碰撞體高 2.16 倍半徑，見 `SPRITE_ANCHOR`）。
   * The user's decision: "add a transparent plane below the warning zone". The warning band is
   * the strip between the rim and the overflow line, so its lower edge *is* the rim; going a
   * little deeper keeps even the artwork from poking out of the container mouth (the art reaches
   * 2.16 radii above the collider — see `SPRITE_ANCHOR`).
   *
   * 它**不影響溢位判定**：溢位看的是碰撞體上緣，而天花板保證上緣停在溢位線下方。
   * It does **not** change the overflow rule: that reads the collider's top edge, and the ceiling
   * already keeps that edge below the line.
   */
  floatCeilingBelowRim: number;
  /** 容器寬高比下限。 */
  aspectMin: number;
  /** 容器寬高比上限。 */
  aspectMax: number;
}

/** 軸對齊矩形，虛擬座標。放置於 core 是為了讓 `game/` 與 `render/` 共用而不互相依賴。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 品牌與法務文案。 */
export interface BrandingConfig {
  gameName: string;
  gameNameZh: string;
  version: string;
  notice: string;
  noticeZh: string;
  repoUrl: string;
}

/** 載入完成的完整配置。 */
export interface AllConfig {
  levels: LevelsConfig;
  skills: SkillsConfig;
  container: ContainerConfig;
  branding: BrandingConfig;
}
