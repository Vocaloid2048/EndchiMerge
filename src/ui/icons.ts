/**
 * 工具列、面板與技能欄的圖示。
 * Icons for the toolbar, panels and the skill bar.
 *
 * 圖示分兩個來源：
 * Icons come from two sources:
 *
 * 1. **素材圖示**（`public/assets/ui/ic_*.svg`）：工具列、音樂開關與重新開始鍵。
 *    這些是 Phosphor 風格的**實心** path（`fill="#000000"` 寫死在檔案裡），不能像線稿
 *    一樣用 `stroke: currentColor` 上色，所以 `createAssetIcon()` 改用 **CSS mask**：
 *    mask 只取形狀的 alpha，顏色永遠跟著元素的 `currentColor` 走 —— 直接用 `<img>`
 *    的話，黑色圖示在深色主題裡會整顆隱形。
 *    **Asset icons** (`public/assets/ui/ic_*.svg`) for the toolbar, the music toggle and
 *    restart. These are **filled** Phosphor-style paths with `fill="#000000"` baked in,
 *    so `createAssetIcon()` uses a **CSS mask** instead of a stroke: the mask carries only
 *    the shape's alpha and the color always follows `currentColor` — an `<img>` would be
 *    an invisible black glyph on the dark theme.
 *
 * 2. **手寫線稿**：技能欄的四個技能圖示（M5）與說明鍵的備援。這些沒有對應素材，
 *    維持 24×24 線稿 + `stroke: currentColor`（見 `styles/layout.css` 的 `.icon`）。
 *    **Hand-written stroke icons** for the four skills (M5) and the help fallback. These
 *    have no asset counterpart and stay 24×24 strokes with `stroke: currentColor`.
 */

/** 素材圖示的語意名（對應 `design.md D23` 的工具列語意 + 重新開始）。 */
export const ASSET_ICON_NAMES = [
  'home',
  'trophy',
  'workshop',
  'help',
  'settings',
  'music',
  'restart',
] as const;
export type AssetIconName = (typeof ASSET_ICON_NAMES)[number];

/** 素材圖示 → `public/assets/ui/` 下的檔名（不含副檔名）。 */
const ASSET_ICON_FILES: Record<AssetIconName, string> = {
  home: 'ic_game',
  trophy: 'ic_leaderboard',
  workshop: 'ic_creation',
  help: 'ic_question',
  settings: 'ic_setting',
  music: 'ic_music',
  restart: 'ic_restart',
};

/** 技能圖示（M5）——語意對應 `skills.json → id`。 */
export const ICON_NAMES = [
  'discard',
  'float',
  'shake',
  'fateSwap',
  /* 技能欄的備援字形：技能 id 對不上任何圖示時用說明鍵頂上。 */
  'help',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * 每個線稿圖示的內部標記。只作為 `innerHTML` 寫入固定的本機常數，不含任何外部輸入。
 * Inner markup per stroke icon. Written via `innerHTML` from a local constant only;
 * no external input ever reaches it.
 */
const ICON_PATHS: Record<IconName, string> = {
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.8a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.3.9-1.3 1.7v.4"/><circle cx="12" cy="17.2" r="0.9"/>',
  /* ── 技能（M5）。造型刻意彼此差很遠，小尺寸下也分得出是哪一個。 */
  /* 當棄即棄！：垃圾桶。 */
  discard:
    '<path d="M5 6.5h14"/><path d="M9.5 6.5V4.5h5v2"/><path d="M7.5 6.5l1 13h7l1-13"/>',
  /* 協議：浮動：向上的雙箭頭。 */
  float:
    '<path d="M12 20.5V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M6 14.5l6-3.5 6 3.5"/>',
  /* 搖晃！：左右晃動的弧線。 */
  shake:
    '<path d="M8.5 4.5c-2.4 2.2 2.4 5.5 0 7.7s2.4 5.5 0 7.7"/><path d="M15.5 4.5c2.4 2.2-2.4 5.5 0 7.7s-2.4 5.5 0 7.7"/>',
  /* 命運互換：上下互相對流的箭頭。 */
  fateSwap:
    '<path d="M6.5 8.5h11l-3-3"/><path d="M17.5 15.5h-11l3 3"/>',
};

/** 建立一個手寫線稿的 `<svg>` 圖示節點（技能欄用）。 */
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
 * 建立一個素材圖示節點（工具列／音樂／重新開始用）。
 * Build an asset-icon node (toolbar / music / restart).
 *
 * 回傳 `<span>` 而非 `<svg>`：形狀由 CSS mask 提供（見 `styles/layout.css` 的
 * `.icon--asset`），顏色由 `background-color: currentColor` 提供。路徑以 `BASE_URL`
 * 為底，部署在子路徑下也不會斷圖。
 * Returns a `<span>` rather than an `<svg>`: the shape comes from a CSS mask (see
 * `.icon--asset` in `styles/layout.css`) and the color from `background-color:
 * currentColor`. Paths are prefixed with `BASE_URL` so deploys under a sub-path stay intact.
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
