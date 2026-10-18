/**
 * 排行榜彈窗：工具列獎盃鍵彈出的模態 popup，全時段單一榜、三個分類分頁、Top 100。
 * The leaderboard popup: a modal opened by the trophy button — one all-time board, three category tabs, Top 100.
 *
 * 發布設定（顯示名稱與同意）刻意不在這裡：首次開榜由 `ui/publishPrompt.ts` 單獨問一次，之後到設定裡改。
 * The publish settings are deliberately not here: the first open is handled once by `ui/publishPrompt.ts`, and edits live in settings.
 *
 * 不含任何規則或儲存：榜單與名次全部由 `LeaderboardSource` 報告；接後端時只多了 `open()` 裡的 `source.refresh?.()` 一行。
 * It holds no rules or storage: the board and ranks come from `LeaderboardSource`; wiring the backend adds exactly one line — `source.refresh?.()` in `open()`.
 *
 * 一筆紀錄是一位玩家（不是一局）：每一行顯示該玩家在目前分頁分類的最佳值，右邊帶 `HH:mm:ss` 用時。
 * A row is a player, not a run: each row shows that player's best in the current tab's category, with their `HH:mm:ss` run time to the right.
 */

import type { LeaderboardCategory, LeaderboardEntry, LeaderboardSource } from '../game/leaderboard';
import { LEADERBOARD_CATEGORIES, LEADERBOARD_LIMIT } from '../game/leaderboard';
import { BOARD_MODES, boardModeLabelKey, type BoardMode } from '../game/mode';
import { i18n, i18nAriaLabel, i18nText, i18nTitle, t, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';
import { formatDuration } from './duration';

/**
 * 分頁標題的語系鍵；分類的識別與順序仍由資料層決定，只有顯示文字由 UI 翻譯。
 * The locale key per tab label; the categories' identity and order come from the data layer, and only the displayed text is translated here.
 */
const TAB_KEYS: Readonly<Record<LeaderboardCategory, MessageKey>> = {
  score: 'leaderboard.tab.score',
  combo: 'leaderboard.tab.combo',
  merges: 'leaderboard.tab.merges',
};

export interface LeaderboardOptions {
  /**
   * 掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * Where it mounts; usually `layout.root` (also the scaled stage).
   */
  host: HTMLElement;
  /**
   * 榜單來源（現階段是本地實作）。
   * The board source (currently the local implementation).
   */
  source: LeaderboardSource;
}

export interface LeaderboardView {
  /**
   * 開啟彈窗；已經開著時不做事。
   * Opens the popup; a no-op while already open.
   */
  open(): void;
  /**
   * 關閉彈窗；已經關著時不做事。
   * Closes the popup; a no-op while already closed.
   */
  close(): void;
  readonly visible: boolean;
  /**
   * 移除節點與事件綁定；頁面層級 teardown 用。
   * Removes the nodes and bindings; for page-level teardown.
   */
  dispose(): void;
}

/**
 * 千分位；分數動輒五六位，不加分隔很難讀。
 * Thousands separators; five- or six-digit scores are unreadable without them.
 */
function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * 紀錄時間，`YYYY/MM/DD HH:mm`；年份一定要有 —— 榜是全時段的，`MM-DD` 會把去年和今年混在一起。
 * The recorded-at time as `YYYY/MM/DD HH:mm`; the year is not optional — the board is all-time, and `MM-DD` blurs last year into this one.
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

/**
 * 該分類要顯示的主要數值。
 * The primary value shown for the category.
 */
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

  let category: LeaderboardCategory = LEADERBOARD_CATEGORIES[0]!;
  /*
   * 榜的模式篩選（右上角）：預設「所有模式」，兩個模式各佔自己的列並在列上標示。
   * 切換只影響這一面榜，不會改動玩家正在玩的模式。
   * The board's mode filter (top right): "all modes" by default, each row labelled with its mode.
   * Switching only changes this view — never the mode the player is in.
   */
  let mode: BoardMode = 'all';

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

  /* ── 模式篩選（右上角）───────────────────────────────────────────── */

  const modeFilters = el('div', 'leaderboard__modes');
  modeFilters.setAttribute('role', 'group');
  i18nAriaLabel(modeFilters, 'leaderboard.modeFilter');

  const modeButtons = new Map<BoardMode, HTMLButtonElement>();

  for (const item of BOARD_MODES) {
    const button = el('button', 'leaderboard__mode-filter');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    i18nText(button, boardModeLabelKey(item));

    button.addEventListener('click', (): void => {
      if (mode === item) return;

      mode = item;
      /* 換篩選先抓一次：快取是空的，不抓好版會顯示「還沒有紀錄」。 */
      /* A filter change fetches once: the cache for it is empty, and without this the board would read "no records yet". */
      source.refresh?.(mode);
      render();
    });

    modeButtons.set(item, button);
    modeFilters.append(button);
  }

  const header = el('header', 'leaderboard__header');
  appendChildren(header, title, subtitle, modeFilters, closeButton);

  /* ── 分頁 ──────────────────────────────────────────────────────────── */

  const tabs = el('div', 'leaderboard__tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<LeaderboardCategory, HTMLButtonElement>();

  for (const item of LEADERBOARD_CATEGORIES) {
    const button = el('button', 'leaderboard__tab');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.addEventListener('click', (): void => {
      category = item;
      render();
    });
    tabButtons.set(item, button);
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

  /**
   * 每次開窗（與換語系）都重寫一次的動態外框文字：副標題與分頁標籤。
   * The dynamic chrome rewritten on every open (and locale change): the subtitle and the tab labels.
   */
  function renderChrome(): void {
    subtitle.textContent = t('leaderboard.subtitle', { limit: LEADERBOARD_LIMIT });

    for (const item of LEADERBOARD_CATEGORIES) {
      tabButtons.get(item)!.textContent = t(TAB_KEYS[item]);
    }
  }

  /**
   * 載入中的那一格：文字在上、圓環在下，整塊置中；
   * `role="status"` 讓讀屏唸出「載入中…」，圓環 `aria-hidden`（它只是那句話的裝飾）。
   * The loading cell: text on top, ring underneath, centred; `role="status"` gets "loading" announced and the ring is `aria-hidden` (it only decorates that sentence).
   */
  function renderLoading(): HTMLElement {
    const block = el('li', 'leaderboard__loading');
    block.setAttribute('role', 'status');

    const label = el('span', 'leaderboard__loadingText');
    i18nText(label, 'leaderboard.loading');

    const ring = el('span', 'leaderboard__spinner');
    ring.setAttribute('aria-hidden', 'true');

    appendChildren(block, label, ring);

    return block;
  }

  function renderList(): void {
    const snapshot = source.snapshot(category, undefined, mode);

    for (const [id, button] of tabButtons) {
      button.classList.toggle('leaderboard__tab--active', id === category);
      button.setAttribute('aria-selected', id === category ? 'true' : 'false');
    }

    for (const [id, button] of modeButtons) {
      const active = id === mode;
      button.classList.toggle('leaderboard__mode-filter--active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    /*
     * 「正在抓」與「還沒有紀錄」在畫面上都是空的，但不該長得一樣。三個條件都成立才顯示載入中：
     * 這個分類沒有東西可顯示（有快取就照舊顯示榜，不換成轉圈）、分享已開（關掉時 `snapshot()`
     * 一律回空，等下去也不會有東西）、這個分類真的正在抓（本機版沒有這個成員，`?.` 後永遠是假）。
     * "Fetching" and "no records yet" are both empty on screen but must not read alike. All three
     * conditions must hold: nothing to show for this category (a cached board is drawn as usual),
     * sharing is on (with it off `snapshot()` always answers empty), and the category is actually
     * being fetched (the local build has no such member, so `?.` yields false forever).
     */
    const fetching = source.sharing && (source.isFetching?.(category, mode) ?? false);

    if (snapshot.entries.length === 0 && fetching) {
      list.replaceChildren(renderLoading());
      summary.hidden = true;
      return;
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
     * 列上不重複顯示分數：分數是「最高分數」分頁的主要數值，在另外兩個分頁每列都掛一串
     * 「XXXX 分」反而讓真正的排序依據失焦。
     * Rows do not repeat the score: it is the primary value of the score tab, and a second "XXXX 分" on every row of the other tabs only distracts from what actually ordered that tab.
     */
    const rows = snapshot.entries.map((entry, index): HTMLElement => {
      const row = el('li', 'leaderboard__row');
      row.dataset['rank'] = String(index + 1);

      const rank = el('span', 'leaderboard__rank', `#${String(index + 1)}`);
      /*
       * 名字與號是**同一個顯示單位**的兩半：號用淡化小字緊貼在名字後面，兩列同名的人才分得開。
       * 只有名字存在時才顯示 —— 未命名的人沒有東西要區分。
       * Name and tag are two halves of **one display unit**: the tag follows the name in muted small
       * type, which is what keeps two rows sharing a name apart. Shown only when there is a name.
       */
      const who = el('span', 'leaderboard__who');
      appendChildren(
        who,
        el('span', 'leaderboard__name', entry.name === '' ? t('leaderboard.unnamed') : entry.name),
      );
      if (entry.name !== '' && entry.tag !== undefined && entry.tag !== '') {
        appendChildren(who, el('span', 'leaderboard__tag', `#${entry.tag}`));
      }

      /*
       * 模式標記：一位玩家在每個模式各有一列，所以每一列都要說得出自己是哪一個模式。
       * The mode badge: one row per player per mode, so every row has to say which mode it is.
       */
      const badge = el('span', 'leaderboard__mode');
      i18nText(badge, boardModeLabelKey(entry.mode ?? 'new'));
      appendChildren(who, badge);
      const value = el('span', 'leaderboard__value', primaryValue(entry, category));
      /*
       * 時長（`HH:mm:ss`）貼在該分類數值的右邊，回答「這個數字是跑了多久打出來的」。
       * 它描述的是創下最高分那一局（`LeaderboardEntry.durationMs` 綁在分數上）：所以在
       * COMBO／合成分頁讀到的是該玩家最高分那一局的長度，不是創下該紀錄那一局 —— 每位玩家只有一份時長。
       * The duration (`HH:mm:ss`) sits right of the category value, answering "how long was the run that produced this". It describes the best-score run (`LeaderboardEntry.durationMs` is bound to the score): on the combo and merges tabs it reads as that player's best-scoring run, not the run that set that record — one duration per player.
       */
      const duration = el('span', 'leaderboard__duration', formatDuration(entry.durationMs));
      /* 裸一個 `00:01:30` 看不出是什麼，滑過去看得到名字。 */
      i18nTitle(duration, 'label.duration');
      const when = el('span', 'leaderboard__when', formatWhen(entry.at));

      appendChildren(row, rank, who, value, duration, when);
      return row;
    });

    list.replaceChildren(...rows);

    if (snapshot.self === null) {
      summary.hidden = true;
      return;
    }

    /*
     * 名次寫「第幾名／共幾位玩家」；名次掉出榜外（第 101 名起）就改報「超越了百分之多少的玩家」
     * —— 榜只列前 100，那個名次沒有列可核對。門檻用 `LEADERBOARD_LIMIT` 而非本頁長度。
     * The rank reads "Nth of M players"; past the board's edge (#101+) the share of players beaten is reported instead — the board lists the top 100, so that rank has no row to check against. The threshold is `LEADERBOARD_LIMIT`, not the page length.
     */
    const { entry, rank, total, beats } = snapshot.self;
    summary.hidden = false;
    summary.textContent =
      rank > LEADERBOARD_LIMIT
        ? t('leaderboard.selfBeats', {
            value: primaryValue(entry, category),
            score: formatNumber(entry.score),
            beats,
            total,
          })
        : t('leaderboard.self', {
            value: primaryValue(entry, category),
            score: formatNumber(entry.score),
            rank,
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

    /*
     * 開窗時抓一次最新的榜（選填成員，只有伺服器版有）：`snapshot()` 是同步的，讀的是上一次
     * 的快取 —— 少了這一行，另一台裝置刷新的成績要等重開分頁才看得到。
     * Fetches the board once on open (an optional member, server build only): `snapshot()` is synchronous and reads the last cache — without this, a score set on another device would not show until the tab was reopened.
     */
    source.refresh?.(mode);

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
