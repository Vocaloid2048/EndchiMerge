/**
 * 時長格式化的單元測試：`HH:mm:ss` 的補零、欄位進位與壞輸入。
 * Unit tests for duration formatting: `HH:mm:ss` padding, field carry-over and bad input.
 */

import { describe, expect, it } from 'vitest';
import { formatDuration } from '../src/ui/duration';

describe('formatDuration — 時長格式 / duration format', () => {
  it('always prints HH:mm:ss, with every field padded', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(7_000)).toBe('00:00:07');
    expect(formatDuration(60_000)).toBe('00:01:00');
    expect(formatDuration(754_000)).toBe('00:12:34');
  });

  it('floors to whole seconds, so a partial second never rounds up', () => {
    expect(formatDuration(999)).toBe('00:00:00');
    expect(formatDuration(1_999)).toBe('00:00:01');
    expect(formatDuration(59_999)).toBe('00:00:59');
  });

  it('carries at the hour boundary without changing the string length', () => {
    expect(formatDuration(3_599_999)).toBe('00:59:59');
    expect(formatDuration(3_600_000)).toBe('01:00:00');
    expect(formatDuration(4_500_000)).toBe('01:15:00');
    expect(formatDuration(8 * 3_600_000 + 30_000)).toBe('08:00:30');
  });

  it('covers the endless-mode ceiling of two hours', () => {
    expect(formatDuration(2 * 3_600_000)).toBe('02:00:00');
    expect(formatDuration(2 * 3_600_000 - 1)).toBe('01:59:59');
  });

  it('lets the hours field grow past two digits instead of wrapping', () => {
    expect(formatDuration(100 * 3_600_000)).toBe('100:00:00');
  });

  it('treats negative and non-finite input as zero', () => {
    expect(formatDuration(-5_000)).toBe('00:00:00');
    expect(formatDuration(Number.NaN)).toBe('00:00:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('00:00:00');
  });
});
