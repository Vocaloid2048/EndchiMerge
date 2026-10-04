/**
 * 掉落佇列。
 * The spawn queue.
 *
 * 依 design.md §5.7（D22）的硬性要求：**NEXT 卡顯示的方團團，必須就是下一次投放的方團團**。
 * Per design.md §5.7 (D22) the NEXT card must show the exact dumpling that will drop next.
 *
 * 舊版做法是「NEXT 與投放各自抽一次」，只要兩邊的抽取條件有一點不同步就會露出馬腳
 * （例如玩家看到 A、掉下 B）。這裡改用**單一佇列**：只有這個類別能產生等級，
 * NEXT 卡讀 `peek()`、投放呼叫 `take()`，兩者看的是同一個 `items[0]`。
 * The old approach drew twice — once for the display, once for the drop — and any drift
 * between them showed up as "the card said A, B fell". Here a single queue is the only
 * producer: the card reads `peek()`, the drop calls `take()`, and both look at `items[0]`.
 *
 * **禁止**「先顯示、後抽取」。佇列永遠保持滿的，所以 `peek()` 不可能對上一個已消耗的等級。
 * Displaying before drawing is forbidden: the queue is always kept full, so `peek()` can
 * never refer to a level that was already consumed.
 */

import type { LevelDef } from '../core/types';
import type { Rng } from '../core/rng';

/**
 * 佇列深度。1 代表只預測下一顆，與 §2.2「NEXT 卡 = 下一顆方團團」一致。
 * Queue depth. 1 means predicting exactly one dumpling, matching §2.2.
 */
export const DEFAULT_SPAWN_QUEUE_DEPTH = 1;

export interface SpawnQueueOptions {
  /** 全部等級定義；內部會篩掉不可投放者。 */
  levels: readonly LevelDef[];
  /** 亂數來源；注入種子即可讓序列可斷言。 */
  rng: Rng;
  /** 佇列深度；預設 1。 */
  depth?: number;
}

export class SpawnQueue {
  private readonly pool: readonly LevelDef[];
  private readonly rng: Rng;
  private readonly depth: number;
  private items: LevelDef['id'][] = [];

  constructor(options: SpawnQueueOptions) {
    const depth = options.depth ?? DEFAULT_SPAWN_QUEUE_DEPTH;

    if (!Number.isInteger(depth) || depth < 1) {
      throw new RangeError(
        `SpawnQueue requires a positive integer depth, received ${String(depth)}.`,
      );
    }

    /*
     * 只有「標記為可投放」且「權重為正」的等級能進池。兩個條件都要，因為
     * `droppable` 是作者的意圖、`spawnWeight` 是實際機率，只檢查其中一個會讓
     * 配置寫錯時悄悄改變掉落表。
     * A level must be both flagged droppable and weighted above zero. Both checks are
     * needed: the flag is intent, the weight is the actual odds.
     */
    this.pool = options.levels.filter((level) => level.droppable && level.spawnWeight > 0);

    if (this.pool.length === 0) {
      throw new RangeError(
        'SpawnQueue found no droppable level with a positive spawnWeight, so nothing could ever drop.',
      );
    }

    this.rng = options.rng;
    this.depth = depth;
    this.refill();
  }

  /** 目前的佇列內容；`[0]` 就是 NEXT 卡該顯示的等級。 */
  get pending(): readonly LevelDef['id'][] {
    return this.items;
  }

  /** 佇列可容納的長度。 */
  get capacity(): number {
    return this.depth;
  }

  /** 參與抽取的等級（唯讀，供除錯與測試）。 */
  get candidates(): readonly LevelDef[] {
    return this.pool;
  }

  /**
   * 預覽下一顆，**不消耗**。
   * Preview the next one without consuming it.
   *
   * NEXT 卡渲染用。回傳值必然等於緊接著 `take()` 會拿到的值。
   * Used by the NEXT card; the value always equals what the following `take()` returns.
   */
  peek(): LevelDef['id'] {
    const first = this.items[0];

    /* 建構子已填空，所以這裡理論上不會發生；留著是為了讓型別收窄，也避免
     * 有人日後加了 `take()` 卻忘了補佇列時拿到 undefined。 */
    if (first === undefined) {
      throw new Error('SpawnQueue is empty; it should have been refilled after the last take().');
    }

    return first;
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

  /** 清空並重新抽滿，用於開新局。 */
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
