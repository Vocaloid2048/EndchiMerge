/**
 * 全域型別定義：形狀與 `public/config/*.json` 逐一對應，描述的是載入器檢查通過後的形狀。
 * Global type definitions mirroring `public/config/*.json` one-to-one; they describe the shape *after* the loader's validation.
 */

import type { Locale } from '../i18n/locale';

/**
 * 依語系覆寫的顯示名稱；只有專有名詞（角色名、技能名）需要它，未列出的語系回退到 `name`。
 * Display names overridden per locale; only proper nouns (characters, skills) need it, and unlisted locales fall back to `name`.
 */
export type LocaleNames = Partial<Record<Locale, string>>;

/**
 * 單一等級（方團團）的靜態定義。
 * The static definition of one level (one dumpling).
 */
export interface LevelDef {
  /**
   * 1 為底的等級編號，也是合成鏈的索引。
   * The 1-based level id, also the merge chain's index.
   */
  id: number;
  /**
   * 顯示名稱（預設語言；其餘語系見 `names`）。
   * The display name (default language; other locales in `names`).
   */
  name: string;
  /**
   * 依語系覆寫的名稱；未列出的語系用 `name`。
   * Per-locale name overrides; unlisted locales use `name`.
   */
  names?: LocaleNames;
  /**
   * 相對於 `public/assets/` 的路徑，例如 `character/萊萬汀_img.webp`。
   * The sprite path relative to `public/assets/`, e.g. `character/萊萬汀_img.webp`.
   */
  sprite: string;
  /**
   * 碰撞圓半徑，虛擬單位。
   * The collision circle's radius, in virtual units.
   */
  radius: number;
  /**
   * 密度；質量 = 密度 × 圓面積。
   * Density; mass = density × circle area.
   */
  density: number;
  /**
   * 彈性係數。
   * Restitution.
   */
  restitution: number;
  /**
   * 接觸摩擦。
   * Contact friction.
   */
  friction: number;
  /**
   * 空氣阻力。
   * Air friction.
   */
  frictionAir: number;
  /**
   * 由合成產生時獲得的分數；Lv1 永不經由合成產生，故為 0。
   * The score awarded when produced by a merge; Lv1 is never merged into, so it is 0.
   */
  score: number;
  /**
   * 掉落抽取的相對權重；0 表示不作為掉落物。
   * The relative weight for spawn picking; 0 means never dropped.
   */
  spawnWeight: number;
  /**
   * 是否可被投放。
   * Whether this level may be dropped.
   */
  droppable: boolean;
  /**
   * 合成後的等級編號；最高級為 null。
   * The level this merges into; `null` for the top level.
   */
  mergeResult: number | null;
}

/**
 * 與等級無關的全域遊戲設定。
 * Global game settings, independent of any level.
 */
export interface GameSettings {
  /**
   * 場上同時存在的物體上限，超過即視為溢出。
   * The maximum number of bodies on the field; exceeding it counts as overflow.
   */
  maxBodies: number;
  /**
   * 重力加速度（Matter.js 的 `gravity.y`）；可調參數，以虛擬單位定義，換裝置不變。
   * Gravitational acceleration (Matter.js' `gravity.y`); a tuning knob in virtual units, unchanged across devices.
   */
  gravityY: number;
  /**
   * 是否鎖定方團團的旋轉：`false`（預設）＝ 依真實物理翻滾；`true` ＝ 慣量無限大、永遠正立。
   * Whether rotation is locked: `false` (default) leaves it to the physics; `true` sets infinite inertia and keeps every sprite upright.
   */
  lockRotation: boolean;
  /**
   * 是否禁止在特定條件下繼續投放。
   * Whether dropping may be blocked under certain conditions.
   */
  spawnBlockEnabled: boolean;
  /**
   * 溢出時是否直接扣分結束，或僅提示。
   * Whether overflow ends the run with a penalty, or only warns.
   */
  overflowPenalty: boolean;
  /**
   * 同一顆剛體生成後多久內不得合成，毫秒。
   * How long after spawning a body may not merge, in ms.
   */
  mergeCooldownMs: number;
  /**
   * 堆疊越過溢位線後，玩家還有多少時間處理，毫秒；逾時即結束這一局。
   * How long the player has to clear a breach, in ms; running out ends the run.
   */
  overflowGraceMs: number;
  /**
   * 兩次投放之間的最短間隔，毫秒；間隔內的投放輸入一律忽略。
   * The minimum spacing between two drops, in ms; input inside the gap is ignored.
   */
  dropCooldownMs: number;
}

export interface LevelsConfig {
  settings: GameSettings;
  levels: LevelDef[];
}

/**
 * 技力（SP）經濟參數。
 * The SP economy parameters.
 */
export interface SpSettings {
  /**
   * 配置上限；載入時鉗制到 `[SP_MIN, SP_MAX_CEILING]`（1–10 的正整數）。
   * The configured cap, clamped to `[SP_MIN, SP_MAX_CEILING]` (a positive integer 1–10).
   *
   * 它同時是技力條的段數（一點一條），所以只接受正整數。
   * It doubles as the meter's segment count (one pill per point), hence the integer restriction.
   */
  max: number;
  /**
   * 開局技力。
   * SP at the start of a run.
   */
  initial: number;
  /**
   * 每次成功投放累積的技力。
   * SP gained per successful drop.
   */
  gainPerDrop: number;
  /**
   * 每次合成（＝每次 combo）累積的技力。
   * SP gained per merge (each combo step).
   */
  gainPerCombo: number;
  /**
   * 滿值後是否允許繼續累積。
   * Whether gains continue past the cap.
   */
  overflowAllowed: boolean;
}

/**
 * 技能的選取方式。
 * How a skill is targeted.
 */
export type SkillTargeting = 'user_pick' | 'immediate';

/**
 * 技能的解鎖條件：`sp` ＝ 當前技力 ≥ 消耗（扣費後即時上鎖）；
 * `cumulativeSpent` ＝ 累計消耗滿 `threshold` 才解鎖且免費，用後累計歸零、重新上鎖；
 * `cumulativeUses` ＝ 本局施放技能滿 `threshold` 次才解鎖且免費，用後次數歸零、重新上鎖。
 * A skill's unlock condition: `sp` while current SP ≥ cost (locked again once spent);
 * `cumulativeSpent` after `threshold` total spend, then free and the total resets on use;
 * `cumulativeUses` after `threshold` casts this run, then free and the cast count resets on use.
 */
export type SkillUnlock =
  | { kind: 'sp' }
  | { kind: 'cumulativeSpent'; threshold: number }
  | { kind: 'cumulativeUses'; threshold: number };

/**
 * 技能行為參數；不同技能使用的欄位不同，未使用的欄位留空。
 * Skill behaviour parameters; each skill uses its own subset, the rest left empty.
 */
export interface SkillParams {
  /**
   * 「作用中」的持續時間，毫秒；這段時間內禁止繼續投放。瞬發技能不設。
   * How long the effect stays active, in ms; dropping is blocked for the window. Instant skills omit it.
   */
  durationMs?: number;
  /**
   * 浮動的向上加速度，以重力倍率表示：> 1 才會淨上升（用倍率讓它與 `gravityY` 同量級）。
   * The float's upward acceleration as a multiple of gravity: above 1 gives a net rise (a ratio stays commensurate with `gravityY`).
   */
  liftFactor?: number;
  /**
   * 浮動的追趕倍率：浮動期間仍落在天花板帶下方的顆粒，每步額外獲得此倍率重力的向上力；
   * 讓「整堆都升上去」由機制保證。省略時由 `FloatSkill` 給預設。
   * The float's catch-up factor: bodies still below the ceiling band earn this many extra gravities upward per step, guaranteeing the whole pile rises. `FloatSkill` supplies a default when omitted.
   */
  catchupFactor?: number;
  /**
   * 搖晃時容器往復擺動的圈數。
   * Cycles the container oscillates through during a shake.
   */
  revolutions?: number;
  /**
   * 搖晃的位移幅度，以容器寬度為比例；硬上限 1/3。
   * The shake's displacement amplitude as a fraction of the container width; hard cap 1/3.
   */
  radiusFactor?: number;
  /**
   * 搖晃擺動軸相對水平線的傾角，度；0 ＝ 純水平地震，90 ＝ 純上下震。
   * The swing axis' tilt above horizontal, in degrees; 0 ＝ a purely horizontal quake, 90 ＝ purely vertical.
   */
  axisTiltDeg?: number;
  /**
   * 搖晃時持續施加的向上力，以水平衝量峰值為比例；與 `axisTiltDeg` 不同 —— 那是交替上下，這是固定托力。
   * A steady upward force during the shake, as a fraction of the peak horizontal impulse; distinct from `axisTiltDeg`, which alternates up and down.
   */
  upwardFactor?: number;
  /**
   * 命運互換時對鄰居的擾動衝量，世界單位／步。
   * The disturbance impulse on neighbours during a fate swap, in world units per step.
   */
  disturbance?: number;
  /**
   * 重新洗牌要降下幾顆方團團。
   * How many dumplings a reshuffle rains down.
   */
  count?: number;
  /**
   * 連擊護盾要保護幾次投放。
   * How many drops a combo shield covers.
   */
  drops?: number;
  /**
   * 縮小技能的目標半徑，虛擬單位。
   * The target radius of the shrink skill, in virtual units.
   */
  radius?: number;
  /**
   * 「以方代圓」的核心正方形倍率；1 ＝ 邊長 `2r`。
   * The core square's scale for "Square Rule"; 1 means a side of `2r`.
   */
  sizeFactor?: number;
}

/**
 * 單一技能的定義。
 * The definition of one skill.
 */
export interface SkillDef {
  /**
   * 穩定識別碼，對應 `src/game/skills/` 的處理器。
   * The stable id, matching a handler in `src/game/skills/`.
   */
  id: string;
  /**
   * 顯示名稱（預設語言；其餘語系見 `names`）。
   * The display name (default language; other locales in `names`).
   */
  name: string;
  /**
   * 依語系覆寫的名稱；未列出的語系用 `name`。
   * Per-locale name overrides; unlisted locales use `name`.
   */
  names?: LocaleNames;
  /**
   * 消耗技力，也決定技能格徽章的數字；免費技能為 0。
   * The SP cost, also the badge number on the skill card; 0 for free skills.
   */
  cost: number;
  /**
   * 選取方式。
   * The targeting mode.
   */
  targeting: SkillTargeting;
  /**
   * `user_pick` 需要依序點選幾顆；`immediate` 為 0。
   * How many targets `user_pick` needs, in order; 0 for `immediate`.
   */
  pickCount: number;
  /**
   * 解鎖條件。
   * The unlock condition.
   */
  unlock: SkillUnlock;
  /**
   * 行為參數。
   * Behaviour parameters.
   */
  params: SkillParams;
  /**
   * 覆寫自動排序用的序號；未提供時按消耗技力排序。
   * Overrides the automatic sort order; defaults to sorting by cost.
   */
  sortOrder?: number;
}

export interface SkillsConfig {
  sp: SpSettings;
  skills: SkillDef[];
}

/**
 * 中央容器（平面 U 形）的外觀與擺位參數；物理不套用這些值。
 * Appearance and placement parameters of the central container (a flat U); physics does not consume these.
 */
export interface ContainerConfig {
  /**
   * 底部兩個圓角的半徑，虛擬單位。
   * The two bottom corners' radius, in virtual units.
   */
  cornerRadius: number;
  /**
   * U 形線框粗細，虛擬單位。
   * The U's stroke width, in virtual units.
   */
  strokeWidth: number;
  /**
   * U 形線框顏色。
   * The U's stroke colour.
   */
  strokeColor: string;
  /**
   * U 形內部的填充色。
   * The U's interior fill.
   */
  fill: string;
  /**
   * U 形頂緣距畫布頂端的距離，虛擬單位；留出投放用的頭部空間。
   * The U's rim distance from the canvas top, in virtual units; headroom for dropping.
   */
  topOffset: number;
  /**
   * 投放留白，虛擬單位：瞄準範圍距離左右邊緣各內縮多少（再各讓開一個半徑）。
   * Drop padding in virtual units: how far the aim range is inset from each edge (plus one radius).
   */
  spawnGap: number;
  /**
   * 投放高度：方團團出現的位置距離 U 形頂緣上方多遠，虛擬單位（預覽要懸在容器之上）。
   * The drop height: how far above the U's rim a dumpling appears, in virtual units (the preview hovers above the box).
   */
  dropAboveRim: number;
  /**
   * 溢位線距 U 形頂緣上方多遠，虛擬單位；一律比 `dropAboveRim` 小，
   * 否則每一顆一出現就立刻觸發溢位。
   * How far above the U's rim the overflow line sits, in virtual units; always smaller than `dropAboveRim`, or every dumpling triggers overflow the instant it appears.
   */
  overflowAboveRim: number;
  /**
   * 技能天花板的深度：隱形平面距離 U 形頂緣下方多遠，虛擬單位。
   * How far below the U's rim the invisible skill ceiling sits, in virtual units.
   *
   * 協議：浮動與搖晃！共用同一個深度（兩者要的都是「把顆粒封在容器口以下」），
   * 且不影響溢位判定 —— 溢位看的是碰撞體上緣，天花板保證它停在溢位線下方。
   * Protocol: Float and Shake! share one depth (both want bodies sealed below the container mouth), and it does not change the overflow rule — that reads the collider's top edge, which the ceiling keeps below the line.
   */
  floatCeilingBelowRim: number;
  /**
   * 容器底部的托高量：U 形外框底緣距離畫布底端多遠，虛擬單位。
   * How far the U's outer box bottom sits above the canvas bottom, in virtual units.
   *
   * 給容器下方的技能選取提示留一條帶；物理地板跟著 `frame` 走，可玩深度等量變淺。
   * Leaves a strip for the skill-selection hint below the container; the physics floor follows `frame`, so the play depth shrinks by the same amount.
   */
  bottomOffset: number;
  /**
   * 容器左右兩側的展示餘裕，虛擬單位；容器寬度不變（畫布的虛擬寬度同步加寬，兩者相抵）。
   * The container's display margin on each side, in virtual units; the container width is unchanged (the canvas' virtual width grows to match).
   *
   * 兩個用途：給搖晃左右移動留 room（水平幅度被夾在餘裕內），以及讓裁切範圍是
   * 「外框 ＋ 兩側餘裕」，貼牆的方團團在容器晃動時不會被裁掉半邊。
   * Two jobs: room to shake (the horizontal amplitude is clamped inside the margin), and a clip region of box-plus-margins so wall-hugging dumplings are not sliced while the container moves.
   */
  leftOffset: number;
  /** 右側的展示餘裕，語意同 `leftOffset`。 / Right-hand display margin; see `leftOffset`. */
  rightOffset: number;
  /**
   * 容器寬高比下限。
   * The container aspect ratio's lower bound.
   */
  aspectMin: number;
  /**
   * 容器寬高比上限。
   * The container aspect ratio's upper bound.
   */
  aspectMax: number;
}

/**
 * 軸對齊矩形，虛擬座標。放置於 core 是為了讓 `game/` 與 `render/` 共用而不互相依賴。
 * An axis-aligned rectangle in virtual coordinates; it lives in `core` so `game/` and `render/` share it without depending on each other.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 品牌與法務文案。
 * Branding and legal copy.
 */
export interface BrandingConfig {
  gameName: string;
  gameNameZh: string;
  version: string;
  notice: string;
  noticeZh: string;
  repoUrl: string;
}

/**
 * 載入完成的完整配置。
 * The fully loaded configuration.
 */
export interface AllConfig {
  levels: LevelsConfig;
  skills: SkillsConfig;
  container: ContainerConfig;
  branding: BrandingConfig;
}
