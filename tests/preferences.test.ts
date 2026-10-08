/**
 * 偏好的單元測試。
 * Unit tests for the preferences store.
 *
 * 三件事要釘住：**首次跟隨裝置語言**、**壞存檔不會炸**、以及**總開關與無盡模式的閘門關係**
 * —— 最後一項是使用者定案的規則，也是最容易被後續改動弄鬆的地方。
 * Three things are pinned here: the **first-run device locale**, that a **corrupt save cannot
 * crash it**, and the **gate relationship between the master switch and endless mode** — the
 * latter is a decided rule and the easiest one for later edits to loosen.
 */

import { describe, expect, it } from 'vitest';
import { createPreferencesStore } from '../src/game/preferences';
import { isLocale } from '../src/i18n/locale';
import type { ProgressStorage } from '../src/game/progress';

/** 記憶體版儲存體；`seed` 用來偽造壞掉的存檔。 */
class FakeStorage implements ProgressStorage {
  private readonly map = new Map<string, string>();
  failOnWrite = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnWrite) throw new Error('quota exceeded');
    this.map.set(key, value);
  }

  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const KEY = 'prefs';

describe('createPreferencesStore — 預設值 / defaults', () => {
  it('starts from the injected initial locale and both switches off', () => {
    const store = createPreferencesStore({ storage: null, initialLocale: 'ja' });

    expect(store.locale).toBe('ja');
    expect(store.rulesEnabled).toBe(false);
    expect(store.endless).toBe(false);
  });

  it('detects a supported locale from the device when none is injected', () => {
    /*
     * 不注入 `initialLocale` 時會讀裝置語言。Node 22 也有 `navigator.language`（跟著系統地區
     * 走），所以這裡**不能**斷言一定會是預設語系 —— 只能斷言結果落在支援清單內，而且偵測
     * 規則本身由 `tests/i18n.test.ts` 逐條釘住。
     * Without an injected `initialLocale` it reads the device language. Node 22 does expose
     * `navigator.language` (following the system region), so this must **not** assume the default
     * — only that the result is a supported locale. The detection rules themselves are pinned in
     * `tests/i18n.test.ts`.
     */
    const store = createPreferencesStore({ storage: null });

    expect(isLocale(store.locale)).toBe(true);
  });
});

describe('createPreferencesStore — 存檔 / persistence', () => {
  it('round-trips all three values', () => {
    const storage = new FakeStorage();

    const first = createPreferencesStore({ storage, key: KEY });
    first.setLocale('en');
    first.setRulesEnabled(true);
    first.setEndless(true);

    const second = createPreferencesStore({ storage, key: KEY, initialLocale: 'ja' });
    expect(second.locale).toBe('en');
    expect(second.rulesEnabled).toBe(true);
    expect(second.endless).toBe(true);
  });

  it('falls back on corrupt JSON instead of throwing', () => {
    const storage = new FakeStorage();
    storage.seed(KEY, '{not json');

    const store = createPreferencesStore({ storage, key: KEY, initialLocale: 'zh-Hans' });
    expect(store.locale).toBe('zh-Hans');
    expect(store.rulesEnabled).toBe(false);
  });

  it('falls back per-field when the locale is unknown', () => {
    const storage = new FakeStorage();
    storage.seed(KEY, JSON.stringify({ locale: 'fr', rulesEnabled: true }));

    const store = createPreferencesStore({ storage, key: KEY, initialLocale: 'yue' });
    expect(store.locale).toBe('yue');
    expect(store.rulesEnabled).toBe(true);
  });

  it('survives a storage that refuses to write', () => {
    const storage = new FakeStorage();
    storage.failOnWrite = true;

    const store = createPreferencesStore({ storage, key: KEY });
    expect(() => store.setLocale('ja')).not.toThrow();
    expect(store.locale).toBe('ja');
  });
});

describe('createPreferencesStore — 總開關與無盡模式的閘門', () => {
  it('refuses to turn endless on while the master switch is off', () => {
    const store = createPreferencesStore({ storage: null });

    store.setEndless(true);
    expect(store.endless).toBe(false);
  });

  it('turns endless off when the master switch is closed', () => {
    const store = createPreferencesStore({ storage: null });

    store.setRulesEnabled(true);
    store.setEndless(true);
    expect(store.endless).toBe(true);

    store.setRulesEnabled(false);
    expect(store.endless).toBe(false);
  });

  it('reads a stored endless flag as off when the gate was off', () => {
    const storage = new FakeStorage();
    storage.seed(KEY, JSON.stringify({ rulesEnabled: false, endless: true }));

    const store = createPreferencesStore({ storage, key: KEY });
    expect(store.endless).toBe(false);
  });

  it('keeps endless on when a stored save has both on', () => {
    const storage = new FakeStorage();
    storage.seed(KEY, JSON.stringify({ locale: 'en', rulesEnabled: true, endless: true }));

    const store = createPreferencesStore({ storage, key: KEY });
    expect(store.endless).toBe(true);
  });
});

describe('createPreferencesStore — 通知 / notifications', () => {
  it('notifies subscribers once per real change', () => {
    const store = createPreferencesStore({ storage: null });
    let calls = 0;
    store.subscribe((): void => {
      calls += 1;
    });

    store.setRulesEnabled(true);
    expect(calls).toBe(1);

    /* 設成同一個值不該通知 —— 否則 UI 會做白工重繪。 */
    store.setRulesEnabled(true);
    expect(calls).toBe(1);

    store.setLocale('ja');
    expect(calls).toBe(2);
  });
});
