/**
 * 蛇形佈局的單元測試。
 * Unit tests for the serpentine layout.
 *
 * 守住三件事：(1) 走位是**橫向蛇形（S 形）**——第一列由左而右、第二列由右而左（使用者
 * 定案），(2) 設計稿的 19 個槽位會落在 4 欄 × 5 列的哪一格 —— 那個「缺一格」的位置就是
 * 判斷蛇形方向的唯一證據，(3) 走線是**一條**連續折線，帶著設計稿的 32 圓角與向下箭頭。
 * Three things are pinned: (1) the walk is **row-major (an S shape)** — row 1 left to right,
 * row 2 right to left (the user's decision), (2) which of the 4×5 grid cells the mock's 19
 * slots occupy — the single gap is the only evidence for the walking direction — and (3) the
 * track is **one** continuous polyline carrying the mock's 32-radius fillets and a downward
 * arrow.
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
const { laneOverhang, exitInset, cornerRadius, strokeWidth, arrowLength, arrowHalfWidth } =
  MELTING.track;

/** 4 欄格網在內容區裡的置中偏移（使用者定案：S 形左右置中）。 */
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
    /* 3 欄一列：偶數列由左而右，奇數列由右而左。 */
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
    /* 4 欄佔 337、內容區 367 → 左右各留 15。 */
    expect(OFFSET_4).toBe((MELTING.content.width - COLS * CW) / 2);
    /* 1 欄（84.25）置中在 367 裡。 */
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
    /* 左右對稱：兩條走道到內容區左右緣的距離相等。 */
    expect(trackLanes(COLS).leftLane).toBe(
      MELTING.content.width - trackLanes(COLS).rightLane,
    );
    /* 欄數改變時走道跟著（置中後的）格網走。 */
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

    /* 前 4 列各 4 格、第 5 列 3 格。直行蛇形會把空位留在**第 1 列**，與此不符。 */
    expect(perRow).toEqual([4, 4, 4, 4, 3]);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 4)).toBe(false);
  });

  it('fills the grid completely once the chain reaches 20', () => {
    const layout = computeRosterLayout({ count: 20 });

    expect(layout.slots).toHaveLength(20);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 4)).toBe(true);
    /* 第 5 列是偶數列，由左而右，所以第 20 顆停在第 5 列的最右邊。 */
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

    /* 第 1 列往右（sweep 1）→ 2 個；第 2 列往左（sweep 0）→ 2 個；如此類推。 */
    expect(sweeps).toEqual([1, 1, 0, 0, 1, 1, 0, 0]);
  });

  it('keeps every x on the widened grid: a lane, a lane inset by one fillet radius, or the last slot centre', () => {
    /*
     * 這條守住「走線不會飄走」：實線段的每一個水平座標都必須是左／右走道、走道內縮一個
     * 圓角半徑（＝列上那一段的端點）、或最後一個槽位的中心（實線／虛線分界）。
     * Guards against the track drifting: every x of the solid run must be a lane, a lane
     * inset by one fillet radius (the row run's endpoints), or the last slot's centre (the
     * solid/dashed boundary).
     */
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');
    /* count 19 的最後一格是第 5 列第 3 欄（row-major：index 18 → col 2）。 */
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

  it('stops the solid run at the last slot and hands the rest to the dashed tail', () => {
    const track = computeRosterLayout({ count: 19 }).track;
    const lastSlotX = OFFSET_4 + 2 * CW + CW / 2;
    const exitY = ROWS * CH - exitInset;

    /* 實線的最後一筆落在最後一格的中心（第 5 列第 3 欄的中心）。 */
    expect(parsePath(track?.path ?? '').at(-1)).toEqual({ cmd: 'L', args: [lastSlotX, rowCentre(4)] });
    /* 虛線段：由最後一格中心沿第 5 列走到右走道，直落出欄線。 */
    expect(track?.dash).toBe(
      [`M ${String(lastSlotX)} ${String(rowCentre(4))}`, `L ${String(RIGHT_LANE_4)} ${String(rowCentre(4))}`, `L ${String(RIGHT_LANE_4)} ${String(exitY)}`].join(' '),
    );
  });

  it('dashes only the descent when the chain fills the grid', () => {
    const track = computeRosterLayout({ count: 20 }).track;
    const lastSlotX = OFFSET_4 + 3 * CW + CW / 2;
    const exitY = ROWS * CH - exitInset;

    expect(parsePath(track?.path ?? '').at(-1)).toEqual({ cmd: 'L', args: [lastSlotX, rowCentre(4)] });
    expect(track?.dash).toBe(
      [`M ${String(lastSlotX)} ${String(rowCentre(4))}`, `L ${String(RIGHT_LANE_4)} ${String(rowCentre(4))}`, `L ${String(RIGHT_LANE_4)} ${String(exitY)}`].join(' '),
    );
  });

  it('locks the whole 4-column route to the centred, widened geometry', () => {
    /*
     * 這條是「幾何合約」：把整條 `d` 寫死。它來自使用者定案（格網置中＋走道外拓＋
     * 最後一隻之後虛線，見 `core/design.ts` 的 `MELTING.track`），任何改動都應該是
     * 有意識的，而不是順手漂移。
     * The geometry contract: the entire `d`, frozen. It encodes the user's decisions
     * (centred grid, widened lanes, dashed tail past the last dumpling — see
     * `MELTING.track` in `core/design.ts`), so any change here must be deliberate.
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
    const exitY = 1 * CH - exitInset;
    const lastSlotX = OFFSET_4 + 3 * CW + CW / 2;

    expect(parsePath(track?.path ?? '').filter((c) => c.cmd === 'A')).toHaveLength(0);
    expect(track?.path).toBe(
      [`M ${String(LEFT_LANE_4)} 47.2`, `L ${String(lastSlotX)} 47.2`].join(' '),
    );
    expect(track?.dash).toBe(
      [`M ${String(lastSlotX)} 47.2`, `L ${String(RIGHT_LANE_4)} 47.2`, `L ${String(RIGHT_LANE_4)} ${String(exitY)}`].join(' '),
    );
  });

  it('places the arrowhead with its tip on the end of the dashed tail', () => {
    const exitY = ROWS * CH - exitInset;
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');

    expect(commands).toEqual([
      { cmd: 'M', args: [RIGHT_LANE_4 - arrowHalfWidth, exitY - arrowLength] },
      { cmd: 'L', args: [RIGHT_LANE_4, exitY] },
      { cmd: 'L', args: [RIGHT_LANE_4 + arrowHalfWidth, exitY - arrowLength] },
    ]);
  });

  it('points the arrow down, not up or sideways', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');
    const [, middle, last] = commands;

    /* 中間那一點的 y 最大（＝最低），兩隻翼都比它高。 */
    expect(middle.args[1]).toBeGreaterThan(last.args[1]);
    expect(middle.args[0]).toBe(last.args[0] - arrowHalfWidth);
  });

  it('lets the arrow overshoot the content edge like the mock, still inside the panel', () => {
    /*
     * 走道外拓之後，箭頭的兩翼伸過內容區右緣 —— 與設計稿一致（`overflow: visible`）。
     * 但整支箭頭仍在 MELTING LIST 面板（435 寬、內容區左緣 21）之內。
     * With the widened lanes the arrowhead's wings overshoot the content box's right edge —
     * like the mock (`overflow: visible`). The whole arrow still sits inside the MELTING LIST
     * panel (435 wide, content box 21 from the panel's left edge).
     */
    const right = RIGHT_LANE_4 + arrowHalfWidth;

    expect(right).toBeGreaterThan(MELTING.content.width);
    expect(right + MELTING.content.x).toBeLessThan(435);
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
    /* 3 顆填不滿第一列，所以只用到 1 欄，槽位不會掉到畫面外。 */
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
    /* 第 5 列是偶數列，由左而右，最後一顆落在第 2 欄。 */
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
    /* 空鏈仍回報設計稿的欄列數，讓外框尺寸保持穩定。 */
    expect(layout.cols).toBe(COLS);
    expect(layout.rows).toBe(ROWS);
  });

  it('truncates a fractional count instead of inventing a half slot', () => {
    expect(computeRosterLayout({ count: 7.9 }).slots).toHaveLength(7);
  });
});
