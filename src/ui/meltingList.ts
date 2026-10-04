/**
 * MELTING LIST 名冊渲染。
 * MELTING LIST roster rendering.
 *
 * 把 `ui/serpentine.ts` 算出來的幾何畫成 DOM：格子用 CSS Grid 的顯式 `grid-row` /
 * `grid-column` 落位，因此「走位規則」完全由演算法決定，這裡不重算任何方向。
 * Renders the geometry computed by `ui/serpentine.ts` as DOM. Cells are placed with
 * explicit `grid-row` / `grid-column`, so the walking order stays entirely in the
 * algorithm and is never re-derived here.
 *
 * 三個設計約束 / Three design constraints:
 *
 * 1. **未解鎖顯示 `???`**（design.md D5），且解鎖後永久保留。
 * 2. **1:1 正方格、素材等比放入、不拉伸**（D26）。素材已在導出時正規化過
 *    （512×512、body 304、body 中心 (256, 328)），所以所有角色共用同一個縮放與
 *    裁切框就會對齊 —— 不必逐格處理。
 * 3. **組與組之間另開蛇形**（design.md §2.5 第 4 點），組界不畫 U-turn。
 */

import type { LevelDef } from '../core/types';
import { placeholderColor } from '../render/placeholder';
import type { SpriteLoader } from '../render/spriteLoader';
import { el } from './dom';
import { computeRosterLayout, type RosterArrow, type RosterCell } from './serpentine';

const DEFAULT_MAX_ROWS = 4;
/*
 * 目標單格邊長。這個數字決定「桌面寬度下會有幾欄」，而設計稿是 5 欄
 * （design.md §2.5：N=10、cols=5 ⇒ 2 列 1 次 U-turn）。名冊欄在 1440–1920px 的
 * 螢幕上約 240–290px 寬，扣掉內距後 46 剛好落回 5 欄。
 * The target cell size decides the column count on desktop, and the design calls
 * for 5 (design.md §2.5). The panel is roughly 240–290px wide over 1440–1920px, so
 * 46 lands back on five columns after padding.
 */
const DEFAULT_TARGET_CELL = 46;

/** 各方向的箭頭線稿。座標固定，故寫成常數。 */
const ARROW_PATHS: Record<'uturn-right' | 'uturn-left' | 'tail-right' | 'tail-left', string> = {
  'uturn-right': '<path d="M41 2 V12 a8 8 0 0 1 -8 8 H18"/><path d="M24 14 L18 20 L24 26"/>',
  'uturn-left': '<path d="M7 2 V12 a8 8 0 0 0 8 8 H30"/><path d="M24 14 L30 20 L24 26"/>',
  'tail-right': '<path d="M41 2 V14"/><path d="M35 14 L41 20 L47 14"/>',
  'tail-left': '<path d="M7 2 V14"/><path d="M1 14 L7 20 L13 14"/>',
};

export interface MeltingListOptions {
  /** 名冊面板內的可捲動宿主，通常是 `[data-hook="melting-body"]`。 */
  host: HTMLElement;
  /** 合成鏈等級表，順序即名冊順序。 */
  levels: readonly LevelDef[];
  sprites: SpriteLoader;
  /** 已解鎖的前綴長度；預設 1（只知道 Lv1）。 */
  unlockedCount?: number;
  /** 期望的單格邊長，用來反推欄數。 */
  targetCellSize?: number;
  maxCols?: number;
  maxRows?: number;
}

export interface MeltingList {
  /** 依目前面板寬度重畫。尺寸變化時會自動呼叫。 */
  render(): void;
  /** 停止監看尺寸。 */
  destroy(): void;
}

export function createMeltingList(options: MeltingListOptions): MeltingList {
  const { host, levels, sprites } = options;
  const targetCellSize = options.targetCellSize ?? DEFAULT_TARGET_CELL;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const unlockedCount = options.unlockedCount ?? 1;

  const grid = el('div', 'roster');
  host.replaceChildren(grid);

  function buildCell(cell: RosterCell, gridRow: number): HTMLElement {
    const level = levels[cell.index];
    const node = el('div', 'roster-cell');
    node.style.gridRow = String(gridRow);
    node.style.gridColumn = String(cell.col + 1);

    if (level === undefined) return node;

    if (cell.index >= unlockedCount) {
      node.classList.add('roster-cell--locked');
      node.textContent = '???';
      node.setAttribute('aria-label', `第 ${cell.index + 1} 級，尚未解鎖`);
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
      image.addEventListener(
        'error',
        (): void => {
          art.replaceChildren(buildFallback(level));
        },
        { once: true },
      );
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

  /** 素材不可用時的替代：等級色塊 + 數字，與 Canvas 佔位圖同一套配色。 */
  function buildFallback(level: LevelDef): HTMLElement {
    const fallback = el('span', 'roster-cell__fallback', String(level.id));
    fallback.style.setProperty('--fallback-tint', placeholderColor(level.id));
    return fallback;
  }

  function buildArrow(arrow: RosterArrow, gridRow: number): HTMLElement {
    const wrap = el('div', `roster-arrow roster-arrow--${arrow.side}`);
    wrap.style.gridRow = String(gridRow);
    wrap.style.gridColumn = '1 / -1';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 48 28');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('roster-arrow__glyph');
    const key = `${arrow.kind}-${arrow.side}` as keyof typeof ARROW_PATHS;
    svg.innerHTML = ARROW_PATHS[key];
    wrap.append(svg);
    return wrap;
  }

  function buildGroupSeparator(groupIndex: number, gridRow: number): HTMLElement {
    const separator = el('div', 'roster-group');
    separator.style.gridRow = String(gridRow);
    separator.style.gridColumn = '1 / -1';
    separator.textContent = `▼ 第 ${groupIndex + 1} 組`;
    return separator;
  }

  function render(): void {
    const panelWidth = grid.clientWidth;
    if (panelWidth === 0) return;

    const layout = computeRosterLayout(levels.length, {
      panelWidth,
      targetCellSize,
      maxCols: options.maxCols,
      maxRows,
      unlockedCount,
    });

    grid.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
    grid.replaceChildren();

    const cellsByRow = new Map<number, RosterCell[]>();
    for (const cell of layout.cells) {
      const bucket = cellsByRow.get(cell.row);
      if (bucket === undefined) cellsByRow.set(cell.row, [cell]);
      else bucket.push(cell);
    }

    let gridRow = 1;
    for (let group = 0; group < layout.groups; group += 1) {
      const groupStart = group * maxRows;
      const rowsInGroup = Math.min(maxRows, layout.rows - groupStart);
      const isLastGroup = group === layout.groups - 1;

      for (let localRow = 0; localRow < rowsInGroup; localRow += 1) {
        const row = groupStart + localRow;

        /* DOM 順序即視覺順序：同一列的格子依欄序 append。 */
        for (const cell of (cellsByRow.get(row) ?? []).slice().sort((a, b) => a.col - b.col)) {
          grid.append(buildCell(cell, gridRow));
        }
        gridRow += 1;

        const isLastRowOfGroup = localRow === rowsInGroup - 1;
        if (!isLastRowOfGroup) {
          const uTurn = layout.arrows.find((arrow) => arrow.kind === 'uturn' && arrow.row === row);
          if (uTurn !== undefined) {
            grid.append(buildArrow(uTurn, gridRow));
            gridRow += 1;
          }
        } else if (!isLastGroup) {
          grid.append(buildGroupSeparator(group + 1, gridRow));
          gridRow += 1;
        }
      }
    }

    /* 尾箭頭指向下一個未解鎖槽位；全部解鎖後 `target` 為 null，整個不畫。 */
    const tail = layout.arrows.find((arrow) => arrow.kind === 'tail');
    if (tail !== undefined && tail.target !== null) {
      grid.append(buildArrow(tail, gridRow));
    }
  }

  const observer = new ResizeObserver((): void => render());
  observer.observe(grid);
  render();

  return {
    render,
    destroy: (): void => observer.disconnect(),
  };
}
