/**
 * `mergeSettle` 純函式的單元測試：動量繼承、質量、向下投影找支撐。
 * Unit tests for the `mergeSettle` pure functions: momentum inheritance, mass, and support projection.
 */

import { describe, expect, it } from 'vitest';
import Matter from 'matter-js';
import { createCircleBody } from '../src/core/physics';
import { boundsOf, circleMass, distanceToSupport, inheritMomentum } from '../src/game/mergeSettle';

describe('circleMass — 質量由密度與半徑決定 / mass from density and radius', () => {
  it('grows with the square of the radius', () => {
    const small = circleMass(1, 2);
    const large = circleMass(1, 4);

    expect(large / small).toBeCloseTo(4, 6);
  });

  it('scales linearly with density', () => {
    expect(circleMass(3, 5)).toBeCloseTo(circleMass(1, 5) * 3, 6);
  });
});

describe('inheritMomentum — 質量加權平均 / mass-weighted average', () => {
  it('returns the arithmetic mean when the masses are equal', () => {
    const v = inheritMomentum({ x: 4, y: -2 }, 1, { x: 2, y: 6 }, 1);

    expect(v.x).toBeCloseTo(3, 6);
    expect(v.y).toBeCloseTo(2, 6);
  });

  it('favours the heavier body', () => {
    const v = inheritMomentum({ x: 0, y: 0 }, 3, { x: 8, y: 0 }, 1);

    expect(v.x).toBeCloseTo(2, 6);
  });

  it('conserves momentum: total p_out equals total p_in', () => {
    const ma = 2.5;
    const mb = 1.5;
    const va = { x: 3, y: -1 };
    const vb = { x: -2, y: 5 };

    const result = inheritMomentum(va, ma, vb, mb);
    const total = ma + mb;

    expect(result.x * total).toBeCloseTo(va.x * ma + vb.x * mb, 6);
    expect(result.y * total).toBeCloseTo(va.y * ma + vb.y * mb, 6);
  });

  it('returns a zero vector when both masses are zero', () => {
    const v = inheritMomentum({ x: 9, y: 9 }, 0, { x: 9, y: 9 }, 0);

    expect(v).toEqual({ x: 0, y: 0 });
  });

  it('carries a falling pair downward (the motivating case)', () => {
    const v = inheritMomentum({ x: 0, y: 12 }, 1, { x: 0, y: 8 }, 1);

    expect(v.y).toBeCloseTo(10, 6);
  });
});

describe('distanceToSupport — 向下投影 / downward projection', () => {
  const floor = [{ x: 0, y: 100, width: 200, height: 1 }];

  it('reports the gap between the circle bottom and a support top', () => {
    expect(distanceToSupport(100, 50, 20, floor)).toBeCloseTo(30, 6);
  });

  it('reports zero when the circle already rests on the support', () => {
    expect(distanceToSupport(100, 80, 20, floor)).toBe(0);
  });

  it('clamps a penetrating circle to zero rather than a negative distance', () => {
    expect(distanceToSupport(100, 95, 20, floor)).toBe(0);
  });

  it('ignores supports that do not overlap horizontally', () => {
    expect(distanceToSupport(500, 50, 20, floor)).toBe(Infinity);
  });

  it('treats a partial horizontal overlap as a support', () => {
    expect(distanceToSupport(195, 50, 20, floor)).toBeCloseTo(30, 6);
  });

  it('picks the nearest of several supports', () => {
    const supports = [
      { x: 0, y: 100, width: 200, height: 1 },
      { x: 0, y: 400, width: 200, height: 1 },
      { x: 0, y: 220, width: 200, height: 1 },
    ];

    expect(distanceToSupport(100, 50, 20, supports)).toBeCloseTo(30, 6);
  });

  it('ignores a support that is above the circle', () => {
    const above = [{ x: 0, y: 10, width: 200, height: 1 }];

    expect(distanceToSupport(100, 50, 20, above)).toBe(0);
  });

  it('returns infinity when every support is beyond the max distance', () => {
    expect(distanceToSupport(100, 50, 20, floor, 10)).toBe(Infinity);
  });

  it('reports the support when it is within the max distance', () => {
    expect(distanceToSupport(100, 50, 20, floor, 31)).toBeCloseTo(30, 6);
  });

  it('returns infinity with no supports at all', () => {
    expect(distanceToSupport(100, 50, 20, [])).toBe(Infinity);
  });
});

describe('boundsOf — 剛體包圍盒 / body bounding boxes', () => {
  it('converts a body into its bounding rectangle', () => {
    const body = createCircleBody(50, 60, 20);
    const rects = boundsOf([body], -1);

    expect(rects).toHaveLength(1);
    const [rect] = rects;
    expect(rect?.x).toBeCloseTo(body.bounds.min.x, 6);
    expect(rect?.y).toBeCloseTo(body.bounds.min.y, 6);
    expect(rect?.width).toBeCloseTo(body.bounds.max.x - body.bounds.min.x, 6);
    expect(rect?.height).toBeCloseTo(body.bounds.max.y - body.bounds.min.y, 6);
  });

  it('excludes the given body id', () => {
    const a = createCircleBody(0, 0, 10);
    const b = createCircleBody(100, 0, 10);

    expect(boundsOf([a, b], a.id)).toHaveLength(1);
    expect(boundsOf([a, b], a.id)[0]?.x).toBeCloseTo(b.bounds.min.x, 6);
  });

  it('returns nothing when every body is excluded', () => {
    const a = createCircleBody(0, 0, 10);

    expect(boundsOf([a], a.id)).toEqual([]);
  });

  it('reflects a translated body in its bounds', () => {
    const body = createCircleBody(0, 0, 20);
    const before = boundsOf([body], -1)[0]?.y ?? 0;

    Matter.Body.translate(body, { x: 0, y: 40 });

    expect(boundsOf([body], -1)[0]?.y).toBeCloseTo(before + 40, 6);
  });
});
