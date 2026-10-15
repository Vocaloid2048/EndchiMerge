/**
 * 執行環境轉接頭的測試：同一份 `Handler` 要得到一樣的 `ApiRequest`。
 * Tests for the runtime adapters: one `Handler` must yield the same `ApiRequest` everywhere.
 */

import { describe, expect, it } from 'vitest';

import { createEdgeOneHandlers, createFetchHandler } from '../api/_lib/adapters/fetch';
import { createVercelHandler, vercelEndpoint } from '../api/_lib/adapters/vercel';
import { methodNotAllowed, ok, type Handler } from '../api/_lib/http';
import { handleHealth } from '../api/_lib/handlers';
import { MemoryStore } from '../api/_lib/store';
import { endpoint, setDependencies } from '../api/_lib/runtime';
import { MAX_RUN_MS, RUN_TOKEN_SLACK_MS, type Config } from '../api/_lib/env';

const SECRET = 'a'.repeat(48);

const echo: Handler = async (request) =>
  ok({
    method: request.method,
    path: request.path,
    query: Object.fromEntries(request.query),
    headers: request.headers,
    body: request.body,
  });

interface Echo {
  ok: true;
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

function fakeResponse(): {
  res: { statusCode: number; setHeader(name: string, value: string): void; end(chunk?: string): void };
  headers: Record<string, string>;
  body(): string | null;
  status(): number;
} {
  let chunk: string | undefined;
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
    end(value?: string): void {
      chunk = value;
    },
  };

  return {
    res,
    headers,
    body: () => chunk ?? null,
    status: () => res.statusCode,
  };
}

/* ── Web 標準轉接頭（EdgeOne 等）/ Web-standard adapter ─────────────────────── */

describe('fetch adapter — Web 標準 / the Web standard', () => {
  it('reads the method, path, query, headers and body off a Request', async () => {
    const response = await createFetchHandler(echo)(
      new Request('https://game.example/api/score?limit=5&deviceId=abc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: 900 }),
      }),
    );

    const body = (await response.json()) as Echo;

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/api/score');
    expect(body.query).toEqual({ limit: '5', deviceId: 'abc' });
    expect(body.body).toEqual({ score: 900 });
  });

  it('lowercases header names, so one header is not missed in one casing', async () => {
    const response = await createFetchHandler(echo)(
      new Request('https://game.example/api/x', { headers: { 'User-Agent': 'vitest', Origin: 'https://a.example' } }),
    );

    const { headers } = (await response.json()) as Echo;

    expect(headers['user-agent']).toBe('vitest');
    expect(headers['origin']).toBe('https://a.example');
    expect(headers['User-Agent']).toBeUndefined();
  });

  it('treats a body that is not JSON as no body, rather than throwing', async () => {
    const response = await createFetchHandler(echo)(
      new Request('https://game.example/api/x', { method: 'POST', body: 'not json at all' }),
    );

    expect(((await response.json()) as Echo).body).toBeNull();
  });

  it('does not try to read a body on GET', async () => {
    const response = await createFetchHandler(echo)(new Request('https://game.example/api/x'));

    expect(response.status).toBe(200);
    expect(((await response.json()) as Echo).body).toBeNull();
  });

  it('turns an unexpected failure into a 500 without leaking the message', async () => {
    const exploding = createFetchHandler(async () => {
      throw new Error('postgres://user:hunter2@host/db');
    });

    const response = await exploding(new Request('https://game.example/api/x'));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(text).not.toContain('hunter2');
    expect(text).toContain('internal_error');
  });

  it('sends no body for a 204', async () => {
    const response = await createFetchHandler(async () => ({ status: 204, body: null }))(
      new Request('https://game.example/api/x', { method: 'OPTIONS' }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});

/* ── EdgeOne Pages Functions / ─────────────────────────────────────────────── */

describe('EdgeOne handlers — 具名匯出 / the named exports', () => {
  it('exposes the three method names EdgeOne routes on', () => {
    const handlers = createEdgeOneHandlers(echo);

    expect(typeof handlers.onRequestGet).toBe('function');
    expect(typeof handlers.onRequestPost).toBe('function');
    expect(typeof handlers.onRequestOptions).toBe('function');
  });

  it('reads context.request and answers with a Response', async () => {
    const handlers = createEdgeOneHandlers(echo);

    const response = await handlers.onRequestPost({
      request: new Request('https://game.example/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ score: 1 }),
      }),
    });

    const body = (await response.json()) as Echo;

    expect(body.method).toBe('POST');
    expect(body.body).toEqual({ score: 1 });
  });

  it('answers 405 for a method the handler does not accept', async () => {
    const handlers = createEdgeOneHandlers(async () => methodNotAllowed(['POST']));

    const response = await handlers.onRequestGet({ request: new Request('https://game.example/api/x') });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});

/* ── Vercel 轉接頭 / The Vercel adapter ────────────────────────────────────── */

describe('vercel adapter — Node 的 req／res / Node req and res', () => {
  it('parses the url, the query and an already-parsed body', async () => {
    const fake = fakeResponse();

    await createVercelHandler(echo)(
      {
        method: 'post',
        url: '/api/score?limit=5',
        headers: { 'User-Agent': 'vitest' },
        body: { score: 900 },
      },
      fake.res,
    );

    const body = JSON.parse(fake.body() ?? 'null') as Echo;

    expect(fake.status()).toBe(200);
    expect(body.method).toBe('POST');
    expect(body.path).toBe('/api/score');
    expect(body.query).toEqual({ limit: '5' });
    expect(body.body).toEqual({ score: 900 });
  });

  it('parses a body that arrived as a string', async () => {
    const fake = fakeResponse();

    await createVercelHandler(echo)(
      { method: 'POST', url: '/api/x', headers: {}, body: '{"score":1}' },
      fake.res,
    );

    expect((JSON.parse(fake.body() ?? 'null') as Echo).body).toEqual({ score: 1 });
  });

  it('writes no body for a 204', async () => {
    const fake = fakeResponse();

    await createVercelHandler(async () => ({ status: 204, body: null }))(
      { method: 'OPTIONS', url: '/api/x', headers: {} },
      fake.res,
    );

    expect(fake.status()).toBe(204);
    expect(fake.body()).toBeNull();
  });

  it('copies the response headers onto res', async () => {
    const fake = fakeResponse();

    await createVercelHandler(async () => ok({ ok: true }, { allow: 'GET' }))(
      { method: 'GET', url: '/api/x', headers: {} },
      fake.res,
    );

    expect(fake.headers['allow']).toBe('GET');
  });
});

/* ── 兩個轉接頭要得到同一個結果 / Both adapters agree ──────────────────────── */

describe('adapters — 同一份處理器 / the same handler', () => {
  it('produces the same ApiRequest from a Request and from req/res', async () => {
    const url = '/api/leaderboard?limit=10&deviceId=player-aaaa-1111';
    const headers = { 'content-type': 'application/json', 'user-agent': 'vitest' };

    const viaFetch = await createFetchHandler(echo)(
      new Request(`https://game.example${url}`, { method: 'POST', headers, body: '{"a":1}' }),
    );

    const fake = fakeResponse();
    await createVercelHandler(echo)(
      { method: 'POST', url, headers, body: '{"a":1}' },
      fake.res,
    );

    const fromFetch = (await viaFetch.json()) as Echo;
    const fromVercel = JSON.parse(fake.body() ?? 'null') as Echo;

    expect(fromFetch).toEqual(fromVercel);
  });
});

/* ── 外殼與轉接頭的接線 / Wiring the shell to an adapter ───────────────────── */

describe('vercelEndpoint — 外殼 ＋ 轉接頭 / the shell plus the adapter', () => {
  function makeConfig(): Config {
    return {
      databaseUrl: 'postgresql://user:pass@host/db',
      dbDialect: 'postgres',
      storageBackend: 'sql',
      runTokenSecret: SECRET,
      allowedOrigins: [],
      submissionsPerHour: 20,
      runTokenTtlMs: MAX_RUN_MS + RUN_TOKEN_SLACK_MS,
      runsPerHour: 120,
    };
  }

  it('runs the real health handler through the shell', async () => {
    const store = new MemoryStore();
    setDependencies({ config: makeConfig(), store, now: () => 1_700_000_000_000 });

    try {
      const fake = fakeResponse();
      await vercelEndpoint(handleHealth)({ method: 'GET', url: '/api/health', headers: {} }, fake.res);

      const body = JSON.parse(fake.body() ?? 'null') as {
        ok: boolean;
        database: string;
        players: number;
      };

      expect(fake.status()).toBe(200);
      expect(body).toMatchObject({ ok: true, database: 'postgres', players: 0 });
      expect(store.requestCount).toBe(1);
      expect(store.lastRequest?.path).toBe('/api/health');
    } finally {
      setDependencies(null);
    }
  });

  it('gives the same answer through the fetch adapter', async () => {
    const store = new MemoryStore();
    setDependencies({ config: makeConfig(), store, now: () => 1_700_000_000_000 });

    try {
      const response = await createFetchHandler(endpoint(handleHealth))(
        new Request('https://game.example/api/health'),
      );

      expect(response.status).toBe(200);
      expect((await response.json()) as object).toMatchObject({ ok: true, database: 'postgres' });
      expect(store.lastRequest?.path).toBe('/api/health');
    } finally {
      setDependencies(null);
    }
  });
});
