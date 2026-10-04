/**
 * 固定時間步累加器的單元測試。
 * Unit tests for the fixed-timestep accumulator.
 *
 * 累加器的邊界（「剛好等於一步」與「差一點點」）是最容易寫錯的地方，而且寫錯在畫面上
 * 只會表現成「物理偶爾慢半拍」，幾乎不可能靠肉眼抓到。
 * Accumulator boundaries are where this code goes wrong, and a mistake only shows up on
 * screen as "physics occasionally feels a beat slow" — effectively invisible by eye.
 */

import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, FixedStepper } from '../src/game/loop';

describe('FixedStepper — 步數換算 / step conversion', () => {
  it('runs no step for a zero-length frame', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(0)).toBe(0);
  });

  it('runs exactly one step for a 60 Hz frame', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(FIXED_STEP_MS)).toBe(1);
  });

  it('runs no step until a full step has accumulated', () => {
    const stepper = new FixedStepper();

    /* 差一點點 → 還不跑，但時間要留著。 */
    expect(stepper.advance(FIXED_STEP_MS - 0.01)).toBe(0);
    expect(stepper.pendingMs).toBeCloseTo(FIXED_STEP_MS - 0.01, 6);
  });

  it('carries the remainder into the next frame', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(FIXED_STEP_MS * 0.6)).toBe(0);
    expect(stepper.advance(FIXED_STEP_MS * 0.6)).toBe(1);
  });

  it('runs two steps for a 30 Hz frame', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(FIXED_STEP_MS * 2)).toBe(2);
  });

  it('keeps a steady 60 Hz cadence over many frames', () => {
    const stepper = new FixedStepper();
    let total = 0;

    for (let frame = 0; frame < 600; frame += 1) {
      total += stepper.advance(FIXED_STEP_MS);
    }

    expect(total).toBe(600);
  });
});

describe('FixedStepper — 上限 / substep cap', () => {
  it('never exceeds the substep cap for a huge delta', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(60_000)).toBe(5);
  });

  it('discards the lag instead of entering a catch-up spiral', () => {
    const stepper = new FixedStepper();

    stepper.advance(60_000);

    /* 落後的時間必須被丟棄，否則之後每一幀都會頂到上限。 */
    expect(stepper.pendingMs).toBe(0);
    expect(stepper.advance(FIXED_STEP_MS)).toBe(1);
  });

  it('treats a negative delta as zero', () => {
    const stepper = new FixedStepper();

    expect(stepper.advance(-500)).toBe(0);
    expect(stepper.pendingMs).toBe(0);
  });

  it('honours a custom cap', () => {
    const stepper = new FixedStepper({ maxSubsteps: 2 });

    expect(stepper.advance(60_000)).toBe(2);
  });

  it('rejects a non-positive step size', () => {
    expect(() => new FixedStepper({ stepMs: 0 })).toThrow(/positive step size/);
  });

  it('rejects a substep cap below one', () => {
    expect(() => new FixedStepper({ maxSubsteps: 0 })).toThrow(/positive integer substep cap/);
  });
});

describe('FixedStepper — reset()', () => {
  it('drops the pending remainder', () => {
    const stepper = new FixedStepper();

    stepper.advance(FIXED_STEP_MS * 0.9);
    stepper.reset();

    expect(stepper.pendingMs).toBe(0);
    expect(stepper.advance(FIXED_STEP_MS * 0.9)).toBe(0);
  });
});

describe('FixedStepper — 更新率無關 / refresh-rate independence', () => {
  it('produces the same number of steps per second at 60 Hz and at 144 Hz', () => {
    const seconds = 2;

    const at60 = new FixedStepper();
    let steps60 = 0;
    for (let frame = 0; frame < 60 * seconds; frame += 1) steps60 += at60.advance(1000 / 60);

    const at144 = new FixedStepper();
    let steps144 = 0;
    for (let frame = 0; frame < 144 * seconds; frame += 1) steps144 += at144.advance(1000 / 144);

    /* 浮點誤差允許 ±2 步。 */
    expect(Math.abs(steps60 - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(steps144 - 120)).toBeLessThanOrEqual(2);
  });
});
