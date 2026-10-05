/**
 * 溢位判定的單元測試。
 * Unit tests for overflow detection.
 *
 * 這裡最關鍵的三條：
 *
 * 1. **瞬時穿越不算溢位**：掉落下來的方團團本來就會短暫經過線上，若把那些瞬間累加起來，
 *    正常遊玩也會被判出局。倒數必須是連續的。
 * 2. **還在下墜的顆粒不算溢位**：投放點刻意在溢位線上方，所以每顆剛生成時上緣都在線之上。
 *    若把它們算進去，連續投放會讓計時器自己爬滿 —— 容器沒滿也會結束。
 * 3. **「入堆」＝接觸**（使用者本次定案）：只有**碰到其他方團團**的顆粒才納入判定
 *    （`entered`）。標記由呼叫端在碰撞事件裡單向設真；本類別只讀它，不看幾何也不看速度。
 *    session 層的完整驗證在 `session.test.ts`（單獨一顆永不出局、接觸後才出局）。
 * The three critical ones:
 *
 * 1. "A momentary crossing is not an overflow": a falling dumpling passes the line by design,
 *    and accumulating those instants would fail a normal run. The countdown has to be
 *    continuous.
 * 2. "A dumpling still in flight is not an overflow": the drop point sits above the overflow
 *    line, so a fresh dumpling starts with its top edge over it. Counting those would let
 *    rapid dropping fill the timer on its own and end a run whose container is not full.
 * 3. **"Piled" means contact** (the user's decision, this change): only a body that has
 *    **touched another dumpling** counts (`entered`). The caller latches the flag in its
 *    collision handler; this class only reads it, and looks at neither geometry nor velocity.
 *    The end-to-end proof lives in `session.test.ts` (a lone dumpling never ends the run; a
 *    touching pair does).
 */

import { describe, expect, it } from 'vitest';
import { OverflowMonitor } from '../src/game/overflow';

const LINE = 50;
const GRACE = 3000;

/** 已入堆（碰過其他方團團）、上緣在線上（y - radius = 10 < 50）的顆粒。 */
const overTheLine = (y = 30, radius = 20) => ({ y, radius, entered: true });
/** 已入堆、整顆在線之下。 */
const underTheLine = (y = 300, radius = 20) => ({ y, radius, entered: true });
/** 還沒碰到任何東西（例如仍在下墜）的顆粒。 */
const inFlight = (y = 30, radius = 20) => ({ y, radius, entered: false });

describe('OverflowMonitor', () => {
  it('stays calm with an empty board', () => {
    const monitor = new OverflowMonitor(GRACE);

    expect(monitor.update(16.7, [], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('counts time while an entered body’s top edge is above the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    expect(monitor.update(1000, [overTheLine()], LINE)).toBe(true);
    expect(monitor.elapsed).toBe(1000);
    expect(monitor.isOver).toBe(false);
  });

  it('ignores a body that is entirely below the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    expect(monitor.update(1000, [underTheLine(600, 100)], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('ignores a body that is still in flight above the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    /* 上緣在線上，但還沒碰到任何方團團 → 不算。 */
    expect(monitor.update(GRACE, [inFlight()], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('does not let a stream of in-flight bodies fill the timer', () => {
    const monitor = new OverflowMonitor(GRACE);

    /*
     * 模擬「每 100ms 投一顆」：下墜中的顆粒首尾相接，計時器沒有任何歸零的縫隙。
     * 這一串若被算進去，3 秒就會結束一局 —— 而容器其實還很空。
     * Simulates one drop per 100 ms: the in-flight bodies chain together with no gap to reset
     * the timer. Counting them would end the run in 3 s with a nearly empty container.
     */
    for (let drop = 0; drop < 60; drop += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('keeps counting a body that was piled and then pushed back above the rim', () => {
    const monitor = new OverflowMonitor(GRACE);

    /*
     * 「已入堆」是單向的：碰過其他方團團之後，就算被堆疊擠到頂緣之上仍然算數（那正是
     * 「堆疊溢出來了」）。同一顆先以 entered=true 出現，之後就一直算數。
     * "Piled" is one-way: having touched another dumpling, a body keeps counting even when the
     * stack squeezes it above the rim — that is precisely "the pile is spilling out". Once
     * true it keeps counting.
     */
    monitor.update(1000, [{ y: 30, radius: 20, entered: true }], LINE);
    monitor.update(1000, [{ y: 30, radius: 20, entered: true }], LINE);

    expect(monitor.elapsed).toBe(2000);
  });

  it('snaps the countdown back to zero the moment nothing piled is over the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    monitor.update(2000, [overTheLine()], LINE);
    expect(monitor.elapsed).toBe(2000);

    /* 一顆掉下去之後全部退回線下 → 立刻歸零，先前的 2 秒不算數。 */
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

  it('ends the run once the grace period elapses', () => {
    const monitor = new OverflowMonitor(GRACE);
    const bodies = [overTheLine()];

    monitor.update(2999, bodies, LINE);
    expect(monitor.isOver).toBe(false);

    monitor.update(1, bodies, LINE);
    expect(monitor.isOver).toBe(true);
  });

  it('treats a zero grace period as immediate', () => {
    const monitor = new OverflowMonitor(0);

    monitor.update(1, [overTheLine()], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('reports progress as a 0..1 fraction of the grace period', () => {
    const monitor = new OverflowMonitor(GRACE);

    monitor.update(1500, [overTheLine()], LINE);

    expect(monitor.progress).toBeCloseTo(0.5, 6);
  });

  it('does not recover on its own once it is over', () => {
    const monitor = new OverflowMonitor(GRACE);
    monitor.update(GRACE, [overTheLine()], LINE);

    /* 就算畫面清乾淨了，判定仍然成立 —— 要由 reset() 明確復原。 */
    monitor.update(16.7, [], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('clears everything on reset', () => {
    const monitor = new OverflowMonitor(GRACE);
    monitor.update(GRACE, [overTheLine()], LINE);

    monitor.reset();

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });
});
