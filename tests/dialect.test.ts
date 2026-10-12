/**
 * 方言的測試。
 * Tests for the dialects.
 *
 * 這個檔案裡最重要的兩條是**不需要資料庫**就能跑的：
 *   1. **建表語句必須可重複執行** —— 因為 `ensureSchema` 就是靠這一點才能同時當「部署遷移」與
 *      「本機第一步」。少了 `if not exists`，第二次執行就會炸，而那是很容易漏掉的。
 *   2. **MySQL 的 `best_score` 必須排在 `best_duration_ms` 之後** —— 這是那條「時長跟著分數走」的
 *      規則在 MySQL 上**唯一**會靜靜失靈的地方（見 `Dialect.upsertProfile`）。
 * The two most important tests here need no database:
 *   1. **The DDL must be repeatable** — that is what lets `ensureSchema` double as the deploy migration
 *      and the first step of local setup. Without `if not exists` the second run explodes, and that is
 *      an easy thing to miss.
 *   2. **In MySQL `best_score` must come after `best_duration_ms`** — the one place where the
 *      "duration follows the score" rule silently breaks on MySQL (see `Dialect.upsertProfile`).
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  Binder,
  BOARD_ORDER_KEYS,
  dialectFromUrl,
  isConnectionError,
  type Dialect,
} from '../api/_lib/db/dialect';
import { mysqlDialect } from '../api/_lib/db/mysql';
import { postgresDialect } from '../api/_lib/db/postgres';

const DIALECTS: readonly Dialect[] = [postgresDialect, mysqlDialect];

/** 這個方言的語句用了幾個參數位置。 */
function placeholderCount(sql: string, dialect: Dialect): number {
  if (dialect.name === 'mysql') return (sql.match(/\?/gu) ?? []).length;

  const numbers = [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));

  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

/* ── 佔位符與參數 ─────────────────────────────────────────────────────────── */

describe('Binder — 佔位符與參數要對得上 / placeholders and params must line up', () => {
  /*
   * 這是兩個方言能共用同一份 SQL 的機制（見 `Binder` 的說明）。斷言很單純：**綁了幾個值，語句裡就要
   * 有幾個佔位符位置**。Postgres 是 `max($n)`，MySQL 是 `?` 的出現次數。
   * This is the mechanism that lets both dialects share one SQL string (see `Binder`). The assertion is
   * simple: **as many placeholder positions as values bound**. For Postgres that is `max($n)`, for
   * MySQL the number of `?`.
   */
  it('assigns one position per bound value', () => {
    for (const dialect of DIALECTS) {
      const b = new Binder(dialect);
      const placeholders = [b.bind('a'), b.bind(1), b.bind(null)];

      const sql = `select * from t where x = ${placeholders[0]} and y = ${placeholders[1]} and z = ${placeholders[2]}`;

      expect(b.params).toHaveLength(3);
      expect(placeholderCount(sql, dialect)).toBe(3);
    }
  });

  /*
   * 同一份 SQL 文字，重複引用同一個佔位符：Postgres 只傳一份值，MySQL 要傳三份。這條把那個差異
   * **明確地測出來**，因為它是「照抄 Postgres 的寫法搬到 MySQL」時最容易漏掉的坑。
   * The same SQL text referencing one placeholder repeatedly: Postgres sends one value, MySQL needs
   * three. This pins that difference down, because it is the easiest trap to fall into when copying a
   * Postgres statement over to MySQL.
   */
  it('needs one value per occurrence on MySQL, but reuses on Postgres', () => {
    const postgres = new Binder(postgresDialect);
    const shared = postgres.bind(7);
    const postgresSql = `select * from t where a = ${shared} or b = ${shared}`;

    expect(postgres.params).toHaveLength(1);
    expect(placeholderCount(postgresSql, postgresDialect)).toBe(1);

    const mysql = new Binder(mysqlDialect);
    const first = mysql.bind(7);
    const second = mysql.bind(7);
    const mysqlSql = `select * from t where a = ${first} or b = ${second}`;

    expect(mysql.params).toHaveLength(2);
    expect(placeholderCount(mysqlSql, mysqlDialect)).toBe(2);
  });

  it('binds time and json through the dialect, not as plain values', () => {
    const postgres = new Binder(postgresDialect);
    const tsSql = postgres.bindTime(1_700_000_000_000);
    const jsonSql = postgres.bindJson('{}');

    /* Postgres 要明確的 cast，否則時間會被當成字串比較、JSON 會被當成一段文字。 */
    expect(tsSql).toBe('$1::timestamptz');
    expect(jsonSql).toBe('$2::jsonb');
    expect(postgres.params).toHaveLength(2);

    const mysql = new Binder(mysqlDialect);
    expect(mysql.bindTime(1_700_000_000_000)).toBe('?');
    expect(mysql.bindJson('{}')).toBe('?');
    expect(mysql.params).toHaveLength(2);
  });

  /* 值的**型別**也換掉了：Postgres 收 ISO 字串，MySQL 收 `Date`（見 `Dialect.ts`）。 */
  it('converts the time value itself, not just the placeholder', () => {
    expect(postgresDialect.ts(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(mysqlDialect.ts(0)).toBeInstanceOf(Date);
    expect((mysqlDialect.ts(0) as Date).toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });
});

/* ── 榜的排序 / The board order ────────────────────────────────────────────── */

describe('board order — 三個鍵的語意要一致 / the three keys mean the same thing', () => {
  /*
   * 兩邊都必須是「分數降冪 → 同分較早優先 → id 收尾」。只差 `nulls last` 的寫法：MySQL 沒有這個
   * 關鍵字，要用 `best_at is null` 當第一個排序鍵才等價。
   * Both must be "score descending → earlier first → id last", and they differ only in nulls-last
   * spelling: MySQL has no such keyword and needs `best_at is null` as a preceding sort key.
   */
  it('orders by score, then time, then id on both dialects', () => {
    for (const dialect of DIALECTS) {
      const order = dialect.boardOrder();

      expect(order).toContain('best_score desc');
      expect(order).toContain('best_at');
      expect(order).toContain('device_id asc');
    }

    expect(postgresDialect.boardOrder()).toContain('nulls last');
    expect(mysqlDialect.boardOrder()).toContain('best_at is null');
    expect(mysqlDialect.boardOrder()).not.toContain('nulls last');
  });

  /* `BOARD_ORDER_KEYS` 是給人看的那份「語意」，不該被某一邊的語法汙染。 */
  it('keeps the shared key list free of dialect syntax', () => {
    expect(BOARD_ORDER_KEYS).toBe('best_score desc, best_at asc, device_id asc');
    expect(BOARD_ORDER_KEYS).not.toContain('nulls');
  });
});

/* ── 寫入語句 / The writes ─────────────────────────────────────────────────── */

describe('writes — 形狀差異 / shape differences', () => {
  it('uses on conflict on Postgres and on duplicate key on MySQL', () => {
    expect(postgresDialect.insertRunToken()).toContain('on conflict (run_id) do nothing');
    expect(mysqlDialect.insertRunToken()).toContain('on duplicate key update run_id = run_id');
  });

  /*
   * ⚠️ `insert ignore` 是錯的：它會把**所有**錯誤吞成警告，不只是重複鍵 —— 外鍵違反、型別錯誤都會
   * 靜靜地變成「什麼都沒發生」，於是壞資料進不來而我們也不會知道。
   * ⚠️ `insert ignore` would be wrong: it swallows **every** error as a warning, not just duplicate
   * keys — foreign-key violations and type errors all quietly become "nothing happened", so bad data
   * never arrives and we never hear about it.
   */
  it('never uses insert ignore on MySQL', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.insertScore().toLowerCase()).not.toContain('insert ignore');
    }
  });

  it('reports the insert via returning on Postgres and affected rows on MySQL', () => {
    expect(postgresDialect.insertScore()).toContain('returning run_id');
    expect(postgresDialect.insertScoreSignal).toBe('rows');

    expect(mysqlDialect.insertScore()).not.toContain('returning');
    expect(mysqlDialect.insertScoreSignal).toBe('affected');
  });

  /*
   * 這一條就是檔頭講的「唯一會靜靜失靈的地方」。
   *
   * MySQL 的 `on duplicate key update` 是**由左至右**求值的，所以拿 `best_score` 來比較的欄位必須
   * 排在 `best_score` 自己的賦值**之前**。順序反過來的話 `values(best_score) > best_score` 會變成
   * 「新 > 新」，永遠是 false，時長就永遠不會跟著分數更新 —— 而且不會報任何錯。
   * This is the "one place it silently breaks" from the file header.
   *
   * MySQL evaluates `on duplicate key update` **left to right**, so the columns that compare against
   * `best_score` must come **before** the assignment to `best_score` itself. Reversed,
   * `values(best_score) > best_score` becomes "new > new" — always false — and the duration never
   * follows the score, with no error to show for it.
   */
  it('puts best_score after the columns that compare against it (MySQL)', () => {
    const sql = mysqlDialect.upsertProfile();

    const durationAt = sql.indexOf('best_duration_ms =');
    const bestAtAt = sql.indexOf('best_at =');
    const scoreAt = sql.indexOf('best_score = greatest');

    expect(durationAt).toBeGreaterThan(-1);
    expect(bestAtAt).toBeGreaterThan(-1);
    expect(scoreAt).toBeGreaterThan(-1);

    expect(scoreAt).toBeGreaterThan(durationAt);
    expect(scoreAt).toBeGreaterThan(bestAtAt);
  });

  /* Postgres 不受順序影響（`excluded` 永遠是新的一列），但兩個方言都必須有那三個條件分支。 */
  it('guards the duration behind the score on both dialects', () => {
    for (const dialect of DIALECTS) {
      const sql = dialect.upsertProfile();

      expect(sql).toContain('best_duration_ms');
      expect(sql).toContain('best_at');
      /* 兩個最小值都用「取歷史最大」，不靠客戶端宣稱。 */
      expect(sql.toLowerCase()).toContain('greatest');
    }
  });
});

/* ── 建表 / The schema ─────────────────────────────────────────────────────── */

describe('schema — 必須可重複執行 / it must be repeatable', () => {
  /*
   * 沒有 `if not exists` 的話，第二次執行（或本機先跑過一次再部署）就會炸在建表上。`ensureSchema`
   * 的整個設計就建立在這一條上面，所以它是這份檔案裡最重要的一條。
   * Without `if not exists` the second run (or a local run before a deploy) explodes on the CREATE.
   * `ensureSchema`'s whole design rests on this, which makes it the most important test in the file.
   */
  it('uses only create … if not exists on both dialects', () => {
    for (const dialect of DIALECTS) {
      const statements = dialect.schema();

      expect(statements.length).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.toLowerCase().replace(/\s+/gu, ' ')).toContain('if not exists');
      }
    }
  });

  /* 兩個方言要建出**同一組表** —— 少一張就是某個端點在其中一邊會 500。 */
  it('creates the same set of tables on both dialects', () => {
    const tablesOf = (dialect: Dialect): string[] =>
      dialect
        .schema()
        .flatMap((statement) => [...statement.matchAll(/create table if not exists\s+[`"]?(\w+)/giu)])
        .map((match) => match[1] ?? '')
        .sort();

    expect(tablesOf(postgresDialect)).toEqual(['profiles', 'requests', 'run_tokens', 'scores']);
    expect(tablesOf(mysqlDialect)).toEqual(tablesOf(postgresDialect));
  });

  /*
   * MySQL 的建表語句把索引寫在**表內**（MySQL 的 `CREATE INDEX` 沒有 `IF NOT EXISTS`，分開寫就無法
   * 重複執行），所以那一邊的索引不會出現在 `create index` 形式的語句裡。
   * MySQL puts indexes **inside** the table (its `CREATE INDEX` has no `IF NOT EXISTS`, so separate
   * statements could not be re-run), so that side's indexes never appear as `create index` statements.
   */
  it('declares the board index on both dialects', () => {
    expect(postgresDialect.schema().join('\n')).toContain('profiles_best_score_idx');
    expect(mysqlDialect.schema().join('\n')).toContain('profiles_best_score_idx');
  });
});

/* ── schema.sql 與程式的一致性 / schema.sql versus the code ────────────────── */

describe('schema.sql — 人看的那一份要和程式一致 / the human-readable copy must match', () => {
  /** 去掉註解、把空白折成一個、轉小寫 —— 只比**語意**，不比排版。 */
  function normalise(sql: string): string {
    return sql
      .replace(/--[^\n]*/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * **先去掉註解，再切 `;`** —— 順序不能顛倒。
   * Strip comments **before** splitting on `;` — the order is not interchangeable.
   *
   * `schema.sql` 的檔頭有一句散文含分號（`… is a cache; every number …`）。先切再清註解的話，
   * 那個分號會把一句話腰斬，而後半段已經沒有行首的 `-- ` 了，於是清不掉、被黏到下一條
   * `create table` 前面，害它認不出來（實際上就少了一條建表語句）。
   * The file's header has prose containing a semicolon (`… is a cache; every number …`). Split first
   * and that semicolon bisects a sentence; the tail no longer has a leading `-- `, so it survives
   * comment-stripping, glues itself onto the next statement and hides it (a whole `create table`
   * quietly disappears). A `;` inside a comment is not a separator.
   */
  function statements(sql: string): string[] {
    return normalise(sql)
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('create'));
  }

  /*
   * `schema.sql` 是給人看的（可以直接 `psql -f`），而真正的來源是 `postgres.ts` 的 `schema()`。
   * 兩份會漂移，而漂移的後果是「照著 .sql 建的庫少一個欄位」，那會在第一次寫入時才炸。
   *
   * 所以與其靠註解提醒，這裡直接把檔案讀回來比對 —— 同一個專案裡比對 `limits.ts` 與
   * `levels.json` 的那一條用的是同一個手法。
   * `schema.sql` is the human-readable copy (directly `psql -f`-able) while `postgres.ts`'s
   * `schema()` is the source of truth. The two drift, and drift means "a database built from the .sql
   * is missing a column", which only explodes on the first write.
   *
   * So rather than trusting a comment, this reads the file back and compares — the same trick the
   * project already uses to pin `limits.ts` against `levels.json`.
   */
  it('matches postgresDialect.schema() statement for statement', () => {
    const fromFile = statements(
      readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'),
    );
    const fromCode = postgresDialect.schema().map(normalise);

    expect(fromFile).toEqual(fromCode);
  });

  /* 檔案裡也要有那四張表，否則上面那條可能只是「兩邊都空」。 */
  it('actually contains the four tables', () => {
    const text = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

    for (const table of ['profiles', 'scores', 'run_tokens', 'requests']) {
      expect(text).toContain(`create table if not exists ${table}`);
    }
  });
});

/* ── 讀值 / Reading values back ────────────────────────────────────────────── */

describe('reads — 驅動回來的值 / values coming back from the driver', () => {
  it('turns a time into milliseconds, or null', () => {
    /* Postgres 的 `extract(epoch …)::bigint` 回來是**字串**（pg 對 int8 的處理）。 */
    expect(postgresDialect.readTime('1700000000000')).toBe(1_700_000_000_000);
    expect(postgresDialect.readTime(null)).toBeNull();

    /* MySQL 回來是 `Date`（`timezone: 'Z'`，見 `mysql.ts`）。 */
    expect(mysqlDialect.readTime(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(mysqlDialect.readTime(null)).toBeNull();
  });

  it('reads a MySQL datetime string as UTC, not as local time', () => {
    /* 少了補上的 `Z`，同一個值在 UTC+8 的機器上會被解讀成早八小時。 */
    expect(mysqlDialect.readTime('2023-11-14 22:13:20.000')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));

    /* 已經帶了時區的就不要動它。 */
    expect(mysqlDialect.readTime('2023-11-14T22:13:20.000Z')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
  });

  /*
   * 布林：Postgres 回真的 `true`／`false`，MySQL 回 `tinyint(1)` 的 1／0。混用的話 `verified` 會變成
   * 「1 是真、0 也是真」（因為 `0` 是 truthy 的字串），於是未通過的提交也會進榜。
   * Booleans: Postgres returns real `true` / `false`, MySQL returns `tinyint(1)`'s 1 / 0. Mixed up,
   * `verified` becomes "1 is true and so is 0" (since the string `'0'` is truthy) and rejected
   * submissions would land on the board.
   */
  it('reads a boolean from either representation', () => {
    expect(postgresDialect.readBool(true)).toBe(true);
    expect(postgresDialect.readBool(false)).toBe(false);

    expect(mysqlDialect.readBool(1)).toBe(true);
    expect(mysqlDialect.readBool(0)).toBe(false);
    expect(mysqlDialect.readBool('0')).toBe(false);
    expect(mysqlDialect.readBool(false)).toBe(false);
  });

  it('coerces counts to numbers on both dialects', () => {
    expect(postgresDialect.readNumber('42')).toBe(42);
    expect(mysqlDialect.readNumber(42)).toBe(42);
    expect(postgresDialect.readNumber(undefined)).toBe(0);

    /* Postgres 的 count 要 `::int` 才會是數字而不是字串。 */
    expect(postgresDialect.countInt('count(*)')).toBe('count(*)::int');
    expect(mysqlDialect.countInt('count(*)')).toBe('count(*)');
  });
});

/* ── 從連線字串推斷方言 / Inferring the dialect ────────────────────────────── */

describe('dialectFromUrl — 猜方言 / guessing the flavour', () => {
  it('reads the scheme', () => {
    expect(dialectFromUrl('postgresql://user:pass@host/db')).toBe('postgres');
    expect(dialectFromUrl('postgres://user:pass@host/db')).toBe('postgres');
    expect(dialectFromUrl('mysql://user:pass@host:3306/db')).toBe('mysql');
    expect(dialectFromUrl('mariadb://user:pass@host/db')).toBe('mysql');
  });

  /*
   * 認不出來時回 Postgres 是刻意的保守選擇：那是目前正式部署用的方言，而猜錯的代價在文件裡講明了。
   * Returning Postgres for anything unrecognised is the deliberately conservative choice: it is the
   * dialect the current deployment uses, and the cost of guessing wrong is documented.
   */
  it('defaults to postgres when the scheme is unfamiliar', () => {
    expect(dialectFromUrl('sqlite:///tmp/x.db')).toBe('postgres');
    expect(dialectFromUrl('')).toBe('postgres');
  });

  /* 池化參數不該影響判斷（Neon 的 `-pooler` 主機名帶著查詢字串）。 */
  it('ignores query parameters', () => {
    expect(dialectFromUrl('postgresql://u:p@ep-x-pooler.aws.neon.tech/db?sslmode=require')).toBe('postgres');
  });
});

/* ── 錯誤分類 / Classifying errors ─────────────────────────────────────────── */

describe('isConnectionError — 連不上 vs SQL 寫錯 / unreachable vs bad SQL', () => {
  /*
   * 分開的理由是**處置方式不同**：連不上要重試（503），SQL 寫錯要改程式（500）。把兩者混在一起會讓
   * 前者看起來像後者的 bug。
   * The reason to split them is that the **response differs**: unreachable should be retried (503) and
   * bad SQL needs a code fix (500). Mixing them makes the first look like a bug in the second.
   */
  it('recognises the connection-shaped codes from both drivers', () => {
    expect(isConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectionError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isConnectionError({ code: '08006' })).toBe(true);
    expect(isConnectionError({ code: 'PROTOCOL_CONNECTION_LOST' })).toBe(true);
    /* 密碼錯也是「連不上」，同樣該走 503 而不是 500。 */
    expect(isConnectionError({ code: 'ER_ACCESS_DENIED_ERROR' })).toBe(true);
  });

  it('does not mistake a SQL error for a connection error', () => {
    expect(isConnectionError({ code: '42P01' })).toBe(false);
    expect(isConnectionError({ code: 'ER_BAD_FIELD_ERROR' })).toBe(false);
    expect(isConnectionError({ code: 'ER_NO_SUCH_TABLE' })).toBe(false);
    expect(isConnectionError(new Error('boom'))).toBe(false);
    expect(isConnectionError(null)).toBe(false);
    expect(isConnectionError('ECONNREFUSED')).toBe(false);
  });
});
