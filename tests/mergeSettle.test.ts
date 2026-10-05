/**
 * `mergeSettle` 的單元測試：動量繼承、質量、向下投影找支撐。
 * Unit tests for `mergeSettle`: momentum inheritance, mass, and downward support projection.
 *
 * 這些是**純函式**，所以測試不需要 Matter 世界、不需要跑幀 —— 直接餵數字、比對數字。
 * These are **pure functions**, so the tests need no Matter world and no frame stepping — feed
 * numbers in, compare numbers out.
 */

import { describe, expect, it } from 'vitest';
import Matter from 'matter-js';
import { createCircleBody } from '../src/core/physics';
import { boundsOf, circleMass, distanceToSupport, inheritMomentum } from '../src/game/mergeSettle';

describe('circleMass — 質量由密度與半徑決定 / mass from density and radius', () => {
  it('grows with the square of the radius', () => {
    const small = circleMass(1, 2);
    const large = circleMass(1, 4);

    /* 半徑兩倍 → 面積四倍 → 質量四倍。 */
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
    /*
     * 質量 3 那顆靜止、質量 1 那顆以 8 前進 → 合成速度偏向重的：8 × 1/4 = 2。
     * The mass-3 body is at rest and the mass-1 body moves at 8, so the result leans to the
     * heavier one: 8 × 1/4 = 2.
     */
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

    /* m_total × v_result 應等於 m_a·v_a + m_b·v_b，逐軸檢查。 */
    expect(result.x * total).toBeCloseTo(va.x * ma + vb.x * mb, 6);
    expect(result.y * total).toBeCloseTo(va.y * ma + vb.y * mb, 6);
  });

  it('returns a zero vector when both masses are zero', () => {
    /* 質量都不存在時沒有動量；這裡守住「不要除以零」的退路。 */
    const v = inheritMomentum({ x: 9, y: 9 }, 0, { x: 9, y: 9 }, 0);

    expect(v).toEqual({ x: 0, y: 0 });
  });

  it('carries a falling pair downward (the motivating case)', () => {
    /*
     * 使用者要的情境：兩顆都在下墜，合成後不該停在半空 —— 速度必須往下。
     * The motivating case: two falling bodies must not stop dead on merging — the velocity must
     * still point down.
     */
    const v = inheritMomentum({ x: 0, y: 12 }, 1, { x: 0, y: 8 }, 1);

    expect(v.y).toBeCloseTo(10, 6);
  });
});

describe('distanceToSupport — 向下投影 / downward projection', () => {
  /** 一條橫向的地板，上緣在 y=100。 */
  const floor = [{ x: 0, y: 100, width: 200, height: 1 }];

  it('reports the gap between the circle bottom and a support top', () => {
    /* 圓心 y=50、半徑 20 → 圓底 70；支撐上緣 100 → 還差 30。 */
    expect(distanceToSupport(100, 50, 20, floor)).toBeCloseTo(30, 6);
  });

  it('reports zero when the circle already rests on the support', () => {
    /* 圓心 y=80、半徑 20 → 圓底正好 100 ＝ 支撐上緣。 */
    expect(distanceToSupport(100, 80, 20, floor)).toBe(0);
  });

  it('clamps a penetrating circle to zero rather than a negative distance', () => {
    /* 圓底已經越過支撐上緣（已穿透）→ 0，不是負數。 */
    expect(distanceToSupport(100, 95, 20, floor)).toBe(0);
  });

  it('ignores supports that do not overlap horizontally', () => {
    /* 圓在 x=500，地板只到 x=200 → 腳下無物。 */
    expect(distanceToSupport(500, 50, 20, floor)).toBe(Infinity);
  });

  it('treats a partial horizontal overlap as a support', () => {
    /* 圓心 x=195、半徑 20 → 左緣 175，地板右緣 200，仍有重疊。 */
    expect(distanceToSupport(195, 50, 20, floor)).toBeCloseTo(30, 6);
  });

  it('picks the nearest of several supports', () => {
    const supports = [
      { x: 0, y: 100, width: 200, height: 1 },
      { x: 0, y: 400, width: 200, height: 1 },
      { x: 0, y: 220, width: 200, height: 1 },
    ];

    /* 最近的支撐是 100 那條（差 30），不是 220 或 400。 */
    expect(distanceToSupport(100, 50, 20, supports)).toBeCloseTo(30, 6);
  });

  it('ignores a support that is above the circle', () => {
    /*
     * 支撐在圓的上方（y=10 < 圓心 50）→ 不會墊在下面，不算。
     * A support above the circle is not something to land on.
     */
    const above = [{ x: 0, y: 10, width: 200, height: 1 }];

    expect(distanceToSupport(100, 50, 20, above)).toBe(0);
  });

  it('returns infinity when every support is beyond the max distance', () => {
    /* 門檻 10，但最近支撐要下落 30 → 太遠，回報 Infinity（維持自由落體）。 */
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
    /*
     * `Matter.Body.translate` 會同步 `bounds`，所以位移後由 `boundsOf` 讀到的是新位置 ——
     * 這條守住「推力／吸附之後，向下投影看到的是最新位置」。
     * `Matter.Body.translate` keeps `bounds` in sync, so after a shift `boundsOf` reads the new
     * position — this pins "after a push or a snap, the projection sees the current location".
     */
    const body = createCircleBody(0, 0, 20);
    const before = boundsOf([body], -1)[0]?.y ?? 0;

    Matter.Body.translate(body, { x: 0, y: 40 });

    expect(boundsOf([body], -1)[0]?.y).toBeCloseTo(before + 40, 6);
  });
});
