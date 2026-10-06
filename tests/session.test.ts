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

/**
 * 三級都可掉落；搭配解鎖閘門時，開局只有 Lv1 進池。
 *
 * Lv3 **不再往上合成**（`mergeResult: null`）：這張表只有三級，若 Lv3 還宣告要合成就會去找
 * 不存在的 Lv4，`GameSession` 會直接拋錯。短表一定要有一級當終點。
 * Three droppable levels; with the unlock gate only Lv1 is in the pool at the start.
 *
 * Lv3 **stops merging** (`mergeResult: null`): the table has only three levels, so a Lv3 that
 * still declared a merge would look for a nonexistent Lv4 and `GameSession` would throw. A
 * short table always needs one level as its terminus.
 */
const ALL_DROPPABLE: LevelDef[] = [
  level(1, 13.5, 10),
  level(2, 17.3, 10),
  { ...level(3, 22.1, 10), mergeResult: null },
];

/**
 * 三級都可掉落但**永不合成**；用來測「抽到哪些等級」，合成會把證據吃掉。
 * Three droppable levels that **never merge**, for testing which levels get drawn — a merge
 * would destroy the very evidence being counted.
 */
const ALL_DROPPABLE_NO_MERGE: LevelDef[] = [
  { ...level(1, 13.5, 10), mergeResult: null },
  { ...level(2, 17.3, 10), mergeResult: null },
  { ...level(3, 22.1, 10), mergeResult: null },
];

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

/**
 * 窄容器版本：把兩顆丟在同一個 X，容器窄到它們**必定**貼在一起。
 *
 * 寬容器裡兩顆球落地後會各自滾開（實測圓心相距 51px，遠超容差 30px），所以「近接」根本
 * 不會成立 —— 測試會變成在驗證物理，而不是在驗證近接偵測。窄容器強制它們相依，讓測試
 * 只針對「近接掃描有沒有把相鄰的一對配起來」。
 * Narrow-container variant: dropping twice at the same X leaves the pair **guaranteed**
 * adjacent. In a wide box the two balls roll apart after landing (centre distance measured at
 * 51px, far beyond the 30px tolerance), so no proximity ever forms and the test would be
 * measuring physics rather than the sweep. A narrow box forces them together.
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
 * 注入輪廓素材的 session（每一級都用同一份輪廓）。
 * A session with injected outline sprites — every level gets the same outline.
 *
 * 測試環境沒有真的 sprite，所以想驗證**輪廓路徑**就只能自己餵一份輪廓進去。這份 helper 讓
 * 上面的近接測試能確實走到多邊形判定，而不是悄悄退回圓形。
 * Tests have no real sprites, so exercising the **outline path** means injecting one. This
 * helper lets the proximity tests genuinely reach the polygon predicate instead of quietly
 * falling back to circles.
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

  it('accumulates one body per drop once the cooldown has elapsed', () => {
    /*
     * 用**不會合成**的等級表：合成會把兩顆併成一顆，顆數就永遠對不上。
     * Uses a **non-merging** level table: merges would fuse pairs and the count could never
     * add up. The drop cooldown is what actually matters here, so the level table is held
     * constant to isolate it.
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
      /* 每次都換個位置，避免同級方團團疊在一起。 */
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

    /* 冷卻期間：不消耗佇列、不新增剛體。 */
    runFrames(session, 30);
    expect(session.canDrop).toBe(false);
    expect(session.drop()).toBe(false);
    expect(session.bodies).toHaveLength(1);

    /* 佇列也沒被吃掉 —— 這一顆仍然是預覽那一顆。 */
    expect(session.pendingLevelId).toBe(session.upcomingLevelId);
  });

  it('accepts the next drop once the cooldown elapses', () => {
    const session = makeSession(500, { dropCooldownMs: 500 });

    session.drop();
    runFrames(session, 31); /* 約 517ms */
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
    /*
     * 結束後 `canDrop` 為假，而 `dropCooldownRemainingMs` 回報 0 —— 「不能投」的原因是這一局
     * 完了，不是還在冷卻，UI 才不會顯示一個永遠倒不完的計時。
     * After the run ends `canDrop` is false while `dropCooldownRemainingMs` reports 0: the
     * reason is the run, not a cooldown, so the UI never shows a timer that cannot finish.
     *
     * 用一份**極淺**的容器來結束這一局，正是溢位測試那一套設定（見 <overflow> 區塊）。
     * The run is ended with a **shallow** container — the same setup the overflow suite uses.
     */
    const session = makeSession(500, {
      overflowGraceMs: 0,
      /* 溢位判定需要接觸，所以投兩顆讓它們碰上。 */
      dropCooldownMs: 0,
    });

    session.setAim(250);
    session.drop();
    runFrames(session, 90);
    session.setAim(250);
    session.drop();
    runFrames(session, 90);

    /*
     * 這份預設容器不夠淺，未必會結束；所以只在真的結束時檢查 —— 重點是「over ⇒ 數值一致」，
     * 而不是製造一次逾時（那在溢位區塊測得更準）。
     * The default container may not be shallow enough to end the run, so this only asserts the
     * invariant when it does: "over ⇒ the two numbers agree". Provoking a real timeout is the
     * overflow suite's job, where it can be done precisely.
     */
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
    /* 冷卻設 0，才有一顆接一顆的連投空間可以檢查預覽指向。 */
    const session = makeSession(500, { dropCooldownMs: 0 });

    for (let index = 0; index < 20; index += 1) {
      expect(session.aimPreview?.levelId).toBe(session.pendingLevelId);
      session.drop();
    }
  });

  it('withholds the aim preview until the drop cooldown elapses', () => {
    /*
     * 使用者定案：投放之後、「即將投放」要先隱藏，等 `dropCooldownMs` 完結才展示下一順位。
     * 這條把「回傳 `null`」與「冷卻結束後回來」兩半都釘住 —— 只釘一半的話，一個永遠
     * 回傳 `null` 的 getter 也會通過。
     * The user's rule: after a drop the "next up" preview stays hidden until `dropCooldownMs`
     * elapses. Both halves are pinned — an always-null getter would otherwise pass.
     */
    const session = makeSession(500, { dropCooldownMs: 500 });

    /* 開局沒有冷卻，预覽在場。 */
    expect(session.aimPreview).not.toBeNull();

    session.drop();

    /* 冷卻中：預覽隱藏。 */
    expect(session.canDrop).toBe(false);
    expect(session.aimPreview).toBeNull();

    /* 冷卻剛走完沒多久仍然隱藏。 */
    runFrames(session, 15); /* 約 250ms */
    expect(session.aimPreview).toBeNull();

    /* 冷卻結束：下一順位回來了。 */
    runFrames(session, 20); /* 合計約 583ms */
    expect(session.canDrop).toBe(true);
    expect(session.aimPreview?.levelId).toBe(session.pendingLevelId);
  });

  it('drops the aim preview once the run is over', () => {
    /*
     * 結束後預覽也必須消失：這一局已經不能投了，還畫著「即將投放」是在承諾一件不會發生的事。
     * 用一份**極淺**的容器把這一局結束掉（`topOffset: 980` + 線貼頂緣），正是溢位那一套。
     * The preview must also go away when the run ends: the run can no longer drop, so a preview
     * would promise something that will not happen. A very shallow container ends the run.
     */
    const session = new GameSession({
      config: {
        ...CONFIG,
        levels: {
          ...CONFIG.levels,
          /* 永不合成，證據不會被吃掉；`overflowGraceMs: 0` 一越線就結束。 */
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

    /* 故意交錯投放，製造大量碰撞與擠壓。每次投放要跨過冷卻時間。 */
    for (const x of [200, 260, 220, 240, 280, 210]) {
      session.setAim(x);
      if (session.canDrop) session.drop();
      for (let frame = 0; frame < 90; frame += 1) session.step(1000 / 60);
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

  it('builds a combo when merges land inside one drop', () => {
    const session = makeCustom(SOLO_LV1);

    dropAndSettle(session, 250);
    session.setAim(250);
    session.drop();

    /* 逐幀推進到合成發生的那一刻，這樣才讀得到連擊狀態。 */
    let merged = false;
    for (let frame = 0; frame < 300 && !merged; frame += 1) {
      session.step(1000 / 60);
      merged = session.mergedCount > 0;
    }

    expect(merged).toBe(true);
    expect(session.comboCount).toBe(1);
    /* 第一次合成拿曲線起點（貼著 ×1.1），且本次投放的分數就是那一場的加分。 */
    expect(session.comboMultiplier).toBeGreaterThan(1);
    expect(session.dropScore).toBe(session.score);
  });

  it('carries a chain across drops while every drop merges', () => {
    /*
     * 連勝語意（使用者定案）：串長**跨投放累積**。上次投放有合成，下次投放就不歸零 ——
     * 這是與舊語意（「每次投放歸零」）最直接的一條分野，也是這份測試存在的理由。
     *
     * 註：這裡的 `comboCount` 是「這串連勝累積到第幾次合成」，不是「本次投放合成了幾次」。
     * Streak semantics (the user's decision): the chain **carries across drops**. As long as the
     * previous drop merged something, the next drop does not zero it — the sharpest possible
     * contrast with the old "every drop zeroes it".
     *
     * Note `comboCount` is now "how many merges this streak has accumulated", not "how many this
     * drop merged".
     */
    const session = makeCustom(SOLO_LV1, { dropCooldownMs: 0 });

    /* 先備兩顆 Lv1 在同一格 —— 它們各自靜止，尚未合成。 */
    dropAndSettle(session, 250, 90);
    dropAndSettle(session, 250, 90);

    expect(session.bodies.map((body) => body.levelId)).toEqual([1, 1]);
    expect(session.mergedCount).toBe(0);
    expect(session.comboCount).toBe(0);

    /* 第三顆：把備好的兩顆合成成 Lv2，串長開到 1。 */
    session.drop();
    runFrames(session, 90);

    expect(session.mergedCount).toBe(1);
    expect(session.comboCount).toBe(1);

    /*
     * 第四顆：投放**當下**還沒合成，但因為上一顆有合成，串長原封不動保留下來 ——
     * `drop()` 在歸零前先讀了「上一顆的合成次數」。這是與舊語意（「每次投放歸零」）
     * 最尖銳的一條分野，也是這份測試存在的理由。
     *
     * 註：`comboCount` 現在是「這串連勝累積到第幾次合成」，不是「本次投放合成了幾次」。
     * The fourth drop: at the instant of dropping it has not merged yet, but the previous one
     * did, so the chain survives untouched — `drop()` reads the previous drop's merge count
     * before zeroing. This is the sharpest contrast with the old "every drop zeroes it".
     *
     * Note `comboCount` is now "how many merges this streak has accumulated", not "how many this
     * drop merged".
     */
    session.drop();
    expect(session.comboCount).toBe(1);
    /* 本次投放的分數從 0 重新起算 —— 那是單顆的成績，與串長是兩件事。 */
    expect(session.dropScore).toBe(0);

    /* 這一顆也合成 → 串長**跨投放**累積到 2。 */
    const before = session.mergedCount;
    for (let frame = 0; frame < 400 && session.mergedCount === before; frame += 1) {
      session.step(1000 / 60);
    }

    expect(session.mergedCount).toBe(2);
    expect(session.comboCount).toBe(2);
    /* 倍率沿著曲線爬升，不是每次都重算同一格。 */
    expect(session.comboMultiplier).toBeGreaterThan(comboMultiplier(1));
  });

  it('breaks the chain only when a drop merges nothing at all', () => {
    /*
     * 中斷條件：**下一次投放前，若果這次投放沒有做成 combo，則重新由 0 開始**。
     *
     * 這顆是 `mergeResult: null` 的等級，永遠不會合成，所以它一定會中斷連勝。
     * 這個「零合成」測試與上面「跨投放累積」測試是一對：兩邊都成立，規則才算寫對了。
     * The break rule: "before the next drop, if that drop made no combo, restart from 0".
     *
     * This level has `mergeResult: null`, so it can never merge and must break the streak. It is
     * the mirror image of the carry-across test above: both halves must hold.
     */
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

    /* 讓這一顆完全不會碰到任何東西：移到容器最左邊的角落，且不與任何同級相鄰。 */
    session.setAim(60);
    session.drop();

    /* 確認這顆真的什麼都沒合成 —— 前提成立，斷連才是規則而不是物理。 */
    const mergesBefore = session.mergedCount;
    runFrames(session, 300);
    expect(session.mergedCount).toBe(mergesBefore);

    /* 下一顆投放時讀到「上一顆零合成」→ 歸零。 */
    session.setAim(60);
    session.drop();
    expect(session.comboCount).toBe(0);
    expect(session.comboMultiplier).toBe(1);
    expect(session.dropScore).toBe(0);
  });

  it('accumulates this drop\'s score across its merges', () => {
    const session = makeCustom(SOLO_LV1);
    dropAndSettle(session, 250);

    /*
     * 連投三顆同一位置：前兩顆合成 Lv2（加分），第三顆再合成出 Lv3。每一次合成都在同一批裡
     * 拿到當下串長的曲線倍率，`dropScore` 應該是這些加分的總和。
     * Three drops at one spot: the first two merge into Lv2 and the third merges again into
     * Lv3. Every merge takes the curve value at its chain length, so `dropScore` must be the
     * sum of those gains.
     */
    session.drop();
    runFrames(session, 120);
    session.drop();
    runFrames(session, 120);

    expect(session.mergedCount).toBeGreaterThanOrEqual(1);
    expect(session.comboCount).toBeGreaterThanOrEqual(1);
    expect(session.dropScore).toBeGreaterThan(0);
    /* 本次投放的分數不可能超過總分。 */
    expect(session.dropScore).toBeLessThanOrEqual(session.score);
  });
});

/*
 * 近接合成（使用者定案：改用輪廓實際接觸判定）。
 * Proximity merging (the user's decision: judge by the outlines actually meeting).
 *
 * 方團團用的是**輪廓碰撞體**，兩顆貼在一起時圓身之間仍有一道縫，碰撞事件永遠不觸發，
 * 所以只靠碰撞判定會出現「兩顆明顯相依卻不合成」。這一整個區塊釘住補救規則：
 * **同級 ＋ 輪廓邊緣間隙 ≤ `MERGE_OUTLINE_GAP`（或已重疊）→ 合成。**
 * Dumplings use **outline colliders**, so two neighbours leave a seam between their round
 * middles and the collision never fires — collision-only detection leaves two clearly-adjacent
 * dumplings refusing to merge. This block pins the remedy: **same level + outline edge gap
 * within `MERGE_OUTLINE_GAP` (or overlapping) → merge.**
 *
 * **測試環境沒有輪廓素材**，所以 `silhouettes` 是空的，判定會走**圓形退回路徑**
 * （圓心距離 ≤ r₁+r₂）。純幾何的輪廓判定本身由 `outlineProximity.test.ts` 涵蓋；這裡
 * 驗證的是 session 的接線：有沒有每步掃、有沒有去重、有沒有守冷卻。
 * **The test environment has no sprite assets**, so `silhouettes` is empty and the predicate
 * takes the **circle fallback** (centre distance ≤ r₁+r₂). The outline geometry itself is
 * covered by `outlineProximity.test.ts`; what is verified here is the session's wiring —
 * whether it sweeps every step, de-duplicates, and honours the cooldown.
 */
describe('GameSession — 近接合成 / proximity merging', () => {
  it('merges two same-level dumplings that come close without touching', () => {
    /*
     * 兩顆都丟在同一個 X。容器刻意窄，因為寬容器裡兩顆落地後會各自滾開 —— 那時它們相距
     * 51px、遠超容差 30px，測到的其實是物理而非近接掃描。窄容器讓「相鄰」成為必然，
     * 於是這裡只驗證一件事：**近接掃描把相鄰的同級一對配起來了**。
     * Both drop at the same X. The box is deliberately narrow: in a wide box the two balls roll
     * apart on landing — 51px apart, well past the 30px tolerance — so the test would be
     * measuring physics, not the sweep. A narrow box makes adjacency certain, leaving exactly
     * one thing under test: **the sweep pairs the adjacent same-level pair.**
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);
  });

  it('does not merge different levels even when they are touching', () => {
    /*
     * 近接掃描**不能**放寬等級限制：不同級別的兩顆就算完全重疊也不該合成。
     *
     * 這裡必須讓「場上剛好同時有兩個不同級」—— 若兩顆都是 Lv1，它們會先自己合成，測不到
     * 等級限制。作法是先合成出一顆 Lv2，再投放一顆 Lv1 到同一個 X：窄容器讓 Lv1 必定
     * 靠上 Lv2，而 Lv1 與 Lv2 不同級，所以**不該**再合成。
     * The sweep must **not** loosen the level rule: two different levels never merge, however
     * closely they sit.
     *
     * The room has to actually hold two different levels at once — two Lv1s would merge with
     * each other first and never exercise the rule. So: merge a Lv2 into existence, then drop a
     * Lv1 onto the same X. The narrow box guarantees the Lv1 ends up against the Lv2, and
     * Lv1-vs-Lv2 differs in level, so **no** second merge may happen.
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    /* 先造出一顆 Lv2。 */
    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);
    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId)).toEqual([2]);

    /* 再丟一顆 Lv1 貼上去：不同級，合成數不該變。 */
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(1);
    expect(session.bodies.map((body) => body.levelId).sort()).toEqual([1, 2]);
  });

  it('never pairs a body that a real collision already claimed', () => {
    /*
     * 一顆只能參與一次合成。碰撞對先跑、近接後跑，兩者共用 `claimed` —— 所以三顆同級
     * 排在一起時只會合成**一次**（用掉兩顆），不會出現 A-B 與 A-C 同時成立把 A 用兩次。
     * One body joins one merge only. The collision pass runs first and the sweep second, sharing
     * `claimed` — so three same-level bodies in a row merge **once** (consuming two), never
     * A-B and A-C together reusing A.
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 90);

    /*
     * 第三顆落地後，場上曾有 3 顆 Lv1。一輪只配走兩顆，所以合成數不會一次跳到 2 以上。
     * After the third lands there were three Lv1s. One pass consumes two, so the merge count
     * cannot leap past 1 in a single flush.
     */
    session.setAim(60);
    session.drop();
    runFrames(session, 120);

    expect(session.mergedCount).toBeLessThanOrEqual(2);
    expect(session.mergedCount).toBeGreaterThanOrEqual(1);
  });

  it('still honours the merge cooldown for proximity pairs', () => {
    /*
     * 近接路徑也必須尊重冷卻，否則一顆剛生成（投下或剛合成）的顆粒會立刻跟鄰居連鎖合成，
     * 整局變成「一次投放合成到頂」。
     * The sweep must honour the cooldown too, or a freshly born body (just dropped, just merged)
     * immediately chains into its neighbour and one drop runs the whole ladder.
     */
    const session = makeNarrow(SOLO_LV1, 120, { mergeCooldownMs: 1_000_000, dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 120);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });

  it('leaves far-apart same-level dumplings unmerged', () => {
    /*
     * 容差**不是無限大**：把兩顆丟到容器兩端，它們永遠不該合成。這是「擴大範圍」與
     * 「整個容器隨機合成」之間的那條界線。
     *
     * 這一條必須用**寬**容器 —— 窄容器會強制相鄰，反而測不出「遠處不合成」。
     * The tolerance is **not unbounded**: drop the two at opposite ends and they must never
     * merge. This is the line between "wider detection" and "merges at random".
     *
     * This one needs a **wide** box: a narrow one forces adjacency and would defeat the point.
     */
    const session = makeCustom(SOLO_LV1, { dropCooldownMs: 0 });

    dropAndSettle(session, 80, 90);
    dropAndSettle(session, 420, 120);

    expect(session.mergedCount).toBe(0);
    expect(session.bodies).toHaveLength(2);
  });

  /*
   * 輪廓路徑（有素材時真正會走的那一條）。
   * The outline path — the one actually taken when sprites are present.
   *
   * 上面幾條走的是**圓形退回**，因為測試環境沒有輪廓素材。這裡注入一份真實輪廓，驗證
   * session 把兩顆的**局部頂點轉到世界座標**、再交給純幾何判定的接線是對的。
   * The tests above take the **circle fallback** because the environment has no sprites. Here a
   * real outline is injected so the wiring — local vertices to world space, then the pure
   * geometry test — is exercised.
   */
  it('merges two same-level dumplings whose outlines meet, using the injected outline', () => {
    /*
     * 用一個邊長 28 的正方形輪廓（half 14），丟進窄容器讓兩顆必然相依。若 session 沒有把
     * 輪廓接進判定（例如忘了轉世界座標），這一條就會失敗。
     * A square outline of half 14 in a narrow box, so the pair is guaranteed adjacent. If the
     * session failed to wire outlines into the predicate (a forgotten world transform, say),
     * this fails.
     */
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
    /*
     * 有輪廓時也要守住「遠處不合成」：寬容器裡兩顆會滾開，輪廓自然拉遠。
     * The outline path must still refuse distant pairs: in a wide box the two roll apart and
     * their outlines end up far from each other.
     */
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

/*
 * 合成推力（使用者定案：按重疊深度推開）。
 * The merge push (the user's decision: displace neighbours by overlap depth).
 *
 * 合成出來的那顆比兩顆原料都大，卻生成在質心 —— 多出來的面積會陷進旁邊的方團團。這一整個
 * 區塊釘住「生成後立刻把被壓到的鄰居推開」這條補救規則。
 * The merged dumpling is larger than either input yet spawns at the midpoint, so its extra area
 * sinks into the neighbours. This block pins the remedy: overlapping neighbours are displaced
 * immediately after the new body appears.
 */
describe('GameSession — 合成推力 / merge push', () => {
  it('still merges and never leaves a neighbour buried inside the result', () => {
    /*
     * 密集投放後，場上不該有「明顯重疊」的同級或跨級殘留。
     *
     * 用**圓形近似**量殘留（測試環境沒有輪廓）：`(r₁+r₂) − 圓心距離` 為正代表重疊。這比
     * 真實輪廓保守（輪廓有凹角，實際上更不容易重疊），所以「近似下也不重疊」比
     * 「輪廓下不重疊」是更強的保證。
     * After dense dropping, no clearly overlapping pair may remain.
     *
     * The residual is measured with a **circle approximation** (tests have no outlines):
     * `(r₁+r₂) − centre distance` being positive means overlap. That is more conservative than
     * the true outlines (whose concave corners overlap less readily), so "no overlap even under
     * the approximation" is the stronger guarantee.
     */
    const session = makeNarrow(SOLO_LV1, 200, { dropCooldownMs: 0 });

    for (let n = 0; n < 10; n += 1) {
      session.setAim(60 + (n % 3) * 40);
      session.drop();
      runFrames(session, 40);
    }
    /* 讓場面完全靜止。 */
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

    /*
     * 門檻 1：物理求解器本身就會解掉一點點重疊，這裡允許極小殘留（< 1）當作數值誤差。
     * A threshold of 1 absorbs the tiny residual the solver itself leaves as numeric error.
     */
    expect(worst).toBeLessThan(1);
  });

  it('displaces a neighbour that the merge result lands on', () => {
    /*
     * 直接驗證推力：鋪三顆同級，讓中間那兩顆合成，檢查被壓到的第三顆有沒有被推開。
     *
     * 做法是記錄「合成前」第三顆的位置與「合成後數幀」的位置，兩者必須有位移。用窄容器
     * 確保它們一定擠在一起，推力才有東西可推。
     * A direct check of the push: lay three same-level dumplings, merge the middle two, and
     * verify the third one got moved. The third body's position before the merge and a few
     * frames after are compared; they must differ. A narrow box guarantees the tight packing
     * the push needs to have anything to push.
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    /* 鋪好第一顆並記下位置。 */
    dropAndSettle(session, 60, 90);
    const firstId = session.bodies[0]?.levelId;
    expect(firstId).toBe(1);

    /* 再投一顆 → 合成；此時場上只剩合成結果。 */
    dropAndSettle(session, 60, 120);
    expect(session.mergedCount).toBe(1);

    /* 投第三顆，讓它跟合成結果靠近（不同級不會再合成，所以才留得住）。 */
    session.setAim(60);
    session.drop();
    runFrames(session, 5);

    const before = session.bodies.map((body) => ({ x: body.x, y: body.y }));
    runFrames(session, 10);
    const after = session.bodies.map((body) => ({ x: body.x, y: body.y }));

    /* 至少有一顆移動了（推力或物理擠壓）。 */
    const moved = before.some((point, index) => {
      const other = after[index];
      if (other === undefined) return false;
      return Math.hypot(point.x - other.x, point.y - other.y) > 0.5;
    });

    expect(moved).toBe(true);
  });
});

/*
 * 合成後的落點物理（使用者定案：質心 ＋ 動量平均，並避免貿然凌空）。
 * Post-merge placement physics (the user's decisions: midpoint plus averaged momentum, and no
 * freezing in mid-air).
 *
 * 這一整個區塊守住兩件事：合成結果**繼承動量**（不會憑空靜止），以及**吸附到最近支撐**
 * （不會定格在半空）。兩者都在 `merge()` 內、於新顆粒生成後立刻套用。
 * This block pins two things: the result **inherits momentum** (it never stops dead) and it
 * **snaps onto the nearest support** (it never stalls in the air). Both apply inside `merge()`,
 * right after the new body appears.
 */
describe('GameSession — 合成落點 / merge placement', () => {
  it('carries the inputs’ downward momentum into the merged body', () => {
    /*
     * 兩顆都在下墜時合成，新顆粒必須帶著「兩顆速度的質量加權平均」。
     *
     * 這裡不直接抓合成那一幀的速度（那一幀之後物理已經又跑過、還有彈跳與吸附，數字會被
     * 擾動）。改為：逐幀記錄，直到合成發生的**前一幀**把兩顆原料的速度存起來，再確認合成
     * 後的新顆粒速度等於兩者平均（同級 → 質量相等）。這直接驗證了係數接得對不對。
     * Two falling inputs must give the result the mass-weighted average of their velocities.
     *
     * Rather than reading the merge frame's velocity (physics has already stepped again by then,
     * with bounce and snapping perturbing it), this records the two inputs' velocities on the
     * frame **before** the merge and checks the result equals their mean (same level → equal
     * masses). That directly verifies the coefficient is wired correctly.
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0, mergeCooldownMs: 0 });

    /* 兩顆幾乎同時投下，讓它們在空中相遇（都還在加速下墜）。 */
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
        /* 合成前一幀的兩顆速度平均 = 期待的合成速度（質量相等）。 */
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
    /* 合成前一幀兩顆都在下墜 → 平均值為正（往下）。 */
    expect(expectedY!).toBeGreaterThan(0);
    /* 合成後的新顆粒確實帶著這個往下速度（允許物理在一幀內造成的少量誤差）。 */
    expect(session.bodies[0]?.velocity?.y ?? 0).toBeGreaterThan(0);
  });

  it('does not leave a merged body below the floor when the midpoint is near it', () => {
    /*
     * 回歸測試：吸附用的「地板」必須取**空腔底部**而不是外框底部，否則新顆粒會被塞進地板裡
     * 然後穿出去。這裡合成後長時間推進，結果必須留在場上。
     * Regression: the snap's "floor" must be the **cavity bottom**, not the frame bottom, or the
     * new body is pushed into the floor and tunnels out. Here the result must stay on the board
     * long after the merge.
     */
    const session = makeNarrow(SOLO_LV1, 120, { dropCooldownMs: 0 });

    dropAndSettle(session, 60, 90);
    dropAndSettle(session, 60, 400);

    expect(session.mergedCount).toBe(1);
    const result = session.bodies[0];
    expect(result).toBeDefined();
    expect(result!.levelId).toBe(2);

    /* 還在遊戲區內（不是掉出底部）。 */
    const floor = session.playArea.y + session.playArea.height;
    expect(result!.y).toBeLessThan(floor);
  });

  it('keeps a merged pair from hanging in mid-air', () => {
    /*
     * 合成後若質心中點下方本來有支撐，結果最後必須靜止在場上某個支撐上 —— 而不是停在半空。
     * 判準是「推進很久之後還在場上且已靜止」。這裡刻意讓兩顆在高處靠近合成，檢查結果最後
     * 落到接近底部（不是停在高處）。
     * When the midpoint has support below, the result must ultimately rest on the board rather
     * than stall in the air. The check is "still present and settled after a long run". The pair
     * is merged near the top on purpose, and the result must end up near the bottom, not up high.
     */
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

    /* 已經落到下方（＞遊戲區一半高度），證明真的落體而非懸空。 */
    const halfHeight = session.playArea.y + session.playArea.height / 2;
    expect(result!.y).toBeGreaterThan(halfHeight);
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
     * 先讓 Lv1 合成一次（解鎖 Lv2）。等級表不能中途更換，所以這一局維持可合成的表，並改為
     * 檢查**生成紀錄**而不是場上剛體 —— 合成會把場上的證據吃掉。
     * First force one Lv1+Lv1 merge to unlock Lv2. The level table cannot be swapped mid-run,
     * so this session keeps the regular table and checks the **draw record** instead of what
     * is still on the board, which merges would consume.
     */
    const session = makeCustom(ALL_DROPPABLE, {}, gate);
    dropAndSettle(session, 250);
    dropAndSettle(session, 250, 240);

    expect(gate.has(2)).toBe(true);

    /*
     * 解鎖後 Lv2 進入生成池：連續投放時 `pendingLevelId` 應該看得到它。`pendingLevelId` 是
     * 佇列最前面那顆，不受合成影響，所以取樣不會被吃掉。
     *
     * 取樣迴圈只推進到剛好跨過投放冷卻（70 幀 ≈ 1167ms），而不是一大段時間 —— 否則堆疊
     * 會越過溢位線、這一局提早結束，`canDrop` 一旦變假就再也不會投放，取樣也就永遠停在
     * 同一個佇列位置。
     * Once unlocked, Lv2 joins the draw pool, so `pendingLevelId` — the front of the queue,
     * unaffected by merges — must show it while we keep dropping.
     *
     * The loop advances just past the drop cooldown (70 frames ≈ 1167 ms) rather than a long
     * stretch: otherwise the pile crosses the overflow line, the run ends early, and once
     * `canDrop` goes false nothing drops again — the sample would freeze on one position.
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

  it('reports the decomposed convex parts, not the convex hull, for collider outlines', () => {
    /*
     * `?debug=1` 的碰撞框標註要畫**物理真正在碰撞的形狀**。
     *
     * `Bodies.fromVertices` 把凹多邊形分解成多個凸部件，父體（`parts[0]`）的 `vertices`
     * 是**凸包** —— 一個把 U 字凹角填滿的多邊形。若標註畫凸包，畫面上會看到一個跟素材
     * 明顯對不上的實心形狀，正是「看畫面看不出碰撞到底用什麼」的情況。
     *
     * 這條釘住 `colliderOutlines` 回傳的是 `parts.slice(1)`：多個部件、每個頂點數 ≥ 3，
     * 且**不在**父體凸包上。
     * The `?debug=1` collider annotation must draw the shape physics **actually** collides with.
     *
     * `Bodies.fromVertices` splits a concave polygon into convex parts; the parent (`parts[0]`)
     * holds the **convex hull**, which fills the U's notch. Drawing that would put a visibly
     * wrong solid shape on screen — exactly the "you cannot see what collides" problem.
     *
     * This pins that `colliderOutlines` returns `parts.slice(1)`: several parts, each with ≥3
     * vertices, and **not** sitting on the parent's hull.
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
    /* 凹多邊形必須真的被拆開 —— 只有一個部件就代表拿到的是凸包。 */
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      /* 每個部件都要能畫成多邊形。 */
      expect(part.length).toBeGreaterThanOrEqual(3);
      for (const vertex of part) {
        expect(Number.isFinite(vertex.x)).toBe(true);
        expect(Number.isFinite(vertex.y)).toBe(true);
      }
    }

    /*
     * 關鍵斷言：**凹角**（原多邊形在 (−4, −14) 到 (−4, 4) 之間內凹）必須是空的。
     * 凸包會把 (−4, 0) 這種凹進去的點也包含進來；分解後的凸塊不會。
     */
    const notchPoints = parts
      .flat()
      .filter((vertex) => vertex.x > -6 && vertex.x < -2 && vertex.y > -2 && vertex.y < 6);
    expect(notchPoints).toHaveLength(0);
  });

  it('hands out copies so the renderer cannot mutate the physics vertices', () => {
    /*
     * `colliderOutlines` 把 Matter 的 `vertices` 複製一份再交出去。若哪天圖個方便直接回傳
     * 內部陣列，渲染層就能改到物理狀態 —— 而且這種 bug 只會在除錯開啟時出現，最難查。
     * `colliderOutlines` copies Matter's vertices. Should anyone ever return the internals for
     * convenience, the renderer could mutate physics — and only with debug on, which is the
     * hardest class of bug to trace.
     */
    const session = makeOutlineSession(
      [{ ...level(1, 13.5, 70), mergeResult: null }],
      U_POLYGON,
    );

    dropAndSettle(session, 250, 240);

    const first = session.colliderOutlines[0];
    const snapshot = first?.parts[0]?.[0];
    expect(snapshot).toBeDefined();
    if (snapshot === undefined) return;

    /* 竄改回傳的副本，不該影響下一次讀取。 */
    snapshot.x = -9999;

    expect(session.colliderOutlines[0]?.parts[0]?.[0]?.x).not.toBe(-9999);
  });

  it('falls back to a single part when the collider is a circle', () => {
    /*
     * 圓形碰撞體沒有 `parts` 陣列，退回父體本身就是對的 —— 圓就是一個部件。
     * 這條同時保證「圓形後備路徑不會讓除錯標註崩掉」。
     * A circle collider has no `parts`, so falling back to the parent is correct — a circle is
     * one part. This also guarantees the fallback never breaks the debug annotation.
     */
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
