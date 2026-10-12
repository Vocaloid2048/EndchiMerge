/**
 * 反作弊層次 **T2**：伺服器頒發的短期憑證。
 * Anti-cheat tier **T2**: short-lived tokens issued by the server.
 *
 * 使用者定案（2026-10-12）：只做 T2，不做 T1 對稱簽章、也不做 T3 伺服器端重放。
 * The user's decision (2026-10-12): T2 only — no T1 symmetric signature, and no T3 server-side
 * replay.
 *
 * 這一層真正買到的是**時間**：憑證由伺服器在自己手上的時刻頒發，所以當客戶端提交「這一局打了
 * 38 分鐘」時，伺服器可以拿自己記錄的頒發時刻回問「但我五分鐘前才發給你」。T1 做不到這件事 ——
 * 對稱簽章只證明「這份資料沒有被改過」，不證明「它是在什麼時候被產生的」，而後者才是偽造成績的
 * 主要入口（宣告一局不存在的長局、順便宣告一個大分數）。
 * What this tier actually buys is **time**: the token is issued at a moment the server owns, so when
 * a client submits "this run lasted 38 minutes" the server can answer against its own record —
 * "but I issued this to you five minutes ago". T1 cannot do that: a symmetric signature proves the
 * data was not edited, not *when it was produced* — and the latter is the main door for forged
 * scores (claim a long run that never happened, and a large score along with it).
 *
 * **這仍然不是防護，只是門檻。** 憑證綁定的是「一局開始了」，不是「這一局打了多少分」；玩家完全
 * 可以在自己那一局裡誠實地開始、然後送出一個假的成績。理由與設計文件一致：物理跑在客戶端，分數
 * 本質上可偽造，目標是把作弊成本拉到不划算。要真正算分只有 T3（伺服器重放輸入軌跡），而使用者
 * 已明確排除。
 * **This is still a threshold, not a defence.** The token binds "a run began", not "this run scored
 * this much": a player can start a run honestly and then submit a fabricated score. That matches the
 * design document — physics runs on the client, scores are forgeable in principle, and the goal is to
 * make cheating not worth the effort. Genuinely computing the score requires T3 (replaying the input
 * trace on the server), which the user has explicitly ruled out.
 */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/** 一張憑證所綁定的事實。這四個值全部參與簽章，改動任何一個都會讓簽章對不上。 */
export interface RunTokenPayload {
  readonly runId: string;
  readonly deviceId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * 簽章的輸入。用 `\n` 串接而不是 `JSON.stringify`：欄位順序與跳脫規則會隨引擎而異，而**簽章
 * 必須在任何地方算出來都一樣**。
 * The signing input. Joined with `\n` rather than `JSON.stringify`: key order and escaping rules vary
 * between engines, and **a signature has to come out the same everywhere**.
 */
function canonical(payload: RunTokenPayload): string {
  return [
    payload.runId,
    payload.deviceId,
    String(payload.issuedAtMs),
    String(payload.expiresAtMs),
  ].join('\n');
}

/** 鑄一張新憑證。 */
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

  /* 長度不同就直接回 false：長度本身不是秘密（簽章長度固定），而 `timingSafeEqual` 要求等長。 */
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** 驗一張憑證是否與這些事實相符。 */
export function verifyRunToken(
  secret: string,
  token: string,
  payload: RunTokenPayload,
): boolean {
  return equalsConstantTime(signRunToken(secret, payload), token);
}

/**
 * 憑證的指紋（存進資料庫的是這個，不是憑證本身）。
 * The token's fingerprint — this is what goes into the database, not the token itself.
 *
 * 理由是資料庫外洩時：存原文等於把一整批未過期的憑證送給對方，而它們可以直接拿去提交。
 * 存雜湊的話，外洩的資料不能反推出可用的憑證。
 * Because of a database leak: storing the token itself hands over a batch of unexpired credentials
 * that can be submitted directly, whereas a hash cannot be turned back into a usable token.
 */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 對某個值取帶秘密的指紋（給 IP 用）。
 * A keyed fingerprint of a value (used for IPs).
 *
 * 帶秘密是必要的：IPv4 只有 43 億個可能值，純 SHA-256 的雜湊可以被暴力反推 —— 那樣「雜湊過的
 * IP」就只是看起來像匿名而已。加了秘密，沒有秘密的人就推不回去。
 * The key is essential: IPv4 has only 4.3 billion possible values, so a plain SHA-256 is reversible
 * by brute force — which would make a "hashed IP" look anonymous without being anonymous. With a
 * secret, someone without the secret cannot invert it.
 */
export function keyedFingerprint(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** 鑄一個新的局號。 */
export function newRunId(): string {
  return randomUUID();
}

/**
 * 裝置識別碼的形狀。
 * The shape of a device id.
 *
 * 伺服器在第一次開局時頒發，但也接受客戶端既有的那一組（`endchimerge:device-id`，早就存在）：
 * 強制換 id 會讓既有玩家看起來像新玩家，而這個 id 的用途只是把同一台裝置的歷史綁在一起。
 * The server issues it on the first run, but also accepts an id the client already has
 * (`endchimerge:device-id`, which predates the backend): forcing a new one would make existing
 * players look new, and the id's only job is to tie one device's history together.
 */
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;

export function isValidDeviceId(value: string): boolean {
  return ID_PATTERN.test(value);
}
