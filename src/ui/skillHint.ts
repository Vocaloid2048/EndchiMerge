/**
 * 技能選取提示：user_pick 技能啟動時，容器下方那條「做什麼／已選幾顆／怎麼取消」的提示帶。
 * The skill-selection hint: while a user_pick skill arms, the strip below the container says what to do, how many are picked and how to cancel.
 *
 * 不含任何規則：狀態全部由 `GameSession.skillCards` 報告，這裡只畫出來；每幀呼叫，文案沒變就不動 DOM。
 * It holds no rules: state comes from `GameSession.skillCards` and is only drawn; called every frame, it touches the DOM only when the text changes.
 */

import type { SkillCardState } from '../game/session';
import { i18n, t, type MessageKey } from '../i18n';
import { el } from './dom';

/**
 * 每個 user_pick 技能的提示文案鍵；沒登記的技能用通用句式，不會空白。
 * The hint key per user_pick skill; an unregistered skill falls back to the generic line, so the strip is never blank.
 *
 * 文案裡已含技能名（不做插值）；技能名若改名，這裡要一起改。
 * The sentences contain the skill name (no interpolation); renaming a skill means updating these too.
 */
const HINT_KEYS: Readonly<Record<string, MessageKey>> = {
  discard: 'skillHint.discard',
  fate_swap: 'skillHint.fate_swap',
};

export interface SkillHintOptions {
  /**
   * 提示的宿主：版面根節點（`.layout`），提示是 `main.stage` 的兄弟而不是子元素。
   * The hint's host: the layout root (`.layout`); the hint is a sibling of `main.stage`, not its child.
   */
  host: HTMLElement;
}

export interface SkillHint {
  update(cards: readonly SkillCardState[]): void;
  destroy(): void;
}

export function createSkillHint(options: SkillHintOptions): SkillHint {
  const { host } = options;

  const node = el('p', 'skill-hint');
  node.hidden = true;
  host.append(node);

  let signature = '';

  function update(cards: readonly SkillCardState[]): void {
    /*
     * 只看「正在選取中」的卡：`active` 且 `targeting === 'user_pick'`；即時技能不顯示提示。
     * Only an arming card counts: `active` with `targeting === 'user_pick'`. Immediate skills get no hint.
     */
    const arming = cards.find((card) => card.active && card.targeting === 'user_pick');

    if (arming === undefined) {
      if (signature === '') return;
      signature = '';
      node.hidden = true;
      node.textContent = '';
      return;
    }

    /*
     * 語系也放進簽名：換語言時同一張卡的文字要重畫，否則會留著上一個語言。
     * The locale is part of the signature: on a locale change the same card's text must be rewritten, or it keeps the previous language.
     */
    const base =
      HINT_KEYS[arming.id] === undefined ? t('skillHint.generic') : t(HINT_KEYS[arming.id]);
    const text = t('skillHint.counter', {
      base,
      selected: arming.selectedCount,
      total: arming.pickCount,
    });
    const next = `${arming.id}|${String(arming.selectedCount)}|${i18n.locale}`;

    if (next === signature) return;
    signature = next;

    node.textContent = text;
    node.hidden = false;
  }

  return {
    update,
    destroy: (): void => {
      node.remove();
    },
  };
}
