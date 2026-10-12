/**
 * 統一的本地儲存層。
 * The single local storage layer.
 *
 * 這一支是 M7 的地基。在它出現之前，`progress.ts`、`preferences.ts`、`leaderboard.ts` 各自
 * 複製了一份「取得儲存體」與 try/catch 的讀寫函式，而「有沒有東西要上載」只有排行榜的 profile
 * 答得出來 —— **解鎖了新角色卻沒刷新分數時，那個更新沒有任何版本標記可以代表它**，於是永遠
 * 不會被推上伺服器。
 * This is M7's foundation. Before it existed, `progress.ts`, `preferences.ts` and
 * `leaderboard.ts` each carried their own copy of "get the storage backend" and of the try/catch
 * read/write helpers, and only the leaderboard profile could answer "is there anything to
 * upload" — **an unlock with no new high score had no version marker to represent it**, so it
 * would never reach the server.
 *
 * 三件事收攏在這裡 / Three things are centralised here:
 *
 * 1. **取得儲存體**：注入值 → `localStorage` → 記憶體。`localStorage` 在無痕模式或關閉 cookie
 *    時**光是存取就拋錯**，所以「不可用」是常態而不是例外；三處各寫一次就會有三種行為。
 *    **Backend resolution**: injected → `localStorage` → memory, because `localStorage` can
 *    throw on mere access, and three copies of that decision is three different behaviours.
 * 2. **安全讀寫**：讀到壞資料回 `null`、寫不進去吞掉錯誤。存檔壞掉不該讓遊戲崩掉，這是硬性
 *    要求，不是防禦性程式設計的潔癖。
 *    **Safe read/write**: bad data reads as `null` and a failed write is swallowed — a corrupt
 *    save must not take the game down.
 * 3. **單一 `revision`**：涵蓋**所有要同步的鍵**，所以「有沒有東西沒上載」是一次整數比較。
 *    同步器因此不必知道本機有幾個鍵、也不必逐一去問每個模組 —— 那正是它最容易與本機實作
 *    綁死的地方。
 *    **One `revision`** covering **every key that syncs**, so "anything pending?" is a single
 *    integer comparison. The sync layer therefore never enumerates keys nor interrogates each
 *    module — which is exactly where it would otherwise couple itself to the local layout.
 *
 * **`revision` 只計算「要同步的鍵」。** 語系、榜面快取、「問過發布意願了沒」寫下去**不會**推進
 * 它 —— 否則改一次語言就會觸發一次空轉上載。
 * **`revision` counts only the keys that sync.** Writing the locale, the board cache or "we have
 * already asked about publishing" does **not** advance it; otherwise changing the language once
 * would trigger a pointless upload.
 *
 * **關於「原子寫入」要說清楚**：`localStorage` 沒有交易，所以跨鍵的原子性做不到。這裡的做法是
 * ①**先序列化再寫**（`JSON.stringify` 拋錯就整筆不寫，不會留下半份 JSON）②**每個邏輯單位只佔
 * 一個鍵**。`revision` 是另一支鍵，因此最壞情況是「值寫成了、版本沒寫成」——資料不會遺失
 * （下一次寫入會把版本帶過頭），只是那一筆得等下一輪才上載。
 * **On "atomic writes", plainly**: `localStorage` has no transactions, so cross-key atomicity is
 * not achievable. What this does instead is (1) **serialise before writing**, so a `JSON.stringify`
 * failure leaves nothing behind rather than half a JSON document, and (2) keep **each logical unit
 * in one key**. The revision lives in its own key, so the worst case is "value stored, version not"
 * — nothing is lost (the next write carries the revision past it), that entry just waits a round.
 */

import { STORAGE_KEYS } from '../core/constants';

/**
 * 儲存體的最小介面；`localStorage` 在結構上已滿足。
 * The least a storage backend must offer; `localStorage` satisfies it structurally.
 *
 * `removeItem` 是選填的：測試常餵一個只有 get/set 的假物件，而這一層從不「非刪不可」。
 * `removeItem` is optional: tests routinely inject a get/set-only fake, and nothing here *needs*
 * to delete.
 */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * 會被上載到伺服器的鍵。寫入這些鍵才會推進 `revision`。
 * The keys that get uploaded to the server; writing one of these advances `revision`.
 *
 * 名單刻意放在這裡而不是散在各模組：**「什麼要同步」是一個決定，不是三個。**
 * The list lives here rather than in each module because **"what syncs" is one decision, not
 * three**.
 */
export const SYNCED_STORAGE_KEYS: readonly string[] = [
  STORAGE_KEYS.profile,
  STORAGE_KEYS.unlocks,
  STORAGE_KEYS.highScore,
];

/**
 * 要上載的東西，一次交出。
 * Everything to upload, handed over in one piece.
 *
 * `data` 是**原始字串**，刻意不在這裡解析：怎麼解讀是同步器的判斷（解不開的那一筆要回報、
 * 還是跳過），不是儲存層的。儲存層一旦開始理解內容，就會慢慢長出第二套 schema。
 * `data` holds **raw strings** and is deliberately not parsed here: how to interpret them is the
 * sync layer's call (report the unreadable entry, or skip it), not storage's. A storage layer that
 * starts understanding its contents grows a second schema.
 */
export interface LocalSnapshot {
  revision: number;
  data: Record<string, string>;
}

export interface LocalStoreOptions {
  /**
   * 注入儲存體。`undefined` ＝ 用 `localStorage`，`null` ＝ 明確不要持久化（只用記憶體）。
   * 兩者要分開：測試要的是後者，瀏覽器要的是前者。
   * Inject a backend. `undefined` means `localStorage`; `null` means explicitly do not persist.
   * The two must be distinct: tests want the latter, the browser the former.
   */
  storage?: StorageBackend | null;
  /** 覆寫「要同步的鍵」名單；測試用。 */
  syncedKeys?: readonly string[];
  /** 覆寫版本鍵；測試用。 */
  revisionKey?: string;
}

export interface LocalStore {
  /** 是否真的寫進了持久化儲存體（`false` ＝ 只用記憶體）。 */
  readonly persistent: boolean;
  /** 本地變更計數；只算要同步的鍵。 */
  readonly revision: number;
  /** 最後一次成功上載時的 `revision`。 */
  readonly uploaded: number;
  /** 讀原始字串；讀不到或儲存體拋錯都回 `null`。 */
  read(key: string): string | null;
  /** 讀並解析 JSON；壞掉回 `null`（壞資料不該讓整個模組消失）。 */
  readJson<T>(key: string): T | null;
  /** 寫原始字串。 */
  write(key: string, value: string): void;
  /** 寫一個 JSON 值；**先序列化再寫**。 */
  writeJson(key: string, value: unknown): void;
  /** 刪除一個鍵。 */
  remove(key: string): void;
  /** 有沒有還沒上載的變更。 */
  hasPendingUpload(): boolean;
  /** 記下「現在的 `revision` 已經上載過了」；這一步**不會**推進 `revision`。 */
  markUploaded(): void;
  /** 匯出所有要同步的鍵（原始字串）與版本。 */
  export(): LocalSnapshot;
  /** 套用一批（通常是伺服器合併後的）值。 */
  apply(data: Record<string, string>): void;
  /** 訂閱變更（任何一次成功寫入）；回傳取消訂閱的函式。 */
  subscribe(listener: () => void): () => void;
}

/** 記憶體後備：`localStorage` 不可用時仍讓整個 session 內讀得到自己寫的東西。 */
function memoryBackend(): StorageBackend {
  const cells = new Map<string, string>();

  return {
    getItem: (key): string | null => cells.get(key) ?? null,
    setItem: (key, value): void => {
      cells.set(key, value);
    },
    removeItem: (key): void => {
      cells.delete(key);
    },
  };
}

/** 瀏覽器的 `localStorage`；不可用時回 `null`。 */
function browserStorage(): StorageBackend | null {
  try {
    /* 某些設定下光是存取 `localStorage` 就拋錯，所以連讀取都要包起來。 */
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** 解析存下來的版本計數；壞掉回 `null`，由呼叫端決定退路。 */
function parseRevision(text: string | null): { revision: number; uploaded: number } | null {
  if (text === null) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return null;

    const candidate = parsed as Record<string, unknown>;
    const revision = candidate['revision'];
    const uploaded = candidate['uploaded'];
    if (typeof revision !== 'number' || !Number.isFinite(revision) || revision < 0) return null;
    if (typeof uploaded !== 'number' || !Number.isFinite(uploaded) || uploaded < 0) return null;

    return {
      revision: Math.floor(revision),
      /* `uploaded` 不可以超過 `revision`，否則「有待上載的更新」永遠不成立。 */
      uploaded: Math.min(Math.floor(uploaded), Math.floor(revision)),
    };
  } catch {
    return null;
  }
}

export function createLocalStore(options: LocalStoreOptions = {}): LocalStore {
  const resolved = options.storage === undefined ? browserStorage() : options.storage;
  const backend = resolved ?? memoryBackend();
  const revisionKey = options.revisionKey ?? STORAGE_KEYS.revision;
  const synced = new Set(options.syncedKeys ?? SYNCED_STORAGE_KEYS);

  const listeners = new Set<() => void>();

  let revision = 0;
  let uploaded = 0;

  const readRaw = (key: string): string | null => {
    try {
      return backend.getItem(key);
    } catch {
      return null;
    }
  };

  const saved = parseRevision(readRaw(revisionKey));
  if (saved !== null) {
    revision = saved.revision;
    uploaded = saved.uploaded;
  }

  /*
   * 版本以**記憶體的值為準**，寫檔只是盡力而為：配額爆掉時若改用「寫成功才更新」，那一輪的
   * 待上載標記會直接消失在這個 session 裡，反而比寫不進檔案更糟。
   * The in-memory value is authoritative and persistence is best-effort: on a quota error, only
   * updating after a successful write would lose the pending marker for the rest of the session,
   * which is worse than failing to persist it.
   */
  const persistRevision = (): void => {
    try {
      backend.setItem(revisionKey, JSON.stringify({ revision, uploaded }));
    } catch {
      /* 這一次的版本沒存下來；值本身還在，下一次寫入會把版本帶過頭。 */
    }
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const writeRaw = (key: string, value: string): void => {
    try {
      backend.setItem(key, value);
    } catch {
      /* 寫不進去只是這次的變更沒保存，玩法本身不受影響 —— 也就不算一次變更。 */
      return;
    }

    if (synced.has(key)) {
      revision += 1;
      persistRevision();
    }

    notify();
  };

  return {
    get persistent(): boolean {
      return resolved !== null;
    },

    get revision(): number {
      return revision;
    },

    get uploaded(): number {
      return uploaded;
    },

    read(key: string): string | null {
      return readRaw(key);
    },

    readJson<T>(key: string): T | null {
      const text = readRaw(key);
      if (text === null) return null;

      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },

    write(key: string, value: string): void {
      writeRaw(key, value);
    },

    writeJson(key: string, value: unknown): void {
      /*
       * 先序列化再寫：序列化失敗就**整筆不寫**，絕不留下半份 JSON。
       * `JSON.stringify` 對循環引用是**拋錯**而不是回 `undefined`，所以兩種都要接住 ——
       * 只檢查回傳值的話，這一支會在「該安靜地不寫」的時候把整個呼叫端炸掉。
       * Serialise before writing: on failure **write nothing** rather than leave half a JSON
       * document. `JSON.stringify` **throws** on a circular value instead of returning
       * `undefined`, so both cases have to be caught — checking the return value alone would blow
       * up the caller exactly where it should quietly not write.
       */
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        return;
      }

      if (typeof text !== 'string') return;

      writeRaw(key, text);
    },

    remove(key: string): void {
      try {
        backend.removeItem?.(key);
      } catch {
        return;
      }

      if (synced.has(key)) {
        revision += 1;
        persistRevision();
      }

      notify();
    },

    hasPendingUpload(): boolean {
      return revision > uploaded;
    },

    markUploaded(): void {
      if (uploaded === revision) return;

      uploaded = revision;
      persistRevision();
    },

    export(): LocalSnapshot {
      const data: Record<string, string> = {};

      for (const key of synced) {
        const text = readRaw(key);
        if (text !== null) data[key] = text;
      }

      return { revision, data };
    },

    apply(data: Record<string, string>): void {
      const keys = Object.keys(data);
      if (keys.length === 0) return;

      for (const key of keys) writeRaw(key, data[key] as string);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);

      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}
