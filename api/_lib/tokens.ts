/**
 * 反作弊層次 T2：伺服器頒發的短期憑證，買的是時間 —— 宣稱的局時長可用伺服器記錄的頒發時刻回問；這是門檻而非防護。
 * Anti-cheat tier T2: short-lived server-issued tokens whose value is time — a claimed duration is
 * checked against the moment the server recorded at issue; a threshold, not a defence.
 */

import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

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

/**
 * 鑄一張新憑證。
 * Mints a new token.
 */
export function signRunToken(secret: string, payload: RunTokenPayload): string {
  return createHmac('sha256', secret).update(canonical(payload)).digest('base64url');
}

/**
 * 定時比較，避免用回應時間一個位元組一個位元組地猜簽章。
 * Constant-time comparison, so a response time cannot be used to guess the token byte by byte.
 */
function equalsConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  /*
   * 長度不同直接回 false：長度不是秘密（簽章長度固定），而 `timingSafeEqual` 要求等長。
   * A length difference returns false directly: length is not secret (the signature length is
   * fixed) and `timingSafeEqual` requires equal lengths.
   */
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * 驗一張憑證是否與這些事實相符。
 * Verifies a token against these facts.
 */
export function verifyRunToken(
  secret: string,
  token: string,
  payload: RunTokenPayload,
): boolean {
  return equalsConstantTime(signRunToken(secret, payload), token);
}

/**
 * 憑證的指紋（存進資料庫的是這個，不是憑證本身）：資料庫外洩時不能反推出可用憑證。
 * The token's fingerprint — what goes into the database, not the token: a leaked database cannot
 * be turned back into usable tokens.
 */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 鑄一個新的局號。
 * Mints a new run id.
 */
export function newRunId(): string {
  return randomUUID();
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
  return String(randomInt(1, 10_000)).padStart(4, '0');
}
