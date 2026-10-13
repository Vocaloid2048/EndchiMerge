/**
 * 合成後的落點物理：動量繼承與向下投影找支撐（純函式，可在 node 單元測試）。
 * Post-merge placement physics: momentum inheritance and downward support projection (pure functions).
 */

import type { Body } from 'matter-js';

/**
 * 以質量加權平均兩顆剛體的速度，作為合成後的新速度（動量守恆）。
 * Mass-weighted average of two velocities, used as the merged body's velocity (momentum conservation).
 *
 * 質量取 `密度 × π r²`，與 `LevelDef` 的宣告一致；兩者質量皆為 0 時回傳零向量。
 * Mass is `density × π r²`, matching the `LevelDef` declaration; returns a zero vector when both masses are zero.
 */
export function inheritMomentum(
  va: { x: number; y: number },
  ma: number,
  vb: { x: number; y: number },
  mb: number,
): { x: number; y: number } {
  const total = ma + mb;

  if (total <= 0) return { x: 0, y: 0 };

  return {
    x: (va.x * ma + vb.x * mb) / total,
    y: (va.y * ma + vb.y * mb) / total,
  };
}

/**
 * 由 `LevelDef` 的宣告計算質量（密度 × 圓面積）；測試與實作共用這一支。
 * Mass from a `LevelDef` declaration (density × circle area); tests and implementation share this one.
 */
export function circleMass(density: number, radius: number): number {
  return density * Math.PI * radius * radius;
}

/**
 * 一個矩形（用來描述地板、牆或另一顆方團團的包圍盒）。
 * A rectangle (a floor, a wall, or another dumpling's bounding box).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 向下投影：算出落在 `(cx, cy)` 的圓沿垂直線往下第一個碰到的支撐面有多遠。
 * Downward projection: how far a circle at `(cx, cy)` must fall before it first rests on something.
 *
 * 只比對水平投影重疊的候選支撐，取「圓底到支撐上緣」的最小正值；都沒有時回 `Infinity`。
 * Only supports overlapping the circle's horizontal span count; the smallest positive
 * "bottom-to-top" drop wins, and `Infinity` means nothing is below (free fall).
 *
 * 用包圍盒而非真實輪廓：投影只會偏保守（提早落地），不會讓顆粒穿過鄰居。
 * Bounding boxes rather than true outlines: the projection is only conservative and never lets a body pass through a neighbour.
 */
export function distanceToSupport(
  cx: number,
  cy: number,
  radius: number,
  supports: readonly Rect[],
  maxDistance = Infinity,
): number {
  const left = cx - radius;
  const right = cx + radius;
  const bottom = cy + radius;

  let best = Infinity;

  for (const rect of supports) {
    /* 水平投影沒重疊 → 這塊不會墊在圓的下面。 */
    if (rect.x + rect.width < left || rect.x > right) continue;

    const drop = rect.y - bottom;

    /* 已經在支撐裡面或下方時 drop ≤ 0：視為 0（貼住），不是負距離。 */
    const clamped = drop > 0 ? drop : 0;

    if (clamped < best) best = clamped;
  }

  return best <= maxDistance ? best : Infinity;
}

/**
 * 把一組剛體轉成包圍盒矩形（供 `distanceToSupport` 使用），讀 Matter 維護好的 `body.bounds`。
 * Turns bodies into bounding-box rectangles (for `distanceToSupport`), reading Matter's maintained `body.bounds`.
 */
export function boundsOf(bodies: readonly Body[], excludeId: number): Rect[] {
  const rects: Rect[] = [];

  for (const body of bodies) {
    if (body.id === excludeId) continue;
    rects.push({
      x: body.bounds.min.x,
      y: body.bounds.min.y,
      width: body.bounds.max.x - body.bounds.min.x,
      height: body.bounds.max.y - body.bounds.min.y,
    });
  }

  return rects;
}
