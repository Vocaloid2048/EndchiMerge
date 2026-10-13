/**
 * Vercel（Node 函式）的轉接頭：`req`／`res` 只用結構型別描述，不需要 `@vercel/node` 相依。
 * The Vercel (Node function) adapter: `req` / `res` are described structurally, so `@vercel/node`
 * is not a dependency.
 */

import { coerceBody, fail, normaliseHeaders, type ApiRequest, type ApiResponse, type Handler } from '../http.js';
import type { CoreHandler } from '../handlers.js';
import { endpoint } from '../runtime.js';

interface VercelRequestLike {
  readonly method?: string;
  readonly url?: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body?: unknown;
  readonly socket?: { readonly remoteAddress?: string };
}

interface VercelResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

/**
 * 從 URL 組出查詢參數；壞 URL 一律當作沒有參數。
 * Builds the query parameters from the URL; a bad URL means no parameters, always.
 */
function parseQuery(url: string): URLSearchParams {
  const index = url.indexOf('?');
  if (index < 0) return new URLSearchParams();

  try {
    return new URLSearchParams(url.slice(index + 1));
  } catch {
    return new URLSearchParams();
  }
}

/**
 * 把一個處理器接成 Vercel 的 Node 函式。
 * Wires a handler into a Vercel Node function.
 */
export function createVercelHandler(handler: Handler) {
  return async function vercelHandler(req: VercelRequestLike, res: VercelResponseLike) {
    const url = req.url ?? '';

    const request: ApiRequest = {
      method: (req.method ?? 'GET').toUpperCase(),
      path: url.split('?')[0] ?? '',
      query: parseQuery(url),
      headers: normaliseHeaders(req.headers),
      body: coerceBody(req.body),
      remoteAddress: req.socket?.remoteAddress ?? '',
    };

    let response: ApiResponse;

    try {
      response = await handler(request);
    } catch (error) {
      /*
       * 未預期例外一律轉成 500，訊息只寫進伺服器日誌：回給客戶端會洩漏實作細節（連線字串、SQL 片段）。
       * An unexpected exception becomes a 500 with the message written only to the server log:
       * returning it to clients would leak implementation details (connection strings, SQL fragments).
       */
      console.error('[api] unhandled error', error);
      response = fail(500, 'internal_error', 'internal error');
    }

    res.statusCode = response.status;
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      res.setHeader(name, value);
    }

    /*
     * 204／304 不得帶主體：硬塞一個 "null" 會讓某些代理直接把回應變成 502。
     * Statuses 204 and 304 must not carry a body: forcing a "null" makes some proxies turn the
     * response into a 502.
     */
    res.end(response.status === 204 || response.status === 304 ? undefined : JSON.stringify(response.body ?? null));
  };
}

/**
 * 端點檔案的預設匯出（Vercel 版）：把外殼與轉接頭串成一行，端點檔一行即可看出平台。
 * An endpoint file's default export, the Vercel flavour: chains the shell and the adapter into one
 * line, so the endpoint file shows its platform at a glance.
 */
export function vercelEndpoint(core: CoreHandler) {
  return createVercelHandler(endpoint(core));
}
