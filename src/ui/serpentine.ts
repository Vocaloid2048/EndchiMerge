/**
 * MELTING LIST 的蛇形佈局：橫向蛇形（S 形）走法，格網置中、走道外拓，最後一隻之後以虛線呈現。
 * Serpentine layout for the MELTING LIST: a row-major S walk, centred grid with outward lanes, dashed past the last dumpling.
 *
 * 這裡只有幾何，不碰 DOM：座標單位是設計稿像素，原點在內容區左上角。
 * Pure geometry, no DOM, in design pixels with the origin at the content box's top-left.
 */

import { MELTING } from '../core/design';

export interface RosterSlot {
  /**
   * 0 為底的合成鏈索引。
   * The 0-based merge-chain index.
   */
  index: number;
  /**
   * 欄（0 為底）。
   * The column (0-based).
   */
  col: number;
  /**
   * 列（0 為底）。
   * The row (0-based).
   */
  row: number;
}

/**
 * 蛇形走線：一筆畫的路徑；整條路徑是一條連續折線（畫在素材之下，只有縫隙露出來）。
 * The serpentine track as one stroke: a single continuous polyline drawn under the art, visible only through the gaps.
 */
export interface RosterTrack {
  /**
   * 實線段的 SVG `d`（內容區座標）：由起點一路到最後一個槽位的中心。
   * The solid run's SVG `d` (content-box coordinates): from the start to the last slot's centre.
   */
  path: string;
  /**
   * 虛線段的 SVG `d`：最後一個槽位之後的走線 —— 「最後一隻之後是未知的路」。
   * The dashed tail's SVG `d`: the track past the last slot — "past the last dumpling the road is unknown".
   */
  dash: string;
  /**
   * 箭頭的 SVG `d`：開放 V 形，尖端落在虛線段終點。
   * The arrow's SVG `d`: an open V whose tip lands on the dashed tail's end.
   */
  arrow: string;
  /**
   * 走線經過的列中心 y；供測試與除錯斷言。
   * The row centres the track passes through, for test and debug assertions.
   */
  rowCentres: number[];
}

export interface RosterLayout {
  /**
   * 實際用到的欄數（＝ `min(cols, ceil(count / rows))`）。
   * The columns actually used (＝ `min(cols, ceil(count / rows))`).
   */
  cols: number;
  rows: number;
  /**
   * 格網在內容區裡的水平置中偏移；渲染端把它加到每格的 left 上。
   * The grid's horizontal centring offset in the content box; the renderer adds it to every cell's `left`.
   */
  offsetX: number;
  slots: RosterSlot[];
  /**
   * 走線；鏈長為 0 時是 `null`。
   * The track; `null` for an empty chain.
   */
  track: RosterTrack | null;
  /**
   * 已解鎖的前綴長度，夾到 `[0, count]`；渲染端用它決定哪些格子顯示 `?`、哪一格是下一個目標。
   * The unlocked prefix length, clamped; the renderer uses it for `?` cells and the next target.
   */
  unlockedCount: number;
}

export interface RosterOptions {
  /**
   * 槽位總數（＝合成鏈長度）。
   * The slot count (the merge chain's length).
   */
  count: number;
  /**
   * 欄數；預設取自設計稿。
   * The column count; defaults to the mock's value.
   */
  cols?: number;
  /**
   * 列數；預設取自設計稿。
   * The row count; defaults to the mock's value.
   */
  rows?: number;
  /**
   * 已解鎖的前綴長度（解鎖沿合成鏈單調遞增）。
   * The unlocked prefix length (unlocks grow monotonically along the chain).
   */
  unlockedCount?: number;
}

/**
 * 格網在內容區裡的水平置中偏移：實際用到的欄數常少於塞得下的欄數，置中之後格網與走線左右對稱。
 * The grid's horizontal centring offset in the content box: the used columns are often fewer than fit, and centring keeps the grid and its track symmetric.
 */
export function gridOffsetX(cols: number): number {
  const safeCols = Math.max(1, Math.trunc(cols));
  return (MELTING.content.width - safeCols * MELTING.cellWidth) / 2;
}

/**
 * 單格的左上角，內容區座標；`offsetX` 是置中偏移，不傳就是 0（貼左，供純幾何測試用）。
 * A cell's top-left corner in content-box coordinates; `offsetX` is the centring offset, defaulting to 0 (flush left, for pure-geometry tests).
 */
export function cellOrigin(col: number, row: number, offsetX = 0): { x: number; y: number } {
  return { x: offsetX + col * MELTING.cellWidth, y: row * MELTING.cellHeight };
}

/**
 * 單格的中心，內容區座標。
 * A cell's centre in content-box coordinates.
 */
export function cellCentre(col: number, row: number, offsetX = 0): { x: number; y: number } {
  const origin = cellOrigin(col, row, offsetX);
  return { x: origin.x + MELTING.cellWidth / 2, y: origin.y + MELTING.cellHeight / 2 };
}

/**
 * 某一欄的中心 x；走線與槽位都用這個，不會出現兩套欄中心。
 * A column's centre X; both the track and the slots use it, so there is only one set of centres.
 */
export function columnCentre(col: number): number {
  return col * MELTING.cellWidth + MELTING.cellWidth / 2;
}

/**
 * 某一列的中心 y；走線經過列中心，與欄中心同一套規則。
 * A row's centre Y; the track passes through row centres under the same rule as the columns.
 */
export function rowCentre(row: number): number {
  return row * MELTING.cellHeight + MELTING.cellHeight / 2;
}

/**
 * 橫向蛇形的座標：偶數列由左而右、奇數列由右而左；這條式子是名冊唯一的走位規則。
 * The row-major walk: even rows left to right, odd rows right to left; this expression is the roster's single walking rule.
 */
export function slotAt(index: number, cols: number): { col: number; row: number } {
  const safeCols = Math.max(1, Math.trunc(cols));
  const row = Math.floor(index / safeCols);
  const within = index % safeCols;
  return { col: row % 2 === 0 ? within : safeCols - 1 - within, row };
}

/**
 * 由欄數推導左／右走道的 x：走道貼著置中後的格網左右緣再各向外伸 `laneOverhang`，
 * S 形因此比格網寬且左右對稱。
 * Derives the lane X from the column count: each lane reaches `laneOverhang` beyond the centred grid's edges, so the S is wider than the grid and symmetric.
 */
export function trackLanes(cols: number): { leftLane: number; rightLane: number } {
  const safeCols = Math.max(1, Math.trunc(cols));
  const { laneOverhang } = MELTING.track;
  const gridLeft = gridOffsetX(safeCols);
  const gridRight = gridLeft + safeCols * MELTING.cellWidth;

  return { leftLane: gridLeft - laneOverhang, rightLane: gridRight + laneOverhang };
}

/**
 * 把座標寫成 SVG 用的短字串，順手砍掉浮點尾巴。
 * Formats a coordinate for SVG, trimming float tails.
 */
function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * 組出走線：一律通過列中心，轉彎是兩個 32 圓角的 U-turn；
 * 實線只走到最後一個槽位的中心，之後（含箭頭）全是虛線段 —— 幾何仍是一筆畫，只是畫成兩條 path。
 * Builds the track: always through row centres, turns as two 32-radius fillets; the solid run stops at the last slot's centre and everything past it (arrow included) is dashed — still one stroke, drawn as two paths.
 *
 * SVG 的 sweep-flag 通則：往右走是 1、往左走是 0；同一個 U-turn 的兩個圓角一定同向。
 * The SVG sweep rule: rightward ＝ 1, leftward ＝ 0; both fillets of one U-turn share a direction.
 */
function buildTrack(
  cols: number,
  rows: number,
  last: { col: number; row: number },
): RosterTrack | null {
  if (cols < 1) return null;

  const pitch = MELTING.cellWidth;
  const { cornerRadius, arrowLength, arrowHalfWidth, exitInset } = MELTING.track;
  const { leftLane, rightLane } = trackLanes(cols);
  const gridLeft = gridOffsetX(cols);

  /* 出欄線 y：格網底緣內縮（設計稿直行版出欄線 364 ＝ 內容區右緣 367 − 3 的鏡像）。 */
  const exitY = rows * MELTING.cellHeight - exitInset;

  /* 圓角半徑不能吃掉整個欄距，否則同一組 U-turn 的兩個圓角會互相穿過。 */
  const radius = Math.min(cornerRadius, pitch / 2 - 1);

  const parts: string[] = [`M ${num(leftLane)} ${num(rowCentre(0))}`];

  for (let row = 0; row <= last.row; row += 1) {
    const y = rowCentre(row);
    const rightward = row % 2 === 0;
    const lane = rightward ? rightLane : leftLane;

    /* 最後一列只走到最後一個槽位的中心；之後是虛線段。 */
    if (row === last.row) {
      parts.push(`L ${num(gridLeft + last.col * pitch + pitch / 2)} ${num(y)}`);
      break;
    }

    const nextY = rowCentre(row + 1);
    const sweep = rightward ? 1 : 0;
    const arc = `A ${num(radius)} ${num(radius)} 0 0 ${String(sweep)}`;

    /* 水平段收在圓角起點，再沿走道落到下一列、轉回頭。 */
    parts.push(`L ${num(rightward ? lane - radius : lane + radius)} ${num(y)}`);
    parts.push(`${arc} ${num(lane)} ${num(y + radius)}`);
    parts.push(`L ${num(lane)} ${num(nextY - radius)}`);
    parts.push(`${arc} ${num(rightward ? lane - radius : lane + radius)} ${num(nextY)}`);
  }

  /*
   * 虛線段：由最後一個槽位的中心繼續沿最後一列走到出欄走道，直落出欄線。
   * The dashed tail: from the last slot's centre, along the last row to the exit lane, then straight down to the exit line.
   */
  const endLane = last.row % 2 === 0 ? rightLane : leftLane;
  const lastX = gridLeft + last.col * pitch + pitch / 2;
  const dash = [
    `M ${num(lastX)} ${num(rowCentre(last.row))}`,
    `L ${num(endLane)} ${num(rowCentre(last.row))}`,
    `L ${num(endLane)} ${num(exitY)}`,
  ].join(' ');

  const arrow = [
    `M ${num(endLane - arrowHalfWidth)} ${num(exitY - arrowLength)}`,
    `L ${num(endLane)} ${num(exitY)}`,
    `L ${num(endLane + arrowHalfWidth)} ${num(exitY - arrowLength)}`,
  ].join(' ');

  return {
    path: parts.join(' '),
    dash,
    arrow,
    rowCentres: Array.from({ length: rows }, (_, row) => rowCentre(row)),
  };
}

export function computeRosterLayout(options: RosterOptions): RosterLayout {
  const cols = Math.max(1, options.cols ?? MELTING.cols);
  const rows = Math.max(1, options.rows ?? MELTING.rows);
  const total = Math.max(0, Math.trunc(options.count));
  const unlocked = Math.max(0, Math.min(options.unlockedCount ?? 0, total));

  if (total === 0) {
    return { cols, rows, offsetX: gridOffsetX(cols), slots: [], track: null, unlockedCount: 0 };
  }

  /*
   * 只走需要的欄數：10 級填不滿 4 欄時不該讓槽位落到畫面外的欄。
   * Only walk as many columns as are needed, so a short chain never places slots in columns that fall outside the panel.
   */
  const usedCols = Math.min(cols, Math.ceil(total / rows));

  const slots: RosterSlot[] = [];
  for (let index = 0; index < total; index += 1) {
    const { col, row } = slotAt(index, usedCols);
    slots.push({ index, col, row });
  }

  /*
   * 實線／虛線的分界在最後一個槽位（＝合成鏈的終點）：之後的走線以虛線呈現。
   * The solid/dashed boundary sits on the last slot (the chain's end): the track past it is dashed.
   */
  const last = slots.at(-1) ?? { index: 0, col: 0, row: 0 };

  return {
    cols: usedCols,
    rows,
    offsetX: gridOffsetX(usedCols),
    slots,
    track: buildTrack(usedCols, rows, { col: last.col, row: last.row }),
    unlockedCount: unlocked,
  };
}

/**
 * 由合成鏈長度挑出填得滿寬度的列數：`rows = ceil(total / cols)`，讓欄數自然填滿面板寬度
 * （沿用設計稿 5 列會讓 10 級只用到 2 欄，蛇形退化成一條直線）。
 * Picks the row count that fills the width for a chain length: `rows = ceil(total / cols)`, so the columns fill the panel (keeping the mock's 5 rows would let 10 levels use only 2 columns and degenerate the S into a straight line).
 */
export function autoFitRows(total: number, cols: number, maxRows: number = MELTING.rows): number {
  const safeCols = Math.max(1, Math.trunc(cols));
  const safeRows = Math.max(1, Math.trunc(maxRows));
  const count = Math.max(0, Math.trunc(total));

  if (count === 0) return 1;

  const rows = Math.ceil(count / safeCols);
  return Math.max(1, Math.min(rows, safeRows));
}
