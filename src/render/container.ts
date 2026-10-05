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
 * 把繪製範圍裁到「看得見的遊戲區」：容器 frame 的橫向範圍，加上畫布頂端以上不放行。
 * Clip drawing to the **visible** play field: the container frame's horizontal span, and no
 * drawing above the top of the canvas.
 *
 * **為什麼需要顯式裁切。** Canvas 本身就會裁，但那是「靜默」的 —— 一張 sprite 若一半在
 * 畫布之外，你只會看到它被切掉，卻說不出是被誰切的。方團團的素材是
 * `SPRITE_ANCHOR = (256, 328)` 對齊的，藝術在圓心**上方**伸出 2.16 倍半徑、下方只有
 * 1.21 倍，所以疊高之後最頂那一顆、以及**投放預覽**（生成在溢位線之上），都可能有一截
 * 落在畫布之外。這裡把裁切寫成明碼，並用 `clipY` 明確表達「頂端是開口的」。
 * **Why an explicit clip.** The canvas clips anyway, but it does so **silently** — a sprite
 * half outside the canvas just looks cut, with nothing to say what cut it. Dumpling art is
 * aligned by `SPRITE_ANCHOR = (256, 328)`, so it reaches 2.16 radii **above** the centre and
 * only 1.21 below; once the pile is tall, both the topmost dumpling and the **drop preview**
 * (spawned above the overflow line) can have a slice outside the canvas. Writing the clip out
 * in the open, with an explicit `clipY`, also documents that the top is open on purpose.
 *
 * 裁切**不碰** U 形線框：線框在裁切之外繪製，所以底部圓角與左右牆永遠是完整的。
 * The clip deliberately **excludes** the U outline: it is drawn outside the clip so the
 * rounded corners and side walls always render whole.
 *
 * @param ctx 已套用虛擬座標變換的上下文 / A context already in virtual units.
 * @param geometry 容器幾何 / The container geometry.
 * @param clipY 裁切區的頂端（虛擬 Y）；傳 0 即「畫布頂端」。預設 0。
 *   / The clip region's top in virtual units; 0 means the canvas top. Defaults to 0.
 */
export function clipToPlayField(
  ctx: CanvasRenderingContext2D,
  geometry: ContainerGeometry,
  clipY = 0,
): void {
  const frame = geometry.frame;
  /* `clipY` 以上的內容不放行；用矩形裁切而非把 Y 夾到 0，讓呼叫端能自己決定界線。 */
  const top = Math.min(clipY, frame.y);
  const height = frame.y + frame.height - top;

  if (frame.width <= 0 || height <= 0) return;

  ctx.beginPath();
  ctx.rect(frame.x, top, frame.width, height);
  ctx.clip();
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
