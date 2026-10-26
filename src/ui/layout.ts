/**
 * 主畫面版面：固定設計畫布上的絕對定位，座標全部取自 `core/design.ts`，整張畫布由 `ui/scale.ts` 等比縮放。
 * The main-screen layout: absolute positioning on a fixed design canvas, coordinates from `core/design.ts`, scaled uniformly by `ui/scale.ts`.
 *
 * 位置與尺寸由這裡以 inline style 寫入；外觀在 `styles/`；面板內部格距由 `ui/designTokens.ts` 寫成 CSS 變數。
 * Position and size are inline styles here; appearance lives in `styles/`; intra-panel pitches become CSS variables via `ui/designTokens.ts`.
 */

import { DESIGN_HEIGHT, DESIGN_WIDTH, LAYOUT_RECTS } from '../core/design';
import { VIRTUAL_HEIGHT } from '../core/constants';
import type { Rect } from '../core/types';
import { i18nAriaLabel, i18nText, i18nTitle, type MessageKey } from '../i18n';
import { applyDesignTokens } from './designTokens';
import { appendChildren, el } from './dom';
import { createAssetIcon, createIcon, type AssetIconName } from './icons';

/**
 * 七個區域的識別名，對應 design.md §2.2 的編號 1–7。
 * The seven regions' names, matching the mock's numbering 1–7.
 */
export const REGION_NAMES = ['score', 'toolbar', 'next', 'combo', 'skill', 'container', 'melting'] as const;
export type RegionName = (typeof REGION_NAMES)[number];

export interface Layout {
  /**
   * 設計畫布的內層版面根節點。
   * The layout root inside the design canvas.
   */
  root: HTMLElement;
  /**
   * 固定 1920×1080、被整體縮放的畫布節點。
   * The fixed 1920×1080 canvas node that gets scaled as a whole.
   */
  stage: HTMLElement;
  /**
   * 七個區域節點，供後續模組掛載內容。
   * The seven region nodes for later modules to mount into.
   */
  regions: Record<RegionName, HTMLElement>;
  /**
   * 不屬七區域的常駐介面。
   * Persistent chrome outside the seven regions.
   */
  chrome: {
    /**
     * 音樂開關，獨立於工具列膠囊之外。
     * The music toggle, separate from the toolbar capsule.
     */
    music: HTMLButtonElement;
    /**
     * 返回選單；設計稿的 `return_btn` 本來被 SCORE 面板蓋住，這裡畫在面板之上。
     * Back to the menu; the mock's `return_btn` sits under the SCORE panel and is drawn above it here.
     */
    back: HTMLButtonElement;
  };
  /**
   * 非官方聲明的宿主；內容由配置載入後填入。
   * Hosts the unofficial notice; filled in once the config loads.
   */
  notice: HTMLElement;
  /**
   * 依容器的左右展示餘裕重新擺放舞台（`container.json` 的 `leftOffset`／`rightOffset`）；
   * 版面比配置更早建立，所以這一手要在 `loadConfig()` 之後補上。
   * Re-places the stage from the container's left/right display margins (`leftOffset`/`rightOffset` in `container.json`); the layout is built before the config loads, so this runs afterwards.
   */
  setContainerMargin(leftOffset: number, rightOffset: number): void;
}

/**
 * 工具列每個圖示的語意：排行榜、工作坊（停用）、說明、設定、重新開始。
 * Toolbar semantics: leaderboard, workshop (disabled), help, settings, restart.
 *
 * 標籤是 i18n 鍵而非字串：`title` 與 `aria-label` 由 `data-i18n-*` 標記，語系一換一次改掉。
 * Labels are i18n keys, not strings: `title` and `aria-label` are tagged with `data-i18n-*` and rewritten in one pass on a locale change.
 */
const TOOLBAR_ITEMS: readonly {
  icon: AssetIconName;
  labelKey: MessageKey;
  action: string;
  disabled?: boolean;
}[] = [
  { icon: 'trophy', labelKey: 'toolbar.leaderboard', action: 'leaderboard' },
  { icon: 'workshop', labelKey: 'toolbar.workshop', action: 'workshop', disabled: true },
  { icon: 'help', labelKey: 'toolbar.help', action: 'help' },
  { icon: 'settings', labelKey: 'toolbar.settings', action: 'settings' },
  { icon: 'restart', labelKey: 'toolbar.restart', action: 'restart' },
];

/**
 * 把節點放到設計稿座標上；用 inline style 而非 CSS class（座標只有一份，產生 class 會要在 CSS 再寫一次）。
 * Places a node at a design-space rectangle with inline styles rather than a class — the coordinates exist once, and a class would duplicate them in CSS.
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

  /*
   * 分數那一行只裝分數（時長只在排行榜顯示），結構與 COMBO 卡一致。
   * The score line holds only the score (the duration shows on the leaderboard alone), matching the COMBO card's structure.
   */
  const value = el('p', 'card__value', '0');
  value.dataset['hook'] = 'score-value';

  const stats = el('dl', 'card__stats');
  for (const [labelKey, hookName] of [
    ['label.bestTry', 'best-try'],
    ['label.merged', 'merged'],
  ] as const) {
    const row = el('div', 'card__stat');
    const term = el('dt', 'card__stat-label');

    /*
     * 標籤與分隔號是兩個 `<span>`：`applyTo()` 對每個 `[data-i18n]` 直接覆寫 `textContent`，
     * 不帶標記的文字節點會在下次換語系被抹掉。
     * Label and separator are two `<span>`s: `applyTo()` overwrites `textContent` per `[data-i18n]` node, so an untagged text node would be wiped on the next locale change.
     */
    const name = el('span');
    i18nText(name, labelKey);
    const separator = el('span');
    i18nText(separator, 'label.statSuffix');
    appendChildren(term, name, separator);

    const definition = el('dd', 'card__stat-value', '0');
    definition.dataset['hook'] = hookName;
    appendChildren(row, term, definition);
    stats.append(row);
  }

  const label = el('h2', 'card__label');
  i18nText(label, 'label.score');

  appendChildren(card, label, value, el('hr', 'card__rule'), stats);
  return card;
}

/**
 * 工具列：五圖示共用一個膠囊群組。
 * The toolbar: five icons sharing one pill group.
 */
function buildToolbar(): HTMLElement {
  const nav = el('nav', 'panel panel--pill toolbar');
  nav.dataset['region'] = 'toolbar';
  i18nAriaLabel(nav, 'chrome.toolbar');

  for (const item of TOOLBAR_ITEMS) {
    const button = el('button', 'toolbar__button');
    button.type = 'button';
    button.dataset['action'] = item.action;
    i18nTitle(button, item.labelKey);
    i18nAriaLabel(button, item.labelKey);
    if (item.disabled === true) button.disabled = true;
    button.append(createAssetIcon(item.icon));
    nav.append(button);
  }

  return nav;
}

/**
 * 返回選單：設計稿的 `return_btn` 與 SCORE 面板完全重疊、被面板的 z-order 壓住，這裡把它畫在面板之上。
 * Back to the menu: the mock's `return_btn` overlaps the SCORE panel exactly and is buried by it;
 * here it is drawn above the panel instead.
 */
function buildBackButton(): HTMLButtonElement {
  const back = el('button', 'panel panel--pill back');
  back.type = 'button';
  back.dataset['action'] = 'back';
  i18nAriaLabel(back, 'chrome.back');
  back.append(createIcon('back'));

  return back;
}

/**
 * 音樂開關：獨立，不與工具列共用選中態。
 * The music toggle: standalone, not sharing the toolbar's pressed state.
 */
function buildMusicButton(): HTMLButtonElement {
  const music = el('button', 'panel panel--pill music');
  music.type = 'button';
  music.dataset['action'] = 'music';
  /*
   * `title` 不掛 `data-i18n-title`：它講「按下去會怎樣」（關閉／開啟音樂），由 `ui/music.ts`
   * 隨靜音狀態自己寫；掛了標記反而會在換語系時被 `applyTo()` 蓋回一句靜態的「音樂開關」。
   * The `title` is deliberately untagged: it says what a press will do (mute or play) and is
   * written by `ui/music.ts` alongside the muted state. Tagging it would let `applyTo()` reset it
   * to a static "Music" on every locale change.
   */
  i18nAriaLabel(music, 'chrome.music');
  music.setAttribute('aria-pressed', 'false');
  music.append(createAssetIcon('music'));
  return music;
}

function buildNextCard(): HTMLElement {
  const card = el('section', 'panel card card--next');
  card.dataset['region'] = 'next';
  const preview = el('div', 'card__preview');
  preview.dataset['hook'] = 'next-preview';

  const label = el('h2', 'card__label');
  i18nText(label, 'label.next');

  appendChildren(card, label, preview);
  return card;
}

/**
 * COMBO 卡：大數字是本次投放合成了幾次，下一行是本次投放合共賺的分與最後一次的倍率；
 * 兩者都隨投放歸零，界線與連擊一致。
 * The COMBO card: the big number is merges this drop produced, the line below is what the drop earned with its last multiplier; both reset on a drop, so the window matches the chain.
 */
function buildComboCard(): HTMLElement {
  const card = el('section', 'panel card card--combo');
  card.dataset['region'] = 'combo';
  const count = el('p', 'card__value', '0');
  count.dataset['hook'] = 'combo-count';
  const detail = el('p', 'card__detail', '+ 0 (×1.0)');
  detail.dataset['hook'] = 'combo-detail';

  const label = el('h2', 'card__label');
  i18nText(label, 'label.combo');

  appendChildren(card, label, count, detail);
  return card;
}

function buildSkillList(): HTMLElement {
  const panel = el('aside', 'panel panel--skill');
  panel.dataset['region'] = 'skill';

  /*
   * 技力條的段數由 `sp.max` 決定，配置載入前不建任何段數，載入後由 `renderSpMeter()` 填。
   * The meter's segment count follows `sp.max`; nothing is built before the config loads, and `renderSpMeter()` fills it afterwards.
   */
  const meter = el('div', 'sp-meter');
  meter.dataset['hook'] = 'sp-meter';
  meter.setAttribute('role', 'meter');
  i18nAriaLabel(meter, 'chrome.spMeter');

  const grid = el('div', 'skill-grid');
  grid.dataset['hook'] = 'skill-grid';

  /*
   * 技能說明（i）：貼在面板右上角，與標題同高。它只是個按鈕，彈窗由 `ui/skillGuide.ts` 負責。
   * The skill guide "(i)": pinned to the panel's top-right, level with the title. This is only the
   * button — the popup itself lives in `ui/skillGuide.ts`.
   */
  const guideButton = el('button', 'panel__info');
  guideButton.type = 'button';
  guideButton.dataset['action'] = 'skill-guide';
  guideButton.append(createIcon('info'));
  i18nAriaLabel(guideButton, 'skillGuide.open');

  const title = el('h2', 'panel__title');
  i18nText(title, 'label.skillList');

  appendChildren(panel, title, guideButton, meter, grid);
  return panel;
}

function buildStage(): HTMLElement {
  const stage = el('main', 'stage');
  stage.dataset['region'] = 'container';

  const canvas = el('canvas', 'stage__canvas');
  canvas.dataset['hook'] = 'stage-canvas';
  /*
   * 畫布是自繪的互動介面：`role="application"` ＋ 可聚焦，鍵盤的瞄準與投放才有宿主。
   * The canvas is a self-drawn interactive surface: `role="application"` plus a tab stop gives the keyboard controls a home.
   */
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('tabindex', '0');
  i18nAriaLabel(canvas, 'chrome.canvas');

  stage.append(canvas);
  return stage;
}

function buildMeltingList(): HTMLElement {
  const panel = el('aside', 'panel panel--melting');
  panel.dataset['region'] = 'melting';
  const body = el('div', 'melting__body');
  body.dataset['hook'] = 'melting-body';

  const title = el('h2', 'panel__title');
  i18nText(title, 'label.meltingList');

  /*
   * 標題下方那行提示：圖鑑展示的是**當前模式**的合成鏈，想換一套就到設定切換。
   * The line under the title: the roster shows the **current mode's** chain, and another one is a
   * settings trip away.
   */
  const hint = el('p', 'melting__hint');
  i18nText(hint, 'label.meltingHint');

  appendChildren(panel, title, hint, body);
  return panel;
}

/**
 * 建立版面並掛載到宿主節點；`host` 通常是 `#app`。
 * Builds the layout and mounts it into the host element; `host` is normally `#app`.
 */
export function createLayout(host: HTMLElement): Layout {
  /* 畫布：固定 1920×1080，倍率由 `ui/scale.ts` 設定。 */
  const stage = el('div', 'stage-scale');
  applyDesignTokens(stage);
  stage.style.width = `${String(DESIGN_WIDTH)}px`;
  stage.style.height = `${String(DESIGN_HEIGHT)}px`;

  const root = el('div', 'layout');

  const score = buildScoreCard();
  const back = buildBackButton();
  const toolbar = buildToolbar();
  const music = buildMusicButton();
  const next = buildNextCard();
  const combo = buildComboCard();
  const skill = buildSkillList();
  const container = buildStage();
  const melting = buildMeltingList();

  place(score, LAYOUT_RECTS.score);
  place(back, LAYOUT_RECTS.back);
  place(toolbar, LAYOUT_RECTS.toolGroup);
  place(music, LAYOUT_RECTS.music);
  place(next, LAYOUT_RECTS.next);
  place(combo, LAYOUT_RECTS.combo);
  place(skill, LAYOUT_RECTS.skill);
  place(container, LAYOUT_RECTS.container);
  place(melting, LAYOUT_RECTS.melting);

  /*
   * 返回鍵刻意排在 SCORE 之後：同一個堆疊層裡後者在上，它才不會被面板蓋回設計稿那個「看不見」的狀態。
   * The back button is appended after the SCORE card on purpose: within one stacking context the
   * later sibling paints on top, so it cannot fall back to the mock's invisible state.
   */

  /* 非官方聲明：放在安全區之下的下緣留白，不佔任何 UI 空間。 */
  const notice = el('footer', 'layout__notice');
  notice.dataset['hook'] = 'notice';

  appendChildren(root, score, back, toolbar, music, next, combo, skill, container, melting, notice);
  stage.append(root);
  host.append(stage);

  /*
   * 容器的左右展示餘裕：畫布比容器區域左右各寬一段，容器才搖得動而不被切掉。
   * 設計像素/虛擬單位這把尺由「區域高度 ↔ VIRTUAL_HEIGHT」決定，與寬度無關，所以不會遞迴。
   * The container's left/right display margins: the canvas is one margin wider on each side so the box can shake without being sliced. The design-px-per-virtual-unit ruler comes from the region height against `VIRTUAL_HEIGHT` and is width-independent, so this is not circular.
   */
  const setContainerMargin = (leftOffset: number, rightOffset: number): void => {
    const rect = LAYOUT_RECTS.container;
    const designPerUnit = rect.height / VIRTUAL_HEIGHT;
    const left = Math.max(0, leftOffset) * designPerUnit;
    const right = Math.max(0, rightOffset) * designPerUnit;

    /*
     * 舞台以容器為中心向左右長出去：畫布的虛擬寬度增加 `left + right`，
     * 而 `render/container.ts` 把外框內縮同樣的距離 —— 兩者相抵，容器尺寸與可玩寬度都不變。
     * The stage grows symmetrically outward: the canvas' virtual width gains `left + right`, and `render/container.ts` insets the frame by the same amount — the two cancel, so neither the container's size nor the play width changes.
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
    chrome: { music, back },
    notice,
    setContainerMargin,
  };
}
