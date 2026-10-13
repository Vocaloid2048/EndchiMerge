/**
 * `GET /api/health` — 真的去問一次資料庫的自我檢查（遷移沒跑、連線字串錯都立刻看得出來）；只回方言、玩家數與時間戳，不含任何敏感值。
 * `GET /api/health` — a self-check that really queries the database once (a missed migration or a
 * wrong connection string shows up immediately); returns only the dialect, the player count and a
 * timestamp — nothing sensitive.
 */

import { handleHealth } from './_lib/handlers.js';
import { vercelEndpoint } from './_lib/adapters/vercel.js';

export default vercelEndpoint(handleHealth);
