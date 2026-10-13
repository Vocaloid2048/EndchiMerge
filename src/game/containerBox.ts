/**
 * 遊玩區的物理邊界：由前表面算出空腔與左牆、右牆、地板三片矩形，並轉成靜態剛體。
 * The play area's physics boundaries: the cavity and the left/right/floor slabs, plus their bodies.
 */

import Matter from 'matter-js';
import { createStaticRect } from '../core/physics';
import { WALL_THICKNESS } from '../core/constants';
import type { Rect } from '../core/types';

/**
 * 左右牆高於容器頂緣的**下限**，不是實際使用的值；實際高度由 `computeWallOverhang()` 決定。
 * A **floor**, not the value used; `computeWallOverhang()` derives the real height.
 */
export const DEFAULT_WALL_OVERHANG = 240;

/**
 * 由容器頂緣、投放點與溢位線算出左右牆該往上長多高（蓋過兩者，並與下限取大）。
 * How far the side walls must rise above the rim to clear both the drop point and the overflow line.
 */
export function computeWallOverhang(
  frameTop: number,
  spawnY?: number,
  overflowLineY?: number,
): number {
  const candidates = [frameTop - DEFAULT_WALL_OVERHANG];

  /* 投放點與溢位線都轉成「頂緣以上多遠」，再往上多留一段餘裕。
   * Both are measured as "how far above the rim", plus one overhang of slack. */
  if (spawnY !== undefined && Number.isFinite(spawnY)) {
    candidates.push(spawnY - DEFAULT_WALL_OVERHANG);
  }
  if (overflowLineY !== undefined && Number.isFinite(overflowLineY)) {
    candidates.push(overflowLineY - DEFAULT_WALL_OVERHANG);
  }

  const top = Math.min(...candidates);

  return Math.max(DEFAULT_WALL_OVERHANG, frameTop - top);
}

export interface ContainerBounds {
  /**
   * 空腔：方團團合法活動的矩形。
   * The cavity: the rectangle dumplings may legally occupy.
   */
  cavity: Rect;
  /**
   * 三片靜態邊界，依序為左牆、右牆、地板。
   * The three static slabs, in order: left wall, right wall, floor.
   */
  walls: Rect[];
}

/**
 * 由前表面算出空腔：左右與底部各縮一個牆厚，頂部不縮（方團團要從上方投進來）。
 * Derive the cavity: inset left/right/bottom by one wall thickness, leaving the top open for drops.
 */
export function computePlayArea(front: Rect, thickness = WALL_THICKNESS): Rect {
  const inset = Math.max(0, thickness);
  return {
    x: front.x + inset,
    y: front.y,
    /* 面板極窄時仍要留至少 1 單位寬，否則 Matter 會拿到退化矩形。
     * Keep at least 1 unit of width so Matter never receives a degenerate rectangle. */
    width: Math.max(1, front.width - inset * 2),
    height: Math.max(1, front.height - inset),
  };
}

/**
 * 由前表面算出左牆、右牆、地板三片矩形（依序）；各片往外長，空腔因此與 `computePlayArea()` 一致。
 * Derive the left wall, right wall and floor, in that order; each grows outward from the front face.
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
    { x: front.x, y: wallTop, width: t, height: cavityBottom - wallTop },
    {
      x: cavity.x + cavity.width,
      y: wallTop,
      width: t,
      height: cavityBottom - wallTop,
    },
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
 * 把矩形轉成靜態剛體（Matter 以中心點定址，這裡的矩形以左上角定址）。
 * Turn rectangles into static bodies (Matter addresses by centre; these rectangles are top-left).
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
