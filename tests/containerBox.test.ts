/**
 * 遊玩區物理邊界的單元測試。
 * Unit tests for the play area's physics boundaries.
 *
 * 這裡釘住三件事：空腔與牆的**內緣必須完全貼合**（否則球會卡在縫隙或被牆推出去）、
 * 地板**橫跨整個前表面寬度**（否則底部轉角有洞）、以及矩形左上角定址轉 Matter
 * **中心點**定址的換算正確。
 * Three things are pinned: the cavity and wall inner edges must coincide exactly (or
 * bodies snag on a seam), the floor must span the full front width (or the bottom
 * corners leak), and the top-left → Matter-centre conversion must be right.
 */

import { describe, expect, it } from 'vitest';
import {
  computeContainerBounds,
  computePlayArea,
  computeWalls,
  createContainerBodies,
  DEFAULT_WALL_OVERHANG,
} from '../src/game/containerBox';
import { WALL_THICKNESS } from '../src/core/constants';
import type { Rect } from '../src/core/types';

/** 一個典型的前表面：500 寬、1000 高，位於原點。 */
const FRONT: Rect = { x: 0, y: 0, width: 500, height: 1000 };

const [leftWall, rightWall, floor] = computeWalls(FRONT);
const cavity = computePlayArea(FRONT);

describe('computePlayArea — 空腔內縮 / cavity inset', () => {
  it('insets the sides and the bottom by one wall thickness', () => {
    expect(cavity.x).toBe(WALL_THICKNESS);
    expect(cavity.width).toBe(500 - WALL_THICKNESS * 2);
    /* 底部縮、頂部不縮：方團團要從上方投進來。 */
    expect(cavity.y).toBe(0);
    expect(cavity.height).toBe(1000 - WALL_THICKNESS);
  });

  it('keeps the cavity anchored to the front face when it is offset', () => {
    const offset = computePlayArea({ x: 26, y: 18, width: 474, height: 982 });

    expect(offset.x).toBe(26 + WALL_THICKNESS);
    expect(offset.y).toBe(18);
    expect(offset.height).toBe(982 - WALL_THICKNESS);
  });

  it('never returns a degenerate cavity', () => {
    const tiny = computePlayArea({ x: 0, y: 0, width: 10, height: 10 });

    expect(tiny.width).toBe(1);
    expect(tiny.height).toBe(1);
  });
});

describe('computeWalls — 貼合空腔 / flush with the cavity', () => {
  it('returns exactly three slabs in left, right, floor order', () => {
    expect(computeWalls(FRONT)).toHaveLength(3);
  });

  it('puts the left wall flush against the cavity', () => {
    expect(leftWall.x + leftWall.width).toBe(cavity.x);
    expect(leftWall.width).toBe(WALL_THICKNESS);
  });

  it('puts the right wall flush against the cavity', () => {
    expect(rightWall.x).toBe(cavity.x + cavity.width);
    expect(rightWall.x + rightWall.width).toBe(FRONT.x + FRONT.width);
  });

  it('puts the floor flush against the cavity bottom', () => {
    expect(floor.y).toBe(cavity.y + cavity.height);
    expect(floor.height).toBe(WALL_THICKNESS);
  });

  it('spans the floor across the full front width so the corners have no gap', () => {
    expect(floor.x).toBe(FRONT.x);
    expect(floor.width).toBe(FRONT.width);
  });

  it('lets both walls reach down to the floor', () => {
    const cavityBottom = cavity.y + cavity.height;

    expect(leftWall.y + leftWall.height).toBe(cavityBottom);
    expect(rightWall.y + rightWall.height).toBe(cavityBottom);
  });

  it('rises above the front face so falling bodies cannot slip out sideways', () => {
    expect(leftWall.y).toBe(FRONT.y - DEFAULT_WALL_OVERHANG);
    expect(rightWall.y).toBe(leftWall.y);
  });

  it('clamps the overhang instead of allowing walls to start inside the play area', () => {
    const [shortLeft] = computeWalls(FRONT, WALL_THICKNESS, 0);

    expect(shortLeft.y).toBe(FRONT.y);
  });
});

describe('computeWalls — 不與空腔重疊 / never overlaps the cavity', () => {
  it('leaves every slab outside the cavity', () => {
    const inside = (wall: Rect): boolean =>
      wall.x < cavity.x + cavity.width &&
      wall.x + wall.width > cavity.x &&
      wall.y < cavity.y + cavity.height &&
      wall.y + wall.height > cavity.y;

    for (const wall of computeWalls(FRONT)) {
      expect(inside(wall)).toBe(false);
    }
  });
});

describe('computeContainerBounds — 一次算完 / one-shot derivation', () => {
  it('agrees with the individual helpers', () => {
    const bounds = computeContainerBounds(FRONT);

    expect(bounds.cavity).toEqual(cavity);
    expect(bounds.walls).toEqual(computeWalls(FRONT));
  });
});

describe('createContainerBodies — 座標換算 / coordinate conversion', () => {
  it('converts top-left rectangles into centre-addressed bodies', () => {
    const bodies = createContainerBodies(computeWalls(FRONT));

    expect(bodies).toHaveLength(3);

    /* 左牆：左上角 (0, -240)、16 × 1224 → 中心 (8, 372)。 */
    expect(bodies[0]?.position.x).toBeCloseTo(leftWall.x + leftWall.width / 2, 6);
    expect(bodies[0]?.position.y).toBeCloseTo(leftWall.y + leftWall.height / 2, 6);
  });

  it('makes every body static', () => {
    for (const body of createContainerBodies(computeWalls(FRONT))) {
      expect(body.isStatic).toBe(true);
    }
  });
});
