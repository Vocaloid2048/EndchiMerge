/**
 * 資料庫驅動層的最小介面。
 * The database driver layer's minimal interface.
 *
 * 這一層存在的唯一理由是**共用程式碼**：`sqlStore.ts` 的邏輯（什麼時候更新時長、交易裡的順序、
 * 冪等怎麼判）只寫一次，而 Postgres 與 MySQL 的差異全部收斂到 `Dialect`（見 `dialect.ts`）。
 * The only reason this layer exists is **code sharing**: the logic in `sqlStore.ts` (when the duration
 * is replaced, the order inside a transaction, how idempotency is decided) is written once, and every
 * difference between Postgres and MySQL is folded into `Dialect` (see `dialect.ts`).
 *
 * `Driver` 刻意只是一個 `query(sql, params)`。它**不是**一個通用的 ORM 或查詢建構器 —— 這個專案的
 * SQL 只有十幾條，能被讀懂比能被抽象重要。
 * `Driver` is deliberately nothing but `query(sql, params)`. It is **not** a general ORM or query
 * builder — this project has a dozen statements, and being readable beats being abstract.
 */

export type Row = Record<string, unknown>;

/** 一次查詢的結果。 */
export interface SqlResult {
  readonly rows: readonly Row[];
  /**
   * INSERT／UPDATE／DELETE 影響的行數；SELECT 一律 0。
   * The number of rows an INSERT / UPDATE / DELETE touched; always 0 for a SELECT.
   *
   * 這是 MySQL 判斷「這一局是不是第一次送」的唯一依據（它沒有 `RETURNING`），所以兩個驅動都必須
   * 把它填對 —— 填 0 會讓每一筆提交都被當成重複而靜默丟掉。
   * This is the only signal MySQL has for "is this the first submission of this run" (it has no
   * `RETURNING`), so both drivers must report it correctly — reporting 0 would make every submission
   * look like a duplicate and be silently dropped.
   */
  readonly affected: number;
}

/**
 * 一個能跑 SQL 的東西：連線池，或交易中的單一連線。
 * Something that can run SQL: a pool, or a single connection inside a transaction.
 */
export interface Driver {
  query(sql: string, params?: readonly unknown[]): Promise<SqlResult>;

  /**
   * 在一個交易裡跑 `run`；拋錯就回滾。
   * Run `run` inside a transaction, rolling back on a throw.
   *
   * 若 `this` 已經在交易中（也就是 `run` 收到的那個 driver 再呼叫 `transaction`），直接執行而不開
   * 巢狀交易 —— 巢狀交易在 MySQL 是**隱式提交**（`begin` 會把外層交易結束掉），這是很容易出事的
   * 地方，所以在介面上就避免它。
   * If `this` is already inside a transaction (i.e. the driver handed to `run` calls `transaction`
   * again), it just runs without opening a nested one: nested transactions in MySQL are an **implicit
   * commit** (`begin` ends the outer transaction), which is an easy way to lose data, so the interface
   * avoids it outright.
   */
  transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T>;

  /** 關掉這個 driver（測試與本機工具用）。 */
  close(): Promise<void>;
}
