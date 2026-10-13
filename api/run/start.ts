/**
 * `POST /api/run/start` — 開一局，取得一張短期憑證。
 * `POST /api/run/start` — start a run and receive a short-lived token.
 *
 * 客戶端應該在**每一局開始的那一刻**呼叫它（`GameSession.reset()` 之後），並把回傳的 `deviceId`
 * 存進 `endchimerge:device-id`（伺服器可能自己頒一個）。
 * The client should call this at the **start of every run** (right after `GameSession.reset()`) and
 * persist the returned `deviceId` into `endchimerge:device-id` — the server may mint one.
 */

import { handleRunStart } from '../_lib/handlers.js';
import { vercelEndpoint } from '../_lib/adapters/vercel.js';

export default vercelEndpoint(handleRunStart);
