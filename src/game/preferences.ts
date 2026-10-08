/**
 * 玩家偏好設定。
 * Player preferences.
 *
 * 三個值，都住在同一個 JSON blob 裡（`endchimerge:preferences`，常數早就定義好但一直沒人用）：
 * Three values, all in one JSON blob (`endchimerge:preferences` — the key has existed since the
 * beginning but nothing used it):
 *
 * - **語系**：介面語言。首次執行時**跟隨裝置／瀏覽器語言**（使用者定案），之後以存檔為準。
 * - **`rulesEnabled`（規則變更總開關）**：使用者定案的閘門。開啟後才可調整其他規則，而且
 *   **開啟期間的成績一律不記入排行榜**。這是「這局算不算數」的單一判準，所以放在資料層
 *   而不是散在 UI 裡。
 * - **`endless`（無盡模式）**：越過警戒線不再觸發 5 秒警告與結束。只有在總開關開啟時才有
 *   效，因此關閉總開關會一併把它關掉。
 *
 * - **Locale**: the interface language, **following the device/browser language on first run**
 *   (the user's decision) and the saved value afterwards.
 * - **`rulesEnabled`**: the master gate the user decided on. Only with it on can the other rules
 *   be adjusted, and **while it is on nothing is recorded on the leaderboard**. It is the single
 *   answer to "does this run count", so it lives in the data layer rather than scattered in the UI.
 * - **`endless`**: crossing the warning line no longer triggers the 5-second warning or the end
 *   of the run. It only applies while the master gate is on, so closing the gate closes it too.
 *
 * 與 `game/progress.ts`、`game/leaderboard.ts` 的分工相同：這裡只做「讀寫 + 通知」，不含任何
 * 遊戲規則，也不碰 DOM。
 * The split matches `game/progress.ts` and `game/leaderboard.ts`: read, write and notify only —
 * no game rules, no DOM.
 */

import { STORAGE_KEYS } from '../core/constants';
import { detectBrowserLocale, isLocale, type Locale } from '../i18n/locale';
import type { ProgressStorage } from './progress';

/** 偏好的完整內容。 */
export interface Preferences {
  locale: Locale;
  /** 規則變更總開關；開啟期間成績不記入排行榜。 */
  rulesEnabled: boolean;
  /** 無盡模式；僅在 `rulesEnabled` 為真時有效。 */
  endless: boolean;
}

export interface PreferencesOptions {
  /** 注入儲存體；未提供時用 `localStorage`，不可用時退回記憶體（不持久化）。 */
  storage?: ProgressStorage | null;
  /** 覆寫儲存鍵；測試用。 */
  key?: string;
  /**
   * 尚未有存檔時的語系。未提供時讀裝置／瀏覽器語言，讀不到才用預設語系（繁中）。
   * The locale to use before anything is saved. When omitted it reads the device/browser
   * language and falls back to the default (Traditional Chinese).
   */
  initialLocale?: Locale;
}

export interface PreferencesStore {
  readonly locale: Locale;
  readonly rulesEnabled: boolean;
  readonly endless: boolean;
  setLocale(locale: Locale): void;
  setRulesEnabled(on: boolean): void;
  setEndless(on: boolean): void;
  /** 訂閱變更；回傳取消訂閱的函式。 */
  subscribe(listener: () => void): () => void;
}

/** 讀一個鍵；儲存體拋錯時視為沒有值。 */
function readItem(storage: ProgressStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 寫一個鍵；配額爆掉或無痕模式擋寫時不應讓遊戲崩掉，因此吞掉錯誤。 */
function writeItem(storage: ProgressStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* 寫不進去只代表這次的偏好不會保存，遊戲本身不受影響。 */
  }
}

function toBool(value: unknown): boolean {
  return value === true;
}

/** 解析存下來的一份偏好；壞掉的欄位各自回退，不因一個欄位壞掉就整份丟掉。 */
function parsePreferences(text: string | null, fallbackLocale: Locale): Preferences {
  const fallback: Preferences = { locale: fallbackLocale, rulesEnabled: false, endless: false };
  if (text === null) return fallback;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return fallback;

    const candidate = parsed as Record<string, unknown>;
    const locale = isLocale(candidate['locale']) ? candidate['locale'] : fallbackLocale;
    const rulesEnabled = toBool(candidate['rulesEnabled']);

    return {
      locale,
      rulesEnabled,
      /* 無盡模式不能在總開關之外單獨成立，讀檔時就把它壓平。 */
      endless: rulesEnabled && toBool(candidate['endless']),
    };
  } catch {
    return fallback;
  }
}

/** 取得預設儲存體；瀏覽器端不可用時回傳 null。 */
function defaultStorage(): ProgressStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createPreferencesStore(options: PreferencesOptions = {}): PreferencesStore {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const key = options.key ?? STORAGE_KEYS.preferences;
  const fallbackLocale = options.initialLocale ?? detectBrowserLocale();

  const initial = storage === null
    ? { locale: fallbackLocale, rulesEnabled: false, endless: false }
    : parsePreferences(readItem(storage, key), fallbackLocale);

  let state: Preferences = initial;
  const listeners = new Set<() => void>();

  const persist = (): void => {
    if (storage === null) return;
    writeItem(storage, key, JSON.stringify(state));
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  /** 套用一組新值；真的變了才寫檔與通知。 */
  const update = (next: Preferences): void => {
    if (
      next.locale === state.locale &&
      next.rulesEnabled === state.rulesEnabled &&
      next.endless === state.endless
    ) {
      return;
    }

    state = next;
    persist();
    notify();
  };

  return {
    get locale(): Locale {
      return state.locale;
    },

    get rulesEnabled(): boolean {
      return state.rulesEnabled;
    },

    get endless(): boolean {
      return state.endless;
    },

    setLocale(locale: Locale): void {
      if (!isLocale(locale)) return;
      update({ ...state, locale });
    },

    setRulesEnabled(on: boolean): void {
      /*
       * 關掉總開關時一併關掉無盡模式：閘門關上就沒有規則可以被改，留著無盡模式會讓「閘門
       * 是關的、但規則還是被改了」的矛盾狀態存在。
       * Closing the gate also closes endless mode: with the gate shut no rule can be changed,
       * and leaving endless on would be the contradictory state of "gate shut, rule still changed".
       */
      update({ ...state, rulesEnabled: on, endless: on ? state.endless : false });
    },

    setEndless(on: boolean): void {
      /* 總開關未開時，無盡模式不成立（UI 也會把它停用，這裡是最後一道）。 */
      update({ ...state, endless: state.rulesEnabled && on });
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
