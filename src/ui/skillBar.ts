/**
 * 技能欄：技力條下方的技能卡格網。
 * The skill bar: the grid of skill cards beneath the SP meter.
 *
 * 版面是「每行 3 格」（使用者定案），所以第 4 個技能自然落在第二行第一格。卡片內容：
 * **圖示 ＋ 名稱 ＋ 消耗徽章**；未解鎖時整張卡被一層灰色遮罩蓋住，遮罩下面顯示解鎖進度。
 * The grid is **three per row** (the user's decision), so the fourth skill lands on the second
 * row's first cell. A card carries an **icon, a name and a cost badge**; while locked the whole
 * card is covered by a grey mask that also shows unlock progress.
 *
 * **這裡不含任何規則**：可不可以按由 `GameSession` 決定（它才看得到技力與累計消耗），
 * 這個模組只把 `SkillCardState` 畫出來，並在使用者按下時回報 id。
 * **No rules live here**: whether a card is pressable is decided by `GameSession` (the only thing
 * that can see SP and cumulative spend). This module just renders `SkillCardState` and reports the
 * id when pressed.
 *
 * 每幀都會被呼叫，所以每個欄位都先比對上次的值，只有真的變了才動 DOM —— 每幀重建節點會讓
 * 面板不停重排。
 * It is called every frame, so each field compares against its previous value and only real
 * changes touch the DOM; rebuilding nodes every frame would keep reflowing the panel.
 */

import type { SkillCardState } from '../game/session';
import { el } from './dom';
import { createIcon, type IconName } from './icons';

/** 技能 id → 圖示。沒登記的技能用通用圖示，不會空白。 */
const SKILL_ICONS: Readonly<Record<string, IconName>> = {
  discard: 'discard',
  protocol_float: 'float',
  shake: 'shake',
  fate_swap: 'fateSwap',
};

/** 消耗徽章的顯示字元：① ② ③ … 超過 10 就用純數字。 */
const BADGE_GLYPHS = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export interface SkillBarOptions {
  /** 掛載宿主（`layout` 的 skill 區的 `skill-grid` 槽）。 */
  host: HTMLElement;
  /** 按下技能卡（或再按一次取消）時回報技能 id。 */
  onActivate: (id: string) => void;
}

export interface SkillBar {
  update(cards: readonly SkillCardState[]): void;
  destroy(): void;
}

/** 一張卡在 DOM 上需要的把手。 */
interface CardNodes {
  root: HTMLButtonElement;
  name: HTMLElement;
  badge: HTMLElement;
  progress: HTMLElement;
  /** 上次寫入的狀態簽名，用來判斷要不要動 DOM。 */
  signature: string;
}

export function createSkillBar(options: SkillBarOptions): SkillBar {
  const { host, onActivate } = options;
  const cards = new Map<string, CardNodes>();

  const handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button[data-skill-id]');
    if (!(button instanceof HTMLButtonElement)) return;

    const id = button.dataset['skillId'];
    if (id === undefined) return;

    onActivate(id);
  };

  host.addEventListener('click', handleClick);

  function ensureCard(state: SkillCardState): CardNodes {
    const existing = cards.get(state.id);
    if (existing !== undefined) return existing;

    const root = el('button', 'skill-card');
    root.type = 'button';
    root.dataset['skillId'] = state.id;

    const icon = createIcon(SKILL_ICONS[state.id] ?? 'help');
    const name = el('span', 'skill-card__name', state.name);
    const badge = el('span', 'skill-card__badge');
    /*
     * 遮罩是**獨立一層**，覆蓋整張卡（使用者定案「整張卡覆蓋」），而不是把卡本身調暗 ——
     * 這樣解鎖的那一刻只要移除一層，圖示與名稱的對比度完全不受影響。
     * The mask is a **separate layer** covering the whole card (the user's decision), rather than
     * dimming the card itself, so unlocking simply removes one layer and the icon and name keep
     * their full contrast.
     */
    const mask = el('span', 'skill-card__mask');
    const progress = el('span', 'skill-card__progress');

    mask.append(progress);
    root.append(icon, name, badge, mask);

    host.append(root);

    const nodes: CardNodes = { root, name, badge, progress, signature: '' };
    cards.set(state.id, nodes);
    return nodes;
  }

  function update(next: readonly SkillCardState[]): void {
    for (const state of next) {
      const nodes = ensureCard(state);

      /*
       * 簽名把所有會影響外觀的欄位串起來，只有真的變了才寫 DOM。比逐欄比對少寫很多程式，
       * 而欄位數量本來就少。
       * The signature concatenates every field that affects appearance, so the DOM is touched only
       * on a real change — far less code than field-by-field comparison, and the field count is
       * small anyway.
       */
      const badgeText =
        state.cost > 0 ? (BADGE_GLYPHS[state.cost] ?? String(state.cost)) : '免';
      const signature = [
        state.name,
        badgeText,
        state.unlocked ? '1' : '0',
        state.active ? '1' : '0',
        state.selectedCount,
        Math.round(state.progress * 100),
        state.targeting,
      ].join('|');

      if (signature === nodes.signature) continue;
      nodes.signature = signature;

      nodes.name.textContent = state.name;
      nodes.badge.textContent = badgeText;
      nodes.root.dataset['cost'] = String(state.cost);
      nodes.root.classList.toggle('skill-card--locked', !state.unlocked);
      nodes.root.classList.toggle('skill-card--active', state.active);
      nodes.root.disabled = !state.unlocked;
      nodes.root.setAttribute('aria-disabled', String(!state.unlocked));

      /*
       * 遮罩上顯示「還差多少」：收費技能是目前的技力佔比，累計消耗型技能是累計消耗的佔比。
       * 內容為百分比而不是「需要 3 技力」，因為技力是連續累積的 —— 玩家要的是還有多近。
       * The mask shows "how far off": the current SP share for a paid skill, the cumulative-spend
       * share for a gated one. A percentage rather than "needs 3 SP", because SP accrues
       * continuously and what the player wants is the distance left.
       */
      nodes.progress.textContent = state.unlocked ? '' : `${String(Math.round(state.progress * 100))}%`;
      nodes.progress.style.setProperty('--skill-progress', `${String(state.progress * 100)}%`);

      const label = state.unlocked
        ? `${state.name}（消耗 ${String(state.cost)} 技力）`
        : `${state.name}（未解鎖）`;
      nodes.root.setAttribute('aria-label', label);
      nodes.root.title = label;
    }
  }

  return {
    update,
    destroy: (): void => {
      host.removeEventListener('click', handleClick);
      host.replaceChildren();
      cards.clear();
    },
  };
}
