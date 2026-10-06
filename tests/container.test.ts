/**
 * 容器 U 形外框幾何的單元測試。
 * Unit tests for the container's U-shaped frame geometry.
 *
 * 這裡守住兩個不變式：**寬度吃滿畫布**，以及**頂端留出的投放頭部空間被夾在合法範圍**。
 * 前者若被改壞，線框會與畫布邊緣之間出現縫隙或溢出；後者若被改壞，投放中的方團團會
 * 生在畫面之外，或直接生在槽裡面。兩者都只在實際跑起來時才看得到，所以用測試釘住。
 * Two invariants: the width fills the canvas, and the headroom reserved at the top is
 * clamped to a legal range. Break the first and the outline gaps or overflows the canvas;
 * break the second and the in-flight dumpling spawns off-screen or already inside the
 * trough. Both are only visible at runtime, so they are pinned here.
 */

import { describe, expect, it } from 'vitest';
import { clipToPlayField, computeContainerGeometry } from '../src/render/container';
import type { ContainerConfig } from '../src/core/types';

/** 與 configLoader 的 DEFAULT_CONTAINER 一致。 */
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
  aspectMin: 0.62,
  aspectMax: 1.45,
};

describe('computeContainerGeometry — U 形外框 / the U frame', () => {
  it('fills the canvas width and starts below the reserved headroom', () => {
    const { frame } = computeContainerGeometry(500, 1000, CONFIG);

    expect(frame.x).toBe(0);
    expect(frame.y).toBe(CONFIG.topOffset);
    expect(frame.width).toBe(500);
    expect(frame.height).toBe(1000 - CONFIG.topOffset);
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
    /* 頂端留白比畫布還高時，frame 被夾到只剩 1 單位，而不是變成 0 或負值。 */
    const { frame } = computeContainerGeometry(500, 50, CONFIG);

    expect(frame.y).toBe(49);
    expect(frame.height).toBe(1);
  });

  it('never shrinks the frame below one unit', () => {
    const { frame } = computeContainerGeometry(10, 10, CONFIG);

    expect(frame.width).toBe(10);
    expect(frame.height).toBe(1);
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
  /**
   * 只記錄 `rect()` 與 `clip()` 的假上下文：這個函式不畫任何東西，只宣告範圍。
   * A fake context that records only `rect()` and `clip()`: the function draws nothing, it
   * merely declares a region.
   */
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

  it('clips to the frame horizontally and from the given Y down to the floor', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(clipCount()).toBe(1);
    expect(rects).toHaveLength(1);
    /* 橫向＝整個 frame（裁切不內縮，線框另外畫）。 */
    expect(rects[0]?.[0]).toBe(geometry.frame.x);
    expect(rects[0]?.[2]).toBe(geometry.frame.width);
    /* 縱向＝由 0（畫布頂端）直落到 frame 底部。 */
    expect(rects[0]?.[1]).toBe(0);
    expect((rects[0]?.[1] ?? 0) + (rects[0]?.[3] ?? 0)).toBe(
      geometry.frame.y + geometry.frame.height,
    );
  });

  it('starts the clip at the requested Y when one is given', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx } = makeCtx();

    /* 0（畫布頂端）到頂緣之間是合法區間；拿 20 當例子。 */
    clipToPlayField(ctx, geometry, 20);

    expect(rects[0]?.[1]).toBe(20);
    /* 高度隨上界縮短，底部仍然對齊 frame 底部。 */
    expect((rects[0]?.[1] ?? 0) + (rects[0]?.[3] ?? 0)).toBe(
      geometry.frame.y + geometry.frame.height,
    );
  });

  it('never lets the clip start below the rim', () => {
    /* 傳一個比頂緣更低的 Y 會被夾到頂緣：裁切只該往「上」放寬，不該切掉容器內容。 */
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx } = makeCtx();

    clipToPlayField(ctx, geometry, 9000);

    expect(rects[0]?.[1]).toBe(geometry.frame.y);
  });

  it('still clips for a degenerate size, because the frame is never empty', () => {
    /*
     * `computeContainerGeometry()` 對退化輸入仍會給出至少 1×1 的 frame（見上面的測試），
     * 所以裁切照樣成立 —— 這裡把「不會有零面積 frame」這個既有的保證與裁切綁在一起，
     * 避免日後有人把 `max(1, ...)` 拿掉卻不知道那會讓裁切整個畫面變黑。
     * `computeContainerGeometry()` still returns at least a 1×1 frame for degenerate input
     * (see the tests above), so the clip still applies. This ties "the frame is never empty"
     * to the clip, so removing that `max(1, ...)` later is known to blank the whole canvas.
     */
    const geometry = computeContainerGeometry(0, 0, CONFIG);
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(geometry.frame.width).toBeGreaterThan(0);
    expect(clipCount()).toBe(1);
    expect(rects[0]?.[2]).toBe(geometry.frame.width);
  });

  it('leaves the context alone when the frame has no area at all', () => {
    /*
     * 直接餵一個零面積的 frame（繞過幾何函式）才是真正的退化路徑：此時不能裁，否則之後
     * 每一次繪製都會被吃掉。
     * Feeding a zero-area frame directly (bypassing the geometry helper) is the real
     * degenerate path: clipping here would swallow every later draw call.
     */
    const geometry = {
      ...computeContainerGeometry(500, 1000, CONFIG),
      frame: { x: 0, y: 80, width: 0, height: 0 },
    };
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(clipCount()).toBe(0);
    expect(rects).toHaveLength(0);
  });
});
