/**
 * 執行期配置載入器。
 * Runtime configuration loader.
 *
 * 唯一允許讀取 `public/config/*.json` 的地方（agent-readme §0.3）。其他模組一律
 * 透過這裡拿到的 `AllConfig`，不得自行 `fetch()`。
 * The single place allowed to read `public/config/*.json` (agent-readme §0.3).
 * Every other module consumes the `AllConfig` produced here and must not fetch
 * on its own.
 *
 * 三個原則 / Three principles:
 *
 * 1. **Fallback-first**：任何缺漏、型別錯誤或整份檔案壞掉，都降級成內建預設值，
 *    絕不讓整個遊戲因為一個參數而開不起來。
 *    Any missing field, wrong type, or broken file degrades to a built-in default;
 *    a single bad parameter never stops the game from booting.
 *
 * 2. **JSON-vs-HTML 形狀檢查**：`public/config/` 之所以放在 `public/` 而非 `src/`，
 *    就是為了讓 Vite 以靜態檔案提供。若路徑寫錯，伺服器會回 SPA fallback 的
 *    **HTML + 200**，`JSON.parse` 會拋錯，然後被靜默吞掉 —— 遊戲照跑但吃錯參數。
 *    因此這裡在 parse 之前先看開頭字元，明確報錯。
 *    The loader checks for an HTML body before parsing. Without it a wrong path
 *    returns the SPA fallback (HTML + 200), `JSON.parse` throws, and the game
 *    silently runs on defaults.
 *
 * 3. **載入期語意檢查**：例如某技能所需技力超過 `sp.max` 時它永遠解鎖不了。
 *    這種「配置自己矛盾」的情況必須發出警告，而非等玩家玩到才發現。
 *    Load-time semantic checks: a skill costing more than `sp.max` can never be
 *    unlocked. Such self-contradictory configs warn up front.
 */

import { SP_MAX_CEILING } from './constants';
import type {
  AllConfig,
  BrandingConfig,
  ContainerConfig,
  GameSettings,
  LevelDef,
  LevelsConfig,
  SkillDef,
  SkillParams,
  SkillsConfig,
  SkillTargeting,
  SpSettings,
} from './types';

/* -------------------------------------------------------------------------- *
 * 預設值 / Built-in defaults
 *
 * 這些是「配置整份壞掉」時的最後防線，數值必須與 `public/config/*.json` 同步。
 * 兩邊刻意重複：JSON 是作者調參的入口，這裡是玩家端開得起來的保證。
 * These are the last line of defence when a whole config file is unusable. The
 * values must be kept in sync with `public/config/*.json`. The duplication is
 * deliberate: the JSON is the authoring surface, these are the boot guarantee.
 * -------------------------------------------------------------------------- */

const DEFAULT_SETTINGS: GameSettings = {
  maxBodies: 80,
  gravityY: 1,
  lockRotation: false,
  spawnBlockEnabled: false,
  overflowPenalty: false,
  mergeCooldownMs: 100,
  overflowGraceMs: 3000,
  comboWindowMs: 1000,
};

/** 合成鏈 10 級（design.md D2）。順序即等級順序。 */
const DEFAULT_LEVELS: readonly LevelDef[] = [
  { id: 1, name: '萊萬汀', sprite: 'character/萊萬汀_img.webp', radius: 13.5, density: 0.001, restitution: 0.2, friction: 0.3, frictionAir: 0.005, score: 0, spawnWeight: 70, droppable: true, mergeResult: 2 },
  { id: 2, name: '潔爾佩塔', sprite: 'character/潔爾佩塔_img.webp', radius: 17.3, density: 0.001, restitution: 0.18, friction: 0.3, frictionAir: 0.005, score: 1, spawnWeight: 25, droppable: true, mergeResult: 3 },
  { id: 3, name: '伊馮', sprite: 'character/伊馮_img.webp', radius: 22.1, density: 0.001, restitution: 0.17, friction: 0.3, frictionAir: 0.005, score: 2, spawnWeight: 5, droppable: true, mergeResult: 4 },
  { id: 4, name: '湯湯', sprite: 'character/湯湯_img.webp', radius: 28.3, density: 0.001, restitution: 0.15, friction: 0.3, frictionAir: 0.005, score: 4, spawnWeight: 0, droppable: false, mergeResult: 5 },
  { id: 5, name: '洛茜', sprite: 'character/洛茜_img.webp', radius: 36.2, density: 0.001, restitution: 0.14, friction: 0.3, frictionAir: 0.005, score: 8, spawnWeight: 0, droppable: false, mergeResult: 6 },
  { id: 6, name: '莊方宜', sprite: 'character/莊方宜_img.webp', radius: 46.4, density: 0.001, restitution: 0.12, friction: 0.3, frictionAir: 0.005, score: 16, spawnWeight: 0, droppable: false, mergeResult: 7 },
  { id: 7, name: '弭弗', sprite: 'character/弭弗_img.webp', radius: 59.4, density: 0.001, restitution: 0.11, friction: 0.3, frictionAir: 0.005, score: 32, spawnWeight: 0, droppable: false, mergeResult: 8 },
  { id: 8, name: '卡繆', sprite: 'character/卡繆_img.webp', radius: 76, density: 0.001, restitution: 0.09, friction: 0.3, frictionAir: 0.005, score: 64, spawnWeight: 0, droppable: false, mergeResult: 9 },
  { id: 9, name: '訣', sprite: 'character/訣_img.webp', radius: 97.3, density: 0.001, restitution: 0.08, friction: 0.3, frictionAir: 0.005, score: 128, spawnWeight: 0, droppable: false, mergeResult: 10 },
  { id: 10, name: '梨諾', sprite: 'character/梨諾_img.webp', radius: 124.5, density: 0.001, restitution: 0.06, friction: 0.3, frictionAir: 0.005, score: 256, spawnWeight: 0, droppable: false, mergeResult: null },
];

const DEFAULT_SP: SpSettings = {
  max: 3,
  initial: 0,
  gainPerDrop: 1,
  overflowAllowed: false,
};

/** 技能表（design.md D8：數量由 JSON 決定，這裡只是壞檔時的替身）。 */
const DEFAULT_SKILLS: readonly SkillDef[] = [
  { id: 'discard', name: '捨棄', cost: 1, targeting: 'user_pick', pickCount: 1, params: {} },
  { id: 'protocol_float', name: '協議：浮動', cost: 2, targeting: 'immediate', pickCount: 0, params: { durationMs: 1500, forceY: null } },
  { id: 'shake', name: '搖晃！', cost: 3, targeting: 'immediate', pickCount: 0, params: { impulse: null, durationMs: 600 } },
  { id: 'fate_swap', name: '命運互換', cost: 4, targeting: 'user_pick', pickCount: 2, params: { disturbance: null } },
];

const DEFAULT_CONTAINER: ContainerConfig = {
  cornerRadius: 16,
  strokeWidth: 10,
  strokeColor: '#FFFFFF',
  fill: 'rgba(255, 255, 255, 0.20)',
  topOffset: 80,
  spawnGap: 8,
  dropAboveRim: 40,
  overflowAboveRim: 30,
  aspectMin: 0.62,
  aspectMax: 1.45,
};

const DEFAULT_BRANDING: BrandingConfig = {
  gameName: 'EndchiMerge',
  gameNameZh: '方團團大作戰',
  version: '0.0.0',
  notice: 'Unofficial fan project. All character names and artwork remain the property of their respective owners.',
  noticeZh: '非官方粉絲作品，所有角色名稱與美術版權歸原權利人所有。',
  repoUrl: '',
};

/* -------------------------------------------------------------------------- *
 * 小工具 / Small helpers
 * -------------------------------------------------------------------------- */

/** 回報器：所有降級都會經過它，方便測試替換成陣列收集。 */
export type ConfigWarning = (message: string) => void;

/** 可注入的 fetch 形狀，方便測試餵入假的回應。 */
export type FetchLike = (input: string) => Promise<Response>;

export interface LoadConfigOptions {
  /** 配置檔的基底路徑；預設為 Vite 的 `BASE_URL`。 */
  baseUrl?: string;
  /** 取代全域 `fetch`；測試用。 */
  fetcher?: FetchLike;
  /** 取代 `console.warn`；測試用來斷言降級訊息。 */
  onWarn?: ConfigWarning;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 每個欄位的讀取器。回傳值必定合法：缺欄位 → 用 fallback（不吵），
 * 有欄位但不合法 → 警告後用 fallback（要吵，因為這是作者填錯）。
 */
function makeReader(warn: ConfigWarning, section: string) {
  return {
    number(
      source: Record<string, unknown>,
      key: string,
      fallback: number,
      limits: { min?: number; max?: number; integer?: boolean } = {},
    ): number {
      if (!(key in source)) return fallback;
      const value = source[key];
      let valid = typeof value === 'number' && Number.isFinite(value);
      if (valid && limits.integer === true) valid = Number.isInteger(value as number);
      if (valid && limits.min !== undefined) valid = (value as number) >= limits.min;
      if (valid && limits.max !== undefined) valid = (value as number) <= limits.max;
      if (!valid) {
        warn(`${section}.${key} is invalid (${JSON.stringify(value)}); using ${String(fallback)}.`);
        return fallback;
      }
      return value as number;
    },

    string(source: Record<string, unknown>, key: string, fallback: string): string {
      if (!(key in source)) return fallback;
      const value = source[key];
      if (typeof value !== 'string' || value.trim() === '') {
        warn(`${section}.${key} is invalid (${JSON.stringify(value)}); using the default.`);
        return fallback;
      }
      return value;
    },

    boolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
      if (!(key in source)) return fallback;
      const value = source[key];
      if (typeof value !== 'boolean') {
        warn(`${section}.${key} is invalid (${JSON.stringify(value)}); using ${String(fallback)}.`);
        return fallback;
      }
      return value;
    },
  };
}

/* -------------------------------------------------------------------------- *
 * 各段配置的清理 / Per-section sanitisers
 * -------------------------------------------------------------------------- */

function sanitizeSettings(raw: unknown, warn: ConfigWarning): GameSettings {
  if (!isRecord(raw)) {
    if (raw !== undefined) warn('levels.settings is not an object; using defaults.');
    return { ...DEFAULT_SETTINGS };
  }
  const read = makeReader(warn, 'levels.settings');
  return {
    maxBodies: read.number(raw, 'maxBodies', DEFAULT_SETTINGS.maxBodies, { min: 1, integer: true }),
    /* 重力允許 0（無重力）與負值（反向），但必須是有限數，故不設 min。 */
    gravityY: read.number(raw, 'gravityY', DEFAULT_SETTINGS.gravityY),
    lockRotation: read.boolean(raw, 'lockRotation', DEFAULT_SETTINGS.lockRotation),
    spawnBlockEnabled: read.boolean(raw, 'spawnBlockEnabled', DEFAULT_SETTINGS.spawnBlockEnabled),
    overflowPenalty: read.boolean(raw, 'overflowPenalty', DEFAULT_SETTINGS.overflowPenalty),
    mergeCooldownMs: read.number(raw, 'mergeCooldownMs', DEFAULT_SETTINGS.mergeCooldownMs, { min: 0 }),
    overflowGraceMs: read.number(raw, 'overflowGraceMs', DEFAULT_SETTINGS.overflowGraceMs, { min: 0 }),
    comboWindowMs: read.number(raw, 'comboWindowMs', DEFAULT_SETTINGS.comboWindowMs, { min: 0 }),
  };
}

function sanitizeLevel(raw: unknown, index: number, warn: ConfigWarning): LevelDef {
  const fallback = DEFAULT_LEVELS[index] ?? (DEFAULT_LEVELS[DEFAULT_LEVELS.length - 1] as LevelDef);
  if (!isRecord(raw)) {
    warn(`levels[${index}] is not an object; using the built-in level ${fallback.id}.`);
    return { ...fallback };
  }
  const read = makeReader(warn, `levels[${index}]`);

  const id = read.number(raw, 'id', fallback.id, { min: 1, integer: true });

  /* mergeResult 是唯一允許 null 的欄位：null 代表終端等級，不再合成。 */
  let mergeResult: number | null = fallback.mergeResult;
  if ('mergeResult' in raw) {
    const value = raw.mergeResult;
    if (value === null) {
      mergeResult = null;
    } else if (typeof value === 'number' && Number.isInteger(value) && value >= 1) {
      mergeResult = value;
    } else {
      warn(`levels[${index}].mergeResult is invalid (${JSON.stringify(value)}); using ${String(mergeResult)}.`);
    }
  }

  return {
    id,
    name: read.string(raw, 'name', fallback.name),
    sprite: read.string(raw, 'sprite', fallback.sprite),
    radius: read.number(raw, 'radius', fallback.radius, { min: 0.5 }),
    density: read.number(raw, 'density', fallback.density, { min: 0 }),
    restitution: read.number(raw, 'restitution', fallback.restitution, { min: 0, max: 1 }),
    friction: read.number(raw, 'friction', fallback.friction, { min: 0, max: 1 }),
    frictionAir: read.number(raw, 'frictionAir', fallback.frictionAir, { min: 0 }),
    score: read.number(raw, 'score', fallback.score, { min: 0, integer: true }),
    spawnWeight: read.number(raw, 'spawnWeight', fallback.spawnWeight, { min: 0 }),
    droppable: read.boolean(raw, 'droppable', fallback.droppable),
    mergeResult,
  };
}

function sanitizeLevels(raw: unknown, warn: ConfigWarning): LevelsConfig {
  if (!isRecord(raw)) {
    warn('levels.json could not be read; using the built-in level table.');
    return { settings: { ...DEFAULT_SETTINGS }, levels: DEFAULT_LEVELS.map((level) => ({ ...level })) };
  }

  const settings = sanitizeSettings(raw.settings, warn);
  const rawLevels = raw.levels;

  if (!Array.isArray(rawLevels) || rawLevels.length === 0) {
    warn('levels.levels is missing or empty; using the built-in level table.');
    return { settings, levels: DEFAULT_LEVELS.map((level) => ({ ...level })) };
  }

  const levels = rawLevels.map((entry, index) => sanitizeLevel(entry, index, warn)).sort((a, b) => a.id - b.id);

  return { settings, levels };
}

function sanitizeSp(raw: unknown, warn: ConfigWarning): SpSettings {
  if (!isRecord(raw)) {
    if (raw !== undefined) warn('skills.sp is not an object; using defaults.');
    return { ...DEFAULT_SP };
  }
  const read = makeReader(warn, 'skills.sp');
  const requested = read.number(raw, 'max', DEFAULT_SP.max, { min: 0 });

  /* 硬上限是程式常數，JSON 不得超越（design.md D12）。 */
  if (requested > SP_MAX_CEILING) {
    warn(`skills.sp.max (${requested}) exceeds the hard ceiling; clamped to ${SP_MAX_CEILING}.`);
  }
  const max = Math.min(requested, SP_MAX_CEILING);

  const initial = read.number(raw, 'initial', DEFAULT_SP.initial, { min: 0 });
  if (initial > max) warn(`skills.sp.initial (${initial}) exceeds sp.max (${max}); it will be clamped at runtime.`);

  return {
    max,
    initial,
    gainPerDrop: read.number(raw, 'gainPerDrop', DEFAULT_SP.gainPerDrop, { min: 0 }),
    overflowAllowed: read.boolean(raw, 'overflowAllowed', DEFAULT_SP.overflowAllowed),
  };
}

function sanitizeParams(raw: unknown, fallback: SkillParams, section: string, warn: ConfigWarning): SkillParams {
  if (raw === undefined) return { ...fallback };
  if (!isRecord(raw)) {
    warn(`${section}.params is not an object; using the default.`);
    return { ...fallback };
  }
  /** 允許 null 的數值欄位：null 代表「待調」，語意上合法。 */
  const nullable = (key: keyof SkillParams, fallbackValue: number | null | undefined): number | null | undefined => {
    if (!(key in raw)) return fallbackValue;
    const value = raw[key];
    if (value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    warn(`${section}.params.${key} is invalid (${JSON.stringify(value)}); using ${String(fallbackValue)}.`);
    return fallbackValue;
  };
  return {
    durationMs: nullable('durationMs', fallback.durationMs) as number | undefined,
    forceY: nullable('forceY', fallback.forceY) as number | null | undefined,
    impulse: nullable('impulse', fallback.impulse) as number | null | undefined,
    disturbance: nullable('disturbance', fallback.disturbance) as number | null | undefined,
  };
}

function sanitizeSkill(raw: unknown, index: number, warn: ConfigWarning): SkillDef | null {
  const fallback = DEFAULT_SKILLS[index] ?? null;
  if (!isRecord(raw)) {
    warn(`skills[${index}] is not an object; skipping it.`);
    return null;
  }
  const read = makeReader(warn, `skills[${index}]`);

  /* `id` 沒有預設值：它是對應技能實作的鍵，猜錯等於接錯效果，寧可整條丟掉。 */
  const id = read.string(raw, 'id', '');
  if (id === '') {
    warn(`skills[${index}] has no usable id; skipping it.`);
    return null;
  }

  const targetingRaw = raw.targeting;
  let targeting: SkillTargeting = fallback?.targeting ?? 'immediate';
  if (targetingRaw === 'user_pick' || targetingRaw === 'immediate') {
    targeting = targetingRaw;
  } else if (targetingRaw !== undefined) {
    warn(`skills[${index}].targeting is invalid (${JSON.stringify(targetingRaw)}); using "${targeting}".`);
  }

  const defaultPick = targeting === 'user_pick' ? (fallback?.pickCount ?? 1) : 0;
  const pickCount = read.number(raw, 'pickCount', defaultPick, { min: 0, integer: true });

  const skill: SkillDef = {
    id,
    name: read.string(raw, 'name', fallback?.name ?? id),
    cost: read.number(raw, 'cost', fallback?.cost ?? 1, { min: 0 }),
    targeting,
    pickCount: targeting === 'immediate' ? 0 : pickCount,
    params: sanitizeParams(raw.params, fallback?.params ?? {}, `skills[${index}]`, warn),
  };

  if ('sortOrder' in raw) {
    const sortOrder = raw.sortOrder;
    if (typeof sortOrder === 'number' && Number.isFinite(sortOrder)) skill.sortOrder = sortOrder;
    else warn(`skills[${index}].sortOrder is invalid (${JSON.stringify(sortOrder)}); using automatic order.`);
  }

  return skill;
}

/**
 * 技能排序（design.md D13）：`sortOrder` 覆寫 > 消耗技力遞增 > 即時技能先於需選取技能。
 * Skill ordering (design.md D13): explicit `sortOrder` wins, then ascending cost,
 * then immediate skills before ones that need a target selection.
 */
function sortSkills(skills: SkillDef[]): SkillDef[] {
  return [...skills].sort((a, b) => {
    const orderA = a.sortOrder ?? Number.POSITIVE_INFINITY;
    const orderB = b.sortOrder ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) return orderA - orderB;
    if (a.cost !== b.cost) return a.cost - b.cost;
    return (a.pickCount > 0 ? 1 : 0) - (b.pickCount > 0 ? 1 : 0);
  });
}

function sanitizeSkills(raw: unknown, warn: ConfigWarning): SkillsConfig {
  if (!isRecord(raw)) {
    warn('skills.json could not be read; using the built-in skill table.');
    return { sp: { ...DEFAULT_SP }, skills: sortSkills(DEFAULT_SKILLS.map((skill) => ({ ...skill }))) };
  }

  const sp = sanitizeSp(raw.sp, warn);
  const rawSkills = raw.skills;

  if (!Array.isArray(rawSkills) || rawSkills.length === 0) {
    warn('skills.skills is missing or empty; using the built-in skill table.');
    return { sp, skills: sortSkills(DEFAULT_SKILLS.map((skill) => ({ ...skill }))) };
  }

  const skills = rawSkills
    .map((entry, index) => sanitizeSkill(entry, index, warn))
    .filter((skill): skill is SkillDef => skill !== null);

  if (skills.length === 0) {
    warn('every skills.skills entry was unusable; using the built-in skill table.');
    return { sp, skills: sortSkills(DEFAULT_SKILLS.map((skill) => ({ ...skill }))) };
  }

  return { sp, skills: sortSkills(skills) };
}

function sanitizeContainer(raw: unknown, warn: ConfigWarning): ContainerConfig {
  if (!isRecord(raw)) {
    if (raw !== undefined) warn('container.json could not be read; using defaults.');
    return { ...DEFAULT_CONTAINER };
  }
  const read = makeReader(warn, 'container');
  const aspectMin = read.number(raw, 'aspectMin', DEFAULT_CONTAINER.aspectMin, { min: 0.05, max: 10 });
  const aspectMax = read.number(raw, 'aspectMax', DEFAULT_CONTAINER.aspectMax, { min: 0.05, max: 10 });

  /* 上下限倒過來時只否決這一組，其他欄位照樣沿用作者填的值。 */
  const usableRange = aspectMin < aspectMax;
  if (!usableRange) {
    warn(`container aspect range is inverted (${aspectMin} >= ${aspectMax}); using the default range.`);
  }

  return {
    cornerRadius: read.number(raw, 'cornerRadius', DEFAULT_CONTAINER.cornerRadius, { min: 0 }),
    strokeWidth: read.number(raw, 'strokeWidth', DEFAULT_CONTAINER.strokeWidth, { min: 0 }),
    strokeColor: read.string(raw, 'strokeColor', DEFAULT_CONTAINER.strokeColor),
    fill: read.string(raw, 'fill', DEFAULT_CONTAINER.fill),
    topOffset: read.number(raw, 'topOffset', DEFAULT_CONTAINER.topOffset, { min: 0 }),
    spawnGap: read.number(raw, 'spawnGap', DEFAULT_CONTAINER.spawnGap, { min: 0 }),
    dropAboveRim: read.number(raw, 'dropAboveRim', DEFAULT_CONTAINER.dropAboveRim, { min: 0 }),
    overflowAboveRim: read.number(raw, 'overflowAboveRim', DEFAULT_CONTAINER.overflowAboveRim, { min: 0 }),
    aspectMin: usableRange ? aspectMin : DEFAULT_CONTAINER.aspectMin,
    aspectMax: usableRange ? aspectMax : DEFAULT_CONTAINER.aspectMax,
  };
}

function sanitizeBranding(raw: unknown, warn: ConfigWarning): BrandingConfig {
  if (!isRecord(raw)) {
    if (raw !== undefined) warn('branding.json could not be read; using defaults.');
    return { ...DEFAULT_BRANDING };
  }
  const read = makeReader(warn, 'branding');
  return {
    gameName: read.string(raw, 'gameName', DEFAULT_BRANDING.gameName),
    gameNameZh: read.string(raw, 'gameNameZh', DEFAULT_BRANDING.gameNameZh),
    version: read.string(raw, 'version', DEFAULT_BRANDING.version),
    notice: read.string(raw, 'notice', DEFAULT_BRANDING.notice),
    /* 非官方聲明是法定緩衝，不允許被空字串抹掉（agent-readme §0.4）。 */
    noticeZh: read.string(raw, 'noticeZh', DEFAULT_BRANDING.noticeZh),
    repoUrl: typeof raw.repoUrl === 'string' ? raw.repoUrl : DEFAULT_BRANDING.repoUrl,
  };
}

/**
 * 載入期語意檢查：技能若比技力上限還貴，就永遠解鎖不了（design.md §5.1）。
 * Semantic check: a skill costing more than `sp.max` can never be unlocked.
 */
function checkSkillUnlockability(skills: SkillsConfig, warn: ConfigWarning): void {
  for (const skill of skills.skills) {
    if (skill.cost > skills.sp.max) {
      warn(
        `skill "${skill.id}" costs ${skill.cost} SP but sp.max is ${skills.sp.max}; it can never be unlocked.`,
      );
    }
  }
}

/**
 * 載入期語意檢查：投放點必須高於溢位線。
 * Semantic check: the drop point must sit above the overflow line.
 *
 * 兩者都量自 U 形頂緣上方，所以「投放高度 > 溢位高度」才對。倒過來的話每一顆方團團一
 * 出現就越線，寬限倒數會從第一幀就開始跑。
 * Both are measured upward from the rim, so the drop height must exceed the line height.
 * Inverted, every dumpling crosses the line the instant it appears and the countdown starts
 * on frame one.
 */
function checkDropClearsOverflow(container: ContainerConfig, warn: ConfigWarning): void {
  if (container.dropAboveRim <= container.overflowAboveRim) {
    warn(
      `container.dropAboveRim (${container.dropAboveRim}) is not above overflowAboveRim ` +
        `(${container.overflowAboveRim}); dumplings would overshoot from the drop point.`,
    );
  }
}

/* -------------------------------------------------------------------------- *
 * 抓取 / Fetching
 * -------------------------------------------------------------------------- */

function joinUrl(base: string, path: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

/**
 * 抓一份 JSON。任何失敗（網路、狀態碼、HTML 回應、parse 錯誤）都回傳 null，
 * 由呼叫端退回預設值 —— 這裡不拋錯，因為「配置讀不到」不該是致命錯誤。
 * Fetch one JSON file. Every failure returns null so the caller can fall back;
 * an unreadable config must not be fatal.
 */
async function fetchJson(fetcher: FetchLike, url: string, warn: ConfigWarning): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (error) {
    warn(`${url} could not be fetched (${String(error)}); using defaults.`);
    return null;
  }

  if (!response.ok) {
    warn(`${url} responded ${response.status}; using defaults.`);
    return null;
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    warn(`${url} body could not be read (${String(error)}); using defaults.`);
    return null;
  }

  /* SPA fallback 會以 200 回傳 HTML，parse 前先擋掉，否則會被靜默吞掉。 */
  if (text.trimStart().startsWith('<')) {
    warn(`${url} returned HTML instead of JSON (wrong path or SPA fallback); using defaults.`);
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    warn(`${url} is not valid JSON (${String(error)}); using defaults.`);
    return null;
  }
}

/**
 * 載入全部配置。四份檔案並行抓取，各自獨立降級 —— 一份壞掉不影響其他三份。
 * Load every config file. The four fetches run in parallel and degrade
 * independently, so one broken file does not take the rest down with it.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<AllConfig> {
  const warn: ConfigWarning = options.onWarn ?? ((message: string): void => console.warn(`[config] ${message}`));
  const base = options.baseUrl ?? import.meta.env.BASE_URL;
  const fetcher: FetchLike = options.fetcher ?? ((input: string): Promise<Response> => fetch(input));

  const [levelsRaw, skillsRaw, containerRaw, brandingRaw] = await Promise.all([
    fetchJson(fetcher, joinUrl(base, 'config/levels.json'), warn),
    fetchJson(fetcher, joinUrl(base, 'config/skills.json'), warn),
    fetchJson(fetcher, joinUrl(base, 'config/container.json'), warn),
    fetchJson(fetcher, joinUrl(base, 'config/branding.json'), warn),
  ]);

  const levels = sanitizeLevels(levelsRaw, warn);
  const skills = sanitizeSkills(skillsRaw, warn);
  const container = sanitizeContainer(containerRaw, warn);

  checkSkillUnlockability(skills, warn);
  checkDropClearsOverflow(container, warn);

  return {
    levels,
    skills,
    container,
    branding: sanitizeBranding(brandingRaw, warn),
  };
}
