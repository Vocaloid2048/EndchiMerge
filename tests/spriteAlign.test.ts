/**
 * sprite 對位數學的單元測試。
 * Unit tests for the sprite alignment maths.
 *
 * 「畫面上的身體對不上碰撞圓」正是這個遊戲最致命的瑕疵（design.md §1.5.1），
 * 所以這裡把兩個不變式釘死：素材的 body 外框必須**恰好**等於碰撞直徑，而 body
 * 中心必須落在圓心上。任何一邊被改動，這裡就會亮紅燈。
 * "The body on screen does not line up with the collision circle" is the most
 * damaging defect this game can have, so two invariants are pinned: the asset's body
 * box must equal the collision diameter exactly, and its centre must land on the
 * circle's centre.
 */

import { describe, expect, it } from 'vitest';
import { SPRITE_ANCHOR, SPRITE_BODY, SPRITE_SIZE, spriteScaleForRadius } from '../src/core/constants';
import { spriteDrawSize } from '../src/render/stage';

describe('sprite 正規化常數 / normalisation constants', () => {
  it('matches the values written into the assets', () => {
    /* design.md §1.5.1：512²、body 304、中心 (256, 328)。 */
    expect(SPRITE_SIZE).toBe(512);
    expect(SPRITE_BODY).toBe(304);
    expect(SPRITE_ANCHOR).toEqual({ x: 256, y: 328 });
  });

  it('keeps the body centre on the canvas centre-line horizontally', () => {
    /* x 置中，y 偏下（裝飾多在身體上方）。 */
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
    /* drawBody() 以 (x - ANCHOR.x*scale, y - ANCHOR.y*scale) 為繪製原點。 */
    const drawOriginX = x - SPRITE_ANCHOR.x * scale;
    const drawOriginY = y - SPRITE_ANCHOR.y * scale;

    /* 把 body 外框的左右緣換算回場景座標，應該剛好夾住碰撞圓。 */
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
