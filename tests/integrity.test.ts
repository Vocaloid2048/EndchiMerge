/**
 * 完整性摘要的單元測試。
 * Unit tests for the storage integrity digest.
 *
 * 這裡驗的是「機制有沒有照設計運作」——同樣的輸入得到同樣的摘要、動過一個位元就對不上。它
 * **不是**在驗安全性：鹽是公開的，摘要也算不上密碼學，這件事在 `core/integrity.ts` 的檔頭
 * 寫得很清楚。有測試的好處是，日後有人「順手」把鹽或演算法換掉時，這些斷言會先講話。
 * What is checked here is that the mechanism does what it is designed to do — same input, same
 * digest; one altered byte and it no longer matches. It is **not** a security claim: the salt is
 * public and the digest is not cryptographic, which the header of `core/integrity.ts` says
 * outright. The value of testing it is that if anyone later swaps the salt or the algorithm out,
 * these assertions speak up first.
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
    /* 信封裡的那份 JSON 是字串，所以引號是跳脫過的（`score\":12`）。 */
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
