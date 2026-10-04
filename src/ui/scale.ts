/**
 * 設計畫布的等比縮放。
 * Uniform scaling of the design canvas.
 *
 * 這裡是「瀏覽器縮放不該改變 UI 比例」的落點。整個介面被放進一張固定 1920×1080 的
 * 畫布，再由這裡算出的**單一倍率** `transform: scale(k)` 整體縮放。
 * This is where "browser zoom must not change the UI's proportions" is enforced. The
 * whole interface sits on a fixed 1920×1080 canvas and is scaled as one unit by the
 * single factor computed here.
 *
 * 為什麼這樣就夠 / Why this is enough:
 *
 * - 面板、格距、字級全部寫死成設計稿的像素，彼此的比例不可能在縮放時走樣。
 *   Panels, pitches and type sizes are fixed design pixels, so their ratios cannot drift.
 * - 瀏覽器縮放只改變視窗的 CSS 像素數，也就是只改變 `k`。110% 縮放讓 `k` 下降，
 *   整個介面等比變小（在螢幕上的實際大小不變），版面沒有任何一格改變相對大小。
 *   Zoom only changes the viewport's CSS pixel count, hence only `k`. At 110% `k` drops
 *   and the whole UI shrinks uniformly, so no two elements change size relative to each
 *   other.
 * - 方團團與容器在**物理座標**裡的大小從頭到尾沒被碰過，所以「縮小視窗就能多塞幾隻」
 *   這種漏洞不存在。
 *   The dumplings and the container are never touched in physics units, so "zoom out and
 *   fit more in" simply cannot happen.
 *
 * 用 `min()` 而非 `max()`：設計稿是 16:9，非 16:9 的視窗會**留黑邊**（letterbox）。
 * 另一種做法是裁切（cover），但裁切會吃掉貼齊安全邊界的面板，等於破壞版面。
 * `min()` rather than `max()`: the design is 16:9, so other aspect ratios letterbox.
 * Cropping to fill would eat the panels that sit on the safe inset.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';

/**
 * 算出設計畫布該縮放幾倍。
 * Compute how much the design canvas should be scaled.
 *
 * @param viewportWidth 視窗寬度（CSS px）/ Viewport width in CSS pixels.
 * @param viewportHeight 視窗高度（CSS px）/ Viewport height in CSS pixels.
 * @param designWidth 設計畫布寬度 / Design canvas width.
 * @param designHeight 設計畫布高度 / Design canvas height.
 * @returns `min(vw / dw, vh / dh)`；輸入無效時回 0（呼叫端應據此跳過套用）。
 */
export function computeStageScale(
  viewportWidth: number,
  viewportHeight: number,
  designWidth: number = DESIGN_WIDTH,
  designHeight: number = DESIGN_HEIGHT,
): number {
  /*
   * 早期呼叫（版面尚未布局）或離屏時可能拿到 0；此時回 0 讓呼叫端略過，而不是套用
   * 一個會把畫面縮成一點的倍率。
   * Early calls before layout, or an offscreen host, can report 0. Returning 0 lets the
   * caller skip rather than applying a factor that collapses the canvas.
   */
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return 0;
  if (!(designWidth > 0) || !(designHeight > 0)) return 0;

  return Math.min(viewportWidth / designWidth, viewportHeight / designHeight);
}

/** 目前的視窗 CSS 像素尺寸。 */
function viewportSize(): { width: number; height: number } {
  const root = document.documentElement;
  return {
    /* clientWidth/Height 不含捲軸；版面已 `overflow: hidden`，因此等於可視區。 */
    width: root.clientWidth,
    height: root.clientHeight,
  };
}

/**
 * 把「置中 + 等比縮放」合成一條 transform 字串。
 * Compose centring and uniform scaling into a single transform string.
 *
 * **為何置中要寫進 transform，而不是靠父層 `display: grid; place-items: center`**：
 * `transform: scale()` 不改變元素的 layout 尺寸，所以這張 1920×1080 的畫布在幾乎所有
 * 視窗下都比容器大。而「置中一個比容器大的元素」並不保證置中 —— 瀏覽器會把溢出推到
 * 某一側（把元素貼齊 start），父層的 `overflow: hidden` 再把另一側裁掉。此時
 * `transform-origin: center center` 落在未變形盒子的中心 (960, 540)，而不是視窗中心，
 * 整張畫布就往右下漂。實測（Chrome，1076×519 視窗）：內容中心 (960, 540) 對視窗中心
 * (538, 260)，偏移 (+422, +281)；把視窗放大到超過 1920×1080 則偏移歸零 —— 這正是
 * 「25% 正常、100%–500% 跑位」的原因。
 * **Why centring belongs in the transform rather than the parent:** `transform: scale()`
 * leaves the layout size untouched, so this 1920×1080 canvas is larger than its host in
 * almost every viewport; and centring an oversized element is not guaranteed — the browser
 * aligns it to `start` and the host's `overflow: hidden` clips the other side.
 * `transform-origin: center center` then lands on the untransformed box centre (960, 540)
 * instead of the viewport centre, and the canvas drifts down-right. Measured in Chrome on
 * a 1076×519 viewport: content centre (960, 540) versus viewport centre (538, 260), an
 * offset of (+422, +281); grow the viewport past 1920×1080 and the offset goes to zero —
 * which is exactly why 25% looks right and 100%–500% does not.
 *
 * `translate(-50%, -50%)` 用**元素自身尺寸**把中點釘到父層中心，`scale()` 再以同一個
 * 中點縮放，所以結果與視窗大小、與瀏覽器如何處置溢出都無關。
 * `translate(-50%, -50%)` uses the element's **own** size to pin its centre to the host's
 * centre, and `scale()` scales about that same centre, so the result is independent of the
 * viewport size and of how the browser resolves overflow.
 *
 * @param scale CSS px / 虛擬單位 / CSS pixels per virtual unit.
 */
export function stageTransform(scale: number): string {
  return `translate(-50%, -50%) scale(${String(scale)})`;
}

/**
 * 把縮放倍率套到畫布上。
 * Apply the scale factor to the canvas.
 */
function applyScale(stage: HTMLElement, scale: number): void {
  stage.style.setProperty('--stage-scale', String(scale));
  stage.style.transform = stageTransform(scale);
}

export interface StageScaleOptions {
  /** 畫布節點，必須是 `.stage-scale`。 */
  stage: HTMLElement;
  /** 每次倍率變動時回報；供需要同步座標的模組使用。 */
  onScale?: (scale: number) => void;
}

/**
 * 開始讓畫布跟著視窗等比縮放。回傳取消函式。
 * Start scaling the canvas with the viewport; returns a disposer.
 *
 * 監看兩個來源：`resize` 事件（含瀏覽器縮放）與根元素的 `ResizeObserver`（含版面
 * 變動造成的尺寸改變）。只監看其中一個會漏掉另一類變化。
 * Two sources are watched: the `resize` event (which browser zoom fires) and a
 * `ResizeObserver` on the root element (which catches layout-driven changes). Watching
 * only one misses the other.
 */
export function attachStageScale(options: StageScaleOptions): () => void {
  const { stage, onScale } = options;
  let last = -1;

  const sync = (): void => {
    const { width, height } = viewportSize();
    const scale = computeStageScale(width, height);

    if (scale === 0 || scale === last) return;

    last = scale;
    applyScale(stage, scale);
    onScale?.(scale);
  };

  window.addEventListener('resize', sync);
  const observer = new ResizeObserver(sync);
  observer.observe(document.documentElement);

  /* 立即同步一次，避免第一幀之前畫面上仍是未縮放的 1920×1080 畫布。 */
  sync();

  return (): void => {
    window.removeEventListener('resize', sync);
    observer.disconnect();
  };
}
