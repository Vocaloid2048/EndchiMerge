/**
 * 專有名詞的語系解析：配置檔的 `name` 是預設語言的名字，`names` 是逐語系覆寫。
 * Locale resolution for proper nouns: config `name` is the default-language name and `names` holds per-locale overrides.
 */

import type { LocaleNames } from './types';
import type { Locale } from '../i18n/locale';

/**
 * 取某個語系下的名字；缺的語系或空字串一律退回 `base`（空字串在畫面上就是一個洞）。
 * Resolves the name for one locale; a missing locale or an empty string falls back to `base` (an empty string is a hole on screen).
 */
export function resolveLocalizedName(
  base: string,
  names: LocaleNames | undefined,
  locale: Locale,
): string {
  const localized = names?.[locale];
  return localized !== undefined && localized !== '' ? localized : base;
}
