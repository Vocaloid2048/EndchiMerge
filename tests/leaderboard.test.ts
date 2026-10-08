/**
 * 排行榜資料層與名稱驗證的單元測試。
 * Unit tests for the leaderboard data layer and display-name validation.
 *
 * 現在的模型是「**每位玩家一筆，每個分類最多一筆**」，所以這個模組要釘住的行為換了一批：
 * 一局一局記下來只會是一行、只升不降、改名不新增紀錄、本機紀錄與上載分開、同意之前不上榜、
 * 上載有觸發時機，以及存檔被手改過時認得出來。以下每條對應其中一項，用注入的假儲存體，
 * 不碰 `localStorage`。
 * The model is now **one row per player, at most one per category**, so the behaviours worth
 * pinning have changed: repeated runs stay one row, numbers never go down, a rename adds nothing,
 * the local record and the upload are separate, nothing shows before consent, the upload has
 * trigger points, and a hand-edited save is noticed. Each test below pins one of those, over an
 * injected fake storage.
 *
 * 「別人的榜」用 `seal()` 直接寫進假儲存體 —— 本地只有一位玩家，所以多人排序只能這樣造，
 * 順便也就驗了摘要在正常情況下是通的（同一條路徑的另一半在下面被改壞時會失敗）。
 * A board of "other players" is written straight into the fake storage with `seal()`: locally
 * there is only one player, so multi-player ordering has to be staged this way — which doubles as
 * proof that a well-formed digest passes, while the other half of the same path is shown to fail
 * once it is corrupted.
 */

import { describe, expect, it } from 'vitest';
import { seal } from '../src/core/integrity';
import { createLocalLeaderboard, LEADERBOARD_LIMIT } from '../src/game/leaderboard';
import type { LeaderboardEntry } from '../src/game/leaderboard';
import type { ProgressStorage } from '../src/game/progress';
import {
  NAME_MAX_UNITS,
  nameUnits,
  normalizeDisplayName,
  validateDisplayName,
} from '../src/game/playerName';

/** 測試用的鹽；與正式的那一組不同，正好也證明摘要不是寫死比對。 */
const TEST_SALT = 'test-salt';

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

/** 榜上某一列（別人），供排序與裁切的測試用來擺位。 */
function playerRow(
  id: string,
  score: number,
  maxCombo: number,
  merges: number,
  at = 1,
): LeaderboardEntry {
  return { id, name: id, score, maxCombo, merges, at };
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
});

/** 建一個榜；`seed` 是「別人的榜」，會在讀取之前寫進去。 */
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

    /* 高分局、低連擊。 */
    board.record({ score: 900, maxCombo: 1, merges: 2 });
    /* 低分但連擊很長的一局，會刷新 COMBO 與合成，卻不會碰到分數。 */
    board.record({ score: 100, maxCombo: 40, merges: 60 });
    board.sync();

    /*
     * 同一行的三個數字來自不同的局 —— 這是刻意的，否則 COMBO 分頁只會看到高分局。
     * The three numbers on one row come from different runs, which is the point: tied to a single
     * run, the COMBO tab would only ever show high-score games.
     */
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

    /*
     * 「關分頁前又記了一次中途成績」不該把那筆紀錄的時間改成現在 —— 那會讓榜上的日期變成
     * 「最後一次離開」而不是「最後一次刷新」。
     * Recording a mid-run score on the way out must not restamp the record, or the board's date
     * becomes "when you last left" rather than "when you last improved".
     */
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
    /*
     * 「分數最高」與「連擊最高」刻意不是同一個人：只按分數裁切會讓 COMBO 分頁一開始就偏斜。
     * The top scorer and the top combo are deliberately different players: trimming by score alone
     * would bias the COMBO tab from the start.
     */
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
    /* 3 位玩家、第 2 名 → 贏過 1 位 → 33%（`(total − rank) / total`）。 */
    expect(self?.beats).toBe(33);
  });

  /*
   * 名次掉出榜外時，那一筆**必須還留著**，否則 UI 既沒有名次也沒有百分比可報（見
   * `ui/leaderboard.ts` 的 `rank > LEADERBOARD_LIMIT` 分支）—— 這是「你的最佳」那一行的前提。
   * When the rank falls off the board the row **has to survive**, or the UI has neither a rank nor
   * a percentage to report (see the `rank > LEADERBOARD_LIMIT` branch in `ui/leaderboard.ts`) —
   * which is the precondition for the whole "your best" line.
   *
   * 用一個很小的 `limit` 重現「排到榜外」：位元組上與 150 位玩家無異，但不必為了測一條界線塞
   * 150 筆資料進存檔。
   * A tiny `limit` reproduces "off the board": byte for byte the same situation as 150 players,
   * without pushing 150 rows through storage to test one boundary.
   */
  it('keeps the player on the record even at a rank past the listed top', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      /* 三個數值一起遞減，讓每個分類的前三名都是同一批人，截斷才可預期。 */
      playerRow(`q${String(index)}`, 600 - index * 100, 60 - index * 10, 6 - index),
    );

    const { board } = makeBoard(3, many);
    board.setSharing(true);
    board.record({ score: 250, maxCombo: 1, merges: 1 });
    board.sync();

    const snapshot = board.snapshot('score');

    /* 榜身只列前三名，自己（第四名）不在裡面。 */
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['q0', 'q1', 'q2']);

    expect(snapshot.self).not.toBeNull();
    expect(snapshot.self?.rank).toBe(4);
    /*
     * 本機儲存只留得住各分類的前 `limit` 名，所以排到榜外的人在**留住的那些人**之中一定是
     * 最後一名，百分比自然是 0 —— 這是本地版的極限，不是公式錯了。真正的跨玩家百分位要有
     * 伺服器才知道分母（見 `game/leaderboard.ts` 的 `beats` 說明）。
     * The local store only keeps each category's top `limit`, so anyone past it is necessarily
     * last among the rows that were kept and the share is 0 — that is the local ceiling, not a
     * broken formula. A real cross-player share needs a server that knows its own denominator (see
     * the `beats` note in `game/leaderboard.ts`).
     */
    expect(snapshot.self?.total).toBe(4);
    expect(snapshot.self?.beats).toBe(0);
  });

  it('has no self row while the player is not on the board', () => {
    const { board } = makeBoard(LEADERBOARD_LIMIT, [playerRow('a', 900, 1, 1)]);
    board.setSharing(true);

    expect(board.snapshot('score').self).toBeNull();
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

    /*
     * 重開一個「新工作階段」再改名。舊版就是在這裡出事的：只有「沒有名字」的紀錄會被認領，
     * 所以改名之後那些記錄留在舊名底下，玩家看到的就是「我的紀錄不見了」。
     * Reopen a "new session" and rename. This is exactly where the previous version failed: only
     * nameless records were claimed, so after a rename the records stayed under the old name and
     * the player concluded his record was gone.
     */
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
    /* 剛才那一次 push 已經把 `uploaded` 追上 `revision`，所以再叫一次是空轉。 */
    expect(board.sync()).toBe(false);

    board.record({ score: 900, maxCombo: 1, merges: 1 });
    expect(board.sync()).toBe(true);
  });

  it('uploads the moment consent is given, with no button pressed', () => {
    const { board } = makeBoard();

    board.record({ score: 500, maxCombo: 1, merges: 1 });
    /* 「同意」本身就是上載的觸發點（使用者定案）。 */
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

    /* 第一段：同意之後刷新了一次紀錄，但沒等到任何上載時機就關掉分頁。 */
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

    /* 第二段：下次回來。 */
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

    /* 被改過的那一筆當作不存在，所以留下來的是真的打出來的分數。 */
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

    /* 新格式是信封，不再是裸陣列 —— 否則下次開啟會再遷移一次。 */
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

    /* 壞資料之後仍然可以正常記錄。 */
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

    /* 每幀都會呼叫 `record()`，所以「沒有刷新就什麼都不做」是它便宜的原因。 */
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

    /* 第二次不該再通知 —— 那會讓已開著的榜白白重繪。 */
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
