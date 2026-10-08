/**
 * 本機存檔的完整性摘要：這份資料有沒有被手改過。
 * A local integrity digest: has this blob been edited by hand?
 *
 * 動機很具體：玩家的最佳成績（分數／COMBO／合成）會進排行榜，而它存放在 `localStorage`
 * 裡 —— 開 DevTools 敲一行就能改成 999999。所以每份存檔都附一段摘要，讀回來時重算比對，
 * 對不上就當作那筆不存在。
 * The motivation is concrete: the player's best score / combo / merges goes onto the
 * leaderboard, and it lives in `localStorage`, where one line in DevTools turns it into
 * 999999. So every blob carries a digest, recomputed and compared on read; a mismatch means
 * the record is treated as absent.
 *
 * ⚠️ **這是門檻，不是防護。**
 * 鹽寫在這個檔案裡，會被一起打包進產物，所以任何看得到 JS 的人都能替自己算出一段合法摘要。
 * 它擋得住「隨手改 localStorage 看看會怎樣」，**擋不住有心人**。真正的防作弊只有兩條路，而且
 * 都在伺服器那一側：重新跑一次那一局的輸入，或者由伺服器簽發紀錄。刻意不在註解裡把它講得
 * 比實際更強 —— 一段擋得住橡皮擦的鎖，不該被描述成防盜門。
 * ⚠️ **This is a speed bump, not a defence.**
 * The salt lives in this file and ships with the bundle, so anyone who can read the JavaScript
 * can compute a valid digest for themselves. It stops "let me poke at localStorage and see what
 * happens"; it does **not** stop someone who means it. Real anti-cheat is server-side only — either
 * by replaying the run's inputs or by having the server sign records — and nothing here pretends
 * otherwise: a lock that keeps out an eraser is not a vault door.
 *
 * 摘要刻意**同步**：`crypto.subtle` 是 async 的，而儲存層的讀取散落在建構子裡，把它們全部
 * 改成 async 是為了保護一段本來就不安全的資料，不划算。
 * The digest is deliberately **synchronous**: `crypto.subtle` is async and the storage reads are
 * scattered through constructors, so making them all async would be a lot of churn to guard data
 * that is not really guarded anyway.
 */

/** FNV-1a 的 32 位質數（`Math.imul` 讓乘法留在 32 位內）。 */
const FNV_PRIME = 16777619;

/** 兩個不同的 FNV 起始值，湊出約 64 位元的摘要。 */
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

/** 一段文字＋鹽的摘要。同樣的輸入永遠得到同樣的輸出。 */
export function checksum(text: string, salt: string): string {
  return toHex(fnv1a(`${salt}|${text}`, SEED_A)) + toHex(fnv1a(`${text}|${salt}`, SEED_B));
}

/**
 * 包成信封：`{ v: <原本的 JSON 字串>, d: <摘要> }`。
 * Wrap into an envelope: `{ v: <the JSON text>, d: <digest> }`.
 *
 * 摘要算的是**字串本身**而不是解析後的物件。若算在物件上，驗證時得把解析回來的東西重新
 * `stringify` 一次，而那個字串不保證與當初寫入的逐位元組相同（數字格式、鍵的順序），
 * 於是「原封不動的存檔」會被誤判為被改過。
 * The digest is over the **text itself**, not over the parsed object: digesting the object would
 * mean re-`stringify`ing it on the way back in, and that text is not guaranteed to be
 * byte-identical to what was written (number formatting, key order) — a perfectly untouched file
 * would then be reported as tampered with.
 */
export function seal(value: unknown, salt: string): string {
  const text = JSON.stringify(value);

  return JSON.stringify({ v: text, d: checksum(text, salt) });
}

/**
 * 拆信封。任何問題（不是 JSON、不像信封、摘要對不上）一律回傳 `null`。
 * Open the envelope. Any problem — not JSON, not an envelope, digest mismatch — returns `null`.
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
