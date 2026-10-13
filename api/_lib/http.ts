/**
 * 端點用的最小 HTTP 抽象，刻意不依賴任何平台：Vercel、EdgeOne、本機測試各自只是 `adapters/` 裡的轉接頭。
 * The minimal HTTP abstraction the endpoints use, deliberately platform-agnostic: Vercel, EdgeOne
 * and a local test are each just an adapter under `adapters/`.
 */

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  /** 標頭鍵一律小寫（HTTP 標頭不分大小寫，混著用會漏撿）。
   * Header keys are lowercase, always (headers are case-insensitive; mixing loses values). */
  readonly headers: Readonly<Record<string, string>>;
  /** 已解析的 JSON 主體；沒有主體時為 `null`。
   * The parsed JSON body; `null` when there is none. */
  readonly body: unknown;
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

/* ── 回應 / Responses ─────────────────────────────────────────────────────── */

/** 一個成功回應。
 * A success response. */
export function ok(body: JsonObject, headers?: Record<string, string>): ApiResponse {
  return { status: 200, body, ...(headers === undefined ? {} : { headers }) };
}

/**
 * 一個失敗回應；錯誤形狀固定成 `{ ok: false, error: { code, message } }`：客戶端分支認 `code`，`message` 是給人看的、不進 UI 文案。
 * A failure response, fixed at `{ ok: false, error: { code, message } }`: clients branch on
 * `code`, while `message` is for humans reading logs — never UI copy.
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

/* ── 請求正規化（給轉接頭用）/ Request normalisation (for the adapters) ──── */

/** 把 `Headers`-like 的東西正規化成小寫鍵的普通物件；陣列值取第一個。
 * Normalises a `Headers`-like value into a plain object with lowercase keys; array values take the first entry. */
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
 * 把「可能是字串的主體」收斂成值；在兩個轉接頭共用處補一次，不是 JSON 就當作沒有主體（形狀錯由欄位驗證擋下）。
 * Coerces a possibly-string body into a value, done once where the two adapters share code;
 * anything that is not JSON becomes "no body" (a wrong shape is caught by field validation).
 */
export function coerceBody(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/* ── 欄位讀取 / Field readers ─────────────────────────────────────────────── */

/** 讀一個欄位必須是普通物件；否則回 `null`。
 * Reads a field that must be a plain object; `null` otherwise. */
export function asObject(value: unknown): JsonObject | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  return value as JsonObject;
}

/** 讀一個字串欄位並套上長度上限；非字串或空字串回 `null`。
 * Reads a string field with a length cap; non-strings and empty strings give `null`. */
export function readString(source: JsonObject, key: string, maxLength: number): string | null {
  const value = source[key];
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) return null;

  return trimmed;
}

/**
 * 讀一個整數欄位並夾在 `[min, max]`；小數與 `NaN` 一律拒絕而非四捨五入，避免伺服器與客戶端的值不一致。
 * Reads an integer field clamped into `[min, max]`; fractions and `NaN` are rejected rather than
 * rounded, so the server's value never disagrees with the client's.
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
