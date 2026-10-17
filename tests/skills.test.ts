/**
 * 技能類別的單元測試；用假棋盤觀察每個技能發出的動作與參數。
 * Unit tests for the skill classes; a fake board records each skill's actions and parameters.
 */

import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../src/core/types';
import {
  AscendSkill,
  ComboGraceSkill,
  createSkill,
  createSkills,
  DiscardSkill,
  FateSwapSkill,
  FloatSkill,
  hasSkillImplementation,
  ReshuffleSkill,
  ScrambleSkill,
  ShakeSkill,
  ShrinkAllSkill,
  SquareCoreSkill,
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
  readonly upgrades: number[] = [];
  readonly reshuffles: number[] = [];
  readonly protections: number[] = [];
  readonly shrinks: number[] = [];
  scrambles = 0;
  squareMergeCalls = 0;

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

  upgradeTarget(id: number): boolean {
    this.upgrades.push(id);
    return true;
  }

  scrambleTargets(): void {
    this.scrambles += 1;
  }

  reshuffle(count: number): void {
    this.reshuffles.push(count);
  }

  protectCombo(drops: number): void {
    this.protections.push(drops);
  }

  shrinkAll(radius: number): void {
    this.shrinks.push(radius);
  }

  useSquareMerge(): void {
    this.squareMergeCalls += 1;
  }
}

function target(id: number, overrides: Partial<BoardTarget> = {}): BoardTarget {
  return {
    id,
    levelId: 1,
    x: id * 10,
    y: 0,
    radius: 20,
    nextLevelId: 2,
    nextLevelUnlocked: true,
    ...overrides,
  };
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
      def({ id: 'ascend', targeting: 'user_pick', pickCount: 1 }),
      def({ id: 'protocol_float' }),
      def({ id: 'scramble' }),
      def({ id: 'combo_grace' }),
      def({ id: 'shake' }),
      def({ id: 'reshuffle' }),
      def({ id: 'fate_swap', cost: 0, unlock: { kind: 'cumulativeSpent', threshold: 6 }, targeting: 'user_pick', pickCount: 2 }),
      def({ id: 'shrink_all', cost: 0, unlock: { kind: 'cumulativeUses', threshold: 8 } }),
      def({ id: 'square_core', cost: 0, unlock: { kind: 'cumulativeSpent', threshold: 12 } }),
      def({ id: 'not_implemented_yet' }),
    ]);

    expect(skills.map((skill) => skill.constructor)).toEqual([
      DiscardSkill,
      AscendSkill,
      FloatSkill,
      ScrambleSkill,
      ComboGraceSkill,
      ShakeSkill,
      ReshuffleSkill,
      FateSwapSkill,
      ShrinkAllSkill,
      SquareCoreSkill,
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

  it('lets only the reshuffle fire on an empty board', () => {
    expect(new ReshuffleSkill(def({ id: 'reshuffle' })).allowsEmptyBoard).toBe(true);
    expect(new ScrambleSkill(def({ id: 'scramble' })).allowsEmptyBoard).toBe(false);
    expect(new AscendSkill(def({ id: 'ascend' })).allowsEmptyBoard).toBe(false);
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

describe('一步登天 / ascend', () => {
  it('accepts a target whose next level is unlocked', () => {
    const skill = new AscendSkill(def({ id: 'ascend', targeting: 'user_pick', pickCount: 1 }));

    expect(skill.canPick(target(1))).toBe(true);
  });

  it('refuses a maxed dumpling and a locked next level', () => {
    const skill = new AscendSkill(def({ id: 'ascend', targeting: 'user_pick', pickCount: 1 }));

    expect(skill.canPick(target(1, { nextLevelId: null }))).toBe(false);
    expect(skill.canPick(target(1, { nextLevelId: 9, nextLevelUnlocked: false }))).toBe(false);
  });

  it('upgrades the picked dumpling', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new AscendSkill(def({ id: 'ascend', targeting: 'user_pick', pickCount: 1 }));

    skill.apply(board, [target(7)]);

    expect(board.upgrades).toEqual([7]);
  });

  it('does nothing without a target', () => {
    const board = new FakeBoard([target(1)]);
    new AscendSkill(def({ id: 'ascend' })).apply(board, []);

    expect(board.upgrades).toEqual([]);
  });
});

describe('協議：浮動 / float', () => {
  it('uses the shipped defaults (1500ms, 1.6x gravity)', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new FloatSkill(def({ id: 'protocol_float' }));

    skill.apply(board, []);

    expect(skill.durationMs).toBe(1500);
    expect(board.floats).toEqual([{ durationMs: 1500, liftFactor: 1.6, catchupFactor: 2 }]);
  });

  it('honours explicit parameters', () => {
    const board = new FakeBoard([target(1)]);
    const skill = new FloatSkill(
      def({ id: 'protocol_float', params: { durationMs: 900, liftFactor: 2 } }),
    );

    skill.apply(board, []);

    expect(board.floats).toEqual([{ durationMs: 900, liftFactor: 2, catchupFactor: 2 }]);
  });
});

describe('乾坤挪移 / scramble', () => {
  it('asks the board to scramble once', () => {
    const board = new FakeBoard([target(1), target(2)]);
    new ScrambleSkill(def({ id: 'scramble' })).apply(board, []);

    expect(board.scrambles).toBe(1);
  });
});

describe('連勢不墜 / combo grace', () => {
  it('defaults to three drops', () => {
    const board = new FakeBoard([target(1)]);
    new ComboGraceSkill(def({ id: 'combo_grace' })).apply(board, []);

    expect(board.protections).toEqual([3]);
  });

  it('honours an explicit count and never goes below one', () => {
    const board = new FakeBoard([target(1)]);
    new ComboGraceSkill(def({ id: 'combo_grace', params: { drops: 0 } })).apply(board, []);
    new ComboGraceSkill(def({ id: 'combo_grace', params: { drops: 5.7 } })).apply(board, []);

    expect(board.protections).toEqual([1, 5]);
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

describe('天翻地覆 / reshuffle', () => {
  it('defaults to thirty dumplings', () => {
    const board = new FakeBoard([target(1)]);
    new ReshuffleSkill(def({ id: 'reshuffle' })).apply(board, []);

    expect(board.reshuffles).toEqual([30]);
  });

  it('floors the count and never asks for zero', () => {
    const board = new FakeBoard([target(1)]);
    new ReshuffleSkill(def({ id: 'reshuffle', params: { count: 12.9 } })).apply(board, []);
    new ReshuffleSkill(def({ id: 'reshuffle', params: { count: -4 } })).apply(board, []);

    expect(board.reshuffles).toEqual([12, 1]);
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

describe('縮地成寸 / shrink all', () => {
  it('defaults to radius 37.5', () => {
    const board = new FakeBoard([target(1)]);
    new ShrinkAllSkill(def({ id: 'shrink_all', cost: 0 })).apply(board, []);

    expect(board.shrinks).toEqual([37.5]);
  });

  it('falls back to the default when the configured radius is not a positive number', () => {
    const board = new FakeBoard([target(1)]);
    new ShrinkAllSkill(def({ id: 'shrink_all', cost: 0, params: { radius: 0 } })).apply(board, []);
    new ShrinkAllSkill(def({ id: 'shrink_all', cost: 0, params: { radius: -12 } })).apply(board, []);

    expect(board.shrinks).toEqual([37.5, 37.5]);
  });
});

describe('以方代圓 / square core', () => {
  it('switches the merge shape once per cast', () => {
    const board = new FakeBoard([target(1)]);
    new SquareCoreSkill(def({ id: 'square_core', cost: 0 })).apply(board, []);

    expect(board.squareMergeCalls).toBe(1);
  });
});
