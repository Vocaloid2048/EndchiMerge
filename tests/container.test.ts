/**
 * 容器 U 形外框幾何的單元測試。
 * Unit tests for the container's U-shaped frame geometry.
 */

import { describe, expect, it } from 'vitest';
import { clipToPlayField, computeContainerGeometry } from '../src/render/container';
import type { ContainerConfig } from '../src/core/types';

/**
 * 與 configLoader 的 DEFAULT_CONTAINER 一致（含 50/50 的展示餘裕）。
 * Mirrors `DEFAULT_CONTAINER` from configLoader, including the 50/50 display margins.
 */
const CONFIG: ContainerConfig = {
  cornerRadius: 16,
  strokeWidth: 10,
  strokeColor: '#FFFFFF',
  fill: 'rgba(255, 255, 255, 0.20)',
  topOffset: 80,
  spawnGap: 8,
  dropAboveRim: 40,
  overflowAboveRim: 30,
  floatCeilingBelowRim: 20,
  bottomOffset: 0,
  leftOffset: 50,
  rightOffset: 50,
  aspectMin: 0.62,
  aspectMax: 1.45,
};

describe('computeContainerGeometry — U 形外框 / the U frame', () => {
  it('insets the frame by the display margins and keeps the canvas for the display', () => {
    const { frame, display } = computeContainerGeometry(500, 1000, CONFIG);

    expect(frame.x).toBe(CONFIG.leftOffset);
    expect(frame.width).toBe(500 - CONFIG.leftOffset - CONFIG.rightOffset);
    expect(frame.y).toBe(CONFIG.topOffset);
    expect(frame.height).toBe(1000 - CONFIG.topOffset);

    expect(display.x).toBe(0);
    expect(display.width).toBe(500);
    expect(display.y).toBe(frame.y);
    expect(display.y + display.height).toBe(1000);
  });

  it('raises the frame bottom by bottomOffset but keeps the clip to the canvas bottom', () => {
    const { frame, display } = computeContainerGeometry(500, 1000, { ...CONFIG, bottomOffset: 70 });

    expect(frame.y + frame.height).toBe(1000 - 70);
    expect(display.y + display.height).toBe(1000);
  });

  it('clamps bottomOffset so the frame keeps at least one unit of height', () => {
    const { frame } = computeContainerGeometry(500, 1000, { ...CONFIG, bottomOffset: 5000 });

    expect(frame.height).toBe(1);
    expect(frame.y + frame.height).toBe(CONFIG.topOffset + 1);
  });

  it('falls back to a full-width frame when both margins are zero', () => {
    const { frame, display } = computeContainerGeometry(500, 1000, {
      ...CONFIG,
      leftOffset: 0,
      rightOffset: 0,
    });

    expect(frame.x).toBe(0);
    expect(frame.width).toBe(500);
    expect(display.width).toBe(500);
  });

  it('treats negative margins as zero', () => {
    const { frame } = computeContainerGeometry(500, 1000, {
      ...CONFIG,
      leftOffset: -80,
      rightOffset: -80,
    });

    expect(frame.x).toBe(0);
    expect(frame.width).toBe(500);
  });

  it('caps each margin at 40% of the canvas so the frame never collapses', () => {
    const { frame, display } = computeContainerGeometry(500, 1000, {
      ...CONFIG,
      leftOffset: 5000,
      rightOffset: 5000,
    });

    expect(frame.x).toBe(200);
    expect(frame.width).toBe(100);
    expect(frame.width).toBeGreaterThan(0);
    expect(display.width).toBe(500);
  });

  it('is unaffected by the headroom when it is zero', () => {
    const { frame } = computeContainerGeometry(320, 480, { ...CONFIG, topOffset: 0 });

    expect(frame.y).toBe(0);
    expect(frame.height).toBe(480);
  });

  it('clamps a negative headroom to zero rather than pushing the frame off the canvas', () => {
    const { frame } = computeContainerGeometry(500, 1000, { ...CONFIG, topOffset: -40 });

    expect(frame.y).toBe(0);
    expect(frame.height).toBe(1000);
  });

  it('clamps the headroom so a short canvas still yields a positive frame', () => {
    const { frame } = computeContainerGeometry(500, 50, CONFIG);

    expect(frame.y).toBe(49);
    expect(frame.height).toBe(1);
  });

  it('still returns a positive frame for a degenerate canvas', () => {
    const { frame, display } = computeContainerGeometry(10, 10, CONFIG);

    expect(frame.x).toBe(4);
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(1);
    expect(display.width).toBe(10);
  });
});

describe('computeContainerGeometry — 樣式沿用 / style passthrough', () => {
  it('carries over the outline, corner and fill settings untouched', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);

    expect(geometry.cornerRadius).toBe(CONFIG.cornerRadius);
    expect(geometry.strokeWidth).toBe(CONFIG.strokeWidth);
    expect(geometry.strokeColor).toBe(CONFIG.strokeColor);
    expect(geometry.fill).toBe(CONFIG.fill);
  });

  it('never returns a negative corner radius or stroke width', () => {
    const geometry = computeContainerGeometry(500, 1000, {
      ...CONFIG,
      cornerRadius: -10,
      strokeWidth: -5,
    });

    expect(geometry.cornerRadius).toBe(0);
    expect(geometry.strokeWidth).toBe(0);
  });
});

describe('clipToPlayField — 顯式裁切 / the explicit clip', () => {
  function makeCtx(): { ctx: CanvasRenderingContext2D; rects: number[][]; clipCount: () => number } {
    const rects: number[][] = [];
    let clips = 0;

    const ctx = {
      beginPath: (): void => undefined,
      rect: (x: number, y: number, w: number, h: number): void => {
        rects.push([x, y, w, h]);
      },
      clip: (): void => {
        clips += 1;
      },
    } as unknown as CanvasRenderingContext2D;

    return { ctx, rects, clipCount: (): number => clips };
  }

  it('clips to the display region, not the frame, and runs down to the floor', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(clipCount()).toBe(1);
    expect(rects).toHaveLength(1);
    expect(rects[0]?.[0]).toBe(geometry.display.x);
    expect(rects[0]?.[2]).toBe(geometry.display.width);
    expect(rects[0]?.[2]).toBeGreaterThan(geometry.frame.width);
    expect(rects[0]?.[1]).toBe(0);
    expect((rects[0]?.[1] ?? 0) + (rects[0]?.[3] ?? 0)).toBe(
      geometry.frame.y + geometry.frame.height,
    );
  });

  it('does not move when the frame is shaken', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const before = makeCtx();
    clipToPlayField(before.ctx, geometry);

    const shaken = {
      ...geometry,
      frame: { ...geometry.frame, x: geometry.frame.x + 50 },
    };
    const after = makeCtx();
    clipToPlayField(after.ctx, shaken);

    expect(after.rects).toEqual(before.rects);
  });

  it('starts the clip at the requested Y when one is given', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx } = makeCtx();

    clipToPlayField(ctx, geometry, 20);

    expect(rects[0]?.[1]).toBe(20);
    expect((rects[0]?.[1] ?? 0) + (rects[0]?.[3] ?? 0)).toBe(
      geometry.frame.y + geometry.frame.height,
    );
  });

  it('never lets the clip start below the rim', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx } = makeCtx();

    clipToPlayField(ctx, geometry, 9000);

    expect(rects[0]?.[1]).toBe(geometry.frame.y);
  });

  it('still clips for a degenerate size, because the frame is never empty', () => {
    const geometry = computeContainerGeometry(0, 0, CONFIG);
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(geometry.frame.width).toBeGreaterThan(0);
    expect(clipCount()).toBe(1);
    expect(rects[0]?.[2]).toBe(geometry.frame.width);
  });

  it('leaves the context alone when the display region has no area at all', () => {
    const geometry = {
      ...computeContainerGeometry(500, 1000, CONFIG),
      display: { x: 0, y: 80, width: 0, height: 0 },
    };
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(clipCount()).toBe(0);
    expect(rects).toHaveLength(0);
  });
});
