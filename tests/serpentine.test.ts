/**
 * 蛇形佈局的單元測試。
 * Unit tests for the serpentine layout.
 *
 * 守住三件事：(1) 走位是**直行蛇形**（column-major），(2) 設計稿的 19 個槽位會落在 4 欄
 * × 5 列的哪一格 —— 那個「缺一格」的位置就是判斷蛇形方向的唯一證據，(3) 走線是**一條**
 * 連續折線，帶著設計稿指定的 32 圓角與向下箭頭。
 * Three things are pinned: (1) the walk is **column-major**, (2) which of the 4×5 grid cells
 * the mock's 19 slots occupy — the single gap is the only evidence for the walking direction
 * — and (3) the track is **one** continuous polyline carrying the mock's 32-radius fillets
 * and a downward arrow.
 */

import { describe, expect, it } from 'vitest';
import {
  cellCentre,
  cellOrigin,
  columnCentre,
  computeRosterLayout,
  slotAt,
} from '../src/ui/serpentine';
import { MELTING } from '../src/core/design';

/** 設計稿的格網：4 欄 × 5 列。 */
const { cols: COLS, rows: ROWS, cellWidth: CW, cellHeight: CH } = MELTING;
const { topLane, bottomLane, exitX, cornerRadius, strokeWidth, arrowLength, arrowHalfWidth } =
  MELTING.track;

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

describe('slotAt — 直行蛇形 / column-major walk', () => {
  it('walks the first column top to bottom', () => {
    expect(slotAt(0, 5)).toEqual({ col: 0, row: 0 });
    expect(slotAt(2, 5)).toEqual({ col: 0, row: 2 });
    expect(slotAt(4, 5)).toEqual({ col: 0, row: 4 });
  });

  it('turns around and walks the second column bottom to top', () => {
    expect(slotAt(5, 5)).toEqual({ col: 1, row: 4 });
    expect(slotAt(7, 5)).toEqual({ col: 1, row: 2 });
    expect(slotAt(9, 5)).toEqual({ col: 1, row: 0 });
  });

  it('resumes top to bottom on the third column', () => {
    expect(slotAt(10, 5)).toEqual({ col: 2, row: 0 });
    expect(slotAt(14, 5)).toEqual({ col: 2, row: 4 });
  });

  it('advances one column every `rows` slots, never skipping one', () => {
    for (let index = 0; index < 60; index += 1) {
      expect(slotAt(index, 5).col).toBe(Math.floor(index / 5));
    }
  });

  it('respects a non-default row count', () => {
    /* 3 列一欄：偶數欄由上而下，奇數欄由下而上。 */
    expect(slotAt(0, 3)).toEqual({ col: 0, row: 0 });
    expect(slotAt(2, 3)).toEqual({ col: 0, row: 2 });
    expect(slotAt(3, 3)).toEqual({ col: 1, row: 2 });
    expect(slotAt(5, 3)).toEqual({ col: 1, row: 0 });
  });
});

describe('格網幾何 / grid geometry', () => {
  it('places a cell at col×pitch, row×pitch', () => {
    expect(cellOrigin(2, 3)).toEqual({ x: 2 * CW, y: 3 * CH });
  });

  it('centres a cell half a cell inside its origin', () => {
    expect(cellCentre(0, 0)).toEqual({ x: CW / 2, y: CH / 2 });
    expect(cellCentre(1, 2)).toEqual({ x: CW + CW / 2, y: 2 * CH + CH / 2 });
  });

  it('puts the column centre exactly on the cell centre', () => {
    for (let col = 0; col < COLS; col += 1) {
      expect(columnCentre(col)).toBe(cellCentre(col, 0).x);
    }
  });
});

describe('computeRosterLayout — 設計稿的 19 格 / the mock’s 19 slots', () => {
  it('fills a 4×5 grid with the default options', () => {
    const layout = computeRosterLayout({ count: 19 });

    expect(layout.cols).toBe(COLS);
    expect(layout.rows).toBe(ROWS);
    expect(layout.slots).toHaveLength(19);
  });

  it('leaves its single gap in column 4, row 1 — the signature of a column-major walk', () => {
    const layout = computeRosterLayout({ count: 19 });

    const perRow = [0, 1, 2, 3, 4].map(
      (row) => layout.slots.filter((slot) => slot.row === row).length,
    );

    /* 第 1 列只有 3 格、其餘各 4 格。橫向蛇形會把空位留在**最後一列**，與此不符。 */
    expect(perRow).toEqual([3, 4, 4, 4, 4]);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 0)).toBe(false);
  });

  it('fills the grid completely once the chain reaches 20', () => {
    const layout = computeRosterLayout({ count: 20 });

    expect(layout.slots).toHaveLength(20);
    expect(layout.slots.some((slot) => slot.col === 3 && slot.row === 0)).toBe(true);
    /* 第 4 欄是奇數欄，由下而上，所以第 20 顆停在第 4 欄的最上面。 */
    expect(layout.slots.at(-1)).toMatchObject({ col: 3, row: 0 });
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

  it('spans exactly the columns the chain uses', () => {
    expect(computeRosterLayout({ count: 3 }).track?.columns).toEqual([columnCentre(0)]);
    expect(computeRosterLayout({ count: 6 }).track?.columns).toEqual([
      columnCentre(0),
      columnCentre(1),
    ]);
    expect(computeRosterLayout({ count: 19 }).track?.columns).toHaveLength(4);
  });

  it('starts in the top lane of the first column', () => {
    const [first] = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');

    expect(first).toEqual({ cmd: 'M', args: [columnCentre(0), topLane] });
  });

  it('is one continuous polyline: a single M, then only L and A', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');

    expect(commands.filter((command) => command.cmd === 'M')).toHaveLength(1);
    expect(commands.filter((command) => command.cmd === 'L').length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(['M', 'L', 'A']).toContain(command.cmd);
    }
  });

  it('emits two fillets per column transition, at the mock’s 32 radius', () => {
    const arcs = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '').filter(
      (command) => command.cmd === 'A',
    );

    expect(arcs).toHaveLength(2 * (4 - 1));
    for (const arc of arcs) {
      expect(arc.args[0]).toBe(cornerRadius);
      expect(arc.args[1]).toBe(cornerRadius);
      expect(arc.args[2]).toBe(0);
      expect(arc.args[3]).toBe(0);
      expect([0, 1]).toContain(arc.args[4]);
    }
  });

  it('sweeps downward turns one way and upward turns the other, never mixed', () => {
    const arcs = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '').filter(
      (command) => command.cmd === 'A',
    );
    const sweeps = arcs.map((arc) => arc.args[4]);

    /* 第 1 欄往下（sweep 0）→ 2 個；第 2 欄往上（sweep 1）→ 2 個；第 3 欄往下 → 2 個。 */
    expect(sweeps).toEqual([0, 0, 1, 1, 0, 0]);
  });

  it('keeps every x on the grid: a column centre, a fillet end, or the exit lane', () => {
    /*
     * 這條守住「走線不會飄出格網」：每一個水平座標都必須是欄中心、欄中心加減一個圓角
     * 半徑（＝走道那一段的端點），或者出欄線本身。
     * Guards against the track drifting off-grid: every x must be a column centre, a centre
     * plus or minus one fillet radius (the lane run's endpoints), or the exit line itself.
     */
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');
    const centres = [0, 1, 2, 3].map(columnCentre);
    const allowed = new Set([
      ...centres,
      ...centres.map((centre) => centre - cornerRadius),
      ...centres.map((centre) => centre + cornerRadius),
      exitX,
    ]);

    for (const command of commands) {
      for (const x of command.cmd === 'A' ? command.args.slice(-2, -1) : command.args.slice(0, 1)) {
        expect(allowed.has(x)).toBe(true);
      }
    }
  });

  it('exits right and descends the lane, ending on the bottom lane', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.path ?? '');
    const last = commands.at(-1);

    expect(last).toEqual({ cmd: 'L', args: [exitX, bottomLane] });
    /* 倒數第二個指令是「向右出欄」，同一條上走道。 */
    expect(commands.at(-2)).toEqual({ cmd: 'L', args: [exitX, topLane] });
  });

  it('locks the whole 4-column route to the mock’s decoded geometry', () => {
    /*
     * 這條是「設計稿合約」：把整條 `d` 寫死。它來自 `Arrow 1`（`1408:2184`）解出的
     * stroke geometry，任何改動都應該是有意識的，而不是順手漂移。
     * The design contract: the entire `d`, frozen. It comes from the stroke geometry decoded
     * out of the mock's `Arrow 1`, so any change here must be deliberate.
     */
    expect(computeRosterLayout({ count: 19 }).track?.path).toBe(
      [
        'M 42.125 35',
        'L 42.125 426',
        'A 32 32 0 0 0 74.125 458',
        'L 94.375 458',
        'A 32 32 0 0 0 126.375 426',
        'L 126.375 67',
        'A 32 32 0 0 1 158.375 35',
        'L 178.625 35',
        'A 32 32 0 0 1 210.625 67',
        'L 210.625 426',
        'A 32 32 0 0 0 242.625 458',
        'L 262.875 458',
        'A 32 32 0 0 0 294.875 426',
        'L 294.875 35',
        'L 364 35',
        'L 364 458',
      ].join(' '),
    );
  });

  it('draws a single-column chain without any turn', () => {
    const track = computeRosterLayout({ count: 4 }).track;

    expect(parsePath(track?.path ?? '').filter((c) => c.cmd === 'A')).toHaveLength(0);
    expect(track?.path).toBe(
      ['M 42.125 35', 'L 42.125 458', 'L 364 458'].join(' '),
    );
  });

  it('places the arrowhead with its tip on the end of the route', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');

    expect(commands).toEqual([
      { cmd: 'M', args: [exitX - arrowHalfWidth, bottomLane - arrowLength] },
      { cmd: 'L', args: [exitX, bottomLane] },
      { cmd: 'L', args: [exitX + arrowHalfWidth, bottomLane - arrowLength] },
    ]);
  });

  it('points the arrow down, not up or sideways', () => {
    const commands = parsePath(computeRosterLayout({ count: 19 }).track?.arrow ?? '');
    const [, middle, last] = commands;

    /* 中間那一點的 y 最大（＝最低），兩隻翼都比它高。 */
    expect(middle.args[1]).toBeGreaterThan(last.args[1]);
    expect(middle.args[0]).toBe(last.args[0] - arrowHalfWidth);
  });

  it('keeps the arrow inside the panel even though it overshoots the content box', () => {
    /* 尖端右翼會超出內容區 367，但仍在面板 435 之內 —— 設計稿也是如此。 */
    const right = exitX + arrowHalfWidth;

    expect(right).toBeGreaterThan(MELTING.content.width);
    expect(right).toBeLessThan(MELTING.content.width + MELTING.laneWidth);
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
    /* 3 顆填不滿第一欄，所以只用到 1 欄，槽位不會掉到畫面外。 */
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
    expect(layout.slots.at(-1)).toMatchObject({ col: 1, row: 0 });
    expect(layout.track?.columns).toEqual([columnCentre(0), columnCentre(1)]);
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
