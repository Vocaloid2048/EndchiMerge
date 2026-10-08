/**
 * 設定彈窗。
 * The settings popup.
 *
 * 使用者定案的版面是兩欄：**左欄是分類**，右欄是該分類的「副標題 → 控件 → 淺灰小字說明」。
 * 一行一個設定，說明就在它下面，所以「這個開關做什麼」永遠不必去別的地方找。
 * The layout the user decided on is two columns: **the category on the left**, and on the right
 * that category's "subtitle → control → small grey note". One setting per row with its note
 * directly beneath, so what a switch does never has to be looked up elsewhere.
 *
 * 四個分類（依使用者定案）：
 * 1. **遊戲玩法 / 規則更改** —— 一個**總開關**，開啟後才可調整其他規則，而且開啟期間成績一律
 *    不記入排行榜（見 `game/preferences.ts` 的閘門說明）。
 * 2. **無盡模式** —— 越過警戒線不再觸發警告與結束。
 * 3. **語言** —— 五個語系，預設跟隨裝置。
 * 4. **排行榜** —— 顯示名稱與分享意願，直接掛 `ui/publishFields.ts`（與首次詢問共用同一支）。
 *
 * Four categories (the user's decision): the rule-change **master switch** (with the other rules
 * only adjustable while it is on, and nothing recorded while it is), **endless mode**, the
 * **language** (five locales, defaulting to the device), and the **leaderboard** fields, which
 * mount the very same `ui/publishFields.ts` the one-off prompt uses.
 *
 * 這一支**不含任何儲存邏輯**：偏好寫進 `PreferencesStore`，名稱與分享寫進 `LeaderboardSource`，
 * 這裡只把控件接上去、把狀態畫出來。
 * **No storage logic lives here**: preferences go to the `PreferencesStore` and the name/sharing to
 * the `LeaderboardSource`; this only wires the controls and draws the state.
 *
 * 尺寸是**設計稿像素**（掛在 `.stage-scale` 內，與整張畫布一起被 `ui/scale.ts` 等比縮放）。
 * Sizes are **design pixels** (mounted inside `.stage-scale`, scaled with the canvas).
 */

import type { LeaderboardSource } from '../game/leaderboard';
import type { PreferencesStore } from '../game/preferences';
import { i18n, i18nAriaLabel, i18nText, LOCALE_LABELS, LOCALES, type Locale, type MessageKey } from '../i18n';
import { appendChildren, el } from './dom';
import { createPublishFields, type PublishFields } from './publishFields';

export interface SettingsOptions {
  /** 掛載點；通常是 `layout.root`（同時也是縮放畫布）。 */
  host: HTMLElement;
  /** 偏好來源（語言、規則總開關、無盡模式）。 */
  preferences: PreferencesStore;
  /** 排行榜來源（顯示名稱與分享意願）。 */
  leaderboard: LeaderboardSource;
}

export interface SettingsView {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

/** 一個開關列的三件東西。 */
interface SwitchRow {
  root: HTMLElement;
  input: HTMLInputElement;
  setChecked(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

/**
 * 開關列：標題在左、開關在右，說明在下一行（淺灰小字）。
 * A switch row: the label on the left, the switch on the right, the note on the line below in
 * small grey type.
 *
 * 用 `<input type="checkbox" role="switch">` 而不是自己畫一顆 div：鍵盤、`Space` 切換、
 * 表單語意與輔助技術全部免費，`aria-checked` 也跟著 `checked` 一起維護。
 * A native `<input type="checkbox" role="switch">` rather than a hand-drawn div: keyboard,
 * `Space` toggling, form semantics and assistive tech all come free, and `aria-checked` is kept
 * in step with `checked`.
 */
function buildSwitchRow(options: {
  labelKey: MessageKey;
  noteKey: MessageKey;
  onChange: (on: boolean) => void;
}): SwitchRow {
  const label = el('span', 'settings__item-label');
  i18nText(label, options.labelKey);

  const input = el('input', 'settings__switch-input');
  input.type = 'checkbox';
  input.setAttribute('role', 'switch');
  i18nAriaLabel(input, options.labelKey);

  const track = el('span', 'settings__switch-track');
  track.setAttribute('aria-hidden', 'true');

  const control = el('label', 'settings__switch');
  appendChildren(control, input, track);

  const head = el('div', 'settings__item-head');
  appendChildren(head, label, control);

  const note = el('p', 'settings__note');
  i18nText(note, options.noteKey);

  const root = el('div', 'settings__item');
  appendChildren(root, head, note);

  input.addEventListener('change', (): void => {
    options.onChange(input.checked);
  });

  return {
    root,
    input,
    setChecked(on: boolean): void {
      input.checked = on;
      input.setAttribute('aria-checked', String(on));
    },
    setDisabled(disabled: boolean): void {
      input.disabled = disabled;
      root.classList.toggle('settings__item--disabled', disabled);
    },
  };
}

export function createSettings(options: SettingsOptions): SettingsView {
  const { preferences, leaderboard } = options;

  const titleId = 'settings-title';

  const root = el('section', 'settings');
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', titleId);

  const title = el('h2', 'settings__title');
  title.id = titleId;
  i18nText(title, 'settings.title');

  const closeButton = el('button', 'settings__close', '×');
  closeButton.type = 'button';
  i18nAriaLabel(closeButton, 'settings.close');

  const header = el('header', 'settings__header');
  appendChildren(header, title, closeButton);

  const body = el('div', 'settings__body');

  /* ── ① 遊戲玩法 / 規則更改 ────────────────────────────────────────── */

  const masterSwitch = buildSwitchRow({
    labelKey: 'settings.rules.master',
    noteKey: 'settings.rules.masterNote',
    onChange: (on): void => preferences.setRulesEnabled(on),
  });

  const endlessSwitch = buildSwitchRow({
    labelKey: 'settings.rules.endless',
    noteKey: 'settings.rules.endlessNote',
    onChange: (on): void => preferences.setEndless(on),
  });

  const more = el('p', 'settings__more');
  i18nText(more, 'settings.rules.more');

  const rulesPanel = el('div', 'settings__panel');
  const rulesSubtitle = el('p', 'settings__subtitle');
  i18nText(rulesSubtitle, 'settings.rules.subtitle');
  appendChildren(rulesPanel, rulesSubtitle, masterSwitch.root, endlessSwitch.root, more);

  /* ── ② 語言 ──────────────────────────────────────────────────────── */

  const languagePanel = el('div', 'settings__panel');
  const languageSubtitle = el('p', 'settings__subtitle');
  i18nText(languageSubtitle, 'settings.language.subtitle');

  const languageList = el('div', 'settings__languages');
  languageList.setAttribute('role', 'radiogroup');
  i18nAriaLabel(languageList, 'settings.language.heading');

  const languageInputs = new Map<Locale, HTMLInputElement>();
  const groupName = 'settings-locale';

  for (const locale of LOCALES) {
    const input = el('input', 'settings__language-input');
    input.type = 'radio';
    input.name = groupName;
    input.value = locale;

    /*
     * 語系名一律用**該語言自己的寫法**（endonym），不翻譯：日文使用者要能一眼找到「日本語」，
     * 而不是在五個莫名其妙的漢字裡猜。所以這一格刻意不掛 `data-i18n`。
     * Locale names are always endonyms and are **not** translated: a Japanese speaker looks for
     * "日本語", not for a guess among five unfamiliar labels. Hence no `data-i18n` here.
     */
    const optionLabel = el('label', 'settings__language');
    appendChildren(optionLabel, input, el('span', 'settings__language-name', LOCALE_LABELS[locale]));

    input.addEventListener('change', (): void => {
      if (input.checked) preferences.setLocale(locale);
    });

    languageInputs.set(locale, input);
    languageList.append(optionLabel);
  }

  const languageNote = el('p', 'settings__note');
  i18nText(languageNote, 'settings.language.note');

  appendChildren(languagePanel, languageSubtitle, languageList, languageNote);

  /* ── ③ 排行榜 ────────────────────────────────────────────────────── */

  const fields: PublishFields = createPublishFields({ source: leaderboard });

  const leaderboardPanel = el('div', 'settings__panel');
  const leaderboardSubtitle = el('p', 'settings__subtitle');
  i18nText(leaderboardSubtitle, 'settings.leaderboard.subtitle');

  const leaderboardNote = el('p', 'settings__note');
  i18nText(leaderboardNote, 'settings.leaderboard.note');

  appendChildren(leaderboardPanel, leaderboardSubtitle, fields.element, leaderboardNote);

  /* ── 組裝 ────────────────────────────────────────────────────────── */

  function category(headingKey: MessageKey, panel: HTMLElement): HTMLElement {
    const heading = el('h3', 'settings__heading');
    i18nText(heading, headingKey);

    const section = el('section', 'settings__category');
    appendChildren(section, heading, panel);
    return section;
  }

  appendChildren(
    body,
    category('settings.rules.heading', rulesPanel),
    category('settings.language.heading', languagePanel),
    category('settings.leaderboard.heading', leaderboardPanel),
  );

  const card = el('div', 'settings__card');
  appendChildren(card, header, body);

  root.append(card);
  options.host.append(root);

  /* ── 狀態同步 ────────────────────────────────────────────────────── */

  /**
   * 把控制項拉回來源。開窗時、以及來源被別處改動時呼叫。
   * Pull the controls back from the sources. Called on open and whenever a source changes
   * elsewhere.
   *
   * **不會**同步名稱輸入框裡玩家正在打的字（`fields.sync()` 自己會避開聚焦中的欄位）。
   * It does **not** clobber what the player is typing in the name field (`fields.sync()` avoids
   * the focused field by itself).
   */
  function sync(): void {
    masterSwitch.setChecked(preferences.rulesEnabled);
    endlessSwitch.setChecked(preferences.endless);
    /* 總開關關著時無盡模式不可調（閘門語意；資料層也會擋，這裡只是讓它看起來就該如此）。 */
    endlessSwitch.setDisabled(!preferences.rulesEnabled);

    for (const [locale, input] of languageInputs) input.checked = locale === preferences.locale;

    fields.sync();
  }

  const unsubscribePreferences = preferences.subscribe((): void => {
    if (!root.hidden) sync();
  });

  const unsubscribeLeaderboard = leaderboard.subscribe((): void => {
    if (!root.hidden) fields.sync();
  });

  /*
   * 語系變更時重跑一次同步：`data-i18n` 的靜態文字由 `main.ts` 的 `applyTo()` 負責，但控件
   * 的**狀態**（勾選、radio、無盡模式的可用性）要在這裡更新，因為它們不是文字。
   * Re-sync on a locale change: `main.ts`'s `applyTo()` handles the static `data-i18n` copy, but
   * the controls' **state** (ticks, radios, endless availability) is updated here, since it is
   * not text.
   */
  const unsubscribeLocale = i18n.subscribe((): void => {
    if (!root.hidden) sync();
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
    sync();
    root.hidden = false;
    document.addEventListener('keydown', onKeyDown, true);
    root.addEventListener('pointerdown', onBackdropPointerDown);

    closeButton.focus();
  }

  closeButton.addEventListener('click', onCloseClick);

  return {
    get visible(): boolean {
      return !root.hidden;
    },

    open,
    close,

    dispose(): void {
      unsubscribePreferences();
      unsubscribeLeaderboard();
      unsubscribeLocale();
      closeButton.removeEventListener('click', onCloseClick);
      fields.dispose();
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
