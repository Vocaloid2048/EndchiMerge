/**
 * `configLoader` 的單元測試。
 * Unit tests for `configLoader`.
 *
 * 這裡刻意**不打任何真實網路**：所有測試都注入假的 fetcher，因此能精確控制
 * 每一份配置檔的內容與失敗方式，逐條驗證降級行為。
 * No test touches the network. Every case injects a fake fetcher so each config
 * file's content and failure mode is controlled precisely, letting the fallback
 * behaviour be asserted line by line.
 */

import { describe, expect, it } from 'vitest';
import { loadConfig, type FetchLike } from '../src/core/configLoader';

/** 以檔名（`levels.json` 等）為 key 的假檔案系統。 */
type FileMap = Record<string, string>;

function makeFetcher(files: FileMap): FetchLike {
  return async (input: string): Promise<Response> => {
    const name = input.slice(input.lastIndexOf('/') + 1);
    const body = files[name];
    if (body === undefined) return new Response('', { status: 404 });
    return new Response(body, { status: 200 });
  };
}

function collectWarnings(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message: string): void => void messages.push(message), messages };
}

const VALID_LEVELS = JSON.stringify({
  settings: { maxBodies: 90 },
  levels: [
    {
      id: 1,
      name: '測試甲',
      sprite: 'character/甲.webp',
      radius: 20,
      density: 0.001,
      restitution: 0.5,
      friction: 0.3,
      frictionAir: 0.005,
      score: 1,
      spawnWeight: 10,
      droppable: true,
      mergeResult: 2,
    },
    {
      id: 2,
      name: '測試乙',
      sprite: 'character/乙.webp',
      radius: 30,
      density: 0.001,
      restitution: 0.4,
      friction: 0.3,
      frictionAir: 0.005,
      score: 2,
      spawnWeight: 0,
      droppable: false,
      mergeResult: null,
    },
  ],
});

const VALID_SKILLS = JSON.stringify({
  sp: { max: 2, initial: 0, gainPerDrop: 1, overflowAllowed: false },
  skills: [
    { id: 'late', name: '後', cost: 2, targeting: 'immediate', pickCount: 0, params: {} },
    { id: 'early', name: '先', cost: 1, targeting: 'user_pick', pickCount: 1, params: {} },
  ],
});

const VALID_CONTAINER = JSON.stringify({ cornerRadius: 10, strokeWidth: 2, strokeColor: '#fff' });
const VALID_BRANDING = JSON.stringify({ gameName: 'X', gameNameZh: '叉', version: '9.9.9' });

function allValid(extra: FileMap = {}): FileMap {
  return {
    'levels.json': VALID_LEVELS,
    'skills.json': VALID_SKILLS,
    'container.json': VALID_CONTAINER,
    'branding.json': VALID_BRANDING,
    ...extra,
  };
}

const OPTIONS = { baseUrl: '/' } as const;

describe('loadConfig — 正常路徑 / happy path', () => {
  it('parses a valid config and preserves per-level values', async () => {
    const { warn, messages } = collectWarnings();
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(allValid()), onWarn: warn });

    expect(config.levels.levels).toHaveLength(2);
    expect(config.levels.levels[0]?.radius).toBe(20);
    expect(config.levels.settings.maxBodies).toBe(90);
    expect(messages).toEqual([]);
  });

  it('keeps an explicit gravity, including zero', async () => {
    const files = allValid({
      'levels.json': JSON.stringify({ settings: { gravityY: 0 }, levels: JSON.parse(VALID_LEVELS).levels }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });

    /* 0 是合法值（無重力），不應被當成缺漏而退回預設的 1。 */
    expect(config.levels.settings.gravityY).toBe(0);
  });

  it('keeps a null mergeResult, which marks the terminal level', async () => {
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(allValid()) });
    expect(config.levels.levels[1]?.mergeResult).toBeNull();
  });

  it('sorts skills by cost, cheapest first', async () => {
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(allValid()) });
    expect(config.skills.skills.map((skill) => skill.id)).toEqual(['early', 'late']);
  });

  it('forces pickCount to zero for immediate skills', async () => {    const files = allValid({
      'skills.json': JSON.stringify({
        sp: { max: 3 },
        skills: [{ id: 'x', name: 'X', cost: 1, targeting: 'immediate', pickCount: 5, params: {} }],
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });
    expect(config.skills.skills[0]?.pickCount).toBe(0);
  });

  it('falls back to a 500ms drop cooldown, the shipped value', async () => {
    /*
     * 投放冷卻由 1000 縮到 500（使用者定案「1 秒好像太久了」）。這條盯的是**預設值** ——
     * `levels.json` 若缺失或漏欄位，`DEFAULT_SETTINGS` 必須給 500，而不是留著舊的 1000。
     * A missing or partial `levels.json` must yield the shipped 500ms, not a stale 1000.
     */
    const files = allValid({
      'levels.json': JSON.stringify({ levels: JSON.parse(VALID_LEVELS).levels }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });

    expect(config.levels.settings.dropCooldownMs).toBe(500);
  });
});

describe('loadConfig — 檔案層級的降級 / file-level fallback', () => {
  it('falls back to built-in levels when the file is missing', async () => {
    const { warn, messages } = collectWarnings();
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher({}), onWarn: warn });

    expect(config.levels.levels).toHaveLength(10);
    expect(messages.some((message) => message.includes('404'))).toBe(true);
  });

  it('rejects an HTML body (SPA fallback) instead of parsing it', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({ 'levels.json': '<!doctype html><html></html>' });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.levels.levels).toHaveLength(10);
    expect(messages.some((message) => message.includes('HTML'))).toBe(true);
  });

  it('falls back when the body is not valid JSON', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({ 'levels.json': '{ "levels": [ }' });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.levels.levels).toHaveLength(10);
    expect(messages.some((message) => message.includes('not valid JSON'))).toBe(true);
  });

  it('survives a fetcher that throws', async () => {
    const { warn, messages } = collectWarnings();
    const throwing: FetchLike = async () => {
      throw new Error('offline');
    };
    const config = await loadConfig({ ...OPTIONS, fetcher: throwing, onWarn: warn });

    expect(config.levels.levels).toHaveLength(10);
    expect(config.skills.skills).toHaveLength(4);
    expect(messages.some((message) => message.includes('could not be fetched'))).toBe(true);
  });
});

describe('loadConfig — 欄位層級的降級 / field-level fallback', () => {
  it('replaces an out-of-range radius and warns', async () => {
    const { warn, messages } = collectWarnings();
    const broken = JSON.parse(VALID_LEVELS) as { levels: Array<Record<string, unknown>> };
    broken.levels[0]!.radius = -5;
    const files = allValid({ 'levels.json': JSON.stringify(broken) });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    /* -5 不合法 → 退回內建第 1 級的半徑（13.5），而不是沿用前一個合法值。 */
    expect(config.levels.levels[0]?.radius).toBe(13.5);
    expect(messages.some((message) => message.includes('radius'))).toBe(true);
  });

  it('clamps sp.max to the hard ceiling', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({ sp: { max: 9 }, skills: [{ id: 'a', name: 'A', cost: 1, params: {} }] }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.sp.max).toBe(5);
    expect(messages.some((message) => message.includes('hard ceiling'))).toBe(true);
  });

  it('drops skill entries without an id and keeps the rest', async () => {
    const { warn } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({
        sp: { max: 3 },
        skills: [{ name: '沒 id' }, { id: 'ok', name: '有', cost: 1, params: {} }],
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.skills.map((skill) => skill.id)).toEqual(['ok']);
  });

  it('restores the default aspect range when it is inverted', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({ 'container.json': JSON.stringify({ aspectMin: 2, aspectMax: 1 }) });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.container.aspectMin).toBe(0.62);
    expect(config.container.aspectMax).toBe(1.45);
    expect(messages.some((message) => message.includes('inverted'))).toBe(true);
  });

  it('keeps the unofficial notice even if branding blanks it out', async () => {
    const { warn } = collectWarnings();
    const files = allValid({ 'branding.json': JSON.stringify({ noticeZh: '' }) });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.branding.noticeZh).not.toBe('');
  });
});

describe('loadConfig — 載入期語意檢查 / load-time semantics', () => {
  it('warns when a skill costs more SP than the cap allows', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({
        sp: { max: 3 },
        skills: [{ id: 'expensive', name: '貴', cost: 4, params: {} }],
      }),
    });
    await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(messages.some((message) => message.includes('never be unlocked'))).toBe(true);
  });
});
