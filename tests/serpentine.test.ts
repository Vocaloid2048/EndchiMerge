/**
 * 蛇形佈局的單元測試。
 * Unit tests for the serpentine layout.
 *
 * 覆蓋 design.md §2.5 的「各數量下的行為對照」表：單列、一次 U-turn、多次 U-turn、
 * 向下開新一組，以及欄數的上下鉗制。
 * Covers the behaviour table in design.md §2.5: single row, one U-turn, several
 * U-turns, a second group, and the column clamps.
 */

import { describe, expect, it } from 'vitest';
import { computeRosterLayout, resolveColumns } from '../src/ui/serpentine';

/** 面板夠寬 → cols 固定 5（floor(250/50) = 5），方便斷言位置。 */
const WIDE = { panelWidth: 250, targetCellSize: 50 } as const;

function cellAt(layout: ReturnType<typeof computeRosterLayout>, index: number) {
  const cell = layout.cells.find((entry) => entry.index === index);
  if (cell === undefined) throw new Error(`no cell for index ${index}`);
  return cell;
}

describe('resolveColumns — 欄數鉗制 / column clamps', () => {
  it('never returns fewer than two columns', () => {
    expect(resolveColumns({ panelWidth: 80, targetCellSize: 50 })).toBe(2);
  });

  it('never exceeds maxCols', () => {
    expect(resolveColumns({ panelWidth: 1000, targetCellSize: 50 })).toBe(5);
    expect(resolveColumns({ panelWidth: 1000, targetCellSize: 50, maxCols: 8 })).toBe(8);
  });
});

describe('computeRosterLayout — 單列 / single row', () => {
  it('N <= cols produces one row and no U-turn', () => {
    const layout = computeRosterLayout(3, { ...WIDE, unlockedCount: 1 });

    expect(layout.cols).toBe(5);
    expect(layout.rows).toBe(1);
    expect(layout.groups).toBe(1);
    expect(layout.cells).toHaveLength(3);
    expect(layout.arrows.filter((arrow) => arrow.kind === 'uturn')).toHaveLength(0);
  });

  it('places the tail arrow at the right end of a left-to-right row', () => {
    const layout = computeRosterLayout(3, { ...WIDE, unlockedCount: 1 });
    const tail = layout.arrows.find((arrow) => arrow.kind === 'tail');

    expect(tail).toEqual({ kind: 'tail', row: 0, side: 'right', target: 1 });
  });
});

describe('computeRosterLayout — 一次 U-turn / one U-turn', () => {
  it('handles the current chain length (N = 10, cols = 5) as two rows', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 1 });

    expect(layout.rows).toBe(2);
    expect(layout.groups).toBe(1);
    expect(layout.cells).toHaveLength(10);
  });

  it('runs the first row left-to-right and the second right-to-left', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 1 });

    expect(cellAt(layout, 0)).toMatchObject({ row: 0, col: 0 });
    expect(cellAt(layout, 4)).toMatchObject({ row: 0, col: 4 });
    expect(cellAt(layout, 5)).toMatchObject({ row: 1, col: 4 });
    expect(cellAt(layout, 9)).toMatchObject({ row: 1, col: 0 });
  });

  it('emits exactly one U-turn, on the right of row 0', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 1 });
    const uTurns = layout.arrows.filter((arrow) => arrow.kind === 'uturn');

    expect(uTurns).toEqual([{ kind: 'uturn', row: 0, side: 'right', target: null }]);
  });

  it('puts the tail arrow on the left, following the reversed row', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 1 });
    const tail = layout.arrows.find((arrow) => arrow.kind === 'tail');

    expect(tail).toMatchObject({ kind: 'tail', row: 1, side: 'left' });
  });
});

describe('computeRosterLayout — 多次 U-turn / several U-turns', () => {
  it('adds a U-turn for every row that continues inside the group', () => {
    const layout = computeRosterLayout(20, { ...WIDE, unlockedCount: 1 });

    expect(layout.rows).toBe(4);
    expect(layout.groups).toBe(1);
    expect(layout.arrows.filter((arrow) => arrow.kind === 'uturn')).toHaveLength(3);
  });
});

describe('computeRosterLayout — 向下開新一組 / second group', () => {
  it('starts a new group once rows exceed maxRows', () => {
    const layout = computeRosterLayout(21, { ...WIDE, unlockedCount: 1 });

    expect(layout.rows).toBe(5);
    expect(layout.groups).toBe(2);
    /* 組界不畫 U-turn：3 個 U-turn 來自第 0–2 列，第 3 列之後換組。 */
    expect(layout.arrows.filter((arrow) => arrow.kind === 'uturn')).toHaveLength(3);
  });

  it('restarts a new group left-to-right', () => {
    const layout = computeRosterLayout(21, { ...WIDE, unlockedCount: 1 });
    const firstOfGroupTwo = cellAt(layout, 20);

    expect(firstOfGroupTwo).toMatchObject({ group: 1, row: 4, localRow: 0, col: 0 });
  });
});

describe('computeRosterLayout — 尾箭頭目標 / tail target', () => {
  it('points at the first locked slot', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 4 });
    expect(layout.arrows.find((arrow) => arrow.kind === 'tail')?.target).toBe(4);
  });

  it('hides the tail arrow once everything is unlocked', () => {
    const layout = computeRosterLayout(10, { ...WIDE, unlockedCount: 10 });
    expect(layout.arrows.find((arrow) => arrow.kind === 'tail')?.target).toBeNull();
  });
});

describe('computeRosterLayout — 邊界 / edges', () => {
  it('returns an empty layout for zero slots', () => {
    const layout = computeRosterLayout(0, WIDE);
    expect(layout).toMatchObject({ rows: 0, groups: 0, cells: [], arrows: [] });
    expect(layout.cols).toBe(5);
  });

  it('fills a partial last row without inventing cells', () => {
    const layout = computeRosterLayout(7, { ...WIDE, unlockedCount: 1 });
    expect(layout.rows).toBe(2);
    expect(layout.cells).toHaveLength(7);
    /* 第二列由右至左：索引 5 在最右欄、索引 6 在其左側。 */
    expect(cellAt(layout, 5)).toMatchObject({ row: 1, col: 4 });
    expect(cellAt(layout, 6)).toMatchObject({ row: 1, col: 3 });
  });
});
