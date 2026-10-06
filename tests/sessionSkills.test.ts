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
 * 固定種子；窄容器讓兩顆必定疊起來，寬容器讓搖晃有足夠幅度。
 * Fixed seed; a narrow container forces the pair into a tower and a wide one gives the shake room.
 *
 * 傳進來的是**畫布**寬度，容器本身還要再扣掉兩側各 50 的展示餘裕（`CONFIG.container`）——
 * 所以「容器寬 110」的測試要傳 210。餘裕是搖晃的活動空間，也正是這次要驗的東西之一，
 * 所以這裡不放 0（放 0 會把搖晃幅度夾成 0）。
 * The argument is the **canvas** width; the container itself gives up 50 per side of display
 * margin (`CONFIG.container`), so a test that wants a 110-wide container passes 210. The margin
 * is the shake's room and is part of what is under test, so it is not zeroed — zero would clamp
 * the shake amplitude to nothing.
 */
function makeSession(virtualWidth: number): GameSession {
  return new GameSession({ config: CONFIG, rng: createRng(20261006), virtualWidth });
}

/**
 * 與 `makeSession` 相同，但把所有等級的 `mergeResult` 設成 `null`，讓場上無論怎麼疊都不會
 * 合成 —— 這樣才能堆出「一整堆」去驗「每一顆都升上去」，而不是被合成吃掉。
 * Same as `makeSession` but every level's `mergeResult` is `null`, so bodies never merge no
 * matter how they pile — only then can we build a whole pile to check "every one rises" instead
 * of watching the pile get eaten by merges.
 */
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
     * 畫布 210 ＝ 容器 110 ＋ 兩側各 50 的展示餘裕。空腔 78 剛好**放得下一顆**（直徑 60）但
     * 放不下並排的兩顆（需要 120），所以兩顆必定疊成一座塔。太窄反而會把它們擠出容器口
     * （空腔小於直徑時求解器只能往上推），那就變成在測別的 bug 了。
     * Canvas 210 = a 110-wide container plus 50 of display margin per side. A 78-unit cavity
     * fits **one** dumpling (60 across) but not two side by side (120), so the pair is forced
     * into a tower. Narrower than that and the solver can only push them **up** out of the
     * mouth, which would be testing a different bug entirely.
     */
    const session = makeSession(210);

    dropAndSettle(session, 105);
    dropAndSettle(session, 105);
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
    const session = makeSession(600);
    dropAndSettle(session, 300);
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
    const session = makeSession(600);
    dropAndSettle(session, 300);
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
    const session = makeSession(600);
    dropAndSettle(session, 300);
    settleToSleep(session);

    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 30);

    /* 上一局在浮動中結束 —— 那片靜態平面不會被 `removeDynamicBodies()` 帶走。 */
    session.reset();
    dropAndSettle(session, 300);
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

  it('leaves no body stuck at the floor when a whole pile floats', () => {
    const session = makeNonMergingSession(600);

    /* 散布投放七顆，堆出一座不會合成的實體堆疊。 */
    for (const aimX of [150, 300, 450, 220, 380, 100, 500]) dropAndSettle(session, aimX);
    settleToSleep(session);

    const count = session.bodies.length;
    expect(count).toBeGreaterThan(4);

    expect(session.activateSkill('protocol_float')).toBe(true);
    /* 浮動還在作用（1.5 秒＝ 90 幀）時取樣，避免結束後重力翻回、堆疊落回的階段干擾。 */
    runFrames(session, 85);
    expect(session.isFloating).toBe(true);

    const frame = session.containerGeometry.frame;
    const floorLeeway = frame.height * 0.3;

    for (const body of session.bodies) {
      /*
       * 每一顆都必須已經離開底部三成 —— 這條就是「至少有一顆卡在地板上完全沒動」的回歸鎖。
       * 速度地板（見 `applyFloatCatchup`）對仍低於天花板帶的顆粒每步重設最低上升速度，
       * 被鄰居擋住的也會棘輪式升上去，所以不會有落單的。
       * Every body must have cleared the bottom third — this is the regression lock against
       * "at least one dumpling frozen on the floor". The velocity floor (see `applyFloatCatchup`)
       * re-forces a minimum upward speed every step on any body still below the ceiling band, so
       * even one braced by neighbours ratchets up and none are left behind.
       */
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

describe('搖晃！—— 天花板與展示餘裕 / the shake ceiling and the display margin', () => {
  /**
   * 以自訂的搖晃參數開一局（其餘沿用 `CONFIG`）。
   * Open a session with custom shake params, reusing everything else from `CONFIG`.
   *
   * `gravityY` 可以調低：**天花板只有在顆粒真的被甩上去時才驗得到**。實測（重力 1、幅度比例
   * 0.3、向上力夾到上限）單顆最多只升到頂緣下方約 120 單位，**根本碰不到**那片平面，於是
   * 「有沒有裝平面」在斷言上分不出來；把重力壓到 0.2 之後顆粒會一路頂住平面，兩者才有差
   * （見下方兩條測試的實測數字）。
   * `gravityY` can be lowered: **the ceiling is only verifiable if a body really gets thrown up
   * there.** Measured (gravity 1, ratio 0.3, upward force at its clamp) a lone body only reaches
   * about 120 units below the rim and **never touches** the plane, so the assertions cannot tell
   * whether it was installed. At gravity 0.2 the body pins against the plane, and the two cases
   * separate cleanly (numbers are in the two tests below).
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

  /** 向上力與幅度都開到技能端的硬上限，讓地震真的把顆粒往容器口甩。 */
  const QUAKE_AT_MAX = {
    durationMs: 2000,
    revolutions: 5,
    radiusFactor: 0.3,
    axisTiltDeg: 15,
    /* 技能端會把它夾到 0.5。 */
    upwardFactor: 1,
  };

  it('never lets a dumpling past the invisible ceiling, however hard it is thrown up', () => {
    /*
     * 重力刻意壓低，讓顆粒被那個持續向上的力一路頂到平面上 —— 否則它根本飛不到那麼高，
     * 這條測試就變成什麼都沒驗（見 `makeSessionWithShake` 的說明）。
     * 實測（種子 20261006）：**有平面時最高只到 y - r = 99.93（天花板 100）**；把搖晃的平面
     * 關掉則同一組參數會飛到 y - r = -114，也就是**衝出容器口、越過溢位線 164 單位**。
     * Gravity is deliberately low so the steady upward force drives the body all the way onto the
     * plane — otherwise it never gets that high and the test verifies nothing (see
     * `makeSessionWithShake`). Measured (seed 20261006): **with the plane the highest top edge is
     * 99.93 against a ceiling of 100**; with the shake ceiling disabled the same params fly to
     * -114, i.e. **164 units past the overflow line and out of the container mouth**.
     */
    const session = makeSessionWithShake(600, QUAKE_AT_MAX, 0.2);

    dropAndSettle(session, 300);
    settleToSleep(session);

    /* 天花板的深度是相對**靜止**的頂緣算的，所以要在施放前記下來。 */
    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    expect(session.activateSkill('shake')).toBe(true);

    let highest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 120; i += 1) {
      session.step(FRAME_MS);
      for (const body of session.bodies) {
        highest = Math.min(highest, body.y - body.radius);
      }
    }

    /* 每一步、每一顆都不得越過平面（留 5 單位的求解器穿透餘裕）。 */
    expect(highest).toBeGreaterThan(ceilingY - 5);
    /* 而且真的頂到了平面 —— 否則這條在「平面根本沒裝上」時也會通過。 */
    expect(highest).toBeLessThan(ceilingY + 20);
  });

  it('drops the ceiling again once the quake is over, so the pile falls back', () => {
    /*
     * 與浮動同一條道理：技能結束後平面必須離開世界，否則壓在它上面的顆粒會**懸在半空**。
     * 實測（重力 0.2、種子 20261006）：搖晃結束那一刻顆粒貼在平面上（y ≈ 140）；再跑 240 幀
     * 之後落到 y ≈ 954，也就是回到地板（1000 − 半徑 30 ≈ 970）。
     * Same reasoning as the float: the plane must leave the world when the skill ends, or the
     * bodies resting on it would stay hanging. Measured (gravity 0.2, seed 20261006): the body is
     * pinned on the plane when the quake ends (y ≈ 140) and has fallen to y ≈ 954 — the floor —
     * after 240 more frames.
     */
    const session = makeSessionWithShake(600, QUAKE_AT_MAX, 0.2);

    dropAndSettle(session, 300);
    settleToSleep(session);

    const ceilingY = session.containerGeometry.frame.y + CONFIG.container.floatCeilingBelowRim;

    expect(session.activateSkill('shake')).toBe(true);

    /* 跑完整段搖晃（2 秒 ＝ 120 幀）。 */
    runFrames(session, 120);
    expect(session.isShaking).toBe(false);

    const pinned = session.bodies[0];
    expect(pinned).toBeDefined();
    /* 先確認它真的被壓在平面上，否則「之後掉下來」證明不了平面被收走了。 */
    expect(pinned!.y - pinned!.radius).toBeLessThan(ceilingY + 20);

    /* 平面離開世界之後，重力才有辦法把它拉回地板。 */
    runFrames(session, 240);

    const body = session.bodies[0];
    expect(body).toBeDefined();
    expect(body!.y).toBeGreaterThan(ceilingY + 200);
  });

  it('clamps the container offset inside the display margin', () => {
    /*
     * 幅度比例 1/3（技能的硬上限）× 容器寬 500 ＝ 167，遠大於左右各 50 的餘裕。實作必須把
     * 它夾進餘裕內，否則容器邊線會被畫布切掉 —— 那正是這次要修的「邊界被切掉」。
     * A 1/3 ratio (the skill's hard cap) on a 500-wide container is 167, far more than the 50 of
     * margin per side. The implementation has to clamp it, or the canvas slices the outline —
     * exactly the "boundary gets cut" symptom this change is fixing.
     */
    const session = makeSessionWithShake(600, {
      durationMs: 2000,
      revolutions: 5,
      radiusFactor: 1 / 3,
      axisTiltDeg: 15,
      upwardFactor: 0.1,
    });

    const restX = session.containerGeometry.frame.x;

    /* 沒有場上沒有顆粒的技能一律不受理，技力也還沒賺到 —— 先投一顆。 */
    dropAndSettle(session, 300);
    expect(session.activateSkill('shake')).toBe(true);

    let maxShift = 0;
    for (let i = 0; i < 120; i += 1) {
      session.step(FRAME_MS);
      maxShift = Math.max(maxShift, Math.abs(session.containerGeometry.frame.x - restX));
    }

    /* 先證明容器真的在動，再證明它沒有走出餘裕（留 1 單位給浮點與夾制）。 */
    expect(maxShift).toBeGreaterThan(1);
    expect(maxShift).toBeLessThanOrEqual(CONFIG.container.leftOffset + 1);
  });

  it('leaves no ceiling behind after a restart in the middle of a quake', () => {
    /*
     * 上一局在搖晃中結束 —— 那片靜態平面不會被 `removeDynamicBodies()` 帶走，`reset()` 必須
     * 自己收掉它。重力同樣壓低，這樣「平面還在」才會表現成「顆粒卡在半空」，否則兩種情況
     * 的下場一模一樣。
     * The previous run ended mid-quake: the static plane is not carried away by
     * `removeDynamicBodies()`, so `reset()` has to remove it itself. Gravity is lowered here too,
     * so a leftover plane would show up as a body stuck in mid-air instead of falling.
     */
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

    /* 用掉 3 點（搖晃）之後累計應該跟着走 —— 徽章顯示的 `n/m` 就是這個數字。 */
    dropAndSettle(session, 300);
    expect(session.activateSkill('shake')).toBe(true);

    const after = session.skillCards.find((card) => card.id === 'fate_swap');
    expect(after?.cumulativeSpent).toBeCloseTo(3, 6);
    expect(after?.unlocked).toBe(false);
  });
});

/**
 * 浮動強度回歸：一整堆要真的升到天花板的下半部以上，而不是只有頂部幾顆上去、底部的
 * 方團團還卡在下半部。早一版 `liftFactor = 1.6`（向上淨加速度只有 0.6g）在 1.5 秒內拉不動
 * 一整堆，最底部的頂緣仍遠低於容器半高線；調強後整堆壓在天花板下。
 * Float-strength regression: a whole pile must actually reach the upper half, not just let the
 * top few rise while the bottom stays low. An earlier `liftFactor = 1.6` (only 0.6g net upward)
 * could not lift a full pile within 1.5 s, leaving the bottom's top edge far below the container's
 * mid-height; the stronger lift pins the whole pile under the ceiling.
 */
/**
 * 浮動強度回歸：一整堆要真的升到容器上半部，而不是只有頂部幾顆上去、底部的方團團還卡在下半部。
 * 早一版 `liftFactor = 1.6`（向上淨加速度只有 0.6g）在 1.5 秒內拉不動一整堆，最底部的頂緣仍遠
 * 低於容器半高線；調強到 2.5（淨向上 1.5g）後整堆壓在天花板下。
 * 這裡用「不會合成」的單一等級，讓堆疊維持高大（合成會把堆疊吃掉，觀察不到弱浮動拉不動整堆的問題）。
 * Float-strength regression: a whole pile must actually reach the upper half, not just let the top
 * few rise while the bottom stays low. An earlier `liftFactor = 1.6` (only 0.6g net upward) could not
 * lift a full pile within 1.5 s; the stronger 2.5 (1.5g net) pins the whole pile under the ceiling.
 * A single non-merging level keeps the pile tall (merging would eat the stack and hide the weak lift).
 */
describe('協議：浮動 —— 整堆都要升進上半部 / float lifts the whole pile', () => {
  /** 不會合成的單一等級 + 窄容器，強制疊成高塔，最能逼出弱浮動拉不動整堆的極限。 */
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

  /** 在窄容器裡投放 `n` 顆，每顆間隔拉滿投放冷卻，確保每顆都真的落下、疊成高塔。 */
  function dropPile(session: GameSession, n: number): void {
    const frame = session.containerGeometry.frame;
    const lo = frame.x + 20;
    const hi = frame.x + frame.width - 20;
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i += 1) {
      session.setAim(lo + ((i * 53) % span));
      session.drop();
      runFrames(session, 65); // 超過 dropCooldownMs(1000) 才放下一顆
    }
  }

  /** 喚醒後施放浮動，並在浮動期間（約第 85 幀）取樣最底部的頂緣與容器半高。 */
  function floatAndSample(session: GameSession): { topEdge: number; midY: number; rise: number } {
    const beforeLowestY = Math.max(...session.bodies.map((b) => b.y));
    expect(session.activateSkill('protocol_float')).toBe(true);
    runFrames(session, 85); // 浮動期間測量（1500ms ≈ 90 幀，取 85）
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
   * 追趕機制的專用判別：淨重力調成 0（liftFactor=1）之後，翻轉重力什麼都不做 —— 堆疊要升，
   * 只能靠追趕力。這條測試在追趕壞掉（力算錯、方向反了、帶判斷反了）時必定失敗。
   * Dedicated catch-up discriminator: with net gravity zeroed (liftFactor=1) the gravity flip
   * does nothing at all — the pile can only rise via the catch-up force. This fails the moment
   * the catch-up breaks (wrong magnitude, wrong direction, or an inverted band test).
   */
  it('淨重力為 0 時，單靠追趕力也要把整堆升進上半部', () => {
    const session = new GameSession({ config: makeFloatConfig(1, 2), rng: createRng(20261006), virtualWidth: 260 });
    dropPile(session, 8);
    settleToSleep(session);
    const { topEdge, midY, rise } = floatAndSample(session);
    expect(topEdge).toBeLessThan(midY);
    expect(rise).toBeGreaterThan(100);
  });
});
