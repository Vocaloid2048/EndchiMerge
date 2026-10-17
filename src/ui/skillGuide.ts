/**
 * 技能說明彈窗（技能列表右上角的 (i)）：左邊是按技力需求分類的選單，右邊是該技能的說明。
 * The skill guide popup (the "(i)" at the skill list's top-right): a menu grouped by SP cost on
 * the left, the selected skill's description on the right.
 *
 * 只讀 `SkillDef`（來自 `skills.json`），不碰任何規則、也不訂閱 `GameSession` —— 說明是靜態的，
 * 場上發生什麼都不會改變它。文字全部走 i18n，換語系時重畫一次（描述帶參數，`i18nText` 不能插值）。
 * It reads `SkillDef` from `skills.json` only, holds no rules and never subscribes to `GameSession`:
 * the copy is static and nothing on the board changes it. All text goes through i18n and is
 * redrawn once per locale change (the descriptions carry parameters, which `i18nText` cannot fill).
 */

import type { SkillDef } from '../core/types';
import { i18n, i18nAriaLabel, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 技能 id → 描述文案的鍵。
 * Skill id → the message key of its description.
 *
 * 寫成表而不是拼字串：拼出來的鍵不屬於 `MessageKey`，少一個文案就只會在畫面上露餡。
 * A table rather than string concatenation: a built key is not a `MessageKey`, so a missing entry
 * would only show up on screen.
 */
const DESC_KEYS: Readonly<Record<string, MessageKey>> = {
  discard: 'skillGuide.desc.discard',
  ascend: 'skillGuide.desc.ascend',
  protocol_float: 'skillGuide.desc.protocol_float',
  scramble: 'skillGuide.desc.scramble',
  combo_grace: 'skillGuide.desc.combo_grace',
  shake: 'skillGuide.desc.shake',
  reshuffle: 'skillGuide.desc.reshuffle',
  fate_swap: 'skillGuide.desc.fate_swap',
  shrink_all: 'skillGuide.desc.shrink_all',
  square_core: 'skillGuide.desc.square_core',
};

/**
 * 描述裡可用的數字參數，直接取自配置；缺值時用技能本身的預設。
 * The numeric parameters the descriptions may use, taken from the config; missing values fall
 * back to the skill's own default.
 *
 * 一個技能只會用到其中一個，三個一併傳進去 —— `formatMessage` 只替換模板裡真的出現的佔位符。
 * A skill uses at most one of them; all three are passed because `formatMessage` only replaces the
 * placeholders that actually appear in the template.
 */
function descParams(def: SkillDef): Record<string, number> {
  return {
    drops: def.params.drops ?? 3,
    count: def.params.count ?? 30,
    radius: def.params.radius ?? 37.5,
  };
}

export interface SkillGuideOptions {
  /** 掛載點；通常是 `layout.root`。 / The mount host; usually `layout.root`. */
  host: HTMLElement;
  /** 全部技能定義（`config.skills.skills`）。 / Every skill definition (`config.skills.skills`). */
  skills: readonly SkillDef[];
  /** 依語系取名字；未提供時用 `SkillDef.name`。 / Resolves a name per locale; defaults to `SkillDef.name`. */
  nameFor?: (def: SkillDef) => string;
}

export interface SkillGuideView {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

export function createSkillGuide(options: SkillGuideOptions): SkillGuideView {
  const { host, skills } = options;
  const nameFor = options.nameFor ?? ((def: SkillDef): string => def.name);

  const titleId = 'skill-guide-title';

  const root = el('section', 'skill-guide');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);

  const card = el('div', 'skill-guide__card');

  const title = el('h2', 'skill-guide__title');
  title.id = titleId;

  const closeButton = el('button', 'skill-guide__close', '×');
  closeButton.type = 'button';
  i18nAriaLabel(closeButton, 'skillGuide.close');

  const header = el('header', 'skill-guide__header');
  appendChildren(header, title, closeButton);

  const menu = el('nav', 'skill-guide__menu');
  menu.setAttribute('aria-label', t('skillGuide.title'));

  const detail = el('article', 'skill-guide__detail');
  const name = el('h3', 'skill-guide__name');
  const meta = el('p', 'skill-guide__meta');
  /*
   * 媒體位：預留給示意圖或 GIF。它只有外框與提示字，之後要放圖不必改這裡的結構，
   * 直接塞一個 `<img>`／`<video>`（`data-slot` 就是掛載點）。
   * The media slot, reserved for an illustration or a GIF. It carries only a frame and a hint;

   * dropping in an `<img>` or `<video>` needs no structural change — `data-slot` is the hook.
   */
  const media = el('div', 'skill-guide__media');
  media.dataset['slot'] = 'skill-media';

  /*
   * 示意 GIF：`public/assets/skills/<id>.gif`，一個技能一張，選到哪個就載哪個（`src` 在
   * `renderDetail()` 才設定，所以不會一次抓十張）。圖片沒有 `alt` —— 右邊那段描述已經講了
   * 同一件事，再念一次只會吵。
   * The illustration GIF at `public/assets/skills/<id>.gif`, one per skill; `src` is set in
   * `renderDetail()`, so only the selected skill loads. It carries an empty `alt` because the
   * description beside it already says the same thing, and repeating it would only be noise.
   */
  const mediaImage = el('img', 'skill-guide__media-image');
  mediaImage.alt = '';
  mediaImage.decoding = 'async';

  const mediaHint = el('span', 'skill-guide__media-hint');
  media.append(mediaImage, mediaHint);

  /* 沒有對應素材時退回提示字，而不是留一個破圖。 */
  /* Fall back to the hint when a skill has no artwork, rather than showing a broken image. */
  mediaImage.addEventListener('error', (): void => {
    mediaImage.hidden = true;
    mediaHint.hidden = false;
    media.classList.remove('skill-guide__media--filled');
  });

  const desc = el('p', 'skill-guide__desc');

  appendChildren(detail, name, meta, media, desc);

  const body = el('div', 'skill-guide__body');
  appendChildren(body, menu, detail);

  appendChildren(card, header, body);
  root.append(card);
  host.append(root);

  /* 依消耗分組：0 點（特殊技能：不扣技力、靠累計解鎖）在最前，其餘按點數遞增。 */
  const groups = new Map<number, SkillDef[]>();
  for (const def of skills) {
    const bucket = groups.get(def.cost);
    if (bucket === undefined) groups.set(def.cost, [def]);
    else bucket.push(def);
  }

  const orderedCosts = [...groups.keys()].sort((a, b) => a - b);
  const allIds = orderedCosts.flatMap((cost) => (groups.get(cost) ?? []).map((def) => def.id));

  let selectedId = allIds[0] ?? '';
  const items = new Map<string, HTMLButtonElement>();

  function renderMenu(): void {
    menu.replaceChildren();
    items.clear();

    for (const cost of orderedCosts) {
      const bucket = groups.get(cost);
      if (bucket === undefined) continue;

      const heading = el(
        'p',
        'skill-guide__group',
        cost > 0 ? t('skillGuide.groupPaid', { cost }) : t('skillGuide.groupSpecial'),
      );
      menu.append(heading);

      for (const def of bucket) {
        const item = el('button', 'skill-guide__item', nameFor(def));
        item.type = 'button';
        item.dataset['skillId'] = def.id;
        item.setAttribute('aria-current', String(def.id === selectedId));
        item.classList.toggle('skill-guide__item--current', def.id === selectedId);
        items.set(def.id, item);
        menu.append(item);
      }
    }
  }

  function unlockLine(def: SkillDef): string {
    if (def.unlock.kind === 'cumulativeSpent') {
      return t('skillGuide.unlockSpent', { threshold: def.unlock.threshold });
    }
    if (def.unlock.kind === 'cumulativeUses') {
      return t('skillGuide.unlockUses', { threshold: def.unlock.threshold });
    }
    return t('skillGuide.unlockSp');
  }

  function renderDetail(): void {
    const def = skills.find((entry) => entry.id === selectedId);

    if (def === undefined) {
      name.textContent = '';
      meta.textContent = '';
      desc.textContent = '';
      mediaImage.hidden = true;
      mediaHint.textContent = '';
      return;
    }

    name.textContent = nameFor(def);
    const costLine =
      def.cost > 0 ? t('skillGuide.cost', { cost: def.cost }) : t('skillGuide.costSpecial');
    meta.textContent = `${costLine}・${unlockLine(def)}`;

    const key = DESC_KEYS[def.id];
    desc.textContent = key === undefined ? '' : t(key, descParams(def));

    mediaHint.textContent = t('skillGuide.media');
    mediaHint.hidden = true;
    mediaImage.hidden = false;
    media.classList.add('skill-guide__media--filled');
    media.dataset['skillId'] = def.id;

    const source = `${import.meta.env.BASE_URL}assets/skills/${def.id}.gif`;
    if (mediaImage.getAttribute('src') !== source) mediaImage.src = source;

    for (const [id, item] of items) {
      const current = id === def.id;
      item.setAttribute('aria-current', String(current));
      item.classList.toggle('skill-guide__item--current', current);
    }
  }

  function render(): void {
    title.textContent = t('skillGuide.title');
    menu.setAttribute('aria-label', t('skillGuide.title'));
    renderMenu();
    renderDetail();
  }

  /* ── 開關、鍵盤與焦點 ─────────────────────────────────────────────── */

  let previouslyFocused: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target === root) close();
  };

  const onMenuClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest('button[data-skill-id]');
    if (!(button instanceof HTMLButtonElement)) return;

    const id = button.dataset['skillId'];
    if (id === undefined || id === selectedId) return;

    selectedId = id;
    renderDetail();
  };

  function close(): void {
    if (root.hidden) return;

    root.hidden = true;
    document.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('pointerdown', onBackdropPointerDown);

    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function open(): void {
    if (!root.hidden) return;

    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    render();
    root.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);
    closeButton.focus();
  }

  closeButton.addEventListener('click', close);
  menu.addEventListener('click', onMenuClick);

  /* 換語系：名字來自配置、描述帶參數，兩者都要重畫一次。 */
  const unsubscribeLocale = i18n.subscribe((): void => {
    if (!root.hidden) render();
  });

  return {
    get visible(): boolean {
      return !root.hidden;
    },
    open,
    close,
    dispose(): void {
      unsubscribeLocale();
      closeButton.removeEventListener('click', close);
      menu.removeEventListener('click', onMenuClick);
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
