#!/usr/bin/env node
/**
 * 本機開發的**一個指令**：前端 ＋ 後端 ＋ 資料庫。
 * Local development in **one command**: front end + back end + database.
 *
 * ## 它做什麼 / What it does
 *
 *   1. **補上開發用的環境變數預設值**（只補沒有設的，所以 `.env` 永遠優先）；
 *   2. **建表**（`ensureSchema`，可重複執行）—— 所以第一次跑就會有一個能用的資料庫；
 *   3. 用 `node:http` 起一個真的 API 伺服器，路由**直接從 `api/**` 掃出來**；
 *   4. 在同一個行程裡起 Vite，並把 `/api` 代理到 3 的那個埠。
 * It fills in development defaults for the environment variables (only the ones that are unset, so
 * `.env` always wins), creates the tables (`ensureSchema`, repeatable, so the very first run gets a
 * usable database), starts a real API server on `node:http` whose routes are **scanned out of
 * `api/**`**, and starts Vite in the same process with `/api` proxied to that server.
 *
 * ## 為什麼不是 `vercel dev` / Why not `vercel dev`
 *
 * 那要多一個每次都連到雲端的 CLI、一份 `.vercel/`，而且它模擬的執行環境與正式環境仍然不完全一樣。
 * 這裡走的是**正式環境那一個轉接頭**（`adapters/vercel.ts` 的 `createVercelHandler`），只把 Node 的
 * `req`／`res` 交給它 —— 而 Vercel 的 `res` 介面（`statusCode`／`setHeader`／`end`）本來就是
 * `node:http` 的 `ServerResponse` 的子集，所以連包裝都不必寫。
 * That needs a CLI that phones home on every invocation, a `.vercel/` directory, and still simulates an
 * environment that is not quite production. This goes through the **production adapter**
 * (`createVercelHandler` in `adapters/vercel.ts`), handing it Node's own `req` / `res` — and Vercel's
 * `res` interface (`statusCode` / `setHeader` / `end`) is a subset of `node:http`'s `ServerResponse`,
 * so not even a wrapper is needed.
 *
 * 因此本機與雲上跑的是**同一條**轉接頭 → 外殼 → 處理器 → 儲存層的路徑，只有傳輸層不同。
 * Local and cloud therefore run the **same** adapter → shell → handlers → store path; only the
 * transport differs.
 *
 * ## 路由是掃出來的，不是抄一份 / The route table is scanned, not copied
 *
 * 端點檔（`api/health.ts`、`api/score.ts`…）的預設匯出就是一個處理器，所以這裡**動態載入每一個檔**
 * 並用它自己的路徑當路由（`api/run/start.ts` → `/api/run/start`）。因此新增一個端點不需要動這個檔案
 * —— 手抄一份路由表的話，總有一天會出現「本機 404、線上正常」這種最花時間的 bug。
 * An endpoint file's default export is a handler, so this **dynamically loads each file** and uses its
 * own path as the route (`api/run/start.ts` → `/api/run/start`). Adding an endpoint therefore needs no
 * edit here — a hand-copied route table eventually produces the most expensive kind of bug: "404
 * locally, fine in production".
 *
 * ## 資料庫在 `.mysql/endchi.db` / The database lives in `.mysql/endchi.db`
 *
 * 是 **SQLite**，不是 MySQL：它是一個檔案（`api/_lib/db/sqlite.ts`），所以沒有服務要起、沒有埠要
 * 佔、沒有帳號密碼要填。整個 `.mysql/` 都在 `.gitignore` 裡，連 WAL 的兩個附屬檔
 * （`-wal`／`-shm`）一起忽略 —— 它們是執行期的產物，不該進版控。
 * It is **SQLite**, not MySQL: it is a file (`api/_lib/db/sqlite.ts`), so there is no service to start,
 * no port to occupy and no credentials to fill in. The whole `.mysql/` directory is gitignored,
 * including the two WAL side files (`-wal` / `-shm`) — they are runtime artefacts and do not belong in
 * version control.
 *
 * ⚠️ SQLite **不是部署選項**（函式的檔案系統是拋棄式的，見 `sqlite.ts` 檔頭）。它換掉的是「本機要
 * 先起一個資料庫」這件事，不是正式環境的資料庫。
 * ⚠️ SQLite is **not a deployment target** (a function's filesystem is ephemeral; see the header of
 * `sqlite.ts`). What it replaces is "you must start a database first", not the production database.
 *
 * ## 用法 / Usage
 *
 *   npm run dev          # 這個檔案：API（SQLite）＋ Vite
 *   npm run dev:web      # 只有 Vite（前端；打不到 API，適合純 UI 的改動）
 *
 * 環境變數（都有預設值）：`DEV_API_PORT`、`DATABASE_URL`、`RUN_TOKEN_SECRET`。
 * Environment variables, all defaulted: `DEV_API_PORT`, `DATABASE_URL`, `RUN_TOKEN_SECRET`.
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

/** API 伺服器的埠。**只出現在這裡** —— Vite 的代理是下面當場組出來的，所以不會有第二份。 */
const API_PORT = Number(process.env['DEV_API_PORT'] ?? '') || 8787;
const API_HOST = '127.0.0.1';
const API_ORIGIN = `http://${API_HOST}:${API_PORT}`;

/** 端點檔所在的位置。 */
const API_DIR = fileURLToPath(new URL('../api', import.meta.url));

/** 一個端點檔的預設匯出。型別由轉接頭決定，不另外宣告一份。 */
type Endpoint = ReturnType<typeof createVercelHandler>;

/**
 * 開發用的環境變數預設值。
 * Development defaults for the environment variables.
 *
 * **只補沒有設定過的鍵**，所以 `.env`（由 `npm run dev` 的 `--env-file-if-exists=.env` 載入）永遠
 * 優先 —— 想在本機測真的 Neon 或騰訊雲，只要在 `.env` 裡填 `DATABASE_URL` 就好，不必改任何程式。
 * Only keys that are **not already set** are filled in, so `.env` (loaded by `npm run dev`'s
 * `--env-file-if-exists=.env`) always wins: pointing local development at a real Neon or Tencent
 * database is a matter of putting `DATABASE_URL` in `.env`, with no code change.
 *
 * `RUN_TOKEN_SECRET` 這個值**是公開的、故意很明顯不是秘密**。它只在這個檔案裡當預設值，而
 * `loadConfig()` 會拒絕任何短於 32 字元的秘密 —— 所以它不能、也不該被帶到任何真實部署上。
 * The `RUN_TOKEN_SECRET` below is **public and deliberately obvious about not being a secret**. It is
 * only ever a default inside this file, and `loadConfig()` rejects any secret shorter than 32
 * characters — so it cannot, and must not, travel to a real deployment.
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
 * 這個檔案或資料夾要跳過嗎。
 * Should this file or directory be skipped.
 *
 * `_lib` 是共用程式碼而不是端點，所以整棵子樹都跳過；其餘以 `_` 開頭的檔案同理。這**不是**本專案自己
 * 發明的慣例 —— Vercel 也把 `api/` 底下以 `_` 開頭的檔案排除在函式之外，所以這一行的行為與部署時
 * 一致。
 * `_lib` is shared code rather than an endpoint, so the whole subtree is skipped; any other
 * `_`-prefixed file likewise. This is **not** a convention invented here — Vercel also excludes
 * `_`-prefixed files under `api/` from becoming functions, so this line behaves the way deployment
 * does.
 */
function isPrivate(name: string): boolean {
  return name.startsWith('_');
}

/**
 * 掃出所有端點，回一個「路徑 → 處理器」的表。
 * Scan every endpoint into a "path → handler" table.
 *
 * 載入失敗**不吞掉**：一個端點檔匯入不了（打錯字、指向不存在的模組）在開發時就該當場炸掉，而不是等
 * 到你打開那一頁才 404。
 * A failed load is **not swallowed**: an endpoint file that cannot be imported (a typo, a module that
 * does not exist) should blow up right here, not 404 later when you happen to open that page.
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
 * 讀完一個請求的主體，回**文字**。
 * Read a request body to completion and return it as **text**.
 *
 * 回文字而不是解析過的物件是刻意的：轉接頭自己會呼叫 `coerceBody`（見 `http.ts`），而 `fetch.ts`
 * 那條路徑傳的也正是文字 —— 所以在這裡先解析一次等於讓本機與雲上走不同的分支，而那個分支正好是
 * 「什麼算 JSON」這件容易分歧的事。
 * Returning text rather than a parsed object is deliberate: the adapter calls `coerceBody` itself (see
 * `http.ts`), and the `fetch.ts` path also hands over text — parsing here would put local and cloud on
 * different branches, and that branch is exactly the easily-diverging question of "what counts as
 * JSON".
 *
 * `GET`／`HEAD` 沒有主體，所以直接回 `null` 而不是讀一個空字串：`coerceBody('')` 也是 `null`，但
 * 不讀就少一次 `await`，而且讀了在某些傳輸層會直接拋錯。
 * `GET` / `HEAD` have no body, so this returns `null` rather than reading an empty string:
 * `coerceBody('')` is `null` too, but not reading is one fewer `await` and reading throws on some
 * transports.
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

/* 連線字串的建議（見 `db/index.ts`）。SQLite 那一條講的是「這個選擇不該上線」。 */
for (const note of connectionNotesFor(config.dbDialect, config.databaseUrl)) {
  console.warn(`[dev] ${note}`);
}

/*
 * 建表用它自己的驅動，而且用完就關：`runtime.ts` 會在**第一個請求**時才建自己那一份（連線池住在
 * 模組層級、整個行程共用），兩者不該互相牽扯。SQLite 是檔案，所以開兩條連線完全沒有代價。
 * The migration uses its own driver and closes it right away: `runtime.ts` builds its own on the
 * **first request** (the pool lives at module scope and is shared by the process), and the two should
 * not be entangled. With SQLite being a file, opening a second connection costs nothing.
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
 * 這個函式裡**沒有**任何業務邏輯 —— CORS、接收紀錄、未預期的 500 全都在 `runtime.ts` 與轉接頭裡，
 * 與線上完全相同。
 * There is **no** business logic in this function: CORS, the request log and the unexpected-500 path
 * all live in `runtime.ts` and the adapter, identical to production.
 */
const api = createServer((req, res) => {
  void (async () => {
    const url = req.url ?? '/';
    const path = url.split('?')[0] ?? '';
    const handler = routes.get(path);

    if (handler === undefined) {
      /*
       * 同一個 JSON 錯誤形狀（見 `http.ts` 的 `fail`），這樣客戶端不必為「本機專屬的 404」寫分支。
       * 順便把認得的路徑列出來 —— 在終端機打錯一個字時，這比一個光禿禿的 404 有用得多。
       * The same JSON error shape as `fail` in `http.ts`, so the client needs no branch for a
       * dev-only 404 — and the known paths are listed, which is far more useful than a bare 404 when a
       * character was mistyped in a terminal.
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
        /*
         * 假裝有一個反向代理在前面。轉接頭讀的是 `x-forwarded-for`／`x-real-ip`（見 `fetch.ts`），
         * 而 Vercel 一定會設前者 —— 少了這一行，接收紀錄裡的 IP 就永遠是空的，而「IP 是空的」正好是
         * 本機與線上最容易一直沒發現的差異。真正的位址就是 `127.0.0.1`／`::1`，沒有東西可以外洩。
         * Pretend a reverse proxy is in front. The adapter reads `x-forwarded-for` / `x-real-ip` (see
         * `fetch.ts`) and Vercel always sets the former — without this line the request log's IP is
         * always empty, and "the IP is empty" is exactly the local-versus-production difference that
         * hides longest. The address really is `127.0.0.1` / `::1`, so there is nothing to leak.
         */
        headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress ?? '' },
        body: await readBody(req),
        socket: req.socket,
      },
      res,
    );
  })().catch((error: unknown) => {
    /*
     * 走到這裡代表連轉接頭都炸了（它自己會把處理器的例外收成 500）。實務上只有「讀主體時連線斷了」
     * 這一種，所以回一個空的 400 就好 —— 但一定要結束回應，否則瀏覽器會一直等。
     * Reaching here means the adapter itself threw (it already turns handler exceptions into a 500). In
     * practice that is only "the connection dropped while reading the body", so an empty 400 is enough
     * — but the response must be ended, or the browser waits forever.
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
     * 代理在**這裡**設定而不是 `vite.config.ts`：那個檔案是給部署用的，而這個代理只在本機的這一個
     * 指令裡成立。設定在這裡還有一個好處 —— 埠號只寫一次，不會出現「改了 script 的埠、忘了改
     * config 的埠」。
     * The proxy is configured **here** rather than in `vite.config.ts`: that file is about deployment
     * and this proxy only exists for this one local command. Keeping it here also means the port is
     * written down once, so "changed the port in the script, forgot the config" cannot happen.
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
 * 收工時把兩邊都關掉。
 * Shut both sides down on the way out.
 *
 * 順序是 Vite 先、API 後：反過來的話，瀏覽器還開著的那一頁在 Vite 關閉的瞬間可能送出一兩個請求，
 * 而它們會撞上一個已經在關的伺服器，在 console 留下一串沒有意義的錯誤。
 * Vite first, then the API: the other order lets the page still open in the browser fire one or two
 * requests the moment Vite goes down, and they would hit an API that is already closing and leave
 * meaningless errors in the console.
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
