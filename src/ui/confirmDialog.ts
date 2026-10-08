/**
 * 確認對話框（模態）。
 * The confirmation dialog (modal).
 *
 * 有些動作一旦做了就收不回來 —— 重新開始會**丟掉進行中的一局**。這種動作需要一次明確的
 * 應答，而不是一顆按下去就生效的按鈕。這支提供一個可重用的模態：標題、說明、取消、確認，
 * 確認鈕的語氣（警示／強調）可選。
 * Some actions cannot be undone — restarting **throws away the run in progress**. Those need an
 * explicit answer rather than a button that fires on the first press. This module provides a
 * reusable modal: a title, a message, cancel and confirm, with the confirm button's tone
 * (danger / accent) selectable.
 *
 * 分工與 `ui/gameOver.ts` 相同：這裡**只管對話框本身**（開、關、鍵盤、焦點），按下確認後
 * 要做什麼由呼叫端透過 `onConfirm` 決定。
 * The split matches `ui/gameOver.ts`: this owns only the dialog itself (open, close, keyboard,
 * focus); what a confirmation *does* is the caller's business, via `onConfirm`.
 *
 * 無障礙 / Accessibility:
 * - `role="dialog"` ＋ `aria-modal="true"`：輔助技術知道這是一層蓋住其餘介面的模態。
 * - 開啟時把焦點移到**取消**鈕：破壞性動作不該一按 Enter 就成立。Tab 在兩顆鈕之間循環，
 *   焦點不會跑到被遮住的介面上。
 * - Esc 與點擊暗色背景都＝取消（常見的模態慣例）；關閉後焦點還原到開啟前的元素。
 * - focus starts on **cancel**: a destructive action must not fire on a stray Enter. Tab
 *   cycles between the two buttons so focus cannot escape behind the overlay. Esc and a
 *   backdrop click both cancel; focus returns to the element that opened the dialog.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，跟整張畫布一起被 `ui/scale.ts` 等比縮放），
 * 與其他面板同一套座標語言。
 * Sizes are **design pixels** (it mounts inside `.stage-scale` and scales with the canvas via
 * `ui/scale.ts`), the same coordinate language as every other panel.
 */

import { t } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 對話框上的一組文案。
 * One set of dialog copy.
 *
 * 獨立成型別是為了讓 `setTexts()` 能在**語系變更後**重寫一次 —— 對話框只在建立時被建一次，
 * 之後不會重建，所以文字必須能被換掉（見 `ui/restartButton.ts`）。
 * A separate type so `setTexts()` can rewrite the copy **after a locale change**: the dialog is
 * built once and never rebuilt, so its strings have to be replaceable (see
 * `ui/restartButton.ts`).
 */
export interface ConfirmDialogTexts {
  title: string;
  message: string;
  confirmLabel: string;
  /** 取消鈕的文字；未提供時用 `common.cancel` 的翻譯。 */
  cancelLabel?: string;
}

export interface ConfirmDialogOptions extends ConfirmDialogTexts {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /**
   * 確認鈕的語氣：`'danger'`（預設，警示色，用於破壞性動作）或 `'accent'`（強調色）。
   * The confirm button's tone: `'danger'` (default, for destructive actions) or `'accent'`.
   */
  tone?: 'danger' | 'accent';
  /** 按下確認後呼叫（真正執行動作的一方）。 */
  onConfirm: () => void;
}

export interface ConfirmDialog {
  /** 開啟對話框；已經開著時不做事。 */
  open(): void;
  /** 關閉對話框（等同取消）；已經關著時不做事。 */
  close(): void;
  readonly visible: boolean;
  /** 換一組文案（語系變更時呼叫）；不影響開關狀態。 */
  setTexts(texts: ConfirmDialogTexts): void;
  /** 移除節點與事件綁定；頁面層級 teardown 用。 */
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

  /** 目前的一組文案；`setTexts()` 會整組換掉。 */
  function setTexts(texts: ConfirmDialogTexts): void {
    title.textContent = texts.title;
    message.textContent = texts.message;
    confirm.textContent = texts.confirmLabel;
    cancel.textContent = texts.cancelLabel ?? t('common.cancel');
    root.setAttribute('aria-label', texts.title);
  }

  setTexts(options);

  /*
   * 關閉後要把焦點還原到「開啟這個對話框的那顆鈕」，否則鍵盤使用者關掉之後會落到頁面開頭。
   * On close, focus returns to whatever opened the dialog, so a keyboard user does not get
   * dumped back at the top of the page.
   */
  let previouslyFocused: HTMLElement | null = null;

  /** 兩顆鈕就是整個對話框的可聚焦集合；Tab 只在它們之間循環。 */
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
    /* 點卡片外的暗色背景＝取消；點卡片本身不關。 */
    if (event.target === root) close();
  };

  const onCancelClick = (): void => close();

  const onConfirmClick = (): void => {
    /* 先關閉再執行動作：反過來的話畫面會先變，對話框還停在上面一幀。 */
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

    /* 預設焦點放在取消：破壞性動作不該一按 Enter 就成立。 */
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
