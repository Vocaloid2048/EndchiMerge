/**
 * 方言的測試：三種方言的佔位符、排序、DDL 與錯誤分類。
 * Tests for the dialects: placeholders, ordering, DDL and error classification across all three.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  Binder,
  BOARD_CATEGORIES,
  BOARD_ORDER_KEYS,
  describeConnectionTarget,
  dialectFromUrl,
  isBoardCategory,
  isConnectionError,
  type Dialect,
} from '../api/_lib/db/dialect';
import { mysqlDialect, MYSQL_CLIENT_FLAGS } from '../api/_lib/db/mysql';
import { normaliseSslMode, postgresDialect } from '../api/_lib/db/postgres';
import { sqliteDialect, sqlitePathFromUrl } from '../api/_lib/db/sqlite';

const DIALECTS: readonly Dialect[] = [postgresDialect, mysqlDialect, sqliteDialect];

/**
 * 參數位置是 `$1` 還是 `?` 由 `ph()` 決定，不是方言的名字。
 * Whether a position is `$1` or `?` comes from `ph()`, not the dialect's name.
 */
function placeholderCount(sql: string, dialect: Dialect): number {
  if (dialect.ph(1) === '?') return (sql.match(/\?/gu) ?? []).length;

  const numbers = [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));

  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

function greaterCall(column: string): RegExp {
  return new RegExp(`(?:greatest|max)\\(profiles\\.${column}\\b`, 'iu');
}

/* ── 佔位符與參數 ─────────────────────────────────────────────────────────── */

describe('Binder — 佔位符與參數要對得上 / placeholders and params must line up', () => {
  it('assigns one position per bound value', () => {
    for (const dialect of DIALECTS) {
      const b = new Binder(dialect);
      const placeholders = [b.bind('a'), b.bind(1), b.bind(null)];

      const sql = `select * from t where x = ${placeholders[0]} and y = ${placeholders[1]} and z = ${placeholders[2]}`;

      expect(b.params).toHaveLength(3);
      expect(placeholderCount(sql, dialect)).toBe(3);
    }
  });

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

    expect(tsSql).toBe('$1::timestamptz');
    expect(jsonSql).toBe('$2::jsonb');
    expect(postgres.params).toHaveLength(2);

    const mysql = new Binder(mysqlDialect);
    expect(mysql.bindTime(1_700_000_000_000)).toBe('?');
    expect(mysql.bindJson('{}')).toBe('?');
    expect(mysql.params).toHaveLength(2);

    const sqlite = new Binder(sqliteDialect);
    expect(sqlite.bindTime(1_700_000_000_000)).toBe('?');
    expect(sqlite.bindJson('{}')).toBe('?');
    expect(sqlite.params).toHaveLength(2);
  });

  it('converts the time value itself, not just the placeholder', () => {
    expect(postgresDialect.ts(0)).toBe('1970-01-01T00:00:00.000Z');
    expect(mysqlDialect.ts(0)).toBeInstanceOf(Date);
    expect((mysqlDialect.ts(0) as Date).toISOString()).toBe('1970-01-01T00:00:00.000Z');

    expect(sqliteDialect.ts(0)).toBe(0);
    expect(sqliteDialect.ts(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(typeof sqliteDialect.ts(1_700_000_000_000)).toBe('number');
  });
});

/* ── 榜的排序 / The board order ────────────────────────────────────────────── */

describe('board order — 四個鍵的語意要一致 / the four keys mean the same thing', () => {
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

  it('spells nulls last natively on Postgres and SQLite, and only simulates it on MySQL', () => {
    for (const dialect of [postgresDialect, sqliteDialect]) {
      expect(dialect.boardOrder('score'), dialect.name).not.toContain('best_at is null');
    }

    expect(mysqlDialect.boardOrder('score')).toContain('best_at is null');
  });

  it('ranks each category on its own column', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.boardOrder('combo')).toContain('best_max_combo desc');
      expect(dialect.boardOrder('merges')).toContain('best_merges desc');
    }
  });

  it('does not repeat the primary key on the score board', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.boardOrder('score').match(/best_score/gu), dialect.name).toHaveLength(1);
    }
  });

  it('uses the same tie-breakers on every category', () => {
    for (const category of BOARD_CATEGORIES) {
      expect(postgresDialect.boardOrder(category)).toContain('best_at asc nulls last, device_id asc');
      expect(sqliteDialect.boardOrder(category)).toContain('best_at asc nulls last, device_id asc');
      expect(mysqlDialect.boardOrder(category)).toContain('best_at is null, best_at asc, device_id asc');
    }
  });

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

  it('rejects anything else', () => {
    for (const value of ['SCORE', 'combo ', 'best', '', null, undefined, 3, {}, ['score']]) {
      expect(isBoardCategory(value), JSON.stringify(value)).toBe(false);
    }
  });
});

/* ── 寫入語句 / The writes ─────────────────────────────────────────────────── */

describe('writes — 形狀差異 / shape differences', () => {
  it('uses on conflict on Postgres and SQLite, and on duplicate key on MySQL', () => {
    expect(postgresDialect.insertRunToken()).toContain('on conflict (run_id) do nothing');
    expect(sqliteDialect.insertRunToken()).toContain('on conflict (run_id) do nothing');
    expect(mysqlDialect.insertRunToken()).toContain('on duplicate key update run_id = run_id');
  });

  it('never uses insert ignore on MySQL', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.insertScore().toLowerCase()).not.toContain('insert ignore');
    }
  });

  it('takes one placeholder per bound column, including the submission time', () => {
    for (const dialect of DIALECTS) {
      expect(placeholderCount(dialect.insertScore(), dialect), dialect.name).toBe(12);
      /* `scores.created_at` 是綁定值，不靠 DDL 預設值。
         `scores.created_at` is a bound value, not a DDL default. */
      expect(dialect.insertScore(), dialect.name).toContain('created_at');
      /* 私隱硬規則：`client_ip` 不在 insertScore 的欄位裡。
         Hard privacy rule: `client_ip` is not among insertScore's columns. */
      expect(dialect.insertScore(), dialect.name).not.toContain('client_ip');
    }
  });

  it('reports the insert via returning on Postgres and SQLite, and affected rows on MySQL', () => {
    expect(postgresDialect.insertScore()).toContain('returning run_id');
    expect(postgresDialect.insertScoreSignal).toBe('rows');

    expect(sqliteDialect.insertScore()).toContain('returning run_id');
    expect(sqliteDialect.insertScoreSignal).toBe('rows');

    expect(mysqlDialect.insertScore()).not.toContain('returning');
    expect(mysqlDialect.insertScoreSignal).toBe('affected');
  });

  /*
   * MySQL 的 `on duplicate key update` 由左至右求值：`best_score` 的賦值必須排在拿它比較的
   * `best_duration_ms` 與 `best_at` 之後，否則時長永遠不會跟著分數更新。
   * MySQL evaluates `on duplicate key update` left to right: the `best_score` assignment must come
   * after the `best_duration_ms` and `best_at` columns that compare against it, or the duration never
   * follows the score.
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

  it('uses max() on SQLite and greatest() elsewhere', () => {
    expect(sqliteDialect.upsertProfile()).toMatch(/max\(profiles\.best_score\b/iu);
    expect(sqliteDialect.upsertProfile()).not.toMatch(/greatest/iu);

    for (const dialect of [postgresDialect, mysqlDialect]) {
      expect(dialect.upsertProfile(), dialect.name).toMatch(/greatest\(profiles\.best_score\b/iu);
    }
  });

  it('produces the current time without a bound parameter', () => {
    expect(postgresDialect.upsertProfile()).toContain('now()');
    expect(mysqlDialect.upsertProfile()).not.toContain('now()');
    expect(sqliteDialect.upsertProfile()).toContain("strftime('%s','now')");
    expect(sqliteDialect.upsertProfile()).not.toContain('now()');
  });
});

/* ── 建表 / The schema ─────────────────────────────────────────────────────── */

describe('schema — 必須可重複執行 / it must be repeatable', () => {
  it('uses only re-runnable statements on every dialect', () => {
    for (const dialect of DIALECTS) {
      const statements = dialect.schema();

      expect(statements.length, dialect.name).toBeGreaterThan(0);

      for (const statement of statements) {
        const flat = statement.toLowerCase().replace(/\s+/gu, ' ');
        const where = `${dialect.name}: ${statement.slice(0, 60)}`;

        if (flat.startsWith('create') || flat.startsWith('alter') || flat.startsWith('drop')) {
          const native = flat.includes('if not exists') || flat.includes('if exists');
          const classified =
            typeof dialect.isMissingColumnError === 'function' ||
            typeof dialect.isDuplicateColumnError === 'function';

          expect(native || classified, where).toBe(true);
        } else {
          expect(flat.startsWith('update'), where).toBe(true);
          expect(flat, where).toContain('where');
        }
      }
    }
  });

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

    for (const dialect of [mysqlDialect, sqliteDialect]) {
      expect([...tablesOf(dialect)].sort(), dialect.name).toEqual(tablesOf(postgresDialect).sort());
    }
  });

  it('declares the board index on every dialect', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.schema().join('\n'), dialect.name).toContain('profiles_best_score_idx');
    }
  });

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
   * `scores` 刻意不設指向 `profiles` 的外鍵：`saveScore` 先寫 `scores`，而被退回的局不建 profile。
   * `scores` deliberately has no foreign key to `profiles`: `saveScore` writes `scores` first, and a
   * rejected run never creates a profile.
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
  it('accepts a bare path after the scheme', () => {
    expect(sqlitePathFromUrl('sqlite:.mysql/endchi.db')).toBe('.mysql/endchi.db');
    expect(sqlitePathFromUrl('sqlite:/tmp/x.db')).toBe('/tmp/x.db');
  });

  it('strips the URL separator once', () => {
    expect(sqlitePathFromUrl('sqlite://rel/x.db')).toBe('rel/x.db');
    expect(sqlitePathFromUrl('sqlite:///tmp/x.db')).toBe('/tmp/x.db');
    expect(sqlitePathFromUrl('sqlite://E:/x.db')).toBe('E:/x.db');
  });

  it('keeps the in-memory marker recognisable', () => {
    expect(sqlitePathFromUrl('sqlite::memory:')).toBe(':memory:');
    expect(sqlitePathFromUrl(':memory:')).toBe(':memory:');
  });

  it('treats a plain path as a path', () => {
    expect(sqlitePathFromUrl('.mysql/endchi.db')).toBe('.mysql/endchi.db');
  });
});

/* ── MySQL 連線 flags / MySQL connection flags ─────────────────────────────── */

describe('MySQL 連線 flags / MySQL connection flags', () => {
  /*
   * `mysql2` 預設開啟 `FOUND_ROWS`，會讓 `affectedRows` 從「寫入列數」變成「符合列數」；
   * 它必須留在黑名單裡（`insertScoreSignal` 靠 `affectedRows` 判斷這一局是不是新的）。
   * `mysql2` enables `FOUND_ROWS` by default, turning `affectedRows` from rows written into rows
   * matched; it must stay blacklisted (`insertScoreSignal` reads it to tell whether a run is new).
   */
  it('blacklists FOUND_ROWS, which mysql2 enables by default', () => {
    expect(MYSQL_CLIENT_FLAGS).toContain('-FOUND_ROWS');
  });

  it('uses the blacklist prefix rather than naming the flag', () => {
    expect(MYSQL_CLIENT_FLAGS).not.toContain('FOUND_ROWS');
  });
});

/* ── schema.sql 與程式的一致性 / schema.sql versus the code ────────────────── */

describe('schema.sql — 人看的那一份要和程式一致 / the human-readable copy must match', () => {
  function normalise(sql: string): string {
    return sql
      .replace(/--[^\n]*/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * 先去掉註解，再切 `;` —— 順序不能顛倒，否則檔頭散文裡的分號會腰斬一條語句。
   * Strip comments **before** splitting on `;` — reversed, a semicolon in the header prose bisects a statement.
   */
  function statements(sql: string): string[] {
    return normalise(sql)
      .split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement !== '');
  }

  it('matches postgresDialect.schema() statement for statement', () => {
    const fromFile = statements(
      readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'),
    );
    const fromCode = postgresDialect.schema().map(normalise);

    expect(fromFile).toEqual(fromCode);
  });

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
    expect(postgresDialect.readTime('1700000000000')).toBe(1_700_000_000_000);
    expect(postgresDialect.readTime(null)).toBeNull();

    expect(mysqlDialect.readTime(new Date(1_700_000_000_000))).toBe(1_700_000_000_000);
    expect(mysqlDialect.readTime(null)).toBeNull();

    expect(sqliteDialect.readTime(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(sqliteDialect.readTime(0)).toBe(0);
    expect(sqliteDialect.readTime(null)).toBeNull();
  });

  it('reads a MySQL datetime string as UTC, not as local time', () => {
    expect(mysqlDialect.readTime('2023-11-14 22:13:20.000')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));

    expect(mysqlDialect.readTime('2023-11-14T22:13:20.000Z')).toBe(Date.UTC(2023, 10, 14, 22, 13, 20));
  });

  it('reads a boolean from either representation', () => {
    expect(postgresDialect.readBool(true)).toBe(true);
    expect(postgresDialect.readBool(false)).toBe(false);

    for (const dialect of [mysqlDialect, sqliteDialect]) {
      expect(dialect.readBool(1), dialect.name).toBe(true);
      expect(dialect.readBool(0), dialect.name).toBe(false);
      expect(dialect.readBool('0'), dialect.name).toBe(false);
      expect(dialect.readBool(false), dialect.name).toBe(false);
      expect(dialect.readBool(null), dialect.name).toBe(false);
    }
  });

  it('coerces counts to numbers on every dialect', () => {
    for (const dialect of DIALECTS) {
      expect(dialect.readNumber('42'), dialect.name).toBe(42);
      expect(dialect.readNumber(42), dialect.name).toBe(42);
      expect(dialect.readNumber(undefined), dialect.name).toBe(0);
    }

    expect(postgresDialect.countInt('count(*)')).toBe('count(*)::int');
    expect(mysqlDialect.countInt('count(*)')).toBe('count(*)');
    expect(sqliteDialect.countInt('count(*)')).toBe('count(*)');
  });

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

  it('recognises both sqlite spellings, whatever the path looks like', () => {
    expect(dialectFromUrl('sqlite:.mysql/endchi.db')).toBe('sqlite');
    expect(dialectFromUrl('sqlite:///tmp/x.db')).toBe('sqlite');
    expect(dialectFromUrl('sqlite::memory:')).toBe('sqlite');
    expect(dialectFromUrl('sqlite3:/tmp/x.db')).toBe('sqlite');
    expect(dialectFromUrl('SQLITE:.mysql/endchi.db')).toBe('sqlite');
  });

  it('defaults to postgres when the scheme is unfamiliar', () => {
    expect(dialectFromUrl('')).toBe('postgres');
    expect(dialectFromUrl('libsql://x.turso.io')).toBe('postgres');
  });

  it('ignores query parameters', () => {
    expect(dialectFromUrl('postgresql://u:p@ep-x-pooler.aws.neon.tech/db?sslmode=require')).toBe('postgres');
  });
});

/* ── 把連線目標寫進日誌 / Naming the target for the log ───────────────────── */

describe('describeConnectionTarget — 日誌裡要看得到目標 / the target a log should show', () => {
  it('keeps the host and the database, drops the query string', () => {
    expect(
      describeConnectionTarget('postgresql://user:pass@ep-x-pooler.aws.neon.tech/neondb?sslmode=require'),
    ).toBe('postgresql://ep-x-pooler.aws.neon.tech/neondb');
  });

  it('keeps a port and a credential-free url as they are', () => {
    expect(describeConnectionTarget('mysql://root:s3cr3t@10.0.0.5:3306/endchi')).toBe(
      'mysql://10.0.0.5:3306/endchi',
    );
    expect(describeConnectionTarget('postgres://host/db')).toBe('postgres://host/db');
  });

  it('drops a password that contains an @ of its own', () => {
    expect(describeConnectionTarget('postgres://player:p@ss@ep-real.aws.neon.tech/neondb')).toBe(
      'postgres://ep-real.aws.neon.tech/neondb',
    );
  });

  it('never leaks a credential', () => {
    const secrets = ['neondb_owner', 'npg_hunter2', 'admin', 'p@ss', 'secretpassword'];
    const rendered = [
      describeConnectionTarget(
        'postgresql://neondb_owner:npg_hunter2@ep-x-pooler.aws.neon.tech/neondb?sslmode=require&password=secretpassword',
      ),
      describeConnectionTarget('mysql://admin:p@ss@db.internal:3306/endchi'),
      describeConnectionTarget('sqlite:.mysql/endchi.db'),
    ].join('\n');

    for (const secret of secrets) expect(rendered).not.toContain(secret);
  });

  it('returns a sqlite file path as it is', () => {
    expect(describeConnectionTarget('sqlite:.mysql/endchi.db')).toBe('sqlite:.mysql/endchi.db');
    expect(describeConnectionTarget('sqlite::memory:')).toBe('sqlite::memory:');
    expect(describeConnectionTarget('sqlite:///tmp/x.db?mode=rwc')).toBe('sqlite:///tmp/x.db');
  });

  it('always answers, even for an empty or odd string', () => {
    expect(describeConnectionTarget('')).toBe('(empty)');
    expect(describeConnectionTarget('   ')).toBe('(empty)');
    expect(describeConnectionTarget('endchi.db')).toBe('(unrecognised)');
  });
});

/* ── Postgres 的 SSL 模式 / Spelling the Postgres SSL mode out ─────────────── */

describe('normaliseSslMode — 別名要寫明白 / aliases written out', () => {
  it('writes the three aliases out as verify-full', () => {
    for (const alias of ['prefer', 'require', 'verify-ca']) {
      expect(normaliseSslMode(`postgresql://u:p@host/db?sslmode=${alias}`)).toBe(
        'postgresql://u:p@host/db?sslmode=verify-full',
      );
    }
  });

  it('handles the Neon-shaped string without disturbing anything else', () => {
    expect(
      normaliseSslMode(
        'postgresql://neondb_owner:npg_x@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
      ),
    ).toBe(
      'postgresql://neondb_owner:npg_x@ep-cool-name-123-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require',
    );
  });

  it('is case-insensitive about the value and keeps the key as it was', () => {
    expect(normaliseSslMode('postgres://h/d?SSLMODE=REQUIRE')).toBe('postgres://h/d?SSLMODE=verify-full');
  });

  it('leaves an explicit libpq-compat string alone', () => {
    const explicit = 'postgres://u:p@host/db?uselibpqcompat=true&sslmode=require';
    expect(normaliseSslMode(explicit)).toBe(explicit);

    expect(normaliseSslMode('postgres://u:p@host/db?sslmode=require&uselibpqcompat=true')).toBe(
      'postgres://u:p@host/db?sslmode=require&uselibpqcompat=true',
    );
  });

  it('does not touch anything that is not an alias', () => {
    for (const value of ['verify-full', 'disable', 'allow']) {
      const url = `postgres://u:p@host/db?sslmode=${value}`;
      expect(normaliseSslMode(url)).toBe(url);
    }

    const plain = 'postgresql://user:pass@host:5432/db';
    expect(normaliseSslMode(plain)).toBe(plain);
  });

  it('changes one value and nothing else', () => {
    const before = 'postgresql://u%40ser:p%40ss%2Fword@host:6543/my_db?application_name=endchi&sslmode=require&connect_timeout=10';
    expect(normaliseSslMode(before)).toBe(
      'postgresql://u%40ser:p%40ss%2Fword@host:6543/my_db?application_name=endchi&sslmode=verify-full&connect_timeout=10',
    );
  });
});

/* ── 錯誤分類 / Classifying errors ─────────────────────────────────────────── */

describe('isConnectionError — 連不上 vs SQL 寫錯 / unreachable vs bad SQL', () => {
  it('recognises the connection-shaped codes from both drivers', () => {
    expect(isConnectionError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(isConnectionError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isConnectionError({ code: '08006' })).toBe(true);
    expect(isConnectionError({ code: 'PROTOCOL_CONNECTION_LOST' })).toBe(true);
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

describe('isMissingColumnError — drop 的冪等來源 / what makes a drop idempotent', () => {
  it('accepts the missing-column errors of its own driver and nothing else', () => {
    expect(postgresDialect.isMissingColumnError?.({ code: '42703' })).toBe(true);
    expect(postgresDialect.isMissingColumnError?.({ code: '42P01' })).toBe(false);
    expect(postgresDialect.isMissingColumnError?.({ code: '42601' })).toBe(false);
    expect(postgresDialect.isMissingColumnError?.(new Error('boom'))).toBe(false);
    expect(postgresDialect.isMissingColumnError?.(null)).toBe(false);

    expect(mysqlDialect.isMissingColumnError?.({ errno: 1091 })).toBe(true);
    expect(mysqlDialect.isMissingColumnError?.({ code: 'ER_CANT_DROP_FIELD_OR_KEY' })).toBe(true);
    expect(mysqlDialect.isMissingColumnError?.({ code: 'ER_NO_SUCH_TABLE' })).toBe(false);
    expect(mysqlDialect.isMissingColumnError?.({ errno: 1146 })).toBe(false);
    expect(mysqlDialect.isMissingColumnError?.(null)).toBe(false);

    expect(
      sqliteDialect.isMissingColumnError?.({
        code: 'ERR_SQLITE_ERROR',
        message: 'no such column: "client_ip"',
      }),
    ).toBe(true);
    expect(
      sqliteDialect.isMissingColumnError?.({
        code: 'ERR_SQLITE_ERROR',
        message: 'no such index: requests_ip_idx',
      }),
    ).toBe(true);
    expect(
      sqliteDialect.isMissingColumnError?.({
        code: 'ERR_SQLITE_ERROR',
        message: 'no such table: requests',
      }),
    ).toBe(false);
    expect(sqliteDialect.isMissingColumnError?.(new Error('boom'))).toBe(false);
  });
});

describe('isDuplicateColumnError — 加欄位的冪等來源 / what makes an add idempotent', () => {
  it('accepts the duplicate-column error of its own driver and nothing else', () => {
    expect(postgresDialect.isDuplicateColumnError?.({ code: '42701' })).toBe(true);
    expect(postgresDialect.isDuplicateColumnError?.({ code: '42703' })).toBe(false);
    expect(postgresDialect.isDuplicateColumnError?.(null)).toBe(false);

    expect(mysqlDialect.isDuplicateColumnError?.({ errno: 1060 })).toBe(true);
    expect(mysqlDialect.isDuplicateColumnError?.({ code: 'ER_DUP_FIELDNAME' })).toBe(true);
    expect(mysqlDialect.isDuplicateColumnError?.({ errno: 1091 })).toBe(false);
    expect(mysqlDialect.isDuplicateColumnError?.(null)).toBe(false);

    expect(
      sqliteDialect.isDuplicateColumnError?.({
        code: 'ERR_SQLITE_ERROR',
        message: 'duplicate column name: user_tag',
      }),
    ).toBe(true);
    expect(
      sqliteDialect.isDuplicateColumnError?.({
        code: 'ERR_SQLITE_ERROR',
        message: 'no such column: user_tag',
      }),
    ).toBe(false);
    expect(sqliteDialect.isDuplicateColumnError?.(new Error('boom'))).toBe(false);
  });
});
