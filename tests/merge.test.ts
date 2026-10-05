/**
 * 合成規則的單元測試。
 * Unit tests for the merge rule.
 *
 * 合成是這個遊戲全部分數的來源，所以規則被拆成純函式正是為了能在這裡把三種「不能合成」
 * 的情形逐一釘住，而不必先讓一堆剛體真的撞在一起。
 * Merging is where all the score comes from, and splitting it into a pure function is exactly
 * what lets the three "cannot merge" cases be pinned here instead of by shoving bodies
 * together and hoping.
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
