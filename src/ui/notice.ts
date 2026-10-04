/**
 * 非官方聲明橫幅。
 * Unofficial-project notice banner.
 *
 * 這條聲明是專案存續的法定緩衝，agent-readme §0.4 明列「移除或隱藏 NOTICE 聲明」
 * 為紅線，因此它**必須**在頁面上可見，且不被任何 fallback 抹掉（`configLoader`
 * 對空字串也有防護）。
 * The notice is the project's legal buffer. Hiding or removing it is a red line
 * (agent-readme §0.4), so it must stay visible on the page and survives every
 * fallback path.
 *
 * 文字來源是 `branding.json` 的 `noticeZh`（繁中為主）與 `notice`（英文），
 * 兩者都顯示：繁中對主要客群可讀，英文確保在非中文環境下聲明仍然成立。
 * Text comes from `branding.json`; both locales are shown so the disclaimer holds
 * even if a visitor cannot read Chinese.
 */

import { appendChildren, el } from './dom';

export interface NoticeText {
  /** 繁體中文聲明。 */
  zh: string;
  /** 英文聲明。 */
  en: string;
}

/** 建立聲明橫幅；由版面提供外層的 `<footer>` 宿主。 */
export function createNotice(text: NoticeText): HTMLElement {
  const banner = el('div', 'notice');

  const zh = el('p', 'notice__line', text.zh);
  zh.lang = 'zh-Hant';

  const en = el('p', 'notice__line notice__line--muted', text.en);
  en.lang = 'en';

  appendChildren(banner, zh, en);
  return banner;
}
