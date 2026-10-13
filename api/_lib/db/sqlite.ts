/**
 * SQLite：驅動（`node:sqlite`，Node 22 內建、零依賴）＋ 方言；只服務本機開發，函式環境的檔案系統是拋棄式的，不是部署選項。
 * SQLite: the driver (`node:sqlite`, built into Node 22, zero dependencies) and the dialect; local
 * development only — function filesystems are ephemeral, so it is not a deployment option.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

import { boardOrderKeys, type Dialect } from './dialect.js';
import type { Driver, Row, SqlResult } from './types.js';

/**
 * 這一句會不會回傳列：看有無 `select`／`returning`。可靠，因為所有 SQL 都由 `Dialect` 產生、數量少且讀得懂。
 * Whether a statement returns rows: it looks for `select` / `returning`, reliable because every
 * statement comes from `Dialect` — few of them, each one readable.
 */
const RETURNS_ROWS = /(^|[\s(])(?:select|returning)\b/iu;

/**
 * UTC 毫秒的 SQL 表達式：SQLite 沒有 `now()`，`strftime` 回的是秒的文字，乘 1000 後強制轉成整數，與其他時間欄位單位一致。
 * A UTC-milliseconds SQL expression: SQLite has no `now()`, `strftime` returns seconds as text,
 * and ×1000 coerces it to an integer matching the unit of every other time column.
 */
const NOW_MS = "(strftime('%s','now') * 1000)";

/**
 * 把一個 JS 值轉成 `node:sqlite` 收得下的參數：布林不在接受清單、直接傳會拋，轉換留在這層（對應 DDL 的 `integer not null default 1`）。
 * Turns a JS value into a parameter `node:sqlite` accepts: booleans are not in the list and throw,
 * so the conversion lives here (mirroring the DDL's `integer not null default 1`).
 */
const bindable = (value: unknown): SQLInputValue =>
  typeof value === 'boolean' ? (value ? 1 : 0) : (value as SQLInputValue);

/**
 * `node:sqlite` 的驅動：同步 API 包成 resolved promise；交易因此簡單 —— 沒有第二條連線，整條路徑在同一執行緒跑完。
 * The `node:sqlite` driver: a synchronous API wrapped in resolved promises, which also makes
 * transactions simple — no second connection, the whole path on one thread.
 */
class SqliteDriver implements Driver {
  constructor(
    private readonly db: DatabaseSync,
    /** 非 `null` 表示這個 driver 已經在某個交易裡（見 `Driver.transaction`）。
     * Non-`null` means this driver is already inside a transaction (see `Driver.transaction`). */
    private readonly inTransaction = false,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const statement: StatementSync = this.db.prepare(sql);
    const args = params.map(bindable);

    if (RETURNS_ROWS.test(sql)) {
      return { rows: statement.all(...args) as Row[], affected: 0 };
    }

    /*
     * `changes` 就是「真的寫進去的列數」，與關掉 `FOUND_ROWS` 後 MySQL 的 `affectedRows` 同義；建表語句回 0，無人依賴。
     * `changes` is the rows actually written, the same thing MySQL's `affectedRows` means once
     * `FOUND_ROWS` is off; DDL statements report 0, which nothing depends on.
     */
    return { rows: [], affected: Number(statement.run(...args).changes) };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    /* 已經在交易裡就不再開一層。
     * Already inside a transaction: do not open another layer. */
    if (this.inTransaction) return run(this);

    this.db.exec('begin');

    try {
      const result = await run(new SqliteDriver(this.db, true));
      this.db.exec('commit');

      return result;
    } catch (error) {
      this.db.exec('rollback');
      throw error;
    }
  }

  async close(): Promise<void> {
    /* 交易中的 driver 不擁有連線，關掉是外層的事。
     * A transaction-scoped driver does not own the connection; closing is the outer driver's job. */
    if (!this.inTransaction) this.db.close();
  }
}

/**
 * 從連線字串取出檔案路徑；`//`／`///` 只當 URL 分隔符剝一次（SQLite 沒有 host 概念），`sqlite:///tmp/x.db` → `/tmp/x.db`。
 * Extracts the file path from the connection string; `//` / `///` are stripped once as URL
 * separators (a SQLite connection string has no host concept), so `sqlite:///tmp/x.db` → `/tmp/x.db`.
 */
export function sqlitePathFromUrl(url: string): string {
  let path = url.startsWith('sqlite:') ? url.slice('sqlite:'.length) : url;

  if (path.startsWith('///')) path = path.slice(2);
  else if (path.startsWith('//')) path = path.slice(2);

  return path;
}

export function createSqliteDriver(url: string): Driver {
  const path = sqlitePathFromUrl(url);

  /*
   * 檔案資料庫要先建上層目錄，否則 SQLite 回 `SQLITE_CANTOPEN`，看起來像權限問題而非「忘了 mkdir」。
   * A file database needs its parent directory to exist first, or SQLite answers
   * `SQLITE_CANTOPEN` — which looks like a permissions problem rather than a forgotten mkdir.
   */
  if (path !== ':memory:' && path !== '') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  /*
   * `foreign_keys`：SQLite 預設不強制外鍵；目前 schema 刻意沒有任何外鍵（`scores.device_id` 不得設外鍵），
   * 但留著讓 DDL 裡哪天加的外鍵會被強制執行。`journal_mode = WAL` 讓讀取不被寫入擋住；
   * `busy_timeout` 讓兩個行程同時動同一個檔案時排隊，而不是立刻回 `SQLITE_BUSY`。
   * `foreign_keys`: SQLite does not enforce keys by default; the schema deliberately declares none
   * (`scores.device_id` must NOT be a foreign key), but this stays so any future key in the DDL is
   * honoured without being asked. `journal_mode = WAL` keeps reads unblocked by writes;
   * `busy_timeout` makes two processes touching one file queue instead of failing with `SQLITE_BUSY`.
   */
  db.exec('pragma foreign_keys = on');
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma busy_timeout = 5000');

  return new SqliteDriver(db);
}

/**
 * 對這組連線設定的提醒：SQLite 只服務本機開發；仍不是錯誤，防的是有人把 `sqlite:` 填進正式環境。
 * The advice for this connection setting: SQLite is for local development only; still not an
 * error, it guards against `sqlite:` reaching a production deployment.
 */
export function connectionNotes(url: string): string[] {
  return [
    `SQLite（${sqlitePathFromUrl(url)}）只服務本機開發：它是一個檔案，而函式環境的檔案系統是拋棄式的，` +
      '部署請改用 postgres:// 或 mysql://（見 sqlite.ts 檔頭）。',
  ];
}

/* ── 方言 / The dialect ──────────────────────────────────────────────────── */

export const sqliteDialect: Dialect = {
  name: 'sqlite',

  ph: () => '?',
  /* 時間就是那個整數，不做任何轉換。
   * The time is that integer, with no conversion. */
  ts: (ms) => ms,
  tsPlaceholder: () => '?',
  jsonPlaceholder: () => '?',

  /* 時間欄位存的已是毫秒整數，SELECT 直接取欄位（同 MySQL）。
   * Time columns already hold millisecond integers, so SELECT takes the column directly (as in MySQL). */
  epochMs: (column) => column,
  readTime: (value) => (value === null || value === undefined ? null : Number(value)),
  /* `count(*)` 已回 JS number，不必像 Postgres 補 `::int`。
   * `count(*)` already returns a JS number; Postgres's `::int` is unneeded. */
  countInt: (expression) => expression,
  readNumber: (value) => Number(value ?? 0),
  /* 布林以 `integer` 存（DDL 的 `default 1`），只有 1 是真。
   * Booleans are stored as `integer` (the DDL's `default 1`); only 1 is true. */
  readBool: (value) => value === true || Number(value) === 1,

  /*
   * SQLite 3.30 起支援 `nulls last`，與 Postgres 共用同一份寫法，不必像 MySQL 模擬。
   * SQLite has supported `nulls last` since 3.30, so it shares Postgres's spelling instead of
   * simulating it the way MySQL must.
   */
  boardOrder: (category) => boardOrderKeys(category, 'best_at asc nulls last'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values (?, ?, ?, ?, ?)
     on conflict (run_id) do nothing`,

  /*
   * `created_at` 必須綁定而非用預設值：SQLite 的 `NOW_MS` 只有秒解析度，靠預設會讓審計時間與實際提交差上整秒。
   * `created_at` must be bound, not defaulted: SQLite's `NOW_MS` has only second resolution, so a
   * default would put the audit time up to a full second away from the actual submission.
   */
  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, client_ip, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (run_id) do nothing
     returning run_id`,

  insertScoreSignal: 'rows',

  /*
   * 形狀與 Postgres 相同，只差兩個函式名（`greatest` → `max`、`now()` → `NOW_MS`）；`excluded` 永遠是
   * 「原本要插入的那一列」，不受賦值順序影響，MySQL 的欄位順序地雷在這裡不存在。
   * Same shape as Postgres, differing only in two function names (`greatest` → `max`,
   * `now()` → `NOW_MS`); `excluded` is always "the row about to be inserted", independent of
   * assignment order — MySQL's column-order trap does not exist here.
   */
  upsertProfile: () => `insert into profiles (
       device_id, display_name, best_score, best_duration_ms, best_max_combo, best_merges,
       best_at, created_at, updated_at
     ) values (?, ?, ?, ?, ?, ?, ?, ${NOW_MS}, ${NOW_MS})
     on conflict (device_id) do update set
       display_name = case when excluded.display_name = ''
                           then profiles.display_name else excluded.display_name end,
       best_duration_ms = case when excluded.best_score > profiles.best_score
                               then excluded.best_duration_ms else profiles.best_duration_ms end,
       best_at = case when excluded.best_score > profiles.best_score
                      then excluded.best_at else profiles.best_at end,
       best_score = max(profiles.best_score, excluded.best_score),
       best_max_combo = max(profiles.best_max_combo, excluded.best_max_combo),
       best_merges = max(profiles.best_merges, excluded.best_merges),
       updated_at = ${NOW_MS}`,

  /*
   * 識別碼不加引號（`version`、`rank`、`merges` 在 SQLite 都不是保留字）；索引分開寫；
   * `integer primary key` 是 rowid 的別名，`requests` 不必寫 `autoincrement`。
   * Identifiers are unquoted (`version`, `rank` and `merges` are not reserved in SQLite); indexes
   * are written separately; `integer primary key` aliases the rowid, so `requests` needs no
   * `autoincrement`.
   */
  schema: () => [
    `create table if not exists profiles (
       device_id        text    primary key,
       display_name     text    not null default '',
       best_score       integer not null default 0,
       best_max_combo   integer not null default 0,
       best_merges      integer not null default 0,
       best_duration_ms integer not null default 0,
       best_at          integer,
       name_changed_at  integer,
       created_at       integer not null default (${NOW_MS}),
       updated_at       integer not null default (${NOW_MS})
     )`,
    `create index if not exists profiles_best_score_idx on profiles (best_score desc, best_at asc)`,
    `create table if not exists scores (
       run_id       text    primary key,
       device_id    text    not null,
       display_name text    not null default '',
       score        integer not null,
       duration_ms  integer not null,
       merges       integer not null,
       drops        integer not null,
       max_combo    integer not null,
       version      text    not null default '',
       verified     integer not null default 1,
       rejected     text,
       client_ip    text,
       created_at   integer not null default (${NOW_MS})
     )`,
    `create index if not exists scores_device_idx on scores (device_id, created_at desc)`,
    `create index if not exists scores_verified_score_idx on scores (score desc) where verified`,
    `create table if not exists run_tokens (
       run_id     text    primary key,
       device_id  text    not null,
       token_hash text    not null,
       issued_at  integer not null,
       expires_at integer not null,
       used_at    integer
     )`,
    `create index if not exists run_tokens_device_idx on run_tokens (device_id, issued_at desc)`,
    `create table if not exists requests (
       id              integer primary key,
       received_at     integer not null default (${NOW_MS}),
       method          text    not null,
       path            text    not null,
       status          integer not null,
       device_id       text,
       run_id          text,
       client_ip       text,
       user_agent      text,
       accept_language text,
       origin          text,
       referer         text,
       country         text,
       region          text,
       city            text,
       headers         text    not null default '{}'
     )`,
    `create index if not exists requests_received_idx on requests (received_at desc)`,
    `create index if not exists requests_device_idx on requests (device_id, received_at desc)`,
    `create index if not exists requests_ip_idx on requests (client_ip, received_at desc)`,
  ],
};
