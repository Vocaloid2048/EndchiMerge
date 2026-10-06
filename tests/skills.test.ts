/**
 * 技能類別的單元測試。
 * Unit tests for the skill classes.
 *
 * 技能透過 `SkillBoard` 這個窄介面與遊戲互動，所以這裡可以用一個**假棋盤**精確觀察每個
 * 技能到底發了哪些動作、帶了哪些參數 —— 不必碰物理，也不必碰 Matter.js。
 * Skills talk to the game through the narrow `SkillBoard` interface, so a **fake board** can
 * record exactly which actions each skill issued and with which parameters — no physics and no
 * Matter.js involved.
 */

import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../src/core/types';
import {
  createSkill,
  createSkills,
  DiscardSkill,
  FateSwapSkill,
  FloatSkill,
  hasSkillImplementation,
  ShakeSkill,
  type BoardTarget,
  type FloatRequest,
  type ShakeRequest,
  type SkillBoard,
} from '../src/game/skills';

/** 記錄所有動作的假棋盤。 */
class FakeBoard implements SkillBoard {
  readonly removed: number[] = [];
  readonly swaps: { a: number; b: number; disturbance: number }[] = [];
  readonly floats: FloatRequest[] = [];
  readonly shakes: ShakeRequest[] = [];

  constructor(
    public targets: readonly BoardTarget[],
    readonly overflowLineY = 100,
    readonly containerWidth = 600,
  ) {}

  removeTarget(id: number): boolean {
    const index = this.targets.findIndex((target) => target.id === id);
    if (index < 0) return false;
    this.targets = this.targets.filter((target) => target.id !== id);
    this.removed.push(id);
    return true;
  }

  swapTargets(a: number, b: number, disturbance: number): void {
    this.swaps.push({ a, b, disturbance });
  }

  floatAll(request: FloatRequest): void {
    this.floats.push(request);
  }

  shakeContainer(request: ShakeRequest): void {
    this.shakes.push(request);
  }
}

function target(id: number): BoardTarget {
  return { id, levelId: 1, x: id * 10, y: 0, radius: 20 };
}

function def(overrides: Partial<SkillDef> & { id: string }): SkillDef {
  return {
    name: overrides.id,
    cost: 1,
    targeting: 'immediate',
    pickCount: 0,
    unlock: { kind: 'sp' },
    params: {},
    ...overrides,
  };
}

describe('技能註冊表 / skill registry', () => {
  it('maps every shipped id onto a class and skips unknown ones', () => {
    const skills = createSkills([
      def({ id: 'discard', targeting: 'user_pick', pickCount: 1 }),
      def({ id: 'protocol_float' }),
      def({ id: 'shake' }),
      def({ id: 'fate_swap', cost: 0, unlock: { kind: 'cumulativeSpent', threshold: 6 }, targeting: 'user_pick', pickCount: 2 }),
      def({ id: 'not_implemented_yet' }),
    ]);

    expect(skills.map((skill) => skill.constructor)).toEqual([
      DiscardSkill,
      FloatSkill,
      ShakeSkill,
      FateSwapSkill,
    ]);
  });

  it('reports whether an id has an implementation', () => {
    expect(hasSkillImplementation('shake')).toBe(true);
    expect(hasSkillImplementation('mystery')).toBe(false);
    expect(createSkill(def({ id: 'mystery' }))).toBeNull();
  });

  it('exposes targeting metadata from the definition', () => {
    const discard = createSkill(def({ id: 'discard', targeting: 'user_pick', pickCount: 1 }));

    expect(discard?.requiresTargets).toBe(true);
    expect(discard?.durationMs).toBe(0);
  });
});

describe('當棄即棄！/ discard', () => {
  it('removes the picked dumpling', () => {
    const board = new FakeBoard([target(1), target(2)]);
    const skill = new DiscardSkill(def({ id: 'discard', targeting: 'user_pick', pickCount: 1 }));

    skill.apply(board, [target(2)]);

    expect(board.removed).toEqual([2]);
    expect(board.targets.map((entry) => entry.id)).toEqual([1]);
  });

  it('does nothing when no target was handed over', () => {
    const board = new FakeBoard([target(1)]);
    new DiscardSkill(def({ id: 'discard' })).apply(board, []);

    expect(board.removed).toEqual([]);
  });
});

describe('協議：浮動 / float', () => {
  it('uses the shipped defaults (1500ms, 1.6x gravity)', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new FloatSkill(def({ id: 'protocol_float' }));

    skill.apply(board, []);

    expect(skill.durationMs).toBe(1500);
    expect(board.floats).toEqual([{ durationMs: 1500, liftFactor: 1.6 }]);
  });

  it('honours explicit parameters', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new FloatSkill(
      def({ id: 'protocol_float', params: { durationMs: 900, liftFactor: 2 } }),
    );

    skill.apply(board, []);

    expect(board.floats).toEqual([{ durationMs: 900, liftFactor: 2 }]);
  });
});

describe('搖晃！/ shake', () => {
  it('clamps the radius to the 1/3 hard cap', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new ShakeSkill(def({ id: 'shake', params: { radiusFactor: 5 } }));

    skill.apply(board, []);

    expect(board.shakes[0]?.radiusFactor).toBeCloseTo(1 / 3, 10);
  });

  it('never allows a fractional or zero revolution count', () => {
    const board = new FakeBoard([target(1)]);
    new ShakeSkill(def({ id: 'shake', params: { revolutions: 0 } })).apply(board, []);

    expect(board.shakes[0]?.revolutions).toBe(1);
  });

  it('defaults to 2s / 5 revolutions', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new ShakeSkill(def({ id: 'shake' }));

    skill.apply(board, []);

    expect(skill.durationMs).toBe(2000);
    expect(board.shakes[0]?.revolutions).toBe(5);
  });

  it('defaults the earthquake axis to 15 degrees and a 10% upward force', () => {
    const board = new FakeBoard([target(1)]);
    new ShakeSkill(def({ id: 'shake' })).apply(board, []);

    expect(board.shakes[0]?.axisTiltDeg).toBe(15);
    expect(board.shakes[0]?.upwardFactor).toBe(0.1);
  });

  it('clamps the tilt to 60 degrees and the upward force to half the impulse', () => {
    const board = new FakeBoard([target(1)]);
    new ShakeSkill(def({ id: 'shake', params: { axisTiltDeg: 400, upwardFactor: 9 } })).apply(
      board,
      [],
    );

    expect(board.shakes[0]?.axisTiltDeg).toBe(60);
    expect(board.shakes[0]?.upwardFactor).toBe(0.5);
  });

  it('never lets a negative tilt or upward force through', () => {
    const board = new FakeBoard([target(1)]);
    new ShakeSkill(def({ id: 'shake', params: { axisTiltDeg: -30, upwardFactor: -1 } })).apply(
      board,
      [],
    );

    expect(board.shakes[0]?.axisTiltDeg).toBe(0);
    expect(board.shakes[0]?.upwardFactor).toBe(0);
  });
});

describe('命運互換 / fate swap', () => {
  it('swaps the two picked dumplings with the configured disturbance', () => {
    const board = new FakeBoard([target(1), target(2)]);
    const skill = new FateSwapSkill(
      def({ id: 'fate_swap', cost: 0, targeting: 'user_pick', pickCount: 2, params: { disturbance: 8 } }),
    );

    skill.apply(board, [target(1), target(2)]);

    expect(board.swaps).toEqual([{ a: 1, b: 2, disturbance: 8 }]);
  });

  it('needs two distinct targets', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new FateSwapSkill(def({ id: 'fate_swap' }));

    skill.apply(board, [target(1)]);
    skill.apply(board, [target(1), target(1)]);

    expect(board.swaps).toEqual([]);
  });
});
