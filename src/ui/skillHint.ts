/**
 * 技能選取提示：容器下方那條提示帶。
 * The skill-selection hint: the strip below the container.
 *
 * 當棄即棄與命運互換都是「點選方團團」的技能（design.md §5.5 的 user_pick），畫面只把
 * 選中的目標圈起來，玩家不一定看得出現在該做什麼。使用者定案：這類技能啟動時，在容器
 * 下方展示一條相應的提示（做什麼、已選幾顆、怎麼取消）。
 * Discard! and Fate Swap are both "pick a dumpling" skills (user_pick in design.md §5.5), and
 * the canvas only rings the picked targets — a player cannot always tell what is expected.
 * The user's decision: while such a skill is arming, show a matching hint below the container
 * (what to do, how many picked, how to cancel).
 *
 * **位置在使用者第二次定案後改到畫布外**：提示掛在 `.layout` 上、與 `main.stage` 同層，
 * 坐在舞台下緣與聲明（`.layout__notice`）之間的縫隙裡 —— 不在畫布內，所以永遠不會蓋住
 * 容器或畫布；膠囊壓到 34px 高，上不碰舞台、下不碰聲明（見 `layout.css` 的 `.skill-hint`）。
 * **The position moved outside the canvas in the user's second decision**: the hint mounts on
 * `.layout`, a sibling of `main.stage`, sitting in the gap between the stage's bottom edge and
 * the notice (`.layout__notice`) — never inside the canvas, so it can never cover the container
 * or the canvas; the pill is kept 34px tall so it touches neither (see `.skill-hint` in
 * `layout.css`).
 *
 * 即時技能（協議：浮動、搖晃！）不需要提示 —— 按下去就生效，沒有懸而未決的狀態。
 * Immediate skills (Protocol: Float, Shake!) need no hint — they fire at once, nothing is
 * left pending.
 *
 * 這裡不含任何規則：現在選的是哪個技能、選了幾顆，全部由 `GameSession.skillCards` 報告，
 * 這個模組只把狀態畫出來。每幀都會被呼叫，所以只在文案真的變了才動 DOM。
 * **No rules live here**: which skill is arming and how many targets are picked come from
 * `GameSession.skillCards`; this module only draws that state. It is called every frame, so
 * the DOM is touched only when the text really changes.
 */

import type { SkillCardState } from '../game/session';
import { i18n, t, type MessageKey } from '../i18n';
import { el } from './dom';

/**
 * 每個 user_pick 技能的提示文案鍵；沒登記的技能用通用句式，不會空白。
 * The hint key for each user_pick skill; an unregistered skill falls back to the generic line,
 * so the strip is never blank.
 *
 * 文案裡**已含技能名**（而不是用 `{name}` 插值）：這兩個技能的名字是定死的，插值反而要在
 * 「當棄即棄！」後面再接一個標點。技能名若日後改名，這裡要一起改。
 * The sentences **contain the skill name** rather than interpolating `{name}`: those two names
 * are fixed, and interpolating would put a second punctuation mark after "當棄即棄！". If a skill
 * is renamed, these move with it.
 */
const HINT_KEYS: Readonly<Record<string, MessageKey>> = {
  discard: 'skillHint.discard',
  fate_swap: 'skillHint.fate_swap',
};

export interface SkillHintOptions {
  /**
   * 提示的宿主：版面根節點（`.layout`），提示是 `main.stage` 的**兄弟**而不是子元素。
   * The hint's host: the layout root (`.layout`); the hint is a **sibling** of `main.stage`,
   * not its child.
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
     * 只看「正在選取中」的卡：`active` 且 `targeting === 'user_pick'`。即時技能不顯示提示。
     * Only an arming card counts: `active` with `targeting === 'user_pick'`. Immediate skills
     * get no hint.
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
     * The locale is part of the signature: on a locale change the same card's text has to be
     * rewritten, or it would keep the previous language.
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
