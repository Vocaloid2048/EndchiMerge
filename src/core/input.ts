/**
 * 投放輸入：把指標／鍵盤的位置換成虛擬座標後轉呼叫回；投放規則的判斷留在 `GameSession`。
 * Drop input: translates pointer/keyboard positions into virtual coordinates and hands off; the drop rules stay in `GameSession`.
 */

import type { Viewport, VirtualPoint } from '../render/viewport';

export interface DropInputOptions {
  /**
   * 接收指標事件的元素，通常就是遊戲畫布。
   * The element receiving pointer events, normally the game canvas.
   */
  target: HTMLElement;
  /**
   * 用於把 CSS 像素換算成虛擬座標。
   * Converts CSS pixels into virtual coordinates.
   */
  viewport: Viewport;
  /**
   * 瞄準位置改變。
   * The aim position changed.
   */
  onAim: (x: number) => void;
  /**
   * 確認投放，帶上虛擬座標（技能選取模式下同一顆按鈕要改為選球，判斷在 `GameSession`）；
   * 鍵盤沒有座標，傳 `null` ＝ 照目前瞄準點投放。
   * Confirms the drop with virtual coordinates (while a skill selects, the same press picks a dumpling — `GameSession` decides); the keyboard passes `null` (drop at the current aim).
   */
  onDrop: (point: VirtualPoint | null) => void;
  /**
   * 取消目前的技能選取（`Esc`）；未提供時 `Esc` 不做任何事。
   * Cancels the current skill selection (`Esc`); without it `Esc` does nothing.
   */
  onCancel?: () => void;
  /**
   * 鍵盤一次移動的虛擬距離；預設 20。
   * A keyboard step in virtual units; defaults to 20.
   */
  keyStep?: number;
  /**
   * 讀取目前的瞄準位置：鍵盤每次按鍵都以它為基準加減 `keyStep`，
   * 牆壁夾制（與 resize 後的重夾）因此自然反映在下一步。
   * Reads the current aim: each arrow press offsets this base by `keyStep`, so wall clamping (and any re-clamp from a resize) shows up in the next step for free.
   */
  readAim: () => number;
}

const DEFAULT_KEY_STEP = 20;

/**
 * 會攔截的按鍵，避免方向鍵與空白滾動頁面。
 * Keys that are intercepted so the arrows and Space do not scroll the page.
 */
const MOVE_LEFT_KEYS = new Set(['ArrowLeft']);
const MOVE_RIGHT_KEYS = new Set(['ArrowRight']);
/** `ArrowDown`（↓ 即投放）＋ 空白與 Enter。 */
const DROP_KEYS = new Set(['Enter', ' ', 'Spacebar', 'ArrowDown']);
export function attachDropInput(options: DropInputOptions): () => void {
  const { target, viewport, onAim, onDrop, onCancel, readAim } = options;
  const keyStep = options.keyStep ?? DEFAULT_KEY_STEP;

  /**
   * 把事件的視窗座標換成虛擬 X。
   * Converts an event's client coordinates into a virtual X.
   *
   * 用 `getBoundingClientRect()` 而非 `offsetX`；rect 是「已縮放」的，要整個交給
   * `viewport.toVirtual()` 除掉縮放，否則指標會比畫面跑得快 k 倍。
   * Uses the bounding rect rather than `offsetX`; the rect is the scaled one, so it goes to
   * `viewport.toVirtual()` whole to divide the scale back out — otherwise the pointer outruns the screen by a factor of k.
   */
  const aimAt = (clientX: number, clientY: number): VirtualPoint | null => {
    const rect = target.getBoundingClientRect();
    const point = viewport.toVirtual(rect, clientX, clientY);
    if (point === null) return null;
    onAim(point.x);
    return point;
  };

  const handlePointerMove = (event: PointerEvent): void => {
    aimAt(event.clientX, event.clientY);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    /*
     * 先瞄準再確認：觸控沒有 hover 階段，少了第一步，第一次點擊會掉在上一次的位置。
     * Aim before confirming: touch has no hover phase, so without it the first tap lands wherever the aim happened to be.
     */
    const point = aimAt(event.clientX, event.clientY);
    onDrop(point);

    /* 捕獲指標，讓拖到畫布外時仍能繼續瞄準。 */
    capturePointer(target, event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      onCancel?.();
      return;
    }

    if (DROP_KEYS.has(event.key)) {
      event.preventDefault();
      /* 鍵盤沒有座標：`null` ＝ 照目前瞄準點投放。 */
      onDrop(null);
      return;
    }

    const isLeft = MOVE_LEFT_KEYS.has(event.key);
    const isRight = MOVE_RIGHT_KEYS.has(event.key);
    if (!isLeft && !isRight) return;

    /* 阻止方向鍵滾動頁面。 */
    event.preventDefault();
    /*
     * 基準取現在的瞄準位置：貼牆時基準就是牆，往另一邊按一下就走一步。
     * The base is the aim's current value: at the wall the base is the wall, so one press of the other key moves one step.
     */
    onAim(readAim() + (isLeft ? -keyStep : keyStep));
  };

  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('keydown', handleKeyDown);

  return (): void => {
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerdown', handlePointerDown);
    target.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * 盡力捕獲指標；失敗不影響投放。
 * Best-effort pointer capture; a failure never affects the drop.
 */
function capturePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.setPointerCapture !== 'function') return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* 部分瀏覽器對已釋放的 pointerId 會拋錯。 */
  }
}
