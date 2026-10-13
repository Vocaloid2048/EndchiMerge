#!/usr/bin/env node
/**
 * 本機開發的一個指令：前端 ＋ 後端 ＋ SQLite。
 * Local development in one command: front end + back end + SQLite.
 */

import { readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createServer as createViteServer } from 'vite';

import type { createVercelHandler } from '../api/_lib/adapters/vercel';
import { connectionNotesFor, createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { loadConfig } from '../api/_lib/env';

/* ── 常數 ─────────────────────────────────────────────────────────────────── */

/**
 * API 伺服器的埠；Vite 的代理在下面當場組出來，所以全檔只有這一份。
 * The API server's port; the Vite proxy below is built from it, so there is only one copy.
 */
const API_PORT = Number(process.env['DEV_API_PORT'] ?? '') || 8787;
const API_HOST = '127.0.0.1';
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;

const API_DIR = fileURLToPath(new URL('../api', import.meta.url));

type Endpoint = ReturnType<typeof createVercelHandler>;

/**
 * 開發用的環境變數預設值；只補沒有設定過的鍵，所以 `.env` 永遠優先。
 * Development defaults for the environment variables; only unset keys are filled, so `.env` wins.
 *
 * `RUN_TOKEN_SECRET` 的預設值刻意很明顯不是秘密，而 `loadConfig()` 會拒絕短於 32 字元的秘密。
 * The `RUN_TOKEN_SECRET` default is deliberately obvious about not being a secret, and
 * `loadConfig()` rejects any secret shorter than 32 characters.
 */
const DEFAULTS: Readonly<Record<string, string>> = {
  DATABASE_URL: 'sqlite:.mysql/endchi.db',
  RUN_TOKEN_SECRET: 'dev-only-insecure-run-token-secret-do-not-deploy',
};

function applyDefaults(): void {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const current = process.env[key];
    if (current === undefined || current.trim() === '') process.env[key] = value;
  }
}

/* ── 路由掃描 / Route discovery ───────────────────────────────────────────── */

/**
 * 以 `_` 開頭的檔案或資料夾要跳過（`_lib` 是共用程式碼而非端點）。
 * Skips `_`-prefixed files and directories (`_lib` is shared code, not an endpoint).
 *
 * Vercel 也這樣排除 `api/` 底下的 `_` 檔案，所以這一行與部署時一致。
 * Vercel excludes `_`-prefixed files under `api/` too, so this matches deployment.
 */
function isPrivate(name: string): boolean {
  return name.startsWith('_');
}

/**
 * 掃出所有端點，回一個「路徑 → 處理器」的表。
 * Scans every endpoint into a "path → handler" table.
 *
 * 載入失敗不吞掉：端點檔匯入不了就該當場炸掉，而不是等你打開那一頁才 404。
 * A failed load is not swallowed: an endpoint that cannot be imported should blow up here rather
 * than 404 later.
 */
async function discoverRoutes(): Promise<ReadonlyMap<string, Endpoint>> {
  const routes = new Map<string, Endpoint>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (isPrivate(entry.name)) continue;

      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (extname(entry.name) !== '.ts') continue;

      const module: unknown = await import(pathToFileURL(full).href);
      const handler = (module as { default?: unknown }).default;

      if (typeof handler !== 'function') {
        throw new Error(`${full} has no default export, so it cannot be an endpoint`);
      }

      const route = relative(API_DIR, full).replace(extname(entry.name), '').split(sep).join('/');
      routes.set(`/api/${route}`, handler as Endpoint);
    }
  }

  await walk(API_DIR);

  return routes;
}

/* ── 請求主體 / The request body ──────────────────────────────────────────── */

/**
 * 讀完請求主體並回文字，交給轉接頭自己解析；`GET`／`HEAD` 沒有主體，回 `null`。
 * Reads a request body to completion and returns text for the adapter to parse; `GET`/`HEAD` have
 * no body and return `null`.
 */
async function readBody(request: IncomingMessage): Promise<string | null> {
  if (request.method === 'GET' || request.method === 'HEAD') return null;

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks).toString('utf8');
}

/* ── 主流程 / The main flow ───────────────────────────────────────────────── */

applyDefaults();

const config = loadConfig();
const dialect = dialectFor(config.dbDialect);

for (const note of connectionNotesFor(config.dbDialect, config.databaseUrl)) {
  console.warn(`[dev] ${note}`);
}

/*
 * 建表用它自己的驅動，用完就關：`runtime.ts` 那種連線池住在模組層級、整個行程共用，兩者不該互相牽扯。
 * The migration uses its own driver and closes it right away: `runtime.ts` keeps its pool at module
 * scope, shared by the process, and the two should not be entangled.
 */
{
  const driver = createDriver(config.dbDialect, config.databaseUrl);

  try {
    const applied = await ensureSchema(driver, dialect);
    console.log(`[dev] ${config.dbDialect} schema ready (${applied} statements)`);
  } finally {
    await driver.close();
  }
}

const routes = await discoverRoutes();

/**
 * 本機的 API 伺服器：把 `node:http` 的 `req`／`res` 直接交給正式環境那個轉接頭。
 * The local API server: hands `node:http`'s `req` / `res` straight to the production adapter.
 *
 * 這裡沒有任何業務邏輯：CORS、接收紀錄與未預期的 500 全在 `runtime.ts` 與轉接頭裡。
 * There is no business logic here: CORS, the request log and the unexpected-500 path all live in
 * `runtime.ts` and the adapter.
 */
const api = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '';
    const handler = routes.get(path);

    if (handler === undefined) {
      /*
       * 與 `http.ts` 的 `fail` 同一個 JSON 錯誤形狀，並列出認得的路徑，方便在終端機打錯字時排查。
       * The same JSON error shape as `fail` in `http.ts`, listing the known paths, which is far
       * more useful than a bare 404 when a character was mistyped in a terminal.
       */
      res.statusCode = 404;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            code: 'not_found',
            message: `no such endpoint; try one of: ${[...routes.keys()].sort().join(', ')}`,
          },
        }),
      );
      return;
    }

    await handler(
      {
        method: req.method,
        url,
        headers: { ...req.headers },
        body: await readBody(req),
      },
      res,
    );
  })().catch((error: unknown) => {
    /*
     * 走到這裡代表連轉接頭都炸了（它自己會把處理器的例外收成 500）；實務上只有「讀主體時連線斷了」，
     * 回一個空的 400 就好，但一定要結束回應，否則瀏覽器會一直等。
     * Reaching here means the adapter itself threw (it already turns handler exceptions into a 500).
     * In practice that is only "the connection dropped while reading the body", so an empty 400 is
     * enough — but the response must be ended, or the browser waits forever.
     */
    console.error('[dev] the dev API server could not answer', error);

    if (!res.headersSent) res.statusCode = 400;
    res.end();
  });
});

await new Promise<void>((resolve) => {
  api.listen(API_PORT, API_HOST, resolve);
});

const vite = await createViteServer({
  server: {
    /*
     * 代理設在這裡而不是 `vite.config.ts`：那個檔案是給部署用的，而埠號只寫一次就不會兩邊走樣。
     * The proxy is configured here rather than in `vite.config.ts`, which is about deployment, and
     * the port is written down once so the two cannot drift apart.
     */
    proxy: { '/api': { target: API_ORIGIN } },
  },
});

await vite.listen();
vite.printUrls();

console.log(`[dev] api      ${API_ORIGIN}  (${config.dbDialect}, ${routes.size} endpoints)`);
console.log(
  `[dev] database ${config.databaseUrl.replace(/^sqlite:/u, '')}  (gitignored, SQLite is not deployable)`,
);

/**
 * 收工時把兩邊都關掉；Vite 先、API 後，免得關閉瞬間的請求撞上已停的伺服器。
 * Shuts both sides down on the way out, Vite first, so requests fired at that moment do not hit an
 * API that is already closing.
 */
let closing = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;

    void (async () => {
      await vite.close();
      await new Promise<void>((resolve) => api.close(() => resolve()));
      process.exit(0);
    })();
  });
}
