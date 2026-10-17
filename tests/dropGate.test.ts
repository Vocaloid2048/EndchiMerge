/**
 * 落點越線的投放禁令：預測這顆會停在警戒線之上就不投，兩個模式都一樣。
 * The landing gate: a drop predicted to come to rest above the warning line is refused in both modes.
 */

import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { createRng } from '../src/core/rng';
import type { AllConfig, LevelDef } from '../src/core/types';

const FRAME_MS = 1000 / 60;

/**
 * 單一等級、不可合成：測試要的是「一直疊上去」，不是「疊完就合掉」。
 * One level, nothing merges: the test wants a pile that grows, not one that collapses as it goes.
 */
function level(): LevelDef {
  return {
    id: 1,
    name: 'Lv1',
    sprite: 'character/lv1.webp',
    radius: 48,
    density: 0.001,
    restitution: 0.15,
    friction: 0.3,
    frictionAir: 0.005,
    score: 1,
    spawnWeight: 10,
    droppable: true,
    mergeResult: null,
  };
}

/**
 * 淺槽：`topOffset` 拉到 600 讓容器只有 400 高，十來顆就填滿 —— 不必為了測一道閘門跑幾百幀。
 * A shallow trough: `topOffset` 600 leaves a 400-tall container, filled by a dozen bodies, so the
 * gate can be tested without simulating hundreds of frames.
 */
function buildConfig(): AllConfig {
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
      levels: [level()],
    },
    skills: {
      sp: { max: 10, initial: 0, gainPerDrop: 0.05, gainPerCombo: 0.05, overflowAllowed: false },
      skills: [],
    },
    container: {
      cornerRadius: 16,
      strokeWidth: 10,
      strokeColor: '#FFFFFF',
      fill: 'rgba(255, 255, 255, 0.20)',
      topOffset: 600,
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
      gameNameZh: '團團大作戰',
      version: '0.0.0',
      notice: 'Unofficial fan project.',
      noticeZh: '非官方同人作品。',
      repoUrl: 'https://example.invalid',
    },
  };
}

/** 畫布 400 ＝ 容器 300 ＋ 兩側各 50 餘裕。 / Canvas 400 = a 300-wide container plus 50 per side. */
const CANVAS = 400;

function runFrames(session: GameSession, frames: number): void {
  for (let i = 0; i < frames; i += 1) session.step(FRAME_MS);
}

/**
 * 一直從同一欄投，直到被拒為止；回傳成功投下的顆數。
 * Keep dropping down one column until the session refuses, returning how many landed.
 */
function fillColumn(session: GameSession, x: number, cap = 40): number {
  let drops = 0;

  while (drops < cap) {
    session.setAim(x);
    if (!session.drop()) break;
    runFrames(session, 40);
    drops += 1;
  }

  return drops;
}

describe('落點越線 / landing gate', () => {
  it('refuses the drop once the column would breach the line', () => {
    const session = new GameSession({
      config: buildConfig(),
      rng: createRng(3),
      virtualWidth: CANVAS,
    });

    const x = CANVAS / 2;
    const drops = fillColumn(session, x);

    /* 真的疊了一段才停，而不是第一顆就被擋。 */
    expect(drops).toBeGreaterThan(1);
    expect(drops).toBeLessThan(40);

    expect(session.canDropAt(x)).toBe(false);
  });

  it('marks the preview instead of hiding it', () => {
    const session = new GameSession({
      config: buildConfig(),
      rng: createRng(5),
      virtualWidth: CANVAS,
    });

    session.setAim(CANVAS / 2);
    expect(session.aimPreview?.blocked).toBe(false);

    fillColumn(session, CANVAS / 2);

    session.setAim(CANVAS / 2);
    /* 預覽仍在（冷卻已過），但標成投不下去。 */
    expect(session.aimPreview).not.toBeNull();
    expect(session.aimPreview?.blocked).toBe(true);
  });

  it('keeps the queue and the drop count untouched when refused', () => {
    const session = new GameSession({
      config: buildConfig(),
      rng: createRng(11),
      virtualWidth: CANVAS,
    });

    fillColumn(session, CANVAS / 2);
    const pending = session.pendingLevelId;
    const count = session.dropCount;
    const total = session.totalDrops;

    session.setAim(CANVAS / 2);
    expect(session.drop()).toBe(false);

    expect(session.pendingLevelId).toBe(pending);
    expect(session.dropCount).toBe(count);
    expect(session.totalDrops).toBe(total);
  });

  it('accepts again once the board is cleared', () => {
    const session = new GameSession({
      config: buildConfig(),
      rng: createRng(13),
      virtualWidth: CANVAS,
    });

    fillColumn(session, CANVAS / 2);
    expect(session.canDropAt(CANVAS / 2)).toBe(false);

    session.reset();
    expect(session.canDropAt(CANVAS / 2)).toBe(true);
  });

  it('applies in endless mode too, and the run never ends', () => {
    const session = new GameSession({
      config: buildConfig(),
      rng: createRng(17),
      virtualWidth: CANVAS,
      endless: true,
    });

    const drops = fillColumn(session, CANVAS / 2);

    /* 同一道禁令：無盡模式不會因為「疊不上去」就放行。 */
    expect(drops).toBeLessThan(40);
    expect(session.canDropAt(CANVAS / 2)).toBe(false);
    expect(session.isOver).toBe(false);
    expect(session.overflowSecondsLeft).toBe(0);
  });
});
