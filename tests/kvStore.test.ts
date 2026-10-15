/**
 * KvStore 的單元測試：用一個記憶體版的 KV 取代 `globalThis.ENDCHI_KV`，驗證「掃描前綴」實作出來的
 * 行為與 MemoryStore 一致（冪等、歷史最大值、撞號重抽、榜的排序、名次、速率、憑證）。
 * Unit tests for KvStore: an in-memory KV stands in for `globalThis.ENDCHI_KV`, proving the
 * prefix-scan implementation behaves like MemoryStore (idempotency, maxima, tag re-roll, board
 * order, rank, rate, tokens).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KVNamespace } from '../api/_lib/store/kvStore';
import { KvStore, KV_BINDING } from '../api/_lib/store/kvStore';
import type { ScoreRow } from '../api/_lib/store';

/** EdgeOne KV 介面的記憶體實作（只有用到的部分）。 */
class MockKV implements KVNamespace {
  private readonly map = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json'): Promise<unknown> {
    const raw = this.map.get(key);
    if (raw === undefined) return null;
    return type === 'json' ? JSON.parse(raw) : raw;
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    readonly keys: ReadonlyArray<{ readonly name: string }>;
    readonly complete: boolean;
    readonly cursor: string;
  }> {
    const prefix = options?.prefix ?? '';
    const keys = [...this.map.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, complete: true, cursor: '' };
  }
}

function makeScore(overrides: Partial<ScoreRow>): ScoreRow {
  return {
    runId: 'run-' + Math.random().toString(36).slice(2),
    deviceId: 'device-a',
    displayName: '玩家',
    userTag: '',
    score: 100,
    durationMs: 60_000,
    merges: 10,
    drops: 20,
    maxCombo: 3,
    version: '0.1.0',
    verified: true,
    rejected: null,
    atMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('KvStore — 綁定與冪等 / binding and idempotency', () => {
  let store: KvStore;

  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
    store = new KvStore();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
  });

  it('預期變數名是 ENDCHI_KV', () => {
    expect(KV_BINDING).toBe('ENDCHI_KV');
  });

  it('未綁定 KV 時拋錯（提醒去控制台 Bind Namespace）', async () => {
    globalThis.ENDCHI_KV = undefined;
    await expect(store.getProfile('device-a')).rejects.toThrow(/ENDCHI_KV/);
  });

  it('同一 run_id 再送回 false（冪等，網路重試不會雙倍計入）', async () => {
    const score = makeScore({ runId: 'run-1', deviceId: 'device-a', score: 500 });

    expect(await store.saveScore(score)).toBe(true);
    expect(await store.saveScore(score)).toBe(false);
    expect((await store.getScore('run-1'))?.score).toBe(500);
  });

  it('通過的提交建立 profile，未通過的不進榜', async () => {
    await store.saveScore(makeScore({ runId: 'run-good', deviceId: 'device-a', score: 500 }));
    await store.saveScore(makeScore({ runId: 'run-bad', deviceId: 'device-a', verified: false, score: 9999 }));

    const profile = await store.getProfile('device-a');
    expect(profile).not.toBeNull();
    expect(profile?.bestScore).toBe(500);
    expect(await store.countProfiles()).toBe(1);
  });
});

describe('KvStore — 歷史最大值 / historical maxima', () => {
  let store: KvStore;

  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
    store = new KvStore();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
  });

  it('同一裝置只留一列，且取三個最大值各自的最高', async () => {
    await store.saveScore(
      makeScore({ runId: 'r1', deviceId: 'd', score: 100, maxCombo: 2, merges: 5, durationMs: 10_000 }),
    );
    await store.saveScore(
      makeScore({ runId: 'r2', deviceId: 'd', score: 300, maxCombo: 9, merges: 3, durationMs: 40_000 }),
    );

    const profile = await store.getProfile('d');
    expect(profile?.bestScore).toBe(300);
    expect(profile?.bestMaxCombo).toBe(9);
    expect(profile?.bestMerges).toBe(5);
    expect(profile?.bestDurationMs).toBe(40_000);
  });
});

describe('KvStore — 撞號重抽 / tag re-roll', () => {
  let store: KvStore;

  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
    store = new KvStore();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
  });

  it('兩個裝置同名字＋同號時，後者重抽一個不同的號', async () => {
    const tag = '1234';
    await store.saveScore(
      makeScore({ runId: 'ra', deviceId: 'device-a', displayName: '夜芷冰', userTag: tag, score: 100 }),
    );
    await store.saveScore(
      makeScore({ runId: 'rb', deviceId: 'device-b', displayName: '夜芷冰', userTag: tag, score: 200 }),
    );

    const a = await store.getProfile('device-a');
    const b = await store.getProfile('device-b');
    expect(a?.userTag).toBe(tag);
    expect(b?.userTag).not.toBe(tag);
  });

  it('改名不動號（沿用既有）', async () => {
    await store.saveScore(
      makeScore({ runId: 'ra', deviceId: 'device-a', displayName: '舊名', userTag: '4321', score: 100 }),
    );
    await store.saveScore(
      makeScore({ runId: 'rb', deviceId: 'device-a', displayName: '新名', userTag: '9999', score: 200 }),
    );

    const profile = await store.getProfile('device-a');
    expect(profile?.displayName).toBe('新名');
    expect(profile?.userTag).toBe('4321');
  });
});

describe('KvStore — 榜的排序與名次 / board order and rank', () => {
  let store: KvStore;

  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
    store = new KvStore();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
  });

  it('topProfiles 在分數分類下降冪排序', async () => {
    await store.saveScore(makeScore({ runId: 'r1', deviceId: 'd1', score: 100 }));
    await store.saveScore(makeScore({ runId: 'r2', deviceId: 'd2', score: 300 }));
    await store.saveScore(makeScore({ runId: 'r3', deviceId: 'd3', score: 200 }));

    const board = await store.topProfiles('score', 10);
    expect(board.map((row) => row.deviceId)).toEqual(['d2', 'd3', 'd1']);
  });

  it('limit 真的截斷', async () => {
    await store.saveScore(makeScore({ runId: 'r1', deviceId: 'd1', score: 100 }));
    await store.saveScore(makeScore({ runId: 'r2', deviceId: 'd2', score: 300 }));
    await store.saveScore(makeScore({ runId: 'r3', deviceId: 'd3', score: 200 }));

    const board = await store.topProfiles('score', 2);
    expect(board).toHaveLength(2);
    expect(board[0].deviceId).toBe('d2');
  });

  it('rankOf 與 topProfiles 共用同一條排序', async () => {
    await store.saveScore(makeScore({ runId: 'r1', deviceId: 'd1', score: 100 }));
    await store.saveScore(makeScore({ runId: 'r2', deviceId: 'd2', score: 300 }));

    const rank = await store.rankOf(
      { deviceId: 'probe', score: 250, maxCombo: 0, merges: 0, atMs: 0 },
      'score',
    );
    expect(rank).toBe(2);
  });

  it('countProfiles 只數 bestScore > 0', async () => {
    await store.saveScore(makeScore({ runId: 'r1', deviceId: 'd1', score: 100 }));
    await store.saveScore(makeScore({ runId: 'r2', deviceId: 'd2', score: 0 }));

    expect(await store.countProfiles()).toBe(1);
  });
});

describe('KvStore — 憑證與速率 / tokens and rate', () => {
  let store: KvStore;

  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
    store = new KvStore();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
  });

  it('run token 可寫回讀、標記用過', async () => {
    const row = {
      runId: 'run-x',
      deviceId: 'device-a',
      tokenHash: 'h',
      issuedAtMs: 1,
      expiresAtMs: 2,
      usedAtMs: null,
    };
    await store.putRunToken(row);
    expect(await store.getRunToken('run-x')).toEqual(row);

    await store.markRunTokenUsed('run-x', 9);
    expect((await store.getRunToken('run-x'))?.usedAtMs).toBe(9);
  });

  it('速率計數只看該裝置、且只看時間窗', async () => {
    await store.putRunToken({
      runId: 'r1',
      deviceId: 'device-a',
      tokenHash: 'h',
      issuedAtMs: 1_000,
      expiresAtMs: 2_000,
      usedAtMs: null,
    });
    await store.putRunToken({
      runId: 'r2',
      deviceId: 'device-a',
      tokenHash: 'h',
      issuedAtMs: 5_000,
      expiresAtMs: 6_000,
      usedAtMs: null,
    });
    await store.putRunToken({
      runId: 'r3',
      deviceId: 'device-b',
      tokenHash: 'h',
      issuedAtMs: 5_000,
      expiresAtMs: 6_000,
      usedAtMs: null,
    });

    expect(await store.countRunTokensSince('device-a', 0)).toBe(2);
    expect(await store.countRunTokensSince('device-a', 2_000)).toBe(1);
    expect(await store.countRunTokensSince('device-a', 5_000)).toBe(1);
    expect(await store.countRunTokensSince('device-a', 5_001)).toBe(0);
    expect(await store.countRunTokensSince('device-b', 0)).toBe(1);
  });

  it('提交速率計數含被退回的', async () => {
    await store.saveScore(makeScore({ runId: 'r1', deviceId: 'device-a', atMs: 1_000, verified: true }));
    await store.saveScore(makeScore({ runId: 'r2', deviceId: 'device-a', atMs: 2_000, verified: false }));

    expect(await store.countSubmissionsSince('device-a', 0)).toBe(2);
  });

  it('接收紀錄寫入不抛錯', async () => {
    await expect(
      store.insertRequest({ method: 'POST', path: '/api/score', status: 200, deviceId: 'device-a', runId: 'r1' }),
    ).resolves.toBeUndefined();
  });
});
