/**
 * 設計畫布的等比縮放：整個介面是一張固定 1920×1080 的畫布，由單一倍率 `transform: scale(k)` 整體縮放。
 * Uniform scaling of the design canvas: the whole UI is one fixed 1920×1080 canvas, scaled as a unit by a single `transform: scale(k)`.
 *
 * 用 `min()` 而非 `max()`：非 16:9 的視窗留黑邊；裁切（cover）會吃掉貼齊安全邊界的面板。
 * `min()` rather than `max()`: other aspect ratios letterbox; cropping would eat the panels on the safe inset.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../core/design';

/**
 * 算出設計畫布該縮放幾倍：`min(vw / dw, vh / dh)`；輸入無效時回 0（呼叫端應據此跳過套用）。
 * Computes the design canvas' scale factor: `min(vw / dw, vh / dh)`; 0 for invalid input (the caller then skips applying it).
 */
export function computeStageScale(
  viewportWidth: number,
  viewportHeight: number,
  designWidth: number = DESIGN_WIDTH,
  designHeight: number = DESIGN_HEIGHT,
): number {
  /*
   * 早期呼叫（版面尚未布局）或離屏時可能拿到 0；此時回 0 讓呼叫端略過，
   * 而不是套用一個會把畫面縮成一點的倍率。
   * Early calls before layout, or an offscreen host, can report 0. Returning 0 lets the caller skip rather than applying a factor that collapses the canvas.
   */
  if (!(viewportWidth > 0) || !(viewportHeight > 0)) return 0;
  if (!(designWidth > 0) || !(designHeight > 0)) return 0;

  return Math.min(viewportWidth / designWidth, viewportHeight / designHeight);
}

/**
 * 目前的視窗 CSS 像素尺寸。
 * The viewport's current CSS pixel size.
 */
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
 * Composes centring and uniform scaling into a single transform string.
 *
 * 置中必須寫進 transform，而不能靠父層 grid 置中：`transform: scale()` 不改變 layout 尺寸，
 * 比容器大的元素會被推到 start 再裁掉，`transform-origin` 因此落在未變形盒子的中心而非視窗中心。
 * Centring must live in the transform, not the parent: `scale()` leaves the layout size untouched, so an oversized element is pushed to `start` and clipped, and `transform-origin` lands on the untransformed centre rather than the viewport centre.
 *
 * `translate(-50%, -50%)` 用元素自身尺寸把中點釘到父層中心，結果與視窗大小無關。
 * `translate(-50%, -50%)` pins the centre to the host's centre using the element's own size, so the result is viewport-independent.
 */
export function stageTransform(scale: number): string {
  return `translate(-50%, -50%) scale(${String(scale)})`;
}

/**
 * 把縮放倍率套到畫布上。
 * Applies the scale factor to the canvas.
 */
function applyScale(stage: HTMLElement, scale: number): void {
  stage.style.setProperty('--stage-scale', String(scale));
  stage.style.transform = stageTransform(scale);
}

export interface StageScaleOptions {
  /**
   * 畫布節點，必須是 `.stage-scale`。
   * The canvas node, expected to be `.stage-scale`.
   */
  stage: HTMLElement;
  /**
   * 每次倍率變動時回報；供需要同步座標的模組使用。
   * Reported on every factor change, for modules that must sync coordinates.
   */
  onScale?: (scale: number) => void;
}

/**
 * 開始讓畫布跟著視窗等比縮放，回傳取消函式；同時監看 `resize` 事件與根元素的
 * `ResizeObserver`（只看其中一個會漏掉另一類變化）。
 * Starts viewport-driven scaling and returns a disposer; both the `resize` event and a root `ResizeObserver` are watched — one alone misses the other.
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
