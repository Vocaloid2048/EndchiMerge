/**
 * 手機把關：直向時蓋住整個畫面請玩家橫放，橫向時自動嘗試全螢幕。
 * The mobile gate: covers the screen and asks for landscape when the device is upright, and tries
 * to go fullscreen once it is turned.
 *
 * 蓋在**畫布之外**（`#app` 的直接子節點），所以不受 1920×1080 的等比縮放影響 —— 縮放後的畫布
 * 在手機上只剩三成多，提示字會小到讀不到。
 * It sits **outside the design canvas** (a direct child of `#app`), so the 1920×1080 scaling does
 * not touch it: a scaled canvas is barely a third of its size on a phone, and the message would be
 * unreadable.
 */

import { i18n, i18nText } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 手持裝置：粗指標 **且** 不能懸停。桌面觸控螢幕仍然可以懸停（滑鼠），所以兩個條件都要。
 * A handheld device is a coarse pointer that cannot hover. A touchscreen laptop can still hover,
 * so both conditions are required.
 */
const HANDHELD_QUERY = '(hover: none) and (pointer: coarse)';

/**
 * 能不能強制轉向。只有同時具備全螢幕與 `screen.orientation.lock` 的瀏覽器（主要是 Android
 * 的 Chrome）才可以；iOS Safari 兩者都沒有，按了不會有反應，那比不給按鈕更糟 —— 所以按鈕會
 * 在這種裝置上直接隱藏，只留文字提示。
 * Whether the orientation can be forced. Only browsers that have both element fullscreen and
 * `screen.orientation.lock` (mostly Chrome on Android) can do it. iOS Safari has neither, and a
 * button that does nothing is worse than no button, so it is hidden there and the text stands alone.
 */
function canForceLandscape(): boolean {
  const orientation = screen.orientation as (ScreenOrientation & { lock?: unknown }) | undefined;

  return typeof document.documentElement.requestFullscreen === 'function' && typeof orientation?.lock === 'function';
}

export interface MobileGate {
  dispose(): void;
}

/**
 * 建立手機把關。桌面上不會有任何節點出現（判定不過就一直 `hidden`）。
 * Builds the mobile gate. Nothing appears on a desktop: the check fails and it stays `hidden`.
 */
export function createMobileGate(options: { host: HTMLElement }): MobileGate {
  const root = el('div', 'mobile-gate');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');

  const card = el('div', 'mobile-gate__card');

  /* 手機圖示只是方向示意，交給 CSS 轉動；報讀器不需要知道它。 */
  /* The phone glyph only hints at the direction and is turned by CSS; a screen reader has no use for it. */
  const glyph = el('span', 'mobile-gate__glyph');
  glyph.setAttribute('aria-hidden', 'true');

  const title = el('h2', 'mobile-gate__title');
  i18nText(title, 'mobile.rotateTitle');

  const body = el('p', 'mobile-gate__body');
  i18nText(body, 'mobile.rotateBody');

  const action = el('button', 'mobile-gate__action');
  action.type = 'button';
  i18nText(action, 'mobile.landscape');
  action.hidden = !canForceLandscape();

  appendChildren(card, glyph, title, body, action);
  root.append(card);
  options.host.append(root);

  const handheld = window.matchMedia(HANDHELD_QUERY);
  const portrait = window.matchMedia('(orientation: portrait)');

  /**
   * 使用者已經碰過畫面。全螢幕必須在**手勢之中**請求，所以「自動」只能定義成
   * 「玩家第一次互動之後，一橫放就進去」。
   * The user has interacted. Fullscreen may only be requested **inside a gesture**, so "automatic"
   * can only mean "once the player has touched the screen, going landscape enters it".
   */
  let interacted = false;

  /**
   * 玩家自己退出全螢幕之後就不再自動搶回去 —— 全螢幕是「幫你一把」，不是鎖死。
   * Once the player leaves fullscreen by hand it is never taken back automatically: fullscreen is a
   * nudge, not a cage.
   */
  let autoFullscreen = true;

  const sync = (): void => {
    root.hidden = !(handheld.matches && portrait.matches);
    if (root.hidden && handheld.matches && interacted) void enterFullscreen();
  };

  async function enterFullscreen(force = false): Promise<void> {
    if (document.fullscreenElement !== null) return;
    if (!force && !autoFullscreen) return;

    const element = document.documentElement;
    const request = element.requestFullscreen;
    if (typeof request !== 'function') return;

    try {
      await request.call(element, { navigationUI: 'hide' });
      await lockLandscape();
    } catch {
      /* 未經手勢或被使用者拒絕：維持現狀，不是錯誤。 */
      /* No gesture, or the player declined: stay as we are. This is not an error. */
    }
  }

  async function lockLandscape(): Promise<void> {
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (target: 'landscape') => Promise<void> })
      | undefined;

    try {
      await orientation?.lock?.('landscape');
    } catch {
      /* 不支援（iOS／桌機）—— 玩家自己轉向就好。 */
      /* Unsupported (iOS, desktop): the player rotates by hand. */
    }
  }

  const onPointerDown = (): void => {
    interacted = true;
    if (handheld.matches && !portrait.matches) void enterFullscreen();
  };

  /* 按鈕是給「還在直向」的玩家：按下去直接全螢幕 ＋ 鎖成橫向，不必自己轉。 */
  /* The button is for a player still in portrait: it goes fullscreen and locks to landscape. */
  const onAction = (): void => {
    interacted = true;
    void enterFullscreen(true);
  };

  const onFullscreenChange = (): void => {
    if (document.fullscreenElement === null) autoFullscreen = false;
  };

  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('pointerdown', onPointerDown, true);
  action.addEventListener('click', onAction);
  handheld.addEventListener('change', sync);
  portrait.addEventListener('change', sync);
  window.addEventListener('resize', sync);

  const detachI18n = i18n.subscribe((): void => {
    i18nText(title, 'mobile.rotateTitle');
    i18nText(body, 'mobile.rotateBody');
    i18nText(action, 'mobile.landscape');
  });

  sync();

  return {
    dispose(): void {
      window.removeEventListener('pointerdown', onPointerDown, true);
      action.removeEventListener('click', onAction);
      handheld.removeEventListener('change', sync);
      portrait.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      detachI18n();
      root.remove();
    },
  };
}
