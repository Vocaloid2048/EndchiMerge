/**
 * 輪廓碰撞體的整合測試；真的跑 Matter.js，驗證凹多邊形被分解成凸塊而非凸包。
 * Integration tests for the outline collider; Matter.js runs, concave input must truly decompose.
 */

import { describe, expect, it } from 'vitest';
import Matter from 'matter-js';
import { createCircleBody, createPolygonBody, pushBody } from '../src/core/physics';

/** 一個邊長 40、正方、凸的輪廓（相對質心）。 */
function squarePolygon(half = 20) {
  return [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
}

/** 一個明顯的凹形：U 字。若被當成凸包，中間凹口會消失。 */
function uPolygon() {
  return [
    { x: -30, y: -30 },
    { x: -10, y: -30 },
    { x: -10, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: -30 },
    { x: 30, y: -30 },
    { x: 30, y: 30 },
    { x: -30, y: 30 },
  ];
}

describe('createPolygonBody', () => {
  it('registers poly-decomp with Matter so concave input can be decomposed', () => {
    expect(Matter.Common.getDecomp()).not.toBeNull();
  });

  it('builds a body from a convex polygon', () => {
    const body = createPolygonBody(100, 100, squarePolygon());

    expect(body).not.toBeNull();
    expect(body!.mass).toBeGreaterThan(0);
    expect(body!.position.x).toBeCloseTo(100, 0);
    expect(body!.position.y).toBeCloseTo(100, 0);
  });

  it('decomposes a concave polygon into more than one part', () => {
    /*
     * U 是凹的：分解成功至少有兩個凸塊，未分解時 Matter 只回單一凸包（本體＋一個 part）。
     * A U is concave: decomposition yields at least two pieces, without it Matter returns one hull.
     */
    const body = createPolygonBody(0, 0, uPolygon());

    expect(body).not.toBeNull();
    expect(body!.parts.length).toBeGreaterThan(2);
  });

  it('returns null for a degenerate polygon', () => {
    expect(createPolygonBody(0, 0, [])).toBeNull();
    expect(
      createPolygonBody(0, 0, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
    expect(
      createPolygonBody(0, 0, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]),
    ).toBeNull();
  });
});

describe('createCircleBody', () => {
  it('still builds a working fallback body', () => {
    const body = createCircleBody(50, 60, 20);

    expect(body.mass).toBeGreaterThan(0);
    expect(body.circleRadius).toBeCloseTo(20, 6);
  });
});

describe('pushBody — 沿方向推開剛體 / displace a body along a direction', () => {
  it('translates the body by the requested distance', () => {
    const body = createCircleBody(0, 0, 10);
    pushBody(body, 1, 0, 5, 0);

    expect(body.position.x).toBeCloseTo(5, 6);
    expect(body.position.y).toBeCloseTo(0, 6);
  });

  it('pushes along a diagonal direction', () => {
    const body = createCircleBody(0, 0, 10);
    const inv = 1 / Math.SQRT2;
    pushBody(body, inv, inv, 10, 0);

    expect(body.position.x).toBeCloseTo(10 * inv, 6);
    expect(body.position.y).toBeCloseTo(10 * inv, 6);
  });

  it('adds a velocity kick on top of any existing velocity', () => {
    const body = createCircleBody(0, 0, 10);
    Matter.Body.setVelocity(body, { x: 1, y: 0 });

    pushBody(body, 1, 0, 0, 0.5);

    expect(body.velocity.x).toBeCloseTo(1.5, 6);
    expect(body.velocity.y).toBeCloseTo(0, 6);
  });

  it('keeps the cached bounds in sync with the new position', () => {
    /*
     * 釘住「用 `Body.translate` 而非直接改 `position`」，並且斷言位移量而非絕對位置 ——
     * 圓形剛體的頂點是多邊形近似，絕對值不可靠。
     * Pins "use `Body.translate`, not a raw `position` assignment", and asserts the shift rather
     * than absolute positions (a circle's vertices are a polygon approximation).
     */
    const body = createCircleBody(0, 0, 10);
    const beforeBounds = body.bounds.min.x;
    const beforeMinX = Math.min(...body.vertices.map((v) => v.x));

    pushBody(body, 1, 0, 25, 0);

    expect(body.bounds.min.x).toBeCloseTo(beforeBounds + 25, 6);
    expect(Math.min(...body.vertices.map((v) => v.x))).toBeCloseTo(beforeMinX + 25, 6);
  });

  it('does nothing when both distance and speed are zero', () => {
    const body = createCircleBody(7, 8, 10);
    pushBody(body, 1, 0, 0, 0);

    expect(body.position.x).toBeCloseTo(7, 6);
    expect(body.position.y).toBeCloseTo(8, 6);
  });
});
