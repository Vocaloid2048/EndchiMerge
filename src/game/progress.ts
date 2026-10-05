/**
 * 本地 meta-progression：解鎖進度與最高分。
 * Local meta-progression: unlock progress and high score.
 *
 * 依 `design.md` D5：**首次解鎖永久保留，跨局不重設**。所以解鎖狀態不能存在 `GameSession`
 * （那個物件每次開局都會重建），必須活在一個比單局更長命的地方，並且寫進 `localStorage`。
 * Per D5 the first unlock is permanent and survives across runs, so the state cannot live in
 * `GameSession` (rebuilt every run). It needs an owner that outlives a run and persists to
 * `localStorage`.
 *
 * **這裡只做儲存與集合運算**，不含任何「什麼時候該解鎖」的規則 —— 那屬於 `GameSession`
 * （合成出新等級時）。把兩件事分開，才測得出「存了什麼」而不必先跑一場遊戲。
 * This module only stores and does set arithmetic; *when* to unlock is `GameSession`'s
 * business. Keeping them apart lets the storage be tested without playing a run first.
 *
 * 儲存體是**可注入**的：瀏覽器在無痕模式或關閉 cookie 時 `localStorage` 會直接拋錯，
 * 注入介面讓測試能餵一個假的，也讓瀏覽器端能退回「只活在記憶體裡」。
 * The storage is **injectable**: `localStorage` throws outright in private mode or with
 * cookies disabled, so an interface lets tests inject a fake and the browser fall back to
 * memory-only.
 */

import { STORAGE_KEYS } from '../core/constants';

/** 這個模組對儲存體的最小需求；`localStorage` 在結構上已滿足。 */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProgressStoreOptions {
  /**
   * 一律視為已解鎖的等級；通常是合成鏈首（Lv1）。沒有它，開局會完全沒有東西可掉。
   * Levels that are always unlocked — normally the head of the merge chain. Without one
   * there would be nothing to drop at all.
   */
  baseline?: readonly number[];
  /** 注入儲存體；未提供時用 `localStorage`，不可用時退回記憶體。 */
  storage?: ProgressStorage | null;
  /** 覆寫儲存鍵；測試用。 */
  keys?: { unlocks?: string; highScore?: string };
}

export interface ProgressStore {
  /** 已解鎖的等級編號（含 baseline）。這是**活的**集合，解鎖後內容會變。 */
  readonly unlocked: ReadonlySet<number>;
  has(id: number): boolean;
  /** 解鎖一個等級；回傳**是否為新的解鎖**（用來決定要不要播提示）。 */
  unlock(id: number): boolean;
  /** 歷史最高分。 */
  readonly highScore: number;
  /** 記錄一次分數；回傳更新後的最高分。 */
  recordScore(score: number): number;
  /**
   * 訂閱解鎖變更；回傳取消訂閱的函式。
   * Subscribe to unlock changes; returns an unsubscribe function.
   *
   * 名冊要靠它即時把 `???` 換成角色圖，而不必每幀輪詢。
   * The roster uses it to swap `???` for art immediately rather than polling every frame.
   */
  onChange(listener: () => void): () => void;
}

/** 從任意來源取值並轉成正整數；不合法就回傳 null。 */
function toLevelId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/** 解析解鎖清單；壞掉或格式不符一律當作空的（不是致命錯誤）。 */
function parseUnlocks(text: string | null): number[] {
  if (text === null) return [];

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    const ids: number[] = [];
    for (const entry of parsed) {
      const id = toLevelId(entry);
      if (id !== null) ids.push(id);
    }

    return ids;
  } catch {
    return [];
  }
}

/** 解析最高分；壞掉視為 0。 */
function parseHighScore(text: string | null): number {
  if (text === null) return 0;

  const value = Number(text);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 取得預設儲存體；瀏覽器端不可用時回傳 null。 */
function defaultStorage(): ProgressStorage | null {
  try {
    /* `localStorage` 在某些瀏覽器設定下光是存取就拋錯，所以要包起來。 */
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createProgressStore(options: ProgressStoreOptions = {}): ProgressStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const unlockKey = options.keys?.unlocks ?? STORAGE_KEYS.unlocks;
  const highScoreKey = options.keys?.highScore ?? STORAGE_KEYS.highScore;

  const unlocked = new Set<number>();
  for (const id of options.baseline ?? []) {
    const valid = toLevelId(id);
    if (valid !== null) unlocked.add(valid);
  }

  if (storage !== null) {
    for (const id of parseUnlocks(readItem(storage, unlockKey))) unlocked.add(id);
  }

  let highScore = storage === null ? 0 : parseHighScore(readItem(storage, highScoreKey));
  const listeners = new Set<() => void>();

  return {
    get unlocked(): ReadonlySet<number> {
      return unlocked;
    },

    has(id: number): boolean {
      return unlocked.has(id);
    },

    unlock(id: number): boolean {
      const valid = toLevelId(id);
      if (valid === null || unlocked.has(valid)) return false;

      unlocked.add(valid);
      if (storage !== null) writeItem(storage, unlockKey, JSON.stringify([...unlocked].sort((a, b) => a - b)));

      for (const listener of listeners) listener();

      return true;
    },

    get highScore(): number {
      return highScore;
    },

    recordScore(score: number): number {
      const value = Number.isFinite(score) ? Math.floor(score) : 0;
      if (value <= highScore) return highScore;

      highScore = value;
      if (storage !== null) writeItem(storage, highScoreKey, String(highScore));

      return highScore;
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

/** 讀取；儲存體拋錯時視為沒有值。 */
function readItem(storage: ProgressStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 寫入；配額爆掉或無痕模式擋寫時**不應**讓遊戲崩掉，因此吞掉錯誤。 */
function writeItem(storage: ProgressStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* 寫不進去只是這次的進度不會保存，玩法本身不受影響。 */
  }
}
