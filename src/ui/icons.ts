/**
 * 工具列與面板用的線性圖示。
 * Line icons for the toolbar and panels.
 *
 * 全部是手寫的 24×24 線稿，刻意不使用圖示套件：本專案目前零 UI 依賴，而工具列
 * 只有六個圖示，為此拉進一整套 icon library 並不划算。
 * All are hand-written 24×24 stroke icons. No icon package is pulled in: the
 * project currently has zero UI dependencies and six icons do not justify one.
 *
 * 語意對應 design.md D23 / §2.2：手把＝主頁面、獎盃＝排行榜、鎬＝創意工坊
 * （尚未實作）、問號＝說明、齒輪＝設定、音符＝音樂開關（獨立、不進頁面）。
 * Semantics follow design.md D23: gamepad = home, trophy = leaderboard,
 * pickaxe = workshop (not implemented yet), question = help, gear = settings,
 * note = music toggle (standalone, does not navigate).
 */

export const ICON_NAMES = [
  'home',
  'trophy',
  'workshop',
  'help',
  'settings',
  'music',
  /* 技能圖示（M5）——語意對應 `skills.json → id`。 */
  'discard',
  'float',
  'shake',
  'fateSwap',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/**
 * 每個圖示的內部標記。只作為 `innerHTML` 寫入固定的本機常數，不含任何外部輸入。
 * Inner markup per icon. Written via `innerHTML` from a local constant only;
 * no external input ever reaches it.
 */
const ICON_PATHS: Record<IconName, string> = {
  home: '<rect x="3" y="8" width="18" height="9" rx="4.5"/><circle cx="8" cy="12.5" r="1"/><circle cx="16" cy="12.5" r="1"/>',
  trophy:
    '<path d="M8 4h8v4.5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.5v1.5a3 3 0 0 0 3 3"/><path d="M16 5.5h2.5v1.5a3 3 0 0 1-3 3"/><path d="M12 12.5V16"/><path d="M8.5 20h7l-.8-4h-5.4z"/>',
  workshop: '<path d="M4 15L15 4l5 5-11 11z"/><path d="M4 15l5 5"/><path d="M13 6l5 5"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.8a2.5 2.5 0 1 1 3.3 2.4c-.8.3-1.3.9-1.3 1.7v.4"/><circle cx="12" cy="17.2" r="0.9"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>',
  music: '<circle cx="7" cy="17.5" r="2.5"/><circle cx="18" cy="15.5" r="2.5"/><path d="M9.5 17.5V6l11-2.2v11.7"/>',
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

/** 建立一個 `<svg>` 圖示節點。 */
export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}
