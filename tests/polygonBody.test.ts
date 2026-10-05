/**
 * 輪廓碰撞體的整合測試（真的跑 Matter.js）。
 * Integration tests for the outline collider (Matter.js actually runs).
 *
 * 這裡驗證**最關鍵的一條**：凹多邊形真的被分解成凸塊，而不是被硬套成凸包。若 `poly-decomp`
 * 沒接上，Matter 會靜默退回凸包，玩家的碰撞框會變成「隱形大三角」而完全察覺不到 ——
 * 所以這裡用一個明顯的凹形（U 字）斷言它的凸塊數量大於 1。
 * This verifies the **one thing that matters**: a concave polygon is genuinely decomposed into
 * convex pieces rather than silently forced into its convex hull. If `poly-decomp` were not
 * registered, Matter falls back to the hull and the collider becomes an invisible wedge — with
 * no visible symptom. A deliberately concave U shape is asserted to yield more than one part.
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
    /* 沒有這一步，下面的凹形測試會退回凸包而「意外通過」單一凸塊的斷言。 */
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
     * U 字是凹的：若 `poly-decomp` 沒生效，Matter 會回傳單一凸包（parts.length === 2：本體
     * ＋一個 part）。分解成功則至少有兩個以上的凸塊。
     * A U is concave: without decomposition Matter returns one hull (parts.length === 2, the
     * body plus a single part). Successful decomposition yields at least two convex pieces.
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
     * 這條釘住「用 `Body.translate` 而不是直接改 `position`」。直接賦值會讓 `bounds` 與
     * `vertices` 停在舊位置 —— 下一次碰撞偵測就會拿過期幾何去比對。
     * This pins "use `Body.translate`, not a raw `position` assignment": assigning leaves
     * `bounds` and `vertices` at the old location, and the next collision pass then tests
     * against stale geometry.
     *
     * 斷言的是**位移量**而不是絕對位置：圓形剛體的頂點是多邊形近似（Matter 預設取樣數
     * 讓半徑 10 的圓在 x 上只到 15.489 而非 15），所以絕對值不可靠，位移才可靠。
     * The assertion is on the **shift**, not the absolute position: a circle's vertices are a
     * polygon approximation (Matter's default sample count makes a radius-10 circle reach
     * 15.489 on x, not 15), so the absolute value is unreliable while the shift is exact.
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
