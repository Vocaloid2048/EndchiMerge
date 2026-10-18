/**
 * 伺服器版排行榜資料層的單元測試。
 * Unit tests for the server-backed leaderboard data layer.
 */

import { describe, expect, it } from 'vitest';

import type { LeaderboardSource } from '../src/game/leaderboard';
import type { StorageBackend } from '../src/game/localStore';
import { createRemoteLeaderboard } from '../src/game/remoteLeaderboard';

const TIME = 1_700_000_000_000;
const TEST_SALT = 'test-salt';
const KEYS = { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' };

class FakeStorage implements StorageBackend {
  private readonly map = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('quota exceeded');
    this.map.set(key, value);
  }
}

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | null;
  readonly keepalive: boolean;
}

interface Reply {
  status?: number;
  body?: unknown;
  raw?: string;
  throws?: boolean;
}

const OK_START = { ok: true, deviceId: 'me', runId: 'run-1', token: 'tok-1', issuedAt: TIME };
const OK_SCORE = { ok: true, verified: true, reason: null, rank: 1, best: { score: 0 } };

const OK_BOARD = {
  ok: true,
  category: 'score',
  total: 5,
  entries: [
    { rank: 1, name: '阿爺', tag: '0001', score: 9000, durationMs: 60_000, maxCombo: 9, merges: 40, at: TIME },
    { rank: 2, name: '阿嬤', tag: '0002', score: 4000, durationMs: 30_000, maxCombo: 4, merges: 20, at: TIME - 1 },
  ],
  self: { rank: 3, name: '我', tag: '0003', score: 900, durationMs: 20_000, maxCombo: 6, merges: 12, at: TIME - 2 },
};

interface Harness {
  readonly board: LeaderboardSource;
  readonly calls: Call[];
  readonly storage: FakeStorage;
  readonly submissions: () => Call[];
  readonly fetches: () => Call[];
}

function makeHarness(options: {
  reply?: (call: Call, nth: number) => Reply | undefined;
  limit?: number;
  playerId?: string;
} = {}): Harness {
  const storage = new FakeStorage();
  const calls: Call[] = [];
  let runs = 0;

  const fetcher = async (url: string, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>),
      keepalive: init?.keepalive === true,
    };

    calls.push(call);

    const overridden = options.reply?.(call, calls.length - 1);
    if (overridden?.throws === true) throw new TypeError('Failed to fetch');

    let reply: Reply;

    if (overridden !== undefined) {
      reply = overridden;
    } else if (call.url === '/api/run/start') {
      runs += 1;
      reply = { body: { ...OK_START, runId: `run-${String(runs)}`, token: `tok-${String(runs)}` } };
    } else if (call.url === '/api/score') {
      reply = { body: OK_SCORE };
    } else {
      reply = { body: OK_BOARD };
    }

    const status = reply.status ?? 200;
    const payload = reply.raw ?? JSON.stringify(reply.body ?? null);

    return new Response(status === 204 || status === 304 ? null : payload, {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };

  const board = createRemoteLeaderboard({
    storage,
    keys: KEYS,
    salt: TEST_SALT,
    playerId: options.playerId ?? 'me',
    now: (): number => TIME,
    version: '9.9.9',
    fetch: fetcher,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });

  return {
    board,
    calls,
    storage,
    submissions: (): Call[] => calls.filter((call) => call.url === '/api/score'),
    fetches: (): Call[] => calls.filter((call) => call.url.startsWith('/api/leaderboard')),
  };
}

/**
 * 讓排隊中的 promise 跑完：用真的 macrotask，`setTimeout(0)` 後 microtask 必定清空。
 * Lets queued promises settle: one real macrotask, after which every microtask has drained.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

async function startRun(board: LeaderboardSource): Promise<void> {
  board.beginRun?.();
  await settle();
}

describe('createRemoteLeaderboard — 同意之前 / before consent', () => {
  it('does not talk to the server at all', () => {
    const { board, calls } = makeHarness();

    expect(board.snapshot('score')).toEqual({ category: 'score', entries: [], self: null });
    expect(board.sharing).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('starts uploading and fetching the moment consent is given', async () => {
    const { board, calls } = makeHarness();

    board.setSharing(true);
    await settle();

    expect(board.sharing).toBe(true);
    expect(calls.some((call) => call.url.startsWith('/api/leaderboard'))).toBe(true);
  });
});

describe('createRemoteLeaderboard — 開局的憑證 / the run token', () => {
  it('mints one on beginRun, sending the device id the client already has', async () => {
    const { board, calls } = makeHarness();

    await startRun(board);

    expect(calls[0]).toMatchObject({ url: '/api/run/start', method: 'POST', body: { deviceId: 'me' } });
  });

  it('mints a fresh token for every run, not one shared token', async () => {
    const { board, calls } = makeHarness();

    await startRun(board);
    board.beginRun?.();
    await settle();

    const tokens = calls.filter((call) => call.url === '/api/run/start').map((call) => call.body);
    expect(tokens).toHaveLength(2);
  });

  it('does not start a second run for the same one', async () => {
    const { board, calls } = makeHarness();

    board.beginRun?.();
    board.beginRun?.();
    await settle();

    expect(calls.filter((call) => call.url === '/api/run/start')).toHaveLength(1);
  });

  it('survives the server refusing to start a run', async () => {
    const { board, calls } = makeHarness({
      reply: (call) => (call.url === '/api/run/start' ? { status: 429, body: { ok: false } } : undefined),
    });

    await startRun(board);
    board.setSharing(true);
    await settle();

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });

    expect(board.sync()).toBe(false);
    expect(calls.filter((call) => call.url === '/api/score')).toHaveLength(0);
  });
});

describe('createRemoteLeaderboard — 提交哪一局 / which run is submitted', () => {
  it("submits the run's own numbers, drops included", async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    expect(board.sync()).toBe(true);
    await settle();

    expect(submissions()).toHaveLength(1);
    expect(submissions()[0]?.body).toMatchObject({
      runId: 'run-1',
      token: 'tok-1',
      deviceId: 'me',
      score: 900,
      merges: 12,
      drops: 30,
      maxCombo: 6,
      durationMs: 60_000,
      version: '9.9.9',
    });
  });

  it('never merges two runs into one submission', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 5000, maxCombo: 2, merges: 5, drops: 9, durationMs: 30_000 });
    board.sync();
    await settle();

    await startRun(board);
    board.record({ score: 100, maxCombo: 40, merges: 45, drops: 60, durationMs: 90_000 });
    board.sync();
    await settle();

    expect(submissions()).toHaveLength(2);
    expect(submissions()[0]?.body).toMatchObject({ score: 5000, maxCombo: 2, merges: 5, drops: 9 });
    expect(submissions()[1]?.body).toMatchObject({ score: 100, maxCombo: 40, merges: 45, drops: 60 });
  });

  it("falls back to merges when a run does not report its drops", async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 44, maxCombo: 3, merges: 7 });
    board.sync();
    await settle();

    expect(submissions()[0]?.body).toMatchObject({ merges: 7, drops: 7 });
  });

  it('sends nothing when the run improved no maximum', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 500, maxCombo: 3, merges: 4, drops: 8, durationMs: 30_000 });
    board.sync();
    await settle();

    await startRun(board);
    board.record({ score: 100, maxCombo: 1, merges: 1, drops: 4, durationMs: 10_000 });

    expect(board.sync()).toBe(false);
    expect(submissions()).toHaveLength(1);
  });

  it('does not submit the same run twice', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    expect(board.sync()).toBe(true);
    await settle();

    expect(board.sync()).toBe(false);
    expect(submissions()).toHaveLength(1);
  });

  it('does not submit while a submission is in flight', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    board.sync();
    board.sync();

    await settle();
    expect(submissions()).toHaveLength(1);
  });

  /**
   * 送出途中又刷新：`settled()` 不可以把這次刷新清掉，否則最後一次刷新會永遠送不出去。
   * An improvement arriving mid-flight must survive `settled()`, or the last improvement is never sent.
   */
  it('still uploads an improvement that arrives while the previous upload is in flight', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 300, maxCombo: 3, merges: 10, drops: 15, durationMs: 60_000 });
    expect(board.sync()).toBe(true);

    board.record({ score: 900, maxCombo: 6, merges: 30, drops: 40, durationMs: 90_000 });

    await settle();

    expect(board.sync()).toBe(true);
    expect(submissions()).toHaveLength(2);
    expect(submissions()[1]?.body).toMatchObject({ score: 900, durationMs: 90_000 });
  });
});

describe('createRemoteLeaderboard — 送不出去的時候 / when it cannot get through', () => {
  it('keeps a failed submission pending, and retries it on the next sync', async () => {
    let fail = true;
    const { board, submissions } = makeHarness({
      reply: (call) => (call.url === '/api/score' && fail ? { throws: true } : undefined),
    });

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    board.sync();
    await settle();

    fail = false;
    expect(board.sync()).toBe(true);
    await settle();

    expect(submissions()).toHaveLength(2);
    expect(board.sync()).toBe(false);
  });

  it('clears the pending marker when the submission is refused, rather than retrying forever', async () => {
    const { board, submissions } = makeHarness({
      reply: (call) => (call.url === '/api/score' ? { status: 401, body: { ok: false } } : undefined),
    });

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    board.sync();
    await settle();

    expect(submissions()).toHaveLength(1);
    expect(board.sync()).toBe(false);
  });

  it('keeps a rate-limited submission pending, because 429 means "try later"', async () => {
    const { board, submissions } = makeHarness({
      reply: (call) => (call.url === '/api/score' ? { status: 429, body: { ok: false } } : undefined),
    });

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    board.sync();
    await settle();

    expect(board.sync()).toBe(true);
    expect(submissions()).toHaveLength(2);
  });

  /**
   * 合理與不合理的提交都回 200，只差在 `verified`。
   * Both plausible and implausible submissions return 200, differing only in `verified`.
   */
  it('treats an accepted-but-not-counted submission as settled', async () => {
    const { board, submissions } = makeHarness({
      reply: (call) =>
        call.url === '/api/score'
          ? { body: { ok: true, verified: false, reason: 'merges_exceed_drops', rank: null, best: {} } }
          : undefined,
    });

    board.setSharing(true);
    await settle();
    await startRun(board);

    board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
    expect(board.sync()).toBe(true);
    await settle();

    expect(submissions()).toHaveLength(1);
    expect(board.sync()).toBe(false);
  });

  it('never lets a failed upload reach the game', async () => {    const { board } = makeHarness({
      reply: (call) => (call.url === '/api/score' ? { throws: true } : undefined),
    });

    board.setSharing(true);
    await settle();
    await startRun(board);

    expect(() => {
      board.record({ score: 900, maxCombo: 6, merges: 12, drops: 30, durationMs: 60_000 });
      board.sync();
    }).not.toThrow();

    expect(board.record({ score: 5000, maxCombo: 9, merges: 40, drops: 80 })).toBe(true);
  });
});

describe('createRemoteLeaderboard — 讀榜 / reading the board', () => {
  it('asks for the tab, the limit and itself', async () => {
    const { board, fetches } = makeHarness({ limit: 20 });

    board.setSharing(true);
    await settle();

    expect(fetches()).toHaveLength(3);
    expect(fetches()[0]?.url).toBe('/api/leaderboard?category=score&limit=20&deviceId=me&mode=all');
    expect(fetches().map((call) => new URL(`https://x${call.url}`).searchParams.get('category'))).toEqual([
      'score',
      'combo',
      'merges',
    ]);
  });

  it('shows the server board and the player own rank', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    const snapshot = board.snapshot('score');
    expect(snapshot.entries.map((entry) => entry.name)).toEqual(['阿爺', '阿嬤']);
    expect(snapshot.entries[0]).toMatchObject({ score: 9000, durationMs: 60_000, maxCombo: 9, merges: 40 });
    expect(snapshot.self).toMatchObject({ rank: 3, total: 5, beats: 40 });
  });

  it('does not leak a fake id into the rows', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    expect(board.snapshot('score').entries.every((entry) => entry.id === '')).toBe(true);
  });

  it('honours a per-call limit', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    expect(board.snapshot('score', 1).entries).toHaveLength(1);
    expect(board.snapshot('score').entries).toHaveLength(2);
  });

  it('stays empty until the first fetch lands, then notifies', async () => {
    const { board } = makeHarness();

    board.setSharing(true);

    let notified = 0;
    board.subscribe(() => {
      notified += 1;
    });

    expect(board.snapshot('score').entries).toHaveLength(0);
    await settle();

    expect(board.snapshot('score').entries).toHaveLength(2);
    expect(notified).toBeGreaterThan(0);
  });

  it('does not stampede when asked to refresh twice in a row', async () => {
    const { board, fetches } = makeHarness();

    board.setSharing(true);
    board.refresh?.();
    board.refresh?.();
    await settle();

    expect(fetches()).toHaveLength(3);
  });

  it('keeps the last board when a refresh fails', async () => {
    let fail = false;
    const { board } = makeHarness({
      reply: (call) => (call.url.startsWith('/api/leaderboard') && fail ? { throws: true } : undefined),
    });

    board.setSharing(true);
    await settle();
    expect(board.snapshot('score').entries).toHaveLength(2);

    fail = true;
    board.refresh?.();
    await settle();

    expect(board.snapshot('score').entries).toHaveLength(2);
  });

  it('survives a gateway answering with a 500 and an HTML page', async () => {
    const { board } = makeHarness({
      reply: (call) =>
        call.url.startsWith('/api/leaderboard') ? { status: 500, raw: '<html>oops</html>' } : undefined,
    });

    board.setSharing(true);
    await settle();

    expect(() => board.snapshot('score')).not.toThrow();
    expect(board.snapshot('score').entries).toHaveLength(0);
  });

  it('drops only the malformed row rather than the whole board', async () => {
    const { board } = makeHarness({
      reply: (call) =>
        call.url.startsWith('/api/leaderboard')
          ? {
              body: {
                ...OK_BOARD,
                entries: [OK_BOARD.entries[0], { name: '壞掉的一列' }, OK_BOARD.entries[1]],
              },
            }
          : undefined,
    });

    board.setSharing(true);
    await settle();

    expect(board.snapshot('score').entries).toHaveLength(2);
  });

  it('carries the tag through, and drops one that is not four digits', async () => {
    const { board } = makeHarness({
      reply: (call) =>
        call.url.startsWith('/api/leaderboard')
          ? {
              body: {
                ...OK_BOARD,
                entries: [{ ...OK_BOARD.entries[0], tag: '42' }, { ...OK_BOARD.entries[1], tag: 'abcd' }],
                self: { ...OK_BOARD.self, tag: '0003' },
              },
            }
          : undefined,
    });

    board.setSharing(true);
    await settle();

    const snapshot = board.snapshot('score');
    expect(snapshot.entries.map((entry) => entry.tag)).toEqual(['', '']);
    expect(snapshot.self?.entry.tag).toBe('0003');
  });
});

describe('createRemoteLeaderboard — 改名 / renaming', () => {
  it('renames the cached row at once, because the server only learns on the next submission', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    board.setDisplayName('新名字');

    expect(board.snapshot('score').self?.entry.name).toBe('新名字');
    expect(board.snapshot('score').entries[0]?.name).toBe('阿爺');
  });

  it('does not add a row and keeps the identity', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    board.setDisplayName('阿爺');
    board.setDisplayName('阿嬤');

    expect(board.snapshot('score').entries).toHaveLength(2);
    expect(board.snapshot('score').self?.entry.name).toBe('阿嬤');
  });
});

describe('createRemoteLeaderboard — 與本機版共用的那一半 / the shared half', () => {
  it('keeps the name, the consent and the local record across sessions', async () => {
    const storage = new FakeStorage();
    const first = makeHarnessWith(storage);
    first.board.setDisplayName('阿爺');
    first.board.setSharing(true);
    first.board.record({ score: 123, maxCombo: 7, merges: 8, drops: 12 });

    const second = makeHarnessWith(storage);
    expect(second.board.displayName).toBe('阿爺');
    expect(second.board.sharing).toBe(true);
    expect(second.board.record({ score: 1, maxCombo: 1, merges: 1 })).toBe(false);
  });

  it('falls back to memory when storage is unavailable', () => {
    const board = createRemoteLeaderboard({ storage: null, fetch: () => Promise.resolve(new Response('{}')) });

    board.setDisplayName('阿爺');
    board.record({ score: 42, maxCombo: 1, merges: 1 });

    expect(board.displayName).toBe('阿爺');
  });

  it('does not crash when the storage refuses to write', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;

    const board = createRemoteLeaderboard({
      storage,
      playerId: 'me',
      salt: TEST_SALT,
      fetch: () => Promise.resolve(new Response('{}')),
    });

    board.setSharing(true);

    expect(() => board.record({ score: 1, maxCombo: 1, merges: 1 })).not.toThrow();
  });

  it('still notifies subscribers on record, rename and consent', () => {
    const { board } = makeHarness();
    let calls = 0;
    board.subscribe(() => {
      calls += 1;
    });

    board.setDisplayName('阿爺');
    board.setSharing(true);
    board.record({ score: 1, maxCombo: 1, merges: 1 });

    expect(calls).toBe(3);

    board.record({ score: 0, maxCombo: 0, merges: 0 });
    expect(calls).toBe(3);
  });
});

function makeHarnessWith(storage: FakeStorage): Harness {
  const calls: Call[] = [];

  const board = createRemoteLeaderboard({
    storage,
    keys: KEYS,
    salt: TEST_SALT,
    playerId: 'me',
    now: (): number => TIME,
    fetch: async (url, init): Promise<Response> => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>),
        keepalive: init?.keepalive === true,
      });

      return new Response(JSON.stringify(url === '/api/leaderboard' ? OK_BOARD : {}), { status: 200 });
    },
  });

  return {
    board,
    calls,
    storage,
    submissions: (): Call[] => calls.filter((call) => call.url === '/api/score'),
    fetches: (): Call[] => calls.filter((call) => call.url.startsWith('/api/leaderboard')),
  };
}

describe('createRemoteLeaderboard — 自己的最高分 / the own best', () => {
  it('resolves the server-side best of this device', async () => {
    const { board } = makeHarness();

    await expect(board.fetchOwnBest?.()).resolves.toBe(OK_BOARD.self.score);
  });

  it('resolves null when the server has no row for this device', async () => {
    const { board } = makeHarness({
      reply: (call) =>
        call.url.startsWith('/api/leaderboard')
          ? { body: { ...OK_BOARD, self: null } }
          : undefined,
    });

    await expect(board.fetchOwnBest?.()).resolves.toBeNull();
  });

  it('resolves null when fetch is unavailable', async () => {
    const global_ = globalThis as { fetch?: typeof fetch };
    const original = global_.fetch;
    global_.fetch = undefined;

    try {
      const board = createRemoteLeaderboard({
        storage: new FakeStorage(),
        keys: KEYS,
        salt: TEST_SALT,
        playerId: 'me',
        now: (): number => TIME,
      });

      await expect(board.fetchOwnBest?.()).resolves.toBeNull();
    } finally {
      global_.fetch = original;
    }
  });
});
