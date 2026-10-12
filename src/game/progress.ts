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
 * 實際的解析與 try/catch 已經收攏到 `game/localStore.ts`（M7-3），這裡只決定**存什麼**。
 * The storage is **injectable**: `localStorage` throws outright in private mode or with
 * cookies disabled, so an interface lets tests inject a fake and the browser fall back to
 * memory-only. The actual resolution and try/catch now live in `game/localStore.ts` (M7-3);
 * this module only decides **what** gets stored.
 */

import { STORAGE_KEYS } from '../core/constants';
import { createLocalStore, type LocalStore, type StorageBackend } from './localStore';

export interface ProgressStoreOptions {
  /**
   * 一律視為已解鎖的等級；通常是合成鏈首（Lv1）。沒有它，開局會完全沒有東西可掉。
   * Levels that are always unlocked — normally the head of the merge chain. Without one
   * there would be nothing to drop at all.
   */
  baseline?: readonly number[];
  /**
   * 共用的本地儲存層。給了它，這裡的寫入就會推進**全機**的 `revision`（M7 的同步靠它判斷
   * 「有沒有東西要上載」）。
   * The shared local store. With it, writes here advance the **machine-wide** `revision` that
   * M7's sync uses to answer "is there anything to upload".
   */
  store?: LocalStore;
  /** 自行注入儲存體；未提供 `store` 時才用（測試會走這條，自建一個只屬於自己的 store）。 */
  storage?: StorageBackend | null;
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

export function createProgressStore(options: ProgressStoreOptions = {}): ProgressStore {
  const unlockKey = options.keys?.unlocks ?? STORAGE_KEYS.unlocks;
  const highScoreKey = options.keys?.highScore ?? STORAGE_KEYS.highScore;

  /*
   * 自建 store 時要宣告**自己這兩個鍵**要同步：解鎖清單與最高分都是伺服器要收到的（§6.2
   * 「解鎖取聯集、最高分取大」）。測試會覆寫鍵名，所以不能靠 store 的預設名單。
   * A private store is told that **these two keys** sync — the unlock set and the high score are
   * both server-bound (§6.2). Tests override key names, so the default list would not match.
   */
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
