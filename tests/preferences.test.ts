/**
 * 偏好的單元測試：首次跟隨裝置語言、壞存檔不炸、總開關與無盡模式的閘門。
 * Unit tests for the preferences store: first-run locale, corrupt-save survival, endless gating.
 */

import { describe, expect, it } from 'vitest';
import { createPreferencesStore } from '../src/game/preferences';
import { isLocale } from '../src/i18n/locale';
import type { StorageBackend } from '../src/game/localStore';

/** 記憶體版儲存體；`seed` 用來偽造壞掉的存檔。 */
class FakeStorage implements StorageBackend {
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
     * 不注入時讀裝置語言，所以只能斷言結果落在支援清單內，不能斷言預設語系。
     * Without an injected locale it reads the device language, so only membership in the supported
     * list is asserted, never the default.
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

describe('createPreferencesStore — 音樂靜音 / the music mute', () => {
  it('starts with sound on and remembers the choice', () => {
    const storage = new FakeStorage();

    const first = createPreferencesStore({ storage, key: KEY });
    expect(first.musicMuted).toBe(false);

    first.setMusicMuted(true);

    const second = createPreferencesStore({ storage, key: KEY });
    expect(second.musicMuted).toBe(true);
  });

  it('is not governed by the rules gate', () => {
    const store = createPreferencesStore({ storage: null });

    store.setMusicMuted(true);
    store.setRulesEnabled(false);

    /* 靜音不是規則：關掉總開關不該把音樂開回來。 */
    /* The mute is not a rule: closing the master gate must not bring the music back. */
    expect(store.musicMuted).toBe(true);
  });

  it('reads a save without the field as unmuted', () => {
    const storage = new FakeStorage();
    storage.seed(KEY, JSON.stringify({ locale: 'en', rulesEnabled: false }));

    const store = createPreferencesStore({ storage, key: KEY });
    expect(store.musicMuted).toBe(false);
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

    store.setRulesEnabled(true);
    expect(calls).toBe(1);

    store.setLocale('ja');
    expect(calls).toBe(2);
  });
});
