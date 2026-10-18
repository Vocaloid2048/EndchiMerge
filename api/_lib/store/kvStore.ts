/**
 * 用 EdgeOne KV 實作的 `Store`；對應 Makers 的 `cloud-functions`（V8 邊緣執行時，無 TCP，故不能連 SQL）。
 * A `Store` backed by EdgeOne KV; for Makers `cloud-functions` (V8 edge runtime, no TCP, so no SQL).
 *
 * KV 是扁平 key→value，沒有 SQL 的查詢／排序能力，所以「榜」與各種計數都靠掃描前綴下的所有列（O(N)）。
 * FYP 規模可接受；量大時再考慮為每個分類維護一份排序索引。
 * KV is a flat key→value store with no SQL query/sort, so the board and every count scan all rows under
 * a prefix (O(N)). Fine at FYP scale; for volume, maintain a per-category sorted index.
 */

import type { BoardCategory } from '../db/dialect.js';
import { DEFAULT_RUN_MODE, isRunMode, type RunMode } from '../modes.js';
import { newRunId } from '../tokens.js';
import {
  applyProfileUpdate,
  compareProfiles,
  resolveUserTag,
  type ProfileRow,
  type RankProbe,
  type RequestRow,
  type RunTokenRow,
  type ScoreRow,
  type Store,
} from '../store.js';

/** EdgeOne KV 的命名空間介面（只用到的部分）。
 * The slice of the EdgeOne KV namespace interface we use. */
export interface KVNamespace {
  get(key: string, type?: 'text' | 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ readonly keys: ReadonlyArray<{ readonly name: string }>; readonly complete: boolean; readonly cursor: string }>;
}

declare global {
  // eslint-disable-next-line no-var
  var ENDCHI_KV: KVNamespace | undefined;
}

/** 綁定 KV 命名空間時設的變數名；在控制台 Bind Namespace 的 Variable Name 要填一樣的。
 * The variable name set when binding the KV namespace; the console's Variable Name must match. */
export const KV_BINDING = 'ENDCHI_KV';

function kv(): KVNamespace {
  const handle = globalThis.ENDCHI_KV;
  if (handle === undefined) {
    throw new Error(
      `${KV_BINDING} is not bound; bind a KV namespace with variable name ${KV_BINDING} in the EdgeOne console`,
    );
  }
  return handle;
}

const RUN_PREFIX = 'run:';
const SCORE_PREFIX = 'score:';
const PROFILE_PREFIX = 'profile:';
const REQUEST_PREFIX = 'req:';

/** 一位玩家在一個模式下一列：`profile:<裝置>:<模式>`。 */
function profileKey(deviceId: string, mode: RunMode): string {
  return `${PROFILE_PREFIX}${deviceId}:${mode}`;
}

function matchesMode(row: ProfileRow, mode: RunMode | null): boolean {
  return mode === null || row.mode === mode;
}

/**
 * 舊列的 `mode` 可能不存在（這個欄位是後加的）；讀回來時補成新玩法，榜的篩選才不會漏掉它。
 * Old rows may lack `mode` (the field was added later); reading them as the new mode keeps them on
 * that filter instead of vanishing from every board.
 */
function normaliseProfile(row: ProfileRow | null): ProfileRow | null {
  if (row === null) return null;

  return isRunMode(row.mode) ? row : { ...row, mode: DEFAULT_RUN_MODE };
}

export class KvStore implements Store {
  async putRunToken(row: RunTokenRow): Promise<void> {
    await kv().put(RUN_PREFIX + row.runId, JSON.stringify(row));
  }

  async getRunToken(runId: string): Promise<RunTokenRow | null> {
    const value = await kv().get(RUN_PREFIX + runId, 'json');
    return (value as RunTokenRow | null) ?? null;
  }

  async markRunTokenUsed(runId: string, atMs: number): Promise<void> {
    const row = await this.getRunToken(runId);
    if (row === null) return;
    await kv().put(RUN_PREFIX + runId, JSON.stringify({ ...row, usedAtMs: atMs }));
  }

  async countRunTokensSince(deviceId: string, sinceMs: number): Promise<number> {
    let count = 0;
    for await (const row of this.eachRun()) {
      if (row.deviceId === deviceId && row.issuedAtMs >= sinceMs) count += 1;
    }
    return count;
  }

  async getScore(runId: string): Promise<ScoreRow | null> {
    const value = await kv().get(SCORE_PREFIX + runId, 'json');
    return (value as ScoreRow | null) ?? null;
  }

  async countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number> {
    let count = 0;
    for await (const row of this.eachScore()) {
      if (row.deviceId === deviceId && row.atMs >= sinceMs) count += 1;
    }
    return count;
  }

  async saveScore(row: ScoreRow): Promise<boolean> {
    /* 冪等：同一 `run_id` 再送回 `false`，網路重試不會重複計入。
     * Idempotent: the same `run_id` again returns `false`, so a retry cannot double-count. */
    const existingScore = await this.getScore(row.runId);
    if (existingScore !== null) return false;

    await kv().put(SCORE_PREFIX + row.runId, JSON.stringify(row));

    /* 未通過檢查的提交不進榜。
     * Submissions that failed the checks never enter the board. */
    if (!row.verified) return true;

    await this.mergeProfile(row);

    return true;
  }

  /*
   * 同一局的即時更新：覆蓋數字而不是新增一列；`atMs` 保留首次提交的時間（與另外兩個 store 一致）。
   * 被退回的更新整條跳過 —— 不合理的提交不該抹掉之前那筆已驗證的成績。
   * A live update to the same run: overwrites the figures instead of adding a row, keeping the first
   * submission's `atMs` (consistent with the other two stores). A rejected update is skipped
   * entirely — an implausible submission must not erase an earlier verified result.
   */
  async updateScore(row: ScoreRow): Promise<void> {
    const existing = await this.getScore(row.runId);
    if (existing === null || existing.deviceId !== row.deviceId) return;
    if (!row.verified) return;

    await kv().put(SCORE_PREFIX + row.runId, JSON.stringify({ ...row, atMs: existing.atMs }));
    await this.mergeProfile(row);
  }

  private async mergeProfile(row: ScoreRow): Promise<void> {
    const previous = await this.getProfile(row.deviceId, row.mode);
    const userTag = await resolveUserTag({
      displayName: row.displayName,
      current: previous?.userTag ?? '',
      offered: row.userTag,
      deviceId: row.deviceId,
      isTaken: (tag) => this.isUserTagTaken(row.displayName, tag, row.deviceId),
    });
    const updated = applyProfileUpdate(previous, row, userTag);

    await kv().put(profileKey(row.deviceId, row.mode), JSON.stringify(updated));
  }

  async getProfile(deviceId: string, mode: RunMode = DEFAULT_RUN_MODE): Promise<ProfileRow | null> {
    const value = await kv().get(profileKey(deviceId, mode), 'json');
    if (value !== null) return normaliseProfile(value as ProfileRow | null);

    /*
     * 升級前的鍵是 `profile:<裝置>`（沒有模式）。它只可能屬於新玩法，所以在新玩法下讀到就順手
     * 搬到新鍵再刪掉舊鍵 —— 不搬的話，這次提交會寫出第二列，榜上同一個人就出現兩次。
     * The pre-upgrade key was `profile:<device>` (no mode). It can only be the new mode, so reading
     * it under that mode moves it to the new key and deletes the old one — leaving it would make the
     * next submission write a second row and put the same player on the board twice.
     */
    if (mode !== DEFAULT_RUN_MODE) return null;

    const legacy = await kv().get(PROFILE_PREFIX + deviceId, 'json');
    const row = normaliseProfile(legacy as ProfileRow | null);
    if (row === null) return null;

    await kv().put(profileKey(deviceId, mode), JSON.stringify(row));
    await kv().delete(PROFILE_PREFIX + deviceId);

    return row;
  }

  async topProfiles(
    category: BoardCategory,
    limit: number,
    mode: RunMode | null = null,
  ): Promise<ProfileRow[]> {
    const rows: ProfileRow[] = [];
    for await (const row of this.eachProfile()) {
      if (row.bestScore > 0 && matchesMode(row, mode)) rows.push(row);
    }
    rows.sort((a, b) => compareProfiles(category, a, b));
    return rows.slice(0, Math.max(0, limit));
  }

  async countProfiles(mode: RunMode | null = null): Promise<number> {
    let count = 0;
    for await (const row of this.eachProfile()) {
      if (row.bestScore > 0 && matchesMode(row, mode)) count += 1;
    }
    return count;
  }

  async countPlayers(): Promise<number> {
    const devices = new Set<string>();
    for await (const row of this.eachProfile()) {
      if (row.bestScore > 0) devices.add(row.deviceId);
    }
    return devices.size;
  }

  async rankOf(
    probe: RankProbe,
    category: BoardCategory,
    mode: RunMode | null = null,
  ): Promise<number> {
    const probeRow: ProfileRow = {
      deviceId: probe.deviceId,
      mode: probe.mode ?? DEFAULT_RUN_MODE,
      displayName: '',
      userTag: '',
      bestScore: probe.score,
      bestDurationMs: 0,
      bestMaxCombo: probe.maxCombo,
      bestMerges: probe.merges,
      bestAtMs: probe.atMs,
    };

    let ahead = 0;
    for await (const row of this.eachProfile()) {
      if (row.bestScore <= 0) continue;
      if (!matchesMode(row, mode)) continue;
      if (compareProfiles(category, row, probeRow) < 0) ahead += 1;
    }
    return ahead + 1;
  }

  async insertRequest(row: RequestRow): Promise<void> {
    /* 接收紀錄用獨立前綴，不會混進榜的掃描；失敗不影響回應（runtime 已吞錯）。
     * The receive log uses its own prefix so it never mixes into board scans; a failure does not
     * affect the response (the runtime swallows it). */
    await kv().put(REQUEST_PREFIX + newRunId(), JSON.stringify(row));
  }

  private async isUserTagTaken(displayName: string, tag: string, deviceId: string): Promise<boolean> {
    for await (const profile of this.eachProfile()) {
      if (profile.deviceId !== deviceId && profile.displayName === displayName && profile.userTag === tag) {
        return true;
      }
    }
    return false;
  }

  private async *eachRun(): AsyncGenerator<RunTokenRow> {
    yield* this.each<RunTokenRow>(RUN_PREFIX);
  }

  private async *eachScore(): AsyncGenerator<ScoreRow> {
    yield* this.each<ScoreRow>(SCORE_PREFIX);
  }

  private async *eachProfile(): AsyncGenerator<ProfileRow> {
    for await (const row of this.each<ProfileRow>(PROFILE_PREFIX)) {
      const normalised = normaliseProfile(row);
      if (normalised !== null) yield normalised;
    }
  }

  private async *each<T>(prefix: string): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const result = await kv().list({ prefix, limit: 256, cursor });
      const entries = await Promise.all(
        result.keys.map(async (key) => {
          const value = await kv().get(key.name, 'json');
          return value as T | null;
        }),
      );
      for (const entry of entries) {
        if (entry !== null) yield entry;
      }
      cursor = result.complete ? undefined : result.cursor;
    } while (cursor !== undefined);
  }
}
