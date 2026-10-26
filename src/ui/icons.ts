/**
 * 工具列、面板與技能欄的圖示：素材圖示走 **CSS mask**（跟隨 `currentColor`），手寫線稿維持 `stroke: currentColor`。
 * Icons for the toolbar, panels and skill bar: asset icons use a **CSS mask** so they follow `currentColor`; hand-written ones stay strokes.
 */

/**
 * 素材圖示的語意名（工具列語意 ＋ 重新開始）。
 * Semantic names for the asset icons (toolbar meanings + restart).
 */
export const ASSET_ICON_NAMES = [
  'trophy',
  'workshop',
  'help',
  'settings',
  'music',
  'restart',
] as const;
export type AssetIconName = (typeof ASSET_ICON_NAMES)[number];

/**
 * 素材圖示 → `public/assets/ui/` 下的檔名（不含副檔名）。
 * Asset icon → file name under `public/assets/ui/` (without the extension).
 */
const ASSET_ICON_FILES: Record<AssetIconName, string> = {
  trophy: 'ic_leaderboard',
  workshop: 'ic_creation',
  help: 'ic_question',
  settings: 'ic_setting',
  music: 'ic_music',
  restart: 'ic_restart',
};

/**
 * 技能圖示 —— 語意對應 `skills.json → id`。
 * Skill icons — their meanings map to `skills.json → id`.
 */
export const ICON_NAMES = [
  'discard',
  'ascend',
  'float',
  'scramble',
  'comboGrace',
  'shake',
  'reshuffle',
  'fateSwap',
  'shrink',
  'squareCore',
  /**
   * 「技能說明」的 (i) 按鈕。
   * The (i) glyph on the skill-guide button.
   */
  'info',
  /**
   * 技能欄的備援字形：技能 id 對不上任何圖示時用說明鍵頂上。
   * The skill bar's fallback glyph: the help icon stands in when no id matches.
   */
  'help',
  /**
   * 「返回選單」的左向箭頭（常駐介面，不屬於技能欄或工具列）。
   * The back-to-menu chevron (chrome, not part of the skill bar or the toolbar).
   */
  'back',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * 每個線稿圖示的內部標記。只作為 `innerHTML` 寫入固定的本機常數，不含任何外部輸入。
 * Inner markup per stroke icon. Written via `innerHTML` from a local constant only; no input reaches it.
 */
const ICON_PATHS: Record<IconName, string> = {
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.8a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.3.9-1.3 1.7v.4"/><circle cx="12" cy="17.2" r="0.9"/>',
  /* 當棄即棄！：垃圾桶。 */
  /* Discard!: a trash can. */
  discard:
    '<path d="M5 6.5h14"/><path d="M9.5 6.5V4.5h5v2"/><path d="M7.5 6.5l1 13h7l1-13"/>',
  /* 協議：浮動：向上的雙箭頭。 */
  /* Protocol: Float: a pair of upward arrows. */
  float:
    '<path d="M12 20.5V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M6 14.5l6-3.5 6 3.5"/>',
  /* 搖晃！：左右晃動的弧線。 */
  /* Shake!: a left-right wobble. */
  shake:
    '<path d="M8.5 4.5c-2.4 2.2 2.4 5.5 0 7.7s2.4 5.5 0 7.7"/><path d="M15.5 4.5c2.4 2.2-2.4 5.5 0 7.7s-2.4 5.5 0 7.7"/>',
  /* 命運互換：上下互相對流的箭頭。 */
  /* Fate Swap: two arrows flowing in opposite directions. */
  fateSwap:
    '<path d="M6.5 8.5h11l-3-3"/><path d="M17.5 15.5h-11l3 3"/>',
  /* 一步登天：拾級而上的階梯箭頭。 */
  /* One Step Up: a staircase arrow. */
  ascend: '<path d="M4 18.5h5v-5h5v-5h6"/><path d="M17 5.5l3 3M20 8.5l-3 3"/>',
  /* 乾坤挪移：交錯的洗牌箭頭。 */
  /* Shifting Ground: crossing shuffle arrows. */
  scramble:
    '<path d="M4 7h4l8 10h4"/><path d="M4 17h4l8-10h4"/><path d="M17.5 4.5l2.5 2.5-2.5 2.5"/><path d="M17.5 14.5l2.5 2.5-2.5 2.5"/>',
  /* 連勢不墜：護盾。 */
  /* Chain Ward: a shield. */
  comboGrace: '<path d="M12 4l7 2.8v5.4c0 3.8-2.9 6.2-7 7.8-4.1-1.6-7-4-7-7.8V6.8z"/>',
  /* 天翻地覆：循環重來的箭頭。 */
  /* Clean Slate: a reset arrow. */
  reshuffle: '<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M19.5 4.5V9h-4.5"/>',
  /* 縮地成寸：向內收攏的四角。 */
  /* Fold Space: four corners pulled inward. */
  shrink:
    '<path d="M9.5 9.5L4 4"/><path d="M4 9V4h5"/><path d="M14.5 14.5L20 20"/><path d="M20 15v5h-5"/>',
  /* 以方代圓：圓中取方。 */
  /* Square Rule: a square inside a circle. */
  squareCore: '<circle cx="12" cy="12" r="8.5"/><rect x="8" y="8" width="8" height="8" rx="1.2"/>',
  /* 技能說明：圓圈裡的一個 i。 */
  /* Skill guide: an "i" inside a circle. */
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8v0.1"/>',
  /* 返回選單：單一左向箭頭。 */
  /* Back to menu: one left chevron. */
  back: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
};

/**
 * 建立一個手寫線稿的 `<svg>` 圖示節點（技能欄用）。
 * Builds a hand-written stroke `<svg>` icon node (for the skill bar).
 */
export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}

/**
 * 建立一個素材圖示節點（工具列／音樂／重新開始）：回傳 `<span>`，形狀由 CSS mask、顏色由 `currentColor`，路徑以 `BASE_URL` 為底。
 * Builds an asset-icon node (toolbar / music / restart): a `<span>` shaped by a CSS mask and coloured by `currentColor`, rooted at `BASE_URL`.
 */
export function createAssetIcon(name: AssetIconName): HTMLElement {
  const glyph = document.createElement('span');
  glyph.className = 'icon icon--asset';
  glyph.setAttribute('aria-hidden', 'true');
  const url = `${import.meta.env.BASE_URL}assets/ui/${ASSET_ICON_FILES[name]}.svg`;
  glyph.style.setProperty('mask-image', `url("${url}")`);
  glyph.style.setProperty('-webkit-mask-image', `url("${url}")`);
  return glyph;
}
