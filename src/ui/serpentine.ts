/**
 * MELTING LIST 的蛇形佈局。
 * Serpentine layout for the MELTING LIST.
 *
 * **走法已由使用者定案改為橫向蛇形（S 形）**：第一列由左而右、第二列由右而左，如此類推。
 * 設計稿原本推導的是**直行**蛇形（先走完第 1 欄再走第 2 欄），但使用者要求改成讀起來像
 * 英文字母 S 的橫向走法 —— 那也是一般圖鑑「第一行從左邊開始到右邊」的直覺。
 * **The walk is row-major (an S shape), per the user's decision**: row 1 runs left to right,
 * row 2 right to left, and so on. The mock originally implied a **column-major** walk (down
 * column 1, up column 2), but the user asked for the S-shaped, reading-order walk — which is
 * also how a roster "first row from left to right" reads naturally.
 *
 * 走線的幾何在使用者定案後改為「格網置中＋走道外拓」：實際用到的欄數在內容區裡左右
 * 置中（`gridOffsetX()`），左右走道貼著格網左右緣再各向外伸 `laneOverhang`（見
 * `MELTING.track`），整個 S 比格網更寬且左右對稱；最後一隻方團團之後的走線以虛線呈現。
 * The track geometry was re-centred and widened per the user's decisions: the columns actually
 * used are centred in the content box (`gridOffsetX()`), and the two lanes reach `laneOverhang`
 * beyond the grid's left/right edges (see `MELTING.track`) — a wider, symmetric S. The track
 * past the last dumpling is drawn dashed.
 *
 * 這裡**只有幾何**，不碰 DOM：純函式才能把「N=3 / 5 / 10 / 19 / 20 各長怎樣」全部寫成
 * 單元測試，而不是靠瞇著眼看畫面。座標單位是**設計稿像素**，原點在內容區左上角。
 * Pure geometry, no DOM, in **design pixels** with the origin at the content box's top-left.
 * Purity is what lets every "what does N=10 look like" case become a unit test instead of
 * squinting at the screen.
 */

import { MELTING } from '../core/design';

export interface RosterSlot {
  /** 0 為底的合成鏈索引。 */
  index: number;
  /** 欄（0 為底）。 */
  col: number;
  /** 列（0 為底）。 */
  row: number;
}

/**
 * 蛇形走線：一筆畫的路徑。
 * The serpentine track: one single path.
 *
 * 整條路徑仍是**一條**連續折線：整條線畫在素材之下、只有縫隙露出來，轉彎處的圓角就是
 * 「它其實是連續的」的證據。
 * The route is still **one** continuous polyline: the path sits under the art, so only the
 * gaps show through; the fillets at the turns are the evidence that it is continuous.
 */
export interface RosterTrack {
  /**
   * 實線段的 SVG `d`（內容區座標）：由起點一路到**最後一個槽位的中心**。
   * The solid run's SVG `d` (content-box coordinates): from the start to the **last slot's
   * centre**.
   */
  path: string;
  /**
   * 虛線段的 SVG `d`：最後一個槽位之後的走線（沿出欄走道落到出欄線）。
   * 「最後一隻之後是未知的路」—— 使用者定案以虛線呈現。
   * The dashed tail's SVG `d`: the track past the last slot (down the exit lane to the exit
   * line). "Past the last dumpling the road is unknown" — the user's decision to draw it
   * dashed.
   */
  dash: string;
  /** 箭頭的 SVG `d`：開放 V 形，尖端落在虛線段終點。 */
  arrow: string;
  /** 走線經過的列中心 y；供測試與除錯斷言。 */
  rowCentres: number[];
}

export interface RosterLayout {
  /** 實際用到的欄數（＝ `min(cols, ceil(count / rows))`）。 */
  cols: number;
  rows: number;
  /**
   * 格網在內容區裡的**水平置中偏移**（使用者定案）：格子與走線整體右移這麼多，
   * 讓窄於內容區的格網左右對稱。渲染端把它加到每格的 left 上。
   * The grid's **horizontal centring offset** in the content box (the user's decision):
   * cells and track all shift right by this much so a grid narrower than the content box
   * sits symmetrically. The renderer adds it to every cell's `left`.
   */
  offsetX: number;
  slots: RosterSlot[];
  /** 走線；鏈長為 0 時是 `null`。 */
  track: RosterTrack | null;
  /**
   * 已解鎖的前綴長度，夾到 `[0, count]`。渲染端用它決定哪些格子要顯示 `?`，
   * 以及哪一格是「下一個可解鎖的目標」。
   * The unlocked prefix length, clamped. The renderer uses it to decide which cells show
   * `?` and which one is the next target.
   */
  unlockedCount: number;
}

export interface RosterOptions {
  /** 槽位總數（＝合成鏈長度）。 */
  count: number;
  /** 欄數；預設取自設計稿。 */
  cols?: number;
  /** 列數；預設取自設計稿。 */
  rows?: number;
  /** 已解鎖的**前綴長度**（解鎖沿合成鏈單調遞增）。 */
  unlockedCount?: number;
}

/**
 * 格網在內容區裡的水平**置中偏移**（使用者定案：S 形左右置中）。
 * The grid's horizontal **centring offset** in the content box (the user's decision: centre
 * the S left-right).
 *
 * 實際用到的欄數往往少於內容區塞得下的欄數（10 級 4 欄佔 337，內容區 367），左對齊會讓
 * 整個 S 偏一邊；置中之後格網與走線作為一個整體左右對稱。
 * The columns actually used are often fewer than the content box fits (10 levels at 4 columns
 * span 337 of 367), and left-aligning would lean the whole S to one side; centring makes the
 * grid and its track symmetric as one unit.
 */
export function gridOffsetX(cols: number): number {
  const safeCols = Math.max(1, Math.trunc(cols));
  return (MELTING.content.width - safeCols * MELTING.cellWidth) / 2;
}

/**
 * 單格的左上角，內容區座標。
 * The top-left corner of a cell in content-box coordinates.
 *
 * `offsetX` 是置中偏移（見 `gridOffsetX()`）；不傳就是 0（貼左），供純幾何測試用。
 * `offsetX` is the centring offset (see `gridOffsetX()`); defaulting to 0 (flush left) keeps
 * the pure-geometry tests simple.
 */
export function cellOrigin(col: number, row: number, offsetX = 0): { x: number; y: number } {
  return { x: offsetX + col * MELTING.cellWidth, y: row * MELTING.cellHeight };
}

/** 單格的中心，內容區座標。 */
export function cellCentre(col: number, row: number, offsetX = 0): { x: number; y: number } {
  const origin = cellOrigin(col, row, offsetX);
  return { x: origin.x + MELTING.cellWidth / 2, y: origin.y + MELTING.cellHeight / 2 };
}

/** 某一欄的中心 x。走線與槽位都用這個，不會出現兩套欄中心。 */
export function columnCentre(col: number): number {
  return col * MELTING.cellWidth + MELTING.cellWidth / 2;
}

/** 某一列的中心 y。走線經過列中心，與欄中心同一套規則。 */
export function rowCentre(row: number): number {
  return row * MELTING.cellHeight + MELTING.cellHeight / 2;
}

/**
 * 橫向蛇形的座標：`index → (col, row)`。
 * The row-major walk: `index → (col, row)`.
 *
 * 偶數列由左而右、奇數列由右而左。這條式子就是整個名冊的「走位規則」，其他地方不重算。
 * Even rows run left to right, odd rows right to left. This expression is the roster's
 * entire walking rule; nothing else re-derives it.
 */
export function slotAt(index: number, cols: number): { col: number; row: number } {
  const safeCols = Math.max(1, Math.trunc(cols));
  const row = Math.floor(index / safeCols);
  const within = index % safeCols;
  return { col: row % 2 === 0 ? within : safeCols - 1 - within, row };
}

/**
 * 由欄數推導左／右走道的 x。
 * Derive the left and right lane X from the column count.
 *
 * **使用者定案：走道貼著（置中後的）格網左右緣再各向外伸 `laneOverhang`** —— S 形因此
 * 比格網本身更寬，而且左右對稱。設計稿直行版「走道藏在首／末欄中心內側」的內縮不再沿用：
 * 鏡射到橫向後左右並不對稱（左 29.925、右 44），使用者看到的正是那個歪的 S。
 * **The user's decision: each lane reaches `laneOverhang` beyond the (centred) grid's left /
 * right edges** — the S is wider than the grid itself and symmetric. The mock's column-major
 * inset (lanes hidden inside the outer columns) is dropped: mirrored onto the row-major track
 * it was asymmetric (29.925 left vs 44 right), the lopsided S the user reported.
 *
 * @param cols 實際使用的欄數 / The columns actually used.
 * @returns 左、右走道的 x（內容區座標）。
 */
export function trackLanes(cols: number): { leftLane: number; rightLane: number } {
  const safeCols = Math.max(1, Math.trunc(cols));
  const { laneOverhang } = MELTING.track;
  const gridLeft = gridOffsetX(safeCols);
  const gridRight = gridLeft + safeCols * MELTING.cellWidth;

  return { leftLane: gridLeft - laneOverhang, rightLane: gridRight + laneOverhang };
}

/** 把座標寫成 SVG 用的短字串，順手砍掉浮點尾巴。 */
function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * 組出走線。
 * Build the track.
 *
 * 走法就是橫向蛇形本身：第 0 列由左而右、第 1 列由右而左，如此類推，走線一律通過**列
 * 中心**，所以線在縫隙裡剛好落在兩格之間。轉彎不是 90° 尖角，而是兩個 32 圓角的 U-turn。
 * The route is the serpentine itself: along row 0 left to right, back along row 1 right to
 * left, and so on, always through the **row centres**, so the line falls exactly in the gaps.
 * Turns are two 32-radius fillets rather than 90° corners.
 *
 * **實線只走到最後一個槽位的中心**（使用者定案）：之後的走線 —— 沿最後一列走到出欄走道、
 * 直落出欄線 —— 全部改為 `dash` 虛線段，箭頭也屬於虛線段：「最後一隻之後的路還沒修到」，
 * 與未解鎖灰格同一種語意。整段仍是一筆畫的幾何，只是用兩條 path、兩種筆觸畫。
 * **The solid run stops at the last slot's centre** (the user's decision): everything past it —
 * along the last row to the exit lane, then down to the exit line — becomes the `dash` tail,
 * arrowhead included: "the road is not built past the last dumpling", the same semantics as a
 * locked grey tile. The geometry is still one stroke; it is simply drawn as two paths.
 *
 * SVG 的 `sweep-flag` 通則：「往右走就是 1、往左走就是 0」。同一個 U-turn 的兩個圓角
 * 一定同向，所以一個旗標就夠。
 * The SVG sweep rule: "rightward = 1, leftward = 0". Both fillets of one U-turn always share
 * a direction, so a single flag suffices.
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
   * The dashed tail: from the last slot's centre, along the last row to the exit lane, then
   * straight down to the exit line.
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
   * Only walk as many columns as are needed, so a short chain never places slots in
   * columns that fall outside the panel.
   */
  const usedCols = Math.min(cols, Math.ceil(total / rows));

  const slots: RosterSlot[] = [];
  for (let index = 0; index < total; index += 1) {
    const { col, row } = slotAt(index, usedCols);
    slots.push({ index, col, row });
  }

  /*
   * 實線／虛線的分界在最後一個槽位（＝合成鏈的終點）：之後的走線以虛線呈現。
   * The solid/dashed boundary sits on the last slot (the chain's end): the track past it is
   * dashed.
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
 * 由合成鏈長度挑出**填得滿寬度**的列數。
 * Pick the row count that **fills the width** for a given chain length.
 *
 * 設計稿的 4×5 是從**19 格**反推的；實際的合成鏈只有 10 級時，沿用 5 列會讓走線只用到
 * 2 欄，蛇形退化成「走完兩欄後從最右邊垂直下來」的一條直線 —— 那既不像蛇形、也浪費了
 * 整個面板的寬度。使用者回報的正是這個：10 個之後就變成 90° 一條直線。
 * The mock's 4×5 was reverse-engineered from **19 slots**; with an actual 10-level chain, keeping
 * 5 rows makes the walk use only 2 columns and the serpentine degenerates into "two columns, then
 * drop straight down the far right" — not serpentine, and it wastes the panel's width. That is
 * exactly what the user reported: a 90° straight line after the tenth cell.
 *
 * 選法：`rows = ceil(total / cols)`，讓每一欄分到差不多數量的格子，欄數自然填滿面板寬度。
 * 例：10 級、4 欄 → `ceil(10/4) = 3`，得到 4+4+2 的三列分佈（比 5+5 的 2 欄高塔好得多）。
 * The rule is `rows = ceil(total / cols)`: each column gets a comparable share and the columns
 * fill the panel width. For 10 levels at 4 columns that is `ceil(10/4) = 3`, giving a 4+4+2
 * three-row spread — far better than a 5+5 two-column tower.
 *
 * @param total 合成鏈長度 / The chain length.
 * @param cols 可用的欄數上限 / The column budget.
 * @param maxRows 列數上限（避免超長鏈把面板撐爆）/ Row cap, so a very long chain cannot blow up.
 * @returns 建議列數，至少 1。
 */
export function autoFitRows(total: number, cols: number, maxRows: number = MELTING.rows): number {
  const safeCols = Math.max(1, Math.trunc(cols));
  const safeRows = Math.max(1, Math.trunc(maxRows));
  const count = Math.max(0, Math.trunc(total));

  if (count === 0) return 1;

  const rows = Math.ceil(count / safeCols);
  return Math.max(1, Math.min(rows, safeRows));
}
