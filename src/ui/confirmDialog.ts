/**
 * 確認對話框（模態）：只管開關、鍵盤與焦點，確認後要做什麼由呼叫端決定。
 * The confirmation dialog (modal): owns only open/close, keyboard and focus; the action is the caller's.
 */

import { t } from '../i18n';
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
  onConfirm: () => void;
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

  function setTexts(texts: ConfirmDialogTexts): void {
    title.textContent = texts.title;
    message.textContent = texts.message;
    confirm.textContent = texts.confirmLabel;
    cancel.textContent = texts.cancelLabel ?? t('common.cancel');
    root.setAttribute('aria-label', texts.title);
  }

  setTexts(options);

  /*
   * 關閉後焦點還原到開啟這個對話框的元素。
   * On close, focus returns to whatever opened the dialog.
   */
  let previouslyFocused: HTMLElement | null = null;

  /**
   * 兩顆鈕就是整個對話框的可聚焦集合；Tab 只在它們之間循環。
   * The two buttons are the dialog's whole focusable set; Tab only cycles between them.
   */
  const focusables: readonly HTMLButtonElement[] = [cancel, confirm];

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    const index = focusables.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;

    const step = event.shiftKey ? -1 : 1;
    const next = (index + step + focusables.length) % focusables.length;
    event.preventDefault();
    focusables[next]?.focus();
  };

  const onBackdropPointerDown = (event: PointerEvent): void => {
    /* 點卡片外的背景＝取消。 */
    /* A click outside the card cancels. */
    if (event.target === root) close();
  };

  const onCancelClick = (): void => close();

  const onConfirmClick = (): void => {
    /* 先關閉再執行動作，否則畫面會先變、對話框還多留一幀。 */
    /* Close before acting, or the screen updates a frame before the dialog disappears. */
    close();
    options.onConfirm();
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
    root.hidden = false;
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
