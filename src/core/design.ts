/**
 * 設計稿幾何。
 * Design-canvas geometry.
 *
 * 這裡的每個數字都直接來自 Figma 檔 `方團團.fig` 裡的 **`Group 445`**（1920×1080，id
 * `1408:2062`）。它是主畫面的唯一真實來源：面板位置、尺寸、間距、安全邊界都以此為準。
 * Every number here is taken straight from the **`Group 445`** frame (1920×1080, id
 * `1408:2062`) in `方團團.fig`, the single source of truth for panel position, size,
 * spacing and the safe inset.
 *
 * **為何要有這支檔案 / Why this module exists**
 *
 * 版面之所以會「在瀏覽器 110% / 90% 時整個走樣」，是因為面板尺寸用 `clamp()`／百分比
 * 跟著視窗跑。改用固定設計畫布後，版面只認這裡的座標；縮放交給 `ui/scale.ts` 對整個
 * 畫布做一次等比 `transform: scale()`。於是瀏覽器縮放只改變一個倍率，面板比例、
 * 名冊格距、方團團與容器的相對大小全部不動。
 * The layout drifted under browser zoom because panel sizes followed the viewport via
 * `clamp()` and percentages. With a fixed design canvas the layout only reads these
 * coordinates, and `ui/scale.ts` scales the whole canvas once. Zoom then changes a single
 * factor and nothing inside moves.
 *
 * **誰擁有哪個數字 / Who owns which number**
 *
 * TypeScript **只**持有它真的會讀的數字：畫布尺寸、面板矩形、名冊格網（蛇形演算法要
 * 用）。純粹由 CSS 使用的數字（字級、工具列按鈕、技能卡內部）留在 `styles/*.css`，
 * 並在該處註明對應的 Figma 節點 —— 把只給 CSS 用的值也搬進來只會多一份會漂移的副本，
 * 而那些值沒有任何程式在讀。
 * TypeScript holds **only** numbers it actually reads. Values used purely by CSS live in
 * `styles/*.css` with the Figma node named beside them; hoisting them here would add a
 * second copy that nothing but CSS reads, and second copies drift.
 *
 * **一處刻意偏離設計稿 / One deliberate departure**
 *
 * 設計稿的技能欄 (375..1018) 與名冊欄 (372..1015) 底緣差 3px。這裡統一對齊安全區下緣
 * 1016：兩欄差 2–3px 肉眼不可見，但程式只需要一條對齊規則。
 * The mock's skill and roster columns end 3px apart; both are aligned to the safe bottom
 * here, because 2–3px is invisible while a second alignment rule is permanent.
 *
 * **設計稿沒有畫出來的東西 / What the mock does not draw**
 *
 * `Group 445` 把返回鍵放在 (64,64)，而 SCORE 面板也在 (64,64) 435×287，面板的 z-order
 * 在後，所以**設計稿本身完全看不到返回鍵**（縮圖已確認）。裁定是「照設計稿，不顯示」，
 * 因此 `LAYOUT_RECTS.back` 只作紀錄，不由 `ui/layout.ts` 渲染。日後 M6 的解鎖頁需要離開
 * 入口時再決定它該放哪。
 * The mock puts the back button at (64,64) and the SCORE panel at the same point; the
 * panel is later in z-order, so the mock renders no back button at all. The decision was
 * to follow the mock, so `LAYOUT_RECTS.back` is a record only.
 */

import type { Rect } from './types';

/**
 * 設計畫布的邏輯尺寸。
 * The design canvas' logical size.
 *
 * 這是 **Figma frame `Group 445` 的原始尺寸**，不是任何裝置的解析度。所有面板座標都是
 * 這個空間裡的像素；實機上整個畫布被等比縮放。
 * The raw size of the Figma frame, not any device's resolution.
 */
export const DESIGN_WIDTH = 1920;
export const DESIGN_HEIGHT = 1080;

/**
 * 安全邊界。設計稿的 `border` 節點是 (64,64) 1792×952，也就是四邊各留 64。
 * 沒有任何 UI 應該越過它。
 * The safe inset. The mock's `border` node is (64,64) 1792×952, i.e. 64 on every side.
 */
export const SAFE_INSET = 64;

/** 面板圓角；設計稿所有面板共用同一個值。 */
export const PANEL_RADIUS = 32;

/**
 * 各區域的設計稿矩形，鍵名對應 `ui/layout.ts` 的區域。
 * Design-space rectangles per region, keyed to match `ui/layout.ts`.
 *
 * 座標系原點是 **frame 左上角**，不是畫面左上角。
 * The origin is the frame's top-left corner, not the screen's.
 */
export const LAYOUT_RECTS = {
  /** ① SCORE 面板（`1408:2246`）。 */
  score: { x: 64, y: 64, width: 435, height: 287 },
  /** ⑤ SKILL LIST 面板（`1408:2694`）。 */
  skill: { x: 64, y: 375, width: 435, height: 641 },
  /**
   * 返回鍵（`1408:2092`）。設計稿座標與 SCORE 面板完全重疊，設計稿本身看不到它；
   * 這裡只作紀錄，不渲染（見檔頭說明）。
   * Back button. Its rect sits exactly under the SCORE panel so the mock never renders
   * it; recorded here, not drawn.
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
  /** ② 工具列的五圖示膠囊（`1408:2064` `hover_function_row`）。 */
  toolGroup: { x: 1262, y: 64, width: 450, height: 96 },
  /** ② 音樂開關（`1408:2086`），獨立於膠囊之外。 */
  music: { x: 1760, y: 64, width: 96, height: 96 },
} as const satisfies Record<string, Rect>;

/** 供 `ui/layout.ts` 定位用的區域鍵（不含只作紀錄的 `back`）。 */
export type LayoutKey = Exclude<keyof typeof LAYOUT_RECTS, 'back'>;

/**
 * MELTING LIST 的格網幾何。
 * The MELTING LIST grid geometry.
 *
 * 由設計稿的 19 個格子反推而來（`1408:2234` 底下的 19 個 `ROUNDED_RECTANGLE`）：內容區
 * 367×472、**4 欄 × 5 列**、欄距 84.25、列距 94.4。第 1 列只有 3 格、其餘 4 格，這個
 * 「缺一格」正是**直行蛇形**留下的痕跡 —— 先由上而下走完第 1 欄，再由下而上走第 2 欄；
 * 若是橫向蛇形，缺的會是最後一列而不是第一列。
 * Derived from the mock's 19 slots: a 367×472 content box, **4 columns × 5 rows**, pitched
 * 84.25 by 94.4. Row 1 holds three slots and the rest hold four, and that gap is the
 * signature of a **column-major serpentine** — down column 1, then up column 2. A
 * row-major walk would leave the gap in the last row instead.
 *
 * 右側 30px 的走道留給蛇形連接線。
 * The 30px lane on the right is for the serpentine connector.
 *
 * 這組數字同時被演算法（欄列數）與 CSS（格子的像素尺寸）使用，所以由
 * `ui/designTokens.ts` 橋接成 CSS 變數，兩邊不會各抄一份。
 * Both the algorithm (column and row counts) and CSS (pixel pitches) read these, so
 * `ui/designTokens.ts` bridges them into CSS variables rather than duplicating them.
 */
export const MELTING = {
  cols: 4,
  rows: 5,
  /** 格網內容區，相對於面板。 */
  content: { x: 21, y: 104, width: 367, height: 472 },
  /** 單格尺寸（含間隙）。 */
  cellWidth: 84.25,
  cellHeight: 94.4,
  /** 每格內素材的最大邊長。 */
  artSize: 80,
  /** 右側蛇形走道寬度。 */
  laneWidth: 30,
  /**
   * 蛇形走線的參數。
   * The serpentine track parameters.
   *
   * **走法是橫向蛇形（S 形）**（使用者定案）：第一列由左而右、第二列由右而左，如此類推。
   * **幾何在使用者第二次定案後改為「格網置中＋走道外拓」**：實際用到的欄數在內容區裡
   * 左右置中（`gridOffsetX()`，見 `ui/serpentine.ts`），左右走道則貼著格網左右緣再各向
   * 外伸 `laneOverhang` —— 整個 S 比格網更寬、且永遠左右對稱，不再沿用設計稿直行版
   * 「走道藏在首／末欄中心內側」的內縮（那個內縮是給直行版用的，鏡射到橫向後左 29.925、
   * 右 44 並不對稱，使用者看到的正是這個歪的 S）。
   * **The walk is row-major (an S shape), per the user's decision**: row 1 runs left to right,
   * row 2 right to left, and so on. **The geometry was recentered and widened in the user's
   * second decision**: the columns actually used are centred in the content box
   * (`gridOffsetX()`, see `ui/serpentine.ts`), and the two lanes reach `laneOverhang` beyond
   * the used grid's left/right edges — the whole S is wider than the grid and always
   * symmetric. This drops the mock's column-major inset (lanes hidden inside the outer
   * columns), which mirrored onto the row-major track as an asymmetric 29.925/44 pair — the
   * lopsided S the user reported.
   *
   * - 出欄線沿用設計稿：直行版出欄線 364 ＝ 內容區右緣 367 內縮 3 → 橫向版的**出欄線**
   *   ＝ 格網底緣內縮 3。
   *   The exit line keeps the mock's relation: the mock's exit line 364 = content right edge
   *   367 inset by 3 → the row-major **exit line** = grid bottom inset by 3.
   *
   * **虛線段**（使用者定案）：最後一隻方團團之後的走線以虛線呈現（見 `buildTrack()` 的
   * `dash`）—— 「路還沒修到那裡」，與未解鎖的灰格同一種語意。
   * **The dashed tail** (the user's decision): the track past the last dumpling is dashed
   * (see `dash` in `buildTrack()`) — "the road is not built that far yet", the same semantics
   * as a locked grey tile.
   *
   * **為何不是「每格一段短線」**：表面上看到的是一節一節的短線，但那是因為整條線畫在
   * 素材**之下**，只有格與格之間的縫隙露得出來。所以正確的做法是一條連續線，不是十幾
   * 條獨立線段 —— 兩者在縫隙裡看起來一樣，但連續線在轉彎處才有那四個圓角。
   * **Why not one short tick per pair**: the broken line is an illusion — the path is drawn
   * **under** the art, so only the gaps between cells show through. One continuous path is
   * therefore the right model, not a dozen independent segments; they look the same inside
   * the gaps, but only the continuous path carries the four fillets.
   */
  track: {
    /** 左右走道超出格網左右緣的長度（內容區座標）；S 形因此比格網寬。 */
    laneOverhang: 8,
    /** 出欄線距格網底緣的內縮。 */
    exitInset: 3,
    /** 轉彎圓角；沿用設計稿 `vectorData.styleOverrideTable` 的 `cornerRadius`。 */
    cornerRadius: 32,
    /** 線寬；設計稿的 `strokeWeight`。 */
    strokeWidth: 5,
    /** 箭頭由尖端往後量的長度與半寬。 */
    arrowLength: 20.2,
    arrowHalfWidth: 17.7,
  },
} as const;
