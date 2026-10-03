/**
 * 可注入種子的亂數來源。
 * Seedable random number source.
 *
 * 存在理由是**可測試性**：掉落抽取若直接用 `Math.random()`，測試便無法斷言
 * 序列，只能斷言「有抽到東西」。可注入種子後，權重分佈與邊界案例都能用固定序列驗證。
 * The point is testability: a spawner calling `Math.random()` directly can only be
 * asserted as "returned something". With an injectable seed, weight distribution
 * and boundary cases become deterministic.
 */

export interface Rng {
  /** 回傳 [0, 1) 的浮點數。 */
  next(): number;
  /** 回傳 [0, maxExclusive) 的整數。 */
  int(maxExclusive: number): number;
  /**
   * 依權重抽取一個元素。
   *
   * 權重為 0 的元素永遠不會被選中。若全部權重皆為 0，代表配置錯誤，直接拋錯
   * 而非靜默回傳任意元素 —— 靜默失敗會讓「掉落物永遠是同一種」這種 bug 極難察覺。
   * Items with weight 0 are never selected. If every weight is 0 the config is
   * wrong, so this throws rather than silently returning an arbitrary item: a
   * silent failure here makes "the spawner is stuck on one level" very hard to
   * notice.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
}

/** mulberry32：小、快、週期足夠，且對種子敏感。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 建立一個指定種子的亂數來源。同種子必然產生同序列。 */
export function createRng(seed: number): Rng {
  const next = mulberry32(seed);

  return {
    next,

    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(
          `Rng.int() requires a positive integer bound, received ${String(maxExclusive)}.`,
        );
      }
      return Math.floor(next() * maxExclusive);
    },

    pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
      if (items.length === 0) {
        throw new RangeError('Rng.pickWeighted() requires at least one item.');
      }

      const weights: number[] = [];
      let total = 0;

      for (const item of items) {
        const weight = weightOf(item);
        if (!Number.isFinite(weight) || weight < 0) {
          throw new RangeError(
            `Rng.pickWeighted() received an invalid weight: ${String(weight)}.`,
          );
        }
        weights.push(weight);
        total += weight;
      }

      if (total <= 0) {
        throw new RangeError(
          'Rng.pickWeighted() received weights summing to zero, so nothing could be selected.',
        );
      }

      let roll = next() * total;

      for (let index = 0; index < items.length; index += 1) {
        roll -= weights[index] as number;
        if (roll < 0) {
          return items[index] as T;
        }
      }

      /* 浮點誤差可能令迴圈走完仍未命中；最後一個非零權重的元素是安全答案。 */
      return items[items.length - 1] as T;
    },
  };
}
