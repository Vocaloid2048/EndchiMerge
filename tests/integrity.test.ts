/**
 * 完整性摘要的單元測試。
 * Unit tests for the storage integrity digest.
 */

import { describe, expect, it } from 'vitest';
import { checksum, open, seal } from '../src/core/integrity';

const SALT = 'test-salt';

describe('checksum — 摘要 / the digest', () => {
  it('is deterministic', () => {
    expect(checksum('hello', SALT)).toBe(checksum('hello', SALT));
  });

  it('depends on the salt', () => {
    expect(checksum('hello', SALT)).not.toBe(checksum('hello', 'other-salt'));
  });

  it('changes when a single character changes', () => {
    expect(checksum('{"score":100}', SALT)).not.toBe(checksum('{"score":900}', SALT));
  });

  it('returns a fixed-width hex string', () => {
    expect(checksum('', SALT)).toMatch(/^[0-9a-f]{16}$/);
    expect(checksum('a much longer payload '.repeat(50), SALT)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('seal / open — 信封 / the envelope', () => {
  it('round-trips a value', () => {
    const raw = seal([{ id: 'a', score: 12 }], SALT);

    expect(open(raw, SALT)).toEqual([{ id: 'a', score: 12 }]);
  });

  it('round-trips an object and preserves exact numbers', () => {
    const value = { playerId: 'me', score: 900, at: 1_700_000_000_123 };

    expect(open(seal(value, SALT), SALT)).toEqual(value);
  });

  it('rejects a payload edited after sealing', () => {
    const raw = seal([{ id: 'a', score: 12 }], SALT);
    /*
     * 信封裡的 JSON 是字串，所以引號是跳脫過的（`score\":12`）。
     * The envelope embeds the JSON as a string, so its quotes are escaped (`score\":12`).
     */
    const edited = raw.replace('score\\":12', 'score\\":999999');

    expect(edited).not.toBe(raw);
    expect(open(edited, SALT)).toBeNull();
  });

  it('rejects a digest computed with another salt', () => {
    expect(open(seal([1, 2, 3], 'other-salt'), SALT)).toBeNull();
  });

  it('rejects anything that is not an envelope', () => {
    expect(open(null, SALT)).toBeNull();
    expect(open('{ not json', SALT)).toBeNull();
    expect(open('[1,2,3]', SALT)).toBeNull();
    expect(open('"just a string"', SALT)).toBeNull();
    expect(open('{"v":"[]"}', SALT)).toBeNull();
  });
});
