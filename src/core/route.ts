/**
 * 路由：以 `?game=<id>` 分辨「選單」與「某個遊戲」，切換一律靠重新載入。
 * Routing: `?game=<id>` separates the menu from one game; switching always goes through a reload.
 */

import { findGame, isGameId, type GameId } from '../game/gameCatalog';

/**
 * 目前的畫面。選單是預設值 —— 網址壞掉、缺參數、指向未推出的遊戲，都安全地落在選單。
 * The current screen. The menu is the default: a broken URL, a missing parameter or a planned game all land there safely.
 */
export type Route = { readonly kind: 'menu' } | { readonly kind: 'game'; readonly id: GameId };

/** 查詢參數名；`gameHref()` 與 `parseRoute()` 共用同一個常數。 */
export const GAME_PARAM = 'game';

/**
 * 解析查詢字串（可帶或不帶前導 `?`）。
 * Parses a query string (with or without the leading `?`).
 *
 * 只有「目錄內 ＋ 可玩」的 id 才算進入遊戲；未推出的遊戲回選單，而不是進到一個空白頁。
 * Only a catalogued, playable id counts as entering a game; a planned one returns the menu rather than a blank page.
 */
export function parseRoute(search: string): Route {
  const id = new URLSearchParams(search).get(GAME_PARAM);

  if (id === null || !isGameId(id)) return { kind: 'menu' };

  return findGame(id)?.status === 'playable' ? { kind: 'game', id } : { kind: 'menu' };
}

/** 某個遊戲的網址（相對目前目錄）；選單的網址＝去掉查詢字串的路徑。 */
export function gameHref(id: GameId): string {
  return `?${GAME_PARAM}=${id}`;
}
