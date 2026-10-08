/**
 * 排行榜彈窗。
 * The leaderboard popup.
 *
 * 使用者定案：工具的獎盃鍵彈出**模態 popup**（不做獨立頁面）。內容是他定案的三件事 ——
 * **全時段**單一榜、**三個分類分頁**（最高分數／COMBO 數／合成數）、**Top 100**。
 * The user's decision: the trophy button opens a **modal popup** (no separate page). Its content
 * is his three calls — one **all-time** board, **three category tabs** (best score / COMBO /
 * merges) and **Top 100**.
 *
 * **發布設定（顯示名稱與同意分享）刻意不在這裡**（使用者定案）：那是玩家的設定，只在**首次
 * 開啟排行榜**時被單獨問一次（`ui/publishPrompt.ts`），之後要改就到設定裡改。這一支只負責
 * 看榜 —— 榜上沒有輸入框，也沒有儲存鍵。
 * **The publish settings (display name and sharing) are deliberately not here** (the user's
 * decision): they are player settings, asked **once on the first leaderboard open**
 * (`ui/publishPrompt.ts`) and edited in settings afterwards. This module only shows the board —
 * no input field, no save key.
 *
 * 這一支**不含任何規則或儲存**：榜單、名次、百分位全部由 `game/leaderboard.ts` 的
 * `LeaderboardSource` 報告。接上真後端時只需要換一個 `LeaderboardSource` 實作，這個檔案
 * 一行都不用動。
 * **No rules or storage live here**: the board, the ranks and the percentile all come from the
 * `LeaderboardSource` in `game/leaderboard.ts`. Wiring up a real backend means swapping that one
 * implementation — this file does not change.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，與整張畫布一起被 `ui/scale.ts` 等比縮放），
 * 與結算覆蓋層、確認對話框同一套座標語言。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas by
 * `ui/scale.ts`), the same coordinate language as the game-over overlay and the confirm dialog.
 */

import type { LeaderboardCategory, LeaderboardEntry, LeaderboardSource } from '../game/leaderboard';
import { LEADERBOARD_CATEGORIES, LEADERBOARD_LIMIT } from '../game/leaderboard';
import { i18n, i18nAriaLabel, i18nText, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';

/**
 * 分頁標題的語系鍵。
 * The locale key for each tab's label.
 *
 * 分類的**識別與順序**仍由資料層（`LEADERBOARD_CATEGORIES`）決定，只有顯示文字由 UI 翻譯
 * ——資料層不該認識語系。
 * The categories' **identity and order** still come from the data layer
 * (`LEADERBOARD_CATEGORIES`); only the displayed text is translated here, because the data layer
 * should know nothing about locales.
 */
const TAB_KEYS: Readonly<Record<LeaderboardCategory, MessageKey>> = {
  score: 'leaderboard.tab.score',
  combo: 'leaderboard.tab.combo',
  merges: 'leaderboard.tab.merges',
};

export interface LeaderboardOptions {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /** 榜單來源（現階段是本地實作）。 */
  source: LeaderboardSource;
}

export interface LeaderboardView {
  /** 開啟彈窗；已經開著時不做事。 */
  open(): void;
  /** 關閉彈窗；已經關著時不做事。 */
  close(): void;
  readonly visible: boolean;
  /** 移除節點與事件綁定；頁面層級 teardown 用。 */
  dispose(): void;
}

/** 千分位；分數動輒五六位，不加分隔很難讀。 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * 紀錄時間，`YYYY/MM/DD HH:mm`（使用者定案）。
 * Recorded at, as `YYYY/MM/DD HH:mm` (the user's decision).
 *
 * 年份一定要有：榜是**全時段**的，`MM-DD` 在跨年之後會把去年和今年混在一起。
 * The year is not optional: the board is **all-time**, and `MM-DD` would blur last year into
 * this one.
 */
function formatWhen(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number): string => String(value).padStart(2, '0');

  return (
    `${String(date.getFullYear())}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 該分類要顯示的主要數值。 */
function primaryValue(entry: LeaderboardEntry, category: LeaderboardCategory): string {
  switch (category) {
    case 'score':
      return formatNumber(entry.score);
    case 'combo':
      return t('leaderboard.comboValue', { value: formatNumber(entry.maxCombo) });
    case 'merges':
      return t('leaderboard.mergesValue', { value: formatNumber(entry.merges) });
  }
}

export function createLeaderboard(options: LeaderboardOptions): LeaderboardView {
  const { source } = options;

  let category: LeaderboardCategory = LEADERBOARD_CATEGORIES[0]!.id;

  const root = el('section', 'leaderboard');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  i18nAriaLabel(root, 'leaderboard.title');

  const title = el('h2', 'leaderboard__title');
  i18nText(title, 'leaderboard.title');

  /* 副標題帶 Top 數，屬動態文字，由 `renderChrome()` 寫入。 */
  const subtitle = el('p', 'leaderboard__subtitle');

  const closeButton = el('button', 'leaderboard__close', '×');
  closeButton.type = 'button';
  i18nAriaLabel(closeButton, 'leaderboard.close');

  const header = el('header', 'leaderboard__header');
  appendChildren(header, title, subtitle, closeButton);

  /* ── 分頁 ──────────────────────────────────────────────────────────── */

  const tabs = el('div', 'leaderboard__tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<LeaderboardCategory, HTMLButtonElement>();

  for (const item of LEADERBOARD_CATEGORIES) {
    const button = el('button', 'leaderboard__tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', (): void => {
      category = item.id;
      render();
    });
    tabButtons.set(item.id, button);
    tabs.append(button);
  }

  /* ── 榜身與「你自己」摘要 ─────────────────────────────────────────── */

  const list = el('ol', 'leaderboard__list');
  const listWrap = el('div', 'leaderboard__body');
  listWrap.append(list);

  const summary = el('p', 'leaderboard__self');
  summary.hidden = true;

  const card = el('div', 'leaderboard__card');
  appendChildren(card, header, tabs, listWrap, summary);

  root.append(card);
  options.host.append(root);

  /* ── 渲染 ──────────────────────────────────────────────────────────── */

  /** 每次開窗（與換語系）都重寫一次的動態外框文字：副標題與分頁標籤。 */
  function renderChrome(): void {
    subtitle.textContent = t('leaderboard.subtitle', { limit: LEADERBOARD_LIMIT });

    for (const item of LEADERBOARD_CATEGORIES) {
      tabButtons.get(item.id)!.textContent = t(TAB_KEYS[item.id]);
    }
  }

  function renderList(): void {
    const snapshot = source.snapshot(category);

    for (const [id, button] of tabButtons) {
      button.classList.toggle('leaderboard__tab--active', id === category);
      button.setAttribute('aria-selected', id === category ? 'true' : 'false');
    }

    if (snapshot.entries.length === 0) {
      const empty = el('li', 'leaderboard__empty');
      empty.textContent = source.sharing
        ? t('leaderboard.emptyShare')
        : t('leaderboard.emptyNoShare');
      list.replaceChildren(empty);
      summary.hidden = true;
      return;
    }

    /*
     * 列上**不再重複顯示分數**（使用者定案）：分數是「最高分數」分頁的主要數值，在另外兩個
     * 分頁它只是一份附帶資訊，每個分類都掛一串「XXXX 分」反而讓真正的排序依據失焦。
     * Rows **no longer repeat the score** (the user's decision): the score is the primary value of
     * the "best score" tab, and carrying a second "XXXX 分" on every row only distracts from the
     * value that actually ordered that tab.
     */
    const rows = snapshot.entries.map((entry, index): HTMLElement => {
      const row = el('li', 'leaderboard__row');
      row.dataset['rank'] = String(index + 1);

      const rank = el('span', 'leaderboard__rank', `#${String(index + 1)}`);
      const who = el(
        'span',
        'leaderboard__who',
        entry.name === '' ? t('leaderboard.unnamed') : entry.name,
      );
      const value = el('span', 'leaderboard__value', primaryValue(entry, category));
      const when = el('span', 'leaderboard__when', formatWhen(entry.at));

      appendChildren(row, rank, who, value, when);
      return row;
    });

    list.replaceChildren(...rows);

    if (snapshot.self === null) {
      summary.hidden = true;
      return;
    }

    /*
     * 百分位在本地是「超越你自己 X% 的場次」——跨玩家版本需要伺服器（見 `game/leaderboard.ts`）。
     * 文案照這個事實寫，不假裝它是全球排名。
     * The percentile is local — "beats X% of your own runs" — because a cross-player version
     * needs the server (see `game/leaderboard.ts`). The copy says exactly that instead of
     * pretending it is a global rank.
     */
    const { entry, percentile, total } = snapshot.self;
    summary.hidden = false;
    summary.textContent = t('leaderboard.self', {
      value: primaryValue(entry, category),
      score: formatNumber(entry.score),
      percentile,
      total,
    });
  }

  function render(): void {
    renderChrome();
    renderList();
  }

  /* ── 開關、鍵盤與焦點 ─────────────────────────────────────────────── */

  let previouslyFocused: HTMLElement | null = null;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const onBackdropPointerDown = (event: PointerEvent): void => {
    if (event.target === root) close();
  };

  const onCloseClick = (): void => close();

  function close(): void {
    if (root.hidden) return;

    root.hidden = true;
    document.removeEventListener('keydown', onKeyDown, true);
    root.removeEventListener('pointerdown', onBackdropPointerDown);

    previouslyFocused?.focus();
    previouslyFocused = null;
  }

  function open(): void {
    if (!root.hidden) return;

    previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    render();
    root.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);

    closeButton.focus();
  }

  closeButton.addEventListener('click', onCloseClick);

  const unsubscribe = source.subscribe((): void => {
    if (!root.hidden) render();
  });

  /* 換語系時榜上的文字（分頁、數值單位、自己的摘要）要跟著重畫。 */
  const unsubscribeLocale = i18n.subscribe((): void => {
    if (!root.hidden) render();
  });

  return {
    get visible(): boolean {
      return !root.hidden;
    },

    open,
    close,

    dispose(): void {
      unsubscribe();
      unsubscribeLocale();
      closeButton.removeEventListener('click', onCloseClick);
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
