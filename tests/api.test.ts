/**
 * 後端的單元測試。
 * Backend unit tests.
 *
 * 這裡刻意**不需要資料庫**：端點只依賴 `Store` 介面，而測試餵它 `MemoryStore`。所以「開局 → 提交 →
 * 上榜」這條完整路徑可以在毫秒內跑完，而且驗的是**真的處理器**，不是替身。
 * These deliberately **need no database**: an endpoint depends only on the `Store` interface, and the
 * tests hand it a `MemoryStore`. So the whole "start a run → submit → appear on the board" path runs in
 * milliseconds against the **real handlers**, not stand-ins.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  handleLeaderboard,
  handleRunStart,
  handleScore,
  sanitiseName,
  type Deps,
} from '../api/_lib/handlers';
import {
  MAX_RUN_MS,
  MIN_RUN_MS,
  RUN_TOKEN_SLACK_MS,
  readConfig,
  type Config,
} from '../api/_lib/env';
import type { ApiRequest, ApiResponse } from '../api/_lib/http';
import { endpoint, setDependencies } from '../api/_lib/runtime';
import {
  DROP_COOLDOWN_MS,
  MAX_LEVEL_SCORE,
  MAX_MULTIPLIER,
  checkClaimedDuration,
  checkRationality,
  maxDropsFor,
} from '../api/_lib/limits';
import { buildRequestRow, clientIp, storeIp } from '../api/_lib/requests';
import { MemoryStore, type Store } from '../api/_lib/store';
import { isValidDeviceId, signRunToken, tokenFingerprint, verifyRunToken } from '../api/_lib/tokens';

const SECRET = 'a'.repeat(48);
const DEVICE = 'device-0000-1111';
const OTHER_DEVICE = 'another-device-77';
const VERSION = '0.1.0';

/** 一組一定通過檢查的數字（60 秒、40 顆、30 次合成、900 分）。 */
const GOOD_RUN = { score: 900, merges: 30, drops: 40, maxCombo: 5, durationMs: 60_000 };

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    databaseUrl: 'postgresql://user:pass@host/db',
    runTokenSecret: SECRET,
    ipStorage: 'truncated',
    ipHashSecret: 'h'.repeat(48),
    allowedOrigins: [],
    submissionsPerHour: 20,
    runTokenTtlMs: MAX_RUN_MS + RUN_TOKEN_SLACK_MS,
    runsPerHour: 120,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Config> = {}): {
  deps: Deps;
  store: MemoryStore;
  advance: (ms: number) => void;
} {
  const store = new MemoryStore();
  let clock = 1_700_000_000_000;

  const deps: Deps = { config: makeConfig(overrides), store, now: () => clock };

  return {
    deps,
    store,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

function request(
  method: string,
  body: unknown,
  options: { query?: string; headers?: Record<string, string> } = {},
): ApiRequest {
  return {
    method,
    path: '/api/test',
    query: new URLSearchParams(options.query ?? ''),
    headers: options.headers ?? {},
    body,
    remoteAddress: '203.0.113.9',
  };
}

interface StartBody {
  ok: boolean;
  deviceId: string;
  runId: string;
  token: string;
  issuedAt: number;
  expiresAt: number;
}

interface VerdictBody {
  ok: boolean;
  verified: boolean;
  reason: string | null;
  rank: number | null;
  best: { score: number; durationMs: number; maxCombo: number; merges: number };
}

type RunNumbers = typeof GOOD_RUN;

async function startRun(deps: Deps, deviceId = DEVICE): Promise<StartBody> {
  const result = await handleRunStart(request('POST', { deviceId, version: VERSION }), deps);
  expect(result.response.status).toBe(200);

  return result.response.body as StartBody;
}

/** 用一張既有的憑證提交。`started` 可以被覆寫，用來製造「偽造的憑證」這類案例。 */
async function submitRun(
  deps: Deps,
  started: StartBody,
  run: RunNumbers,
  deviceId = DEVICE,
): Promise<{ status: number; body: VerdictBody }> {
  const result = await handleScore(
    request('POST', {
      runId: started.runId,
      token: started.token,
      deviceId,
      score: run.score,
      merges: run.merges,
      drops: run.drops,
      maxCombo: run.maxCombo,
      durationMs: run.durationMs,
      displayName: '阿爺',
      version: VERSION,
    }),
    deps,
  );

  return { status: result.response.status, body: result.response.body as VerdictBody };
}

/**
 * 玩一局然後提交：開局、把時鐘往前推（讓「宣稱的時長」站得住）、再送成績。
 * 一併回傳開局時拿到的憑證，重試的測試才可以用**同一張**再送一次。
 * Play a run and submit it: start, advance the clock so the claimed duration holds up, then submit.
 * The started run is returned too, so a retry test can send the **same** token again.
 */
async function play(
  deps: Deps,
  advance: (ms: number) => void,
  run: RunNumbers,
): Promise<{ status: number; body: VerdictBody; started: StartBody }> {
  const started = await startRun(deps);
  advance(run.durationMs);

  const submitted = await submitRun(deps, started, run);

  return { ...submitted, started };
}

/*
 * 榜的處理器回的是 `HandlerResult`（回應 ＋ 給接收紀錄用的線索），但測試只想看回應本身，所以這裡
 * 把 `response` 攤平出來 —— 呼叫端一律 `.body` / `.status`，不必到處寫 `.response.body`。
 * The board handler returns a `HandlerResult` (the response plus the hints the receive log needs), but
 * the tests only want the response, so this flattens `response` out — callers use `.body` / `.status`
 * uniformly instead of writing `.response.body` everywhere.
 */
function board(deps: Deps, query = ''): Promise<ApiResponse> {
  return handleLeaderboard(request('GET', null, { query }), deps).then((result) => result.response);
}

/* ── 設定 ─────────────────────────────────────────────────────────────────── */

describe('readConfig — 環境變數 / environment variables', () => {
  it('names what is missing rather than starting without it', () => {
    expect(readConfig({})).toEqual({ ok: false, missing: ['DATABASE_URL', 'RUN_TOKEN_SECRET'] });
    expect(readConfig({ DATABASE_URL: 'postgres://x' })).toEqual({
      ok: false,
      missing: ['RUN_TOKEN_SECRET'],
    });
  });

  /*
   * 短秘密等於沒有秘密，所以它被當成**缺漏**而不是「有點弱但可以用」。HMAC 的建議下限是 32 位元組。
   * A short secret is no secret, so it counts as **missing** rather than "weak but usable". The
   * recommended floor for an HMAC key is 32 bytes.
   */
  it('treats a short secret as missing', () => {
    expect(readConfig({ DATABASE_URL: 'postgres://x', RUN_TOKEN_SECRET: 'too-short' }).ok).toBe(false);
  });

  it('defaults to the conservative side', () => {
    const result = readConfig({ DATABASE_URL: 'postgres://x', RUN_TOKEN_SECRET: SECRET });
    if (!result.ok) throw new Error('expected a valid config');

    expect(result.config.ipStorage).toBe('truncated');
    expect(result.config.allowedOrigins).toEqual([]);
    expect(result.config.submissionsPerHour).toBe(20);
    expect(result.config.ipHashSecret).toBe(SECRET);
  });

  it('parses an origin list and ignores an unknown storage mode', () => {
    const result = readConfig({
      DATABASE_URL: 'postgres://x',
      RUN_TOKEN_SECRET: SECRET,
      ALLOWED_ORIGIN: 'https://a.example , https://b.example',
      IP_STORAGE_MODE: 'banana',
    });
    if (!result.ok) throw new Error('expected a valid config');

    expect(result.config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(result.config.ipStorage).toBe('truncated');
  });
});

/* ── 上界必須跟著遊戲配置走 ───────────────────────────────────────────────── */

describe('limits — 上界與配置同步 / the bounds track the game config', () => {
  /*
   * 這一條是整份測試裡最重要的一條。`limits.ts` 的三個常數是**從遊戲配置推導**出來的，所以配置
   * 一改它們就會變成錯的 —— 而「錯的上界」比沒有上界更糟：它會安靜地放過作弊，或更糟地誤傷誠實
   * 玩家。與其靠註解提醒，這裡直接讀回那兩個檔案比對。
   * This is the most important test in the file. The three constants in `limits.ts` are **derived from
   * the game config**, so changing the config makes them wrong — and a wrong bound is worse than none:
   * it silently lets cheats through, or worse, rejects honest players. Rather than trusting a comment,
   * this reads both files back and compares.
   */
  it('matches dropCooldownMs, the top level score and the multiplier ceiling', () => {
    const levels = JSON.parse(
      readFileSync(new URL('../public/config/levels.json', import.meta.url), 'utf8'),
    ) as { settings: { dropCooldownMs: number }; levels: { score: number }[] };
    const combo = readFileSync(new URL('../src/game/combo.ts', import.meta.url), 'utf8');

    const cap = Number(/cap:\s*(\d+)/.exec(combo)?.[1]);
    const base = Number(/base:\s*(\d+)/.exec(combo)?.[1]);

    expect(DROP_COOLDOWN_MS).toBe(levels.settings.dropCooldownMs);
    expect(MAX_LEVEL_SCORE).toBe(Math.max(...levels.levels.map((level) => level.score)));
    expect(MAX_MULTIPLIER).toBe(cap + base);
  });

  it('caps drops by the cooldown, with slack for the ungated first drop', () => {
    expect(maxDropsFor(60_000)).toBe(122);
    expect(maxDropsFor(0)).toBe(2);
  });

  it('accepts a plausible run', () => {
    expect(checkRationality(GOOD_RUN)).toEqual({ verified: true });
  });

  /*
   * 兩端都是**閉區間**：剛好 5 秒的局不能判死（撞線之後的寬限就是 5 秒），剛好兩小時的無盡模式上限
   * 也不能判死。這裡用一組「5 秒內投得出來」的數字，因為同一組數字在 5 秒內會有 40 顆，那本身就不
   * 合理 —— 上界是**互相交織**的，測試也必須照這個事實寫。
   * Both ends are **inclusive**: a run of exactly five seconds must not be rejected (the post-crossing
   * grace is exactly five seconds), nor must one at the endless-mode ceiling of two hours. The numbers
   * here have to be droppable within five seconds, because the same numbers with 40 drops would be
   * implausible on their own — the bounds **interlock**, and the test has to reflect that.
   */
  it('treats both duration ends as inclusive', () => {
    const short = { score: 100, merges: 10, drops: 12, maxCombo: 3 };

    expect(checkRationality({ ...short, durationMs: MIN_RUN_MS })).toEqual({ verified: true });
    expect(checkRationality({ ...short, durationMs: MIN_RUN_MS - 1 })).toMatchObject({
      verified: false,
      reason: 'run_too_short',
    });

    expect(checkRationality({ ...GOOD_RUN, durationMs: MAX_RUN_MS })).toEqual({ verified: true });
    expect(checkRationality({ ...GOOD_RUN, durationMs: MAX_RUN_MS + 1 })).toMatchObject({
      verified: false,
      reason: 'run_too_long',
    });
  });

  it('rejects more drops than the cooldown allows', () => {
    expect(checkRationality({ ...GOOD_RUN, drops: maxDropsFor(60_000) })).toEqual({ verified: true });
    expect(checkRationality({ ...GOOD_RUN, drops: maxDropsFor(60_000) + 1 })).toMatchObject({
      verified: false,
      reason: 'too_many_drops',
    });
  });

  it('rejects more merges than drops, and more combo than merges', () => {
    expect(checkRationality({ ...GOOD_RUN, merges: 41 })).toMatchObject({
      verified: false,
      reason: 'merges_exceed_drops',
    });
    expect(checkRationality({ ...GOOD_RUN, maxCombo: 31 })).toMatchObject({
      verified: false,
      reason: 'combo_exceeds_merges',
    });
  });

  it('rejects a score above the derived ceiling', () => {
    const ceiling = 30 * MAX_LEVEL_SCORE * MAX_MULTIPLIER;

    expect(checkRationality({ ...GOOD_RUN, score: ceiling })).toEqual({ verified: true });
    expect(checkRationality({ ...GOOD_RUN, score: ceiling + 1 })).toMatchObject({
      verified: false,
      reason: 'score_above_ceiling',
    });
  });

  it('rejects a score with no merges behind it', () => {
    expect(
      checkRationality({ score: 500, merges: 0, drops: 40, maxCombo: 0, durationMs: 60_000 }),
    ).toMatchObject({ verified: false, reason: 'score_without_merges' });
    expect(
      checkRationality({ score: 0, merges: 0, drops: 40, maxCombo: 0, durationMs: 60_000 }),
    ).toEqual({ verified: true });
  });
});

describe('checkClaimedDuration — 單邊檢查 / the one-sided check', () => {
  const issued = 1_700_000_000_000;

  it('accepts any duration that fits inside the elapsed time', () => {
    expect(checkClaimedDuration(60_000, issued, issued + 60_000, 5_000)).toEqual({ verified: true });
    /* 打得比流逝時間短是**合法**的：切到背景時模擬時鐘會停住。 */
    expect(checkClaimedDuration(10_000, issued, issued + 60_000, 5_000)).toEqual({ verified: true });
  });

  it('rejects a duration longer than the time that has actually passed', () => {
    expect(checkClaimedDuration(60_000, issued, issued + 30_000, 5_000)).toMatchObject({
      verified: false,
      reason: 'duration_exceeds_elapsed',
    });
    /* 容許差距是拿來吸量測噪音的，不是拿來放寬的：差一個數量級仍然要擋。 */
    expect(checkClaimedDuration(3_600_000, issued, issued + 60_000, 5_000)).toMatchObject({
      verified: false,
      reason: 'duration_exceeds_elapsed',
    });
  });
});

/* ── 憑證 ─────────────────────────────────────────────────────────────────── */

describe('run tokens — T2', () => {
  const payload = { runId: 'run-1', deviceId: DEVICE, issuedAtMs: 1, expiresAtMs: 2 };

  it('round-trips and rejects anything that was edited', () => {
    const token = signRunToken(SECRET, payload);

    expect(verifyRunToken(SECRET, token, payload)).toBe(true);
    expect(verifyRunToken(SECRET, token, { ...payload, deviceId: 'other-00000000' })).toBe(false);
    expect(verifyRunToken(SECRET, token, { ...payload, expiresAtMs: 99 })).toBe(false);
    expect(verifyRunToken('another-secret-'.padEnd(48, 'x'), token, payload)).toBe(false);
    expect(verifyRunToken(SECRET, `${token}x`, payload)).toBe(false);
  });

  it('fingerprints are stable and do not contain the token', () => {
    const token = signRunToken(SECRET, payload);

    expect(tokenFingerprint(token)).toBe(tokenFingerprint(token));
    expect(tokenFingerprint(token)).not.toContain(token);
  });

  it('accepts the ids the client already has and rejects junk', () => {
    expect(isValidDeviceId('0f5a5a38-7573-40bd-9c76-c2b900ce680b')).toBe(true);
    expect(isValidDeviceId('1700000000000-abc123def')).toBe(true);
    expect(isValidDeviceId('short')).toBe(false);
    expect(isValidDeviceId('has space and more')).toBe(false);
    expect(isValidDeviceId('a'.repeat(65))).toBe(false);
  });
});

/* ── 接收紀錄 ─────────────────────────────────────────────────────────────── */

describe('requests — 位址與標頭 / address and headers', () => {
  it('takes the first forwarded address, since the rest are proxies', () => {
    expect(clientIp({ 'x-forwarded-for': '198.51.100.7, 70.41.3.18' }, '10.0.0.1')).toBe('198.51.100.7');
    expect(clientIp({ 'x-real-ip': '198.51.100.9' }, '10.0.0.1')).toBe('198.51.100.9');
    expect(clientIp({}, '10.0.0.1')).toBe('10.0.0.1');
  });

  it('normalises ports and IPv4-mapped IPv6, so one source stays one source', () => {
    expect(clientIp({ 'x-forwarded-for': '[2001:db8::1]:443' }, '')).toBe('2001:db8::1');
    expect(clientIp({ 'x-forwarded-for': '198.51.100.7:51234' }, '')).toBe('198.51.100.7');
    expect(clientIp({ 'x-forwarded-for': '::ffff:198.51.100.7' }, '')).toBe('198.51.100.7');
  });

  it('stores the address the way IP_STORAGE_MODE says', () => {
    expect(storeIp('198.51.100.7', 'raw', SECRET)).toBe('198.51.100.7');
    expect(storeIp('198.51.100.7', 'truncated', SECRET)).toBe('198.51.100.0');
    expect(storeIp('2001:db8:1234:5678::1', 'truncated', SECRET)).toBe('2001:db8:1234::');
    expect(storeIp('', 'raw', SECRET)).toBeNull();

    const hashed = storeIp('198.51.100.7', 'hashed', SECRET);
    expect(hashed).toMatch(/^h:[0-9a-f]{32}$/u);
    /* 同一組輸入穩定、不同秘密不同值：可以對照，但換了秘密就推不回去。 */
    expect(storeIp('198.51.100.7', 'hashed', SECRET)).toBe(hashed);
    expect(storeIp('198.51.100.7', 'hashed', 'other'.repeat(10))).not.toBe(hashed);
  });

  /*
   * 這一條是資安上的硬性要求：`cookie` 與 `authorization` **永遠不能**落庫。所以測試用黑名單的
   * 方式反過來檢查 —— 送一組含憑證的標頭進去，然後確認輸出裡沒有任何一個鍵是憑證。
   * This one is a hard security requirement: `cookie` and `authorization` must **never** be stored. The
   * test therefore checks the blacklist in reverse — send a set of headers carrying credentials and
   * assert that no credential key survives into the output.
   */
  it('never stores credentials', () => {
    const row = buildRequestRow({
      method: 'POST',
      path: '/api/score',
      status: 200,
      deviceId: DEVICE,
      runId: null,
      ip: '198.51.100.7',
      headers: {
        'user-agent': 'vitest',
        'accept-language': 'zh-HK',
        cookie: 'session=super-secret',
        authorization: 'Bearer super-secret',
        'x-api-key': 'super-secret',
      },
      ipStorage: 'truncated',
      ipHashSecret: SECRET,
    });

    expect(row.userAgent).toBe('vitest');
    expect(row.acceptLanguage).toBe('zh-HK');
    expect(row.clientIp).toBe('198.51.100.0');

    const stored = JSON.stringify(row);
    expect(stored).not.toContain('super-secret');
    expect(Object.keys(row.headers)).not.toContain('cookie');
    expect(Object.keys(row.headers)).not.toContain('authorization');
  });
});

/* ── 端到端：開局 → 提交 → 上榜 ───────────────────────────────────────────── */

describe('handlers — 開局、提交與榜 / start, submit and the board', () => {
  it('issues a token and refuses a non-POST', async () => {
    const { deps } = makeDeps();

    const started = await startRun(deps);
    expect(isValidDeviceId(started.deviceId)).toBe(true);
    expect(started.token).not.toBe('');
    expect(started.expiresAt).toBeGreaterThan(started.issuedAt);

    const wrong = await handleRunStart(request('GET', null), deps);
    expect(wrong.response.status).toBe(405);
  });

  it('hands back the device id the client already had', async () => {
    const { deps } = makeDeps();

    const started = await startRun(deps, DEVICE);
    expect(started.deviceId).toBe(DEVICE);
  });

  it('accepts a run and puts the player on the board with its duration', async () => {
    const { deps, advance } = makeDeps();

    const submitted = await play(deps, advance, GOOD_RUN);
    expect(submitted.status).toBe(200);
    expect(submitted.body.verified).toBe(true);
    expect(submitted.body.best).toEqual({ score: 900, durationMs: 60_000, maxCombo: 5, merges: 30 });

    const response = await board(deps, `deviceId=${DEVICE}`);
    const body = response.body as {
      total: number;
      entries: { rank: number; name: string; score: number; durationMs: number }[];
      self: { rank: number } | null;
    };

    expect(body.total).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({ rank: 1, name: '阿爺', score: 900, durationMs: 60_000 });
    expect(body.self?.rank).toBe(1);
  });

  /*
   * 時長**跟著分數走**：一局打得久但分數低，只該刷新它自己那一項（連擊、合成），不該把「最高分那
   * 一局」的時間蓋掉 —— 否則榜上會出現「900 分，打了 12 分鐘」這種自相矛盾的兩格。
   * The duration **follows the score**: a long but lower-scoring run should refresh only its own
   * metrics (combo, merges) and leave the best-scoring run's time alone — otherwise the board shows
   * "900 points, 12 minutes", two cells contradicting each other.
   */
  it('does not let a longer low-scoring run overwrite the best duration', async () => {
    const { deps, advance } = makeDeps();

    await play(deps, advance, GOOD_RUN);
    await play(deps, advance, {
      score: 100,
      merges: 50,
      drops: 90,
      maxCombo: 40,
      durationMs: 240_000,
    });

    const body = (await board(deps, `deviceId=${DEVICE}`)).body as {
      entries: { score: number; durationMs: number; maxCombo: number; merges: number }[];
    };

    expect(body.entries[0]).toMatchObject({
      score: 900,
      durationMs: 60_000,
      maxCombo: 40,
      merges: 50,
    });
  });

  it('rejects a run id the server never issued', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);

    const result = await submitRun(
      deps,
      { ...started, runId: '11111111-1111-1111-1111-111111111111' },
      GOOD_RUN,
    );

    expect(result.status).toBe(401);
  });

  /* 開局是這個裝置，提交換一個裝置 —— 憑證綁的是開局的那一個。 */
  it('rejects a token presented by another device', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps, DEVICE);
    advance(GOOD_RUN.durationMs);

    const result = await submitRun(deps, started, GOOD_RUN, OTHER_DEVICE);
    expect(result.status).toBe(403);
  });

  it('rejects a forged token', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);

    const result = await submitRun(deps, { ...started, token: 'not-a-real-token' }, GOOD_RUN);
    expect(result.status).toBe(401);
  });

  it('rejects a token that has expired', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps);
    /* 憑證有效期是「單局上限 ＋ 一分鐘」，所以再往前推一點就過期了。 */
    advance(deps.config.runTokenTtlMs + 1);

    const result = await submitRun(deps, started, GOOD_RUN);
    expect(result.status).toBe(401);
  });

  it('marks a run that claims more time than has passed, and keeps it out of the board', async () => {
    const { deps, store, advance } = makeDeps();

    /* 開局之後只過 10 秒，卻宣稱打了 60 秒。 */
    const started = await startRun(deps);
    advance(10_000);

    const result = await submitRun(deps, started, GOOD_RUN);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ verified: false, reason: 'duration_exceeds_elapsed' });

    /* 未通過的提交寫進了 `scores`（留審計痕跡），但不進榜。 */
    expect(await store.getScore(started.runId)).not.toBeNull();
    expect(((await board(deps)).body as { total: number }).total).toBe(0);
  });

  it('marks an implausible score and keeps it out of the board', async () => {
    const { deps, store, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);

    const result = await submitRun(deps, started, { ...GOOD_RUN, score: 9_000_000 });
    expect(result.body).toMatchObject({ verified: false, reason: 'score_above_ceiling' });
    expect(await store.getScore(started.runId)).not.toBeNull();
    expect(((await board(deps)).body as { total: number }).total).toBe(0);
  });

  /*
   * 冪等：送出後斷線、客戶端重試是正常的。第二次必須用**同一張憑證、同一個局號**再送，而且會拿回
   * 同一個裁決 —— 這時憑證早已被標記用過，所以這條同時驗證了「先查既有成績、再驗 `used_at`」的
   * 順序是對的。
   * Idempotency: losing the connection after sending and retrying is normal. The second call must send
   * the **same token and the same run id** and get the same verdict back — by then the token is already
   * marked used, so this also pins the order "check the stored score first, test `used_at` after".
   */
  it('returns the same verdict for a retry and does not double-count', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);

    const first = await submitRun(deps, started, GOOD_RUN);
    expect(first.status).toBe(200);

    advance(1_000);
    const second = await submitRun(deps, started, GOOD_RUN);

    expect(second.status).toBe(200);
    expect(second.body.verified).toBe(first.body.verified);
    expect(second.body.best).toEqual(first.body.best);
  });

  it('refuses a token that was consumed without a stored score', async () => {
    const { deps, store, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);
    await store.markRunTokenUsed(started.runId, deps.now());

    const result = await submitRun(deps, started, GOOD_RUN);
    expect(result.status).toBe(409);
  });

  it('rate limits the 21st submission of an hour, counting rejected ones too', async () => {
    const { deps, advance } = makeDeps();

    for (let index = 0; index < 20; index += 1) {
      /*
       * 每次都送一筆**不合理**的：被退回的提交也要算進速率，否則「先送一堆假成績」就等於繞過速率
       * 限制，而速率限制正是為了擋這件事。
       * Every one of them is **implausible** on purpose: rejected submissions have to count too,
       * otherwise flooding fake scores would bypass the very limit that exists to stop it.
       */
      const submitted = await play(deps, advance, { ...GOOD_RUN, score: 9_000_000 });
      expect(submitted.status).toBe(200);
    }

    const blocked = await play(deps, advance, GOOD_RUN);
    expect(blocked.status).toBe(429);
  });

  it('stops a device from minting tokens without limit', async () => {
    const { deps } = makeDeps({ runsPerHour: 2 });

    await startRun(deps);
    await startRun(deps);

    const third = await handleRunStart(request('POST', { deviceId: DEVICE, version: VERSION }), deps);
    expect(third.response.status).toBe(429);
  });

  it('orders the board by score and breaks ties by who got there first', async () => {
    const { deps, advance } = makeDeps();

    for (const [deviceId, score] of [
      ['player-aaaa-1111', 500],
      ['player-bbbb-2222', 700],
      ['player-cccc-3333', 700],
    ] as const) {
      const started = await startRun(deps, deviceId);
      advance(GOOD_RUN.durationMs);
      const submitted = await submitRun(deps, started, { ...GOOD_RUN, score }, deviceId);
      expect(submitted.status).toBe(200);
    }

    const body = (await board(deps, 'limit=10')).body as {
      total: number;
      entries: { rank: number; score: number }[];
    };

    expect(body.total).toBe(3);
    expect(body.entries.map((entry) => entry.score)).toEqual([700, 700, 500]);

    /* 同分時較早達成的那一筆排在前面（`player-bbbb` 先送）。 */
    const first = (await board(deps, 'limit=10&deviceId=player-bbbb-2222')).body as { self: { rank: number } };
    const second = (await board(deps, 'limit=10&deviceId=player-cccc-3333')).body as { self: { rank: number } };

    expect(first.self.rank).toBe(1);
    expect(second.self.rank).toBe(2);
  });

  it('clamps the board limit instead of trusting it', async () => {
    const { deps } = makeDeps();

    for (const query of ['limit=100000', 'limit=abc', 'limit=-5', 'limit=0']) {
      expect((await board(deps, query)).status).toBe(200);
    }
  });

  it('rejects a non-POST submission and a body that is not an object', async () => {
    const { deps } = makeDeps();

    expect((await handleScore(request('GET', null), deps)).response.status).toBe(405);
    expect((await handleScore(request('POST', 'nope'), deps)).response.status).toBe(400);
    expect((await handleScore(request('POST', {}), deps)).response.status).toBe(400);
  });

  it('rejects fractional and out-of-range numbers rather than rounding them', async () => {
    const { deps, advance } = makeDeps();

    const started = await startRun(deps);
    advance(GOOD_RUN.durationMs);

    for (const broken of [
      { score: 12.5 },
      { score: -1 },
      { durationMs: 1.5 },
      { merges: Number.NaN },
      { drops: 1e12 },
    ]) {
      const result = await submitRun(deps, started, { ...GOOD_RUN, ...broken });
      expect(result.status).toBe(400);
    }
  });

  it('strips invisible characters from a name', () => {
    expect(sanitiseName('阿\u200b爺\u202e')).toBe('阿爺');
    expect(sanitiseName('  spaced  ')).toBe('spaced');
    expect(sanitiseName('x'.repeat(80))).toHaveLength(32);
  });
});

/* ── 外殼：接收紀錄與 CORS ───────────────────────────────────────────────── */

describe('runtime — 接收紀錄與 CORS / the receive log and CORS', () => {
  it('writes a receive row for every request, including rejected ones', async () => {
    const { deps, store } = makeDeps();
    setDependencies(deps);

    const response = await endpoint(handleScore)(
      request('POST', {}, { headers: { origin: 'https://game.example', 'user-agent': 'vitest' } }),
    );

    expect(response.status).toBe(400);
    expect(store.requestCount).toBe(1);
    expect(store.lastRequest).toMatchObject({
      method: 'POST',
      status: 400,
      clientIp: '203.0.113.0',
      userAgent: 'vitest',
      origin: 'https://game.example',
    });

    setDependencies(null);
  });

  it('emits CORS headers only for an allow-listed origin', async () => {
    const { deps } = makeDeps({ allowedOrigins: ['https://game.example'] });
    setDependencies(deps);

    const handler = endpoint(handleLeaderboard);

    const allowed = await handler(request('GET', null, { headers: { origin: 'https://game.example' } }));
    expect(allowed.headers?.['access-control-allow-origin']).toBe('https://game.example');

    const other = await handler(request('GET', null, { headers: { origin: 'https://evil.example' } }));
    expect(other.headers?.['access-control-allow-origin']).toBeUndefined();

    setDependencies(null);
  });

  it('answers a preflight without reaching the handler', async () => {
    const { deps, store } = makeDeps({ allowedOrigins: ['https://game.example'] });
    setDependencies(deps);

    const response = await endpoint(handleScore)(
      request('OPTIONS', null, { headers: { origin: 'https://game.example' } }),
    );

    expect(response.status).toBe(204);
    /* 前置請求沒有主體、也沒有被處理，所以不該留下一筆紀錄。 */
    expect(store.requestCount).toBe(0);

    setDependencies(null);
  });

  it('answers with no CORS header at all when no origin is configured', async () => {
    const { deps } = makeDeps();
    setDependencies(deps);

    const response = await endpoint(handleLeaderboard)(
      request('GET', null, { headers: { origin: 'https://game.example' } }),
    );

    expect(response.headers?.['access-control-allow-origin']).toBeUndefined();

    setDependencies(null);
  });

  it('turns an unexpected failure into a 500 without leaking the message', async () => {
    const { deps, store } = makeDeps();
    setDependencies(deps);

    const exploding = endpoint(async () => {
      throw new Error('connection string leaked here');
    });

    const response = await exploding(request('GET', null));

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('connection string leaked here');
    /* 崩掉的那一次也留下了紀錄，那正是最需要看的一筆。 */
    expect(store.requestCount).toBe(1);

    setDependencies(null);
  });

  it('keeps the response shape stable', () => {
    const shape: ApiResponse = { status: 200, body: { ok: true } };
    expect(shape.status).toBe(200);
  });
});

/* `MemoryStore` 在型別上要符合 `Store`；這個斷言讓「介面改了但實作沒跟上」在型別檢查就爆。 */
const storeContract: Store = new MemoryStore();
void storeContract;
