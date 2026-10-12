#!/usr/bin/env node
/**
 * 建表（＝這個專案的「遷移」）。
 * Create the tables (this project's "migration").
 *
 * 用法 / Usage:
 *   npm run db:migrate                          # 讀 .env 的 DATABASE_URL
 *   DATABASE_URL='mysql://…' npm run db:migrate  # 直接指定
 *   npm run db:migrate -- --dialect mysql        # 覆寫方言（連線字串猜不出來時）
 *
 * **兩個方言共用同一份 schema 定義**（`api/_lib/db/postgres.ts` 與 `mysql.ts` 的 `schema()`），所以
 * 這支腳本不需要、也不會有一份自己的 SQL —— 少一份要同步維護的東西，就少一次「部署時才發現兩邊
 * 不一致」。
 * **Both dialects share the same schema definitions** (the `schema()` in `api/_lib/db/postgres.ts` and
 * `mysql.ts`), so this script neither needs nor has SQL of its own — one fewer thing to keep in sync
 * and one fewer "found the two disagreeing at deploy time".
 *
 * 每個方言的建表語句都只用 `create table if not exists`，所以**可以重複執行**；這也是它可以安全地
 * 放進部署流程的原因。
 * Every dialect's DDL uses only `create table if not exists`, so it is **safe to run repeatedly** —
 * which is what makes it safe to put in a deploy pipeline.
 */

import { connectionNotesFor, createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { dialectFromUrl, isConnectionError, type DialectName } from '../api/_lib/db/dialect';

/** 從 `--flag value` 兩種寫法取值。 */
function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;

  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

function readDialect(url: string): DialectName {
  const raw = (argValue('--dialect') ?? process.env['DB_DIALECT'] ?? '').trim().toLowerCase();

  if (raw === 'mysql' || raw === 'mariadb') return 'mysql';
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') return 'postgres';

  return dialectFromUrl(url);
}

async function main(): Promise<void> {
  const url = (argValue('--url') ?? process.env['DATABASE_URL'] ?? '').trim();

  if (url === '') {
    console.error(
      'DATABASE_URL is not set. Put it in .env, or pass it: DATABASE_URL=… npm run db:migrate',
    );
    process.exitCode = 1;
    return;
  }

  const name = readDialect(url);
  const dialect = dialectFor(name);

  /*
   * 連線字串的建議（池化、SSL）在遷移時同樣值得看 —— 尤其是「沒有 TLS」這一條：遷移會傳密碼，
   * 而遷移常常是開發者在公共網路上做的第一件事。
   * The connection-string advice (pooling, SSL) matters here too — especially the "no TLS" one: a
   * migration sends the password, and a migration is often the first thing a developer runs over a
   * public network.
   */
  for (const note of connectionNotesFor(name, url)) {
    console.warn(`warning: ${note}`);
  }

  console.log(`applying the ${name} schema…`);

  const driver = createDriver(name, url);

  try {
    const count = await ensureSchema(driver, dialect);
    console.log(`ok: ${count} statements applied, schema is up to date`);
  } catch (error) {
    /*
     * 「連不上」與「SQL 有問題」要分開講。原始堆疊對前者毫無幫助（開發者已經知道要檢查連線字串），
     * 而對後者它才是重點 —— 所以後者原樣丟出去。
     * "Cannot connect" and "the SQL is broken" are told apart. The raw stack is useless for the first
     * (the developer already knows to check the connection string) and is the whole point for the
     * second — so the second is rethrown as-is.
     */
    if (isConnectionError(error)) {
      console.error(`cannot reach the ${name} database. Check DATABASE_URL and that the server is up.`);
      console.error(`  (${error instanceof Error ? error.message : String(error)})`);
      process.exitCode = 1;
      return;
    }

    throw error;
  } finally {
    /* 一定要關池子，否則 Node 會因為還開著連線而不結束。 */
    await driver.close();
  }
}

await main();
