/**
 * Web 標準（`Request` → `Response`）的轉接頭。
 * The Web-standard (`Request` → `Response`) adapter.
 *
 * 這是**所有邊緣型執行環境**共同的形狀，包括：
 *   - 騰訊 **EdgeOne Pages Functions**（Edge Functions 與 Node Functions 都是 `export const
 *     onRequestGet = async (context) => Response`，`context.request` 是標準 `Request`）；
 *   - Cloudflare Pages／Workers、Deno Deploy、Bun、Next.js 的 Route Handlers。
 * This is the shape **every edge-style runtime** shares, including Tencent's **EdgeOne Pages
 * Functions** (both Edge and Node Functions export `onRequestGet = async (context) => Response`,
 * where `context.request` is a standard `Request`), plus Cloudflare Pages/Workers, Deno Deploy, Bun
 * and Next.js Route Handlers.
 *
 * ## 這對「共用程式碼」意味著什麼 / What this means for code sharing
 *
 * `handlers.ts` 與 `runtime.ts` 完全不知道自己在哪裡跑 —— 它們只看到 `ApiRequest`／`ApiResponse`。
 * 所以同一份業務邏輯（反作弊、榜的排序、接收紀錄）可以直接餵給這個轉接頭，不需要複製任何一行。
 * 真正要各自處理的只有三件事：**路由宣告的形狀**、**怎麼拿到客戶端 IP**、**資料庫驅動能不能開
 * TCP**。前兩件在這個檔案裡；第三件在 `db/` 那一層。
 * `handlers.ts` and `runtime.ts` have no idea where they run — they only see `ApiRequest` /
 * `ApiResponse`. So the same business logic (anti-cheat, board ordering, the request log) plugs
 * straight into this adapter with no line copied. Only three things genuinely differ per platform:
 * **the shape of the route declaration**, **how the client IP is read**, and **whether the database
 * driver can open a TCP connection**. The first two are here; the third lives in `db/`.
 */

import { coerceBody, fail, normaliseHeaders, type ApiRequest, type ApiResponse, type Handler } from '../http.js';

export type FetchHandler = (request: Request) => Promise<Response>;

/**
 * 從請求標頭讀客戶端位址。
 * Read the client address from the request headers.
 *
 * 邊緣平台幾乎都把真實來源放在 `x-forwarded-for`（最左邊那個）。這裡只做「取第一個」，其餘的判斷
 * 與正規化（埠、`::ffff:`）留在 `requests.ts` 的 `clientIp`，好讓三個轉接頭的行為一致。
 * Edge platforms almost all put the real source in `x-forwarded-for` (the left-most entry). This only
 * takes the first one; the rest of the parsing and normalisation (ports, `::ffff:`) stays in
 * `requests.ts`'s `clientIp` so all adapters behave the same.
 */
function forwardedAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') return first;
  }

  return request.headers.get('x-real-ip')?.trim() ?? '';
}

/** 204／304 不得帶主體。 */
function bodyAllowed(status: number): boolean {
  return status !== 204 && status !== 304;
}

/** 把一個處理器接成 Web 標準的 `fetch` 函式。 */
export function createFetchHandler(handler: Handler): FetchHandler {
  return async function fetchHandler(request: Request): Promise<Response> {
    /* 讀主體：GET／HEAD 沒有主體，讀了在部分 runtime 會拋錯。 */
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const raw = hasBody ? await request.text().catch(() => '') : '';

    const url = new URL(request.url);

    const apiRequest: ApiRequest = {
      method: request.method.toUpperCase(),
      path: url.pathname,
      query: url.searchParams,
      headers: normaliseHeaders(Object.fromEntries(request.headers) as Record<string, string>),
      body: coerceBody(raw),
      remoteAddress: forwardedAddress(request),
    };

    let response: ApiResponse;

    try {
      response = await handler(apiRequest);
    } catch (error) {
      /* 與 Vercel 轉接頭同一條規則：訊息只進日誌，不回給客戶端。 */
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
 * EdgeOne Pages Functions 的上下文。只宣告我們用到的欄位。
 * The EdgeOne Pages Functions context. Only the fields we use are declared.
 */
export interface EdgeOneContext {
  readonly request: Request;
}

/**
 * 產生 EdgeOne Pages Functions 的具名匯出。
 * Produce EdgeOne Pages Functions' named exports.
 *
 * EdgeOne 用 `onRequestGet`／`onRequestPost`／`onRequestOptions` 這種**逐方法**的具名匯出來宣告路由，
 * 而我們的處理器自己就會判斷方法（不對的方法回 405）。所以三個匯出指向**同一個**處理器是正確的：
 * 方法判斷只有一處，三個平台分支不會各自漂移。
 * EdgeOne declares routes with **per-method** named exports (`onRequestGet` / `onRequestPost` /
 * `onRequestOptions`), while our handlers check the method themselves (a wrong one gets a 405). So
 * pointing all three exports at the **same** handler is the correct wiring: the method check lives in
 * exactly one place and the three platform entries cannot drift apart.
 *
 * 用法（`node-functions/api/score.js`）：
 * Usage (`node-functions/api/score.js`):
 *
 * ⚠️ 相對路徑**要帶 `.js`**。`package.json` 是 `"type": "module"`，而函式平台是**逐檔轉譯、不打包**，
 * 所以模組解析走的是 Node 的 ESM 規則 —— 少一個副檔名在部署後就是執行期的 `ERR_MODULE_NOT_FOUND`
 * （本機看不出來，因為 `tsx` 與 `vitest` 都會替我們補上）。這條規則在 `api/**` 內**每一處**相對
 * import 都成立，`api/` 之外則不適用。
 * ⚠️ Relative paths **must carry `.js`**. `package.json` is `"type": "module"` and function platforms
 * transpile **file by file, without bundling**, so module resolution follows Node's ESM rules — one
 * missing extension is a runtime `ERR_MODULE_NOT_FOUND` after deployment (invisible locally, because
 * `tsx` and `vitest` both fill it in for us). The rule holds for **every** relative import inside
 * `api/**`; it does not apply outside `api/`.
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
