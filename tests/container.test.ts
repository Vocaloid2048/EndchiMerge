/**
 * 容器線框幾何的單元測試。
 * Unit tests for the container wireframe geometry.
 *
 * 這裡守住的是一個關鍵不變式：**前後兩面合起來剛好填滿畫布，不多不少**。
 * 若哪天有人調整 `computeContainerGeometry` 的內縮規則，畫布邊緣會被切掉或出現空隙，
 * 而那種瑕疵只有在實際跑起來時才看得到——所以用測試釘住。
 * The invariant under test is that the two faces together exactly fill the canvas,
 * no more and no less. Changing the inset rule would silently clip or leave a gap
 * at the canvas edge, an artefact only visible at runtime, so it is pinned here.
 */

import { describe, expect, it } from 'vitest';
import { computeContainerGeometry } from '../src/render/container';
import type { ContainerConfig, Rect } from '../src/core/types';

/** 與 configLoader 的 DEFAULT_CONTAINER 一致（後緣往右上）。 */
const CONFIG: ContainerConfig = {
  cornerRadius: 28,
  strokeWidth: 3,
  strokeColor: '#e8c07a',
  perspectiveDx: 26,
  perspectiveDy: -18,
  frontTint: 'rgba(255, 255, 255, 0.04)',
  backTint: 'rgba(255, 255, 255, 0.02)',
  aspectMin: 0.62,
  aspectMax: 1.45,
};

/** 取兩面聯集的包圍盒。 */
function bounds(front: Rect, back: Rect) {
  return {
    left: Math.min(front.x, back.x),
    top: Math.min(front.y, back.y),
    right: Math.max(front.x + front.width, back.x + back.width),
    bottom: Math.max(front.y + front.height, back.y + back.height),
  };
}

describe('computeContainerGeometry — 基本位移 / basic offsets', () => {
  it('anchors the front face to the top-left when the back is offset right and up', () => {
    const { front, back } = computeContainerGeometry(500, 1000, CONFIG);

    /* dx > 0 → 前表面貼左；dy < 0 → 前表面下移，讓後表面貼頂。 */
    expect(front.x).toBe(0);
    expect(front.y).toBe(18);
    expect(back.x).toBe(26);
    expect(back.y).toBe(0);
  });

  it('subtracts the perspective offset from the face size', () => {
    const { front, back } = computeContainerGeometry(500, 1000, CONFIG);

    expect(front.width).toBe(474);
    expect(front.height).toBe(982);
    /* 兩面大小相同。 / Both faces share one size. */
    expect(back.width).toBe(front.width);
    expect(back.height).toBe(front.height);
  });

  it('mirrors the anchoring when the offset points the other way', () => {
    const { front } = computeContainerGeometry(500, 1000, {
      ...CONFIG,
      perspectiveDx: -26,
      perspectiveDy: 18,
    });

    /* dx < 0 → 前表面右移；dy > 0 → 前表面貼頂。 */
    expect(front.x).toBe(26);
    expect(front.y).toBe(0);
  });
});

describe('computeContainerGeometry — 填滿畫布 / canvas coverage', () => {
  it('makes both faces exactly span the canvas', () => {
    const size = { width: 500, height: 1000 };
    const { front, back } = computeContainerGeometry(size.width, size.height, CONFIG);
    const box = bounds(front, back);

    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.right).toBe(size.width);
    expect(box.bottom).toBe(size.height);
  });

  it('still spans the canvas for the mirrored offset', () => {
    const { front, back } = computeContainerGeometry(400, 640, {
      ...CONFIG,
      perspectiveDx: -30,
      perspectiveDy: 22,
    });
    const box = bounds(front, back);

    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.right).toBe(400);
    expect(box.bottom).toBe(640);
  });

  it('degrades to a zero perspective when the offset is zero', () => {
    const { front, back } = computeContainerGeometry(320, 480, {
      ...CONFIG,
      perspectiveDx: 0,
      perspectiveDy: 0,
    });

    expect(front).toEqual(back);
    expect(front.width).toBe(320);
    expect(front.height).toBe(480);
  });
});

describe('computeContainerGeometry — 退化輸入 / degenerate input', () => {
  it('never shrinks a face below one unit', () => {
    /* 畫布比透視偏移還小 → 寬高被夾在 1，但**不保證**仍落在畫布內。
     * containment 由呼叫端的 aspect 鉗制負責，這裡只保證尺寸為正。 */
    const { front } = computeContainerGeometry(10, 10, CONFIG);

    expect(front.width).toBe(1);
    expect(front.height).toBe(1);
  });
});

describe('computeContainerGeometry — 樣式沿用 / style passthrough', () => {
  it('carries over the stroke and tint settings untouched', () => {
    const geometry = computeContainerGeometry(500, 1000, CONFIG);

    expect(geometry.strokeWidth).toBe(CONFIG.strokeWidth);
    expect(geometry.strokeColor).toBe(CONFIG.strokeColor);
    expect(geometry.frontTint).toBe(CONFIG.frontTint);
    expect(geometry.backTint).toBe(CONFIG.backTint);
    expect(geometry.front.cornerRadius).toBe(CONFIG.cornerRadius);
    expect(geometry.back.cornerRadius).toBe(CONFIG.cornerRadius);
  });
});
