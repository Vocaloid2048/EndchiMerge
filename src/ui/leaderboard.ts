/**
 * 排行榜彈窗。
 * The leaderboard popup.
 *
 * 使用者定案：工具的獎盃鍵彈出**模態 popup**（不做獨立頁面）。內容是他定案的三件事 ——
 * **全時段**單一榜、**三個分類分頁**（最高分數／COMBO 數／合成數）、**Top 10**；
 * 另外在榜上方放一條「發布列」：首次開啟時請玩家輸入顯示名並選擇是否同意分享，**同意之後
 * 他的成績才會出現在榜上**。
 * The user's decision: the trophy button opens a **modal popup** (no separate page). Its content
 * is his three calls — one **all-time** board, **three category tabs** (best score / COMBO /
 * merges) and **Top 10** — plus a publish bar above the board: on first open it asks for a
 * display name and whether to share, and **his scores only appear once he agrees**.
 *
 * 這一支**不含任何規則或儲存**：榜單、名次、百分位全部由 `game/leaderboard.ts` 的
 * `LeaderboardSource` 報告，名稱驗證由 `game/playerName.ts` 負責。接上真後端時只需要換一個
 * `LeaderboardSource` 實作，這個檔案一行都不用動。
 * **No rules or storage live here**: the board, the ranks and the percentile all come from the
 * `LeaderboardSource` in `game/leaderboard.ts`, and name validation from `game/playerName.ts`.
 * Wiring up a real backend means swapping that one implementation — this file does not change.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，與整張畫布一起被 `ui/scale.ts` 等比縮放），
 * 與結算覆蓋層、確認對話框同一套座標語言。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas by
 * `ui/scale.ts`), the same coordinate language as the game-over overlay and the confirm dialog.
 */

import type { LeaderboardCategory, LeaderboardEntry, LeaderboardSource } from '../game/leaderboard';
import { LEADERBOARD_CATEGORIES } from '../game/leaderboard';
import { NAME_MAX_UNITS, nameErrorText, nameUnits, validateDisplayName } from '../game/playerName';
import { appendChildren, el } from './dom';

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

/** 紀錄時間；`MM-DD HH:mm` 在榜上足夠短也足夠精確。 */
function formatWhen(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';

  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 該分類要顯示的主要數值。 */
function primaryValue(entry: LeaderboardEntry, category: LeaderboardCategory): string {
  switch (category) {
    case 'score':
      return formatNumber(entry.score);
    case 'combo':
      return `${formatNumber(entry.maxCombo)} 連`;
    case 'merges':
      return `${formatNumber(entry.merges)} 次`;
  }
}

export function createLeaderboard(options: LeaderboardOptions): LeaderboardView {
  const { source } = options;

  let category: LeaderboardCategory = LEADERBOARD_CATEGORIES[0]!.id;

  const root = el('section', 'leaderboard');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', '排行榜');

  const title = el('h2', 'leaderboard__title', '排行榜');
  const subtitle = el('p', 'leaderboard__subtitle', '全時段 · Top 10');

  const closeButton = el('button', 'leaderboard__close', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '關閉排行榜');

  const header = el('header', 'leaderboard__header');
  appendChildren(header, title, subtitle, closeButton);

  /* ── 發布列：名稱 ＋ 分享意願 ────────────────────────────────────────── */

  const nameLabel = el('label', 'leaderboard__field-label', '顯示名稱');
  const nameInput = el('input', 'leaderboard__name');
  nameInput.type = 'text';
  nameInput.autocomplete = 'off';
  nameInput.spellcheck = false;
  nameInput.placeholder = '輸入你的名稱';
  nameInput.setAttribute('aria-label', '顯示名稱');
  const nameField = el('div', 'leaderboard__field');
  appendChildren(nameField, nameLabel, nameInput);

  const units = el('p', 'leaderboard__units', `0 / ${String(NAME_MAX_UNITS)} 單位`);

  const shareInput = el('input', 'leaderboard__share-input');
  shareInput.type = 'checkbox';
  const shareLabel = el('label', 'leaderboard__share', '同意將我的成績顯示在排行榜上');
  shareLabel.prepend(shareInput);

  const saveButton = el('button', 'leaderboard__save', '儲存');
  saveButton.type = 'button';

  const error = el('p', 'leaderboard__error');
  error.hidden = true;

  const publish = el('div', 'leaderboard__publish');
  appendChildren(publish, nameField, units, shareLabel, saveButton, error);

  /* ── 分頁 ──────────────────────────────────────────────────────────── */

  const tabs = el('div', 'leaderboard__tabs');
  tabs.setAttribute('role', 'tablist');
  const tabButtons = new Map<LeaderboardCategory, HTMLButtonElement>();

  for (const item of LEADERBOARD_CATEGORIES) {
    const button = el('button', 'leaderboard__tab', item.label);
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
  appendChildren(card, header, publish, tabs, listWrap, summary);

  root.append(card);
  options.host.append(root);

  /* ── 渲染 ──────────────────────────────────────────────────────────── */

  function renderPublish(): void {
    /* 尚未輸入時不要蓋掉玩家正在打的字。 */
    if (document.activeElement !== nameInput) nameInput.value = source.displayName;
    shareInput.checked = source.sharing;
    units.textContent = `${String(nameUnits(nameInput.value))} / ${String(NAME_MAX_UNITS)} 單位`;
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
        ? '還沒有紀錄 —— 先玩一局吧！'
        : '未開啟分享，成績不會上榜。勾選「同意將我的成績顯示在排行榜上」並儲存，你的紀錄就會出現。';
      list.replaceChildren(empty);
      summary.hidden = true;
      return;
    }

    const rows = snapshot.entries.map((entry, index): HTMLElement => {
      const row = el('li', 'leaderboard__row');
      row.dataset['rank'] = String(index + 1);

      const rank = el('span', 'leaderboard__rank', `#${String(index + 1)}`);
      const who = el('span', 'leaderboard__who', entry.name === '' ? '（未命名）' : entry.name);
      const value = el('span', 'leaderboard__value', primaryValue(entry, category));
      const score = el('span', 'leaderboard__score', `${formatNumber(entry.score)} 分`);
      const when = el('span', 'leaderboard__when', formatWhen(entry.at));

      appendChildren(row, rank, who, value, score, when);
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
    summary.textContent = `你的最佳：${primaryValue(entry, category)}（${formatNumber(entry.score)} 分）· 超越你自己 ${String(percentile)}% 的場次（共 ${String(total)} 場）`;
  }

  function render(): void {
    renderPublish();
    renderList();
  }

  /* ── 發布列的互動 ─────────────────────────────────────────────────── */

  nameInput.addEventListener('input', (): void => {
    units.textContent = `${String(nameUnits(nameInput.value))} / ${String(NAME_MAX_UNITS)} 單位`;
    error.hidden = true;
  });

  shareInput.addEventListener('change', (): void => {
    error.hidden = true;
  });

  saveButton.addEventListener('click', (): void => {
    const result = validateDisplayName(nameInput.value);

    if (!result.ok) {
      /* 只想瀏覽、不想分享的人可以留空；但一旦要上榜，名稱就是必要的。 */
      const browseOnly =
        result.reason === 'empty' && !shareInput.checked;

      if (!browseOnly) {
        error.textContent = nameErrorText(result.reason);
        error.hidden = false;
        return;
      }

      source.setDisplayName('');
      source.setSharing(false);
      render();
      return;
    }

    source.setDisplayName(result.value);
    source.setSharing(shareInput.checked);
    nameInput.value = result.value;
    error.hidden = true;
    render();
  });

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

    /* 首次開啟（還沒有名字）時直接把游標放進名稱欄，省一次點擊。 */
    if (source.displayName === '') nameInput.focus();
    else closeButton.focus();
  }

  closeButton.addEventListener('click', onCloseClick);

  const unsubscribe = source.subscribe((): void => {
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
      closeButton.removeEventListener('click', onCloseClick);
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
