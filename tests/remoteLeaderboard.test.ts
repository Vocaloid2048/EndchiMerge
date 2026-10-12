/**
 * 伺服器版排行榜資料層的單元測試。
 * Unit tests for the server-backed leaderboard data layer.
 *
 * 這一支是把「榜從哪裡來」換成 `fetch` 之後，**唯一**驗得到那條線的東西。三件事最重要：
 * This is the only thing that checks the line after "where the board comes from" became `fetch`.
 * Three things matter most:
 *
 *   1. **提交的是某一局自己的數字，不是本機紀錄。** 本機紀錄的三個最大值可能來自不同的局，湊在
 *      一起送會被伺服器判成不合理（`merges_exceed_drops` 之類）—— 而那是對的。所以「換局之後送的
 *      是新的那一局」必須被釘住。
 *      **What is submitted is one run's own numbers, not the local record.** The local record's
 *      three maxima may come from different runs, and sending them together is rejected as
 *      implausible by the server — correctly. So "after a run boundary, what goes up is the new
 *      run" has to be pinned.
 *   2. **失敗不會讓遊戲受傷，也不會讓榜消失。** 上載失敗留著下次再送、抓榜失敗保留舊的榜、
 *      4xx 才清標記。
 *      **A failure harms neither the game nor the board**: a failed upload stays pending, a failed
 *      fetch keeps the old board, and only a 4xx clears the marker.
 *   3. **憑證在開局時鑄。** 提交時才鑄的話，伺服器的「時長不得超過實際流逝時間」永遠不成立。
 *      **The token is minted at the start of a run.** Minting at submission would make the server's
 *      "duration cannot exceed elapsed time" check permanently fail.
 *
 * `fetch` 是注入的，所以整個檔案不碰網路、不起伺服器，而且是確定性的。
 * `fetch` is injected, so the whole file touches neither the network nor a server, and is
 * deterministic.
 */

import { describe, expect, it } from 'vitest';

import type { LeaderboardSource } from '../src/game/leaderboard';
import type { StorageBackend } from '../src/game/localStore';
import { createRemoteLeaderboard } from '../src/game/remoteLeaderboard';

/** 固定時鐘，讓斷言不必容忍時間。 */
const TIME = 1_700_000_000_000;
const TEST_SALT = 'test-salt';
const KEYS = { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' };

/** 記憶體版的儲存體；可設定在寫入時拋錯，模擬無痕模式。 */
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

/** 一次送出的請求。 */
interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: Record<string, unknown> | null;
  readonly keepalive: boolean;
}

/** 假伺服器的回答。`throws` 模擬網路層失敗（離線、逾時）。 */
interface Reply {
  status?: number;
  body?: unknown;
  /** 原封不動當作主體（模擬閘道回的 HTML 錯誤頁）。 */
  raw?: string;
  throws?: boolean;
}

const OK_START = { ok: true, deviceId: 'me', runId: 'run-1', token: 'tok-1', issuedAt: TIME };
const OK_SCORE = { ok: true, verified: true, reason: null, rank: 1, best: { score: 0 } };

/** 一份兩列 + 自己第 3 名的榜。 */
const OK_BOARD = {
  ok: true,
  category: 'score',
  total: 5,
  entries: [
    { rank: 1, name: '阿爺', score: 9000, durationMs: 60_000, maxCombo: 9, merges: 40, at: TIME },
    { rank: 2, name: '阿嬤', score: 4000, durationMs: 30_000, maxCombo: 4, merges: 20, at: TIME - 1 },
  ],
  self: { rank: 3, name: '我', score: 900, durationMs: 20_000, maxCombo: 6, merges: 12, at: TIME - 2 },
};

interface Harness {
  readonly board: LeaderboardSource;
  readonly calls: Call[];
  readonly storage: FakeStorage;
  /** 只回提交那一種請求，依序。 */
  readonly submissions: () => Call[];
  /** 只回抓榜那一種請求，依序。 */
  readonly fetches: () => Call[];
}

function makeHarness(options: {
  /** 覆寫回答；回 `undefined` ＝ 用預設（成功）。 */
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
 * 讓所有排隊中的 promise 跑完。
 * Let every queued promise settle.
 *
 * 用一個真的 macrotask 而不是幾個 `await Promise.resolve()`：`response.json()` 也是 promise
 * 鏈的一部分，而一個 `setTimeout(0)` 之後所有 microtask 一定都跑完了，不必猜要等幾輪。
 * A real macrotask rather than a few `await Promise.resolve()`: `response.json()` is part of the
 * promise chain too, and after one `setTimeout(0)` every microtask has certainly drained — no
 * guessing how many rounds to wait.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** 開一局並等憑證到位。 */
async function startRun(board: LeaderboardSource): Promise<void> {
  board.beginRun?.();
  await settle();
}

describe('createRemoteLeaderboard — 同意之前 / before consent', () => {
  it('does not talk to the server at all', () => {
    const { board, calls } = makeHarness();

    expect(board.snapshot('score')).toEqual({ category: 'score', entries: [], self: null });
    expect(board.sharing).toBe(false);
    /* 沒有同意就沒有東西被推上去，所以連問都不必問（榜是空的不是因為沒抓，是因為沒人上榜）。 */
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

  /*
   * 提交時才鑄憑證的話，伺服器算出來的「憑證頒發到現在」永遠是零，而它會拿它去比對宣稱的時長
   * —— 任何超過容忍值的成績都會被判成作弊。所以「開局時鑄」不是實作細節，是反作弊成立的前提。
   * Minting at submission would make "time since the token was issued" zero, and the server compares
   * the claimed duration against it — every run longer than the tolerance would be flagged. So
   * "minted at the start" is not an implementation detail; the anti-cheat depends on it.
   */
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

    /* 同一次請求還在飛的時候再問一次，不該再開一個。 */
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

    /* 沒有憑證就不送 —— 而不是送一筆沒有 runId 的請求去換一個 400。 */
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

  /*
   * 這是整個檔案最重要的一條。本機紀錄的三個最大值**可以來自不同的三局**（那是刻意的，見
   * `LeaderboardEntry`），所以「把紀錄整包送上去」會宣稱一局同時打出了三個不同局的成績 ——
   * 伺服器會退它（`merges_exceed_drops`），而那是對的。
   * This is the most important test in the file. The local record's three maxima **may come from
   * three different runs** (deliberately; see `LeaderboardEntry`), so sending the record wholesale
   * claims one run produced all three — the server rejects that (`merges_exceed_drops`), correctly.
   */
  it('never merges two runs into one submission', async () => {
    const { board, submissions } = makeHarness();

    board.setSharing(true);
    await settle();
    await startRun(board);

    /* 第一局：高分、低連擊。 */
    board.record({ score: 5000, maxCombo: 2, merges: 5, drops: 9, durationMs: 30_000 });
    board.sync();
    await settle();

    /* 第二局：低分、高連擊。 */
    await startRun(board);
    board.record({ score: 100, maxCombo: 40, merges: 45, drops: 60, durationMs: 90_000 });
    board.sync();
    await settle();

    expect(submissions()).toHaveLength(2);
    expect(submissions()[0]?.body).toMatchObject({ score: 5000, maxCombo: 2, merges: 5, drops: 9 });
    /* 第二筆是第二局原封不動的數字，而不是「5000 分 ＋ 45 合成」那個不存在的組合。 */
    expect(submissions()[1]?.body).toMatchObject({ score: 100, maxCombo: 40, merges: 45, drops: 60 });
  });

  /*
   * `drops` 未提供時退回 `merges`：伺服器的下界是「合成數 ≤ 投放數」，所以少報投入量是安全的，
   * 而送 0 會讓每一筆提交都被退。
   * `drops` falls back to `merges`: the server's lower bound is "merges ≤ drops", so under-reporting
   * the input is safe where sending 0 would reject every submission.
   */
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

    /* 第二局什麼都沒刷新 —— 使用者定案：只送刷新了三個最大值之一的那一局。 */
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

    /* 同一局再送一次是同一個 `run_id`，伺服器只會回同一個裁決 —— 所以不該送。 */
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

    /* 離線：標記留著，所以下一次 `sync()` 仍然會送。 */
    fail = false;
    expect(board.sync()).toBe(true);
    await settle();

    expect(submissions()).toHaveLength(2);
    /* 送到了之後就不再重試。 */
    expect(board.sync()).toBe(false);
  });

  /*
   * 4xx（除了 429）是**定論**：憑證過期、這一局已經收過、數字不合理 —— 這些再送一萬次也一樣。
   * 留著只會讓每一次上載都重試一個必敗的請求。
   * A 4xx other than 429 is **final**: an expired token, a run already received, numbers rejected —
   * none of those change on retry. Keeping it would retry a doomed request on every upload.
   */
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

  /*
   * ⚠️ **200 不代表上榜了。** 伺服器對「合理」與「不合理」的提交都回 200，只差在 `verified`。
   * 不合理的會被存進 `scores` 但不會進 `profiles`（留作審計線索），所以那一筆在榜上是找不到的
   * —— 而它是被**受理過**的，重送只會拿到同一個裁決，因此標記要清掉。
   * ⚠️ **A 200 does not mean it reached the board.** The server answers 200 for both plausible and
   * implausible submissions, differing only in `verified`. The latter is stored in `scores` but
   * never reaches `profiles` (kept as an audit trail), so it is absent from the board — and it was
   * **accepted**, so a retry only returns the same verdict. The marker must be cleared.
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

    /* 本機紀錄照樣更新：上載失敗與「這一局打得好不好」無關。 */
    expect(board.record({ score: 5000, maxCombo: 9, merges: 40, drops: 80 })).toBe(true);
  });
});

describe('createRemoteLeaderboard — 讀榜 / reading the board', () => {
  it('asks for the tab, the limit and itself', async () => {
    const { board, fetches } = makeHarness({ limit: 20 });

    board.setSharing(true);
    await settle();

    expect(fetches()).toHaveLength(3);
    expect(fetches()[0]?.url).toBe('/api/leaderboard?category=score&limit=20&deviceId=me');
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
    /* `beats`：五個人裡排第三 ＝ 贏過 40%（(5−3)/5），與本機版同一條公式。 */
    expect(snapshot.self).toMatchObject({ rank: 3, total: 5, beats: 40 });
  });

  it('does not leak a fake id into the rows', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    /* 伺服器刻意不外洩裝置碼，所以 `id` 是空的而不是「名次」那種看起來像真的東西。 */
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

    /* 一個分類一次，而不是兩次（榜面開啟與同意分享撞在一起是常態）。 */
    expect(fetches()).toHaveLength(3);
  });

  /*
   * 抓不到時**保留舊的榜**：把榜清空會讓玩家以為自己的成績不見了，而事實只是這一次沒問到。
   * A failed fetch **keeps the old board**: blanking it would read as "my score is gone" when the
   * only fact is that this attempt failed.
   */
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
});

describe('createRemoteLeaderboard — 改名 / renaming', () => {
  it('renames the cached row at once, because the server only learns on the next submission', async () => {
    const { board } = makeHarness();

    board.setSharing(true);
    await settle();

    board.setDisplayName('新名字');

    /*
     * 伺服器上的名字要等下一次提交（`upsertProfile`）才會更新，而玩家按完改名就開榜時不該還看到
     * 舊名字 —— 所以快取先自己改。
     * The server's copy only updates on the next submission (`upsertProfile`), and a player who
     * renames then opens the board should not see the old name, so the cache is updated first.
     */
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

    /* 每一幀都會呼叫 `record()`，所以「沒有刷新就什麼都不做」是它便宜的原因。 */
    board.record({ score: 0, maxCombo: 0, merges: 0 });
    expect(calls).toBe(3);
  });
});

/** 與 `makeHarness` 相同，但可以共用一份儲存體（模擬「重開一個工作階段」）。 */
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
