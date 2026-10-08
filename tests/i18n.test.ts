/**
 * i18n 的單元測試。
 * Unit tests for the i18n runtime.
 *
 * 這一層的兩個失敗模式最貴：**鍵對不上**（某個語言少一句，畫面上默默變成別的語言）與
 * **語言偵測挑錯**（香港裝置拿到繁中、日文裝置拿到英文）。前者用「五份字典鍵集合一致」釘住，
 * 後者逐條列出對照。
 * The two expensive failure modes here are a **key mismatch** (one locale silently renders
 * another language) and **wrong detection** (a Hong Kong device getting Traditional Chinese).
 * The first is pinned by "all five dictionaries share one key set"; the second by an explicit
 * table of tag → locale.
 */

import { describe, expect, it } from 'vitest';
import { formatMessage, I18n, t } from '../src/i18n';
import { DEFAULT_LOCALE, detectLocale, LOCALE_LABELS, LOCALES, isLocale } from '../src/i18n/locale';
import { MESSAGES, zhHant } from '../src/i18n/messages';

describe('formatMessage — 佔位符 / placeholders', () => {
  it('substitutes named placeholders', () => {
    expect(formatMessage('Top {limit}', { limit: 100 })).toBe('Top 100');
    expect(formatMessage('{a}/{b}', { a: 1, b: 2 })).toBe('1/2');
  });

  it('leaves unknown placeholders visible', () => {
    /* 原樣保留比留白好 —— 一眼看得出漏填了什麼。 */
    expect(formatMessage('{known} {missing}', { known: 'x' })).toBe('x {missing}');
  });

  it('returns the template untouched when there are no params', () => {
    expect(formatMessage('plain')).toBe('plain');
  });
});

describe('detectLocale — 裝置語言對照', () => {
  it.each([
    [['zh-HK'], 'yue'],
    [['zh_MO'], 'yue'],
    [['zh-Hant-HK'], 'yue'],
    [['zh-TW'], 'zh-Hant'],
    [['zh-Hant'], 'zh-Hant'],
    [['zh'], 'zh-Hant'],
    [['zh-CN'], 'zh-Hans'],
    [['zh-Hans'], 'zh-Hans'],
    [['zh-SG'], 'zh-Hans'],
    [['en-US'], 'en'],
    [['en'], 'en'],
    [['ja-JP'], 'ja'],
    [['yue'], 'yue'],
  ] as const)('%j → %s', (tags, expected) => {
    expect(detectLocale(tags)).toBe(expected);
  });

  it('walks the preference list and takes the first match', () => {
    expect(detectLocale(['fr-FR', 'de', 'ja'])).toBe('ja');
  });

  it('falls back to the default when nothing matches', () => {
    expect(detectLocale(['fr', 'de'])).toBe(DEFAULT_LOCALE);
    expect(detectLocale([])).toBe(DEFAULT_LOCALE);
  });
});

describe('isLocale / LOCALE_LABELS', () => {
  it('accepts exactly the five supported locales', () => {
    expect(LOCALES).toHaveLength(5);
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true);

    expect(isLocale('fr')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it('labels every locale in its own language', () => {
    for (const locale of LOCALES) expect(LOCALE_LABELS[locale].length).toBeGreaterThan(0);
  });
});

describe('字典完整性 / dictionary completeness', () => {
  it('every locale provides exactly the source key set', () => {
    const expected = Object.keys(zhHant).sort();

    for (const locale of LOCALES) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual(expected);
    }
  });

  it('has no empty strings', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value.trim(), `${locale} → ${key}`).not.toBe('');
      }
    }
  });
});

describe('I18n — 查表與切換 / lookup and switching', () => {
  it('looks up the active locale', () => {
    const i18n = new I18n('en');
    expect(i18n.t('settings.title')).toBe(MESSAGES['en']['settings.title']);
  });

  it('falls back to the source locale for an unknown key', () => {
    const i18n = new I18n('en');
    /* 型別上不可能，但執行期資料壞掉時仍要有合理的退路。 */
    expect(i18n.t('does.not.exist' as never)).toBe('does.not.exist');
  });

  it('notifies subscribers on a real change only', () => {
    const i18n = new I18n('zh-Hant');
    let calls = 0;
    i18n.subscribe((): void => {
      calls += 1;
    });

    i18n.setLocale('ja');
    expect(calls).toBe(1);
    expect(i18n.locale).toBe('ja');

    i18n.setLocale('ja');
    expect(calls).toBe(1);

    /* 不支援的語系一律忽略，不能把狀態弄成無效值。 */
    i18n.setLocale('fr' as never);
    expect(i18n.locale).toBe('ja');
    expect(calls).toBe(1);
  });

  it('unsubscribes cleanly', () => {
    const i18n = new I18n('zh-Hant');
    let calls = 0;
    const off = i18n.subscribe((): void => {
      calls += 1;
    });

    off();
    i18n.setLocale('en');
    expect(calls).toBe(0);
  });

  it('rejects an invalid initial locale', () => {
    expect(new I18n('fr' as never).locale).toBe(DEFAULT_LOCALE);
  });

  it('exposes a module-level t() bound to the shared instance', () => {
    expect(typeof t('common.save')).toBe('string');
    expect(t('common.save').length).toBeGreaterThan(0);
  });
});
