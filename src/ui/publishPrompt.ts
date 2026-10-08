/**
 * 首次的發布詢問彈窗。
 * The one-off publish prompt.
 *
 * 使用者定案：顯示名稱與「同意分享成績」這兩件事，**只在首次按下排行榜時單獨問一次**
 * （見 `game/leaderboard.ts` 的 `publishPromptDone`），之後要改就到設定裡改 —— 榜單本身
 * 不再內嵌輸入框，看榜就是看榜。
 * The user's decision: the display name and the sharing consent are asked **once, on their own,
 * the first time the leaderboard is opened** (see `publishPromptDone` in `game/leaderboard.ts`)
 * and edited in settings afterwards. The board itself carries no input field — looking at the
 * board is just looking at the board.
 *
 * 「問過一次」的判定很寬鬆：**勾了同意、按「之後再說」、按 Esc、點背景，四者都算問過了**。
 * 不這樣做的話，只要玩家關掉一次，下次開榜又會再彈一次 —— 那就不是「首次」了。
 * "Asked once" is deliberately lenient: **ticking consent, "之後再說", Esc and a backdrop click all
 * count as asked.** Otherwise a single dismissal would make the prompt reappear on every later
 * open, which is exactly what "once" is meant to avoid.
 *
 * **這個彈窗沒有儲存鍵**（使用者定案，與設定同步）：欄位改完就套用，所以「回答」的方式是
 * **把同意打開** —— 那一刻`setSharing(true)` 已經把本機紀錄推上榜了，這裡只負責收窗、開榜，
 * 讓玩家立刻看到自己那一筆。「之後再說」不勾同意，榜便維持空的。
 * **This popup has no save key** (the user's decision, matching settings): fields apply on their
 * own, so the way to answer is **to turn consent on** — at which point `setSharing(true)` has
 * already uploaded the local record, leaving this popup to close itself and open the board so the
 * player sees his own row. "之後再說" leaves consent off and the board empty.
 *
 * 欄位本身（名稱、同意、驗證）在 `ui/publishFields.ts`；這裡只管彈窗的開關、鍵盤與焦點，
 * 分工與 `ui/confirmDialog.ts` 相同。
 * The fields themselves live in `ui/publishFields.ts`; this owns only the modal's open/close,
 * keyboard and focus — the same split as `ui/confirmDialog.ts`.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，跟整張畫布一起被 `ui/scale.ts` 等比縮放）。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas).
 */

import type { LeaderboardSource } from '../game/leaderboard';
import { i18nAriaLabel, i18nText } from '../i18n';
import { appendChildren, el } from './dom';
import { createPublishFields } from './publishFields';

export interface PublishPromptOptions {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /** 設定來源。 */
  source: LeaderboardSource;
  /** 儲存成功之後呼叫；`main.ts` 用它接著開榜，讓玩家立刻看到自己。 */
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
   * 「之後要修改可以到設定」是使用者定案的流程（這一組欄位也是**玩家設定**）。設定 popup
   * 現在已經上線，這句成立。文案住在 `src/i18n/messages/`。
   * The "edit it later in settings" line follows the user's decision (these fields are **player
   * settings**). The settings popup is live now, so the sentence holds. The copy lives in
   * `src/i18n/messages/`.
   */
  const message = el('p', 'publish-prompt__message');
  i18nText(message, 'publishPrompt.message');

  /*
   * 這個彈窗的「回答」就是**把同意打開**：欄位改完即套用，所以第二次按鍵是多餘的。同意的那一刻
   * `setSharing(true)` 已經上載過了（見 `game/leaderboard.ts`），這裡只負責收窗與開榜。
   * The answer to this popup is **turning consent on**: the fields apply on their own, so a second
   * press would be redundant. `setSharing(true)` has already uploaded by then (see
   * `game/leaderboard.ts`); this only closes the popup and opens the board.
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

  /** 婉拒：分享維持關閉、榜保持空的，只是記下「問過了」。 */
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
