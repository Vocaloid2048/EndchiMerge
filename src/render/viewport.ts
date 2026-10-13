/**
 * 世界座標系與畫布縮放：鎖定虛擬高度（難度由垂直空間決定），寬度隨容器浮動。
 * World coordinates and canvas scaling: virtual height is locked (difficulty is vertical), the width floats with the container.
 *
 * 物理一律在虛擬單位下計算，`scale` 只出現在投影；resize 不必搬動任何剛體，只有牆壁與溢位線要重算。
 * Physics runs entirely in virtual units and `scale` only appears in projection; a resize moves no body — only the walls and the overflow line are recomputed.
 */

import { VIRTUAL_HEIGHT } from '../core/constants';

export interface ViewportOptions {
  /**
   * 虛擬高度；預設為全域常數。
   * Virtual height, defaults to the global constant.
   */
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

  /**
   * 2D 繪圖上下文。
   * The 2D rendering context.
   */
  get context(): CanvasRenderingContext2D {
    return this.ctx;
  }

  /**
   * 虛擬高度（常數）。
   * The virtual height (constant).
   */
  get virtualHeight(): number {
    return this.height;
  }

  /**
   * 目前可見的虛擬寬度，隨容器寬度浮動。
   * The currently visible virtual width, floating with the container.
   */
  get virtualWidth(): number {
    return this.currentVirtualWidth;
  }

  /**
   * CSS px / 虛擬單位。
   * CSS px per virtual unit.
   */
  get scale(): number {
    return this.currentScale;
  }

  /**
   * 畫布的 CSS 像素尺寸。
   * The canvas' CSS pixel size.
   */
  get cssSize(): { width: number; height: number } {
    return { width: this.widthPx, height: this.heightPx };
  }

  /**
   * 依目前 CSS 尺寸重算畫布的後備儲存與縮放；回傳尺寸是否有變（true 表示需要重繪）。
   * Recomputes the backing store and scale from the current CSS size; returns whether the size changed (true means redraw).
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
   * 把繪圖上下文切到虛擬單位；之後所有繪製都用虛擬座標，不需自行換算。
   * Switches the context to virtual units so every draw call can use virtual coordinates directly.
   */
  applyTransform(): void {
    const factor = this.currentScale * this.dpr;
    this.ctx.setTransform(factor, 0, 0, factor, 0, 0);
  }

  /**
   * 清空整張畫布（虛擬座標空間）。
   * Clears the whole canvas (in virtual space).
   */
  clear(): void {
    this.applyTransform();
    this.ctx.clearRect(0, 0, this.currentVirtualWidth, this.height);
  }

  /**
   * 虛擬座標 → CSS 像素，用於把 HTML 元素疊在畫面上。
   * Virtual to CSS pixels, for overlaying HTML on the canvas.
   */
  toScreen(point: VirtualPoint): VirtualPoint {
    return { x: point.x * this.currentScale, y: point.y * this.currentScale };
  }

  /**
   * 相對元素的 CSS 像素 → 虛擬座標，用於處理指標事件。
   * Element-relative CSS pixels to virtual coordinates, for pointer handling.
   *
   * 一定要傳「相對元素的」像素並先除掉 CSS 縮放：畫布活在被 `transform: scale(k)`
   * 縮放過的樹裡，`getBoundingClientRect()` 是縮放後的尺寸，直接餵會讓指標比畫面快 k 倍。
   * Pass element-relative pixels and divide out the CSS scale: the canvas lives inside a tree scaled by `transform: scale(k)`, so the rect is the scaled size and feeding it raw makes the pointer outrun the screen by a factor of k.
   *
   * `rect` 是指標事件當下 `getBoundingClientRect()` 的結果（已縮放）；`clientX`／`clientY`
   * 是事件的視窗座標（CSS px）。指標落在元素之外時回傳 `null`。
   * `rect` is the (scaled) result of `getBoundingClientRect()` at event time; `clientX`/`clientY` are the event's client coordinates in CSS px. Returns `null` outside the element.
   */
  toVirtual(rect: DOMRectReadOnly, clientX: number, clientY: number): VirtualPoint | null {
    if (this.widthPx <= 0 || this.heightPx <= 0 || rect.width <= 0 || rect.height <= 0) return null;

    /*
     * 元素的實際 CSS 縮放倍率（＝外層 transform 的 k）；基準是未縮放的 `clientWidth`。
     */
    const k = rect.width / this.widthPx;
    if (!(k > 0)) return null;

    /* 相對元素的未縮放 CSS 像素。 */
    const localX = (clientX - rect.left) / k;
    const localY = (clientY - rect.top) / k;

    /* 指標落在元素之外時不回應，與瀏覽器不在元素外派發事件的行為一致。 */
    if (localX < 0 || localY < 0 || localX > this.widthPx || localY > this.heightPx) return null;

    const factor = this.currentScale > 0 ? this.currentScale : 1;

    return { x: localX / factor, y: localY / factor };
  }

  /**
   * 監看容器尺寸變化；回傳一個取消函式。
   * Observes container size changes; returns a disposer.
   */
  observe(onResize: () => void): () => void {
    const observer = new ResizeObserver((): void => onResize());
    observer.observe(this.canvas);
    /* 立即回報一次，讓呼叫端不必自己先跑一遍。 */
    onResize();
    return (): void => observer.disconnect();
  }
}
