/**
 * 執行期外殼：把核心處理器接上真實的設定、資料庫、接收紀錄與 CORS。
 * The runtime shell: wires a core handler to real configuration, the database, the receive log and
 * CORS.
 *
 * 外殼做四件事，順序有意義：
 *   1. **載入設定**（第一次呼叫時），失敗就直接讓它拋 —— 少一個環境變數時大聲壞掉，比安靜地跑一個
 *      沒有反作弊的後端好。
 *   2. **呼叫核心處理器**，並把任何未預期的例外收斂成 500。
 *   3. **寫接收紀錄**（IP ＋ 標頭白名單）。**即使處理器回了 4xx/5xx 也寫** —— 被擋下來的請求才是
 *      這張表最想看的東西。
 *   4. **補上 CORS 標頭**（只有設定了 `ALLOWED_ORIGIN` 才發）。
 * The shell does four things, in a meaningful order: load the config once (and throw loudly if an
 * environment variable is missing, which beats quietly running a backend with no anti-cheat), call the
 * core handler and collapse unexpected exceptions into a 500, write the receive log (IP plus
 * whitelisted headers) — **including for 4xx/5xx responses**, since rejected requests are precisely
 * what that table is for — and add CORS headers, only when `ALLOWED_ORIGIN` is configured.
 */

import { loadConfig, type Config } from './env';
import type { CoreHandler, Deps } from './handlers';
import { createVercelHandler, fail, type ApiRequest, type ApiResponse, type Handler } from './http';
import { PgStore } from './pgStore';
import { buildRequestRow, clientIp } from './requests';

/**
 * 模組層級的相依快取。
 * Dependency cache at module scope.
 *
 * Vercel 會重用同一個實例來處理多個請求，所以設定與連線池只該建一次。快取住在模組層級（而不是
 * 在處理器裡面 new），是為了讓同一個實例的請求共用一個連線池 —— 每個請求一個池子的話，很快就會
 * 把資料庫的連線數用光。
 * Vercel reuses one instance for several requests, so the config and the pool are built once. The cache
 * lives at module scope rather than inside the handler so requests on one instance share a single pool:
 * a pool per request exhausts the database's connection limit quickly.
 */
let deps: Deps | null = null;

function dependencies(): Deps {
  if (deps === null) {
    const config = loadConfig();
    deps = { config, store: new PgStore(config), now: () => Date.now() };
  }

  return deps;
}

/** 測試或本機工具用：換一組相依（或清掉快取）。 */
export function setDependencies(next: Deps | null): void {
  deps = next;
}

/** 只有設定了 `ALLOWED_ORIGIN` 才發 CORS；清單為空時連 `vary` 都不加。 */
function corsHeaders(request: ApiRequest, config: Config): Record<string, string> {
  const origin = request.headers['origin'];
  if (origin === undefined) return {};

  /*
   * 空清單 ＝ 只接受同源（正式部署的預設：前端與 API 都在 Vercel 上）。此時**不回應** CORS 標頭，
   * 瀏覽器就會自己擋下跨來源的讀取 —— 這是預設安全的那一邊。
   * An empty list means same-origin only, which is the production default (front end and API both on
   * Vercel). No CORS header is emitted, so the browser blocks cross-origin reads by itself — the safe
   * side of the default.
   */
  if (config.allowedOrigins.length === 0) return {};

  if (!config.allowedOrigins.includes(origin)) return {};

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    /* 回應會隨 `Origin` 而變，所以要讓快取知道不能用單一份回應服務所有人。 */
    vary: 'origin',
  };
}

/** 前置請求（CORS preflight）：直接回 204，不必進到處理器。 */
function preflight(request: ApiRequest, config: Config): ApiResponse | null {
  if (request.method !== 'OPTIONS') return null;

  return { status: 204, body: null, headers: corsHeaders(request, config) };
}

/** 把接收紀錄寫進資料庫。失敗**不得**影響回應。 */
async function logRequest(
  request: ApiRequest,
  response: ApiResponse,
  context: { config: Config; store: Deps['store'] },
  handled: { deviceId: string | null; runId: string | null },
  ip: string,
): Promise<void> {
  try {
    await context.store.insertRequest(
      buildRequestRow({
        method: request.method,
        path: request.path,
        status: response.status,
        deviceId: handled.deviceId,
        runId: handled.runId,
        ip,
        headers: request.headers,
        ipStorage: context.config.ipStorage,
        ipHashSecret: context.config.ipHashSecret,
      }),
    );
  } catch (error) {
    /*
     * 紀錄寫不進去只是少了審計痕跡，遊戲與榜都不受影響。這裡**吞掉**錯誤是刻意的：讓一個紀錄用的
     * 插入把一次成功的提交變成 500，是拿必要的事去換可有可無的事。
     * A failed log write only loses an audit trail; the game and the board are unaffected. Swallowing
     * it is deliberate: letting a logging insert turn a successful submission into a 500 trades
     * something essential for something optional.
     */
    console.error('[api] could not write the request log', error);
  }
}

/** 一個可部署的端點。 */
export function endpoint(core: CoreHandler): Handler {
  return async (request: ApiRequest): Promise<ApiResponse> => {
    const current = dependencies();

    const early = preflight(request, current.config);
    if (early !== null) return early;

    /* 客戶端位址只算一次：多個代理標頭、以及主體處理都不該改變它。 */
    const ip = clientIp(request.headers, request.remoteAddress);

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

    await logRequest(request, handled.response, current, handled, ip);

    return {
      ...handled.response,
      headers: { ...corsHeaders(request, current.config), ...(handled.response.headers ?? {}) },
    };
  };
}

/** 端點檔案的預設匯出：`export default endpointOf(handleScore)`。 */
export function endpointOf(core: CoreHandler) {
  return createVercelHandler(endpoint(core));
}
