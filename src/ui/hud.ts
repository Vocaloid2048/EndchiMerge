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
  /**
   * **本次投放**的合共得分。這是 COMBO 卡的大數字。
   * The total score earned by **this drop** — the COMBO card's big number.
   */
  dropScore: number;
  /** 本次投放已合成的次數。顯示在倍率旁，讓玩家看得出連鎖有多長。 */
  dropMergeCount: number;
  /** 最近一次合成的加分與倍率，渲染成 `+16 (×2.0)`。 */
  lastGain: { base: number; multiplier: number; gain: number };
  /** 現在是否可以投放；false 時卡片轉為冷卻態。 */
  canDrop: boolean;
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
  private readonly comboScoreValue: HTMLElement;
  private readonly comboDetailValue: HTMLElement;
  private readonly comboCard: HTMLElement;

  /** 上次寫入的值；初值用不可能的數字，保證第一次一定更新。 */
  private lastNextId = Number.NaN;
  private lastScore = Number.NaN;
  private lastMerged = Number.NaN;
  private lastBestTry = Number.NaN;
  private lastComboScore = Number.NaN;
  private lastComboDetail = '';
  private lastCanDrop: boolean | null = null;

  constructor(options: HudOptions) {
    this.sprites = options.sprites;
    this.levels = new Map(options.levels.map((level) => [level.id, level]));

    const { regions } = options.layout;
    this.nextHost = hook<HTMLElement>(regions.next, 'next-preview');
    this.scoreValue = hook<HTMLElement>(regions.score, 'score-value');
    this.mergedValue = hook<HTMLElement>(regions.score, 'merged');
    this.bestTryValue = hook<HTMLElement>(regions.score, 'best-try');
    this.comboCard = regions.combo;
    this.comboScoreValue = hook<HTMLElement>(regions.combo, 'combo-score');
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
     * COMBO 卡大數字 ＝ **本次投放**的合共得分。零分也要寫（投放後歸零），所以用數值比對
     * 而不是「非零才寫」。
     * The COMBO card's big number is the score **this drop** earned. Zero is a real value
     * (right after a drop), so this compares numbers rather than skipping falsy values.
     */
    if (state.dropScore !== this.lastComboScore) {
      this.comboScoreValue.textContent = `+${String(state.dropScore)}`;
      this.lastComboScore = state.dropScore;
    }

    /*
     * 下面一行：`+16 (×2.0)` 加一個 `n 連` 的串長計數。串長為 0 時只顯示倍率的預設值，
     * 讓卡片在還沒合成時保持乾淨。
     * The line below: `+16 (×2.0)` plus an `n 連` chain counter. With a zero chain it shows
     * just the default multiplier so the card stays quiet before the first merge.
     */
    const detail = this.buildComboDetail(state);
    if (detail !== this.lastComboDetail) {
      this.comboDetailValue.textContent = detail;
      this.lastComboDetail = detail;
    }

    /*
     * 冷卻態：投放後 1 秒內卡片變暗，玩家一眼看得出「現在還不能投」。
     * Cooldown state: the card dims for the second after a drop, so it is obvious at a glance
     * that dropping is not accepted yet.
     */
    if (state.canDrop !== this.lastCanDrop) {
      this.comboCard.classList.toggle('card--cooling', !state.canDrop);
      this.lastCanDrop = state.canDrop;
    }

    const bestTry = state.bestTry ?? 0;
    if (bestTry !== this.lastBestTry) {
      this.bestTryValue.textContent = String(bestTry);
      this.lastBestTry = bestTry;
    }
  }

  /**
   * 組出 COMBO 卡的第二行。
   * Build the COMBO card's second line.
   *
   * 未合成任何東西時顯示 `+0 (×1.0)`（＝下一場合併會用的倍率），一旦有了連鎖就變成
   * `+16 (×2.0)`，並在前面加上串長。三個數字都是**本次投放**的，與大數字同一個窗口。
   * Before any merge it shows `+0 (×1.0)` — the multiplier the next merge would use — and
   * once a chain exists it becomes `+16 (×2.0)` with the chain length in front. All three
   * numbers belong to **this drop**, the same window as the big number.
   */
  private buildComboDetail(state: HudState): string {
    const { gain, multiplier } = state.lastGain;
    const shown = Math.round(multiplier * 10) / 10;
    const gainText = `+${String(gain)} (×${shown.toFixed(1)})`;

    if (state.dropMergeCount <= 0) return gainText;

    return `${String(state.dropMergeCount)} 連 · ${gainText}`;
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
