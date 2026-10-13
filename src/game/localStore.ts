/**
 * 統一的本地儲存層：儲存體解析、安全讀寫，與只計「要同步的鍵」的單一 `revision`。
 * The single local storage layer: backend resolution, safe read/write, and one `revision` counting only the synced keys.
 */

import { STORAGE_KEYS } from '../core/constants';

/**
 * 儲存體的最小介面；`localStorage` 在結構上已滿足，`removeItem` 選填（測試常餵只有 get/set 的假物件）。
 * The least a storage backend must offer; `localStorage` satisfies it structurally, and `removeItem` is optional (tests inject get/set-only fakes).
 */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * 會被上載到伺服器的鍵；寫入這些鍵才會推進 `revision`。
 * The keys uploaded to the server; writing one advances `revision`.
 */
export const SYNCED_STORAGE_KEYS: readonly string[] = [
  STORAGE_KEYS.profile,
  STORAGE_KEYS.unlocks,
  STORAGE_KEYS.highScore,
];

/**
 * 要上載的東西，一次交出；`data` 是原始字串，解析是同步層的事。
 * Everything to upload in one piece; `data` holds raw strings — interpreting them is the sync layer's call.
 */
export interface LocalSnapshot {
  revision: number;
  data: Record<string, string>;
}

export interface LocalStoreOptions {
  /**
   * 注入儲存體：`undefined` ＝ 用 `localStorage`，`null` ＝ 明確只用記憶體。
   * Inject a backend: `undefined` means `localStorage`; `null` means explicitly memory-only.
   */
  storage?: StorageBackend | null;
  /**
   * 覆寫「要同步的鍵」名單；測試用。
   * Overrides the synced-key list (tests).
   */
  syncedKeys?: readonly string[];
  /**
   * 覆寫版本鍵；測試用。
   * Overrides the revision key (tests).
   */
  revisionKey?: string;
}

export interface LocalStore {
  /**
   * 是否真的寫進了持久化儲存體（`false` ＝ 只用記憶體）。
   * Whether writes reach persistent storage (`false` ＝ memory only).
   */
  readonly persistent: boolean;
  /**
   * 本地變更計數；只算要同步的鍵。
   * The local change counter; synced keys only.
   */
  readonly revision: number;
  /**
   * 最後一次成功上載時的 `revision`。
   * The `revision` as of the last successful upload.
   */
  readonly uploaded: number;
  read(key: string): string | null;
  /**
   * 讀並解析 JSON；壞掉回 `null`。
   * Reads and parses JSON; returns `null` when corrupt.
   */
  readJson<T>(key: string): T | null;
  write(key: string, value: string): void;
  /**
   * 寫一個 JSON 值；先序列化再寫。
   * Writes a JSON value, serialising before writing.
   */
  writeJson(key: string, value: unknown): void;
  remove(key: string): void;
  /**
   * 有沒有還沒上載的變更。
   * Whether any change is still pending upload.
   */
  hasPendingUpload(): boolean;
  /**
   * 記下「現在的 `revision` 已經上載過了」；不會推進 `revision`。
   * Marks the current `revision` as uploaded; it never advances `revision`.
   */
  markUploaded(): void;
  /**
   * 匯出所有要同步的鍵（原始字串）與版本。
   * Exports the synced keys (raw strings) plus the revision.
   */
  export(): LocalSnapshot;
  /**
   * 套用一批（通常是伺服器合併後的）值。
   * Applies a batch of (usually server-merged) values.
   */
  apply(data: Record<string, string>): void;
  /**
   * 訂閱變更（任何一次成功寫入）；回傳取消訂閱的函式。
   * Subscribes to every successful write; returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * 記憶體後備：`localStorage` 不可用時仍讓整個 session 內讀得到自己寫的東西。
 * The memory fallback: when `localStorage` is unavailable, writes stay readable within the session.
 */
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

/**
 * 瀏覽器的 `localStorage`；不可用時回 `null`（某些設定下光是存取就拋錯）。
 * The browser's `localStorage`; `null` when unavailable (mere access can throw in some settings).
 */
function browserStorage(): StorageBackend | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 解析存下來的版本計數；壞掉回 `null`，由呼叫端決定退路。
 * Parses the saved revision counters; `null` when corrupt, leaving the fallback to the caller.
 */
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
   * 版本以記憶體的值為準，寫檔只是盡力而為：配額爆掉時若「寫成功才更新」，
   * 待上載標記會在這個 session 消失，比寫不進檔案更糟。
   * The in-memory value is authoritative and persistence is best-effort: updating only after a
   * successful write would lose the pending marker for the whole session on a quota error.
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
      /* 寫不進去只是這次的變更沒保存，玩法本身不受影響。 */
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
       * 先序列化再寫：`JSON.stringify` 對循環引用是拋錯而不是回 `undefined`，兩種都要接住，
       * 序列化失敗就整筆不寫，絕不留下半份 JSON。
       * Serialise before writing: `JSON.stringify` throws on circular values rather than returning
       * `undefined`, so both cases are caught — a failure writes nothing, never half a document.
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
