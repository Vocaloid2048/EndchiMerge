/**
 * 資料庫的組裝點：方言 → 驅動 → 儲存層；唯一知道有哪些方言的地方。
 * The database's assembly point: dialect → driver → store; the only place that knows which
 * dialects exist.
 */

import type { Config } from '../env.js';
import { SqlStore } from '../sqlStore.js';
import type { Store } from '../store.js';
import type { Dialect, DialectName } from './dialect.js';
import { connectionNotes as mysqlNotes, createMysqlDriver, mysqlDialect } from './mysql.js';
import { connectionNotes as postgresNotes, createPostgresDriver, postgresDialect } from './postgres.js';
import { connectionNotes as sqliteNotes, createSqliteDriver, sqliteDialect } from './sqlite.js';
import type { Driver } from './types.js';

/**
 * 方言表用 `Record<DialectName, …>` 而非 `Partial`：新增一個 `DialectName` 而沒填就一定編不過。
 * A `Record<DialectName, …>` rather than a `Partial`: adding a `DialectName` without filling it in
 * is a compile error.
 */
const DIALECTS: Readonly<Record<DialectName, Dialect>> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
  sqlite: sqliteDialect,
};

export function dialectFor(name: DialectName): Dialect {
  return DIALECTS[name];
}

/**
 * 依方言建立驅動；用 `switch` 而非三元串，少一個分支會被 `never` 那行擋下。
 * Builds the driver for a dialect; a `switch` rather than a chain of ternaries, so a missing branch
 * is caught by the `never` line.
 */
export function createDriver(name: DialectName, url: string): Driver {
  switch (name) {
    case 'mysql':
      return createMysqlDriver(url);
    case 'sqlite':
      return createSqliteDriver(url);
    case 'postgres':
      return createPostgresDriver(url);
    default: {
      const unhandled: never = name;
      throw new Error(`unhandled dialect: ${String(unhandled)}`);
    }
  }
}

/**
 * 對這組連線設定要提醒的事；不是錯誤，沒有一條該讓後端起不來。
 * What is worth warning about for this connection setting; not errors — none of them should stop
 * the backend from starting.
 */
export function connectionNotesFor(name: DialectName, url: string): readonly string[] {
  switch (name) {
    case 'mysql':
      return mysqlNotes(url);
    case 'sqlite':
      return sqliteNotes(url);
    case 'postgres':
      return postgresNotes(url);
    default: {
      const unhandled: never = name;
      throw new Error(`unhandled dialect: ${String(unhandled)}`);
    }
  }
}

/**
 * 依設定建立儲存層。
 * Builds the store from the configuration.
 */
export function createStore(config: Config): { store: Store; driver: Driver; dialect: Dialect } {
  const dialect = dialectFor(config.dbDialect);
  const driver = createDriver(config.dbDialect, config.databaseUrl);

  return { store: new SqlStore(driver, dialect), driver, dialect };
}

/**
 * 建表（可重複執行）：`create … if not exists` 加上清除舊欄位的冪等 drop，可當部署遷移與本機開發的第一步。
 * Creates the tables, safe to run repeatedly: `create … if not exists` plus idempotent drops of legacy columns.
 *
 * 每個方言的 drop 靠原生 `if exists` 或 `isMissingColumnError`、加欄位靠原生 `if not exists` 或
 * `isDuplicateColumnError`（見 `Dialect`）；回填靠自己的 `where`；其餘錯誤一律照丟。
 * A dialect's drops rely on a native `if exists` or on `isMissingColumnError`, adds on a native
 * `if not exists` or `isDuplicateColumnError`, backfills on their own `where`; any other error is rethrown.
 *
 * @returns 實際執行成功的語句數（跳過的不計）。
 *   The number of statements that actually ran (skips do not count).
 */
export async function ensureSchema(driver: Driver, dialect: Dialect): Promise<number> {
  const statements = dialect.schema();
  let applied = 0;

  for (const statement of statements) {
    try {
      await driver.query(statement);
      applied += 1;
    } catch (error) {
      const alreadyDone =
        dialect.isMissingColumnError?.(error) === true || dialect.isDuplicateColumnError?.(error) === true;
      if (!alreadyDone) throw error;
    }
  }

  return applied;
}

export type { Dialect, DialectName, Driver };
