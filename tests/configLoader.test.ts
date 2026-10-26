/**
 * `configLoader` 的單元測試：以注入的假 fetcher 驗證降級行為。
 * Unit tests for `configLoader`: fallback behaviour via an injected fake fetcher.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBranding, loadConfig, type FetchLike } from '../src/core/configLoader';

/**
 * 以檔名（`levels.json` 等）為 key 的假檔案系統。
 * A fake filesystem keyed by filename (`levels.json` etc.).
 */
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
    'levels_new.json': VALID_LEVELS,
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
      'levels_new.json': JSON.stringify({ settings: { gravityY: 0 }, levels: JSON.parse(VALID_LEVELS).levels }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });

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
    const files = allValid({
      'levels_new.json': JSON.stringify({ levels: JSON.parse(VALID_LEVELS).levels }),
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
    const files = allValid({ 'levels_new.json': '<!doctype html><html></html>' });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.levels.levels).toHaveLength(10);
    expect(messages.some((message) => message.includes('HTML'))).toBe(true);
  });

  it('falls back when the body is not valid JSON', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({ 'levels_new.json': '{ "levels": [ }' });
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
    expect(config.skills.skills).toHaveLength(10);
    expect(messages.some((message) => message.includes('could not be fetched'))).toBe(true);
  });
});

describe('loadConfig — 欄位層級的降級 / field-level fallback', () => {
  it('replaces an out-of-range radius and warns', async () => {
    const { warn, messages } = collectWarnings();
    const broken = JSON.parse(VALID_LEVELS) as { levels: Array<Record<string, unknown>> };
    broken.levels[0]!.radius = -5;
    const files = allValid({ 'levels_new.json': JSON.stringify(broken) });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.levels.levels[0]?.radius).toBe(13.5);
    expect(messages.some((message) => message.includes('radius'))).toBe(true);
  });

  it('clamps sp.max into [1, 10] and warns', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({ sp: { max: 42 }, skills: [{ id: 'a', name: 'A', cost: 1, params: {} }] }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.sp.max).toBe(10);
    expect(messages.some((message) => message.includes('outside [1, 10]'))).toBe(true);
  });

  it('accepts any whole number in 1..10 without warning', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({ sp: { max: 7 }, skills: [{ id: 'a', name: 'A', cost: 1, params: {} }] }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.sp.max).toBe(7);
    expect(messages).toEqual([]);
  });

  it('rounds a fractional sp.max and warns', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({ sp: { max: 3.5 }, skills: [{ id: 'a', name: 'A', cost: 1, params: {} }] }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.sp.max).toBe(4);
    expect(messages.some((message) => message.includes('whole number'))).toBe(true);
  });

  it('parses a cumulativeSpent unlock and sorts it after the SP skills', async () => {
    const { warn } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({
        sp: { max: 3 },
        skills: [
          { id: 'free', name: '免費', cost: 0, targeting: 'immediate', params: {}, unlock: { kind: 'cumulativeSpent', threshold: 6 } },
          { id: 'paid', name: '收費', cost: 1, targeting: 'immediate', params: {}, unlock: { kind: 'sp' } },
        ],
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.skills.map((skill) => skill.id)).toEqual(['paid', 'free']);
    expect(config.skills.skills[1]?.unlock).toEqual({ kind: 'cumulativeSpent', threshold: 6 });
  });

  it('warns when a cumulativeSpent skill also charges SP', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'skills.json': JSON.stringify({
        sp: { max: 3 },
        skills: [{ id: 'contradiction', name: '矛盾', cost: 2, params: {}, unlock: { kind: 'cumulativeSpent', threshold: 6 } }],
      }),
    });
    await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(messages.some((message) => message.includes('meant to be free'))).toBe(true);
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

describe('loadConfig — 玩法模式 / play modes', () => {
  it('defaults to levels_new.json', async () => {
    const files = allValid({
      'levels_new.json': JSON.stringify({ settings: { maxBodies: 77 }, levels: JSON.parse(VALID_LEVELS).levels }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });

    expect(config.levels.settings.maxBodies).toBe(77);
  });

  it('reads the table named by levelsFile instead', async () => {
    const files = allValid({
      'levels.json': JSON.stringify({ settings: { maxBodies: 33 }, levels: JSON.parse(VALID_LEVELS).levels }),
    });
    const config = await loadConfig({
      ...OPTIONS,
      levelsFile: 'config/levels.json',
      fetcher: makeFetcher(files),
    });

    expect(config.levels.settings.maxBodies).toBe(33);
  });

  it('narrows the skill roster to skillIds, keeping the loader order', async () => {
    const files = allValid({
      'levels_new.json': JSON.stringify({
        skillIds: ['early'],
        levels: JSON.parse(VALID_LEVELS).levels,
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files) });

    expect(config.skills.skills.map((skill) => skill.id)).toEqual(['early']);
  });

  it('ignores unknown ids and keeps every skill when none match', async () => {
    const { warn, messages } = collectWarnings();
    const files = allValid({
      'levels_new.json': JSON.stringify({
        skillIds: ['ghost'],
        levels: JSON.parse(VALID_LEVELS).levels,
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.skills).toHaveLength(2);
    expect(messages.some((message) => message.includes('unknown skill "ghost"'))).toBe(true);
    expect(messages.some((message) => message.includes('matched no skill'))).toBe(true);
  });

  it('keeps every skill when the roster is malformed', async () => {
    const { warn } = collectWarnings();
    const files = allValid({
      'levels_new.json': JSON.stringify({
        skillIds: 'early',
        levels: JSON.parse(VALID_LEVELS).levels,
      }),
    });
    const config = await loadConfig({ ...OPTIONS, fetcher: makeFetcher(files), onWarn: warn });

    expect(config.skills.skills).toHaveLength(2);
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

describe('public/config — 兩個模式的技能名單 / each mode’s skill roster', () => {
  /** 讀真正的配置檔；這些是隨附檔案，不會被假 fetcher 影響。 */
  const read = (file: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(`../public/config/${file}`, import.meta.url), 'utf8')) as Record<
      string,
      unknown
    >;

  /*
   * 名單是「這個模式有哪幾個技能」的唯一來源：新玩法不寫＝全部，傳統模式寫死最初四個。
   * 兩邊一旦對調（曾經發生過），切換模式後看到的仍是上一個模式的技能欄。
   * The roster is the single source of "which skills this mode has": omitting it in the new mode
   * means every skill, while the traditional mode pins the original four. Swapping the two (which
   * has happened) leaves the skill bar showing the previous mode's set after a switch.
   */
  it('leaves the new mode unrestricted so every skill stays available', () => {
    expect(read('levels_new.json')['skillIds']).toBeUndefined();
  });

  it('gives the traditional mode the original four, by id', () => {
    expect(read('levels.json')['skillIds']).toEqual([
      'discard',
      'protocol_float',
      'shake',
      'fate_swap',
    ]);
  });

  it('only names skills that exist in skills.json', () => {
    const known = new Set(
      (read('skills.json')['skills'] as { id: string }[]).map((skill) => skill.id),
    );

    for (const id of read('levels.json')['skillIds'] as string[]) {
      expect(known.has(id), id).toBe(true);
    }
  });
});

describe('loadBranding — 選單專用 / menu-only', () => {
  it('fetches the branding file and nothing else', async () => {
    const asked: string[] = [];
    const fetcher: FetchLike = async (input: string): Promise<Response> => {
      asked.push(input);
      return new Response(input.endsWith('branding.json') ? VALID_BRANDING : '', { status: 200 });
    };

    const branding = await loadBranding({ ...OPTIONS, fetcher });

    expect(branding.gameName).toBe('X');
    expect(asked).toHaveLength(1);
  });

  /*
   * 聲明是法定緩衝：連檔案都拿不到時，仍必須有內建預設的那一份。
   * The notice is a legal buffer: even with no file at all, the built-in default must survive.
   */
  it('keeps the built-in notice when the file is missing', async () => {
    const { warn } = collectWarnings();
    const branding = await loadBranding({ ...OPTIONS, fetcher: makeFetcher({}), onWarn: warn });

    expect(branding.noticeZh.length).toBeGreaterThan(0);
    expect(branding.notice.length).toBeGreaterThan(0);
    expect(branding.gameName.length).toBeGreaterThan(0);
  });
});
