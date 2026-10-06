/**
 * 技能在**整合層**的物理行為：喚醒休眠、浮動天花板、地震。
 * Skill physics at the **integration** level: waking sleepers, the float ceiling, the earthquake.
 *
 * 為什麼要另外開一個檔案：`tests/skills.test.ts` 用假棋盤證明「技能發了什麼指令」，但完全
 * 碰不到 Matter.js。這三隻 bug 的根因**只在引擎裡**看得到 —— Matter 開了休眠，而
 * `Engine._bodiesApplyGravity` / `Engine._bodiesUpdate` 對休眠剛體直接 `continue`，
 * `Sleeping.afterCollisions` 又只認「被夠快的移動物體撞到」，所以「移除支撐／翻轉重力／
 * 搬動靜態牆」都不會叫醒任何東西。下面每一個測試都先讓堆疊**睡著**，再施放技能，這樣
 * 沒有喚醒的實作一定會失敗。
 * Why a separate file: `tests/skills.test.ts` uses a fake board to prove "which commands a skill
 * issues" but never touches Matter.js. The root cause of these three bugs is **only** visible in
 * the engine: Matter runs with sleeping on, `Engine._bodiesApplyGravity` and
 * `Engine._bodiesUpdate` `continue` on sleeping bodies, and `Sleeping.afterCollisions` only
 * recognises "hit by a body moving fast enough" — so removing a support, flipping gravity or
 * sliding a static wall wakes nothing. Every test below lets the pile **fall asleep** first and
 * then casts, so an implementation without the wake-up fails outright.
 */

import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import { createRng } from '../src/core/rng';
import type { AllConfig, LevelDef, SkillDef } from '../src/core/types';

/** 單一等級、**永不合成**：合成會把堆疊吃掉，讓「移除支撐後上面那顆要落下」變得沒有觀察對象。 */
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

/**
 * 每投放一次技力 +10 —— 測試不必為了湊到 3 點技力而投放 60 次。
 * SP accrues 10 per drop so a test never has to drop 60 times just to afford a 3-cost skill.
 */
const SKILLS: readonly SkillDef[] = [
  { id: 'discard', name: '當棄即棄！', cost: 1, targeting: 'user_pick', pickCount: 1, unlock: { kind: 'sp' }, params: {} },
  {
    id: 'protocol_float',
    name: '協議：浮動',
    cost: 2,
    targeting: 'immediate',
    pickCount: 0,
    unlock: { kind: 'sp' },
    params: { durationMs: 1500, liftFactor: 1.6 },
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

/** 固定種子；窄容器讓兩顆必定疊起來，寬容器讓搖晃有足夠幅度。 */
function makeSession(virtualWidth: number): GameSession {
  return new GameSession({ config: CONFIG, rng: createRng(20261006), virtualWidth });
}

const FRAME_MS = 1000 / 60;

/** 前進若干幀。 */
function runFrames(session: GameSession, frames: number): void {
  for (let i = 0; i < frames; i += 1) session.step(FRAME_MS);
}

/**
 * 讓場上的顆粒**睡著**。Matter 預設要連續 60 幀低於門檻才入眠，所以這裡給足 4 秒。
 * Let the bodies **fall asleep**. Matter needs 60 consecutive quiet frames, so 4 seconds is
 * generous and makes the wake-up the only thing that can move them.
 */
function settleToSleep(session: GameSession): void {
  runFrames(session, 240);
}

/** 投放到 `aimX` 並等它落定（投放冷卻 1 秒，所以至少要走 60 幀）。 */
function dropAndSettle(session: GameSession, aimX: number): void {
  session.setAim(aimX);
  session.drop();
  runFrames(session, 120);
}

describe('當棄即棄！—— 移除支撐後，上面的堆疊必須落下 / discard drops the stack above', () => {
  it('wakes the sleeping stack so it falls onto the floor', () => {
    /*
     * 容器寬 110：空腔 78 剛好**放得下一顆**（直徑 60）但放不下並排的兩顆（需要 120），
     * 所以兩顆必定疊成一座塔。太窄反而會把它們擠出容器口（空腔小於直徑時求解器只能往上推），
     * 那就變成在測別的 bug 了。
     * Width 110: a 78-unit cavity fits **one** dumpling (60 across) but not two side by side
     * (120), so the pair is forced into a tower. Narrower than that and the solver can only push
     * them **up** out of the mouth, which would be testing a different bug entirely.
     */
    const session = makeSession(110);

    dropAndSettle(session, 55);
    dropAndSettle(session, 55);
    settleToSleep(session);

    const before = session.bodies.map((body) => ({ x: body.x, y: body.y, radius: body.radius }));
    expect(before).toHaveLength(2);

    /* 挑**下面**那顆（y 較大）當作被捨棄的支撐。 */
    const lower = before.reduce((a, b) => (a.y > b.y ? a : b));
    const upper = before.reduce((a, b) => (a.y < b.y ? a : b));

    const activated = session.activateSkill('discard');
    expect(activated).toBe(true);
    session.canvasPointerAction(lower.x, lower.y);
    expect(session.bodies).toHaveLength(1);

    runFrames(session, 90);

    const survivor = session.bodies[0];
    expect(survivor).toBeDefined();

    /*
     * 支撐不見了，唯一的一顆必須**落到地面**。落下距離 ＝ 一個直徑（60），門檻取 40 是為了
     * 留一點穿透與滾動的餘裕，同時遠大於「沒有被喚醒」的 0。
     * With the support gone the survivor must **reach the floor**. The fall is one diameter (60);
     * a 40 threshold leaves room for penetration and rolling while staying far above the 0 an
     * implementation without the wake-up produces.
     */
    expect(survivor!.y - upper.y).toBeGreaterThan(40);
  });
});

describe('協議：浮動 —— 每一顆都要浮起 / float lifts every dumpling', () => {
  it('raises a body that had settled and fallen asleep', () => {
    const session = makeSession(500);
    dropAndSettle(session, 250);
    settleToSleep(session);

    const startY = session.bodies[0]!.y;

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 30);

    expect(session.isFloating).toBe(true);
    /*
     * 浮動是「翻重力」，所以睡着的那顆若沒被叫醒就會一動也不動；-20 代表明顯上升。
     * Floating flips gravity, so a sleeping body that is never woken does not move at all; -20
     * means a clearly visible rise.
     */
    expect(session.bodies[0]!.y - startY).toBeLessThan(-20);
  });

  it('stops every body at the invisible ceiling below the rim', () => {
    const session = makeSession(500);
    dropAndSettle(session, 250);
    settleToSleep(session);

    expect(session.activateSkill('protocol_float')).toBe(true);

    /* 跑完整段浮動 ＋ 緩衝，讓堆疊有充分的時間壓在天花板上。 */
    runFrames(session, 120);
    expect(session.isFloating).toBe(false);

    const ceilingY =
      session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    for (const body of session.bodies) {
      /* 只夾上緣（`y - radius`），與溢位判定同一套定義。容忍幾單位的穿透。 */
      expect(body.y - body.radius).toBeGreaterThan(ceilingY - 5);
      /* 天花板一定在溢位線之下，所以浮動永遠不可能觸發溢位。 */
      expect(body.y - body.radius).toBeGreaterThan(session.overflowLineY);
    }
  });

  it('leaves no ceiling behind after a restart', () => {
    const session = makeSession(500);
    dropAndSettle(session, 250);
    settleToSleep(session);

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 30);

    /* 上一局在浮動中結束 —— 那片靜態平面不會被 `removeDynamicBodies()` 帶走。 */
    session.reset();
    dropAndSettle(session, 250);
    runFrames(session, 120);

    const body = session.bodies[0];
    expect(body).toBeDefined();
    /*
     * 若平面留在世界上，這一顆會停在容器頂端附近；沒有平面它才會一路落到地板。
     * 用「明顯低於天花板」當判準，而不是精確的地板座標。
     * A leftover plane would park this body near the top of the container; without it the body
     * reaches the floor. The assertion is "clearly below the ceiling", not an exact floor Y.
     */
    const ceilingY =
      session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;
    expect(body!.y).toBeGreaterThan(ceilingY + 200);
  });
});

describe('搖晃！—— 地震要把睡着的堆疊甩動 / the earthquake actually moves the pile', () => {
  it('moves a body that had settled and fallen asleep', () => {
    const session = makeSession(500);
    dropAndSettle(session, 250);
    settleToSleep(session);

    const startX = session.bodies[0]!.x;

    expect(session.activateSkill('shake')).toBe(true);
    expect(session.isShaking).toBe(true);

    /*
     * 記**最大位移**而不是最終位移：擺動是往復的，一個半週期之後淨位移可能剛好回到原點，
     * 但「有沒有被甩動」看的是過程。
     * Track the **maximum** displacement rather than the final one: the oscillation reverses, so
     * after roughly a cycle the net displacement can land back near the start, while "did it get
     * thrown around" is about the journey.
     */
    let maxShift = 0;
    for (let i = 0; i < 60; i += 1) {
      session.step(FRAME_MS);
      maxShift = Math.max(maxShift, Math.abs(session.bodies[0]!.x - startX));
    }

    expect(maxShift).toBeGreaterThan(5);
  });
});

describe('命運互換 —— 累計消耗的解鎖資訊要傳到卡片 / the gated skill reports its progress', () => {
  it('reports n/m and the cumulative unlock kind', () => {
    const session = makeSession(500);

    const gated = session.skillCards.find((card) => card.id === 'fate_swap');
    expect(gated?.unlockKind).toBe('cumulativeSpent');
    expect(gated?.unlockThreshold).toBe(6);
    expect(gated?.cumulativeSpent).toBe(0);

    /* 用掉 3 點（搖晃）之後累計應該跟着走 —— 徽章顯示的 `n/m` 就是這個數字。 */
    dropAndSettle(session, 250);
    expect(session.activateSkill('shake')).toBe(true);

    const after = session.skillCards.find((card) => card.id === 'fate_swap');
    expect(after?.cumulativeSpent).toBeCloseTo(3, 6);
    expect(after?.unlocked).toBe(false);
  });
});
