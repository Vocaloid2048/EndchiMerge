/**
 * 技力條。
 * The SP meter.
 *
 * 設計稿（`1408:2301` / `1408:2304` / `1408:2306`）畫的是**三顆** 120×16 的膠囊，而不是
 * 一條長條。三條不是裝飾：`skills.json` 的 `sp.max` 剛好是 3.0，也就是「**一條代表一點
 * 技力**」。因此這裡的段數跟著 `sp.max` 走，寫死三條會在 D12 把上限改成 5 的那天安靜地
 * 少畫兩格。
 * The mock draws **three** 120×16 pills rather than one bar. That is not decoration:
 * `skills.json` sets `sp.max` to 3.0, so **one pill is one point of SP**. The segment count
 * therefore follows `sp.max`; hard-coding three would silently under-draw the day D12 raises
 * the ceiling to 5.
 *
 * 只有真的變了才碰 DOM —— 這個模組之後會每幀被呼叫（M5 的技力會隨投放成長）。
 * The DOM is touched only on a real change, because M5 will call this every frame as SP
 * accrues.
 */

import { el } from './dom';

export interface SpMeterState {
  /** 目前技力值，可為小數（部分填充的段）。 */
  value: number;
  /** 技力上限；決定段數。 */
  max: number;
}

export interface SpMeter {
  /** 段數，等於 `ceil(max)`。 */
  readonly segments: number;
  update(state: SpMeterState): void;
  destroy(): void;
}

export function createSpMeter(host: HTMLElement): SpMeter {
  let segments = 0;
  let fills: HTMLElement[] = [];
  let lastValue = Number.NaN;

  /** 依 max 重建段數。段數沒變就整批重用，避免每幀重建節點。 */
  function ensureSegments(count: number): void {
    if (count === segments) return;

    segments = count;
    fills = [];
    host.replaceChildren();

    for (let index = 0; index < count; index += 1) {
      const segment = el('div', 'sp-meter__segment');
      const fill = el('div', 'sp-meter__fill');
      segment.append(fill);
      host.append(segment);
      fills.push(fill);
    }

    /* 段數變了，填充寬度必須重算。 */
    lastValue = Number.NaN;
  }

  function update(state: SpMeterState): void {
    ensureSegments(Math.max(1, Math.ceil(state.max)));

    if (state.value === lastValue) return;
    lastValue = state.value;

    for (let index = 0; index < fills.length; index += 1) {
      /*
       * 第 i 段填 `value - i` 的比例，夾在 0..1。這樣 1.5 點技力會畫成一條滿、一條半。
       * Segment i is filled by `value - i`, clamped, so 1.5 SP reads as one full pill and
       * one half pill.
       */
      const ratio = Math.max(0, Math.min(1, state.value - index));
      fills[index]?.style.setProperty('width', `${String(ratio * 100)}%`);
    }

    host.setAttribute('aria-valuemin', '0');
    host.setAttribute('aria-valuemax', String(state.max));
    host.setAttribute('aria-valuenow', String(state.value));
  }

  return {
    get segments(): number {
      return segments;
    },
    update,
    destroy: (): void => host.replaceChildren(),
  };
}
