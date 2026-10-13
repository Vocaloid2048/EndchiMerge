#!/usr/bin/env node
/**
 * 建表（＝這個專案的「遷移」）：讀 `DATABASE_URL`，跑各 `dialect.schema()` 的冪等 DDL。
 * Creates the tables (this project's "migration") from each `dialect.schema()`.
 */

import { connectionNotesFor, createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import {
  describeConnectionTarget,
  dialectFromUrl,
  isConnectionError,
  type DialectName,
} from '../api/_lib/db/dialect';

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
    console.error('DATABASE_URL is not set, and there is nothing to migrate without it.');
    console.error('  locally:   put it in .env, or pass it: DATABASE_URL=… npm run db:migrate');
    console.error('  on Vercel: Project → Settings → Environment Variables. The value has to be');
    console.error('             available at build time too, not only at runtime.');
    process.exitCode = 1;
    return;
  }

  const name = readDialect(url);
  const dialect = dialectFor(name);

  /*
   * 連線字串的建議（池化、SSL）在遷移時同樣值得看：遷移會送密碼，而且常常是開發者在公共網路上
   * 跑的第一件事。
   * The connection-string advice (pooling, SSL) matters here too: a migration sends the password and
   * is often the first thing a developer runs over a public network.
   */
  for (const note of connectionNotesFor(name, url)) {
    console.warn(`warning: ${note}`);
  }

  /*
   * 把目標印出來，讓部署日誌自己回答「剛剛遷移的是哪一個資料庫」：Vercel 的 Neon 整合每個環境各開
   * 一個 branch，所以「跑過了」與「正式環境還是空的」可以同時成立。
   * Print the target so a deploy log answers "which database did that migration just touch": Vercel's
   * Neon integration opens a branch per environment, so "it ran" and "production is still empty" can
   * both be true.
   */
  console.log(`applying the ${name} schema to ${describeConnectionTarget(url)}…`);

  const driver = createDriver(name, url);

  try {
    const count = await ensureSchema(driver, dialect);
    console.log(`ok: ${count} statements applied, schema is up to date`);
  } catch (error) {
    /*
     * 「連不上」與「SQL 有問題」分開講：原始堆疊對前者沒有幫助，對後者才是重點。
     * "Cannot connect" and "the SQL is broken" are told apart: the raw stack is useless for the
     * first and is the whole point for the second.
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
    /* The pool must be closed, or Node will not exit with connections still open. */
    await driver.close();
  }
}

await main();
