/**
 * Postgres：驅動（`pg`）＋ 方言。
 * Postgres: the driver (`pg`) and the dialect.
 */

import { Pool, type PoolClient } from 'pg';

import { boardOrderKeys, type Dialect } from './dialect.js';
import type { Driver, Row, SqlResult } from './types.js';

/**
 * 每個實例最多幾條連線；2 條讓同時讀憑證與寫分數不互相排隊，又不會一起把資料庫的連線數吃光。
 * At most this many connections per instance; two keeps a token read and a score write from queueing while not exhausting the database's connections.
 */
const POOL_MAX = 2;

/**
 * 需要 TLS 的託管供應商；命中且未明講 `sslmode` 時，補上「加密但不驗憑證鏈」的設定。
 * Managed providers that need TLS; when one matches and `sslmode` is not spelled out, an "encrypt but do not verify the chain" setting is added.
 */
const MANAGED_HOSTS = /(neon\.tech|supabase\.(co|com|in)|render\.com|amazonaws\.com|azure\.com|aliyuncs\.com|tencentcloud)/i;

function sslFor(url: string): undefined | { rejectUnauthorized: boolean } {
  /*
   * 連線字串自己講了 `sslmode` 就別插手：那是使用者明確的選擇。
   * If the connection string spells out `sslmode`, do not interfere: that is an explicit choice.
   */
  if (/[?&]sslmode=/i.test(url)) return undefined;

  return MANAGED_HOSTS.test(url) ? { rejectUnauthorized: false } : undefined;
}

/**
 * `pg` 當成 `verify-full` **別名**的那三個 SSL 模式。
 * The three SSL modes `pg` treats as **aliases for `verify-full`**.
 */
const SSLMODE_ALIASES = /([?&]sslmode=)(prefer|require|verify-ca)(?=[&#]|$)/i;

/**
 * 把 SSL 模式的**別名**寫成它今天真正的意思（`verify-full`）。
 * Spells the SSL mode **aliases** out as what they mean today (`verify-full`).
 *
 * 不動 `verify-full`／`disable`／`allow`，也不動帶 `uselibpqcompat=true` 的字串（那是使用者的明確選擇）。
 * Leaves `verify-full` / `disable` / `allow` alone, and any string carrying `uselibpqcompat=true` (an explicit choice).
 */
export function normaliseSslMode(url: string): string {
  if (/[?&]uselibpqcompat=(true|1)/i.test(url)) return url;

  return url.replace(SSLMODE_ALIASES, '$1verify-full');
}

/**
 * 對連線字串的建議；回傳的是**要記進日誌的字串**，不是錯誤，都不該讓後端起不來。
 * Advice about the connection string; these are **strings for the log**, never errors, and none should stop the backend from starting.
 */
export function connectionNotes(url: string): string[] {
  const notes: string[] = [];

  if (url.includes('neon.tech') && !url.includes('-pooler')) {
    notes.push(
      'Neon 連線字串沒有帶 `-pooler`：直連會讓每個函式實例各佔一條後端連線，併發一高就會撞上 too many connections。',
    );
  }

  if (!/[?&]sslmode=/i.test(url) && !MANAGED_HOSTS.test(url)) {
    notes.push(
      '連線字串沒有帶 `sslmode`，而且看不出是託管服務：若資料庫在公網上，請用 `sslmode=require`，否則密碼會以明文傳輸。',
    );
  }

  return notes;
}

/**
 * `pg` 的驅動。
 * The `pg` driver.
 *
 * 交易另開一條專屬連線：池子的連線會被共用，而 `begin`／`commit` 是連線層級的狀態。
 * Transactions use a dedicated connection: pool connections are shared, and `begin` / `commit` are connection-level state.
 */
class PostgresDriver implements Driver {
  constructor(
    private readonly pool: Pool,
    /**
     * 非 `null` 表示這個 driver 已經在某個交易裡（見 `Driver.transaction`）。
     * Non-`null` means this driver is already inside a transaction (see `Driver.transaction`).
     */
    private readonly client: PoolClient | null = null,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const executor = this.client ?? this.pool;
    const result = await executor.query(sql, params as unknown[]);

    return { rows: result.rows as Row[], affected: result.rowCount ?? 0 };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    /*
     * 已經在交易裡就不再開一層（介面上的理由見 `types.ts`）。
     * Already inside a transaction, so do not nest another (see `types.ts` for why).
     */
    if (this.client !== null) return run(this);

    const client = await this.pool.connect();

    try {
      await client.query('begin');
      const result = await run(new PostgresDriver(this.pool, client));
      await client.query('commit');

      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    /*
     * 交易中的 driver 不擁有池子，關掉是池子的事。
     * A transaction driver does not own the pool; closing it is the pool's job.
     */
    if (this.client === null) await this.pool.end();
  }
}

export function createPostgresDriver(url: string): Driver {
  /*
   * 正規化**先做**，讓「送進 `pg` 的那一條字串」只有一個來源（`sslFor()` 只在沒有 `sslmode` 時插手）。
   * Normalise **first** so there is one single source for the string that goes into `pg` (`sslFor()` only steps in when `sslmode` is absent).
   */
  const connectionString = normaliseSslMode(url);
  const ssl = sslFor(connectionString);

  const pool = new Pool({
    connectionString,
    max: POOL_MAX,
    /*
     * serverless 上閒置連線沒有價值（實例本來就會被回收），而且資料庫端會較快把連線讓給別的實例；預設 10 秒太長。
     * Idle connections are worth nothing on serverless (instances get reclaimed anyway) and the database frees them sooner; the 10s default is too long.
     */
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    ...(ssl === undefined ? {} : { ssl }),
  });

  /*
   * 池子層級的錯誤不能讓整個 Node 行程掛掉：斷線是正常事件，記下來就好。
   * A pool-level error must not take the Node process down: a dropped connection is normal, so just log it.
   */
  pool.on('error', (error) => {
    console.error('[api] idle client error', error);
  });

  return new PostgresDriver(pool);
}

export const postgresDialect: Dialect = {
  name: 'postgres',

  ph: (position) => `$${position}`,
  ts: (ms) => new Date(ms).toISOString(),
  tsPlaceholder: (position) => `$${position}::timestamptz`,
  jsonPlaceholder: (position) => `$${position}::jsonb`,

  epochMs: (column) => `(extract(epoch from ${column}) * 1000)::bigint`,
  readTime: (value) => (value === null || value === undefined ? null : Number(value)),
  countInt: (expression) => `${expression}::int`,
  readNumber: (value) => Number(value ?? 0),
  /*
   * Postgres 真的回布林，但 `pg` 對某些欄位型別可能給字串，所以兩種都認。
   * Postgres really returns booleans, but `pg` may hand back a string for some column types, so both are accepted.
   */
  readBool: (value) => value === true || value === 't' || value === 1 || value === '1',

  boardOrder: (category) => boardOrderKeys(category, 'best_at asc nulls last'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz)
     on conflict (run_id) do nothing`,

  /*
   * ⚠️ `created_at` 是**綁進去的**，不是靠 DDL 的 `default now()`：這一欄是速率限制與審計的依據，而 `MemoryStore` 用的是呼叫端傳入的 `atMs`。
   * ⚠️ `created_at` is **bound**, not left to the DDL's `default now()`: the column backs the rate limit and audit trail, and `MemoryStore` uses the caller's `atMs`.
   */
  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
     on conflict (run_id) do nothing
     returning run_id`,

  insertScoreSignal: 'rows',

  upsertProfile: () => `insert into profiles (
       device_id, display_name, user_tag, best_score, best_duration_ms, best_max_combo, best_merges,
       best_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, now(), now())
     on conflict (device_id) do update set
       display_name = case when excluded.display_name = ''
                           then profiles.display_name else excluded.display_name end,
       user_tag = excluded.user_tag,
       best_duration_ms = case when excluded.best_score > profiles.best_score
                               then excluded.best_duration_ms else profiles.best_duration_ms end,
       best_at = case when excluded.best_score > profiles.best_score
                      then excluded.best_at else profiles.best_at end,
       best_score = greatest(profiles.best_score, excluded.best_score),
       best_max_combo = greatest(profiles.best_max_combo, excluded.best_max_combo),
       best_merges = greatest(profiles.best_merges, excluded.best_merges),
       updated_at = now()`,

  schema: () => [
    `create table if not exists profiles (
       device_id         text primary key,
       display_name      text        not null default '',
       user_tag          varchar(4)  not null default '',
       best_score        integer     not null default 0,
       best_max_combo    integer     not null default 0,
       best_merges       integer     not null default 0,
       best_duration_ms  integer     not null default 0,
       best_at           timestamptz,
       name_changed_at   timestamptz,
       created_at        timestamptz not null default now(),
       updated_at        timestamptz not null default now()
     )`,
    `create index if not exists profiles_best_score_idx
       on profiles (best_score desc, best_at asc)`,
    /*
     * ⚠️ `scores.device_id` **刻意不是**外鍵：`saveScore` 先寫 `scores` 才寫 `profiles`，且被退回的局（`verified = false`）不建 profile，兩者都會被外鍵擋掉。
     * ⚠️ `scores.device_id` is **deliberately not** a foreign key: `saveScore` writes `scores` before `profiles`, and a rejected run (`verified = false`) creates no profile — both would be rejected by it.
     */
    `create table if not exists scores (
       run_id       uuid primary key,
       device_id    text        not null,
       display_name text        not null default '',
       score        integer     not null,
       duration_ms  integer     not null,
       merges       integer     not null,
       drops        integer     not null,
       max_combo    integer     not null,
       version      text        not null default '',
       verified     boolean     not null default true,
       rejected     text,
       created_at   timestamptz not null default now()
     )`,
    `create index if not exists scores_device_idx on scores (device_id, created_at desc)`,
    `create index if not exists scores_verified_score_idx on scores (score desc) where verified`,
    `create table if not exists run_tokens (
       run_id      uuid primary key,
       device_id   text        not null,
       token_hash  text        not null,
       issued_at   timestamptz not null default now(),
       expires_at  timestamptz not null,
       used_at     timestamptz
     )`,
    `create index if not exists run_tokens_device_idx on run_tokens (device_id, issued_at desc)`,
    `create table if not exists requests (
       id              bigserial primary key,
       received_at     timestamptz not null default now(),
       method          text        not null,
       path            text        not null,
       status          integer     not null,
       device_id       text,
       run_id          uuid
     )`,
    `create index if not exists requests_received_idx on requests (received_at desc)`,
    `create index if not exists requests_device_idx on requests (device_id, received_at desc)`,

    /* ⚠️ 私隱：IP 與標頭屬個人資料，永不落庫 —— 這些 drop 清掉舊庫的欄位與資料，新庫由 `if exists` 通過。
     * ⚠️ Privacy: IPs and headers are personal data, never persisted — these drops clear them from an old
     * database and pass straight through a new one. */
    `alter table requests drop column if exists user_agent,
       drop column if exists accept_language, drop column if exists origin, drop column if exists referer,
       drop column if exists country, drop column if exists region, drop column if exists city,
       drop column if exists headers`,

    /* 玩家號：顯示用的四位數，永不當身分（身分只認 `device_id`）。新庫由建表帶上，舊庫在這裡補欄位與回填 —— 回填靠自己的 `where` 冪等。
     * The player tag: four display digits, never identity (that is `device_id` only). A new database gets
     * it from the create; an old one is given the column and the backfill here, the backfill idempotent
     * through its own `where`. */
    `alter table profiles add column if not exists user_tag varchar(4) not null default ''`,
    `update profiles set user_tag = lpad((floor(random() * 9999) + 1)::int::text, 4, '0') where user_tag = ''`,
  ],

  /* PG 的「欄位」錯誤：42703 不存在、42701 重複；上面的語句全走原生 `if exists`／`if not exists`，這兩個成員只是把缺口補齊。
   * PG's column errors: 42703 undefined, 42701 duplicate; the statements above are all native, so these only complete the pattern. */
  isMissingColumnError: (error) => (error as { code?: unknown } | null)?.code === '42703',
  isDuplicateColumnError: (error) => (error as { code?: unknown } | null)?.code === '42701',
};
