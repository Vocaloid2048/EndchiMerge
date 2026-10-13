/**
 * `GET /api/health` — 後端與資料庫的自我檢查。
 * `GET /api/health` — the backend's and the database's self-check.
 *
 * **不是**回一個寫死的 200：它真的去問一次資料庫（見 `handlers.ts` 的 `handleHealth`），所以「忘了跑
 * 遷移」與「連線字串填錯」這兩件事都會在部署後第一次打開就看得出來，而不是等到玩家送出成績才發現。
 * It is **not** a hard-coded 200: it really asks the database (see `handleHealth` in `handlers.ts`), so
 * "forgot to run the migration" and "the connection string is wrong" both show up the first time you
 * open it after deploying, rather than when a player submits a score.
 *
 * 沒有任何敏感資訊：只回方言名稱、玩家數與時間戳，**不回**連線字串、主機名或任何設定值。
 * Nothing sensitive: it returns the dialect name, the player count and a timestamp — **not** the
 * connection string, the host name, or any configuration value.
 */

import { handleHealth } from './_lib/handlers.js';
import { vercelEndpoint } from './_lib/adapters/vercel.js';

export default vercelEndpoint(handleHealth);
