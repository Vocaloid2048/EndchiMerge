/**
 * 投放輸入。
 * Drop input.
 *
 * 只做一件事：把**指標位置換成虛擬座標**，然後轉呼叫回。這裡不做夾制、不做投放判定，
 * 那些屬於 `GameSession` —— 輸入層若開始決定遊戲規則，規則就會散在兩個地方。
 * It does exactly one thing: translate a pointer position into virtual coordinates and
 * hand it off. Clamping and drop rules belong to `GameSession`; once an input layer
 * starts deciding rules they end up split across two files.
 *
 * 事件綁定刻意**回傳取消函式**，而不是自己管生命週期，方便日後做頁面切換（M6 的解鎖頁）。
 * The bindings return a disposer rather than owning a lifecycle, so page switching
 * (the M6 unlock screen) can tear them down.
 *
 * 鍵盤支援（方向鍵移動、空白／Enter 投放）與滑鼠走同一組回呼，所以兩種操作在
 * `GameSession` 眼中完全等價。
 * Keyboard support funnels through the same callbacks, so pointer and keyboard are
 * indistinguishable to `GameSession`.
 */

import type { Viewport } from '../render/viewport';

export interface DropInputOptions {
  /** 接收指標事件的元素，通常就是遊戲畫布。 */
  target: HTMLElement;
  /** 用於把 CSS 像素換算成虛擬座標。 */
  viewport: Viewport;
  /** 瞄準位置改變。 */
  onAim: (x: number) => void;
  /** 在目前瞄準位置投放。 */
  onDrop: () => void;
  /** 鍵盤一次移動的虛擬距離；預設 20。 */
  keyStep?: number;
  /** 初始瞄準位置；鍵盤用它累加相對位移。 */
  initialAim?: number;
}

const DEFAULT_KEY_STEP = 20;

/** 會攔截的按鍵，避免方向鍵與空白滾動頁面。 */
const MOVE_LEFT_KEYS = new Set(['ArrowLeft', 'ArrowUp']);
const MOVE_RIGHT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const DROP_KEYS = new Set(['Enter', ' ', 'Spacebar']);

export function attachDropInput(options: DropInputOptions): () => void {
  const { target, viewport, onAim, onDrop } = options;
  const keyStep = options.keyStep ?? DEFAULT_KEY_STEP;

  /*
   * 鍵盤需要知道「目前在哪」，但輸入層不該保存遊戲狀態。折衷做法是記住最後一次
   * 自己送出的值，並以**相對位移**回報 —— 硬算絕對值會讓方向鍵在貼牆夾制後失去同步。
   * Keyboard needs a current position but this layer must not own game state, so it
   * tracks the last value it sent and reports relative deltas; an absolute value would
   * desync once the session clamps at a wall.
   */
  let lastAim = options.initialAim ?? 0;

  const aim = (x: number): void => {
    lastAim = x;
    onAim(x);
  };

  /**
   * 把事件的視窗座標換成虛擬 X。
   * Convert an event's client coordinates into a virtual X.
   *
   * 用 `getBoundingClientRect()` 而非 `offsetX`：`offsetX` 以**事件目標**為基準，
   * 一旦畫布內有子元素就會偏移，而 rect 永遠是視窗座標，可直接相減。
   * **但 rect 是「已縮放」的**（畫布活在 `.stage-scale { transform: scale(k) }` 裡），
   * 所以必須把 rect 一起交給 `viewport.toVirtual()` 讓它除掉 k —— 只傳相對位移會讓
   * 指標比畫面跑得快 k 倍，可投放範圍看起來會窄掉。
   * Uses the bounding rect rather than `offsetX`, which is relative to the event target and
   * drifts as soon as the canvas has children. **Note the rect is the *scaled* one** (the
   * canvas sits inside `.stage-scale { transform: scale(k) }`), so the rect goes to
   * `viewport.toVirtual()` too, which divides the scale back out; passing only the offset
   * makes the pointer outrun the screen by a factor of k and the droppable range look narrow.
   */
  const aimAt = (clientX: number, clientY: number): void => {
    const rect = target.getBoundingClientRect();
    const point = viewport.toVirtual(rect, clientX, clientY);
    if (point === null) return;
    aim(point.x);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    aimAt(event.clientX, event.clientY);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    /*
     * 先瞄準再投放。少了第一步，觸控裝置上第一次點擊會掉在**上一次**的位置，
     * 因為觸控沒有 hover 階段可以先用來更新瞄準。
     * Aim before dropping: without it the first tap on touch lands wherever the aim
     * happened to be, since touch has no hover phase to update it.
     */
    aimAt(event.clientX, event.clientY);
    onDrop();

    /* 捕獲指標，讓拖到畫布外時仍能繼續瞄準。 */
    capturePointer(target, event.pointerId);
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (DROP_KEYS.has(event.key)) {
      event.preventDefault();
      onDrop();
      return;
    }

    const isLeft = MOVE_LEFT_KEYS.has(event.key);
    const isRight = MOVE_RIGHT_KEYS.has(event.key);
    if (!isLeft && !isRight) return;

    /* 阻止方向鍵滾動頁面。 */
    event.preventDefault();
    aim(lastAim + (isLeft ? -keyStep : keyStep));
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

/** 盡力捕獲指標；失敗不影響投放。 */
function capturePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.setPointerCapture !== 'function') return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* 部分瀏覽器對已釋放的 pointerId 會拋錯。 */
  }
}
