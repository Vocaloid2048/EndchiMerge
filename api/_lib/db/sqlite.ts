/**
 * SQLite：驅動（`node:sqlite`）＋ 方言。
 * SQLite: the driver (`node:sqlite`) and the dialect.
 *
 * ## 為什麼有第三個方言 / Why a third dialect exists
 *
 * 前面兩個方言都要**先有一個服務**：Postgres／MySQL 得先跑起來、給埠、給帳號密碼。開發時那意味著
 * 「跑測試之前先開 Docker」或「先裝一個 MySQL」，而這個 repo 之前正是因為這樣才把整合測試 gated 掉
 * （見 `docs/backend.md` §7）。SQLite 只是一個**檔案**：沒有服務、沒有埠、沒有帳號，所以
 * `npx vitest run` 可以直接跑真的 SQL，`npm run dev` 也可以一鍵起一個真的資料庫。
 * The other two dialects both need **a service running first**: Postgres and MySQL want a port, a
 * user and a password. During development that means "start Docker before running the tests" or
 * "install MySQL first", which is exactly why this repo used to gate its integration tests (see
 * `docs/backend.md` §7). SQLite is just a **file**: no service, no port, no credentials — so
 * `npx vitest run` can exercise real SQL, and `npm run dev` can bring a real database up in one step.
 *
 * 而且它**不加任何依賴**：Node 22 內建 `node:sqlite`（這裡實測 22.22.2 直接可用，不必加 flag）。
 * 那個模組的 API 還是 experimental（會印一行警告），用在開發資料庫上可以接受 —— 要規避就換
 * `better-sqlite3`，那是同一個 `Driver` 換一個實作。
 * And it **adds no dependency at all**: Node 22 ships `node:sqlite` (measured working on 22.22.2
 * without a flag). That module's API is still experimental (it prints a warning), which is acceptable
 * for a development database — to avoid it, swap in `better-sqlite3`; that is the same `Driver` with a
 * different implementation.
 *
 * ## ⚠️ 它**不是**部署選項 / It is **not** a deployment option
 *
 * Vercel、EdgeOne 與騰訊雲的函式都跑在**拋棄式檔案系統**上：一個請求寫進去的檔案，下一個請求不一定
 * 看得到，實例被回收就整批消失。所以正式環境仍然是 Postgres（Neon）或 MySQL（騰訊雲）——這個方言的
 * 定位是**開發**，不是取代任何一邊。真的要上線又想要 SQLite 的形狀，得走 Turso／libSQL 那種託管的
 * 版本，那是同樣的 `Driver` 換一個實作，不是把檔案放上函式。
 * Vercel, EdgeOne and Tencent Cloud functions all run on an **ephemeral filesystem**: a file written
 * by one request is not reliably visible to the next, and everything vanishes when the instance is
 * reclaimed. Production therefore stays on Postgres (Neon) or MySQL (Tencent Cloud) — this dialect's
 * job is **development**, not replacing either. Deploying with SQLite's shape means a hosted variant
 * such as Turso / libSQL: again the same `Driver` with another implementation, not a file shipped
 * inside a function.
 *
 * ## 三個地方的寫法與另外兩個方言不同 / Three spellings differ from the other dialects
 *
 * | 項目 | 這裡 | 為什麼 |
 * | --- | --- | --- |
 * | 時間 | `integer`（UTC 毫秒） | SQLite 沒有時間型別。存整數沒有時區歧義，也不會有 MySQL 那個「驅動按行程本地時區解讀」的地雷 |
 * | `greatest(a, b)` | `max(a, b)` | SQLite 沒有 `greatest`（`max` 的兩參數形式就是逐列最大值） |
 * | `now()` | `(strftime('%s','now') * 1000)` | SQLite 沒有 `now()` |
 *
 * 反過來，**upsert 與 `returning` 與 Postgres 同形**：`on conflict (…) do update set … excluded.x`
 * 與 `insert … on conflict do nothing returning` 兩者都支援。所以 `insertScoreSignal` 也是 `'rows'`
 * —— 不像 MySQL 要靠 `affectedRows`（而那條路上還有 `FOUND_ROWS` 那個地雷，見 `mysql.ts`）。
 * Conversely, **the upsert and `returning` have Postgres's shape**: SQLite supports
 * `on conflict (…) do update set … excluded.x` and `insert … on conflict do nothing returning`. So
 * `insertScoreSignal` is `'rows'` too — unlike MySQL, which has to lean on `affectedRows` (and that
 * path carries the `FOUND_ROWS` trap described in `mysql.ts`).
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

import { boardOrderKeys, type Dialect } from './dialect.js';
import type { Driver, Row, SqlResult } from './types.js';

/**
 * 這一句會不會回傳列。
 * Whether a statement returns rows.
 *
 * `node:sqlite` 用兩個不同的方法跑語句（`all()` 回列、`run()` 回「改了幾個」），所以驅動必須先知道
 * 手上這一句是哪一種。判斷看的是語句裡有沒有 `select` 或 `returning` —— 這在這個專案裡是可靠的，
 * 因為所有 SQL 都由 `Dialect` 產生，只有十幾條、每一條都讀得懂（`types.ts` 的取捨：能被讀懂比能被
 * 抽象重要）。
 * `node:sqlite` runs statements through two different methods (`all()` returns rows, `run()` returns
 * "how many changed"), so the driver has to know which kind it holds. The test looks for `select` or
 * `returning`, which is reliable here because every statement comes from `Dialect`: there are a dozen
 * of them and each one is readable (the trade-off from `types.ts`: being readable beats being
 * abstract).
 */
const RETURNS_ROWS = /(^|[\s(])(?:select|returning)\b/iu;

/**
 * UTC 毫秒的 SQL 表達式，用來填 `created_at` ／ `updated_at`。
 * A UTC-milliseconds SQL expression, used to fill `created_at` / `updated_at`.
 *
 * `sqlStore.upsertProfile` 只綁 7 個參數（DeviceId、名稱、四個數值與時間），所以這兩個時間欄位只能
 * 由 SQL 自己生 —— 而 SQLite 沒有 `now()`。`strftime` 回的是**秒**的文字，乘 1000 會被 SQLite 強制
 * 轉成整數，與其他時間欄位的單位一致。
 * `sqlStore.upsertProfile` binds exactly seven parameters (the device id, the name, the four numbers
 * and the time), so those two timestamp columns have to be produced by the SQL itself — and SQLite
 * has no `now()`. `strftime` returns **seconds** as text; multiplying by 1000 makes SQLite coerce it
 * to an integer, matching the unit of every other time column.
 */
const NOW_MS = "(strftime('%s','now') * 1000)";

/**
 * 把一個 JS 值轉成 `node:sqlite` 收得下的參數。
 * Turn a JS value into something `node:sqlite` will accept as a parameter.
 *
 * `node:sqlite` 只收 `null | number | bigint | string | Uint8Array` —— **布林不在其中**，直接傳會拋。
 * 而 `sqlStore.insertScore` 綁的是 `row.verified`，那是儲存層的事實（一局有沒有通過檢查），不該為了
 * 某個驅動把它改成 1／0；所以轉換留在這一層，與 DDL 的 `integer not null default 1` 對應。
 * `node:sqlite` accepts only `null | number | bigint | string | Uint8Array` — **booleans are not in
 * that list** and passing one throws. `sqlStore.insertScore` binds `row.verified`, which is a fact
 * about the run (did it pass the checks) and must not be turned into 1/0 just for one driver, so the
 * conversion lives here, mirroring the DDL's `integer not null default 1`.
 */
const bindable = (value: unknown): SQLInputValue =>
  typeof value === 'boolean' ? (value ? 1 : 0) : (value as SQLInputValue);

/**
 * `node:sqlite` 的驅動。
 * The `node:sqlite` driver.
 *
 * 這個驅動是**同步**的（`node:sqlite` 沒有非同步 API），而介面是非同步的 —— 所以每個方法只是把同步的
 * 結果包成 resolved promise。這反而讓交易比另外兩個方言簡單：沒有第二條連線、沒有 `begin` 落在別人身上
 * 的可能，整條路徑都在同一個執行緒上跑到底。
 * This driver is **synchronous** (`node:sqlite` has no async API) while the interface is async, so
 * each method just wraps a sync result in a resolved promise. That makes transactions simpler than on
 * the other two dialects: no second connection, no chance of a `begin` landing on someone else's
 * session, and the whole path runs to completion on one thread.
 */
class SqliteDriver implements Driver {
  constructor(
    private readonly db: DatabaseSync,
    /** 非 `null` 表示這個 driver 已經在某個交易裡（見 `Driver.transaction`）。 */
    private readonly inTransaction = false,
  ) {}

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    const statement: StatementSync = this.db.prepare(sql);
    const args = params.map(bindable);

    if (RETURNS_ROWS.test(sql)) {
      return { rows: statement.all(...args) as Row[], affected: 0 };
    }

    /*
     * `changes` 就是「真的寫進去的列數」，與 MySQL 的 `affectedRows`（在關掉 `FOUND_ROWS` 之後）同義。
     * `changes` 就是 PostgreSQL 的 `returning` 行數的等價物，而建表語句回 0，兩者都不影響。
     * `changes` is "rows actually written", the same thing MySQL's `affectedRows` means once
     * `FOUND_ROWS` is off. DDL statements report 0, which nothing depends on.
     */
    return { rows: [], affected: Number(statement.run(...args).changes) };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    /* 已經在交易裡就不再開一層（介面上的理由見 `types.ts`）。 */
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
    /* 交易中的 driver 不擁有連線，關掉是外層的事。 */
    if (!this.inTransaction) this.db.close();
  }
}

/**
 * 從連線字串取出檔案路徑。
 * Extract the file path from the connection string.
 *
 * 接受 `sqlite:` 後面直接接路徑（`sqlite:.mysql/endchi.db`）或接 `//` 開頭的形式
 * （`sqlite://rel/path`、`sqlite:///abs/path`）。`//` 與 `///` 都只當「URL 的分隔符」剝掉一次 ——
 * SQLite 的連線字串沒有 host 這個概念，所以在這裡 `//` 不代表「跳過一個 host 名」而是「路徑從下一
 * 個字元開始」。`sqlite:///tmp/x.db` 因此得到 `/tmp/x.db`（POSIX 絕對路徑），
 * `sqlite://E:/x.db` 得到 `E:/x.db`（Windows 磁碟機）。
 * Accepts a path directly after `sqlite:` (`sqlite:.mysql/endchi.db`) or the `//`-prefixed forms
 * (`sqlite://rel/path`, `sqlite:///abs/path`). `//` and `///` are stripped once as a "URL separator":
 * a SQLite connection string has no concept of a host, so here `//` does not mean "skip a host name"
 * but "the path starts at the next character". `sqlite:///tmp/x.db` therefore yields `/tmp/x.db` (a
 * POSIX absolute path) and `sqlite://E:/x.db` yields `E:/x.db` (a Windows drive).
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
   * 記憶體資料庫沒有目錄要建；檔案資料庫則要先把上層目錄做出來，否則 SQLite 回 `SQLITE_CANTOPEN`
   * —— 而那個錯誤看起來像權限問題，不像「你忘了 mkdir」。
   * An in-memory database has no directory to create; a file one needs its parent to exist first, or
   * SQLite answers `SQLITE_CANTOPEN` — an error that looks like a permissions problem rather than
   * "you forgot to mkdir".
   */
  if (path !== ':memory:' && path !== '') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  /*
   * 三個 pragma，每一個都對應一個實際會遇到的症狀：
   * - `foreign_keys`：SQLite **預設不強制**外鍵，也就是「你寫的約束不會發生」。目前的 schema 其實
   *   **沒有任何外鍵**（`scores.device_id` 那個刻意拿掉了，理由見 `postgres.ts`），所以這一行現在
   *   不擋任何東西；留著是因為另外兩個方言永遠強制外鍵，而一個會**默默忽略**約束的方言並不真的是它們
   *   的等價物 —— 哪天有人在 DDL 裡加一個外鍵，這裡不問就該照著執行。
   * - `journal_mode = WAL`：讀取不會被寫入擋住（開發時一邊開工具看資料、一邊玩遊戲）。
   * - `busy_timeout`：兩個行程同時動同一個檔案時排隊等待，而不是立刻回 `SQLITE_BUSY`。
   * Three pragmas, each answering a symptom that really happens: `foreign_keys` because SQLite
   * **does not enforce** foreign keys by default, which means "the constraint you wrote does nothing"
   * — the schema currently declares **no** foreign key at all (the one on `scores.device_id` was
   * deliberately removed, see `postgres.ts`), so this line guards nothing today; it stays because the
   * other two dialects always enforce their keys, and a dialect that **silently ignores** constraints
   * is not really their equivalent — the day someone adds a key to the DDL, this must honour it without
   * being asked. `journal_mode = WAL` so a read is not blocked by a write (browsing the data while
   * playing). `busy_timeout` so two processes touching the same file queue instead of failing with
   * `SQLITE_BUSY`.
   */
  db.exec('pragma foreign_keys = on');
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma busy_timeout = 5000');

  return new SqliteDriver(db);
}

/**
 * 對這組連線設定的提醒。只有一條，但它是三個方言裡最要緊的一條 —— 另外兩條講的是「連線設得不好」，
 * 這一條講的是「這個選擇本身不該上線」。
 * The advice for this connection setting. There is only one line, but it is the most important of the
 * three dialects' — the other two say "this connection is set up badly", this one says "this choice
 * does not belong in production".
 *
 * 仍然**不是錯誤**：本機開發就該這樣跑，所以它擋不了任何事（`runtime.ts` 只會 `console.warn`）。真正
 * 要防的是「有人把 `sqlite:` 填進 Vercel 的環境變數」——那個部署會看似成功，然後在實例被回收時安靜地
 * 掉光所有分數。
 * It is still **not an error**: this is exactly how local development should run, so it blocks nothing
 * (`runtime.ts` merely warns). What it guards against is someone putting `sqlite:` into a Vercel
 * environment: that deploy would appear to succeed and then silently lose every score when the
 * instance is reclaimed.
 */
export function connectionNotes(url: string): string[] {
  return [
    `SQLite（${sqlitePathFromUrl(url)}）只服務本機開發：它是一個檔案，而函式環境的檔案系統是拋棄式的，` +
      '部署請改用 postgres:// 或 mysql://（見 sqlite.ts 檔頭）。',
  ];
}

/* ── 方言 ─────────────────────────────────────────────────────────────────── */

export const sqliteDialect: Dialect = {
  name: 'sqlite',

  ph: () => '?',
  /* 時間就是那個整數，不做任何轉換。 */
  ts: (ms) => ms,
  tsPlaceholder: () => '?',
  jsonPlaceholder: () => '?',

  /* 時間欄位存的已經是毫秒整數，所以 SELECT 直接取欄位（同 MySQL）。 */
  epochMs: (column) => column,
  readTime: (value) => (value === null || value === undefined ? null : Number(value)),
  /* SQLite 的 `count(*)` 回 JS number，不必像 Postgres 那樣補 `::int`。 */
  countInt: (expression) => expression,
  readNumber: (value) => Number(value ?? 0),
  /* 布林以 `integer` 存（DDL 的 `default 1`），所以只有 1 是真。 */
  readBool: (value) => value === true || Number(value) === 1,

  /*
   * SQLite **有** `nulls last`（3.30 起；Node 22 內建的是 3.51），所以與 Postgres 共用同一份寫法
   * —— 這裡不必像 MySQL 那樣用 `best_at is null` 模擬。
   * SQLite **has** `nulls last` (since 3.30; Node 22 bundles 3.51), so it shares Postgres's spelling
   * rather than simulating it with `best_at is null` the way MySQL must.
   */
  boardOrder: (category) => boardOrderKeys(category, 'best_at asc nulls last'),

  insertRunToken: () => `insert into run_tokens (run_id, device_id, token_hash, issued_at, expires_at)
     values (?, ?, ?, ?, ?)
     on conflict (run_id) do nothing`,

  /*
   * `created_at` 綁進去的理由見 `postgres.ts`（`MemoryStore` 用的是 `atMs`，兩邊必須一致）。這裡格外
   * 需要注意的是 SQLite 的 `NOW_MS` 與 `strftime` 只有**秒**的解析度，所以靠預設值的話審計時間會與
   * 實際提交時間差上幾百毫秒 —— 綁進去的值是毫秒，與另外兩個方言一致。
   * The reason `created_at` is bound is in `postgres.ts` (`MemoryStore` uses `atMs`, and the two must
   * agree). What matters extra here is that SQLite's `NOW_MS` / `strftime` has only **second**
   * resolution, so leaning on the default would put the audit time up to a second away from the actual
   * submission — the bound value is milliseconds, matching the other two dialects.
   */
  insertScore: () => `insert into scores (
       run_id, device_id, display_name, score, duration_ms, merges, drops, max_combo,
       version, verified, rejected, client_ip, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (run_id) do nothing
     returning run_id`,

  insertScoreSignal: 'rows',

  /*
   * 形狀與 Postgres 那份一樣，差的只有兩個函式名：`greatest` → `max`、`now()` → `NOW_MS`。
   *
   * MySQL 那個「欄位順序有意義」的地雷**在這裡不存在** —— `excluded` 永遠是「原本要插入的那一列」，
   * 不受賦值順序影響（與 Postgres 同一個道理）。所以 `best_score` 排在哪裡都對，這裡仍照 Postgres 的
   * 順序寫，讓兩份並排看時一眼看得出是同一件事。
   * The shape matches Postgres', differing only in two function names: `greatest` → `max` and
   * `now()` → `NOW_MS`.
   *
   * MySQL's "column order matters" trap **does not exist here**: `excluded` is always "the row that
   * was about to be inserted" regardless of assignment order, exactly as in Postgres. `best_score`
   * could sit anywhere; it keeps Postgres's order so the two read as the same thing side by side.
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
   * 識別碼**不加引號**：SQLite 的保留字清單短，而 `version`、`rank`、`merges` 這些欄位名在 SQLite 裡
   * 都不是保留字（`rank` 在 MySQL 是、在 SQLite 不是），加了只是噪音。
   * Identifiers are **not quoted**: SQLite's reserved-word list is short, and none of `version`,
   * `rank` or `merges` is reserved here (unlike in MySQL); quoting would only be noise.
   *
   * 索引分開寫（SQLite 的 `create index if not exists` 是有的，不像 MySQL 要擠進建表語句），欄位型別
   * 是 SQLite 的親和性（`integer`／`text`）——`integer primary key` 就是 rowid 的別名，所以 `requests`
   * 的自增主鍵不必寫 `autoincrement`。
   * Indexes are written separately (SQLite has `create index if not exists`, unlike MySQL where they
   * have to be folded into the `create table`), and column types use SQLite's affinities
   * (`integer` / `text`) — `integer primary key` is an alias for the rowid, so `requests` needs no
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
