/**
 * 執行期外殼：載入設定、呼叫核心處理器（未預期例外收斂成 500）、寫接收紀錄（4xx/5xx 也寫）、補上 CORS。
 * The runtime shell: loads the config, calls the core handler (collapsing unexpected exceptions
 * into a 500), writes the receive log (also for 4xx/5xx) and adds CORS.
 */

import { connectionNotesFor, createStore } from './db/index.js';
import type { Driver } from './db/types.js';
import { loadConfig, type Config } from './env.js';
import type { CoreHandler, Deps } from './handlers.js';
import { fail, type ApiRequest, type ApiResponse, type Handler } from './http.js';

/**
 * 模組層級的相依快取：同一實例的多個請求共用一個連線池，避免每請求一池耗盡資料庫的連線數。
 * A module-scope dependency cache: requests on one instance share a single pool, since a pool per
 * request exhausts the database's connection limit quickly.
 */
let deps: Deps | null = null;

/**
 * 目前這個實例的驅動；`closeDependencies` 與測試要用。
 * The current instance's driver; used by `closeDependencies` and tests.
 */
let activeDriver: Driver | null = null;

function dependencies(): Deps {
  if (deps === null) {
    const config = loadConfig();

    /*
     * 連線字串的建議只印一次（相依只建一次）；這些不是錯誤，只是把「之後會出事」變成現在可見。
     * Connection-string advice, printed once (the dependency is built once); these are not errors,
     * they just make "this will hurt later" visible now.
     */
    for (const note of connectionNotesFor(config.dbDialect, config.databaseUrl)) {
      console.warn(`[api] ${note}`);
    }

    const { store, driver } = createStore(config);
    activeDriver = driver;
    deps = { config, store, now: () => Date.now() };
  }

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
 * 同步版本：只換相依，不管連線池（測試用）。
 * The synchronous variant: swaps dependencies only, leaving the pool alone (for tests).
 */
export function setDependencies(next: Deps | null): void {
  deps = next;
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
 * 把接收紀錄寫進資料庫；失敗不得影響回應。
 * Writes the receive log to the database; a failure must never affect the response.
 *
 * ⚠️ 私隱：只寫端點維運需要的五個欄位 —— IP 與標頭屬個人資料，**不得**加回來（見 `RequestRow`）。
 * ⚠️ Privacy: only the five fields operations needs — IPs and headers are personal data and must **not** be added back.
 */
async function logRequest(
  request: ApiRequest,
  response: ApiResponse,
  context: { config: Config; store: Deps['store'] },
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
    const current = dependencies();

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
