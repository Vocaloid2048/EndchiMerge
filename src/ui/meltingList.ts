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
 * 1. **未解鎖顯示 `???`**（design.md D5），解鎖後永久保留。這一支不解鎖任何東西 ——
 *    它只是把 `game/progress.ts` 的結果畫出來。
 *    Locked cells show `???` and stay unlocked forever once revealed. This module unlocks
 *    nothing; it only draws what `game/progress.ts` reports.
 * 2. **素材等比放入、不拉伸**（D26）。素材已在導出時正規化過（512×512、body 304、
 *    body 中心 (256, 328)），所以所有角色共用同一個縮放就會對齊。
 * 3. **連接線由演算法給**，這裡只負責畫；走位規則不重算。
 */

import type { LevelDef } from '../core/types';
import { placeholderColor } from '../render/placeholder';
import type { SpriteLoader } from '../render/spriteLoader';
import { MELTING } from '../core/design';
import { el } from './dom';
import {
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

  function buildCell(slot: RosterSlot): HTMLElement {
    const level = levels[slot.index];
    const origin = cellOrigin(slot.col, slot.row);

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
      node.textContent = '???';
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
 */
function buildTrack(track: RosterTrack): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('roster-track');
  svg.setAttribute(
    'viewBox',
    `0 0 ${String(MELTING.content.width)} ${String(MELTING.content.height)}`,
  );
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');

  const { strokeWidth } = MELTING.track;

  const path = document.createElementNS(SVG_NS, 'path');
  path.classList.add('roster-track__route');
  path.setAttribute('d', track.path);
  path.setAttribute('stroke-width', String(strokeWidth));

  const head = document.createElementNS(SVG_NS, 'path');
  head.classList.add('roster-track__arrow');
  head.setAttribute('d', track.arrow);
  head.setAttribute('stroke-width', String(strokeWidth));

  svg.append(path, head);
  return svg;
}

  function render(): void {
    const unlockedCount = levels.filter((level) => unlocked.has(level.id)).length;

    const layout = computeRosterLayout({
      count: levels.length,
      cols: options.cols,
      rows: options.rows,
      unlockedCount,
    });

    grid.replaceChildren();
    if (layout.track !== null) grid.append(buildTrack(layout.track));

    for (const slot of layout.slots) {
      grid.append(buildCell(slot));
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
