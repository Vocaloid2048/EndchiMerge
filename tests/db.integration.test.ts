/**
 * 真的資料庫的整合測試。
 * Integration tests against a real database.
 *
 * ## 為什麼以前 gated、現在不必 / Why this used to be gated, and no longer is
 *
 * 單元測試**永遠測不到真 SQL**：`sqlStore.test.ts` 的假驅動驗的是「我們產生了什麼」，這個檔案驗的是
 * 「資料庫真的接受它」。兩者的交集才是「能跑」，而那個交集只有在真的連上去之後才存在。
 * Unit tests can never check real SQL: the fake driver in `sqlStore.test.ts` checks "what we produced",
 * while this file checks "the database actually accepts it". Only the intersection of the two is "it
 * works", and that intersection does not exist until something actually connects.
 *
 * 但連上去以前要先有**一個服務** —— Postgres／MySQL 得跑起來、給埠、給帳號密碼。所以這份測試從前是
 * gated 的（只有設了 `TEST_DATABASE_URL` 才跑），代價是**平時不會跑**，而那正是最需要它的時候
 * （改了一條 SQL，卻沒有資料庫可以驗）。
 * But connecting used to need **a service**: Postgres and MySQL want a port, a user and a password. So
 * this file was gated (only running with `TEST_DATABASE_URL` set), and the price was that it **did not
 * run** in the ordinary case — precisely when it is most useful (a SQL statement changed and there is
 * no database to check it against).
 *
 * 加了 SQLite 方言之後那個代價就消失了：它是一個**檔案**，而記憶體裡的版本連檔案都不是。所以預設值
 * 改成 `sqlite::memory:` —— 這個 suite **現在一律會跑真的 SQL**，不需要任何服務；想測 Postgres 或
 * MySQL 仍然是設一個環境變數的事。
 * Adding the SQLite dialect removed that price: it is a **file**, and the in-memory flavour is not even
 * that. The default is therefore `sqlite::memory:` — the suite **now always exercises real SQL** with
 * no service, and testing Postgres or MySQL is still one environment variable away.
 *
 * 用法 / Usage:
 *   npx vitest run tests/db.integration.test.ts                                     # 記憶體 SQLite
 *   TEST_DATABASE_URL='postgresql://…' npx vitest run tests/db.integration.test.ts
 *   TEST_DATABASE_URL='mysql://…'      npx vitest run tests/db.integration.test.ts
 *
 * ⚠️ 指向真庫時，它會在**指定的資料庫**裡建表與寫測試資料，所以請指向一個拋棄式的實例（本機容器、
 * Neon 的分支、騰訊雲的測試庫），**不要指向正式庫**。測試用的列都帶 `it-` 前綴的裝置碼，跑完會自己
 * 刪掉。
 * ⚠️ Pointed at a real database, it creates tables and writes test data **there**, so use a disposable
 * instance (a local container, a Neon branch, a Tencent test database), **never production**. Test rows
 * all use device ids prefixed `it-` and are deleted on the way out.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { dialectFromUrl, type Dialect } from '../api/_lib/db/dialect';
import type { Driver } from '../api/_lib/db/types';
import type { RequestRow } from '../api/_lib/requests';
import { SqlStore } from '../api/_lib/sqlStore';
import type { ProfileRow, RankProbe, ScoreRow } from '../api/_lib/store';

/**
 * 要測哪一個資料庫。
 * Which database to test against.
 *
 * 預設 `sqlite::memory:` 有兩個好處：不必任何服務，而且**每次都是乾淨的** —— 記憶體資料庫在最後一條
 * 連線關掉時就消失了，所以沒有「上一輪的殘留資料讓這一輪紅掉」這種事（真庫那條路徑靠 `it-` 前綴與
 * 事後清理來達到同樣的效果）。
 * The `sqlite::memory:` default buys two things: no service, and a **clean slate every time** — an
 * in-memory database disappears when the last connection closes, so a red run can never be caused by a
 * previous run's leftovers (the real-database path gets the same property from the `it-` prefix and the
 * cleanup below).
 */
const TEST_URL = (process.env['TEST_DATABASE_URL'] ?? 'sqlite::memory:').trim();

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

/**
 * `rankOf` 要問的那一組數字；預設值對應 `score()` 會存出來的 profile。三個最大值都要帶，因為名次
 * 是相對於某個分類的（見 `RankProbe`）。
 * The numbers `rankOf` asks about, defaulting to the profile `score()` writes. All three maxima are
 * carried because a rank is relative to a category (see `RankProbe`).
 */
function probe(device: string, overrides: Partial<RankProbe> = {}): RankProbe {
  return { deviceId: device, score: 900, maxCombo: 5, merges: 30, atMs: AT, ...overrides };
}

/**
 * 現在這份 suite 一律會跑，所以 `describe` 不再需要 `skipIf` —— 資料庫由 `TEST_URL` 決定。
 * The suite now always runs, so the `describe` needs no `skipIf`: `TEST_URL` decides the database.
 */
describe('SqlStore — 真的資料庫 / a real database', () => {
  const dialectName = dialectFromUrl(TEST_URL);
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
    for (const device of devices) {
      /*
       * 先刪 `scores` 再刪 `profiles` —— 現在**沒有**外鍵在綁著它們（那是刻意的，見 `postgres.ts` 的
       * `scores` 建表語句），所以這個順序不會被任何東西強制，也因此更該寫清楚：孤兒 `scores` 列是這張
       * 表的正常狀態（被退回的局就是孤兒），但測試自己弄出來的髒資料不該留著。
       * `scores` is deleted before `profiles` — nothing ties them together now (deliberately; see the
       * `scores` statement in `postgres.ts`), so this order is not enforced by anything, which is
       * exactly why it is worth stating: an orphan `scores` row is a normal state for that table (a
       * rejected run is one), but junk the tests created should not survive.
       */
      await driver.query(`delete from scores where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from requests where device_id = ${dialect.ph(1)}`, [device]);
      await driver.query(`delete from profiles where device_id = ${dialect.ph(1)}`, [device]);
    }

    for (const device of devices) {
      await driver.query(`delete from run_tokens where device_id = ${dialect.ph(1)}`, [device]);
    }

    await driver.close();
  });

  /**
   * 這個 suite 現在到底是對什麼資料庫跑的。
   * Which database this suite is actually running against.
   *
   * 它存在的理由是那一行 `console.log` 般的期待：一個「全綠」如果不說自己在測哪一邊，就沒辦法判斷
   * **該測的那一邊有沒有被測到**。跑真庫時看到 `sqlite` 就代表環境變數沒吃到。
   * It exists because a green run that does not say what it tested cannot tell you whether the thing you
   * *meant* to test was tested. Seeing `sqlite` here when you pointed at a real database means the
   * environment variable did not take effect.
   */
  it('runs against the dialect the URL names', () => {
    expect(['postgres', 'mysql', 'sqlite']).toContain(dialectName);
    expect(dialect.name).toBe(dialectName);
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

    const board = await store.topProfiles('score', 100);
    expect(board.some((entry) => entry.deviceId === device)).toBe(true);
    expect(await store.countProfiles()).toBeGreaterThan(0);

    expect(await store.getScore(run.runId)).toMatchObject({ score: 900, verified: true });

    /* 名次是 1 起算的。 */
    expect(await store.rankOf(probe(device), 'score')).toBeGreaterThan(0);
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

    const rankFirst = await store.rankOf(probe(first, { score: 700, atMs: AT }), 'score');
    const rankSecond = await store.rankOf(probe(second, { score: 700, atMs: AT + 1_000 }), 'score');

    /* 同分時較早達成的排前面。 */
    expect(rankFirst).toBeLessThan(rankSecond);

    /*
     * 名次必須**等於**它在榜上的位置 —— 這是最直接的鏡像檢查：兩個查詢各算各的，就會在同分時分歧。
     * The rank must **equal** its position on the board — the most direct mirror check: two
     * independently computed queries would diverge exactly on a tie.
     */
    const board = await store.topProfiles('score', 100);
    const positionOnBoard = board.findIndex((entry) => entry.deviceId === first) + 1;

    expect(rankFirst).toBe(positionOnBoard);
  });

  /*
   * 三個分頁排的是**不同的東西**：一個「分數很低但連擊很長」的玩家必須出現在**組合數榜**上，即使他在
   * 分數榜上排得很後面。這一條只有在**伺服器自己排序**時才成立 —— 榜若一律按分數排再切前 N 名，
   * 那個人根本不會被回傳，客戶端再怎麼重排都救不回來。
   * The three tabs rank **different things**: a player with a **low score but a long combo** must show up
   * on the **combo board** even when they sit far down the score board. That only holds while the
   * **server does the ordering** — a board always sorted by score and then sliced never returns them,
   * and no amount of client-side re-sorting can bring them back.
   */
  it('puts a high-combo, low-score player on top of the combo board', async () => {
    const rival = deviceId('combo-rival');
    const boss = deviceId('combo-boss');

    await store.saveScore(score(rival, { score: 5_000, maxCombo: 3, merges: 40 }));
    await store.saveScore(score(boss, { score: 120, maxCombo: 90, merges: 60 }));

    const positionOf = (board: readonly ProfileRow[], id: string): number =>
      board.findIndex((entry) => entry.deviceId === id);

    const comboBoard = await store.topProfiles('combo', 100);
    const scoreBoard = await store.topProfiles('score', 100);

    /* 分數榜上排在後面的那一位，在組合數榜上反而排在前面。 */
    expect(positionOf(comboBoard, boss)).toBeLessThan(positionOf(comboBoard, rival));
    expect(positionOf(scoreBoard, boss)).toBeGreaterThan(positionOf(scoreBoard, rival));

    /* 名次也跟著分頁走。 */
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

/*
 * 從前這裡有一個「已跳過」的 `describe`，用一條必然通過的斷言告訴開發者這份測試沒跑。現在沒有東西會
 * 被跳過，所以那一段也跟著消失了 —— 一個永遠會跑的 suite 不需要公告自己沒跑。
 * There used to be a "skipped" `describe` here whose whole job was a always-passing assertion telling
 * the developer nothing had run. Nothing is skipped any more, so it is gone: a suite that always runs
 * has no reason to announce that it did not.
 */

/* ── SQLite 驅動自己的保證 / Guarantees the SQLite driver makes ─────────────── */

/*
 * 這一段驗的不是 SQL 語意 —— 上面那些測試已經在 SQLite 上驗過 —— 而是**這個驅動額外做的三件事**：
 * `pragma foreign_keys = on` 真的生效、交易真的會回滾、以及交易的巢狀呼叫不會開第二層。
 *
 * 它**自己開一個記憶體資料庫**，所以與 `TEST_DATABASE_URL` 無關、一律會跑（即使上面那一大段指向
 * Postgres）。這三段也只有在 SQLite 上才便宜到可以隨手跑：記憶體資料庫起一個只要微秒，而驗同一件事
 * 在 Postgres／MySQL 上要開一個容器。
 * This block does not test SQL semantics — the tests above already did that on SQLite — but the **three
 * extra things this driver does**: that `pragma foreign_keys = on` really takes effect, that a
 * transaction really rolls back, and that a nested `transaction` does not open a second layer.
 *
 * It **opens its own in-memory database**, so it does not care about `TEST_DATABASE_URL` and always
 * runs (even when the block above points at Postgres). These three are also only cheap enough to run in
 * passing on SQLite: an in-memory database costs microseconds, where checking the same thing on
 * Postgres / MySQL needs a container.
 */
describe('SQLite 驅動 / the SQLite driver', () => {
  /**
   * 一個孤立的記憶體資料庫，附帶本段共用的兩個小工具。
   * A throwaway in-memory database, plus the two helpers this block shares.
   */
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
   * ⚠️ 這一條測的是 **pragma 有沒有下對**，不是我們的 schema —— 我們的 schema 現在**沒有任何外鍵**
   * （`scores.device_id` 那個刻意拿掉了，理由見 `postgres.ts` 的 `scores` 建表語句上方）。所以這裡
   * 自己建一對父子表來驗。
   *
   * SQLite 預設**不強制**外鍵，也就是「你寫的約束不會發生」，而那是個安靜的失敗：DDL 看起來完全正常，
   * 錯誤只會在幾週後以「怎麼會有孤兒列」的形式出現。另外兩個方言不會這樣，所以這個 pragma 是「SQLite
   * 真的是另外兩個方言的等價物」的一部分，而不是調校。
   * ⚠️ This checks **the pragma, not our schema** — our schema now declares **no** foreign key at all
   * (the one on `scores.device_id` was deliberately removed; see the reasoning above the `scores`
   * statement in `postgres.ts`). So it builds its own parent/child pair.
   *
   * SQLite **does not enforce** foreign keys by default, which means "the constraint you wrote does
   * nothing" — and that is a silent failure: the DDL looks perfectly normal and the symptom only shows
   * up weeks later as "why are there orphan rows". The other two dialects never behave that way, which
   * is why this pragma is part of "SQLite really is their equivalent" rather than tuning.
   */
  it('enforces foreign keys, unlike a default SQLite', async () => {
    const { driver, count } = await scratch();

    await driver.query('create table parent (id integer primary key)');
    await driver.query(
      'create table child (id integer primary key, parent_id integer references parent (id))',
    );

    await driver.query('insert into parent (id) values (1)');
    await driver.query('insert into child (id, parent_id) values (1, 1)');

    /* 指向不存在的父列：**必須**拋。pragma 沒下的話這一行會靜靜地成功。 */
    await expect(
      driver.query('insert into child (id, parent_id) values (2, 99)'),
    ).rejects.toThrow();

    expect(await count('child', 'id', '1')).toBe(1);
    expect(await count('child', 'id', '2')).toBe(0);

    await driver.close();
  });

  /*
   * 交易要真的回滾。這裡用一個**寫進一半**的交易：先插入一筆，再故意讓第二條語句失敗，然後確認第一筆
   * 沒有留下來。`saveScore` 的路徑已經在真庫上驗過（`leaves no half-written score …`），這一條驗的是
   * 驅動自己那三行 `begin`／`commit`／`rollback`。
   *
   * 這一條對 SQLite 格外重要，因為它的驅動是**同步**的：`this.db.exec('rollback')` 排在 `catch` 裡，
   * 而中間那些 `await` 是包出來的 promise。若哪天有人把 `await run(...)` 拿掉，回滾就會在寫入完成前
   * 執行，而 SQLite 會（合理地）什麼都不做 —— 這條測試會紅。
   * Transactions must really roll back. This writes half a transaction: insert one row, make a second
   * statement fail, then check the first did not survive. `saveScore`'s path is already covered against
   * a real database (`leaves no half-written score …`); this checks the driver's own three lines of
   * `begin` / `commit` / `rollback`.
   *
   * It matters especially on SQLite because that driver is **synchronous**: `this.db.exec('rollback')`
   * sits in the `catch`, and the `await`s in between are wrapper promises. Remove the `await run(...)`
   * some day and the rollback fires before the write finishes — SQLite would then (correctly) do
   * nothing. This is the test that goes red.
   */
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

        /* 這一句會撞上主鍵。 */
        await tx.query('insert into profiles (device_id) values (?)', [device]);
      }),
    ).rejects.toThrow();

    expect(await count('profiles', 'device_id', device)).toBe(0);

    await driver.close();
  });

  /*
   * 交易的巢狀呼叫不會開第二層 —— `Driver.transaction` 的介面承諾（見 `types.ts`：MySQL 的巢狀
   * `begin` 是隱式提交）。SQLite 上這條路的後果比 MySQL 輕（它會直接報「不能 begin 一個交易」），
   * 但介面是同一個，所以行為也要一樣。
   * A nested `transaction` call must not open a second layer — the interface's promise (see `types.ts`:
   * a nested `begin` in MySQL is an implicit commit). The consequences are milder on SQLite than on
   * MySQL (it just refuses to begin a transaction), but it is the same interface, so the behaviour has
   * to match.
   */
  it('does not open a second transaction when one is already running', async () => {
    const { driver, count } = await scratch();
    await ensureSchema(driver, dialectFor('sqlite'));

    const device = `it-nested-${ROUND}`;

    await driver.transaction(async (tx) => {
      /* 同一條連線上再要一個交易：應該直接跑，而不是 `begin` 第二次。 */
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
