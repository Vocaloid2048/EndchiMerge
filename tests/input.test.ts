/**
 * 投放輸入層的單元測試：貼牆長按時，鍵盤每次按鍵都重讀當前瞄準點。
 * Unit tests for the drop input layer: each key press re-reads the current aim, even against a wall.
 */

import { describe, expect, it } from 'vitest';
import { attachDropInput } from '../src/core/input';
import type { Viewport, VirtualPoint } from '../src/render/viewport';

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
    fire: (type, event): void => {
      handlers.get(type)?.({ preventDefault: (): void => {}, ...(event as Record<string, unknown>) });
    },
  };
}

function makeViewport(): Viewport {
  /*
   * 一比一的假投影：client 座標直接當虛擬座標，斷言不必換算。
   * An identity projection: client coordinates are the virtual ones, so assertions need no conversion.
   */
  return { toVirtual: (_rect: DOMRect, x: number, y: number): VirtualPoint => ({ x, y }) } as unknown as Viewport;
}

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

    press('ArrowLeft', 40);
    expect(aim.state.aim).toBe(aim.state.min);

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

    press('ArrowLeft', 40);
    const settled = aim.state.aim;
    expect(settled).toBe(aim.state.min);

    press('ArrowLeft', 30);
    expect(aim.state.aim).toBe(settled);
  });
});

describe('attachDropInput — 方向鍵以「現在的瞄準點」為基準 / arrow keys re-read the aim', () => {
  it('follows a clamp the input layer did not cause (a resize narrowing the walls)', () => {
    const { aim, press } = setup();

    press('ArrowRight', 40);
    expect(aim.state.aim).toBe(aim.state.max);

    aim.state.max = 600;
    aim.state.aim = 600;

    press('ArrowLeft');
    expect(aim.state.aim).toBe(600 - KEY_STEP);
  });

  it('re-bases after a pointer aim that was itself clamped', () => {
    const { aim, fire } = setup();

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
