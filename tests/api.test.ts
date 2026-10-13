/**
 * 後端的單元測試：設定、上界、憑證、處理器與外殼。
 * Backend unit tests: config, bounds, tokens, handlers and the shell.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  handleHealth,
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
import { MemoryStore, type Store } from '../api/_lib/store';
import { isValidDeviceId, signRunToken, tokenFingerprint, verifyRunToken } from '../api/_lib/tokens';

const SECRET = 'a'.repeat(48);
const DEVICE = 'device-0000-1111';
const OTHER_DEVICE = 'another-device-77';
const VERSION = '0.1.0';

const GOOD_RUN = { score: 900, merges: 30, drops: 40, maxCombo: 5, durationMs: 60_000 };

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    databaseUrl: 'postgresql://user:pass@host/db',
    dbDialect: 'postgres',
    runTokenSecret: SECRET,
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
 * 玩一局然後提交：開局、把時鐘往前推（否則宣稱的時長站不住）、再送成績。
 * Play a run and submit it: start, advance the clock (or the claimed duration fails), then submit.
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

function board(deps: Deps, query = ''): Promise<ApiResponse> {
  return handleLeaderboard(request('GET', null, { query }), deps).then((result) => result.response);
}

describe('readConfig — 環境變數 / environment variables', () => {
  it('names what is missing rather than starting without it', () => {
    expect(readConfig({})).toEqual({ ok: false, missing: ['DATABASE_URL', 'RUN_TOKEN_SECRET'] });
    expect(readConfig({ DATABASE_URL: 'postgres://x' })).toEqual({
      ok: false,
      missing: ['RUN_TOKEN_SECRET'],
    });
  });

  it('treats a short secret as missing', () => {
    expect(readConfig({ DATABASE_URL: 'postgres://x', RUN_TOKEN_SECRET: 'too-short' }).ok).toBe(false);
  });

  it('defaults to the conservative side', () => {
    const result = readConfig({ DATABASE_URL: 'postgres://x', RUN_TOKEN_SECRET: SECRET });
    if (!result.ok) throw new Error('expected a valid config');

    expect(result.config.allowedOrigins).toEqual([]);
    expect(result.config.submissionsPerHour).toBe(20);
  });

  it('parses an origin list', () => {
    const result = readConfig({
      DATABASE_URL: 'postgres://x',
      RUN_TOKEN_SECRET: SECRET,
      ALLOWED_ORIGIN: 'https://a.example , https://b.example',
    });
    if (!result.ok) throw new Error('expected a valid config');

    expect(result.config.allowedOrigins).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('limits — 上界與配置同步 / the bounds track the game config', () => {
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
    expect(checkClaimedDuration(10_000, issued, issued + 60_000, 5_000)).toEqual({ verified: true });
  });

  it('rejects a duration longer than the time that has actually passed', () => {
    expect(checkClaimedDuration(60_000, issued, issued + 30_000, 5_000)).toMatchObject({
      verified: false,
      reason: 'duration_exceeds_elapsed',
    });
    expect(checkClaimedDuration(3_600_000, issued, issued + 60_000, 5_000)).toMatchObject({
      verified: false,
      reason: 'duration_exceeds_elapsed',
    });
  });
});

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

describe('requests — 接收紀錄不收個人資料 / the receive log holds no personal data', () => {
  /**
   * 私隱硬規則：請求落的庫不含 IP 與標頭。
   * Hard privacy rule: a persisted request carries no IP and no headers.
   */
  it('stores no address and no header, not even a credential', async () => {
    const { deps, store } = makeDeps();
    setDependencies(deps);

    /**
     * 走完整的外殼（`endpoint`）：接收紀錄由外殼寫入，直接呼叫處理器不會落列。
     * Through the full shell (`endpoint`): the receive log is the shell's job, so calling the handler writes no row.
     */
    const response = await endpoint(handleRunStart)(
      request('POST', { deviceId: DEVICE, version: VERSION }, {
        headers: {
          'user-agent': 'vitest',
          'x-forwarded-for': '198.51.100.7, 70.41.3.18',
          'x-vercel-ip-city': 'Hong Kong',
          cookie: 'session=super-secret',
          authorization: 'Bearer super-secret',
        },
      }),
    );
    expect(response.status).toBe(200);

    const row = store.lastRequest;
    expect(row).toMatchObject({ method: 'POST', path: '/api/test' });

    const stored = JSON.stringify(row);
    expect(stored).not.toContain('198.51.100.7');
    expect(stored).not.toContain('super-secret');
    expect(stored).not.toContain('Hong Kong');
    expect(stored).not.toContain('user-agent');

    setDependencies(null);
  });
});

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

  /* 憑證綁在開局的裝置；換裝置提交會被擋。 */
  /* A token is bound to the device that started the run. */
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
    advance(deps.config.runTokenTtlMs + 1);

    const result = await submitRun(deps, started, GOOD_RUN);
    expect(result.status).toBe(401);
  });

  it('marks a run that claims more time than has passed, and keeps it out of the board', async () => {
    const { deps, store, advance } = makeDeps();

    const started = await startRun(deps);
    advance(10_000);

    const result = await submitRun(deps, started, GOOD_RUN);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ verified: false, reason: 'duration_exceeds_elapsed' });

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

  /**
   * 冪等：同一張憑證與同一個局號重送要拿回同一個裁決（先查既有成績，再驗 `used_at`）。
   * Idempotent: the same token and run id return the same verdict (the stored score is checked before `used_at`).
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

  it('orders each tab by its own column', async () => {
    const { deps, advance } = makeDeps();

    const submissions = [
      ['player-scored-1111', { ...GOOD_RUN, score: 5_000, maxCombo: 3, merges: 40, drops: 80 }],
      ['player-comboed-2222', { ...GOOD_RUN, score: 120, maxCombo: 90, merges: 100, drops: 120 }],
    ] as const;

    for (const [deviceId, run] of submissions) {
      const started = await startRun(deps, deviceId);
      advance(run.durationMs);
      expect((await submitRun(deps, started, run, deviceId)).status).toBe(200);
    }

    const scoreBoard = (await board(deps, 'category=score')).body as {
      category: string;
      entries: { score: number; maxCombo: number }[];
    };
    const comboBoard = (await board(deps, 'category=combo')).body as typeof scoreBoard;

    expect(scoreBoard.category).toBe('score');
    expect(comboBoard.category).toBe('combo');

    expect(scoreBoard.entries.map((entry) => entry.score)).toEqual([5_000, 120]);
    expect(comboBoard.entries.map((entry) => entry.maxCombo)).toEqual([90, 3]);
  });

  it('gives every board row a four-digit tag that does not move between fetches', async () => {
    const { deps, advance } = makeDeps();

    await play(deps, advance, GOOD_RUN);

    const read = async (): Promise<{ entries: { name: string; tag: string }[]; self: { tag: string } }> =>
      (await board(deps, `deviceId=${DEVICE}`)).body as never;

    const first = await read();
    expect(first.entries[0]?.tag).toMatch(/^\d{4}$/u);
    expect(first.self.tag).toBe(first.entries[0]?.tag);

    const second = await read();
    expect(second.entries[0]?.tag).toBe(first.entries[0]?.tag);
  });

  it('reports the self rank for the requested tab', async () => {
    const { deps, advance } = makeDeps();

    const scored = 'player-scored-1111';
    const comboed = 'player-comboed-2222';

    for (const [deviceId, run] of [
      [scored, { ...GOOD_RUN, score: 5_000, maxCombo: 3, merges: 40, drops: 80 }],
      [comboed, { ...GOOD_RUN, score: 120, maxCombo: 90, merges: 100, drops: 120 }],
    ] as const) {
      const started = await startRun(deps, deviceId);
      advance(run.durationMs);
      await submitRun(deps, started, run, deviceId);
    }

    const rankOn = async (category: string): Promise<number> => {
      const body = (await board(deps, `category=${category}&deviceId=${comboed}`)).body as {
        self: { rank: number };
      };
      return body.self.rank;
    };

    expect(await rankOn('combo')).toBe(1);
    expect(await rankOn('score')).toBe(2);
  });

  it('falls back to the score board for an unknown category', async () => {
    const { deps } = makeDeps();

    for (const query of ['category=nope', 'category=SCORE', 'category=', 'category']) {
      const response = await board(deps, query);

      expect(response.status, query).toBe(200);
      expect((response.body as { category: string }).category, query).toBe('score');
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

class BrokenStore extends MemoryStore {
  constructor(private readonly failure: unknown) {
    super();
  }

  override async countProfiles(): Promise<number> {
    throw this.failure;
  }
}

describe('health — 真的問一次資料庫 / it really asks', () => {
  it('reports the dialect and the player count', async () => {
    const { deps } = makeDeps();

    const result = await handleHealth(request('GET', null), deps);

    expect(result.response.status).toBe(200);
    expect(result.response.body).toMatchObject({ ok: true, database: 'postgres', players: 0 });
    expect(JSON.stringify(result.response.body)).not.toContain('postgresql://');
  });

  it('reports the dialect that is actually configured', async () => {
    const { deps } = makeDeps({ dbDialect: 'mysql' });

    expect((await handleHealth(request('GET', null), deps)).response.body).toMatchObject({
      database: 'mysql',
    });
  });

  it('answers 503 when the database is unreachable', async () => {
    const config = makeConfig();
    const deps: Deps = {
      config,
      store: new BrokenStore(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })),
      now: () => 0,
    };

    const result = await handleHealth(request('GET', null), deps);

    expect(result.response.status).toBe(503);
    expect(result.response.body).toMatchObject({ error: { code: 'database_unreachable' } });
  });

  it('answers 500 when the database rejects the query', async () => {
    const deps: Deps = {
      config: makeConfig(),
      store: new BrokenStore(Object.assign(new Error('relation "profiles" does not exist'), {
        code: '42P01',
      })),
      now: () => 0,
    };

    const result = await handleHealth(request('GET', null), deps);

    expect(result.response.status).toBe(500);
    expect(result.response.body).toMatchObject({ error: { code: 'database_error' } });
    expect(JSON.stringify(result.response.body)).not.toContain('profiles');
  });

  it('refuses a non-GET', async () => {
    const { deps } = makeDeps();

    expect((await handleHealth(request('POST', {}), deps)).response.status).toBe(405);
  });
});

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
    });
    expect(store.lastRequest).not.toHaveProperty('clientIp');
    expect(store.lastRequest).not.toHaveProperty('userAgent');

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
    expect(store.requestCount).toBe(1);

    setDependencies(null);
  });

  it('keeps the response shape stable', () => {
    const shape: ApiResponse = { status: 200, body: { ok: true } };
    expect(shape.status).toBe(200);
  });
});

/* `MemoryStore` 必須滿足 `Store`；不符時型別檢查就會失敗。 */
/* `MemoryStore` must satisfy the `Store` type, so a drift fails type checking. */
const storeContract: Store = new MemoryStore();
void storeContract;
