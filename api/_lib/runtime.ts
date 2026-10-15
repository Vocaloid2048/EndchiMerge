/**
 * 執行期外殼：載入設定、呼叫核心處理器（未預期例外收斂成 500）、寫接收紀錄（4xx/5xx 也寫）、補上 CORS。
 * The runtime shell: loads the config, calls the core handler (collapsing unexpected exceptions
 * into a 500), writes the receive log (also for 4xx/5xx) and adds CORS.
 *
 * 儲存層按 `STORAGE_BACKEND` 選：sql 走 SQL（Postgres/MySQL/SQLite），kv 走 EdgeOne KV。兩者都用
 * 動態 import，使邊緣套件圖**完全不會**引入 `mysql2`／`pg`／`node:sqlite`（那些是 Node 專用，V8 跑不了）。
 * The store is chosen by `STORAGE_BACKEND`: sql uses SQL (Postgres/MySQL/SQLite), kv uses EdgeOne KV.
 * Both are dynamic imports so the edge bundle never pulls in `mysql2` / `pg` / `node:sqlite` (Node-only,
 * which the V8 runtime cannot run).
 */

import type { Driver } from './db/types.js';
import { readConfig, type Config } from './env.js';
import type { CoreHandler, Deps } from './handlers.js';
import { fail, type ApiRequest, type ApiResponse, type Handler } from './http.js';
import type { Store } from './store.js';

/**
 * 模組層級的相依快取：同一實例的多個請求共用一組相依，避免每請求重建（含冷啟動的 KV 解析）。
 * A module-scope dependency cache: requests on one instance share one set of dependencies, so they are
 * not rebuilt per request (including the cold-start KV resolution).
 */
let deps: Deps | null = null;
let activeDriver: Driver | null = null;

/**
 * 設定的來源；邊緣執行時由轉接頭把 `context.env` 注入這裡（V8 沒有 `process.env`）。
 * The config source; under an edge runtime the adapter injects `context.env` here (V8 has no `process.env`).
 */
let envSource: Readonly<Record<string, string | undefined>> | null = null;

/** 邊緣轉接頭呼叫：把 `context.env` 設成設定來源。
 * Called by the edge adapter: makes `context.env` the config source. */
export function setEnvSource(env: Readonly<Record<string, string | undefined>>): void {
  envSource = env;
}

function currentEnv(): Readonly<Record<string, string | undefined>> {
  if (envSource !== null) return envSource;
  return process.env as Readonly<Record<string, string | undefined>>;
}

async function buildDependencies(): Promise<Deps> {
  const result = readConfig(currentEnv());
  if (!result.ok) {
    throw new Error(`missing or invalid environment variables: ${result.missing.join(', ')} (see .env.example)`);
  }
  const config: Config = result.config;

  if (config.storageBackend === 'kv') {
    const { createKvStore } = await import('./store/kvStoreFactory.js');
    const { store, driver } = createKvStore(config);
    activeDriver = driver;
    return { config, store, now: () => Date.now() };
  }

  const { createStore, connectionNotesFor } = await import('./db/index.js');
  for (const note of connectionNotesFor(config.dbDialect, config.databaseUrl)) {
    console.warn(`[api] ${note}`);
  }
  const { store, driver } = createStore(config);
  activeDriver = driver;
  return { config, store, now: () => Date.now() };
}

async function dependencies(): Promise<Deps> {
  if (deps === null) deps = await buildDependencies();
  return deps;
}

/**
 * 測試或本機工具用：換一組相依（或清掉快取與連線池）。
 * For tests and local tooling: swaps the dependencies (or clears the cache and the pool).
 */
export async function closeDependencies(): Promise<void> {
  const driver = activeDriver;
  activeDriver = null;
  deps = null;

  if (driver !== null) await driver.close();
}

/**
 * 同步版本：直接換相依，不管連線池（測試用）；也可傳 `null` 清掉快取，讓下一個請求重建。
 * The synchronous variant: swaps dependencies only, leaving the pool alone (for tests); `null` clears
 * the cache so the next request rebuilds.
 */
export function setDependencies(next: Deps | null): void {
  deps = next;
  activeDriver = null;
}

/**
 * 只有設定了 `ALLOWED_ORIGIN` 才發 CORS；清單為空時連 `vary` 都不加。
 * Emits CORS only when `ALLOWED_ORIGIN` is configured; with an empty list not even `vary` is sent.
 */
function corsHeaders(request: ApiRequest, config: Config): Record<string, string> {
  const origin = request.headers['origin'];
  if (origin === undefined) return {};

  /*
   * 空清單 ＝ 只接受同源：不回應 CORS 標頭，瀏覽器自己擋跨來源（預設安全的那一邊）。
   * An empty list means same-origin only: no CORS header is emitted and the browser blocks
   * cross-origin reads by itself — the safe side of the default.
   */
  if (config.allowedOrigins.length === 0) return {};

  if (!config.allowedOrigins.includes(origin)) return {};

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    /*
     * 回應會隨 `Origin` 而變，快取不能拿單一份回應服務所有人。
     * The response varies with `Origin`, so caches must not serve one response to everyone.
     */
    vary: 'origin',
  };
}

/**
 * 前置請求（CORS preflight）：直接回 204，不必進到處理器。
 * The CORS preflight: answers 204 directly, without reaching the handler.
 */
function preflight(request: ApiRequest, config: Config): ApiResponse | null {
  if (request.method !== 'OPTIONS') return null;

  return { status: 204, body: null, headers: corsHeaders(request, config) };
}

/**
 * 把接收紀錄寫進儲存層；失敗不得影響回應。
 * Writes the receive log to the store; a failure must never affect the response.
 *
 * ⚠️ 私隱：只寫端點維運需要的五個欄位 —— IP 與標頭屬個人資料，**不得**加回來（見 `RequestRow`）。
 * ⚠️ Privacy: only the five fields operations needs — IPs and headers are personal data and must **not** be added back.
 */
async function logRequest(
  request: ApiRequest,
  response: ApiResponse,
  context: { config: Config; store: Store },
  handled: { deviceId: string | null; runId: string | null },
): Promise<void> {
  try {
    await context.store.insertRequest({
      method: request.method,
      path: request.path,
      status: response.status,
      deviceId: handled.deviceId,
      runId: handled.runId,
    });
  } catch (error) {
    /*
     * 紀錄寫不進去只是少了審計痕跡，吞掉是刻意的：不讓一筆紀錄把成功的提交變成 500。
     * A failed log write only loses an audit trail; swallowing it is deliberate — a log insert must
     * not turn a successful submission into a 500.
     */
    console.error('[api] could not write the request log', error);
  }
}

/**
 * 一個可部署的端點；平台無關（轉接頭見 `adapters/`）。
 * A deployable endpoint; platform-agnostic (adapters live in `adapters/`).
 */
export function endpoint(core: CoreHandler): Handler {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    const current = await dependencies();

    const early = preflight(request, current.config);
    if (early !== null) return early;

    let handled: { response: ApiResponse; deviceId: string | null; runId: string | null };

    try {
      handled = await core(request, current);
    } catch (error) {
      console.error('[api] unhandled error', error);
      handled = {
        response: fail(500, 'internal_error', 'internal error'),
        deviceId: null,
        runId: null,
      };
    }

    await logRequest(request, handled.response, current, handled);

    return {
      ...handled.response,
      headers: { ...corsHeaders(request, current.config), ...(handled.response.headers ?? {}) },
    };
  };
}
