/**
 * 返回選單鍵：未開局就立刻回去；已開局則先彈確認，確認鈕鎖五秒後才可離開。
 * The back-to-menu button: an untouched run leaves at once; a started run gets a confirmation
 * whose confirm button stays locked for five seconds.
 */

import { i18n, t } from '../i18n';
import { createConfirmDialog, type ConfirmDialogTexts } from './confirmDialog';

/**
 * 確認鈕鎖住多久（毫秒）。與切換模式、開啟無盡模式同一個五秒 —— 三者都會結束目前這一局。
 * How long the confirm button stays locked, in ms. The same five seconds as a mode switch or
 * turning on endless mode: all three end the run in progress.
 */
export const LEAVE_HOLD_MS = 5000;

/**
 * 對話框文案，以語系鍵取得；每次呼叫都重新查表，語系一換下一次就是新語言。
 * The dialog copy, looked up by locale key; fetched afresh on every call, so a locale change applies next time.
 */
function dialogTexts(): ConfirmDialogTexts {
  return {
    title: t('back.title'),
    message: t('back.message'),
    confirmLabel: t('back.confirm'),
    cancelLabel: t('common.cancel'),
  };
}

export interface BackToMenuOptions {
  /**
   * 版面左上角的返回鍵（`layout.chrome.back`）。
   * The back button at the layout's top-left corner.
   */
  button: HTMLButtonElement;
  /**
   * 對話框的掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * Where the dialog mounts; usually `layout.root` (also the scaled canvas).
   */
  host: HTMLElement;
  /**
   * 這一局是否已經開始 —— 每個遊戲自己定義：目前的合成遊戲是「投放過至少一顆」。
   * Whether this run has started — each game defines it; today's merge game uses "has dropped at least once".
   */
  hasStarted: () => boolean;
  /**
   * 確認離開（或根本未開局）時呼叫；記錄、上載與導航由呼叫端負責。
   * Called on a confirmed leave (or when no run has started); the caller records, uploads and navigates.
   */
  onLeave: () => void;
}

export interface BackToMenu {
  /**
   * 移除事件綁定與對話框；頁面層級 teardown 用。
   * Removes the binding and the dialog; for page-level teardown.
   */
  dispose(): void;
}

export function attachBackToMenu(options: BackToMenuOptions): BackToMenu {
  const dialog = createConfirmDialog({
    host: options.host,
    ...dialogTexts(),
    tone: 'accent',
    holdMs: LEAVE_HOLD_MS,
    onConfirm: options.onLeave,
  });

  /*
   * 對話框只建一次，語系變更要主動換文案：`i18n.applyTo()` 只認 `data-i18n` 標記過的節點。
   * The dialog is built once, so a locale change must rewrite its copy by hand: `i18n.applyTo()`
   * only knows nodes tagged with `data-i18n`.
   */
  const unsubscribe = i18n.subscribe((): void => dialog.setTexts(dialogTexts()));

  const onClick = (): void => {
    /* 一顆都未投：場上沒有可失去的東西，直接回去，不必讓玩家等五秒。
       Nothing dropped yet: there is nothing to lose, so leave without making the player wait. */
    if (!options.hasStarted()) {
      options.onLeave();

      return;
    }

    dialog.open();
  };

  options.button.addEventListener('click', onClick);

  return {
    dispose(): void {
      unsubscribe();
      options.button.removeEventListener('click', onClick);
      dialog.dispose();
    },
  };
}
