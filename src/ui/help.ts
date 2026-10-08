/**
 * 遊戲說明彈窗（工具列的「?」）。
 * The help popup (the toolbar's "?").
 *
 * 內容依使用者定案分四段：**玩法**、**製作緣由**、**作者（頭像、品牌徽章、專案連結）**、
 * **版權聲明**。除了「作者」那一段有幾個連結與圖片，其餘都是靜態文案，所以文字全部用
 * `data-i18n` 一類的標記，語系一換由 `main.ts` 的 `i18n.applyTo(layout.root)` 一次改掉 ——
 * 這一支不必訂閱任何東西，也就不必有一份自己的重繪邏輯。
 * Four sections per the user's decision: **how to play**, **why it exists**, **the author (avatar,
 * brand badges, project link)** and **the copyright notice**. Apart from the links and the image in
 * the author section it is all static copy, so every string is tagged for i18n and a locale change
 * is handled in one `i18n.applyTo(layout.root)` pass from `main.ts` — nothing to subscribe to here,
 * and no second rendering path to keep in step.
 *
 * 段落一律「一段一個 `<p>`」：內文的行距與段距靠 CSS（`.help__text` 的 `line-height` 加上
 * `.help__section` 的 `gap`），全塞進同一個字串就吃不到段距，讀起來會是一整塊。
 * Paragraphs are one `<p>` each: the leading and the space between them come from CSS, so folding
 * several paragraphs into one string would lose the separation and read as a single slab.
 *
 * 命名（`#` 開頭的常數）與網址一樣**不是文案**，不進字典：品牌名五個語系都寫 Discord / GitHub，
 * 作者署名亦然。字典只收會隨語系改變的句子與敘述（含圖片的 `alt` 與連結的 `aria-label`）。
 * Identifiers (`#`-prefixed constants) and URLs are **not copy** and stay out of the message
 * tables: a brand name is spelled Discord / GitHub in every locale, and so is the author's name.
 * The tables hold only what actually changes with the locale — sentences, the image `alt`, and the
 * links' `aria-label`.
 *
 * 彈窗行為沿用 `ui/confirmDialog.ts` 與 `ui/leaderboard.ts` 的慣例：`role="dialog"` ＋
 * `aria-modal`、`Esc` 關閉、點背景關閉、關閉後把焦點還原。
 * Behaviour follows the `ui/confirmDialog.ts` / `ui/leaderboard.ts` convention: `role="dialog"`
 * with `aria-modal`, `Esc` to close, a backdrop press to close, and focus restored on close.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，與整張畫布一起被 `ui/scale.ts` 等比縮放）。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas).
 */

import { i18nAlt, i18nAriaLabel, i18nText, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 專案網址。與 `README.md` 的 clone 位址同一個（`git remote -v` 亦同）。
 * The project URL, identical to the clone address in `README.md` and to `git remote -v`.
 */
export const REPO_URL = 'https://github.com/Vocaloid2048/EndchiMerge';

/** 作者署名。專有名詞，五個語系一概照原樣顯示，因此不進字典。 */
const AUTHOR_NAME = '夜芷冰';

/** 作者頭像（GitHub 頭像）。 */
const AUTHOR_AVATAR = 'https://avatars.githubusercontent.com/u/47070571?v=4';

/** 作者的 Discord 個人頁。 */
const AUTHOR_DISCORD = 'https://discord.com/users/417665898548166678';

/** 作者的 GitHub 個人頁。 */
const AUTHOR_GITHUB = 'https://github.com/Vocaloid2048/';

/** 支援用 Discord 伺服器邀請連結。 */
const SERVER_INVITE = 'https://discord.gg/uXatcbWKv2';

/*
 * 品牌標誌。兩個都是官方商標的簡化路徑（24×24 視圖框），著色走 `currentColor`，
 * 所以徽章換底色時圖示會自己跟上，不必為每個狀態各存一份。
 * Brand marks: the simplified official paths on a 24×24 viewBox, filled with `currentColor`, so
 * the icon follows the badge's colour instead of needing one copy per state.
 */
const DISCORD_MARK =
  'M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z';

const GITHUB_MARK =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.5 11.5 0 0 1 3.003-.404c1.018.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 一個 24×24 的品牌圖示；`aria-hidden` —— 它的意義由外層連結的文字與 `aria-label` 承擔。 */
function buildIcon(mark: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('help__icon');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', mark);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);

  return svg;
}

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

/** 一段說明：標題 ＋ 一至多段內文。 */
function buildSection(headingKey: MessageKey, bodyKeys: readonly MessageKey[]): HTMLElement {
  const heading = el('h3', 'help__heading');
  i18nText(heading, headingKey);

  const section = el('section', 'help__section');
  section.append(heading);

  for (const key of bodyKeys) {
    const paragraph = el('p', 'help__text');
    i18nText(paragraph, key);
    section.append(paragraph);
  }

  return section;
}

/**
 * 一個帶圖示的外部連結。
 * One external link with its brand icon.
 *
 * 文字放在內層 `<span>` 而**不是**標在 `<a>` 上：`applyTo()` 對 `[data-i18n]` 是直接蓋掉
 * `textContent`，標在外層會連圖示一起抹掉。
 * The label lives in an inner `<span>` rather than on the `<a>`: `applyTo()` overwrites
 * `textContent` outright for `[data-i18n]`, so tagging the anchor would wipe the icon with it.
 */
function buildIconLink(options: {
  className: string;
  labelClass: string;
  href: string;
  mark: string;
}): { link: HTMLAnchorElement; label: HTMLElement } {
  const link = el('a', options.className);
  link.href = options.href;
  link.target = '_blank';
  /* `noopener` 是必要的：沒有它，被開啟的分頁可以透過 `window.opener` 反向操作本頁。 */
  link.rel = 'noopener noreferrer';
  /* 滑過去看得到完整網址（不是文案，不進字典）。 */
  link.title = options.href;

  const label = el('span', options.labelClass);
  appendChildren(link, buildIcon(options.mark), label);

  return { link, label };
}

/** 作者區塊：頭像、署名，以及兩個品牌徽章。 */
function buildAuthorBlock(): HTMLElement {
  const avatar = el('img', 'help__avatar');
  avatar.src = AUTHOR_AVATAR;
  avatar.width = 96;
  avatar.height = 96;
  avatar.loading = 'lazy';
  avatar.decoding = 'async';
  i18nAlt(avatar, 'help.author.avatarAlt');

  const name = el('p', 'help__author-name', AUTHOR_NAME);

  const discord = buildIconLink({
    className: 'help__badge',
    labelClass: 'help__badge-label',
    href: AUTHOR_DISCORD,
    mark: DISCORD_MARK,
  });
  /* 品牌名不是文案，不進字典（見檔頭）。 */
  discord.label.textContent = 'Discord';
  i18nAriaLabel(discord.link, 'help.author.discordAria');

  const github = buildIconLink({
    className: 'help__badge',
    labelClass: 'help__badge-label',
    href: AUTHOR_GITHUB,
    mark: GITHUB_MARK,
  });
  github.label.textContent = 'GitHub';
  i18nAriaLabel(github.link, 'help.author.githubAria');

  const badges = el('div', 'help__badges');
  appendChildren(badges, discord.link, github.link);

  const meta = el('div', 'help__author-meta');
  appendChildren(meta, name, badges);

  const block = el('div', 'help__author');
  appendChildren(block, avatar, meta);

  return block;
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
  const play = buildSection('help.play.heading', [
    'help.play.body1',
    'help.play.body2',
    'help.play.body3',
    'help.play.body4',
  ]);

  /* ② 製作緣由 */
  const origin = buildSection('help.origin.heading', [
    'help.origin.body1',
    'help.origin.body2',
    'help.origin.body3',
  ]);

  /* ③ 作者 —— 頭像、署名、徽章，然後是兩個主要出口 */
  const authorHeading = el('h3', 'help__heading');
  i18nText(authorHeading, 'help.author.heading');

  const repo = buildIconLink({
    className: 'help__link',
    labelClass: 'help__link-label',
    href: REPO_URL,
    mark: GITHUB_MARK,
  });
  i18nText(repo.label, 'help.repo.label');

  const server = buildIconLink({
    className: 'help__link',
    labelClass: 'help__link-label',
    href: SERVER_INVITE,
    mark: DISCORD_MARK,
  });
  i18nText(server.label, 'help.author.server');
  i18nAriaLabel(server.link, 'help.author.serverAria');

  const links = el('p', 'help__links');
  appendChildren(links, repo.link, server.link);

  const author = el('section', 'help__section');
  appendChildren(author, authorHeading, buildAuthorBlock(), links);

  /* ④ 版權聲明 */
  const copyright = buildSection('help.copyright.heading', [
    'help.copyright.body1',
    'help.copyright.body2',
  ]);

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
