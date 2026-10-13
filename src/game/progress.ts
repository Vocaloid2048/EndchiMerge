/**
 * 本地 meta 進度：解鎖集合與最高分，只做儲存與集合運算，寫入可注入的儲存層。
 * Local meta-progression: the unlock set and the high score, stored through an injectable backend.
 */

import { STORAGE_KEYS } from '../core/constants';
import { createLocalStore, type LocalStore, type StorageBackend } from './localStore';

export interface ProgressStoreOptions {
  /**
   * 一律視為已解鎖的等級（通常是合成鏈首）；沒有它開局會完全沒有東西可掉。
   * Levels that are always unlocked (normally the chain head); without one nothing could drop.
   */
  baseline?: readonly number[];
  /**
   * 共用的本地儲存層；寫入會推進全機的 `revision`（同步靠它判斷有沒有東西要上載）。
   * The shared local store; writes here advance the machine-wide `revision` that sync reads.
   */
  store?: LocalStore;
  storage?: StorageBackend | null;
  keys?: { unlocks?: string; highScore?: string };
}

export interface ProgressStore {
  /**
   * 已解鎖的等級編號（含 baseline）；這是**活的**集合，解鎖後內容會變。
   * The unlocked level ids (including the baseline); a **live** set that changes on unlock.
   */
  readonly unlocked: ReadonlySet<number>;
  has(id: number): boolean;
  /**
   * 解鎖一個等級；回傳**是否為新的解鎖**。
   * Unlock a level; returns whether it was newly unlocked.
   */
  unlock(id: number): boolean;
  readonly highScore: number;
  recordScore(score: number): number;
  /**
   * 訂閱解鎖變更；回傳取消訂閱的函式。
   * Subscribe to unlock changes; returns an unsubscribe function.
   */
  onChange(listener: () => void): () => void;
}

/**
 * 從任意來源取值並轉成正整數（≥ 1）；不合法就回傳 `null`。
 * Coerce a value from any source into a positive integer; `null` when invalid.
 */
function toLevelId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * 解析解鎖清單；壞掉或格式不符一律當作空的（不是致命錯誤）。
 * Parse the unlock list; anything malformed yields an empty list.
 */
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

function parseHighScore(text: string | null): number {
  if (text === null) return 0;

  const value = Number(text);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function createProgressStore(options: ProgressStoreOptions = {}): ProgressStore {
  const unlockKey = options.keys?.unlocks ?? STORAGE_KEYS.unlocks;
  const highScoreKey = options.keys?.highScore ?? STORAGE_KEYS.highScore;

  /* 自建的 store 要宣告自己這兩個鍵（解鎖、最高分）要同步；測試會覆寫鍵名，不能靠預設名單。
   * A private store must be told these two keys sync; tests override key names, so no default list works. */
  const local = options.store ?? createLocalStore({
    storage: options.storage,
    syncedKeys: [unlockKey, highScoreKey],
  });

  const unlocked = new Set<number>();
  for (const id of options.baseline ?? []) {
    const valid = toLevelId(id);
    if (valid !== null) unlocked.add(valid);
  }

  for (const id of parseUnlocks(local.read(unlockKey))) unlocked.add(id);

  let highScore = parseHighScore(local.read(highScoreKey));
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
      local.writeJson(unlockKey, [...unlocked].sort((a, b) => a - b));

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
      local.write(highScoreKey, String(highScore));

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
