/**
 * i18n 執行期的單元測試。
 * Unit tests for the i18n runtime.
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

/**
 * 五份字典共用同一組鍵：少一句就會默默退回別的語言。
 * All five dictionaries share one key set; a missing entry silently falls back to another locale.
 */
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

/**
 * 技能說明是玩家看到的規則，不該洩漏內部常數。
 * The skill copy is the rules as the player reads them, so it must not leak internal constants.
 */
describe('技能說明 / skill guide copy', () => {
  it('describes the shrink by its effect, not by a radius', () => {
    for (const locale of LOCALES) {
      const text = MESSAGES[locale]['skillGuide.desc.shrink_all'];

      /* 半徑是實作細節：改平衡時不該連文案一起改。 */
      /* The radius is an implementation detail; retuning it should not rewrite the copy. */
      expect(text, locale).not.toContain('{radius}');
      expect(text, locale).not.toMatch(/\d/u);
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
