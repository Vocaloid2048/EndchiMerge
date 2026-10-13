/**
 * 排行榜資料層的**伺服器版**。
 * The **server-backed** leaderboard data layer.
 *
 * 它與 `createLocalLeaderboard` 是同一條線的兩個端點：本機的那一半（身份、顯示名、分享意願、
 * 本機紀錄）完全共用 `createPlayerRecord`，只有「榜從哪裡來」不同 —— 那邊是 `localStorage`，
 * 這邊是 `/api/leaderboard`。所以 `LeaderboardSource` 這個介面從第一天就在等這一支，而 UI
 * （`ui/leaderboard.ts`）一行都沒有改。
 * It and `createLocalLeaderboard` are the two ends of one line: the local half (identity, display
 * name, sharing preference, the local record) is shared entirely through `createPlayerRecord`, and
 * only "where the board comes from" differs — `localStorage` there, `/api/leaderboard` here. The
 * `LeaderboardSource` interface was written for this file, and the UI (`ui/leaderboard.ts`) did not
 * change a line.
 *
 * ## 三個必須先講清楚的設計決定 / Three decisions worth stating up front
 *
 * 1. **`snapshot()` 是同步的，所以榜一定是快取。** 介面不能改（UI 每個分頁都同步讀它），因此
 *    這裡留一份上次抓回來的榜，抓不到就**保留舊的** —— 寧可給一份稍舊但真實的排名，也不要
 *    在載入的那一瞬間把榜清空。從沒抓到過就是空的，UI 顯示「還沒有人上榜」。
 *    **`snapshot()` is synchronous, so the board is necessarily a cache.** The interface cannot
 *    change (the UI reads it synchronously per tab), so the last fetched board is kept and a failed
 *    fetch **keeps the old one**: a slightly stale but true ranking beats blanking the board while
 *    it loads. Before the first successful fetch there is nothing, and the UI shows "nobody yet".
 *
 * 2. **提交的是「某一局自己的數字」，不是本機紀錄。** 這一點是被伺服器逼出來的，也是對的：
 *    `checkRationality` 要求「合成數 ≤ 投放數」與「連擊 ≤ 合成數」，而**本機紀錄的三個數字
 *    可能來自不同的三局**（見 `LeaderboardEntry`）—— 把它們湊在一起送，等於宣稱一局同時打出
 *    了三個不同局的成績，那筆提交會被退掉（而它本來就該被退）。所以 `record()` 把**這一局**
 *    原封不動存下來，`sync()` 送的是它。
 *    **What is submitted is one run's own numbers, never the local record.** The server forces
 *    this and it is right to: `checkRationality` requires "merges ≤ drops" and "combo ≤ merges",
 *    while **the local record's three numbers may come from three different runs** (see
 *    `LeaderboardEntry`) — sending them together claims one run produced all three, and that
 *    submission is rejected (as it should be). So `record()` stashes **this run** as it is and
 *    `sync()` sends that.
 *
 * 3. **憑證在開局時鑄，不是提交時。** `POST /api/run/start` 回的那張憑證帶著**頒發時刻**，而
 *    反作弊用它判斷「宣稱的時長不可能超過實際流逝的時間」。提交時才鑄的話，那個差值永遠是
 *    零，任何超過容忍值的成績都會被退。所以 `beginRun()` 必須在開局時呼叫（見該介面成員）。
 *    **The token is minted at the start of a run, not at submission.** The token returned by
 *    `POST /api/run/start` carries its **issue time**, and the anti-cheat uses it for "the claimed
 *    duration cannot exceed the time actually elapsed". Minting at submission would make that
 *    difference zero and reject any run longer than the tolerance. So `beginRun()` must be called
 *    when the run begins (see that interface member).
 *
 * ## 失敗是常態，不是例外 / Failure is the normal case, not the exception
 *
 * 手機進隧道、伺服器重啟、玩家在無痕模式裡 —— 上載本來就會常常失敗。這裡的每一條路徑都預設
 * 「送了可能不會到」：`sync()` 立刻返回（不阻塞遊戲）、失敗就留著下一次再送、4xx 這種**定論**
 * 才把待上載的標記清掉。而且**沒有任何一條失敗會影響遊戲本身**：本機紀錄照樣更新，下一局照樣玩。
 * Tunnels, restarts, private windows — uploads fail all the time. Every path here assumes "it may
 * not arrive": `sync()` returns at once (never blocking the game), a failure stays pending for the
 * next attempt, and only a **definitive** 4xx clears the pending marker. And **no failure touches
 * the game itself**: the local record still updates and the next run still plays.
 *
 * ⚠️ **同一局只會提交一次**（`run_id` 是主鍵，重送是同一個裁決）。憑證會在提交後作廢，所以
 * 「先玩一局、離線、隔天才上載」是不可能的 —— 那一局的憑證早就過期了。這是刻意的：它正是
 * 「伺服器知道這一局是什麼時候開始的」的代價。
 * ⚠️ **A run is submitted exactly once** (`run_id` is the primary key and a retry returns the same
 * verdict). The token is consumed by the submission, so "play offline today, upload tomorrow" is
 * impossible — the token would be long expired. That is deliberate: it is the price of the server
 * knowing when a run began.
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
 * 送得出去的 `fetch`。
 * The `fetch` this module calls.
 *
 * 宣告成自己的型別是為了**可以注入**：測試餵一個假的就不必起伺服器，也不必碰真的網路。
 * Declared as its own type so it can be **injected**: a fake in tests needs neither a server nor
 * the network.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 單一請求的最長等待；逾時當作拿不到（保留上一次的榜）。 */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * 一次抓榜最多要幾列。
 * The most rows one board fetch may ask for.
 *
 * 伺服器自己上限是 200（`handlers.ts` 的 `MAX_BOARD_LIMIT`），這裡不要超過它 —— 要更多只是讓
 * 伺服器白白夾住，而夾住之後客戶端拿到的列數與自己以為的不一樣。
 * The server caps at 200 (`MAX_BOARD_LIMIT` in `handlers.ts`); asking above it only makes the
 * server clamp silently, leaving the client with a different row count than it believes.
 */
const MAX_BOARD_LIMIT = 200;

export interface RemoteLeaderboardOptions {
  /**
   * API 的根路徑。**預設空字串 ＝ 同源**，也就是請求會打在 `/api/…`。
   * The API's base path. **Empty by default, meaning same-origin**, so requests go to `/api/…`.
   *
   * 本機開發時 Vite 會把 `/api` 代理到開發伺服器（見 `scripts/dev.ts`），所以留空就通了。前後端
   * 不同網域時（例如前端在騰訊 EdgeOne Pages、後端在雲函式）才要填完整的來源，而伺服器那邊也要
   * 把 `ALLOWED_ORIGIN` 設成前端的來源，否則 CORS 會把請求擋掉。
   * In local development Vite proxies `/api` to the dev API server (see `scripts/dev.ts`), so the
   * default works. Only when front end and back end live on different origins (Tencent EdgeOne
   * Pages plus a cloud function, say) does this need the full origin — and the server then needs
   * `ALLOWED_ORIGIN` set to the front end's, or CORS blocks the request.
   */
  baseUrl?: string;
  /** 共用的本地儲存層（見 `game/localStore.ts`）。 */
  store?: LocalStore;
  /** 自行注入儲存體；未提供 `store` 時才用。 */
  storage?: StorageBackend | null;
  /** 覆寫儲存鍵；測試用。 */
  keys?: LeaderboardKeys;
  /** 顯示名次數；預設 `LEADERBOARD_LIMIT`。 */
  limit?: number;
  /** 時鐘；測試用。 */
  now?: () => number;
  /** 覆寫玩家識別碼；測試用。 */
  playerId?: string;
  /** 覆寫防竄改用的鹽；測試用。 */
  salt?: string;
  /**
   * 客戶端版本，隨每一筆提交送出。伺服器只把它存進 `scores.version` 備查 —— 「這一筆是哪個
   * 版本的客戶端送出來的」在查一件舊事時是唯一問得出來的線索。
   * The client version, sent with every submission. The server only stores it in `scores.version`
   * for reference: "which client version produced this row" is the one clue available when looking
   * into something old.
   */
  version?: string;
  /** 注入 `fetch`；測試用。 */
  fetch?: FetchLike;
  /** 單一請求的最長等待毫秒；預設 8000。 */
  timeoutMs?: number;
}

/** 榜上一列（伺服器回的形狀）。 */
interface ServerEntry {
  readonly rank: number;
  readonly name: string;
  readonly score: number;
  readonly durationMs: number;
  readonly maxCombo: number;
  readonly merges: number;
  readonly at: number;
}

/** 一個分類的榜（快取的就是這一塊）。 */
interface BoardResponse {
  readonly total: number;
  readonly entries: readonly ServerEntry[];
  readonly self: ServerEntry | null;
}

/* ── 解析 / parsing ───────────────────────────────────────────────────────── */

/**
 * 把**不知道是什麼**的東西收成一個物件。
 * Narrow something **unknown** into an object.
 *
 * 回應一律當作不可信：這是瀏覽器與伺服器之間的邊界，中間可能隔著代理、快取、或一個回了 HTML
 * 錯誤頁的閘道。所以每一格都要自己驗，`as` 只在這裡出現一次。
 * Responses are always treated as untrusted: this is the boundary between browser and server, with
 * proxies, caches, or a gateway answering an HTML error page in between. Every field is checked, and
 * `as` appears exactly once.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** 讀一個非負整數；不是數字就回 `fallback`。 */
function readCount(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}

/** 讀一個非空字串。 */
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

/** 解析一個榜；形狀不對回 `null`（呼叫端會保留舊的，而不是把榜清空）。 */
function parseBoard(raw: unknown): BoardResponse | null {
  const record = asRecord(raw);
  if (record === null || record['ok'] !== true) return null;

  const rawEntries = record['entries'];
  if (!Array.isArray(rawEntries)) return null;

  const entries: ServerEntry[] = [];
  for (const item of rawEntries) {
    const entry = parseServerEntry(item);
    /* 壞掉的那一列跳過就好：一列壞掉不該讓整張榜消失（與本機版同一條原則）。 */
    if (entry !== null) entries.push(entry);
  }

  return { total: readCount(record['total'], entries.length), entries, self: parseServerEntry(record['self']) };
}

/**
 * 伺服器的一列 → 介面的一列。
 * A server row → an interface row.
 *
 * **`id` 留空是刻意的。** 伺服器不外洩別人的裝置碼（`handlers.ts` 回應裡根本沒有那一欄），而
 * UI 從來不讀 `id` ——「哪一列是我」由 `snapshot()` 的 `self` 回答。填一個假的（例如名次）只會
 * 讓下一個讀到它的人以為那是真的識別碼。
 * **`id` is empty on purpose.** The server does not expose anyone's device id (the field is absent
 * from `handlers.ts`'s response) and the UI never reads `id` — "which row is mine" is answered by
 * `snapshot()`'s `self`. Filling in a fake (the rank, say) would only make the next reader believe
 * it is a real identifier.
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

  /** 各分類最近的榜。抓不到時**不動它**（見檔頭第 1 點）。 */
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
   * 兩者都由 `record()` 維護（每幀呼叫），由 `beginRun()` 歸零。上載的**唯一**判斷依據是它們，
   * 而刻意**不**用 store 的 `revision`：那個涵蓋解鎖清單與最高分，會讓「只解鎖了新角色、分數
   * 沒動」也觸發一次提交 —— 而伺服器沒有收得下那件事的端點。
   * Both are maintained by `record()` (called every frame) and reset by `beginRun()`. They are the
   * **only** basis for uploading, and the store's `revision` is deliberately **not** used: it
   * covers the unlock set and the high score, so "an unlock with no new score" would trigger a
   * submission — and the server has no endpoint that could accept one.
   */
  let latestRun: LeaderboardRun | null = null;
  let improved = false;

  let uploading = false;

  const notify = (): void => {
    player.notify();
  };

  /**
   * 發一個請求並讀回 JSON。
   * Send one request and read the JSON back.
   *
   * 讀不回 JSON（HTML 錯誤頁、空回應、連線斷了）一律當作 `data: null` —— 呼叫端只看狀態碼，
   * 所以「伺服器回了 500 但沒有主體」與「回了 500 帶一段 JSON」走同一條路。
   * Anything that is not JSON (an HTML error page, an empty body, a dropped connection) becomes
   * `data: null`: callers only look at the status, so "a 500 with no body" and "a 500 with some
   * JSON" take the same path.
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
       * `keepalive` 是**關分頁那一次上載的關鍵**：`pagehide` 之後瀏覽器會殺掉未完成的請求，
       * 而 `keepalive` 明講「這個請求要活過這一頁」。
       * `keepalive` is what makes the **page-close upload** work: the browser kills unfinished
       * requests after `pagehide`, and `keepalive` is the way to say "let this one outlive the
       * page".
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
      /*
       * 連不上（離線、逾時、CORS 被擋）：**保留上一次的榜**。把榜清空會讓玩家以為成績沒了，
       * 而事實只是這一次沒問到。
       * Unreachable (offline, timeout, CORS): **keep the last board**. Blanking it would read as
       * "my score is gone" when the only fact is that this attempt failed.
       */
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
        /* 離線：這一局不會被上載。不吵 —— 下一個 `beginRun()` 會再試一次。 */
        token = null;
      } finally {
        minting = false;
      }
    })();
  }

  /**
   * 把一個已經開始的局送上去。
   * Send one already-started run.
   *
   * 數字全部當作**這一局自己的**：`drops` 未提供時取 `merges`，因為伺服器的下界是
   * 「合成數 ≤ 投放數」—— 寧可少報投入量，也不要送出一筆必定被退回的提交。
   * Every number is **this run's own**: when `drops` is absent it falls back to `merges`, since the
   * server's lower bound is "merges ≤ drops" — better to under-report the input than to send a
   * submission that is guaranteed to be rejected.
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
           * ⚠️ **200 不代表上榜了。** 伺服器對「合理」與「不合理」的提交都回 200，只差在
           * `verified`（不合理的會被存進 `scores` 但**不會**進 `profiles`，留下來當審計線索）。
           * 所以這裡要分開報：被退的那一種，玩家在榜上找不到自己，而那是唯一查得出原因的記錄。
           * ⚠️ **A 200 does not mean it reached the board.** The server answers 200 for both a
           * plausible and an implausible submission, differing only in `verified` (the latter is
           * stored in `scores` but never reaches `profiles`, kept as an audit trail). So the two
           * are reported apart: a rejected run leaves the player off the board, and this is the only
           * record of why.
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
         * 4xx（除了 429）是**定論**：這一筆永遠不會被接受 —— 憑證過期、這一局已經收過、數字不
         * 合理。留著只會讓每次上載都重試一次同一個必敗的請求，所以清掉標記並記一行。
         * A 4xx other than 429 is **final**: this submission will never be accepted (expired
         * token, run already received, numbers rejected). Keeping it would retry a doomed request
         * on every upload, so the marker is cleared and a line is logged.
         */
        if (status >= 400 && status < 500 && status !== 429) {
          console.warn(`[leaderboard] submission refused (${String(status)})`, data);
          settled();

          return;
        }

        /*
         * 429 與 5xx：**留著**。前者是「等一下再送」，後者是「伺服器那邊暫時的事」，兩者都會
         * 隨下一次 `sync()` 再試。
         * 429 and 5xx stay pending: the first means "try later" and the second "the server is
         * having a moment"; both are retried by the next `sync()`.
         */
        console.warn(`[leaderboard] submission deferred (${String(status)})`);
      } catch {
        /* 網路層失敗（離線、逾時）：留著。 */
        console.warn('[leaderboard] submission failed; it will be retried');
      } finally {
        uploading = false;
      }
    })();
  }

  /** 伺服器已經對這一筆表態了（不論接受或拒絕）：標記清掉，狀態同步一次。 */
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
       * 快取裡自己那一列先改名字。伺服器上的名字要等**下一次提交**（`upsertProfile`）才會更新，
       * 而玩家按完改名就開榜時不該還看到舊名字 —— 這是樂觀更新，下一次抓榜就會被真值蓋掉。
       * The cached row is renamed first. The server's copy only updates on the **next submission**
       * (`upsertProfile`), and a player who renames and opens the board should not see the old name
       * — this is an optimistic update that the next fetch overwrites with the truth.
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
       * 同意的那一刻就推一次與抓一次。使用者定案：「在用戶同意分享下，不需要用戶手動按下上載
       * 記錄」—— 所以「同意」本身就是觸發點，而不是等玩家在某處再按一顆按鈕。抓一次是因為榜面
       * 馬上就會被打開，而快取還是空的。
       * Consenting uploads and fetches at once: the user's decision is that a player who has agreed
       * never presses an upload button, so consent itself is the trigger. The fetch is because the
       * board is about to be opened and the cache is still empty.
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
       * 每一幀都會呼叫，所以這裡要便宜：唯一的必要動作是把這一局存下來，然後問共用那一層有沒有
       * 刷新任何最大值。**上載不在這裡發生** —— 那會讓每一幀都可能發出一個請求。
       * Called every frame, so this has to be cheap: the only necessary work is stashing this run
       * and asking the shared layer whether any maximum improved. **Uploading does not happen
       * here** — that would let any frame fire a request.
       */
      latestRun = run;

      const advanced = player.record(run);
      if (!advanced) return false;

      improved = true;
      /* 與本機版同一條規則：刷新了本機紀錄就通知（「你的最佳」那一行靠它即時更新）。 */
      notify();

      return true;
    },

    beginRun,
    refresh,
    sync,

    /*
     * 已經在抓了。`fetchCategory()` 在**任何 `await` 之前**就把這個分類寫進 `fetching`，所以
     * `refresh()` 一回來就查得到 —— 開窗時「先 refresh 再 render」的順序因此拿得到正確答案，
     * 不必等一個 microtask。（`snapshot()` 是同步的，見該介面成員的說明。）
     * Already fetching. `fetchCategory()` adds the category to `fetching` **before any `await`**, so
     * this is answerable the moment `refresh()` returns — which is what makes `open()`'s
     * "refresh, then render" order correct without waiting a microtask. (`snapshot()` is
     * synchronous; see that interface member.)
     */
    isFetching(category: LeaderboardCategory): boolean {
      return fetching.has(category);
    },

    snapshot(category: LeaderboardCategory, requested?: number): LeaderboardSnapshot {
      /*
       * 同意之前榜是空的 —— 與本機版同一條規則（見 `game/leaderboard.ts`）。不是「記了但不顯示」，
       * 而是根本還沒有東西被推上去。
       * Empty until consent, the same rule as the local build (see `game/leaderboard.ts`): not
       * "recorded but hidden", but "nothing has been pushed yet".
       */
      if (!player.sharing) return { category, entries: [], self: null };

      const board = boards.get(category);
      if (board === undefined) return { category, entries: [], self: null };

      const take = Math.max(1, Math.trunc(requested ?? limit));
      const entries = board.entries.slice(0, take).map(toEntry);

      if (board.self === null) return { category, entries, self: null };

      const { total, self } = board;

      /*
       * 百分位由**伺服器給的總人數與名次**算，公式與本機版一字不差（`(total − rank) / total`，
       * 自己留在分母裡）—— 換了榜的來源，這個數字的定義不該跟著換。
       * The percentile comes from the server's total and rank with the local build's exact formula
       * (`(total − rank) / total`, keeping the player in the denominator): changing where the board
       * comes from must not change what this number means.
       */
      const beats = total <= 0 ? 0 : Math.round(((total - self.rank) / total) * 100);

      return { category, entries, self: { rank: self.rank, entry: toEntry(self), total, beats } };
    },

    subscribe: player.subscribe,
  };
}
