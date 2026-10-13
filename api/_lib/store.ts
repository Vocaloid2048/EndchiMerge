/**
 * 儲存層介面，外加一份測試用的記憶體實作（不得出現在正式路徑：不持久、不跨實例）。
 * The storage interface plus an in-memory implementation for tests (never on the production path:
 * it does not persist and does not span instances).
 */

import type { BoardCategory } from './db/dialect.js';

/**
 * `requests` 的一列（接收日誌）。
 * One row of `requests` (the receive log).
 *
 * ⚠️ 私隱：**只有**端點維運需要的五個欄位 —— IP 與標頭屬個人資料，永不落庫。
 * ⚠️ Privacy: **only** the five fields operations needs — IPs and headers are personal data and are never persisted.
 */
export interface RequestRow {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly deviceId: string | null;
  readonly runId: string | null;
}

/**
 * `run_tokens` 的一列。
 * One row of `run_tokens`.
 */
export interface RunTokenRow {
  readonly runId: string;
  readonly deviceId: string;
  readonly tokenHash: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly usedAtMs: number | null;
}

/**
 * `scores` 的一列（一局一列）。
 * One row of `scores` (one per run).
 */
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
  readonly atMs: number;
}

/**
 * 一位玩家一列；三個最大值各自獨立，與客戶端資料層同一個模型。
 * One row per player; the three maxima are independent, matching the client's data layer.
 */
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
 * 名次查詢要問的那組數字；三個最大值都要帶 —— 名次相對於分類，只帶分數會讓其他分頁的名次錯掉。
 * The numbers a rank lookup asks about; all three maxima are required — a rank is relative to a
 * category, so carrying only the score would make the other tabs' ranks wrong.
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
  /**
   * 這個裝置在 `sinceMs` 之後開了幾局（憑證鑄造速率）。
   * How many runs this device started since `sinceMs` (the token-minting rate).
   */
  countRunTokensSince(deviceId: string, sinceMs: number): Promise<number>;

  getScore(runId: string): Promise<ScoreRow | null>;
  /**
   * 這個裝置在 `sinceMs` 之後送了幾筆（速率限制用；含未通過的提交）。
   * Submissions by this device since `sinceMs` (for rate limiting; rejected ones included).
   */
  countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number>;
  /**
   * 寫入一局，並在通過檢查時更新該玩家的歷史最大值。
   * Persists a run, updating the player's historical maxima when it passed the checks.
   *
   * @returns 是否真的寫入；同一 `run_id` 再送回 `false`（冪等），網路重試不會重複計入。
   *   Whether it was actually written; the same `run_id` again returns `false` (idempotent), so a
   *   network retry cannot double-count.
   */
  saveScore(row: ScoreRow): Promise<boolean>;

  getProfile(deviceId: string): Promise<ProfileRow | null>;
  /**
   * 某個分類的前 `limit` 名（只含 `bestScore > 0`）；分類必填、不設預設值，漏傳要直接報錯而不是安靜地填錯分頁。
   * The top `limit` of one category (only `bestScore > 0`); the category is required with no default,
   * so a forgotten argument fails loudly instead of quietly filling the wrong tab.
   */
  topProfiles(category: BoardCategory, limit: number): Promise<ProfileRow[]>;
  /**
   * 榜上的玩家總數（`bestScore > 0` 的人數）。
   * The number of players on the board (those with `bestScore > 0`).
   */
  countProfiles(): Promise<number>;
  /**
   * 某組成績在指定分類下的名次（1 起算），與 `topProfiles` 用完全相同的排序。
   * The 1-based rank of a set of numbers within the given category, using exactly the same ordering
   * as `topProfiles`.
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
 * 榜的排序：該分類降冪，同值時較早達成者優先（穩定且不可操作）；是 `Dialect.boardOrder()` 的鏡像，兩者必須逐鍵一致。
 * Board order: the category descending, ties going to the earlier achievement (stable and not
 * gameable); mirrors `Dialect.boardOrder()` and must agree key for key.
 */
function compareProfiles(category: BoardCategory, a: ProfileRow, b: ProfileRow): number {
  const primary = valueFor(b, category) - valueFor(a, category);
  if (primary !== 0) return primary;

  /*
   * 第二鍵是分數：分數分類下雖多餘，但讓三個分類同一個形狀，與 `boardOrderKeys()` 對應。
   * The second key is score: redundant on the score board, but it keeps all three categories one
   * shape and matches `boardOrderKeys()`.
   */
  if (a.bestScore !== b.bestScore) return b.bestScore - a.bestScore;

  const left = a.bestAtMs ?? 0;
  const right = b.bestAtMs ?? 0;
  if (left !== right) return left - right;

  /*
   * 最後用 id 收尾：少了它，排序會隨插入順序而變。
   * The id breaks remaining ties: without it, the order depends on insertion.
   */
  return a.deviceId.localeCompare(b.deviceId);
}

/**
 * 只存在記憶體裡的實作；給測試用（見檔頭）。
 * The in-memory implementation; for tests only (see the file header).
 */
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

    /*
     * 未通過檢查的提交不進榜。
     * Submissions that failed the checks never enter the board.
     */
    if (!row.verified) return true;

    const previous = this.profiles.get(row.deviceId);
    const updated: ProfileRow = {
      deviceId: row.deviceId,
      displayName: row.displayName === '' ? (previous?.displayName ?? '') : row.displayName,
      bestScore: Math.max(previous?.bestScore ?? 0, row.score),
      /*
       * 時長只在分數真的刷新時才跟著換（與客戶端同一條規則），否則最高分旁會掛別的一局的時間。
       * The duration is replaced only when the score actually improves (the client's rule too);
       * otherwise a best score would sit next to a different run's time.
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
     * 把探針補成完整一列以複用 `compareProfiles`：名次與列序必然共用同一條排序。
     * The probe is completed into a full row to reuse `compareProfiles`: rank and row order
     * necessarily share one ordering.
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
    /*
     * 上限只是不讓一個跑很久的測試把記憶體吃光；正式路徑不會走到這裡。
     * The cap only keeps a long test from eating memory; production never reaches this.
     */
    if (this.requests.length < 10_000) this.requests.push(row);
  }

  /**
   * 測試用：這一輪收到幾筆接收紀錄。
   * Test helper: how many receive records were collected.
   */
  get requestCount(): number {
    return this.requests.length;
  }

  /**
   * 測試用：最近一筆接收紀錄。
   * Test helper: the most recent receive record.
   */
  get lastRequest(): RequestRow | null {
    return this.requests[this.requests.length - 1] ?? null;
  }
}
