/**
 * 後端設定：從環境變數讀出來，並且**在啟動時就驗完**。
 * Backend configuration: read from the environment and **validated up front**.
 *
 * 有兩個值沒有就絕對不能跑，所以它們是硬性缺漏而不是預設值：
 *   - `DATABASE_URL` —— 沒有它整個後端沒有意義；
 *   - `RUN_TOKEN_SECRET` —— 沒有它 T2 的憑證誰都能偽造，比沒有反作弊更糟（會給人「已經有防護」
 *     的錯覺）。
 * Two values are non-negotiable, so they are hard failures rather than defaults: without
 * `DATABASE_URL` the backend has nothing to store, and without `RUN_TOKEN_SECRET` anyone can forge an
 * T2 token — which is worse than having no anti-cheat at all, because it looks like there is some.
 *
 * 其餘都有安全的預設值，而且**預設值是保守的那一邊**：IP 預設只存截斷後的網段、速率限制預設
 * 生效、CORS 預設不放行任何跨來源。
 * Everything else has a default, and **the default is the conservative side**: IPs are truncated by
 * default, rate limiting is on by default, and no cross-origin request is allowed by default.
 */

import { dialectFromUrl, type DialectName } from './db/dialect';

/** IP 要怎麼落庫。 */
export type IpStorageMode = 'raw' | 'truncated' | 'hashed';

export interface Config {
  readonly databaseUrl: string;
  /**
   * 連線字串講的是哪一種 SQL。
   * Which flavour of SQL the connection string speaks.
   *
   * 由 `DB_DIALECT` 決定；沒設定時**從連線字串的 scheme 猜**（`postgres://` → Postgres、
   * `mysql://` → MySQL）。猜的理由是讓最常見的設定「只填一個 `DATABASE_URL` 就能跑」；但猜錯時
   * 錯誤訊息會很難懂（拿 MySQL 的 `?` 去餵 Postgres），所以 `DB_DIALECT` 永遠可以覆寫。
   * Decided by `DB_DIALECT`, or **inferred from the connection string's scheme** when unset
   * (`postgres://` → Postgres, `mysql://` → MySQL). Inferring means the common case needs nothing but
   * a `DATABASE_URL`; but a wrong guess produces a confusing error (MySQL's `?` fed to Postgres), so
   * `DB_DIALECT` always overrides.
   */
  readonly dbDialect: DialectName;
  readonly runTokenSecret: string;
  readonly ipStorage: IpStorageMode;
  /**
   * 雜湊 IP 用的秘密。與 `RUN_TOKEN_SECRET` 分開，因為兩者的輪替時機不同：憑證秘密換掉只影響
   * 未完成的局，IP 秘密換掉則讓歷史紀錄無法再對照。未設定時退回 `RUN_TOKEN_SECRET`。
   * The secret used to hash IPs. Kept separate from `RUN_TOKEN_SECRET` because they rotate on
   * different schedules: rotating the token secret only invalidates runs in flight, while rotating
   * the IP secret breaks the ability to correlate history. Falls back to `RUN_TOKEN_SECRET`.
   */
  readonly ipHashSecret: string;
  /** 允許的跨來源來源；空陣列 ＝ 不發 CORS 標頭（只接受同源）。 */
  readonly allowedOrigins: readonly string[];
  /** 每個裝置每小時的提交上限（design.md §6.7 建議 20）。 */
  readonly submissionsPerHour: number;
  /** 憑證有效期；預設 2 小時（設計上單局上限）＋ 1 分鐘寬限。 */
  readonly runTokenTtlMs: number;
  /** 每個裝置每小時最多能開幾局（避免無限鑄造憑證）。 */
  readonly runsPerHour: number;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: Config }
  | { readonly ok: false; readonly missing: readonly string[] };

/** 單局合理長度的上下限，同時被 `limits.ts` 與憑證有效期用到。 */
export const MIN_RUN_MS = 5_000;
export const MAX_RUN_MS = 2 * 60 * 60 * 1000;
/** 憑證比單局上限再多一分鐘：提交總是在局末之後，不該剛好卡在邊界上被退。 */
export const RUN_TOKEN_SLACK_MS = 60_000;

const DEFAULT_SUBMISSIONS_PER_HOUR = 20;
const DEFAULT_RUNS_PER_HOUR = 120;
/** 秘密太短就等於沒有秘密；HMAC-SHA256 的建議下限是 32 位元組。 */
const MIN_SECRET_LENGTH = 32;

/** 讀一個整數環境變數；壞值一律用預設，不讓一個錯字讓後端起不來。 */
function readCount(raw: string | undefined, fallback: number, min: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;

  return Math.max(min, Math.trunc(value));
}

function readIpStorage(raw: string | undefined): IpStorageMode {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'raw' || value === 'hashed' ? value : 'truncated';
}

/**
 * 讀方言：`DB_DIALECT` 優先，認不出來就從連線字串猜。
 * Read the dialect: `DB_DIALECT` wins, and anything unrecognised falls back to the connection string.
 *
 * 認不出來的值**不報錯**，改走猜測 —— 與其他選填欄位同一條規則（一個錯字不該讓後端起不來）。但
 * 這裡比別的欄位更需要 `DB_DIALECT`：猜錯的後果是 SQL 語法錯誤，而那種錯誤訊息不會告訴你「是你把
 * MySQL 的 `?` 餵給了 Postgres」。
 * An unrecognised value **does not fail**; it falls back to inference, matching every other optional
 * field (a typo should not stop the backend). But `DB_DIALECT` matters more here than elsewhere: a
 * wrong guess produces SQL syntax errors, and those messages do not say "you fed MySQL's `?` to
 * Postgres".
 */
function readDialect(raw: string | undefined, url: string): DialectName {
  const value = (raw ?? '').trim().toLowerCase();

  if (value === 'mysql' || value === 'mariadb') return 'mysql';
  if (value === 'postgres' || value === 'postgresql' || value === 'pg') return 'postgres';

  return dialectFromUrl(url);
}

/**
 * 從一份環境變數讀出設定。**純函式** —— 測試不必碰 `process.env`，也不會互相污染。
 * Read the configuration out of an environment map. **Pure**, so tests never touch `process.env`
 * and cannot leak into each other.
 */
export function readConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const missing: string[] = [];

  const databaseUrl = (env['DATABASE_URL'] ?? '').trim();
  if (databaseUrl === '') missing.push('DATABASE_URL');

  const runTokenSecret = (env['RUN_TOKEN_SECRET'] ?? '').trim();
  if (runTokenSecret.length < MIN_SECRET_LENGTH) missing.push('RUN_TOKEN_SECRET');

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
      runTokenSecret,
      ipStorage: readIpStorage(env['IP_STORAGE_MODE']),
      ipHashSecret: (env['IP_HASH_SECRET'] ?? '').trim() || runTokenSecret,
      allowedOrigins,
      submissionsPerHour: readCount(
        env['SUBMISSIONS_PER_HOUR'],
        DEFAULT_SUBMISSIONS_PER_HOUR,
        1,
      ),
      runTokenTtlMs: MAX_RUN_MS + RUN_TOKEN_SLACK_MS,
      runsPerHour: readCount(env['RUNS_PER_HOUR'], DEFAULT_RUNS_PER_HOUR, 1),
    },
  };
}

/**
 * 給執行期用的版本：讀真正的 `process.env`，缺東西就丟出一個說清楚少了什麼的錯誤。
 * The runtime version: reads the real `process.env` and throws an error that names what is missing.
 *
 * 錯誤訊息**不含任何值**，只含鍵名 —— 這種字串很容易被貼進 issue 或 log 裡。
 * The message carries **no values, only key names** — this string is exactly the sort of thing that
 * ends up pasted into an issue or a log.
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
