/**
 * 本機存檔的完整性摘要：這份資料有沒有被手改過。
 * A local integrity digest: has this blob been edited by hand?
 *
 * ⚠️ 這是門檻而非防護：鹽會隨打包公開，擋得住隨手改 `localStorage`，擋不住有心人；
 * 真正的防作弊只在伺服器那一側。
 * ⚠️ This is a speed bump, not a defence: the salt ships with the bundle, so it stops casual poking, not someone who means it — real anti-cheat is server-side only.
 */

/**
 * FNV-1a 的 32 位質數（`Math.imul` 讓乘法留在 32 位內）。
 * FNV-1a's 32-bit prime (`Math.imul` keeps the multiplication inside 32 bits).
 */
const FNV_PRIME = 16777619;

/**
 * 兩個不同的 FNV 起始值，湊出約 64 位元的摘要。
 * Two distinct FNV seeds, giving a ~64-bit digest.
 */
const SEED_A = 0x811c9dc5;
const SEED_B = 0x5bf03635;

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}

/**
 * 一段文字＋鹽的摘要；同樣的輸入永遠得到同樣的輸出。
 * A digest of text plus salt; the same input always yields the same output.
 */
export function checksum(text: string, salt: string): string {
  return toHex(fnv1a(`${salt}|${text}`, SEED_A)) + toHex(fnv1a(`${text}|${salt}`, SEED_B));
}

/**
 * 包成信封：`{ v: <原本的 JSON 字串>, d: <摘要> }`。
 * Wraps into an envelope: `{ v: <the JSON text>, d: <digest> }`.
 *
 * 摘要算的是字串本身而不是解析後的物件 —— 後者驗證時要重新 `stringify`，
 * 不保證與寫入時逐位元組相同，會把原封不動的存檔誤判成被改過。
 * The digest is over the text itself, not the parsed object: re-`stringify`ing on the way back is not guaranteed byte-identical, which would report untouched saves as tampered with.
 */
export function seal(value: unknown, salt: string): string {
  const text = JSON.stringify(value);

  return JSON.stringify({ v: text, d: checksum(text, salt) });
}

/**
 * 拆信封；任何問題（不是 JSON、不像信封、摘要對不上）一律回傳 `null`。
 * Opens the envelope; any problem — not JSON, not an envelope, digest mismatch — returns `null`.
 */
export function open(raw: string | null, salt: string): unknown | null {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return null;

    const envelope = parsed as Record<string, unknown>;
    const text = envelope['v'];
    const digest = envelope['d'];

    if (typeof text !== 'string' || typeof digest !== 'string') return null;
    if (checksum(text, salt) !== digest) return null;

    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
