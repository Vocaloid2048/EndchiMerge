/**
 * 設計畫布縮放的單元測試：每個情境對應一種版面走樣方式。
 * Unit tests for the design-canvas scale factor; each case is a way the layout could drift.
 */

import { describe, expect, it } from 'vitest';
import { computeStageScale, stageTransform } from '../src/ui/scale';
import { DESIGN_HEIGHT, DESIGN_WIDTH, MELTING } from '../src/core/design';

describe('computeStageScale — 等比縮放 / uniform scaling', () => {
  it('is exactly 1 when the viewport matches the design canvas', () => {
    expect(computeStageScale(DESIGN_WIDTH, DESIGN_HEIGHT)).toBe(1);
  });

  it('letterboxes a wider viewport by binding on height', () => {
    expect(computeStageScale(2560, 1080)).toBeCloseTo(1, 9);
    expect(computeStageScale(3840, 1080)).toBeCloseTo(1, 9);
  });

  it('letterboxes a taller viewport by binding on width', () => {
    expect(computeStageScale(1440, 1080)).toBeCloseTo(1440 / DESIGN_WIDTH, 9);
    expect(computeStageScale(1440, 1920)).toBeCloseTo(1440 / DESIGN_WIDTH, 9);
  });

  it('never scales one axis more than the other', () => {
    /*
     * 倍率必須是單一值：per-axis 縮放會讓方團團變成橢圓、名冊格子不再是正方形。
     * The factor must be a single number: a per-axis scale would make dumplings elliptical.
     */
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
      [1440, 900],
      [2560, 1440],
      [800, 600],
    ] as const) {
      const scale = computeStageScale(w, h);
      expect(scale * DESIGN_WIDTH).toBeLessThanOrEqual(w + 1e-9);
      expect(scale * DESIGN_HEIGHT).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it('scales linearly with browser zoom so ratios never change', () => {
    /*
     * 瀏覽器縮放同時改變兩個軸（110% ⇒ 各軸少 9.09%），倍率必須跟著等比變化。
     * Browser zoom changes both axes at once (110% ⇒ 9.09% fewer CSS pixels on each), so the
     * factor must track proportionally.
     */
    const base = computeStageScale(DESIGN_WIDTH, DESIGN_HEIGHT);

    expect(base).toBe(1);
    expect(computeStageScale(DESIGN_WIDTH * 1.1, DESIGN_HEIGHT * 1.1) / base).toBeCloseTo(1.1, 9);
    expect(computeStageScale(DESIGN_WIDTH * 0.9, DESIGN_HEIGHT * 0.9) / base).toBeCloseTo(0.9, 9);
    expect(computeStageScale(1280 * 1.1, 720 * 1.1)).toBeCloseTo((1280 * 1.1) / DESIGN_WIDTH, 9);
  });

  it('keeps every pair of design measurements at the same ratio across zooms', () => {
    const zooms = [0.9, 1, 1.1, 1.25, 0.75];
    const containerWidth = 667;
    const dumplingDiameter = 27;

    const ratios = zooms.map((zoom) => {
      const scale = computeStageScale(DESIGN_WIDTH * zoom, DESIGN_HEIGHT * zoom);
      return (containerWidth * scale) / (dumplingDiameter * scale);
    });

    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(containerWidth / dumplingDiameter, 9);
    }
  });

  it('does not let a zoomed-out viewport fit extra roster cells', () => {
    const columnsThatFit = (zoom: number): number => {
      const scale = computeStageScale(DESIGN_WIDTH * zoom, DESIGN_HEIGHT * zoom);
      const rosterWidthCss = MELTING.content.width * scale;

      return Math.floor(rosterWidthCss / (MELTING.cellWidth * scale));
    };

    for (const zoom of [0.5, 0.75, 0.9, 1, 1.1, 1.25, 2]) {
      expect(columnsThatFit(zoom)).toBe(MELTING.cols);
    }
  });

  it('returns 0 for a degenerate viewport instead of a collapsing factor', () => {
    expect(computeStageScale(0, 1080)).toBe(0);
    expect(computeStageScale(1920, 0)).toBe(0);
    expect(computeStageScale(-100, 1080)).toBe(0);
    expect(computeStageScale(Number.NaN, 1080)).toBe(0);
  });

  it('honours an explicit design size', () => {
    expect(computeStageScale(1000, 500, 1000, 500)).toBe(1);
    expect(computeStageScale(2000, 4000, 1000, 500)).toBeCloseTo(2, 9);
  });
});

describe('stageTransform — 置中寫進 transform / centring baked into the transform', () => {
  it('centres with translate(-50%, -50%) and then scales', () => {
    expect(stageTransform(0.5)).toBe('translate(-50%, -50%) scale(0.5)');
    expect(stageTransform(2.25)).toBe('translate(-50%, -50%) scale(2.25)');
  });

  it('uses a percentage translate so the centre never depends on the viewport', () => {
    /*
     * 百分比 translate 以元素自身尺寸（永遠 1920×1080）計算，所以中點永遠被釘在父層中心。
     * A percentage translate resolves against the element's own size (always 1920×1080), so the
     * centre is pinned to the host's centre without knowing its size.
     */
    for (const scale of [0.25, 1, 2.5, 5]) {
      expect(stageTransform(scale)).toMatch(/^translate\(-50%, -50%\) scale\(/);
    }
  });
});
