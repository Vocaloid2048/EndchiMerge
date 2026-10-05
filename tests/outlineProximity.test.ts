/**
 * 輪廓接近程度（合成判定用）的單元測試。
 * Unit tests for outline proximity (the merge predicate).
 *
 * 這些測試**不碰瀏覽器、不碰 Matter**：模組是純幾何，輸入是頂點座標，輸出是布林或距離。
 * 所以可以在 node 環境完整驗證 —— 包含「重疊偵測」、「間隙量測」、「世界座標轉換」、
 * 以及「重疊深度與推力方向」。
 * These tests touch **neither a browser nor Matter**: the module is pure geometry, vertices go
 * in and a boolean or a distance comes out. The whole thing is therefore verifiable in node —
 * overlap detection, gap measurement, the world-space transform, and penetration depth with its
 * push direction.
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
    /* 兩個邊長 20 的正方形，中心相距 10 → 邊互相切過。 */
    expect(outlinesOverlap(square(10), square(10, 10, 0))).toBe(true);
  });

  it('detects containment with no edge crossing at all', () => {
    /*
     * 同心大小方塊：**一條邊都不相交**，只有「頂點在對方內部」偵測得到。這是條件 2、3
     * 缺一不可的原因。
     * Concentric squares: **not a single edge crosses**, so only the containment test catches
     * it — which is why conditions 2 and 3 are both required.
     */
    expect(outlinesOverlap(square(30), square(5))).toBe(true);
  });

  it('reports no overlap for clearly separated squares', () => {
    expect(outlinesOverlap(square(10), square(10, 100, 0))).toBe(false);
  });

  it('reports touching squares as overlapping', () => {
    /* 邊恰好相接（中心距 20 = 兩個 half 相加）。 */
    expect(outlinesOverlap(square(10), square(10, 20, 0))).toBe(true);
  });

  it('treats degenerate polygons as non-overlapping', () => {
    expect(outlinesOverlap([], square(10))).toBe(false);
    expect(outlinesOverlap(square(10), [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
  });
});

describe('outlineProximity — 邊緣間隙 / edge distance', () => {
  it('measures the gap between two separated squares', () => {
    /* 中心距 40、兩個 half 各 10 → 邊緣間隙 20。 */
    const d = polygonEdgeDistanceSq(square(10), square(10, 40, 0));
    expect(Math.sqrt(d)).toBeCloseTo(20, 6);
  });

  it('returns the nearest vertex-to-edge distance when contained', () => {
    /*
     * 小方塊在大方塊內：最近距離是「小方塊頂點到大方塊邊」的距離，不是 0 ——
     * 這正是「不能只靠距離門檻判斷重疊」的原因。
     * A small square inside a big one: the nearest distance is "small square's vertex to the
     * big square's edge", **not** 0 — exactly why a distance threshold alone cannot detect
     * overlap.
     */
    const d = polygonEdgeDistanceSq(square(30), square(5));
    expect(Math.sqrt(d)).toBeCloseTo(25, 6);
    expect(Math.sqrt(d)).toBeGreaterThan(0);
  });

  it('returns zero for overlapping shapes', () => {
    /*
     * 重疊時距離是 0 —— 因為「最近的頂點」會落在對方的邊**上面**（或穿越），點到線段的
     * 距離自然是 0。這比文件原先假設的「仍為正值」更好，但重疊偵測仍不該只靠距離：
     * 距離 0 與「恰好相接」不可區分，而完全包含（小方塊在大方塊內、邊不相交）時距離
     * 是 25 而非 0。所以 `outlinesWithinReach` 仍然先跑 `outlinesOverlap()`。
     * Overlapping shapes give 0, because the nearest vertex lands **on** the other shape's
     * edge, and the point-to-segment distance is then zero. That is better than the docs first
     * assumed, but overlap detection still cannot rest on distance alone: 0 is
     * indistinguishable from "exactly touching", and full containment (a small square inside
     * a big one, no edge crossing) gives 25, not 0. `outlinesWithinReach` therefore still
     * runs `outlinesOverlap()` first.
     */
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
    /* 邊緣間隙 20；容差 25 → 過關。 */
    expect(outlinesWithinReach(square(10), square(10, 40, 0), 25)).toBe(true);
  });

  it('rejects a gap above the tolerance', () => {
    /* 邊緣間隙 20；容差 10 → 不合成。 */
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
     * 使用者截圖的核心情境：小顆粒夾在兩顆大顆粒之間。
     *
     * 幾何：兩顆大顆粒 half 30，中心在 x = ±29 → 它們之間的空隙是 2×29 − 2×30 = −2，
     * 也就是**它們自己會微微重疊**（實務上不會疊，這裡只是為了把空隙壓到最小）。
     * 這樣「夾在中間」的情境才對：小顆粒 half 3 只要有任何一部分落在空隙裡，它的輪廓就
     * 同時貼著兩邊。
     *
     * 關鍵對照：小顆粒中心 (0, 0)，左大顆粒中心 (−29, 0)，圓心距離 = 29。
     * 而圓心距離法的門檻是 (3 + 30) × 1.12 = 36.96 → **29 < 36.96，圓心法也會過關**。
     * 所以這一組測不出差異。真正測得出差異的是**圓心距離大但邊緣很近**的排列：
     * 把小顆粒**往下**放，讓它靠在大顆粒的**下緣**而非側面。
     *
     * The user's screenshot in miniature: a small dumpling nestled between two large ones.
     *
     * Geometry: two large squares of half 30 centred at x = ±29, so the space between them is
     * 2×29 − 2×30 = −2 (they mildly overlap; only to squeeze the gap to nothing). A small
     * square of half 3 anywhere in that gap touches both.
     *
     * The telling comparison is a small shape hugging a large one's **lower edge** rather than
     * its side: there the centre distance is large while the edges are close.
     */
    const large = square(30, -29, 0);

    /*
     * 小顆粒 half 3，中心在 (−29, 33)：正好在大顆粒**下緣**（y = 30）下方 0 單位 ——
     * 邊緣相接。
     * Small square of half 3 centred at (−29, 33): flush against the large one's lower edge
     * (y = 30), edges touching.
     */
    const nestled = square(3, -29, 33);
    expect(outlinesWithinReach(nestled, large, 4)).toBe(true);

    /*
     * 圓心距離法在這裡會**誤判**：圓心相距 33，門檻 36.96 —— 咦，還是過了。
     * 所以把距離拉開一點：小顆粒中心 (−29, 40)，下緣接觸但圓心相距 40 > 36.96。
     * 邊緣間隙仍是 7（超出容差 4），但用更大的容差 8 就能看出差別。
     * The centre rule misjudges here only past a threshold: at centre offset 40 the centre
     * distance (40) exceeds 36.96 while the edges are 7 apart — inside a tolerance of 8.
     */
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
    /* 旋轉 90°：(x, y) → (-y, x)。 */
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
     * 旋轉不改變尺寸：half 10 的方塊對角線長 20√2，轉 45° 後對角線剛好躺在 x 軸上，
     * 所以水平跨距就是 20√2。
     * Rotation preserves size: a square of half 10 has a diagonal of 20√2, and turning it 45°
     * lays that diagonal on the x axis, so the horizontal extent is 20√2.
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
    /* 邊恰好相接（中心距 20 = 兩個 half）不算重疊。 */
    const { depth } = outlinePenetration(square(10), square(10, 20, 0));
    expect(depth).toBe(0);
  });

  it('measures the overlap of two partially overlapping squares', () => {
    /*
     * 邊長 20 的正方塊、中心距 10：沿 x 軸的投影區間是 [−10,10] 與 [0,20]，
     * 重疊 10。
     * Two 20-wide squares 10 apart: projections are [−10,10] and [0,20], overlapping by 10.
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
     * 使用者截圖的極端版：小顆粒完全埋在大顆粒裡。沿連心線的區間重疊 = 小顆粒的整個直徑
     * （小方塊 half 3 → 6）。這正是「用最近邊界距離會回傳 0 而推不開」的情況，也是
     * `MERGE_PUSH_MAX_DEPTH` 存在的理由。
     * The extreme version of the user's screenshot: a small dumpling wholly buried in a large
     * one. The interval overlap along the centre line is the small shape's whole extent
     * (half 3 → 6). This is exactly the case where "closest edge distance" would report 0 and
     * push nothing — and the reason `MERGE_PUSH_MAX_DEPTH` exists.
     */
    const { depth } = outlinePenetration(square(30), square(3));
    expect(depth).toBeCloseTo(6, 6);
  });

  it('falls back to a downward direction when centres coincide', () => {
    /* 質心完全重合時沒有方向可言，用 (0,1) 當預設，深度照算。 */
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
    /* 方向則相反。 */
    expect(ab.nx).toBeCloseTo(-ba.nx, 6);
    expect(ab.ny).toBeCloseTo(-ba.ny, 6);
  });
});
