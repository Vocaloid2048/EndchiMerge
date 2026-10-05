/**
 * 本地進度（解鎖 ＋ 最高分）的單元測試。
 * Unit tests for local progress (unlocks and high score).
 *
 * 這裡用一個注入的假儲存體，所以不必碰 `localStorage`，也就測得到「壞掉的存檔」這種在
 * 真實瀏覽器裡很難重現的情況 —— 而那正是這個模組最需要防守的地方。
 * A fake injected storage means `localStorage` is never touched, which makes "a corrupt save"
 * testable — and that is exactly what this module exists to defend against.
 */

import { describe, expect, it } from 'vitest';
import { createProgressStore, type ProgressStorage } from '../src/game/progress';

/** 記憶體版的儲存體；可設定在寫入時拋錯，模擬無痕模式。 */
class FakeStorage implements ProgressStorage {
  private readonly map = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('quota exceeded');
    this.map.set(key, value);
  }

  /** 直接塞值，用來偽造壞掉的存檔。 */
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('createProgressStore — 解鎖 / unlocks', () => {
  it('always treats the baseline level as unlocked', () => {
    const store = createProgressStore({ baseline: [1], storage: null });

    expect(store.has(1)).toBe(true);
    expect(store.has(2)).toBe(false);
  });

  it('reports whether an unlock was new', () => {
    const store = createProgressStore({ storage: null });

    expect(store.unlock(3)).toBe(true);
    expect(store.unlock(3)).toBe(false);
  });

  it('ignores nonsense level ids', () => {
    const store = createProgressStore({ storage: null });

    expect(store.unlock(0)).toBe(false);
    expect(store.unlock(-2)).toBe(false);
    expect(store.unlock(1.5)).toBe(false);
  });

  it('persists unlocks and loads them back', () => {
    const storage = new FakeStorage();
    const first = createProgressStore({ baseline: [1], storage });
    first.unlock(4);

    const second = createProgressStore({ baseline: [1], storage });

    expect(second.has(4)).toBe(true);
    expect([...second.unlocked].sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it('survives a corrupt save instead of throwing', () => {
    const storage = new FakeStorage();
    storage.seed('endchimerge:unlocks', '{ not json');

    const store = createProgressStore({ baseline: [1], storage });

    expect(store.has(1)).toBe(true);
    expect(store.unlocked.size).toBe(1);
  });

  it('ignores a save that is not an array', () => {
    const storage = new FakeStorage();
    storage.seed('endchimerge:unlocks', '{"a":1}');

    const store = createProgressStore({ baseline: [1], storage });

    expect(store.unlocked.size).toBe(1);
  });

  it('drops non-integer entries from a save', () => {
    const storage = new FakeStorage();
    storage.seed('endchimerge:unlocks', '[1, 2, "x", 0, null, 3.5, 5]');

    const store = createProgressStore({ baseline: [], storage });

    expect([...store.unlocked].sort((a, b) => a - b)).toEqual([1, 2, 5]);
  });

  it('keeps working when the storage refuses to write', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;

    const store = createProgressStore({ storage });

    expect(() => store.unlock(2)).not.toThrow();
    expect(store.has(2)).toBe(true);
  });

  it('notifies listeners only on a real unlock', () => {
    const store = createProgressStore({ storage: null });
    let calls = 0;
    store.onChange((): void => {
      calls += 1;
    });

    store.unlock(2);
    store.unlock(2);

    expect(calls).toBe(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createProgressStore({ storage: null });
    let calls = 0;
    const off = store.onChange((): void => {
      calls += 1;
    });

    off();
    store.unlock(2);

    expect(calls).toBe(0);
  });
});

describe('createProgressStore — 最高分 / high score', () => {
  it('records a new best and ignores a lower score', () => {
    const store = createProgressStore({ storage: null });

    expect(store.recordScore(120)).toBe(120);
    expect(store.recordScore(50)).toBe(120);
    expect(store.highScore).toBe(120);
  });

  it('persists the high score across loads', () => {
    const storage = new FakeStorage();
    createProgressStore({ storage }).recordScore(999);

    const reloaded = createProgressStore({ storage });

    expect(reloaded.highScore).toBe(999);
  });

  it('treats a corrupt high score as zero', () => {
    const storage = new FakeStorage();
    storage.seed('endchimerge:high-score', 'NaN');

    expect(createProgressStore({ storage }).highScore).toBe(0);
  });

  it('floors a fractional score', () => {
    const store = createProgressStore({ storage: null });

    expect(store.recordScore(12.9)).toBe(12);
  });
});
