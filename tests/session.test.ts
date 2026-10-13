/**
 * 單局狀態的單元測試：幾何、瞄準、投放、合成、推力、溢位與解鎖。
 * Unit tests for the play session: geometry, aiming, dropping, merging, push, overflow and unlocks.
 */

import { describe, expect, it } from 'vitest';
import { GameSession, type UnlockSource } from '../src/game/session';
import { comboMultiplier } from '../src/game/combo';
import { computeContainerBounds } from '../src/game/containerBox';
import { WALL_THICKNESS } from '../src/core/constants';
import { createRng } from '../src/core/rng';
import type { AllConfig, ContainerConfig, GameSettings, LevelDef } from '../src/core/types';

function level(id: number, radius: number, spawnWeight: number, droppable = true): LevelDef {
  return {
    id,
    name: `Lv${String(id)}`,
    sprite: `character/lv${String(id)}.webp`,
    radius,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: id * 2,
    spawnWeight,
    droppable,
    mergeResult: id + 1,
  };
}

/** 迷你但形狀完整的配置。
 * Minimal but shape-complete config. */
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
    levels: [level(1, 13.5, 70), level(2, 17.3, 25), level(3, 22.1, 5), level(4, 28.3, 0, false)],
  },
  skills: {
    sp: { max: 3, initial: 0, gainPerDrop: 0.05, gainPerCombo: 0.05, overflowAllowed: false },
    skills: [],
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
    /*
     * 展示餘裕刻意設為 0：容器吃滿畫布，斷言直接以 `virtualWidth` 為準，數字不必換算。
     * The display margins are deliberately zero so the container fills the canvas and the
     * assertions read straight off `virtualWidth` with no conversion.
     */
    leftOffset: 0,
    rightOffset: 0,
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

/** 固定種子與寬度的 session；`settings` 可覆寫個別開關。
 * Fixed-seed, fixed-width session; `settings` overrides individual switches. */
function makeSession(virtualWidth = 500, settings: Partial<GameSettings> = {}): GameSession {
  return new GameSession({
    config: {
      ...CONFIG,
      levels: { ...CONFIG.levels, settings: { ...CONFIG.levels.settings, ...settings } },
    },
    rng: createRng(20261004),
    virtualWidth,
  });
}

/** 只有 Lv1 可掉落；其餘等級只作為合成目標存在。
 * Only Lv1 is droppable; the rest exist only as merge targets. */
const SOLO_LV1: LevelDef[] = [level(1, 13.5, 70), level(2, 17.3, 0, false), level(3, 22.1, 0, false)];

/**
 * 三級都可掉落；搭配解鎖閘門時開局只有 Lv1 進池。Lv3 必須是終點（`mergeResult: null`），
 * 否則它會去找不存在的 Lv4，`GameSession` 直接拋錯。
 * Three droppable levels; with the unlock gate only Lv1 is in the pool at the start. Lv3 must be
 * the terminus (`mergeResult: null`), or it looks for a nonexistent Lv4 and the session throws.
 */
const ALL_DROPPABLE: LevelDef[] = [
  level(1, 13.5, 10),
  level(2, 17.3, 10),
  { ...level(3, 22.1, 10), mergeResult: null },
];

/** 三級都可掉落但永不合成；用來測「抽到哪些等級」，合成會把證據吃掉。
 * Three droppable levels that never merge, for testing which levels get drawn. */
const ALL_DROPPABLE_NO_MERGE: LevelDef[] = [
  { ...level(1, 13.5, 10), mergeResult: null },
  { ...level(2, 17.3, 10), mergeResult: null },
  { ...level(3, 22.1, 10), mergeResult: null },
];

/** 單一等級、永不合成；用來疊一座純粹的塔，合成會把堆疊吃掉。
 * A single level that never merges, so a plain tower can be stacked for the overflow tests. */
const NO_MERGE: LevelDef[] = [{ ...level(1, 13.5, 70), mergeResult: null }];

/** 自訂等級表＋settings＋解鎖閘門的 session。
 * A session with a custom level table, settings and an unlock gate. */
function makeCustom(
  levels: LevelDef[],
  settings: Partial<GameSettings> = {},
  unlocks?: UnlockSource,
): GameSession {
  return new GameSession({
    config: {
      ...CONFIG,
      levels: { ...CONFIG.levels, settings: { ...CONFIG.levels.settings, ...settings }, levels },
    },
    rng: createRng(20261004),
    virtualWidth: 500,
    unlocks,
  });
}

/**
 * 窄容器版本：兩顆丟在同一個 X 就必定貼在一起。寬容器裡兩顆落地後會滾開（實測相距 51px，
 * 遠超容差 30px），近接根本不會成立，測到的就變成物理而非掃描。
 * Narrow-container variant: two drops at the same X leave the pair guaranteed adjacent. In a
 * wide box they roll apart (~51px, past the 30px tolerance) and no proximity ever forms.
 */
function makeNarrow(levels: LevelDef[], width: number, settings: Partial<GameSettings> = {}): GameSession {
  return new GameSession({
    config: {
      ...CONFIG,
      levels: { ...CONFIG.levels, settings: { ...CONFIG.levels.settings, ...settings }, levels },
    },
    rng: createRng(20261004),
    virtualWidth: width,
  });
}

/**
 * 注入輪廓素材的 session（每一級都用同一份輪廓）。測試環境沒有真的 sprite，想走到輪廓路徑
 * 就只能自己餵一份進去，否則會悄悄退回圓形。
 * A session with injected outline sprites — the environment has none, so exercising the outline
 * path means feeding one in instead of quietly falling back to circles.
 */
function makeWithOutline(
  levels: LevelDef[],
  polygons: readonly { x: number; y: number }[],
  width = 500,
  settings: Partial<GameSettings> = {},
): GameSession {
  const silhouettes = new Map<number, { x: number; y: number }[] | null>();
  for (const lvl of levels) silhouettes.set(lvl.id, [...polygons]);

  return new GameSession({
    config: {
      ...CONFIG,
      levels: { ...CONFIG.levels, settings: { ...CONFIG.levels.settings, ...settings }, levels },
    },
    rng: createRng(20261004),
    virtualWidth: width,
    silhouettes,
  });
}

/** 最小的解鎖閘門；`unlocked` 是活的集合，解鎖後內容會變。
 * A minimal unlock gate whose `unlocked` set is live and changes as levels unlock. */
function makeGate(initial: readonly number[]): UnlockSource {
  const ids = new Set<number>(initial);

  return {
    get unlocked(): ReadonlySet<number> {
      return ids;
    },
    has: (id: number): boolean => ids.has(id),
    unlock: (id: number): boolean => {
      if (ids.has(id)) return false;
      ids.add(id);
      return true;
    },
  };
}

function runFrames(session: GameSession, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) session.step(1000 / 60);
}

function dropAndSettle(session: GameSession, aimX: number, frames = 90): void {
  session.setAim(aimX);
  session.drop();
  runFrames(session, frames);
}

describe('GameSession — 幾何與空腔 / geometry and cavity', () => {
  it('insets the cavity inside the container frame', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;
    const expected = computeContainerBounds(frame, WALL_THICKNESS).cavity;

    expect(session.playArea).toEqual(expected);
    expect(session.playArea.x).toBe(frame.x + WALL_THICKNESS);
    expect(session.playArea.y).toBe(frame.y);
  });

  it('reserves the headroom above the frame for the drop', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;

    expect(frame.y).toBe(CONFIG.container.topOffset);
    expect(session.spawnYValue).toBe(frame.y - CONFIG.container.dropAboveRim);
    expect(session.spawnYValue).toBeLessThan(frame.y);
  });

  it('puts the overflow line between the drop point and the rim', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;

    expect(session.overflowLineY).toBe(frame.y - CONFIG.container.overflowAboveRim);
    expect(session.overflowLineY).toBeLessThan(frame.y);
    expect(session.spawnYValue).toBeLessThan(session.overflowLineY);
  });

  it('recomputes geometry and cavity on resize', () => {
    const session = makeSession(500);

    session.resize(900, 1000);

    expect(session.containerGeometry.frame.width).toBe(900);
    expect(session.playArea.width).toBe(900 - WALL_THICKNESS * 2);
  });

  it('ignores a degenerate resize so a hidden canvas cannot wipe the arena', () => {
    const session = makeSession(500);
    const before = session.containerGeometry.frame.width;

    session.resize(0, 0);

    expect(session.containerGeometry.frame.width).toBe(before);
  });
});

describe('GameSession — 瞄準夾制 / aim clamping', () => {
  it('centres the aim by default', () => {
    const session = makeSession();
    const cavity = session.playArea;

    expect(session.aimXValue).toBe(cavity.x + cavity.width / 2);
  });

  it('clamps an aim beyond the right edge so the dumpling keeps the spawn padding', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;
    const radius = session.pendingLevel().radius;

    session.setAim(frame.x + frame.width + 500);

    expect(session.aimXValue).toBe(frame.x + frame.width - CONFIG.container.spawnGap - radius);
  });

  it('clamps an aim beyond the left edge so the dumpling keeps the spawn padding', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;
    const radius = session.pendingLevel().radius;

    session.setAim(frame.x - 500);

    expect(session.aimXValue).toBe(frame.x + CONFIG.container.spawnGap + radius);
  });
});

describe('GameSession — 投放 / dropping', () => {
  it('spawns the dumpling at the aim position and drop height', () => {
    const session = makeSession();

    session.setAim(200);
    session.drop();

    const [body] = session.bodies;
    expect(body?.x).toBeCloseTo(200, 6);
    expect(body?.y).toBe(session.spawnYValue);
  });

  it('uses the radius of the level it spawned', () => {
    const session = makeSession();

    session.drop();

    const expected = session.bodies[0]?.levelId;
    const def = CONFIG.levels.levels.find((entry) => entry.id === expected);

    expect(session.bodies[0]?.radius).toBe(def?.radius);
  });

  it('drops with zero velocity so gravity alone decides the fall', () => {
    const session = makeSession();

    session.drop();

    expect(session.bodies[0]?.y).toBe(session.spawnYValue);
  });

  it('accumulates one body per drop once the cooldown has elapsed', () => {
    /*
     * 用不會合成的等級表：合成會把兩顆併成一顆，顆數永遠對不上。
     * A non-merging level table: merges would fuse pairs and the count could never add up.
     */
    const session = makeCustom(NO_MERGE);

    for (const x of [120, 250, 380]) {
      session.setAim(x);
      expect(session.canDrop).toBe(true);
      expect(session.drop()).toBe(true);
      runFrames(session, 90);
    }

    expect(session.bodies).toHaveLength(3);
    expect(session.dropCount).toBe(3);
  });

  it('never spawns the level marked not droppable', () => {
    const session = makeCustom(NO_MERGE.concat(level(4, 28.3, 0, false)));

    for (let index = 0; index < 60; index += 1) {
      /* 每次換位置，避免同級方團團疊在一起。
       * Vary the X so same-level dumplings do not stack. */
      session.setAim(80 + (index % 7) * 60);
      if (session.canDrop) session.drop();
      runFrames(session, 30);
    }

    const spawned = session.bodies.map((body) => body.levelId);
    expect(spawned).not.toContain(4);
  });

  it('allows the opening drop immediately', () => {
    const session = makeSession();

    expect(session.canDrop).toBe(true);
    expect(session.drop()).toBe(true);
  });

  it('ignores a second drop inside the cooldown', () => {
    const session = makeSession(500, { dropCooldownMs: 1000 });

    expect(session.drop()).toBe(true);

    runFrames(session, 30);
    expect(session.canDrop).toBe(false);
    expect(session.drop()).toBe(false);
    expect(session.bodies).toHaveLength(1);

    /*
     * 佇列沒被推進：這一顆仍是預覽的那一顆。
     * The queue did not advance — this is still the previewed dumpling.
     */
    expect(session.pendingLevelId).toBe(session.upcomingLevelId);
  });

  it('accepts the next drop once the cooldown elapses', () => {
    const session = makeSession(500, { dropCooldownMs: 500 });

    session.drop();
    /*
     * 約 517ms，已過 500ms 冷卻。
     * ≈517 ms, past the 500 ms cooldown.
     */
    runFrames(session, 31);
    expect(session.canDrop).toBe(true);

    expect(session.drop()).toBe(true);
    expect(session.bodies).toHaveLength(2);
  });

  it('reports the remaining cooldown and counts it down', () => {
    const session = makeSession(500, { dropCooldownMs: 1000 });

    session.drop();
    const atDrop = session.dropCooldownRemainingMs;
    runFrames(session, 30);

    expect(atDrop).toBeGreaterThan(900);
    expect(session.dropCooldownRemainingMs).toBeLessThan(atDrop);
    expect(session.dropCooldownRemainingMs).toBeGreaterThanOrEqual(0);
  });

  it('treats a zero cooldown as no gate at all', () => {
    const session = makeSession(500, { dropCooldownMs: 0 });

    expect(session.drop()).toBe(true);
    expect(session.drop()).toBe(true);

    expect(session.bodies).toHaveLength(2);
  });

  it('resets the cooldown on a new run', () => {
    const session = makeSession(500, { dropCooldownMs: 5000 });

    session.drop();
    expect(session.canDrop).toBe(false);

    session.reset();
    expect(session.canDrop).toBe(true);
  });

  it('reports no cooldown once the run is over', () => {
    const session = makeSession(500, {
      overflowGraceMs: 0,
      dropCooldownMs: 0,
    });

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    if (session.isOver) {
      expect(session.canDrop).toBe(false);
      expect(session.dropCooldownRemainingMs).toBe(0);
      expect(session.drop()).toBe(false);
    }
  });
});

describe('GameSession — D22 在整合層 / D22 at the integration level', () => {
  it('drops exactly the level that was pending', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      const inHand = session.pendingLevelId;
      session.drop();

      /* `bodies` 依「已存在」順序排列，最新一顆在最後。
       * `bodies` is in creation order, so the newest is last. */
      expect(session.bodies.at(-1)?.levelId).toBe(inHand);
    }
  });

  it('promotes the NEXT card’s dumpling to pending once the drop happens', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      const cardShown = session.upcomingLevelId;
      session.drop();

      expect(session.pendingLevelId).toBe(cardShown);
    }
  });

  it('drives the aim preview from the pending level, not the NEXT card', () => {
    const session = makeSession(500, { dropCooldownMs: 0 });

    for (let index = 0; index < 20; index += 1) {
      expect(session.aimPreview?.levelId).toBe(session.pendingLevelId);
      session.drop();
    }
  });

  it('withholds the aim preview until the drop cooldown elapses', () => {
    const session = makeSession(500, { dropCooldownMs: 500 });

    expect(session.aimPreview).not.toBeNull();

    session.drop();

    expect(session.canDrop).toBe(false);
    expect(session.aimPreview).toBeNull();

    /*
     * 約 250ms，冷卻未過。
     * ≈250 ms, still within the cooldown.
     */
    runFrames(session, 15);
    expect(session.aimPreview).toBeNull();

    /*
     * 合計約 583ms，已過 500ms 冷卻。
     * ≈583 ms cumulative, past the 500 ms cooldown.
     */
    runFrames(session, 20);
    expect(session.canDrop).toBe(true);
    expect(session.aimPreview?.levelId).toBe(session.pendingLevelId);
  });

  it('drops the aim preview once the run is over', () => {
    const session = new GameSession({
      config: {
        ...CONFIG,
        levels: {
          ...CONFIG.levels,
          /* 永不合成（證據不被吃掉）；`overflowGraceMs: 0` 一越線即結束。
           * Never merges (evidence survives); `overflowGraceMs: 0` ends the run on crossing. */
          levels: NO_MERGE,
          settings: { ...CONFIG.levels.settings, overflowGraceMs: 0, dropCooldownMs: 0 },
        },
        container: { ...CONFIG.container, topOffset: 980, overflowAboveRim: 0 },
      },
      rng: createRng(20261004),
      virtualWidth: 500,
    });

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    expect(session.isOver).toBe(true);
    expect(session.aimPreview).toBeNull();
  });

  it('keeps both lookahead slots populated after every drop', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      expect(session.pendingLevelId).toBeTypeOf('number');
      expect(session.upcomingLevelId).toBeTypeOf('number');
      expect(session.upcomingLevel().id).toBe(session.upcomingLevelId);
      session.drop();
    }
  });
});

describe('GameSession — 物理推進 / stepping', () => {
  it('makes a dropped dumpling fall under gravity', () => {
    const session = makeSession();
    session.drop();

    const startY = session.bodies[0]?.y ?? 0;

    for (let frame = 0; frame < 10; frame += 1) {
      session.step(1000 / 60);
    }

    expect(session.bodies[0]?.y ?? 0).toBeGreaterThan(startY);
  });

  it('keeps the dumpling inside the cavity instead of leaking through the walls', () => {
    const session = makeSession();

    session.setAim(-9999);
    session.drop();
    session.setAim(9999);
    session.drop();

    for (let frame = 0; frame < 600; frame += 1) {
      session.step(1000 / 60);
    }

    const cavity = session.playArea;
    for (const body of session.bodies) {
      expect(body.x).toBeGreaterThanOrEqual(cavity.x - 1);
      expect(body.x).toBeLessThanOrEqual(cavity.x + cavity.width + 1);
    }
  });

  it('settles both dumplings down onto the floor', () => {
    const session = makeSession();
    session.drop();
    session.drop();

    for (let frame = 0; frame < 900; frame += 1) {
      session.step(1000 / 60);
    }

    const floor = session.containerGeometry.frame.y + session.containerGeometry.frame.height;
    for (const body of session.bodies) {
      expect(body.y).toBeLessThan(floor);
      expect(body.y).toBeGreaterThan(floor - body.radius * 3);
    }
  });
});

describe('GameSession — 旋轉交由物理 / rotation follows the engine', () => {
  it('lets a busy pile-up tumble the dumplings', () => {
    const session = makeSession();

    for (const x of [200, 260, 220, 240, 280, 210]) {
      session.setAim(x);
      if (session.canDrop) session.drop();
      for (let frame = 0; frame < 90; frame += 1) session.step(1000 / 60);
    }
    for (let frame = 0; frame < 600; frame += 1) session.step(1000 / 60);

    expect(session.bodies.some((body) => Math.abs(body.angle) > 0.01)).toBe(true);
  });

  it('keeps every dumpling upright when lockRotation is on', () => {
    const session = makeSession(500, { lockRotation: true });

    for (const x of [200, 260, 220, 240, 280, 210]) {
      session.setAim(x);
      session.drop();
      for (let frame = 0; frame < 20; frame += 1) session.step(1000 / 60);
    }
    for (let frame = 0; frame < 600; frame += 1) session.step(1000 / 60);

    for (const body of session.bodies) {
      expect(body.angle).toBe(0);
    }
  });
});

describe('GameSession — 合成與計分 / merging and scoring', () => {
  it('merges two same-level dumplings into the next level and scores it', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);
    /* Lv2 分數 4（=id×2）再乘連擊倍率，故至少 4。
     * Lv2 scores 4 (id×2) times the combo multiplier, so at least 4. */
    expect(session.score).toBeGreaterThanOrEqual(4);
  });

  it('leaves a lone drop unmerged and unscored', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250, 240);

    expect(session.bodies.map((body) => body.levelId)).toEqual([1]);
    expect(session.mergedCount).toBe(0);
    expect(session.score).toBe(0);
  });

  it('honours the merge cooldown so a fresh body never merges instantly', () => {
    /* 冷卻遠大於一局長度 → 永不合成。
     * Cooldown far exceeds a run, so nothing ever merges. */
    const session = makeCustom(SOLO_LV1, { mergeCooldownMs: 1_000_000 });

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });

  it('pops the merged dumpling and settles it back to its normal size', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    session.setAim(250);
    session.drop();

    let merged = false;
    for (let frame = 0; frame < 300 && !merged; frame += 1) {
      session.step(1000 / 60);
      merged = session.mergedCount > 0;
    }

    expect(merged).toBe(true);
    const popped = session.bodies[0];
    expect(popped?.scale ?? 1).toBeGreaterThan(1);

    /* 彈跳動畫約 180ms，跑完後縮放回到 1。
     * The pop animation lasts ~180 ms, then scale returns to 1. */
    runFrames(session, 60);
    expect(session.bodies[0]?.scale).toBe(1);
  });

  it('builds a combo when merges land inside one drop', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    session.setAim(250);
    session.drop();

    /* 逐幀推進到合成那一刻，才讀得到連擊狀態。
     * Step frame by frame to the merge so the combo state can be read. */
    let merged = false;
    for (let frame = 0; frame < 300 && !merged; frame += 1) {
      session.step(1000 / 60);
      merged = session.mergedCount > 0;
    }

    expect(merged).toBe(true);
    expect(session.comboCount).toBe(1);
    expect(session.comboMultiplier).toBeGreaterThan(1);
    expect(session.dropScore).toBe(session.score);
  });

  it('carries a chain across drops while every drop merges', () => {
    const session = makeCustom(SOLO_LV1, { dropCooldownMs: 0 });

    dropAndSettle(session, 250, 90);
    dropAndSettle(session, 250, 90);

    expect(session.bodies.map((body) => body.levelId)).toEqual([1, 1]);
    expect(session.mergedCount).toBe(0);
    expect(session.comboCount).toBe(0);

    session.drop();
    runFrames(session, 90);

    expect(session.mergedCount).toBe(1);
    expect(session.comboCount).toBe(1);

    session.drop();
    expect(session.comboCount).toBe(1);
    expect(session.dropScore).toBe(0);

    const before = session.mergedCount;
    for (let frame = 0; frame < 400 && session.mergedCount === before; frame += 1) {
      session.step(1000 / 60);
    }

    expect(session.mergedCount).toBe(2);
    expect(session.comboCount).toBe(2);
    expect(session.maxCombo).toBe(2);
    expect(session.comboMultiplier).toBeGreaterThan(comboMultiplier(1));
  });

  it('breaks the chain only when a drop merges nothing at all', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    session.setAim(250);
    session.drop();

    let merged = false;
    for (let frame = 0; frame < 300 && !merged; frame += 1) {
      session.step(1000 / 60);
      merged = session.mergedCount > 0;
    }
    expect(merged).toBe(true);
    const before = session.comboCount;
    expect(before).toBeGreaterThan(0);

    session.setAim(60);
    session.drop();

    const mergesBefore = session.mergedCount;
    runFrames(session, 300);
    expect(session.mergedCount).toBe(mergesBefore);

    session.setAim(60);
    session.drop();
    expect(session.comboCount).toBe(0);
    expect(session.comboMultiplier).toBe(1);
    expect(session.dropScore).toBe(0);

    expect(session.maxCombo).toBe(before);
  });

  it('zeroes the combo peak on reset, not just the current streak', () => {
    const session = makeCustom(SOLO_LV1, { dropCooldownMs: 0 });

    dropAndSettle(session, 250, 90);
    dropAndSettle(session, 250, 90);
    session.drop();
    runFrames(session, 90);
    session.drop();
    const before = session.mergedCount;
    for (let frame = 0; frame < 400 && session.mergedCount === before; frame += 1) {
      session.step(1000 / 60);
    }

    expect(session.maxCombo).toBeGreaterThan(0);

    session.reset();

    expect(session.comboCount).toBe(0);
    expect(session.maxCombo).toBe(0);
  });

  it('accumulates this drop\'s score across its merges', () => {
    const session = makeCustom(SOLO_LV1);
    dropAndSettle(session, 250);

    session.drop();
    runFrames(session, 120);
    session.drop();
    runFrames(session, 120);

    expect(session.mergedCount).toBeGreaterThanOrEqual(1);
    expect(session.comboCount).toBeGreaterThanOrEqual(1);
    expect(session.dropScore).toBeGreaterThan(0);
    expect(session.dropScore).toBeLessThanOrEqual(session.score);
  });
});

describe('GameSession — 近接合成 / proximity merging', () => {
  it('merges two same-level dumplings that come close without touching', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);
  });

  it('does not merge different levels even when they are touching', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);
    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);

    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId).sort()).toEqual([1, 2]);
  });

  it('never pairs a body that a real collision already claimed', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 90);

    session.setAim(60);
    session.drop();
    runFrames(session, 120);

    expect(session.mergedCount).toBeLessThanOrEqual(2);
    expect(session.mergedCount).toBeGreaterThanOrEqual(1);
  });

  it('still honours the merge cooldown for proximity pairs', () => {
    const session = makeNarrow(SOLO_LV1, 120, { mergeCooldownMs: 1_000_000, dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });

  it('leaves far-apart same-level dumplings unmerged', () => {
    const session = makeCustom(SOLO_LV1, { dropCooldownMs: 0 });

    dropAndSettle(session, 80, 90);
    dropAndSettle(session, 420, 120);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });

  it('merges two same-level dumplings whose outlines meet, using the injected outline', () => {
    const squareOutline = [
      { x: -14, y: -14 },
      { x: 14, y: -14 },
      { x: 14, y: 14 },
      { x: -14, y: 14 },
    ];
    const session = makeWithOutline(SOLO_LV1, squareOutline, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);
  });

  it('does not merge outline dumplings that stay clearly apart', () => {
    const squareOutline = [
      { x: -14, y: -14 },
      { x: 14, y: -14 },
      { x: 14, y: 14 },
      { x: -14, y: 14 },
    ];
    const session = makeWithOutline(SOLO_LV1, squareOutline, 500, { dropCooldownMs: 0 });

    dropAndSettle(session, 80, 90);
    dropAndSettle(session, 420, 120);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });
});

describe('GameSession — 合成推力 / merge push', () => {
  it('still merges and never leaves a neighbour buried inside the result', () => {
    const session = makeNarrow(SOLO_LV1, 200, { dropCooldownMs: 0 });

    for (let n = 0; n < 10; n += 1) {
      session.setAim(60 + (n % 3) * 40);
      session.drop();
      runFrames(session, 40);
    }
    runFrames(session, 300);

    const bodies = session.bodies;
    const radii = new Map<number, number>([
      [1, 13.5],
      [2, 17.3],
      [3, 22.1],
    ]);

    let worst = 0;
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const overlap = (radii.get(a.levelId) ?? 0) + (radii.get(b.levelId) ?? 0) - distance;
        if (overlap > worst) worst = overlap;
      }
    }

    /* 門檻 1：容許求解器殘留的極小重疊當作數值誤差。
     * Threshold 1 absorbs the tiny overlap the solver leaves as numeric error. */
    expect(worst).toBeLessThan(1);
  });

  it('displaces a neighbour that the merge result lands on', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    const firstId = session.bodies[0]?.levelId;
    expect(firstId).toBe(1);

    dropAndSettle(session, 60, 120);
    expect(session.mergedCount).toBe(1);

    session.setAim(60);
    session.drop();
    runFrames(session, 5);

    const before = session.bodies.map((body) => ({ x: body.x, y: body.y }));
    runFrames(session, 10);
    const after = session.bodies.map((body) => ({ x: body.x, y: body.y }));

    const moved = before.some((point, index) => {
      const other = after[index];
      if (other === undefined) return false;
      return Math.hypot(point.x - other.x, point.y - other.y) > 0.5;
    });

    expect(moved).toBe(true);
  });
});

describe('GameSession — 合成落點 / merge placement', () => {
  it('carries the inputs’ downward momentum into the merged body', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0, mergeCooldownMs: 0 });

    session.setAim(60);
    session.drop();
    for (let frame = 0; frame < 8; frame += 1) session.step(1000 / 60);
    session.setAim(60);
    session.drop();

    let expectedY: number | null = null;
    let previous: { x: number; y: number }[] = session.bodies.map((body) => ({
      x: body.velocity?.x ?? 0,
      y: body.velocity?.y ?? 0,
    }));

    for (let frame = 0; frame < 400 && expectedY === null; frame += 1) {
      const before = previous;
      session.step(1000 / 60);

      if (session.mergedCount > 0) {
        /* 合成前一幀兩顆速度的平均＝期待值（同級 → 質量相等）。
         * The mean of the two pre-merge velocities is expected (same level → equal masses). */
        if (before.length === 2) {
          expectedY = ((before[0]?.y ?? 0) + (before[1]?.y ?? 0)) / 2;
        }
      } else {
        previous = session.bodies.map((body) => ({
          x: body.velocity?.x ?? 0,
          y: body.velocity?.y ?? 0,
        }));
      }
    }

    expect(session.mergedCount).toBeGreaterThan(0);
    expect(expectedY).not.toBeNull();
    expect(expectedY!).toBeGreaterThan(0);
    expect(session.bodies[0]?.velocity?.y ?? 0).toBeGreaterThan(0);
  });

  it('does not leave a merged body below the floor when the midpoint is near it', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 400);

    expect(session.mergedCount).toBe(1);
    const result = session.bodies[0];
    expect(result).toBeDefined();
    expect(result!.levelId).toBe(2);

    const floor = session.playArea.y + session.playArea.height;
    expect(result!.y).toBeLessThan(floor);
  });

  it('keeps a merged pair from hanging in mid-air', () => {
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    session.setAim(60);
    session.drop();
    runFrames(session, 5);
    session.setAim(60);
    session.drop();
    runFrames(session, 600);

    expect(session.mergedCount).toBe(1);
    const result = session.bodies[0];
    expect(result).toBeDefined();

    const halfHeight = session.playArea.y + session.playArea.height / 2;
    expect(result!.y).toBeGreaterThan(halfHeight);
  });
});

describe('GameSession — 溢位與結束 / overflow and game over', () => {
  /**
   * 溢位測試專用的房間：容器可覆寫，等級表不合成，堆疊才穩定。
   * An overflow-only room with an overridable container and a non-merging table so the pile stays put.
   */
  function makeOverflowRoom(
    container: Partial<ContainerConfig> = {},
    settings: Partial<GameSettings> = {},
    endless = false,
  ): GameSession {
    return new GameSession({
      config: {
        ...CONFIG,
        levels: {
          ...CONFIG.levels,
          levels: NO_MERGE,
          settings: { ...CONFIG.levels.settings, ...settings },
        },
        container: { ...CONFIG.container, ...container },
      },
      rng: createRng(20261004),
      virtualWidth: 500,
      endless,
    });
  }

  it('does not start the countdown for a dumpling that is still in flight', () => {
    /* 投放點在溢位線上方（40 > 30），剛生成的一顆不算越線。
     * The drop point is above the overflow line (40 > 30), so a fresh dumpling does not count. */
    const session = makeOverflowRoom({}, { overflowGraceMs: 0 });

    session.drop();

    for (let frame = 0; frame < 200; frame += 1) {
      session.step(1000 / 60);
      expect(session.isOver).toBe(false);
      expect(session.overflowProgress).toBe(0);
    }

    expect(session.dropCount).toBe(1);
  });

  it('does not count a lone dumpling as overflow, however long it sits', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    session.drop();

    for (let frame = 0; frame < 240; frame += 1) {
      session.step(1000 / 60);
      expect(session.isOver).toBe(false);
    }

    expect(session.dropCount).toBe(1);
  });

  it('ends the run once a dumpling touches the pile and stays over the line', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    expect(session.isOver).toBe(false);
    expect(session.playArea.height).toBeLessThan(60);
    expect(session.overflowLineY).toBe(session.containerGeometry.frame.y);

    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    expect(session.isOver).toBe(false);

    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    expect(session.isOver).toBe(true);
  });

  it('never ends the run in endless mode, however high the pile crosses the line', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 }, true);

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 180);

    expect(session.isOver).toBe(false);
    expect(session.overflowSettled).toBe(false);
    expect(session.overflowDanger).toBe(false);
    expect(session.overflowSecondsLeft).toBe(0);
    expect(session.overflowProgress).toBe(0);
  });

  it('clears a running countdown when endless mode is switched on', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 5000 });

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    expect(session.overflowSettled).toBe(true);
    expect(session.overflowSecondsLeft).toBeGreaterThan(0);

    session.setEndless(true);
    expect(session.overflowSettled).toBe(false);
    expect(session.overflowSecondsLeft).toBe(0);

    session.setEndless(false);
    expect(session.isOver).toBe(false);
  });

  it('exposes the endless flag and ignores a redundant toggle', () => {
    const session = makeOverflowRoom({}, {}, false);

    expect(session.endlessMode).toBe(false);

    session.setEndless(true);
    expect(session.endlessMode).toBe(true);

    session.setEndless(true);
    expect(session.endlessMode).toBe(true);
  });

  it('ignores drops after the run is over', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    const before = session.dropCount;
    session.drop();

    expect(session.isOver).toBe(true);
    expect(session.dropCount).toBe(before);
  });

  it('does not raise the warning while the breaching stack is still moving', () => {
    const session = makeOverflowRoom({}, { overflowGraceMs: 5000 });

    session.drop();

    let sawSettledDuringFall = false;
    for (let frame = 0; frame < 24; frame += 1) {
      session.step(1000 / 60);
      if (session.overflowSettled) sawSettledDuringFall = true;
    }

    expect(sawSettledDuringFall).toBe(false);
    expect(session.overflowDanger).toBe(false);
    expect(session.overflowSecondsLeft).toBe(0);
  });

  it('reports the countdown in whole seconds once the breach settles', () => {
    const session = makeOverflowRoom(
      { topOffset: 980, overflowAboveRim: 0 },
      { overflowGraceMs: 5000 },
    );

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    const seconds = session.overflowSecondsLeft;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(5);

    runFrames(session, 120);
    expect(session.overflowSecondsLeft).toBeLessThan(seconds);
  });

  it('never shows a warning for a shallow container with a single lone dumpling', () => {
    const session = makeOverflowRoom(
      { topOffset: 980, overflowAboveRim: 0 },
      { overflowGraceMs: 5000 },
    );

    session.drop();
    runFrames(session, 240);

    expect(session.overflowSettled).toBe(false);
    expect(session.overflowSecondsLeft).toBe(0);
    expect(session.isOver).toBe(false);
  });

  it('clears the board on reset but keeps the unlocks', () => {
    const gate = makeGate([1]);
    const session = makeCustom(ALL_DROPPABLE, {}, gate);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);
    const unlockedByMerge = gate.has(2);

    session.reset();

    expect(session.bodies).toHaveLength(0);
    expect(session.score).toBe(0);
    expect(session.mergedCount).toBe(0);
    expect(session.isOver).toBe(false);
    expect(unlockedByMerge).toBe(true);
    expect(gate.has(2)).toBe(true);
  });
});

describe('GameSession — 解鎖與生成池 / unlocks and the draw pool', () => {
  it('only draws levels that are unlocked', () => {
    const session = makeCustom(ALL_DROPPABLE_NO_MERGE, {}, makeGate([1]));

    for (let index = 0; index < 30; index += 1) {
      if (session.canDrop) session.drop();
      runFrames(session, 30);
    }

    expect(session.bodies.every((body) => body.levelId === 1)).toBe(true);
  });

  it('unlocks a level the first time it is merged into, then allows it to drop', () => {
    const gate = makeGate([1]);

    /*
     * 等級表不能中途更換，且合成會吃掉場上證據 —— 所以改看生成紀錄而非剛體。
     * The level table cannot be swapped mid-run and merges consume the evidence, so read the draw record instead.
     */
    const session = makeCustom(ALL_DROPPABLE, {}, gate);
    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(gate.has(2)).toBe(true);

    /*
     * 只推到剛跨過投放冷卻（70 幀 ≈ 1167ms），不跑一大段 —— 否則堆積越線會提早結束，
     * `canDrop` 變假後取樣就凍結在同一格。
     * Advance just past the drop cooldown (70 frames ≈ 1167 ms), not further: an overflowing pile
     * would end the run early and freeze the sample on one position.
     */
    const seen = new Set<number>();
    for (let index = 0; index < 80 && !session.isOver; index += 1) {
      seen.add(session.pendingLevelId);
      session.setAim(60 + (index % 6) * 70);
      if (session.canDrop) session.drop();
      runFrames(session, 70);
    }

    expect(seen.has(2)).toBe(true);
  });
});

describe('GameSession — 輪廓碰撞體 / outline colliders', () => {
  /**
   * 明顯凹陷的 U 字輪廓（相對質心），Matter 會把它分解成多個凸塊，即複合剛體。
   * A deliberately concave U, which Matter decomposes into convex pieces, i.e. a compound body.
   */
  const U_POLYGON = [
    { x: -14, y: -14 },
    { x: -4, y: -14 },
    { x: -4, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: -14 },
    { x: 14, y: -14 },
    { x: 14, y: 14 },
    { x: -14, y: 14 },
  ];

  /** 注入輪廓快取的 session；每一級都用同一份凹輪廓。
   * A session with an injected outline cache; every level shares the same concave outline. */
  function makeOutlineSession(levels: LevelDef[], polygons: readonly { x: number; y: number }[]): GameSession {
    const silhouettes = new Map<number, { x: number; y: number }[] | null>();
    for (const lvl of levels) silhouettes.set(lvl.id, [...polygons]);

    return new GameSession({
      config: { ...CONFIG, levels: { ...CONFIG.levels, levels } },
      rng: createRng(20261004),
      virtualWidth: 500,
      silhouettes,
    });
  }

  it('still merges when the collider is a compound (decomposed) body', () => {
    /* 輪廓碰撞體是複合剛體，碰撞事件帶的是子塊，配對必須解到子塊才找得到剛體。
     * An outline collider is a compound body and collision events carry child parts, so pairing must resolve to them. */
    const session = makeOutlineSession(SOLO_LV1, U_POLYGON);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBeGreaterThan(0);
  });

  it('latches the piled flag when outline bodies touch', () => {
    /* 用不合成的等級表，兩顆才留在場上，入堆旗標才讀得到。
     * A non-merging table keeps both bodies on the field so the piled flag can be read. */
    const session = makeOutlineSession([{ ...level(1, 13.5, 70), mergeResult: null }], U_POLYGON);

    dropAndSettle(session, 250);
    dropAndSettle(session, 244, 240);

    const entries = (session as unknown as { entries: { entered: boolean }[] }).entries;
    expect(entries.some((entry) => entry.entered)).toBe(true);
  });

  it('falls back to circles when a level has no outline', () => {
    const session = makeOutlineSession(SOLO_LV1, U_POLYGON);
    const silhouettes = (session as unknown as { silhouettes: Map<number, unknown> }).silhouettes;
    silhouettes.set(1, null);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBeGreaterThan(0);
  });

  it('reports the decomposed convex parts, not the convex hull, for collider outlines', () => {
    /*
     * 父體（`parts[0]`）是凸包，會填滿 U 字凹角；`colliderOutlines` 回傳的是 `parts.slice(1)`，
     * 才是物理真正在碰撞的凸塊。
     * The parent (`parts[0]`) is the convex hull that fills the U's notch; `colliderOutlines`
     * returns `parts.slice(1)`, the convex pieces physics actually uses.
     */
    const session = makeOutlineSession(
      [{ ...level(1, 13.5, 70), mergeResult: null }],
      U_POLYGON,
    );

    dropAndSettle(session, 250, 240);

    const [collider] = session.colliderOutlines;
    expect(collider).toBeDefined();
    expect(collider?.levelId).toBe(1);

    const parts = collider?.parts ?? [];
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      expect(part.length).toBeGreaterThanOrEqual(3);
      for (const vertex of part) {
        expect(Number.isFinite(vertex.x)).toBe(true);
        expect(Number.isFinite(vertex.y)).toBe(true);
      }
    }

    /* 凹角（x∈(−6,−2)、y∈(−2,6)）必須為空：凸包會含進去，分解後的凸塊不會。
     * The notch region must be empty: the hull would include it, the decomposed pieces do not. */
    const notchPoints = parts
      .flat()
      .filter((vertex) => vertex.x > -6 && vertex.x < -2 && vertex.y > -2 && vertex.y < 6);
    expect(notchPoints).toHaveLength(0);
  });

  it('hands out copies so the renderer cannot mutate the physics vertices', () => {
    const session = makeOutlineSession(
      [{ ...level(1, 13.5, 70), mergeResult: null }],
      U_POLYGON,
    );

    dropAndSettle(session, 250, 240);

    const first = session.colliderOutlines[0];
    const snapshot = first?.parts[0]?.[0];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    snapshot.x = -9999;

    expect(session.colliderOutlines[0]?.parts[0]?.[0]?.x).not.toBe(-9999);
  });

  it('falls back to a single part when the collider is a circle', () => {
    const session = makeOutlineSession(
      [{ ...level(1, 13.5, 70), mergeResult: null }],
      U_POLYGON,
    );
    const silhouettes = (session as unknown as { silhouettes: Map<number, unknown> }).silhouettes;
    silhouettes.set(1, null);

    dropAndSettle(session, 250, 240);

    const [collider] = session.colliderOutlines;
    expect(collider?.parts.length).toBe(1);
    expect(collider?.parts[0]?.length).toBeGreaterThanOrEqual(3);
  });
});
