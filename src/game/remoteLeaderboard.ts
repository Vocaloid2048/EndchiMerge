/**
 * 排行榜資料層的伺服器版：與本機版共用 `createPlayerRecord`，只有「榜從哪裡來」不同。
 * The server-backed leaderboard data layer: it shares `createPlayerRecord` with the local build and differs only in where the board comes from.
 *
 * 提交的永遠是「某一局自己的數字」，憑證在開局時鑄（`beginRun()`），失敗一律不影響遊戲本身。
 * Submissions are always one run's own numbers, the token is minted at `beginRun()`, and no failure ever touches the game itself.
 */

import type { LocalStore, StorageBackend } from './localStore';
import {
  createPlayerRecord,
  LEADERBOARD_CATEGORIES,
  LEADERBOARD_LIMIT,
  type LeaderboardCategory,
  type LeaderboardEntry,
  type LeaderboardKeys,
  type LeaderboardRun,
  type LeaderboardSnapshot,
  type LeaderboardSource,
} from './leaderboard';

/**
 * 送得出去的 `fetch`；宣告成自己的型別是為了可以注入（測試不必起伺服器）。
 * The `fetch` this module calls, declared as its own type so it can be injected (tests need no server).
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * 單一請求的最長等待；逾時當作拿不到（保留上一次的榜）。
 * The per-request timeout; a timeout counts as "not fetched" (the previous board is kept).
 */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * 一次抓榜最多要幾列；不得超過伺服器自己的上限（`handlers.ts` 的 `MAX_BOARD_LIMIT` = 200）。
 * The most rows one board fetch may ask for; never above the server's own cap (`MAX_BOARD_LIMIT` = 200 in `handlers.ts`).
 */
const MAX_BOARD_LIMIT = 200;

export interface RemoteLeaderboardOptions {
  /**
   * API 的根路徑；預設空字串 ＝ 同源（`/api/…`）。前後端不同網域時才要填，且伺服器要設 `ALLOWED_ORIGIN`。
   * The API's base path; empty by default (same-origin `/api/…`). Only set it when the origins differ, and the server then needs `ALLOWED_ORIGIN`.
   */
  baseUrl?: string;
  /**
   * 共用的本地儲存層（見 `game/localStore.ts`）。
   * The shared local store (see `game/localStore.ts`).
   */
  store?: LocalStore;
  /**
   * 自行注入儲存體；未提供 `store` 時才用。
   * A storage backend to inject; used only when `store` is absent.
   */
  storage?: StorageBackend | null;
  /**
   * 覆寫儲存鍵；測試用。
   * Overrides the storage keys (tests).
   */
  keys?: LeaderboardKeys;
  /**
   * 顯示名次數；預設 `LEADERBOARD_LIMIT`。
   * How many rows to show; defaults to `LEADERBOARD_LIMIT`.
   */
  limit?: number;
  /**
   * 時鐘；測試用。
   * A clock override (tests).
   */
  now?: () => number;
  /**
   * 覆寫玩家識別碼；測試用。
   * Overrides the player id (tests).
   */
  playerId?: string;
  /**
   * 覆寫防竄改用的鹽；測試用。
   * Overrides the integrity salt (tests).
   */
  salt?: string;
  /**
   * 客戶端版本，隨每一筆提交送出；伺服器存進 `scores.version` 備查。
   * The client version, sent with every submission; the server keeps it in `scores.version` for reference.
   */
  version?: string;
  /**
   * 注入 `fetch`；測試用。
   * Injects `fetch` (tests).
   */
  fetch?: FetchLike;
  /**
   * 單一請求的最長等待毫秒；預設 8000。
   * The per-request timeout in ms; defaults to 8000.
   */
  timeoutMs?: number;
}

/**
 * 榜上一列（伺服器回的形狀）。
 * One board row (the server's shape).
 */
interface ServerEntry {
  readonly rank: number;
  readonly name: string;
  readonly score: number;
  readonly durationMs: number;
  readonly maxCombo: number;
  readonly merges: number;
  readonly at: number;
}

/**
 * 一個分類的榜（快取的就是這一塊）。
 * One category's board (this is what gets cached).
 */
interface BoardResponse {
  readonly total: number;
  readonly entries: readonly ServerEntry[];
  readonly self: ServerEntry | null;
}

/* ── 解析 / parsing ───────────────────────────────────────────────────────── */

/**
 * 把不知道是什麼的東西收成一個物件；回應一律當作不可信，每格都要自己驗。
 * Narrows something unknown into an object; responses are untrusted, so every field is checked.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * 讀一個非負整數；不是數字就回 `fallback`。
 * Reads a non-negative integer, falling back when the value is not a number.
 */
function readCount(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

/**
 * 讀一個非空字串。
 * Reads a non-empty string.
 */
function readText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseServerEntry(raw: unknown): ServerEntry | null {
  const record = asRecord(raw);
  if (record === null) return null;

  const rank = record['rank'];
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank < 1) return null;

  return {
    rank: Math.trunc(rank),
    name: typeof record['name'] === 'string' ? record['name'] : '',
    score: readCount(record['score']),
    durationMs: readCount(record['durationMs']),
    maxCombo: readCount(record['maxCombo']),
    merges: readCount(record['merges']),
    at: readCount(record['at']),
  };
}

/**
 * 解析一個榜；形狀不對回 `null`（呼叫端會保留舊的，而不是把榜清空）。
 * Parses one board; `null` when the shape is wrong (the caller keeps the old board rather than blanking it).
 */
function parseBoard(raw: unknown): BoardResponse | null {
  const record = asRecord(raw);
  if (record === null || record['ok'] !== true) return null;

  const rawEntries = record['entries'];
  if (!Array.isArray(rawEntries)) return null;

  const entries: ServerEntry[] = [];
  for (const item of rawEntries) {
    const entry = parseServerEntry(item);
    /* 壞掉的那一列跳過就好：一列壞掉不該讓整張榜消失。 */
    if (entry !== null) entries.push(entry);
  }

  return { total: readCount(record['total'], entries.length), entries, self: parseServerEntry(record['self']) };
}

/**
 * 伺服器的一列 → 介面的一列；`id` 留空是刻意的（伺服器不外洩裝置碼，「哪一列是我」由 `self` 回答）。
 * A server row → an interface row; `id` is empty on purpose (the server never exposes device ids — "which row is mine" is answered by `self`).
 */
function toEntry(entry: ServerEntry): LeaderboardEntry {
  return {
    id: '',
    name: entry.name,
    score: entry.score,
    durationMs: entry.durationMs,
    maxCombo: entry.maxCombo,
    merges: entry.merges,
    at: entry.at,
  };
}

/* ── 建立 / construction ──────────────────────────────────────────────────── */

export function createRemoteLeaderboard(
  options: RemoteLeaderboardOptions = {},
): LeaderboardSource {
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/u, '');
  const limit = Math.max(1, Math.trunc(options.limit ?? LEADERBOARD_LIMIT));
  const version = options.version ?? '';
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));

  const player = createPlayerRecord({
    store: options.store,
    storage: options.storage,
    keys: options.keys,
    now: options.now,
    playerId: options.playerId,
    salt: options.salt,
  });

  const fetcher: FetchLike | null =
    options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);

  /* 沒有 `fetch`（很舊的瀏覽器、或某個測試環境）就整個網路層停用，但遊戲照跑。 */
  if (fetcher === null) {
    console.warn('[leaderboard] fetch is unavailable; the board will stay empty');
  }

  /** 各分類最近的榜。抓不到時不動它 —— 稍舊但真實的排名好過把榜清空。 */
  const boards = new Map<LeaderboardCategory, BoardResponse>();
  /** 正在抓的分類，避免同一個分類同時打好幾個請求。 */
  const fetching = new Set<LeaderboardCategory>();

  /** 這一局的憑證；還沒鑄好或鑄失敗時是 `null`。 */
  let token: { runId: string; token: string } | null = null;
  let minting = false;

  /**
   * 這一局目前為止的數字，以及「這一局刷新過任何一個最大值嗎」。
   * This run's numbers so far, and whether this run has improved any maximum.
   *
   * 上載的唯一判斷依據；刻意不用 store 的 `revision` —— 它涵蓋解鎖清單，會讓「只解鎖了新角色」
   * 也觸發一次伺服器收不了的提交。
   * They are the only basis for uploading; the store's `revision` is deliberately not used — it covers the unlock set, so "an unlock with no new score" would trigger a submission the server cannot accept.
   */
  let latestRun: LeaderboardRun | null = null;
  let improved = false;

  let uploading = false;

  const notify = (): void => {
    player.notify();
  };

  /**
   * 發一個請求並讀回 JSON；讀不回 JSON 一律當作 `data: null`（呼叫端只看狀態碼）。
   * Sends one request and reads the JSON back; a non-JSON body becomes `data: null` (callers only look at the status).
   */
  async function send(
    path: string,
    init: { method: string; body?: unknown; keepalive?: boolean },
  ): Promise<{ status: number; data: unknown }> {
    if (fetcher === null) return { status: 0, data: null };

    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;

    const response = await fetcher(`${baseUrl}${path}`, {
      method: init.method,
      ...(init.body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
      /*
       * `keepalive` 是關分頁那一次上載的關鍵：`pagehide` 之後瀏覽器會殺掉未完成的請求。
       * `keepalive` is what makes the page-close upload work: the browser kills unfinished requests after `pagehide`.
       */
      ...(init.keepalive === true ? { keepalive: true } : {}),
      ...(signal === undefined ? {} : { signal }),
    });

    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    return { status: response.status, data };
  }

  /* ── 抓榜 / fetching the board ──────────────────────────────────────────── */

  async function fetchCategory(category: LeaderboardCategory): Promise<void> {
    if (fetching.has(category)) return;

    fetching.add(category);

    try {
      const query = new URLSearchParams({
        category,
        limit: String(Math.min(limit, MAX_BOARD_LIMIT)),
        /* 帶上自己，回應才會附 `self`（名次與「超越多少百分比」都靠它）。 */
        deviceId: player.playerId,
      });

      const { status, data } = await send(`/api/leaderboard?${query.toString()}`, { method: 'GET' });
      if (status !== 200) return;

      const board = parseBoard(data);
      if (board === null) return;

      boards.set(category, board);
      notify();
    } catch {
      /* 連不上（離線、逾時、CORS 被擋）：保留上一次的榜，不清空。 */
    } finally {
      fetching.delete(category);
    }
  }

  function refresh(): void {
    for (const category of LEADERBOARD_CATEGORIES) void fetchCategory(category);
  }

  /* ── 開局與提交 / starting a run and submitting it ──────────────────────── */

  function beginRun(): void {
    /* 新的一局：上一局的數字與「刷新過」的旗標都不再有意義。 */
    latestRun = null;
    improved = false;

    if (fetcher === null || minting) return;

    minting = true;

    void (async () => {
      try {
        const { status, data } = await send('/api/run/start', {
          method: 'POST',
          body: { deviceId: player.playerId },
        });

        const record = asRecord(data);
        const runId = record === null ? null : readText(record['runId']);
        const signed = record === null ? null : readText(record['token']);

        if (status !== 200 || runId === null || signed === null) {
          console.warn(`[leaderboard] could not start a run (${String(status)})`);
          token = null;

          return;
        }

        token = { runId, token: signed };
      } catch {
        /* 離線：這一局不會被上載；下一個 `beginRun()` 會再試一次。 */
        token = null;
      } finally {
        minting = false;
      }
    })();
  }

  /**
   * 把一個已經開始的局送上去；`drops` 未提供時取 `merges`（伺服器下界是「合成 ≤ 投放」，少報是安全的）。
   * Sends one already-started run; `drops` falls back to `merges` (the server's lower bound is "merges ≤ drops", so under-reporting is safe).
   */
  function submit(run: LeaderboardRun): void {
    const pending = token;
    if (pending === null) return;

    const merges = Math.max(0, Math.trunc(run.merges));
    const body = {
      runId: pending.runId,
      token: pending.token,
      deviceId: player.playerId,
      displayName: player.displayName,
      score: Math.max(0, Math.trunc(run.score)),
      durationMs: Math.max(0, Math.trunc(run.durationMs ?? 0)),
      merges,
      drops: Math.max(merges, Math.trunc(run.drops ?? 0)),
      maxCombo: Math.max(0, Math.trunc(run.maxCombo)),
      version,
    };

    uploading = true;

    void (async () => {
      try {
        const { status, data } = await send('/api/score', { method: 'POST', body, keepalive: true });

        if (status === 200) {
          /*
           * 200 不代表上榜了：伺服器對合理與不合理的提交都回 200，只差在 `verified`
           * （不合理的存進 `scores` 但不進 `profiles`，留作審計）。
           * A 200 does not mean it reached the board: the server answers 200 either way, differing only in `verified` (implausible ones are stored in `scores` but never reach `profiles`).
           */
          const verdict = asRecord(data);

          if (verdict !== null && verdict['verified'] === false) {
            console.warn(`[leaderboard] submission was not counted (${String(verdict['reason'] ?? 'unknown')})`);
          }

          settled();
          refresh();

          return;
        }

        /*
         * 4xx（除了 429）是定論：這一筆永遠不會被接受，留著只會每次上載都重試同一個必敗的請求。
         * A 4xx other than 429 is final: the submission will never be accepted, so keeping it would retry a doomed request on every upload.
         */
        if (status >= 400 && status < 500 && status !== 429) {
          console.warn(`[leaderboard] submission refused (${String(status)})`, data);
          settled();

          return;
        }

        /* 429 與 5xx 留著：前者是「等一下再送」，後者是「伺服器那邊暫時的事」。 */
        console.warn(`[leaderboard] submission deferred (${String(status)})`);
      } catch {
        /* 網路層失敗（離線、逾時）：留著，下一次 `sync()` 再送。 */
        console.warn('[leaderboard] submission failed; it will be retried');
      } finally {
        uploading = false;
      }
    })();
  }

  /**
   * 伺服器已經對這一筆表態了（不論接受或拒絕）：標記清掉，狀態同步一次。
   * The server has ruled on this submission (accepted or not): clear the marker and sync state once.
   */
  function settled(): void {
    improved = false;
    player.markUploaded();
    notify();
  }

  function sync(): boolean {
    if (!player.sharing) return false;
    if (latestRun === null || !improved) return false;
    if (token === null) return false;
    if (uploading) return false;

    submit(latestRun);

    return true;
  }

  /* ── 介面 / the interface ─────────────────────────────────────────────── */

  return {
    get displayName(): string {
      return player.displayName;
    },

    setDisplayName(name: string): void {
      if (name === player.displayName) return;

      player.setDisplayName(name);

      /*
       * 快取裡自己那一列先改名字（樂觀更新）：伺服器要等下一次提交才會更新，下一次抓榜會蓋掉。
       * The cached row is renamed first (an optimistic update): the server's copy only changes on the next submission, and the next fetch overwrites it.
       */
      for (const [category, board] of boards) {
        if (board.self === null) continue;

        const mine = board.self.rank;
        boards.set(category, {
          ...board,
          entries: board.entries.map((entry) => (entry.rank === mine ? { ...entry, name } : entry)),
          self: { ...board.self, name },
        });
      }

      notify();
    },

    get sharing(): boolean {
      return player.sharing;
    },

    setSharing(on: boolean): void {
      player.setSharing(on);

      /*
       * 同意的那一刻就推一次與抓一次：「同意」本身就是觸發點；抓一次是因為榜面即將被打開而快取還是空的。
       * Consenting uploads and fetches at once — consent itself is the trigger; the fetch covers the board about to be opened against an empty cache.
       */
      if (on) {
        sync();
        refresh();
      }

      notify();
    },

    get publishPromptDone(): boolean {
      return player.publishPromptDone;
    },

    finishPublishPrompt(): void {
      if (!player.finishPublishPrompt()) return;

      notify();
    },

    record(run: LeaderboardRun): boolean {
      /*
       * 每一幀都會呼叫，所以這裡要便宜：把這一局存下來、問共用層有沒有刷新最大值。上載不在這裡發生。
       * Called every frame, so it stays cheap: stash the run and ask the shared layer whether a maximum improved. Uploading never happens here.
       */
      latestRun = run;

      const advanced = player.record(run);
      if (!advanced) return false;

      improved = true;
      /* 與本機版同一條規則：刷新了本機紀錄就通知。 */
      notify();

      return true;
    },

    beginRun,
    refresh,
    sync,

    /*
     * 已經在抓了。`fetchCategory()` 在任何 `await` 之前就寫進 `fetching`，所以 `refresh()` 一回來就查得到。
     * Already fetching. `fetchCategory()` adds the category before any `await`, so this is answerable the moment `refresh()` returns.
     */
    isFetching(category: LeaderboardCategory): boolean {
      return fetching.has(category);
    },

    snapshot(category: LeaderboardCategory, requested?: number): LeaderboardSnapshot {
      /*
       * 同意之前榜是空的 —— 與本機版同一條規則：不是「記了但不顯示」，而是還沒有東西被推上去。
       * Empty until consent, the same rule as the local build: not "recorded but hidden" — nothing has been pushed yet.
       */
      if (!player.sharing) return { category, entries: [], self: null };

      const board = boards.get(category);
      if (board === undefined) return { category, entries: [], self: null };

      const take = Math.max(1, Math.trunc(requested ?? limit));
      const entries = board.entries.slice(0, take).map(toEntry);

      if (board.self === null) return { category, entries, self: null };

      const { total, self } = board;

      /*
       * 百分位由伺服器給的總人數與名次算，公式與本機版一字不差（自己留在分母裡）。
       * The percentile comes from the server's total and rank, with the local build's exact formula (the player stays in the denominator).
       */
      const beats = total <= 0 ? 0 : Math.round(((total - self.rank) / total) * 100);

      return { category, entries, self: { rank: self.rank, entry: toEntry(self), total, beats } };
    },

    subscribe: player.subscribe,
  };
}
