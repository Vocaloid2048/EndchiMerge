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
 * 建表（可重複執行）：每個方言的 `schema()` 只用 `create table if not exists`，可當部署遷移也可當本機開發的第一步。
 * Creates the tables, safe to run repeatedly: every dialect's `schema()` uses only
 * `create table if not exists`, so it serves as both the deploy migration and the local-dev first step.
 *
 * @returns 執行了幾條語句。
 *   The number of statements run.
 */
export async function ensureSchema(driver: Driver, dialect: Dialect): Promise<number> {
  const statements = dialect.schema();

  for (const statement of statements) {
    await driver.query(statement);
  }

  return statements.length;
}

export type { Dialect, DialectName, Driver };
