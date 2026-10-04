/**
 * 世界座標系與畫布縮放。
 * World coordinate system and canvas scaling.
 *
 * 依 design.md §2.4（D18）**鎖定虛擬高度**：垂直空間決定遊戲難度（堆疊高度、
 * 溢出線），因此把世界高度固定為 `VIRTUAL_HEIGHT`，寬度隨容器實際像素寬浮動。
 * 換裝置時只有「橫向餘裕」改變，難度曲線不動。
 * Height is locked (D18) because vertical space determines difficulty; the width
 * floats with the container. Changing devices only changes horizontal room.
 *
 * 三個容易搞錯的點 / Three things that are easy to get wrong:
 *
 * 1. **物理不看 `scale`**。物理一律在虛擬單位下計算，`scale` 只出現在投影。
 *    Physics runs entirely in virtual units; `scale` only appears when projecting.
 * 2. **`scale` 的單位是 CSS px / 虛擬單位**，不是 device px。`devicePixelRatio`
 *    只在 `applyTransform()` 裡乘進去，避免每個呼叫點各自乘一次。
 *    `scale` is CSS px per virtual unit; the DPR lives only in `applyTransform()`.
 * 3. **既有物體的位置是虛擬單位**，所以 resize 不需要搬動任何剛體 —— 只有牆壁與
 *    溢出線需要依新的 `virtualWidth` 重算。這正是鎖虛擬高度的直接好處。
 *    Existing bodies are already in virtual units, so a resize only moves the walls.
 */

import { VIRTUAL_HEIGHT } from '../core/constants';

export interface ViewportOptions {
  /** 虛擬高度；預設為全域常數 / Virtual height, defaults to the global constant. */
  virtualHeight?: number;
}

export interface VirtualPoint {
  x: number;
  y: number;
}

export class Viewport {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly height: number;

  /** CSS px / 虛擬單位。 */
  private currentScale = 1;
  private currentVirtualWidth = 0;
  private widthPx = 0;
  private heightPx = 0;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement, options: ViewportOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('Could not acquire a 2D context for the stage canvas.');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.height = options.virtualHeight ?? VIRTUAL_HEIGHT;
  }

  /** 2D 繪圖上下文。 */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /** 虛擬高度（常數）。 */
  get virtualHeight(): number {
    return this.height;
  }

  /** 目前可見的虛擬寬度，隨容器寬度浮動。 */
  get virtualWidth(): number {
    return this.currentVirtualWidth;
  }

  /** CSS px / 虛擬單位。 */
  get scale(): number {
    return this.currentScale;
  }

  /** 畫布的 CSS 像素尺寸。 */
  get cssSize(): { width: number; height: number } {
    return { width: this.widthPx, height: this.heightPx };
  }

  /**
   * 依目前 CSS 尺寸重算畫布的後備儲存與縮放。
   * Recompute the backing store and scale from the current CSS size.
   *
   * @returns 尺寸是否有變（true 表示需要重繪）/ Whether the size changed.
   */
  resize(): boolean {
    /* clientWidth/Height 是整數 CSS px；離屏或隱藏時可能為 0，此時不做任何事。 */
    const cssWidth = this.canvas.clientWidth;
    const cssHeight = this.canvas.clientHeight;

    if (cssWidth === 0 || cssHeight === 0) return false;

    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const backingWidth = Math.max(1, Math.round(cssWidth * dpr));
    const backingHeight = Math.max(1, Math.round(cssHeight * dpr));

    const sizeChanged = this.widthPx !== cssWidth || this.heightPx !== cssHeight || this.dpr !== dpr;

    this.widthPx = cssWidth;
    this.heightPx = cssHeight;
    this.dpr = dpr;
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;

    this.currentScale = cssHeight / this.height;
    this.currentVirtualWidth = cssWidth / this.currentScale;

    return sizeChanged;
  }

  /**
   * 把繪圖上下文切到虛擬單位。之後所有繪製都用虛擬座標，不需自行換算。
   * Switch the context to virtual units so every draw call can use virtual
   * coordinates directly.
   */
  applyTransform(): void {
    const factor = this.currentScale * this.dpr;
    this.ctx.setTransform(factor, 0, 0, factor, 0, 0);
  }

  /** 清空整張畫布（虛擬座標空間）。 */
  clear(): void {
    this.applyTransform();
    this.ctx.clearRect(0, 0, this.currentVirtualWidth, this.height);
  }

  /**
   * 虛擬座標 → CSS 像素，用於把 HTML 元素疊在畫面上（例如「」選取框）。
   * Virtual to CSS pixels, for overlaying HTML on the canvas.
   */
  toScreen(point: VirtualPoint): VirtualPoint {
    return { x: point.x * this.currentScale, y: point.y * this.currentScale };
  }

  /**
   * CSS 像素 → 虛擬座標，用於處理指標事件。
   * CSS pixels to virtual, for pointer handling.
   *
   * @param offsetX 事件相對畫布左緣的 CSS 像素 / Pointer offset in CSS pixels.
   * @param offsetY 事件相對畫布上緣的 CSS 像素 / Pointer offset in CSS pixels.
   */
  toVirtual(offsetX: number, offsetY: number): VirtualPoint {
    return { x: offsetX / this.currentScale, y: offsetY / this.currentScale };
  }

  /**
   * 監看容器尺寸變化。回傳一個取消函式。
   * Observe container size changes; returns a disposer.
   */
  observe(onResize: () => void): () => void {
    const observer = new ResizeObserver((): void => onResize());
    observer.observe(this.canvas);
    /* 立即回報一次，讓呼叫端不必自己先跑一遍。 */
    onResize();
    return (): void => observer.disconnect();
  }
}
