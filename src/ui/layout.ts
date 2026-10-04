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
import type { Rect } from '../core/types';
import { applyDesignTokens } from './designTokens';
import { appendChildren, el } from './dom';
import { createIcon, type IconName } from './icons';

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
}

/** 工具列每個圖示的語意（design.md D23）。 */
const TOOLBAR_ITEMS: readonly { icon: IconName; label: string; action: string; disabled?: boolean }[] = [
  { icon: 'home', label: '主頁面', action: 'home' },
  { icon: 'trophy', label: '排行榜', action: 'leaderboard' },
  { icon: 'workshop', label: '創意工坊（即將推出）', action: 'workshop', disabled: true },
  { icon: 'help', label: '遊戲說明', action: 'help' },
  { icon: 'settings', label: '設定', action: 'settings' },
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

/** 工具列：五圖示共用一個膠囊群組（design.md D23）。 */
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
    button.append(createIcon(item.icon));
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
  music.append(createIcon('music'));
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

function buildComboCard(): HTMLElement {
  const card = el('section', 'panel card card--combo');
  card.dataset['region'] = 'combo';
  const count = el('p', 'card__value', '0');
  count.dataset['hook'] = 'combo-count';
  const multiplier = el('p', 'card__multiplier', '×1.0');
  multiplier.dataset['hook'] = 'combo-multiplier';
  appendChildren(card, el('h2', 'card__label', 'COMBO'), count, multiplier);
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

  return {
    root,
    stage,
    regions: { score, toolbar, next, combo, skill, container, melting },
    chrome: { music },
    notice,
  };
}
