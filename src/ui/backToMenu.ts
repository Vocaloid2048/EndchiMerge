/**
 * 返回選單鍵：按下先記錄並上載這一局，然後回到選單（＝不帶 `?game=` 的路徑）。
 * The back-to-menu button: records and uploads the run, then returns to the menu (the path without `?game=`).
 */

export interface BackToMenuOptions {
  /**
   * 版面左上角的返回鍵（`layout.chrome.back`）。
   * The back button at the layout's top-left corner.
   */
  button: HTMLButtonElement;
  /**
   * 離開這一頁要做的事；記錄、上載與導航都由呼叫端決定。
   * What leaving the page does; recording, uploading and navigating are the caller's calls.
   */
  onLeave: () => void;
}

export interface BackToMenu {
  /**
   * 移除事件綁定；頁面層級 teardown 用。
   * Removes the binding; for page-level teardown.
   */
  dispose(): void;
}

export function attachBackToMenu(options: BackToMenuOptions): BackToMenu {
  const onClick = (): void => options.onLeave();

  options.button.addEventListener('click', onClick);

  return {
    dispose(): void {
      options.button.removeEventListener('click', onClick);
    },
  };
}
