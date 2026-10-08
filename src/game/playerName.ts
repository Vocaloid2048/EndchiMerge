/**
 * 玩家顯示名稱的驗證。
 * Display-name validation.
 *
 * 依 `design.md` §6.3（D9）與 §6.4（D10）：
 * - **加權單位制**：CJK 字元權重 2、其餘 1，上限 **32 單位** → 純中文最多 16 字、純英文
 *   最多 32 字。
 * - **字元白名單**：CJK 統一表意文字（含擴充 A）、拉丁字母、數字、空白、`_`、`-`、`.`。
 * - **正規化**：先做 NFKC（全形轉半形），再去掉零寬與控制字元，最後壓縮連續空白。
 * Per design.md §6.3 (D9) and §6.4 (D10): a weighted-unit cap (CJK 2, everything else 1; max
 * 32 units), a character whitelist, and NFKC normalisation with zero-width / control stripping.
 *
 * **關鍵詞過濾（D10 的分層攔截）暫不在此實作**：那一層的意義是「防止其他玩家看到冒犯性
 * 名稱」，而現階段榜單是**純本地、只有自己看得到**，本機過濾對任何人都沒有影響；等接上
 * 真後端（Docker Postgres／Vercel）時，它應該與伺服器端驗證一起做，避免兩份清單各自漂移。
 * **Keyword filtering (D10's layered interception) is deliberately not implemented here.** Its
 * purpose is stopping *other* players from seeing an offensive name, and the board is currently
 * local-only — filtering on this machine changes nothing for anyone. When the real backend
 * lands it belongs with the server-side validation, so the two lists cannot drift apart.
 *
 * 純函式、不碰 DOM，所以整組規則可以在單元測試裡逐條釘住。
 * Pure functions with no DOM, so every rule here can be pinned down test by test.
 */

/** 加權長度上限（設計單位）：CJK 每字 2 單位、其餘 1 單位。 */
export const NAME_MAX_UNITS = 32;

/** 名稱最少 1 單位（＝不可為空）。 */
export const NAME_MIN_UNITS = 1;

/**
 * CJK 表意文字：擴充 A（U+3400–U+4DBF）、統一表意文字（U+4E00–U+9FFF）、
 * 相容表意文字（U+F900–U+FAFF，NFKC 之後多數會被折疊，一併接受較寬容）。
 * CJK ideographs: Extension A, the Unified block, and the Compatibility block (most of which
 * NFKC folds away — accepted anyway to stay lenient).
 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;

/** 白名單：CJK（含擴充 A／相容）＋ 拉丁字母 ＋ 數字 ＋ 空白 ＋ `_` `-` `.`。 */
const ALLOWED = /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFFA-Za-z0-9 _.-]+$/u;

/** 零寬與雙向控制字元：肉眼不可見，一律先剔除。 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

/** C0／C1 控制字元。 */
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/gu;

/** 驗證失敗的原因，供 UI 給出對應提示。 */
export type NameError = 'empty' | 'charset' | 'tooLong';

export type NameValidation =
  | { ok: true; value: string; units: number }
  | { ok: false; reason: NameError; units: number };

/**
 * 正規化：NFKC → 去零寬／控制 → 連續空白壓成一個 → 去頭尾空白。
 * Normalise: NFKC → strip invisible/control → collapse whitespace → trim.
 *
 * 順序要緊：先 NFKC 才去控制字元，否則全形空白（U+3000）會被當成普通空白留下。
 * Order matters: NFKC before the control strip, or a full-width space survives as an ordinary
 * space.
 */
export function normalizeDisplayName(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** 加權長度：CJK 每字 2 單位、其餘 1 單位（以碼點計算，emoji 之類不會被拆成兩單位）。 */
export function nameUnits(value: string): number {
  let units = 0;
  for (const char of value) units += CJK.test(char) ? 2 : 1;

  return units;
}

/**
 * 驗證並正規化一個名稱。
 * Validate and normalise a name.
 *
 * 回傳的是**正規化後**的字串（呼叫端直接存它即可），驗證與正規化不分兩步 —— 分開會讓
 * 「畫面上顯示的字」與「存進去的字」有機會不一致。
 * The returned value is the **normalised** string, ready to store: validating and normalising
 * in one step keeps what the player sees and what gets saved from diverging.
 */
export function validateDisplayName(raw: string): NameValidation {
  const value = normalizeDisplayName(raw);
  const units = nameUnits(value);

  if (units < NAME_MIN_UNITS) return { ok: false, reason: 'empty', units };
  if (!ALLOWED.test(value)) return { ok: false, reason: 'charset', units };
  if (units > NAME_MAX_UNITS) return { ok: false, reason: 'tooLong', units };

  return { ok: true, value, units };
}
