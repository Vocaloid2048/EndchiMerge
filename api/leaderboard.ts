/**
 * `GET /api/leaderboard?limit=&deviceId=` — 讀單一全時段榜（故無 `period` 參數）；`deviceId` 選填，帶了會一併回自己的名次。
 * `GET /api/leaderboard?limit=&deviceId=` — reads the single all-time board (hence no `period`
 * parameter); `deviceId` is optional and adds the caller's own rank.
 */

import { handleLeaderboard } from './_lib/handlers.js';
import { vercelEndpoint } from './_lib/adapters/vercel.js';

export default vercelEndpoint(handleLeaderboard);
