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
 *
 * ## 這裡的迴圈都跑**三個**方言 / Every loop here walks **three** dialects
 *
 * `DIALECTS` 是這份檔案的主軸：任何一條「每個方言都該成立」的斷言都應該走它，而不是只挑 Postgres 與
 * MySQL 兩個寫死。SQLite 加進來時，這一招讓它自動被十幾條既有斷言覆蓋 —— 這也是它能短短幾行就接上的
 * 原因。
 * `DIALECTS` is this file's spine: anything that must hold "for every dialect" walks it rather than
 * naming Postgres and MySQL by hand. When SQLite was added, that is what swept it into a dozen existing
 * assertions — and why wiring it took so few lines.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  Binder,
  BOARD_CATEGORIES,
  BOARD_ORDER_KEYS,
  dialectFromUrl,
  isBoardCategory,
  isConnectionError,
  type Dialect,
} from '../api/_lib/db/dialect';
import { mysqlDialect, MYSQL_CLIENT_FLAGS } from '../api/_lib/db/mysql';
import { postgresDialect } from '../api/_lib/db/postgres';
import { sqliteDialect, sqlitePathFromUrl } from '../api/_lib/db/sqlite';

const DIALECTS: readonly Dialect[] = [postgresDialect, mysqlDialect, sqliteDialect];

/**
 * 這個方言的語句用了幾個參數位置。
 * How many parameter positions a statement uses in this dialect.
 *
 * 判斷「哪一種佔位符」看的是 `ph()` 的回應，不是方言的名字 —— 名字是標籤，`ph()` 才是行為，而
 * 這份檔案要驗的正是行為。
 * Which placeholder it is comes from `ph()` rather than the dialect's name: the name is a label and
 * `ph()` is the behaviour, and behaviour is what this file checks.
 */
function placeholderCount(sql: string, dialect: Dialect): number {
  if (dialect.ph(1) === '?') return (sql.match(/\?/gu) ?? []).length;

  const numbers = [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));

  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

/**
 * 「取歷史最大」的那個呼叫。
 * The "take the greater of the two" call.
 *
 * 三個方言寫法不同（SQLite 沒有 `greatest`，用的是 `max` 的兩參數形式），但**形狀必須一樣**：拿
 * 資料庫裡的值跟新值比，而不是相信客戶端宣稱的數字。
 * The three dialects spell it differently (SQLite has no `greatest` and uses the two-argument `max`),
 * but the **shape must match**: compare against the stored value rather than trusting what the client
 * claimed.
 */
function greaterCall(column: string): RegExp {
  return new RegExp(`(?:greatest|max)\\(profiles\\.${column}\\b`, 'iu');
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

    /* SQLite 與 MySQL 同形：`?` 就是 `?`，沒有 cast 這種東西。 */
    const sqlite = new Binder(sqliteDialect);
    expect(sqlite.bindTime(1_700_000_000_000)).toBe('?');
    expect(sqlite.bindJson('{}')).toBe('?');
    expect(sqlite.params).toHaveLength(2);
  });

  /* 值的**型別**也換掉了：Postgres 收 ISO 字串，MySQL 收 `Date`，SQLite 收整數（見 `Dialect.ts`）。 */
  it('converts the time value itself, not just the placeholder', () => {
    expect(postgresDialect.ts(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(mysqlDialect.ts(0)).toBeInstanceOf(Date);
    expect((mysqlDialect.ts(0) as Date).toISOString()).toBe('1970-01-01T00:00:00.000Z');

    /*
     * SQLite 的欄位就是「UTC 毫秒」這個整數，所以 `ts()` 原樣回傳。這一條同時釘住「不會有人手癢把它
     * 改成 `Date`」—— 改了的話 `node:sqlite` 會直接拋錯（它不收 `Date`），開發機上立刻看得到。
     * SQLite's column *is* the UTC-millisecond integer, so `ts()` returns it unchanged. This also pins
     * down "nobody helpfully turns it into a `Date`" — doing so makes `node:sqlite` throw outright (it
     * takes no `Date`), which is visible on the developer's machine immediately.
     */
    expect(sqliteDialect.ts(0)).toBe(0);
    expect(sqliteDialect.ts(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(typeof sqliteDialect.ts(1_700_000_000_000)).toBe('number');
  });
});

/* ── 榜的排序 / The board order ────────────────────────────────────────────── */

describe('board order — 四個鍵的語意要一致 / the four keys mean the same thing', () => {
  /*
   * 三邊都必須是「分數降冪 → 同分較早優先 → id 收尾」。只差 `nulls last` 的寫法：MySQL 沒有這個
   * 關鍵字，要用 `best_at is null` 當第一個排序鍵才等價；Postgres 與 SQLite 都有（SQLite 是 3.30 起，
   * Node 22 內建的是 3.51）。
   * All three must be "score descending → earlier first → id last", differing only in nulls-last
   * spelling: MySQL has no such keyword and needs `best_at is null` as a preceding sort key, while
   * Postgres and SQLite both have it (in SQLite since 3.30; Node 22 bundles 3.51).
   */
  it('orders by score, then time, then id on every dialect', () => {
    for (const dialect of DIALECTS) {
      const order = dialect.boardOrder('score');

      expect(order, dialect.name).toContain('best_score desc');
      expect(order, dialect.name).toContain('best_at');
      expect(order, dialect.name).toContain('device_id asc');
    }

    expect(postgresDialect.boardOrder('score')).toContain('nulls last');
    expect(sqliteDialect.boardOrder('score')).toContain('nulls last');
    expect(mysqlDialect.boardOrder('score')).toContain('best_at is null');
    expect(mysqlDialect.boardOrder('score')).not.toContain('nulls last');
  });

  /*
   * MySQL 不能用 `nulls last`，那就是它**唯一**該出現 `is null` 的地方。SQLite 若哪天被人照抄成
   * MySQL 的寫法，這一條會紅 —— 而那個寫法在 SQLite 上是多餘的（本來就支援 `nulls last`），多出來的
   * 那個鍵還會讓排序變成兩份實作。
   * MySQL cannot use `nulls last`, and that is the **only** place it should show up. If SQLite ever
   * gets copied from MySQL's spelling this fails — it would be redundant there (nulls last is native),
   * and the extra key would make the ordering two implementations instead of one.
   */
  it('spells nulls last natively on Postgres and SQLite, and only simulates it on MySQL', () => {
    for (const dialect of [postgresDialect, sqliteDialect]) {
      expect(dialect.boardOrder('score'), dialect.name).not.toContain('best_at is null');
    }

    expect(mysqlDialect.boardOrder('score')).toContain('best_at is null');
  });

  /*
   * 每個分頁排的是**自己那一欄**。
   * 這是「榜有三個分頁」這件事在 SQL 上的落點：組合數那一頁若不是以 `best_max_combo` 為主鍵，
   * 一個分數不高但連擊很長的玩家就永遠不會出現在那一頁。
   * Each tab ranks on **its own column**. This is where "the board has three tabs" lands in SQL: if the
   * combo page did not lead with `best_max_combo`, a low-scoring player with a long combo would never
   * appear on it.
   */
  it('ranks each category on its own column', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.boardOrder('combo')).toContain('best_max_combo desc');
      expect(dialect.boardOrder('merges')).toContain('best_merges desc');
    }
  });

  /*
   * 分數分類的主鍵就是 `best_score`，不該再把它當第二個鍵寫一次 —— 重複的鍵不是錯，但它會讓
   * 「四個鍵」這個形狀對不上，而 `MemoryStore.compareProfiles` 是照那個形狀寫的。
   * The score board's primary key *is* `best_score`, and it must not be repeated as the second key —
   * a repeated key is not wrong, but it breaks the "four keys" shape that
   * `MemoryStore.compareProfiles` is written against.
   */
  it('does not repeat the primary key on the score board', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.boardOrder('score').match(/best_score/gu), dialect.name).toHaveLength(1);
    }
  });

  /*
   * 三個分類的**決勝鍵必須相同**（時間、然後 id），否則同值時的順序會隨分頁而變，而 `rankOf`
   * 與 `topProfiles` 只有在共用同一組鍵時才會給出一致的名次。
   * The three categories must share the same **tie-breakers** (time, then id), or the order of equal
   * values would change with the tab, and `rankOf` and `topProfiles` only agree when they share keys.
   */
  it('uses the same tie-breakers on every category', () => {
    for (const category of BOARD_CATEGORIES) {
      expect(postgresDialect.boardOrder(category)).toContain('best_at asc nulls last, device_id asc');
      expect(sqliteDialect.boardOrder(category)).toContain('best_at asc nulls last, device_id asc');
      expect(mysqlDialect.boardOrder(category)).toContain('best_at is null, best_at asc, device_id asc');
    }
  });

  /* `BOARD_ORDER_KEYS` 是給人看的那份「語意」，不該被某一邊的語法汙染。 */
  it('keeps the shared key list free of dialect syntax', () => {
    expect(BOARD_ORDER_KEYS).toBe('best_score desc, best_at asc, device_id asc');
    expect(BOARD_ORDER_KEYS).not.toContain('nulls');
  });
});

/* ── 分類參數 / The category argument ──────────────────────────────────────── */

describe('isBoardCategory — 不認識的值要有明確的處置 / an unknown value needs an answer', () => {
  it('accepts the three categories', () => {
    expect(BOARD_CATEGORIES).toHaveLength(3);
    for (const category of BOARD_CATEGORIES) expect(isBoardCategory(category)).toBe(true);
  });

  /*
   * 查詢字串是外部輸入，所以「大小寫不同」、「空字串」、「根本不是字串」都要落在同一邊 ——
   * 它們都會退回分數榜，而不是讓請求失敗。
   * The query string is outside input, so a different case, an empty string and a non-string must all
   * land on the same side: each falls back to the score board rather than failing the request.
   */
  it('rejects anything else', () => {
    for (const value of ['SCORE', 'combo ', 'best', '', null, undefined, 3, {}, ['score']]) {
      expect(isBoardCategory(value), JSON.stringify(value)).toBe(false);
    }
  });
});

/* ── 寫入語句 / The writes ─────────────────────────────────────────────────── */

describe('writes — 形狀差異 / shape differences', () => {
  /*
   * 兩邊都用「衝突就什麼都不做」的冪等插入，但**寫法不同**：Postgres 與 SQLite 是
   * `on conflict … do nothing`（標準 SQL），MySQL 只有 `on duplicate key update`。
   * Both do an idempotent "on conflict, do nothing" insert, but the **spelling differs**: Postgres and
   * SQLite use `on conflict … do nothing` (standard SQL) while MySQL only has `on duplicate key
   * update`.
   */
  it('uses on conflict on Postgres and SQLite, and on duplicate key on MySQL', () => {
    expect(postgresDialect.insertRunToken()).toContain('on conflict (run_id) do nothing');
    expect(sqliteDialect.insertRunToken()).toContain('on conflict (run_id) do nothing');
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

  /*
   * `insertScore` 的佔位符數量要**等於** `sqlStore.insertScore` 綁的參數數量（13 個）。兩邊一旦對不
   * 上，Postgres 會說「參數不足」，而 MySQL 與 SQLite 會把後面的值**錯位**吃進去 —— 後者不會報錯，
   * 只會寫進一組看似合理但完全錯誤的數字。
   * The number of placeholders in `insertScore` must **equal** the number of parameters
   * `sqlStore.insertScore` binds (13). Once the two disagree, Postgres says "not enough parameters"
   * while MySQL and SQLite shift the values along — the latter raises nothing and simply writes a
   * plausible-looking, entirely wrong set of numbers.
   */
  it('takes one placeholder per bound column, including the submission time', () => {
    for (const dialect of DIALECTS) {
      expect(placeholderCount(dialect.insertScore(), dialect), dialect.name).toBe(13);
      /* 時間是第 13 個 —— 靠 DDL 的預設值會讓 `SqlStore` 與 `MemoryStore` 分歧（見 `sqlStore.ts`）。 */
      expect(dialect.insertScore(), dialect.name).toContain('created_at');
    }
  });

  it('reports the insert via returning on Postgres and SQLite, and affected rows on MySQL', () => {
    expect(postgresDialect.insertScore()).toContain('returning run_id');
    expect(postgresDialect.insertScoreSignal).toBe('rows');

    /*
     * SQLite 的 `returning` 是 3.35 起（Node 22 內建 3.51），所以它與 Postgres 走同一條路 —— 不必碰
     * MySQL 那個 `affectedRows` 與 `FOUND_ROWS` 的地雷。
     * SQLite's `returning` arrived in 3.35 (Node 22 bundles 3.51), so it takes Postgres's path and
     * never goes near MySQL's `affectedRows` / `FOUND_ROWS` minefield.
     */
    expect(sqliteDialect.insertScore()).toContain('returning run_id');
    expect(sqliteDialect.insertScoreSignal).toBe('rows');

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

  /*
   * 三個方言都必須有那三個條件分支，而且三個數值都是以「**資料庫裡的值**與新值取大」寫入 —— 不是
   * `values(best_score)` 那種「相信客戶端送來的數字」。
   * All three must carry those three conditional branches, and all three numbers must be written as
   * the **greater of the stored value and the new one** — never as "trust the number the client sent".
   */
  it('guards the duration behind the score, and takes the greater value, on every dialect', () => {
    for (const dialect of DIALECTS) {
      const sql = dialect.upsertProfile();

      expect(sql, dialect.name).toContain('best_duration_ms');
      expect(sql, dialect.name).toContain('best_at');
      expect(sql, dialect.name).toMatch(greaterCall('best_score'));
      expect(sql, dialect.name).toMatch(greaterCall('best_max_combo'));
      expect(sql, dialect.name).toMatch(greaterCall('best_merges'));
    }
  });

  /*
   * SQLite 沒有 `greatest` —— 那在 SQLite 上是一個**語法錯誤**，不是「行為不同」。這一條把它釘住：
   * 上面那條會接受兩種寫法，這條指定誰用哪一種。
   * SQLite has no `greatest` — there it is a **syntax error**, not a behavioural difference. This pins
   * which dialect uses which: the test above accepts either spelling, this one says who gets which.
   */
  it('uses max() on SQLite and greatest() elsewhere', () => {
    expect(sqliteDialect.upsertProfile()).toMatch(/max\(profiles\.best_score\b/iu);
    expect(sqliteDialect.upsertProfile()).not.toMatch(/greatest/iu);

    for (const dialect of [postgresDialect, mysqlDialect]) {
      expect(dialect.upsertProfile(), dialect.name).toMatch(/greatest\(profiles\.best_score\b/iu);
    }
  });

  /*
   * `created_at` 與 `updated_at` 是 `insert` 自己生的（`sqlStore.upsertProfile` 只綁 7 個參數），所以每
   * 個方言都要有「現在」的表達式 —— 而 SQLite 沒有 `now()`。
   * `created_at` and `updated_at` are produced by the `insert` itself (`sqlStore.upsertProfile` binds
   * exactly seven parameters), so every dialect needs its own "right now" — and SQLite has no `now()`.
   */
  it('produces the current time without a bound parameter', () => {
    expect(postgresDialect.upsertProfile()).toContain('now()');
    expect(mysqlDialect.upsertProfile()).not.toContain('now()');
    expect(sqliteDialect.upsertProfile()).toContain("strftime('%s','now')");
    expect(sqliteDialect.upsertProfile()).not.toContain('now()');
  });
});

/* ── 建表 / The schema ─────────────────────────────────────────────────────── */

describe('schema — 必須可重複執行 / it must be repeatable', () => {
  /*
   * 沒有 `if not exists` 的話，第二次執行（或本機先跑過一次再部署）就會炸在建表上。`ensureSchema`
   * 的整個設計就建立在這一條上面，所以它是這份檔案裡最重要的一條。
   *
   * MySQL 那一邊比較特別：它的索引是 `create table` 語句**的一部分**（`CREATE INDEX` 沒有
   * `IF NOT EXISTS`），所以那一條語句本身就是「可重複執行」的完整要求。
   * Without `if not exists` the second run (or a local run before a deploy) explodes on the CREATE.
   * `ensureSchema`'s whole design rests on this, which makes it the most important test in the file.
   *
   * MySQL is the odd one out: its indexes are **part of** the `create table` statement (`CREATE INDEX`
   * has no `IF NOT EXISTS`), so that one statement carries the whole repeatability requirement.
   */
  it('uses only create … if not exists on every dialect', () => {
    for (const dialect of DIALECTS) {
      const statements = dialect.schema();

      expect(statements.length, dialect.name).toBeGreaterThan(0);

      for (const statement of statements) {
        expect(statement.toLowerCase().replace(/\s+/gu, ' '), dialect.name).toContain(
          'if not exists',
        );
      }
    }
  });

  /* 三個方言要建出**同一組表** —— 少一張就是某個端點在其中一邊會 500。 */
  it('creates the same set of tables on every dialect', () => {
    const tablesOf = (dialect: Dialect): string[] =>
      dialect
        .schema()
        .flatMap((statement) => [...statement.matchAll(/create table if not exists\s+[`"]?(\w+)/giu)])
        .map((match) => match[1] ?? '');

    expect(tablesOf(postgresDialect).sort()).toEqual([
      'profiles',
      'requests',
      'run_tokens',
      'scores',
    ]);

    /* 排序過才比 —— `requests` 在 MySQL 那份是排在最後的，那是它的可讀性順序，不是語意。 */
    for (const dialect of [mysqlDialect, sqliteDialect]) {
      expect([...tablesOf(dialect)].sort(), dialect.name).toEqual(tablesOf(postgresDialect).sort());
    }
  });

  /*
   * MySQL 的建表語句把索引寫在**表內**（MySQL 的 `CREATE INDEX` 沒有 `IF NOT EXISTS`，分開寫就無法
   * 重複執行），所以那一邊的索引不會出現在 `create index` 形式的語句裡。SQLite 則與 Postgres 一樣是
   * 獨立的 `create index if not exists`。
   * MySQL puts indexes **inside** the table (its `CREATE INDEX` has no `IF NOT EXISTS`, so separate
   * statements could not be re-run), so that side's indexes never appear as `create index` statements.
   * SQLite, like Postgres, writes them as standalone `create index if not exists`.
   */
  it('declares the board index on every dialect', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.schema().join('\n'), dialect.name).toContain('profiles_best_score_idx');
    }
  });

  /*
   * 未通過檢查的提交仍然佔速率限制的額度，所以 `scores` 上的那個部分索引（`where verified`）不是裝飾
   * —— 三個方言都必須有這個索引，否則「先送一堆假成績」在某一邊會變成免費。
   *
   * ⚠️ 但**只有 Postgres 與 SQLite 是部分索引**：MySQL 沒有 `where` 這種寫法，它的版本索引所有列。
   * 那不是錯（索引大一點而已），但把它當成「三個都一樣」就會在調校時看錯方向，所以測試講明白。
   * Rejected submissions still consume the rate limit, so that index on `scores` (`where verified`) is
   * not decoration: all three need it, or "spam fake scores first" becomes free on one of them.
   *
   * ⚠️ But **only Postgres and SQLite make it partial**: MySQL has no `where` clause there and indexes
   * every row. That is not wrong (merely a larger index), but treating the three as identical would
   * point any tuning work the wrong way, so the test says it out loud.
   */
  it('declares the scores index on every dialect, partial where the dialect allows it', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.schema().join('\n'), dialect.name).toContain('scores_verified_score_idx');
    }

    for (const dialect of [postgresDialect, sqliteDialect]) {
      expect(dialect.schema().join('\n'), dialect.name).toContain('where verified');
    }

    expect(mysqlDialect.schema().join('\n')).not.toContain('where verified');
  });

  /*
   * ⚠️ `scores` **不可以**有外鍵指向 `profiles`，而且這一條是**功能性**的，不是風格問題。
   *
   * 它原本有（`references profiles … on delete cascade`），而它會讓兩個完全正常的寫入失敗：
   *   1. 新裝置的第一次提交 —— `saveScore` 先寫 `scores` 才寫 `profiles`，順序不能反（冪等由 `scores`
   *      那一句的結果決定），所以寫入時還沒有父列；
   *   2. 被退回的提交 —— `verified = false` 的局**故意**不建 profile（要留審計痕跡但不進榜），所以它
   *      永遠沒有父列，有外鍵就等於「不准留檔」。
   *
   * 這條測試是那條路徑唯一的守門人：真庫上的行為驗證在 `tests/db.integration.test.ts`（新裝置第一次
   * 提交、以及被退回的局有沒有寫進去），而這一條在**沒有資料庫**時也會紅。
   * ⚠️ `scores` must **not** carry a foreign key to `profiles`, and this is a **functional** rule
   * rather than a matter of style.
   *
   * It used to (`references profiles … on delete cascade`), and that made two entirely normal writes
   * fail: a new device's first submission (`saveScore` writes `scores` before `profiles` and cannot
   * swap that order, since idempotency comes from the first statement's result, so there is no parent
   * row yet) and a rejected submission (a `verified = false` run **deliberately** creates no profile —
   * the audit trail is kept and the board is not touched — so it can never have a parent, which makes
   * the key mean "refuse to record it").
   *
   * This is the only gate on that path that needs no database; the behavioural check lives in
   * `tests/db.integration.test.ts` (a new device's first submission, and whether a rejected run gets
   * written), and this one goes red without any database at all.
   */
  it('never points a foreign key from scores at profiles', () => {
    for (const dialect of DIALECTS) {
      const ddl = dialect.schema().join('\n').toLowerCase();

      expect(ddl, dialect.name).not.toContain('references profiles');
      expect(ddl, dialect.name).not.toMatch(/\bforeign key\b/u);
    }
  });
});

/* ── SQLite 的路徑與驅動 / SQLite's path and driver ────────────────────────── */

describe('sqlitePathFromUrl — 從連線字串取檔案路徑 / extracting the file path', () => {
  /*
   * SQLite 的連線字串沒有 host 這個概念，所以 `//` 不代表「跳過一個主機名」而是「路徑從下一個字元
   * 開始」。這一組案例把三種寫法都釘住，因為開發者會寫的是**最短的那一種**（`sqlite:.mysql/endchi.db`）。
   * A SQLite connection string has no concept of a host, so `//` does not mean "skip a host name" but
   * "the path starts at the next character". These cases pin all three spellings down, because the one
   * a developer actually types is the **shortest** (`sqlite:.mysql/endchi.db`).
   */
  it('accepts a bare path after the scheme', () => {
    expect(sqlitePathFromUrl('sqlite:.mysql/endchi.db')).toBe('.mysql/endchi.db');
    expect(sqlitePathFromUrl('sqlite:/tmp/x.db')).toBe('/tmp/x.db');
  });

  it('strips the URL separator once', () => {
    /* `//` 與 `///` 都只剝一層：`///` 剩下的那個 `/` 是 POSIX 的根目錄，不是多餘的分隔符。 */
    expect(sqlitePathFromUrl('sqlite://rel/x.db')).toBe('rel/x.db');
    expect(sqlitePathFromUrl('sqlite:///tmp/x.db')).toBe('/tmp/x.db');
    /* Windows 磁碟機：`sqlite://E:/x.db` → `E:/x.db`（不可以被剝成 `/x.db`）。 */
    expect(sqlitePathFromUrl('sqlite://E:/x.db')).toBe('E:/x.db');
  });

  /* 記憶體資料庫是測試的預設，而它有兩個等價的寫法。 */
  it('keeps the in-memory marker recognisable', () => {
    expect(sqlitePathFromUrl('sqlite::memory:')).toBe(':memory:');
    expect(sqlitePathFromUrl(':memory:')).toBe(':memory:');
  });

  /* 沒有 scheme 時原樣當路徑 —— 這讓 `createSqliteDriver` 也能直接收一個檔案路徑。 */
  it('treats a plain path as a path', () => {
    expect(sqlitePathFromUrl('.mysql/endchi.db')).toBe('.mysql/endchi.db');
  });
});

/* ── MySQL 連線 flags / MySQL connection flags ─────────────────────────────── */

describe('MySQL 連線 flags / MySQL connection flags', () => {
  /*
   * `mysql2` 的 `getDefaultFlags()` **預設就包含 `FOUND_ROWS`**，所以只要沒有人明著把它黑名單掉，
   * 它就會一直是開的。那個 flag 把 `affectedRows` 從「真的寫入的列數」換成「符合條件的列數」，
   * 而 `insertScoreSignal` 正是靠 `affectedRows` 判斷這一局是不是新的 —— 開著的話，每一次重試都
   * 會被當成新的一局。
   *
   * 這條測試是「不能無聲拆掉」的那道鎖：真正的行為驗證在 `tests/db.integration.test.ts`（要一個
   * 真的 MySQL 才會跑），而這一條在沒有資料庫時也會紅。
   * `mysql2`'s `getDefaultFlags()` **includes `FOUND_ROWS` by default**, so unless it is explicitly
   * blacklisted the flag is on. It swaps `affectedRows` from "rows actually written" to "rows
   * matched", and `insertScoreSignal` decides "is this run new?" from exactly that number — with the
   * flag on, every retry reads as a new run.
   *
   * This is the lock that stops it being removed silently. The real behavioural check lives in
   * `tests/db.integration.test.ts` (which needs a live MySQL); this one also fails with no database.
   */
  it('blacklists FOUND_ROWS, which mysql2 enables by default', () => {
    expect(MYSQL_CLIENT_FLAGS).toContain('-FOUND_ROWS');
  });

  /* 黑名單靠 `-` 前綴（`mergeFlags()` 只認這種寫法）；忘了前綴就等於要求「開啟」它。 */
  it('uses the blacklist prefix rather than naming the flag', () => {
    expect(MYSQL_CLIENT_FLAGS).not.toContain('FOUND_ROWS');
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

    /*
     * SQLite 回來就已經是毫秒整數（欄位就是那個整數），所以 `readTime` 只是把 `null` 擋掉。三個方言的
     * **回傳型別**在這一行之後就統一了 —— 上面的三種輸入，下面 `sqlStore` 拿到的是同一個數字。
     * SQLite comes back as the millisecond integer already (that *is* the column), so `readTime` only
     * has to guard `null`. After this line the three dialects' **return types** are identical: three
     * different inputs above, one number for `sqlStore` below.
     */
    expect(sqliteDialect.readTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(sqliteDialect.readTime(0)).toBe(0);
    expect(sqliteDialect.readTime(null)).toBeNull();
  });

  it('reads a MySQL datetime string as UTC, not as local time', () => {
    /* 少了補上的 `Z`，同一個值在 UTC+8 的機器上會被解讀成早八小時。 */
    expect(mysqlDialect.readTime('2023-11-14 22:13:20.000')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));

    /* 已經帶了時區的就不要動它。 */
    expect(mysqlDialect.readTime('2023-11-14T22:13:20.000Z')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
  });

  /*
   * 布林：Postgres 回真的 `true`／`false`，MySQL 回 `tinyint(1)` 的 1／0，SQLite 回 `integer` 的 1／0
   * （因為 `node:sqlite` 不收支數值）。混用的話 `verified` 會變成「1 是真、0 也是真」（因為 `0` 是
   * truthy 的字串），於是未通過的提交也會進榜。
   * Booleans: Postgres returns real `true` / `false`, MySQL returns `tinyint(1)`'s 1 / 0 and SQLite the
   * `integer` 1 / 0 (`node:sqlite` takes no boolean). Mixed up, `verified` becomes "1 is true and so is
   * 0" (since the string `'0'` is truthy) and rejected submissions would land on the board.
   */
  it('reads a boolean from either representation', () => {
    expect(postgresDialect.readBool(true)).toBe(true);
    expect(postgresDialect.readBool(false)).toBe(false);

    for (const dialect of [mysqlDialect, sqliteDialect]) {
      expect(dialect.readBool(1), dialect.name).toBe(true);
      expect(dialect.readBool(0), dialect.name).toBe(false);
      expect(dialect.readBool('0'), dialect.name).toBe(false);
      expect(dialect.readBool(false), dialect.name).toBe(false);
      /* `null`（欄位可空時）不可以被當成 true —— 那會讓「沒有這個欄位」變成「通過檢查」。 */
      expect(dialect.readBool(null), dialect.name).toBe(false);
    }
  });

  it('coerces counts to numbers on every dialect', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.readNumber('42'), dialect.name).toBe(42);
      expect(dialect.readNumber(42), dialect.name).toBe(42);
      expect(dialect.readNumber(undefined), dialect.name).toBe(0);
    }

    /* Postgres 的 count 要 `::int` 才會是數字而不是字串；另外兩個本來就是數字，不必動。 */
    expect(postgresDialect.countInt('count(*)')).toBe('count(*)::int');
    expect(mysqlDialect.countInt('count(*)')).toBe('count(*)');
    expect(sqliteDialect.countInt('count(*)')).toBe('count(*)');
  });

  /*
   * 時間欄位的 SELECT 表達式。Postgres 要從 `timestamptz` 換算，另外兩個欄位本身就是毫秒。
   * 這一條負責擋住「有人把 Postgres 的 `extract(epoch …)` 照抄到 SQLite」——那不會報錯，只會回 null。
   * The SELECT expression for a time column. Postgres converts from `timestamptz` while the other two
   * store milliseconds outright. This catches "someone copied Postgres's `extract(epoch …)` into
   * SQLite", which would not throw — it would return null.
   */
  it('reads the time column without converting on MySQL and SQLite', () => {
    expect(postgresDialect.epochMs('best_at')).toContain('extract(epoch from');
    expect(mysqlDialect.epochMs('best_at')).toBe('best_at');
    expect(sqliteDialect.epochMs('best_at')).toBe('best_at');
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
   * SQLite 認的是 `sqlite:` 與 `sqlite3:` 兩個 scheme。兩者都要，因為 `sqlite3` 是 `better-sqlite3`
   * 與一些 CLI 沿用的寫法，而**認錯 scheme 的後果是把一個檔案路徑餵給 Postgres**。
   * SQLite answers to both `sqlite:` and `sqlite3:`. Both are needed because `sqlite3` is the spelling
   * `better-sqlite3` and some CLIs use, and **getting the scheme wrong feeds a file path to Postgres**.
   */
  it('recognises both sqlite spellings, whatever the path looks like', () => {
    expect(dialectFromUrl('sqlite:.mysql/endchi.db')).toBe('sqlite');
    expect(dialectFromUrl('sqlite:///tmp/x.db')).toBe('sqlite');
    expect(dialectFromUrl('sqlite::memory:')).toBe('sqlite');
    expect(dialectFromUrl('sqlite3:/tmp/x.db')).toBe('sqlite');
    expect(dialectFromUrl('SQLITE:.mysql/endchi.db')).toBe('sqlite');
  });

  /*
   * 認不出來時回 Postgres 是刻意的保守選擇：那是正式部署用的方言，而猜錯的代價在文件裡講明了。
   *
   * `libsql://` 是刻意留在這一邊的例子：Turso／libSQL 是**託管的 SQLite**，語法上與這個方言幾乎一樣，
   * 但它走的是 HTTP 而不是一個檔案，所以在這裡必須當成「還不支援」——把它猜成 Postgres 會在連線時大聲
   * 失敗，比猜成 SQLite 然後在某個 API 形狀不同時靜靜出錯好。真要接的話是同一個 `Driver` 換一個實作
   * （見 `sqlite.ts` 檔頭）。
   * Returning Postgres for anything unrecognised is the deliberately conservative choice: it is the
   * dialect the deployment uses, and the cost of guessing wrong is documented.
   *
   * `libsql://` is the deliberate example of what stays on that side: Turso / libSQL is **hosted
   * SQLite** and its syntax is nearly this dialect's, but it speaks HTTP rather than opening a file, so
   * here it must count as "not supported yet" — guessing Postgres fails loudly at connect time, which
   * beats guessing SQLite and then quietly breaking on an API difference. Supporting it means the same
   * `Driver` with another implementation (see the header of `sqlite.ts`).
   */
  it('defaults to postgres when the scheme is unfamiliar', () => {
    expect(dialectFromUrl('')).toBe('postgres');
    expect(dialectFromUrl('libsql://x.turso.io')).toBe('postgres');
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
