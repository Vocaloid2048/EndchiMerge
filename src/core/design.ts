/**
 * 設計稿幾何：數字直接取自 `方團團.fig` 的 `Group 445`（1920×1080），版面只認這裡的座標。
 * Design-canvas geometry: every number comes straight from `Group 445` in `方團團.fig` (1920×1080); the layout reads only these coordinates.
 *
 * TypeScript 只持有它真的會讀的數字，純 CSS 用的值留在 `styles/*.css`。
 * TypeScript holds only the numbers it actually reads; CSS-only values stay in `styles/*.css`.
 */

import type { Rect } from './types';

/**
 * 設計畫布的邏輯尺寸（Figma frame 的原始尺寸，不是任何裝置的解析度）。
 * The design canvas' logical size (the Figma frame's raw size, not any device's resolution).
 */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/**
 * 安全邊界：設計稿的 `border` 節點是 (64,64) 1792×952，四邊各留 64，UI 不得越過。
 * The safe inset: the mock's `border` node is (64,64) 1792×952, i.e. 64 on every side; no UI may cross it.
 */
export const SAFE_INSET = 64;

/**
 * 面板圓角；設計稿所有面板共用同一個值。
 * The panel corner radius; the mock's panels all share it.
 */
export const PANEL_RADIUS = 32;

/**
 * 各區域的設計稿矩形，鍵名對應 `ui/layout.ts` 的區域；原點是 frame 左上角。
 * Design-space rectangles per region, keyed to match `ui/layout.ts`; the origin is the frame's top-left corner.
 */
export const LAYOUT_RECTS = {
  /** ① SCORE 面板（`1408:2246`）。 */
  score: { x: 64, y: 64, width: 435, height: 287 },
  /** ⑤ SKILL LIST 面板（`1408:2694`）。 */
  skill: { x: 64, y: 375, width: 435, height: 641 },
  /**
   * 返回鍵（`1408:2092`）：與 SCORE 面板完全重疊，設計稿本身看不到它；只作紀錄，不渲染。
   * Back button: its rect sits exactly under the SCORE panel, so the mock never renders it; recorded, not drawn.
   */
  back: { x: 64, y: 64, width: 128, height: 128 },
  /** ⑥ 容器（`1408:2110`，含透視偏移的完整包圍盒）。 */
  container: { x: 627, y: 140, width: 667, height: 845 },
  /** ③ NEXT 卡（`1408:2236`）。 */
  next: { x: 1421, y: 180, width: 163, height: 171 },
  /** ④ COMBO 卡（`1408:2237`），與 NEXT 同高並排。 */
  combo: { x: 1601, y: 180, width: 255, height: 171 },
  /** ⑦ MELTING LIST 面板（`1408:2235`）。 */
  melting: { x: 1421, y: 372, width: 435, height: 644 },
  /**
   * ② 工具列膠囊（`1408:2064`）：設計稿的五顆 72×72 圓鈕 ＋ 4×16 間距 ＋ 2×13 內距 ＝ 450 寬。
   * The toolbar capsule (`1408:2064`): the mock's five 72×72 round buttons plus 4×16 gaps and 2×13 padding = 450 wide.
   */
  toolGroup: { x: 1262, y: 64, width: 450, height: 96 },
  /** ② 音樂開關（`1408:2086`），獨立於膠囊之外。 */
  music: { x: 1760, y: 64, width: 96, height: 96 },
} as const satisfies Record<string, Rect>;

/**
 * 供 `ui/layout.ts` 定位用的區域鍵（不含只作紀錄的 `back`）。
 * Region keys for `ui/layout.ts` (excluding the record-only `back`).
 */
export type LayoutKey = Exclude<keyof typeof LAYOUT_RECTS, 'back'>;

/**
 * MELTING LIST 的格網幾何：由設計稿的 19 個格子反推（4 欄 × 5 列，第 1 列缺一格是欄序走法的痕跡）。
 * The MELTING LIST grid geometry, derived from the mock's 19 slots (4 columns × 5 rows; the missing slot in row 1 betrays the column-major walk).
 *
 * 這組數字同時被演算法與 CSS 使用，由 `ui/designTokens.ts` 橋接成 CSS 變數，兩邊不各抄一份。
 * Both the algorithm and CSS read these, so `ui/designTokens.ts` bridges them into CSS variables instead of a second copy.
 */
export const MELTING = {
  cols: 4,
  rows: 5,
  /**
   * 格網內容區，相對於面板。
   * The grid's content box, relative to the panel.
   */
  content: { x: 21, y: 104, width: 367, height: 472 },
  /**
   * 單格尺寸（含間隙）。
   * One cell's size including its gap.
   */
  cellWidth: 84.25,
  cellHeight: 94.4,
  /**
   * 每格內素材的最大邊長。
   * The largest art edge inside a cell.
   */
  artSize: 80,
  /**
   * 右側蛇形走道寬度。
   * The serpentine lane's width on the right.
   */
  laneWidth: 30,
  /**
   * 蛇形走線的參數：走法是橫向蛇形（S 形），實際用到的欄數在內容區裡置中，
   * 左右走道貼著格網左右緣再各向外伸 `laneOverhang`，整個 S 比格網寬且左右對稱。
   * The serpentine track parameters: a row-major S walk with the used columns centred in the content box and both lanes reaching `laneOverhang` beyond the grid — wider than the grid and always symmetric.
   *
   * 最後一隻方團團之後的走線以虛線呈現（「路還沒修到那裡」，與未解鎖的灰格同一語意）；
   * 走線是一條畫在素材之下的連續線，不是每格一段短線。
   * The track past the last dumpling is dashed ("the road is not built that far yet", matching a locked grey tile); the path is one continuous line drawn under the art, not a tick per cell.
   */
  track: {
    /**
     * 左右走道超出格網左右緣的長度（內容區座標）；S 形因此比格網寬。
     * How far each lane reaches beyond the grid's edges, in content coordinates; the S is wider than the grid because of it.
     */
    laneOverhang: 8,
    /**
     * 出欄線距格網底緣的內縮。
     * The exit line's inset from the grid's bottom edge.
     */
    exitInset: 3,
    /**
     * 轉彎圓角；沿用設計稿 `vectorData.styleOverrideTable` 的 `cornerRadius`。
     * The corner fillet, matching the mock's `vectorData.styleOverrideTable` `cornerRadius`.
     */
    cornerRadius: 32,
    /**
     * 線寬；設計稿的 `strokeWeight`。
     * The stroke width, the mock's `strokeWeight`.
     */
    strokeWidth: 5,
    /**
     * 箭頭由尖端往後量的長度與半寬。
     * The arrow's length and half-width, measured back from its tip.
     */
    arrowLength: 20.2,
    arrowHalfWidth: 17.7,
  },
} as const;
