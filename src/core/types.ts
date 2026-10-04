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
  /** 同一組合成後的冷卻時間，毫秒。 */
  mergeCooldownMs: number;
}

export interface LevelsConfig {
  settings: GameSettings;
  levels: LevelDef[];
}

/** 技力（SP）經濟參數。 */
export interface SpSettings {
  /** 配置上限；載入時會被鉗制到 `SP_MAX_CEILING` 以下。 */
  max: number;
  /** 開局技力。 */
  initial: number;
  /** 每次成功投放累積的技力。 */
  gainPerDrop: number;
  /** 滿值後是否允許繼續累積。 */
  overflowAllowed: boolean;
}

/** 技能的選取方式。 */
export type SkillTargeting = 'user_pick' | 'immediate';

/** 技能行為參數；不同技能使用的欄位不同，未使用的欄位留空。 */
export interface SkillParams {
  /** 浮動持續時間，毫秒。 */
  durationMs?: number;
  /** 浮動的向上力；null 表示待定。 */
  forceY?: number | null;
  /** 搖晃的水平衝量上限；null 表示待定。 */
  impulse?: number | null;
  /** 命運互換時對鄰居的擾動；null 表示待定。 */
  disturbance?: number | null;
}

export interface SkillDef {
  /** 穩定識別碼，對應 `src/game/skills/` 的處理器。 */
  id: string;
  /** 顯示名稱。 */
  name: string;
  /** 消耗技力，也決定技能格徽章的數字。 */
  cost: number;
  /** 選取方式。 */
  targeting: SkillTargeting;
  /** `user_pick` 需要依序點選幾顆；`immediate` 為 0。 */
  pickCount: number;
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
   * 投放留白，虛擬單位。同時決定兩件事：投放高度在 U 形頂緣**上方**多少、
   * 以及瞄準範圍距離左右邊緣各內縮多少（再各讓開一個半徑）。
   * Drop padding in virtual units. It sets both how far above the U's rim the drop starts
   * and how far the aim range is inset from the left/right edges (plus one radius each).
   */
  spawnGap: number;
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
