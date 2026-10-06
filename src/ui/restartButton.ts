/**
 * 重新開始鍵的雙重確認。
 * Double confirmation for the restart button.
 *
 * 重新開始會**丟掉進行中的一局**，誤觸代價太高，所以第一次按下**不會**重設：按鈕進入
 * 「已要求確認」狀態（整顆轉警示色、文案改成「再按一次確認重新開始」），玩家必須在
 * 確認窗內再按一次才會真的重設；離開確認窗（逾時）就自動退回原樣，不留卡住的狀態。
 * 確認窗本身刻意短（三秒）：它防的是誤觸，不是審訊。
 * Restarting throws away the run in progress, so a stray tap must not reset: the first
 * press only arms the button (danger color, label switching to "press again to confirm"),
 * and a **second** press inside the confirm window performs the reset. Letting the window
 * lapse disarms automatically, so the button never sticks in the armed state. The window
 * is deliberately short (three seconds): it guards against accidents, not interrogates.
 *
 * 這支只管**確認狀態機**，不管重設本身要做什麼 —— 那由呼叫端透過 `onRestart` 決定
 * （與 `ui/gameOver.ts` 的分工相同）。
 * This module owns only the confirm state machine, not what a restart does — the caller
 * decides that via `onRestart` (same split as `ui/gameOver.ts`).
 */

/** 進入確認狀態後，多久沒有第二次按下就自動退回。 */
const DEFAULT_CONFIRM_WINDOW_MS = 3000;

/** 確認狀態下的提示文案（同步寫進 `title` 與 `aria-label`）。 */
const CONFIRM_LABEL = '再按一次確認重新開始';

export interface RestartConfirmOptions {
  /** 工具列上的重新開始按鈕。 */
  button: HTMLButtonElement;
  /** 雙重確認通過後呼叫（真正執行重設的一方）。 */
  onRestart: () => void;
  /** 覆寫確認窗時長；測試用。 */
  confirmWindowMs?: number;
}

export interface RestartConfirm {
  /** 退回未確認狀態（例如結算覆蓋層已經在處理重設時）。 */
  disarm(): void;
  /** 移除事件綁定；頁面層級 teardown 用。 */
  dispose(): void;
}

export function attachRestartConfirm(options: RestartConfirmOptions): RestartConfirm {
  const button = options.button;
  const confirmWindowMs = options.confirmWindowMs ?? DEFAULT_CONFIRM_WINDOW_MS;
  /* 進入確認狀態前先記下原本的文案，退回時原樣還原。 */
  const baseLabel = button.getAttribute('aria-label') ?? button.title;

  let armed = false;
  let timer = Number.NaN;

  const disarm = (): void => {
    armed = false;
    if (!Number.isNaN(timer)) {
      window.clearTimeout(timer);
      timer = Number.NaN;
    }
    button.classList.remove('toolbar__button--confirm');
    button.title = baseLabel;
    button.setAttribute('aria-label', baseLabel);
  };

  const onClick = (): void => {
    if (!armed) {
      /* 第一次按下：只進入確認狀態，不重設。 */
      armed = true;
      button.classList.add('toolbar__button--confirm');
      button.title = CONFIRM_LABEL;
      button.setAttribute('aria-label', CONFIRM_LABEL);
      timer = window.setTimeout(disarm, confirmWindowMs);
      return;
    }

    /* 第二次按下：確認成立，退回原樣後才執行重設。 */
    disarm();
    options.onRestart();
  };

  button.addEventListener('click', onClick);

  return {
    disarm,
    dispose(): void {
      disarm();
      button.removeEventListener('click', onClick);
    },
  };
}
