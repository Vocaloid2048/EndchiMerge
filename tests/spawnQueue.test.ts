/**
 * 掉落佇列的單元測試。
 * Unit tests for the spawn queue.
 *
 * 最重要的一條是 **D22 一致性**：`peek()` 的結果必須永遠等於緊接著 `take()` 的結果。
 * 這一條守住「NEXT 卡說 A 就一定會掉 A」。
 * The critical one is D22 consistency: `peek()` must always equal the following
 * `take()`. That is what guarantees "the card says A, A drops".
 */

import { describe, expect, it } from 'vitest';
import { SpawnQueue, DEFAULT_SPAWN_QUEUE_DEPTH } from '../src/game/spawnQueue';
import { createRng } from '../src/core/rng';
import type { LevelDef } from '../src/core/types';

/** 造一個等級定義，只填與抽取有關的欄位。 */
function level(id: number, spawnWeight: number, droppable = true): LevelDef {
  return {
    id,
    name: `Lv${String(id)}`,
    sprite: `character/lv${String(id)}.webp`,
    radius: 10 + id,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: 0,
    spawnWeight,
    droppable,
    mergeResult: id + 1,
  };
}

/** 與 levels.json 的掉落表一致的迷你版本。 */
const LEVELS: LevelDef[] = [
  level(1, 70),
  level(2, 25),
  level(3, 5),
  level(4, 0, false),
  level(5, 0, false),
];

function makeQueue(levels: LevelDef[] = LEVELS) {
  return new SpawnQueue({ levels, rng: createRng(20261004) });
}

describe('SpawnQueue — 建構 / construction', () => {
  it('starts full so a preview is always available', () => {
    const queue = makeQueue();

    expect(queue.pending).toHaveLength(DEFAULT_SPAWN_QUEUE_DEPTH);
    expect(queue.capacity).toBe(DEFAULT_SPAWN_QUEUE_DEPTH);
  });

  it('rejects a depth below one', () => {
    expect(() => new SpawnQueue({ levels: LEVELS, rng: createRng(1), depth: 0 })).toThrow(
      /positive integer depth/,
    );
  });

  it('rejects a level set with nothing droppable', () => {
    expect(() => new SpawnQueue({ levels: [level(4, 0, false)], rng: createRng(1) })).toThrow(
      /no droppable level/,
    );
  });

  it('excludes a droppable level whose weight is zero', () => {
    const queue = new SpawnQueue({
      levels: [level(1, 10), level(2, 0, true)],
      rng: createRng(7),
    });

    expect(queue.candidates.map((entry) => entry.id)).toEqual([1]);
  });

  it('excludes a weighted level that is flagged not droppable', () => {
    const queue = new SpawnQueue({
      levels: [level(1, 10), level(2, 30, false)],
      rng: createRng(7),
    });

    expect(queue.candidates.map((entry) => entry.id)).toEqual([1]);
  });
});

describe('SpawnQueue — D22 一致性 / D22 consistency', () => {
  it('peek() always equals the next take()', () => {
    const queue = makeQueue();

    for (let draw = 0; draw < 200; draw += 1) {
      const previewed = queue.peek();
      const dropped = queue.take();

      expect(dropped).toBe(previewed);
    }
  });

  it('refills after every take so the queue is never empty', () => {
    const queue = makeQueue();

    for (let draw = 0; draw < 50; draw += 1) {
      queue.take();
      expect(queue.pending).toHaveLength(DEFAULT_SPAWN_QUEUE_DEPTH);
    }
  });

  it('keeps a configurable lookahead when the depth is greater than one', () => {
    const queue = new SpawnQueue({ levels: LEVELS, rng: createRng(99), depth: 3 });
    const before = [...queue.pending];

    const dropped = queue.take();

    expect(before).toHaveLength(3);
    expect(dropped).toBe(before[0]);
    /* 取走一顆後，原本的第二顆遞補到最前面。 */
    expect(queue.peek()).toBe(before[1]);
    expect(queue.pending).toHaveLength(3);
  });
});

describe('SpawnQueue — 權重 / weighting', () => {
  it('never draws a level outside the droppable pool', () => {
    const queue = makeQueue();

    for (let draw = 0; draw < 500; draw += 1) {
      expect([1, 2, 3]).toContain(queue.take());
    }
  });

  it('honours the weights rather than drawing uniformly', () => {
    /* 固定種子 → 完全確定，不需要容錯區間以外的隨機性處理。 */
    const queue = makeQueue();
    const counts = new Map<number, number>();

    for (let draw = 0; draw < 2000; draw += 1) {
      const id = queue.take();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const low = counts.get(1) ?? 0;
    const mid = counts.get(2) ?? 0;
    const high = counts.get(3) ?? 0;

    /* 70 / 25 / 5 → 期望值 1400 / 500 / 100；區間放寬到 ±200 仍足以證明不是均勻抽取。 */
    expect(low).toBeGreaterThan(1200);
    expect(mid).toBeGreaterThan(300);
    expect(high).toBeLessThan(300);
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it('is stuck on the only option when just one level is droppable', () => {
    const queue = new SpawnQueue({
      levels: [level(1, 70), level(2, 0, false)],
      rng: createRng(5),
    });

    for (let draw = 0; draw < 20; draw += 1) {
      expect(queue.take()).toBe(1);
    }
  });
});

describe('SpawnQueue — reset()', () => {
  it('refills the queue to full', () => {
    const queue = new SpawnQueue({ levels: LEVELS, rng: createRng(3), depth: 2 });

    queue.take();
    queue.reset();

    expect(queue.pending).toHaveLength(2);
  });

  it('reproduces the same opening sequence for the same seed', () => {
    const first = makeQueue();
    const second = makeQueue();

    expect(first.peek()).toBe(second.peek());
  });
});
