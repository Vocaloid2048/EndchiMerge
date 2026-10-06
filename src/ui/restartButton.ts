/**
 * 工具列重新開始鍵。
 * The toolbar restart button.
 *
 * 重新開始會**丟掉進行中的一局**，誤觸代價太高，所以按下時不直接重設，而是彈出一個
 * 確認對話框問「是否重新開始」；只有按下對話框裡的「重新開始」才會真的重設，取消（或
 * Esc／點背景）則原樣退回。
 * Restarting throws away the run in progress, so a press does not reset: it opens a
 * confirmation dialog asking whether to restart. Only the dialog's "restart" performs the
 * reset; cancel (or Esc / a backdrop click) leaves everything as it was.
 *
 * **為何不是「再按一次同一顆鈕」**：使用者定案改為對話框。二次按鈕的確認窗只有三秒、
 * 狀態還留在工具列上（整顆轉紅），玩家常在還來不及讀完提示時就逾時；對話框把問題講清楚、
 * 給一個看得見的出口，取消也不需要玩家自己發現「其實可以不理它」。對話框本身由
 * `ui/confirmDialog.ts` 提供 —— 這支只負責**把工具列按鈕接到那個對話框**，以及
 * 確認通過後呼叫 `onRestart`。
 * **Why not "press the same button twice"**: the user's decision is a dialog. The old two-tap
 * confirm had a three-second window and left its state on the toolbar (turning the button red),
 * so players often timed out before reading it; a dialog states the question plainly, gives a
 * visible way out, and cancelling needs no discovery. The dialog itself comes from
 * `ui/confirmDialog.ts` — this module only **wires the toolbar button to that dialog** and
 * calls `onRestart` once it is confirmed.
 */

import { createConfirmDialog } from './confirmDialog';

/** 對話框的文案（使用者定案）。 */
const DIALOG = {
  title: '重新開始？',
  message: '進行中的這一局分數與版面都會清空，確定要重新開始嗎？',
  confirmLabel: '重新開始',
  cancelLabel: '取消',
} as const;

export interface RestartConfirmOptions {
  /** 工具列上的重新開始按鈕。 */
  button: HTMLButtonElement;
  /** 對話框的掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /** 確認通過後呼叫（真正執行重設的一方）。 */
  onRestart: () => void;
}

export interface RestartConfirm {
  /** 收起對話框（例如結算覆蓋層已經在處理重設時）。 */
  close(): void;
  /** 移除事件綁定與對話框；頁面層級 teardown 用。 */
  dispose(): void;
}

export function attachRestartConfirm(options: RestartConfirmOptions): RestartConfirm {
  const dialog = createConfirmDialog({
    host: options.host,
    title: DIALOG.title,
    message: DIALOG.message,
    confirmLabel: DIALOG.confirmLabel,
    cancelLabel: DIALOG.cancelLabel,
    onConfirm: options.onRestart,
  });

  const onClick = (): void => dialog.open();
  options.button.addEventListener('click', onClick);

  return {
    close: (): void => dialog.close(),
    dispose(): void {
      options.button.removeEventListener('click', onClick);
      dialog.dispose();
    },
  };
}
