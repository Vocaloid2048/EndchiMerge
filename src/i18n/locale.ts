/**
 * 語系清單與偵測。
 * The locale list and detection.
 *
 * 五個語系（使用者定案）：繁體中文、簡體中文、粵語、英文、日文。清單順序就是設定頁的顯示
 * 順序，也是語言選單的順序。
 * Five locales (the user's decision): Traditional Chinese, Simplified Chinese, Cantonese,
 * English and Japanese. The list order is the settings page's display order.
 *
 * 純函式、不碰 DOM，所以偵測規則可以逐條釘在單元測試裡。
 * Pure functions with no DOM, so every detection rule can be pinned down by a test.
 */

/** 支援的語系。 */
export const LOCALES = ['zh-Hant', 'zh-Hans', 'yue', 'en', 'ja'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * 語系在選單上的顯示名 —— 一律用**該語言自己的寫法**（endonym），不隨介面語言變。
 * The menu label for each locale, always in its own language (endonym), so it never moves.
 */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
  yue: '粵語',
  en: 'English',
  ja: '日本語',
};

/** 找不到匹配時的預設語系（來源語言）。 */
export const DEFAULT_LOCALE: Locale = 'zh-Hant';

/** 判斷一個字串是不是支援的語系。 */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * 把一個 BCP-47 標籤正規化成小寫並以 `-` 分隔，方便比對。
 * Normalise a BCP-47 tag to lower case with `-` separators so comparisons are simple.
 *
 * `navigator.language` 可能給 `zh-HK`、`zh_HK` 甚至 `zh-Hant-HK`，全部收斂成同一種寫法。
 * `navigator.language` may hand back `zh-HK`, `zh_HK` or even `zh-Hant-HK`; all are folded to
 * one shape here.
 */
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/gu, '-');
}

/**
 * 由瀏覽器語言偏好挑一個語系。
 * Pick a locale from the browser's language preferences.
 *
 * 依序走訪每個標籤（`navigator.languages` 已按偏好排序），第一個能對應上的就勝出：
 * - `zh-HK` / `zh-MO` → **粵語**：香港、澳門的預設書面語預期就是粵文，而設定裡粵語是獨立
 *   選項，若把它排在繁體中文之後，粵語就永遠選不到。
 * - 其餘 `zh-Hant` / `zh-TW` → 繁體中文；`zh-Hans` / `zh-CN` / `zh-SG` → 簡體中文。
 * - `en*` → 英文；`ja*` → 日文。
 * 都對不上時回傳預設語系。
 *
 * Walks the tags in order (already preference-sorted in `navigator.languages`) and the first
 * match wins: `zh-HK` / `zh-MO` → **Cantonese** (a Hong Kong or Macao device expects written
 * Cantonese, and Cantonese is its own option here — behind Traditional Chinese it could never
 * be auto-selected); other `zh-Hant` / `zh-TW` → Traditional; `zh-Hans` / `zh-CN` / `zh-SG` →
 * Simplified; `en*` → English; `ja*` → Japanese. Anything else falls back to the default.
 */
export function detectLocale(tags: readonly string[], fallback: Locale = DEFAULT_LOCALE): Locale {
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag === '') continue;

    const [primary] = tag.split('-');

    if (primary === 'yue') return 'yue';

    if (primary === 'zh') {
      if (tag.includes('hans') || tag.endsWith('-cn') || tag.endsWith('-sg')) return 'zh-Hans';
      if (tag.endsWith('-hk') || tag.endsWith('-mo')) return 'yue';
      if (tag.includes('hant') || tag.endsWith('-tw')) return 'zh-Hant';

      /* 只有 `zh` 而沒有地區：繁體中文是來源語言，也是本專案的主力客群。 */
      return 'zh-Hant';
    }

    if (primary === 'en') return 'en';
    if (primary === 'ja') return 'ja';
  }

  return fallback;
}

/**
 * 讀取執行環境的語言偏好，挑一個語系。
 * Read the runtime's language preferences and pick a locale.
 *
 * 在沒有 `navigator` 的環境（單元測試、SSR）退回預設語系。
 * Falls back to the default where there is no `navigator` (tests, SSR).
 */
export function detectBrowserLocale(): Locale {
  const nav = globalThis.navigator;
  if (nav === undefined) return DEFAULT_LOCALE;

  const tags =
    Array.isArray(nav.languages) && nav.languages.length > 0
      ? nav.languages
      : [nav.language].filter((value): value is string => typeof value === 'string');

  return detectLocale(tags);
}
