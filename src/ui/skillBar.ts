/**
 * 技能欄：技力條下方的技能卡格網。
 * The skill bar: the grid of skill cards beneath the SP meter.
 *
 * 版面是「每行 3 格」（使用者定案），所以第 4 個技能自然落在第二行第一格。卡片內容：
 * **圖示（套圓圈框）＋ 名稱 ＋ 右上角徽章**，累計消耗型技能在名稱下方多一行說明；未解鎖時
 * 整張卡被一層灰色遮罩蓋住，遮罩下面顯示解鎖進度。
 * The grid is **three per row** (the user's decision), so the fourth skill lands on the second
 * row's first cell. A card carries an **icon inside a ring, a name and a badge in the top-right**,
 * plus one caption line under the name for cumulative-spend skills; while locked the whole card is
 * covered by a grey mask that also shows unlock progress.
 *
 * 徽章顯示什麼由 `unlockKind` 決定（使用者定案）：收費技能顯示消耗數字，累計消耗型技能顯示
 * `n/m` 進度，並由下方那行說明是哪一種進度。
 * What the badge shows follows `unlockKind` (the user's decision): a paid skill shows its cost,
 * a cumulative-spend skill shows `n/m` progress, with the caption below saying which progress it
 * is.
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
import { i18n, t } from '../i18n';
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
  /**
   * 技能卡上要顯示的名字。未提供時直接用 `SkillCardState.name`。
   * The name to show on a skill card. Defaults to `SkillCardState.name`.
   *
   * 需要它是因為**技能名可依語系而不同**（`skills.json` 的 `names`），而 `GameSession` 刻意
   * 不認識語系；`main.ts` 用 `resolveLocalizedName()` 從配置組出這個函式，技能名才會跟著
   * 設定頁的語言走。這個元件每幀重畫，所以換語系時名字自然會更新。
   * It exists because **skill names can differ per locale** (`names` in `skills.json`) while
   * `GameSession` deliberately knows nothing about locales; `main.ts` builds this from config via
   * `resolveLocalizedName()`, so the names follow the settings page's language. The bar redraws
   * every frame, so a locale change updates them by itself.
   */
  nameFor?: (state: SkillCardState) => string;
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
  caption: HTMLElement;
  progress: HTMLElement;
  /** 上次寫入的狀態簽名，用來判斷要不要動 DOM。 */
  signature: string;
}

/**
 * 徽章文字。收費技能是消耗數字，累計消耗型是 `n/m`。
 * The badge text: a paid skill shows its cost, a cumulative-spend skill shows `n/m`.
 *
 * 累計值可能是小數（技力以 0.05 為單位累積），所以四捨五入到最近的整數 —— 徽章只有兩位
 * 數字寬，`5.95` 與 `6` 對玩家是同一件事。
 * The running total can be fractional (SP accrues in 0.05 steps), so it is rounded to the nearest
 * integer — the badge has room for two digits, and `5.95` and `6` are the same thing to a player.
 */
function badgeTextFor(state: SkillCardState): string {
  if (state.unlockKind === 'cumulativeSpent') {
    return `${String(Math.round(state.cumulativeSpent))}/${String(state.unlockThreshold)}`;
  }
  if (state.cost > 0) return BADGE_GLYPHS[state.cost] ?? String(state.cost);
  return t('skillBar.free');
}

export function createSkillBar(options: SkillBarOptions): SkillBar {
  const { host, onActivate } = options;
  const nameFor = options.nameFor ?? ((state: SkillCardState): string => state.name);
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

    /*
     * 圖示外面再套一層圓框（使用者定案，比照參考圖）：圓框是純 CSS 的 `border-radius`，
     * 所以換圖示不必動樣式，圖示本身仍是一個 24×24 的線稿 `<svg>`。
     * The icon sits inside a ring (the user's decision, following the reference mock). The ring is
     * pure CSS `border-radius`, so swapping icons needs no style change and the icon itself stays a
     * 24×24 stroke `<svg>`.
     */
    const glyph = el('span', 'skill-card__glyph');
    glyph.append(createIcon(SKILL_ICONS[state.id] ?? 'help'));
    const name = el('span', 'skill-card__name', nameFor(state));
    const caption = el('span', 'skill-card__caption');
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
    root.append(glyph, name, caption, badge, mask);

    host.append(root);

    const nodes: CardNodes = { root, name, badge, caption, progress, signature: '' };
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
      const badgeText = badgeTextFor(state);
      const name = nameFor(state);
      const captionText = state.unlockKind === 'cumulativeSpent' ? t('skillBar.cumulative') : '';
      const signature = [
        name,
        badgeText,
        captionText,
        state.unlocked ? '1' : '0',
        state.active ? '1' : '0',
        state.selectedCount,
        Math.round(state.progress * 100),
        state.targeting,
        /* 換語系時即使數值沒變也要重畫文字與 aria。 */
        i18n.locale,
      ].join('|');

      if (signature === nodes.signature) continue;
      nodes.signature = signature;

      nodes.name.textContent = name;
      nodes.badge.textContent = badgeText;
      nodes.caption.textContent = captionText;
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
      nodes.progress.textContent = state.unlocked
        ? ''
        : `${String(Math.round(state.progress * 100))}%`;
      nodes.progress.style.setProperty('--skill-progress', `${String(state.progress * 100)}%`);

      const label =
        state.unlockKind === 'cumulativeSpent'
          ? t('skillBar.ariaCumulative', {
              name,
              spent: Math.round(state.cumulativeSpent),
              threshold: state.unlockThreshold,
            })
          : state.unlocked
            ? t('skillBar.ariaCost', { name, cost: state.cost })
            : t('skillBar.ariaLocked', { name });
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
