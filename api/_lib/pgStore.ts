/**
 * Postgres 版的儲存層。
 * The Postgres-backed store.
 *
 * 目標是**任何** Postgres：Neon、Supabase、自架的 NAS、本機的容器都一樣，唯一的差別是
 * `DATABASE_URL`。所以這裡只用標準 SQL（`ON CONFLICT`、`GREATEST`、`jsonb`），不碰任何一家
 * 的專屬功能 —— 換供應商時要改的是一個環境變數，不是這支檔案。
 * The target is **any** Postgres: Neon, Supabase, a self-hosted NAS, a local container — the only
 * difference is `DATABASE_URL`. So this uses plain SQL (`ON CONFLICT`, `GREATEST`, `jsonb`) and no
 * vendor-specific feature: moving providers changes an environment variable, not this file.
 *
 * ## 連線池 / The pool
 *
 * Vercel 的函式實例是短命的，而 **Postgres 的連線很貴**（每個連線約 10MB 記憶體、開一次要
 * 50–100ms）。所以：池子是**模組層級**的（同一個實例重用它、跨請求共用），而且 `max` 開得很小。
 * 要注意的是**必須用池化連線字串**（Neon 的主機名帶 `-pooler`）：用直連的話每個實例都會佔掉一條
 * 真實連線，併發一高就撞上 `too many connections`。
 * Vercel function instances are short-lived, and **Postgres connections are expensive** (~10MB each,
 * 50–100ms to open). So the pool is **module-scoped** (one per instance, reused across requests) and
 * `max` is small. The important part is to **use the pooled connection string** (Neon's host carries
 * `-pooler`): with a direct connection every instance holds a real backend connection, and moderate
 * concurrency hits `too many connections`.
 */

import { Pool, type PoolClient } from 'pg';
import type { Config } from './env';
import type { RequestRow } from './requests';
import type { ProfileRow, RunTokenRow, ScoreRow, Store } from './store';

/**
 * 每個實例最多幾條連線。開 2 而不是 1：一個請求可能同時要讀憑證與寫分數，只有一條會排隊；開太大
 * 則會讓併發的實例一起把資料庫的連線數吃光。
 * At most this many connections per instance. Two rather than one because a single request both reads
 * a token and writes a score, and one connection would serialise them; more than a few lets
 * concurrent instances exhaust the database's connection limit together.
 */
const POOL_MAX = 2;

const pools = new Map<string, Pool>();

/**
 * 取得（或建立）這個連線字串的池子。用 `Map` 快取是為了讓**熱重載與測試**不會一直漏池子 ——
 * 每次呼叫都新建一個池子的話，每個舊池子都會繼續佔著連線直到逾時。
 * Get (or create) the pool for this connection string. The `Map` matters for **hot reload and tests**
 * not to leak pools: a fresh pool per call would leave every old one holding connections until it
 * times out.
 */
function poolFor(config: Config): Pool {
  const existing = pools.get(config.databaseUrl);
  if (existing !== undefined) return existing;

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: POOL_MAX,
    /*
     * 閒置的連線在 serverless 上沒有價值（實例本來就會被回收），而且資料庫端會比較快把連線釋放
     * 出來給別的實例。`idleTimeoutMillis` 預設 10 秒在這裡太長。
     * Idle connections are worth nothing on serverless (instances get reclaimed anyway) and the
     * database frees them for other instances sooner. The 10s default is too long here.
     */
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
  });

  /* 池子層級的錯誤不能讓整個 Node 行程掛掉：斷線是正常事件，記下來就好。 */
  pool.on('error', (error) => {
    console.error('[api] idle client error', error);
  });

  pools.set(config.databaseUrl, pool);

  return pool;
}

/** 測試與本機工具用：關掉所有池子。 */
export async function closePools(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(async (pool) => pool.end()));
}

type Row = Record<string, unknown>;

const asNumber = (value: unknown): number => Number(value ?? 0);
const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNullableText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
const asNullableMs = (value: unknown): number | null => (value === null ? null : Number(value));

/** 毫秒 → ISO 字串（給 `$n::timestamptz` 用）。時間一律在邊界轉，不讓 JS 的 `Date` 參與運算。 */
const toTimestamp = (ms: number): string => new Date(ms).toISOString();

const TOKEN_COLUMNS = `
  run_id,
  device_id,
  token_hash,
  (extract(epoch from issued_at) * 1000)::bigint as issued_at_ms,
  (extract(epoch from expires_at) * 1000)::bigint as expires_at_ms,
  case when used_at is null then null
       else (extract(epoch from used_at) * 1000)::bigint end as used_at_ms
`;

const PROFILE_COLUMNS = `
  device_id,
  display_name,
  best_score,
  best_duration_ms,
  best_max_combo,
  best_merges,
  case when best_at is null then null
       else (extract(epoch from best_at) * 1000)::bigint end as best_at_ms
`;

function toProfileRow(row: Row): ProfileRow {
  return {
    deviceId: asText(row['device_id']),
    displayName: asText(row['display_name']),
    bestScore: asNumber(row['best_score']),
    bestDurationMs: asNumber(row['best_duration_ms']),
    bestMaxCombo: asNumber(row['best_max_combo']),
    bestMerges: asNumber(row['best_merges']),
    bestAtMs: asNullableMs(row['best_at_ms']),
  };
}

function toTokenRow(row: Row): RunTokenRow {
  return {
    runId: asText(row['run_id']),
    deviceId: asText(row['device_id']),
    tokenHash: asText(row['token_hash']),
    issuedAtMs: asNumber(row['issued_at_ms']),
    expiresAtMs: asNumber(row['expires_at_ms']),
    usedAtMs: asNullableMs(row['used_at_ms']),
  };
}

export class PgStore implements Store {
  private readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  private get pool(): Pool {
    return poolFor(this.config);
  }

  async putRunToken(row: RunTokenRow): Promise<void> {
    await this.pool.query(
      `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz)
       on conflict (run_id) do nothing`,
      [row.runId, row.deviceId, row.tokenHash, toTimestamp(row.issuedAtMs), toTimestamp(row.expiresAtMs)],
    );
  }

  async getRunToken(runId: string): Promise<RunTokenRow | null> {
    const { rows } = await this.pool.query(
      `select ${TOKEN_COLUMNS} from run_tokens where run_id = $1`,
      [runId],
    );

    const row = (rows as Row[])[0];

    return row === undefined ? null : toTokenRow(row);
  }

  async markRunTokenUsed(runId: string, atMs: number): Promise<void> {
    await this.pool.query(
      'update run_tokens set used_at = $2::timestamptz where run_id = $1 and used_at is null',
      [runId, toTimestamp(atMs)],
    );
  }

  async countRunTokensSince(deviceId: string, sinceMs: number): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from run_tokens
       where device_id = $1 and issued_at >= $2::timestamptz`,
      [deviceId, toTimestamp(sinceMs)],
    );

    return asNumber((rows as Row[])[0]?.['n']);
  }

  async getScore(runId: string): Promise<ScoreRow | null> {
    const { rows } = await this.pool.query(
      `select run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
              version, verified, rejected, client_ip,
              (extract(epoch from created_at) * 1000)::bigint as at_ms
       from scores where run_id = $1`,
      [runId],
    );

    const row = (rows as Row[])[0];
    if (row === undefined) return null;

    return {
      runId: asText(row['run_id']),
      deviceId: asText(row['device_id']),
      displayName: asText(row['display_name']),
      score: asNumber(row['score']),
      durationMs: asNumber(row['duration_ms']),
      merges: asNumber(row['merges']),
      drops: asNumber(row['drops']),
      maxCombo: asNumber(row['max_combo']),
      version: asText(row['version']),
      verified: row['verified'] === true,
      rejected: asNullableText(row['rejected']),
      clientIp: asNullableText(row['client_ip']),
      atMs: asNumber(row['at_ms']),
    };
  }

  async countSubmissionsSince(deviceId: string, sinceMs: number): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from scores
       where device_id = $1 and created_at >= $2::timestamptz`,
      [deviceId, toTimestamp(sinceMs)],
    );

    return asNumber((rows as Row[])[0]?.['n']);
  }

  async saveScore(row: ScoreRow): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');
      const inserted = await insertScore(client, row);

      /*
       * 同一局重複提交（網路重試）時 `inserted` 是 false，這時候**不能**再動 profile：分數早就算
       * 進去了，再算一次會讓 `updated_at` 一直往前跑，看起來像剛刷新。
       * On a duplicate submission (a network retry) `inserted` is false and the profile must **not** be
       * touched again: the score is already counted, and doing it twice would keep pushing
       * `updated_at` forward so it looks freshly beaten.
       */
      if (!inserted) {
        await client.query('commit');
        return false;
      }

      /* 未通過檢查的提交留檔但不進榜（design.md §6.7）。 */
      if (row.verified) {
        await client.query(
          `insert into profiles (
             device_id, display_name, best_score, best_duration_ms, best_max_combo, best_merges,
             best_at, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, now(), now())
           on conflict (device_id) do update set
             display_name = case when excluded.display_name = ''
                                 then profiles.display_name else excluded.display_name end,
             best_duration_ms = case when excluded.best_score > profiles.best_score
                                     then excluded.best_duration_ms else profiles.best_duration_ms end,
             best_at = case when excluded.best_score > profiles.best_score
                            then excluded.best_at else profiles.best_at end,
             best_score = greatest(profiles.best_score, excluded.best_score),
             best_max_combo = greatest(profiles.best_max_combo, excluded.best_max_combo),
             best_merges = greatest(profiles.best_merges, excluded.best_merges),
             updated_at = now()`,
          [
            row.deviceId,
            row.displayName,
            row.score,
            row.durationMs,
            row.maxCombo,
            row.merges,
            toTimestamp(row.atMs),
          ],
        );
      }

      await client.query('commit');

      return true;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getProfile(deviceId: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query(
      `select ${PROFILE_COLUMNS} from profiles where device_id = $1`,
      [deviceId],
    );

    const row = (rows as Row[])[0];

    return row === undefined ? null : toProfileRow(row);
  }

  async topProfiles(limit: number): Promise<ProfileRow[]> {
    const { rows } = await this.pool.query(
      `select ${PROFILE_COLUMNS} from profiles
       where best_score > 0
       order by best_score desc, best_at asc nulls last, device_id asc
       limit $1`,
      [Math.max(0, limit)],
    );

    return (rows as Row[]).map(toProfileRow);
  }

  async countProfiles(): Promise<number> {
    const { rows } = await this.pool.query(
      'select count(*)::int as n from profiles where best_score > 0',
    );

    return asNumber((rows as Row[])[0]?.['n']);
  }

  async rankOf(key: { score: number; atMs: number; deviceId: string }): Promise<number> {
    /*
     * 名次 ＝ 排在自己前面的有幾個 ＋ 1，而「排在前面」寫成**與 `topProfiles` 同一條排序**的三段
     * 條件：分數更高，或同分但更早達成，或三者完全相同時 id 較小。寫成 `order by` 的鏡像是刻意的
     * —— 兩邊任何一邊改了，這裡就必須跟著改，而 `tests/api.test.ts` 會用同分的案例把兩邊釘在一起。
     * The rank is "how many come before me, plus one", and "before me" is spelled out as the **same
     * three-part ordering as `topProfiles`**: a higher score, or an equal score reached earlier, or —
     * with all three equal — a smaller id. Mirroring the `order by` is deliberate: changing either side
     * requires changing this one, and `tests/api.test.ts` pins the two together with a tied case.
     */
    const { rows } = await this.pool.query(
      `select count(*)::int as n from profiles
       where best_score > $1
          or (best_score = $1 and best_at is not null and best_at < $2::timestamptz)
          or (best_score = $1 and best_at = $2::timestamptz and device_id < $3)`,
      [key.score, toTimestamp(key.atMs), key.deviceId],
    );

    return asNumber((rows as Row[])[0]?.['n']) + 1;
  }

  async insertRequest(row: RequestRow): Promise<void> {
    await this.pool.query(
      `insert into requests (
         method, path, status, device_id, run_id, client_ip, user_agent, accept_language,
         origin, referer, country, region, city, headers
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
      [
        row.method,
        row.path,
        row.status,
        row.deviceId,
        row.runId,
        row.clientIp,
        row.userAgent,
        row.acceptLanguage,
        row.origin,
        row.referer,
        row.country,
        row.region,
        row.city,
        JSON.stringify(row.headers),
      ],
    );
  }
}

/**
 * 插入一局，回報是否真的插進去了。
 * Insert a run, reporting whether it actually landed.
 *
 * `on conflict do nothing` 加上 `returning` 是**原子**的冪等：檢查「有沒有一樣的局」與寫入是同一個
 * 陳述式，所以兩個同時抵達的請求不會都以為自己是第一個。先 `select` 再 `insert` 做不到這件事。
 * `on conflict do nothing` with `returning` is atomic idempotency: the "does this run exist" check and
 * the write are one statement, so two requests arriving together cannot both believe they were first.
 * A `select` followed by an `insert` cannot promise that.
 */
async function insertScore(client: PoolClient, row: ScoreRow): Promise<boolean> {
  const { rows } = await client.query(
    `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, client_ip
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (run_id) do nothing
     returning run_id`,
    [
      row.runId,
      row.deviceId,
      row.displayName,
      row.score,
      row.durationMs,
      row.merges,
      row.drops,
      row.maxCombo,
      row.version,
      row.verified,
      row.rejected,
      row.clientIp,
    ],
  );

  return (rows as Row[]).length > 0;
}
