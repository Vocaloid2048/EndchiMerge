/**
 * 非官方聲明橫幅：繁中與英文**都**顯示，且必須保持可見（移除或隱藏是紅線）。
 * Unofficial-project notice banner: it shows **both** the Chinese and English notices and must stay visible (hiding it is a red line).
 */

import { appendChildren, el } from './dom';

export interface NoticeText {
  zh: string;
  en: string;
}

/**
 * 建立聲明橫幅；由版面提供外層的 `<footer>` 宿主。
 * Builds the notice banner; the layout supplies the outer `<footer>` host.
 */
export function createNotice(text: NoticeText): HTMLElement {
  const banner = el('div', 'notice');

  const zh = el('p', 'notice__line', text.zh);
  zh.lang = 'zh-Hant';

  const en = el('p', 'notice__line notice__line--muted', text.en);
  en.lang = 'en';

  appendChildren(banner, zh, en);
  return banner;
}
