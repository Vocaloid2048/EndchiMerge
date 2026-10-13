/**
 * 輪廓接近程度（合成判定）的單元測試；純幾何，不碰瀏覽器與 Matter。
 * Unit tests for outline proximity (the merge predicate); pure geometry, no browser or Matter.
 */

import { describe, expect, it } from 'vitest';
import {
  outlinePenetration,
  outlinesOverlap,
  outlinesWithinReach,
  polygonEdgeDistanceSq,
  toWorldPolygon,
} from '../src/game/outlineProximity';
import type { Point } from '../src/render/silhouette';

/** 軸對齊正方形（以中心為原點）。 */
function square(half: number, cx = 0, cy = 0): Point[] {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

describe('outlineProximity — 重疊偵測 / overlap detection', () => {
  it('detects two squares that overlap by edge crossing', () => {
    expect(outlinesOverlap(square(10), square(10, 10, 0))).toBe(true);
  });

  it('detects containment with no edge crossing at all', () => {
    expect(outlinesOverlap(square(30), square(5))).toBe(true);
  });

  it('reports no overlap for clearly separated squares', () => {
    expect(outlinesOverlap(square(10), square(10, 100, 0))).toBe(false);
  });

  it('reports touching squares as overlapping', () => {
    expect(outlinesOverlap(square(10), square(10, 20, 0))).toBe(true);
  });

  it('treats degenerate polygons as non-overlapping', () => {
    expect(outlinesOverlap([], square(10))).toBe(false);
    expect(outlinesOverlap(square(10), [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('outlineProximity — 邊緣間隙 / edge distance', () => {
  it('measures the gap between two separated squares', () => {
    const d = polygonEdgeDistanceSq(square(10), square(10, 40, 0));
    expect(Math.sqrt(d)).toBeCloseTo(20, 6);
  });

  it('returns the nearest vertex-to-edge distance when contained', () => {
    /*
     * 小方塊在大方塊內：最近距離是「小方塊頂點到大方塊邊」= 25，不是 0。
     * A small square inside a big one: the nearest distance is vertex-to-edge = 25, not 0.
     */
    const d = polygonEdgeDistanceSq(square(30), square(5));
    expect(Math.sqrt(d)).toBeCloseTo(25, 6);
    expect(Math.sqrt(d)).toBeGreaterThan(0);
  });

  it('returns zero for overlapping shapes', () => {
    const d = polygonEdgeDistanceSq(square(10), square(10, 5, 0));
    expect(d).toBe(0);
  });

  it('returns Infinity for degenerate input', () => {
    expect(polygonEdgeDistanceSq([], square(10))).toBe(Number.POSITIVE_INFINITY);
    expect(polygonEdgeDistanceSq(square(10), [{ x: 0, y: 0 }])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('outlineProximity — 合成判定 / the merge predicate', () => {
  it('accepts overlapping outlines regardless of tolerance', () => {
    expect(outlinesWithinReach(square(10), square(10, 5, 0), 0)).toBe(true);
  });

  it('accepts a gap below the tolerance', () => {
    expect(outlinesWithinReach(square(10), square(10, 40, 0), 25)).toBe(true);
  });

  it('rejects a gap above the tolerance', () => {
    expect(outlinesWithinReach(square(10), square(10, 40, 0), 10)).toBe(false);
  });

  it('accepts a gap exactly at the tolerance', () => {
    expect(outlinesWithinReach(square(10), square(10, 40, 0), 20)).toBe(true);
  });

  it('rejects when either polygon is degenerate', () => {
    expect(outlinesWithinReach([], square(10), 100)).toBe(false);
    expect(outlinesWithinReach(square(10), [], 100)).toBe(false);
  });

  it('handles a small shape nestled between two large ones', () => {
    /*
     * 兩顆大顆粒刻意微微重疊以把空隙壓到最小；小顆粒靠下緣，使圓心距離大但邊緣很近。
     * Two large shapes mildly overlap to squeeze the gap to nothing; the small one hugs a lower
     * edge — a large centre distance but close edges.
     */
    const large = square(30, -29, 0);

    const nestled = square(3, -29, 33);
    expect(outlinesWithinReach(nestled, large, 4)).toBe(true);

    const far = square(3, -29, 40);
    const centreDistance = Math.hypot(0, 40);
    const radiiSum = (3 + 30) * 1.12;

    expect(centreDistance).toBeGreaterThan(radiiSum);
    expect(outlinesWithinReach(far, large, 8)).toBe(true);
    expect(outlinesWithinReach(far, large, 4)).toBe(false);
  });
});

describe('outlineProximity — 世界座標轉換 / world-space transform', () => {
  it('translates vertices when the angle is 0', () => {
    const world = toWorldPolygon(square(10), 100, 200, 0);
    expect(world).toEqual([
      { x: 90, y: 190 },
      { x: 110, y: 190 },
      { x: 110, y: 210 },
      { x: 90, y: 210 },
    ]);
  });

  it('rotates a quarter turn', () => {
    const world = toWorldPolygon([{ x: 10, y: 0 }], 0, 0, Math.PI / 2);
    expect(world[0]!.x).toBeCloseTo(0, 6);
    expect(world[0]!.y).toBeCloseTo(10, 6);
  });

  it('combines rotation and translation', () => {
    const world = toWorldPolygon([{ x: 10, y: 0 }], 100, 100, Math.PI / 2);
    expect(world[0]!.x).toBeCloseTo(100, 6);
    expect(world[0]!.y).toBeCloseTo(110, 6);
  });

  it('preserves the shape under rotation', () => {
    /*
     * 旋轉不改尺寸：half 10 的方塊對角線 20√2，轉 45° 後躺在 x 軸上。
     * Rotation preserves size: a half-10 square's diagonal is 20√2, laid on the x axis at 45°.
     */
    const world = toWorldPolygon(square(10), 0, 0, Math.PI / 4);
    const width = Math.max(...world.map((p) => p.x)) - Math.min(...world.map((p) => p.x));
    expect(width).toBeCloseTo(20 * Math.SQRT2, 6);
  });
});

describe('outlineProximity — 重疊深度與推力方向 / penetration depth and push direction', () => {
  it('reports zero depth for shapes that are apart', () => {
    const { depth } = outlinePenetration(square(10), square(10, 100, 0));
    expect(depth).toBe(0);
  });

  it('reports zero depth for shapes that only touch', () => {
    const { depth } = outlinePenetration(square(10), square(10, 20, 0));
    expect(depth).toBe(0);
  });

  it('measures the overlap of two partially overlapping squares', () => {
    /*
     * 邊長 20、中心距 10：沿 x 的投影 [−10,10] 與 [0,20]，重疊 10。
     * Two 20-wide squares 10 apart: x projections [−10,10] and [0,20], overlapping by 10.
     */
    const { depth } = outlinePenetration(square(10), square(10, 10, 0));
    expect(depth).toBeCloseTo(10, 6);
  });

  it('points the push direction from the first shape towards the second', () => {
    const { nx, ny } = outlinePenetration(square(10), square(10, 10, 0));
    expect(nx).toBeCloseTo(1, 6);
    expect(ny).toBeCloseTo(0, 6);
  });

  it('points along a diagonal when the shapes are offset diagonally', () => {
    const { nx, ny } = outlinePenetration(square(10), square(10, 10, 10));
    const inv = 1 / Math.SQRT2;
    expect(nx).toBeCloseTo(inv, 6);
    expect(ny).toBeCloseTo(inv, 6);
  });

  it('reports the full overlap when one shape sits wholly inside another', () => {
    /*
     * 小顆粒完全埋在大顆粒裡：沿連心線的重疊 = 小顆粒整個直徑（half 3 → 6）。
     * A small shape wholly inside a large one: overlap along the centre line is its whole
     * diameter (half 3 → 6).
     */
    const { depth } = outlinePenetration(square(30), square(3));
    expect(depth).toBeCloseTo(6, 6);
  });

  it('falls back to a downward direction when centres coincide', () => {
    const { nx, ny, depth } = outlinePenetration(square(10), square(5));
    expect(nx).toBe(0);
    expect(ny).toBe(1);
    expect(depth).toBeCloseTo(10, 6);
  });

  it('returns zero depth for degenerate input', () => {
    expect(outlinePenetration([], square(10)).depth).toBe(0);
    expect(outlinePenetration(square(10), [{ x: 0, y: 0 }]).depth).toBe(0);
  });

  it('is symmetric in depth when the arguments swap', () => {
    const ab = outlinePenetration(square(10), square(10, 10, 0));
    const ba = outlinePenetration(square(10, 10, 0), square(10));
    expect(ab.depth).toBeCloseTo(ba.depth, 6);
    expect(ab.nx).toBeCloseTo(-ba.nx, 6);
    expect(ab.ny).toBeCloseTo(-ba.ny, 6);
  });
});
