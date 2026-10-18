/**
 * MELTING LIST 名冊（圖鑑）：把 `ui/serpentine.ts` 的幾何畫成絕對定位的 DOM，本身不解鎖任何東西。
 * MELTING LIST roster (compendium): draws `ui/serpentine.ts` geometry as absolutely positioned DOM; it unlocks nothing.
 */

import type { LevelDef } from '../core/types';
import { placeholderColor } from '../render/placeholder';
import type { SpriteLoader } from '../render/spriteLoader';
import { MELTING } from '../core/design';
import { el } from './dom';
import {
  autoFitRows,
  cellOrigin,
  computeRosterLayout,
  type RosterSlot,
  type RosterTrack,
} from './serpentine';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface MeltingListOptions {
  /**
   * 名冊面板內的內容宿主，通常是 `[data-hook="melting-body"]`。
   * The content host inside the roster panel, usually `[data-hook="melting-body"]`.
   */
  host: HTMLElement;
  /**
   * 合成鏈等級表，順序即名冊順序。
   * The merge-chain level table; its order is the roster order.
   */
  levels: readonly LevelDef[];
  sprites: SpriteLoader;
  /**
   * 已解鎖的**等級編號**。未提供時只有第一級算解鎖 —— 最保守的預設，寧可少顯示也不要
   * 把未解鎖的角色畫出來。
   * The unlocked **level ids**. When omitted only the first level counts — the conservative
   * default, since leaking a locked character is the worse failure.
   */
  unlocked?: ReadonlySet<number>;
  /**
   * 覆寫欄數；預設取自設計稿。
   * Overrides the column count; defaults to the design's.
   */
  cols?: number;
  /**
   * 覆寫列數；預設取自設計稿。
   * Overrides the row count; defaults to the design's.
   */
  rows?: number;
}

export interface MeltingList {
  /**
   * 重畫名冊。
   * Redraws the roster.
   */
  render(): void;
  /**
   * 換一批解鎖集合並重畫；由 `game/progress.ts` 的解鎖事件呼叫。
   * Swaps in a new unlocked set and redraws; called by `game/progress.ts`'s unlock events.
   */
  setUnlocked(unlocked: ReadonlySet<number>): void;
  /**
   * 卸下；目前沒有需要監看的東西，保留是為了介面穩定。
   * Detaches; nothing needs cleaning up yet, kept for interface stability.
   */
  destroy(): void;
}

export function createMeltingList(options: MeltingListOptions): MeltingList {
  const { host, levels, sprites } = options;

  const grid = el('div', 'roster');
  host.replaceChildren(grid);

  let unlocked: ReadonlySet<number> = options.unlocked ?? new Set([levels[0]?.id ?? 1]);

  /**
   * 素材不可用時的替代：等級色塊 + 數字，與 Canvas 佔位圖同一套配色。
   * Fallback when art is unavailable: a level swatch with its number, matching the canvas placeholders.
   */
  function buildFallback(level: LevelDef): HTMLElement {
    const fallback = el('span', 'roster-cell__fallback', String(level.id));
    fallback.style.setProperty('--fallback-tint', placeholderColor(level.id));
    return fallback;
  }

  function buildCell(slot: RosterSlot, offsetX: number): HTMLElement {
    const level = levels[slot.index];
    const origin = cellOrigin(slot.col, slot.row, offsetX);

    const node = el('div', 'roster-cell');
    node.style.left = `${String(origin.x)}px`;
    node.style.top = `${String(origin.y)}px`;

    if (level === undefined) return node;

    /*
     * 依**等級編號**判斷，而不是「索引小於幾」：解鎖沿合成鏈單調遞增，用編號就不必假設
     * `levels` 的順序或編號連續。
     * Gated by **level id** rather than "index below N", so the array order and id contiguity
     * need not be assumed.
     */
    if (!unlocked.has(level.id)) {
      node.classList.add('roster-cell--locked');
      /*
       * `?` 是獨立一層，而不是把 `???` 塞進格子 —— 獨立元素才能保證永遠置中且蓋在灰格上。
       * The `?` is its own layer rather than text stuffed into the cell, so it stays centred
       * above the grey tile no matter what.
       */
      node.append(el('span', 'roster-cell__mark', '?'));
      node.setAttribute('aria-label', `${level.name}，尚未解鎖`);
      return node;
    }

    const art = el('div', 'roster-cell__art');
    const entry = sprites.get(level.id);

    if (entry?.ok === true) {
      const image = new Image();
      /* `sprite-outline` 沿 alpha 剪影描白邊。 */
      /* `sprite-outline` traces a white edge along the sprite's alpha. */
      image.className = 'roster-cell__img sprite-outline';
      image.decoding = 'async';
      /* 拖曳素材同樣能繞過護層觸發儲存，直接關掉。 */
      /* Dragging the art would bypass the shield and offer a save, so dragging is off. */
      image.draggable = false;
      /* 素材載入後才失敗（例如快取被清）時退回佔位色塊。 */
      /* Falls back to the placeholder swatch when loading fails after the fact (e.g. a purged cache). */
      image.addEventListener('error', (): void => art.replaceChildren(buildFallback(level)), {
        once: true,
      });
      image.src = sprites.srcFor(level);
      image.alt = level.name;
      art.append(image);
    } else {
      art.append(buildFallback(level));
    }

    node.title = level.name;
    node.append(art);

    /*
     * 透明護層：整格罩一層會接住指標事件的元素，長按／右鍵落在護層而不是 `<img>` 上，
     * 瀏覽器就不會提供「儲存圖片」。最後 append，所以永遠蓋在素材之上。
     * The transparent shield: a pointer-catching element over the whole cell, so long-presses
     * and right-clicks land on it instead of the `<img>` and the browser never offers "save
     * image". Appended last, so it always sits above the art.
     */
    const shield = el('span', 'roster-cell__shield');
    shield.setAttribute('aria-hidden', 'true');
    node.append(shield);
    return node;
  }

/**
 * 把蛇形走線畫成一張覆蓋整格網的 SVG；放在格子之前 append，所以永遠在素材之下。
 * The serpentine track as one SVG over the grid, appended before the cells so it stays under the art.
 *
 * 走線在最後一格結束，所以 `viewBox` 只需覆蓋實際格網高度。
 * The track ends on the last slot, so the `viewBox` only has to cover the real grid height.
 */
function buildTrack(track: RosterTrack, gridHeight: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('roster-track');
  svg.setAttribute(
    'viewBox',
    `0 0 ${String(MELTING.content.width)} ${String(gridHeight)}`,
  );
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');

  const { strokeWidth } = MELTING.track;

  /*
   * 走線與箭頭：兩條 path，都畫在格子之下。
   * The track and its arrowhead: two paths, both under the cells.
   */
  const route = document.createElementNS(SVG_NS, 'path');
  route.classList.add('roster-track__route');
  route.setAttribute('d', track.path);
  route.setAttribute('stroke-width', String(strokeWidth));

  const head = document.createElementNS(SVG_NS, 'path');
  head.classList.add('roster-track__arrow');
  head.setAttribute('d', track.arrow);
  head.setAttribute('stroke-width', String(strokeWidth));

  svg.append(route, head);
  return svg;
}

  function render(): void {
    const unlockedCount = levels.filter((level) => unlocked.has(level.id)).length;

    /*
     * 列數由**鏈長自動決定**（見 `autoFitRows`）：固定的 5 列在只有 10 級時會讓走線只用 2 欄、蛇形退化成最右邊一條垂直線。
     * Rows are **auto-fitted to the chain length** (see `autoFitRows`): a fixed 5 rows at 10 levels would use only 2 columns and degenerate the serpentine into one vertical line.
     */
    const rows = options.rows ?? autoFitRows(levels.length, options.cols ?? MELTING.cols);

    const layout = computeRosterLayout({
      count: levels.length,
      cols: options.cols,
      rows,
      unlockedCount,
    });

    /*
     * 格網高度跟著實際列數走，否則列數變少時下半個面板會空著、走線也拖在格子下方。
     * The grid height follows the rows actually used, or a shorter grid would leave the lower
     * half of the panel empty and the track dragging below the cells.
     */
    const gridHeight = rows * MELTING.cellHeight;
    grid.style.setProperty('--melting-grid-h', `${String(gridHeight)}px`);

    grid.replaceChildren();
    if (layout.track !== null) grid.append(buildTrack(layout.track, gridHeight));

    for (const slot of layout.slots) {
      grid.append(buildCell(slot, layout.offsetX));
    }

    grid.setAttribute(
      'aria-label',
      `合成鏈圖鑑，共 ${String(layout.slots.length)} 級，已解鎖 ${String(unlockedCount)} 級`,
    );
  }

  render();

  return {
    render,

    setUnlocked(next: ReadonlySet<number>): void {
      unlocked = next;
      render();
    },

    destroy: (): void => undefined,
  };
}
