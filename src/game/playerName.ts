/**
 * 玩家顯示名稱的驗證：加權長度上限、字元白名單與 NFKC 正規化。
 * Display-name validation: a weighted-unit cap, a character whitelist, and NFKC normalisation.
 */

/**
 * 加權長度上限（設計單位）：CJK 每字 2 單位、其餘 1 單位。
 * Weighted-length cap in design units: CJK counts 2 per character, everything else 1.
 */
export const NAME_MAX_UNITS = 32;

export const NAME_MIN_UNITS = 1;

/**
 * CJK 表意文字：擴充 A、統一與相容區塊。
 * CJK ideographs: the Extension A, Unified and Compatibility blocks.
 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

/**
 * 白名單：CJK、拉丁字母、數字、空白與 `_` `-` `.`。
 * The whitelist: CJK, Latin letters, digits, whitespace, and `_` `-` `.`.
 */
const ALLOWED = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFFA-Za-z0-9 _.-]+$/u;

/**
 * 零寬與雙向控制字元：肉眼不可見，一律先剔除。
 * Zero-width and bidi control characters: invisible, always stripped first.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * 驗證失敗的原因，供 UI 給出對應提示。
 * Why a validation failed, so the UI can show a matching hint.
 */
export type NameError = 'empty' | 'charset' | 'tooLong';

export type NameValidation =
  | { ok: true; value: string; units: number }
  | { ok: false; reason: NameError; units: number };

/**
 * 正規化：NFKC → 去零寬／控制 → 壓縮連續空白 → 去頭尾。
 * Normalise: NFKC → strip invisible/control → collapse whitespace → trim.
 *
 * 順序要緊：先 NFKC 才去控制字元，否則全形空白會以普通空白留下。
 * Order matters: NFKC before the strip, or a full-width space survives as an ordinary space.
 */
export function normalizeDisplayName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * 加權長度：CJK 每字 2 單位、其餘 1 單位（以碼點計算）。
 * Weighted length: CJK counts 2 per character, everything else 1 (counted by code point).
 */
export function nameUnits(value: string): number {
  let units = 0;
  for (const char of value) units += CJK.test(char) ? 2 : 1;

  return units;
}

/**
 * 驗證並正規化一個名稱；回傳的是正規化後的字串，可直接存檔。
 * Validates and normalises a name; the returned value is normalised and ready to store.
 */
export function validateDisplayName(raw: string): NameValidation {
  const value = normalizeDisplayName(raw);
  const units = nameUnits(value);

  if (units < NAME_MIN_UNITS) return { ok: false, reason: 'empty', units };
  if (!ALLOWED.test(value)) return { ok: false, reason: 'charset', units };
  if (units > NAME_MAX_UNITS) return { ok: false, reason: 'tooLong', units };

  return { ok: true, value, units };
}
