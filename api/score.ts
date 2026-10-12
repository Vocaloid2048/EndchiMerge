/**
 * `POST /api/score` — 提交一局的成績。
 * `POST /api/score` — submit one run's result.
 *
 * 主體：`{ runId, token, deviceId, score, merges, drops, maxCombo, durationMs, displayName, version }`。
 * 憑證由 `/api/run/start` 頒發，**同一局送第二次會拿回同一個裁決**（冪等），所以網路重試是安全的。
 * Body: `{ runId, token, deviceId, score, merges, drops, maxCombo, durationMs, displayName, version }`.
 * The token comes from `/api/run/start`, and **a second submission of the same run returns the same
 * verdict** (idempotent), so a network retry is safe.
 */

import { handleScore } from './_lib/handlers';
import { endpointOf } from './_lib/runtime';

export default endpointOf(handleScore);
