/**
 * EdgeOne Makers `cloud-functions` 入口的接線：四個端點都要有具名匯出，且透過邊緣轉接頭
 * （注入 `context.env` ＋ `globalThis.ENDCHI_KV`）真的走一次 KV 儲存層。
 * EdgeOne Makers `cloud-functions` wiring: all four endpoints expose the named exports, and a real
 * pass through the edge adapter (injecting `context.env` plus `globalThis.ENDCHI_KV`) exercises the KV store.
 *
 * KV 模式沒有 `DATABASE_URL`，所以 `context.env` 只需 `STORAGE_BACKEND=kv` 與 `RUN_TOKEN_SECRET`；
 * `globalThis.ENDCHI_KV` 用記憶體版取代，證明「掃描前綴」的邊緣路徑真的通。
 * The kv mode needs no `DATABASE_URL`, so `context.env` carries only `STORAGE_BACKEND=kv` and
 * `RUN_TOKEN_SECRET`; an in-memory `ENDCHI_KV` proves the prefix-scan edge path really works.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KVNamespace } from '../api/_lib/store/kvStore';
import { KV_BINDING, KvStore } from '../api/_lib/store/kvStore';
import { setDependencies } from '../api/_lib/runtime';
import type { ScoreRow } from '../api/_lib/store';

import * as score from '../cloud-functions/api/score.js';
import * as health from '../cloud-functions/api/health.js';
import * as leaderboard from '../cloud-functions/api/leaderboard.js';
import * as runStart from '../cloud-functions/api/run/start.js';

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

const SECRET = 'a'.repeat(48);
const ENV = { STORAGE_BACKEND: 'kv', RUN_TOKEN_SECRET: SECRET } as const;

type Entry = {
  onRequestGet?: unknown;
  onRequestPost?: unknown;
  onRequestOptions?: unknown;
};

function expectNamed(handler: unknown): void {
  const exports = handler as Entry;

  expect(typeof exports.onRequestGet).toBe('function');
  expect(typeof exports.onRequestPost).toBe('function');
  expect(typeof exports.onRequestOptions).toBe('function');
}

function post(path: string, body: unknown): Request {
  return new Request(`https://game.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`https://game.example${path}`, { method: 'GET' });
}

describe('EdgeOne Makers cloud-functions — 四個入口 / the four entries', () => {
  it('score 匯出三個具名方法', () => expectNamed(score));
  it('health 匯出三個具名方法', () => expectNamed(health));
  it('leaderboard 匯出三個具名方法', () => expectNamed(leaderboard));
  it('run/start 匯出三個具名方法', () => expectNamed(runStart));
});

describe('EdgeOne Makers cloud-functions — KV 路徑真的通 / the KV path really works', () => {
  beforeEach(() => {
    globalThis.ENDCHI_KV = new MockKV();
  });

  afterEach(() => {
    globalThis.ENDCHI_KV = undefined;
    setDependencies(null);
  });

  it('health 回 200、ok:true、database:kv', async () => {
    const response = await health.onRequestGet({ request: get('/api/health'), env: ENV });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; database: string; players: number };
    expect(body.ok).toBe(true);
    expect(body.database).toBe('kv');
    expect(typeof body.players).toBe('number');
  });

  it('health 的 players 來自同一個 KV（直接種一筆進榜）', async () => {
    const store = new KvStore();
    const seeded: ScoreRow = {
      runId: 'seed-run',
      deviceId: 'seed-device',
      displayName: '阿爺',
      userTag: '',
      score: 1234,
      durationMs: 60_000,
      merges: 10,
      drops: 20,
      maxCombo: 5,
      version: '0.1.0',
      verified: true,
      rejected: null,
      atMs: 1_700_000_000_000,
    };
    await store.saveScore(seeded);

    const response = await health.onRequestGet({ request: get('/api/health'), env: ENV });
    const body = (await response.json()) as { players: number };

    expect(body.players).toBe(1);
  });

  it('run/start 走邊緣轉接頭真的寫了一張憑證到 KV', async () => {
    const response = await runStart.onRequestPost({
      request: post('/api/run/start', { deviceId: 'device-0000-1111', version: '0.1.0' }),
      env: ENV,
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as { ok: boolean; runId: string; token: string };
    expect(body.ok).toBe(true);
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
    expect(typeof body.token).toBe('string');
  });

  it('score 與 leaderboard 都回 200（KV 讀寫路徑不拋錯）', async () => {
    const started = (await runStart.onRequestPost({
      request: post('/api/run/start', { deviceId: 'device-0000-2222', version: '0.1.0' }),
      env: ENV,
    }).then((r) => r.json())) as { runId: string; token: string };

    const scoreResponse = await score.onRequestPost({
      request: post('/api/score', {
        deviceId: 'device-0000-2222',
        runId: started.runId,
        token: started.token,
        version: '0.1.0',
        score: 100,
        merges: 10,
        drops: 20,
        maxCombo: 3,
        durationMs: 1000,
        displayName: '阿爺',
      }),
      env: ENV,
    });
    expect(scoreResponse.status).toBe(200);

    const boardResponse = await leaderboard.onRequestGet({ request: get('/api/leaderboard?limit=10'), env: ENV });
    expect(boardResponse.status).toBe(200);

    const boardBody = (await boardResponse.json()) as { ok: boolean; entries: unknown[] };
    expect(boardBody.ok).toBe(true);
    expect(Array.isArray(boardBody.entries)).toBe(true);
  });

  it('變數名就是 ENDCHI_KV', () => {
    expect(KV_BINDING).toBe('ENDCHI_KV');
  });
});
