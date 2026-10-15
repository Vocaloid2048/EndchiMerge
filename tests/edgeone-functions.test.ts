/**
 * EdgeOne Node Functions 入口的接線：四個端點都要有具名匯出，且 health 能真的回 200。
 * EdgeOne Node Functions wiring: all four endpoints expose the named exports, and health really returns 200.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFetchHandler } from '../api/_lib/adapters/fetch';
import { setDependencies, endpoint } from '../api/_lib/runtime';
import { handleHealth } from '../api/_lib/handlers';
import { MemoryStore } from '../api/_lib/store';
import { MAX_RUN_MS, RUN_TOKEN_SLACK_MS, type Config } from '../api/_lib/env';

import * as score from '../node-functions/api/score.js';
import * as health from '../node-functions/api/health.js';
import * as leaderboard from '../node-functions/api/leaderboard.js';
import * as runStart from '../node-functions/api/run/start.js';

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

describe('EdgeOne Node Functions — 四個入口 / the four entries', () => {
  it('score 匯出三個具名方法', () => expectNamed(score));
  it('health 匯出三個具名方法', () => expectNamed(health));
  it('leaderboard 匯出三個具名方法', () => expectNamed(leaderboard));
  it('run/start 匯出三個具名方法', () => expectNamed(runStart));
});

describe('EdgeOne health — 實際回應 / a real response', () => {
  const config: Config = {
    databaseUrl: 'postgresql://user:pass@host/db',
    dbDialect: 'postgres',
    runTokenSecret: 'a'.repeat(48),
    allowedOrigins: [],
    submissionsPerHour: 20,
    runTokenTtlMs: MAX_RUN_MS + RUN_TOKEN_SLACK_MS,
    runsPerHour: 120,
  };

  beforeEach(() =>
    setDependencies({ config, store: new MemoryStore(), now: () => 1_700_000_000_000 }),
  );
  afterEach(() => setDependencies(null));

  it('onRequestGet 回 200 與 ok:true', async () => {
    const response = await health.onRequestGet({ request: new Request('https://game.example/api/health') });

    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('與 fetch 轉接頭得到同一份結果（同一處理器）', async () => {
    const viaEdgeOne = await health.onRequestGet({ request: new Request('https://game.example/api/health') });
    const viaFetch = await createFetchHandler(endpoint(handleHealth))(
      new Request('https://game.example/api/health'),
    );

    expect(await viaEdgeOne.json()).toEqual(await viaFetch.json());
  });
});
