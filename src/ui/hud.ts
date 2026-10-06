/**
 * HUD：NEXT、SCORE 與 COMBO 卡的 DOM 更新。
 * The HUD: DOM updates for the NEXT, SCORE and COMBO cards.
 *
 * 這個模組只**讀取**狀態並寫進 DOM，不碰遊戲邏輯。它每幀都會被呼叫，所以每個欄位
 * 都先比對上次的值，只有真的變了才動 DOM —— 每幀重設 `src` 會讓圖片不停重新解碼，
 * 也會讓瀏覽器不停重排。
 * This module only reads state and writes DOM; it owns no game logic. It is called
 * every frame, so each field compares against its previous value and touches the DOM
 * only on a real change — rewriting `src` each frame would re-decode the image and
 * force a reflow.
 *
 * NEXT 的內容來自 `session.upcomingLevelId`，也就是 `spawnQueue.peekAt(1)`：**放下手上
 * 這顆之後**才會上場的那一顆（D22）。它**不是**馬上要掉的那顆（那是
 * `session.pendingLevelId`，由準心預覽負責）。這裡絕不自行抽取或推測下一顆。
 * The NEXT content comes from `session.upcomingLevelId`, i.e. `spawnQueue.peekAt(1)`:
 * the one that takes the field **after** the dumpling in hand (D22). It is **not** the one
 * about to drop — that is `session.pendingLevelId`, which drives the aim preview. This
 * module never draws or guesses a level itself.
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
  /** NEXT 卡顯示的等級編號（＝放下手上這顆之後才上場的那顆）。 */
  nextLevelId: number;
  score: number;
  mergedCount: number;
  /** 本次投放已合成的次數 —— COMBO 卡的大數字。 */
  comboCount: number;
  /** 本次投放合共賺了多少分 —— 第二行的 `+ 18`。 */
  comboDropScore: number;
  /** 最後一次合成所用的倍率；尚未合成為 1。渲染成 `×1.74`（小數兩位）。 */
  comboMultiplier: number;
  /** 最高分；M7 接上存檔前固定為 0。 */
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

  /** 上次寫入的值；初值用不可能的數字，保證第一次一定更新。 */
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

  /** 套用一份新狀態。只有變動的欄位會被寫入 DOM。 */
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
     * COMBO 卡大數字 ＝ **本次投放**的合成次數。零也要寫（投放後歸零），所以用數值比對
     * 而不是「非零才寫」。
     * The COMBO card's big number is how many merges **this drop** produced. Zero is a real
     * value (right after a drop), so this compares numbers rather than skipping falsy values.
     */
    if (state.comboCount !== this.lastComboCount) {
      this.comboCountValue.textContent = String(state.comboCount);
      this.lastComboCount = state.comboCount;
    }

    /*
     * 第二行：`+ 18 (×1.74)` —— 本次投放合共得分，加上最後一次合成所用的倍率。
     * 倍率由 `comboMultiplier()` 算好並已四捨五入到小數兩位（使用者定案），這裡**直接顯示**
     * —— 不可再對它套任何曲線或換算（先前有一版在這裡把倍率又套了一次指數曲線，是錯的）。
     * The second line: `+ 18 (×1.74)` — this drop's total with the multiplier its last merge
     * used. `comboMultiplier()` already rounds to two decimals (the user's decision); display
     * it **as is** — never re-apply a curve here (an earlier version transformed the multiplier
     * a second time, which was wrong).
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
    /* 與名冊同一個輪廓白框（design.md §3.2），讓兩處的方團團看起來是同一個角色。 */
    image.className = 'card__preview-img sprite-outline';
    image.decoding = 'async';
    image.alt = level.name;
    /* 載入後才失敗（例如快取被清）時退回等級色塊。 */
    image.addEventListener('error', (): void => this.nextHost.replaceChildren(buildFallback(level)), {
      once: true,
    });
    image.src = this.sprites.srcFor(level);

    this.nextHost.replaceChildren(image);
    this.nextHost.title = level.name;
  }
}

/** 素材不可用時的替代：等級色塊 + 數字，配色與名冊和 Canvas 佔位圖一致。 */
function buildFallback(level: LevelDef): HTMLElement {
  const fallback = el('span', 'card__preview-fallback', String(level.id));
  fallback.style.setProperty('--fallback-tint', placeholderColor(level.id));
  return fallback;
}
