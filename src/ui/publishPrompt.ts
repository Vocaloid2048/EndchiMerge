/**
 * 首次的發布詢問彈窗：顯示名稱與分享同意只在首次開榜時問一次，之後到設定裡改。
 * The one-off publish prompt: the display name and sharing consent are asked once on the first board open, edited in settings afterwards.
 *
 * 「問過一次」很寬鬆：勾了同意、按「之後再說」、按 Esc、點背景，四者都算問過。
 * "Asked once" is deliberately lenient: ticking consent, "later", Esc and a backdrop click all count as asked.
 *
 * 這個彈窗沒有儲存鍵：欄位改完即套用，「回答」的方式就是把同意打開（那一刻 `setSharing(true)` 已上載）。
 * The popup has no save key: fields apply on their own, and answering means turning consent on (`setSharing(true)` has already uploaded by then).
 */

import type { LeaderboardSource } from '../game/leaderboard';
import { i18nAriaLabel, i18nText } from '../i18n';
import { appendChildren, el } from './dom';
import { createPublishFields } from './publishFields';

export interface PublishPromptOptions {
  /**
   * 掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * Where it mounts; usually `layout.root` (also the scaled stage).
   */
  host: HTMLElement;
  /**
   * 設定來源。
   * The settings source.
   */
  source: LeaderboardSource;
  /**
   * 儲存成功之後呼叫；`main.ts` 用它接著開榜，讓玩家立刻看到自己。
   * Called after a successful save; `main.ts` uses it to open the board so the player sees himself immediately.
   */
  onSaved?: () => void;
}

export interface PublishPromptView {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

export function createPublishPrompt(options: PublishPromptOptions): PublishPromptView {
  const { source, onSaved } = options;

  const root = el('section', 'publish-prompt');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  i18nAriaLabel(root, 'publishPrompt.title');

  const title = el('h2', 'publish-prompt__title');
  i18nText(title, 'publishPrompt.title');

  /*
   * 「之後要修改可以到設定」：這一組欄位是玩家設定，設定 popup 已上線，這句成立。
   * The "edit it later in settings" line: these fields are player settings and the settings popup is live, so the sentence holds.
   */
  const message = el('p', 'publish-prompt__message');
  i18nText(message, 'publishPrompt.message');

  /*
   * 這個彈窗的「回答」就是把同意打開：欄位改完即套用，第二次按鍵是多餘的；
   * 同意的那一刻 `setSharing(true)` 已經上載過了，這裡只負責收窗與開榜。
   * The answer to this popup is turning consent on: fields apply on their own and a second press would be redundant; `setSharing(true)` has already uploaded, so this only closes the popup and opens the board.
   */
  const fields = createPublishFields({
    source,
    onApply: (change): void => {
      if (change.field !== 'sharing' || !change.sharing) return;

      source.finishPublishPrompt();
      close();
      onSaved?.();
    },
  });

  const skip = el('button', 'publish-prompt__skip');
  skip.type = 'button';
  i18nText(skip, 'publishPrompt.skip');

  const actions = el('div', 'publish-prompt__actions');
  appendChildren(actions, skip);

  const card = el('div', 'publish-prompt__card');
  appendChildren(card, title, message, fields.element, actions);

  root.append(card);
  options.host.append(root);

  let previouslyFocused: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  };

  const onBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target === root) dismiss();
  };

  /**
   * 婉拒：分享維持關閉、榜保持空的，只是記下「問過了」。
   * Declines: sharing stays off and the board empty; only "asked" is recorded.
   */
  function dismiss(): void {
    source.finishPublishPrompt();
    close();
  }

  function onSkipClick(): void {
    dismiss();
  }

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
    /* 開窗是唯一同步欄位的時機（見 `ui/publishFields.ts` 的 `sync()`）。 */
    fields.sync();
    root.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);

    fields.focus();
  }

  skip.addEventListener('click', onSkipClick);

  return {
    get visible(): boolean {
      return !root.hidden;
    },

    open,
    close,

    dispose(): void {
      skip.removeEventListener('click', onSkipClick);
      fields.dispose();
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
