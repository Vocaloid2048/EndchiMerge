/**
 * 輪廓追蹤（光柵化輪廓法）的單元測試；純幾何，不碰瀏覽器。
 * Unit tests for outline tracing (rasterised contour tracing); pure geometry, no browser.
 */

import { describe, expect, it } from 'vitest';
import {
  contourToPolygon,
  isDegenerate,
  simplify,
  toVirtualPolygon,
  traceContour,
  type Bitmap,
  type Point,
} from '../src/render/silhouette';

/** 由字串點陣建立遮罩；`#` 為實心、其他為空。 */
function mask(rows: readonly string[]): Bitmap {
  const height = rows.length;
  const width = Math.max(...rows.map((row) => row.length));
  const data = new Uint8ClampedArray(width * height);

  rows.forEach((row, y) => {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = row[x] === '#' ? 255 : 0;
    }
  });

  return { width, height, data };
}

/** 產生邊長 `size` 的正方形遮罩，左上角在 (ox, oy)。 */
function squareMask(size: number, ox = 0, oy = 0, canvas = size + ox * 2): Bitmap {
  const rows: string[] = [];
  for (let y = 0; y < canvas; y += 1) {
    let row = '';
    for (let x = 0; x < canvas; x += 1) {
      const inside = x >= ox && x < ox + size && y >= oy && y < oy + size;
      row += inside ? '#' : '.';
    }
    rows.push(row);
  }
  return mask(rows);
}

/** 多邊形的軸對齊外框。 */
function bounds(points: readonly Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('traceContour', () => {
  it('returns nothing for an empty mask', () => {
    expect(traceContour(mask(['....', '....']))).toEqual([]);
  });

  it('traces a filled square and recovers its corners', () => {
    const contour = traceContour(squareMask(8, 4, 4, 20), { step: 1, threshold: 8 });

    const box = bounds(contour);
    expect(box.minX).toBe(4);
    expect(box.maxX).toBe(11);
    expect(box.minY).toBe(4);
    expect(box.maxY).toBe(11);
  });

  it('only traces the outer boundary of a solid block', () => {
    /*
     * 8×8 實心塊的輪廓長度遠小於面積 64，追蹤必須沿邊走。
     * The outline of an 8×8 block is far shorter than its area (64): tracing must follow the edge.
     */
    const contour = traceContour(squareMask(8, 4, 4, 20), { step: 1, threshold: 8 });

    expect(contour.length).toBeLessThan(64);
    expect(contour.length).toBeGreaterThan(8);
  });

  it('respects the sampling stride', () => {
    const bitmap = squareMask(24, 4, 4, 34);
    const fine = traceContour(bitmap, { step: 1, threshold: 8 });
    const coarse = traceContour(bitmap, { step: 4, threshold: 8 });

    expect(coarse.length).toBeLessThan(fine.length);
  });

  it('ignores pixels below the alpha threshold', () => {
    const data = new Uint8ClampedArray(4);
    data[0] = 4;
    data[1] = 200;
    const bitmap: Bitmap = { width: 2, height: 2, data };

    const contour = traceContour(bitmap, { step: 1, threshold: 8 });
    expect(contour.length).toBeGreaterThan(0);
    expect(contour.some((p) => p.x === 1 && p.y === 0)).toBe(true);
  });
});

describe('simplify', () => {
  it('keeps the endpoints and drops collinear middles', () => {
    const line: Point[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ];

    const result = simplify(line, 0.5);
    expect(result).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it('keeps a sharp corner', () => {
    /*
     * L 的直角必須被保留，否則碰撞框會變成斜邊。
     * An L's right angle must survive, or the collider becomes a slanted edge.
     */
    const corner: Point[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ];

    expect(simplify(corner, 0.5)).toHaveLength(3);
  });

  it('collapses a noisy circle but keeps its roundness', () => {
    const circle: Point[] = Array.from({ length: 360 }, (_, i) => ({
      x: 50 + 50 * Math.cos((i * Math.PI) / 180),
      y: 50 + 50 * Math.sin((i * Math.PI) / 180),
    }));

    const simplified = simplify(circle, 3);
    expect(simplified.length).toBeLessThan(60);
    expect(simplified.length).toBeGreaterThan(8);
  });

  it('returns short inputs untouched', () => {
    const two: Point[] = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    expect(simplify(two, 1)).toEqual(two);
  });
});

describe('toVirtualPolygon', () => {
  it('subtracts the anchor and applies the scale', () => {
    const pixel: Point[] = [
      { x: 256, y: 328 },
      { x: 266, y: 328 },
      { x: 266, y: 338 },
    ];

    const virtual = toVirtualPolygon(pixel, 0.5, 256, 328);

    expect(virtual[0]).toEqual({ x: 0, y: 0 });
    expect(virtual[1]).toEqual({ x: 5, y: 0 });
    expect(virtual[2]).toEqual({ x: 5, y: 5 });
  });
});

describe('isDegenerate', () => {
  it('flags too-few points', () => {
    expect(isDegenerate([])).toBe(true);
    expect(isDegenerate([{ x: 0, y: 0 }])).toBe(true);
    expect(isDegenerate([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });

  it('flags collinear points', () => {
    expect(
      isDegenerate([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(true);
  });

  it('accepts a real polygon', () => {
    expect(
      isDegenerate([
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ]),
    ).toBe(false);
  });
});

describe('contourToPolygon', () => {
  it('produces a centred square for a square mask', () => {
    /*
     * 8×8 實心、anchor (12,12)、每像素 1 單位：追蹤取像素 4..11，置中後為 −8..−1。
     * An 8×8 solid mask anchored at (12,12), one unit per pixel: tracing takes pixels 4..11,
     * which centre to −8..−1.
     */
    const bitmap = squareMask(8, 4, 4, 20);
    const polygon = contourToPolygon(bitmap, 1, 12, 12, { step: 1, threshold: 8, epsilon: 0.5 });

    expect(polygon).not.toBeNull();
    const box = bounds(polygon!);
    expect(box.minX).toBeCloseTo(-8, 0);
    expect(box.maxY).toBeCloseTo(-1, 0);
  });

  it('returns null for an empty mask', () => {
    expect(contourToPolygon(mask(['...', '...']), 1, 0, 0)).toBeNull();
  });

  it('returns null when the result degenerates', () => {
    expect(contourToPolygon(mask(['#']), 1, 0, 0, { step: 1, threshold: 8, epsilon: 0.1 })).toBeNull();
  });
});
