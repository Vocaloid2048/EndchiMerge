/**
 * 蛇形佈局的單元測試：S 形走位、設計稿 19 格的唯一缺口、單一連續走線、走線在最後一格結束。
 * Unit tests for the serpentine layout: the S-shaped walk, the 19-slot gap, one continuous track, and the track ending on the last slot.
 */

import { describe, expect, it } from 'vitest';
import {
  cellCentre,
  cellOrigin,
  columnCentre,
  computeRosterLayout,
  gridOffsetX,
  rowCentre,
  slotAt,
  trackLanes,
} from '../src/ui/serpentine';
import { MELTING } from '../src/core/design';

/** 設計稿的格網：4 欄 × 5 列。 */
const { cols: COLS, rows: ROWS, cellWidth: CW, cellHeight: CH } = MELTING;
const { laneOverhang, cornerRadius, strokeWidth, arrowLength, arrowHalfWidth } = MELTING.track;

/** 4 欄格網在內容區裡的置中偏移。 */
const OFFSET_4 = gridOffsetX(COLS);

/** 左右走道：置中後的格網左右緣再各向外伸 `laneOverhang`。 */
const LEFT_LANE_4 = OFFSET_4 - laneOverhang;
const RIGHT_LANE_4 = OFFSET_4 + COLS * CW + laneOverhang;

/** 把 SVG `d` 拆成 `[指令, ...數字]`，讓斷言可以按語意寫而不是比字串。 */
function parsePath(d: string): { cmd: string; args: number[] }[] {
  const out: { cmd: string; args: number[] }[] = [];
  const pattern = /([A-Za-z])([^A-Za-z]*)/g;
  let match = pattern.exec(d);

  while (match !== null) {
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter((token) => token.length > 0)
      .map(Number);
    out.push({ cmd: match[1], args });
    match = pattern.exec(d);
  }

  return out;
}

describe('slotAt — 橫向蛇形 / row-major S walk', () => {
  it('walks the first row left to right', () => {
    expect(slotAt(0, 4)).toEqual({ col: 0, row: 0 });
    expect(slotAt(2, 4)).toEqual({ col: 2, row: 0 });
    expect(slotAt(3, 4)).toEqual({ col: 3, row: 0 });
  });

  it('turns around and walks the second row right to left', () => {
    expect(slotAt(4, 4)).toEqual({ col: 3, row: 1 });
    expect(slotAt(5, 4)).toEqual({ col: 2, row: 1 });
    expect(slotAt(7, 4)).toEqual({ col: 0, row: 1 });
  });

  it('resumes left to right on the third row', () => {
    expect(slotAt(8, 4)).toEqual({ col: 0, row: 2 });
    expect(slotAt(11, 4)).toEqual({ col: 3, row: 2 });
  });

  it('advances one row every `cols` slots, never skipping one', () => {
    for (let index = 0; index < 60; index += 1) {
      expect(slotAt(index, 4).row).toBe(Math.floor(index / 4));
    }
  });

  it('respects a non-default column count', () => {
    expect(slotAt(0, 3)).toEqual({ col: 0, row: 0 });
    expect(slotAt(2, 3)).toEqual({ col: 2, row: 0 });
    expect(slotAt(3, 3)).toEqual({ col: 2, row: 1 });
    expect(slotAt(5, 3)).toEqual({ col: 0, row: 1 });
  });
});

describe('格網幾何 / grid geometry', () => {
  it('places a cell at col×pitch, row×pitch (offset defaults to 0)', () => {
    expect(cellOrigin(2, 3)).toEqual({ x: 2 * CW, y: 3 * CH });
  });

  it('shifts a cell right by the centring offset when one is given', () => {
    expect(cellOrigin(2, 3, OFFSET_4)).toEqual({ x: OFFSET_4 + 2 * CW, y: 3 * CH });
  });

  it('centres a cell half a cell inside its origin', () => {
    expect(cellCentre(0, 0)).toEqual({ x: CW / 2, y: CH / 2 });
    expect(cellCentre(1, 2)).toEqual({ x: CW + CW / 2, y: 2 * CH + CH / 2 });
  });

  it('centres the used grid in the content box', () => {
    expect(OFFSET_4).toBe((MELTING.content.width - COLS * CW) / 2);
    expect(gridOffsetX(1)).toBe((MELTING.content.width - CW) / 2);
  });

  it('puts the column and row centres exactly on the cell centres', () => {
    for (let col = 0; col < COLS; col += 1) {
      expect(columnCentre(col)).toBe(cellCentre(col, 0).x);
    }
    for (let row = 0; row < ROWS; row += 1) {
      expect(rowCentre(row)).toBe(cellCentre(0, row).y);
    }
  });

  it('derives the lanes: the centred grid edges widened by one overhang each side', () => {
    expect(trackLanes(COLS)).toEqual({ leftLane: LEFT_LANE_4, rightLane: RIGHT_LANE_4 });
    expect(trackLanes(COLS).leftLane).toBe(
      MELTING.content.width - trackLanes(COLS).rightLane,
    );
    expect(trackLanes(2).leftLane).toBe(gridOffsetX(2) - laneOverhang);
    expect(trackLanes(2).rightLane).toBe(gridOffsetX(2) + 2 * CW + laneOverhang);
  });
});

describe('computeRosterLayout — 設計稿的 19 格 / the mock’s 19 slots', () => {
  it('fills a 4×5 grid with the default options', () => {
    const layout = computeRosterLayout({ count: 19 });

    expect(layout.cols).toBe(COLS);
    expect(layout.rows).toBe(ROWS);
    expect(layout.slots).toHaveLength(19);
  });

  it('leaves its single gap in the last row, column 4 — the signature of a row-major walk', () => {
    const layout = computeRosterLayout({ count: 19 });

    const perRow = [0, 1, 2, 3, 4].map(
      (row) => layout.slots.filter((slot) => slot.row === row).length,
    );

    expect(perRow).toEqual([4, 4, 4, 4, 3]);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 4)).toBe(false);
  });

  it('fills the grid completely once the chain reaches 20', () => {
    const layout = computeRosterLayout({ count: 20 });

    expect(layout.slots).toHaveLength(20);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 4)).toBe(true);
    expect(layout.slots.at(-1)).toMatchObject({ col: 3, row: 4 });
  });

  it('numbers the slots from zero, in chain order, with no duplicate cells', () => {
    const layout = computeRosterLayout({ count: 20 });
    const keys = layout.slots.map((slot) => `${String(slot.col)}:${String(slot.row)}`);

    expect(layout.slots.map((slot) => slot.index)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('走線 / the track', () => {
  it('is absent when the chain is empty', () => {
    expect(computeRosterLayout({ count: 0 }).track).toBeNull();
  });

  it('passes through every row centre of the grid', () => {
    const centres = computeRosterLayout({ count: 19 }).track?.rowCentres;

    expect(centres).toEqual([0, 1, 2, 3, 4].map(rowCentre));
  });

  it('starts on the left lane of the first row', () => {
    const [first] = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');

    expect(first).toEqual({ cmd: 'M', args: [LEFT_LANE_4, rowCentre(0)] });
  });

  it('is one continuous polyline: a single M, then only L and A', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');

    expect(commands.filter((command) => command.cmd === 'M')).toHaveLength(1);
    expect(commands.filter((command) => command.cmd === 'L').length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(['M', 'L', 'A']).toContain(command.cmd);
    }
  });

  it('emits two fillets per row transition, at the mock’s 32 radius', () => {
    const arcs = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '').filter(
      (command) => command.cmd === 'A',
    );

    expect(arcs).toHaveLength(2 * (ROWS - 1));
    for (const arc of arcs) {
      expect(arc.args[0]).toBe(cornerRadius);
      expect(arc.args[1]).toBe(cornerRadius);
      expect(arc.args[2]).toBe(0);
      expect(arc.args[3]).toBe(0);
      expect([0, 1]).toContain(arc.args[4]);
    }
  });

  it('sweeps rightward turns one way and leftward turns the other, never mixed', () => {
    const arcs = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '').filter(
      (command) => command.cmd === 'A',
    );
    const sweeps = arcs.map((arc) => arc.args[4]);

    expect(sweeps).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('keeps every x on the widened grid: a lane, a lane inset by one fillet radius, or the last slot centre', () => {
    /*
     * 實線段的每個水平座標都必須落在左／右走道、走道內縮一個圓角半徑、或最後一槽中心。
     * Every x of the solid run must be a lane, a lane inset by one fillet radius, or the last
     * slot's centre.
     */
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');
    const lastSlotX = OFFSET_4 + 2 * CW + CW / 2;
    const allowed = new Set([
      LEFT_LANE_4,
      RIGHT_LANE_4,
      LEFT_LANE_4 + cornerRadius,
      RIGHT_LANE_4 - cornerRadius,
      lastSlotX,
    ]);

    for (const command of commands) {
      for (const x of command.cmd === 'A' ? command.args.slice(-2, -1) : command.args.slice(0, 1)) {
        expect(allowed.has(x)).toBe(true);
      }
    }
  });

  it('stops the track on the last slot, with nothing past it', () => {
    const track = computeRosterLayout({ count: 19 }).track;
    const lastSlotX = OFFSET_4 + 2 * CW + CW / 2;

    expect(parsePath(track?.path ?? '').at(-1)).toEqual({ cmd: 'L', args: [lastSlotX, rowCentre(4)] });
  });

  it('also stops on the last slot when the chain fills the grid', () => {
    const track = computeRosterLayout({ count: 20 }).track;
    const lastSlotX = OFFSET_4 + 3 * CW + CW / 2;

    expect(parsePath(track?.path ?? '').at(-1)).toEqual({ cmd: 'L', args: [lastSlotX, rowCentre(4)] });
  });

  it('locks the whole 4-column route to the centred, widened geometry', () => {
    /*
     * 幾何合約：整條 `d` 寫死，任何改動都應該是有意識的。
     * The geometry contract: the entire `d`, frozen, so any change here must be deliberate.
     */
    expect(computeRosterLayout({ count: 19 }).track?.path).toBe(
      [
        'M 7 47.2',
        'L 328 47.2',
        'A 32 32 0 0 1 360 79.2',
        'L 360 109.6',
        'A 32 32 0 0 1 328 141.6',
        'L 39 141.6',
        'A 32 32 0 0 0 7 173.6',
        'L 7 204',
        'A 32 32 0 0 0 39 236',
        'L 328 236',
        'A 32 32 0 0 1 360 268',
        'L 360 298.4',
        'A 32 32 0 0 1 328 330.4',
        'L 39 330.4',
        'A 32 32 0 0 0 7 362.4',
        'L 7 392.8',
        'A 32 32 0 0 0 39 424.8',
        'L 225.625 424.8',
      ].join(' '),
    );
  });

  it('draws a single-row chain without any turn', () => {
    const track = computeRosterLayout({ count: 4, cols: 4, rows: 1 }).track;
    const lastSlotX = OFFSET_4 + 3 * CW + CW / 2;

    expect(parsePath(track?.path ?? '').filter((c) => c.cmd === 'A')).toHaveLength(0);
    expect(track?.path).toBe(
      [`M ${String(LEFT_LANE_4)} 47.2`, `L ${String(lastSlotX)} 47.2`].join(' '),
    );
  });

  it('places the arrowhead with its tip on the last slot centre', () => {
    const lastSlotX = OFFSET_4 + 2 * CW + CW / 2;
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');

    expect(commands).toEqual([
      { cmd: 'M', args: [lastSlotX - arrowLength, rowCentre(4) - arrowHalfWidth] },
      { cmd: 'L', args: [lastSlotX, rowCentre(4)] },
      { cmd: 'L', args: [lastSlotX - arrowLength, rowCentre(4) + arrowHalfWidth] },
    ]);
  });

  it('points the arrow along the last row, rightward on an even row', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');
    const [start, tip] = commands;

    expect(tip.args[0]).toBeGreaterThan(start.args[0]);
    expect(tip.args[1]).toBe(rowCentre(4));
  });

  it('mirrors the arrow when the chain ends on a leftward row', () => {
    /* 7 格落在 2 欄 5 列：最後一格在奇數列，該列由右至左走，箭頭因此向左。 */
    /* Seven slots on 2 columns × 5 rows: the last one sits on an odd (leftward) row, so the arrow points left. */
    const layout = computeRosterLayout({ count: 7 });
    const last = layout.slots.at(-1);
    expect(last?.row).toBe(3);

    const centre = cellCentre(last!.col, last!.row, layout.offsetX);
    const commands = parsePath(layout.track?.arrow ?? '');
    /* 路徑字串會把浮點尾巴砍掉，所以比較前用同一把尺。 */
    /* The path string trims float tails, so the comparison uses the same ruler. */
    const round = (value: number): number => Number(value.toFixed(3));
    const actual = commands.map((command) => ({
      cmd: command.cmd,
      args: command.args.map(round),
    }));

    expect(actual).toEqual([
      { cmd: 'M', args: [round(centre.x + arrowLength), round(centre.y - arrowHalfWidth)] },
      { cmd: 'L', args: [round(centre.x), round(centre.y)] },
      { cmd: 'L', args: [round(centre.x + arrowLength), round(centre.y + arrowHalfWidth)] },
    ]);
  });

  it('keeps the whole arrowhead inside the last cell, never past it', () => {
    /*
     * 箭翼向後張開 20.2，尖端在最一格的中心 —— 整支箭頭都在那一格之內，不會伸到格網外。
     * The wings reach back 20.2 from the last slot's centre, so the arrowhead stays inside that
     * cell and never reaches outside the grid.
     */
    const lastSlotX = OFFSET_4 + 2 * CW + CW / 2;
    const leftmost = lastSlotX - arrowLength;

    expect(leftmost).toBeGreaterThan(OFFSET_4 + 2 * CW);
    expect(leftmost + arrowLength).toBe(lastSlotX);
    expect(RIGHT_LANE_4).toBeGreaterThanOrEqual(OFFSET_4 + COLS * CW);
  });

  it('uses the mock’s stroke weight of 5', () => {
    expect(strokeWidth).toBe(5);
  });
});

describe('computeRosterLayout — 已解鎖前綴 / unlocked prefix', () => {
  it('keeps the unlocked count as given', () => {
    expect(computeRosterLayout({ count: 19, unlockedCount: 7 }).unlockedCount).toBe(7);
  });

  it('clamps the unlocked count into [0, count]', () => {
    expect(computeRosterLayout({ count: 5, unlockedCount: 99 }).unlockedCount).toBe(5);
    expect(computeRosterLayout({ count: 5, unlockedCount: -3 }).unlockedCount).toBe(0);
  });

  it('defaults to nothing unlocked', () => {
    expect(computeRosterLayout({ count: 5 }).unlockedCount).toBe(0);
  });
});

describe('computeRosterLayout — 欄數 / columns', () => {
  it('only walks as many columns as the chain needs', () => {
    expect(computeRosterLayout({ count: 3 }).cols).toBe(1);
    expect(computeRosterLayout({ count: 6 }).cols).toBe(2);
    expect(computeRosterLayout({ count: 19 }).cols).toBe(4);
  });

  it('never exceeds the configured column count', () => {
    expect(computeRosterLayout({ count: 200 }).cols).toBe(COLS);
    expect(computeRosterLayout({ count: 200, cols: 2 }).cols).toBe(2);
  });

  it('honours explicit cols and rows', () => {
    const layout = computeRosterLayout({ count: 10, cols: 2, rows: 5 });

    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(5);
    expect(layout.slots.at(-1)).toMatchObject({ col: 1, row: 4 });
    expect(layout.track?.rowCentres).toEqual([0, 1, 2, 3, 4].map(rowCentre));
  });
});

describe('computeRosterLayout — 邊界 / edges', () => {
  it('returns an empty layout for a zero-length chain', () => {
    const layout = computeRosterLayout({ count: 0 });

    expect(layout.slots).toEqual([]);
    expect(layout.track).toBeNull();
    expect(layout.unlockedCount).toBe(0);
    expect(layout.cols).toBe(COLS);
    expect(layout.rows).toBe(ROWS);
  });

  it('truncates a fractional count instead of inventing a half slot', () => {
    expect(computeRosterLayout({ count: 7.9 }).slots).toHaveLength(7);
  });
});
