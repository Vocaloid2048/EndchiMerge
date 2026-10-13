/**
 * MySQL：驅動（`mysql2`）＋ 方言。
 * MySQL: the driver (`mysql2`) and the dialect.
 */

import { createPool, type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';

import { boardOrderKeys, type Dialect } from './dialect.js';
import type { Driver, Row, SqlResult } from './types.js';

/**
 * 每個實例最多幾條連線；與 Postgres 同一個理由（見 `postgres.ts`）。
 * At most this many connections per instance, for the same reason as Postgres (see `postgres.ts`).
 */
const POOL_MAX = 2;

/**
 * 需要 TLS 的託管供應商；與 `postgres.ts` 的判斷一致。
 * Managed providers that need TLS, matching `postgres.ts`'s test.
 */
const MANAGED_HOSTS = /(neon\.tech|supabase|render\.com|amazonaws\.com|azure\.com|aliyuncs\.com|tencentcloud|tdsql)/i;

/**
 * 對連線字串的建議；與 `postgres.ts` 的 `connectionNotes` 同一組規則。
 * Connection-string advice, following the same rules as `connectionNotes` in `postgres.ts`.
 */
export function connectionNotes(url: string): string[] {
  const notes: string[] = [];

  if (url.includes('tencentcloud') || url.includes('tdsql')) {
    notes.push(
      '騰訊雲 MySQL：請確認這個實例允許來自公網的連線（Vercel 的函式對外 IP 是**動態**的，不能用白名單）。',
    );
  }

  if (!/[?&]ssl=/i.test(url) && !MANAGED_HOSTS.test(url)) {
    notes.push('連線字串沒有啟用 TLS：若資料庫在公網上，請加上 ssl 設定，否則密碼會以明文傳輸。');
  }

  return notes;
}

/**
 * `mysql2` 的驅動。
 * The `mysql2` driver.
 *
 * 交易用 `getConnection()` 取一條**專屬**連線；理由與 Postgres 相同（`begin` 是連線層級的狀態）。
 * Transactions take a **dedicated** connection via `getConnection()`, for the same reason as Postgres (`begin` is connection-level state).
 */
class MysqlDriver implements Driver {
  constructor(
    private readonly pool: Pool,
    private readonly connection: PoolConnection | null = null,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const executor = this.connection ?? this.pool;

    /*
     * `mysql2` 的查詢回 `[rows, fields]`，而 SELECT 與 INSERT 的 `rows` 型別完全不同。
     * A `mysql2` query returns `[rows, fields]`, and the `rows` of a SELECT and an INSERT are entirely different types.
     */
    const [result] = await executor.query(sql, params as unknown[]);

    if (Array.isArray(result)) return { rows: result as Row[], affected: 0 };

    /*
     * 非 SELECT：`affectedRows` 是 MySQL 唯一的「有沒有寫進去」訊號（`changedRows` 不行 —— 我們的 no-op 值不會變）；
     * 且它只有在 `FOUND_ROWS` 關掉時才等於「寫進去了」（見 `createMysqlDriver`）。
     * Anything but a SELECT: `affectedRows` is MySQL's only "did it land" signal (`changedRows` will not do, since our no-op changes nothing), and it means "written" only while `FOUND_ROWS` is off (see `createMysqlDriver`).
     */
    return { rows: [], affected: (result as ResultSetHeader).affectedRows ?? 0 };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    if (this.connection !== null) return run(this);

    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      const result = await run(new MysqlDriver(this.pool, connection));
      await connection.commit();

      return result;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    if (this.connection === null) await this.pool.end();
  }
}

/**
 * 連線時套用的 client flags：**必須**關掉 `FOUND_ROWS`。
 * The client flags every connection opens with: `FOUND_ROWS` **must** stay off.
 *
 * 開著會讓 `affectedRows` 從「真的寫進去的列數」變成「符合條件的列數」，重複提交被當成新的一局且不拋錯。
 * With it on, `affectedRows` becomes "rows matched" rather than "rows written", so a duplicate submission counts as a new run and nothing throws.
 */
export const MYSQL_CLIENT_FLAGS: readonly string[] = ['-FOUND_ROWS'];

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;

  return undefined;
};

export function createMysqlDriver(url: string): Driver {
  const pool = createPool({
    uri: url,
    connectionLimit: POOL_MAX,
    /*
     * 一律 UTC：少了這一行，`mysql2` 會用行程的本地時區轉換，同一時刻在 Vercel 與本機差八小時。
     * Always UTC: without this line `mysql2` converts in the process's local timezone, so one instant differs by eight hours between Vercel and a local machine.
     */
    timezone: 'Z',
    /*
     * 連線編碼用 `utf8mb4`；不設的話舊版預設 `utf8mb3`，中文看起來沒事但**表情符號會插入失敗**，而暱稱欄位擋不住玩家打表情。
     * The connection charset is `utf8mb4`; left unset, older versions default to `utf8mb3`, where Chinese "looks fine" but **emoji fail to insert**, and nothing in the display-name field stops one.
     */
    charset: 'utf8mb4',
    /*
     * 等待連線的上限：Vercel 的函式逾時是 10 秒（`vercel.json`），超過就沒有意義了。
     * The cap on waiting for a connection: Vercel's function timeout is ten seconds (`vercel.json`), so anything longer is pointless.
     */
    connectTimeout: 10_000,
    waitForConnections: true,
    /*
     * 大數字用 JS number 拿回來（分數與毫秒都遠在安全整數內）。
     * Big numbers come back as JS numbers (scores and milliseconds are far inside the safe range).
     */
    supportBigNumbers: true,
    bigNumberStrings: false,
    /*
     * 見 `MYSQL_CLIENT_FLAGS`：關掉 `FOUND_ROWS` 是**正確性**的要求，不是調校。
     * See `MYSQL_CLIENT_FLAGS`: turning `FOUND_ROWS` off is a **correctness** requirement, not tuning.
     */
    flags: [...MYSQL_CLIENT_FLAGS],
    ...(MANAGED_HOSTS.test(url) ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  return new MysqlDriver(pool);
}

/* ── 方言 ─────────────────────────────────────────────────────────────────── */

/**
 * 把驅動回來的時間值轉成毫秒。
 * Converts a driver-returned time value into milliseconds.
 *
 * 正常路徑是 `Date`；字串那條是防禦性的，`'YYYY-MM-DD HH:MM:SS.mmm'` **沒有時區標記**，補一個 `Z` 講清楚。
 * The normal path is a `Date`; the string branch is defensive, appending a `Z` because `'YYYY-MM-DD HH:MM:SS.mmm'` carries no timezone marker.
 */
function readMysqlTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    /*
     * 已經帶了時區（`Z` 或 `+08:00`）就別動它。
     * A value that already carries a timezone (`Z` or `+08:00`) is left alone.
     */
    const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(value);
    const iso = hasZone ? value : `${value.replace(' ', 'T')}Z`;
    const ms = Date.parse(iso);

    return Number.isNaN(ms) ? null : ms;
  }

  return null;
}

export const mysqlDialect: Dialect = {
  name: 'mysql',

  ph: () => '?',
  ts: (ms) => new Date(ms),
  tsPlaceholder: () => '?',
  jsonPlaceholder: () => '?',

  /*
   * MySQL 把時間回成 `Date`，所以 SELECT 直接取欄位；轉換在 `readTime` 裡。
   * MySQL returns time as a `Date`, so the SELECT takes the column directly; conversion lives in `readTime`.
   */
  epochMs: (column) => column,
  readTime: readMysqlTime,
  /*
   * MySQL 的 count 直接回數字（`readNumber` 再擋一次 bigint-as-string）。
   * MySQL's count comes back as a number (`readNumber` guards against bigint-as-string once more).
   */
  countInt: (expression) => expression,
  readNumber: (value) => Number(value ?? 0),
  /*
   * `tinyint(1)` 回 1／0；`mysql2` 有時給布林，兩種都認。
   * `tinyint(1)` returns 1 / 0; `mysql2` sometimes gives a boolean, so both are accepted.
   */
  readBool: (value) => asBoolean(value) ?? Number(value) === 1,

  /*
   * MySQL 沒有 `nulls last`；`best_at is null` 對非空值給 0、對空值給 1，升冪排即等價於「空值在後」。
   * MySQL has no `nulls last`; `best_at is null` yields 0 for non-null and 1 for null, so ascending order places the nulls last.
   */
  boardOrder: (category) => boardOrderKeys(category, 'best_at is null, best_at asc'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values (?, ?, ?, ?, ?)
     on duplicate key update run_id = run_id`,

  /*
   * `created_at` 也是綁進去的（不是 `utc_timestamp(3)`），理由與 `postgres.ts` 那份相同：速率限制與審計都靠它，而 `MemoryStore` 用的是呼叫端的 `atMs`。
   * `created_at` is bound here too (not `utc_timestamp(3)`), for the same reason as `postgres.ts`: the rate limit and audit trail depend on it, and `MemoryStore` uses the caller's `atMs`.
   */
  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on duplicate key update run_id = run_id`,

  /*
   * MySQL 沒有 `RETURNING`，改看 `affectedRows`（見 `MysqlDriver.query`）。
   * MySQL has no `RETURNING`, so this looks at `affectedRows` instead (see `MysqlDriver.query`).
   */
  insertScoreSignal: 'affected',

  /*
   * ⚠️ 欄位順序是**正確性**的一部分：`best_duration_ms` 與 `best_at` 必須排在 `best_score` 之前，因為它們要拿**舊的** `best_score` 比較（見 `Dialect.upsertProfile`）。
   * ⚠️ Column order is part of **correctness**: `best_duration_ms` and `best_at` must come before `best_score`, since they compare against the **old** `best_score` (see `Dialect.upsertProfile`).
   */
  upsertProfile: () => `insert into profiles (
       device_id, display_name, user_tag, best_score, best_duration_ms, best_max_combo, best_merges,
       best_at, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, utc_timestamp(3), utc_timestamp(3))
     on duplicate key update
       display_name = if(values(display_name) = '', profiles.display_name, values(display_name)),
       user_tag = values(user_tag),
       best_duration_ms = if(values(best_score) > profiles.best_score,
                               values(best_duration_ms), profiles.best_duration_ms),
       best_at = if(values(best_score) > profiles.best_score, values(best_at), profiles.best_at),
       best_score = greatest(profiles.best_score, values(best_score)),
       best_max_combo = greatest(profiles.best_max_combo, values(best_max_combo)),
       best_merges = greatest(profiles.best_merges, values(best_merges)),
       updated_at = utc_timestamp(3)`,

  /*
   * 識別碼一律加反引號（MySQL 保留字較多），索引寫在建表語句內（`CREATE INDEX` 沒有 `IF NOT EXISTS`）。
   * Identifiers are always backticked (MySQL reserves more words) and indexes live inside the `create table` (its `CREATE INDEX` has no `IF NOT EXISTS`).
   *
   * `utf8mb4_bin` 讓 `device_id` 逐位元組、大小寫敏感，榜的最後決勝鍵才可決定。
   * `utf8mb4_bin` makes `device_id` byte-wise and case-sensitive so the board's final tie-break is deterministic.
   */
  schema: () => [
    `create table if not exists \`profiles\` (
       \`device_id\`        varchar(64)  not null,
       \`display_name\`     varchar(64)  not null default '',
       \`user_tag\`         varchar(4)   not null default '',
       \`best_score\`       int          not null default 0,
       \`best_max_combo\`   int          not null default 0,
       \`best_merges\`      int          not null default 0,
       \`best_duration_ms\` int          not null default 0,
       \`best_at\`          datetime(3)  null,
       \`name_changed_at\`  datetime(3)  null,
       \`created_at\`       datetime(3)  not null default utc_timestamp(3),
       \`updated_at\`       datetime(3)  not null default utc_timestamp(3),
       primary key (\`device_id\`),
       key \`profiles_best_score_idx\` (\`best_score\` desc, \`best_at\` asc)
     ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,
    `create table if not exists \`scores\` (
       \`run_id\`       char(36)     not null,
       \`device_id\`    varchar(64)  not null,
       \`display_name\` varchar(64)  not null default '',
       \`score\`        int          not null,
       \`duration_ms\`  int          not null,
       \`merges\`       int          not null,
       \`drops\`        int          not null,
       \`max_combo\`    int          not null,
       \`version\`      varchar(32)  not null default '',
       \`verified\`     tinyint(1)   not null default 1,
       \`rejected\`     varchar(64)  null,
       \`created_at\`   datetime(3)  not null default utc_timestamp(3),
       primary key (\`run_id\`),
       key \`scores_device_idx\` (\`device_id\`, \`created_at\` desc),
       key \`scores_verified_score_idx\` (\`score\` desc)
     ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,
    `create table if not exists \`run_tokens\` (
       \`run_id\`     char(36)     not null,
       \`device_id\`  varchar(64)  not null,
       \`token_hash\` char(64)     not null,
       \`issued_at\`  datetime(3)  not null,
       \`expires_at\` datetime(3)  not null,
       \`used_at\`    datetime(3)  null,
       primary key (\`run_id\`),
       key \`run_tokens_device_idx\` (\`device_id\`, \`issued_at\` desc)
     ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,
    `create table if not exists \`requests\` (
       \`id\`              bigint       not null auto_increment,
       \`received_at\`     datetime(3)  not null default utc_timestamp(3),
       \`method\`          varchar(16)  not null,
       \`path\`            varchar(255) not null,
       \`status\`          int          not null,
       \`device_id\`       varchar(64)  null,
       \`run_id\`          char(36)     null,
       primary key (\`id\`),
       key \`requests_received_idx\` (\`received_at\` desc),
       key \`requests_device_idx\` (\`device_id\`, \`received_at\` desc)
     ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,

    /* ⚠️ 私隱：IP 與標頭屬個人資料，永不落庫 —— 這些 drop 清掉舊庫的欄位與資料；新庫沒有這些欄位，每條報 1091 後被判為已完成。索引先刪（它以 `client_ip` 開頭）。
     * ⚠️ Privacy: IPs and headers are personal data, never persisted — these drops clear them from an old
     * database; a new one raises 1091 per statement and each counts as done. The index goes first. */
    `drop index \`requests_ip_idx\` on \`requests\``,
    `alter table \`requests\` drop column \`client_ip\``,
    `alter table \`requests\` drop column \`user_agent\``,
    `alter table \`requests\` drop column \`accept_language\``,
    `alter table \`requests\` drop column \`origin\``,
    `alter table \`requests\` drop column \`referer\``,
    `alter table \`requests\` drop column \`country\``,
    `alter table \`requests\` drop column \`region\``,
    `alter table \`requests\` drop column \`city\``,
    `alter table \`requests\` drop column \`headers\``,
    `alter table \`scores\` drop column \`client_ip\``,

    /* 玩家號：顯示用的四位數，永不當身分。MySQL 沒有 `add column if not exists`，舊庫已有這個欄位時報 1060 並被判為已完成。
     * The player tag: four display digits, never identity. MySQL has no `add column if not exists`, so an
     * old database that already has the column raises 1060 and counts as done. */
    `alter table \`profiles\` add column \`user_tag\` varchar(4) not null default ''`,
    `update \`profiles\` set \`user_tag\` = lpad(floor(rand() * 9999) + 1, 4, '0') where \`user_tag\` = ''`,
  ],

  /*
   * MySQL 的欄位錯誤：1091 不存在（drop 用）、1060 重複（add 用）；mysql2 把代號放在 `errno` 與 `code` 兩處，兩處都認。
   * MySQL's column errors: 1091 missing (drops), 1060 duplicate (adds); mysql2 carries the code in both `errno` and `code`.
   */
  isMissingColumnError: (error) => {
    const e = error as { code?: unknown; errno?: unknown } | null;
    return e?.code === 'ER_CANT_DROP_FIELD_OR_KEY' || e?.errno === 1091;
  },
  isDuplicateColumnError: (error) => {
    const e = error as { code?: unknown; errno?: unknown } | null;
    return e?.code === 'ER_DUP_FIELDNAME' || e?.errno === 1060;
  },
};
