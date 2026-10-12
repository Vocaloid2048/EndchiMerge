/**
 * 端點用的最小 HTTP 抽象。
 * The minimal HTTP abstraction the endpoints are written against.
 *
 * 這裡刻意**不依賴任何平台**：處理器只認得 `ApiRequest` → `ApiResponse` 這個形狀，而 Vercel、
 * EdgeOne、本機測試各自只是一個**轉接頭**（見 `adapters/`）。好處有三個：單元測試可以直接餵一個
 * 物件呼叫處理器（不必起 HTTP、不必有平台 CLI）、換執行環境只換轉接頭、而型別檢查與部署平台解耦。
 * This deliberately **depends on no platform**: a handler only knows the `ApiRequest` → `ApiResponse`
 * shape, and Vercel, EdgeOne and a local test are each just an **adapter** (see `adapters/`). Three
 * benefits: tests call a handler with a plain object (no HTTP, no platform CLI), swapping runtimes
 * swaps one adapter, and type-checking is decoupled from the deploy platform.
 *
 * ## 為什麼要分成兩個形狀而不是直接用 `Request`／`Response`
 * ## Why two shapes instead of using `Request` / `Response` directly
 *
 * 因為**不是所有平台都用 Web 標準**：Vercel 的 Node 函式給的是 `req`／`res` 這種 Node 物件。若核心
 * 直接吃 `Request`，Vercel 這邊就得先「反過來」把 Node 物件包成 `Request` —— 多一層轉換、多一處能
 * 出錯的地方。核心吃自己的形狀，兩個方向都只是**前向**轉接。
 * Because **not every platform speaks the Web standard**: a Vercel Node function hands you Node's
 * `req` / `res`. If the core took a `Request`, the Vercel side would have to wrap Node objects *into*
 * a `Request` — one more conversion and one more place to get it wrong. The core takes its own shape,
 * so both directions are forward adapters.
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

/* ── 回應 ──────────────────────────────────────────────────────────────────── */

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

/* ── 請求正規化（給轉接頭用）/ Request normalisation (used by the adapters) ── */

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

/**
 * 把「可能是字串的主體」收斂成值。
 * Coerce a possibly-string body into a value.
 *
 * Vercel 對 JSON 主體會先解析成物件，但其他型別（以及 fetch 那邊讀 `text()` 的結果）還是字串，
 * 所以在**兩個轉接頭共用的地方**補一次。不是 JSON 就當作沒有主體：端點只收 JSON，形狀不對會在
 * 欄位驗證那關被擋下。
 * Vercel parses a JSON body into an object for us, but other content types (and the `text()` result on
 * the fetch side) are still strings, so this is done once in the **place the two adapters share**.
 * Anything that is not JSON becomes "no body": the endpoints only accept JSON, and a wrong shape is
 * caught by field validation.
 */
export function coerceBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    /* 不是 JSON 就當作沒有主體（見上面）。 */
    return null;
  }
}

/* ── 欄位讀取 ──────────────────────────────────────────────────────────────── */

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
