/**
 * 後端設定：從環境變數讀出並在啟動時驗完；`RUN_TOKEN_SECRET` 硬性必填，其餘預設值皆取保守側。
 * Backend configuration, read from the environment and validated up front; `RUN_TOKEN_SECRET` is a
 * hard requirement, and every other default is the conservative side.
 *
 * `STORAGE_BACKEND` 決定用哪一種儲存層：`sql`（Postgres/MySQL/SQLite，需 `DATABASE_URL`）或 `kv`
 * （EdgeOne KV，無 TCP；用於 Makers 的 `cloud-functions`）。kv 模式不強制 `DATABASE_URL`。
 * `STORAGE_BACKEND` picks the storage layer: `sql` (Postgres/MySQL/SQLite, needs `DATABASE_URL`) or
 * `kv` (EdgeOne KV, no TCP; for Makers `cloud-functions`). The kv mode does not require `DATABASE_URL`.
 */

export type StorageBackend = 'sql' | 'kv';

export interface Config {
  readonly databaseUrl: string;
  /**
   * 連線字串的方言：由 `DB_DIALECT` 決定，未設定時從 scheme 猜；猜錯時錯誤難懂，故 `DB_DIALECT` 永遠可覆寫。
   * The SQL flavour of the connection string: decided by `DB_DIALECT`, inferred from the scheme
   * when unset; a wrong guess produces a confusing error, so `DB_DIALECT` always overrides.
   */
  readonly dbDialect: DialectName;
  readonly storageBackend: StorageBackend;
  readonly runTokenSecret: string;
  /** 允許的跨來源來源；空陣列 ＝ 不發 CORS 標頭（只接受同源）。
   * Allowed cross-origin origins; an empty array means no CORS headers (same-origin only). */
  readonly allowedOrigins: readonly string[];
  /** 每個裝置每小時的提交上限。
   * Submissions allowed per device per hour. */
  readonly submissionsPerHour: number;
  /** 憑證有效期：單局上限 ＋ 1 分鐘寬限。
   * Token lifetime: the run ceiling plus a one-minute grace. */
  readonly runTokenTtlMs: number;
  /** 每個裝置每小時最多能開幾局（避免無限鑄造憑證）。
   * Runs a device may start per hour (so tokens cannot be minted endlessly). */
  readonly runsPerHour: number;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly missing: readonly string[] };

/** 單局合理長度的上下限，同時被 `limits.ts` 與憑證有效期用到。
 * The sensible bounds of one run's length, used by both `limits.ts` and the token lifetime. */
export const MIN_RUN_MS = 5_000;
export const MAX_RUN_MS = 2 * 60 * 60 * 1000;
/** 憑證比單局上限多一分鐘：提交總在局末之後，不該卡在邊界被退。
 * Tokens outlive the run ceiling by a minute: submissions always come after the run ends and must not die on the boundary. */
export const RUN_TOKEN_SLACK_MS = 60_000;

const DEFAULT_SUBMISSIONS_PER_HOUR = 20;
const DEFAULT_RUNS_PER_HOUR = 120;
/** 秘密太短就等於沒有秘密；HMAC-SHA256 的建議下限是 32 位元組。
 * A too-short secret is no secret; 32 bytes is the recommended floor for HMAC-SHA256. */
const MIN_SECRET_LENGTH = 32;

type DialectName = 'postgres' | 'mysql' | 'sqlite';

/** 讀一個整數環境變數；壞值一律用預設，不讓一個錯字讓後端起不來。
 * Reads an integer environment variable; a bad value falls back to the default, so one typo cannot stop the backend. */
function readCount(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  return Math.max(min, Math.trunc(value));
}

/**
 * 讀方言：`DB_DIALECT` 優先，認不出來不報錯、改從連線字串猜（一個錯字不該讓後端起不來）。
 * Reads the dialect: `DB_DIALECT` wins, and an unrecognised value falls back to the connection
 * string rather than failing (a typo must not stop the backend).
 */
function readDialect(raw: string | undefined, url: string): DialectName {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'mysql' || value === 'mariadb') return 'mysql';
  if (value === 'postgres' || value === 'postgresql' || value === 'pg') return 'postgres';
  if (value === 'sqlite' || value === 'sqlite3') return 'sqlite';

  const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
  if (scheme === 'mysql' || scheme === 'mysql2' || scheme === 'mariadb') return 'mysql';
  if (scheme === 'sqlite' || scheme === 'sqlite3') return 'sqlite';
  return 'postgres';
}

/**
 * 從一份環境變數讀出設定。純函式 —— 測試不必碰 `process.env`，也不會互相污染。
 * Reads the configuration out of an environment map. Pure, so tests never touch `process.env` and
 * cannot leak into each other.
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const missing: string[] = [];

  const storageBackendRaw = (env['STORAGE_BACKEND'] ?? 'sql').trim().toLowerCase();
  const storageBackend: StorageBackend = storageBackendRaw === 'kv' ? 'kv' : 'sql';

  const runTokenSecret = (env['RUN_TOKEN_SECRET'] ?? '').trim();
  if (runTokenSecret.length < MIN_SECRET_LENGTH) missing.push('RUN_TOKEN_SECRET');

  /*
   * kv 模式走 EdgeOne KV（無 TCP）：`DATABASE_URL` 不需要；sql 模式才需要。
   * The kv mode uses EdgeOne KV (no TCP): `DATABASE_URL` is not needed; only the sql mode needs it.
   */
  const databaseUrl = (env['DATABASE_URL'] ?? '').trim();
  if (storageBackend === 'sql' && databaseUrl === '') missing.push('DATABASE_URL');

  if (missing.length > 0) return { ok: false, missing };

  const allowedOrigins = (env['ALLOWED_ORIGIN'] ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');

  return {
    ok: true,
    config: {
      databaseUrl,
      dbDialect: readDialect(env['DB_DIALECT'], databaseUrl),
      storageBackend,
      runTokenSecret,
      allowedOrigins,
      submissionsPerHour: readCount(env['SUBMISSIONS_PER_HOUR'], DEFAULT_SUBMISSIONS_PER_HOUR, 1),
      runTokenTtlMs: MAX_RUN_MS + RUN_TOKEN_SLACK_MS,
      runsPerHour: readCount(env['RUNS_PER_HOUR'], DEFAULT_RUNS_PER_HOUR, 1),
    },
  };
}

/**
 * 讀真正的環境變數；缺東西就丟錯（在邊緣執行時下由 `setEnvSource` 把 `context.env` 注入這裡）。
 * Reads the real environment; throws when something is missing (under an edge runtime, `setEnvSource`
 * injects `context.env` here).
 */
export function loadConfig(): Config {
  const result = readConfig(process.env);
  if (!result.ok) {
    throw new Error(
      `missing or invalid environment variables: ${result.missing.join(', ')} ` +
        '(see .env.example)',
    );
  }

  return result.config;
}
