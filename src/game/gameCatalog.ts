/**
 * 遊戲目錄：選單上的一個遊戲＝一張圖、一個名、一個狀態。純資料，不含任何啟動邏輯。
 * The game catalogue: one row per game on the menu — an image, a name, a status. Pure data, no boot logic.
 */

import type { MessageKey } from '../i18n';

/**
 * 選單認得的遊戲；`?game=` 只接受這個聯集，其他值一律回選單。
 * The games the menu knows; `?game=` accepts only this union, anything else falls back to the menu.
 */
export type GameId = 'merge' | 'citybloxx' | 'match3';

/**
 * `playable` ＝ 有頁面可進；`planned` ＝ 只佔一格，卡片停用。
 * `playable` means a screen exists; `planned` only holds a slot, and its card is disabled.
 */
export type GameStatus = 'playable' | 'planned';

export interface GameEntry {
  readonly id: GameId;
  /** 卡片下方顯示的名字，走語系字典（專有名詞不在此列）。 */
  readonly nameKey: MessageKey;
  /** 圖示路徑，相對於 `BASE_URL`。 */
  readonly art: string;
  readonly status: GameStatus;
}

/**
 * 選單的顯示順序就是這個陣列的順序；加一個遊戲＝加一筆 ＋ 一個 `?game=` 的啟動分支。
 * The array order is the menu order: adding a game means one more row plus one more `?game=` boot branch.
 *
 * 名字刻意避開第三方作品的原名（`citybloxx`／`match3` 只是程式內識別名），
 * 免得把別人的作品名當成自家遊戲的識別用途。
 * The display names deliberately avoid third-party titles (`citybloxx` / `match3` are code identifiers only).
 */
export const GAME_CATALOG: readonly GameEntry[] = [
  { id: 'merge', nameKey: 'game.merge.name', art: 'assets/menu/merge.webp', status: 'playable' },
  { id: 'citybloxx', nameKey: 'game.citybloxx.name', art: 'assets/menu/citybloxx.webp', status: 'planned' },
  { id: 'match3', nameKey: 'game.match3.name', art: 'assets/menu/match3.webp', status: 'planned' },
];

/** 型別警衛：字串是不是目錄內的 id。 */
export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && GAME_CATALOG.some((entry) => entry.id === value);
}

/** 按 id 找一筆；找不到回 `undefined`（呼叫端據此回選單）。 */
export function findGame(id: string): GameEntry | undefined {
  return GAME_CATALOG.find((entry) => entry.id === id);
}

/** 目前真的進得去的遊戲；`?game=` 的守門與測試共用。 */
export function playableGameIds(): readonly GameId[] {
  return GAME_CATALOG.filter((entry) => entry.status === 'playable').map((entry) => entry.id);
}
