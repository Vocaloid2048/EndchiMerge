/**
 * 合理性檢查：把明顯不可能的成績擋下來。
 * Rationality checks: reject scores that cannot be true.
 *
 * 分數跑在客戶端、本質可偽造，所以每條檢查都是刻意寬鬆的上界，用來拉高作弊成本而非防堵。
 * Scores run on the client and are forgeable, so every check is a deliberately loose upper bound
 * meant to raise the cost of cheating rather than to stop it.
 */

import { MAX_RUN_MS, MIN_RUN_MS } from './env.js';

/**
 * 三個上界常數，直接取自遊戲配置：最短投放間隔（`levels.json → settings.dropCooldownMs`）、
 * 最高級分數（`levels.json → levels[].score`，256）、倍率天花板（`COMBO_CURVE.cap + base`，10）。
 * Three upper bounds taken straight from the game config: the minimum drop interval
 * (`levels.json` → `settings.dropCooldownMs`), the top level's `score` (256), and the multiplier
 * ceiling (`combo.ts` → `COMBO_CURVE.cap + base`, i.e. 10).
 */
export const DROP_COOLDOWN_MS = 500;
export const MAX_LEVEL_SCORE = 256;
export const MAX_MULTIPLIER = 10;

const DROP_SLACK = 2;

/**
 * 這一局時長內最多可投幾顆：`⌊時長 / 500⌋ + 2`（`+2` 給不受冷卻的第一顆與整數邊界寬限）。
 * Max drops a run can make: `floor(duration / 500) + 2` (the `+2` covers the ungated first drop
 * and integer edges).
 */
export function maxDropsFor(durationMs: number): number {
  return Math.floor(Math.max(0, durationMs) / DROP_COOLDOWN_MS) + DROP_SLACK;
}

export interface RationalityInput {
  readonly score: number;
  readonly merges: number;
  readonly drops: number;
  readonly maxCombo: number;
  readonly durationMs: number;
}

export type RationalityVerdict =
  | { readonly verified: true }
  | { readonly verified: false; readonly reason: string };

const PASS: RationalityVerdict = { verified: true };

/**
 * 檢查一筆提交是否合理；`reason` 是給開發者看的代碼，會存進 `scores.rejected`。
 * Checks whether a submission is plausible; `reason` is a developer-facing code stored in
 * `scores.rejected`.
 */
export function checkRationality(input: RationalityInput): RationalityVerdict {
  const { score, merges, drops, maxCombo, durationMs } = input;

  if (durationMs < MIN_RUN_MS) return { verified: false, reason: 'run_too_short' };
  if (durationMs > MAX_RUN_MS) return { verified: false, reason: 'run_too_long' };

  if (drops < 1) return { verified: false, reason: 'no_drops' };
  if (drops > maxDropsFor(durationMs)) return { verified: false, reason: 'too_many_drops' };

  if (merges > drops) return { verified: false, reason: 'merges_exceed_drops' };
  if (maxCombo > merges) return { verified: false, reason: 'combo_exceeds_merges' };

  if (score < 0) return { verified: false, reason: 'negative_score' };
  if (merges < 0) return { verified: false, reason: 'negative_merges' };

  if (merges === 0 && score > 0) return { verified: false, reason: 'score_without_merges' };
  if (merges === 0) return PASS;

  const ceiling = merges * MAX_LEVEL_SCORE * MAX_MULTIPLIER;
  if (score > ceiling) return { verified: false, reason: 'score_above_ceiling' };

  return PASS;
}

/**
 * 宣稱的時長對不對得上伺服器手上的憑證時刻。
 * Whether the claimed duration fits the moment the server issued the token.
 *
 * 單邊檢查：只驗上界（不能打得比頒發以來的實際時間更久），刻意不設下界 —— 玩家切到背景時
 * 模擬時鐘會停、牆上時鐘不會，設下界會誤傷誠實玩家（下界由 `checkRationality` 負責）。
 * One-sided: only the upper bound is checked (you cannot have played longer than the wall clock
 * since issue); the lower bound is deliberately absent because backgrounding the tab pauses the
 * simulated clock but not the wall clock (the lower bound lives in `checkRationality`).
 */
export function checkClaimedDuration(
  durationMs: number,
  issuedAtMs: number,
  nowMs: number,
  toleranceMs: number,
): RationalityVerdict {
  const elapsed = Math.max(0, nowMs - issuedAtMs);

  if (durationMs > elapsed + toleranceMs) {
    return { verified: false, reason: 'duration_exceeds_elapsed' };
  }

  return PASS;
}
