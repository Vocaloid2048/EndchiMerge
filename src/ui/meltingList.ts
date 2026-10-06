/**
 * MELTING LIST 名冊渲染（＝圖鑑）。
 * MELTING LIST roster rendering (the compendium).
 *
 * 把 `ui/serpentine.ts` 算出來的幾何畫成 DOM。因為格網是**固定設計尺寸**（4 欄 × 5 列、
 * 單格 84.25×94.4），這裡用絕對定位而不是 CSS Grid：絕對定位讓「演算法給什麼座標就放
 * 哪裡」，不需要在 CSS 裡再描述一次格線，也就不會出現演算法與 CSS 各有一套欄列的漂移。
 * Renders the geometry from `ui/serpentine.ts`. Because the grid is a **fixed design size**
 * (4×5 of 84.25×94.4 cells), cells are absolutely positioned rather than placed by CSS Grid:
 * the algorithm's coordinates are the only description of the grid, so there is no second
 * set of column and row definitions to drift out of sync.
 *
 * 三個設計約束 / Three design constraints:
 *
 * 1. **未解鎖顯示灰格 ＋ 中央的 `?`**（design.md D5 ＋ 使用者定案），解鎖後永久保留。
 *    這一支不解鎖任何東西 —— 它只是把 `game/progress.ts` 的結果畫出來。
 *    Locked cells show a grey tile with a centred `?` (design.md D5 + the user's decision),
 *    and stay unlocked forever once revealed. This module unlocks nothing; it only draws what
 *    `game/progress.ts` reports.
 * 2. **素材等比放入、不拉伸**（D26）。素材已在導出時正規化過（512×512、body 304、
 *    body 中心 (256, 328)），所以所有角色共用同一個縮放就會對齊。
 * 3. **素材上覆一層透明護層**（使用者定案）：長按／右鍵落在護層上而不是 `<img>` 上，
 *    瀏覽器的「儲存圖片」就不會被觸發。
 *    A transparent shield sits over the art (the user's decision): long-presses and
 *    right-clicks land on the shield instead of the `<img>`, so the browser's "save image"
 *    is never offered.
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
  /** 名冊面板內的內容宿主，通常是 `[data-hook="melting-body"]`。 */
  host: HTMLElement;
  /** 合成鏈等級表，順序即名冊順序。 */
  levels: readonly LevelDef[];
  sprites: SpriteLoader;
  /**
   * 已解鎖的**等級編號**。未提供時視為只有第一級解鎖（最保守的預設，寧可少顯示也不要
   * 把未解鎖的角色畫出來）。
   * The unlocked **level ids**. When omitted only the first level counts as unlocked — the
   * conservative default, since leaking a locked character is the worse failure.
   */
  unlocked?: ReadonlySet<number>;
  /** 覆寫欄數；預設取自設計稿。 */
  cols?: number;
  /** 覆寫列數；預設取自設計稿。 */
  rows?: number;
}

export interface MeltingList {
  /** 重畫名冊。 */
  render(): void;
  /** 換一批解鎖集合並重畫；由 `game/progress.ts` 的解鎖事件呼叫。 */
  setUnlocked(unlocked: ReadonlySet<number>): void;
  /** 卸下；目前沒有需要監看的東西，保留是為了介面穩定。 */
  destroy(): void;
}

export function createMeltingList(options: MeltingListOptions): MeltingList {
  const { host, levels, sprites } = options;

  const grid = el('div', 'roster');
  host.replaceChildren(grid);

  let unlocked: ReadonlySet<number> = options.unlocked ?? new Set([levels[0]?.id ?? 1]);

  /** 素材不可用時的替代：等級色塊 + 數字，與 Canvas 佔位圖同一套配色。 */
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
     * 依**等級編號**判斷，而不是「索引小於幾」：解鎖沿合成鏈單調遞增，但用編號判斷就
     * 不必假設 `levels` 的順序或編號連續。
     * Gated by **level id** rather than "index below N": the chain unlocks monotonically, and
     * keying on the id avoids assuming the array order or contiguous ids.
     */
    if (!unlocked.has(level.id)) {
      node.classList.add('roster-cell--locked');
      /*
       * `?` 是獨立一層（使用者定案：灰方格**中央**一個問號），而不是把 `???` 塞進格子 ——
       * 獨立元素才能保證永遠置中、也永遠蓋在灰格之上。
       * The `?` is its own layer (the user's decision: a single question mark **centred** on
       * the grey tile), rather than text stuffed into the cell — a dedicated element stays
       * centred above the tile no matter what.
       */
      node.append(el('span', 'roster-cell__mark', '?'));
      node.setAttribute('aria-label', `${level.name}，尚未解鎖`);
      return node;
    }

    const art = el('div', 'roster-cell__art');
    const entry = sprites.get(level.id);

    if (entry?.ok === true) {
      const image = new Image();
      /* `sprite-outline` 沿 alpha 剪影描白邊（design.md §3.2）。 */
      image.className = 'roster-cell__img sprite-outline';
      image.decoding = 'async';
      /* 拖曳素材同樣能繞過護層觸發儲存，直接關掉。 */
      image.draggable = false;
      /* 素材載入後才失敗（例如快取被清）時退回佔位色塊。 */
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
     * 透明護層（使用者定案）：整格罩一層透明的、會接住指標事件的元素，長按／右鍵落在
     * 護層上而不是 `<img>` 上，瀏覽器就不會提供「儲存圖片」。放在最後 append，永遠蓋在
     * 素材之上；外觀是全透明的，畫面看不出它存在。
     * The transparent shield (the user's decision): a transparent, pointer-catching element
     * covers the whole cell, so long-presses and right-clicks land on it instead of the
     * `<img>` and the browser never offers "save image". Appended last, it always sits above
     * the art; being fully transparent it is invisible on screen.
     */
    const shield = el('span', 'roster-cell__shield');
    shield.setAttribute('aria-hidden', 'true');
    node.append(shield);
    return node;
  }

/**
 * 把蛇形走線畫成一張覆蓋整格網的 SVG。放在格子之前 append，所以永遠在素材之下 ——
 * 這正是設計稿的做法：整條線是連續的，只是被素材蓋住、只剩縫隙露出白色短線。
 * The serpentine track as one SVG over the grid. It is appended before the cells so it
 * always sits under the art — exactly as in the mock, where the path is continuous and only
 * the gaps between cells let the white line show.
 *
 * `overflow: visible` 是必要的：箭頭比內容區右緣再突出約 18px（設計稿也是如此，只是仍在
 * 面板之內）。SVG 預設會裁掉視埠外的內容，那會把箭頭切一半。
 *
 * `viewBox` 的高度取**實際格網高度**（`rows × cellHeight`），與 `.roster` 的高度一致；否則
 * `preserveAspectRatio="none"` 會把路徑垂直拉伸，圓角與線寬全部變形。
 * The `viewBox` height is the **actual grid height** (`rows × cellHeight`), matching `.roster`;
 * otherwise `preserveAspectRatio="none"` would stretch the path vertically and distort every
 * fillet and the stroke width.
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

  const path = document.createElementNS(SVG_NS, 'path');
  path.classList.add('roster-track__route');
  path.setAttribute('d', track.path);
  path.setAttribute('stroke-width', String(strokeWidth));

  /*
   * 虛線段（使用者定案）：最後一隻方團團之後的走線 —— 「路還沒修到那裡」。
   * The dashed tail (the user's decision): the track past the last dumpling — "the road is
   * not built that far yet".
   */
  const tail = document.createElementNS(SVG_NS, 'path');
  tail.classList.add('roster-track__dash');
  tail.setAttribute('d', track.dash);
  tail.setAttribute('stroke-width', String(strokeWidth));

  const head = document.createElementNS(SVG_NS, 'path');
  head.classList.add('roster-track__arrow');
  head.setAttribute('d', track.arrow);
  head.setAttribute('stroke-width', String(strokeWidth));

  svg.append(path, tail, head);
  return svg;
}

  function render(): void {
    const unlockedCount = levels.filter((level) => unlocked.has(level.id)).length;

    /*
     * 列數由**鏈長自動決定**（見 `autoFitRows`）：設計稿的 4×5 是 19 格的形狀，10 級沿用 5 列
     * 會讓走線只用 2 欄、蛇形退化成最右邊一條垂直線。自動列數讓欄數填滿面板寬度。
     * Rows are **auto-fitted to the chain length** (see `autoFitRows`): the mock's 4×5 is the shape
     * of 19 slots, and 10 levels at 5 rows would use only 2 columns and degenerate the serpentine
     * into one vertical line at the far right. Auto-fit fills the panel width instead.
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
     * The grid height follows the rows actually used, or a shorter grid would leave the lower half
     * of the panel empty and the track dragging below the cells.
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
