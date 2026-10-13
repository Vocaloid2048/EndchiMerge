/**
 * sprite 對位數學的單元測試：body 外框恰等於碰撞直徑、body 中心落在圓心。
 * Unit tests for the sprite alignment maths: the body box equals the collision diameter, centred.
 */

import { describe, expect, it } from 'vitest';
import { SPRITE_ANCHOR, SPRITE_BODY, SPRITE_SIZE, spriteScaleForRadius } from '../src/core/constants';
import { spriteDrawSize } from '../src/render/stage';

describe('sprite 正規化常數 / normalisation constants', () => {
  it('matches the values written into the assets', () => {
    expect(SPRITE_SIZE).toBe(512);
    expect(SPRITE_BODY).toBe(304);
    expect(SPRITE_ANCHOR).toEqual({ x: 256, y: 328 });
  });

  it('keeps the body centre on the canvas centre-line horizontally', () => {
    expect(SPRITE_ANCHOR.x).toBe(SPRITE_SIZE / 2);
    expect(SPRITE_ANCHOR.y).toBeGreaterThan(SPRITE_SIZE / 2);
  });
});

describe('spriteDrawSize — body 對上碰撞圓 / body matches the collision circle', () => {
  it('maps the 304 body box onto exactly the collision diameter', () => {
    for (const radius of [13.5, 17.3, 36.2, 124.5]) {
      const drawnBody = spriteDrawSize(radius) * (SPRITE_BODY / SPRITE_SIZE);

      expect(drawnBody).toBeCloseTo(radius * 2, 9);
    }
  });

  it('scales linearly with the radius', () => {
    const unit = spriteDrawSize(1);

    expect(spriteDrawSize(10)).toBeCloseTo(unit * 10, 9);
    expect(spriteDrawSize(124.5) / spriteDrawSize(13.5)).toBeCloseTo(124.5 / 13.5, 9);
  });

  it('agrees with the formula in design.md §1.5.1', () => {
    const radius = 22.1;
    const scale = (2 * radius) / SPRITE_BODY;

    expect(spriteScaleForRadius(radius)).toBeCloseTo(scale, 12);
    expect(spriteDrawSize(radius)).toBeCloseTo(SPRITE_SIZE * scale, 9);
  });
});

describe('spriteDrawSize — 質心偏移 / centre offset', () => {
  it('brackets the collision circle with the drawn body box', () => {
    const x = 250;
    const y = 700;
    const radius = 46.4;
    const scale = spriteScaleForRadius(radius);
    const drawOriginX = x - SPRITE_ANCHOR.x * scale;
    const drawOriginY = y - SPRITE_ANCHOR.y * scale;

    const bodyLeft = drawOriginX + (SPRITE_ANCHOR.x - SPRITE_BODY / 2) * scale;
    const bodyRight = drawOriginX + (SPRITE_ANCHOR.x + SPRITE_BODY / 2) * scale;
    const bodyTop = drawOriginY + (SPRITE_ANCHOR.y - SPRITE_BODY / 2) * scale;
    const bodyBottom = drawOriginY + (SPRITE_ANCHOR.y + SPRITE_BODY / 2) * scale;

    expect(bodyLeft).toBeCloseTo(x - radius, 9);
    expect(bodyRight).toBeCloseTo(x + radius, 9);
    expect(bodyTop).toBeCloseTo(y - radius, 9);
    expect(bodyBottom).toBeCloseTo(y + radius, 9);
  });
});
