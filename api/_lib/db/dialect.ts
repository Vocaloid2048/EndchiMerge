/**
 * SQL 方言：**Postgres 與 MySQL 之間所有差異的唯一去處**。
 * The SQL dialect: the **single home for every difference between Postgres and MySQL**.
 *
 * ## 為什麼要有這一層 / Why this layer exists
 *
 * 同一個遊戲要在 Vercel（Neon ＝ Postgres）與騰訊（免費的關聯式選項都是 MySQL）上跑，而資料層的
 * **邏輯**不該有兩份。若把 SQL 直接寫進 store，兩邊就會變成兩支會各自漂移的檔案；漂移一次就是
 * 「Vercel 上正常、騰訊上分數算錯」這種最難查的 bug。
 * The same game runs on Vercel (Neon = Postgres) and Tencent (whose free relational options are all
 * MySQL), and the data layer's **logic** must not exist twice. Writing SQL straight into the store
 * would produce two files that drift; one drift and you get "fine on Vercel, wrong scores on
 * Tencent" — the hardest kind of bug to find.
 *
 * 所以分工是：
 *   - `sqlStore.ts` —— **邏輯**（要不要更新時長、交易的順序、冪等怎麼判），只寫一次；
 *   - `Dialect` —— **語法**（佔位符、時間、upsert、`RETURNING`、`NULLS LAST`），每個方言一份。
 * So the split is: `sqlStore.ts` holds the **logic** (whether to replace the duration, the order inside
 * a transaction, how idempotency is decided) and is written once; `Dialect` holds the **syntax**
 * (placeholders, time, upsert, `RETURNING`, `NULLS LAST`), one per dialect.
 *
 * ## 方言之間的差異，一覽 / The differences, at a glance
 *
 * | 項目 | Postgres | MySQL |
 * | --- | --- | --- |
 * | 佔位符 | `$1, $2` | `?` |
 * | 時間型別 | `timestamptz` | `datetime(3)`（UTC） |
 * | 時間參數 | ISO 字串 ＋ `::timestamptz` | `Date` 物件 |
 * | 讀時間 | `extract(epoch from …) * 1000` | `Date.getTime()` |
 * | 布林 | `true` / `false` | `1` / `0` |
 * | JSON | `jsonb` | `json` |
 * | 唯一鍵衝突 | `on conflict … do nothing` | `on duplicate key update` |
 * | 插入是否成功 | `returning` 的行數 | `affectedRows` |
 * | 空值排序 | `nulls last` | 沒有，要寫 `col is null, col` |
 * | `count(*)` | 回 bigint（字串）→ 要 `::int` | 回數字 |
 */

import type { Driver } from './types';

export type DialectName = 'postgres' | 'mysql';

/** 一個方言要回答的所有問題。 */
export interface Dialect {
  readonly name: DialectName;

  /* ── 參數 ──────────────────────────────────────────────────────────────── */

  /** 第 `position` 個（1 起算）佔位符。 */
  ph(position: number): string;
  /** 時間參數的值：毫秒 → 驅動看得懂的東西。 */
  ts(ms: number): unknown;
  /** 時間參數的**佔位符**（Postgres 要 `::timestamptz` 才不會被當成字串比較）。 */
  tsPlaceholder(position: number): string;
  /** JSON 參數的佔位符。 */
  jsonPlaceholder(position: number): string;

  /* ── 讀取 ──────────────────────────────────────────────────────────────── */

  /** 把時間欄位讀成毫秒的 SELECT 表達式。 */
  epochMs(column: string): string;
  /** 把驅動回來的時間值轉成毫秒；`null` 原樣回 `null`。 */
  readTime(value: unknown): number | null;
  /** `count(…)` 轉成 JS 安全整數的表達式。 */
  countInt(expression: string): string;
  /** 驅動回來的整數（Postgres 的 `count` 是字串、MySQL 的 `bigint` 也可能是字串）。 */
  readNumber(value: unknown): number;
  /** 驅動回來的布林值。 */
  readBool(value: unknown): boolean;

  /* ── 語句片段 ──────────────────────────────────────────────────────────── */

  /**
   * 榜的 `order by`（**不含** `order by` 這幾個字）。
   * The board's `order by` (without the keywords themselves).
   *
   * 三個鍵必須與 `MemoryStore.compareProfiles` 完全一致，否則同分時 `rankOf` 與 `topProfiles` 會
   * 對不起來 —— `tests/api.test.ts` 用同分的案例把兩邊釘在一起。
   * The three keys must match `MemoryStore.compareProfiles` exactly, or a tie would make `rankOf` and
   * `topProfiles` disagree — `tests/api.test.ts` pins the two together with a tied case.
   */
  boardOrder(): string;

  /* ── 三個寫入語句（形狀差異太大，各自寫一份）/ Three writes, written per dialect ── */

  insertRunToken(): string;
  /**
   * 插入一局。
   * Insert a run.
   *
   * 兩邊都必須是**原子**的冪等：Postgres 是 `on conflict … do nothing returning`，MySQL 是
   * `on duplicate key update run_id = run_id`（把主鍵更新成自己 ＝ 什麼都不做）。MySQL **不能**用
   * `insert ignore`：它會把所有錯誤（外鍵、型別）都吞成警告，而不只是重複鍵。
   * Both must be **atomically** idempotent: Postgres uses `on conflict … do nothing returning`, MySQL
   * uses `on duplicate key update run_id = run_id` (assigning the key to itself is a no-op). MySQL
   * must **not** use `insert ignore`, which swallows *every* error (foreign keys, types) as a warning
   * rather than only duplicate keys.
   */
  insertScore(): string;
  /** 這個 `insertScore` 用什麼判斷「真的插進去了」。 */
  readonly insertScoreSignal: 'rows' | 'affected';
  /**
   * 寫入或更新一位玩家的歷史最大值。
   * Write or refresh a player's historical maxima.
   *
   * ⚠️ **MySQL 的欄位順序有意義**：`on duplicate key update` 是**由左至右**求值的，後面的賦值會看到
   * 前面已經改過的值（Postgres 的 `excluded` 則永遠是「新的那一列」）。所以 MySQL 這邊 `best_score`
   * 必須排在所有拿它比較的欄位**之後**，否則 `values(best_score) > best_score` 會變成「新 > 新」而
   * 永遠是 false，時長就永遠不會跟著分數更新。
   * ⚠️ **Column order matters in MySQL**: `on duplicate key update` evaluates **left to right**, and a
   * later assignment sees values already updated by an earlier one (Postgres's `excluded` is always
   * "the new row" regardless of order). So in MySQL `best_score` must come **after** every column that
   * compares against it, or `values(best_score) > best_score` becomes "new > new" — always false — and
   * the duration would never follow the score.
   */
  upsertProfile(): string;

  /* ── 建表 ──────────────────────────────────────────────────────────────── */

  /** 建表語句；`ensureSchema` 會逐條執行，所以每一條都必須**可重複執行**。 */
  schema(): readonly string[];
}

/* ── 共用小工具 / Shared helpers ──────────────────────────────────────────── */

/**
 * 把值綁進語句，並給出對應的佔位符。
 * Bind values into a statement, handing back the matching placeholder.
 *
 * 這是**同一個 SQL 字串能同時餵 Postgres 與 MySQL 的關鍵**。兩種佔位符的差異不只是文字：
 * `$1` 可以被引用多次而只傳一份值，`?` 則是**位置性**的 —— 每一次出現都吃掉一個參數。所以
 * 「同一個值出現三次」在 Postgres 只要一個參數，在 MySQL 要三個。
 * This is **what lets one SQL string feed both Postgres and MySQL**. The two placeholders differ in
 * more than spelling: `$1` can be referenced many times with a single value, whereas `?` is
 * **positional** — every occurrence consumes a parameter. So "the same value three times" needs one
 * parameter on Postgres and three on MySQL.
 *
 * 修法很單純：**每一次出現都綁一次**。Postgres 那邊會多幾個沒有必要的參數，但語句是對的、而且是
 * 同一份文字 —— 比起為這個差異寫兩份 SQL（然後等著它們漂移），多幾個參數便宜太多了。
 * The fix is simply to **bind once per occurrence**. Postgres gets a few redundant parameters, but the
 * statement is correct and it is the same text — far cheaper than writing the SQL twice (and waiting
 * for the two copies to drift).
 *
 * 唯一不適用的是三個寫入語句（見 `Dialect.insertRunToken` 等）：它們的**形狀**本身就不一樣，所以
 * 各自寫在自己的方言裡。
 * The only things this does not cover are the three writes (see `Dialect.insertRunToken` and friends):
 * their **shape** differs, so each lives in its own dialect.
 */
export class Binder {
  private readonly values: unknown[] = [];

  constructor(private readonly dialect: Dialect) {}

  /** 綁一個值，回它在這個方言裡的佔位符。 */
  bind(value: unknown): string {
    this.values.push(value);
    return this.dialect.ph(this.values.length);
  }

  /**
   * 綁一個時間值（毫秒）。
   * Bind a time value, in milliseconds.
   *
   * 走 `ts`／`tsPlaceholder` 而不是 `bind`：值的**型別**要換（Postgres 收 ISO 字串、MySQL 收
   * `Date`），而 Postgres 那邊還要 `::timestamptz` 才會被當成時間而不是字串來比較。
   * Goes through `ts` / `tsPlaceholder` rather than `bind` because the **type** must change (Postgres
   * takes an ISO string, MySQL a `Date`) and Postgres needs `::timestamptz` to compare it as a time
   * rather than as text.
   */
  bindTime(ms: number): string {
    this.values.push(this.dialect.ts(ms));
    return this.dialect.tsPlaceholder(this.values.length);
  }

  /** 綁一個 JSON 值；Postgres 要 `::jsonb` 才不會把它當成一段文字。 */
  bindJson(value: unknown): string {
    this.values.push(value);
    return this.dialect.jsonPlaceholder(this.values.length);
  }

  /** 依綁定順序排好的參數，直接餵給驅動。 */
  get params(): readonly unknown[] {
    return this.values;
  }
}

/**
 * 榜的排序鍵（三個鍵的**語意**，各方言只差 `nulls last` 的寫法）。
 * The board's sort keys — the **semantics** are shared, and only the spelling of nulls-last differs.
 */
export const BOARD_ORDER_KEYS = 'best_score desc, best_at asc, device_id asc';

/** 從連線字串猜方言（沒有明講 `DB_DIALECT` 時）。 */
export function dialectFromUrl(url: string): DialectName {
  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();

  if (scheme === 'mysql' || scheme === 'mysql2' || scheme === 'mariadb') return 'mysql';

  return 'postgres';
}

/**
 * 這個錯誤是不是「連不上」而不是「SQL 寫錯」。
 * Whether an error is "cannot connect" rather than "the SQL is wrong".
 *
 * 分開的理由是**處置方式完全不同**：連不上要重試（或回 503），SQL 寫錯要修程式而重試沒有意義。
 * 把兩者混成一個 500 會讓前者看起來像後者的 bug。
 * The distinction matters because the **response differs**: a connection failure should be retried
 * (or answered with a 503), while a bad SQL statement needs a code fix and retrying is pointless.
 * Collapsing both into a 500 makes the first look like a bug in the second.
 */
export function isConnectionError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return false;

  /*
   * Postgres 的連線類錯誤從 08 開頭（`08000` 連線例外、`08006` 連線失敗…），加上 `ECONNREFUSED`
   * 這類 Node 層的錯誤碼；MySQL 用 `PROTOCOL_CONNECTION_LOST` / `ECONNREFUSED` / `ETIMEDOUT` /
   * `ER_ACCESS_DENIED_ERROR`（憑證錯也連不上，同樣該走 503 而不是 500）。
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

/** 方言要能建立自己的 driver（`db/index.ts` 用它把兩邊接起來）。 */
export type DriverFactory = (url: string) => Driver;
