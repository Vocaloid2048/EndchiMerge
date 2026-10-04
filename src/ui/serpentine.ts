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
 * SVG 的 `sweep-flag` 只有兩個值，這裡用「往下走就是 0、往上走就是 1」的通則決定 ——
 * 直行蛇形裡同一個 U-turn 的兩個圓角一定同向，所以一個旗標就夠。
 * The SVG sweep flag has only two values; the rule here is "downward = 0, upward = 1".
 * Both fillets of one U-turn always share a direction, so a single flag suffices.
 */
function buildTrack(cols: number): RosterTrack | null {
  if (cols < 1) return null;

  const pitch = MELTING.cellWidth;
  const { topLane, bottomLane, exitX, cornerRadius, arrowLength, arrowHalfWidth } = MELTING.track;

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
  parts.push(`L ${num(exitX)} ${num(endLane)}`);
  if (endLane !== bottomLane) parts.push(`L ${num(exitX)} ${num(bottomLane)}`);

  const arrow = [
    `M ${num(exitX - arrowHalfWidth)} ${num(bottomLane - arrowLength)}`,
    `L ${num(exitX)} ${num(bottomLane)}`,
    `L ${num(exitX + arrowHalfWidth)} ${num(bottomLane - arrowLength)}`,
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

  return { cols: usedCols, rows, slots, track: buildTrack(usedCols), unlockedCount: unlocked };
}
