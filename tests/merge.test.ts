/**
 * 合成規則 `mergeResultId` 的單元測試。
 * Unit tests for the merge rule, `mergeResultId`.
 */

import { describe, expect, it } from 'vitest';
import { mergeResultId } from '../src/game/merge';
import type { LevelDef } from '../src/core/types';

function level(id: number, mergeResult: number | null): LevelDef {
  return {
    id,
    name: `Lv${String(id)}`,
    sprite: `character/lv${String(id)}.webp`,
    radius: 10 + id,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: id * 2,
    spawnWeight: 10,
    droppable: true,
    mergeResult,
  };
}

describe('mergeResultId', () => {
  it('merges two of the same level into the next one', () => {
    expect(mergeResultId(level(3, 4), level(3, 4))).toBe(4);
  });

  it('refuses two different levels', () => {
    expect(mergeResultId(level(3, 4), level(5, 6))).toBeNull();
  });

  it('refuses the terminal level', () => {
    expect(mergeResultId(level(10, null), level(10, null))).toBeNull();
  });

  it('is order independent', () => {
    const a = level(3, 4);
    const b = level(3, 4);

    expect(mergeResultId(a, b)).toBe(4);
    expect(mergeResultId(b, a)).toBe(4);
  });
});
