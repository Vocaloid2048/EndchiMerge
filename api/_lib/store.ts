/**
 * 儲存層介面，外加一份測試用的記憶體實作（不得出現在正式路徑：不持久、不跨實例）。
 * The storage interface plus an in-memory implementation for tests (never on the production path:
 * it does not persist and does not span instances).
 */

import type { BoardCategory } from './db/dialect.js';
import { newUserTag } from './tokens.js';

/** 重抽玩家號的次數上限：撞號本身罕見（四位數），上限只是不讓極端情況變成無窮迴圈。
 * How many times a colliding tag is re-rolled: collisions are rare (four digits), and the cap only keeps an extreme case from looping forever. */
const TAG_ATTEMPTS = 10;

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
  /**
   * 要給 profile 的玩家號（**不是** `scores` 的欄位）：只有 `profiles` 帶號，這裡負責把它送過去。
   * The player tag offered to the profile — **not** a `scores` column; only `profiles` carries one.
   */
  readonly userTag: string;
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
  /** 顯示用的四位數玩家號；`''` 代表這一列還沒拿到號（舊庫回填前）。**永遠不是身分**（那是 `deviceId`）。
   * The four-digit display tag; `''` means this row has none yet (an old database before the backfill). **Never identity** (that is `deviceId`). */
  readonly userTag: string;
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
export function compareProfiles(category: BoardCategory, a: ProfileRow, b: ProfileRow): number {
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
 * 這個裝置在**這個名字**下該用哪個號：沿用既有的（所以改名不動號），否則用送進來的那個；只有與**別的裝置**
 * 撞到「同名字＋同號」才重抽 —— 這一條就是「榜上不會有兩列一模一樣」的保證。
 * Which tag this device carries under **this name**: keep the existing one (so a rename does not change
 * it), else take the offered one; a re-roll happens only when **another device** already holds the same
 * name-and-tag pair — that is what keeps two board rows from ever reading alike.
 *
 * `isTaken` 對 KV 是「掃描全表」的 async 檢查，對記憶體是 Map 查詢；兩邊共用同一條規則。
 * `isTaken` is an async scan for KV but a Map lookup for the in-memory store; both share one rule.
 */
export async function resolveUserTag(opts: {
  readonly displayName: string;
  readonly current: string;
  readonly offered: string;
  readonly deviceId: string;
  readonly isTaken: (tag: string) => boolean | Promise<boolean>;
}): Promise<string> {
  /* 沿用既有的 → 用送來的 → 連送來的都是空的就當場鑄一個（例如從 `scores` 讀回來的一列）。
   * Keep the existing one → take the offered one → mint one when even that is empty (a row read back from `scores`, say). */
  let tag = opts.current !== '' ? opts.current : opts.offered !== '' ? opts.offered : newUserTag();
  if (opts.displayName === '') return tag;

  for (let attempt = 0; attempt < TAG_ATTEMPTS && (await opts.isTaken(tag)); attempt += 1) {
    tag = newUserTag();
  }

  return tag;
}

/**
 * 把一筆通過檢查的提交合併進玩家歷史最大值；與客戶端同一條規則：分數真的刷新時才換時長與達成時間。
 * Merges a verified submission into a player's historical maxima; the client's same rule — the duration
 * and achievement time change only when the score actually improves.
 */
export function applyProfileUpdate(existing: ProfileRow | null, score: ScoreRow, userTag: string): ProfileRow {
  return {
    deviceId: score.deviceId,
    displayName: score.displayName === '' ? (existing?.displayName ?? '') : score.displayName,
    userTag,
    bestScore: Math.max(existing?.bestScore ?? 0, score.score),
    bestDurationMs: score.score > (existing?.bestScore ?? 0) ? score.durationMs : (existing?.bestDurationMs ?? 0),
    bestMaxCombo: Math.max(existing?.bestMaxCombo ?? 0, score.maxCombo),
    bestMerges: Math.max(existing?.bestMerges ?? 0, score.merges),
    bestAtMs: score.score > (existing?.bestScore ?? 0) ? score.atMs : (existing?.bestAtMs ?? null),
  };
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

    const previous = this.profiles.get(row.deviceId) ?? null;
    const userTag = await resolveUserTag({
      displayName: row.displayName,
      current: previous?.userTag ?? '',
      offered: row.userTag,
      deviceId: row.deviceId,
      isTaken: (tag) => this.isUserTagTaken(row.displayName, tag, row.deviceId),
    });
    const updated = applyProfileUpdate(previous, row, userTag);

    this.profiles.set(row.deviceId, updated);

    return true;
  }

  /** 這個「名字＋號」是不是已經被**別的**裝置佔用。 */
  private isUserTagTaken(displayName: string, tag: string, deviceId: string): boolean {
    for (const profile of this.profiles.values()) {
      if (profile.deviceId !== deviceId && profile.displayName === displayName && profile.userTag === tag) {
        return true;
      }
    }

    return false;
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
      /* 名次只看數字，與號無關。 */
      userTag: '',
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
