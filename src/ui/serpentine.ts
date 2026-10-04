/**
 * MELTING LIST 的蛇形（牛耕式）自動佈局。
 * Serpentine (boustrophedon) auto-layout for the MELTING LIST.
 *
 * 依 design.md §2.5（D19）實作。名冊格**不寫死數量**：欄數由面板寬度推得，列數由
 * 角色數量推得；超過每組上限時向下另開一組，每組重新由左至右開始。
 * Implements design.md §2.5 (D19). The grid is not hard-coded: the column count
 * comes from the panel width, the row count from the number of characters, and
 * anything beyond a group's row cap starts a new group that restarts left-to-right.
 *
 * 這裡**只有幾何**，不碰 DOM、不碰顏色。純函式才能把「N=3 / 5 / 10 / 21 各長怎樣」
 * 全部寫成單元測試，而不是靠瞇著眼看畫面。
 * This module is pure geometry: no DOM, no colours. Purity is what lets every
 * "what does N=3/5/10/21 look like" case become a unit test instead of squinting
 * at the screen.
 */

export interface RosterCell {
  /** 0 為底的合成鏈索引。 */
  index: number;
  /** 所屬蛇形組（0 為底）。 */
  group: number;
  /** 全域列（0 為底），跨組連續。 */
  row: number;
  /** 組內列（0 為底）；決定該列的行進方向。 */
  localRow: number;
  /** 欄（0 為底）。 */
  col: number;
}

export type ArrowKind = 'uturn' | 'tail';

export interface RosterArrow {
  kind: ArrowKind;
  /** 箭頭所在的列（0 為底，全域）。 */
  row: number;
  /** 附著在該列的右端或左端，取決於該列的行進方向。 */
  side: 'right' | 'left';
  /**
   * 僅 `tail` 使用：指向的格索引；`null` 表示沒有未解鎖槽位可指（此時不畫箭頭）。
   * Only used by `tail`. `null` means there is no locked slot left to point at.
   */
  target: number | null;
}

export interface RosterLayout {
  cols: number;
  rows: number;
  groups: number;
  cells: RosterCell[];
  arrows: RosterArrow[];
}

export interface RosterOptions {
  /** 名冊面板可用寬度（CSS px）。 */
  panelWidth: number;
  /** 期望的單格邊長（含間距）。 */
  targetCellSize: number;
  /** 欄數上限，預設 5。 */
  maxCols?: number;
  /** 每組蛇形最多幾列，預設 4；超過就向下開新組。 */
  maxRows?: number;
  /** 已解鎖的**前綴長度**（解鎖沿合成鏈單調遞增）。 */
  unlockedCount?: number;
}

const DEFAULT_MAX_COLS = 5;
const DEFAULT_MAX_ROWS = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 由面板寬度推欄數。
 * Derive the column count from the panel width.
 *
 * 下限 2 是為了避免窄面板退化成單欄（單欄就沒有蛇形可走了）。
 * The floor of 2 stops a narrow panel from collapsing to a single column, where a
 * serpentine would be pointless.
 */
export function resolveColumns(options: RosterOptions): number {
  const maxCols = options.maxCols ?? DEFAULT_MAX_COLS;
  const raw = Math.floor(options.panelWidth / options.targetCellSize);
  return clamp(raw, 2, Math.max(2, maxCols));
}

/**
 * 計算名冊的完整幾何。
 * Compute the roster's full geometry.
 *
 * @param count 名冊格總數（＝合成鏈長度）/ Total slots, i.e. the chain length.
 * @param options 面板寬度、目標格大小與上限 / Panel width, target cell size, caps.
 */
export function computeRosterLayout(count: number, options: RosterOptions): RosterLayout {
  const cols = resolveColumns(options);
  const maxRows = Math.max(1, options.maxRows ?? DEFAULT_MAX_ROWS);
  const total = Math.max(0, Math.trunc(count));

  if (total === 0) {
    return { cols, rows: 0, groups: 0, cells: [], arrows: [] };
  }

  const rows = Math.ceil(total / cols);
  const groups = Math.ceil(rows / maxRows);

  const cells: RosterCell[] = [];
  for (let index = 0; index < total; index += 1) {
    const row = Math.floor(index / cols);
    const group = Math.floor(row / maxRows);
    const localRow = row - group * maxRows;
    /* 每個組都重新由左至右開始，所以用「組內列」的奇偶決定方向。 */
    const col = localRow % 2 === 0 ? index % cols : cols - 1 - (index % cols);
    cells.push({ index, group, row, localRow, col });
  }

  const arrows: RosterArrow[] = [];
  const lastRow = rows - 1;

  for (let row = 0; row < lastRow; row += 1) {
    /* 組內換列才畫 U-turn；組與組之間改以組別分隔列處理。 */
    const localRow = row % maxRows;
    const nextLocalRow = (row + 1) % maxRows;
    if (nextLocalRow !== localRow + 1) continue;

    arrows.push({
      kind: 'uturn',
      row,
      /* 奇數列由右至左，走到左端；偶數列反之。 */
      side: localRow % 2 === 0 ? 'right' : 'left',
      target: null,
    });
  }

  const lastLocalRow = lastRow % maxRows;
  const unlockedCount = Math.max(0, Math.min(options.unlockedCount ?? 0, total));
  arrows.push({
    kind: 'tail',
    row: lastRow,
    side: lastLocalRow % 2 === 0 ? 'right' : 'left',
    /* 全部解鎖後就沒有下一個未解鎖槽位，尾箭頭應隱藏。 */
    target: unlockedCount < total ? unlockedCount : null,
  });

  return { cols, rows, groups, cells, arrows };
}
