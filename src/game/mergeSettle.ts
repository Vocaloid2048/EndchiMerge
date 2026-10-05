/**
 * 合成後的落點物理：動量繼承與向下投影找支撐。
 * Post-merge placement physics: momentum inheritance and downward support projection.
 *
 * 這個模組是**純函式**：不碰 Matter、不碰 canvas，輸入是數字與矩形，輸出也是數字，所以能在
 * node 環境完整單元測試 —— 與 `outlineProximity.ts` 同一套方針。
 * This module is **pure functions**: no Matter, no canvas. Numbers and rectangles go in; numbers
 * come out, so it unit-tests fully in node — the same policy as `outlineProximity.ts`.
 *
 * **為什麼要有這個模組**：合成的位置若只取兩顆原料的質心中點，會產生兩個玩家看得出的問題：
 *  1. **動量憑空消失** —— 兩顆正在下墜或正在被推擠的顆粒，合成後突然靜止憑空出現。
 *  2. **凌空生成** —— 質心中點可能落在半空中（例如兩顆原本堆在高處、或被推開後才合成），
 *     新顆粒就在空中定格，違反直覺。
 * 這個模組提供兩支函式分別解掉這兩件事。
 * **Why this module exists**: a merge that only takes the inputs' midpoint produces two problems
 * the player can see: (1) momentum vanishes, so two falling or shoving dumplings produce a
 * motionless result out of nowhere; (2) the midpoint can sit in mid-air (inputs stacked high, or
 * pushed apart before merging), leaving the new body frozen in the air. The two functions below
 * address these separately.
 */

import type { Body } from 'matter-js';

/**
 * 以**質量加權**平均兩顆剛體的速度，作為合成後的新速度。
 * Mass-weighted average of two bodies' velocities, used as the merged body's velocity.
 *
 * 動量 `p = m·v` 守恆是這裡的依據：合成後的新顆粒要帶著「兩顆原料合起來的動量」繼續走，
 * 才不會讓一顆正在下墜的顆粒因為合成而突然停在半空。質量取 `密度 × 圓面積`
 * （`π r²`），與 `LevelDef` 的宣告一致 —— 雖然 Matter 對輪廓碰撞體用的是多邊形面積，但
 * 決策層面的質量宣告本來就是圓形近似，用它算出的比例穩定且可預測。
 * Momentum `p = m·v` conservation is the basis: the new body must carry the combined momentum of
 * its inputs, or a falling pair would stop dead on merging. Mass is `density × circle area`
 * (`π r²`), matching the `LevelDef` declaration — Matter measures a polygon's actual area for an
 * outline collider, but the design-level mass is declared as a circle, and the ratio it yields is
 * stable and predictable.
 *
 * **同級合成時質量相等**，所以結果就是兩者速度的算術平均 —— 但這裡仍寫成通用式，讓未來若開放
 * 不同級合成時不必改。
 * **Same-level merges have equal masses**, so the result is simply the two velocities' arithmetic
 * mean — the general form is kept so a future cross-level merge needs no change.
 *
 * @param va 第一顆的速度 / First body's velocity.
 * @param ma 第一顆的質量 / First body's mass.
 * @param vb 第二顆的速度 / Second body's velocity.
 * @param mb 第二顆的質量 / Second body's mass.
 * @returns 質量加權後的速度；兩者質量皆為 0 時回傳零向量。
 *   The mass-weighted velocity; a zero vector when both masses are zero.
 */
export function inheritMomentum(
  va: { x: number; y: number },
  ma: number,
  vb: { x: number; y: number },
  mb: number,
): { x: number; y: number } {
  const total = ma + mb;

  /* 質量都不存在時沒有動量可言，回傳靜止，避免除以零。 */
  if (total <= 0) return { x: 0, y: 0 };

  return {
    x: (va.x * ma + vb.x * mb) / total,
    y: (va.y * ma + vb.y * mb) / total,
  };
}

/**
 * 由 `LevelDef` 的宣告計算質量（密度 × 圓面積）。
 * Mass from a `LevelDef` declaration (density × circle area).
 *
 * 抽出來單獨一支，是因為「質量怎麼算」必須在測試裡與實作中一致 —— 兩處各寫一份遲早會漂移。
 * Extracted because "how mass is computed" must agree between tests and implementation; two
 * copies would drift apart sooner or later.
 *
 * @param density 密度 / Density.
 * @param radius 圓半徑 / Circle radius.
 */
export function circleMass(density: number, radius: number): number {
  return density * Math.PI * radius * radius;
}

/** 一個矩形（用來描述地板、牆或另一顆方團團的包圍盒）。 */
export interface Rect {
  /** 左緣 X / Left edge X. */
  x: number;
  /** 上緣 Y / Top edge Y. */
  y: number;
  /** 寬 / Width. */
  width: number;
  /** 高 / Height. */
  height: number;
}

/**
 * 向下投影：算出一個落在 `(cx, cy)` 的圓，沿垂直線往下**第一個碰到的支撐面**有多遠。
 * Downward projection: how far a circle centred at `(cx, cy)` must fall before it first rests on
 * something.
 *
 * 這是「避免貿然凌空」的核心。合成後若質心中點下方一片空，新顆粒就該立刻落到最近的支撐上，
 * 而不是停在半空等物理慢慢拉 —— 那會有肉眼可見的「定格在空中」。
 * This is the core of "do not freeze in mid-air". If nothing sits under the merged midpoint, the
 * new body should come to rest on the nearest support immediately rather than hang in the air
 * waiting for physics to pull it down, which reads as a visible stall.
 *
 * **演算法**：對每個候選支撐（其他顆粒的包圍盒 ＋ 容器地板），判斷圓的水平投影
 * `[cx − r, cx + r]` 是否與該矩形的水平範圍重疊；若重疊，則「圓底碰到該矩形上緣」所需的
 * 下落距離是 `rect.y − (cy + r)`。取所有正值中的最小值即為最近支撐的距離；都沒有時回傳
 * `Infinity`（＝腳下無物，維持自由落體）。
 * **Algorithm**: for every candidate support (the other bodies' bounding boxes plus the
 * container floor), test whether the circle's horizontal span `[cx − r, cx + r]` overlaps the
 * rectangle's horizontal span; if it does, the fall needed for the circle's bottom to reach the
 * rectangle's top is `rect.y − (cy + r)`. The smallest positive value is the nearest support's
 * distance; when none applies the result is `Infinity` (nothing below, so free fall).
 *
 * **為什麼用包圍盒而不是真實輪廓**：這是「找最近的東西墊在下面」，不是碰撞解算 —— 用包圍盒
 * 只會讓投影**偏保守**（提早落地），而不會讓顆粒穿過鄰居。真實輪廓的多邊形相交測試成本高
 * 且對凹形鄰居容易出現「射線剛好穿過縫」的假陰性，反而更糟。
 * **Why bounding boxes rather than true outlines**: this finds "the nearest thing to land on",
 * not a collision solve. Boxes only make the projection **conservative** (landing a touch early)
 * and never let a body pass through a neighbour; true-outline intersection would cost far more
 * and, for concave neighbours, invite false negatives where the ray slips through a gap.
 *
 * @param cx 圓心 X / Circle centre X.
 * @param cy 圓心 Y / Circle centre Y.
 * @param radius 圓半徑 / Circle radius.
 * @param supports 候選支撐矩形（不含自己）/ Candidate support rectangles (excluding self).
 * @param maxDistance 只回報不超過這個距離的支撐；其餘視為「太遠，不值得吸附」。
 *   Only report supports within this distance; anything farther is "too far to snap onto".
 * @returns 最近支撐的距離（0 表示已經貼住或已穿透），或 `Infinity`。
 *   The nearest support's distance (0 when already resting or penetrating), or `Infinity`.
 */
export function distanceToSupport(
  cx: number,
  cy: number,
  radius: number,
  supports: readonly Rect[],
  maxDistance = Infinity,
): number {
  const left = cx - radius;
  const right = cx + radius;
  const bottom = cy + radius;

  let best = Infinity;

  for (const rect of supports) {
    /* 水平投影沒重疊 → 這塊不會墊在圓的下面。 */
    if (rect.x + rect.width < left || rect.x > right) continue;

    const drop = rect.y - bottom;

    /* 已經在支撐「裡面」或下方時 drop ≤ 0：視為 0（貼住），不是負距離。 */
    const clamped = drop > 0 ? drop : 0;

    if (clamped < best) best = clamped;
  }

  return best <= maxDistance ? best : Infinity;
}

/**
 * 把一組剛體轉成包圍盒矩形（供 `distanceToSupport` 使用）。
 * Turn a set of bodies into bounding-box rectangles (for `distanceToSupport`).
 *
 * 用 `body.bounds` 而不是重算輪廓：Matter 已經在每次位置變動後維護它，取用即可。
 * Uses `body.bounds` rather than recomputing outlines: Matter maintains it after every position
 * change, so it is ready to read.
 *
 * @param bodies 剛體清單 / The bodies.
 * @param excludeId 要排除的剛體 id（通常是正在投影的那一顆自己）。
 *   The body id to exclude (normally the one being projected).
 */
export function boundsOf(bodies: readonly Body[], excludeId: number): Rect[] {
  const rects: Rect[] = [];

  for (const body of bodies) {
    if (body.id === excludeId) continue;
    rects.push({
      x: body.bounds.min.x,
      y: body.bounds.min.y,
      width: body.bounds.max.x - body.bounds.min.x,
      height: body.bounds.max.y - body.bounds.min.y,
    });
  }

  return rects;
}
