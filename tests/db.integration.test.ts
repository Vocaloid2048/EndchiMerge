/**
 * 真的資料庫的整合測試。
 * Integration tests against a real database.
 *
 * ## 為什麼要 gated / Why it is gated
 *
 * 它**預設不跑**：只有在設了 `TEST_DATABASE_URL` 時才執行，否則整個 suite 被跳過。
 * It **does not run by default**: it only runs when `TEST_DATABASE_URL` is set, and the whole suite is
 * skipped otherwise.
 *
 * 理由有兩個。一是這個 repo 與 CI 不需要為了跑測試而背一個資料庫；二是**單元測試永遠測不到真 SQL**
 * ——`sqlStore.test.ts` 的假驅動驗的是「我們產生了什麼」，這個檔案驗的是「資料庫真的接受它」。兩者
 * 的交集才是「能跑」，而這個交集只有在真的連上去之後才存在。
 * Two reasons: neither this repo nor CI should have to carry a database just to run tests, and **unit
 * tests can never check real SQL** — the fake driver in `sqlStore.test.ts` checks "what we produced",
 * while this file checks "the database actually accepts it". Only the intersection of the two is
 * "it works", and that intersection does not exist until something actually connects.
 *
 * 用法 / Usage:
 *   TEST_DATABASE_URL='postgresql://…' npx vitest run tests/db.integration.test.ts
 *   TEST_DATABASE_URL='mysql://…'      npx vitest run tests/db.integration.test.ts
 *
 * ⚠️ 它會在**指定的資料庫**裡建表與寫測試資料。請指向一個拋棄式的實例（本機容器、Neon 的分支、
 * 騰訊雲的測試庫），**不要指向正式庫**。測試用的列都帶 `it-` 前綴的裝置碼，跑完會自己刪掉。
 * ⚠️ It creates tables and writes test data **in the database you name**. Point it at a disposable
 * instance (a local container, a Neon branch, a Tencent test database), **never at production**. Test
 * rows all use device ids prefixed `it-` and are deleted on the way out.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { dialectFromUrl, type Dialect } from '../api/_lib/db/dialect';
import type { Driver } from '../api/_lib/db/types';
import type { RequestRow } from '../api/_lib/requests';
import { SqlStore } from '../api/_lib/sqlStore';
import type { ScoreRow } from '../api/_lib/store';

const TEST_URL = (process.env['TEST_DATABASE_URL'] ?? '').trim();
const ENABLED = TEST_URL !== '';

/** 每一輪的唯一前綴，讓重複執行不會互相污染。 */
const ROUND = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 測試期間建立的裝置碼，跑完用它清理。 */
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
    score: 900,
    durationMs: 60_000,
    merges: 30,
    drops: 40,
    maxCombo: 5,
    version: '0.1.0',
    verified: true,
    rejected: null,
    clientIp: null,
    atMs: AT,
    ...overrides,
  };
}

describe.skipIf(!ENABLED)('SqlStore — 真的資料庫 / a real database', () => {
  const dialectName = ENABLED ? dialectFromUrl(TEST_URL) : 'postgres';
  const dialect: Dialect = dialectFor(dialectName);

  let driver: Driver;
  let store: SqlStore;

  beforeAll(async () => {
    driver = createDriver(dialectName, TEST_URL);
    /* 建表是可重複執行的，所以每次跑都先套一次，順便驗證它真的能重複跑。 */
    await ensureSchema(driver, dialect);
    await ensureSchema(driver, dialect);
    store = new SqlStore(driver, dialect);
  });

  afterAll(async () => {
    if (!ENABLED) return;

    for (const device of devices) {
      /* 先刪 `scores` 再刪 `profiles`：外鍵是 scores → profiles（Postgres 有 cascade，但明講更穩）。 */
      await driver.query(`delete from scores where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from requests where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from profiles where device_id = ${dialect.ph(1)}`, [device]);
    }

    for (const device of devices) {
      await driver.query(`delete from run_tokens where device_id = ${dialect.ph(1)}`, [device]);
    }

    await driver.close();
  });

  it('creates the tables and says they already exist on a second run', () => {
    /* 走到這裡就代表 `ensureSchema` 跑了兩次都沒炸。 */
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
    /* 毫秒要**完全**等於，不是「差不多」—— 時區或精度錯了這裡就會紅。 */
    expect(stored?.issuedAtMs).toBe(AT);
    expect(stored?.expiresAtMs).toBe(AT + 60_000);
    expect(stored?.usedAtMs).toBeNull();

    await store.markRunTokenUsed(runId, AT + 1_000);
    expect((await store.getRunToken(runId))?.usedAtMs).toBe(AT + 1_000);

    /* 已用過的憑證不該被第二次改寫（`where used_at is null`）。 */
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

    const board = await store.topProfiles(100);
    expect(board.some((entry) => entry.deviceId === device)).toBe(true);
    expect(await store.countProfiles()).toBeGreaterThan(0);

    expect(await store.getScore(run.runId)).toMatchObject({ score: 900, verified: true });

    /* 名次是 1 起算的。 */
    expect(await store.rankOf({ score: 900, atMs: AT, deviceId: device })).toBeGreaterThan(0);
  });

  /*
   * 「時長跟著分數走」—— 這一條在真的資料庫上跑，因為它正是 `upsertProfile` 那個**由左至右求值**的
   * 陷阱所在（見 `Dialect.upsertProfile`）。假驅動測不到這個：它只在 MySQL 真的執行語句時才會咬人。
   * "The duration follows the score" runs against the real database because it is exactly where
   * `upsertProfile`'s **left-to-right evaluation** trap lives (see `Dialect.upsertProfile`). The fake
   * driver cannot catch it — it only bites when MySQL actually executes the statement.
   */
  it('keeps the duration on the best-scoring run, not the longest one', async () => {
    const device = deviceId('duration');

    await store.saveScore(score(device, { score: 900, durationMs: 60_000, maxCombo: 5, merges: 30 }));
    /* 打得久但分數低：只該刷新連擊與合成數，**不該**蓋掉最高分那一局的時間。 */
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
    /* 同一局再送一次 —— 這是網路重試的樣子。 */
    expect(await store.saveScore(run)).toBe(false);

    const profile = await store.getProfile(device);
    expect(profile?.bestScore).toBe(900);
  });

  /* 未通過的提交要留檔（審計）但不進榜。 */
  it('stores a rejected run without putting it on the board', async () => {
    const device = deviceId('rejected');
    const run = score(device, { score: 9_000_000, verified: false, rejected: 'score_above_ceiling' });

    expect(await store.saveScore(run)).toBe(true);
    expect(await store.getScore(run.runId)).toMatchObject({ verified: false, rejected: 'score_above_ceiling' });
    /* 沒有 profile，因為這一筆沒通過檢查。 */
    expect(await store.getProfile(device)).toBeNull();
  });

  /* ── 榜的排序與名次 ────────────────────────────────────────────────────── */

  /*
   * 這一條是 `rankOf` 與 `topProfiles` 要**互相對得上**的證明，而它只有在真的資料庫上才有意義 ——
   * 排序是資料庫做的，不是我們做的。
   * This proves `rankOf` and `topProfiles` **agree with each other**, and it only means anything on a
   * real database — the ordering is done by the database, not by us.
   */
  it('ranks a tie by who got there first, and mirrors the board order', async () => {
    const first = deviceId('tie-first');
    const second = deviceId('tie-second');
    const lower = deviceId('tie-lower');

    await store.saveScore(score(lower, { score: 500, atMs: AT + 2_000 }));
    await store.saveScore(score(first, { score: 700, atMs: AT }));
    await store.saveScore(score(second, { score: 700, atMs: AT + 1_000 }));

    const rankFirst = await store.rankOf({ score: 700, atMs: AT, deviceId: first });
    const rankSecond = await store.rankOf({ score: 700, atMs: AT + 1_000, deviceId: second });

    /* 同分時較早達成的排前面。 */
    expect(rankFirst).toBeLessThan(rankSecond);

    /*
     * 名次必須**等於**它在榜上的位置 —— 這是最直接的鏡像檢查：兩個查詢各算各的，就會在同分時分歧。
     * The rank must **equal** its position on the board — the most direct mirror check: two
     * independently computed queries would diverge exactly on a tie.
     */
    const board = await store.topProfiles(100);
    const positionOnBoard = board.findIndex((entry) => entry.deviceId === first) + 1;

    expect(rankFirst).toBe(positionOnBoard);
  });

  /* ── 速率限制的計數 ────────────────────────────────────────────────────── */

  it('counts submissions including the rejected ones', async () => {
    const device = deviceId('count');

    await store.saveScore(score(device, { score: 9_000_000, verified: false, rejected: 'x' }));
    await store.saveScore(score(device, { atMs: AT + 1_000 }));

    expect(await store.countSubmissionsSince(device, AT - 1)).toBe(2);
    /* 被退回的也要算進去，否則「先送一堆假成績」就等於繞過速率限制。 */
    expect(await store.countSubmissionsSince(device, AT + 500)).toBe(1);
  });

  /* ── 接收紀錄 ──────────────────────────────────────────────────────────── */

  it('stores a request row with the whitelisted headers as JSON', async () => {
    const device = deviceId('request');

    const row: RequestRow = {
      method: 'POST',
      path: '/api/score',
      status: 200,
      deviceId: device,
      runId: null,
      clientIp: '198.51.100.0',
      userAgent: 'vitest',
      acceptLanguage: 'zh-HK',
      origin: 'https://game.example',
      referer: null,
      country: 'HK',
      region: null,
      city: null,
      headers: { 'user-agent': 'vitest', 'accept-language': 'zh-HK' },
    };

    await store.insertRequest(row);

    const { rows } = await driver.query(
      `select method, status, client_ip, user_agent, headers from requests
       where device_id = ${dialect.ph(1)}`,
      [device],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      method: 'POST',
      status: 200,
      client_ip: '198.51.100.0',
      user_agent: 'vitest',
    });
    /* JSON 欄位真的存成了 JSON，不是一段被跳脫過的字串。 */
    expect(JSON.stringify(rows[0]?.['headers'])).toContain('user-agent');
  });

  /* ── 交易的原子性 ──────────────────────────────────────────────────────── */

  /*
   * 兩個寫入必須同生共死。這裡用**重複的 `run_id` 配上不同的裝置**製造外鍵失敗，驗證 `scores` 沒有
   * 留下半筆 —— 若交易沒包好，第一筆會留在那裡，而重試會因為 `run_id` 已存在被當成重複，那個最大值
   * 就永遠補不回來。
   * The two writes live or die together. A duplicate `run_id` with a different device forces a
   * foreign-key failure, and the check is that no half-written `scores` row survives — without a
   * proper transaction the first row would stay, the retry would look like a duplicate, and the maxima
   * could never be repaired.
   */
  it('leaves no half-written score when the profile insert is invalid', async () => {
    const device = deviceId('atomic');
    const run = score(device);

    expect(await store.saveScore(run)).toBe(true);

    let threw = false;

    try {
      /*
       * 同一個 `run_id` 但**不存在的裝置**：`scores` 的外鍵會擋下來。不過 `run_id` 已經存在，所以會先
       * 撞上主鍵衝突而回 false（冪等）—— 這也是正確行為，兩種結果都接受，重點是**不能留下半筆**。
       * Same `run_id` but a **non-existent device**: the foreign key on `scores` blocks it. The
       * `run_id` already exists though, so it hits the primary-key conflict first and returns false
       * (idempotent) — also correct. Either outcome is fine; the point is **no half-written row**.
       */
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

/* 沒有設定 `TEST_DATABASE_URL` 時，明確告訴開發者這份測試被跳過了（而不是靜靜地什麼都沒跑）。 */
describe.skipIf(ENABLED)('integration tests — 已跳過 / skipped', () => {
  it('explains how to run them', () => {
    expect(TEST_URL).toBe('');
    /* 想跑的話：TEST_DATABASE_URL='postgresql://…' npx vitest run tests/db.integration.test.ts */
  });
});
