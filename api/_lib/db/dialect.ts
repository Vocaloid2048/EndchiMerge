/**
 * SQL 方言：**各資料庫之間所有差異的唯一去處**。
 * The SQL dialect: the **single home for every difference between the databases**.
 */

import type { Driver } from './types.js';

export type DialectName = 'postgres' | 'mysql' | 'sqlite';

/**
 * 一個方言要回答的所有問題。
 * Every question a dialect has to answer.
 */
export interface Dialect {
  readonly name: DialectName;

  /**
   * 第 `position` 個（1 起算）佔位符。
   * The placeholder for argument `position` (1-based).
   */
  ph(position: number): string;
  /**
   * 時間參數的值：毫秒轉成驅動看得懂的形式。
   * A time argument's value: milliseconds in the form the driver understands.
   */
  ts(ms: number): unknown;
  /**
   * 時間參數的**佔位符**（Postgres 要 `::timestamptz` 才不會被當成字串比較）。
   * The time argument's **placeholder** (Postgres needs `::timestamptz` to avoid a text comparison).
   */
  tsPlaceholder(position: number): string;
  /**
   * JSON 參數的佔位符。
   * The JSON argument's placeholder.
   */
  jsonPlaceholder(position: number): string;

  /**
   * 把時間欄位讀成毫秒的 SELECT 表達式。
   * A SELECT expression that reads a time column as milliseconds.
   */
  epochMs(column: string): string;
  /**
   * 把驅動回來的時間值轉成毫秒；`null`／`undefined` 原樣回 `null`。
   * Converts a driver-returned time value to milliseconds; `null` / `undefined` stay `null`.
   */
  readTime(value: unknown): number | null;
  /**
   * 把 `count(…)` 轉成 JS 安全整數的表達式。
   * An expression turning `count(…)` into a JS-safe integer.
   */
  countInt(expression: string): string;
  /**
   * 驅動回來的整數（Postgres 的 `count` 與 MySQL 的 `bigint` 都可能是字串）。
   * A driver-returned integer (Postgres `count` and MySQL `bigint` may both arrive as strings).
   */
  readNumber(value: unknown): number;
  /**
   * 驅動回來的布林值。
   * A driver-returned boolean.
   */
  readBool(value: unknown): boolean;

  /**
   * 榜的 `order by`（**不含** `order by` 這幾個字），依分類。
   * The board's `order by` (without the keywords themselves), per category.
   *
   * 鍵必須與 `MemoryStore.compareProfiles` 完全一致，否則同分時 `rankOf` 與 `topProfiles` 會對不起來。
   * The keys must match `MemoryStore.compareProfiles` exactly, or a tie makes `rankOf` and `topProfiles` disagree.
   */
  boardOrder(category: BoardCategory): string;

  insertRunToken(): string;
  /**
   * 插入一局。
   * Insert a run.
   *
   * 兩邊都必須**原子**冪等；MySQL 用 `on duplicate key update run_id = run_id` 而非 `insert ignore`，後者會把所有錯誤吞成警告。
   * Both must be **atomically** idempotent; MySQL uses `on duplicate key update run_id = run_id`, not `insert ignore`, which swallows every error as a warning.
   */
  insertScore(): string;
  /**
   * `insertScore` 用什麼判斷「真的插進去了」。
   * What `insertScore` uses to decide it really inserted.
   */
  readonly insertScoreSignal: 'rows' | 'affected';
  /**
   * 寫入或更新一位玩家的歷史最大值。
   * Write or refresh a player's historical maxima.
   *
   * ⚠️ MySQL 的 `on duplicate key update` **由左至右**求值，所以 `best_score` 必須排在 `best_duration_ms`／`best_at` **之後**。
   * ⚠️ MySQL's `on duplicate key update` evaluates **left to right**, so `best_score` must come **after** `best_duration_ms` / `best_at`.
   */
  upsertProfile(): string;

  /**
   * 建表語句；`ensureSchema` 會逐條執行，所以每一條都必須**可重複執行**。
   * Schema statements; `ensureSchema` runs them one by one, so each must be **re-runnable**.
   *
   * 除了 `create … if not exists`，也可以放「清除舊欄位」的 drop：方言沒有 `drop column if exists` 時
   * （MySQL／SQLite）靠 `isMissingColumnError` 達成冪等。
   * Beyond `create … if not exists`, statements that drop legacy columns are allowed; where a dialect
   * has no `drop column if exists` (MySQL / SQLite), `isMissingColumnError` supplies the idempotency.
   */
  schema(): readonly string[];

  /**
   * 這個錯誤是不是「要 drop 的欄位／索引本來就不存在」＝ schema 已是目標形狀。
   * Whether this error means "the column / index to drop was never there" = already in target shape.
   *
   * 只服務 `schema()` 裡的 drop，不是通用的錯誤分類。
   * Only for the drops inside `schema()`, not a general error classifier.
   */
  isMissingColumnError?(error: unknown): boolean;
}

/**
 * 把值綁進語句，並給出對應的佔位符。
 * Bind values into a statement, handing back the matching placeholder.
 *
 * `$1` 可重複引用，`?` 則依位置各吃一個參數 —— 所以**每一次出現都綁一次**，同一份 SQL 才能兩邊通用。
 * `$1` can be referenced repeatedly while `?` consumes one argument per occurrence, so **bind once per occurrence** to keep one SQL string valid on both.
 */
export class Binder {
  private readonly values: unknown[] = [];

  constructor(private readonly dialect: Dialect) {}

  /**
   * 綁一個值，回它在這個方言裡的佔位符。
   * Binds a value and returns its placeholder in this dialect.
   */
  bind(value: unknown): string {
    this.values.push(value);
    return this.dialect.ph(this.values.length);
  }

  /**
   * 綁一個時間值（毫秒）。
   * Binds a time value in milliseconds.
   *
   * 走 `ts`／`tsPlaceholder` 而非 `bind`：值的型別要換，Postgres 還需要 `::timestamptz` 才會被當成時間比較。
   * Goes through `ts` / `tsPlaceholder` rather than `bind`: the value's type changes and Postgres needs `::timestamptz` to compare it as a time.
   */
  bindTime(ms: number): string {
    this.values.push(this.dialect.ts(ms));
    return this.dialect.tsPlaceholder(this.values.length);
  }

  /**
   * 綁一個 JSON 值；Postgres 要 `::jsonb` 才不會把它當成一段文字。
   * Binds a JSON value; Postgres needs `::jsonb` so it is not treated as text.
   */
  bindJson(value: unknown): string {
    this.values.push(value);
    return this.dialect.jsonPlaceholder(this.values.length);
  }

  /**
   * 依綁定順序排好的參數，直接餵給驅動。
   * The arguments in binding order, ready to hand to the driver.
   */
  get params(): readonly unknown[] {
    return this.values;
  }
}

/**
 * 榜的三個分類。
 * The board's three categories.
 *
 * 這是**榜在排什麼**的識別，不是顯示文字（顯示文字在客戶端的 `src/i18n`）。
 * This identifies **what the board ranks**, not the label (labels live in the client's `src/i18n`).
 */
export type BoardCategory = 'score' | 'combo' | 'merges';

/**
 * 三個分類（順序即 UI 的顯示順序）。
 * The three categories (the order is the UI's display order).
 */
export const BOARD_CATEGORIES: readonly BoardCategory[] = ['score', 'combo', 'merges'];

/**
 * 這個字串是不是一個分類。
 * Whether a string names a category.
 *
 * 不認識的值退回 `score` 而非回 400：榜是唯讀的，打錯分類參數不需要讓整個請求失敗。
 * An unknown value falls back to `score` rather than a 400: the board is read-only, so a mistyped category need not fail the request.
 */
export function isBoardCategory(value: unknown): value is BoardCategory {
  return typeof value === 'string' && (BOARD_CATEGORIES as readonly string[]).includes(value);
}

/**
 * 每個分類排的是哪一欄。
 * Which column each category ranks on.
 *
 * 三個值都是 `profiles` 上的**歷史最大值**且彼此獨立，所以組合數榜不是分數榜重排，而是換主鍵。
 * All three are **historical maxima** on `profiles` and independent, so the combo board changes the primary key rather than re-sorting the score board.
 */
export const BOARD_PRIMARY_COLUMN: Readonly<Record<BoardCategory, string>> = {
  score: 'best_score',
  combo: 'best_max_combo',
  merges: 'best_merges',
};

/**
 * 組成榜的排序鍵，各方言只差「時間怎麼排空的」那一段。
 * Builds the board's sort keys; dialects differ only in how the time column sorts nulls.
 *
 * 分類欄之後接**分數**（同組合數時高分在前），再以時間與 id 決勝。
 * After the category column comes **score** (higher score first on an equal combo), then time and id as tie-breakers.
 */
export function boardOrderKeys(category: BoardCategory, timeOrder: string): string {
  const primary = `${BOARD_PRIMARY_COLUMN[category]} desc`;
  const tail = `${timeOrder}, device_id asc`;

  return category === 'score' ? `${primary}, ${tail}` : `${primary}, best_score desc, ${tail}`;
}

/**
 * 榜的排序鍵（分數分類的**語意**版本，不含方言寫法，也不該被 `nulls last` 或 `is null` 汙染）。
 * The board's sort keys — the score category's **semantics**, free of dialect spelling and of `nulls last` / `is null`.
 */
export const BOARD_ORDER_KEYS = 'best_score desc, best_at asc, device_id asc';

/**
 * 從連線字串猜方言（沒有明講 `DB_DIALECT` 時），認不出來就當 Postgres。
 * Guesses the dialect from the connection string (when `DB_DIALECT` is unset), defaulting to Postgres.
 */
export function dialectFromUrl(url: string): DialectName {
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();

  if (scheme === 'mysql' || scheme === 'mysql2' || scheme === 'mariadb') return 'mysql';

  /*
   * `sqlite:` 與 `sqlite3:` 都認；路徑怎麼取由 `sqlite.ts` 的 `sqlitePathFromUrl` 負責。
   * Both `sqlite:` and `sqlite3:` are accepted; extracting the path is `sqlitePathFromUrl`'s job in `sqlite.ts`.
   */
  if (scheme === 'sqlite' || scheme === 'sqlite3') return 'sqlite';

  return 'postgres';
}

/**
 * 一個連線字串指向哪裡 —— **去掉帳密**之後的那一小段，用來記進日誌。
 * Where a connection string points — the short form with credentials **removed**, for the log.
 *
 * 只回主機與資料庫名（SQLite 回檔案路徑）；查詢參數一律丟掉，因為其中可能有密碼。
 * Only the host and database name come back (the file path for SQLite); query parameters are dropped because one may be a password.
 */
export function describeConnectionTarget(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '') return '(empty)';

  const colon = trimmed.indexOf(':');
  if (colon < 0) return '(unrecognised)';

  const scheme = trimmed.slice(0, colon).toLowerCase();
  const rest = trimmed.slice(colon + 1);

  /*
   * SQLite 是一個檔案：沒有主機、沒有帳密，原樣回傳（查詢字串仍然丟掉）。
   * SQLite is a file: no host and no credentials, so it is returned as-is (the query string is still dropped).
   */
  if (scheme === 'sqlite' || scheme === 'sqlite3') return `${scheme}:${rest.split('?')[0] ?? ''}`;

  const withoutQuery = rest.split('?')[0] ?? '';
  const withoutSlashes = withoutQuery.replace(/^\/+/, '');
  const slash = withoutSlashes.indexOf('/');
  const authority = slash < 0 ? withoutSlashes : withoutSlashes.slice(0, slash);
  const database = slash < 0 ? '' : withoutSlashes.slice(slash);

  /*
   * 帳密在主機之前，而密碼本身可能含 `@`（未編碼時），所以取**最後一個** `@` 當分隔。
   * Credentials precede the host and a password may itself contain `@` when unescaped, so the **last** `@` is the separator.
   */
  const at = authority.lastIndexOf('@');
  const host = at < 0 ? authority : authority.slice(at + 1);

  return `${scheme}://${host}${database}`;
}

/**
 * 這個錯誤是不是「連不上」而不是「SQL 寫錯」。
 * Whether an error is "cannot connect" rather than "the SQL is wrong".
 *
 * 兩者處置不同：連不上要重試或回 503，SQL 寫錯要修程式。
 * The two need different handling: a connection failure is retried or answered with a 503, while bad SQL needs a code fix.
 */
export function isConnectionError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;

  /*
   * Postgres 連線類錯誤以 `08` 開頭，加上 Node 的 `ECONNREFUSED`／`ETIMEDOUT`／`ENOTFOUND`；MySQL 另有
   * `PROTOCOL_CONNECTION_LOST`／`ER_ACCESS_DENIED_ERROR`／`ER_CON_COUNT_ERROR`。
   * Postgres connection errors start with `08`, plus Node's `ECONNREFUSED` / `ETIMEDOUT` / `ENOTFOUND`; MySQL adds `PROTOCOL_CONNECTION_LOST` / `ER_ACCESS_DENIED_ERROR` / `ER_CON_COUNT_ERROR`.
   */
  return (
    code.startsWith('08') ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    code === 'PROTOCOL_CONNECTION_LOST' ||
    code === 'ER_ACCESS_DENIED_ERROR' ||
    code === 'ER_CON_COUNT_ERROR'
  );
}

/**
 * 方言要能建立自己的 driver（`db/index.ts` 用它把兩邊接起來）。
 * A dialect can build its own driver (`db/index.ts` wires the two together with it).
 */
export type DriverFactory = (url: string) => Driver;
