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
 * 走線的兩個內縮關係仍鏡像設計稿（見 `core/design.ts` 的 `MELTING.track`），只是沿對角
 * 鏡射到橫向：左走道貼著首欄中心內縮、右走道貼著格網右緣內縮、出欄線貼著格網底緣內縮。
 * The track's inset relations still mirror the mock (see `MELTING.track` in `core/design.ts`),
 * mapped onto the horizontal walk: the left lane insets from the first column's centre, the
 * right lane insets from the grid's right edge, and the exit line insets from the grid bottom.
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
  /** 走線的 SVG `d`（內容區座標）。 */
  path: string;
  /** 箭頭的 SVG `d`：開放 V 形，尖端落在走線終點。 */
  arrow: string;
  /** 走線經過的列中心 y；供測試與除錯斷言。 */
  rowCentres: number[];
}

export interface RosterLayout {
  /** 實際用到的欄數（＝ `min(cols, ceil(count / rows))`）。 */
  cols: number;
  rows: number;
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
 * 單格的左上角，內容區座標。
 * The top-left corner of a cell in content-box coordinates.
 */
export function cellOrigin(col: number, row: number): { x: number; y: number } {
  return { x: col * MELTING.cellWidth, y: row * MELTING.cellHeight };
}

/** 單格的中心，內容區座標。 */
export function cellCentre(col: number, row: number): { x: number; y: number } {
  const origin = cellOrigin(col, row);
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
 * 內縮關係鏡像設計稿的直行版（見 `MELTING.track` 的註解）：左走道 ＝ 首欄中心再往左
 * 12.2（與首列中心到上走道的 12.2 相同）；右走道 ＝ 格網右緣內縮 14（與直行版下走道
 * 距格網底緣的 14 相同）。欄數改變時右走道自動跟著貼合格網右緣。
 * The insets mirror the mock's column-major track (see the `MELTING.track` comment): the
 * left lane sits 12.2 inside the first column's centre (the same 12.2 as the mock's top lane
 * to the first row's centre), and the right lane sits 14 inside the grid's right edge (the
 * same 14 as the mock's bottom lane to the grid bottom). The right lane follows the column
 * count automatically.
 *
 * @param cols 實際使用的欄數 / The columns actually used.
 * @returns 左、右走道的 x（內容區座標）。
 */
export function trackLanes(cols: number): { leftLane: number; rightLane: number } {
  const { leftLane, laneInset } = MELTING.track;
  const safeCols = Math.max(1, Math.trunc(cols));

  const gridRight = safeCols * MELTING.cellWidth;
  return { leftLane, rightLane: gridRight - laneInset };
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
 * 中心**，所以線在縫隙裡剛好落在兩格之間。轉彎不是 90° 尖角，而是兩個 32 圓角的 U-turn；
 * 最後一列走完之後沿走道落到格網底緣附近的出欄線，以向下箭頭收尾。
 * The route is the serpentine itself: along row 0 left to right, back along row 1 right to
 * left, and so on, always through the **row centres**, so the line falls exactly in the gaps.
 * Turns are two 32-radius fillets rather than 90° corners; after the final row the path
 * descends its lane to the exit line just above the grid bottom and finishes in a downward
 * arrow.
 *
 * SVG 的 `sweep-flag` 通則：「往右走就是 1、往左走就是 0」。同一個 U-turn 的兩個圓角
 * 一定同向，所以一個旗標就夠。
 * The SVG sweep rule: "rightward = 1, leftward = 0". Both fillets of one U-turn always share
 * a direction, so a single flag suffices.
 */
function buildTrack(cols: number, rows: number): RosterTrack | null {
  if (cols < 1) return null;

  const pitch = MELTING.cellWidth;
  const { cornerRadius, arrowLength, arrowHalfWidth, exitInset } = MELTING.track;
  const { leftLane, rightLane } = trackLanes(cols);

  /* 出欄線 y：格網底緣內縮（設計稿直行版出欄線 364 ＝ 內容區右緣 367 − 3 的鏡像）。 */
  const exitY = rows * MELTING.cellHeight - exitInset;

  /* 圓角半徑不能吃掉整個欄距，否則同一組 U-turn 的兩個圓角會互相穿過。 */
  const radius = Math.min(cornerRadius, pitch / 2 - 1);

  const parts: string[] = [`M ${num(leftLane)} ${num(rowCentre(0))}`];

  for (let row = 0; row < rows; row += 1) {
    const y = rowCentre(row);
    const rightward = row % 2 === 0;
    const lane = rightward ? rightLane : leftLane;

    /* 最後一列走完就直接出欄，不必再留圓角的空間。 */
    if (row === rows - 1) {
      parts.push(`L ${num(lane)} ${num(y)}`);
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
   * 出欄。最後一列走完時人就在左或右走道上，沿走道直落出欄線即可 —— 箭頭朝下。
   * Exit. The walk ends on the left or right lane, so the path simply descends that lane to
   * the exit line — the arrow points down.
   */
  const endLane = (rows - 1) % 2 === 0 ? rightLane : leftLane;
  parts.push(`L ${num(endLane)} ${num(exitY)}`);

  const arrow = [
    `M ${num(endLane - arrowHalfWidth)} ${num(exitY - arrowLength)}`,
    `L ${num(endLane)} ${num(exitY)}`,
    `L ${num(endLane + arrowHalfWidth)} ${num(exitY - arrowLength)}`,
  ].join(' ');

  return {
    path: parts.join(' '),
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
    return { cols, rows, slots: [], track: null, unlockedCount: 0 };
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

  return { cols: usedCols, rows, slots, track: buildTrack(usedCols, rows), unlockedCount: unlocked };
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
