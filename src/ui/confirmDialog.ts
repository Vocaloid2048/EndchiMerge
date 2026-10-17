/**
 * 確認對話框（模態）：只管開關、鍵盤與焦點，確認後要做什麼由呼叫端決定。
 * The confirmation dialog (modal): owns only open/close, keyboard and focus; the action is the caller's.
 */

import { formatMessage, t } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 對話框上的一組文案；`setTexts()` 可在語系變更後整組換掉。
 * One set of dialog copy; `setTexts()` replaces it wholesale after a locale change.
 */
export interface ConfirmDialogTexts {
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * 取消鈕的文字；未提供時用 `common.cancel` 的翻譯。
   * The cancel label; defaults to the `common.cancel` translation.
   */
  cancelLabel?: string;
  /**
   * 倒數期間確認鈕的文字；`{seconds}` 會被代入。未提供時在 `confirmLabel` 後加上 `（n）`。
   * The confirm label while the hold counts down; `{seconds}` is substituted. Defaults to
   * `confirmLabel` followed by `(n)`.
   */
  holdLabel?: string;
}

export interface ConfirmDialogOptions extends ConfirmDialogTexts {
  /**
   * 掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * The mount point, usually `layout.root` (which is also the scaled canvas).
   */
  host: HTMLElement;
  /**
   * 確認鈕的語氣：`'danger'`（預設，破壞性動作）或 `'accent'`。
   * The confirm button's tone: `'danger'` (default, destructive) or `'accent'`.
   */
  tone?: 'danger' | 'accent';
  /**
   * 確認鈕要先鎖住多少毫秒（倒數期間不可按）；0（預設）＝ 立刻可按。
   * How long the confirm button stays locked, in ms; 0 (the default) means it is pressable at once.
   */
  holdMs?: number;
  onConfirm: () => void;
  /**
   * 取消時的通知（例如把剛翻動的開關撥回去）；未提供時什麼都不做。
   * Notified on cancel (e.g. to flip a switch back); omitted means nothing happens.
   */
  onCancel?: () => void;
}

export interface ConfirmDialog {
  /**
   * 開啟對話框；已經開著時不做事。
   * Opens the dialog; a no-op when it is already open.
   */
  open(): void;
  /**
   * 關閉對話框（等同取消）；已經關著時不做事。
   * Closes the dialog (equivalent to cancelling); a no-op when already closed.
   */
  close(): void;
  readonly visible: boolean;
  /**
   * 換一組文案（語系變更時呼叫）；不影響開關狀態。
   * Replaces the copy (called on a locale change); the open state is untouched.
   */
  setTexts(texts: ConfirmDialogTexts): void;
  /**
   * 移除節點與事件綁定；頁面層級 teardown 用。
   * Removes the nodes and listeners; for page-level teardown.
   */
  dispose(): void;
}

export function createConfirmDialog(options: ConfirmDialogOptions): ConfirmDialog {
  const tone = options.tone ?? 'danger';

  const root = el('div', 'confirm');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const title = el('h2', 'confirm__title');
  const message = el('p', 'confirm__message');

  const cancel = el('button', 'confirm__action confirm__action--ghost');
  cancel.type = 'button';

  const confirm = el('button', `confirm__action confirm__action--${tone}`);
  confirm.type = 'button';

  const actions = el('div', 'confirm__actions');
  appendChildren(actions, cancel, confirm);

  const card = el('div', 'confirm__card');
  appendChildren(card, title, message, actions);

  root.append(card);
  options.host.append(root);

  /*
   * 倒數：`holdUntil` 是時戳而不是「剩幾秒」，所以分頁被凍結再回來時不會少算。
   * The hold is a timestamp rather than a countdown value, so a frozen tab does not under-count.
   */
  const holdMs = Math.max(0, options.holdMs ?? 0);
  let texts: ConfirmDialogTexts = options;
  let holdUntil = 0;
  let holdTimer: ReturnType<typeof setInterval> | null = null;

  /** 依「還在倒數嗎」寫確認鈕：鎖住時顯示剩餘秒數，鎖完就是原來的標籤。 */
  function renderConfirm(): void {
    const remaining = holdUntil - Date.now();

    if (remaining <= 0) {
      confirm.disabled = false;
      confirm.textContent = texts.confirmLabel;
      return;
    }

    confirm.disabled = true;
    confirm.textContent = formatMessage(texts.holdLabel ?? '{confirmLabel}（{seconds}）', {
      confirmLabel: texts.confirmLabel,
      seconds: Math.ceil(remaining / 1000),
    });
  }

  function stopHold(): void {
    if (holdTimer !== null) {
      clearInterval(holdTimer);
      holdTimer = null;
    }

    holdUntil = 0;
    renderConfirm();
  }

  function startHold(): void {
    if (holdMs <= 0) return;

    holdUntil = Date.now() + holdMs;
    renderConfirm();

    /* 200ms 一跳：秒數換得夠準，又不至於每一幀碰 DOM。 */
    holdTimer = setInterval((): void => {
      renderConfirm();
      if (holdUntil - Date.now() <= 0) stopHold();
    }, 200);
  }

  function setTexts(next: ConfirmDialogTexts): void {
    texts = next;
    title.textContent = next.title;
    message.textContent = next.message;
    cancel.textContent = next.cancelLabel ?? t('common.cancel');
    root.setAttribute('aria-label', next.title);
    renderConfirm();
  }

  setTexts(options);

  /*
   * 關閉後焦點還原到開啟這個對話框的元素。
   * On close, focus returns to whatever opened the dialog.
   */
  let previouslyFocused: HTMLElement | null = null;

  /**
   * 整個對話框的可聚焦集合；Tab 只在它們之間循環。倒數期間確認鈕是停用的，
   * 那時只剩取消可聚焦（把焦點丟給停用鈕會什麼都不發生）。
   * The dialog's focusable set; Tab only cycles between them. While the hold runs the confirm
   * button is disabled, leaving cancel alone (focusing a disabled button does nothing).
   */
  const focusables = (): readonly HTMLButtonElement[] =>
    confirm.disabled ? [cancel] : [cancel, confirm];

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const order = focusables();
    const index = order.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;

    const step = event.shiftKey ? -1 : 1;
    const next = (index + step + order.length) % order.length;
    event.preventDefault();
    order[next]?.focus();
  };

  const onBackdropPointerDown = (event: PointerEvent): void => {
    /* 點卡片外的背景＝取消。 */
    /* A click outside the card cancels. */
    if (event.target === root) close();
  };

  const onCancelClick = (): void => {
    close();
    options.onCancel?.();
  };

  const onConfirmClick = (): void => {
    /* 先關閉再執行動作，否則畫面會先變、對話框還多留一幀。 */
    /* Close before acting, or the screen updates a frame before the dialog disappears. */
    close();
    options.onConfirm();
  };

  function close(): void {
    if (root.hidden) return;

    root.hidden = true;
    stopHold();
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
    startHold();
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);

    /* 預設焦點放在取消：破壞性動作不該被一個誤按的 Enter 觸發。 */
    /* Focus starts on cancel so a stray Enter cannot fire a destructive action. */
    cancel.focus();
  }

  cancel.addEventListener('click', onCancelClick);
  confirm.addEventListener('click', onConfirmClick);

  return {
    get visible(): boolean {
      return !root.hidden;
    },

    open,
    close,
    setTexts,

    dispose(): void {
      cancel.removeEventListener('click', onCancelClick);
      confirm.removeEventListener('click', onConfirmClick);
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
