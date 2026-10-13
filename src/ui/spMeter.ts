/**
 * 技力條：一條代表一點技力，段數跟著 `sp.max` 走；只在真的變了才碰 DOM。
 * The SP meter: one pill per SP point, the segment count following `sp.max`; the DOM is touched only on a real change.
 */

import { el } from './dom';

export interface SpMeterState {
  /**
   * 目前技力值，可為小數（部分填充的段）。
   * The current SP, possibly fractional (a partially filled pill).
   */
  value: number;
  /**
   * 技力上限；決定段數。
   * The SP cap; it fixes the segment count.
   */
  max: number;
}

export interface SpMeter {
  /**
   * 段數，等於 `ceil(max)`。
   * The segment count, `ceil(max)`.
   */
  readonly segments: number;
  update(state: SpMeterState): void;
  destroy(): void;
}

export function createSpMeter(host: HTMLElement): SpMeter {
  let segments = 0;
  let fills: HTMLElement[] = [];
  let lastValue = Number.NaN;

  /**
   * 依 max 重建段數；段數沒變就整批重用，避免每幀重建節點。
   * Rebuilds the segments for a new max; unchanged counts reuse the batch instead of rebuilding nodes every frame.
   */
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
       * 第 i 段填 `value - i` 的比例，夾在 0..1；1.5 點技力畫成一條滿、一條半。
       * Segment i is filled by `value - i`, clamped, so 1.5 SP reads as one full pill and one half pill.
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
