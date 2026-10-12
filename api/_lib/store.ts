/**
 * 儲存層介面，外加一份**記憶體實作**。
 * The storage interface, plus an **in-memory implementation**.
 *
 * 端點只認這個介面，所以它有兩個實作：`pgStore.ts`（正式，接 Postgres）與這裡的 `MemoryStore`
 * （測試）。這樣單元測試可以完整跑過 `POST /api/score` 的整條路徑 —— 憑證驗證、速率限制、
 * 合理性檢查、寫入 —— 而不需要一個真的資料庫，也不必為了測試去起容器。
 * Endpoints know only this interface, which has two implementations: `pgStore.ts` (production,
 * against Postgres) and the `MemoryStore` here (tests). That lets a unit test walk the whole
 * `POST /api/score` path — token verification, rate limiting, rationality, writes — with no database
 * and no container to start.
 *
 * `MemoryStore` **不得**在正式路徑上被使用：它不持久、不跨實例共用，而 Vercel 的每一個函式實例
 * 都有自己的記憶體。它存在只是為了讓測試能叫得出處理器。
 * `MemoryStore` must **not** be reachable in production: it does not persist, does not span
 * instances, and every Vercel function instance has its own memory. It exists so tests can call the
 * handlers.
 */

import type { BoardCategory } from './db/dialect';
import type { RequestRow } from './requests';

/** `run_tokens` 的一列。 */
export interface RunTokenRow {
  readonly runId: string;
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly usedAtMs: number | null;
}

/** `scores` 的一列（一局一列）。 */
export interface ScoreRow {
  readonly runId: string;
  readonly deviceId: string;
  readonly displayName: string;
  readonly score: number;
  readonly durationMs: number;
  readonly merges: number;
  readonly drops: number;
  readonly maxCombo: number;
  readonly version: string;
  readonly verified: boolean;
  readonly rejected: string | null;
  readonly clientIp: string | null;
  readonly atMs: number;
}

/** `profiles` 的一列（一位玩家一列）。三個最大值**各自獨立**，與客戶端資料層同一個模型。 */
export interface ProfileRow {
  readonly deviceId: string;
  readonly displayName: string;
  readonly bestScore: number;
  readonly bestDurationMs: number;
  readonly bestMaxCombo: number;
  readonly bestMerges: number;
  readonly bestAtMs: number | null;
}

/**
 * 查名次時要問的那一組數字。
 * The set of numbers asked about when looking up a rank.
 *
 * 三個最大值都要帶，因為**名次是相對於某個分類的**：同一個人在分數榜第 3 名、在組合數榜可能是
 * 第 40 名。只帶分數的話，切到其他分頁時那一行「第 N 名」就是錯的。
 * All three maxima are required because **a rank is always relative to a category**: the same player
 * may be 3rd on the score board and 40th on the combo board. Carrying only the score would make the
 * summary's "Nth" wrong on the other two tabs.
 */
export interface RankProbe {
  readonly deviceId: string;
  readonly score: number;
  readonly maxCombo: number;
  readonly merges: number;
  readonly atMs: number;
}

export interface Store {
  putRunToken(row: RunTokenRow): Promise<void>;
  getRunToken(runId: string): Promise<RunTokenRow | null>;
  markRunTokenUsed(runId: string, atMs: number): Promise<void>;
  /** 這個裝置在 `sinceMs` 之後開了幾局（憑證鑄造速率）。 */
  countRunTokensSince(deviceId: string, sinceMs: number): Promise<number>;

  getScore(runId: string): Promise<ScoreRow | null>;
  /** 這個裝置在 `sinceMs` 之後送了幾筆（速率限制用；**含未通過**的提交）。 */
  countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number>;
  /**
   * 寫入一局，並在通過檢查時更新該玩家的歷史最大值。
   * Persist a run, updating the player's historical maxima when it passed the checks.
   *
   * @returns 是否**真的寫進去了**。同一 `run_id` 再送一次會回 `false`（冪等）—— 這讓「網路重試」
   *   不會讓最大值被算兩次，也讓兩個同時抵達的相同請求只有一個生效。
   *   Whether it was actually written. Submitting the same `run_id` again returns `false`
   *   (idempotent), so a network retry cannot double-count and two identical requests arriving at
   *   once leave exactly one effect.
   */
  saveScore(row: ScoreRow): Promise<boolean>;

  getProfile(deviceId: string): Promise<ProfileRow | null>;
  /**
   * 某個分類的前 `limit` 名（只含 `bestScore > 0` 的玩家）。
   * The top `limit` of one category (only players with `bestScore > 0`).
   *
   * 分類是**必填**而不是可選加預設值：榜有三個分頁，而每一個都應該只有一個寫法。給預設值的話，
   * 呼叫端漏傳的那一天不會報錯，只會安靜地回一份分數榜去填組合數那一頁。
   * The category is **required** rather than optional-with-a-default: the board has three tabs and each
   * deserves exactly one spelling at the call site. A default would let a caller that forgot the
   * argument quietly render a score board inside the combo tab.
   */
  topProfiles(category: BoardCategory, limit: number): Promise<ProfileRow[]>;
  /** 榜上的玩家總數（＝ `bestScore > 0` 的人數），客戶端拿它算「超越了百分之多少」。 */
  countProfiles(): Promise<number>;
  /**
   * 某一組成績在**指定分類**下的名次（1 起算，用與 `topProfiles` **完全相同**的排序）。
   * The 1-based position of a set of numbers **within the given category**, using **exactly** the
   * same ordering as `topProfiles`.
   *
   * 用同一個排序是刻意的：客戶端同時顯示「第 N 名」與逐列的 `#index`，兩者若各算各的，同分時就會
   * 出現「我自己是第 3 名，但列上寫 #5」這種對不起來的畫面。
   * The same ordering is deliberate: the client shows both a rank and a per-row `#index`, and if the
   * two were computed differently, a tie would produce "I am 3rd, but my row says #5".
   */
  rankOf(probe: RankProbe, category: BoardCategory): Promise<number>;

  insertRequest(row: RequestRow): Promise<void>;
}

/**
 * 某一列在指定分類下的取值。
 * What one row is worth in the given category.
 */
function valueFor(profile: ProfileRow, category: BoardCategory): number {
  switch (category) {
    case 'score':
      return profile.bestScore;
    case 'combo':
      return profile.bestMaxCombo;
    case 'merges':
      return profile.bestMerges;
  }
}

/**
 * 榜的排序：該分類降冪，同值時**較早達成**的排前面。
 * Board order: the category descending, and on a tie the **earlier** achievement comes first.
 *
 * 它是 `Dialect.boardOrder()` 的鏡像，兩邊必須逐鍵一致 —— 否則同分時 `topProfiles` 的列序與
 * `rankOf` 算出來的名次會互相矛盾。`compareProfiles` 與 `boardOrder` 的配對在
 * `tests/api.test.ts` 有同分的案例釘住。
 * It mirrors `Dialect.boardOrder()`, and the two must agree key for key — otherwise a tie makes the
 * row order from `topProfiles` contradict the rank from `rankOf`. `tests/api.test.ts` pins the pair
 * together with a tied case.
 *
 * 同分時取早的那一個，是為了讓排序**穩定且不可操作**：如果同分改看時間戳「新的優先」，任何人只要
 * 再送一次就能把自己往上推。
 * Ties go to the earlier one so the order is **stable and not gameable**: with "newest wins" on a
 * tie, anyone could push themselves up by submitting again.
 */
function compareProfiles(category: BoardCategory, a: ProfileRow, b: ProfileRow): number {
  const primary = valueFor(b, category) - valueFor(a, category);
  if (primary !== 0) return primary;

  /*
   * 第二個鍵是**分數**（與客戶端 `compareBy` 同一個想法）：同樣的組合數時，分數高的那位是整體上
   * 更強的玩家。分數分類下這一步是多餘的（主鍵已經相等），但留著讓四個鍵在三個分類裡都是同一個
   * 形狀，也與 `boardOrderKeys()` 逐字對應。
   * The second key is **score** (the same idea as the client's `compareBy`): with the same combo, the
   * higher score is the stronger player overall. It is redundant on the score board (the primary key
   * already ties), but keeping it gives all three categories one shape and matches `boardOrderKeys()`
   * literally.
   */
  if (a.bestScore !== b.bestScore) return b.bestScore - a.bestScore;

  const left = a.bestAtMs ?? 0;
  const right = b.bestAtMs ?? 0;
  if (left !== right) return left - right;

  /* 最後用 id 收尾：少了它，排序會隨插入順序而變，「同樣的榜」在兩次讀取之間可能不一樣。 */
  return a.deviceId.localeCompare(b.deviceId);
}

/** 只存在記憶體裡的實作；給測試用（見檔頭）。 */
export class MemoryStore implements Store {
  private readonly tokens = new Map<string, RunTokenRow>();
  private readonly scores = new Map<string, ScoreRow>();
  private readonly profiles = new Map<string, ProfileRow>();
  private readonly requests: RequestRow[] = [];

  async putRunToken(row: RunTokenRow): Promise<void> {
    this.tokens.set(row.runId, row);
  }

  async getRunToken(runId: string): Promise<RunTokenRow | null> {
    return this.tokens.get(runId) ?? null;
  }

  async markRunTokenUsed(runId: string, atMs: number): Promise<void> {
    const row = this.tokens.get(runId);
    if (row !== undefined) this.tokens.set(runId, { ...row, usedAtMs: atMs });
  }

  async countRunTokensSince(deviceId: string, sinceMs: number): Promise<number> {
    let count = 0;
    for (const row of this.tokens.values()) {
      if (row.deviceId === deviceId && row.issuedAtMs >= sinceMs) count += 1;
    }

    return count;
  }

  async getScore(runId: string): Promise<ScoreRow | null> {
    return this.scores.get(runId) ?? null;
  }

  async countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number> {
    let count = 0;
    for (const row of this.scores.values()) {
      if (row.deviceId === deviceId && row.atMs >= sinceMs) count += 1;
    }

    return count;
  }

  async saveScore(row: ScoreRow): Promise<boolean> {
    if (this.scores.has(row.runId)) return false;

    this.scores.set(row.runId, row);

    /* 未通過檢查的提交**不進榜**（design.md §6.7：未通過者 `verified = false`，榜單排除）。 */
    if (!row.verified) return true;

    const previous = this.profiles.get(row.deviceId);
    const updated: ProfileRow = {
      deviceId: row.deviceId,
      displayName: row.displayName === '' ? (previous?.displayName ?? '') : row.displayName,
      bestScore: Math.max(previous?.bestScore ?? 0, row.score),
      /*
       * 時長跟在分數後面：只有在**分數真的刷新**時才換（與客戶端同一條規則，見
       * `LeaderboardEntry.durationMs`）。否則榜上會出現「最高分旁邊掛著別的一局的時間」。
       * The duration follows the score: it is replaced only when the **score actually improves** —
       * the same rule as the client's `LeaderboardEntry.durationMs`. Otherwise the board would show a
       * best score next to a different run's time.
       */
      bestDurationMs:
        row.score > (previous?.bestScore ?? 0) ? row.durationMs : (previous?.bestDurationMs ?? 0),
      bestMaxCombo: Math.max(previous?.bestMaxCombo ?? 0, row.maxCombo),
      bestMerges: Math.max(previous?.bestMerges ?? 0, row.merges),
      bestAtMs: row.score > (previous?.bestScore ?? 0) ? row.atMs : (previous?.bestAtMs ?? null),
    };

    this.profiles.set(row.deviceId, updated);

    return true;
  }

  async getProfile(deviceId: string): Promise<ProfileRow | null> {
    return this.profiles.get(deviceId) ?? null;
  }

  async topProfiles(category: BoardCategory, limit: number): Promise<ProfileRow[]> {
    return [...this.profiles.values()]
      .filter((row) => row.bestScore > 0)
      .sort((a, b) => compareProfiles(category, a, b))
      .slice(0, Math.max(0, limit));
  }

  async countProfiles(): Promise<number> {
    let count = 0;
    for (const row of this.profiles.values()) {
      if (row.bestScore > 0) count += 1;
    }

    return count;
  }

  async rankOf(probe: RankProbe, category: BoardCategory): Promise<number> {
    /*
     * 把探針補成完整的一列，就能直接複用 `compareProfiles` —— 名次與列序因此**必然**用同一條排序，
     * 而不是兩份「看起來一樣」的比較邏輯。
     * The probe is completed into a full row so `compareProfiles` can be reused directly: the rank and
     * the row order then **necessarily** share one ordering instead of two look-alike comparisons.
     */
    const probeRow: ProfileRow = {
      deviceId: probe.deviceId,
      displayName: '',
      bestScore: probe.score,
      bestDurationMs: 0,
      bestMaxCombo: probe.maxCombo,
      bestMerges: probe.merges,
      bestAtMs: probe.atMs,
    };

    let ahead = 0;
    for (const row of this.profiles.values()) {
      if (row.bestScore <= 0) continue;
      if (compareProfiles(category, row, probeRow) < 0) ahead += 1;
    }

    return ahead + 1;
  }

  async insertRequest(row: RequestRow): Promise<void> {
    /* 上限只是為了不讓一個跑很久的測試把記憶體吃光；正式路徑不會走到這裡。 */
    if (this.requests.length < 10_000) this.requests.push(row);
  }

  /** 測試用：這一輪收到幾筆接收紀錄。 */
  get requestCount(): number {
    return this.requests.length;
  }

  /** 測試用：最近一筆接收紀錄。 */
  get lastRequest(): RequestRow | null {
    return this.requests[this.requests.length - 1] ?? null;
  }
}
