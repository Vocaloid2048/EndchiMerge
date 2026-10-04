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
import { GameSession } from '../src/game/session';
import { computeContainerBounds } from '../src/game/containerBox';
import { WALL_THICKNESS } from '../src/core/constants';
import { createRng } from '../src/core/rng';
import type { AllConfig, LevelDef } from '../src/core/types';

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
      aimY: 90,
      spawnBlockEnabled: false,
      overflowPenalty: false,
      mergeCooldownMs: 100,
    },
    levels: [level(1, 13.5, 70), level(2, 17.3, 25), level(3, 22.1, 5), level(4, 28.3, 0, false)],
  },
  skills: {
    sp: { max: 3, initial: 0, gainPerDrop: 1, overflowAllowed: false },
    skills: [],
  },
  container: {
    cornerRadius: 28,
    strokeWidth: 3,
    strokeColor: '#e8c07a',
    perspectiveDx: 26,
    perspectiveDy: -18,
    frontTint: 'rgba(255, 255, 255, 0.04)',
    backTint: 'rgba(255, 255, 255, 0.02)',
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

/** 固定種子、固定寬度的 session。 */
function makeSession(virtualWidth = 500): GameSession {
  return new GameSession({ config: CONFIG, rng: createRng(20261004), virtualWidth });
}

describe('GameSession — 幾何與空腔 / geometry and cavity', () => {
  it('insets the cavity inside the front face', () => {
    const session = makeSession();
    const front = session.containerGeometry.front;
    const expected = computeContainerBounds(front, WALL_THICKNESS).cavity;

    expect(session.playArea).toEqual(expected);
    expect(session.playArea.x).toBe(front.x + WALL_THICKNESS);
    expect(session.playArea.y).toBe(front.y);
  });

  it('recomputes geometry and cavity on resize', () => {
    const session = makeSession(500);

    session.resize(900, 1000);

    expect(session.containerGeometry.front.width).toBe(900 - 26);
    expect(session.playArea.width).toBe(900 - 26 - WALL_THICKNESS * 2);
  });

  it('ignores a degenerate resize so a hidden canvas cannot wipe the arena', () => {
    const session = makeSession(500);
    const before = session.containerGeometry.front.width;

    session.resize(0, 0);

    expect(session.containerGeometry.front.width).toBe(before);
  });
});

describe('GameSession — 瞄準夾制 / aim clamping', () => {
  it('centres the aim by default', () => {
    const session = makeSession();
    const cavity = session.playArea;

    expect(session.aimXValue).toBe(cavity.x + cavity.width / 2);
  });

  it('clamps an aim beyond the right wall so the dumpling still fits', () => {
    const session = makeSession();
    const cavity = session.playArea;
    const radius = session.pendingLevel().radius;

    session.setAim(cavity.x + cavity.width + 500);

    expect(session.aimXValue).toBe(cavity.x + cavity.width - radius);
  });

  it('clamps an aim beyond the left wall so the dumpling still fits', () => {
    const session = makeSession();
    const cavity = session.playArea;
    const radius = session.pendingLevel().radius;

    session.setAim(cavity.x - 500);

    expect(session.aimXValue).toBe(cavity.x + radius);
  });
});

describe('GameSession — 投放 / dropping', () => {
  it('spawns the dumpling at the aim position and drop height', () => {
    const session = makeSession();

    session.setAim(200);
    session.drop();

    const [body] = session.bodies;
    expect(body?.x).toBeCloseTo(200, 6);
    expect(body?.y).toBe(CONFIG.levels.settings.aimY);
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

    /* 第一顆的 y 應該正好等於 aimY，而不是被初始速度推走。 */
    expect(session.bodies[0]?.y).toBe(CONFIG.levels.settings.aimY);
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

    const floor = session.containerGeometry.front.y + session.containerGeometry.front.height;
    for (const body of session.bodies) {
      /* 落地後圓心應該停在離地板一個半徑的高處附近。 */
      expect(body.y).toBeLessThan(floor);
      expect(body.y).toBeGreaterThan(floor - body.radius * 3);
    }
  });
});

describe('GameSession — sprite 保持直立 / sprites stay upright', () => {
  it('keeps every dumpling at zero angle after a busy pile-up', () => {
    const session = makeSession();

    /* 故意交錯投放，製造大量碰撞與擠壓。 */
    for (const x of [200, 260, 220, 240, 280, 210]) {
      session.setAim(x);
      session.drop();
      for (let frame = 0; frame < 20; frame += 1) session.step(1000 / 60);
    }
    for (let frame = 0; frame < 600; frame += 1) session.step(1000 / 60);

    /* design.md §4.1：方團團「平面、直立，不旋轉或僅小幅旋轉」。
     * 碰撞體是圓、畫面是方，一旦旋轉就會把兩者不一致演給玩家看。 */
    for (const body of session.bodies) {
      expect(body.angle).toBe(0);
    }
  });

  it('does not let the pile-up leave anyone spinning', () => {
    const session = makeSession();

    session.drop();
    session.drop();

    for (let frame = 0; frame < 300; frame += 1) {
      session.step(1000 / 60);
    }

    expect(session.bodies.every((body) => body.angle === 0)).toBe(true);
  });
});

describe('GameSession — 尚未實作的部分 / not yet implemented', () => {
  it('reports zero score until M4 wires merging up', () => {
    const session = makeSession();
    session.drop();

    expect(session.score).toBe(0);
    expect(session.mergedCount).toBe(0);
  });
});
