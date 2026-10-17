/**
 * 設定彈窗：兩欄版面（左欄分類、右欄「副標題 → 控件 → 說明」），一行一個設定。
 * The settings popup: a two-column layout (categories on the left, "subtitle → control → note" on the right), one setting per row.
 *
 * 不含任何儲存邏輯：偏好寫進 `PreferencesStore`，名稱與分享寫進 `LeaderboardSource`，這裡只接控件與畫狀態。
 * It holds no storage logic: preferences go to `PreferencesStore`, the name and sharing to `LeaderboardSource`; this only wires controls and draws state.
 */

import type { LeaderboardSource } from '../game/leaderboard';
import type { PreferencesStore } from '../game/preferences';
import { i18n, i18nAriaLabel, i18nText, LOCALE_LABELS, LOCALES, t, type Locale, type MessageKey } from '../i18n';
import { createConfirmDialog, type ConfirmDialogTexts } from './confirmDialog';
import { appendChildren, el } from './dom';
import { createPublishFields, type PublishFields } from './publishFields';

export interface SettingsOptions {
  /**
   * 掛載點；通常是 `layout.root`（同時也是縮放畫布）。
   * Where it mounts; usually `layout.root` (also the scaled stage).
   */
  host: HTMLElement;
  /**
   * 偏好來源（語言、規則總開關、無盡模式）。
   * The preferences source (locale, the rules master gate, endless mode).
   */
  preferences: PreferencesStore;
  /**
   * 排行榜來源（顯示名稱與分享意願）。
   * The leaderboard source (display name and sharing consent).
   */
  leaderboard: LeaderboardSource;
}

/**
 * 開啟無盡模式之前，確認鈕要鎖住多久（毫秒）。
 * How long the confirm button stays locked before endless mode may be switched on.
 *
 * 五秒不是防誤觸的裝飾：無盡模式一開，這一局就永遠不能進排行榜（即使之後關掉），
 * 而玩家通常是在「快輸了」的一刻才想起來有這個開關。等五秒，讓那個念頭冷卻一下。
 * Five seconds is not decoration: switching endless on makes this run permanently unranked
 * (even after turning it off), and players usually remember the switch at the moment they are
 * about to lose. The wait lets that impulse cool.
 */
const ENDLESS_HOLD_MS = 5000;

/**
 * 無盡模式警告的文案；語系變更時整組重取一次。
 * The endless-mode warning's copy, re-read as a whole when the locale changes.
 */
function endlessTexts(): ConfirmDialogTexts {
  return {
    title: t('endlessConfirm.title'),
    message: t('endlessConfirm.message'),
    confirmLabel: t('endlessConfirm.confirm'),
    holdLabel: t('endlessConfirm.confirmHold'),
  };
}

export interface SettingsView {
  open(): void;
  close(): void;
  readonly visible: boolean;
  dispose(): void;
}

/**
 * 一個開關列的三件東西。
 * The three handles of a switch row.
 */
interface SwitchRow {
  root: HTMLElement;
  input: HTMLInputElement;
  setChecked(on: boolean): void;
  setDisabled(disabled: boolean): void;
}

/**
 * 開關列：標題在左、開關在右，說明在下一行（淺灰小字）。
 * A switch row: the label on the left, the switch on the right, the note below in small grey type.
 *
 * 用原生 `<input type="checkbox" role="switch">`：鍵盤、`Space` 切換與表單語意全部免費。
 * A native `<input type="checkbox" role="switch">`: keyboard, `Space` toggling and form semantics come free.
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

  /*
   * 無盡模式的警告：先講清楚「這一局不記榜」，確認鈕鎖五秒才可按。
   * The endless-mode warning: say "this run is not ranked" up front, and lock the confirm
   * button for five seconds.
   */
  const endlessDialog = createConfirmDialog({
    host: options.host,
    ...endlessTexts(),
    tone: 'accent',
    holdMs: ENDLESS_HOLD_MS,
    onConfirm: (): void => preferences.setEndless(true),
    /* 取消：把開關撥回去。偏好沒有變，所以不會有通知替我們重畫。 */
    /* Cancel: flip the switch back. The preference never changed, so no notification redraws it. */
    onCancel: (): void => sync(),
  });

  const masterSwitch = buildSwitchRow({
    labelKey: 'settings.rules.master',
    noteKey: 'settings.rules.masterNote',
    onChange: (on): void => preferences.setRulesEnabled(on),
  });

  const endlessSwitch = buildSwitchRow({
    labelKey: 'settings.rules.endless',
    noteKey: 'settings.rules.endlessNote',
    onChange: (on): void => {
      if (!on) {
        preferences.setEndless(false);
        return;
      }

      endlessDialog.open();
    },
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
     * 語系名一律用該語言自己的寫法（endonym），不翻譯；這一格刻意不掛 `data-i18n`。
     * Locale names are endonyms and never translated; hence no `data-i18n` here.
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
   * 把控制項拉回來源；開窗時、以及來源被別處改動時呼叫。
   * Pulls the controls back from the sources; called on open and whenever a source changes elsewhere.
   *
   * 不會同步名稱輸入框裡玩家正在打的字（`fields.sync()` 自己會避開聚焦中的欄位）。
   * It never clobbers what the player is typing (`fields.sync()` avoids the focused field by itself).
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
   * 語系變更時重跑一次同步：`applyTo()` 負責靜態文字，控件的狀態（勾選、radio、可用性）在這裡更新。
   * Re-syncs on a locale change: `applyTo()` handles the static copy, but the controls' state (ticks, radios, availability) is updated here.
   */
  const unsubscribeLocale = i18n.subscribe((): void => {
    endlessDialog.setTexts(endlessTexts());
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
      endlessDialog.dispose();
      fields.dispose();
      close();
      document.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
