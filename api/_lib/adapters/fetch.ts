/**
 * Web 標準（`Request` → `Response`）的轉接頭：EdgeOne Pages Functions 與其他邊緣型執行環境共用。
 * The Web-standard (`Request` → `Response`) adapter, shared by EdgeOne Pages Functions and other
 * edge-style runtimes.
 */

import { coerceBody, fail, normaliseHeaders, type ApiRequest, type ApiResponse, type Handler } from '../http.js';

export type FetchHandler = (request: Request) => Promise<Response>;

/**
 * 204／304 不得帶主體。
 * Statuses 204 and 304 must not carry a body.
 */
function bodyAllowed(status: number): boolean {
  return status !== 204 && status !== 304;
}

/**
 * 把一個處理器接成 Web 標準的 `fetch` 函式。
 * Wires a handler into a Web-standard `fetch` function.
 */
export function createFetchHandler(handler: Handler): FetchHandler {
  return async function fetchHandler(request: Request): Promise<Response> {
    /*
     * GET／HEAD 沒有主體，讀了在部分 runtime 會拋錯。
     * GET and HEAD have no body; reading one throws on some runtimes.
     */
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const raw = hasBody ? await request.text().catch(() => '') : '';

    const url = new URL(request.url);

    const apiRequest: ApiRequest = {
      method: request.method.toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: normaliseHeaders(Object.fromEntries(request.headers) as Record<string, string>),
      body: coerceBody(raw),
    };

    let response: ApiResponse;

    try {
      response = await handler(apiRequest);
    } catch (error) {
      /*
       * 未預期例外 → 500：訊息只進日誌，不回給客戶端（與 Vercel 轉接頭同一條規則）。
       * An unexpected exception becomes a 500: the message goes to the log only, never to the
       * client (the same rule as the Vercel adapter).
       */
      console.error('[api] unhandled error', error);
      response = fail(500, 'internal_error', 'internal error');
    }

    return new Response(bodyAllowed(response.status) ? JSON.stringify(response.body ?? null) : null, {
      status: response.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(response.headers ?? {}),
      },
    });
  };
}

/**
 * EdgeOne Pages Functions 的上下文；只宣告我們用到的欄位。
 * The EdgeOne Pages Functions context; only the fields we use are declared.
 */
export interface EdgeOneContext {
  readonly request: Request;
}

/**
 * 產生 EdgeOne Pages Functions 的具名匯出；三個匯出指向同一個處理器，方法判斷只留一處（不對的方法由處理器回 405）。
 * Produces EdgeOne Pages Functions' named exports; all three point at the same handler, so the
 * method check lives in exactly one place (a wrong method gets a 405 from the handler).
 *
 * ⚠️ 相對路徑要帶 `.js`：`"type": "module"` 且函式平台逐檔轉譯、不打包，少副檔名部署後就是 `ERR_MODULE_NOT_FOUND`（本機 `tsx`／`vitest` 會替你補上，看不出來）。規則適用 `api/**` 內每一處相對 import，`api/` 之外不適用。
 * ⚠️ Relative paths must carry `.js`: `"type": "module"` plus per-file transpilation with no
 * bundling means a missing extension is a runtime `ERR_MODULE_NOT_FOUND` after deploy (invisible
 * locally, where `tsx` / `vitest` fill it in). Holds for every relative import inside `api/**`; it
 * does not apply outside `api/`.
 *
 * ```js
 * import { endpoint } from '../../api/_lib/runtime.js';
 * import { handleScore } from '../../api/_lib/handlers.js';
 * import { createEdgeOneHandlers } from '../../api/_lib/adapters/fetch.js';
 *
 * export const { onRequestGet, onRequestPost, onRequestOptions } = createEdgeOneHandlers(endpoint(handleScore));
 * ```
 */
export function createEdgeOneHandlers(handler: Handler): {
  onRequestGet: (context: EdgeOneContext) => Promise<Response>;
  onRequestPost: (context: EdgeOneContext) => Promise<Response>;
  onRequestOptions: (context: EdgeOneContext) => Promise<Response>;
} {
  const run = createFetchHandler(handler);
  const route = (context: EdgeOneContext): Promise<Response> => run(context.request);

  return { onRequestGet: route, onRequestPost: route, onRequestOptions: route };
}
