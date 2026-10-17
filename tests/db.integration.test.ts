/**
 * 真資料庫的整合測試：把 `SqlStore` 對真的 SQL 引擎跑一遍（預設記憶體 SQLite）。
 * Integration tests against a real database: run `SqlStore` against a real SQL engine (default in-memory SQLite).
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { dialectFromUrl, type Dialect } from '../api/_lib/db/dialect';
import type { Driver } from '../api/_lib/db/types';
import { SqlStore } from '../api/_lib/sqlStore';
import type { ProfileRow, RankProbe, RequestRow, ScoreRow } from '../api/_lib/store';

const TEST_URL = (process.env['TEST_DATABASE_URL'] ?? 'sqlite::memory:').trim();

const ROUND = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const devices: string[] = [];

function deviceId(label: string): string {
  const id = `it-${ROUND}-${label}`;
  devices.push(id);

  return id;
}

const AT = 1_700_000_000_000;

function score(device: string, overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: randomUUID(),
    deviceId: device,
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

function probe(device: string, overrides: Partial<RankProbe> = {}): RankProbe {
  return { deviceId: device, score: 900, maxCombo: 5, merges: 30, atMs: AT, ...overrides };
}

describe('SqlStore — 真的資料庫 / a real database', () => {
  const dialectName = dialectFromUrl(TEST_URL);
  const dialect: Dialect = dialectFor(dialectName);

  let driver: Driver;
  let store: SqlStore;

  beforeAll(async () => {
    driver = createDriver(dialectName, TEST_URL);
    await ensureSchema(driver, dialect);
    await ensureSchema(driver, dialect);
    store = new SqlStore(driver, dialect);
  });

  afterAll(async () => {
    for (const device of devices) {
      await driver.query(`delete from scores where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from requests where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from profiles where device_id = ${dialect.ph(1)}`, [device]);
    }

    for (const device of devices) {
      await driver.query(`delete from run_tokens where device_id = ${dialect.ph(1)}`, [device]);
    }

    await driver.close();
  });

  it('runs against the dialect the URL names', () => {
    expect(['postgres', 'mysql', 'sqlite']).toContain(dialectName);
    expect(dialect.name).toBe(dialectName);
  });

  it('creates the tables and says they already exist on a second run', () => {
    expect(dialect.schema().length).toBeGreaterThan(0);
  });

  /* ── 憑證 ──────────────────────────────────────────────────────────────── */

  it('round-trips a run token, including the used flag', async () => {
    const device = deviceId('token');
    const runId = randomUUID();

    await store.putRunToken({
      runId,
      deviceId: device,
      tokenHash: 'f'.repeat(64),
      issuedAtMs: AT,
      expiresAtMs: AT + 60_000,
      usedAtMs: null,
    });

    const stored = await store.getRunToken(runId);
    expect(stored?.deviceId).toBe(device);
    expect(stored?.issuedAtMs).toBe(AT);
    expect(stored?.expiresAtMs).toBe(AT + 60_000);
    expect(stored?.usedAtMs).toBeNull();

    await store.markRunTokenUsed(runId, AT + 1_000);
    expect((await store.getRunToken(runId))?.usedAtMs).toBe(AT + 1_000);

    await store.markRunTokenUsed(runId, AT + 9_999);
    expect((await store.getRunToken(runId))?.usedAtMs).toBe(AT + 1_000);

    expect(await store.countRunTokensSince(device, AT - 1)).toBe(1);
    expect(await store.countRunTokensSince(device, AT + 1)).toBe(0);
  });

  it('ignores a duplicate run token instead of failing', async () => {
    const device = deviceId('token-dup');
    const runId = randomUUID();
    const row = {
      runId,
      deviceId: device,
      tokenHash: 'e'.repeat(64),
      issuedAtMs: AT,
      expiresAtMs: AT + 60_000,
      usedAtMs: null,
    };

    await store.putRunToken(row);
    await store.putRunToken(row);

    expect(await store.countRunTokensSince(device, AT - 1)).toBe(1);
  });

  /* ── 成績與最大值 ──────────────────────────────────────────────────────── */

  it('writes a run, builds the profile and lists it on the board', async () => {
    const device = deviceId('score');
    const run = score(device);

    expect(await store.saveScore(run)).toBe(true);

    const profile = await store.getProfile(device);
    expect(profile).toMatchObject({
      displayName: '阿爺',
      bestScore: 900,
      bestDurationMs: 60_000,
      bestMaxCombo: 5,
      bestMerges: 30,
      bestAtMs: AT,
    });

    const board = await store.topProfiles('score', 100);
    expect(board.some((entry) => entry.deviceId === device)).toBe(true);
    expect(await store.countProfiles()).toBeGreaterThan(0);

    expect(await store.getScore(run.runId)).toMatchObject({ score: 900, verified: true });

    expect(await store.rankOf(probe(device), 'score')).toBeGreaterThan(0);
  });

  it('keeps the duration on the best-scoring run, not the longest one', async () => {
    const device = deviceId('duration');

    await store.saveScore(score(device, { score: 900, durationMs: 60_000, maxCombo: 5, merges: 30 }));
    await store.saveScore(
      score(device, { score: 100, durationMs: 240_000, maxCombo: 40, merges: 50, atMs: AT + 1_000 }),
    );

    expect(await store.getProfile(device)).toMatchObject({
      bestScore: 900,
      bestDurationMs: 60_000,
      bestMaxCombo: 40,
      bestMerges: 50,
      bestAtMs: AT,
    });
  });

  it('is idempotent: the same run id does not count twice', async () => {
    const device = deviceId('idempotent');
    const run = score(device);

    expect(await store.saveScore(run)).toBe(true);
    expect(await store.saveScore(run)).toBe(false);

    const profile = await store.getProfile(device);
    expect(profile?.bestScore).toBe(900);
  });

  /*
   * 即時上載：同一局再送一次較高的分數，是原地更新那一列，`created_at` 不動，profile 往前推。
   * Live upload: a higher score for the same run updates that row in place, `created_at` stays put,
   * and the profile moves up.
   */
  it('updates the same run in place when a later submission is higher', async () => {
    const device = deviceId('live-update');
    const run = score(device, { score: 300, durationMs: 30_000, merges: 10, drops: 15, maxCombo: 3 });

    expect(await store.saveScore(run)).toBe(true);

    await store.updateScore({
      ...run,
      score: 900,
      durationMs: 60_000,
      merges: 30,
      drops: 40,
      maxCombo: 5,
      atMs: AT + 30_000,
    });

    const stored = await store.getScore(run.runId);
    expect(stored).toMatchObject({ score: 900, durationMs: 60_000, merges: 30, maxCombo: 5 });
    /* `created_at` 不動：它錨住速率限制視窗與審計時間。 */
    expect(stored?.atMs).toBe(AT);
    expect((await store.getProfile(device))?.bestScore).toBe(900);
  });

  /*
   * 被退回的更新不覆蓋之前那筆已驗證的成績。
   * A rejected update never overwrites an earlier verified result.
   */
  it('leaves the stored row alone when the update is rejected', async () => {
    const device = deviceId('live-rejected');
    const run = score(device);

    expect(await store.saveScore(run)).toBe(true);

    await store.updateScore({
      ...run,
      score: 9_000_000,
      verified: false,
      rejected: 'score_above_ceiling',
      atMs: AT + 1_000,
    });

    expect((await store.getScore(run.runId))?.score).toBe(900);
    expect((await store.getProfile(device))?.bestScore).toBe(900);
  });

  it('stores a rejected run without putting it on the board', async () => {
    const device = deviceId('rejected');
    const run = score(device, { score: 9_000_000, verified: false, rejected: 'score_above_ceiling' });

    expect(await store.saveScore(run)).toBe(true);
    expect(await store.getScore(run.runId)).toMatchObject({ verified: false, rejected: 'score_above_ceiling' });
    expect(await store.getProfile(device)).toBeNull();
  });

  /* ── 榜的排序與名次 ────────────────────────────────────────────────────── */

  it('ranks a tie by who got there first, and mirrors the board order', async () => {
    const first = deviceId('tie-first');
    const second = deviceId('tie-second');
    const lower = deviceId('tie-lower');

    await store.saveScore(score(lower, { score: 500, atMs: AT + 2_000 }));
    await store.saveScore(score(first, { score: 700, atMs: AT }));
    await store.saveScore(score(second, { score: 700, atMs: AT + 1_000 }));

    const rankFirst = await store.rankOf(probe(first, { score: 700, atMs: AT }), 'score');
    const rankSecond = await store.rankOf(probe(second, { score: 700, atMs: AT + 1_000 }), 'score');

    expect(rankFirst).toBeLessThan(rankSecond);

    const board = await store.topProfiles('score', 100);
    const positionOnBoard = board.findIndex((entry) => entry.deviceId === first) + 1;

    expect(rankFirst).toBe(positionOnBoard);
  });

  it('puts a high-combo, low-score player on top of the combo board', async () => {
    const rival = deviceId('combo-rival');
    const boss = deviceId('combo-boss');

    await store.saveScore(score(rival, { score: 5_000, maxCombo: 3, merges: 40 }));
    await store.saveScore(score(boss, { score: 120, maxCombo: 90, merges: 60 }));

    const positionOf = (board: readonly ProfileRow[], id: string): number =>
      board.findIndex((entry) => entry.deviceId === id);

    const comboBoard = await store.topProfiles('combo', 100);
    const scoreBoard = await store.topProfiles('score', 100);

    expect(positionOf(comboBoard, boss)).toBeLessThan(positionOf(comboBoard, rival));
    expect(positionOf(scoreBoard, boss)).toBeGreaterThan(positionOf(scoreBoard, rival));

    const bossCombo = await store.rankOf(probe(boss, { score: 120, maxCombo: 90, merges: 60 }), 'combo');
    const rivalCombo = await store.rankOf(probe(rival, { score: 5_000, maxCombo: 3, merges: 40 }), 'combo');
    expect(bossCombo).toBeLessThan(rivalCombo);
  });

  /* ── 速率限制的計數 ────────────────────────────────────────────────────── */

  it('counts submissions including the rejected ones', async () => {
    const device = deviceId('count');

    await store.saveScore(score(device, { score: 9_000_000, verified: false, rejected: 'x' }));
    await store.saveScore(score(device, { atMs: AT + 1_000 }));

    expect(await store.countSubmissionsSince(device, AT - 1)).toBe(2);
    expect(await store.countSubmissionsSince(device, AT + 500)).toBe(1);
  });

  /* ── 接收紀錄 ──────────────────────────────────────────────────────────── */

  it('stores a request row with the five operational fields only', async () => {
    const device = deviceId('request');

    const row: RequestRow = {
      method: 'POST',
      path: '/api/score',
      status: 200,
      deviceId: device,
      runId: null,
    };

    await store.insertRequest(row);

    const { rows } = await driver.query(
      `select * from requests where device_id = ${dialect.ph(1)}`,
      [device],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: 'POST', status: 200 });

    const first = rows[0] as Record<string, unknown>;
    for (const column of ['user_agent', 'accept_language', 'origin', 'referer', 'country', 'region', 'city', 'headers']) {
      expect(first).not.toHaveProperty(column);
    }
  });

  /* ── 交易的原子性 ──────────────────────────────────────────────────────── */

  it('leaves no half-written score when the profile insert is invalid', async () => {
    const device = deviceId('atomic');
    const run = score(device);

    expect(await store.saveScore(run)).toBe(true);

    let threw = false;

    try {
      await store.saveScore({ ...run, deviceId: `it-${ROUND}-ghost`, score: 1 });
    } catch {
      threw = true;
    }

    const { rows } = await driver.query(
      `select count(*) as n from scores where run_id = ${dialect.ph(1)}`,
      [run.runId],
    );

    expect(Number(rows[0]?.['n'])).toBe(1);
    void threw;
  });
});

/* ── SQLite 驅動自己的保證 / Guarantees the SQLite driver makes ─────────────── */

describe('ensureSchema — 舊欄位的清除遷移 / dropping the legacy columns', () => {
  it('drops the legacy header columns and their data, and is re-runnable', async () => {
    const driver = createDriver('sqlite', ':memory:');
    const dialect = dialectFor('sqlite');

    await driver.query(`create table requests (
       id integer primary key,
       received_at integer not null,
       method text not null,
       path text not null,
       status integer not null,
       device_id text,
       run_id text,
       user_agent text,
       accept_language text,
       origin text,
       referer text,
       country text,
       region text,
       city text,
       headers text not null default '{}')`);
    await driver.query(
      `insert into requests (received_at, method, path, status, device_id, run_id, user_agent, headers)
       values (1, 'POST', '/api/score', 200, 'it-legacy', null, 'vitest', '{"user-agent":"vitest"}')`,
    );

    await ensureSchema(driver, dialect);
    await ensureSchema(driver, dialect);

    const { rows } = await driver.query('select * from requests');
    expect(rows).toHaveLength(1);

    const request = rows[0] as Record<string, unknown>;
    for (const column of [
      'user_agent',
      'accept_language',
      'origin',
      'referer',
      'country',
      'region',
      'city',
      'headers',
    ]) {
      expect(request, column).not.toHaveProperty(column);
    }
    expect(request).toMatchObject({ method: 'POST', path: '/api/score', device_id: 'it-legacy' });

    await driver.close();
  });

  it('adds the player tag to existing profiles and keeps the backfilled value', async () => {
    const driver = createDriver('sqlite', ':memory:');
    const dialect = dialectFor('sqlite');

    await driver.query(`create table profiles (
       device_id        text    primary key,
       display_name     text    not null default '',
       best_score       integer not null default 0,
       best_duration_ms integer not null default 0,
       best_max_combo   integer not null default 0,
       best_merges      integer not null default 0,
       best_at          integer,
       name_changed_at  integer,
       created_at       integer,
       updated_at       integer)`);
    await driver.query(
      `insert into profiles (device_id, display_name, best_score) values ('it-legacy', '阿爺', 900)`,
    );

    await ensureSchema(driver, dialect);
    const backfilled = await new SqlStore(driver, dialect).getProfile('it-legacy');

    expect(backfilled?.displayName).toBe('阿爺');
    expect(backfilled?.bestScore).toBe(900);
    expect(backfilled?.userTag).toMatch(/^\d{4}$/u);
    expect(backfilled?.userTag).not.toBe('0000');

    await ensureSchema(driver, dialect);
    expect((await new SqlStore(driver, dialect).getProfile('it-legacy'))?.userTag).toBe(
      backfilled?.userTag,
    );

    await driver.close();
  });
});

describe('SQLite 驅動 / the SQLite driver', () => {
  async function scratch(): Promise<{
    driver: Driver;
    count: (table: string, column: string, value: string) => Promise<number>;
  }> {
    const driver = createDriver('sqlite', ':memory:');

    return {
      driver,
      count: async (table, column, value) => {
        const { rows } = await driver.query(
          `select count(*) as n from ${table} where ${column} = ?`,
          [value],
        );

        return Number(rows[0]?.['n']);
      },
    };
  }

  /*
   * 我們的 schema 沒有外鍵，所以這裡自建父子表來測 `pragma foreign_keys`（SQLite 預設不強制外鍵）。
   * Our schema declares no foreign key, so this builds its own parent/child pair to test
   * `pragma foreign_keys` (SQLite does not enforce foreign keys by default).
   */
  it('enforces foreign keys, unlike a default SQLite', async () => {
    const { driver, count } = await scratch();

    await driver.query('create table parent (id integer primary key)');
    await driver.query(
      'create table child (id integer primary key, parent_id integer references parent (id))',
    );

    await driver.query('insert into parent (id) values (1)');
    await driver.query('insert into child (id, parent_id) values (1, 1)');

    await expect(
      driver.query('insert into child (id, parent_id) values (2, 99)'),
    ).rejects.toThrow();

    expect(await count('child', 'id', '1')).toBe(1);
    expect(await count('child', 'id', '2')).toBe(0);

    await driver.close();
  });

  it('rolls back the whole transaction when a statement inside it throws', async () => {
    const { driver, count } = await scratch();
    await ensureSchema(driver, dialectFor('sqlite'));

    const device = `it-rollback-${ROUND}`;

    await expect(
      driver.transaction(async (tx) => {
        await tx.query(
          `insert into profiles (device_id, display_name, best_score, best_duration_ms,
                                 best_max_combo, best_merges, best_at, created_at, updated_at)
           values (?, 'rollback', 1, 1, 0, 0, null, 0, 0)`,
          [device],
        );

        await tx.query('insert into profiles (device_id) values (?)', [device]);
      }),
    ).rejects.toThrow();

    expect(await count('profiles', 'device_id', device)).toBe(0);

    await driver.close();
  });

  it('does not open a second transaction when one is already running', async () => {
    const { driver, count } = await scratch();
    await ensureSchema(driver, dialectFor('sqlite'));

    const device = `it-nested-${ROUND}`;

    await driver.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.query(
          `insert into profiles (device_id, display_name, best_score, best_duration_ms,
                                 best_max_combo, best_merges, best_at, created_at, updated_at)
           values (?, 'nested', 1, 1, 0, 0, null, 0, 0)`,
          [device],
        );
      });
    });

    expect(await count('profiles', 'device_id', device)).toBe(1);

    await driver.close();
  });
});
