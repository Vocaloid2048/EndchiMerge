/**
 * 排行榜資料層。
 * The leaderboard data layer.
 *
 * **現階段是純本地**：所有紀錄寫進 `localStorage`，只有自己在看。使用者已定案排行榜最終要
 * 接真後端（Docker Postgres container 或 Vercel 支援的後端＋微資料庫；騰訊雲再後），所以
 * 這一支刻意把「榜單從哪裡來」抽成 `LeaderboardSource` 介面 —— UI 只依賴介面，日後換成
 * 伺服器實作時**一行 UI 都不用改**。
 * **Local for now**: records live in `localStorage` and only the player sees them. The user has
 * decided the leaderboard will eventually talk to a real backend (a Docker Postgres container,
 * or Vercel's supported backend plus a micro database; Tencent Cloud later), so "where the board
 * comes from" is deliberately abstracted behind `LeaderboardSource` — the UI depends on the
 * interface only, and swapping in a server implementation changes **no UI code**.
 *
 * 設計要點（皆為使用者定案）/ Design points, all decided by the user:
 *
 * 1. **每位玩家一筆，每個分類最多一筆**：榜排的是**玩家**，不是場次。一局跑完只是把這位玩家
 *    的數字往上推，不會多留一筆歷史。
 *    **One row per player, at most one per category.** The board ranks **players**, not runs; a
 *    finished run pushes that player's numbers up instead of leaving another row behind.
 * 2. **三個數值各自獨立取歷史最大**：分數／COMBO／合成各自與存檔比大小，所以同一行的三個數字
 *    可能來自不同的局 —— 這是刻意的，三個分頁才都名副其實。若三個數字綁在同一局，COMBO 分頁
 *    會永遠只看到高分局。
 *    **The three values are independent maxima.** Score, combo and merges are each compared
 *    against storage on their own, so one row's three numbers can come from different runs. That
 *    is deliberate: the three tabs are only honest this way — tied to a single run, the COMBO tab
 *    would only ever show high-score games.
 * 3. **只升不降**：較差的表現不會覆蓋較好的紀錄，連時間戳都不動。
 *    **Monotonic.** A worse run never overwrites a better record, not even its timestamp.
 * 4. **名字不是身份**：身份是一個本機鑄造的 `playerId`（`endchimerge:device-id`）。改名只改
 *    那一筆的 `name` 欄位 —— 不新增一筆，也不會留下掛在舊名字底下、再也認不回來的孤兒紀錄。
 *    **The name is not the identity.** Identity is a locally minted `playerId`
 *    (`endchimerge:device-id`). Renaming only rewrites that one row's `name` field: no new row,
 *    and no orphan left behind under the old name that can never be claimed again.
 * 5. **兩層：本機紀錄與榜。** 這條分界就是日後接真後端的那條線。
 *    **Two layers: the local record and the board.** This seam is exactly where the real backend
 *    will go.
 *    - `profile`（`endchimerge:profile`）＝ 這台裝置上的最佳成績，**邊玩邊更新**（只有真的刷新
 *      才寫入），所以關分頁、當機、斷電都不掉成績。它帶 `revision`（每次刷新 +1）與
 *      `uploaded`（最後一次推上排行榜的 revision）。
 *      `profile` is this device's best, **updated as you play** (written only on a real
 *      improvement), so a closed tab or a crash costs nothing. It carries `revision`
 *      (incremented on every improvement) and `uploaded` (the revision last pushed to the board).
 *    - `board`（`endchimerge:leaderboard`）＝ 榜本身。**只有 `sync()` 會寫它。**
 *      `board` is the board itself, and **only `sync()` writes it.**
 * 6. **甚麼時候上載**：該局結束、重新開始、關分頁／切到背景、下次開頁（有未上載的更新時），
 *    以及**同意分享的那一刻**。同意之後玩家不必再手動按任何東西。
 *    **When it uploads**: at the end of a run, on restart, when the page is hidden or closed, on
 *    the next open if something is pending — and the moment consent is given. After that the
 *    player never has to press anything again.
 * 7. **同意分享之前榜是空的**：不是「記了但不顯示」，而是根本還沒推上去。
 *    **The board is empty until consent**: not "recorded but hidden" — nothing has been pushed
 *    yet.
 * 8. **防竄改**：兩份存檔都附一段摘要（`core/integrity.ts`），讀回來重算比對，對不上就當作
 *    那筆不存在。⚠️ 那是門檻不是防護，理由寫在該檔案裡。
 *    **Tamper check**: both blobs carry a digest (`core/integrity.ts`), recomputed and compared
 *    on read; a mismatch means the record is treated as absent. ⚠️ It is a speed bump rather than
 *    a defence, for the reasons given in that file.
 * 9. **首次的發布詢問**：名稱與分享意願只在第一次開榜之前問一次（見 `publishPromptDone`），
 *    之後要改就到設定。
 *    **The one-off publish prompt**: name and consent are asked once, before the board first
 *    opens (see `publishPromptDone`); changes afterwards happen in settings.
 *
 * 只做儲存與排序，不含任何遊戲規則（與 `game/progress.ts` 的分工相同）。
 * Storage and ordering only, no game rules — the same split as `game/progress.ts`.
 */

import { STORAGE_KEYS } from '../core/constants';
import { open, seal } from '../core/integrity';
import type { ProgressStorage } from './progress';

/** 榜單分類。 */
export type LeaderboardCategory = 'score' | 'combo' | 'merges';

/**
 * 三個分類的識別與順序（UI 直接用，順序即顯示順序）。
 * The three categories, id and order (the UI uses this directly; the order is the display order).
 *
 * 只有**識別**在這裡：顯示文字住在 `src/i18n`（`leaderboard.tab.*`），否則同一個標籤會有
 * 兩個來源，改了一個忘了另一個。
 * Only the **ids** live here: the displayed text lives in `src/i18n` (`leaderboard.tab.*`),
 * otherwise one label has two sources and one of them gets forgotten.
 */
export const LEADERBOARD_CATEGORIES: readonly LeaderboardCategory[] = ['score', 'combo', 'merges'];

/**
 * 榜上顯示的名次數（使用者定案：Top 100）。
 * Rows shown on the board (the user's decision: Top 100).
 */
export const LEADERBOARD_LIMIT = 100;

/**
 * 榜上的一筆：一位玩家。
 * One row on the board: one player.
 */
export interface LeaderboardEntry {
  /**
   * 玩家的穩定識別碼。**這不是名字** —— 改名不會換 id，所以改名只是改這一筆的內容。
   * The player's stable id. **This is not the name**: renaming does not change the id, which is
   * why a rename edits this row rather than adding another.
   */
  id: string;
  /** 顯示名；未設定時為空字串。 */
  name: string;
  /** 歷史最高分。 */
  score: number;
  /** 歷史最高連擊（可能來自另一局）。 */
  maxCombo: number;
  /** 歷史最高單局合成次數（可能來自另一局）。 */
  merges: number;
  /** 這筆紀錄最後一次被刷新的時刻（epoch ms）。 */
  at: number;
}

/** 目前的成績，併入本機紀錄時用。 */
export interface LeaderboardRun {
  score: number;
  maxCombo: number;
  merges: number;
  /** 覆寫時間戳；未提供時用時鐘。測試用。 */
  at?: number;
}

/** 榜上玩家自己那一筆的排名資訊。 */
export interface LeaderboardRank {
  /** 1 起算的名次。 */
  rank: number;
  entry: LeaderboardEntry;
  /** 榜上的玩家總數（＝已同意分享且已上載的人數）。 */
  total: number;
  /**
   * 贏過多少比例的玩家，0–100 的整數（`(total − rank) / total`）。
   * The share of players beaten, an integer 0–100 (`(total − rank) / total`).
   *
   * **由資料層算，不讓 UI 自己推**：名次是資料層的事實，換一個（伺服器）實作時它可能拿到
   * 真正的跨玩家百分位，屆時這一格直接換算法，UI 一行都不用動。
   * **Computed here rather than by the UI**: the rank is the data layer's fact, and a server
   * implementation may well have a real percentile to put in this slot — at which point only this
   * line changes and the UI stays put.
   *
   * 公式刻意把「自己」留在分母裡（`(total − rank) / total` 而不是除以 `total − 1`）：榜首在
   * 一千人的榜上讀作「超越 99%」，而不是一句沒人相信的 100%。
   * The formula deliberately keeps the player in the denominator (`(total − rank) / total` rather
   * than dividing by `total − 1`): being first of a thousand then reads "beats 99%", not a
   * 100% nobody believes.
   */
  beats: number;
}

/** 讀取某一分類的結果。 */
export interface LeaderboardSnapshot {
  category: LeaderboardCategory;
  /** 該分類的前 N 名（已依分類排序）。 */
  entries: readonly LeaderboardEntry[];
  /** 玩家自己在該分類的那一筆；不在榜上時是 `null`。 */
  self: LeaderboardRank | null;
}

/**
 * 榜單來源。
 * The leaderboard source.
 *
 * UI 只認這個介面。日後接真後端時新增一個 `createRemoteLeaderboard()` 即可 —— 名稱與分享
 * 意願仍留在本地（那是玩家的設定，不是伺服器資料）。
 * The UI knows only this interface. Adding the real backend means adding a
 * `createRemoteLeaderboard()`; the name and the sharing preference stay local, because they are
 * player settings rather than server data.
 */
export interface LeaderboardSource {
  /** 目前的顯示名；未設定為空字串。 */
  readonly displayName: string;
  /**
   * 設定顯示名（呼叫端已驗證過）。
   * Set the display name (already validated by the caller).
   *
   * **改名不會產生新的一筆**：身份是 `playerId`，名字只是那一筆的一個欄位。榜上自己那一筆
   * （如果已經在上面）與本機紀錄會一起改名。
   * **Renaming never creates a second row**: identity is the `playerId` and the name is just one
   * of that row's fields. The player's row on the board (if it is there) and the local record are
   * renamed together.
   */
  setDisplayName(name: string): void;
  /** 是否同意分享成績上榜（全域開關）。 */
  readonly sharing: boolean;
  /**
   * 切換分享意願。**開啟時會立刻上載一次**，所以玩家同意之後不必再手動按下任何鍵。
   * Toggle the sharing preference. **Turning it on uploads immediately**, so consenting is the
   * only thing the player has to do.
   */
  setSharing(on: boolean): void;
  /**
   * 首次的「發布成績」詢問是否已經處理過。
   * Whether the one-off "publish your score" prompt has already been dealt with.
   *
   * 使用者定案：名稱與分享意願**只在首次按下排行榜時問一次**（之後改到設定裡改），所以需要
   * 一個「問過了沒」的事實。按了儲存或選擇稍後都算處理過 —— 否則每次開榜都會再彈一次。
   * The user's decision: the name and the sharing preference are **asked only once, on the first
   * leaderboard open** (later changes happen in settings), which needs a "already asked" fact.
   * Saving and declining both count — otherwise the prompt would reappear on every open.
   */
  readonly publishPromptDone: boolean;
  /** 記下首次的發布詢問已經處理過。 */
  finishPublishPrompt(): void;
  /**
   * 把目前的成績併入**本機紀錄**。**只升不降**：三個數值各自與存檔比大小，只有更高才覆蓋。
   * Fold the current numbers into the **local record**. **Monotonic**: each of the three values is
   * compared against storage on its own and only a higher one overwrites.
   *
   * 可以安全地每幀呼叫 —— 沒有刷新時立刻返回，不碰儲存體，也不通知任何人。
   * Safe to call every frame: with no improvement it returns immediately, touching neither
   * storage nor the listeners.
   *
   * 這一步**不上榜**。上載是 `sync()`。
   * This step **does not touch the board**; uploading is `sync()`.
   *
   * @returns 是否刷新了紀錄。
   */
  record(run: LeaderboardRun): boolean;
  /**
   * 把本機紀錄推上排行榜。未同意分享、或沒有未上載的更新時什麼都不做（回傳 `false`）。
   * Push the local record onto the board. Does nothing when consent has not been given or when
   * there is no un-uploaded update (returns `false`).
   */
  sync(): boolean;
  /** 讀取某一分類的前 N 名與自己的名次。 */
  snapshot(category: LeaderboardCategory, limit?: number): LeaderboardSnapshot;
  /** 訂閱變更（刷新、上載、改名、切換分享）；回傳取消訂閱的函式。 */
  subscribe(listener: () => void): () => void;
}

export interface LocalLeaderboardOptions {
  /** 注入儲存體；未提供時用 `localStorage`，不可用時退回記憶體。 */
  storage?: ProgressStorage | null;
  /** 覆寫儲存鍵；測試用。 */
  keys?: {
    entries?: string;
    name?: string;
    sharing?: string;
    prompt?: string;
    profile?: string;
    device?: string;
  };
  /** 顯示名次數；預設 `LEADERBOARD_LIMIT`。 */
  limit?: number;
  /** 時鐘；測試用。 */
  now?: () => number;
  /**
   * 覆寫玩家識別碼；測試用。未提供時依序讀本機紀錄、裝置鍵，都沒有才鑄一個。
   * Override the player id; for tests. Otherwise it comes from the local record, then the device
   * key, and is minted only if neither exists.
   */
  playerId?: string;
  /** 覆寫防竄改用的鹽；測試用。 */
  salt?: string;
}

/**
 * 防竄改摘要用的鹽（見 `core/integrity.ts`）。
 * The salt for the tamper digest (see `core/integrity.ts`).
 */
const CONTENT_SALT = 'endchimerge/leaderboard/v2';

/** 本機紀錄：這台裝置上的最佳成績，也就是「要上載的那一筆」。 */
interface PlayerProfile {
  playerId: string;
  name: string;
  score: number;
  maxCombo: number;
  merges: number;
  at: number;
  /** 每次刷新 +1。 */
  revision: number;
  /** 最後一次推上排行榜的 `revision`。 */
  uploaded: number;
}

/** 三種分類各自的取值。 */
function valueOf(entry: LeaderboardEntry, category: LeaderboardCategory): number {
  switch (category) {
    case 'score':
      return entry.score;
    case 'combo':
      return entry.maxCombo;
    case 'merges':
      return entry.merges;
  }
}

/**
 * 分類排序：先比該分類的數值，再比分數，最後比時間（越新越前）。
 * Category order: the category's own value, then score, then recency.
 *
 * 後兩者是**穩定的決勝鍵** —— 少了它們，同分的兩筆會照陣列順序排，存檔讀回來後順序還可能
 * 變；有了它們，排序在任何一次讀寫之後都一致。
 * The last two are deterministic tie-breakers: without them two equal entries fall back on array
 * order, which can change across a save/load round trip.
 */
function compareBy(category: LeaderboardCategory, a: LeaderboardEntry, b: LeaderboardEntry): number {
  const primary = valueOf(b, category) - valueOf(a, category);
  if (primary !== 0) return primary;

  if (b.score !== a.score) return b.score - a.score;

  return b.at - a.at;
}

/** 由任意來源取值並轉成非負整數；不合法就回傳 null。 */
function toCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/** 解析一筆紀錄；壞掉回傳 null（壞資料不該讓整個榜消失）。 */
function parseEntry(raw: unknown): LeaderboardEntry | null {
  if (raw === null || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const id = candidate['id'];
  if (typeof id !== 'string' || id === '') return null;

  const score = toCount(candidate['score']);
  const maxCombo = toCount(candidate['maxCombo']);
  const merges = toCount(candidate['merges']);
  const at = toCount(candidate['at']);

  if (score === null || maxCombo === null || merges === null || at === null) return null;

  const name = typeof candidate['name'] === 'string' ? candidate['name'] : '';

  return { id, name, score, maxCombo, merges, at };
}

/** 解析紀錄陣列；壞掉一律當作空的。 */
function parseEntries(raw: unknown): LeaderboardEntry[] {
  if (!Array.isArray(raw)) return [];

  const entries: LeaderboardEntry[] = [];
  for (const item of raw) {
    const entry = parseEntry(item);
    if (entry !== null) entries.push(entry);
  }

  return entries;
}

/** 解析本機紀錄；壞掉回傳 null（呼叫端會退回空的）。 */
function parseProfile(raw: unknown): PlayerProfile | null {
  if (raw === null || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const playerId = candidate['playerId'];
  if (typeof playerId !== 'string' || playerId === '') return null;

  const score = toCount(candidate['score']);
  const maxCombo = toCount(candidate['maxCombo']);
  const merges = toCount(candidate['merges']);
  const at = toCount(candidate['at']);
  const revision = toCount(candidate['revision']);
  const uploaded = toCount(candidate['uploaded']);

  if (
    score === null ||
    maxCombo === null ||
    merges === null ||
    at === null ||
    revision === null ||
    uploaded === null
  ) {
    return null;
  }

  return {
    playerId,
    name: typeof candidate['name'] === 'string' ? candidate['name'] : '',
    score,
    maxCombo,
    merges,
    at,
    revision,
    /* `uploaded` 不可以超過 `revision`，否則「有待上載的更新」永遠不成立。 */
    uploaded: Math.min(uploaded, revision),
  };
}

/**
 * 空的本機紀錄。
 * An empty local record.
 *
 * `at` 取**當下**而不是 0：同意分享會立刻把本機紀錄推上榜（使用者定案：同意就不必再按任何
 * 鍵），所以一個還沒玩過、就先勾了同意的人也會在榜上看到自己那一筆。那筆的分數當然是 0，
 * 但時間戳不該是 1970 —— 畫面上寫著 1970/01/01 只會讓人以為壞了。
 * `at` is stamped **now** rather than 0: consenting uploads the local record immediately (the
 * user's decision — agreeing means never pressing an upload key), so a player who consents before
 * playing does see a row of his own. Its score is legitimately 0, but its timestamp must not be
 * 1970 — a date of 1970/01/01 on screen only reads as "this is broken".
 */
function emptyProfile(playerId: string, at: number): PlayerProfile {
  return {
    playerId,
    name: '',
    score: 0,
    maxCombo: 0,
    merges: 0,
    at,
    revision: 0,
    uploaded: 0,
  };
}

/**
 * 舊格式（每局一筆）的榜 → 一位玩家一筆。
 * The old per-run board collapsed into one row per player.
 *
 * 舊版的鍵存的是一個裸陣列，每一局一筆。使用者定案改成「每位玩家一筆、只保留最佳」之後，
 * 那些歷史紀錄的唯一合理去處就是：三個數值各取最大值，合成一筆。
 * The old key held a bare array with one row per run. Now that the model is one row per player
 * holding the best, the only sensible home for that history is to take the maximum of each of
 * the three values and fold it into a single row.
 */
function collapseLegacy(rows: readonly LeaderboardEntry[], playerId: string): LeaderboardEntry | null {
  if (rows.length === 0) return null;

  /*
   * 名字取**最新那一筆非空的**：玩家大半是先玩、後命名，所以越新的紀錄越可能帶著他現在
   * 用的名字。
   * The name comes from the **newest non-empty** row: players usually play first and name
   * themselves later, so the most recent rows are the ones likely to carry the name in use.
   */
  const newestName =
    [...rows].sort((a, b) => b.at - a.at).find((row) => row.name !== '')?.name ?? '';

  return {
    id: playerId,
    name: newestName,
    score: Math.max(...rows.map((row) => row.score)),
    maxCombo: Math.max(...rows.map((row) => row.maxCombo)),
    merges: Math.max(...rows.map((row) => row.merges)),
    at: Math.max(...rows.map((row) => row.at)),
  };
}

/** 把一筆榜上的紀錄轉成本機紀錄（給遷移用）。 */
function profileFromEntry(entry: LeaderboardEntry, playerId: string, revision: number): PlayerProfile {
  return {
    playerId,
    name: entry.name,
    score: entry.score,
    maxCombo: entry.maxCombo,
    merges: entry.merges,
    at: entry.at,
    revision,
    /* 遷移過來的那一筆還沒上載過，所以 `uploaded` 留在 0：下次 `sync()` 會推上去。 */
    uploaded: 0,
  };
}

/**
 * 保留每個分類各自的 Top `limit`，外加**玩家自己那一筆**。
 * Keep each category's own top `limit`, plus **the player's own row**.
 *
 * 三個分頁都要正確的最小代價：只存分數的前十名，COMBO 分頁就永遠看不到那些「分數不高但連擊
 * 很長」的玩家。
 * The least storage that keeps all three tabs correct: keeping only the score top ten would hide
 * every high-combo, low-score player from the COMBO tab forever.
 *
 * 自己那一筆**無條件保留**（使用者定案）：榜身只列前 `limit` 名，但「你的最佳」那一行要報
 * 名次或「超越百分之多少」，而兩者都需要自己那一筆還在資料裡。以前它會跟著被裁掉，於是排到
 * 100 名之外就變成「榜上沒有你」，連百分比都算不出來 —— 那個節錄才是這一條存在的理由。
 * The player's own row is kept **unconditionally** (the user's decision): the board itself lists
 * only the top `limit`, but the "your best" line reports either a rank or a share of players
 * beaten, and both need that row to still exist. It used to be trimmed away with the rest, so
 * ranking past 100 meant "you are not on the board at all" and there was no percentage to compute
 * — which is exactly what this clause is for.
 */
function capEntries(
  entries: readonly LeaderboardEntry[],
  limit: number,
  keepId: string,
): LeaderboardEntry[] {
  const kept = new Map<string, LeaderboardEntry>();

  for (const category of LEADERBOARD_CATEGORIES) {
    const top = [...entries].sort((a, b) => compareBy(category, a, b)).slice(0, limit);
    for (const entry of top) kept.set(entry.id, entry);
  }

  const mine = entries.find((entry) => entry.id === keepId);
  if (mine !== undefined) kept.set(mine.id, mine);

  return [...kept.values()];
}

/** 取得預設儲存體；瀏覽器端不可用時回傳 null。 */
function defaultStorage(): ProgressStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 鑄一個玩家識別碼。 */
function mintId(): string {
  const uuid = globalThis.crypto?.randomUUID;
  return typeof uuid === 'function'
    ? uuid.call(globalThis.crypto)
    : `${String(Date.now())}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createLocalLeaderboard(options: LocalLeaderboardOptions = {}): LeaderboardSource {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const limit = Math.max(1, Math.trunc(options.limit ?? LEADERBOARD_LIMIT));
  const now = options.now ?? ((): number => Date.now());
  const salt = options.salt ?? CONTENT_SALT;

  const entriesKey = options.keys?.entries ?? STORAGE_KEYS.leaderboard;
  const nameKey = options.keys?.name ?? STORAGE_KEYS.playerName;
  const sharingKey = options.keys?.sharing ?? STORAGE_KEYS.shareScore;
  const promptKey = options.keys?.prompt ?? STORAGE_KEYS.publishPrompt;
  const profileKey = options.keys?.profile ?? STORAGE_KEYS.profile;
  const deviceKey = options.keys?.device ?? STORAGE_KEYS.deviceId;

  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const readBoard = (): LeaderboardEntry[] => {
    if (storage === null) return [];
    return parseEntries(open(readItem(storage, entriesKey), salt));
  };

  const writeBoard = (): void => {
    if (storage === null) return;
    writeItem(storage, entriesKey, seal(entries, salt));
  };

  const writeProfile = (): void => {
    if (storage === null) return;
    writeItem(storage, profileKey, seal(profile, salt));
  };

  /* ── 身份 ────────────────────────────────────────────────────────────
   * 玩家識別碼優先取本機紀錄裡的那一個（身份跟著紀錄走，裝置鍵被清掉也認得回來），
   * 其次取裝置鍵，都沒有才鑄一個。
   * The player id comes from the local record first (identity travels with the record, so losing
   * the device key does not orphan it), then from the device key, and is minted only if neither
   * exists.
   */
  const storedProfile = storage === null ? null : parseProfile(open(readItem(storage, profileKey), salt));
  const storedDevice = storage === null ? '' : (readItem(storage, deviceKey) ?? '');
  const playerId =
    options.playerId ?? storedProfile?.playerId ?? (storedDevice !== '' ? storedDevice : mintId());

  if (storage !== null && storedDevice !== playerId) writeItem(storage, deviceKey, playerId);

  /* ── 榜 ──────────────────────────────────────────────────────────────
   * 先讀原始字串：舊格式是一個裸陣列（每局一筆），新格式是信封（一筆一位玩家）。兩者要分開
   * 處理，而 `open()` 對舊格式只會回 `null`。
   * Read the raw text first: the old format is a bare array (one row per run) and the new one is
   * an envelope (one row per player). They need separate handling, and `open()` just returns
   * `null` for the old one.
   */
  const rawBoard = storage === null ? null : readItem(storage, entriesKey);

  let entries: LeaderboardEntry[];
  let legacy: LeaderboardEntry[] | null = null;

  try {
    const parsed: unknown = rawBoard === null ? null : JSON.parse(rawBoard);
    legacy = Array.isArray(parsed) ? parseEntries(parsed) : null;
  } catch {
    legacy = null;
  }

  if (legacy !== null) {
    const collapsed = collapseLegacy(legacy, playerId);
    entries = collapsed === null ? [] : [collapsed];

    if (collapsed !== null) {
      const name = storage === null ? '' : (readItem(storage, nameKey) ?? '');
      if (name !== '') entries = [{ ...collapsed, name }];
    }
  } else {
    entries = readBoard();
  }

  let profile: PlayerProfile =
    storedProfile ??
    (() => {
      /* 沒有本機紀錄時，用榜上自己那一筆當起點；連那一筆都沒有就是空的。 */
      const mine = entries.find((entry) => entry.id === playerId);
      return mine === undefined ? emptyProfile(playerId, now()) : profileFromEntry(mine, playerId, 1);
    })();

  /*
   * 名字是**設定**，以 `player-name` 為準 —— 但「沒有這個鍵」與「鍵裡是空的」是兩件事：
   * 前者是舊存檔遷移過來（名字本來只存在紀錄裡），後者是玩家自己把名字清掉了，不該幫他填回去。
   * The name is a **setting**, so `player-name` wins — but "the key is absent" and "the key is
   * empty" are different things: the first is a migrated old save (where the name only ever lived
   * on the records), the second is the player clearing it on purpose, which must not be undone.
   */
  const savedName = storage === null ? null : readItem(storage, nameKey);
  let displayName = savedName ?? profile.name;

  let sharing = storage === null ? false : readItem(storage, sharingKey) === 'true';
  let publishPromptDone = storage === null ? false : readItem(storage, promptKey) === 'true';

  if (displayName !== '') {
    profile = { ...profile, name: displayName };
    const index = entries.findIndex((entry) => entry.id === playerId);
    if (index >= 0) {
      entries = entries.map((entry, at) => (at === index ? { ...entry, name: displayName } : entry));
    }
    /* 名字是從紀錄裡撿回來的，就順手把它補進設定，之後兩邊才不會各說各話。 */
    if (savedName === null && storage !== null) writeItem(storage, nameKey, displayName);
  }

  /* 遷移結果要落地，否則下次開啟又會走一次舊格式。 */
  if (legacy !== null) {
    writeBoard();
    writeProfile();
  }

  /** 把本機紀錄的那一筆寫上（或更新）榜。 */
  const push = (): void => {
    const row: LeaderboardEntry = {
      id: profile.playerId,
      name: displayName,
      score: profile.score,
      maxCombo: profile.maxCombo,
      merges: profile.merges,
      at: profile.at,
    };

    const index = entries.findIndex((entry) => entry.id === playerId);
    const updated =
      index >= 0 ? entries.map((entry, at) => (at === index ? row : entry)) : [...entries, row];

    entries = capEntries(updated, limit, playerId);
    writeBoard();

    profile = { ...profile, name: displayName, uploaded: profile.revision };
    writeProfile();
  };

  /**
   * 上載：把本機紀錄推上榜。
   * Upload: push the local record onto the board.
   *
   * 兩個前提都成立才會動：玩家同意分享、而且有一筆還沒送出去的更新（`revision` 領先
   * `uploaded`）。後者是「上次回來之後又刷新過」的判準，也是「下次回來如有更新就上載」的
   * 實作。
   * Both preconditions must hold: consent, and an update that has not been sent (`revision`
   * ahead of `uploaded`). The second is what "there is something newer than last time" means, and
   * it is how "upload on the next visit if anything changed" is implemented.
   */
  const sync = (): boolean => {
    if (!sharing) return false;
    if (profile.revision === profile.uploaded) return false;

    push();
    notify();

    return true;
  };

  return {
    get displayName(): string {
      return displayName;
    },

    setDisplayName(name: string): void {
      if (name === displayName) return;

      displayName = name;
      if (storage !== null) writeItem(storage, nameKey, name);

      /*
       * 本機紀錄的名字跟著改，並把 `revision` 往上推一次 —— 名字也是要上載的東西之一，
       * 推過了才知道下次 `sync()` 得再送一趟。
       * The local record's name follows, and the revision moves up once: the name is part of what
       * gets uploaded, so bumping it is what tells the next `sync()` to send again.
       */
      profile = { ...profile, name, revision: profile.revision + 1 };
      writeProfile();

      /*
       * 榜上自己那一筆（如果已經在上面）一起改名。**不會新增一筆** —— 找到的是自己那個
       * `playerId` 的那一列。
       * The player's row on the board (if it is up there) is renamed too, and **no row is added**:
       * what gets found is the row carrying this `playerId`.
       */
      const index = entries.findIndex((entry) => entry.id === playerId);
      if (index >= 0) {
        entries = entries.map((entry, at) => (at === index ? { ...entry, name } : entry));
        writeBoard();
      }

      notify();
    },

    get sharing(): boolean {
      return sharing;
    },

    setSharing(on: boolean): void {
      if (sharing !== on) {
        sharing = on;
        if (storage !== null) writeItem(storage, sharingKey, on ? 'true' : 'false');
      }

      /*
       * 同意的那一刻就推一次。使用者定案：「在用戶同意分享下，不需要用戶手動按下上載記錄」，
       * 所以「同意」本身就是上載的觸發點，而不是等玩家在某處再按一顆按鈕。
       * Consent itself is the trigger: the user's decision is that a player who has agreed should
       * never have to press an upload button. `sync()` notifies when it does something, so only
       * the paths that changed nothing need to notify here.
       */
      if (on && sync()) return;

      notify();
    },

    get publishPromptDone(): boolean {
      return publishPromptDone;
    },

    finishPublishPrompt(): void {
      if (publishPromptDone) return;

      publishPromptDone = true;
      if (storage !== null) writeItem(storage, promptKey, 'true');
      notify();
    },

    record(run: LeaderboardRun): boolean {
      const score = toCount(run.score) ?? 0;
      const maxCombo = toCount(run.maxCombo) ?? 0;
      const merges = toCount(run.merges) ?? 0;

      /*
       * 三個數值**各自**比大小，而且只要有一個沒刷新就整個不動 —— 包括時間戳。所以「關分頁
       * 前又記了一次中途成績」不會把那筆紀錄的時間改成現在。
       * The three values are compared **independently**, and nothing moves unless at least one of
       * them improved — the timestamp included. Recording a mid-run score on the way out therefore
       * does not restamp the record.
       */
      if (score <= profile.score && maxCombo <= profile.maxCombo && merges <= profile.merges) {
        return false;
      }

      profile = {
        ...profile,
        score: Math.max(profile.score, score),
        maxCombo: Math.max(profile.maxCombo, maxCombo),
        merges: Math.max(profile.merges, merges),
        at: toCount(run.at) ?? now(),
        revision: profile.revision + 1,
      };

      writeProfile();
      notify();

      return true;
    },

    sync,

    snapshot(category: LeaderboardCategory, requested?: number): LeaderboardSnapshot {
      const take = Math.max(1, Math.trunc(requested ?? limit));

      /*
       * 同意之前榜是空的。這一條同時是「同意後立刻看得到自己」的原因：`setSharing(true)`
       * 會先 `sync()` 才通知。
       * Empty until consent. It is also why consenting shows the player himself immediately:
       * `setSharing(true)` syncs before it notifies.
       */
      const visible = sharing ? entries : [];
      const sorted = [...visible].sort((a, b) => compareBy(category, a, b));
      const top = sorted.slice(0, take);

      const rank = sorted.findIndex((entry) => entry.id === playerId);
      const mine = rank < 0 ? undefined : sorted[rank];

      /* 自己不在榜上（未同意、或還沒上載過）時 `self` 是 `null`。 */
      if (mine === undefined) return { category, entries: top, self: null };

      /*
       * `beats` 只在**名次落在榜外**時才會被看到（見 `ui/leaderboard.ts`），但那不代表它可以
       * 隨便算 —— 伺服器版會直接給真數字，這裡先給一致的定義。
       * `beats` is only ever read when the rank falls **off the board** (see `ui/leaderboard.ts`),
       * which does not make it a throwaway: a server build supplies the real number, so the local
       * one defines the same thing.
       */
      const beats = Math.round(((sorted.length - (rank + 1)) / sorted.length) * 100);

      return {
        category,
        entries: top,
        self: { rank: rank + 1, entry: mine, total: sorted.length, beats },
      };
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

/** 讀取；儲存體拋錯時視為沒有值。 */
function readItem(storage: ProgressStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** 寫入；配額爆掉或無痕模式擋寫時不應讓遊戲崩掉，因此吞掉錯誤。 */
function writeItem(storage: ProgressStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* 寫不進去只是這次的紀錄不會保存，玩法本身不受影響。 */
  }
}
