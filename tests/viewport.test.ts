/**
 * 虛擬座標換算的單元測試。
 * Unit tests for virtual-coordinate conversion.
 *
 * 這一組測試守著一個實際發生過的 bug：**畫布被外層 CSS 縮放時，指標的換算沒有把縮放
 * 除回去**，於是手指停在容器右牆時，瞄準早已撞到夾制上限 —— 玩家看到的可投放範圍只剩
 * 左邊一小段，而且視窗越小越窄。每條斷言都對應那個症狀的其中一面。
 * These tests guard a bug that actually shipped: **when the canvas is CSS-scaled, pointer
 * conversion did not divide the scale back out**, so a finger resting on the right wall was
 * already past the clamp — the droppable range looked like a short segment on the left and
 * got narrower as the window shrank. Each assertion covers one face of that symptom.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Viewport } from '../src/render/viewport';

/*
 * 測試環境是 node，沒有 `window`；`Viewport.resize()` 只跟它要 `devicePixelRatio`。
 * 補一個最小替身，讓換算邏輯能在不需要瀏覽器的情況下被釘住。
 * The test environment is node and has no `window`; `Viewport.resize()` only asks it for
 * `devicePixelRatio`. A minimal stand-in keeps the conversion testable without a browser.
 */
beforeAll((): void => {
  (globalThis as unknown as { window: unknown }).window = { devicePixelRatio: 1 };
});

/** 一個剛好夠用的假 canvas；`Viewport` 只用到 `getContext` 與尺寸屬性。 */
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const ctx = {
    setTransform: () => undefined,
    clearRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;

  return {
    clientWidth: width,
    clientHeight: height,
    width,
    height,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

/** 依視窗尺寸與外層 CSS 縮放 k 造出一個視埠，並回傳「已縮放」的 rect。 */
function setup(
  cssWidth: number,
  cssHeight: number,
  scaleFactor: number,
): { viewport: Viewport; rect: DOMRectReadOnly } {
  const canvas = makeCanvas(cssWidth, cssHeight);
  const viewport = new Viewport(canvas);
  viewport.resize();

  const rect = {
    left: 0,
    top: 0,
    width: cssWidth * scaleFactor,
    height: cssHeight * scaleFactor,
  } as DOMRectReadOnly;

  return { viewport, rect };
}

describe('Viewport.toVirtual — 縮放還原 / undoing the CSS scale', () => {
  it('agrees with the identity case (k = 1)', () => {
    const { viewport, rect } = setup(800, 400, 1);
    /* 800×400 的畫布、虛擬高 1000 ⇒ 比例 0.4；x = 400 應落在虛擬 1000。 */
    const point = viewport.toVirtual(rect, 400, 200);

    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(1000, 6);
    expect(point?.y).toBeCloseTo(500, 6);
  });

  it('maps the visible right edge to the same virtual X regardless of CSS zoom', () => {
    /*
     * 這是 bug 的核心：外層縮放 k 改變的是「一個 CSS px 值多少虛擬單位」，視覺上的
     * 最右緣永遠是虛擬寬度。修好之前，k = 0.5 時指標要到視覺 2 倍遠才會碰到同一個虛擬 X。
     * The heart of the bug: the outer scale changes how many virtual units a CSS pixel is
     * worth, but the visible right edge is always the virtual width. Before the fix, at
     * k = 0.5 the pointer had to travel twice as far to reach the same virtual X.
     */
    for (const k of [1, 0.9, 0.75, 0.5, 0.25]) {
      const { viewport, rect } = setup(800, 400, k);
      /* 指標停在元素的最右緣：rect 寬就是 cssWidth × k。 */
      const point = viewport.toVirtual(rect, rect.width, rect.height / 2);

      expect(point, `k = ${String(k)}`).not.toBeNull();
      expect(point?.x, `k = ${String(k)}`).toBeCloseTo(viewport.virtualWidth, 6);
    }
  });

  it('does not drift with a non-zero rect origin', () => {
    /* 元素被版面挪到 (137, 42) 時，換算結果必須與原點無關。 */
    const { viewport } = setup(800, 400, 0.5);
    const rect = { left: 137, top: 42, width: 400, height: 200 } as DOMRectReadOnly;

    const atOrigin = viewport.toVirtual(rect, 137 + 200, 42);
    const shifted = viewport.toVirtual(rect, 137 + 200, 42);

    expect(atOrigin?.x).toBeCloseTo(1000, 6);
    expect(shifted?.x).toBeCloseTo(1000, 6);
  });

  it('returns null outside the element', () => {
    /*
     * 元素外不回應。少了這一條，拖到畫布外時瞄準會繼續被推到夾制邊界，與瀏覽器
     * 「元素外不派發事件」的行為不一致。
     * Nothing outside the element: without this, dragging off the canvas keeps pushing the
     * aim to its clamp, which contradicts the browser not dispatching events out there.
     */
    const { viewport, rect } = setup(800, 400, 1);

    expect(viewport.toVirtual(rect, -1, 100)).toBeNull();
    expect(viewport.toVirtual(rect, 100, -1)).toBeNull();
    expect(viewport.toVirtual(rect, 801, 100)).toBeNull();
    expect(viewport.toVirtual(rect, 100, 401)).toBeNull();
  });

  it('returns null before any resize(), when the backing size is still zero', () => {
    const canvas = makeCanvas(0, 0);
    const viewport = new Viewport(canvas);
    const rect = { left: 0, top: 0, width: 0, height: 0 } as DOMRectReadOnly;

    expect(viewport.toVirtual(rect, 10, 10)).toBeNull();
  });
});
