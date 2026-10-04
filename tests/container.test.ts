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
import { computeContainerGeometry } from '../src/render/container';
import type { ContainerConfig } from '../src/core/types';

/** 與 configLoader 的 DEFAULT_CONTAINER 一致。 */
const CONFIG: ContainerConfig = {
  cornerRadius: 16,
  strokeWidth: 10,
  strokeColor: '#FFFFFF',
  fill: 'rgba(255, 255, 255, 0.20)',
  topOffset: 80,
  spawnGap: 8,
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
