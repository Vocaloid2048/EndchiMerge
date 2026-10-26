/**
 * 路由解析：只有「目錄內 ＋ 可玩」的 id 才進遊戲，其餘一律回選單。
 * Route parsing: only a catalogued, playable id opens a game; everything else falls back to the menu.
 */

import { describe, expect, it } from 'vitest';
import { gameHref, parseRoute } from '../src/core/route';

describe('parseRoute', () => {
  it('defaults to the menu without a query', () => {
    expect(parseRoute('')).toEqual({ kind: 'menu' });
    expect(parseRoute('?')).toEqual({ kind: 'menu' });
  });

  it('opens a playable game', () => {
    expect(parseRoute('?game=merge')).toEqual({ kind: 'game', id: 'merge' });
  });

  it('accepts the query without a leading question mark', () => {
    expect(parseRoute('game=merge')).toEqual({ kind: 'game', id: 'merge' });
  });

  /* 未推出的遊戲沒有頁面，進去只會看到空白 —— 寧可回選單。 */
  it('keeps a planned game on the menu', () => {
    expect(parseRoute('?game=citybloxx')).toEqual({ kind: 'menu' });
    expect(parseRoute('?game=match3')).toEqual({ kind: 'menu' });
  });

  it('rejects an unknown or wrongly cased id', () => {
    expect(parseRoute('?game=nope')).toEqual({ kind: 'menu' });
    expect(parseRoute('?game=MERGE')).toEqual({ kind: 'menu' });
    expect(parseRoute('?game=')).toEqual({ kind: 'menu' });
  });

  it('ignores unrelated parameters', () => {
    expect(parseRoute('?debug=1&game=merge')).toEqual({ kind: 'game', id: 'merge' });
  });
});

describe('gameHref', () => {
  it('builds a relative link that parseRoute round-trips', () => {
    expect(gameHref('merge')).toBe('?game=merge');
    expect(parseRoute(gameHref('merge'))).toEqual({ kind: 'game', id: 'merge' });
  });
});
