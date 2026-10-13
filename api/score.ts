/**
 * `POST /api/score` — 提交一局成績；同一局送第二次拿回同一個裁決（冪等），網路重試安全。
 * `POST /api/score` — submits one run's result; a second submission of the same run returns the
 * same verdict (idempotent), so a network retry is safe.
 */

import { handleScore } from './_lib/handlers.js';
import { vercelEndpoint } from './_lib/adapters/vercel.js';

export default vercelEndpoint(handleScore);
