/**
 * 投放輸入層的單元測試。
 * Unit tests for the drop input layer.
 *
 * 主角是**貼牆長按**：夾制發生在 `GameSession`，而輸入層看不見它。曾經輸入層自己記住
 * 「上次送出的值」並以它為基準累加，於是貼牆長按左鍵會讓那個值一路飄到牆外；放開再按右鍵
 * 就變成先追回那段看不見的溢出量，要連按好幾下才肯動（使用者回報的 bug）。
 * 現在鍵盤每次按鍵都重新讀當前瞄準點，所以斷言很直接：**在牆上按一下另一邊，只走一步**。
 * The subject is **holding a key against a wall**: the clamping lives in `GameSession` and
 * the input layer cannot see it. This layer used to accumulate on its own copy of "the last
 * value I sent", so holding Left against a wall let that copy drift past the wall; the next
 * Right press then spent several presses paying off an invisible overflow (the reported
 * bug). The keyboard now re-reads the aim on every press, so the assertion is blunt: **one
 * press of the other key at a wall moves exactly one step.**
 *
 * 環境是 node（無 DOM），所以目標元素與 viewport 都是最小化的替身 —— 這裡要驗的是
 * **輸入層的簿記**，不是瀏覽器的事件系統。
 * The environment is node (no DOM), so the target element and the viewport are minimal
 * stand-ins: what is under test is the input layer's bookkeeping, not the browser's event
 * system.
 */

import { describe, expect, it } from 'vitest';
import { attachDropInput } from '../src/core/input';
import type { Viewport, VirtualPoint } from '../src/render/viewport';

/** 只留 `attachDropInput` 會碰到的三件事，其餘留給型別斷言去假裝。 */
function makeTarget(): { target: HTMLElement; fire: (type: string, event: unknown) => void } {
  const handlers = new Map<string, (event: unknown) => void>();
  const rect = { x: 0, y: 0, width: 1000, height: 1000, left: 0, top: 0, right: 1000, bottom: 1000 };

  const target = {
    addEventListener: (type: string, handler: (event: unknown) => void): void => {
      handlers.set(type, handler);
    },
    removeEventListener: (type: string): void => {
      handlers.delete(type);
    },
    getBoundingClientRect: (): typeof rect => rect,
  };

  return {
    target: target as unknown as HTMLElement,
    /* 補一個 `preventDefault`，因為方向鍵與投放鍵都會呼叫它。 */
    fire: (type, event): void => {
      handlers.get(type)?.({ preventDefault: (): void => {}, ...(event as Record<string, unknown>) });
    },
  };
}

function makeViewport(): Viewport {
  /* 一比一的假投影：client 座標直接當虛擬座標，讓斷言不必換算。 */
  return { toVirtual: (_rect: DOMRect, x: number, y: number): VirtualPoint => ({ x, y }) } as unknown as Viewport;
}

/**
 * 假的 `GameSession`：只實作夾制，因為夾制正是這個測試的主角。
 * A fake `GameSession` that implements only clamping, since clamping is the whole subject.
 */
function makeAim(initialMin = 100, initialMax = 900) {
  const state = { min: initialMin, max: initialMax, aim: (initialMin + initialMax) / 2 };
  return {
    state,
    onAim: (x: number): void => {
      state.aim = Math.min(Math.max(x, state.min), state.max);
    },
    readAim: (): number => state.aim,
  };
}

const KEY_STEP = 20;

function setup() {
  const { target, fire } = makeTarget();
  const aim = makeAim();
  const drops: (VirtualPoint | null)[] = [];
  const detach = attachDropInput({
    target,
    viewport: makeViewport(),
    onAim: aim.onAim,
    onDrop: (point): void => {
      drops.push(point);
    },
    readAim: aim.readAim,
    keyStep: KEY_STEP,
  });

  const press = (key: string, times = 1): void => {
    for (let index = 0; index < times; index += 1) fire('keydown', { key });
  };

  return { aim, drops, press, fire, detach };
}

describe('attachDropInput — 貼牆長按 / holding against a wall', () => {
  it('stops at the left edge and steps back in with a single press of the other key', () => {
    const { aim, press } = setup();

    /* 長按左鍵，遠超過容器寬度所能容納的距離。 */
    press('ArrowLeft', 40);
    expect(aim.state.aim).toBe(aim.state.min);

    /* 這一下在舊寫法裡會被「看不見的溢出量」吃掉，位置不動。 */
    press('ArrowRight');
    expect(aim.state.aim).toBe(aim.state.min + KEY_STEP);
  });

  it('stops at the right edge and steps back in with a single press of the other key', () => {
    const { aim, press } = setup();

    press('ArrowRight', 40);
    expect(aim.state.aim).toBe(aim.state.max);

    press('ArrowLeft');
    expect(aim.state.aim).toBe(aim.state.max - KEY_STEP);
  });

  it('keeps the aim on the edge for as long as the key is held', () => {
    const { aim, press } = setup();

    /* 先長按到牆上。 */
    press('ArrowLeft', 40);
    const settled = aim.state.aim;
    expect(settled).toBe(aim.state.min);

    /* 貼牆之後每一次重複觸發都只是把同一個值再送一次，不安裝任何隱形位移。 */
    press('ArrowLeft', 30);
    expect(aim.state.aim).toBe(settled);
  });
});

describe('attachDropInput — 方向鍵以「現在的瞄準點」為基準 / arrow keys re-read the aim', () => {
  it('follows a clamp the input layer did not cause (a resize narrowing the walls)', () => {
    const { aim, press } = setup();

    /* 先走到右牆。 */
    press('ArrowRight', 40);
    expect(aim.state.aim).toBe(aim.state.max);

    /*
     * 容器變窄：`GameSession.resize()` 自己把瞄準點夾回來，輸入層完全不知情。
     * 舊寫法的基準停在舊的右牆上，於是下一次左鍵要先把差值追完才肯動。
     */
    aim.state.max = 600;
    aim.state.aim = 600;

    press('ArrowLeft');
    expect(aim.state.aim).toBe(600 - KEY_STEP);
  });

  it('re-bases after a pointer aim that was itself clamped', () => {
    const { aim, fire } = setup();

    /* 滑鼠指到畫布外：虛擬 X 遠超右牆，session 夾回牆上。 */
    fire('pointermove', { clientX: 5000, clientY: 400 });
    expect(aim.state.aim).toBe(aim.state.max);

    fire('keydown', { key: 'ArrowLeft' });
    expect(aim.state.aim).toBe(aim.state.max - KEY_STEP);
  });
});

describe('attachDropInput — 生命週期 / lifecycle', () => {
  it('stops listening once the disposer runs', () => {
    const { aim, press, fire, drops, detach } = setup();

    fire('keydown', { key: 'ArrowDown' });
    expect(drops).toHaveLength(1);

    detach();

    const before = aim.state.aim;
    press('ArrowLeft');
    fire('keydown', { key: 'ArrowDown' });
    expect(aim.state.aim).toBe(before);
    expect(drops).toHaveLength(1);
  });
});
