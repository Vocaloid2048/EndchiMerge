/**
 * 遊戲選單：一格一個遊戲（圖示在上、遊戲名在下），按下去重新載入進入該遊戲。
 * The game menu: one tile per game (art above, name below); a press reloads into that game.
 *
 * 位置與尺寸由 `core/design.ts` 的 `MENU_RECTS` 以 inline style 寫入，外觀在 `styles/menu.css`。
 * Positions and sizes come from `MENU_RECTS` as inline styles; appearance lives in `styles/menu.css`.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH, MENU_RECTS } from '../core/design';
import type { Rect } from '../core/types';
import type { GameEntry, GameId } from '../game/gameCatalog';
import { i18nText } from '../i18n';
import { applyDesignTokens } from './designTokens';
import { el } from './dom';
import { attachStageScale } from './scale';

export interface MenuView {
  /**
   * 被等比縮放的 1920×1080 畫布。
   * The 1920×1080 canvas that gets scaled uniformly.
   */
  stage: HTMLElement;
  /**
   * 非官方聲明的宿主；內容由呼叫端在拿到品牌資訊後填入。
   * Host for the unofficial notice, filled by the caller once branding arrives.
   */
  notice: HTMLElement;
  /**
   * 取消縮放監看；頁面層級 teardown 用。
   * Stops the scaling watcher; for page-level teardown.
   */
  detachScale: () => void;
}

export interface MenuOptions {
  host: HTMLElement;
  games: readonly GameEntry[];
  /**
   * 按下可玩的遊戲時回報 id；要不要導航由呼叫端決定。
   * Reports the id of a pressed playable game; navigating there is the caller's call.
   */
  onSelect: (id: GameId) => void;
}

/**
 * 把節點放到設計稿座標上；與 `ui/layout.ts` 的同名輔助同形，兩處都不靠 CSS 擺位。
 * Places a node at a design-space rectangle; the same shape as the helper in `ui/layout.ts` — neither
 * relies on CSS for positioning.
 */
function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${String(rect.x)}px`;
  node.style.top = `${String(rect.y)}px`;
  node.style.width = `${String(rect.width)}px`;
  node.style.height = `${String(rect.height)}px`;
}

/**
 * 一格：圖示 ＋ 遊戲名。未推出的遊戲整格停用，並帶一個「即將推出」的角標。
 * One tile: art plus name. A planned game disables the whole tile and carries a "coming soon" chip.
 *
 * @param entry 目錄中的一筆 / One catalogue entry.
 * @param index 由左至右的序號，決定 x 座標 / Zero-based order, which fixes the x coordinate.
 * @param onSelect 可玩的格子被按下時回報 id / Reports the id when a playable tile is pressed.
 * @returns 可直接附加的按鈕 / A button ready to be appended.
 */
function buildTile(entry: GameEntry, index: number, onSelect: (id: GameId) => void): HTMLButtonElement {
  const tile = el('button', 'panel menu__tile');
  tile.type = 'button';
  tile.dataset['game'] = entry.id;
  place(tile, {
    x: index * (MENU_RECTS.tile.width + MENU_RECTS.gap),
    y: 0,
    width: MENU_RECTS.tile.width,
    height: MENU_RECTS.tile.height,
  });

  const art = el('span', 'menu__art');
  const image = el('img', 'menu__art-image');
  image.src = `${import.meta.env.BASE_URL}${entry.art}`;
  image.alt = '';
  image.decoding = 'async';
  image.draggable = false;
  /*
   * 缺圖只降級成一格虛線框，不拋錯：`public/assets/menu/` 可以整個刪掉而選單照樣可用。
   * A missing image degrades to a dashed outline rather than throwing: the whole
   * `public/assets/menu/` folder can be deleted and the menu still works.
   */
  image.addEventListener('error', (): void => {
    art.replaceChildren();
    art.classList.add('menu__art--missing');
  });
  art.append(image);

  const name = el('span', 'menu__name');
  i18nText(name, entry.nameKey);

  tile.append(art, name);

  if (entry.status === 'planned') {
    tile.disabled = true;
    const chip = el('span', 'menu__chip');
    i18nText(chip, 'menu.planned');
    tile.append(chip);

    return tile;
  }

  tile.addEventListener('click', (): void => onSelect(entry.id));

  return tile;
}

/**
 * 建立選單並掛到宿主；縮放立即生效，否則畫面上會是一張超出視窗的 1920×1080 畫布。
 * Builds the menu and mounts it; scaling starts at once, or the canvas overflows the window.
 */
export function createMenu(options: MenuOptions): MenuView {
  const stage = el('div', 'stage-scale');
  applyDesignTokens(stage);
  stage.style.width = `${String(DESIGN_WIDTH)}px`;
  stage.style.height = `${String(DESIGN_HEIGHT)}px`;

  const root = el('div', 'menu');

  const title = el('h1', 'menu__title');
  i18nText(title, 'menu.title');
  place(title, MENU_RECTS.title);

  const grid = el('div', 'menu__grid');
  place(grid, MENU_RECTS.grid);

  options.games.forEach((entry, index): void => {
    grid.append(buildTile(entry, index, options.onSelect));
  });

  /* 聲明的宿主與遊戲畫面同一個 class，兩邊看起來才是同一條聲明。 */
  /* The notice host reuses the game screen's class, so both screens show the same line. */
  const notice = el('footer', 'layout__notice');
  notice.dataset['hook'] = 'notice';

  root.append(title, grid, notice);
  stage.append(root);
  options.host.append(stage);

  const detachScale = attachStageScale({ stage });

  return { stage, notice, detachScale };
}
