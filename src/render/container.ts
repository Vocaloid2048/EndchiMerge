/**
 * 中央容器的 3D 線框外框。
 * The centre container's 3D wireframe shell.
 *
 * 依 design.md §4（D15）：外框是**純裝飾的線框**，盒內方團團是平面 2D sprite，
 * **不做透視變形**。物理邊界對齊的是**前表面矩形**，不含透視偏移的部分。
 * Per design.md §4 (D15) the shell is a purely decorative wireframe and the
 * dumplings inside stay flat 2D sprites with no perspective distortion. The
 * physics boundary follows the **front face** only.
 *
 * 繪製順序是「裝在玻璃箱內」這個效果的全部來源（design.md §4.1）：
 * 後緣 → sprite → 前表面 4 條邊。少了最後一步，方團團看起來是貼在外面而不是裝在裡面。
 * The draw order is what sells "inside a glass box": back edges → sprites → the
 * front face's four edges. Without that last step the dumplings look pasted on.
 */

import type { ContainerConfig, Rect } from '../core/types';

/** 帶圓角的矩形面。 */
export interface BoxFace extends Rect {
  cornerRadius: number;
}

export interface ContainerGeometry {
  /** 前表面；**遊戲區與物理邊界就是這個矩形**。 */
  front: BoxFace;
  /** 後表面；由 `perspectiveDx` / `perspectiveDy` 偏移而來。 */
  back: BoxFace;
  strokeWidth: number;
  strokeColor: string;
  frontTint: string;
  backTint: string;
}

/**
 * 依容器尺寸與配置算出前後兩個面。
 * Derive both faces from the container size and config.
 *
 * 前表面會被往內縮，縮的量剛好等於透視偏移，這樣兩個面都落在畫布內。
 * The front face is inset by exactly the perspective offset so both faces stay
 * inside the canvas.
 *
 * @param width 容器寬（虛擬單位）/ Container width in virtual units.
 * @param height 容器高（虛擬單位）/ Container height in virtual units.
 */
export function computeContainerGeometry(
  width: number,
  height: number,
  config: ContainerConfig,
): ContainerGeometry {
  const dx = config.perspectiveDx;
  const dy = config.perspectiveDy;
  const insetX = Math.abs(dx);
  const insetY = Math.abs(dy);

  const faceWidth = Math.max(1, width - insetX);
  const faceHeight = Math.max(1, height - insetY);

  const front: BoxFace = {
    /* 後緣往右 → 前表面貼左；往左則相反。 */
    x: dx < 0 ? insetX : 0,
    /* 後緣往上（dy < 0）→ 前表面下移，反之貼頂。 */
    y: dy > 0 ? 0 : insetY,
    width: faceWidth,
    height: faceHeight,
    cornerRadius: config.cornerRadius,
  };

  const back: BoxFace = {
    x: front.x + dx,
    y: front.y + dy,
    width: faceWidth,
    height: faceHeight,
    cornerRadius: config.cornerRadius,
  };

  return {
    front,
    back,
    strokeWidth: config.strokeWidth,
    strokeColor: config.strokeColor,
    frontTint: config.frontTint,
    backTint: config.backTint,
  };
}

/** 四個象限座標。 */
function corners(face: BoxFace): { x: number; y: number }[] {
  return [
    { x: face.x, y: face.y },
    { x: face.x + face.width, y: face.y },
    { x: face.x + face.width, y: face.y + face.height },
    { x: face.x, y: face.y + face.height },
  ];
}

/** 圓角矩形路徑。 */
function roundedRectPath(ctx: CanvasRenderingContext2D, face: BoxFace): void {
  const r = Math.max(0, Math.min(face.cornerRadius, face.width / 2, face.height / 2));
  const { x, y, width, height } = face;

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function quadPath(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(d.x, d.y);
  ctx.closePath();
}

/**
 * 畫「後方」的部分：後表面、頂面與右側面。應在方團團**之前**呼叫。
 * Draw everything behind the dumplings. Call this before them.
 */
export function drawContainerBack(ctx: CanvasRenderingContext2D, geometry: ContainerGeometry): void {
  const { front, back } = geometry;
  const [frontTopLeft, frontTopRight, frontBottomRight] = corners(front) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const [backTopLeft, backTopRight, backBottomRight] = corners(back) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];

  ctx.save();
  ctx.lineWidth = geometry.strokeWidth;
  ctx.strokeStyle = geometry.strokeColor;
  ctx.lineJoin = 'round';
  ctx.fillStyle = geometry.backTint;

  /* 後表面。 */
  roundedRectPath(ctx, back);
  ctx.fill();
  ctx.stroke();

  /* 頂面與右側面：兩片薄薄的斜面板，讓線框看起來有體積。 */
  quadPath(ctx, frontTopLeft, frontTopRight, backTopRight, backTopLeft);
  ctx.fill();
  ctx.stroke();

  quadPath(ctx, frontTopRight, backTopRight, backBottomRight, frontBottomRight);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/**
 * 畫「前方」的部分：前表面的 4 條邊。應在方團團**之後**呼叫。
 * Draw the front face's four edges. Call this after the dumplings.
 */
export function drawContainerFront(ctx: CanvasRenderingContext2D, geometry: ContainerGeometry): void {
  ctx.save();
  ctx.lineWidth = geometry.strokeWidth;
  ctx.strokeStyle = geometry.strokeColor;
  ctx.lineJoin = 'round';
  ctx.fillStyle = geometry.frontTint;

  roundedRectPath(ctx, geometry.front);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}
