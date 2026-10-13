/**
 * 設計數值的 CSS 變數橋：只放**兩邊都要讀**的數字（畫布尺寸、安全邊界、面板圓角、MELTING 格網）。
 * Bridges design numbers into CSS custom properties — only those **both sides** read.
 */

import {
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  MELTING,
  PANEL_RADIUS,
  SAFE_INSET,
} from '../core/design';

/**
 * 寫入畫布節點的自訂屬性：長度一律帶 `px`，純比例（欄列數）刻意不帶單位。
 * The custom properties written onto the canvas element: lengths carry `px`, ratios do not.
 */
export function designTokens(): Record<string, string> {
  return {
    /* 畫布 */
    /* Canvas */
    '--design-w': `${String(DESIGN_WIDTH)}px`,
    '--design-h': `${String(DESIGN_HEIGHT)}px`,
    '--safe-inset': `${String(SAFE_INSET)}px`,
    '--panel-radius': `${String(PANEL_RADIUS)}px`,

    /* MELTING LIST 格網 */
    /* MELTING LIST grid */
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

/**
 * 把設計數值寫到節點上（通常是畫布根）。
 * Writes the design tokens onto a node (usually the canvas root).
 */
export function applyDesignTokens(target: HTMLElement): void {
  for (const [name, value] of Object.entries(designTokens())) {
    target.style.setProperty(name, value);
  }
}
