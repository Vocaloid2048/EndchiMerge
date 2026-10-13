/**
 * 合理性檢查：把明顯不可能的成績擋下來。
 * Rationality checks: reject scores that cannot be true.
 *
 * 前提認知（design.md §6.7）：**物理跑在客戶端，分數本質上可偽造。** 這裡的每一條都是「上界」而
 * 不是「驗證」—— 它們能擋掉隨手編出來的數字，擋不掉一個願意照規則慢慢刷的玩家。目標是把作弊成本
 * 拉到不划算，而不是防堵。
 * The premise (design.md §6.7): **physics runs on the client, so scores are forgeable in principle.**
 * Every check here is an *upper bound*, not a verification — it stops numbers that were made up on
 * the spot, not a player willing to grind within the rules. The goal is to make cheating cost more
 * than it is worth, not to stop it.
 *
 * ## 上界是怎麼推出來的 / How the bounds are derived
 *
 * 三個常數直接來自遊戲配置，**不是隨手挑的數字**：
 * Three constants come straight from the game's own configuration; none of them was picked by feel:
 *
 * | 常數 | 值 | 來源 |
 * |:--|--:|:--|
 * | `DROP_COOLDOWN_MS` | 500 | `public/config/levels.json` → `settings.dropCooldownMs` |
 * | `MAX_LEVEL_SCORE` | 256 | `public/config/levels.json` → `levels[].score` 的最大值 |
 * | `MAX_MULTIPLIER` | 10 | `src/game/combo.ts` → `COMBO_CURVE.cap (9) + base (1)` |
 *
 * 於是三個上界可以一層一層推：
 *   - **投放數**受冷卻限制：兩顆之間至少 `DROP_COOLDOWN_MS`，所以一局最多投出
 *     `⌊時長 / 500⌋ + 2` 顆（`+2` 是第一顆不受冷卻、以及浮點與整數邊界的寬限）。
 *   - **合成數 ≤ 投放數**：每合成一次顆粒總數少一，而總數不會變成負的，所以折疊次數不可能超過
 *     投入的顆粒數。
 *   - **分數 ≤ 合成數 × 最高級分數 × 最大倍率**：每次合成加的是「合成後那一級的分數 × 當下倍率」，
 *     而兩者都有上限（`score` 最大值 256、倍率天花板 ×10）。
 *
 * Three bounds follow, one from the last:
 *   - **Drops are rate-limited**: at least `DROP_COOLDOWN_MS` apart, so a run can produce at most
 *     `⌊duration / 500⌋ + 2` of them (the `+2` covers the first drop, which is not gated, plus
 *     integer/floating-point edges).
 *   - **Merges ≤ drops**: every merge removes one body from the pile, so the number of folds cannot
 *     exceed the number of pieces that were put in.
 *   - **Score ≤ merges × max level score × max multiplier**: each merge adds
 *     "the merged-into level's score × the multiplier at that moment", and both are capped (256 and
 *     ×10).
 *
 * 這些上界**刻意寬鬆**。它們要抓的是「六十分鐘打了三千萬分」這種一眼假的提交，而不是判玩家有罪；
 * 誤傷一個認真玩的人，比放過一次作弊更糟。
 * These bounds are **deliberately loose**. They exist to catch submissions that are obviously
 * impossible — "thirty million points in ten minutes" — not to convict players. Wrongly rejecting one
 * honest run is worse than letting one cheat through.
 *
 * ⚠️ **配置改動時這些常數必須跟著改。** `tests/api.test.ts` 會拿 `public/config/levels.json` 與
 * `src/game/combo.ts` 回頭比對這三個數字，對不上就測試失敗 —— 靠人記得改是記不住的。
 * ⚠️ **Changing the game config means changing these constants.** `tests/api.test.ts` reads
 * `public/config/levels.json` and `src/game/combo.ts` back and compares all three, failing on a
 * mismatch — because "someone will remember" is not a mechanism.
 */

import { MAX_RUN_MS, MIN_RUN_MS } from './env.js';

/** 兩顆之間的最短間隔（`levels.json` → `settings.dropCooldownMs`）。 */
export const DROP_COOLDOWN_MS = 500;
/** 最高級的分數（`levels.json` → `levels[].score` 的最大值，第 10 級）。 */
export const MAX_LEVEL_SCORE = 256;
/** 倍率天花板（`combo.ts` → `COMBO_CURVE.cap + COMBO_CURVE.base`）。 */
export const MAX_MULTIPLIER = 10;
/** 第一顆不受冷卻限制，另外留一點整數邊界的寬限。 */
const DROP_SLACK = 2;

/** 這一局時長上限內最多可能投出幾顆。 */
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
 * 檢查一筆提交是否合理。回傳的 `reason` 是**給開發者看的代碼**，會存進 `scores.rejected`。
 * Check whether a submission is plausible. The `reason` is a **developer-facing code** and is stored
 * in `scores.rejected`.
 */
export function checkRationality(input: RationalityInput): RationalityVerdict {
  const { score, merges, drops, maxCombo, durationMs } = input;

  if (durationMs < MIN_RUN_MS) return { verified: false, reason: 'run_too_short' };
  if (durationMs > MAX_RUN_MS) return { verified: false, reason: 'run_too_long' };

  if (drops < 1) return { verified: false, reason: 'no_drops' };
  if (drops > maxDropsFor(durationMs)) return { verified: false, reason: 'too_many_drops' };

  if (merges > drops) return { verified: false, reason: 'merges_exceed_drops' };
  /* 一次合成最多讓連擊加一，所以連擊數不可能超過合成次數。 */
  if (maxCombo > merges) return { verified: false, reason: 'combo_exceeds_merges' };

  if (score < 0) return { verified: false, reason: 'negative_score' };
  if (merges < 0) return { verified: false, reason: 'negative_merges' };

  /* 分數只從合成來，所以沒合成就不可能有序分。 */
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
 * **這是單邊檢查，而且必須是單邊。** 上界是「不可能打得比實際流逝的時間更久」（憑證頒發之後才
 * 開始，之後每一毫秒都是真的）；下界則刻意**不設**，因為玩家把分頁切到背景時，遊戲的模擬時間
 * （`session.elapsed`）會停住，而牆上的鐘不會 —— 那是完全合法的行為，硬要兩邊相等會把「中途去倒
 * 了杯水」的玩家判成作弊。時長的下界由 `checkRationality` 的 `MIN_RUN_MS` 負責。
 * **One-sided, and it must be.** The upper bound is "you cannot have played longer than the wall
 * clock has run" (the run starts after the token is issued, so every millisecond since is real). The
 * lower bound is deliberately **absent**: when a player backgrounds the tab, the game's simulated
 * clock (`session.elapsed`) stops while the wall clock does not — entirely legitimate behaviour, and
 * requiring the two to agree would flag anyone who went to refill a glass of water. The lower bound
 * lives in `checkRationality` as `MIN_RUN_MS`.
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
