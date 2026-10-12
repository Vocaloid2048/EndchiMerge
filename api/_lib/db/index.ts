/**
 * 資料庫的組裝點：**方言 → 驅動 → 儲存層**。
 * The database's assembly point: **dialect → driver → store**.
 *
 * 這一支是唯一知道「有哪些方言」的地方。要再接第三個（例如 MSSQL，或某個廠商自己的驅動）只需要在
 * 這裡多一個分支，`sqlStore.ts` 與端點都不用動。
 * This is the only place that knows **which dialects exist**. Adding a third (MSSQL, or a vendor's own
 * driver) is one more branch here; neither `sqlStore.ts` nor the endpoints change.
 */

import type { Config } from '../env';
import { SqlStore } from '../sqlStore';
import type { Store } from '../store';
import type { Dialect, DialectName } from './dialect';
import { connectionNotes as mysqlNotes, createMysqlDriver, mysqlDialect } from './mysql';
import { connectionNotes as postgresNotes, createPostgresDriver, postgresDialect } from './postgres';
import type { Driver } from './types';

const DIALECTS: Readonly<Record<DialectName, Dialect>> = {
  postgres: postgresDialect,
  mysql: mysqlDialect,
};

export function dialectFor(name: DialectName): Dialect {
  return DIALECTS[name];
}

export function createDriver(name: DialectName, url: string): Driver {
  return name === 'mysql' ? createMysqlDriver(url) : createPostgresDriver(url);
}

/**
 * 對這組連線設定要提醒的事。**不是錯誤** —— 沒有任何一條該讓後端起不來（見 `postgres.ts` 的說明）。
 * What is worth warning about for this connection setting. **Not errors** — none of them should stop
 * the backend from starting (see the note in `postgres.ts`).
 */
export function connectionNotesFor(name: DialectName, url: string): readonly string[] {
  return name === 'mysql' ? mysqlNotes(url) : postgresNotes(url);
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
