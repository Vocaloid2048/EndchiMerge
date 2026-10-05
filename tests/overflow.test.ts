/**
 * 溢位判定的單元測試。
 * Unit tests for overflow detection.
 *
 * 這裡最關鍵的四條：
 *
 * 1. **瞬時穿越不算溢位**：掉落下來的方團團本來就會短暫經過線上，若把那些瞬間累加起來，
 *    正常遊玩也會被判出局。倒數必須是連續的。
 * 2. **還在下墜的顆粒不算溢位**：投放點刻意在溢位線上方，所以每顆剛生成時上緣都在線之上。
 *    若把它們算進去，連續投放會讓計時器自己爬滿 —— 容器沒滿也會結束。
 * 3. **「入堆」＝接觸**（使用者定案）：只有**碰到其他方團團**的顆粒才納入判定
 *    （`entered`）。標記由呼叫端在碰撞事件裡單向設真；本類別只讀它，不看幾何也不看速度。
 * 4. **停定才起算**（使用者本次定案）：越線的顆粒必須在原地停留 `settleMs` 才開始倒數。
 *    還在動的時候 `settled` 為假，畫面完全不顯示警告 —— 玩家不會看到「還在掉就出現」的提示。
 * The four critical ones:
 *
 * 1. "A momentary crossing is not an overflow": a falling dumpling passes the line by design,
 *    and accumulating those instants would fail a normal run. The countdown has to be
 *    continuous.
 * 2. "A dumpling still in flight is not an overflow": the drop point sits above the overflow
 *    line, so a fresh dumpling starts with its top edge over it. Counting those would let
 *    rapid dropping fill the timer on its own and end a run whose container is not full.
 * 3. **"Piled" means contact** (the user's decision): only a body that has **touched another
 *    dumpling** counts (`entered`). The caller latches the flag in its collision handler; this
 *    class only reads it, and looks at neither geometry nor velocity.
 * 4. **The countdown waits for it to settle** (the user's decision, this change): a breaching
 *    body must stay put for `settleMs` before the countdown starts. While it is still moving
 *    `settled` is false and the view shows no warning at all, so the player never sees a cue
 *    about a dumpling that is still falling.
 */

import { describe, expect, it } from 'vitest';
import { OverflowMonitor } from '../src/game/overflow';

const LINE = 50;
const GRACE = 5000;
/** 測試用的停定門檻：一步就當成停定，方便逐條釘住倒數行為。 */
const SETTLE_FAST = { settleDistance: 0.6, settleMs: 200 };

let nextId = 1;

/** 已入堆（碰過其他方團團）、上緣在線上（y - radius = 10 < 50）的顆粒。 */
const overTheLine = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
/** 已入堆、整顆在線之下。 */
const underTheLine = (y = 300, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
/** 還沒碰到任何東西（例如仍在下墜）的顆粒。 */
const inFlight = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: false });

/**
 * 推進一步，同一顆維持原位（＝已停定），並且已經跨過停定門檻。
 * Step once with the same body in the same place, past the settle threshold.
 */
function stepSettled(
  monitor: OverflowMonitor,
  body: ReturnType<typeof overTheLine>,
  dt = 1000,
): boolean {
  /* 第一次見到它算「還在動」，所以要先空推一步建立基準位置。 */
  monitor.update(dt, [body], LINE);
  return monitor.update(dt, [body], LINE);
}

describe('OverflowMonitor — 基本判定 / basic detection', () => {
  it('stays calm with an empty board', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    expect(monitor.update(16.7, [], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('ignores a body that is entirely below the line', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    expect(monitor.update(1000, [underTheLine(600, 100)], LINE)).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('ignores a body that is still in flight above the line', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    /* 上緣在線上，但還沒碰到任何方團團 → 不算。 */
    for (let step = 0; step < 20; step += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('does not let a stream of in-flight bodies fill the timer', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    /*
     * 模擬「每 100ms 投一顆」：下墜中的顆粒首尾相接，計時器沒有任何歸零的縫隙。
     * 這一串若被算進去，很快就會結束一局 —— 而容器其實還很空。
     * Simulates one drop per 100 ms: the in-flight bodies chain together with no gap to reset
     * the timer. Counting them would end the run with a nearly empty container.
     */
    for (let drop = 0; drop < 60; drop += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('keeps counting a body that was piled and then pushed back above the rim', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    /*
     * 「已入堆」是單向的：碰過其他方團團之後，就算被堆疊擠到頂緣之上仍然算數（那正是
     * 「堆疊溢出來了」）。
     * "Piled" is one-way: having touched another dumpling, a body keeps counting even when the
     * stack squeezes it above the rim — that is precisely "the pile is spilling out".
     */
    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);

    expect(monitor.elapsed).toBe(2000);
  });

  it('snaps the countdown back to zero the moment nothing piled is over the line', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    stepSettled(monitor, body);
    expect(monitor.elapsed).toBe(1000);

    /* 全部退回線下 → 立刻歸零，先前的時間不算數。 */
    monitor.update(16.7, [underTheLine()], LINE);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('is not tripped by a momentary crossing', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    for (let pass = 0; pass < 20; pass += 1) {
      monitor.update(200, [overTheLine()], LINE);
      monitor.update(200, [underTheLine()], LINE);
    }

    expect(monitor.isOver).toBe(false);
  });

  it('does not recover on its own once it is over', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    for (let step = 0; step < 10; step += 1) monitor.update(1000, [body], LINE);

    /* 就算畫面清乾淨了，判定仍然成立 —— 要由 reset() 明確復原。 */
    monitor.update(16.7, [], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('clears everything on reset', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    for (let step = 0; step < 10; step += 1) monitor.update(1000, [body], LINE);
    monitor.reset();

    expect(monitor.isOver).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);
  });
});

describe('OverflowMonitor — 停定才起算 / settle before counting', () => {
  it('does not start the countdown while the breaching body is still moving', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    /* 每步都往下移動 5 個單位 → 一直在動 → 永不起算。 */
    for (let step = 0; step < 40; step += 1) {
      monitor.update(100, [{ id: 1, x: 100, y: 30 - step * 5, radius: 20, entered: true }], LINE);
    }

    expect(monitor.settled).toBe(false);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('starts the countdown only after the breach has been still for settleMs', () => {
    const monitor = new OverflowMonitor(GRACE, { settleDistance: 0.6, settleMs: 200 });
    const body = overTheLine();

    /* 第一步：第一次見到它 → 當成還在動。 */
    monitor.update(100, [body], LINE);
    expect(monitor.settled).toBe(false);

    /* 第二步：靜止了 100ms，但還沒到 200ms。 */
    monitor.update(100, [body], LINE);
    expect(monitor.settled).toBe(false);
    expect(monitor.elapsed).toBe(0);

    /* 第三步：累積 200ms → 停定成立，開始倒數。 */
    monitor.update(100, [body], LINE);
    expect(monitor.settled).toBe(true);
    expect(monitor.elapsed).toBe(100);
  });

  it('resets the settle timer when the breach starts moving again', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    monitor.update(1000, [body], LINE);
    monitor.update(1000, [body], LINE);
    expect(monitor.settled).toBe(true);

    /* 動一下 → 停定與倒數都歸零。 */
    monitor.update(1000, [{ ...body, y: body.y + 5 }], LINE);
    expect(monitor.settled).toBe(false);
    expect(monitor.elapsed).toBe(0);
  });

  it('counts horizontal drift as movement too', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    monitor.update(1000, [body], LINE);
    monitor.update(1000, [body], LINE);
    expect(monitor.settled).toBe(true);

    /* 只有 X 改變：只看 Y 的實作會漏掉這種滾動。 */
    monitor.update(1000, [{ ...body, x: body.x + 5 }], LINE);
    expect(monitor.settled).toBe(false);
  });

  it('is not held up by a neighbour that is still rolling', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    /* 一顆靜止、一顆在滾 —— 靜止那顆的位移仍然是 0，所以停定照樣成立。 */
    const still = overTheLine();

    monitor.update(1000, [still], LINE);
    monitor.update(1000, [still], LINE);

    expect(monitor.settled).toBe(true);
  });

  it('ends the run only after the full grace period from when it settled', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    /* 建立基準 + 停定（這步開始倒數 1000ms）。 */
    stepSettled(monitor, body);
    expect(monitor.isOver).toBe(false);

    /* 再 4000ms → 總計 5000ms，剛好到頂。 */
    monitor.update(4000, [body], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('treats a zero grace period as immediate once settled', () => {
    const monitor = new OverflowMonitor(0, { settleDistance: 0.6, settleMs: 0 });
    const body = overTheLine();

    /* settleMs = 0 ⇒ 第二次見到靜止的它就已經停定，而 graceMs = 0 ⇒ 當步就結束。 */
    monitor.update(1, [body], LINE);
    expect(monitor.isOver).toBe(false);

    monitor.update(1, [body], LINE);
    expect(monitor.isOver).toBe(true);
  });
});

describe('OverflowMonitor — 倒數顯示值 / countdown display values', () => {
  it('reports progress as a 0..1 fraction of the grace period', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    stepSettled(monitor, body);

    expect(monitor.progress).toBeCloseTo(1000 / GRACE, 6);
  });

  it('counts whole seconds left, rounded up so it never shows zero', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);
    const body = overTheLine();

    /* 還沒起算 → 0。 */
    expect(monitor.remainingSeconds).toBe(0);

    stepSettled(monitor, body);
    /* 已過 1000ms ⇒ 剩 4000ms ⇒ 顯示 4。 */
    expect(monitor.remainingSeconds).toBe(4);

    monitor.update(3900, [body], LINE);
    /* 剩 100ms ⇒ 進位成 1，而不是 0。 */
    expect(monitor.remainingSeconds).toBe(1);
  });

  it('reports zero seconds left before the breach settles', () => {
    const monitor = new OverflowMonitor(GRACE, SETTLE_FAST);

    monitor.update(16.7, [overTheLine()], LINE);

    expect(monitor.settled).toBe(false);
    expect(monitor.remainingSeconds).toBe(0);
  });
});
