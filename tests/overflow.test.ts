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
 * 4. **已入堆即起算**（使用者定案，修訂版）：只要已入堆的顆粒越線，倒數立刻開始，
 *    **不再要求它停定**。舊版的停定門檻讓「玩家持續投放」時堆頂一直被擾動、永不起算，
 *    紅線與倒數完全不出現（使用者截圖的「卡住」）。入堆與否已由接觸判定把關，越線即計。
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
 * 4. **A piled breach counts immediately** (the user's decision, revised): a piled body over the
 *    line starts the countdown at once, with **no settle requirement**. The old settle gate meant
 *    that while the player kept dropping, the top of the stack was always jostled, settling never
 *    held, and neither the line nor the countdown ever appeared (the "stuck" the user reported).
 *    Contact already gates "piled", so a piled breach simply counts.
 */

import { describe, expect, it } from 'vitest';
import { OverflowMonitor } from '../src/game/overflow';

const LINE = 50;
const GRACE = 5000;

let nextId = 1;

/** 已入堆（碰過其他方團團）、上緣在線上（y - radius = 10 < 50）的顆粒。 */
const overTheLine = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
/** 已入堆、整顆在線之下。 */
const underTheLine = (y = 300, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: true });
/** 還沒碰到任何東西（例如仍在下墜）的顆粒。 */
const inFlight = (y = 30, radius = 20) => ({ id: nextId++, x: 100, y, radius, entered: false });

/**
 * 推進一步，同一顆維持原位。已入堆即起算，所以第一次呼叫就會開始倒數。
 * Step once with the same body in place. A piled breach counts immediately, so the first call
 * already starts the countdown.
 */
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

    /* 上緣在線上，但還沒碰到任何方團團 → 不算。 */
    for (let step = 0; step < 20; step += 1) monitor.update(100, [inFlight()], LINE);

    expect(monitor.elapsed).toBe(0);
    expect(monitor.isOver).toBe(false);
  });

  it('does not let a stream of in-flight bodies fill the timer', () => {
    const monitor = new OverflowMonitor(GRACE);

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
    const monitor = new OverflowMonitor(GRACE);
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
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    expect(monitor.elapsed).toBe(1000);

    /* 全部退回線下 → 立刻歸零，先前的時間不算數。 */
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

    /* 就算畫面清乾淨了，判定仍然成立 —— 要由 reset() 明確復原。 */
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
    /*
     * 這正是使用者截圖裡「卡住」的那個漏洞：玩家持續投放時，堆頂一直被擾動，舊版的停定門檻
     * 永遠不成立、紅線與倒數永遠不出現。現在只要已入堆且越線，不論位移多大都照算。
     * This is exactly the "stuck" hole in the user's screenshot: while the player kept dropping,
     * the top was always jostled, the old settle gate never held, and the line and countdown never
     * appeared. Now a piled breach counts no matter how much it moves.
     */
    const monitor = new OverflowMonitor(GRACE);

    /* 每步都往下移動 5 個單位 —— 舊版會因此永不起算。 */
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
    /* 只有 X 改變時舊版會漏掉這種滾動；現在原則上不看運動，自然照算。 */
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

    /* 再 4000ms → 總計 5000ms，剛好到頂。 */
    monitor.update(4000, [body], LINE);

    expect(monitor.isOver).toBe(true);
  });

  it('treats a zero grace period as immediate', () => {
    const monitor = new OverflowMonitor(0);
    const body = overTheLine();

    /* graceMs = 0 ⇒ 越線的第一步就結束該局。 */
    monitor.update(1, [body], LINE);

    expect(monitor.isOver).toBe(true);
  });
});

/*
 * 使用者回報的 bug：倒數開始後，只要繼續投放方團團，倒數就會被重置回 5 秒，一直走不完。
 * 根因是「新的越線顆粒第一次見到時算還在動」，而舊實作把 `elapsedMs` 也綁在這個條件上。
 * 這一整個區塊釘住新規則：**起算之後，只有「完全沒有越線顆粒」能讓倒數歸零。**
 * The bug the user reported: once the countdown began, dropping more dumplings reset it back to
 * 5 and it never finished. The cause is "a newly seen breaching body counts as moving" combined
 * with `elapsedMs` being tied to that condition. This block pins the new rule: **once counting,
 * only "nothing above the line" resets it.**
 */
describe('OverflowMonitor — 起算後倒數不可被運動打斷 / counting is immune to movement', () => {
  it('keeps counting when a fresh dumpling lands on the pile', () => {
    /*
     * 這就是使用者截圖裡的情境：倒數走到一半，玩家再投一顆，新顆粒掉進堆疊、碰到其他方團團
     * → `entered = true`，上緣在線上 → 成為越線顆粒 → 舊實作在此歸零。
     * This is the screenshot's exact scenario: mid-countdown the player drops again, the fresh
     * dumpling touches the pile so `entered` goes true, its top edge is over the line — and the
     * old code zeroed the timer right here.
     */
    const monitor = new OverflowMonitor(GRACE);
    const piled = overTheLine();

    /* 起算：建立基準 → 停定 200ms → 倒數開始（1000ms）。 */
    stepSettled(monitor, piled);
    monitor.update(1000, [piled], LINE);
    expect(monitor.elapsed).toBe(2000);

    /* 新投的一顆，第一次見到，位置略有不同。 */
    const fresh = { id: nextId++, x: piled.x + 2, y: piled.y - 2, radius: 20, entered: true };
    monitor.update(1000, [piled, fresh], LINE);

    expect(monitor.elapsed).toBe(3000);
    expect(monitor.settled).toBe(true);
    /* 玩家看到的是「4 → 3」繼續走，而不是跳回 5。 */
    expect(monitor.remainingSeconds).toBe(2);
  });

  it('keeps counting even while the whole pile is shoved around', () => {
    /*
     * 越線即起算，之後不論位移多大都照算 —— 玩家把整堆推得團團轉也一樣要算完。
     * Counting starts the moment a piled body breaches, and no amount of displacement stops it —
     * even a pile shoved all over must run the clock out.
     */
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    expect(monitor.elapsed).toBe(1000);

    /* 每一步都大幅位移。 */
    for (let step = 0; step < 2; step += 1) {
      monitor.update(1000, [{ ...body, y: body.y - 30 + step * 60, x: body.x + 40 }], LINE);
    }

    expect(monitor.elapsed).toBe(3000);
    expect(monitor.isOver).toBe(false);
  });

  it('still ends the run even if the player never stops dropping', () => {
    /*
     * 這條是整個修正的落點：**倒數終究會走完**。玩家瘋狂投放也救不了已經起算的倒數。
     * 舊實作下這個場景會永遠停在 5 秒。
     * This is the whole point of the fix: **the countdown does finish**. Dropping frantically
     * cannot save a countdown that has already begun — under the old code this scenario hung at
     * 5 forever.
     */
    const monitor = new OverflowMonitor(3000);
    const piled = overTheLine();

    stepSettled(monitor, piled);

    /* 每 500ms 補一顆新方團團，堆已經高到永遠有東西越線。 */
    for (let round = 0; round < 12 && !monitor.isOver; round += 1) {
      const fresh = { id: nextId++, x: 100 + round, y: 28, radius: 20, entered: true };
      monitor.update(500, [piled, fresh], LINE);
    }

    expect(monitor.isOver).toBe(true);
  });

  it('still resets when every breaching body drops back below the line', () => {
    /*
     * 唯一仍然能讓倒數歸零的條件。玩家若真的把越線的顆粒推回線下（例如用大顆合成掉），
     * 那是「解除越界」，倒數就該重算 —— 而且要重新越線才會再次起算。
     * The one thing that still resets it. If the player genuinely pushes the breaching bodies
     * back under the line (by merging them away with something bigger), the breach *is* cleared,
     * so the countdown restarts — and must breach all over again to count.
     */
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);
    expect(monitor.elapsed).toBe(2000);

    /* 全部退回線下 → 歸零。 */
    monitor.update(16.7, [underTheLine()], LINE);
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);

    /* 再越線 → 立刻重新起算（不需再等停定）。 */
    const again = overTheLine();
    monitor.update(200, [again], LINE);
    expect(monitor.elapsed).toBe(200);
    expect(monitor.settled).toBe(true);
  });

  it('forgets that it was counting after a reset', () => {
    /*
     * `reset()` 必須把 `counting` 一起清掉，否則新一局一開始就越線就立刻倒數，
     * 開局的空場就會被誤判。
     * `reset()` must clear `counting` too, otherwise a new run would start counting the instant
     * anything crosses the line.
     */
    const monitor = new OverflowMonitor(GRACE);
    const body = overTheLine();

    stepSettled(monitor, body);
    monitor.update(1000, [body], LINE);
    expect(monitor.elapsed).toBe(2000);

    monitor.reset();
    expect(monitor.elapsed).toBe(0);
    expect(monitor.settled).toBe(false);

    /* 新局：同樣的顆粒越線，重新起算。 */
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

    /* 還沒越線 → 0。 */
    expect(monitor.remainingSeconds).toBe(0);

    stepSettled(monitor, body);
    /* 已過 1000ms ⇒ 剩 4000ms ⇒ 顯示 4。 */
    expect(monitor.remainingSeconds).toBe(4);

    monitor.update(3900, [body], LINE);
    /* 剩 100ms ⇒ 進位成 1，而不是 0。 */
    expect(monitor.remainingSeconds).toBe(1);
  });

  it('reports zero seconds left while nothing is over the line', () => {
    const monitor = new OverflowMonitor(GRACE);

    monitor.update(16.7, [underTheLine()], LINE);

    expect(monitor.settled).toBe(false);
    expect(monitor.remainingSeconds).toBe(0);
  });
});
