/**
 * Postgres：驅動（`pg`）＋ 方言。
 * Postgres: the driver (`pg`) and the dialect.
 *
 * 這一支同時服務 **Neon**、**Supabase**、**本機容器**與**自架的 NAS** —— 對 `pg` 而言它們沒有差別，
 * 差別只在連線字串（與 SSL）。所以這裡不特別為 Neon 寫程式，只把連線字串的**建議**（池化、SSL）
 * 變成可讀的警告，見 `connectionNotes`。
 * This one file serves **Neon**, **Supabase**, a **local container** and a **self-hosted NAS** alike —
 * to `pg` they are identical, and only the connection string (and SSL) differ. So nothing here is
 * Neon-specific; instead the connection-string **advice** (pooling, SSL) is turned into readable
 * warnings in `connectionNotes`.
 */

import { Pool, type PoolClient } from 'pg';

import { boardOrderKeys, type Dialect } from './dialect.js';
import type { Driver, Row, SqlResult } from './types.js';

/**
 * 每個實例最多幾條連線。開 2 而不是 1：一個請求可能同時要讀憑證與寫分數，只有一條會排隊；開太大
 * 則會讓併發的實例一起把資料庫的連線數吃光。
 * At most this many connections per instance. Two rather than one because a single request both reads
 * a token and writes a score, and one connection would serialise them; more than a few lets concurrent
 * instances exhaust the database's connection limit together.
 */
const POOL_MAX = 2;

/**
 * 需要 TLS 的託管供應商。命中時若連線字串沒明講 `sslmode`，就補一個「加密但不驗憑證鏈」的設定 ——
 * 這些家的憑證鏈在 Node 的根憑證庫裡不一定齊，而「連得上但被自己擋掉」比不加密更令人困惑。
 * Managed providers that need TLS. When one matches and the connection string does not spell out
 * `sslmode`, a "encrypt but do not verify the chain" setting is added: these providers' chains are not
 * always complete in Node's root store, and "connects but is blocked by itself" is more confusing than
 * no encryption at all.
 */
const MANAGED_HOSTS = /(neon\.tech|supabase\.(co|com|in)|render\.com|amazonaws\.com|azure\.com|aliyuncs\.com|tencentcloud)/i;

function sslFor(url: string): undefined | { rejectUnauthorized: boolean } {
  /* 連線字串自己講了 `sslmode` 就別插手：那是使用者明確的選擇。 */
  if (/[?&]sslmode=/i.test(url)) return undefined;

  return MANAGED_HOSTS.test(url) ? { rejectUnauthorized: false } : undefined;
}

/**
 * 對連線字串的建議。回傳的是**要記進日誌的字串**，不是錯誤 —— 這些都不該讓後端起不來。
 * Advice about the connection string. These are **strings for the log**, never errors: none of them
 * should stop the backend from starting.
 *
 * 兩條規則都有實際的代價：少了池化，併發一高就撞 `too many connections`；少了 TLS，密碼就是明文。
 * Both rules cost something real: without pooling, moderate concurrency hits `too many connections`;
 * without TLS, the password goes over the wire in the clear.
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
 * 交易的做法是「另開一條專屬連線」：池子裡的連線會被其他請求共用，而 `begin`／`commit` 是**連線層級**
 * 的狀態，共用會讓別人的查詢意外落進你的交易裡。
 * Transactions use a dedicated connection: pool connections are shared with other requests, and
 * `begin` / `commit` are **connection-level** state, so sharing would drop someone else's query into
 * your transaction.
 */
class PostgresDriver implements Driver {
  constructor(
    private readonly pool: Pool,
    /** 非 `null` 表示這個 driver 已經在某個交易裡（見 `Driver.transaction`）。 */
    private readonly client: PoolClient | null = null,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const executor = this.client ?? this.pool;
    const result = await executor.query(sql, params as unknown[]);

    return { rows: result.rows as Row[], affected: result.rowCount ?? 0 };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    /* 已經在交易裡就不再開一層（介面上的理由見 `types.ts`）。 */
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
    /* 交易中的 driver 不擁有池子，關掉是池子的事。 */
    if (this.client === null) await this.pool.end();
  }
}

export function createPostgresDriver(url: string): Driver {
  const ssl = sslFor(url);

  const pool = new Pool({
    connectionString: url,
    max: POOL_MAX,
    /*
     * 閒置的連線在 serverless 上沒有價值（實例本來就會被回收），而且資料庫端會比較快把連線釋放
     * 出來給別的實例。`idleTimeoutMillis` 預設 10 秒在這裡太長。
     * Idle connections are worth nothing on serverless (instances get reclaimed anyway) and the
     * database frees them for other instances sooner. The 10s default is too long here.
     */
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    ...(ssl === undefined ? {} : { ssl }),
  });

  /* 池子層級的錯誤不能讓整個 Node 行程掛掉：斷線是正常事件，記下來就好。 */
  pool.on('error', (error) => {
    console.error('[api] idle client error', error);
  });

  return new PostgresDriver(pool);
}

/* ── 方言 ─────────────────────────────────────────────────────────────────── */

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
  /* Postgres 真的回布林，但 `pg` 對某些欄位型別可能給字串，所以兩種都認。 */
  readBool: (value) => value === true || value === 't' || value === 1 || value === '1',

  boardOrder: (category) => boardOrderKeys(category, 'best_at asc nulls last'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values ($1, $2, $3, $4::timestamptz, $5::timestamptz)
     on conflict (run_id) do nothing`,

  /*
   * ⚠️ `created_at` 是**綁進去的**，不是靠 DDL 的 `default now()`。這一欄是速率限制的依據
   * （`countSubmissionsSince`）與審計時間，而 `MemoryStore` 用的是呼叫端傳進來的 `atMs` —— 靠
   * 預設值的話兩個 store 的實作就會分歧，而那個分歧只有在真的連上資料庫時才看得出來（本機與單元測試
   * 一律走 `MemoryStore`）。
   * ⚠️ `created_at` is **bound**, not left to the DDL's `default now()`. That column is what the rate
   * limit counts (`countSubmissionsSince`) and what the audit trail records, and `MemoryStore` uses the
   * `atMs` the caller passed — relying on the default would make the two store implementations diverge,
   * and that divergence only shows up against a real database (local runs and unit tests all go through
   * `MemoryStore`).
   */
  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, client_ip, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz)
     on conflict (run_id) do nothing
     returning run_id`,

  insertScoreSignal: 'rows',

  upsertProfile: () => `insert into profiles (
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

  schema: () => [
    `create table if not exists profiles (
       device_id         text primary key,
       display_name      text        not null default '',
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
     * ⚠️ `scores.device_id` **刻意不是**外鍵。它原本是（`references profiles … on delete cascade`），
     * 那是錯的，而且錯得會擋掉兩個正常路徑：
     *
     *   1. **新裝置的第一次提交永遠失敗。** `sqlStore.saveScore` 先寫 `scores` 再寫 `profiles` ——
     *      順序不能反，因為「這一局是不是新的」是由 `scores` 那一句的結果決定的（冪等）。所以寫入的
     *      那一刻 `profiles` 裡還沒有這一列，外鍵當場拒絕。
     *   2. **被退回的提交根本寫不進去。** `verified = false` 的局**故意**不建 profile（design.md §6.7：
     *      留審計痕跡但不進榜），於是它永遠沒有父列。有外鍵就等於「拒絕留檔」，而那正是要留的東西。
     *
     * 反過來看，那個外鍵**買不到任何東西**：整個程式沒有任何地方刪除 profile，所以
     * `on delete cascade` 是裝飾品，而它唯一可觀察的效果就是拒絕合法的寫入。
     *
     * 這三條加起來的結論是「這不是取捨，是矛盾」—— 所以拿掉它，並且讓三個方言一致（約束是最容易在
     * 不同引擎上出現不同錯誤碼的東西，正是 `Dialect` 這一層想避免的）。
     * ⚠️ `scores.device_id` is **deliberately not** a foreign key. It used to be
     * (`references profiles … on delete cascade`) and that was wrong in a way that blocks two normal
     * paths:
     *
     *   1. **A new device's first submission always fails.** `sqlStore.saveScore` writes `scores` before
     *      `profiles`, and the order cannot be swapped because whether the run is new is decided by that
     *      first statement's result (idempotency). At the moment of the insert there is therefore no
     *      parent row, and the key rejects it.
     *   2. **A rejected submission cannot be written at all.** A run with `verified = false`
     *      **deliberately** creates no profile (design.md §6.7: keep an audit trail, keep it off the
     *      board), so it can never have a parent. With the key in place that means "refuse to record
     *      it", which is the one thing that must not happen.
     *
     * Looked at the other way, the key **buys nothing**: nothing in the codebase deletes a profile, so
     * `on delete cascade` is decoration, and its only observable effect was rejecting legitimate writes.
     *
     * Together those add up to "this is not a trade-off, it is a contradiction", so the key is gone —
     * and all three dialects agree (constraints are the thing most likely to fail with different error
     * codes per engine, which is exactly what the `Dialect` layer exists to avoid).
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
       client_ip    text,
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
       run_id          uuid,
       client_ip       text,
       user_agent      text,
       accept_language text,
       origin          text,
       referer         text,
       country         text,
       region          text,
       city            text,
       headers         jsonb       not null default '{}'::jsonb
     )`,
    `create index if not exists requests_received_idx on requests (received_at desc)`,
    `create index if not exists requests_device_idx on requests (device_id, received_at desc)`,
    `create index if not exists requests_ip_idx on requests (client_ip, received_at desc)`,
  ],
};
