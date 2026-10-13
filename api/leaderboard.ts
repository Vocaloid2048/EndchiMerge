/**
 * `GET /api/leaderboard?limit=&deviceId=` — 讀榜。
 * `GET /api/leaderboard?limit=&deviceId=` — read the board.
 *
 * 只有**單一全時段**榜（使用者定案 2026-10-12），所以沒有 `period` 參數。`deviceId` 是選填的，帶了
 * 就會一併回自己的名次（客戶端拿它顯示「第 N 名，共 M 位玩家」／榜外時的百分比）。
 * There is only **one all-time board** (the user's decision, 2026-10-12), so there is no `period`
 * parameter. `deviceId` is optional; supplying it also returns the caller's own rank, which the client
 * uses for "Nth of M players" and for the out-of-range percentage.
 */

import { handleLeaderboard } from './_lib/handlers.js';
import { vercelEndpoint } from './_lib/adapters/vercel.js';

export default vercelEndpoint(handleLeaderboard);
