/**
 * `POST /api/run/start` — 開一局、取得短期憑證；每局開始時呼叫，並把回傳的 `deviceId` 存進 `endchimerge:device-id`（伺服器可能自己頒）。
 * `POST /api/run/start` — starts a run and issues a short-lived token; call at the start of every
 * run and persist the returned `deviceId` into `endchimerge:device-id` (the server may mint one).
 */

import { handleRunStart } from '../_lib/handlers.js';
import { vercelEndpoint } from '../_lib/adapters/vercel.js';

export default vercelEndpoint(handleRunStart);
