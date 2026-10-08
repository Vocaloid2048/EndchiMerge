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
 * 鍵盤支援（←／→ 移動瞄準點，空白／Enter／↓ 投放）與滑鼠走同一組回呼，所以兩種操作在
 * `GameSession` 眼中完全等價。
 * Keyboard support funnels through the same callbacks, so pointer and keyboard are
 * indistinguishable to `GameSession`.
 *
 * 鍵位對應是**橫向的**：瞄準點只有一個自由度，所以只有左右兩個方向鍵有意義，`↓` 留給
 * 投放（使用者定案）。`↑` 刻意不做事 —— 它在這個遊戲裡沒有對應的動作，與其讓它偷偷往左
 * 移一格，不如讓它什麼都不做。
 * The key map is **horizontal**: the aim has one degree of freedom, so only left and right
 * mean anything and `↓` is given to the drop (the user's decision). `↑` deliberately does
 * nothing — it has no corresponding action here, and silently nudging left would be worse
 * than no response at all.
 *
 * 鍵盤的一次移動是**相對位移**，而且基準必須是「現在**真的**在哪」（`readAim`），不是
 * 「我上次送出去多少」。差別只在夾制發生時看得見：曾經這裡自己記住最後送出的值，於是
 * 貼牆長按左鍵時那個值一路往左飄，畫面停在牆上、輸入層卻以為自己已經在牆外；接著按右鍵
 * 就變成「先把飄掉的距離追回來」，要連按好幾下才肯動 —— 使用者回報的正是這個。
 * 讀取當前值讓夾制對鍵盤**透明**：貼牆時基準就是牆，往另一邊按一下就走一步。輸入層因此
 * 不留任何遊戲狀態，也就沒有東西可以走鐘。
 * A keyboard step is a **relative** move, and its base must be where the aim *actually* is
 * (`readAim`), not the last number this layer sent. The difference only shows up once
 * clamping happens: this file used to remember its last sent value, so holding Left against
 * the wall let that value drift past the wall while the picture stayed put; the next Right
 * press then spent several presses "catching up" instead of moving. Reading the current
 * value keeps clamping transparent to the keyboard — at the wall the base *is* the wall, so
 * one press of the other key moves one step. It also means this layer keeps no game state,
 * and so has nothing that can drift.
 */

import type { Viewport, VirtualPoint } from '../render/viewport';

export interface DropInputOptions {
  /** 接收指標事件的元素，通常就是遊戲畫布。 */
  target: HTMLElement;
  /** 用於把 CSS 像素換算成虛擬座標。 */
  viewport: Viewport;
  /** 瞄準位置改變。 */
  onAim: (x: number) => void;
  /**
   * 確認投放。帶上**虛擬座標**，因為同一顆按鈕在「技能選取模式」下要改為選球 —— 判斷在
   * `GameSession`，這裡只負責把位置傳過去。鍵盤沒有座標，所以傳 `null`（＝照目前瞄準點
   * 投放）。
   * Confirm the drop, carrying the **virtual coordinates**: the same press becomes "pick a
   * dumpling" while a skill is selecting, and only `GameSession` decides which. The keyboard has no
   * coordinates, so it passes `null` (= drop at the current aim).
   */
  onDrop: (point: VirtualPoint | null) => void;
  /**
   * 取消目前的技能選取（`Esc`）。選填，未提供時 `Esc` 不做任何事。
   * Cancel the current skill selection (`Esc`). Optional; without it `Esc` does nothing.
   */
  onCancel?: () => void;
  /** 鍵盤一次移動的虛擬距離；預設 20。 */
  keyStep?: number;
  /**
   * 讀取**目前**的瞄準位置。鍵盤每次按鍵都重新問一次，並以它為基準加減 `keyStep`；
   * 這樣牆壁夾制（以及 resize 造成的重夾）都會自然反映在下一步上。
   * Read the **current** aim. Every arrow press asks again and offsets that base by
   * `keyStep`, so wall clamping (and any re-clamp from a resize) shows up in the next step
   * for free.
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
/** `ArrowDown`（使用者定案：↓ 即投放）＋ 空白與 Enter。 */
const DROP_KEYS = new Set(['Enter', ' ', 'Spacebar', 'ArrowDown']);
export function attachDropInput(options: DropInputOptions): () => void {
  const { target, viewport, onAim, onDrop, onCancel, readAim } = options;
  const keyStep = options.keyStep ?? DEFAULT_KEY_STEP;

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
     * 先瞄準再確認。少了第一步，觸控裝置上第一次點擊會掉在**上一次**的位置，
     * 因為觸控沒有 hover 階段可以先用來更新瞄準。
     * Aim before confirming: without it the first tap on touch lands wherever the aim
     * happened to be, since touch has no hover phase to update it.
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
     * 基準取**現在**的瞄準位置。貼牆長按時 `readAim()` 每次都回牆上的值，所以放開左鍵再
     * 按右鍵是從牆邊往回走一步，而不是先追回一段看不見的溢出量。
     * The base is the aim's **current** value. Holding against a wall makes `readAim()` keep
     * answering with the wall position, so Left-then-Right steps one notch back in from the
     * edge instead of first paying off an invisible overflow.
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

/** 盡力捕獲指標；失敗不影響投放。 */
function capturePointer(target: HTMLElement, pointerId: number): void {
  if (typeof target.setPointerCapture !== 'function') return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    /* 部分瀏覽器對已釋放的 pointerId 會拋錯。 */
  }
}
