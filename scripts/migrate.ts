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
 * 它同時是 **Vercel 建置的一部分**（`vercel.json` 的 `buildCommand`）。這一件事讓「部署成功」與
 * 「schema 就緒」變成同一句話：遷移失敗就**部署失敗**，不會有一個沒有表的版本開始收流量。手動指令
 * 留給本機、其他平台，以及「不想等下一次部署」的時候。
 * It is also **part of the Vercel build** (the `buildCommand` in `vercel.json`), which makes "the deploy
 * succeeded" and "the schema is ready" the same statement: a failed migration **fails the deploy**
 * instead of letting a schema-less version take traffic. The manual command stays for local use, other
 * platforms, and "I do not want to wait for the next deploy".
 *
 * **兩個方言共用同一份 schema 定義**（`api/_lib/db/postgres.ts` 與 `mysql.ts` 的 `schema()`），所以
 * 這支腳本不需要、也不會有一份自己的 SQL —— 少一份要同步維護的東西，就少一次「部署時才發現兩邊
 * 不一致」。
 * **Both dialects share the same schema definitions** (the `schema()` in `api/_lib/db/postgres.ts` and
 * `mysql.ts`), so this script neither needs nor has SQL of its own — one fewer thing to keep in sync
 * and one fewer "found the two disagreeing at deploy time".
 *
 * 每個方言的建表語句都只用 `create table if not exists`，所以**可以重複執行**；這也是它可以放進建置
 * 流程的原因（每次部署都跑，包括預覽部署各自對自己的 Neon branch）。
 * Every dialect's DDL uses only `create table if not exists`, so it is **safe to run repeatedly** —
 * which is what lets it live in the build (every deploy runs it, preview deploys included, each against
 * its own Neon branch).
 *
 * ⚠️ 它只管「建表」。真正的 schema 變更（加欄位、回填、加索引）`create table if not exists` 幫不上
 * 忙，那時要在各 `dialect.schema()` 補上冪等的 `alter table … if not exists`，或引進遷移工具 ——
 * 規矩寫在 `docs/backend.md` §6。
 * ⚠️ It only creates tables. A real schema change (a new column, a backfill, an index) is beyond
 * `create table if not exists`; add an idempotent `alter table … if not exists` to each
 * `dialect.schema()`, or bring in a migration tool — the rule is in `docs/backend.md` §6.
 */

import { connectionNotesFor, createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import {
  describeConnectionTarget,
  dialectFromUrl,
  isConnectionError,
  type DialectName,
} from '../api/_lib/db/dialect';

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
   * 連線字串的建議（池化、SSL）在遷移時同樣值得看 —— 尤其是「沒有 TLS」這一條：遷移會傳密碼，
   * 而遷移常常是開發者在公共網路上做的第一件事。
   * The connection-string advice (pooling, SSL) matters here too — especially the "no TLS" one: a
   * migration sends the password, and a migration is often the first thing a developer runs over a
   * public network.
   */
  for (const note of connectionNotesFor(name, url)) {
    console.warn(`warning: ${note}`);
  }

  /*
   * 把**目標**印出來。這一行有一個很具體的用途：讓部署日誌自己回答「剛剛遷移的是哪一個資料庫」。
   * Vercel 的 Neon 整合每個環境各開一個 branch，所以「跑過了」與「正式環境還是空的」可以同時成立 ——
   * 而這一行的存在就是為了讓那件事不必用猜的。
   * Print the **target**. This line has one concrete job: letting a deploy log answer "which database did
   * that migration just touch". Vercel's Neon integration opens a branch per environment, so "it ran"
   * and "production is still empty" can both be true — and this line exists so that is not a guess.
   */
  console.log(`applying the ${name} schema to ${describeConnectionTarget(url)}…`);

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
