/**
 * 結算覆蓋層。
 * The end-of-run overlay.
 *
 * 一局的結束（溢位逾時）需要一個明確的出口：告訴玩家這一局拿到多少、並給一個立刻再來
 * 一次的按鈕。少了它，`GameSession.reset()` 就沒有 UI 入口，玩家只能重新整理頁面。
 * A run's end (overflow timed out) needs a clear exit: it tells the player what they scored
 * and offers an immediate restart. Without it `GameSession.reset()` has no UI entry and the
 * player's only option is reloading the page.
 *
 * 這一支**只呈現結果**：分數由呼叫端算好（`GameSession.score` / `mergedCount` /
 * `ProgressStore.recordScore()`），覆蓋層不自己讀遊戲狀態。
 * This module only presents results: the caller computes them, and the overlay never reads
 * game state itself.
 */

import { i18nAriaLabel, i18nText, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

export interface GameOverSummary {
  score: number;
  merged: number;
  /** 更新後的歷史最高分。 */
  best: number;
  /** 這一局是否刷新了最高分；決定要不要顯示「NEW BEST」。 */
  isNewBest: boolean;
}

export interface GameOverView {
  /** 顯示覆蓋層並填入結果。 */
  show(summary: GameOverSummary): void;
  hide(): void;
  readonly visible: boolean;
}

export interface GameOverOptions {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /** 玩家按下「再玩一次」時呼叫。 */
  onRestart: () => void;
}

/** 一格統計（標籤 ＋ 數值）。標籤收的是**鍵**，與 HUD 那兩列共用同一組 `label.*`。 */
function statRow(labelKey: MessageKey): { root: HTMLElement; value: HTMLElement } {
  const root = el('div', 'game-over__stat');
  const value = el('dd', 'game-over__stat-value', '0');

  const term = el('dt', 'game-over__stat-label');
  i18nText(term, labelKey);

  appendChildren(root, term, value);

  return { root, value };
}

export function createGameOver(options: GameOverOptions): GameOverView {
  const root = el('div', 'game-over');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  i18nAriaLabel(root, 'gameOver.aria');

  const badge = el('p', 'game-over__badge');
  i18nText(badge, 'label.newBest');
  badge.hidden = true;

  const score = statRow('label.score');
  const merged = statRow('label.merged');
  const best = statRow('label.best');

  const stats = el('dl', 'game-over__stats');
  appendChildren(stats, score.root, merged.root, best.root);

  const restart = el('button', 'game-over__restart');
  restart.type = 'button';
  i18nText(restart, 'gameOver.playAgain');

  const title = el('h2', 'game-over__title');
  i18nText(title, 'label.gameOver');

  const card = el('div', 'game-over__card');
  appendChildren(card, title, badge, stats, restart);

  root.append(card);
  options.host.append(root);

  restart.addEventListener('click', (): void => {
    /* 先收起覆蓋層再重設：反過來的話玩家會看到一幀疊著舊分數的畫面。 */
    view.hide();
    options.onRestart();
  });

  const view: GameOverView = {
    get visible(): boolean {
      return !root.hidden;
    },

    show(summary: GameOverSummary): void {
      score.value.textContent = String(summary.score);
      merged.value.textContent = String(summary.merged);
      best.value.textContent = String(summary.best);
      badge.hidden = !summary.isNewBest;
      root.hidden = false;
      /* 焦點移到按鈕，鍵盤使用者不必先用 Tab 找出口。 */
      restart.focus();
    },

    hide(): void {
      root.hidden = true;
    },
  };

  return view;
}
