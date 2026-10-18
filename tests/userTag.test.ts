/**
 * 玩家號的規則：指派一次、改名不動、只在「同名字＋同號」時重抽；兩個 store 必須一致。
 * Player tag rules: assigned once, kept across renames, re-rolled only on a collision.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDriver, dialectFor, ensureSchema } from '../api/_lib/db';
import { SqlStore } from '../api/_lib/sqlStore';
import { MemoryStore, type ScoreRow, type Store } from '../api/_lib/store';

const AT = 1_700_000_000_000;
const DEVICE = 'it-device-0001';
const RIVAL = 'it-device-0002';

function row(deviceId: string, overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    runId: randomUUID(),
    deviceId,
    displayName: '夜芷冰',
    userTag: '0001',
    score: 900,
    durationMs: 60_000,
    merges: 30,
    drops: 40,
    maxCombo: 5,
    version: '0.1.0',
    verified: true,
    rejected: null,
    atMs: AT,
    ...overrides,
    mode: overrides.mode ?? 'new',
  };
}

interface Opened {
  readonly store: Store;
  readonly close: () => Promise<void>;
}

const STORES: readonly { readonly name: string; readonly open: () => Promise<Opened> }[] = [
  {
    name: 'MemoryStore',
    open: () => Promise.resolve({ store: new MemoryStore(), close: () => Promise.resolve() }),
  },
  {
    name: 'SqlStore（真的 SQL）/ real SQL',
    open: async () => {
      const driver = createDriver('sqlite', ':memory:');
      const dialect = dialectFor('sqlite');
      await ensureSchema(driver, dialect);

      return { store: new SqlStore(driver, dialect), close: () => driver.close() };
    },
  },
];

for (const { name, open } of STORES) {
  describe(`玩家號 — ${name}`, () => {
    it('takes the offered tag on the first submission', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '4242' }));

      expect((await store.getProfile(DEVICE))?.userTag).toBe('4242');

      await close();
    });

    it('keeps the tag it already has, whatever is offered later', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '4242' }));
      await store.saveScore(row(DEVICE, { userTag: '7777' }));

      /* 每次提交都會送來新鑄的號（見 `handlers.ts`），所以「沿用既有的」是關鍵一步。
       * Every submission mints a fresh tag (see `handlers.ts`), so keeping the existing one is
       * the load-bearing step. */
      expect((await store.getProfile(DEVICE))?.userTag).toBe('4242');

      await close();
    });

    it('keeps the tag across a rename, so the same player stays the same row', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '4242' }));
      await store.saveScore(row(DEVICE, { displayName: '阿爺', userTag: '7777' }));

      const profile = await store.getProfile(DEVICE);
      expect(profile?.displayName).toBe('阿爺');
      expect(profile?.userTag).toBe('4242');

      await close();
    });

    it('re-rolls only when another device already holds the same name and tag', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '4242' }));
      await store.saveScore(row(RIVAL, { userTag: '4242' }));

      const mine = await store.getProfile(DEVICE);
      const theirs = await store.getProfile(RIVAL);

      expect(theirs?.displayName).toBe('夜芷冰');
      expect(theirs?.userTag).toMatch(/^\d{4}$/u);
      expect(theirs?.userTag).not.toBe('4242');
      expect(mine?.userTag).toBe('4242');

      await close();
    });

    it('does not re-roll when the names differ', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '4242' }));
      await store.saveScore(row(RIVAL, { displayName: '別的名字', userTag: '4242' }));

      expect((await store.getProfile(RIVAL))?.userTag).toBe('4242');

      await close();
    });

    it('leaves an unnamed player alone, since nothing is displayed to disambiguate', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { displayName: '', userTag: '4242' }));
      await store.saveScore(row(RIVAL, { displayName: '', userTag: '4242' }));

      expect((await store.getProfile(DEVICE))?.userTag).toBe('4242');
      expect((await store.getProfile(RIVAL))?.userTag).toBe('4242');

      await close();
    });

    it('mints a tag when the offered one is empty, rather than storing a blank', async () => {
      const { store, close } = await open();

      await store.saveScore(row(DEVICE, { userTag: '' }));

      expect((await store.getProfile(DEVICE))?.userTag).toMatch(/^\d{4}$/u);

      await close();
    });
  });
}
