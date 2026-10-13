/**
 * 技能在整合層的物理行為：喚醒休眠、浮動天花板、地震。
 * Skill physics at the integration level: waking sleepers, the float ceiling, the earthquake.
 */

import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { createRng } from '../src/core/rng';
import type { AllConfig, LevelDef, SkillDef } from '../src/core/types';

function level(id: number, radius: number): LevelDef {
  return {
    id,
    name: `Lv${String(id)}`,
    sprite: `character/lv${String(id)}.webp`,
    radius,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: 0,
    spawnWeight: 10,
    droppable: true,
    mergeResult: null,
  };
}

const SKILLS: readonly SkillDef[] = [
  { id: 'discard', name: '當棄即棄！', cost: 1, targeting: 'user_pick', pickCount: 1, unlock: { kind: 'sp' }, params: {} },
  {
    id: 'protocol_float',
    name: '協議：浮動',
    cost: 2,
    targeting: 'immediate',
    pickCount: 0,
    unlock: { kind: 'sp' },
    params: { durationMs: 1500, liftFactor: 2.5, catchupFactor: 2 },
  },
  {
    id: 'shake',
    name: '搖晃！',
    cost: 3,
    targeting: 'immediate',
    pickCount: 0,
    unlock: { kind: 'sp' },
    params: { durationMs: 2000, revolutions: 5, radiusFactor: 0.12, axisTiltDeg: 15, upwardFactor: 0.1 },
  },
  {
    id: 'fate_swap',
    name: '命運互換',
    cost: 0,
    targeting: 'user_pick',
    pickCount: 2,
    unlock: { kind: 'cumulativeSpent', threshold: 6 },
    params: { disturbance: 6 },
  },
];

const CONFIG: AllConfig = {
  levels: {
    settings: {
      maxBodies: 80,
      gravityY: 1,
      lockRotation: false,
      spawnBlockEnabled: false,
      overflowPenalty: false,
      mergeCooldownMs: 100,
      overflowGraceMs: 3000,
      dropCooldownMs: 1000,
    },
    levels: [level(1, 30)],
  },
  skills: {
    sp: { max: 3, initial: 0, gainPerDrop: 10, gainPerCombo: 10, overflowAllowed: false },
    skills: [...SKILLS],
  },
  container: {
    cornerRadius: 16,
    strokeWidth: 10,
    strokeColor: '#FFFFFF',
    fill: 'rgba(255, 255, 255, 0.20)',
    topOffset: 80,
    spawnGap: 8,
    dropAboveRim: 40,
    overflowAboveRim: 30,
    floatCeilingBelowRim: 20,
    bottomOffset: 0,
    leftOffset: 50,
    rightOffset: 50,
    aspectMin: 0.62,
    aspectMax: 1.45,
  },
  branding: {
    gameName: 'EndchiMerge',
    gameNameZh: '方團團大作戰',
    version: '0.0.0',
    notice: 'Unofficial fan project.',
    noticeZh: '非官方同人作品。',
    repoUrl: 'https://example.invalid',
  },
};

/**
 * 傳入的是**畫布**寬度；容器兩側各扣 50 展示餘裕，故「容器寬 110」要傳 210。
 * The **canvas** width; the container gives up 50 per side, so a 110-wide container passes 210.
 */
function makeSession(virtualWidth: number): GameSession {
  return new GameSession({ config: CONFIG, rng: createRng(20261006), virtualWidth });
}

function makeNonMergingSession(virtualWidth: number): GameSession {
  const config: AllConfig = {
    ...CONFIG,
    levels: {
      ...CONFIG.levels,
      levels: CONFIG.levels.levels.map((lv) => ({ ...lv, mergeResult: null })),
    },
  };
  return new GameSession({ config, rng: createRng(20261006), virtualWidth });
}

const FRAME_MS = 1000 / 60;

function runFrames(session: GameSession, frames: number): void {
  for (let i = 0; i < frames; i += 1) session.step(FRAME_MS);
}

/**
 * 讓場上的顆粒睡着；Matter 需連續 60 幀低於門檻才入眠，4 秒（240 幀）足夠。
 * Lets the bodies fall asleep; Matter needs 60 consecutive quiet frames, so 4 s is generous.
 */
function settleToSleep(session: GameSession): void {
  runFrames(session, 240);
}

function dropAndSettle(session: GameSession, aimX: number): void {
  session.setAim(aimX);
  session.drop();
  runFrames(session, 120);
}

describe('當棄即棄！—— 移除支撐後，上面的堆疊必須落下 / discard drops the stack above', () => {
  it('wakes the sleeping stack so it falls onto the floor', () => {
    /*
     * 畫布 210 ＝ 容器 110 ＋ 兩側各 50 餘裕；空腔 78 只放得下一顆（直徑 60），兩顆並排要 120，
     * 所以必定疊成一座塔。
     * Canvas 210 = a 110-wide container plus 50 per side; a 78-unit cavity fits one dumpling
     * (60 across) but not two side by side (120), so the pair is forced into a tower.
     */
    const session = makeSession(210);

    dropAndSettle(session, 105);
    dropAndSettle(session, 105);
    settleToSleep(session);

    const before = session.bodies.map((body) => ({ x: body.x, y: body.y, radius: body.radius }));
    expect(before).toHaveLength(2);

    const lower = before.reduce((a, b) => (a.y > b.y ? a : b));
    const upper = before.reduce((a, b) => (a.y < b.y ? a : b));

    const activated = session.activateSkill('discard');
    expect(activated).toBe(true);
    session.canvasPointerAction(lower.x, lower.y);
    expect(session.bodies).toHaveLength(1);

    runFrames(session, 90);

    const survivor = session.bodies[0];
    expect(survivor).toBeDefined();

    expect(survivor!.y - upper.y).toBeGreaterThan(40);
  });
});

describe('協議：浮動 —— 每一顆都要浮起 / float lifts every dumpling', () => {
  it('raises a body that had settled and fallen asleep', () => {
    const session = makeSession(600);
    dropAndSettle(session, 300);
    settleToSleep(session);

    const startY = session.bodies[0]!.y;

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 30);

    expect(session.isFloating).toBe(true);
    expect(session.bodies[0]!.y - startY).toBeLessThan(-20);
  });

  it('stops every body at the invisible ceiling below the rim', () => {
    const session = makeSession(600);
    dropAndSettle(session, 300);
    settleToSleep(session);

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 120);
    expect(session.isFloating).toBe(false);

    const ceilingY =
      session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    for (const body of session.bodies) {
      expect(body.y - body.radius).toBeGreaterThan(ceilingY - 5);
      expect(body.y - body.radius).toBeGreaterThan(session.overflowLineY);
    }
  });

  it('leaves no ceiling behind after a restart', () => {
    const session = makeSession(600);
    dropAndSettle(session, 300);
    settleToSleep(session);

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 30);

    session.reset();
    dropAndSettle(session, 300);
    runFrames(session, 120);

    const body = session.bodies[0];
    expect(body).toBeDefined();
    const ceilingY =
      session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;
    expect(body!.y).toBeGreaterThan(ceilingY + 200);
  });

  it('leaves no body stuck at the floor when a whole pile floats', () => {
    const session = makeNonMergingSession(600);

    for (const aimX of [150, 300, 450, 220, 380, 100, 500]) dropAndSettle(session, aimX);
    settleToSleep(session);

    const count = session.bodies.length;
    expect(count).toBeGreaterThan(4);

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 85);
    expect(session.isFloating).toBe(true);

    const frame = session.containerGeometry.frame;
    const floorLeeway = frame.height * 0.3;

    for (const body of session.bodies) {
      expect(body.y).toBeLessThan(frame.y + frame.height - floorLeeway);
    }
  });
});

describe('搖晃！—— 地震要把睡着的堆疊甩動 / the earthquake actually moves the pile', () => {
  it('moves a body that had settled and fallen asleep', () => {
    const session = makeSession(600);
    dropAndSettle(session, 300);
    settleToSleep(session);

    const startX = session.bodies[0]!.x;

    expect(session.activateSkill('shake')).toBe(true);
    expect(session.isShaking).toBe(true);

    let maxShift = 0;
    for (let i = 0; i < 60; i += 1) {
      session.step(FRAME_MS);
      maxShift = Math.max(maxShift, Math.abs(session.bodies[0]!.x - startX));
    }

    expect(maxShift).toBeGreaterThan(5);
  });
});

describe('搖晃！—— 天花板與展示餘裕 / the shake ceiling and the display margin', () => {
  /**
   * 以自訂搖晃參數開一局（其餘沿用 `CONFIG`）；`gravityY` 可調低，否則單顆根本飛不到平面，
   * 天花板就驗不到。
   * Opens a session with custom shake params (the rest from `CONFIG`); `gravityY` can be lowered,
   * since a lone body otherwise never reaches the plane and the ceiling is unverifiable.
   */
  function makeSessionWithShake(
    virtualWidth: number,
    params: Record<string, unknown>,
    gravityY = 1,
  ): GameSession {
    const config: AllConfig = {
      ...CONFIG,
      levels: {
        ...CONFIG.levels,
        settings: { ...CONFIG.levels.settings, gravityY },
      },
      skills: {
        ...CONFIG.skills,
        skills: CONFIG.skills.skills.map((skill) =>
          skill.id === 'shake' ? { ...skill, params } : skill,
        ) as SkillDef[],
      },
    };
    return new GameSession({ config, rng: createRng(20261006), virtualWidth });
  }

  const QUAKE_AT_MAX = {
    durationMs: 2000,
    revolutions: 5,
    radiusFactor: 0.3,
    axisTiltDeg: 15,
    /* 技能端會把它夾到 0.5。 */
    /* The skill clamps it to 0.5. */
    upwardFactor: 1,
  };

  it('never lets a dumpling past the invisible ceiling, however hard it is thrown up', () => {
    const session = makeSessionWithShake(600, QUAKE_AT_MAX, 0.2);

    dropAndSettle(session, 300);
    settleToSleep(session);

    /* 天花板的深度是相對**靜止**的頂緣算的，所以要在施放前記下來。 */
    /* The ceiling depth is measured from the resting rim, so record it before casting. */
    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    expect(session.activateSkill('shake')).toBe(true);

    let highest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 120; i += 1) {
      session.step(FRAME_MS);
      for (const body of session.bodies) {
        highest = Math.min(highest, body.y - body.radius);
      }
    }

    expect(highest).toBeGreaterThan(ceilingY - 5);
    expect(highest).toBeLessThan(ceilingY + 20);
  });

  it('drops the ceiling again once the quake is over, so the pile falls back', () => {
    const session = makeSessionWithShake(600, QUAKE_AT_MAX, 0.2);

    dropAndSettle(session, 300);
    settleToSleep(session);

    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    expect(session.activateSkill('shake')).toBe(true);

    runFrames(session, 120);
    expect(session.isShaking).toBe(false);

    const pinned = session.bodies[0];
    expect(pinned).toBeDefined();
    expect(pinned!.y - pinned!.radius).toBeLessThan(ceilingY + 20);

    runFrames(session, 240);

    const body = session.bodies[0];
    expect(body).toBeDefined();
    expect(body!.y).toBeGreaterThan(ceilingY + 200);
  });

  it('clamps the container offset inside the display margin', () => {
    /*
     * 幅度比例 1/3（技能硬上限）× 容器寬 500 ＝ 167，遠大於左右各 50 的餘裕，實作必須夾回餘裕內。
     * A 1/3 ratio (the skill's hard cap) × a 500-wide container = 167, far more than the 50 of
     * margin per side, so the implementation must clamp it back inside.
     */
    const session = makeSessionWithShake(600, {
      durationMs: 2000,
      revolutions: 5,
      radiusFactor: 1 / 3,
      axisTiltDeg: 15,
      upwardFactor: 0.1,
    });

    const restX = session.containerGeometry.frame.x;

    dropAndSettle(session, 300);
    expect(session.activateSkill('shake')).toBe(true);

    let maxShift = 0;
    for (let i = 0; i < 120; i += 1) {
      session.step(FRAME_MS);
      maxShift = Math.max(maxShift, Math.abs(session.containerGeometry.frame.x - restX));
    }

    expect(maxShift).toBeGreaterThan(1);
    expect(maxShift).toBeLessThanOrEqual(CONFIG.container.leftOffset + 1);
  });

  it('leaves no ceiling behind after a restart in the middle of a quake', () => {
    const session = makeSessionWithShake(
      600,
      { ...QUAKE_AT_MAX, upwardFactor: 0.1 },
      0.2,
    );

    dropAndSettle(session, 300);
    settleToSleep(session);

    expect(session.activateSkill('shake')).toBe(true);
    runFrames(session, 30);

    session.reset();
    dropAndSettle(session, 300);
    runFrames(session, 240);

    const body = session.bodies[0];
    expect(body).toBeDefined();

    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;
    expect(body!.y).toBeGreaterThan(ceilingY + 200);
  });
});

describe('命運互換 —— 累計消耗的解鎖資訊要傳到卡片 / the gated skill reports its progress', () => {
  it('reports n/m and the cumulative unlock kind', () => {
    const session = makeSession(600);

    const gated = session.skillCards.find((card) => card.id === 'fate_swap');
    expect(gated?.unlockKind).toBe('cumulativeSpent');
    expect(gated?.unlockThreshold).toBe(6);
    expect(gated?.cumulativeSpent).toBe(0);

    dropAndSettle(session, 300);
    expect(session.activateSkill('shake')).toBe(true);

    const after = session.skillCards.find((card) => card.id === 'fate_swap');
    expect(after?.cumulativeSpent).toBeCloseTo(3, 6);
    expect(after?.unlocked).toBe(false);
  });
});

describe('協議：浮動 —— 整堆都要升進上半部 / float lifts the whole pile', () => {
  function makeFloatConfig(liftFactor: number, catchupFactor: number): AllConfig {
    const nonMerge: LevelDef = {
      id: 1, name: 'Lv1', sprite: 'character/lv1.webp', radius: 22,
      density: 0.001, restitution: 0.15, friction: 0.3, frictionAir: 0.005, score: 0,
      spawnWeight: 10, droppable: true, mergeResult: null,
    };
    return {
      levels: {
        settings: {
          maxBodies: 80, gravityY: 1, lockRotation: false, spawnBlockEnabled: false,
          overflowPenalty: false, mergeCooldownMs: 100, overflowGraceMs: 3000, dropCooldownMs: 1000,
        },
        levels: [nonMerge],
      },
      skills: {
        sp: { max: 3, initial: 0, gainPerDrop: 10, gainPerCombo: 10, overflowAllowed: false },
        skills: CONFIG.skills.skills.map((s) =>
          s.id === 'protocol_float'
            ? { ...s, params: { ...s.params, durationMs: 1500, liftFactor, catchupFactor } }
            : s,
        ),
      },
      container: { ...CONFIG.container },
      branding: CONFIG.branding,
    };
  }

  function dropPile(session: GameSession, n: number): void {
    const frame = session.containerGeometry.frame;
    const lo = frame.x + 20;
    const hi = frame.x + frame.width - 20;
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i += 1) {
      session.setAim(lo + ((i * 53) % span));
      session.drop();
      // 65 幀（≈1083ms）已超過 dropCooldownMs(1000)，才放下一顆。
      // 65 frames (≈1083 ms) already clears the dropCooldownMs (1000) floor.
      runFrames(session, 65);
    }
  }

  function floatAndSample(session: GameSession): { topEdge: number; midY: number; rise: number } {
    const beforeLowestY = Math.max(...session.bodies.map((b) => b.y));
    expect(session.activateSkill('protocol_float')).toBe(true);
    // 浮動期間測量：1500ms ≈ 90 幀，取第 85 幀取樣。
    // Measured during the float: 1500 ms ≈ 90 frames, sampled at frame 85.
    runFrames(session, 85);
    const frame = session.containerGeometry.frame;
    const midY = frame.y + frame.height / 2;
    const lowest = session.bodies.reduce((a, b) => (b.y > a.y ? b : a));
    return { topEdge: lowest.y - lowest.radius, midY, rise: beforeLowestY - lowest.y };
  }

  it('生產值 liftFactor=2.5 + catchupFactor=2 把整堆升進上半部', () => {
    const session = new GameSession({ config: makeFloatConfig(2.5, 2), rng: createRng(20261006), virtualWidth: 260 });
    dropPile(session, 8);
    settleToSleep(session);
    const { topEdge, midY, rise } = floatAndSample(session);
    expect(topEdge).toBeLessThan(midY);
    expect(rise).toBeGreaterThan(100);
  });

  it('弱浮動 liftFactor=1.6（關掉追趕）不會把整堆升進上半部（回歸方向鎖定）', () => {
    const session = new GameSession({ config: makeFloatConfig(1.6, 0), rng: createRng(20261006), virtualWidth: 260 });
    dropPile(session, 8);
    settleToSleep(session);
    const { topEdge, midY } = floatAndSample(session);
    expect(topEdge).toBeGreaterThanOrEqual(midY);
  });

  /*
   * 淨重力調成 0（liftFactor=1）之後翻轉重力什麼都不做，堆疊只能靠追趕力上升。
   * With net gravity zeroed (liftFactor=1) the gravity flip does nothing, so the pile can only
   * rise via the catch-up force.
   */
  it('淨重力為 0 時，單靠追趕力也要把整堆升進上半部', () => {
    const session = new GameSession({ config: makeFloatConfig(1, 2), rng: createRng(20261006), virtualWidth: 260 });
    dropPile(session, 8);
    settleToSleep(session);
    const { topEdge, midY, rise } = floatAndSample(session);
    expect(topEdge).toBeLessThan(midY);
    expect(rise).toBeGreaterThan(100);
  });

  it('浮動期間每一步、每一顆的上緣都不得高於天花板', () => {
    const session = makeNonMergingSession(600);
    for (const aimX of [150, 300, 450, 220, 380, 100, 500]) dropAndSettle(session, aimX);
    settleToSleep(session);

    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    expect(session.activateSkill('protocol_float')).toBe(true);

    let highest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 90; i += 1) {
      session.step(FRAME_MS);
      for (const body of session.bodies) {
        highest = Math.min(highest, body.y - body.radius);
      }
    }

    expect(highest).toBeGreaterThan(ceilingY - 5);
  });
});

describe('命運互換 —— 交換不得穿越容器邊界 / a swap never crosses the boundary', () => {
  const SMALL_RADIUS = 24;
  const BIG_RADIUS = 56;
  /**
   * `core/constants.ts` 的 `WALL_THICKNESS`；空腔 ＝ frame 內縮這麼多。
   * `WALL_THICKNESS` from `core/constants.ts`; the cavity is the frame inset by this much.
   */
  const WALL = 16;

  function makeSwapSession(virtualWidth: number): GameSession {
    const config: AllConfig = {
      ...CONFIG,
      levels: {
        ...CONFIG.levels,
        levels: [level(1, SMALL_RADIUS), level(2, BIG_RADIUS)],
      },
      skills: {
        ...CONFIG.skills,
        skills: CONFIG.skills.skills.map((s) =>
          s.id === 'fate_swap' ? { ...s, unlock: { kind: 'sp' } } : s,
        ),
      },
    };
    return new GameSession({ config, rng: createRng(20261006), virtualWidth });
  }

  function dropUntil(session: GameSession, wantId: number, aimX: number): void {
    for (let i = 0; i < 24; i += 1) {
      if (session.pendingLevelId === wantId) {
        dropAndSettle(session, aimX);
        return;
      }
      dropAndSettle(session, 470);
    }
    throw new Error(`level ${String(wantId)} never came up within 24 drops`);
  }

  it('大顆換進小顆貼牆的位置時，仍要整顆留在空腔內', () => {
    const session = makeSwapSession(600);

    dropUntil(session, 1, 80);
    dropUntil(session, 2, 300);
    settleToSleep(session);

    const small = session.bodies
      .filter((b) => b.radius === SMALL_RADIUS)
      .reduce((a, b) => (b.x < a.x ? b : a));
    const big = session.bodies
      .filter((b) => b.radius === BIG_RADIUS)
      .reduce((a, b) => (Math.abs(b.x - 300) < Math.abs(a.x - 300) ? b : a));

    const frame = session.containerGeometry.frame;
    expect(small.x).toBeLessThan(frame.x + 130);
    expect(Math.abs(big.x - 300)).toBeLessThan(80);

    expect(session.activateSkill('fate_swap')).toBe(true);
    session.canvasPointerAction(small.x, small.y);
    session.canvasPointerAction(big.x, big.y);

    runFrames(session, 60);

    const bigAfter = session.bodies
      .filter((b) => b.radius === BIG_RADIUS)
      .reduce((a, b) => (b.x < a.x ? b : a));
    expect(bigAfter.x).toBeLessThan(250);

    const cavityLeft = frame.x + WALL;
    const cavityRight = frame.x + frame.width - WALL;
    const cavityBottom = frame.y + frame.height - WALL;
    for (const body of session.bodies) {
      expect(body.x - body.radius).toBeGreaterThanOrEqual(cavityLeft - 2);
      expect(body.x + body.radius).toBeLessThanOrEqual(cavityRight + 2);
      expect(body.y + body.radius).toBeLessThanOrEqual(cavityBottom + 2);
    }
  });
});
