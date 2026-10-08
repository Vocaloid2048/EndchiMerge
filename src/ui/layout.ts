/**
 * 主畫面版面。
 * The main-screen layout.
 *
 * 這一版把版面從「跟著視窗跑的彈性排版」改成**固定設計畫布上的絕對定位**，座標全部
 * 取自 `core/design.ts`（＝ Figma frame `Group 445`）。整個畫布再由 `ui/scale.ts` 等比
 * 縮放，所以瀏覽器縮放不會改變任何兩件東西之間的相對大小。
 * This replaces a fluid, viewport-following layout with **absolute positioning on a fixed
 * design canvas** whose coordinates come from `core/design.ts` (the Figma frame
 * `Group 445`). `ui/scale.ts` then scales the canvas uniformly, so browser zoom cannot
 * change the size of anything relative to anything else.
 *
 * 分工 / Division of labour:
 *
 * - **位置與尺寸**由這裡用 inline style 寫入，值來自 `LAYOUT_RECTS`。
 *   Position and size are written here as inline styles from `LAYOUT_RECTS`.
 * - **外觀**（玻璃、顏色、字級、圓角）在 `styles/`。
 *   Appearance lives in `styles/`.
 * - **面板內部的格距**（技能格、名冊格、技力條）由 `ui/designTokens.ts` 寫成 CSS 變數，
 *   CSS 只讀 `var(--…)`，兩邊不會各抄一份數字。
 *   Intra-panel pitches are written as CSS variables by `ui/designTokens.ts` so no number
 *   is duplicated between TypeScript and CSS.
 *
 * 建構子回傳各區域節點，後續模組以 `data-hook` 取用內部槽位，不必回頭改這支檔案。
 * The returned region nodes let later modules mount into `data-hook` slots without
 * editing this file.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH, LAYOUT_RECTS } from '../core/design';
import { VIRTUAL_HEIGHT } from '../core/constants';
import type { Rect } from '../core/types';
import { applyDesignTokens } from './designTokens';
import { appendChildren, el } from './dom';
import { createAssetIcon, type AssetIconName } from './icons';

/** 七個區域的識別名，對應 design.md §2.2 的編號 1–7。 */
export const REGION_NAMES = ['score', 'toolbar', 'next', 'combo', 'skill', 'container', 'melting'] as const;
export type RegionName = (typeof REGION_NAMES)[number];

export interface Layout {
  /** 設計畫布的內層版面根節點。 */
  root: HTMLElement;
  /** 固定 1920×1080、被整體縮放的畫布節點。 */
  stage: HTMLElement;
  /** 七個區域節點，供後續模組掛載內容。 */
  regions: Record<RegionName, HTMLElement>;
  /** 不屬七區域的常駐介面。 */
  chrome: {
    /** 音樂開關，獨立於工具列膠囊之外（design.md D23）。 */
    music: HTMLButtonElement;
  };
  /** 非官方聲明的宿主；內容由配置載入後填入。 */
  notice: HTMLElement;
  /**
   * 依容器的左右展示餘裕重新擺放舞台（`container.json` 的 `leftOffset` / `rightOffset`，
   * 虛擬單位）。版面比配置更早建立，所以這一手要在 `loadConfig()` 之後補上。
   * Re-place the stage from the container's left/right display margins (`leftOffset` /
   * `rightOffset` in `container.json`, virtual units). The layout is built before the config
   * loads, so this has to be applied afterwards.
   */
  setContainerMargin(leftOffset: number, rightOffset: number): void;
}

/**
 * 工具列每個圖示的語意（design.md D23 + 重新開始）。
 * Toolbar semantics per design.md D23, plus restart.
 *
 * **「主頁面」已移除**（使用者定案）：排行榜、說明與設定都是模態，遊戲本體永遠在下面，
 * 一顆切回本體的按鈕無事可做 —— 所以 `ic_game` 不再出現在工具列，膠囊也就回到設計稿的
 * 五顆鈕（見 `core/design.ts` 的 `toolGroup`）。
 * **The "home" button was removed** (the user's decision): the leaderboard, help and settings are
 * all modals and the game itself never goes away, so a button that switches back to it has
 * nothing to do. `ic_game` therefore left the toolbar and the capsule returned to the mock's five
 * buttons (see `toolGroup` in `core/design.ts`).
 *
 * 重新開始的**行為**（彈出確認對話框）不在這裡 —— 這裡只負責把按鈕放上工具列，`main.ts`
 * 會用 `ui/restartButton.ts` 把確認流程接上。
 * Restart's *behaviour* (the confirmation dialog) does not live here — this only places the
 * button; `main.ts` wires the confirm flow via `ui/restartButton.ts`.
 */
const TOOLBAR_ITEMS: readonly { icon: AssetIconName; label: string; action: string; disabled?: boolean }[] = [
  { icon: 'trophy', label: '排行榜', action: 'leaderboard' },
  { icon: 'workshop', label: '創意工坊（即將推出）', action: 'workshop', disabled: true },
  { icon: 'help', label: '遊戲說明', action: 'help' },
  { icon: 'settings', label: '設定', action: 'settings' },
  { icon: 'restart', label: '重新開始', action: 'restart' },
];

/**
 * 把節點放到設計稿座標上。
 * Place a node at a design-space rectangle.
 *
 * 用 inline style 而非 CSS class：座標只有一份（`core/design.ts`），產生 CSS class 反而
 * 需要在 CSS 裡再寫一次數字。
 * Inline styles rather than generated classes: the coordinates exist once, in
 * `core/design.ts`, and a class would mean writing them a second time in CSS.
 */
function place(node: HTMLElement, rect: Rect): void {
  node.style.left = `${String(rect.x)}px`;
  node.style.top = `${String(rect.y)}px`;
  node.style.width = `${String(rect.width)}px`;
  node.style.height = `${String(rect.height)}px`;
}

function buildScoreCard(): HTMLElement {
  const card = el('section', 'panel card card--score');
  card.dataset['region'] = 'score';

  const value = el('p', 'card__value', '0');
  value.dataset['hook'] = 'score-value';

  const stats = el('dl', 'card__stats');
  for (const [label, hookName] of [
    ['BEST TRY', 'best-try'],
    ['MERGED', 'merged'],
  ] as const) {
    const row = el('div', 'card__stat');
    const term = el('dt', 'card__stat-label', `${label}:`);
    const definition = el('dd', 'card__stat-value', '0');
    definition.dataset['hook'] = hookName;
    appendChildren(row, term, definition);
    stats.append(row);
  }

  appendChildren(card, el('h2', 'card__label', 'SCORE'), value, el('hr', 'card__rule'), stats);
  return card;
}

/** 工具列：五圖示共用一個膠囊群組（design.md D23 + 重新開始鍵）。 */
function buildToolbar(): HTMLElement {
  const nav = el('nav', 'panel panel--pill toolbar');
  nav.dataset['region'] = 'toolbar';
  nav.setAttribute('aria-label', '工具列');

  for (const item of TOOLBAR_ITEMS) {
    const button = el('button', 'toolbar__button');
    button.type = 'button';
    button.dataset['action'] = item.action;
    button.title = item.label;
    button.setAttribute('aria-label', item.label);
    if (item.disabled === true) button.disabled = true;
    button.append(createAssetIcon(item.icon));
    nav.append(button);
  }

  return nav;
}

/** 音樂開關：獨立，不與工具列共用選中態（design.md D23）。 */
function buildMusicButton(): HTMLButtonElement {
  const music = el('button', 'panel panel--pill music');
  music.type = 'button';
  music.dataset['action'] = 'music';
  music.title = '音樂開關';
  music.setAttribute('aria-label', '音樂開關');
  music.setAttribute('aria-pressed', 'false');
  music.append(createAssetIcon('music'));
  return music;
}

function buildNextCard(): HTMLElement {
  const card = el('section', 'panel card card--next');
  card.dataset['region'] = 'next';
  const preview = el('div', 'card__preview');
  preview.dataset['hook'] = 'next-preview';
  appendChildren(card, el('h2', 'card__label', 'NEXT'), preview);
  return card;
}

/**
 * COMBO 卡。
 * The COMBO card.
 *
 * 兩個數字，回答兩個不同的問題（使用者定案）：
 * - 大數字：**本次投放合成了幾次**（`combo-count`）。
 * - 下面一行：**本次投放合共賺了多少分**，加上最後一次合成所用的倍率
 *   （`combo-detail`，`+ 18 (×1.74)`）。
 *
 * 兩者都隨投放歸零，所以「本次投放」的界線與連擊一致，不會出現次數還在跳、
 * 得分卻已經換了一批的錯覺。
 *
 * Two numbers answering two different questions (the user's decision):
 * - the big one: **how many merges this drop produced** (`combo-count`);
 * - the line below: **what this drop earned in total** with the multiplier its last merge
 *   used (`combo-detail`, `+ 18 (×1.74)`).
 *
 * Both reset on a drop, so "this drop" spans the same window as the chain and the total can
 * never belong to a different drop than the count.
 */
function buildComboCard(): HTMLElement {
  const card = el('section', 'panel card card--combo');
  card.dataset['region'] = 'combo';
  const count = el('p', 'card__value', '0');
  count.dataset['hook'] = 'combo-count';
  const detail = el('p', 'card__detail', '+ 0 (×1.0)');
  detail.dataset['hook'] = 'combo-detail';
  appendChildren(card, el('h2', 'card__label', 'COMBO'), count, detail);
  return card;
}

function buildSkillList(): HTMLElement {
  const panel = el('aside', 'panel panel--skill');
  panel.dataset['region'] = 'skill';

  /*
   * 技力條的**段數**由 `sp.max` 決定（設計稿是一點一條），所以配置載入前不建任何
   * 段數；載入後由 `ui/hud.ts` 的 `renderSpMeter()` 填。這裡只提供容器與 hook。
   * The segment count follows `sp.max` (one pill per point), so nothing is built before
   * the config loads; `renderSpMeter()` in `ui/hud.ts` fills it afterwards.
   */
  const meter = el('div', 'sp-meter');
  meter.dataset['hook'] = 'sp-meter';
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', '技力');

  const grid = el('div', 'skill-grid');
  grid.dataset['hook'] = 'skill-grid';

  appendChildren(panel, el('h2', 'panel__title', 'Skill List'), meter, grid);
  return panel;
}

function buildStage(): HTMLElement {
  const stage = el('main', 'stage');
  stage.dataset['region'] = 'container';

  const canvas = el('canvas', 'stage__canvas');
  canvas.dataset['hook'] = 'stage-canvas';
  /*
   * 畫布是自繪的互動介面，不是圖片：`role="img"` 會讓鍵盤使用者永遠進不去。
   * 改為 `application` 並讓它可以聚焦，鍵盤的瞄準與投放才有宿主。
   * The canvas is a self-drawn interactive surface, not an image: `role="img"` would
   * leave keyboard users locked out. `application` plus a tab stop gives the keyboard
   * controls a home.
   */
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('tabindex', '0');
  canvas.setAttribute(
    'aria-label',
    '遊戲容器：方向鍵瞄準、空白鍵投放，或用滑鼠點擊投放。方團團在此落下與合成。',
  );

  stage.append(canvas);
  return stage;
}

function buildMeltingList(): HTMLElement {
  const panel = el('aside', 'panel panel--melting');
  panel.dataset['region'] = 'melting';
  const body = el('div', 'melting__body');
  body.dataset['hook'] = 'melting-body';
  appendChildren(panel, el('h2', 'panel__title', 'MELTING LIST'), body);
  return panel;
}

/**
 * 建立版面並掛載到宿主節點。
 * Build the layout and mount it into the host element.
 *
 * @param host 版面宿主，通常是 `#app` / Layout host, normally `#app`.
 */
export function createLayout(host: HTMLElement): Layout {
  /* 畫布：固定 1920×1080，倍率由 `ui/scale.ts` 設定。 */
  const stage = el('div', 'stage-scale');
  applyDesignTokens(stage);
  stage.style.width = `${String(DESIGN_WIDTH)}px`;
  stage.style.height = `${String(DESIGN_HEIGHT)}px`;

  const root = el('div', 'layout');

  const score = buildScoreCard();
  const toolbar = buildToolbar();
  const music = buildMusicButton();
  const next = buildNextCard();
  const combo = buildComboCard();
  const skill = buildSkillList();
  const container = buildStage();
  const melting = buildMeltingList();

  place(score, LAYOUT_RECTS.score);
  place(toolbar, LAYOUT_RECTS.toolGroup);
  place(music, LAYOUT_RECTS.music);
  place(next, LAYOUT_RECTS.next);
  place(combo, LAYOUT_RECTS.combo);
  place(skill, LAYOUT_RECTS.skill);
  place(container, LAYOUT_RECTS.container);
  place(melting, LAYOUT_RECTS.melting);

  /*
   * 設計稿把返回鍵放在 (64,64)，與 SCORE 面板完全重疊而在設計稿中根本看不到；
   * 依裁定「照設計稿」不渲染它。座標仍留在 `LAYOUT_RECTS.back` 作紀錄。
   * The mock puts the back button at (64,64), fully under the SCORE panel so the mock
   * never renders it; per the decision it is not drawn, and its rect stays in
   * `LAYOUT_RECTS.back` as a record.
   */

  /* 非官方聲明：放在安全區之下的下緣留白，不佔任何 UI 空間。 */
  const notice = el('footer', 'layout__notice');
  notice.dataset['hook'] = 'notice';

  appendChildren(root, score, toolbar, music, next, combo, skill, container, melting, notice);
  stage.append(root);
  host.append(stage);

  /*
   * 容器的左右展示餘裕：畫布（`.stage`）必須比容器區域左右各寬一段，容器才搖得動而不被畫布
   * 切掉。設計稿像素 / 虛擬單位這把尺由「容器區域高度 ↔ `VIRTUAL_HEIGHT`」決定，與寬度無關
   * （`render/viewport.ts` 的 `scale = cssHeight / VIRTUAL_HEIGHT`），所以不會遞迴。
   * The container's left/right display margins: the canvas (`.stage`) must be wider than the
   * container region by one margin on each side, or the box would be sliced by the canvas the
   * moment it shakes. The design-px-per-virtual-unit ruler comes from the region height
   * against `VIRTUAL_HEIGHT` and is independent of the width (`scale = cssHeight /
   * VIRTUAL_HEIGHT` in `render/viewport.ts`), so this is not circular.
   */
  const setContainerMargin = (leftOffset: number, rightOffset: number): void => {
    const rect = LAYOUT_RECTS.container;
    const designPerUnit = rect.height / VIRTUAL_HEIGHT;
    const left = Math.max(0, leftOffset) * designPerUnit;
    const right = Math.max(0, rightOffset) * designPerUnit;

    /*
     * 舞台以容器為中心向左右長出去，所以容器在設計稿上的座標一個都沒動，只有畫布變寬。
     * 畫布的虛擬寬度因此增加 `left + right` 個虛擬單位，而 `render/container.ts` 又把外框
     * 左右各內縮同樣的距離 —— 兩者相抵，**容器的尺寸與可玩寬度都不變**。
     * The stage grows symmetrically outward, so the box keeps the mock's coordinates exactly
     * and only the canvas gets wider. That adds `left + right` virtual units to the canvas'
     * virtual width, and `render/container.ts` insets the frame by the same amount — the two
     * cancel, so **neither the container's size nor the play width changes**.
     */
    place(container, {
      x: rect.x - left,
      y: rect.y,
      width: rect.width + left + right,
      height: rect.height,
    });
  };

  return {
    root,
    stage,
    regions: { score, toolbar, next, combo, skill, container, melting },
    chrome: { music },
    notice,
    setContainerMargin,
  };
}
