/**
 * 技能欄：技力條下方的技能卡格網（每行 3 格）。
 * The skill bar: the grid of skill cards beneath the SP meter, three per row.
 *
 * 不含任何規則：可不可以按由 `GameSession` 決定，這裡只把 `SkillCardState` 畫出來並回報 id；
 * 每幀呼叫，每個欄位先比對上次值，真的變了才動 DOM。
 * It holds no rules: pressability is decided by `GameSession`, and this only renders `SkillCardState` and reports the id; called every frame, each field is compared before touching the DOM.
 */

import type { SkillCardState } from '../game/session';
import { i18n, i18nText, t } from '../i18n';
import { el } from './dom';
import { createIcon, type IconName } from './icons';

/**
 * 技能 id → 圖示；沒登記的技能用通用圖示，不會空白。
 * Skill id → icon; unregistered skills fall back to the generic icon, never blank.
 */
const SKILL_ICONS: Readonly<Record<string, IconName>> = {
  discard: 'discard',
  ascend: 'ascend',
  protocol_float: 'float',
  scramble: 'scramble',
  combo_grace: 'comboGrace',
  shake: 'shake',
  reshuffle: 'reshuffle',
  fate_swap: 'fateSwap',
  shrink_all: 'shrink',
  square_core: 'squareCore',
};

/**
 * 消耗徽章的顯示字元：① ② ③ … 超過 10 就用純數字。
 * The cost badge's glyphs: ① ② ③ …, plain digits past 10.
 */
const BADGE_GLYPHS = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export interface SkillBarOptions {
  /**
   * 掛載宿主（`layout` 的 skill 區的 `skill-grid` 槽）。
   * The mount host (the `skill-grid` slot of `layout`'s skill region).
   */
  host: HTMLElement;
  /**
   * 按下技能卡（或再按一次取消）時回報技能 id。
   * Reports the skill id when a card is pressed (or pressed again to cancel).
   */
  onActivate: (id: string) => void;
  /**
   * 技能卡上要顯示的名字；未提供時直接用 `SkillCardState.name`。
   * The name shown on a card; defaults to `SkillCardState.name`.
   *
   * 需要它因為技能名可依語系而不同，而 `GameSession` 刻意不認識語系；
   * `main.ts` 用 `resolveLocalizedName()` 從配置組出這個函式。
   * It exists because skill names can differ per locale while `GameSession` knows nothing of locales; `main.ts` builds it from config via `resolveLocalizedName()`.
   */
  nameFor?: (state: SkillCardState) => string;
}

export interface SkillBar {
  update(cards: readonly SkillCardState[]): void;
  destroy(): void;
}

/**
 * 一張卡在 DOM 上需要的把手。
 * The DOM handles one card needs.
 */
interface CardNodes {
  root: HTMLButtonElement;
  name: HTMLElement;
  badge: HTMLElement;
  caption: HTMLElement;
  progress: HTMLElement;
  /**
   * 一次性技能的「已使用」字樣（在遮罩內，只有用完之後才顯示）。
   * The one-shot skill's "used" label, inside the mask and shown only after it is spent.
   */
  used: HTMLElement;
  /**
   * 上次寫入的狀態簽名，用來判斷要不要動 DOM。
   * The last written state signature, deciding whether the DOM changes.
   */
  signature: string;
}

/**
 * 徽章文字：收費技能是消耗數字；累計型是 `n/m`（累計消耗四捨五入到整數，累計次數本身已是整數）。
 * The badge text: a paid skill shows its cost, a cumulative one shows `n/m` (the running spend
 * rounded, the cast count already an integer).
 */
function badgeTextFor(state: SkillCardState): string {
  if (state.unlockKind === 'cumulativeSpent') {
    return `${String(Math.round(state.cumulativeSpent))}/${String(state.unlockThreshold)}`;
  }
  if (state.unlockKind === 'cumulativeUses') {
    return `${String(state.cumulativeUses)}/${String(state.unlockThreshold)}`;
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
     * 圖示外面套一層圓框（純 CSS `border-radius`），換圖示不必動樣式。
     * The icon sits inside a ring (pure CSS `border-radius`), so swapping icons needs no style change.
     */
    const glyph = el('span', 'skill-card__glyph');
    glyph.append(createIcon(SKILL_ICONS[state.id] ?? 'help'));
    const name = el('span', 'skill-card__name', nameFor(state));
    const caption = el('span', 'skill-card__caption');
    const badge = el('span', 'skill-card__badge');
    /*
     * 遮罩是獨立一層、覆蓋整張卡：解鎖那一刻只要移除一層，圖示與名稱的對比度不受影響。
     * The mask is a separate layer over the whole card: unlocking removes one layer and the icon and name keep their contrast.
     */
    const mask = el('span', 'skill-card__mask');
    const progress = el('span', 'skill-card__progress');
    const used = el('span', 'skill-card__used');
    i18nText(used, 'skillBar.used');

    mask.append(progress, used);
    root.append(glyph, name, caption, badge, mask);

    host.append(root);

    const nodes: CardNodes = { root, name, badge, caption, progress, used, signature: '' };
    cards.set(state.id, nodes);
    return nodes;
  }

  function update(next: readonly SkillCardState[]): void {
    for (const state of next) {
      const nodes = ensureCard(state);

      /*
       * 簽名把所有影響外觀的欄位串起來，真的變了才寫 DOM；比逐欄比對少寫很多程式。
       * The signature concatenates every appearance-affecting field, so the DOM is touched only on a real change — far less code than field-by-field comparison.
       */
      const badgeText = badgeTextFor(state);
      const name = nameFor(state);
      const captionText =
        state.unlockKind === 'cumulativeSpent'
          ? t('skillBar.cumulative')
          : state.unlockKind === 'cumulativeUses'
            ? t('skillBar.uses')
            : '';
      const signature = [
        name,
        badgeText,
        captionText,
        state.unlocked ? '1' : '0',
        state.active ? '1' : '0',
        state.exhausted ? '1' : '0',
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
      /*
       * 解鎖來源也寫進 `data-unlock`：徽章顏色除了按消耗分級，還要區分「累計施放次數」那一種
       * （`n/m` 是次數，不是點數，用消耗的配色會誤導）。
       * The unlock kind also goes into `data-unlock`: besides the cost tier, the badge colour must
       * tell a cast-count gate apart from a cost gate (`n/m` counts casts, not points, so the cost
       * palette would mislead).
       */
      nodes.root.dataset['unlock'] = state.unlockKind;
      nodes.root.classList.toggle('skill-card--locked', !state.unlocked);
      nodes.root.classList.toggle('skill-card--active', state.active);
      nodes.root.classList.toggle('skill-card--exhausted', state.exhausted);
      nodes.root.disabled = !state.unlocked;
      nodes.root.setAttribute('aria-disabled', String(!state.unlocked));

      /*
       * 遮罩上顯示「還差多少」的百分比：技力是連續累積的，玩家要的是還有多近。
       * 一次性技能用完之後改說「已使用」——它不會再解鎖，顯示進度是騙人的。
       * The mask shows how far off as a percentage: SP accrues continuously and what the player
       * wants is the distance left. A spent one-shot says "used" instead — it never unlocks
       * again, so a progress figure would be a lie.
       */
      nodes.progress.textContent =
        state.unlocked || state.exhausted
          ? ''
          : `${String(Math.round(state.progress * 100))}%`;
      nodes.progress.style.setProperty('--skill-progress', `${String(state.progress * 100)}%`);

      const label = state.exhausted
        ? t('skillBar.ariaUsed', { name })
        : state.unlockKind === 'cumulativeSpent'
          ? t('skillBar.ariaCumulative', {
              name,
              spent: Math.round(state.cumulativeSpent),
              threshold: state.unlockThreshold,
            })
          : state.unlockKind === 'cumulativeUses'
            ? t('skillBar.ariaCumulativeUses', {
                name,
                uses: state.cumulativeUses,
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
