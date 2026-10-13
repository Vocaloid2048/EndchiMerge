/**
 * 本地儲存層的單元測試：解鎖（無新分數）也必須留下待上載。
 * Unit tests for the local storage layer: an unlock alone must still leave an upload pending.
 */

import { describe, expect, it } from 'vitest';
import { createLocalStore, type StorageBackend } from '../src/game/localStore';
import { createLocalLeaderboard } from '../src/game/leaderboard';
import { createProgressStore } from '../src/game/progress';
import { STORAGE_KEYS } from '../src/core/constants';

const TEST_SALT = 'test-salt';

class FakeStorage implements StorageBackend {
  private readonly cells = new Map<string, string>();

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
    expect(store.revision).toBe(0);
  });

  it('falls back to memory when there is no persistent backend', () => {
    const store = createLocalStore({ storage: null });

    expect(store.persistent).toBe(false);

    store.write('a', '1');
    expect(store.read('a')).toBe('1');
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

    const second = createLocalStore({ storage, syncedKeys: ['a'] });
    expect(second.revision).toBe(second.uploaded);
    expect(second.hasPendingUpload()).toBe(false);

    second.write('a', '2');
    expect(second.hasPendingUpload()).toBe(true);
  });

  it('clamps an uploaded count that claims to be ahead of the revision', () => {
    const storage = new FakeStorage();
    /*
     * 手改存檔令 `uploaded > revision`；不壓平的話「有待上載」會永遠不成立。
     * A hand-edited save with `uploaded > revision`; without flattening, "pending upload" is never true.
     */
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
    expect(board.sync()).toBe(false);

    expect(progress.unlock(2)).toBe(true);
    expect(store.hasPendingUpload()).toBe(true);

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
