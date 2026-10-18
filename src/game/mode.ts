/**
 * 玩法模式：一個模式決定等級表與技能名單，模式之間的分數不可直接比較。
 * Play modes: a mode picks the level table and the skill roster; scores across modes are not comparable.
 */

import { STORAGE_KEYS } from '../core/constants';
import type { MessageKey } from '../i18n';

export type ModeId = 'new' | 'traditional';

/** 未設定偏好時的模式：新玩法（`levels_new.json`）。 */
export const DEFAULT_MODE: ModeId = 'new';

/** 所有模式，順序即設定頁的顯示順序。 */
export const MODE_IDS: readonly ModeId[] = ['new', 'traditional'];

export interface ModeDefinition {
  readonly id: ModeId;
  /** 等級表檔案，相對於 `BASE_URL`。 */
  readonly levelsFile: string;
  /** 顯示名稱的語系鍵。 */
  readonly labelKey: MessageKey;
  /**
   * 本地儲存鍵的後綴。新玩法留空 —— 舊存檔與伺服器資料都落在不加後綴的鍵上，
   * 升級不會把既有玩家的最高分與本機紀錄弄丟。
   * The local storage suffix; empty for the new mode so existing saves and server rows keep their keys.
   */
  readonly keySuffix: string;
}

const DEFINITIONS: Readonly<Record<ModeId, ModeDefinition>> = {
  new: {
    id: 'new',
    levelsFile: 'config/levels_new.json',
    labelKey: 'mode.new',
    keySuffix: '',
  },
  traditional: {
    id: 'traditional',
    levelsFile: 'config/levels.json',
    labelKey: 'mode.traditional',
    keySuffix: ':traditional',
  },
};

export function modeDefinition(id: ModeId): ModeDefinition {
  return DEFINITIONS[id];
}

export function isModeId(value: unknown): value is ModeId {
  return value === 'new' || value === 'traditional';
}

/**
 * 榜的模式篩選：一個具體模式，或 `'all'`（兩個模式一起列）。
 * A board's mode filter: one mode, or `'all'` (both listed together).
 */
export type BoardMode = 'all' | ModeId;

/** 篩選選項，順序即榜上的顯示順序。 */
export const BOARD_MODES: readonly BoardMode[] = ['all', 'new', 'traditional'];

export function boardModeLabelKey(mode: BoardMode): MessageKey {
  switch (mode) {
    case 'all':
      return 'leaderboard.mode.all';
    case 'new':
      return 'leaderboard.mode.new';
    case 'traditional':
      return 'leaderboard.mode.traditional';
  }
}

/** 篩選值 → 查詢用的模式；`'all'` 對應 `null`。 */
export function modeFilterValue(mode: BoardMode): ModeId | null {
  return mode === 'all' ? null : mode;
}

/**
 * 這個模式專屬的本地儲存鍵：榜上身份、最高分、圖鑑解鎖進度都是各模式一份。
 * The local storage keys for one mode: board identity, high score and compendium unlocks are kept per mode.
 */
export function modeKeys(id: ModeId): {
  readonly profile: string;
  readonly highScore: string;
  readonly unlocks: string;
} {
  const { keySuffix } = modeDefinition(id);

  return {
    profile: `${STORAGE_KEYS.profile}${keySuffix}`,
    highScore: `${STORAGE_KEYS.highScore}${keySuffix}`,
    unlocks: `${STORAGE_KEYS.unlocks}${keySuffix}`,
  };
}
