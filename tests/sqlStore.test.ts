/**
 * `SqlStore` 的測試：用假的驅動，不需要資料庫。
 * Tests for `SqlStore`, driven by a fake driver — no database needed.
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

function probe(overrides: Partial<RankProbe> = {}): RankProbe {
  return { deviceId: 'device-1', score: 900, maxCombo: 12, merges: 30, atMs: AT, ...overrides };
}

/* ── 假的驅動 / The fake driver ────────────────────────────────────────────── */

class RecordingDriver implements Driver {
  readonly calls: { sql: string; params: readonly unknown[] }[] = [];
  readonly transactions: string[] = [];
  private readonly queued: SqlResult[] = [];

  failWhen: ((sql: string) => boolean) | null = null;

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
  }

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

  it('numbers the Postgres placeholders contiguously', async () => {
    const driver = new RecordingDriver();
    const store = new SqlStore(driver, postgresDialect);

    await store.rankOf(probe(), 'score');

    const numbers = [...(driver.calls[0]?.sql ?? '').matchAll(/\$(\d+)/gu)].map((m) => Number(m[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
    expect(numbers[numbers.length - 1]).toBe(numbers.length);
  });

  it('takes the board order from the dialect', async () => {
    for (const dialect of DIALECTS) {
      const driver = new RecordingDriver();
      const store = new SqlStore(driver, dialect);

      await store.topProfiles('score', 10);

      expect(driver.calls[0]?.sql).toContain(dialect.boardOrder('score'));
    }
  });

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

  it('binds exactly the five operational fields on a request row', async () => {
    const driver = new RecordingDriver();
    await new SqlStore(driver, postgresDialect).insertRequest(requestRow());

    expect(driver.calls[0]?.sql).not.toContain('client_ip');
    expect(driver.calls[0]?.sql).not.toContain('user_agent');
    expect(driver.calls[0]?.sql).not.toContain('headers');
    expect(driver.calls[0]?.params).toHaveLength(5);
    expect(driver.calls[0]?.params).toEqual(['POST', '/api/score', 200, 'device-0000-1111', null]);
  });

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
    driver.reply([], 0);
    driver.reply([], 0);

    const inserted = await new SqlStore(driver, postgresDialect).saveScore(scoreRow());

    expect(inserted).toBe(false);
    expect(driver.calls).toHaveLength(1);
  });

  it('treats a MySQL no-op upsert as a duplicate', async () => {
    const driver = new RecordingDriver();
    driver.reply([], 0);
    driver.reply([], 0);

    const inserted = await new SqlStore(driver, mysqlDialect).saveScore(scoreRow());

    expect(inserted).toBe(false);
    expect(driver.calls).toHaveLength(1);
  });

  it('writes the profile only when the insert really landed', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ run_id: 'x' }], 1);
    driver.reply([], 0);
    driver.reply([], 0);
    driver.reply([], 1);

    const inserted = await new SqlStore(driver, postgresDialect).saveScore(scoreRow());

    expect(inserted).toBe(true);

    const writes = driver.calls.filter((call) => call.sql.toLowerCase().startsWith('insert'));
    expect(writes).toHaveLength(2);
    expect(writes[0]?.sql.toLowerCase()).toContain('insert into scores');
    expect(writes[1]?.sql.toLowerCase()).toContain('insert into profiles');
  });

  it('does not touch the profile for a rejected run', async () => {
    const driver = new RecordingDriver();
    driver.reply([{ run_id: 'x' }], 1);

    await new SqlStore(driver, postgresDialect).saveScore(
      scoreRow({ verified: false, rejected: 'score_above_ceiling' }),
    );

    expect(driver.calls).toHaveLength(1);
  });

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
