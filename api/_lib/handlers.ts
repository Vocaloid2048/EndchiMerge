/**
 * 端點的核心邏輯（不含 HTTP 平台細節，也不含日誌外殼）。
 * The endpoints' core logic — no platform-specific HTTP, no logging shell.
 *
 * 每個處理器都只吃 `ApiRequest` 與一份注入的 `Deps`，回一個 `HandlerResult`。這讓整條路徑在單元
 * 測試裡可以直接呼叫：給一個 `MemoryStore`、一個固定的時鐘，就能驗完「發憑證 → 提交 → 上榜」。
 * Each handler takes an `ApiRequest` and an injected `Deps`, and returns a `HandlerResult`. That makes
 * the whole path callable in a unit test: hand it a `MemoryStore` and a fixed clock, and "issue a
 * token → submit → appear on the board" is fully exercised.
 *
 * 反作弊的兩個檢查放在這裡，順序刻意如下：
 *   1. **先擋速率**（比對憑證便宜，比讀資料庫便宜）；
 *   2. **再驗憑證**（這一局是不是伺服器發的、是不是這個裝置、過期了沒）；
 *   3. **再驗時間**（宣稱的時長不能超過憑證頒發以來的實際時間）；
 *   4. **最後驗合理性**（上界推導見 `limits.ts`）。
 * The two anti-cheat families live here, deliberately in this order: rate limit first (cheapest),
 * then the token (is this run the server's, for this device, still valid), then time (the claimed
 * duration cannot exceed the time since the token was issued), and finally the rationality bounds
 * (derived in `limits.ts`).
 *
 * **未通過檢查的提交仍然寫進 `scores`**，只是 `verified = false`。留著的理由是審計：一次「明顯在
 * 試」的提交比一次成功的作弊更有價值，因為前者告訴你有人在試，而後者只告訴你有人在贏。
 * **A submission that fails the checks is still written to `scores`**, with `verified = false`. It is
 * kept for the audit trail: an obviously probing submission is worth more than a successful cheat,
 * because the first tells you someone is trying and the second only tells you someone is winning.
 */

import type { ApiRequest, ApiResponse, JsonObject } from './http.js';
import { asObject, fail, methodNotAllowed, ok, readInteger, readString } from './http.js';
import { isConnectionError, isBoardCategory, type BoardCategory } from './db/dialect.js';
import type { Config } from './env.js';
import { MAX_RUN_MS } from './env.js';
import { checkClaimedDuration, checkRationality } from './limits.js';
import type { Store } from './store.js';
import { isValidDeviceId, newRunId, signRunToken, tokenFingerprint, verifyRunToken } from './tokens.js';

export interface Deps {
  readonly config: Config;
  readonly store: Store;
  /** 注入時鐘，測試才不必等真的時間過去。 */
  readonly now: () => number;
}

export interface HandlerResult {
  readonly response: ApiResponse;
  /** 給 `requests` 表用的線索；解析不出來時是 `null`。 */
  readonly deviceId: string | null;
  readonly runId: string | null;
}

export type CoreHandler = (request: ApiRequest, deps: Deps) => Promise<HandlerResult>;

/**
 * 宣稱時長與憑證頒發時間之間的容許差距。
 * The tolerated gap between the claimed duration and the token's issue time.
 *
 * 檢查是**單邊**的（見 `limits.ts`），所以這 5 秒只用來吸掉量測噪音：網路往返、計時器合併、
 * 客戶端把模擬時鐘對齊到第一幀的偏移。真正的作弊（宣告一局不存在的兩小時）差的是好幾個數量級，
 * 不會躲在 5 秒裡面。
 * The check is **one-sided** (see `limits.ts`), so these five seconds only absorb measurement noise:
 * the round trip, timer coalescing, and the client aligning its simulated clock on the first frame. A
 * real cheat — claiming a two-hour run that never happened — is orders of magnitude away and does not
 * hide inside five seconds.
 */
const CLOCK_TOLERANCE_MS = 5_000;

const HOUR_MS = 60 * 60 * 1000;

/** 榜上一次最多回幾個（客戶端只顯示前 100，留一點餘裕）。 */
const MAX_BOARD_LIMIT = 200;
const DEFAULT_BOARD_LIMIT = 100;

/* 提交欄位的上限。這些是**形狀**的上限（陣列不可能是負的、時長不可能超過兩小時），不是裁決：
 * 裁決在 `checkRationality`，那裡才是會寫進 `rejected` 的地方。 */
const SCORE_MAX = 100_000_000;
const COUNT_MAX = 1_000_000;
const NAME_MAX = 32;
const VERSION_MAX = 32;

/**
 * 名稱的**最低限度**清洗：移除控制字元與零寬字元、夾到長度上限。
 * The **minimum** name cleanup: strip control and zero-width characters, cap the length.
 *
 * 完整的 §6.4 規則（32 個加權單位、NFKC 正規化、字元白名單、七層關鍵詞摺疊）是 M7-4 的工作，
 * 而且必須是**客戶端與伺服器共用同一份實作** —— 兩邊各寫一套的話，客戶端放行而伺服器退回的名稱
 * 會變成一個玩家看得到、我們解釋不清的錯誤。這裡先只做不會有爭議的部分。
 * The full §6.4 pipeline (32 weighted units, NFKC normalisation, a character whitelist, seven layers of
 * keyword folding) is M7-4's job, and it has to be **one shared implementation** for client and
 * server: two implementations means a name the client accepts and the server rejects, which becomes an
 * error the player can see and we cannot explain. Only the uncontroversial part is done here.
 */
export function sanitiseName(raw: string): string {
  let cleaned = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;

    /* C0/C1 控制字元、刪除字元、零寬與方向控制字元一律剔除。 */
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const isInvisible =
      code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff || (code >= 0x202a && code <= 0x202e);

    if (!isControl && !isInvisible) cleaned += character;
  }

  return [...cleaned.trim()].slice(0, NAME_MAX).join('');
}

/** 讀一個必填的識別碼欄位（局號或裝置碼）。 */
function readId(body: JsonObject, key: string): string | null {
  const value = readString(body, key, 64);

  return value !== null && isValidDeviceId(value) ? value : null;
}

/** 把一次提交的裁決寫成回應（重試時也走這裡，所以兩次回應一模一樣）。 */
function verdictResponse(input: {
  readonly verified: boolean;
  readonly reason: string | null;
  readonly bestScore: number;
  readonly bestDurationMs: number;
  readonly bestMaxCombo: number;
  readonly bestMerges: number;
  readonly rank: number | null;
}): ApiResponse {
  return ok({
    ok: true,
    verified: input.verified,
    reason: input.reason,
    rank: input.rank,
    best: {
      score: input.bestScore,
      durationMs: input.bestDurationMs,
      maxCombo: input.bestMaxCombo,
      merges: input.bestMerges,
    },
  });
}

/* ── POST /api/run/start ──────────────────────────────────────────────────── */

/**
 * 開一局：伺服器鑄一張憑證。
 * Start a run: the server mints a token.
 *
 * 憑證綁定 `(run_id, device_id, 頒發時刻)`，而**頒發時刻是最關鍵的那一欄** —— 它讓伺服器在收到
 * 成績時知道這一局是什麼時候開始的（見 `limits.ts` 的 `checkClaimedDuration`）。
 * The token binds `(run_id, device_id, issued_at)`, and **issued_at is the field that matters**: it is
 * how the server knows, at submission time, when the run began (see
 * `limits.checkClaimedDuration`).
 */
export const handleRunStart: CoreHandler = async (request, deps) => {
  if (request.method !== 'POST') {
    return { response: methodNotAllowed(['POST']), deviceId: null, runId: null };
  }

  const body = asObject(request.body) ?? {};

  /*
   * 裝置碼優先沿用客戶端已經有的那一組（`endchimerge:device-id` 早就存在），形狀不對才由伺服器
   * 頒發。強制換新的話，既有玩家會忽然變成「新玩家」，而這個 id 的唯一用途只是把同一台裝置的
   * 歷史綁在一起。
   * The device id prefers whatever the client already has (`endchimerge:device-id` predates the
   * backend) and is only minted when the shape is wrong. Forcing a new one would turn existing players
   * into new players, and the id's only job is to tie one device's history together.
   */
  const provided = readString(body, 'deviceId', 64);
  const deviceId = provided !== null && isValidDeviceId(provided) ? provided : newRunId();

  const now = deps.now();

  if ((await deps.store.countRunTokensSince(deviceId, now - HOUR_MS)) >= deps.config.runsPerHour) {
    return {
      response: fail(429, 'too_many_runs', 'too many runs started in the last hour'),
      deviceId,
      runId: null,
    };
  }

  const runId = newRunId();
  const expiresAtMs = now + deps.config.runTokenTtlMs;
  const token = signRunToken(deps.config.runTokenSecret, {
    runId,
    deviceId,
    issuedAtMs: now,
    expiresAtMs,
  });

  await deps.store.putRunToken({
    runId,
    deviceId,
    tokenHash: tokenFingerprint(token),
    issuedAtMs: now,
    expiresAtMs,
    usedAtMs: null,
  });

  return {
    response: ok({
      ok: true,
      deviceId,
      runId,
      token,
      issuedAt: now,
      expiresAt: expiresAtMs,
      serverTime: now,
    }),
    deviceId,
    runId,
  };
};

/* ── POST /api/score ──────────────────────────────────────────────────────── */

export const handleScore: CoreHandler = async (request, deps) => {
  if (request.method !== 'POST') {
    return { response: methodNotAllowed(['POST']), deviceId: null, runId: null };
  }

  const body = asObject(request.body);
  if (body === null) {
    return { response: fail(400, 'bad_body', 'expected a JSON object'), deviceId: null, runId: null };
  }

  const runId = readId(body, 'runId');
  const deviceId = readId(body, 'deviceId');
  const token = readString(body, 'token', 200);

  if (runId === null || deviceId === null || token === null) {
    return {
      response: fail(400, 'bad_fields', 'runId, deviceId and token are required'),
      deviceId,
      runId,
    };
  }

  const score = readInteger(body, 'score', 0, SCORE_MAX);
  const merges = readInteger(body, 'merges', 0, COUNT_MAX);
  const drops = readInteger(body, 'drops', 0, COUNT_MAX);
  const maxCombo = readInteger(body, 'maxCombo', 0, COUNT_MAX);
  const durationMs = readInteger(body, 'durationMs', 0, MAX_RUN_MS);

  if (score === null || merges === null || drops === null || maxCombo === null || durationMs === null) {
    return {
      response: fail(400, 'bad_fields', 'score, merges, drops, maxCombo and durationMs must be integers in range'),
      deviceId,
      runId,
    };
  }

  const displayName = sanitiseName(readString(body, 'displayName', 256) ?? '');
  const version = readString(body, 'version', VERSION_MAX) ?? '';
  const now = deps.now();

  /* ① 速率限制。算的是這個裝置在上一小時內的**所有**提交，含被退回的那些。 */
  if ((await deps.store.countSubmissionsSince(deviceId, now - HOUR_MS)) >= deps.config.submissionsPerHour) {
    return {
      response: fail(429, 'rate_limited', 'too many submissions in the last hour'),
      deviceId,
      runId,
    };
  }

  /* ② 憑證。 */
  const tokenRow = await deps.store.getRunToken(runId);
  if (tokenRow === null) {
    return { response: fail(401, 'unknown_run', 'no token was issued for this run'), deviceId, runId };
  }

  if (tokenRow.deviceId !== deviceId) {
    return { response: fail(403, 'device_mismatch', 'this token belongs to another device'), deviceId, runId };
  }

  const payload = {
    runId: tokenRow.runId,
    deviceId: tokenRow.deviceId,
    issuedAtMs: tokenRow.issuedAtMs,
    expiresAtMs: tokenRow.expiresAtMs,
  };

  /*
   * 憑證驗兩件事：簽章（是不是我們發的）與資料庫裡的**指紋**（是不是同一張）。只驗簽章的話，
   * 一張在別處外洩的憑證可以照用；只驗指紋的話，偽造的簽章也會通過。
   * Two things are checked: the signature (did we issue it) and the stored **fingerprint** (is it the
   * same token). Signature alone would accept a token leaked from elsewhere; fingerprint alone would
   * accept a forged signature.
   */
  if (!verifyRunToken(deps.config.runTokenSecret, token, payload)) {
    return { response: fail(401, 'bad_token', 'the token does not match this run'), deviceId, runId };
  }

  if (tokenFingerprint(token) !== tokenRow.tokenHash) {
    return { response: fail(401, 'bad_token', 'the token does not match this run'), deviceId, runId };
  }

  /*
   * 冪等：這一局已經收過就直接回同一個裁決。放在**消耗憑證之前** —— 送出後斷線、客戶端重試是
   * 正常的，那時憑證早已被標記用過，若先檢查 `used_at` 就會把一次成功的提交回成錯誤。
   * Idempotency: if this run was already accepted, return the same verdict. Checked **before** the
   * token is consumed — losing the connection after sending and retrying is normal, and by then the
   * token is already marked used, so testing `used_at` first would turn a successful submission into
   * an error.
   */
  const existing = await deps.store.getScore(runId);
  if (existing !== null) {
    const profile = await deps.store.getProfile(deviceId);

    return {
      response: verdictResponse({
        verified: existing.verified,
        reason: existing.rejected,
        bestScore: profile?.bestScore ?? 0,
        bestDurationMs: profile?.bestDurationMs ?? 0,
        bestMaxCombo: profile?.bestMaxCombo ?? 0,
        bestMerges: profile?.bestMerges ?? 0,
        rank: null,
      }),
      deviceId,
      runId,
    };
  }

  if (tokenRow.usedAtMs !== null) {
    return { response: fail(409, 'token_used', 'this token was already consumed'), deviceId, runId };
  }

  if (now > tokenRow.expiresAtMs) {
    return { response: fail(401, 'token_expired', 'this run started too long ago'), deviceId, runId };
  }

  /* ③④ 時間與合理性。兩者都不通過時只回報第一個理由，那是唯一寫進 `rejected` 的值。 */
  const durationVerdict = checkClaimedDuration(
    durationMs,
    tokenRow.issuedAtMs,
    now,
    CLOCK_TOLERANCE_MS,
  );
  const rationalityVerdict = durationVerdict.verified
    ? checkRationality({ score, merges, drops, maxCombo, durationMs })
    : durationVerdict;

  if (!rationalityVerdict.verified) {
    console.error(
      `[api] rejected submission run=${runId} device=${deviceId} reason=${rationalityVerdict.reason}`,
    );
  }

  await deps.store.markRunTokenUsed(runId, now);
  await deps.store.saveScore({
    runId,
    deviceId,
    displayName,
    score,
    durationMs,
    merges,
    drops,
    maxCombo,
    version,
    verified: rationalityVerdict.verified,
    rejected: rationalityVerdict.verified ? null : rationalityVerdict.reason,
    clientIp: null,
    atMs: now,
  });

  const profile = await deps.store.getProfile(deviceId);
  const rank =
    profile === null || profile.bestScore <= 0
      ? null
      : await deps.store.rankOf(
          {
            deviceId,
            score: profile.bestScore,
            maxCombo: profile.bestMaxCombo,
            merges: profile.bestMerges,
            atMs: profile.bestAtMs ?? now,
          },
          'score',
        );

  return {
    response: verdictResponse({
      verified: rationalityVerdict.verified,
      reason: rationalityVerdict.verified ? null : rationalityVerdict.reason,
      bestScore: profile?.bestScore ?? 0,
      bestDurationMs: profile?.bestDurationMs ?? 0,
      bestMaxCombo: profile?.bestMaxCombo ?? 0,
      bestMerges: profile?.bestMerges ?? 0,
      rank,
    }),
    deviceId,
    runId,
  };
};

/* ── GET /api/leaderboard ─────────────────────────────────────────────────── */

export const handleLeaderboard: CoreHandler = async (request, deps) => {
  if (request.method !== 'GET') {
    return { response: methodNotAllowed(['GET']), deviceId: null, runId: null };
  }

  const rawLimit = request.query.get('limit');
  const parsedLimit = rawLimit === null ? DEFAULT_BOARD_LIMIT : Number(rawLimit);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_BOARD_LIMIT, Math.max(1, Math.trunc(parsedLimit)))
    : DEFAULT_BOARD_LIMIT;

  /*
   * 分頁。**排序由伺服器決定，不是把同一份榜交給客戶端重排** —— 榜只回前 `limit` 名，而在分數榜
   * 排第 500 名的玩家，很可能正是組合數榜的第一名。如果一律用分數排序再取前 100，那一列根本不會
   * 出現在組合數那一頁，客戶端再怎麼排都救不回來。
   * The tab. **The server owns the ordering rather than handing one board over to be re-sorted by the
   * client**: the board returns only the top `limit`, and the player ranked 500th by score may well be
   * first by combo. Ordering by score and slicing 100 would leave that row out entirely, and no amount
   * of client-side sorting can bring it back.
   */
  const rawCategory = request.query.get('category');
  const category: BoardCategory = isBoardCategory(rawCategory) ? rawCategory : 'score';

  const provided = request.query.get('deviceId');
  const deviceId = provided !== null && isValidDeviceId(provided) ? provided : null;

  const [rows, total] = await Promise.all([
    deps.store.topProfiles(category, limit),
    deps.store.countProfiles(),
  ]);

  const entries = rows.map((row, index) => ({
    rank: index + 1,
    name: row.displayName,
    score: row.bestScore,
    durationMs: row.bestDurationMs,
    maxCombo: row.bestMaxCombo,
    merges: row.bestMerges,
    at: row.bestAtMs ?? 0,
  }));

  let self: (typeof entries)[number] | null = null;

  if (deviceId !== null) {
    const profile = await deps.store.getProfile(deviceId);

    if (profile !== null && profile.bestScore > 0) {
      /* 名次要**跟著分頁走** —— 同一個人在三個分頁上的名次本來就不一樣。 */
      const rank = await deps.store.rankOf(
        {
          deviceId,
          score: profile.bestScore,
          maxCombo: profile.bestMaxCombo,
          merges: profile.bestMerges,
          atMs: profile.bestAtMs ?? 0,
        },
        category,
      );

      self = {
        rank,
        name: profile.displayName,
        score: profile.bestScore,
        durationMs: profile.bestDurationMs,
        maxCombo: profile.bestMaxCombo,
        merges: profile.bestMerges,
        at: profile.bestAtMs ?? 0,
      };
    }
  }

  return { response: ok({ ok: true, category, total, entries, self }), deviceId, runId: null };
};

/* ── GET /api/health ──────────────────────────────────────────────────────── */

/**
 * 健康檢查：**真的去問一次資料庫**，不是回一個寫死的 200。
 * A health check that **actually asks the database**, rather than returning a hard-coded 200.
 *
 * 它刻意跑 `countProfiles()` 而不是 `select 1`：前者同時證明「連得上」與「表建好了」，而後者只證明
 * 連得上 —— 一個忘了跑遷移的部署會很有精神地回答 `select 1`。
 * It deliberately runs `countProfiles()` rather than `select 1`: the former proves both "reachable" and
 * "the tables exist", while the latter only proves reachable — a deployment that forgot to run the
 * migration would answer `select 1` quite happily.
 *
 * 失敗時分兩種：**連不上**回 503（基礎設施的事，重試有意義），**語法或 schema 錯**回 500（程式或
 * 遷移的事，重試沒有意義）。兩者混成一個碼會讓前者看起來像後者的 bug。
 * Failures split in two: **unreachable** answers 503 (an infrastructure matter, retrying is
 * meaningful) and a **syntax or schema error** answers 500 (a code or migration matter, retrying is
 * not). Collapsing them into one code makes the first look like a bug in the second.
 */
export const handleHealth: CoreHandler = async (request, deps) => {
  if (request.method !== 'GET') {
    return { response: methodNotAllowed(['GET']), deviceId: null, runId: null };
  }

  try {
    const players = await deps.store.countProfiles();

    return {
      response: ok({ ok: true, database: deps.config.dbDialect, players, at: deps.now() }),
      deviceId: null,
      runId: null,
    };
  } catch (error) {
    const unreachable = isConnectionError(error);
    console.error('[api] health check failed', error);

    return {
      response: fail(
        unreachable ? 503 : 500,
        unreachable ? 'database_unreachable' : 'database_error',
        unreachable ? 'the database is unreachable' : 'the database rejected the query',
      ),
      deviceId: null,
      runId: null,
    };
  }
};
