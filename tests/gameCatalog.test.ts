/**
 * 遊戲目錄的守門測試：id 唯一、名字有譯文、圖示路徑相對、可玩清單與 `?game=` 的守門一致。
 * Guard tests for the catalogue: unique ids, translated names, relative art paths, and a playable list that matches the route.
 */

import { describe, expect, it } from 'vitest';
import { GAME_CATALOG, findGame, isGameId, playableGameIds } from '../src/game/gameCatalog';
import { zhHant } from '../src/i18n/messages/zh-Hant';

describe('game catalogue', () => {
  it('lists every id once', () => {
    const ids = GAME_CATALOG.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a translation for every display name', () => {
    for (const entry of GAME_CATALOG) {
      expect(zhHant[entry.nameKey]).toBeTruthy();
    }
  });

  /*
   * 圖示路徑刻意相對：`BASE_URL` 不是 `/` 時（子目錄部署）帶前導斜線就會 404。
   * Art paths stay relative on purpose: a leading slash 404s when `BASE_URL` is not `/`.
   */
  it('keeps art paths relative to the base URL', () => {
    for (const entry of GAME_CATALOG) {
      expect(entry.art.startsWith('assets/')).toBe(true);
    }
  });

  it('offers at least one playable game', () => {
    expect(playableGameIds().length).toBeGreaterThan(0);
  });

  it('finds an entry by id and rejects anything else', () => {
    expect(findGame('merge')?.status).toBe('playable');
    expect(findGame('nope')).toBeUndefined();
    expect(isGameId('merge')).toBe(true);
    expect(isGameId('nope')).toBe(false);
    expect(isGameId(null)).toBe(false);
  });
});
