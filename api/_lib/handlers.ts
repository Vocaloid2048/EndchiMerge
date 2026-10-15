/**
 * 端點核心邏輯：吃 `ApiRequest` 與注入的 `Deps`，回 `HandlerResult`；反作弊依序為速率、憑證、時間、合理性。
 * The endpoints' core logic: an `ApiRequest` plus injected `Deps` go in, a `HandlerResult` comes out.
 */

import type { ApiRequest, ApiResponse, JsonObject } from './http.js';
import { asObject, fail, methodNotAllowed, ok, readInteger, readString } from './http.js';
import { isConnectionError, isBoardCategory, type BoardCategory } from './db/dialect.js';
import type { Config } from './env.js';
import { MAX_RUN_MS } from './env.js';
import { checkClaimedDuration, checkRationality } from './limits.js';
import type { Store } from './store.js';
import { isValidDeviceId, newRunId, newUserTag, signRunToken, tokenFingerprint, verifyRunToken } from './tokens.js';

export interface Deps {
  readonly config: Config;
  readonly store: Store;
  readonly now: () => number;
}

export interface HandlerResult {
  readonly response: ApiResponse;
  /** 給 `requests` 表用的線索；解析不出來時是 `null`。
   * A hint for the `requests` table; `null` when it cannot be parsed. */
  readonly deviceId: string | null;
  readonly runId: string | null;
}

export type CoreHandler = (request: ApiRequest, deps: Deps) => Promise<HandlerResult>;

/** 宣稱時長與憑證頒發時刻之間容許的差距，只用來吸收量測噪音（檢查是單邊的，見 `limits.ts`）。
 * Tolerance between the claimed duration and the token's issue time, absorbing measurement noise only. */
const CLOCK_TOLERANCE_MS = 5_000;

const HOUR_MS = 60 * 60 * 1000;

const MAX_BOARD_LIMIT = 200;
const DEFAULT_BOARD_LIMIT = 100;

/* 提交欄位的**形狀**上界（不是裁決 —— 裁決在 `checkRationality`，那裡才寫進 `rejected`）。
 * Shape upper bounds for submitted fields; the verdict lives in `checkRationality`. */
const SCORE_MAX = 100_000_000;
const COUNT_MAX = 1_000_000;
const NAME_MAX = 32;
const VERSION_MAX = 32;

/** 名稱的**最低限度**清洗：移除控制與零寬字元，並夾到長度上限。
 * The **minimum** name cleanup: strip control and zero-width characters, cap the length. */
export function sanitiseName(raw: string): string {
  let cleaned = '';
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;

    /* C0/C1 控制字元、刪除字元、零寬與方向控制字元一律剔除。
     * C0/C1 controls, delete characters, and zero-width/direction controls are all dropped. */
    const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
    const isInvisible =
      code === 0x200b || code === 0x200c || code === 0x200d || code === 0xfeff || (code >= 0x202a && code <= 0x202e);

    if (!isControl && !isInvisible) cleaned += character;
  }

  return [...cleaned.trim()].slice(0, NAME_MAX).join('');
}

function readId(body: JsonObject, key: string): string | null {
  const value = readString(body, key, 64);

  return value !== null && isValidDeviceId(value) ? value : null;
}

/** 把一次提交的裁決寫成回應；重試也走這裡，所以兩次回應一模一樣。
 * Renders a submission's verdict; retries reuse it so both responses are identical. */
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

/** 開一局：伺服器鑄一張憑證，綁定 `(run_id, device_id, issued_at)`；`issued_at` 是關鍵欄位（見 `limits.checkClaimedDuration`）。
 * Start a run: the server mints a token binding `(run_id, device_id, issued_at)`, keyed on `issued_at`. */
export const handleRunStart: CoreHandler = async (request, deps) => {
  if (request.method !== 'POST') {
    return { response: methodNotAllowed(['POST']), deviceId: null, runId: null };
  }

  const body = asObject(request.body) ?? {};

  /* 裝置碼優先沿用客戶端已有的那一組；形狀不對才由伺服器頒發（強制換新會讓既有玩家變成新玩家）。
   * The device id prefers the client's existing one and is minted only when the shape is wrong. */
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
  const token = await signRunToken(deps.config.runTokenSecret, {
    runId,
    deviceId,
    issuedAtMs: now,
    expiresAtMs,
  });

  await deps.store.putRunToken({
    runId,
    deviceId,
    tokenHash: await tokenFingerprint(token),
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

  /* ① 速率限制：這個裝置上一小時內的**所有**提交，含被退回的那些。
   * ① Rate limit: all submissions from this device in the last hour, including rejected ones. */
  if ((await deps.store.countSubmissionsSince(deviceId, now - HOUR_MS)) >= deps.config.submissionsPerHour) {
    return {
      response: fail(429, 'rate_limited', 'too many submissions in the last hour'),
      deviceId,
      runId,
    };
  }

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

  /* 憑證驗兩件事：簽章（是不是我們發的）與資料庫裡的**指紋**（是不是同一張）；只驗其一都可被繞過。
   * Two checks: the signature and the stored fingerprint; either one alone can be bypassed. */
  if (!(await verifyRunToken(deps.config.runTokenSecret, token, payload))) {
    return { response: fail(401, 'bad_token', 'the token does not match this run'), deviceId, runId };
  }

  if ((await tokenFingerprint(token)) !== tokenRow.tokenHash) {
    return { response: fail(401, 'bad_token', 'the token does not match this run'), deviceId, runId };
  }

  /* 冪等：這一局已收過就回同一裁決，且放在**消耗憑證之前** —— 斷線重試時憑證早已標記用過。
   * Idempotent: reuse the verdict, checked **before** the token is consumed, so retries still succeed. */
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

  /* ③④ 時間與合理性：兩者都不通過時只回報第一個理由，那是唯一寫進 `rejected` 的值。
   * ③④ Time and rationality: on failure only the first reason is reported and stored in `rejected`. */
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
    /*
     * 只是一個**提議**：profile 已經有號就沿用（改名不動號），撞到別人的「名字＋號」才會被換掉。
     * Only a **proposal**: an existing profile keeps its tag (a rename does not change it), and it is
     * replaced only when it collides with another device's name-and-tag pair.
     */
    userTag: newUserTag(),
    score,
    durationMs,
    merges,
    drops,
    maxCombo,
    version,
    verified: rationalityVerdict.verified,
    rejected: rationalityVerdict.verified ? null : rationalityVerdict.reason,
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

  /* 分頁：**排序由伺服器決定**，且只回前 `limit` 名 —— 名次會隨分類而不同，客戶端重排救不回來。
   * Paging: the server owns the ordering and returns only the top `limit`; rank varies per category. */
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
    tag: row.userTag,
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
        tag: profile.userTag,
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

/** 健康檢查：**真的去問一次資料庫**（`countProfiles()`），不是回一個寫死的 200。
 * A health check that **actually asks the database** (`countProfiles()`), not a hard-coded 200.
 *
 * 失敗分兩碼：連不上回 503（重試有意義），語法或 schema 錯回 500（重試沒意義）。
 * Failures split: unreachable → 503 (retry is meaningful), syntax/schema error → 500 (it is not). */
export const handleHealth: CoreHandler = async (request, deps) => {
  if (request.method !== 'GET') {
    return { response: methodNotAllowed(['GET']), deviceId: null, runId: null };
  }

  try {
    const players = await deps.store.countProfiles();

    return {
      response: ok({
        ok: true,
        database: deps.config.storageBackend === 'kv' ? 'kv' : deps.config.dbDialect,
        players,
        at: deps.now(),
      }),
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
