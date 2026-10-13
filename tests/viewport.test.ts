/**
 * 虛擬座標換算的單元測試：外層 CSS 縮放必須被除回去，否則可投放範圍會縮水。
 * Unit tests for virtual-coordinate conversion: the outer CSS scale must be divided back out.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Viewport } from '../src/render/viewport';

/*
 * 測試環境是 node，沒有 `window`；補一個最小替身，讓 `Viewport.resize()` 問得到 `devicePixelRatio`。
 * The test environment is node and has no `window`; a minimal stand-in supplies `devicePixelRatio`.
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
    const point = viewport.toVirtual(rect, 400, 200);

    expect(point).not.toBeNull();
    expect(point?.x).toBeCloseTo(1000, 6);
    expect(point?.y).toBeCloseTo(500, 6);
  });

  it('maps the visible right edge to the same virtual X regardless of CSS zoom', () => {
    /*
     * 外層縮放改變「一個 CSS px 值多少虛擬單位」，但視覺最右緣永遠對應虛擬寬度。
     * The outer scale changes how many virtual units a CSS pixel is worth, but the visible right
     * edge always maps to the virtual width.
     */
    for (const k of [1, 0.9, 0.75, 0.5, 0.25]) {
      const { viewport, rect } = setup(800, 400, k);
      const point = viewport.toVirtual(rect, rect.width, rect.height / 2);

      expect(point, `k = ${String(k)}`).not.toBeNull();
      expect(point?.x, `k = ${String(k)}`).toBeCloseTo(viewport.virtualWidth, 6);
    }
  });

  it('does not drift with a non-zero rect origin', () => {
    const { viewport } = setup(800, 400, 0.5);
    const rect = { left: 137, top: 42, width: 400, height: 200 } as DOMRectReadOnly;

    const atOrigin = viewport.toVirtual(rect, 137 + 200, 42);
    const shifted = viewport.toVirtual(rect, 137 + 200, 42);

    expect(atOrigin?.x).toBeCloseTo(1000, 6);
    expect(shifted?.x).toBeCloseTo(1000, 6);
  });

  it('returns null outside the element', () => {
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
