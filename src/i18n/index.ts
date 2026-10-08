/**
 * i18n 執行期：目前語系、翻譯查表、以及靜態文字的 DOM 同步。
 * The i18n runtime: the current locale, translation lookup, and DOM sync for static text.
 *
 * 兩種用法，各管一半（**不要混用**）：
 * Two usages, each owning one half — do not mix them:
 *
 * 1. **固定文字**（標籤、按鈕、aria、佔位符）→ 建立時用 `i18nText` / `i18nAriaLabel` /
 *    `i18nTitle` / `i18nPlaceholder` 標記；語系一換，`applyTo()` 走一遍 DOM 就把所有標記過的
 *    節點改掉。**不需要**每個模組自己寫重繪。
 *    **Static text** (labels, buttons, aria, placeholders) is tagged at build time with
 *    `i18nText` and friends; on a locale change `applyTo()` walks the DOM once and rewrites
 *    every tagged node. No per-module re-render code is needed.
 * 2. **動態文字**（帶數字的句子、清單、aria 摘要）→ 用 `t(key, params)` 即時組字串；這類
 *    節點由產生它的模組自行重繪（那些模組本來就每幀或在開啟時重畫）。
 *    **Dynamic text** (sentences with numbers, lists, aria summaries) is composed on the spot
 *    with `t(key, params)`; those nodes are re-rendered by the modules that own them, which
 *    already redraw every frame or on open.
 *
 * 佔位符語法是 `{name}`，代入值一律 `String()` 化；找不到對應值的佔位符**原樣保留**，方便
 * 一眼看出漏填了什麼，而不是留下一個空白。
 * Placeholders are `{name}` and substituted via `String()`; a placeholder with no matching value
 * is **left as-is**, so a missing argument is visible rather than silently blank.
 */

import { DEFAULT_LOCALE, isLocale, type Locale } from './locale';
import { MESSAGES, zhHant, type MessageKey } from './messages';

export * from './locale';
export type { MessageKey, Messages } from './messages';

/** 佔位符的代值。 */
export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * 代入佔位符。獨立成純函式，以便在測試裡直接釘住替換規則。
 * Substitute placeholders. A pure function so the replacement rules can be pinned by a test.
 */
export function formatMessage(template: string, params?: MessageParams): string {
  if (params === undefined) return template;

  return template.replace(/\{(\w+)\}/gu, (match, key: string): string => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

export type LocaleListener = (locale: Locale) => void;

/**
 * i18n 執行期狀態。
 * The i18n runtime state.
 *
 * `setLocale` **只改狀態並通知**，不碰 DOM —— DOM 的同步由呼叫端（`main.ts` 的訂閱）決定，
 * 這樣在沒有 `document` 的單元測試裡也能安全使用。
 * `setLocale` **only changes state and notifies**; DOM sync is the caller's call (the
 * subscription in `main.ts`), which keeps this usable in unit tests with no `document`.
 */
export class I18n {
  private localeValue: Locale;
  private readonly listeners = new Set<LocaleListener>();

  constructor(initial: Locale = DEFAULT_LOCALE) {
    this.localeValue = isLocale(initial) ? initial : DEFAULT_LOCALE;
  }

  /** 目前語系。 */
  get locale(): Locale {
    return this.localeValue;
  }

  /** 切換語系；與目前相同時不做事、不通知。 */
  setLocale(next: Locale): void {
    if (!isLocale(next) || next === this.localeValue) return;

    this.localeValue = next;
    for (const listener of this.listeners) listener(next);
  }

  /** 訂閱語系變更；回傳取消訂閱的函式。 */
  subscribe(listener: LocaleListener): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 取得一句翻譯。查不到鍵時退回來源語言，再查不到就把鍵本身回傳 —— 畫面上寧可看到
   * `settings.title` 也不要看到空白。
   * Look up one message. A missing key falls back to the source locale and then to the key
   * itself: better to see `settings.title` on screen than nothing at all.
   */
  t(key: MessageKey, params?: MessageParams): string {
    const table = MESSAGES[this.localeValue];
    const template = table[key] as string | undefined;

    return formatMessage(template ?? zhHant[key] ?? key, params);
  }

  /**
   * 把標記過的靜態文字重寫一遍。
   * Rewrite every tagged static string under `root`.
   *
   * 認得五種標記：`data-i18n`（文字）、`data-i18n-aria-label`、`data-i18n-title`、
   * `data-i18n-placeholder`、`data-i18n-alt`。
   * Five tags are recognised: `data-i18n` (text), `data-i18n-aria-label`, `data-i18n-title`,
   * `data-i18n-placeholder` and `data-i18n-alt`.
   */
  applyTo(root: ParentNode): void {
    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = node.dataset['i18n'];
      if (key !== undefined) node.textContent = this.t(key as MessageKey);
    }

    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
      const key = node.dataset['i18nAriaLabel'];
      if (key !== undefined) node.setAttribute('aria-label', this.t(key as MessageKey));
    }

    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
      const key = node.dataset['i18nTitle'];
      if (key !== undefined) node.title = this.t(key as MessageKey);
    }

    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
      const key = node.dataset['i18nPlaceholder'];
      if (key !== undefined) node.setAttribute('placeholder', this.t(key as MessageKey));
    }

    for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-alt]')) {
      const key = node.dataset['i18nAlt'];
      if (key !== undefined) node.setAttribute('alt', this.t(key as MessageKey));
    }
  }

  /**
   * 把 `<html lang>` 調成目前語系。輔助技術與瀏覽器的斷字、字型挑選都靠它。
   * Point `<html lang>` at the current locale: assistive tech, hyphenation and font selection
   * all read it.
   */
  setDocumentLang(documentRef: Document | undefined = globalThis.document): void {
    if (documentRef === undefined) return;
    documentRef.documentElement.lang = this.localeValue;
  }
}

/** 全應用共用的一份 i18n。 */
export const i18n = new I18n();

/** `i18n.t` 的簡寫，供高頻呼叫點使用。 */
export function t(key: MessageKey, params?: MessageParams): string {
  return i18n.t(key, params);
}

/** 標記一個節點的文字並立刻寫入（語系變更時由 `applyTo` 再寫一次）。 */
export function i18nText(node: HTMLElement, key: MessageKey): void {
  node.dataset['i18n'] = key;
  node.textContent = i18n.t(key);
}

/** 標記一個節點的 `aria-label` 並立刻寫入。 */
export function i18nAriaLabel(node: HTMLElement, key: MessageKey): void {
  node.dataset['i18nAriaLabel'] = key;
  node.setAttribute('aria-label', i18n.t(key));
}

/** 標記一個節點的 `title` 並立刻寫入。 */
export function i18nTitle(node: HTMLElement, key: MessageKey): void {
  node.dataset['i18nTitle'] = key;
  node.title = i18n.t(key);
}

/** 標記一個輸入框的 `placeholder` 並立刻寫入。 */
export function i18nPlaceholder(node: HTMLElement, key: MessageKey): void {
  node.dataset['i18nPlaceholder'] = key;
  node.setAttribute('placeholder', i18n.t(key));
}

/** 標記一張圖的 `alt` 並立刻寫入（頭像一類有語意文字的圖片才需要）。 */
export function i18nAlt(node: HTMLElement, key: MessageKey): void {
  node.dataset['i18nAlt'] = key;
  node.setAttribute('alt', i18n.t(key));
}
