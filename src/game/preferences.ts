/**
 * 玩家偏好設定：語系、玩法模式、規則變更總開關、無盡模式與音樂靜音；只做讀寫與通知，不含遊戲規則。
 * Player preferences — locale, play mode, the rules master gate, endless mode and the music mute; read/write/notify only.
 */

import { STORAGE_KEYS } from '../core/constants';
import { detectBrowserLocale, isLocale, type Locale } from '../i18n/locale';
import { createLocalStore, type LocalStore, type StorageBackend } from './localStore';
import { DEFAULT_MODE, isModeId, type ModeId } from './mode';

/** 偏好的完整內容。 */
export interface Preferences {
  locale: Locale;
  /**
   * 玩法模式；切換後要重新載入（＝開新一局）才會套用。
   * The play mode; a change only takes effect after a reload (= a new run).
   */
  mode: ModeId;
  /**
   * 規則變更總開關；開啟期間的成績一律不記入排行榜。
   * The rules master gate; while it is on, nothing is recorded on the leaderboard.
   */
  rulesEnabled: boolean;
  /**
   * 無盡模式；僅在 `rulesEnabled` 為真時有效。
   * Endless mode; only applies while `rulesEnabled` is true.
   */
  endless: boolean;
  /**
   * 背景音樂是否靜音；記住上一次的選擇，下次開頁照那個狀態來。
   * Whether the background music is muted; the last choice is remembered and applied on the next visit.
   */
  musicMuted: boolean;
}

export interface PreferencesOptions {
  /**
   * 共用的本地儲存層；偏好不在同步名單，寫入不推進 `revision`、不觸發上載。
   * The shared local store; preferences are not synced, so writes advance neither `revision` nor an upload.
   */
  store?: LocalStore;
  /**
   * 自行注入儲存體；未提供 `store` 時才用（測試用）。
   * A storage backend to inject; used only when `store` is absent (tests).
   */
  storage?: StorageBackend | null;
  /**
   * 覆寫儲存鍵；測試用。
   * Overrides the storage key (tests).
   */
  key?: string;
  /**
   * 尚未有存檔時的語系；未提供時讀裝置／瀏覽器語言，再退回預設（繁中）。
   * The locale before anything is saved; defaults to the device/browser language, then Traditional Chinese.
   */
  initialLocale?: Locale;
}

export interface PreferencesStore {
  readonly locale: Locale;
  readonly mode: ModeId;
  readonly rulesEnabled: boolean;
  readonly endless: boolean;
  readonly musicMuted: boolean;
  setLocale(locale: Locale): void;
  setMode(mode: ModeId): void;
  setRulesEnabled(on: boolean): void;
  setEndless(on: boolean): void;
  setMusicMuted(muted: boolean): void;
  /**
   * 訂閱變更；回傳取消訂閱的函式。
   * Subscribes to changes and returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

function toBool(value: unknown): boolean {
  return value === true;
}

/**
 * 解析存下來的一份偏好；壞掉的欄位各自回退，不因一個欄位壞掉就整份丟掉。
 * Parses a saved preferences blob; each bad field falls back instead of discarding the whole blob.
 */
function parsePreferences(text: string | null, fallbackLocale: Locale): Preferences {
  const fallback: Preferences = {
    locale: fallbackLocale,
    mode: DEFAULT_MODE,
    rulesEnabled: false,
    endless: false,
    musicMuted: false,
  };
  if (text === null) return fallback;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return fallback;

    const candidate = parsed as Record<string, unknown>;
    const locale = isLocale(candidate['locale']) ? candidate['locale'] : fallbackLocale;
    const mode = isModeId(candidate['mode']) ? candidate['mode'] : DEFAULT_MODE;
    const rulesEnabled = toBool(candidate['rulesEnabled']);

    return {
      locale,
      mode,
      rulesEnabled,
      endless: rulesEnabled && toBool(candidate['endless']),
      musicMuted: toBool(candidate['musicMuted']),
    };
  } catch {
    return fallback;
  }
}

export function createPreferencesStore(options: PreferencesOptions = {}): PreferencesStore {
  const local =
    options.store ?? createLocalStore({ storage: options.storage, syncedKeys: [] });
  const key = options.key ?? STORAGE_KEYS.preferences;
  const fallbackLocale = options.initialLocale ?? detectBrowserLocale();

  let state: Preferences = parsePreferences(local.read(key), fallbackLocale);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const update = (next: Preferences): void => {
    if (
      next.locale === state.locale &&
      next.mode === state.mode &&
      next.rulesEnabled === state.rulesEnabled &&
      next.endless === state.endless &&
      next.musicMuted === state.musicMuted
    ) {
      return;
    }

    state = next;
    local.writeJson(key, state);
    notify();
  };

  return {
    get locale(): Locale {
      return state.locale;
    },

    get mode(): ModeId {
      return state.mode;
    },

    get rulesEnabled(): boolean {
      return state.rulesEnabled;
    },

    get endless(): boolean {
      return state.endless;
    },

    get musicMuted(): boolean {
      return state.musicMuted;
    },

    setLocale(locale: Locale): void {
      if (!isLocale(locale)) return;
      update({ ...state, locale });
    },

    /*
     * 模式與規則無關：兩個模式的成績各自上榜，所以它不受總開關管制（受管制的話傳統模式永遠不能上榜）。
     * The mode is unrelated to the rules: each mode has its own board rows, so the master gate does
     * not govern it — otherwise the traditional mode could never be ranked.
     */
    setMode(mode: ModeId): void {
      if (!isModeId(mode)) return;
      update({ ...state, mode });
    },

    setRulesEnabled(on: boolean): void {
      /*
       * 關掉總開關時一併關掉無盡模式：閘門關上就不該有任何規則還被改著。
       * Closing the gate also closes endless mode: no rule may stay changed with the gate shut.
       */
      update({ ...state, rulesEnabled: on, endless: on ? state.endless : false });
    },

    setEndless(on: boolean): void {
      /*
       * 總開關未開時，無盡模式不成立（UI 也會停用，這裡是最後一道）。
       * Endless mode cannot stand without the gate (the UI disables it too; this is the last guard).
       */
      update({ ...state, endless: state.rulesEnabled && on });
    },

    setMusicMuted(muted: boolean): void {
      /* 靜音與規則無關：它不受總開關管，也不影響成績。 */
      /* The mute is unrelated to the rules: the master gate does not govern it, and it never affects a score. */
      update({ ...state, musicMuted: muted });
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
