/**
 * 遊玩區的物理邊界。
 * The play area's physics boundaries.
 *
 * 依 `render/container.ts`：遊戲區 = 容器的 **`frame` 矩形**（平面 U 形的外框），
 * 物理邊界（左右牆＋地板）對齊它。這裡只做「幾何 → 矩形」與「矩形 → 靜態剛體」的換算，
 * 不含任何渲染，因為線框外觀屬於 `render/container.ts`。
 * Per `render/container.ts` the play area is the container's **`frame` rectangle** (the
 * flat U's outer box); the walls align to it. This module only maps geometry to rectangles
 * and rectangles to static bodies — the shell's look belongs to `render/container.ts`.
 *
 * 空腔（cavity）刻意比 frame **往內縮一個牆厚**（`WALL_THICKNESS`）：貼牆的方團團
 * 邊緣因此永遠落在框線內側，不會被線框壓過去或溢出畫布。
 * The cavity is deliberately inset from the frame by one wall thickness so a dumpling
 * resting against a wall always stays inside the drawn outline.
 */

import Matter from 'matter-js';
import { createStaticRect } from '../core/physics';
import { WALL_THICKNESS } from '../core/constants';
import type { Rect } from '../core/types';

/** 左右牆向上延伸的量，避免下落中的方團團從側面溜出。 */
export const DEFAULT_WALL_OVERHANG = 240;

export interface ContainerBounds {
  /** 空腔：方團團合法活動的矩形。 */
  cavity: Rect;
  /**
   * 三片靜態邊界，依序為左牆、右牆、地板。
   * 刻意回傳陣列而非具名欄位：呼叫端只需要「把它們全部加進世界」，
   * 而測試需要能逐一斷言位置。
   */
  walls: Rect[];
}

/**
 * 由前表面算出空腔。
 * Derive the cavity from the front face.
 *
 * 左右各縮一個牆厚、底部縮一個牆厚，**頂部不縮** —— 方團團要從上方投進來。
 * Insets left/right/bottom by one wall thickness; the top stays open for dropping.
 */
export function computePlayArea(front: Rect, thickness = WALL_THICKNESS): Rect {
  const inset = Math.max(0, thickness);
  return {
    x: front.x + inset,
    y: front.y,
    /* 面板極窄時仍要留至少 1 單位寬，否則 Matter 會拿到退化矩形。 */
    width: Math.max(1, front.width - inset * 2),
    height: Math.max(1, front.height - inset),
  };
}

/**
 * 由前表面算出左牆、右牆、地板三片矩形。
 * Derive the left wall, right wall and floor from the front face.
 *
 * 牆與地板都**往外長**（朝前表面的外側），所以空腔剛好等於 `computePlayArea()`
 * 的結果，兩者不會互相重疊。地板橫跨整個前表面寬度，讓底部兩個轉角沒有縫隙。
 * Every slab grows outward so the cavity matches `computePlayArea()` exactly and the
 * slabs never overlap it. The floor spans the full front width so the bottom corners
 * have no gap.
 */
export function computeWalls(
  front: Rect,
  thickness = WALL_THICKNESS,
  overhang = DEFAULT_WALL_OVERHANG,
): Rect[] {
  const t = Math.max(1, thickness);
  const rise = Math.max(0, overhang);

  const cavity = computePlayArea(front, t);
  const cavityBottom = cavity.y + cavity.height;
  const wallTop = front.y - rise;

  return [
    /* 左牆。 */
    { x: front.x, y: wallTop, width: t, height: cavityBottom - wallTop },
    /* 右牆。 */
    {
      x: cavity.x + cavity.width,
      y: wallTop,
      width: t,
      height: cavityBottom - wallTop,
    },
    /* 地板。 */
    { x: front.x, y: cavityBottom, width: front.width, height: t },
  ];
}

/**
 * 由前表面一次算出空腔與三片邊界。
 * Derive the cavity and all three slabs from the front face in one call.
 */
export function computeContainerBounds(
  front: Rect,
  thickness = WALL_THICKNESS,
  overhang = DEFAULT_WALL_OVERHANG,
): ContainerBounds {
  return {
    cavity: computePlayArea(front, thickness),
    walls: computeWalls(front, thickness, overhang),
  };
}

/**
 * 把矩形轉成靜態剛體。
 * Turn rectangles into static rigid bodies.
 *
 * 矩形在 Matter 是以**中心點**定址，而這裡的矩形是用左上角定址（與 canvas 一致），
 * 換算集中在這裡做一次。
 * Matter addresses rectangles by their centre while our rectangles use a top-left
 * origin to match the canvas; that conversion happens once, here.
 */
export function createContainerBodies(walls: readonly Rect[]): Matter.Body[] {
  return walls.map((wall) =>
    createStaticRect(
      wall.x + wall.width / 2,
      wall.y + wall.height / 2,
      wall.width,
      wall.height,
    ),
  );
}
