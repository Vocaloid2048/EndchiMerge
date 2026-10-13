/**
 * 中央容器的平面 U 形外框：`frame` 是容器的**單一真實來源**，`display` 則是加了左右展示餘裕的可繪製範圍。
 * The centre container's flat U-shaped shell; `frame` is the single source of truth and `display` the drawable region.
 */

import type { ContainerConfig, Rect } from '../core/types';

export interface ContainerGeometry {
  /**
   * U 形（容器）的外框矩形；**物理遊戲區就是這個矩形**，再由 `containerBox` 內縮出空腔。
   * The U's (container's) outer rectangle; the physics play area is this rectangle.
   */
  frame: Rect;
  /**
   * **可繪製範圍**：外框（`frame`）加上左右展示餘裕，即整張畫布。
   * The **drawable region**: `frame` plus the left/right display margins, i.e. the canvas.
   *
   * 裁切不隨容器晃動，所以固定在容器靜止時的範圍；`GameSession` 疊上搖晃位移時**只改 `frame`、不動這裡**。
   * The clip must not shake with the container: the shake offset is folded into `frame` only.
   */
  display: Rect;
  cornerRadius: number;
  strokeWidth: number;
  strokeColor: string;
  fill: string;
}

/**
 * 依容器尺寸與配置算出 U 形的外框：寬度吃滿畫布，頂端留 `topOffset` 頭部空間，左右各讓開 `leftOffset` / `rightOffset`。
 * Derive the U's outer rectangle; the width fills the canvas and the margins are clamped so the frame stays positive.
 *
 * 留白一律夾在合法範圍內（`topOffset` 至 `height - 1`），退化輸入（畫布高 0）也拿得到正尺寸的矩形。
 * Offsets are clamped so even degenerate input (zero-height canvas) yields a positive rect.
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

  // 底部托高：留給技能選取提示的帶狀區，但不得吃掉整個畫布（至少留 1 單位的外框）。
  // The bottom raise: the strip reserved for the skill-selection hint, never swallowing the whole canvas.
  const bottom = Math.max(0, Math.min(config.bottomOffset, h - top - 1));

  // 餘裕各夾在畫布寬的 40% 以內，否則兩邊吃滿會把容器壓成一條線。
  // Each margin is clamped to 40% of the canvas width, or both together would collapse the container.
  const maxMargin = w * 0.4;
  const left = Math.max(0, Math.min(config.leftOffset, maxMargin));
  const right = Math.max(0, Math.min(config.rightOffset, maxMargin));

  const frame: Rect = {
    x: left,
    y: top,
    width: Math.max(1, w - left - right),
    height: Math.max(1, h - top - bottom),
  };

  return {
    frame,
    // 可繪製範圍＝整張畫布，刻意不隨 `bottom` 縮短，否則搖晃時探出底緣的美術會被切掉。
    // The drawable region is the whole canvas, deliberately not shortened by `bottom`.
    display: { x: 0, y: top, width: w, height: Math.max(1, h - top) },
    cornerRadius: Math.max(0, config.cornerRadius),
    strokeWidth: Math.max(0, config.strokeWidth),
    strokeColor: config.strokeColor,
    fill: config.fill,
  };
}

/**
 * U 形路徑：由左上角往下、繞過底部兩個圓角、再沿右牆回到右上角；半徑 0 時走直角分支。
 * The U path: down the left, round the two bottom corners, up the right; zero radius takes the square-corner branch.
 *
 * 刻意**不呼叫 `closePath()`** —— 那會補上頂邊把 U 變成封閉矩形；`fill()` 本就會隱式閉合子路徑。
 * Deliberately **no `closePath()`** — that would add the top edge; `fill()` closes the subpath implicitly.
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
 * 把繪製範圍裁到看得見的遊戲區：容器的可繪製範圍（`display`），且不放行畫布頂端以上。
 * Clip drawing to the visible play field: the container's `display`, and nothing above the canvas top.
 *
 * 裁切用 `display` 而非 `frame` —— `frame` 會隨容器晃動，拿它當裁切窗會切掉貼牆的方團團。
 * The clip is `display`, not `frame`: `frame` slides with the shake and would slice wall-hugging dumplings.
 *
 * 裁切**不碰** U 形線框，所以底部圓角與左右牆永遠完整。
 * The clip excludes the U outline, so the rounded corners and side walls always render whole.
 *
 * @param ctx 已套用虛擬座標變換的上下文 / A context already in virtual units.
 * @param geometry 容器幾何 / The container geometry.
 * @param clipY 裁切區的頂端（虛擬 Y）；0 即畫布頂端。預設 0
 *   / The clip region's top in virtual units; 0 means the canvas top. Defaults to 0.
 */
export function clipToPlayField(
  ctx: CanvasRenderingContext2D,
  geometry: ContainerGeometry,
  clipY = 0,
): void {
  const display = geometry.display;
  // `clipY` 以上的內容不放行；用矩形裁切而非把 Y 夾到 0，讓呼叫端能自己決定界線。
  // Nothing above `clipY`; a rect clip rather than clamping Y lets the caller choose the boundary.
  const top = Math.min(clipY, display.y);
  const height = display.y + display.height - top;

  if (display.width <= 0 || height <= 0) return;

  ctx.beginPath();
  ctx.rect(display.x, top, display.width, height);
  ctx.clip();
}

/**
 * 畫槽的內部填充（U 形範圍）；應在方團團**之前**呼叫。
 * Draw the trough's interior fill; call this before the dumplings.
 */
export function drawContainerBack(ctx: CanvasRenderingContext2D, geometry: ContainerGeometry): void {
  ctx.save();
  ctx.fillStyle = geometry.fill;
  uPath(ctx, geometry.frame, geometry.cornerRadius);
  ctx.fill();
  ctx.restore();
}

/**
 * 畫槽的 U 形線框；應在方團團**之後**呼叫。
 * Draw the trough's outline; call this after the dumplings.
 *
 * 線框往內縮半個線寬（模擬 `strokeAlign: INSIDE`），否則一半線寬會落在畫布外被裁掉；頂端開口，故不做垂直內縮。
 * The outline is inset by half its width (`strokeAlign: INSIDE`), or half the stroke falls outside the canvas.
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
