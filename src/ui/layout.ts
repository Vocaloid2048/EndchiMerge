/**
 * 七區域版面骨架。
 * The seven-region layout skeleton.
 *
 * 依 design.md §2.2 建立七個區域，順序與位置對齊設計稿：
 * 左上 SCORE 卡；右上工具列（五圖示群組 + 獨立音符）與其下的 NEXT／COMBO 卡；
 * 主列由左至右為 SKILL LIST、中央容器、MELTING LIST。
 * Builds the seven regions from design.md §2.2 in the order the design shows:
 * SCORE top-left; a five-icon toolbar plus a standalone music toggle top-right
 * with NEXT/COMBO beneath; and a main row of SKILL LIST, the centre container and
 * MELTING LIST.
 *
 * 這一版**只建結構與佔位內容**：容器是空的 canvas、名冊是空的捲動區。M2 會把名冊
 * 填滿、M3 會接手容器、投放與 NEXT。建構子回傳各區域節點，後續模組以 `data-hook`
 * 取用內部槽位，不必回頭改這支檔案。
 * This version builds structure and placeholder content only. M2 fills the roster,
 * M3 takes over the container, dropping and NEXT. The returned region nodes let
 * later modules mount into `data-hook` slots without editing this file.
 */

import { appendChildren, el } from './dom';
import { createIcon, type IconName } from './icons';

/** 七個區域的識別名，對應 design.md §2.2 的編號 1–7。 */
export const REGION_NAMES = ['score', 'toolbar', 'next', 'combo', 'skill', 'container', 'melting'] as const;
export type RegionName = (typeof REGION_NAMES)[number];

export interface Layout {
  /** 版面根節點，掛在 `#app` 之下。 */
  root: HTMLElement;
  /** 七個區域節點，供後續模組掛載內容。 */
  regions: Record<RegionName, HTMLElement>;
  /** 非官方聲明的宿主；內容由 `ui/notice.ts` 在配置載入後填入。 */
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

function buildScoreCard(): HTMLElement {
  const card = el('section', 'panel card card--score');
  card.dataset['region'] = 'score';

  const value = el('p', 'card__value', '0');
  value.dataset['hook'] = 'score-value';
  appendChildren(card, el('h2', 'card__label', 'SCORE'), value, el('hr', 'card__rule'));

  const stats = el('dl', 'card__stats');
  for (const [label, hookName] of [
    ['BEST TRY', 'best-try'],
    ['MERGED', 'merged'],
  ] as const) {
    const row = el('div', 'card__stat');
    appendChildren(row, el('dt', 'card__stat-label', label));
    const value = el('dd', 'card__stat-value', '0');
    value.dataset['hook'] = hookName;
    row.append(value);
    stats.append(row);
  }
  card.append(stats);
  return card;
}

function buildToolbar(): HTMLElement {
  const nav = el('nav', 'toolbar');
  nav.dataset['region'] = 'toolbar';
  nav.setAttribute('aria-label', '工具列');

  const group = el('div', 'toolbar__group');
  for (const item of TOOLBAR_ITEMS) {
    const button = el('button', 'toolbar__button');
    button.type = 'button';
    button.dataset['action'] = item.action;
    button.title = item.label;
    button.setAttribute('aria-label', item.label);
    if (item.disabled === true) button.disabled = true;
    button.append(createIcon(item.icon));
    group.append(button);
  }

  /* 音符是獨立開關，不與上面五個共用選中態（design.md D23）。 */
  const music = el('button', 'toolbar__button toolbar__music');
  music.type = 'button';
  music.dataset['action'] = 'music';
  music.title = '音樂開關';
  music.setAttribute('aria-label', '音樂開關');
  music.setAttribute('aria-pressed', 'false');
  music.append(createIcon('music'));

  appendChildren(nav, group, music);
  return nav;
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

  /* 技力條：位於技能欄頂部（design.md §5.3），滿格對應 sp.max。 */
  const spBar = el('div', 'sp-bar');
  spBar.setAttribute('role', 'meter');
  spBar.setAttribute('aria-label', '技力');
  spBar.setAttribute('aria-valuemin', '0');
  spBar.setAttribute('aria-valuemax', '1');
  spBar.setAttribute('aria-valuenow', '0');
  const spFill = el('div', 'sp-bar__fill');
  spFill.dataset['hook'] = 'sp-fill';
  spBar.append(spFill);

  const grid = el('div', 'panel__scroll skill-grid');
  grid.dataset['hook'] = 'skill-grid';

  appendChildren(panel, el('h2', 'panel__title', 'SKILL LIST'), spBar, grid);
  return panel;
}

function buildStage(): HTMLElement {
  const stage = el('main', 'stage');
  stage.dataset['region'] = 'container';

  const canvas = el('canvas', 'stage__canvas');
  canvas.dataset['hook'] = 'stage-canvas';
  /* Canvas 對輔助技術沒有內容，補一段說明文字。 */
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '遊戲容器，方團團在此落下與合成。');

  stage.append(canvas);
  return stage;
}

function buildMeltingList(): HTMLElement {
  const panel = el('aside', 'panel panel--melting');
  panel.dataset['region'] = 'melting';
  const body = el('div', 'panel__scroll melting__body');
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
  const root = el('div', 'layout');

  const top = el('header', 'layout__top');
  const topRight = el('div', 'layout__top-right');
  const topCards = el('div', 'layout__top-cards');
  const score = buildScoreCard();
  const toolbar = buildToolbar();
  const next = buildNextCard();
  const combo = buildComboCard();

  appendChildren(topCards, next, combo);
  appendChildren(topRight, toolbar, topCards);
  appendChildren(top, score, topRight);

  const main = el('div', 'layout__main');
  const skill = buildSkillList();
  const container = buildStage();
  const melting = buildMeltingList();
  appendChildren(main, skill, container, melting);

  /* 非官方聲明常駐頁尾：內容稍後由配置填入，但宿主永遠存在。 */
  const notice = el('footer', 'layout__notice');
  notice.dataset['hook'] = 'notice';

  appendChildren(root, top, main, notice);
  host.append(root);

  return {
    root,
    regions: { score, toolbar, next, combo, skill, container, melting },
    notice,
  };
}
