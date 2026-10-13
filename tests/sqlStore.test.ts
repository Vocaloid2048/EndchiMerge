/**
 * `SqlStore` 的測試：**用假的驅動，不需要資料庫**。
 * Tests for `SqlStore`: **with a fake driver, no database needed**.
 *
 * 假驅動只做兩件事 —— 記下每一次 `(sql, params)`，然後回傳事先排好的結果。這剛好足夠測到三件最容易
 * 出事的事：
 *   1. **佔位符數與參數數必須相等**。這條抓的是 `Binder` 那個「Postgres 可重用 `$1`、MySQL 的 `?`
 *      一次一個」的差異；錯了會在執行期才炸，而且錯誤訊息完全不會指向真正的原因。
 *   2. **冪等的判斷**。Postgres 看 `returning` 的行數，MySQL 看 `affectedRows` —— 兩條路都要走到，
 *      而且判成「重複」時**不能再動 profile**。
 *   3. **寫入必須在交易裡**，而且順序是先 `scores` 再 `profiles`（前者才是冪等的依據）。
 * The fake driver does two things: records every `(sql, params)` and returns queued results. That is
 * exactly enough to cover the three easiest things to get wrong — the placeholder/param count (which
 * catches the `Binder` difference between a reusable `$1` and a positional `?`, and which would
 * otherwise only explode at runtime with a message pointing nowhere near the cause), the idempotency
 * decision (`returning` rows on Postgres versus `affectedRows` on MySQL, where a "duplicate" verdict
 * must **not** touch the profile again), and the fact that the writes happen inside a transaction and
 * in the order scores-then-profiles (the first being what idempotency rests on).
 */

import { describe, expect, it } from 'vitest';

import type { Dialect } from '../api/_lib/db/dialect';
import { mysqlDialect } from '../api/_lib/db/mysql';
import { postgresDialect } from '../api/_lib/db/postgres';
import type { Driver, Row, SqlResult } from '../api/_lib/db/types';
import { SqlStore } from '../api/_lib/sqlStore';
import type { RankProbe, RequestRow, RunTokenRow, ScoreRow } from '../api/_lib/store';

const DIALECTS: readonly Dialect[] = [postgresDialect, mysqlDialect];

const AT = 1_700_000_000_000;

/**
 * `rankOf` 要問的那一組數字。**三個最大值都要帶** —— 名次是相對於某個分類的，只給分數的話
 * 另外兩個分頁算出來的名次會是錯的（見 `RankProbe`）。
 * The numbers `rankOf` asks about. **All three maxima** are carried: a rank is relative to a category,
 * and handing over only the score would make the other two tabs' ranks wrong (see `RankProbe`).
 */
function probe(overrides: Partial<RankProbe> = {}): RankProbe {
  return { deviceId: 'device-1', score: 900, maxCombo: 12, merges: 30, atMs: AT, ...overrides };
}

/* ── 假的驅動 / The fake driver ────────────────────────────────────────────── */

class RecordingDriver implements Driver {
  readonly calls: { sql: string; params: readonly unknown[] }[] = [];
  readonly transactions: string[] = [];
  private readonly queued: SqlResult[] = [];

  /** 讓符合條件的查詢拋錯；測交易回滾用。 */
  failWhen: ((sql: string) => boolean) | null = null;

  /** 排一筆回傳值；沒排到的查詢一律回「沒有列、沒有影響」。 */
  reply(rows: readonly Row[] = [], affected = 0): void {
    this.queued.push({ rows, affected });
  }

  async query(sql: string, params: readonly unknown[] = []): Promise<SqlResult> {
    this.calls.push({ sql, params });

    if (this.failWhen !== null && this.failWhen(sql)) throw new Error('boom');

    return this.queued.shift() ?? { rows: [], affected: 0 };
  }

  async transaction<T>(run: (tx: Driver) => Promise<T>): Promise<T> {
    this.transactions.push('begin');

    try {
      const result = await run(this);
      this.transactions.push('commit');

      return result;
    } catch (error) {
      this.transactions.push('rollback');
      throw error;
    }
  }

  async close(): Promise<void> {
    /* 沒有東西要關。 */
  }

  /** 這次查詢的 SQL 是第幾筆。 */
  get count(): number {
    return this.calls.length;
  }
}

function placeholderCount(sql: string, dialect: Dialect): number {
  if (dialect.name === 'mysql') return (sql.match(/\?/gu) ?? []).length;

  const numbers = [...sql.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]));

  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

/* ── 素材 / Fixtures ──────────────────────────────────────────────────────── */

function tokenRow(): RunTokenRow {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    deviceId: 'device-0000-1111',
    tokenHash: 'a'.repeat(64),
    issuedAtMs: AT,
    expiresAtMs: AT + 60_000,
    usedAtMs: null,
  };
}

function scoreRow(overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    deviceId: 'device-0000-1111',
    displayName: '阿爺',
    userTag: '0001',
    score: 900,
    durationMs: 60_000,
    merges: 30,
    drops: 40,
    maxCombo: 5,
    version: '0.1.0',
    verified: true,
    rejected: null,
    atMs: AT,
    ...overrides,
  };
}

function requestRow(): RequestRow {
  return {
    method: 'POST',
    path: '/api/score',
    status: 200,
    deviceId: 'device-0000-1111',
    runId: null,
  };
}

/* ── 佔位符與參數 / Placeholders and params ───────────────────────────────── */

describe('SqlStore — 每一條語句的佔位符都要對得上參數 / placeholders must match params', () => {
  /*
   * 這是這個檔案最重要的一條，而且它是**通用**的：走過每一個方法，然後檢查每一條產生的 SQL。
   * 新加一個方法卻忘了讓 `Binder` 處理某個值時，這條會直接紅 —— 不必為每個方法各寫一條。
   * This is the most important test here, and it is **generic**: walk every method, then check every
   * generated statement. Adding a method and forgetting to route a value through `Binder` turns this
   * red immediately — no per-method test needed.
   */
  it('binds exactly as many params as the statement has placeholders', async () => {
    for (const dialect of DIALECTS) {
      const driver = new RecordingDriver();
      const store = new SqlStore(driver, dialect);

      await store.putRunToken(tokenRow());
      await store.getRunToken('run-1');
      await store.markRunTokenUsed('run-1', AT);
      await store.countRunTokensSince('device-1', AT - 3_600_000);
      await store.getScore('run-1');
      await store.countSubmissionsSince('device-1', AT - 3_600_000);
      await store.saveScore(scoreRow());
      await store.getProfile('device-1');
      await store.topProfiles('score', 100);
      await store.countProfiles();
      await store.rankOf(probe(), 'score');
      await store.insertRequest(requestRow());

      expect(driver.calls.length).toBeGreaterThan(10);

      for (const call of driver.calls) {
        expect(placeholderCount(call.sql, dialect)).toBe(call.params.length);
      }
    }
  });

  /*
   * Postgres 的參數是**位置**型的 `$1…$n`，所以最多的那個編號就等於參數數；這一條確認編號是連續的
   * （沒有跳號），跳號會讓驅動收到數量對不上的參數。
   * Postgres params are **positional** `$1…$n`, so the highest number equals the param count; this
   * checks the numbering is contiguous — a gap would hand the driver a mismatched argument list.
   */
  it('numbers the Postgres placeholders contiguously', async () => {
    const driver = new RecordingDriver();
    const store = new SqlStore(driver, postgresDialect);

    await store.rankOf(probe(), 'score');

    const numbers = [...(driver.calls[0]?.sql ?? '').matchAll(/\$(\d+)/gu)].map((m) => Number(m[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
    expect(numbers[numbers.length - 1]).toBe(numbers.length);
  });

  /*
   * 榜的排序必須**照方言走**。這一條把 `SqlStore` 與 `Dialect.boardOrder()` 釘在一起：如果有人把
   * 排序字串直接寫死在 store 裡，MySQL 的 `nulls last` 就會跑出來見人。
   * The board order must **go through the dialect**. This pins `SqlStore` to `Dialect.boardOrder()`: a
   * hard-coded order string in the store would leak MySQL's missing `nulls last` into view.
   */
  it('takes the board order from the dialect', async () => {
    for (const dialect of DIALECTS) {
      const driver = new RecordingDriver();
      const store = new SqlStore(driver, dialect);

      await store.topProfiles('score', 10);

      expect(driver.calls[0]?.sql).toContain(dialect.boardOrder('score'));
    }
  });

  /*
   * `rankOf` 必須是 `topProfiles` 排序的**鏡像**：同樣的三個鍵、同樣的方向。兩邊分歧的症狀是同分時
   * 「我顯示第 3 名，但列上寫 #5」。
   * `rankOf` must **mirror** `topProfiles`: the same three keys in the same direction. Divergence shows
   * up as "I am shown as 3rd but my row says #5" on a tie.
   */
  it('mirrors the three board keys in rankOf', async () => {
    const driver = new RecordingDriver();
    const store = new SqlStore(driver, postgresDialect);

    await store.rankOf(probe(), 'score');

    const sql = driver.calls[0]?.sql ?? '';
    expect(sql).toContain('best_score >');
    expect(sql).toContain('best_score =');
    expect(sql).toContain('best_at <');
    expect(sql).toContain('best_at =');
    expect(sql).toContain('device_id <');
  });

  /*
   * 名次必須**跟著分頁走**：查組合數那一頁要比 `best_max_combo`，不是比 `best_score`。少了這一條，
   * 三個分頁會共用同一個（分數的）名次，摘要那句「你的最佳：N 連 · 第 3 名」就會自相矛盾。
   * The rank must **follow the tab**: the combo page compares `best_max_combo`, not `best_score`.
   * Without this all three tabs would share the score rank and the summary's "Nth" would contradict
   * the value printed beside it.
   */
  it('compares the category column in rankOf', async () => {
    const columns = { score: 'best_score', combo: 'best_max_combo', merges: 'best_merges' } as const;

    for (const category of ['score', 'combo', 'merges'] as const) {
      const driver = new RecordingDriver();
      await new SqlStore(driver, postgresDialect).rankOf(probe(), category);

      const sql = driver.calls[0]?.sql ?? '';
      expect(sql, category).toContain(`${columns[category]} >`);
      expect(sql, category).toContain(`${columns[category]} =`);
    }
  });

  /* headers 要以 JSON 綁定：Postgres 少了 `::jsonb` 會把它當成一段文字而寫不進 jsonb 欄位。 */
  /* 接收紀錄只有五個維運欄位 —— 一個參數都不能多（多了就是在收個人資料）。 */
  it('binds exactly the five operational fields on a request row', async () => {
    const driver = new RecordingDriver();
    await new SqlStore(driver, postgresDialect).insertRequest(requestRow());

    expect(driver.calls[0]?.sql).not.toContain('client_ip');
    expect(driver.calls[0]?.sql).not.toContain('user_agent');
    expect(driver.calls[0]?.sql).not.toContain('headers');
    expect(driver.calls[0]?.params).toHaveLength(5);
    expect(driver.calls[0]?.params).toEqual(['POST', '/api/score', 200, 'device-0000-1111', null]);
  });

  /* 時間要用方言的型別：Postgres 收 ISO 字串，MySQL 收 `Date`。 */
  it('binds timestamps in the dialect representation', async () => {
    const postgres = new RecordingDriver();
    await new SqlStore(postgres, postgresDialect).markRunTokenUsed('run-1', AT);
    expect(postgres.calls[0]?.params[0]).toBe(new Date(AT).toISOString());

    const mysql = new RecordingDriver();
    await new SqlStore(mysql, mysqlDialect).markRunTokenUsed('run-1', AT);
    expect(mysql.calls[0]?.params[0]).toBeInstanceOf(Date);
  });
});

/* ── 冪等 / Idempotency ───────────────────────────────────────────────────── */

describe('SqlStore.saveScore — 冪等 / idempotency', () => {
  it('treats a Postgres insert with no returning row as a duplicate', async () => {
    const driver = new RecordingDriver();
    /* 第一筆是 `insert … returning`（沒有列 ＝ 已存在），第二筆是 profile。 */
    driver.reply([], 0);
    driver.reply([], 0);

    const inserted = await new SqlStore(driver, postgresDialect).saveScore(scoreRow());

    expect(inserted).toBe(false);
    /* 重複時**不能**再動 profile：分數早就算進去了，再算會讓 `updated_at` 一直往前跑。 */
    expect(driver.calls).toHaveLength(1);
  });

  it('treats a MySQL no-op upsert as a duplicate', async () => {
    const driver = new RecordingDriver();
    /* `on duplicate key update run_id = run_id` 是刻意的 no-op，所以 `affectedRows` 是 0。 */
    driver.reply([], 0);
    driver.reply([], 0);

    const inserted = await new SqlStore(driver, mysqlDialect).saveScore(scoreRow());

    expect(inserted).toBe(false);
    expect(driver.calls).toHaveLength(1);
  });

  it('writes the profile only when the insert really landed', async () => {
    const driver = new RecordingDriver();
    /* Postgres 用 `returning` 回一列表示寫進去了；中間兩次讀是 upsert 的前置（沿用既有的號、查「名字＋號」有沒有撞到）。
     * Postgres signals a real write with a `returning` row; the two reads in between are the upsert's
     * prerequisites (keep the existing tag, check the name-and-tag pair for a collision). */
    driver.reply([{ run_id: 'x' }], 1);
    driver.reply([], 0);
    driver.reply([], 0);
    driver.reply([], 1);

    const inserted = await new SqlStore(driver, postgresDialect).saveScore(scoreRow());

    expect(inserted).toBe(true);

    /* 只數**寫入**：前置讀了幾次不該讓這一條紅，但「寫了哪兩張表、什麼次序」是這一條的重點。 */
    const writes = driver.calls.filter((call) => call.sql.toLowerCase().startsWith('insert'));
    expect(writes).toHaveLength(2);
    expect(writes[0]?.sql.toLowerCase()).toContain('insert into scores');
    expect(writes[1]?.sql.toLowerCase()).toContain('insert into profiles');
  });

  /* 未通過檢查的提交留檔但不進榜（design.md §6.7），所以只寫 `scores`。 */
  it('does not touch the profile for a rejected run', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ run_id: 'x' }], 1);

    await new SqlStore(driver, postgresDialect).saveScore(
      scoreRow({ verified: false, rejected: 'score_above_ceiling' }),
    );

    expect(driver.calls).toHaveLength(1);
  });

  /*
   * 兩個寫入必須在同一個交易裡 —— 否則「分數寫進去了但最大值沒更新」這種中間狀態會留在資料庫，
   * 而下一次重試會因為 `run_id` 已存在而被判成重複，那個最大值就永遠補不回來。
   * The two writes must share one transaction — otherwise an intermediate state ("the score is stored
   * but the maxima were not updated") stays in the database, and the retry is judged a duplicate
   * because `run_id` already exists, so the maxima can never be repaired.
   */
  it('wraps both writes in one transaction', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ run_id: 'x' }], 1);
    driver.reply([], 1);

    await new SqlStore(driver, postgresDialect).saveScore(scoreRow());

    expect(driver.transactions).toEqual(['begin', 'commit']);
  });

  it('rolls back when the profile write fails', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ run_id: 'x' }], 1);
    driver.failWhen = (sql) => sql.toLowerCase().includes('insert into profiles');

    await expect(new SqlStore(driver, postgresDialect).saveScore(scoreRow())).rejects.toThrow('boom');
    expect(driver.transactions).toEqual(['begin', 'rollback']);
  });
});

/* ── 讀值的轉換 / Mapping values back ─────────────────────────────────────── */

describe('SqlStore — 列的轉換 / mapping rows', () => {
  it('reads a Postgres profile row, where the epoch arrives as a string', async () => {
    const driver = new RecordingDriver();
    driver.reply([
      {
        device_id: 'device-1',
        display_name: '阿爺',
        user_tag: '0001',
        best_score: '900',
        best_duration_ms: '60000',
        best_max_combo: '5',
        best_merges: '30',
        best_at_ms: String(AT),
      },
    ]);

    const profile = await new SqlStore(driver, postgresDialect).getProfile('device-1');

    expect(profile).toEqual({
      deviceId: 'device-1',
      displayName: '阿爺',
      userTag: '0001',
      bestScore: 900,
      bestDurationMs: 60_000,
      bestMaxCombo: 5,
      bestMerges: 30,
      bestAtMs: AT,
    });
  });

  it('reads a MySQL profile row, where the time arrives as a Date', async () => {
    const driver = new RecordingDriver();
    driver.reply([
      {
        device_id: 'device-1',
        display_name: '阿爺',
        best_score: 900,
        best_duration_ms: 60_000,
        best_max_combo: 5,
        best_merges: 30,
        best_at_ms: new Date(AT),
      },
    ]);

    const profile = await new SqlStore(driver, mysqlDialect).getProfile('device-1');

    expect(profile?.bestAtMs).toBe(AT);
    expect(profile?.bestScore).toBe(900);
  });

  /* `best_at` 可以是 NULL（從未破紀錄），那時名次要當成 0 而不是 `NaN`。 */
  it('maps a null timestamp to null rather than NaN', async () => {
    const driver = new RecordingDriver();
    driver.reply([
      {
        device_id: 'device-1',
        display_name: '',
        best_score: 0,
        best_duration_ms: 0,
        best_max_combo: 0,
        best_merges: 0,
        best_at_ms: null,
      },
    ]);

    expect((await new SqlStore(driver, postgresDialect).getProfile('device-1'))?.bestAtMs).toBeNull();
  });

  /*
   * `verified` 在 MySQL 是 `tinyint(1)`：如果當成布林直接讀，`'0'` 這種字串是 truthy，未通過的提交
   * 就會被當成通過。這一條用 MySQL 的形狀（1／0）確認轉換是對的。
   * `verified` is a `tinyint(1)` on MySQL: read as a plain boolean, the string `'0'` is truthy and a
   * rejected submission counts as verified. This checks the conversion against MySQL's shape (1 / 0).
   */
  it('reads verified from a MySQL tinyint', async () => {
    const driver = new RecordingDriver();
    driver.reply([
      {
        run_id: 'run-1',
        device_id: 'device-1',
        display_name: '阿爺',
        score: 900,
        duration_ms: 60_000,
        merges: 30,
        drops: 40,
        max_combo: 5,
        version: '0.1.0',
        verified: 0,
        rejected: 'score_above_ceiling',
        client_ip: null,
        at_ms: new Date(AT),
      },
    ]);

    const row = await new SqlStore(driver, mysqlDialect).getScore('run-1');

    expect(row?.verified).toBe(false);
    expect(row?.rejected).toBe('score_above_ceiling');
    expect(row?.atMs).toBe(AT);
  });

  it('returns null when there is no such row', async () => {
    const driver = new RecordingDriver();
    const store = new SqlStore(driver, postgresDialect);

    expect(await store.getProfile('nobody')).toBeNull();
    expect(await store.getScore('nobody')).toBeNull();
    expect(await store.getRunToken('nobody')).toBeNull();
  });

  /* 名次是「排在前面的數量 ＋ 1」，所以 count 回 0 時名次是 1（＝第一名）。 */
  it('turns a count of zero ahead into rank 1', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ n: 0 }]);

    expect(await new SqlStore(driver, postgresDialect).rankOf(probe({ deviceId: 'd' }), 'score')).toBe(1);
  });

  it('reads the token row back with milliseconds', async () => {
    const driver = new RecordingDriver();
    driver.reply([
      {
        run_id: 'run-1',
        device_id: 'device-1',
        token_hash: 'abc',
        issued_at_ms: String(AT),
        expires_at_ms: String(AT + 60_000),
        used_at_ms: null,
      },
    ]);

    const row = await new SqlStore(driver, postgresDialect).getRunToken('run-1');

    expect(row).toEqual({
      runId: 'run-1',
      deviceId: 'device-1',
      tokenHash: 'abc',
      issuedAtMs: AT,
      expiresAtMs: AT + 60_000,
      usedAtMs: null,
    });
  });
});
