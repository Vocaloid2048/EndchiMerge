/**
 * HUD：NEXT、SCORE 與 COMBO 卡的 DOM 更新；只讀狀態寫 DOM，不含遊戲邏輯。
 * The HUD: DOM updates for the NEXT, SCORE and COMBO cards; it reads state, owns no game logic.
 */

import type { SpriteLoader } from '../render/spriteLoader';
import { placeholderColor } from '../render/placeholder';
import type { LevelDef } from '../core/types';
import { el, hook } from './dom';
import type { Layout } from './layout';

export interface HudOptions {
  layout: Layout;
  sprites: SpriteLoader;
  levels: readonly LevelDef[];
}

export interface HudState {
  /**
   * NEXT 卡顯示的等級編號，來自 `spawnQueue.peekAt(1)`：**放下手上這顆之後**才上場的那顆，
   * 不是 `pendingLevelId`（那是即將掉落、由準心預覽負責的那顆）。
   * The NEXT card's level id, from `spawnQueue.peekAt(1)`: the one after the dumpling in hand,
   * not `pendingLevelId` (which is about to drop and drives the aim preview).
   */
  nextLevelId: number;
  score: number;
  mergedCount: number;
  /**
   * 本次投放已合成的次數 —— COMBO 卡的大數字。
   * This drop's merge count — the COMBO card's big number.
   */
  comboCount: number;
  /**
   * 本次投放合共賺了多少分 —— 第二行的 `+ 18`。
   * This drop's total score — the `+ 18` on the second line.
   */
  comboDropScore: number;
  /**
   * 最後一次合成所用的倍率（已四捨五入到小數兩位）；尚未合成為 1。
   * The last merge's multiplier (already rounded to two decimals); `1` before any merge.
   */
  comboMultiplier: number;
  /**
   * 歷史最高分；由 `ProgressStore` 邊玩邊記，超越的當下即更新。
   * The best score so far, updated live by `ProgressStore`.
   */
  bestTry?: number;
}

export class Hud {
  private readonly sprites: SpriteLoader;
  private readonly levels: ReadonlyMap<number, LevelDef>;
  private readonly nextHost: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private readonly mergedValue: HTMLElement;
  private readonly bestTryValue: HTMLElement;
  private readonly comboCountValue: HTMLElement;
  private readonly comboDetailValue: HTMLElement;

  /**
   * 上次寫入的值；初值用 NaN，保證第一次一定更新。
   * Last written values; seeded with NaN so the first update always writes.
   */
  private lastNextId = Number.NaN;
  private lastScore = Number.NaN;
  private lastMerged = Number.NaN;
  private lastBestTry = Number.NaN;
  private lastComboCount = Number.NaN;
  private lastComboDetail = '';

  constructor(options: HudOptions) {
    this.sprites = options.sprites;
    this.levels = new Map(options.levels.map((level) => [level.id, level]));

    const { regions } = options.layout;
    this.nextHost = hook<HTMLElement>(regions.next, 'next-preview');
    this.scoreValue = hook<HTMLElement>(regions.score, 'score-value');
    this.mergedValue = hook<HTMLElement>(regions.score, 'merged');
    this.bestTryValue = hook<HTMLElement>(regions.score, 'best-try');
    this.comboCountValue = hook<HTMLElement>(regions.combo, 'combo-count');
    this.comboDetailValue = hook<HTMLElement>(regions.combo, 'combo-detail');
  }

  /**
   * 套用一份新狀態。只有變動的欄位會被寫入 DOM。
   * Applies a new state; only changed fields are written to the DOM.
   */
  update(state: HudState): void {
    if (state.nextLevelId !== this.lastNextId) {
      this.renderNext(state.nextLevelId);
      this.lastNextId = state.nextLevelId;
    }

    if (state.score !== this.lastScore) {
      this.scoreValue.textContent = String(state.score);
      this.lastScore = state.score;
    }

    if (state.mergedCount !== this.lastMerged) {
      this.mergedValue.textContent = String(state.mergedCount);
      this.lastMerged = state.mergedCount;
    }

    /*
     * COMBO 卡大數字 ＝ **本次投放**的合成次數。零也是真值（投放後歸零），所以用數值比對。
     * The COMBO card's big number is how many merges **this drop** produced. Zero is a real value
     * right after a drop, so this compares numbers rather than skipping falsy values.
     */
    if (state.comboCount !== this.lastComboCount) {
      this.comboCountValue.textContent = String(state.comboCount);
      this.lastComboCount = state.comboCount;
    }

    /*
     * 第二行：`+ 18 (×1.74)` —— 本次投放合共得分，加上最後一次合成所用的倍率。
     * `comboMultiplier()` 已算好並四捨五入，這裡**直接顯示**，不可再套任何曲線或換算。
     * The second line: `+ 18 (×1.74)` — this drop's total with its last merge's multiplier.
     * `comboMultiplier()` already rounds it; display it **as is**, never re-apply a curve.
     */
    const detail = `+ ${String(state.comboDropScore)} (×${state.comboMultiplier.toFixed(2)})`;
    if (detail !== this.lastComboDetail) {
      this.comboDetailValue.textContent = detail;
      this.lastComboDetail = detail;
    }

    const bestTry = state.bestTry ?? 0;
    if (bestTry !== this.lastBestTry) {
      this.bestTryValue.textContent = String(bestTry);
      this.lastBestTry = bestTry;
    }
  }

  private renderNext(levelId: number): void {
    const level = this.levels.get(levelId);

    if (level === undefined) {
      this.nextHost.replaceChildren();
      return;
    }

    const entry = this.sprites.get(level.id);

    if (entry?.ok !== true) {
      this.nextHost.replaceChildren(buildFallback(level));
      return;
    }

    const image = new Image();
    /* 與名冊共用的輪廓白框（`sprite-outline`）。 */
    /* The white outline shared with the roster (`sprite-outline`). */
    image.className = 'card__preview-img sprite-outline';
    image.decoding = 'async';
    image.alt = level.name;
    /* 載入後才失敗（例如快取被清）時退回等級色塊。 */
    /* Falls back to the level swatch when loading fails after the fact (e.g. a purged cache). */
    image.addEventListener('error', (): void => this.nextHost.replaceChildren(buildFallback(level)), {
      once: true,
    });
    image.src = this.sprites.srcFor(level);

    this.nextHost.replaceChildren(image);
    this.nextHost.title = level.name;
  }
}

/**
 * 素材不可用時的替代：等級色塊 + 數字，配色與名冊和 Canvas 佔位圖一致。
 * Fallback when art is unavailable: a level swatch with its number, matching the roster and canvas placeholders.
 */
function buildFallback(level: LevelDef): HTMLElement {
  const fallback = el('span', 'card__preview-fallback', String(level.id));
  fallback.style.setProperty('--fallback-tint', placeholderColor(level.id));
  return fallback;
}
