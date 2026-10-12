/**
 * 資料庫的組裝點：**方言 → 驅動 → 儲存層**。
 * The database's assembly point: **dialect → driver → store**.
 *
 * 這一支是唯一知道「有哪些方言」的地方。第三個方言（SQLite，本機開發用）加進來時，改動就只有在這裡 ——
 * `sqlStore.ts`、`handlers.ts` 與端點一行都沒有動，這正是這個 seam 存在的理由。
 * This is the only place that knows **which dialects exist**. When the third dialect (SQLite, for
 * local development) was added, the changes were here and nowhere else: neither `sqlStore.ts` nor
 * `handlers.ts` nor any endpoint changed by a line — which is the whole point of this seam.
 */

import type { Config } from '../env';
import { SqlStore } from '../sqlStore';
import type { Store } from '../store';
import type { Dialect, DialectName } from './dialect';
import { connectionNotes as mysqlNotes, createMysqlDriver, mysqlDialect } from './mysql';
import { connectionNotes as postgresNotes, createPostgresDriver, postgresDialect } from './postgres';
import { connectionNotes as sqliteNotes, createSqliteDriver, sqliteDialect } from './sqlite';
import type { Driver } from './types';

/**
 * 方言表。`Record<DialectName, …>` 而不是 `Partial`，所以**新增一個 `DialectName` 就一定編不過**——
 * 少了這一條，一個打錯的方言名會一路走到「拿 Postgres 的驅動去餵 MySQL 的 SQL」才爆。
 * A `Record<DialectName, …>` rather than a `Partial`, so **adding a `DialectName` is a compile error
 * until it is filled in**: without it, a mistyped dialect name would survive all the way to "a Postgres
 * driver fed MySQL SQL" before failing.
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
 * 依方言建立驅動。
 * Build the driver for a dialect.
 *
 * 用 `switch` 而不是三元串：`DialectName` 是聯合型別，所以少寫一個分支會被 `never` 那一行擋下來。
 * A `switch` rather than a chain of ternaries: `DialectName` is a union, so a missing branch is caught
 * by the `never` line.
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
 * 對這組連線設定要提醒的事。**不是錯誤** —— 沒有任何一條該讓後端起不來（見 `postgres.ts` 的說明）。
 * What is worth warning about for this connection setting. **Not errors** — none of them should stop
 * the backend from starting (see the note in `postgres.ts`).
 *
 * SQLite 也有一條，而且是最重要的一條：它是**開發用**的，檔案系統在函式環境裡是拋棄式的。
 * SQLite has a note too, and it is the most important one of the three: it is for **development**, and
 * a function's filesystem is ephemeral.
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

/** 依設定建立儲存層。 */
export function createStore(config: Config): { store: Store; driver: Driver; dialect: Dialect } {
  const dialect = dialectFor(config.dbDialect);
  const driver = createDriver(config.dbDialect, config.databaseUrl);

  return { store: new SqlStore(driver, dialect), driver, dialect };
}

/**
 * 建表（可重複執行）。
 * Create the tables (safe to run repeatedly).
 *
 * 每個方言的 `schema()` 都只用 `create table if not exists`，所以這支可以每次啟動都跑 —— 這正是它能
 * 同時當「部署時的一次性遷移」與「本機開發的第一步」的原因。
 * Every dialect's `schema()` uses only `create table if not exists`, so this can run on every boot —
 * which is exactly why it doubles as both the one-off deploy migration and the first step of local
 * development.
 *
 * @returns 執行了幾條語句。
 */
export async function ensureSchema(driver: Driver, dialect: Dialect): Promise<number> {
  const statements = dialect.schema();

  for (const statement of statements) {
    await driver.query(statement);
  }

  return statements.length;
}

export type { Dialect, DialectName, Driver };
