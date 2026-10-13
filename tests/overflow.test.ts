/**
 * 溢位判定 `OverflowMonitor` 的單元測試。
 * Unit tests for overflow detection, `OverflowMonitor`.
 */

import { describe, expect, it } from 'vitest';
import { OverflowMonitor } from '../src/game/overflow';

const LINE = 50;
const GRACE = 5000;

let nextId = 1;

const overTheLine = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
const underTheLine = (y = 300, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
const inFlight = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: false });

function stepSettled(
  monitor: OverflowMonitor,
  body: ReturnType<typeof overTheLine>,
  dt = 1000,
): boolean {
  return monitor.update(dt, [body], LINE);
}

describe('OverflowMonitor — 基本判定 / basic detection', () => {
  it('stays calm with an empty board', () => {
    const monitor = new OverflowMonitor(GRACE);

    expect(monitor.update(16.7, [], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('ignores a body that is entirely below the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    expect(monitor.update(1000, [underTheLine(600, 100)], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('ignores a body that is still in flight above the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    for (let step = 0; step < 20; step += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('does not let a stream of in-flight bodies fill the timer', () => {
    const monitor = new OverflowMonitor(GRACE);

    for (let drop = 0; drop < 60; drop += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('keeps counting a body that was piled and then pushed back above the rim', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);

    expect(monitor.elapsed).toBe(2000);
  });

  it('snaps the countdown back to zero the moment nothing piled is over the line', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    expect(monitor.elapsed).toBe(1000);

    monitor.update(16.7, [underTheLine()], LINE);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('is not tripped by a momentary crossing', () => {
    const monitor = new OverflowMonitor(GRACE);

    for (let pass = 0; pass < 20; pass += 1) {
      monitor.update(200, [overTheLine()], LINE);
      monitor.update(200, [underTheLine()], LINE);
    }

    expect(monitor.isOver).toBe(false);
  });

  it('does not recover on its own once it is over', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    for (let step = 0; step < 10; step += 1) monitor.update(1000, [body], LINE);

    monitor.update(16.7, [], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('clears everything on reset', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    for (let step = 0; step < 10; step += 1) monitor.update(1000, [body], LINE);
    monitor.reset();

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);
  });
});

describe('OverflowMonitor — 已入堆即起算 / a piled breach counts immediately', () => {
  it('starts the countdown on the very first step a piled body is over the line', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    monitor.update(100, [body], LINE);

    expect(monitor.settled).toBe(true);
    expect(monitor.elapsed).toBe(100);
    expect(monitor.isOver).toBe(false);
  });

  it('does not need the breaching body to be still — a jostled pile still counts', () => {
    const monitor = new OverflowMonitor(GRACE);

    for (let step = 0; step < 40; step += 1) {
      monitor.update(100, [{ id: 1, x: 100, y: 30 - step * 5, radius: 20, entered: true }], LINE);
    }

    expect(monitor.settled).toBe(true);
    expect(monitor.elapsed).toBe(4000);
    expect(monitor.isOver).toBe(false);
  });

  it('counts horizontal drift the same as any other movement', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    monitor.update(200, [body], LINE);
    monitor.update(200, [{ ...body, x: body.x + 5 }], LINE);

    expect(monitor.settled).toBe(true);
    expect(monitor.elapsed).toBe(400);
  });

  it('is unaffected by a neighbour that is still rolling', () => {
    const monitor = new OverflowMonitor(GRACE);
    const still = overTheLine();
    const rolling = overTheLine(28);

    monitor.update(1000, [still, rolling], LINE);
    monitor.update(1000, [{ ...still, x: still.x + 9 }, rolling], LINE);

    expect(monitor.settled).toBe(true);
    expect(monitor.elapsed).toBe(2000);
  });

  it('ends the run after the full grace period of an unbroken breach', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    monitor.update(1000, [body], LINE);
    expect(monitor.isOver).toBe(false);

    monitor.update(4000, [body], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('treats a zero grace period as immediate', () => {
    const monitor = new OverflowMonitor(0);
    const body = overTheLine();

    monitor.update(1, [body], LINE);

    expect(monitor.isOver).toBe(true);
  });
});

describe('OverflowMonitor — 起算後倒數不可被運動打斷 / counting is immune to movement', () => {
  it('keeps counting when a fresh dumpling lands on the pile', () => {
    const monitor = new OverflowMonitor(GRACE);
    const piled = overTheLine();

    stepSettled(monitor, piled);
    monitor.update(1000, [piled], LINE);
    expect(monitor.elapsed).toBe(2000);

    const fresh = { id: nextId++, x: piled.x + 2, y: piled.y - 2, radius: 20, entered: true };
    monitor.update(1000, [piled, fresh], LINE);

    expect(monitor.elapsed).toBe(3000);
    expect(monitor.settled).toBe(true);
    expect(monitor.remainingSeconds).toBe(2);
  });

  it('keeps counting even while the whole pile is shoved around', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    expect(monitor.elapsed).toBe(1000);

    for (let step = 0; step < 2; step += 1) {
      monitor.update(1000, [{ ...body, y: body.y - 30 + step * 60, x: body.x + 40 }], LINE);
    }

    expect(monitor.elapsed).toBe(3000);
    expect(monitor.isOver).toBe(false);
  });

  it('still ends the run even if the player never stops dropping', () => {
    const monitor = new OverflowMonitor(3000);
    const piled = overTheLine();

    stepSettled(monitor, piled);

    for (let round = 0; round < 12 && !monitor.isOver; round += 1) {
      const fresh = { id: nextId++, x: 100 + round, y: 28, radius: 20, entered: true };
      monitor.update(500, [piled, fresh], LINE);
    }

    expect(monitor.isOver).toBe(true);
  });

  it('still resets when every breaching body drops back below the line', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);
    expect(monitor.elapsed).toBe(2000);

    monitor.update(16.7, [underTheLine()], LINE);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);

    const again = overTheLine();
    monitor.update(200, [again], LINE);
    expect(monitor.elapsed).toBe(200);
    expect(monitor.settled).toBe(true);
  });

  it('forgets that it was counting after a reset', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);
    expect(monitor.elapsed).toBe(2000);

    monitor.reset();
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);

    monitor.update(1000, [body], LINE);
    expect(monitor.elapsed).toBe(1000);
  });
});

describe('OverflowMonitor — 倒數顯示值 / countdown display values', () => {
  it('reports progress as a 0..1 fraction of the grace period', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);

    expect(monitor.progress).toBeCloseTo(1000 / GRACE, 6);
  });

  it('counts whole seconds left, rounded up so it never shows zero', () => {
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    expect(monitor.remainingSeconds).toBe(0);

    stepSettled(monitor, body);
    expect(monitor.remainingSeconds).toBe(4);

    monitor.update(3900, [body], LINE);
    expect(monitor.remainingSeconds).toBe(1);
  });

  it('reports zero seconds left while nothing is over the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    monitor.update(16.7, [underTheLine()], LINE);

    expect(monitor.settled).toBe(false);
    expect(monitor.remainingSeconds).toBe(0);
  });
});
