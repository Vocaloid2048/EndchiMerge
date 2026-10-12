/**
 * 本地儲存層的單元測試。
 * Unit tests for the local storage layer.
 *
 * 最重要的一條不是「讀得回寫進去的東西」——那是常識——而是**只有解鎖、沒有刷新分數時，上載
 * 仍然是待辦**。在 M7-3 之前這件事答不出來：唯一的版本標記長在排行榜的本機紀錄裡，而解鎖是
 * 另一個模組的事。這一條守住「統一 revision」到底有沒有兌現。
 * The important one is not "reads back what it wrote" — that is table stakes — but that **an
 * unlock with no new high score still leaves an upload pending**. Before M7-3 that question had no
 * answer: the only version marker lived on the leaderboard's local record, while unlocking belongs
 * to another module. This test is what holds "one revision" to its word.
 *
 * 環境是 node，所以儲存體一律是注入的替身；`localStorage` 從頭到尾不參與。
 * The environment is node, so the backend is always an injected fake; `localStorage` never
 * appears.
 */

import { describe, expect, it } from 'vitest';
import { createLocalStore, type StorageBackend } from '../src/game/localStore';
import { createLocalLeaderboard } from '../src/game/leaderboard';
import { createProgressStore } from '../src/game/progress';
import { STORAGE_KEYS } from '../src/core/constants';

const TEST_SALT = 'test-salt';

/** 一個可以選擇「一存取就拋錯」的假儲存體，用來驗證壞掉的儲存體不會拖垮遊戲。 */
class FakeStorage implements StorageBackend {
  private readonly cells = new Map<string, string>();

  /** 開啟後 get/set 都拋錯 —— 模擬無痕模式或配額爆掉。 */
  broken = false;

  getItem(key: string): string | null {
    if (this.broken) throw new Error('blocked');
    return this.cells.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.broken) throw new Error('quota');
    this.cells.set(key, value);
  }

  removeItem(key: string): void {
    if (this.broken) throw new Error('blocked');
    this.cells.delete(key);
  }

  /** 直接看某個鍵的原始內容（測試用來確認「沒寫進去」）。 */
  peek(key: string): string | null {
    return this.cells.get(key) ?? null;
  }
}

describe('createLocalStore — 讀寫 / reading and writing', () => {
  it('reads back what it wrote, and reads bad data as null', () => {
    const storage = new FakeStorage();
    const store = createLocalStore({ storage });

    store.writeJson('a', { n: 1 });
    expect(store.readJson<{ n: number }>('a')).toEqual({ n: 1 });

    /* 壞資料回 null，而不是拋錯 —— 存檔壞掉不該讓遊戲起不來。 */
    storage.setItem('a', '{not json');
    expect(store.readJson('a')).toBeNull();
  });

  it('serialises before writing, so a value that cannot be serialised writes nothing', () => {
    const storage = new FakeStorage();
    const store = createLocalStore({ storage, syncedKeys: ['a'] });

    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    store.writeJson('a', circular);

    expect(storage.peek('a')).toBeNull();
    /* 沒有寫成功就不算一次變更。 */
    expect(store.revision).toBe(0);
  });

  it('falls back to memory when there is no persistent backend', () => {
    const store = createLocalStore({ storage: null });

    expect(store.persistent).toBe(false);

    store.write('a', '1');
    expect(store.read('a')).toBe('1');
    /* 版本照樣運作，只是關掉頁面就沒了。 */
    expect(store.revision).toBe(0);
  });

  it('survives a storage backend that throws on every access', () => {
    const storage = new FakeStorage();
    storage.broken = true;
    const store = createLocalStore({ storage });

    expect(store.read('a')).toBeNull();
    expect((): void => store.write('a', '1')).not.toThrow();
    expect(store.revision).toBe(0);
    expect(store.persistent).toBe(true);
  });
});

describe('createLocalStore — 版本 / the revision', () => {
  it('counts only the keys that sync', () => {
    const store = createLocalStore({ storage: new FakeStorage(), syncedKeys: ['synced'] });

    store.write('local-only', 'x');
    expect(store.revision).toBe(0);

    store.write('synced', 'x');
    expect(store.revision).toBe(1);
  });

  it('reports a pending upload until it is marked, and persists that across instances', () => {
    const storage = new FakeStorage();
    const first = createLocalStore({ storage, syncedKeys: ['a'] });

    expect(first.hasPendingUpload()).toBe(false);

    first.write('a', '1');
    expect(first.hasPendingUpload()).toBe(true);

    first.markUploaded();
    expect(first.hasPendingUpload()).toBe(false);

    /* 下一個實例（＝重新開頁）也認得這個狀態。 */
    const second = createLocalStore({ storage, syncedKeys: ['a'] });
    expect(second.revision).toBe(second.uploaded);
    expect(second.hasPendingUpload()).toBe(false);

    second.write('a', '2');
    expect(second.hasPendingUpload()).toBe(true);
  });

  it('clamps an uploaded count that claims to be ahead of the revision', () => {
    const storage = new FakeStorage();
    /* 手改存檔：`uploaded` 大於 `revision` 會讓「有待上載」永遠不成立，讀取時就壓平。 */
    storage.setItem(STORAGE_KEYS.revision, JSON.stringify({ revision: 1, uploaded: 99 }));

    const store = createLocalStore({ storage, syncedKeys: ['a'] });

    expect(store.uploaded).toBe(1);
    expect(store.hasPendingUpload()).toBe(false);
  });
});

describe('createLocalStore — 匯出與套用 / export and apply', () => {
  it('exports only the synced keys, as raw strings', () => {
    const store = createLocalStore({ storage: new FakeStorage(), syncedKeys: ['a', 'b'] });

    store.write('a', '{"n":1}');
    store.write('local-only', 'x');
    store.write('b', 'true');

    expect(store.export()).toEqual({ revision: 2, data: { a: '{"n":1}', b: 'true' } });
  });

  it('treats applied values as one more local change', () => {
    const store = createLocalStore({ storage: new FakeStorage(), syncedKeys: ['a'] });

    store.markUploaded();
    store.apply({ a: 'merged' });

    expect(store.read('a')).toBe('merged');
    /* 合併結果也要被推出去，否則下一次同步會以為沒事可做。 */
    expect(store.hasPendingUpload()).toBe(true);
  });
});

describe('createLocalStore — 與其他模組合體 / with the other modules', () => {
  it('leaves an upload pending when an unlock is the only thing that changed', () => {
    const store = createLocalStore({ storage: new FakeStorage() });
    const progress = createProgressStore({ baseline: [1], store });
    const board = createLocalLeaderboard({
      store,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
    });

    board.setSharing(true);
    /* 全新存檔：還沒有任何要送的東西。 */
    expect(board.sync()).toBe(false);

    expect(progress.unlock(2)).toBe(true);
    expect(store.hasPendingUpload()).toBe(true);

    /* 這一條以前永遠是 false：解鎖不會動到排行榜紀錄的版本。 */
    expect(board.sync()).toBe(true);
  });

  it('does not re-upload after a sync until something changes again', () => {
    const store = createLocalStore({ storage: new FakeStorage() });
    const board = createLocalLeaderboard({ store, salt: TEST_SALT, playerId: 'me', now: () => 5 });

    board.setSharing(true);
    board.record({ score: 500, maxCombo: 1, merges: 1 });

    expect(board.sync()).toBe(true);
    expect(board.sync()).toBe(false);

    board.record({ score: 900, maxCombo: 1, merges: 1 });
    expect(board.sync()).toBe(true);
  });
});
