/**
 * 掉落佇列：NEXT 預覽與實際投放的唯一來源，深度 2（手上的那顆 ＋ 下一顆）。
 * The spawn queue: the single source for both the NEXT preview and the dropped level, depth 2.
 */

import type { LevelDef } from '../core/types';
import type { Rng } from '../core/rng';

/**
 * 佇列深度。2 ＝ 手上的那顆 ＋ NEXT 卡顯示的那顆。
 * Queue depth. 2 = the one in hand plus the one the NEXT card shows.
 */
export const DEFAULT_SPAWN_QUEUE_DEPTH = 2;

export interface SpawnQueueOptions {
  /**
   * 全部等級定義；內部會篩掉不可投放者。
   * Every level definition; non-droppable ones are filtered out internally.
   */
  levels: readonly LevelDef[];
  rng: Rng;
  depth?: number;
  /**
   * 已解鎖的等級；未提供時**不套用**解鎖過濾，只靠 `levels.json` 即可運作。
   * The unlocked levels; when omitted no unlock filter is applied, so `levels.json` alone suffices.
   */
  unlocked?: ReadonlySet<number>;
}

export class SpawnQueue {
  private readonly levels: readonly LevelDef[];
  private readonly rng: Rng;
  private readonly depth: number;
  private items: LevelDef['id'][] = [];
  private unlocked: ReadonlySet<number> | undefined;
  private pool: readonly LevelDef[];

  constructor(options: SpawnQueueOptions) {
    const depth = options.depth ?? DEFAULT_SPAWN_QUEUE_DEPTH;

    if (!Number.isInteger(depth) || depth < 1) {
      throw new RangeError(
        `SpawnQueue requires a positive integer depth, received ${String(depth)}.`,
      );
    }

    this.rng = options.rng;
    this.depth = depth;
    this.levels = options.levels;
    this.unlocked = options.unlocked;

    const pool = this.computePool();

    if (pool.length === 0) {
      throw new RangeError(
        'SpawnQueue found no droppable level with a positive spawnWeight, so nothing could ever drop.',
      );
    }

    this.pool = pool;
    this.refill();
  }

  /**
   * 依「可投放 ＋ 權重為正 ＋（已解鎖）」篩出抽取池。
   * Filter the draw pool by droppable, positive weight, and (when gating is on) unlocked.
   */
  private computePool(): readonly LevelDef[] {
    return this.levels.filter(
      (level) =>
        level.droppable &&
        level.spawnWeight > 0 &&
        (this.unlocked === undefined || this.unlocked.has(level.id)),
    );
  }

  /**
   * 更新解鎖集合並重算抽取池；解鎖只增不減，既有佇列項目仍然合法。
   * Update the unlocked set and recompute the pool; unlocks only grow, so queued items stay valid.
   */
  setUnlocked(unlocked: ReadonlySet<number> | undefined): void {
    this.unlocked = unlocked;

    const pool = this.computePool();

    /* 空池會讓抽取爆掉；寧可保留舊池也不要讓遊戲停擺。
     * An empty pool would break the draw; keeping the old pool beats stalling the game. */
    if (pool.length === 0) return;

    this.pool = pool;
    this.items = this.items.filter((id) => pool.some((level) => level.id === id));
    this.refill();
  }

  /**
   * 目前的佇列內容；`[0]` 是馬上要掉落的那顆。
   * The current queue contents; `[0]` is the one about to drop.
   */
  get pending(): readonly LevelDef['id'][] {
    return this.items;
  }

  get capacity(): number {
    return this.depth;
  }

  get candidates(): readonly LevelDef[] {
    return this.pool;
  }

  /**
   * 預覽第 `index` 顆，**不消耗**；`peekAt(0)` 馬上要掉落，`peekAt(1)` 是 NEXT 卡顯示的那顆。
   * Preview the entry at `index` without consuming it; `peekAt(0)` drops, `peekAt(1)` is the NEXT card.
   */
  peekAt(index: number): LevelDef['id'] {
    if (!Number.isInteger(index) || index < 0 || index >= this.depth) {
      throw new RangeError(
        `SpawnQueue.peekAt(${String(index)}) is outside the queue's depth of ${String(this.depth)}.`,
      );
    }

    const entry = this.items[index];

    /* 佇列永遠保持滿的，所以這裡理論上不會發生；留著是為了讓型別收窄。
     * The queue is always refilled, so this cannot happen; it keeps the type narrowed. */
    if (entry === undefined) {
      throw new Error('SpawnQueue is empty; it should have been refilled after the last take().');
    }

    return entry;
  }

  /**
   * 預覽馬上要掉落的那顆（等同 `peekAt(0)`）。
   * Preview the entry about to drop; shorthand for `peekAt(0)`.
   */
  peek(): LevelDef['id'] {
    return this.peekAt(0);
  }

  /**
   * 取出下一顆並立刻補滿佇列，回傳實際應掉落的等級。
   * Take the next one, refill immediately, and return the level that must actually drop.
   */
  take(): LevelDef['id'] {
    const id = this.peek();
    this.items.shift();
    this.refill();
    return id;
  }

  reset(): void {
    this.items = [];
    this.refill();
  }

  private refill(): void {
    while (this.items.length < this.depth) {
      this.items.push(this.rng.pickWeighted(this.pool, (level) => level.spawnWeight).id);
    }
  }
}
