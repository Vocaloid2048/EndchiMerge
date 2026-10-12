/**
 * MySQL：驅動（`mysql2`）＋ 方言。
 * MySQL: the driver (`mysql2`) and the dialect.
 *
 * 存在的理由是**騰訊**：騰訊雲的免費關聯式選項（云資料庫 MySQL 免費版、TDSQL-C）走的都是 MySQL
 * 協議，而 EdgeOne 官方的資料庫模板也是 MySQL ＋ `mysql2`。Neon 那邊是 Postgres，所以兩邊都要有
 * —— 而共用的部分（`sqlStore.ts` 的邏輯）一行都不用重複。
 * The reason this exists is **Tencent**: its free relational options (the free tier of TencentDB for
 * MySQL, and TDSQL-C) all speak the MySQL protocol, and EdgeOne's own database template is MySQL with
 * `mysql2`. Neon is Postgres, so both dialects are needed — and the shared part (the logic in
 * `sqlStore.ts`) is not duplicated at all.
 *
 * ## 時區：一律 UTC / Timezone: always UTC
 *
 * `timezone: 'Z'` 讓 `mysql2` 用 UTC 解讀與寫出 `datetime`。少了它，驅動會用**伺服器行程的本地時區**
 * 轉換，於是同一個時間在 Vercel（UTC）與你本機（UTC+8）會差八小時 —— 而差異只會在「同分比先後」
 * 這種地方浮現，最難查。日期一律以 UTC 存、以 UTC 讀。
 * `timezone: 'Z'` makes `mysql2` read and write `datetime` in UTC. Without it the driver converts using
 * the **process's local timezone**, so the same instant differs by eight hours between Vercel (UTC) and
 * your machine (UTC+8) — and that difference only surfaces in things like "who reached the tie first",
 * which is the hardest place to find it. Dates are stored and read as UTC, always.
 */

import { createPool, type Pool, type PoolConnection, type ResultSetHeader } from 'mysql2/promise';

import { boardOrderKeys, type Dialect } from './dialect';
import type { Driver, Row, SqlResult } from './types';

/** 與 Postgres 那邊同一個理由（見 `postgres.ts`）。 */
const POOL_MAX = 2;

/** 需要 TLS 的託管供應商；與 `postgres.ts` 的判斷一致。 */
const MANAGED_HOSTS = /(neon\.tech|supabase|render\.com|amazonaws\.com|azure\.com|aliyuncs\.com|tencentcloud|tdsql)/i;

/**
 * 對連線字串的建議。與 `postgres.ts` 的 `connectionNotes` 同一組規則，只是把 Neon 的池化提醒換成
 * MySQL 版的連線數提醒。
 * Connection-string advice. Same rules as `connectionNotes` in `postgres.ts`, with Neon's pooling note
 * replaced by MySQL's connection-count note.
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
 * 交易用 `getConnection()` 取一條**專屬**連線；理由與 Postgres 那邊相同（`begin` 是連線層級的狀態）。
 * Transactions take a **dedicated** connection via `getConnection()` for the same reason as the
 * Postgres side (`begin` is connection-level state).
 */
class MysqlDriver implements Driver {
  constructor(
    private readonly pool: Pool,
    private readonly connection: PoolConnection | null = null,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const executor = this.connection ?? this.pool;

    /* `mysql2` 的查詢回 `[rows, fields]`，而 SELECT 與 INSERT 的 `rows` 型別完全不同。 */
    const [result] = await executor.query(sql, params as unknown[]);

    if (Array.isArray(result)) return { rows: result as Row[], affected: 0 };

    /*
     * 非 SELECT：`affectedRows` 是 MySQL 唯一的「有沒有寫進去」訊號。`changedRows` 不行 —— 它算的是
     * 「值真的變了的列」，而我們的 `on duplicate key update run_id = run_id` 是刻意的 no-op，值不會變。
     *
     * ⚠️ 但 `affectedRows` 只有在 `FOUND_ROWS` 關掉時才等於「寫進去了」。開著的話它是「符合條件的
     * 列數」，重複提交也會是 1 —— 見 `createMysqlDriver` 對這個 flag 的說明。
     *
     * Anything but a SELECT: `affectedRows` is MySQL's only "did it land" signal. `changedRows` will
     * not do — it counts rows whose values actually changed, and our
     * `on duplicate key update run_id = run_id` is a deliberate no-op that changes nothing.
     *
     * ⚠️ But `affectedRows` only means "written" while `FOUND_ROWS` is off: with it on the number is
     * "rows matched" and a duplicate reports 1 too — see the flag's explanation in `createMysqlDriver`.
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
 * 連線時套用的 client flags。
 * The client flags every connection is opened with.
 *
 * 目前只有一條，但它值得有自己的名字與測試：`mysql2` 的預設值是**開著** `FOUND_ROWS` 的，而那個
 * flag 會讓 `affectedRows` 從「真的寫進去的列數」變成「符合條件的列數」—— 於是
 * `on duplicate key update run_id = run_id` 這個刻意的 no-op 在重複提交時回報 `1`，
 * `saveScore()` 就把每次重試都當成新的一局。這條路徑**不會拋錯**，只會靜靜算錯，而 Postgres 那邊
 * 完全正常，所以只有真的用 MySQL 跑一次才會發現。
 * There is only one entry, and it earns its own name and test: `mysql2` enables `FOUND_ROWS` **by
 * default**, and that flag turns `affectedRows` from "rows actually written" into "rows matched" — so
 * the deliberate no-op `on duplicate key update run_id = run_id` reports `1` for a duplicate and
 * `saveScore()` treats every retry as a new run. The path **throws nothing** and is silently wrong,
 * and the Postgres side is perfectly fine, so only actually running MySQL exposes it.
 *
 * `mergeFlags()` in `mysql2` drops a default flag when it is listed with a `-` prefix, which is the
 * only way to unset one (there is no separate "off" switch).
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
    /* 見檔頭：沒有這一行，日期會隨執行環境的本地時區而變。 */
    timezone: 'Z',
    /*
     * 連線編碼用 `utf8mb4`（＝ `utf8mb4_general_ci`，協定編號 45）。不設的話舊版的預設是
     * `utf8mb3`，那個連中文都在 BMP 內所以「看起來沒事」，但**表情符號會插入失敗** —— 而暱稱欄位
     * 沒有任何東西阻止玩家打表情。
     * The connection charset is `utf8mb4` (= `utf8mb4_general_ci`, protocol id 45). Left unset, older
     * versions default to `utf8mb3`, which "looks fine" because Chinese is inside the BMP — but
     * **emoji fail to insert**, and nothing in the display-name field stops a player from typing one.
     */
    charset: 'utf8mb4',
    /* 等待連線的上限：Vercel 的函式逾時是 10 秒（`vercel.json`），超過就沒有意義了。 */
    connectTimeout: 10_000,
    waitForConnections: true,
    /* 大數字用 JS number 拿回來（分數與毫秒都遠在安全整數內）。 */
    supportBigNumbers: true,
    bigNumberStrings: false,
    /*
     * 見 `MYSQL_CLIENT_FLAGS`：關掉 `FOUND_ROWS` 是**正確性**的要求，不是調校。少了它，重複提交會
     * 被當成新的一局，最大值重複累加，而且不會有任何錯誤訊息。
     * See `MYSQL_CLIENT_FLAGS`: turning `FOUND_ROWS` off is a **correctness** requirement rather than
     * tuning. Without it a duplicate submission counts as a new run, double-counting the maxima, with
     * no error to show for it.
     */
    flags: [...MYSQL_CLIENT_FLAGS],
    ...(MANAGED_HOSTS.test(url) ? { ssl: { rejectUnauthorized: false } } : {}),
  });

  return new MysqlDriver(pool);
}

/* ── 方言 ─────────────────────────────────────────────────────────────────── */

/**
 * 把驅動回來的時間值轉成毫秒。
 * Convert a driver-returned time value into milliseconds.
 *
 * 正常路徑是 `Date`（`timezone: 'Z'` 讓它已經是 UTC）。字串那條是防禦性的：若有人關掉了
 * `dateStrings: false`，`mysql2` 會回 `'YYYY-MM-DD HH:MM:SS.mmm'`，而那**沒有時區標記**，
 * `Date.parse` 會當成本地時間 —— 所以補一個 `Z` 把它講清楚。
 * The normal path is a `Date` (already UTC thanks to `timezone: 'Z'`). The string branch is defensive:
 * if `dateStrings` were ever turned on, `mysql2` returns `'YYYY-MM-DD HH:MM:SS.mmm'` with **no
 * timezone marker**, and `Date.parse` would read it as local time — so a `Z` is appended to say it
 * explicitly.
 */
function readMysqlTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;

  if (typeof value === 'string') {
    /* 已經帶了時區（`Z` 或 `+08:00`）就別動它。 */
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

  /* MySQL 把時間回成 `Date`，所以 SELECT 直接取欄位；轉換在 `readTime` 裡。 */
  epochMs: (column) => column,
  readTime: readMysqlTime,
  /* MySQL 的 count 直接回數字（`readNumber` 再擋一次 bigint-as-string）。 */
  countInt: (expression) => expression,
  readNumber: (value) => Number(value ?? 0),
  /* `tinyint(1)` 回 1／0；`mysql2` 有時會給布林，兩種都認。 */
  readBool: (value) => asBoolean(value) ?? Number(value) === 1,

  /*
   * MySQL 沒有 `nulls last`。`best_at is null` 對非空值給 0、對空值給 1，升冪排就等價於
   * 「非空在前、空的在後」，與 Postgres 那邊的 `nulls last` 得到同一個順序。
   * MySQL has no `nulls last`. `best_at is null` yields 0 for non-null and 1 for null, so ascending
   * order puts the non-null ones first — the same order Postgres's `nulls last` produces.
   */
  boardOrder: (category) => boardOrderKeys(category, 'best_at is null, best_at asc'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values (?, ?, ?, ?, ?)
     on duplicate key update run_id = run_id`,

  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, client_ip
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on duplicate key update run_id = run_id`,

  /* MySQL 沒有 `RETURNING`，改看 `affectedRows`（見 `MysqlDriver.query`）。 */
  insertScoreSignal: 'affected',

  /*
   * ⚠️ 欄位順序是**正確性**的一部分，不是風格（理由見 `Dialect.upsertProfile` 的說明）：
   * `best_duration_ms` 與 `best_at` 必須排在 `best_score` 之前，因為它們要拿**舊的** `best_score`
   * 來比較。
   *
   * `values(col)` 取得的是「原本要插入的那一列」的值，在 MySQL 8.0.20+ 已標為 deprecated 但仍可用；
   * 保留它是為了同時相容 5.7 與 8.x。若未來某個版本真的移除它，改成 8.0.19+ 的資料列別名
   * （`insert … as new … on duplicate key update x = new.x`）即可。
   */
  upsertProfile: () => `insert into profiles (
       device_id, display_name, best_score, best_duration_ms, best_max_combo, best_merges,
       best_at, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, utc_timestamp(3), utc_timestamp(3))
     on duplicate key update
       display_name = if(values(display_name) = '', profiles.display_name, values(display_name)),
       best_duration_ms = if(values(best_score) > profiles.best_score,
                               values(best_duration_ms), profiles.best_duration_ms),
       best_at = if(values(best_score) > profiles.best_score, values(best_at), profiles.best_at),
       best_score = greatest(profiles.best_score, values(best_score)),
       best_max_combo = greatest(profiles.best_max_combo, values(best_max_combo)),
       best_merges = greatest(profiles.best_merges, values(best_merges)),
       updated_at = utc_timestamp(3)`,

  /*
   * 識別碼一律加反引號。MySQL 的保留字比 Postgres 多（`rank`、`groups`、`system`…），而 `version`
   * 這類「不算保留字但同名於函式」的欄位遲早會咬人；DDL 只寫一次，加反引號的成本近乎零。
   * Identifiers are always backticked. MySQL has more reserved words than Postgres (`rank`, `groups`,
   * `system`…), and a column like `version` — not reserved, but the name of a function — will bite
   * eventually. DDL is written once, so backticks cost almost nothing.
   *
   * 索引寫在**建表語句內**：MySQL 的 `CREATE INDEX` 沒有 `IF NOT EXISTS`，分開寫就沒辦法重複執行。
   * Indexes live **inside** the `create table`: MySQL's `CREATE INDEX` has no `IF NOT EXISTS`, so
   * writing them separately would make the statement fail on a second run.
   *
   * `utf8mb4_bin` 是刻意的：它讓 `device_id` 的比較與排序是**逐位元組、大小寫敏感**的，因而可決定性
   * —— 榜的排序最後一個決勝鍵就是 `device_id`，用大小寫不敏感的 collation 會讓「同分同時間」的兩筆
   * 順序取決於 collation 的實作細節。
   * `utf8mb4_bin` is deliberate: it makes `device_id` comparison and ordering **byte-wise and
   * case-sensitive**, hence deterministic — `device_id` is the board's final tie-break, and a
   * case-insensitive collation would let the order of two fully-tied rows depend on collation
   * internals.
   */
  schema: () => [
    `create table if not exists \`profiles\` (
       \`device_id\`        varchar(64)  not null,
       \`display_name\`     varchar(64)  not null default '',
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
       \`client_ip\`    varchar(64)  null,
       \`created_at\`   datetime(3)  not null default utc_timestamp(3),
       primary key (\`run_id\`),
       key \`scores_device_idx\` (\`device_id\`, \`created_at\` desc),
       key \`scores_verified_score_idx\` (\`score\` desc),
       constraint \`scores_device_fk\` foreign key (\`device_id\`)
         references \`profiles\` (\`device_id\`) on delete cascade
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
       \`client_ip\`       varchar(64)  null,
       \`user_agent\`      varchar(512) null,
       \`accept_language\` varchar(64)  null,
       \`origin\`          varchar(255) null,
       \`referer\`         varchar(255) null,
       \`country\`         varchar(64)  null,
       \`region\`          varchar(64)  null,
       \`city\`            varchar(64)  null,
       \`headers\`         json         null,
       primary key (\`id\`),
       key \`requests_received_idx\` (\`received_at\` desc),
       key \`requests_device_idx\` (\`device_id\`, \`received_at\` desc),
       key \`requests_ip_idx\` (\`client_ip\`, \`received_at\` desc)
     ) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin`,
  ],
};
