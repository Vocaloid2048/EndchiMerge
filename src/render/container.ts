/**
 * 中央容器的平面 U 形外框。
 * The centre container's flat U-shaped shell.
 *
 * 容器是一件**平面**的 U 形玻璃槽：左牆、右牆、底部，頂端開口；底部兩個角是圓角，
 * 內部填一層半透明白。它**不是** 3D 盒體 —— 之前的斜投影線框已被平面 U 取代。
 * The container is a **flat** U-shaped glass trough: left wall, right wall, floor, open
 * top, rounded bottom corners and a translucent white interior fill. It is **not** a 3D
 * box; the earlier oblique-projection wireframe has been replaced by this flat U.
 *
 * **單一真實來源**：`frame` 是 U 形（也就是容器）的外框矩形。物理邊界由
 * `game/containerBox.ts` 從**同一個矩形**內縮出空腔與牆，所以畫面與碰撞永遠對得上。
 * **One source of truth**: `frame` is the U's outer rectangle, i.e. the container. The
 * physics boundaries are derived from **that same rectangle** by `game/containerBox.ts`,
 * so the drawn shell and the collider can never disagree.
 *
 * 可調參數全部來自 `public/config/container.json`：
 * `cornerRadius`（底部圓角）、`strokeWidth` / `strokeColor`（線框）、`fill`（內部填充）、
 * `topOffset`（U 形頂緣距畫布頂端的留白，投放用的頭部空間）。
 * Every tunable comes from `public/config/container.json`: `cornerRadius` (bottom corners),
 * `strokeWidth` / `strokeColor` (the outline), `fill` (interior), and `topOffset` (the
 * headroom between the canvas top and the U's rim, which the drop needs).
 *
 * 繪製順序是「裝在容器內」這個效果的全部來源：
 * The draw order is what sells "inside the container":
 *
 * 1. `drawContainerBack` —— 填內部（**在方團團之下**）。
 * 2. 方團團。
 * 3. `drawContainerFront` —— 描 U 形線框（**在方團團之上**）。
 *
 * 少了第 3 步，方團團看起來是貼在槽前面而不是裝在裡面。
 * Without step 3 the dumplings read as pasted on rather than sitting inside.
 */

import type { ContainerConfig, Rect } from '../core/types';

export interface ContainerGeometry {
  /** U 形（容器）的外框矩形；**物理遊戲區就是這個矩形**，再由 `containerBox` 內縮出空腔。 */
  frame: Rect;
  /** 底部兩個圓角的半徑，虛擬單位。 */
  cornerRadius: number;
  /** U 形線框粗細，虛擬單位。 */
  strokeWidth: number;
  /** U 形線框顏色。 */
  strokeColor: string;
  /** U 形內部的填充色。 */
  fill: string;
}

/**
 * 依容器尺寸與配置算出 U 形的外框。
 * Derive the U's outer rectangle from the container size and config.
 *
 * 寬度吃滿畫布；垂直方向在頂端留 `topOffset` 的空白，投放中的方團團就在這段空白裡出現。
 * 留白會被夾在 `[0, height - 1]`，所以退化輸入（畫布高 0）也拿得到正尺寸的矩形。
 * The width fills the canvas; vertically, `topOffset` of headroom is reserved at the top,
 * and that is where the in-flight dumpling appears. The offset is clamped to
 * `[0, height - 1]` so even degenerate input (zero-height canvas) yields a positive rect.
 *
 * @param width 容器寬（虛擬單位）/ Container width in virtual units.
 * @param height 容器高（虛擬單位）/ Container height in virtual units.
 */
export function computeContainerGeometry(
  width: number,
  height: number,
  config: ContainerConfig,
): ContainerGeometry {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const top = Math.max(0, Math.min(config.topOffset, h - 1));

  return {
    frame: { x: 0, y: top, width: w, height: Math.max(1, h - top) },
    cornerRadius: Math.max(0, config.cornerRadius),
    strokeWidth: Math.max(0, config.strokeWidth),
    strokeColor: config.strokeColor,
    fill: config.fill,
  };
}

/**
 * U 形路徑：由左上角往下、繞過底部兩個圓角、再沿右牆回到右上角。
 * The U path: down the left side, round the two bottom corners, up the right side.
 *
 * 刻意**不呼叫 `closePath()`** —— 那會補上一條頂邊，U 就變成封閉矩形。`fill()` 會隱式
 * 閉合子路徑，所以不必關閉也能正確填充內部。
 * Deliberately **no `closePath()`**: that would add the top edge and turn the U into a
 * closed rectangle. `fill()` closes the subpath implicitly, so the interior still fills.
 *
 * `arcTo` 需要路徑上已有一個點，因此圓角半徑為 0 時改走直角分支，避免 `arcTo` 拿到
 * 退化的切線。
 * `arcTo` needs an existing current point, so a zero radius takes the square-corner branch
 * instead of feeding `arcTo` a degenerate tangent.
 */
function uPath(ctx: CanvasRenderingContext2D, frame: Rect, radius: number): void {
  const left = frame.x;
  const right = frame.x + frame.width;
  const top = frame.y;
  const bottom = frame.y + frame.height;
  const r = Math.max(0, Math.min(radius, frame.width / 2, frame.height));

  ctx.beginPath();
  ctx.moveTo(left, top);

  if (r > 0) {
    ctx.lineTo(left, bottom - r);
    ctx.arcTo(left, bottom, left + r, bottom, r);
    ctx.lineTo(right - r, bottom);
    ctx.arcTo(right, bottom, right, bottom - r, r);
    ctx.lineTo(right, top);
  } else {
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right, top);
  }
}

/**
 * 畫「槽的內部」：U 形範圍的填充。應在方團團**之前**呼叫。
 * Draw the trough's interior fill. Call this before the dumplings.
 */
export function drawContainerBack(ctx: CanvasRenderingContext2D, geometry: ContainerGeometry): void {
  ctx.save();
  ctx.fillStyle = geometry.fill;
  uPath(ctx, geometry.frame, geometry.cornerRadius);
  ctx.fill();
  ctx.restore();
}

/**
 * 畫「槽的線框」：U 形輪廓。應在方團團**之後**呼叫。
 * Draw the trough's outline. Call this after the dumplings.
 *
 * 線框往內縮半個線寬，模擬設計稿的 `strokeAlign: INSIDE` —— 否則線寬一半會落在畫布
 * 之外被裁掉（畫布寬度就等於 U 的寬度）。頂端是開口的，所以不做垂直內縮。
 * The outline is inset by half its width to emulate the mock's `strokeAlign: INSIDE`;
 * otherwise half the stroke falls outside the canvas (whose width equals the U's width).
 * The top is open, so it is not inset vertically.
 */
export function drawContainerFront(ctx: CanvasRenderingContext2D, geometry: ContainerGeometry): void {
  const inset = geometry.strokeWidth / 2;
  const outline: Rect = {
    x: geometry.frame.x + inset,
    y: geometry.frame.y,
    width: Math.max(1, geometry.frame.width - inset * 2),
    height: Math.max(1, geometry.frame.height - inset),
  };

  ctx.save();
  ctx.lineWidth = geometry.strokeWidth;
  ctx.strokeStyle = geometry.strokeColor;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  uPath(ctx, outline, geometry.cornerRadius);
  ctx.stroke();
  ctx.restore();
}
