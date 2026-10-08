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
 * 1. **全時段單一榜，三個分類**：最高分數／COMBO 數／合成數。三個分類是**同一批紀錄的三種
 *    排序鍵**，不是三份不同的資料。
 *    One all-time board with **three categories** (best score / COMBO / merges). The three tabs
 *    are three sort keys over the *same* records, not three separate datasets.
 * 2. **Top `LEADERBOARD_LIMIT`，每局都記**。因為三個分類各自要有正確的 Top N，儲存時保留
 *    **每個分類各自前 N 名的聯集**（現為 3×100 ＝ 最多 300 筆）—— 只按分數裁切會讓 COMBO
 *    分頁從一開始就偏斜。
 *    **Top `LEADERBOARD_LIMIT`, every run recorded.** Each category needs its own correct top N,
 *    so storage keeps the **union of each category's top N** (3×100 = at most 300 rows).
 *    Trimming by score alone would bias the COMBO tab from the start.
 * 3. **同意分享才上榜**：未同意時榜是空的（唯讀），紀錄本身仍然照記 —— 之後同意就一併出現。
 *    **Opt-in to appear.** While sharing is off the board reads empty; runs are still recorded,
 *    and turning sharing on reveals them all (a global switch, the user's decision).
 * 4. **名稱與分享意願是「玩家設定」，會單獨被問一次**：首次開啟排行榜時彈出一次發布詢問
 *    （見 `publishPromptDone`），之後要改就到設定。這個事實狀態也住在這裡，因為它與名稱、
 *    分享意願是同一組設定。
 *    **The name and the sharing preference are player settings, asked once**: the first time the
 *    leaderboard opens, a publish prompt appears (see `publishPromptDone`); after that they are
 *    edited in settings. That fact lives here too, beside the two settings it belongs to.
 * 4. **百分位**：跨玩家的百分位需要伺服器，本地做不到，所以現階段以**你自己的歷史場次**計算
 *    （「超越你自己 X% 的場次」），並由 `LeaderboardRank.percentile` 這個欄位承載 —— 接上
 *    真後端後，同一個欄位改由伺服器回傳真·跨玩家百分位。
 *    **Percentile.** A true cross-player percentile needs a server, so for now it is computed
 *    against **the player's own run history** ("beats X% of your own runs") and carried by
 *    `LeaderboardRank.percentile`. When the server lands, that same field just gets the real
 *    cross-player number.
 * 5. **一局只佔一筆（`runId` upsert）**：一局會在多處被記錄（自然結束、重新開始、分頁被隱藏
 *    或關閉、玩家在發布列按儲存），這些都是**同一局**的不同時間點，不該各留一筆。帶 `runId`
 *    時 `record()` 是 upsert，後記的數值覆蓋先記的。
 *    **One row per run (`runId` upsert).** A run is recorded from several places (natural game
 *    over, restart, the page being hidden or closed, save pressed in the publish bar) — all the
 *    same run at different moments, and none should leave its own row. With a `runId`, `record()`
 *    upserts, so a later recording overwrites an earlier one.
 * 6. **命名時認領無名紀錄**：名稱是在榜上才問的，先前記下的場次是無名的；`setDisplayName()`
 *    把那些空名的紀錄歸到新名字下，玩家才看得到「自己的紀錄」。
 *    **Naming claims the nameless.** The name is only asked for on the board, so earlier runs are
 *    nameless; `setDisplayName()` moves those to the new name so the player actually sees his own
 *    records.
 *
 * 只做儲存與排序，不含任何遊戲規則（與 `game/progress.ts` 的分工相同）。
 * Storage and ordering only, no game rules — the same split as `game/progress.ts`.
 */

import { STORAGE_KEYS } from '../core/constants';
import type { ProgressStorage } from './progress';

/** 榜單分類。 */
export type LeaderboardCategory = 'score' | 'combo' | 'merges';

/** 三個分頁的順序與標題（UI 直接用，順序即顯示順序）。 */
export const LEADERBOARD_CATEGORIES: readonly {
  id: LeaderboardCategory;
  label: string;
  /** 該分類的數值要顯示在哪個位置時的短名。 */
  column: string;
}[] = [
  { id: 'score', label: '最高分數', column: '分數' },
  { id: 'combo', label: 'COMBO 數', column: 'COMBO' },
  { id: 'merges', label: '合成數', column: '合成' },
];

/**
 * 榜上顯示的名次數（使用者定案：Top 100）。
 * Rows shown on the board (the user's decision: Top 100).
 */
export const LEADERBOARD_LIMIT = 100;

/** 一筆紀錄。 */
export interface LeaderboardEntry {
  /** 穩定識別碼，供 UI 標記「你自己那筆」。 */
  id: string;
  /** 記錄當下的顯示名；未設定時為空字串。 */
  name: string;
  score: number;
  /** 這一局爬到過的最高連擊數。 */
  maxCombo: number;
  /** 這一局累計合成次數。 */
  merges: number;
  /** 這一局結束的時刻（epoch ms）。 */
  at: number;
}

/** 一局要送進榜單的成績。 */
export interface LeaderboardRun {
  score: number;
  maxCombo: number;
  merges: number;
  /** 覆寫時間戳；未提供時用時鐘。測試用。 */
  at?: number;
  /**
   * 這一局的穩定識別碼。提供時 `record()` 是 **upsert** —— 同一局再記一次會更新同一筆，
   * 而不是多出一筆；未提供時每次呼叫都新增一筆（純粹的「一局一筆」）。
   * A stable id for this run. When given, `record()` **upserts**: recording the same run again
   * updates that one entry instead of adding another. Without it every call appends a new entry.
   *
   * 需要它的理由：一局不只在一處被記錄（自然結束、按重新開始、關分頁／切到背景、以及玩家
   * 在發布列按下儲存的那一刻），逐處去重很容易漏；有了這個 id，同一局怎麼記都只會是一筆，
   * 而且每次記都把最新的成績寫進去。
   * It exists because a run is recorded from several places (a natural game over, a restart, the
   * page being hidden/closed, and the moment the player presses save in the publish bar), and
   * de-duplicating at every call site is easy to get wrong. With the id, a run is one row no
   * matter how often it is recorded, and each recording just writes the latest numbers.
   */
  runId?: string;
}

/** 某一分類下，玩家自己那筆的排名資訊。 */
export interface LeaderboardRank {
  /** 1 起算的名次。 */
  rank: number;
  entry: LeaderboardEntry;
  /**
   * 百分位 `0..100`：這一筆超越了「所有已記錄場次」中的百分之多少。
   * Percentile `0..100`: the share of **all recorded runs** this entry beats.
   *
   * 只計**嚴格低於**自己的場次，所以最高的一筆永遠不會是 100（它沒有超越自己）。
   * Only strictly-lower runs count, so the top run never reads 100 — it does not beat itself.
   */
  percentile: number;
  /** 百分位的分母（＝已記錄且已同意分享的場次數）。 */
  total: number;
}

/** 讀取某一分類的結果。 */
export interface LeaderboardSnapshot {
  category: LeaderboardCategory;
  /** 該分類的前 N 名（已依分類排序）。 */
  entries: readonly LeaderboardEntry[];
  /** 玩家自己在該分類的最佳一筆；榜為空時是 `null`。 */
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
   * 實作應把先前**沒有名字**的紀錄一併歸到這個名字下：玩家是先玩、後命名（發布列是在排行榜
   * 彈窗裡才問名稱的），那些在他命名之前記下的場次本來是無名的，命名後他會預期看到「自己的
   * 紀錄」。已經有名字的紀錄不動 —— 那是他在那個名字下跑出來的成績。
   * An implementation should claim previously **unnamed** records for this name: the player plays
   * first and names themselves later (the publish bar lives in the leaderboard popup), so runs
   * recorded before naming are nameless, and he expects to see "his own records" once he names
   * himself. Records that already carry a name are left alone.
   */
  setDisplayName(name: string): void;
  /** 是否同意分享成績上榜（全域開關）。 */
  readonly sharing: boolean;
  /** 切換分享意願。 */
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
   * 記錄一局。每局都記（使用者定案），與是否同意分享無關；帶 `runId` 時是 upsert（同一局
   * 只會有一筆，重複記錄更新數值）。
   * Record a run. Every run is recorded (the user's decision) regardless of sharing; with a
   * `runId` this upserts, so a run stays a single row whose numbers get updated.
   */
  record(run: LeaderboardRun): void;
  /** 讀取某一分類的前 N 名與自己的名次。 */
  snapshot(category: LeaderboardCategory, limit?: number): LeaderboardSnapshot;
  /** 訂閱變更（記錄、改名、切換分享）；回傳取消訂閱的函式。 */
  subscribe(listener: () => void): () => void;
}

export interface LocalLeaderboardOptions {
  /** 注入儲存體；未提供時用 `localStorage`，不可用時退回記憶體。 */
  storage?: ProgressStorage | null;
  /** 覆寫儲存鍵；測試用。 */
  keys?: { entries?: string; name?: string; sharing?: string; prompt?: string };
  /** 顯示名次數；預設 `LEADERBOARD_LIMIT`。 */
  limit?: number;
  /** 時鐘；測試用。 */
  now?: () => number;
  /** 產生紀錄 id；測試用。 */
  idFactory?: () => string;
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
  const score = toCount(candidate['score']);
  const maxCombo = toCount(candidate['maxCombo']);
  const merges = toCount(candidate['merges']);
  const at = toCount(candidate['at']);

  if (score === null || maxCombo === null || merges === null || at === null) return null;

  const id = typeof candidate['id'] === 'string' ? candidate['id'] : '';
  const name = typeof candidate['name'] === 'string' ? candidate['name'] : '';

  return { id, name, score, maxCombo, merges, at };
}

/** 解析存下來的紀錄陣列；壞掉一律當作空的。 */
function parseEntries(text: string | null): LeaderboardEntry[] {
  if (text === null) return [];

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    const entries: LeaderboardEntry[] = [];
    for (const raw of parsed) {
      const entry = parseEntry(raw);
      if (entry !== null) entries.push(entry);
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * 保留每個分類各自的 Top `limit` 聯集。
 * Keep the union of each category's own top `limit`.
 *
 * 這是「三個分頁都要正確」的最小代價：只存分數的前十名，COMBO 分頁就永遠看不到那些
 * 「分數不高但連擊很長」的場次。
 * This is the least storage that keeps all three tabs correct: keeping only the score top ten
 * would hide every high-combo, low-score run from the COMBO tab forever.
 */
function capEntries(entries: readonly LeaderboardEntry[], limit: number): LeaderboardEntry[] {
  const kept = new Map<string, LeaderboardEntry>();

  for (const category of LEADERBOARD_CATEGORIES) {
    const top = [...entries].sort((a, b) => compareBy(category.id, a, b)).slice(0, limit);
    for (const entry of top) kept.set(entry.id, entry);
  }

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

export function createLocalLeaderboard(options: LocalLeaderboardOptions = {}): LeaderboardSource {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const limit = Math.max(1, Math.trunc(options.limit ?? LEADERBOARD_LIMIT));
  const now = options.now ?? ((): number => Date.now());
  const idFactory =
    options.idFactory ??
    ((): string => {
      const uuid = globalThis.crypto?.randomUUID;
      return typeof uuid === 'function'
        ? uuid.call(globalThis.crypto)
        : `${String(now())}-${Math.random().toString(36).slice(2, 10)}`;
    });

  const entriesKey = options.keys?.entries ?? STORAGE_KEYS.leaderboard;
  const nameKey = options.keys?.name ?? STORAGE_KEYS.playerName;
  const sharingKey = options.keys?.sharing ?? STORAGE_KEYS.shareScore;
  const promptKey = options.keys?.prompt ?? STORAGE_KEYS.publishPrompt;

  let entries = storage === null ? [] : parseEntries(readItem(storage, entriesKey));
  let displayName = storage === null ? '' : (readItem(storage, nameKey) ?? '');
  let sharing = storage === null ? false : readItem(storage, sharingKey) === 'true';
  let publishPromptDone = storage === null ? false : readItem(storage, promptKey) === 'true';

  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    get displayName(): string {
      return displayName;
    },

    setDisplayName(name: string): void {
      displayName = name;
      if (storage !== null) writeItem(storage, nameKey, name);

      /*
       * 認領先前「未命名」的紀錄。
       * Claim the previously unnamed records.
       *
       * 發布列是在排行榜彈窗裡才問名稱的，所以玩家多半先玩了好幾局、之後才命名 —— 那些場次
       * 記下時 `displayName` 還是空字串。命名之後若不去認領，他會在榜上看到一堆「（未命名）」
       * 而以為「自己的紀錄不見了」。只認領空名的，有名字的不動。
       * The publish bar asks for a name inside the leaderboard popup, so the player usually plays
       * several runs before naming himself — those entries were stored while `displayName` was an
       * empty string. Without claiming them he would see a board full of "（未命名）" and conclude
       * his records are missing. Only empty names are claimed; named entries are left untouched.
       */
      if (name !== '' && entries.some((entry) => entry.name === '')) {
        entries = entries.map((entry) => (entry.name === '' ? { ...entry, name } : entry));
        if (storage !== null) writeItem(storage, entriesKey, JSON.stringify(entries));
      }

      notify();
    },

    get sharing(): boolean {
      return sharing;
    },

    setSharing(on: boolean): void {
      sharing = on;
      if (storage !== null) writeItem(storage, sharingKey, on ? 'true' : 'false');
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

    record(run: LeaderboardRun): void {
      /*
       * 同一局用 `runId` upsert，沒有 id 才新增一筆。數值一律以**這一次**為準 —— 一局可能
       * 先被記成中途的成績（背景分頁、按儲存），之後再被記成最終成績，後者要蓋掉前者。
       * With a `runId` the same run upserts; only a run without an id appends. The numbers always
       * come from *this* call: a run may first be recorded mid-way (tab hidden, save pressed) and
       * later with its final score, and the later recording must win.
       */
      const fields = {
        name: displayName,
        score: toCount(run.score) ?? 0,
        maxCombo: toCount(run.maxCombo) ?? 0,
        merges: toCount(run.merges) ?? 0,
        at: toCount(run.at) ?? now(),
      };

      const id = run.runId ?? idFactory();
      const index = run.runId === undefined ? -1 : entries.findIndex((entry) => entry.id === id);

      const updated =
        index >= 0
          ? entries.map((entry, at) => (at === index ? { ...entry, ...fields } : entry))
          : [...entries, { id, ...fields }];

      entries = capEntries(updated, limit);
      if (storage !== null) writeItem(storage, entriesKey, JSON.stringify(entries));
      notify();
    },

    snapshot(category: LeaderboardCategory, requested?: number): LeaderboardSnapshot {
      const take = Math.max(1, Math.trunc(requested ?? limit));

      /*
       * 同意分享之前不上榜（使用者定案）：紀錄照記，但榜是空的，同意後一併現身。
       * Nothing appears until sharing is on (the user's decision): runs are still recorded,
       * the board just reads empty, and turning sharing on reveals them all at once.
       */
      const visible = sharing ? entries : [];
      const sorted = [...visible].sort((a, b) => compareBy(category, a, b));
      const top = sorted.slice(0, take);

      const best = sorted[0];
      if (best === undefined) return { category, entries: top, self: null };

      const total = sorted.length;
      const below = sorted.filter((entry) => valueOf(entry, category) < valueOf(best, category)).length;

      return {
        category,
        entries: top,
        self: {
          rank: 1,
          entry: best,
          percentile: Math.round((below / total) * 100),
          total,
        },
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
