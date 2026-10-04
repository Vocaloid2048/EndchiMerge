/**
 * 設計畫布縮放的單元測試。
 * Unit tests for the design-canvas scale factor.
 *
 * 這裡的每條斷言都對應一個「縮放後版面會走樣」的具體情境，而不是在測數學。
 * Every assertion here corresponds to a concrete way the layout could drift under zoom
 * rather than to arithmetic for its own sake.
 */

import { describe, expect, it } from 'vitest';
import { computeStageScale } from '../src/ui/scale';
import { DESIGN_HEIGHT, DESIGN_WIDTH, MELTING } from '../src/core/design';

describe('computeStageScale — 等比縮放 / uniform scaling', () => {
  it('is exactly 1 when the viewport matches the design canvas', () => {
    expect(computeStageScale(DESIGN_WIDTH, DESIGN_HEIGHT)).toBe(1);
  });

  it('letterboxes a wider viewport by binding on height', () => {
    /* 21:9 的超寬螢幕：高度先到頂，左右留黑邊。 */
    expect(computeStageScale(2560, 1080)).toBeCloseTo(1, 9);
    expect(computeStageScale(3840, 1080)).toBeCloseTo(1, 9);
  });

  it('letterboxes a taller viewport by binding on width', () => {
    /* 4:3 的舊螢幕：寬度先到頂，上下留黑邊。 */
    expect(computeStageScale(1440, 1080)).toBeCloseTo(1440 / DESIGN_WIDTH, 9);
    expect(computeStageScale(1440, 1920)).toBeCloseTo(1440 / DESIGN_WIDTH, 9);
  });

  it('never scales one axis more than the other', () => {
    /*
     * 這條是整件事的核心：倍率必須是單一值。若哪天有人改成 per-axis 縮放，方團團就會
     * 變成橢圓，名冊格子也不再是正方形 —— 這條會先壞。
     * The heart of the whole thing: the factor must be a single number. A per-axis scale
     * would make dumplings elliptical and roster cells non-square; this test breaks first.
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
     * 瀏覽器縮放**同時**改變視窗的寬與高（CSS 像素）：110% 縮放＝兩個軸都少 9.09%，
     * 90% 縮放＝兩個軸都多 11.1%。倍率必須跟著等比變化，任何兩個面板之間的尺寸比值
     * 才會完全不動 —— 這正是「不要在 110% / 90% 時改動整個 UI 比例」那條要求。
     * Browser zoom changes **both** viewport axes in CSS pixels: 110% means 9.09% fewer
     * CSS pixels on each axis, 90% means 11.1% more. The factor must track that
     * proportionally, which is exactly what keeps every two panels' size ratio fixed.
     */
    const base = computeStageScale(DESIGN_WIDTH, DESIGN_HEIGHT);

    expect(base).toBe(1);
    expect(computeStageScale(DESIGN_WIDTH * 1.1, DESIGN_HEIGHT * 1.1) / base).toBeCloseTo(1.1, 9);
    expect(computeStageScale(DESIGN_WIDTH * 0.9, DESIGN_HEIGHT * 0.9) / base).toBeCloseTo(0.9, 9);
    /* 1280×720 本身已經比設計畫布小，110% 只是把它放大到 1408×792。 */
    expect(computeStageScale(1280 * 1.1, 720 * 1.1)).toBeCloseTo((1280 * 1.1) / DESIGN_WIDTH, 9);
  });

  it('keeps every pair of design measurements at the same ratio across zooms', () => {
    /*
     * 直接測「比值不變」而不是測倍率本身：任兩個設計稿距離（例如容器寬 667 與方團團
     * 直徑）在 90% / 100% / 110% 下的比值都必須相同。
     * Asserting the invariant rather than the number: any two design distances (say the
     * container's 667 and a dumpling's diameter) must keep the same ratio at 90%, 100% and
     * 110% zoom.
     */
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
    /*
     * 縮小之後名冊格子仍是同一個**設計稿**尺寸，所以可容納的格子數不會增加 —— 否則玩家
     * 一縮小就能多塞幾隻方團團。這裡把格子尺寸換算成 CSS 像素再數一次，結果必須恆等於
     * 設計稿的欄數。
     * At a smaller scale the roster cells keep the same **design** size, so the number of
     * cells that fit cannot grow. Converting a cell to CSS pixels at each zoom and counting
     * must always give the design's column count.
     */
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
