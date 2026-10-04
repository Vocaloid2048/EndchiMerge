/**
 * 設計數值的 CSS 變數橋。
 * Bridges the design numbers into CSS custom properties.
 *
 * 只有**兩邊都要讀**的數字需要經過這裡：
 * Only numbers read by **both** sides pass through here:
 *
 * - 畫布尺寸、安全邊界、面板圓角：CSS 拿來算 `min-height`、內距與圓角。
 *   Canvas size, safe inset and panel radius: CSS needs them for sizing and corner radius.
 * - MELTING LIST 的格網：欄列數由 `ui/serpentine.ts` 的演算法決定，像素尺寸由 CSS 使用。
 *   The MELTING LIST grid: the column and row counts drive the layout algorithm while the
 *   pixel pitches are used by CSS.
 *
 * 其餘設計稿數字（字級、工具列按鈕、技能卡內部）只給 CSS 用，直接寫在 `styles/*.css`
 * 並在該處標明 Figma 節點，不做第二份副本 —— 沒有任何程式在讀它們。
 * The rest (type sizes, toolbar buttons, skill card internals) are CSS-only and live in
 * `styles/*.css` with their Figma node named; nothing in code reads them, so a second copy
 * would only be a second thing to drift.
 */

import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  MELTING,
  PANEL_RADIUS,
  SAFE_INSET,
} from '../core/design';

/**
 * 寫入畫布節點的自訂屬性。
 * The custom properties written onto the canvas element.
 *
 * 長度一律帶 `px`：設計稿空間就是像素，帶著單位可以避免 `calc()` 裡出現無單位數字的
 * 隱性乘法。純比例（欄列數）刻意不帶單位。
 * Lengths all carry `px` so `calc()` never multiplies a bare number by accident; pure
 * ratios (column and row counts) deliberately do not.
 */
export function designTokens(): Record<string, string> {
  return {
    /* 畫布 Canvas */
    '--design-w': `${String(DESIGN_WIDTH)}px`,
    '--design-h': `${String(DESIGN_HEIGHT)}px`,
    '--safe-inset': `${String(SAFE_INSET)}px`,
    '--panel-radius': `${String(PANEL_RADIUS)}px`,

    /* MELTING LIST 格網 */
    '--melting-content-x': `${String(MELTING.content.x)}px`,
    '--melting-content-y': `${String(MELTING.content.y)}px`,
    '--melting-content-w': `${String(MELTING.content.width)}px`,
    '--melting-content-h': `${String(MELTING.content.height)}px`,
    '--melting-cols': String(MELTING.cols),
    '--melting-rows': String(MELTING.rows),
    '--melting-cell-w': `${String(MELTING.cellWidth)}px`,
    '--melting-cell-h': `${String(MELTING.cellHeight)}px`,
    '--melting-art': `${String(MELTING.artSize)}px`,
    '--melting-lane': `${String(MELTING.laneWidth)}px`,
  };
}

/** 把設計數值寫到節點上（通常是畫布根）。 */
export function applyDesignTokens(target: HTMLElement): void {
  for (const [name, value] of Object.entries(designTokens())) {
    target.style.setProperty(name, value);
  }
}
