/**
 * 排行榜資料層與名稱驗證的單元測試。
 * Unit tests for the leaderboard data layer and display-name validation.
 *
 * 這個模組要在沒有伺服器的情況下仍然「像個榜」：三個分類各自排序正確、每局都記、同意之前
 * 不上榜、百分位誠實。以下每條都對應其中一項，用注入的假儲存體，不碰 `localStorage`。
 * The module has to behave like a real board without a server: each of the three categories
 * sorts correctly, every run is recorded, nothing shows before the player opts in, and the
 * percentile is honest. Each test below pins one of those, over an injected fake storage.
 */

import { describe, expect, it } from 'vitest';
import { createLocalLeaderboard, LEADERBOARD_LIMIT } from '../src/game/leaderboard';
import type { ProgressStorage } from '../src/game/progress';
import {
  NAME_MAX_UNITS,
  nameErrorText,
  nameUnits,
  normalizeDisplayName,
  validateDisplayName,
} from '../src/game/playerName';

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

/** 讓 id 可預期，排序斷言才不會被隨機 id 影響。 */
function idSequence(): () => string {
  let next = 0;
  return (): string => {
    next += 1;
    return `e${String(next)}`;
  };
}

/** 驗證失敗的原因；通過時字串 'ok'。讓斷言不必先做型別窄化。 */
function reasonOf(input: string): string {
  const result = validateDisplayName(input);

  return result.ok ? 'ok' : result.reason;
}

describe('validateDisplayName — 名稱規則 / name rules', () => {
  it('applies NFKC so full-width characters fold to half-width', () => {
    expect(normalizeDisplayName('ＡＢＣ１２３')).toBe('ABC123');
    expect(normalizeDisplayName('　阿爺　')).toBe('阿爺');
  });

  it('strips zero-width and control characters', () => {
    expect(normalizeDisplayName('阿\u200B爺')).toBe('阿爺');
    expect(normalizeDisplayName('阿\u0007爺')).toBe('阿爺');
  });

  it('collapses runs of whitespace and trims the ends', () => {
    expect(normalizeDisplayName('  阿   爺  ')).toBe('阿 爺');
  });

  it('rejects an empty name', () => {
    expect(validateDisplayName('   ')).toEqual({ ok: false, reason: 'empty', units: 0 });
  });

  it('rejects characters outside the whitelist', () => {
    expect(validateDisplayName('阿爺😀').ok).toBe(false);
    expect(validateDisplayName('abc@def').ok).toBe(false);
    expect(reasonOf('阿爺🙂')).toBe('charset');
  });

  it('accepts the whitelist itself: CJK, latin, digits, space, _ - .', () => {
    for (const name of ['阿爺', 'Endchi Merge', 'Player_01', 'a-b.c', '團圓大作戰 2026']) {
      expect(validateDisplayName(name).ok, name).toBe(true);
    }
  });

  it('weights CJK at 2 units and everything else at 1', () => {
    expect(nameUnits('阿爺')).toBe(4);
    expect(nameUnits('abc')).toBe(3);
    expect(nameUnits('阿a')).toBe(3);
  });

  it(`caps at ${String(NAME_MAX_UNITS)} units: 16 CJK or 32 latin, not 17`, () => {
    const sixteen = '一'.repeat(16);
    const seventeen = '一'.repeat(17);
    const thirtyTwo = 'a'.repeat(32);
    const thirtyThree = 'a'.repeat(33);

    expect(validateDisplayName(sixteen).ok).toBe(true);
    expect(validateDisplayName(seventeen)).toEqual({
      ok: false,
      reason: 'tooLong',
      units: 34,
    });
    expect(validateDisplayName(thirtyTwo).ok).toBe(true);
    expect(reasonOf(thirtyThree)).toBe('tooLong');
  });

  it('returns the normalised value, not the raw input', () => {
    const result = validateDisplayName('  ＡＢＣ  ');

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe('ABC');
  });

  it('has a message for every failure reason', () => {
    for (const reason of ['empty', 'charset', 'tooLong'] as const) {
      expect(nameErrorText(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('createLocalLeaderboard — 紀錄與排序 / recording and ordering', () => {
  function makeBoard(limit = LEADERBOARD_LIMIT) {
    const storage = new FakeStorage();
    const board = createLocalLeaderboard({
      storage,
      limit,
      idFactory: idSequence(),
      now: (): number => 1_700_000_000_000,
      keys: { entries: 'e', name: 'n', sharing: 's' },
    });

    return { storage, board };
  }

  it('starts empty: nothing is recorded until a run ends', () => {
    const { board } = makeBoard();

    for (const category of ['score', 'combo', 'merges'] as const) {
      expect(board.snapshot(category).entries).toHaveLength(0);
      expect(board.snapshot(category).self).toBeNull();
    }
  });

  it('keeps every run out of the board until sharing is on', () => {
    const { board } = makeBoard();

    board.record({ score: 500, maxCombo: 3, merges: 4 });
    expect(board.snapshot('score').entries).toHaveLength(0);

    board.setSharing(true);
    expect(board.snapshot('score').entries).toHaveLength(1);
  });

  it('sorts each category by its own value, not by score', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 900, maxCombo: 1, merges: 2, at: 1 });
    board.record({ score: 100, maxCombo: 40, merges: 3, at: 2 });
    board.record({ score: 300, maxCombo: 5, merges: 60, at: 3 });

    expect(board.snapshot('score').entries.map((e) => e.score)).toEqual([900, 300, 100]);
    expect(board.snapshot('combo').entries.map((e) => e.maxCombo)).toEqual([40, 5, 1]);
    expect(board.snapshot('merges').entries.map((e) => e.merges)).toEqual([60, 3, 2]);
  });

  it('caps the board at the limit', () => {
    const { board } = makeBoard(3);
    board.setSharing(true);

    for (let i = 1; i <= 8; i += 1) {
      board.record({ score: i * 10, maxCombo: i, merges: i });
    }

    expect(board.snapshot('score').entries).toHaveLength(3);
    expect(board.snapshot('score').entries.map((e) => e.score)).toEqual([80, 70, 60]);
  });

  it('keeps each category\'s top N correct even after many runs', () => {
    /*
     * 這條是「三個分頁都要正確」的核心：儲存時保留的是**每個分類各自前十的聯集**，
     * 所以任何一個分類查出來的 Top N 都必須等於「全部紀錄中該分類的前 N 名」。
     * 若哪天為了省空間改成只留分數前 N，這條會先壞在 COMBO／合成分頁上。
     * The core of "all three tabs must be right": storage keeps the **union of each category's
     * top N**, so any category's snapshot must equal the true top N of every recorded run. If
     * someone trims by score alone to save space, this fails on the COMBO / merges tabs first.
     */
    const limit = 3;
    const { board } = makeBoard(limit);
    board.setSharing(true);

    const runs = [
      { score: 10, maxCombo: 50, merges: 1 },
      { score: 90, maxCombo: 2, merges: 5 },
      { score: 40, maxCombo: 30, merges: 2 },
      { score: 70, maxCombo: 1, merges: 9 },
      { score: 20, maxCombo: 40, merges: 3 },
      { score: 60, maxCombo: 4, merges: 20 },
      { score: 30, maxCombo: 10, merges: 40 },
    ];
    for (const run of runs) board.record(run);

    for (const [category, key] of [
      ['score', 'score'],
      ['combo', 'maxCombo'],
      ['merges', 'merges'],
    ] as const) {
      const expected = runs
        .map((run) => run[key])
        .sort((a, b) => b - a)
        .slice(0, limit);
      const actual = board.snapshot(category).entries.map((entry) => entry[key]);

      expect(actual, category).toEqual(expected);
    }
  });

  it('reports a percentile over the player\'s own runs', () => {
    /*
     * 本地沒有其他玩家，所以百分位是「超越你自己多少 % 的場次」；最高的一筆只計嚴格低於
     * 自己的場次，所以永遠不會是 100。
     * Locally there are no other players, so this is "beats X% of your own runs"; the top run
     * counts only strictly-lower runs and therefore never reads 100.
     */
    const { board } = makeBoard();
    board.setSharing(true);

    for (const score of [10, 20, 30, 40]) board.record({ score, maxCombo: 0, merges: 0 });

    const snapshot = board.snapshot('score');

    expect(snapshot.self?.rank).toBe(1);
    expect(snapshot.self?.entry.score).toBe(40);
    expect(snapshot.self?.total).toBe(4);
    expect(snapshot.self?.percentile).toBe(75);
  });

  it('gives a single recorded run a percentile of 0, not 100', () => {
    const { board } = makeBoard();
    board.setSharing(true);
    board.record({ score: 10, maxCombo: 0, merges: 0 });

    expect(board.snapshot('score').self?.percentile).toBe(0);
  });

  it('defaults the recorded name to whatever is set at the time', () => {
    const { board } = makeBoard();
    board.setSharing(true);
    board.setDisplayName('阿爺');
    board.record({ score: 1, maxCombo: 0, merges: 0 });

    expect(board.snapshot('score').entries[0]?.name).toBe('阿爺');
  });

  it('survives a corrupt save instead of throwing', () => {
    const { storage, board } = makeBoard();
    storage.seed('e', '{ not json');

    expect(board.snapshot('score').entries).toHaveLength(0);

    /* 壞資料之後仍然可以正常記錄。 */
    board.setSharing(true);
    board.record({ score: 5, maxCombo: 0, merges: 0 });
    expect(board.snapshot('score').entries).toHaveLength(1);
  });

  it('round-trips entries, name and sharing through storage', () => {
    const storage = new FakeStorage();
    const keys = { entries: 'e', name: 'n', sharing: 's' };
    const first = createLocalLeaderboard({ storage, keys, now: () => 5, idFactory: idSequence() });
    first.setDisplayName('阿爺');
    first.setSharing(true);
    first.record({ score: 123, maxCombo: 7, merges: 8 });

    const second = createLocalLeaderboard({ storage, keys, now: () => 5 });
    expect(second.displayName).toBe('阿爺');
    expect(second.sharing).toBe(true);
    expect(second.snapshot('combo').entries[0]).toMatchObject({ score: 123, maxCombo: 7, merges: 8 });
  });

  it('falls back to memory when storage is unavailable', () => {
    const board = createLocalLeaderboard({ storage: null });
    board.setDisplayName('阿爺');
    board.setSharing(true);
    board.record({ score: 42, maxCombo: 1, merges: 1 });

    expect(board.displayName).toBe('阿爺');
    expect(board.snapshot('score').entries[0]?.score).toBe(42);
  });

  it('does not crash when the storage refuses to write', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;
    const board = createLocalLeaderboard({ storage, idFactory: idSequence() });
    board.setSharing(true);

    expect(() => board.record({ score: 1, maxCombo: 1, merges: 1 })).not.toThrow();
    expect(board.snapshot('score').entries).toHaveLength(1);
  });

  it('notifies subscribers on record, rename and sharing changes', () => {
    const { board } = makeBoard();
    let calls = 0;
    const unsubscribe = board.subscribe((): void => {
      calls += 1;
    });

    board.setDisplayName('阿爺');
    board.setSharing(true);
    board.record({ score: 1, maxCombo: 1, merges: 1 });
    expect(calls).toBe(3);

    unsubscribe();
    board.record({ score: 2, maxCombo: 2, merges: 2 });
    expect(calls).toBe(3);
  });
});
