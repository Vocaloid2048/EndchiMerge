/**
 * 容器 U 形外框幾何的單元測試。
 * Unit tests for the container's U-shaped frame geometry.
 *
 * 這裡守住三個不變式：**外框左右各讓開展示餘裕**、**可繪製範圍（`display`）吃滿畫布**，
 * 以及**頂端留出的投放頭部空間被夾在合法範圍**。餘裕若被改壞，搖晃時容器會被畫布切掉；
 * 裁切範圍若跟着外框跑，貼牆的方團團會被切半邊；頭部空間若被改壞，投放中的方團團會生在
 * 畫面之外，或直接生在槽裡面。三者都只在實際跑起來時才看得到，所以用測試釘住。
 * Three invariants: the frame gives up its display margins on each side, the **drawable region**
 * (`display`) fills the canvas, and the headroom reserved at the top is clamped to a legal range.
 * Break the margins and the shaking container gets sliced by the canvas; let the clip follow the
 * frame and wall-hugging dumplings get cut in half; break the headroom and the in-flight dumpling
 * spawns off-screen or already inside the trough. All three are only visible at runtime, so they
 * are pinned here.
 */

import { describe, expect, it } from 'vitest';
import { clipToPlayField, computeContainerGeometry } from '../src/render/container';
import type { ContainerConfig } from '../src/core/types';

/** 與 configLoader 的 DEFAULT_CONTAINER 一致（含 50/50 的展示餘裕）。 */
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
    /*
     * 畫布 500、餘裕各 50 → 外框 400 寬、起於 x = 50；可繪製範圍仍是整張 500 寬的畫布。
     * 兩者相抵，所以「畫布變寬多少、外框就往內縮多少」，容器尺寸不隨餘裕改變。
     * Canvas 500 with 50 per side: the frame is 400 wide starting at x = 50, while the display
     * still spans the whole 500-wide canvas. The two cancel, so widening the canvas insets the
     * frame by the same amount and the container's size never follows the margins.
     */
    const { frame, display } = computeContainerGeometry(500, 1000, CONFIG);

    expect(frame.x).toBe(CONFIG.leftOffset);
    expect(frame.width).toBe(500 - CONFIG.leftOffset - CONFIG.rightOffset);
    expect(frame.y).toBe(CONFIG.topOffset);
    expect(frame.height).toBe(1000 - CONFIG.topOffset);

    expect(display.x).toBe(0);
    expect(display.width).toBe(500);
    expect(display.y).toBe(frame.y);
    /* 裁切範圍一直伸到畫布底端：即使外框底緣被托高（見下一條），也切不到探出底緣的美術。 */
    expect(display.y + display.height).toBe(1000);
  });

  it('raises the frame bottom by bottomOffset but keeps the clip to the canvas bottom', () => {
    /*
     * 技能選取提示住在容器下方那條帶裡（使用者定案）：外框底緣托高 70，物理地板跟著升，
     * 可玩深度等量變淺；但裁切範圍刻意**不**跟著縮 —— 搖晃時探出底緣的方團團美術仍完整。
     * The skill-selection hint lives in the strip below the container (the user's decision):
     * the frame bottom is raised by 70, the physics floor follows, and the play depth shrinks
     * by the same amount — but the clip deliberately does **not** follow, so a dumpling poking
     * past the frame bottom mid-shake stays whole.
     */
    const { frame, display } = computeContainerGeometry(500, 1000, { ...CONFIG, bottomOffset: 70 });

    expect(frame.y + frame.height).toBe(1000 - 70);
    expect(display.y + display.height).toBe(1000);
  });

  it('clamps bottomOffset so the frame keeps at least one unit of height', () => {
    /*
     * 托高量先吃掉畫布：5000 被夾成「頂緣以下只留 1 個單位」，外框底緣落在頂緣 + 1。
     * The raise is clamped against the canvas: 5000 collapses to "one unit below the rim",
     * so the frame bottom lands at rim + 1.
     */
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
    /*
     * 兩側都填 5000 時不是「外框消失」而是各自被夾到畫布的 40%，外框仍保有 20% 的寬度。
     * 餘裕是設定失誤最可能出現的地方，所以下限由這裡保證，而不是靠 `max(1, ...)` 兜底。
     * Filling both sides with 5000 does not erase the frame: each margin is capped at 40% of the
     * canvas and the frame keeps 20%. The margins are where a config mistake would land, so the
     * floor is guaranteed here rather than leaning on the `max(1, ...)` fallback.
     */
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
    /* 頂端留白比畫布還高時，frame 被夾到只剩 1 單位，而不是變成 0 或負值。 */
    const { frame } = computeContainerGeometry(500, 50, CONFIG);

    expect(frame.y).toBe(49);
    expect(frame.height).toBe(1);
  });

  it('still returns a positive frame for a degenerate canvas', () => {
    /*
     * 退化畫布（10×10）也要拿到正尺寸：寬度靠 40% 上限保住 20%，高度靠 `max(1, ...)`。
     * A degenerate canvas (10×10) still yields a positive frame: the width survives through the
     * 40% cap (a 20% floor) and the height through `max(1, ...)`.
     */
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

  it('clips to the display region, not the frame, and runs down to the floor', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);
    const { rects, ctx, clipCount } = makeCtx();

    clipToPlayField(ctx, geometry);

    expect(clipCount()).toBe(1);
    expect(rects).toHaveLength(1);
    /*
     * 橫向＝可繪製範圍（外框＋兩側餘裕），**不是**外框：裁切若跟着外框跑，搖晃時貼在另一側
     * 牆邊的方團團就會被切掉半邊。
     * Horizontally the clip is the display region (the frame plus both margins), **not** the
     * frame: a clip that followed the frame would slice the wall-hugging dumplings on the
     * opposite side while the container shakes.
     */
    expect(rects[0]?.[0]).toBe(geometry.display.x);
    expect(rects[0]?.[2]).toBe(geometry.display.width);
    expect(rects[0]?.[2]).toBeGreaterThan(geometry.frame.width);
    /* 縱向＝由 0（畫布頂端）直落到 frame 底部。 */
    expect(rects[0]?.[1]).toBe(0);
    expect((rects[0]?.[1] ?? 0) + (rects[0]?.[3] ?? 0)).toBe(
      geometry.frame.y + geometry.frame.height,
    );
  });

  it('does not move when the frame is shaken', () => {
    /*
     * 這是「搖晃時方團團被切掉」那隻 bug 的回歸測試。`GameSession.containerGeometry` 疊上位移時
     * 只改 `frame`，所以同樣餵一份「晃到 x + 50」的幾何，裁切矩形必須一個數字都不變 ——
     * 它認的是 `display`。
     * Regression test for "the dumplings get cut off during a shake". `GameSession.containerGeometry`
     * folds the offset into `frame` only, so feeding a geometry whose frame has slid by 50 must
     * leave every number of the clip rect untouched — it reads `display`.
     */
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

  it('leaves the context alone when the display region has no area at all', () => {
    /*
     * 直接餵一個零面積的**可繪製範圍**（繞過幾何函式）才是真正的退化路徑：此時不能裁，否則
     * 之後每一次繪製都會被吃掉。
     * Feeding a zero-area **display region** directly (bypassing the geometry helper) is the real
     * degenerate path: clipping here would swallow every later draw call.
     */
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
