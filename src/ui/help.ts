/**
 * 遊戲說明彈窗（工具列的「?」）。
 * The help popup (the toolbar's "?").
 *
 * 內容依使用者定案分四段：**玩法**、**製作緣由**、**作者（含 GitHub 專案連結）**、
 * **版權聲明**。四段都是靜態文案，所以文字全部用 `data-i18n` 標記，語系一換由 `main.ts`
 * 的 `i18n.applyTo(layout.root)` 一次改掉 —— 這一支不必訂閱任何東西，也就不必有一份自己的
 * 重繪邏輯。
 * Four sections per the user's decision: **how to play**, **why it exists**, **the author (with
 * the GitHub link)** and **the copyright notice**. All four are static copy, so every string is
 * tagged with `data-i18n` and a locale change is handled in one `i18n.applyTo(layout.root)` pass
 * from `main.ts` — nothing to subscribe to here, and no second rendering path to keep in step.
 *
 * 唯一不是靜態文字的是**連結的 `href`**：網址不是文案，不進字典。
 * The one thing that is not static text is the link's `href`: a URL is not copy, so it does not
 * belong in the message tables.
 *
 * 彈窗行為沿用 `ui/confirmDialog.ts` 與 `ui/leaderboard.ts` 的慣例：`role="dialog"` ＋
 * `aria-modal`、`Esc` 關閉、點背景關閉、關閉後把焦點還原。
 * Behaviour follows the `ui/confirmDialog.ts` / `ui/leaderboard.ts` convention: `role="dialog"`
 * with `aria-modal`, `Esc` to close, a backdrop press to close, and focus restored on close.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，與整張畫布一起被 `ui/scale.ts` 等比縮放）。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas).
 */

import { i18nAriaLabel, i18nText, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 專案網址。與 `README.md` 的 clone 位址同一個（`git remote -v` 亦同）。
 * The project URL, identical to the clone address in `README.md` and to `git remote -v`.
 */
export const REPO_URL = 'https://github.com/Vocaloid2048/EndchiMerge';

export interface HelpOptions {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
}

export interface HelpView {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

/** 一段說明：標題 ＋ 內文。 */
function buildSection(headingKey: MessageKey, bodyKey: MessageKey): HTMLElement {
  const heading = el('h3', 'help__heading');
  i18nText(heading, headingKey);

  const text = el('p', 'help__text');
  i18nText(text, bodyKey);

  const section = el('section', 'help__section');
  appendChildren(section, heading, text);
  return section;
}

export function createHelp(options: HelpOptions): HelpView {
  const titleId = 'help-title';

  const root = el('section', 'help');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);

  const title = el('h2', 'help__title');
  title.id = titleId;
  i18nText(title, 'help.title');

  const closeButton = el('button', 'help__close', '×');
  closeButton.type = 'button';
  i18nAriaLabel(closeButton, 'help.close');

  const header = el('header', 'help__header');
  appendChildren(header, title, closeButton);

  const body = el('div', 'help__body');

  /* ① 玩法 */
  const play = buildSection('help.play.heading', 'help.play.body');

  /* ② 製作緣由 */
  const origin = buildSection('help.origin.heading', 'help.origin.body');

  /* ③ 作者 —— 內文 + GitHub 連結 */
  const author = buildSection('help.author.heading', 'help.author.body');

  const repoLink = el('a', 'help__link');
  repoLink.href = REPO_URL;
  repoLink.target = '_blank';
  /* `noopener` 是必要的：沒有它，被開啟的分頁可以透過 `window.opener` 反向操作本頁。 */
  repoLink.rel = 'noopener noreferrer';
  /* 滑過去看得到完整網址（不是文案，不進字典）。 */
  repoLink.title = REPO_URL;
  i18nText(repoLink, 'help.repo.label');

  const repoRow = el('p', 'help__repo');
  repoRow.append(repoLink);

  author.append(repoRow);

  /* ④ 版權聲明 */
  const copyright = buildSection('help.copyright.heading', 'help.copyright.body');

  appendChildren(body, play, origin, author, copyright);

  const card = el('div', 'help__card');
  appendChildren(card, header, body);

  root.append(card);
  options.host.append(root);

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

  const onCloseClick = (): void => close();

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
    root.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);

    closeButton.focus();
  }

  closeButton.addEventListener('click', onCloseClick);

  return {
    get visible(): boolean {
      return !root.hidden;
    },

    open,
    close,

    dispose(): void {
      closeButton.removeEventListener('click', onCloseClick);
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
