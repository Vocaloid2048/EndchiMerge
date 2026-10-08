/**
 * 五個語系的字典集中處。
 * Where the five locale dictionaries are collected.
 *
 * `zh-Hant` 是來源語言（鍵集合由它導出），其餘四個都以 `Messages` 型別檢查 —— 少了任何一個
 * 鍵，`tsc` 就會失敗。這是刻意的：漏翻譯應該是**建置錯誤**，而不是畫面上默默出現別的語言。
 * `zh-Hant` is the source locale (the key set derives from it) and the other four are typed as
 * `Messages`, so a missing key fails `tsc`. That is deliberate: a missing translation should be
 * a **build error**, not a stray string in another language appearing on screen.
 */

import type { Locale } from '../locale';
import { zhHant, type Messages, type MessageKey } from './zh-Hant';
import { zhHans } from './zh-Hans';
import { yue } from './yue';
import { en } from './en';
import { ja } from './ja';

export const MESSAGES: Readonly<Record<Locale, Messages>> = {
  'zh-Hant': zhHant,
  'zh-Hans': zhHans,
  yue,
  en,
  ja,
};

export { zhHant };
export type { Messages, MessageKey };
