/**
 * 端點用的最小 HTTP 抽象。
 * The minimal HTTP abstraction the endpoints are written against.
 *
 * 這裡刻意**不依賴 `@vercel/node`**：處理器只認得 `ApiRequest` → `ApiResponse` 這個形狀，Vercel
 * 只是其中一個轉接頭（`createVercelHandler`）。好處有三個：單元測試可以直接餵一個物件呼叫處理
 * 器（不必起 HTTP、不必有 Vercel CLI）、換執行環境只換轉接頭、而型別檢查與部署平台解耦。
 * This deliberately **does not depend on `@vercel/node`**: a handler only knows the `ApiRequest` →
 * `ApiResponse` shape, and Vercel is one adapter among possible others (`createVercelHandler`). Three
 * benefits: tests call a handler with a plain object (no HTTP, no Vercel CLI), swapping runtimes
 * swaps one adapter, and type-checking is decoupled from the deploy platform.
 */

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  /** 標頭鍵一律**小寫**（HTTP 標頭不分大小寫，混著用會漏撿）。 */
  readonly headers: Readonly<Record<string, string>>;
  /** 已解析的 JSON 主體；沒有主體時為 `null`。 */
  readonly body: unknown;
  /** 連線來源位址（未經任何代理判斷）；真正的客戶端位址見 `requests.ts` 的 `clientIp`。 */
  readonly remoteAddress: string;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type Handler = (request: ApiRequest) => Promise<ApiResponse>;

export interface JsonObject {
  readonly [key: string]: unknown;
}

/** 一個成功回應。 */
export function ok(body: JsonObject, headers?: Record<string, string>): ApiResponse {
  return { status: 200, body, ...(headers === undefined ? {} : { headers }) };
}

/**
 * 一個失敗回應。錯誤形狀固定成 `{ ok: false, error: { code, message } }`：客戶端只要認 `code`
 * 就能分支，`message` 是給人看的（**不進**任何 UI 文案，UI 文案在客戶端的字典裡）。
 * A failure response. The error shape is fixed at `{ ok: false, error: { code, message } }`: a client
 * can branch on `code`, while `message` is for humans reading logs — it is **not** UI copy, which
 * lives in the client's dictionaries.
 */
export function fail(status: number, code: string, message: string): ApiResponse {
  return { status, body: { ok: false, error: { code, message } } };
}

export function methodNotAllowed(allowed: readonly string[]): ApiResponse {
  return {
    status: 405,
    headers: { allow: allowed.join(', ') },
    body: { ok: false, error: { code: 'method_not_allowed', message: `use ${allowed.join('/')}` } },
  };
}

/** 把 `Headers`-like 的東西正規化成小寫鍵的普通物件；陣列值取第一個。 */
export function normaliseHeaders(
  raw: Readonly<Record<string, string | string[] | undefined>>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === 'string') headers[key.toLowerCase()] = single;
  }

  return headers;
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

/** 讀一個欄位必須是普通物件；否則回 `null`。 */
export function asObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  return value as JsonObject;
}

/** 讀一個字串欄位並套上長度上限；非字串或空字串回 `null`。 */
export function readString(source: JsonObject, key: string, maxLength: number): string | null {
  const value = source[key];
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) return null;

  return trimmed;
}

/**
 * 讀一個整數欄位並夾在 `[min, max]`。
 * Read an integer field, clamped into `[min, max]`.
 *
 * 小數與 `NaN` 一律拒絕而不是四捨五入：分數帶小數點沒有意義，而把它悄悄修掉會讓「伺服器算出來
 * 的值」與「客戶端送來的值」不一致 —— 這種不一致正是反作弊要抓的東西，不該由我們自己製造。
 * Fractions and `NaN` are rejected rather than rounded: a fractional score means nothing, and
 * silently fixing it would make the server's value disagree with the client's — exactly the kind of
 * disagreement the anti-cheat exists to catch, and not something we should introduce ourselves.
 */
export function readInteger(
  source: JsonObject,
  key: string,
  min: number,
  max: number,
): number | null {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;

  return value;
}

/* ── Vercel 轉接頭 ───────────────────────────────────────────────────────────
 * 只用結構型別描述 Vercel 的 req/res，所以不需要 `@vercel/node` 這個相依：我們用到的欄位就是
 * 這幾個，而少一個相依就是少一份部署時要對齊的版本。
 * Vercel's req/res are described structurally only, so `@vercel/node` is not a dependency: these are
 * the fields we use, and one fewer dependency is one fewer version to line up at deploy time.
 */

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

/** Vercel 對 JSON 主體會先解析成物件；其他型別可能還是字串，這裡補一次。 */
function normaliseBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 不是 JSON 就當作沒有主體：端點只收 JSON，形狀不對會在欄位驗證那關被擋下。 */
    return null;
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
      body: normaliseBody(req.body),
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

    res.end(JSON.stringify(response.body));
  };
}
