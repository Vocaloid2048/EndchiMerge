/**
 * MELTING LIST 的蛇形佈局。
 * Serpentine layout for the MELTING LIST.
 *
 * 設計稿（`1408:2234` `Group 451`）的 19 個槽位推導出：內容區 367×472、**4 欄 × 5 列**、
 * 欄距 84.25、列距 94.4，而且行進方向是**直行**（column-major）而不是橫向：
 * 先由上而下走完第 1 欄，再由下而上走第 2 欄，如此類推。
 * The mock's 19 slots imply a 367×472 content box, **4 columns × 5 rows**, pitched 84.25 by
 * 94.4, walked **down columns** rather than across rows: down column 1, up column 2, and so
 * on.
 *
 * 判斷依據是那個「缺一格」的位置：19 格填進 4×5 的格網時，直行蛇形會在第 1 列留下唯一
 * 的空位（＝第 4 欄的第 1 列），橫向蛇形則會把空位留在最後一列。設計稿的第 1 列正好只有
 * 3 格、其餘 4 格 —— 與直行蛇形完全吻合。
 * The tell is where the single gap falls: with 19 slots in a 4×5 grid, a column-major walk
 * leaves the gap in row 1 (column 4, row 1), while a row-major walk leaves it in the last
 * row. The mock's first row holds three slots and the rest hold four, exactly matching a
 * column-major walk.
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
 * 設計稿把它畫成**一條**連續折線（`1408:2184` `Arrow 1`），而不是每兩格一段。看起來
 * 一節一節是因為整條線畫在素材之下、只有縫隙露出；轉彎處那四個 32 圓角就是「它其實是連
 * 續的」的證據。詳見 `core/design.ts` 的 `MELTING.track`。
 * The mock draws it as **one** continuous polyline, not one segment per pair. The broken
 * look comes from the path sitting under the art, so only the gaps show through; the four
 * 32-radius fillets at the turns are the evidence that it is continuous.
 */
export interface RosterTrack {
  /** 走線的 SVG `d`（內容區座標）。 */
  path: string;
  /** 箭頭的 SVG `d`：開放 V 形，尖端落在走線終點。 */
  arrow: string;
  /** 走線經過的欄中心 x；供測試與除錯斷言。 */
  columns: number[];
}

export interface RosterLayout {
  /** 實際用到的欄數（＝ `min(cols, ceil(count / rows))`）。 */
  cols: number;
  rows: number;
  slots: RosterSlot[];
  /** 走線；鏈長為 0 時是 `null`。 */
  track: RosterTrack | null;
  /**
   * 已解鎖的前綴長度，夾到 `[0, count]`。渲染端用它決定哪些格子要顯示 `???`，
   * 以及哪一格是「下一個可解鎖的目標」。
   * The unlocked prefix length, clamped. The renderer uses it to decide which cells show
   * `???` and which one is the next target.
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

/**
 * 直行蛇形的座標：`index → (col, row)`。
 * The column-major walk: `index → (col, row)`.
 *
 * 偶數欄由上而下、奇數欄由下而上。這條式子就是整個名冊的「走位規則」，其他地方不重算。
 * Even columns run top to bottom, odd columns bottom to top. This expression is the roster's
 * entire walking rule; nothing else re-derives it.
 */
export function slotAt(index: number, rows: number): { col: number; row: number } {
  const col = Math.floor(index / rows);
  const within = index % rows;
  return { col, row: col % 2 === 0 ? within : rows - 1 - within };
}

/** 把座標寫成 SVG 用的短字串，順手砍掉浮點尾巴。 */
function num(value: number): string {
  return String(Number(value.toFixed(3)));
}

/**
 * 由列數推導上／下走道的 y。
 * Derive the top and bottom lane Y from the row count.
 *
 * 設計稿的 5 列格網給出上走道 35、下走道 458，而 5 列共佔 `5 × 94.4 ≈ 472`。兩個值其實是
 * 「貼著格網邊緣內縮一點」：
 *  - 下走道 ＝ 格網底部內縮 `laneInset` → `458 ≈ 472 − 14`
 *  - 上走道 ＝ 第一列中心往上 `cellHeight / 2 − laneInset` → `35 ≈ 47.2 − 12`
 * 把這兩個關係寫成式子，列數改變時走道自動跟著貼合。
 * The mock's 5-row grid gives lanes at 35 and 458, and 5 rows span `5 × 94.4 ≈ 472`. Both are
 * simply "a little inside the grid's edge":
 *  - bottom lane = grid bottom inset by `laneInset` → `458 ≈ 472 − 14`
 *  - top lane = first row's centre raised by `cellHeight / 2 − laneInset` → `35 ≈ 47.2 − 12`
 * Expressing those relations keeps the lanes tight to the grid at any row count.
 *
 * @param rows 實際使用的列數 / The rows actually used.
 * @returns 上走道與下走道的 y（內容區座標）。
 */
export function trackLanes(rows: number): { topLane: number; bottomLane: number } {
  const { topLane, bottomLane } = MELTING.track;
  const safeRows = Math.max(1, Math.trunc(rows));

  /* 從設計稿的 5 列值反推「內縮量」，其餘列數沿用同一個內縮。 */
  const referenceBottom = MELTING.rows * MELTING.cellHeight;
  const laneInset = referenceBottom - bottomLane;

  const gridBottom = safeRows * MELTING.cellHeight;
  const derivedBottom = gridBottom - laneInset;

  /*
   * 上走道：設計稿把它放在第一列中心再往上約 12（`cellHeight/2 − laneInset`）。
   * Top lane: the mock places it about 12 above the first row's centre.
   */
  const referenceTopOffset = topLane - MELTING.cellHeight / 2;
  const derivedTop = MELTING.cellHeight / 2 + referenceTopOffset;

  return { topLane: derivedTop, bottomLane: derivedBottom };
}

/**
 * 組出走線。
 * Build the track.
 *
 * 走法就是蛇形本身：第 0 欄由上而下、第 1 欄由下而上，如此類推，走線一律通過**欄中心**，
 * 所以線在縫隙裡剛好落在兩格之間。轉彎不是 90° 尖角，而是兩個 32 圓角的 U-turn；最後一欄
 * 走完之後向右出欄，沿右側走道落到下走道，以向下箭頭收尾。
 * The route is the serpentine itself: down column 0, up column 1, and so on, always through
 * the **column centres**, so the line falls exactly in the gaps. Turns are two 32-radius
 * fillets rather than 90° corners; after the final column the path exits right and descends
 * the right-hand lane, ending in a downward arrow.
 *
 * **走道的 y 由 `rows` 推導**，不是寫死的。設計稿的 35 / 458 是 5 列格網的值；列數變少時若
 * 沿用，線會拖到格子下方一大截（蛇形看起來「多走了一段」）。推導式讓任何列數都貼著格網。
 * **The lane Y values are derived from `rows`**, not hardcoded. The mock's 35 / 458 belong to a
 * 5-row grid; keeping them for fewer rows would drag the line far below the last row, making the
 * serpentine look like it walks extra steps. Deriving keeps any row count tight to the grid.
 *
 * SVG 的 `sweep-flag` 只有兩個值，這裡用「往下走就是 0、往上走就是 1」的通則決定 ——
 * 直行蛇形裡同一個 U-turn 的兩個圓角一定同向，所以一個旗標就夠。
 * The SVG sweep flag has only two values; the rule here is "downward = 0, upward = 1".
 * Both fillets of one U-turn always share a direction, so a single flag suffices.
 */
function buildTrack(cols: number, rows: number): RosterTrack | null {
  if (cols < 1) return null;

  const pitch = MELTING.cellWidth;
  const { cornerRadius, arrowLength, arrowHalfWidth } = MELTING.track;
  const { topLane, bottomLane } = trackLanes(rows);

  /*
   * 出欄的 x：**預設用設計稿的 364**，但只要最後一欄的右緣超過它（欄數多時），就改貼在最後
   * 一欄外側。設計稿的 364 是 4 欄全用滿時的值；欄數少時它會離最後一欄很遠，出欄線橫拉一大段
   * 再垂直落下 —— 使用者看到的「一條直線」正是這個。
   * The exit X **defaults to the mock's 364**, but moves out to hug the last column whenever that
   * column's right edge passes it. The mock's 364 assumes all 4 columns; with fewer, it sits far
   * from the last column, so the exit stretches across a long run before dropping — the "straight
   * line" the user saw.
   *
   * 這樣「用滿 4 欄」時逐字等於設計稿（既有測試釘住的值不變），欄數少時則自動收窄。
   * This keeps the all-4-column case byte-identical to the mock (the value the existing tests pin),
   * while narrowing automatically for fewer columns.
   */
  const lastColRight = cols * pitch;
  const derivedExit = Math.max(lastColRight + 6, Math.min(MELTING.track.exitX, MELTING.content.width - 3));

  /* 圓角半徑不能吃掉整個欄距，否則同一組 U-turn 的兩個圓角會互相穿過。 */
  const radius = Math.min(cornerRadius, pitch / 2 - 1);

  const parts: string[] = [`M ${num(columnCentre(0))} ${num(topLane)}`];

  for (let col = 0; col < cols; col += 1) {
    const x = columnCentre(col);
    const down = col % 2 === 0;
    const lane = down ? bottomLane : topLane;

    /* 最後一欄走完就直接出欄，不必再留圓角的空間。 */
    if (col === cols - 1) {
      parts.push(`L ${num(x)} ${num(lane)}`);
      break;
    }

    const next = columnCentre(col + 1);
    const sweep = down ? 0 : 1;
    const arc = `A ${num(radius)} ${num(radius)} 0 0 ${String(sweep)}`;

    /* 垂直段收在圓角起點，再沿走道橫過一欄、轉上去。 */
    parts.push(`L ${num(x)} ${num(down ? lane - radius : lane + radius)}`);
    parts.push(`${arc} ${num(x + radius)} ${num(lane)}`);
    parts.push(`L ${num(next - radius)} ${num(lane)}`);
    parts.push(`${arc} ${num(next)} ${num(down ? lane - radius : lane + radius)}`);
  }

  /*
   * 出欄。最後一欄若是由下而上走完，人就在上走道，所以要先向右再到下走道；若是由上而下
   * 走完，人已經在下走道，向右之後就直接收箭頭。
   * Exit. If the last column was walked upward the path is on the top lane, so it steps
   * right and then descends; if it was walked downward it is already on the bottom lane and
   * only needs to step right before the arrow.
   */
  const endLane = (cols - 1) % 2 === 0 ? bottomLane : topLane;
  parts.push(`L ${num(derivedExit)} ${num(endLane)}`);
  if (endLane !== bottomLane) parts.push(`L ${num(derivedExit)} ${num(bottomLane)}`);

  const arrow = [
    `M ${num(derivedExit - arrowHalfWidth)} ${num(bottomLane - arrowLength)}`,
    `L ${num(derivedExit)} ${num(bottomLane)}`,
    `L ${num(derivedExit + arrowHalfWidth)} ${num(bottomLane - arrowLength)}`,
  ].join(' ');

  return {
    path: parts.join(' '),
    arrow,
    columns: Array.from({ length: cols }, (_, col) => columnCentre(col)),
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
    const { col, row } = slotAt(index, rows);
    slots.push({ index, col, row });
  }

  return { cols: usedCols, rows, slots, track: buildTrack(usedCols, rows), unlockedCount: unlocked };
}

/**
 * 由合成鏈長度挑出**填得滿寬度**的列數。
 * Pick the row count that **fills the width** for a given chain length.
 *
 * 設計稿的 4×5 是從**19 格**反推的；實際的合成鏈只有 10 級時，沿用 5 列會讓走線只用到 2 欄，
 * 蛇形退化成「走完兩欄後從最右邊垂直下來」的一條直線 —— 那既不像蛇形、也浪費了整個面板的
 * 寬度。使用者回報的正是這個：10 個之後就變成 90° 一條直線。
 * The mock's 4×5 was reverse-engineered from **19 slots**; with an actual 10-level chain, keeping
 * 5 rows makes the walk use only 2 columns and the serpentine degenerates into "two columns, then
 * drop straight down the far right" — not serpentine, and it wastes the panel's width. That is
 * exactly what the user reported: a 90° straight line after the tenth cell.
 *
 * 選法：`rows = ceil(total / cols)`，讓每一欄分到差不多數量的格子，欄數自然填滿面板寬度。
 * 例：10 級、4 欄 → `ceil(10/4) = 3`，得到 3+3+3+1 的四欄分佈（比 5+5 的 2 欄高塔好得多）。
 * The rule is `rows = ceil(total / cols)`: each column gets a comparable share and the columns
 * fill the panel width. For 10 levels at 4 columns that is `ceil(10/4) = 3`, giving a 3+3+3+1
 * four-column spread — far better than a 5+5 two-column tower.
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
