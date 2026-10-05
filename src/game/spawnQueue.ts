/**
 * 掉落佇列。
 * The spawn queue.
 *
 * 依 design.md §5.7（D22）的硬性要求：**NEXT 卡顯示的方團團，必須就是佇列裡的那一顆**。
 * Per design.md §5.7 (D22) the NEXT card must show a dumpling that really comes from the
 * queue rather than being guessed independently.
 *
 * 舊版做法是「NEXT 與投放各自抽一次」，只要兩邊的抽取條件有一點不同步就會露出馬腳
 * （例如玩家看到 A、掉下 B）。這裡改用**單一佇列**：只有這個類別能產生等級，
 * 預覽讀 `peekAt()`、投放呼叫 `take()`，兩者看的是同一個陣列。
 * The old approach drew twice — once for the display, once for the drop — and any drift
 * showed up as "the card said A, B fell". Here a single queue is the only producer:
 * previews read `peekAt()`, drops call `take()`, and both look at the same array.
 *
 * **深度 2，不是 1。** 玩家看到的 NEXT 是「**放下手上這顆之後**才會上場的那顆」，
 * 所以佇列必須同時容納「馬上要掉的」與「下一顆」：
 * **Depth 2, not 1.** The NEXT card shows the dumpling that follows the one in hand, so the
 * queue has to hold both "about to drop" and "the one after":
 *
 * - `peekAt(0)` ＝ 現在按下滑鼠會放下的那顆（`GameSession.pendingLevelId`）
 * - `peekAt(1)` ＝ NEXT 卡顯示的那顆（`GameSession.upcomingLevelId`）
 *
 * 這個順序不可以顛倒：若把 `peekAt(1)` 拿去投放，畫面就會出現「卡上寫 A、掉下 B」，
 * 那正是 D22 要消滅的 bug。
 * The order must not be swapped: dropping `peekAt(1)` would resurrect exactly the "card says
 * A, B falls" bug D22 exists to kill.
 */

import type { LevelDef } from '../core/types';
import type { Rng } from '../core/rng';

/**
 * 佇列深度。2 ＝ 手上的那顆 ＋ NEXT 卡顯示的那顆。
 * Queue depth. 2 = the one in hand plus the one the NEXT card shows.
 */
export const DEFAULT_SPAWN_QUEUE_DEPTH = 2;

export interface SpawnQueueOptions {
  /** 全部等級定義；內部會篩掉不可投放者。 */
  levels: readonly LevelDef[];
  /** 亂數來源；注入種子即可讓序列可斷言。 */
  rng: Rng;
  /** 佇列深度；預設 2（見上方說明）。 */
  depth?: number;
  /**
   * 已解鎖的等級。未提供時**不套用**解鎖過濾 —— 那讓這個類別在測試與沒有存檔的場合
   * 仍然只靠 `levels.json` 就能運作。
   * The unlocked levels. When omitted, no unlock filter is applied, which keeps the class
   * usable from `levels.json` alone in tests and where no save exists.
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

    /*
     * 只有「可投放」且「權重為正」且（套用過濾時）「已解鎖」的等級能進池。前兩個條件都要，
     * 因為 `droppable` 是作者的意圖、`spawnWeight` 是實際機率，只檢查其中一個會讓配置
     * 寫錯時悄悄改變掉落表。解鎖則是**遊戲進行中的狀態**：作者說「這一級可以被生成」，
     * 但玩家還沒解鎖它，仍然不該出現。
     * A level must be droppable, positively weighted, and (when gating is on) unlocked. The
     * first two are both needed because the flag is intent and the weight is the odds. The
     * unlock gate is different in kind: the author says a level *may* spawn, but a level the
     * player has not unlocked must not appear.
     */
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

  /** 依「可投放 ＋ 權重為正 ＋（已解鎖）」篩出抽取池。 */
  private computePool(): readonly LevelDef[] {
    return this.levels.filter(
      (level) =>
        level.droppable &&
        level.spawnWeight > 0 &&
        (this.unlocked === undefined || this.unlocked.has(level.id)),
    );
  }

  /**
   * 更新解鎖集合並重算抽取池。
   * Update the unlocked set and recompute the pool.
   *
   * 解鎖在遊戲中只會**增加**，所以池只會變大，已經抽出的佇列項目仍然合法。這裡仍順手把
   * 不再合法的項目剔除並補滿，好讓日後若有人做「重設進度」也不會留下孤兒。
   * Unlocks only ever grow during play, so the pool only grows and queued items stay valid.
   * Stale items are pruned and the queue refilled anyway, so a future "reset progress"
   * cannot leave orphans behind.
   *
   * @param unlocked 新的解鎖集合；傳 `undefined` 可關掉過濾。
   */
  setUnlocked(unlocked: ReadonlySet<number> | undefined): void {
    this.unlocked = unlocked;

    const pool = this.computePool();

    /* 空池會讓抽取爆掉；寧可保留舊池也不要讓遊戲停擺。 */
    if (pool.length === 0) return;

    this.pool = pool;
    this.items = this.items.filter((id) => pool.some((level) => level.id === id));
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
   * 預覽第 `index` 顆，**不消耗**。
   * Preview the entry at `index` without consuming it.
   *
   * `peekAt(0)` 是馬上要掉落的那顆，`peekAt(1)` 是 NEXT 卡要顯示的那顆。佇列永遠保持滿的
   * （`take()` 會立刻補），所以這裡不可能取到已經被消耗掉的等級。
   * `peekAt(0)` is about to drop, `peekAt(1)` is what the NEXT card shows. The queue is
   * always kept full, so this can never address a level that was already consumed.
   *
   * @param index 0 為底 / Zero-based index.
   */
  peekAt(index: number): LevelDef['id'] {
    if (!Number.isInteger(index) || index < 0 || index >= this.depth) {
      throw new RangeError(
        `SpawnQueue.peekAt(${String(index)}) is outside the queue's depth of ${String(this.depth)}.`,
      );
    }

    const entry = this.items[index];

    /* 建構子與 `take()` 都會補滿佇列，所以這裡理論上不會發生；留著是為了讓型別收窄，
     * 也避免有人日後改了補滿邏輯卻讓取用端拿到 undefined。 */
    if (entry === undefined) {
      throw new Error('SpawnQueue is empty; it should have been refilled after the last take().');
    }

    return entry;
  }

  /**
   * 預覽馬上要掉落的那顆（等同 `peekAt(0)`）。
   * Preview the entry that is about to drop; shorthand for `peekAt(0)`.
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
