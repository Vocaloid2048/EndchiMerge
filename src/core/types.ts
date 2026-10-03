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
  /** `public/assets/sprites/` 底下的檔名。 */
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
  /** 瞄準指示線距容器頂端的距離，虛擬單位。 */
  aimY: number;
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

/** 中央容器的 3D 裝飾外框參數。物理不套用這些值。 */
export interface ContainerConfig {
  cornerRadius: number;
  strokeWidth: number;
  strokeColor: string;
  /** 後緣相對前緣的水平偏移，虛擬單位。 */
  perspectiveDx: number;
  /** 後緣相對前緣的垂直偏移，虛擬單位。 */
  perspectiveDy: number;
  /** 前表面染色。 */
  frontTint: string;
  /** 後表面染色。 */
  backTint: string;
  /** 容器寬高比下限。 */
  aspectMin: number;
  /** 容器寬高比上限。 */
  aspectMax: number;
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
