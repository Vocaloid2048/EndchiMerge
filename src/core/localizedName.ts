/**
 * 專有名詞的語系解析。
 * Locale resolution for proper nouns.
 *
 * 配置檔（`levels.json` / `skills.json`）的 `name` 是**預設語言**的名字，`names` 則是逐語系
 * 的覆寫。這一支把兩者合成一個給定語系的名字。
 * `name` in config is the **default-language** name and `names` holds per-locale overrides; this
 * folds the two into one name for a given locale.
 *
 * 缺一個語系時**退回到 `name`**，所以翻譯可以逐條補，不會出現空白或英文佔位。空字串一律
 * 視為「沒提供」—— 空字串在畫面上就是一個洞。
 * A missing locale **falls back to `name`**, so translations can arrive one at a time without
 * ever leaving a blank or an English placeholder. An empty string counts as "not provided",
 * since an empty string is just a hole on screen.
 */

import type { LocaleNames } from './types';
import type { Locale } from '../i18n/locale';

/**
 * 取某個語系下的名字。
 * Resolve the name for one locale.
 *
 * @param base 預設語言的名字（`LevelDef.name` / `SkillDef.name`）/ The default-language name.
 * @param names 逐語系覆寫；未提供時一律用 `base` / Per-locale overrides; `base` when absent.
 * @param locale 目前的語系 / The active locale.
 */
export function resolveLocalizedName(
  base: string,
  names: LocaleNames | undefined,
  locale: Locale,
): string {
  const localized = names?.[locale];
  return localized !== undefined && localized !== '' ? localized : base;
}
