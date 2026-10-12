/**
 * Vercel（Node 函式）的轉接頭。
 * The Vercel (Node function) adapter.
 *
 * 只用**結構型別**描述 Vercel 的 `req`／`res`，所以不需要 `@vercel/node` 這個相依：我們用到的欄位
 * 就是這幾個，而少一個相依就是少一份部署時要對齊的版本。
 * Vercel's `req` / `res` are described **structurally only**, so `@vercel/node` is not a dependency:
 * these are the fields we use, and one fewer dependency is one fewer version to line up at deploy
 * time.
 *
 * 這個檔案是三個轉接頭之一。要把端點搬到別的執行環境時**只換這一個檔案**，核心（`handlers.ts`、
 * `runtime.ts`）完全不用動。
 * This is one of several adapters. Moving the endpoints to another runtime **swaps only this file**;
 * the core (`handlers.ts`, `runtime.ts`) does not change at all.
 */

import { coerceBody, fail, normaliseHeaders, type ApiRequest, type ApiResponse, type Handler } from '../http';
import type { CoreHandler } from '../handlers';
import { endpoint } from '../runtime';

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

/** 從 URL 組出查詢參數；壞 URL 一律當作沒有參數。 */
function parseQuery(url: string): URLSearchParams {
  const index = url.indexOf('?');
  if (index < 0) return new URLSearchParams();

  try {
    return new URLSearchParams(url.slice(index + 1));
  } catch {
    return new URLSearchParams();
  }
}

/** 把一個處理器接成 Vercel 的 Node 函式。 */
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
       * 未預期的例外一律轉成 500，而且**只把訊息寫進伺服器日誌**。把內部錯誤訊息回給客戶端會
       * 洩漏實作細節（連線字串、SQL 片段），而且是那種會出現在截圖裡的細節。
       * An unexpected exception becomes a 500 with the message written **only to the server log**.
       * Returning internal messages to clients leaks implementation details (connection strings, SQL
       * fragments) — the kind of detail that ends up in a screenshot.
       */
      console.error('[api] unhandled error', error);
      response = fail(500, 'internal_error', 'internal error');
    }

    res.statusCode = response.status;
    for (const [name, value] of Object.entries(response.headers ?? {})) {
      res.setHeader(name, value);
    }

    /* 204／304 不得帶主體：硬塞一個 "null" 會讓某些代理直接把回應變成 502。 */
    res.end(response.status === 204 || response.status === 304 ? undefined : JSON.stringify(response.body ?? null));
  };
}

/**
 * 端點檔案的預設匯出（Vercel 版）。
 * An endpoint file's default export, the Vercel flavour.
 *
 * 把「外殼（`endpoint`）＋ 轉接頭」串成一行，好讓端點檔只有一行、而且**意圖看得出來是哪個平台**：
 * `export default vercelEndpoint(handleScore)` 對比
 * `export const { onRequestPost } = createEdgeOneHandlers(endpoint(handleScore))`。
 * Chains the shell (`endpoint`) and the adapter into one line, so an endpoint file is one line and the
 * **platform is visible in the intent**.
 */
export function vercelEndpoint(core: CoreHandler) {
  return createVercelHandler(endpoint(core));
}
