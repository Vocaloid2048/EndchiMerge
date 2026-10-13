/**
 * 資料庫驅動層的最小介面；Postgres 與 MySQL 的差異全部收斂到 `dialect.ts`。
 * The database driver layer's minimal interface; every Postgres/MySQL difference is folded into `dialect.ts`.
 */

export type Row = Record<string, unknown>;

export interface SqlResult {
  readonly rows: readonly Row[];
  /**
   * INSERT／UPDATE／DELETE 影響的行數；SELECT 一律 0。
   * Rows touched by an INSERT / UPDATE / DELETE; always 0 for a SELECT.
   *
   * MySQL 沒有 `RETURNING`，只能靠它判斷「這一局是不是第一次送」，填錯會讓每筆提交被當成重複而丟掉。
   * MySQL has no `RETURNING`, so this is its only signal for "is this run's first submission"; getting it wrong drops every submission as a duplicate.
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
   * 已在交易中就直接執行，不開巢狀交易 —— 巢狀交易在 MySQL 是**隱式提交**（`begin` 會結束外層）。
   * If already inside a transaction it runs directly without nesting: nested transactions are an **implicit commit** in MySQL (the `begin` ends the outer one).
   */
  transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T>;

  /**
   * 關掉這個 driver（測試與本機工具用）。
   * Closes this driver (used by tests and local tooling).
   */
  close(): Promise<void>;
}
