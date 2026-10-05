/**
 * 單局狀態的單元測試。
 * Unit tests for the play session.
 *
 * 這裡守住 D22 在**整合層**的版本：`pendingLevelId`（馬上要掉的那顆）是什麼，`drop()`
 * 就必須掉什麼；而 `upcomingLevelId`（NEXT 卡顯示的那顆）在這一掉之後必須**遞補**成
 * 新的 `pendingLevelId`。`SpawnQueue` 自己的測試證明了佇列內部一致，這裡證明 session
 * 沒有在串接時把它弄丟。
 * This is D22 at the integration level: whatever `pendingLevelId` (about to drop) is, is
 * what `drop()` must produce; and the `upcomingLevelId` (what the NEXT card shows) must
 * **promote** into the new `pendingLevelId` after that drop. The queue's own tests prove
 * internal consistency; these prove the session does not lose it while wiring things up.
 *
 * 同時釘住瞄準的夾制行為 —— 允許把方團團丟到牆外會在 M4 變成「合成永遠不觸發」的鬼故事。
 * The aim clamp is pinned too: letting a dumpling spawn inside a wall would become a
 * "merges never trigger" ghost story in M4.
 */

import { describe, expect, it } from 'vitest';
import { GameSession, type UnlockSource } from '../src/game/session';
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

/** 迷你但形狀完整的配置。 */
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
      comboWindowMs: 1000,
    },
    levels: [level(1, 13.5, 70), level(2, 17.3, 25), level(3, 22.1, 5), level(4, 28.3, 0, false)],
  },
  skills: {
    sp: { max: 3, initial: 0, gainPerDrop: 1, overflowAllowed: false },
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

/** 固定種子、固定寬度的 session；可覆寫個別 settings 來測不同開關。 */
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

/** 只有 Lv1 可掉落，其餘等級只作為合成目標存在。 */
const SOLO_LV1: LevelDef[] = [level(1, 13.5, 70), level(2, 17.3, 0, false), level(3, 22.1, 0, false)];

/** 三級都可掉落；搭配解鎖閘門時，開局只有 Lv1 進池。 */
const ALL_DROPPABLE: LevelDef[] = [level(1, 13.5, 10), level(2, 17.3, 10), level(3, 22.1, 10)];

/**
 * 單一等級、**永不合成**。用來疊一座純粹的塔：合成會把堆疊吃掉，讓「疊到溢位」測不穩。
 * A single level that never merges, so a plain tower can be stacked — merging would eat the
 * pile and make "stack until it overflows" flaky.
 */
const NO_MERGE: LevelDef[] = [{ ...level(1, 13.5, 70), mergeResult: null }];

/** 自訂等級表 ＋ settings ＋ 解鎖閘門的 session。 */
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

/** 最小的解鎖閘門；`unlocked` 是活的集合，解鎖後內容會變。 */
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

/** 推進固定步數。 */
function runFrames(session: GameSession, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) session.step(1000 / 60);
}

/** 在 `aimX` 投放一顆並讓它落定。 */
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
    /* 投放高度＝頂緣上方一個 dropAboveRim，所以一定小於 frame.y。 */
    expect(session.spawnYValue).toBe(frame.y - CONFIG.container.dropAboveRim);
    expect(session.spawnYValue).toBeLessThan(frame.y);
  });

  it('puts the overflow line between the drop point and the rim', () => {
    const session = makeSession();
    const frame = session.containerGeometry.frame;

    /* 線在頂緣上方；投放點必須比它更高，否則每一顆一出現就越線。 */
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

    /* 第一顆的 y 應該正好等於投放高度，而不是被初始速度推走。 */
    expect(session.bodies[0]?.y).toBe(session.spawnYValue);
  });

  it('accumulates one body per drop', () => {
    const session = makeSession();

    session.drop();
    session.drop();
    session.drop();

    expect(session.bodies).toHaveLength(3);
    expect(session.dropCount).toBe(3);
  });

  it('never spawns the level marked not droppable', () => {
    const session = makeSession();

    for (let index = 0; index < 60; index += 1) {
      session.drop();
    }

    const spawned = session.bodies.map((body) => body.levelId);
    expect(spawned).not.toContain(4);
  });
});

describe('GameSession — D22 在整合層 / D22 at the integration level', () => {
  it('drops exactly the level that was pending', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      const inHand = session.pendingLevelId;
      session.drop();

      /* bodies 是「已存在」的順序，所以最新一顆在最後。 */
      expect(session.bodies.at(-1)?.levelId).toBe(inHand);
    }
  });

  it('promotes the NEXT card’s dumpling to pending once the drop happens', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      /*
       * 玩家現在看到 NEXT 卡上那顆（upcoming），一按下去，掉的是手上的那顆
       * （pending），而卡上那顆就遞補成新的 pending。
       */
      const cardShown = session.upcomingLevelId;
      session.drop();

      expect(session.pendingLevelId).toBe(cardShown);
    }
  });

  it('drives the aim preview from the pending level, not the NEXT card', () => {
    const session = makeSession();

    for (let index = 0; index < 20; index += 1) {
      expect(session.aimPreview.levelId).toBe(session.pendingLevelId);
      session.drop();
    }
  });

  it('keeps both lookahead slots populated after every drop', () => {
    const session = makeSession();

    for (let index = 0; index < 40; index += 1) {
      /* 只能說「兩格都有值」，不能斷言一定不同 —— 權重抽取本來就可能重複。 */
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
      /* 落地後圓心應該停在離地板一個半徑的高處附近。 */
      expect(body.y).toBeLessThan(floor);
      expect(body.y).toBeGreaterThan(floor - body.radius * 3);
    }
  });
});

describe('GameSession — 旋轉交由物理 / rotation follows the engine', () => {
  it('lets a busy pile-up tumble the dumplings', () => {
    const session = makeSession();

    /* 故意交錯投放，製造大量碰撞與擠壓。 */
    for (const x of [200, 260, 220, 240, 280, 210]) {
      session.setAim(x);
      session.drop();
      for (let frame = 0; frame < 20; frame += 1) session.step(1000 / 60);
    }
    for (let frame = 0; frame < 600; frame += 1) session.step(1000 / 60);

    /*
     * `lockRotation: false`（預設）＝ 依真實物理：碰撞力矩會讓方團團轉動。
     * 只要有任意一顆轉過，就證明旋轉沒有被鎖死。
     */
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

    /* 慣量無限大時，任何力矩都推不歪。 */
    for (const body of session.bodies) {
      expect(body.angle).toBe(0);
    }
  });
});

describe('GameSession — 合成與計分 / merging and scoring', () => {
  it('merges two same-level dumplings into the next level and scores it', () => {
    const session = makeCustom(SOLO_LV1);

    /* 先讓第一顆落定，再把第二顆丟在正上方 —— 比同時丟兩顆更確定會碰上。 */
    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);
    /* Lv2 的 score 是 4，乘上第一次連擊的倍率後取整至少 4。 */
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
    /* 冷卻設成遠大於這一局的長度 → 兩顆永遠碰不出合成。 */
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

    /* 動畫（180ms）跑完後縮放回到 1。 */
    runFrames(session, 60);
    expect(session.bodies[0]?.scale).toBe(1);
  });

  it('builds a combo when merges land inside the window', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    session.setAim(250);
    session.drop();

    /* 逐幀推進到合成發生的那一刻，這樣才讀得到「窗口內」的連擊狀態。 */
    let merged = false;
    for (let frame = 0; frame < 300 && !merged; frame += 1) {
      session.step(1000 / 60);
      merged = session.mergedCount > 0;
    }

    expect(merged).toBe(true);
    expect(session.comboCount).toBe(1);
    expect(session.comboMultiplier).toBeGreaterThan(1);

    /* 靜置超過窗口（1 秒）後連擊歸零。 */
    runFrames(session, 90);
    expect(session.comboCount).toBe(0);
    expect(session.comboMultiplier).toBe(1);
  });
});

describe('GameSession — 溢位與結束 / overflow and game over', () => {
  /**
   * 溢位測試專用的房間：可以覆寫容器參數，而且等級表**不會合成**，堆疊才穩定。
   * An overflow-only room: container overridable, and a non-merging level table so the pile
   * stays put.
   */
  function makeOverflowRoom(
    container: Partial<ContainerConfig> = {},
    settings: Partial<GameSettings> = {},
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
    });
  }

  it('does not start the countdown for a dumpling that is still in flight', () => {
    /*
     * 回歸測試：投放點在溢位線**上方**（dropAboveRim 40 > overflowAboveRim 30），所以每顆
     * 剛生成的方團團上緣都在線之上。若把它算進去，`overflowGraceMs: 0` 會在第一幀就結束
     * 這一局 —— 而容器其實還是空的。
     * Regression: the drop point is **above** the overflow line (dropAboveRim 40 >
     * overflowAboveRim 30), so every fresh dumpling starts above it. Counting it would end the
     * run on frame one with `overflowGraceMs: 0` — while the container is still empty.
     */
    const session = makeOverflowRoom({}, { overflowGraceMs: 0 });

    session.drop();

    /* 整段下墜都要維持「沒越線」；落地後停在線下，也不該越線。 */
    for (let frame = 0; frame < 200; frame += 1) {
      session.step(1000 / 60);
      expect(session.isOver).toBe(false);
      expect(session.overflowProgress).toBe(0);
    }

    expect(session.dropCount).toBe(1);
  });

  it('does not count a lone dumpling as overflow, however long it sits', () => {
    /*
     * 使用者定案的核心（本次改動的重點）：「從頂部跌下的不應該觸發警戒，直至觸碰到其他方團團」。
     * 一顆孤零零的方團團落在空槽底，永遠碰不到別的顆粒，所以就算計時器為 0 也**不該**結束
     * 這一局。容器刻意做得極淺（`topOffset` 很大），讓「上緣越線」這個幾何條件成立 —— 若判定
     * 還依賴幾何，這一顆立刻就會被判出局；只有「必須接觸」才能讓它安然無事。
     * The core of the user's rule (the point of this change): a falling dumpling must not raise
     * the warning until it touches another dumpling. A lone dumpling resting on an empty floor
     * never touches anything, so even with a zero grace timer the run must **not** end. The
     * container is deliberately made very shallow (a large `topOffset`) so the geometric
     * "top edge crosses the line" condition is already satisfied — if the test still leaned on
     * geometry this dumpling would end the run at once; only "must touch" keeps it alive.
     */
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    /* 濫用第一顆：整個下墜與靜置全程都不該出局。 */
    session.drop();

    for (let frame = 0; frame < 240; frame += 1) {
      session.step(1000 / 60);
      expect(session.isOver).toBe(false);
    }

    expect(session.dropCount).toBe(1);
  });

  it('ends the run once a dumpling touches the pile and stays over the line', () => {
    /*
     * 對照組：同樣的極淺容器，第二顆落到第一顆身上**發生接觸**，兩者立刻入堆；因為堆疊已越線
     * 而計時器為 0，這一局隨即結束。
     * The counterpart: in the same shallow container, the second dumpling lands **on** the first
     * and they touch, so both become piled; the stack is already over the line and the timer is
     * zero, so the run ends immediately.
     */
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    expect(session.isOver).toBe(false);
    /* 前設：容器真的極淺，且線就貼在頂緣上。 */
    expect(session.playArea.height).toBeLessThan(60);
    expect(session.overflowLineY).toBe(session.containerGeometry.frame.y);

    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    /* 第一顆單獨存在時還安全。 */
    expect(session.isOver).toBe(false);

    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    expect(session.isOver).toBe(true);
  });

  it('ignores drops after the run is over', () => {
    const session = makeOverflowRoom({ topOffset: 980, overflowAboveRim: 0 }, { overflowGraceMs: 0 });

    /* 先讓兩顆接觸入堆，才會進入結束判定。 */
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
    /*
     * 「停定後才提示」的整合層證明：一顆方團團從上方掉下來、掠過紅線時，`overflowSettled`
     * 必須維持為假 —— 畫面上的線、警戒區與倒數都靠它決定要不要出現。
     * End-to-end proof of "settle before warning": while a dumpling falls through the line,
     * `overflowSettled` must stay false — the line, the zone and the countdown all key off it.
     */
    const session = makeOverflowRoom({}, { overflowGraceMs: 5000 });

    session.drop();

    /* 下墜途中：任何一幀都不該已停定。 */
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
    /*
     * 極淺容器 + 兩顆接觸 → 入堆且越線。放著不動之後倒數應該起算，且秒數由 5 遞減。
     * A shallow container plus two touching dumplings gives a settled breach, so the countdown
     * starts and the whole seconds tick down from 5.
     */
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

    /* 再放一段時間，秒數必須單調下降。 */
    runFrames(session, 120);
    expect(session.overflowSecondsLeft).toBeLessThan(seconds);
  });

  it('never shows a warning for a shallow container with a single lone dumpling', () => {
    /*
     * 對照：同樣極淺，但只有一顆（永不接觸）→ 連停定都不會成立，倒數永遠是 0。
     * Control: same shallow container with a single, never-touching dumpling, so it never even
     * settles and the countdown stays at zero forever.
     */
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
    /* 解鎖屬 meta-progression，不隨新局重設（D5）。 */
    expect(unlockedByMerge).toBe(true);
    expect(gate.has(2)).toBe(true);
  });
});

describe('GameSession — 解鎖與生成池 / unlocks and the draw pool', () => {
  it('only draws levels that are unlocked', () => {
    const session = makeCustom(ALL_DROPPABLE, {}, makeGate([1]));

    for (let index = 0; index < 30; index += 1) session.drop();

    expect(session.bodies.every((body) => body.levelId === 1)).toBe(true);
  });

  it('unlocks a level the first time it is merged into, then allows it to drop', () => {
    const gate = makeGate([1]);
    const session = makeCustom(ALL_DROPPABLE, {}, gate);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(gate.has(2)).toBe(true);

    /* 解鎖後 Lv2 進入生成池：連丟一段時間應該看得到它。 */
    const seen = new Set<number>();
    for (let index = 0; index < 80; index += 1) {
      session.drop();
      seen.add(session.bodies.at(-1)?.levelId ?? 0);
    }

    expect(seen.has(2)).toBe(true);
  });
});

describe('GameSession — 輪廓碰撞體 / outline colliders', () => {
  /**
   * 一個明顯凹的輪廓（U 字，相對質心），保證 Matter 會把它分解成多個凸塊 —— 也就是變成
   * **複合剛體**。這是本測試要壓的東西。
   * A deliberately concave outline (a U, relative to the centre) so Matter decomposes it into
   * multiple convex pieces, i.e. a **compound body**. That is what this block pins down.
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

  /** 注入輪廓快取的 session；每一級都用同一份凹輪廓。 */
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
    /*
     * 回歸測試：輪廓碰撞體是**複合剛體**，碰撞事件帶的是子塊（子塊有各自的 `id`）。若
     * `collectMerges` 直接以 `pair.bodyA.id` 查 `byBodyId`，所有配對都會 miss —— 合成與入堆
     * 會**靜默全數失效**，沒有任何錯誤訊息，畫面只是「怎麼都不會合」。
     * Regression: an outline collider is a **compound body**, so collision events carry child
     * parts with their own ids. Looking up `pair.bodyA.id` directly would miss every pair —
     * merging and piling would silently stop working with no error, just "nothing ever merges".
     */
    const session = makeOutlineSession(SOLO_LV1, U_POLYGON);

    /* 兩顆丟在同一柱，必然接觸 → 合成。 */
    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(session.mergedCount).toBeGreaterThan(0);
  });

  it('latches the piled flag when outline bodies touch', () => {
    /*
     * 同一件事的另一半：入堆（溢位警戒的前提）也必須靠 `resolveEntry()` 才看得見子塊。
     * 用**不會合成**的等級表，兩顆才會留在場上，旗標也才讀得到。
     * The other half of the same thing: piling (the premise of the overflow warning) also
     * depends on `resolveEntry()` to see child parts. A **non-merging** level table keeps both
     * bodies on the field so the flag can be read.
     */
    const session = makeOutlineSession([{ ...level(1, 13.5, 70), mergeResult: null }], U_POLYGON);

    dropAndSettle(session, 250);
    dropAndSettle(session, 244, 240);

    const entries = (session as unknown as { entries: { entered: boolean }[] }).entries;
    expect(entries.some((entry) => entry.entered)).toBe(true);
  });

  it('falls back to circles when a level has no outline', () => {
    /* 沒有輪廓的等級（例如素材缺失）必須能玩，只是退回圓形碰撞體。 */
    const session = makeOutlineSession(SOLO_LV1, U_POLYGON);
    const silhouettes = (session as unknown as { silhouettes: Map<number, unknown> }).silhouettes;
    silhouettes.set(1, null);

    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    /* 仍然合成得起來，證明退回路徑沒有把遊戲弄壞。 */
    expect(session.mergedCount).toBeGreaterThan(0);
  });
});
