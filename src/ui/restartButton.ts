/**
 * 工具列重新開始鍵：按下先彈確認對話框，確認後才真正重設（誤觸代價太高）。
 * The toolbar restart button: a press opens a confirmation dialog first, and only confirmation resets (a mis-press is too costly).
 *
 * 這支只負責把按鈕接到 `ui/confirmDialog.ts` 的對話框，並在確認後呼叫 `onRestart`。
 * This module only wires the button to the dialog from `ui/confirmDialog.ts` and calls `onRestart` on confirmation.
 */

import { i18n, t } from '../i18n';
import { createConfirmDialog, type ConfirmDialogTexts } from './confirmDialog';

/**
 * 對話框的文案，以語系鍵取得；每次呼叫都重新查表，語系一換下一次就是新語言。
 * The dialog copy, looked up by locale key; fetched afresh on every call, so a locale change applies on the next call.
 */
function dialogTexts(): ConfirmDialogTexts {
  return {
    title: t('restart.title'),
    message: t('restart.message'),
    confirmLabel: t('restart.confirm'),
    cancelLabel: t('common.cancel'),
  };
}

export interface RestartConfirmOptions {
  /**
   * 工具列上的重新開始按鈕。
   * The toolbar's restart button.
   */
  button: HTMLButtonElement;
  /**
   * 對話框的掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * Where the dialog mounts; usually `layout.root` (also the scaled stage).
   */
  host: HTMLElement;
  /**
   * 確認通過後呼叫（真正執行重設的一方）。
   * Called once confirmed (the party that actually resets).
   */
  onRestart: () => void;
}

export interface RestartConfirm {
  /**
   * 收起對話框（例如結算覆蓋層已經在處理重設時）。
   * Closes the dialog (e.g. when the game-over overlay already handles the reset).
   */
  close(): void;
  /**
   * 移除事件綁定與對話框；頁面層級 teardown 用。
   * Removes the bindings and the dialog; for page-level teardown.
   */
  dispose(): void;
}

export function attachRestartConfirm(options: RestartConfirmOptions): RestartConfirm {
  const dialog = createConfirmDialog({
    host: options.host,
    ...dialogTexts(),
    onConfirm: options.onRestart,
  });

  /*
   * 對話框只建一次，語系變更要主動把文案換掉：`i18n.applyTo()` 只認 `data-i18n` 標記過的節點。
   * The dialog is built once, so a locale change must rewrite its copy by hand: `i18n.applyTo()` only knows nodes tagged with `data-i18n`.
   */
  const unsubscribe = i18n.subscribe((): void => dialog.setTexts(dialogTexts()));

  const onClick = (): void => dialog.open();
  options.button.addEventListener('click', onClick);

  return {
    close: (): void => dialog.close(),
    dispose(): void {
      unsubscribe();
      options.button.removeEventListener('click', onClick);
      dialog.dispose();
    },
  };
}
