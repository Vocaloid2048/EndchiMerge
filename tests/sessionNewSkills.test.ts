/**
 * 新增技能的整合層行為：升級、重排、重開、連擊護盾、縮小、方形判定。
 * Integration behaviour of the new skills: ascend, scramble, reshuffle, combo shield, shrink,
 * square judgement.
 */

import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { createRng } from '../src/core/rng';
import type { AllConfig, LevelDef, SkillDef } from '../src/core/types';

const FRAME_MS = 1000 / 60;

function levelDef(id: number, radius: number, next: number | null): LevelDef {
  return {
    id,
    name: `Lv${String(id)}`,
    sprite: `character/lv${String(id)}.webp`,
    radius,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: 1,
    /* 只掉 Lv1：測試要能預期場上會出現什麼。 */
    spawnWeight: id === 1 ? 10 : 0,
    droppable: id === 1,
    mergeResult: next,
  };
}

function buildConfig(levels: readonly LevelDef[], skills: readonly SkillDef[]): AllConfig {
  return {
    levels: {
      settings: {
        maxBodies: 80,
        gravityY: 1,
        lockRotation: false,
        spawnBlockEnabled: false,
        overflowPenalty: false,
        mergeCooldownMs: 0,
        overflowGraceMs: 3000,
        dropCooldownMs: 0,
      },
      levels: [...levels],
    },
    skills: {
      sp: { max: 10, initial: 10, gainPerDrop: 10, gainPerCombo: 10, overflowAllowed: false },
      skills: [...skills],
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
      aspectMax: 1.6,
    },
    branding: {
      gameName: 'EndchiMerge',
      gameNameZh: '團圓大作戰',
      version: '0.0.0',
      notice: 'Unofficial fan project.',
      noticeZh: '非官方同人作品。',
      repoUrl: 'https://example.invalid',
    },
  };
}

function skill(overrides: Partial<SkillDef> & { id: string }): SkillDef {
  return {
    name: overrides.id,
    cost: 0,
    targeting: 'immediate',
    pickCount: 0,
    unlock: { kind: 'sp' },
    params: {},
    ...overrides,
  };
}

/** 畫布 400 ＝ 容器 300 ＋ 兩側各 50 餘裕。 / Canvas 400 = a 300-wide container plus 50 per side. */
const CANVAS = 400;

/*
 * 半徑一律 ≥ 30：16 單位厚的地板擋不住更小的圓形碰撞體（落速約 20 單位／幀時會整顆跳過），
 * 那是既有的物理極限，不是本輪改動造成的。
 * Radii stay at 30 or above: the 16-unit floor cannot stop smaller circle colliders (a body
 * falling ~20 units per frame skips it entirely). That is a pre-existing limit, not this change.
 */
const CHAIN = [levelDef(1, 48, 2), levelDef(2, 60, 3), levelDef(3, 80, null)];

function runFrames(session: GameSession, frames: number): void {
  for (let i = 0; i < frames; i += 1) session.step(FRAME_MS);
}

function dropAt(session: GameSession, x: number, frames = 40): void {
  session.setAim(x);
  session.drop();
  runFrames(session, frames);
}

describe('一步登天 / ascend', () => {
  const skills = [skill({ id: 'ascend', cost: 0, targeting: 'user_pick', pickCount: 1 })];

  it('promotes the body and takes the next level\'s radius', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, skills),
      rng: createRng(7),
      virtualWidth: CANVAS,
    });

    dropAt(session, CANVAS / 2);
    const before = session.targets[0];
    expect(before?.levelId).toBe(1);
    expect(before?.radius).toBe(48);

    expect(session.upgradeTarget(before?.id ?? -1)).toBe(true);

    const after = session.targets[0];
    expect(after?.levelId).toBe(2);
    expect(after?.radius).toBe(60);
  });

  it('refuses the top of the chain', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, skills),
      rng: createRng(7),
      virtualWidth: CANVAS,
    });

    dropAt(session, CANVAS / 2);
    const id = session.targets[0]?.id ?? -1;

    expect(session.upgradeTarget(id)).toBe(true);
    expect(session.upgradeTarget(session.targets[0]?.id ?? -1)).toBe(true);
    /* 現在是 Lv3，`mergeResult` 為 null。 */
    expect(session.targets[0]?.levelId).toBe(3);
    expect(session.upgradeTarget(session.targets[0]?.id ?? -1)).toBe(false);
  });

  it('refuses when the next level is still locked in the collection', () => {
    const unlocked = new Set([1]);
    const session = new GameSession({
      config: buildConfig(CHAIN, skills),
      rng: createRng(7),
      virtualWidth: CANVAS,
      unlocks: {
        unlocked,
        has: (id: number): boolean => unlocked.has(id),
        unlock: (id: number): boolean => {
          unlocked.add(id);
          return true;
        },
      },
    });

    dropAt(session, CANVAS / 2);

    expect(session.targets[0]?.nextLevelUnlocked).toBe(false);
    expect(session.upgradeTarget(session.targets[0]?.id ?? -1)).toBe(false);
  });
});

describe('乾坤挪移 / scramble', () => {
  it('keeps the multiset of positions and stops every body', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, [skill({ id: 'scramble', cost: 0 })]),
      rng: createRng(11),
      virtualWidth: CANVAS,
    });

    dropAt(session, 120);
    dropAt(session, 280);

    const before = session.targets
      .map((target) => `${target.x.toFixed(3)},${target.y.toFixed(3)}`)
      .sort();

    session.scrambleTargets();

    const after = session.targets
      .map((target) => `${target.x.toFixed(3)},${target.y.toFixed(3)}`)
      .sort();

    expect(after).toEqual(before);
    for (const body of session.bodies) {
      expect(body.velocity?.x).toBe(0);
      expect(body.velocity?.y).toBe(0);
    }
  });
});

describe('天翻地覆 / reshuffle', () => {
  it('clears the board at once and then rains the exact count down', () => {
    /* 不設合成，否則三十顆同級會在落下途中互相吃掉，數不到 30。 */
    const flat = CHAIN.map((entry) => ({ ...entry, mergeResult: null }));
    const session = new GameSession({
      config: buildConfig(flat, [skill({ id: 'reshuffle', cost: 0, params: { count: 30 } })]),
      rng: createRng(3),
      virtualWidth: CANVAS,
    });

    dropAt(session, 200);
    expect(session.targets.length).toBe(1);

    session.reshuffle(30);
    expect(session.targets.length).toBe(0);

    /*
     * 40ms 一顆，30 顆約 1.2 秒。只跑 75 幀（1.25 秒）就數：這時全部已放出，而第一顆還未落到
     * 地面（約 1.4 秒才觸底），所以不會有顆粒被回收而少算。
     * One per 40 ms, so 30 arrive in about 1.2 s. Count at 75 frames (1.25 s): every one has
     * spawned and the first has not reached the floor yet (about 1.4 s), so none is recycled.
     */
    runFrames(session, 75);
    expect(session.targets.length).toBe(30);
  });

  it('may fire on an empty board, which other skills may not', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, [
        skill({ id: 'reshuffle', cost: 0 }),
        skill({ id: 'scramble', cost: 0 }),
      ]),
      rng: createRng(3),
      virtualWidth: CANVAS,
    });

    expect(session.activateSkill('scramble')).toBe(false);
    expect(session.activateSkill('reshuffle')).toBe(true);
  });
});

describe('縮地成寸 / shrink all', () => {
  it('shrinks the collider and the drawn radius together', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, [skill({ id: 'shrink_all', cost: 0, params: { radius: 37.5 } })]),
      rng: createRng(5),
      virtualWidth: CANVAS,
    });

    dropAt(session, 200);
    expect(session.targets[0]?.radius).toBe(48);

    session.shrinkAll(37.5);

    expect(session.targets[0]?.radius).toBeCloseTo(37.5, 6);
    expect(session.bodies[0]?.radius).toBeCloseTo(37.5, 6);
  });

  it('never enlarges a body that is already smaller', () => {
    const small = [levelDef(1, 30, 2), levelDef(2, 40, 3), levelDef(3, 50, null)];
    const session = new GameSession({
      config: buildConfig(small, [skill({ id: 'shrink_all', cost: 0, params: { radius: 37.5 } })]),
      rng: createRng(5),
      virtualWidth: CANVAS,
    });

    dropAt(session, 200);
    session.shrinkAll(37.5);

    expect(session.targets[0]?.radius).toBe(30);
  });
});

describe('以方代圓 / square core', () => {
  /**
   * 半邊 `r` 的正方形輪廓。
   * A square outline with half-side `r`.
   */
  function box(r: number): { x: number; y: number }[] {
    return [
      { x: -r, y: -r },
      { x: r, y: -r },
      { x: r, y: r },
      { x: -r, y: r },
    ];
  }

  /**
   * 「身體 ＋ 兩側翅膀」的輪廓：高度 `r`、半寬 `1.5r`，底邊平放所以不會滾。
   * A body-plus-wings outline: `r` tall and `1.5r` half-wide, with a flat base so it never rolls.
   *
   * 兩顆並排時**實體**剛好相接（相隔 `3r`），而核心正方形（邊長 `2r`）仍差 `r` 才碰得到 ——
   * 這正是「按輪廓合成、不按方形」的分辨點。
   * Side by side their **colliders** just touch (`3r` apart) while the core squares (`2r` across)
   * are still `r` short of each other — the case that tells the two rules apart.
   */
  function wings(r: number): { x: number; y: number }[] {
    return [
      { x: -1.5 * r, y: -0.5 * r },
      { x: 1.5 * r, y: -0.5 * r },
      { x: 1.5 * r, y: 0.5 * r },
      { x: -1.5 * r, y: 0.5 * r },
    ];
  }

  it('is off at the start, stays on for the run, and resets with the run', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, [skill({ id: 'square_core', cost: 0 })]),
      rng: createRng(5),
      virtualWidth: CANVAS,
    });

    expect(session.squareMergeEnabled).toBe(false);

    session.useSquareMerge();
    expect(session.squareMergeEnabled).toBe(true);

    session.reset();
    expect(session.squareMergeEnabled).toBe(false);
  });

  it('stops merges that happen only because a decoration touches', () => {
    /*
     * 翅膀伸出核心方形之外：兩顆並排時**實體**已經接觸，方形還差 `r`。碰撞路徑若不看方形，
     * 就會照輪廓合成 —— 這正是「用了以方代圓但仍然按輪廓判定」的來源。
     * The wings reach past the core square: side by side the **colliders** already touch while the
     * squares are still `r` short. A collision path that ignores the square merges by outline —
     * exactly the reported "square rule still behaves like outline".
     */
    const levels = [levelDef(1, 40, 2), levelDef(2, 50, null)];
    const silhouettes = new Map<number, { x: number; y: number }[] | null>([
      [1, wings(40)],
      [2, wings(50)],
    ]);

    const build = (): GameSession =>
      new GameSession({
        config: buildConfig(levels, []),
        rng: createRng(2),
        virtualWidth: 700,
        silhouettes,
      });

    /*
     * 兩顆落在相隔 100 的位置（實體各半寬 60，因此必定互相擠壓）；它們會被推到 120 才並排，
     * 那一刻碰撞事件已經發生過 —— 要測的正是「碰撞已發生，但方形還未相接」。
     * Dropped 100 apart (each 60 half-wide), so they must collide; the solver then separates them
     * to 120. The collision has already fired by then — exactly "collided, but squares not yet".
     */
    const plain = build();
    dropAt(plain, 200, 150);
    dropAt(plain, 300, 150);
    expect(plain.mergedCount).toBe(1);

    const square = build();
    /* 先買技能再落第二顆：兩顆相遇的那一刻起就該按方形判，而不是先按輪廓合成再說。 */
    square.useSquareMerge();
    dropAt(square, 200, 150);
    dropAt(square, 300, 150);
    runFrames(square, 90);

    expect(square.mergedCount).toBe(0);
    expect(square.targets.length).toBe(2);
  });

  it('merges on square contact even when the colliders never meet', () => {
    /* 極小的碰撞體（半邊 8），兩顆相距 45：方形（半邊 30）重疊，實體卻離得遠遠的。 */
    const levels = [levelDef(1, 30, 2), levelDef(2, 40, null)];
    const silhouettes = new Map<number, { x: number; y: number }[] | null>([
      [1, box(8)],
      [2, box(10)],
    ]);

    const session = new GameSession({
      config: buildConfig(levels, []),
      rng: createRng(2),
      virtualWidth: 700,
      silhouettes,
    });

    dropAt(session, 200, 120);
    dropAt(session, 245, 120);
    expect(session.mergedCount).toBe(0);

    session.useSquareMerge();
    runFrames(session, 60);

    expect(session.mergedCount).toBe(1);
  });
});

describe('連勢不墜 / combo shield', () => {
  /*
   * 用寬畫布：四次投放要落在互不相碰的位置，否則「沒有合成」這個前提本身就不成立。
   * A wide canvas, so the four drops land far apart; otherwise "no merge happened" would not
   * hold in the first place.
   */
  const WIDE = 1000;

  it('keeps the chain alive across the protected drops, then lets it break', () => {
    /*
     * 給每一級一個正方形輪廓：圓形退路要求「圓心距 ≤ 半徑和」，而求解器總會留下少許間隙，
     * 兩顆疊住也差之毫釐；輪廓路徑帶 4 單位容差（`MERGE_OUTLINE_GAP`），才是真實遊戲的判定。
     * Each level gets a square outline: the circle fallback demands "centre distance ≤ radii sum",
     * which the solver's sliver of separation always just misses, while the outline path carries
     * a 4-unit tolerance (`MERGE_OUTLINE_GAP`) — the real game's rule.
     */
    const silhouettes = new Map<number, { x: number; y: number }[] | null>(
      CHAIN.map((entry) => [
        entry.id,
        [
          { x: -entry.radius, y: -entry.radius },
          { x: entry.radius, y: -entry.radius },
          { x: entry.radius, y: entry.radius },
          { x: -entry.radius, y: entry.radius },
        ],
      ]),
    );

    const session = new GameSession({
      config: buildConfig(CHAIN, [skill({ id: 'combo_grace', cost: 0, params: { drops: 2 } })]),
      rng: createRng(13),
      virtualWidth: WIDE,
      silhouettes,
    });

    /* 同一點連投兩顆同級；等第一顆落定（約 1.4 秒）再投第二顆，必定合成。 */
    dropAt(session, 200, 90);
    dropAt(session, 200, 90);
    const chained = session.comboCount;
    expect(chained).toBeGreaterThan(0);

    /* 兩次護盾投放：丟到遠處，不會碰到既有顆粒，串長因此不該歸零。 */
    session.protectCombo(2);
    dropAt(session, 400);
    expect(session.comboCount).toBe(chained);
    expect(session.comboGrace).toBe(1);

    dropAt(session, 600);
    expect(session.comboCount).toBe(chained);
    expect(session.comboGrace).toBe(0);

    /* 護盾用完之後，再一次零合成的投放就把串長歸零。 */
    dropAt(session, 800);
    expect(session.comboCount).toBe(0);
  });
});

describe('以次數解鎖 / cumulative uses', () => {
  it('unlocks after the threshold and re-locks once used', () => {
    const session = new GameSession({
      config: buildConfig(CHAIN, [
        skill({ id: 'scramble', cost: 0 }),
        skill({ id: 'shrink_all', cost: 0, unlock: { kind: 'cumulativeUses', threshold: 8 } }),
      ]),
      rng: createRng(17),
      virtualWidth: CANVAS,
    });

    dropAt(session, 200);

    const card = (): (typeof session.skillCards)[number] | undefined =>
      session.skillCards.find((entry) => entry.id === 'shrink_all');

    expect(card()?.unlocked).toBe(false);

    for (let i = 0; i < 8; i += 1) expect(session.activateSkill('scramble')).toBe(true);

    expect(session.skillUses).toBe(8);
    expect(card()?.unlocked).toBe(true);

    expect(session.activateSkill('shrink_all')).toBe(true);
    expect(session.skillUses).toBe(0);
    expect(card()?.unlocked).toBe(false);
  });
});
