/**
 * 排行榜資料層與名稱驗證的單元測試。
 * Unit tests for the leaderboard data layer and display-name validation.
 */

import { describe, expect, it } from 'vitest';
import { seal } from '../src/core/integrity';
import { createLocalLeaderboard, LEADERBOARD_LIMIT } from '../src/game/leaderboard';
import type { LeaderboardEntry } from '../src/game/leaderboard';
import type { StorageBackend } from '../src/game/localStore';
import {
  NAME_MAX_UNITS,
  nameUnits,
  normalizeDisplayName,
  validateDisplayName,
} from '../src/game/playerName';

const TEST_SALT = 'test-salt';

class FakeStorage implements StorageBackend {
  private readonly map = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('quota exceeded');
    this.map.set(key, value);
  }

  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function playerRow(
  id: string,
  score: number,
  maxCombo: number,
  merges: number,
  at = 1,
): LeaderboardEntry {
  return { id, name: id, score, durationMs: 0, maxCombo, merges, at };
}

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
});

function makeBoard(limit = LEADERBOARD_LIMIT, seed?: readonly LeaderboardEntry[]) {
  const storage = new FakeStorage();
  if (seed !== undefined) storage.seed('e', seal(seed, TEST_SALT));

  const board = createLocalLeaderboard({
    storage,
    limit,
    playerId: 'me',
    salt: TEST_SALT,
    now: (): number => 1_700_000_000_000,
    keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
  });

  return { storage, board };
}

describe('createLocalLeaderboard — 一位玩家一筆 / one row per player', () => {
  it('starts empty: nothing is on the board before the first run', () => {
    const { board } = makeBoard();

    expect(board.snapshot('score').entries).toHaveLength(0);
    expect(board.snapshot('score').self).toBeNull();
  });

  it('shows nothing at all until consent is given', () => {
    const { board } = makeBoard();

    board.record({ score: 500, maxCombo: 3, merges: 4 });
    expect(board.snapshot('score').entries).toHaveLength(0);

    board.setSharing(true);
    expect(board.snapshot('score').entries).toHaveLength(1);
  });

  it('folds every run into one row instead of adding one per run', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 100, maxCombo: 1, merges: 1 });
    board.record({ score: 900, maxCombo: 2, merges: 2 });
    board.record({ score: 300, maxCombo: 3, merges: 3 });
    board.sync();

    const entries = board.snapshot('score').entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'me', score: 900, maxCombo: 3, merges: 3 });
  });

  it('never downgrades, and says so', () => {
    const { board } = makeBoard();

    expect(board.record({ score: 900, maxCombo: 40, merges: 60 })).toBe(true);
    expect(board.record({ score: 100, maxCombo: 1, merges: 1 })).toBe(false);
    expect(board.record({ score: 900, maxCombo: 40, merges: 60 })).toBe(false);

    board.setSharing(true);
    expect(board.snapshot('score').entries[0]).toMatchObject({
      score: 900,
      maxCombo: 40,
      merges: 60,
    });
  });

  it('takes the maximum of each of the three values independently', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 900, maxCombo: 1, merges: 2 });
    board.record({ score: 100, maxCombo: 40, merges: 60 });
    board.sync();

    expect(board.snapshot('score').entries[0]).toMatchObject({
      score: 900,
      maxCombo: 40,
      merges: 60,
    });
  });

  it('leaves the timestamp alone when nothing improved', () => {
    let clock = 1_000;
    const storage = new FakeStorage();
    const board = createLocalLeaderboard({
      storage,
      playerId: 'me',
      salt: TEST_SALT,
      now: () => clock,
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });

    board.record({ score: 500, maxCombo: 1, merges: 1 });
    clock = 9_000;
    board.record({ score: 10, maxCombo: 1, merges: 1 });
    board.setSharing(true);

    expect(board.snapshot('score').entries[0]?.at).toBe(1_000);
  });

  it('sorts each category by its own value, not by score', () => {
    const { board } = makeBoard(LEADERBOARD_LIMIT, [
      playerRow('a', 900, 1, 1),
      playerRow('b', 500, 40, 2),
      playerRow('c', 100, 5, 60),
    ]);
    board.setSharing(true);

    expect(board.snapshot('score').entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(board.snapshot('combo').entries.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
    expect(board.snapshot('merges').entries.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('caps the board at the limit', () => {
    const { board } = makeBoard(3, [
      playerRow('a', 10, 1, 1),
      playerRow('b', 20, 1, 1),
      playerRow('c', 30, 1, 1),
      playerRow('d', 40, 1, 1),
    ]);
    board.setSharing(true);

    expect(board.snapshot('score').entries).toHaveLength(3);
    expect(board.snapshot('score').entries.map((entry) => entry.id)).toEqual(['d', 'c', 'b']);
  });

  it(`shows ${String(LEADERBOARD_LIMIT)} rows by default`, () => {
    const many = Array.from({ length: LEADERBOARD_LIMIT + 5 }, (_, index) =>
      playerRow(`p${String(index)}`, index, index, index),
    );
    const { board } = makeBoard(LEADERBOARD_LIMIT, many);
    board.setSharing(true);

    const entries = board.snapshot('score').entries;
    expect(entries).toHaveLength(LEADERBOARD_LIMIT);
    expect(entries[0]?.id).toBe(`p${String(LEADERBOARD_LIMIT + 4)}`);
  });

  it("keeps each category's top N correct even after many players", () => {
    const many = Array.from({ length: 20 }, (_, index) => playerRow(`q${String(index)}`, index, 100 - index, 1));

    const { board } = makeBoard(5, many);
    board.setSharing(true);

    expect(board.snapshot('score').entries.map((entry) => entry.score)).toEqual([19, 18, 17, 16, 15]);
    expect(board.snapshot('combo').entries.map((entry) => entry.maxCombo)).toEqual([
      100, 99, 98, 97, 96,
    ]);
  });

  it("reports the player's own rank and the player count", () => {
    const { board } = makeBoard(LEADERBOARD_LIMIT, [
      playerRow('a', 900, 1, 1),
      playerRow('b', 500, 1, 1),
    ]);
    board.setSharing(true);
    board.record({ score: 600, maxCombo: 1, merges: 1 });
    board.sync();

    const self = board.snapshot('score').self;
    expect(self?.rank).toBe(2);
    expect(self?.total).toBe(3);
    expect(self?.entry.id).toBe('me');
    expect(self?.beats).toBe(33);
  });

  it('keeps the player on the record even at a rank past the listed top', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      playerRow(`q${String(index)}`, 600 - index * 100, 60 - index * 10, 6 - index),
    );

    const { board } = makeBoard(3, many);
    board.setSharing(true);
    board.record({ score: 250, maxCombo: 1, merges: 1 });
    board.sync();

    const snapshot = board.snapshot('score');

    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['q0', 'q1', 'q2']);

    expect(snapshot.self).not.toBeNull();
    expect(snapshot.self?.rank).toBe(4);
    expect(snapshot.self?.total).toBe(4);
    expect(snapshot.self?.beats).toBe(0);
  });

  it('has no self row while the player is not on the board', () => {
    const { board } = makeBoard(LEADERBOARD_LIMIT, [playerRow('a', 900, 1, 1)]);
    board.setSharing(true);

    expect(board.snapshot('score').self).toBeNull();
  });
});

describe('createLocalLeaderboard — 時長跟著分數 / the duration follows the score', () => {
  it('records the duration of the run that set the score', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 100, durationMs: 30_000, maxCombo: 1, merges: 1 });
    board.record({ score: 900, durationMs: 240_000, maxCombo: 2, merges: 2 });
    board.sync();

    expect(board.snapshot('score').entries[0]).toMatchObject({ score: 900, durationMs: 240_000 });
  });

  it('does not let a longer but lower-scoring run overwrite the best run duration', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 900, durationMs: 120_000, maxCombo: 1, merges: 1 });
    board.record({ score: 100, durationMs: 720_000, maxCombo: 40, merges: 60 });
    board.sync();

    expect(board.snapshot('score').entries[0]).toMatchObject({
      score: 900,
      durationMs: 120_000,
      maxCombo: 40,
      merges: 60,
    });
  });

  it('keeps the old duration when a call omits it', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.record({ score: 900, durationMs: 120_000, maxCombo: 1, merges: 1 });
    board.record({ score: 1_200, maxCombo: 2, merges: 2 });
    board.sync();

    expect(board.snapshot('score').entries[0]).toMatchObject({ score: 1_200, durationMs: 120_000 });
  });

  it('tracks a rising score frame by frame, so the stored time is the moment it peaked', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    for (let frame = 1; frame <= 60; frame += 1) {
      board.record({ score: frame * 10, durationMs: frame * 1_000, maxCombo: 1, merges: 1 });
    }
    board.record({ score: 600, durationMs: 120_000, maxCombo: 1, merges: 1 });
    board.sync();

    expect(board.snapshot('score').entries[0]).toMatchObject({ score: 600, durationMs: 60_000 });
  });

  it('carries the duration through a save/load round trip', () => {
    const first = makeBoard();
    first.board.setSharing(true);
    first.board.record({ score: 700, durationMs: 90_000, maxCombo: 1, merges: 1 });
    first.board.sync();

    const second = createLocalLeaderboard({
      storage: first.storage,
      playerId: 'me',
      salt: TEST_SALT,
      now: (): number => 1_700_000_000_000,
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });

    expect(second.snapshot('score').entries[0]).toMatchObject({ score: 700, durationMs: 90_000 });
  });

  it('treats a row saved before the field existed as an unknown duration', () => {
    const legacy = { id: 'me', name: '阿爺', score: 500, maxCombo: 1, merges: 1, at: 1 };
    const { board } = makeBoard(LEADERBOARD_LIMIT, [legacy as unknown as LeaderboardEntry]);

    board.setSharing(true);

    expect(board.snapshot('score').entries[0]).toMatchObject({ score: 500, durationMs: 0 });
  });
});

describe('createLocalLeaderboard — 改名 / renaming', () => {
  it('renames the existing row instead of adding one', () => {
    const { board } = makeBoard();
    board.setSharing(true);

    board.setDisplayName('阿爺');
    board.record({ score: 300, maxCombo: 1, merges: 1 });
    board.sync();

    board.setDisplayName('阿嬤');
    board.sync();

    const entries = board.snapshot('score').entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('阿嬤');
    expect(entries[0]?.score).toBe(300);
  });

  it('keeps the identity, so the record is not orphaned under the old name', () => {
    const storage = new FakeStorage();
    const keys = {
      entries: 'e',
      name: 'n',
      sharing: 's',
      prompt: 'p',
      profile: 'pr',
      device: 'd',
    };

    const first = createLocalLeaderboard({
      storage,
      keys,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
    });
    first.setSharing(true);
    first.setDisplayName('阿爺');
    first.record({ score: 77, maxCombo: 1, merges: 1 });
    first.sync();

    const second = createLocalLeaderboard({ storage, keys, salt: TEST_SALT, now: () => 5 });
    second.setDisplayName('阿嬤');

    const entries = second.snapshot('score').entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'me', name: '阿嬤', score: 77 });
  });

  it('does nothing when the name is unchanged', () => {
    const { board } = makeBoard();
    let calls = 0;
    board.subscribe(() => {
      calls += 1;
    });

    board.setDisplayName('阿爺');
    board.setDisplayName('阿爺');

    expect(calls).toBe(1);
  });
});

describe('createLocalLeaderboard — 上載 / uploading', () => {
  it('does not upload without consent', () => {
    const { storage, board } = makeBoard();

    board.record({ score: 500, maxCombo: 1, merges: 1 });
    expect(board.sync()).toBe(false);
    expect(storage.getItem('e')).toBeNull();
  });

  it('uploads only when there is something new', () => {
    const { board } = makeBoard();

    board.record({ score: 500, maxCombo: 1, merges: 1 });
    board.setSharing(true);
    expect(board.sync()).toBe(false);

    board.record({ score: 900, maxCombo: 1, merges: 1 });
    expect(board.sync()).toBe(true);
  });

  it('uploads the moment consent is given, with no button pressed', () => {
    const { board } = makeBoard();

    board.record({ score: 500, maxCombo: 1, merges: 1 });
    board.setSharing(true);

    expect(board.snapshot('score').entries).toHaveLength(1);
    expect(board.snapshot('score').entries[0]?.score).toBe(500);
  });

  it('carries a pending record across a reload and uploads it on the next open', () => {
    const storage = new FakeStorage();
    const keys = {
      entries: 'e',
      name: 'n',
      sharing: 's',
      prompt: 'p',
      profile: 'pr',
      device: 'd',
    };

    const first = createLocalLeaderboard({
      storage,
      keys,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
    });
    first.setSharing(true);
    first.setDisplayName('阿爺');
    first.record({ score: 1234, maxCombo: 9, merges: 9 });
    /* 刻意不 `sync()`：模擬直接關掉分頁。 */
    /* Deliberately no `sync()`: simulates closing the tab. */

    const second = createLocalLeaderboard({ storage, keys, salt: TEST_SALT, now: () => 5 });
    expect(second.snapshot('score').entries).toHaveLength(0);
    expect(second.sync()).toBe(true);

    expect(second.snapshot('score').entries[0]).toMatchObject({
      name: '阿爺',
      score: 1234,
      maxCombo: 9,
    });
  });
});

describe('createLocalLeaderboard — 防竄改 / tamper check', () => {
  it('discards a board whose digest does not match', () => {
    const storage = new FakeStorage();
    const text = JSON.stringify([playerRow('cheater', 999_999, 999, 999)]);
    storage.seed('e', JSON.stringify({ v: text, d: 'not-the-right-digest' }));

    const board = createLocalLeaderboard({
      storage,
      salt: TEST_SALT,
      playerId: 'me',
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });
    board.setSharing(true);

    expect(board.snapshot('score').entries).toHaveLength(0);
  });

  it('discards a local record whose digest does not match', () => {
    const storage = new FakeStorage();
    const text = JSON.stringify({
      playerId: 'me',
      name: '阿爺',
      score: 999_999,
      maxCombo: 999,
      merges: 999,
      at: 1,
      revision: 9,
      uploaded: 9,
    });
    storage.seed('pr', JSON.stringify({ v: text, d: 'not-the-right-digest' }));

    const board = createLocalLeaderboard({
      storage,
      salt: TEST_SALT,
      playerId: 'me',
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });

    board.record({ score: 100, maxCombo: 1, merges: 1 });
    board.setSharing(true);

    expect(board.snapshot('score').entries[0]?.score).toBe(100);
  });

  it('accepts a board that was written by the store itself', () => {
    const storage = new FakeStorage();
    const keys = {
      entries: 'e',
      name: 'n',
      sharing: 's',
      prompt: 'p',
      profile: 'pr',
      device: 'd',
    };

    const first = createLocalLeaderboard({
      storage,
      keys,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
    });
    first.setSharing(true);
    first.record({ score: 321, maxCombo: 2, merges: 3 });
    first.sync();

    const second = createLocalLeaderboard({ storage, keys, salt: TEST_SALT, now: () => 5 });
    expect(second.snapshot('score').entries[0]).toMatchObject({ score: 321, maxCombo: 2, merges: 3 });
  });
});

describe('createLocalLeaderboard — 舊存檔遷移 / migrating the old save', () => {
  it('collapses a per-run history into one row holding the maxima', () => {
    const storage = new FakeStorage();
    storage.seed(
      'e',
      JSON.stringify([
        { id: 'r1', name: '', score: 100, maxCombo: 2, merges: 30, at: 10 },
        { id: 'r2', name: '阿爺', score: 900, maxCombo: 5, merges: 1, at: 20 },
        { id: 'r3', name: '阿爺', score: 400, maxCombo: 9, merges: 3, at: 30 },
      ]),
    );

    const board = createLocalLeaderboard({
      storage,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });
    board.setSharing(true);

    const entries = board.snapshot('score').entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'me',
      name: '阿爺',
      score: 900,
      maxCombo: 9,
      merges: 30,
      at: 30,
    });
  });

  it('writes the migrated save back in the new format', () => {
    const storage = new FakeStorage();
    storage.seed('e', JSON.stringify([{ id: 'r1', name: '阿爺', score: 5, maxCombo: 1, merges: 1, at: 1 }]));

    createLocalLeaderboard({
      storage,
      salt: TEST_SALT,
      playerId: 'me',
      now: () => 5,
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });

    const raw = storage.getItem('e') ?? '';
    expect(raw.startsWith('{')).toBe(true);
    expect(JSON.parse(raw)).toHaveProperty('d');
  });
});

describe('createLocalLeaderboard — 儲存體的邊界情況 / storage edge cases', () => {
  it('survives a corrupt save instead of throwing', () => {
    const { storage, board } = makeBoard();
    storage.seed('e', '{ not json');

    expect(board.snapshot('score').entries).toHaveLength(0);

    board.record({ score: 5, maxCombo: 0, merges: 0 });
    board.setSharing(true);
    expect(board.snapshot('score').entries).toHaveLength(1);
  });

  it('round-trips entries, name and sharing through storage', () => {
    const storage = new FakeStorage();
    const keys = {
      entries: 'e',
      name: 'n',
      sharing: 's',
      prompt: 'p',
      profile: 'pr',
      device: 'd',
    };

    const first = createLocalLeaderboard({ storage, keys, salt: TEST_SALT, playerId: 'me', now: () => 5 });
    first.setDisplayName('阿爺');
    first.setSharing(true);
    first.record({ score: 123, maxCombo: 7, merges: 8 });
    first.sync();

    const second = createLocalLeaderboard({ storage, keys, salt: TEST_SALT, now: () => 5 });
    expect(second.displayName).toBe('阿爺');
    expect(second.sharing).toBe(true);
    expect(second.snapshot('combo').entries[0]).toMatchObject({ score: 123, maxCombo: 7, merges: 8 });
  });

  it('falls back to memory when storage is unavailable', () => {
    const board = createLocalLeaderboard({ storage: null });
    board.setDisplayName('阿爺');
    board.record({ score: 42, maxCombo: 1, merges: 1 });
    board.setSharing(true);

    expect(board.displayName).toBe('阿爺');
    expect(board.snapshot('score').entries[0]?.score).toBe(42);
  });

  it('does not crash when the storage refuses to write', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;

    const board = createLocalLeaderboard({ storage, salt: TEST_SALT, playerId: 'me' });
    board.setSharing(true);

    expect(() => board.record({ score: 1, maxCombo: 1, merges: 1 })).not.toThrow();
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

  it('stays quiet when a recording improves nothing', () => {
    const { board } = makeBoard();
    let calls = 0;
    board.subscribe((): void => {
      calls += 1;
    });

    board.record({ score: 500, maxCombo: 5, merges: 5 });
    expect(calls).toBe(1);

    for (let frame = 0; frame < 100; frame += 1) {
      board.record({ score: 100, maxCombo: 1, merges: 1 });
    }
    expect(calls).toBe(1);
  });
});

describe('createLocalLeaderboard — 首次的發布詢問 / the one-off publish prompt', () => {
  function makePromptBoard(storage: FakeStorage | null) {
    return createLocalLeaderboard({
      storage,
      now: (): number => 1_700_000_000_000,
      salt: TEST_SALT,
      playerId: 'me',
      keys: { entries: 'e', name: 'n', sharing: 's', prompt: 'p', profile: 'pr', device: 'd' },
    });
  }

  it('starts un-asked, so the prompt shows on the first leaderboard open', () => {
    expect(makePromptBoard(new FakeStorage()).publishPromptDone).toBe(false);
  });

  it('remembers that the prompt has been dealt with, and stays idempotent', () => {
    const storage = new FakeStorage();
    const board = makePromptBoard(storage);
    let calls = 0;
    board.subscribe((): void => {
      calls += 1;
    });

    board.finishPublishPrompt();
    expect(board.publishPromptDone).toBe(true);
    expect(calls).toBe(1);

    board.finishPublishPrompt();
    expect(calls).toBe(1);
  });

  it('survives a reload, so the prompt really is asked once', () => {
    const storage = new FakeStorage();
    makePromptBoard(storage).finishPublishPrompt();

    expect(makePromptBoard(storage).publishPromptDone).toBe(true);
  });

  it('keeps the prompt state in memory when storage is unavailable', () => {
    const board = makePromptBoard(null);
    board.finishPublishPrompt();

    expect(board.publishPromptDone).toBe(true);
  });
});
