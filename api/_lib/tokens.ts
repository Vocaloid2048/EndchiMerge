/**
 * 反作弊層次 T2：伺服器頒發的短期憑證，買的是時間 —— 宣稱的局時長可用伺服器記錄的頒發時刻回問；這是門檻而非防護。
 * Anti-cheat tier T2: short-lived server-issued tokens whose value is time — a claimed duration is
 * checked against the moment the server recorded at issue; a threshold, not a defence.
 *
 * 邊緣執行時（EdgeOne Makers 的 V8）沒有 `node:crypto`，所以這裡只用 Web Crypto（`crypto.subtle`）。
 * Web Crypto 在 Node 22 也內建，故 SQL／Vercel 路徑不受影響，只是 `sign`／`verify`／`fingerprint` 改為 async。
 * Edge runtimes (EdgeOne Makers' V8) lack `node:crypto`, so this file uses only Web Crypto
 * (`crypto.subtle`). Web Crypto also ships in Node 22, so the SQL / Vercel paths are unaffected — only
 * `sign` / `verify` / `fingerprint` became async.
 */

/** 邊緣安全的加密介面（不依賴 DOM lib 的型別）。
 * An edge-safe crypto interface (independent of the DOM lib's types). */
interface SubtleLike {
  importKey(
    format: string,
    keyData: Uint8Array,
    algorithm: { name: string; hash: string },
    extractable: boolean,
    usages: readonly string[],
  ): Promise<unknown>;
  sign(algorithm: string, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}
interface CryptoLike {
  subtle: SubtleLike;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
}

const g = globalThis as unknown as {
  crypto: CryptoLike;
  TextEncoder: typeof TextEncoder;
  btoa: (data: string) => string;
};
const webcrypto = g.crypto;
const TextEncoderCtor = g.TextEncoder;
const btoaFn = g.btoa;

/**
 * 一張憑證所綁定的事實；四個值全部參與簽章，改動任何一個都會讓簽章對不上。
 * The facts one token binds; all four take part in the signature, so changing any breaks it.
 */
export interface RunTokenPayload {
  readonly runId: string;
  readonly deviceId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * 簽章的輸入用 `\n` 串接而非 `JSON.stringify`：欄位順序與跳脫規則隨引擎而異，簽章必須到處算出同一結果。
 * The signing input joins with `\n` rather than `JSON.stringify`: key order and escaping vary by
 * engine, and a signature has to come out the same everywhere.
 */
function canonical(payload: RunTokenPayload): string {
  return [
    payload.runId,
    payload.deviceId,
    String(payload.issuedAtMs),
    String(payload.expiresAtMs),
  ].join('\n');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoaFn(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoderCtor().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(
    await webcrypto.subtle.sign('HMAC', key as unknown as never, new TextEncoderCtor().encode(message)),
  );
  return toBase64Url(signature);
}

/**
 * 鑄一張新憑證。
 * Mints a new token.
 */
export async function signRunToken(secret: string, payload: RunTokenPayload): Promise<string> {
  return hmacSha256(secret, canonical(payload));
}

/**
 * 定時比較，避免用回應時間一個位元組一個位元組地猜簽章。
 * Constant-time comparison, so a response time cannot be used to guess the token byte by byte.
 */
function equalsConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * 驗一張憑證是否與這些事實相符。
 * Verifies a token against these facts.
 */
export async function verifyRunToken(
  secret: string,
  token: string,
  payload: RunTokenPayload,
): Promise<boolean> {
  return equalsConstantTime(await signRunToken(secret, payload), token);
}

/**
 * 憑證的指紋（存進資料庫的是這個，不是憑證本身）：資料庫外洩時不能反推出可用憑證。
 * The token's fingerprint — what goes into the database, not the token: a leaked database cannot
 * be turned back into usable tokens.
 */
export async function tokenFingerprint(token: string): Promise<string> {
  const digest = new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoderCtor().encode(token)));
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 鑄一個新的局號。
 * Mints a new run id.
 */
export function newRunId(): string {
  return webcrypto.randomUUID();
}

/**
 * 裝置識別碼的形狀；也接受客戶端既有的 id（`endchimerge:device-id`），強制換新會讓既有玩家看起來像新玩家。
 * The device-id shape; an existing client id (`endchimerge:device-id`) is accepted, since forcing a
 * new one would make existing players look new.
 */
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export function isValidDeviceId(value: string): boolean {
  return ID_PATTERN.test(value);
}

/** 玩家號的值域：`0001`–`9999`（跳過 `0000`），顯示用，永遠不是身分。
 * The player tag's range: `0001`–`9999` (`0000` skipped), for display and never identity. */
export function newUserTag(): string {
  const buffer = new Uint32Array(1);
  webcrypto.getRandomValues(buffer);
  const value = (buffer[0] % 9999) + 1;
  return String(value).padStart(4, '0');
}
