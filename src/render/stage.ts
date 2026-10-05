/**
 * 遊戲區的畫布繪製。
 * Canvas drawing for the play area.
 *
 * 這裡是一個**無狀態的繪製函式**，不是類別：所有狀態（物理、掉落佇列、瞄準位置）
 * 都屬於 `game/`，畫面只是把它投影出來。這樣同一組畫面可以被重播、被截圖測試，
 * 也不會出現「渲染器偷偷改了遊戲狀態」這種難查的問題。
 * This is a stateless draw function rather than a class: all state belongs to `game/`
 * and the canvas merely projects it. That keeps frames replayable and prevents the
 * renderer from quietly mutating game state.
 *
 * 繪製順序本身就是「裝在容器內」這個效果的全部來源（見 `render/container.ts`）：
 * 內部填充 → 溢位警戒區 → 輔助線 → 方團團 → U 形線框 → 溢位紅線 → 投放預覽。
 * The draw order is the whole effect (see `render/container.ts`): interior fill → overflow
 * zone → guide → dumplings → U outline → overflow line → drop preview.
 */

import type { Rect } from '../core/types';
import type { ContainerGeometry } from './container';
import { drawContainerBack, drawContainerFront, clipToPlayField } from './container';
import { drawPlaceholderDumpling } from './placeholder';
import { SPRITE_ANCHOR, SPRITE_SIZE, spriteScaleForRadius } from '../core/constants';

/**
 * 投放輔助虛線的樣式。
 * Aim-guide dash style.
 *
 * **調參入口**：虛線的粗幼、節奏與顏色都在這裡改。`color` 只是預設值，
 * `StageFrame.guideColor` 會覆寫它。
 * **The tuning entry point**: dash width, rhythm and colour all live here. `color` is only
 * a default; `StageFrame.guideColor` overrides it.
 */
export const AIM_GUIDE_STYLE = {
  /** 線寬，虛擬單位。 */
  lineWidth: 5,
  /** 虛線節奏 `[實線, 空白]`，虛擬單位。 */
  dash: [10, 15] as const,
  /** 顏色。 */
  color: 'rgba(61, 61, 61, 0.69)',
} as const;

/**
 * 除錯輔助線的樣式；只在 `StageFrame.debug` 存在時使用。
 *
 * **調參入口**：顏色、粗幼、頂點半徑都在這裡改。
 * The tuning entry point: colours, weights and the vertex dot radius all live here.
 */
const DEBUG_STYLE = {
  lineWidth: 1.5,
  frame: 'rgba(255, 84, 160, 0.95)',
  cavity: 'rgba(90, 220, 255, 0.95)',
  spawn: 'rgba(255, 214, 92, 0.95)',
  /*
   * 碰撞框：**紅線描邊 ＋ 藍色頂點實心圓點**，與 `.tmp-verify/trace-xx.png`（輪廓追蹤工具）
   * 的畫面一模一樣。這不是巧合 —— 兩者回答的是同一個問題：「物理實際拿什麼在碰撞？」，
   * 顏色一致就不用在腦中做一次對應。
   *
   * 紅線選純紅（`#ff2d55`）而 frame 的粉紅（`rgba(255,84,160)`），因為兩者會**同時**出現，
   * 拉開色相才分得清哪條線是哪個。藍點刻意用接近青色的 `#33d6ff`，避開 cavity 的
   * `rgba(90,220,255)` 又足夠醒目。
   * Colliders: **red edges with blue vertex dots**, exactly as the contour tracer renders in
   * `.tmp-verify/trace-xx.png`. Not a coincidence — both answer "what is the engine actually
   * colliding with?", and matching colours means the mapping is never re-derived in the head.
   *
   * The red is deliberately a different hue from the frame's pink because the two can appear
   * together; the vertex blue is pushed toward cyan to stay distinct from the cavity's.
   */
  colliderEdge: 'rgba(255, 45, 85, 0.95)',
  colliderVertex: 'rgba(51, 214, 255, 0.95)',
  colliderVertexRadius: 3.5,
} as const;

/**
 * 溢位線與警戒區的樣式。
 * Overflow line and warning-zone style.
 *
 * **調參入口**：紅線的粗幼／顏色、警戒區的填色、以及中央倒數徽章的尺寸都在這裡改。
 * **The tuning entry point** for the line's weight and colour, the zone's fill, and the
 * centred countdown badge's size.
 */
const OVERFLOW_STYLE = {
  /** 紅線線寬，虛擬單位。 */
  lineWidth: 4,
  /** 紅線顏色。 */
  lineColor: 'rgba(226, 100, 95, 0.95)',
  /** 紅線節奏 `[實線, 空白]`，虛擬單位。 */
  dash: [16, 14] as const,
  /** 警戒區填色（淺紅），實際 alpha 由脈動調變。 */
  zoneColor: '226, 100, 95',
  /** 警戒區的峰值 alpha 與谷值 alpha。 */
  zoneAlphaMax: 0.28,
  /** 警戒區的谷值 alpha。未起算時完全不上色（`zoneAlphaIdle`）。 */
  zoneAlphaMin: 0.1,
  /**
   * 尚未起算（越線但還在動）時的填色 alpha。**0 ＝ 完全不顯示** —— 使用者定案：
   * 停定之前不該有任何提示，否則玩家會看到「還在掉就出現」的警告。
   * Fill alpha before the breach has settled. **0 means invisible** — the user's decision:
   * nothing should show until it settles, or the player sees a warning about a falling
   * dumpling.
   */
  zoneAlphaIdle: 0,
  /** 倒數徽章的底／邊框／文字顏色。 */
  badgeFill: 'rgba(226, 100, 95, 0.82)',
  badgeStroke: 'rgba(255, 255, 255, 0.95)',
  badgeText: '#FFFFFF',
  /** 徽章邊框粗細，虛擬單位。 */
  badgeStrokeWidth: 3,
  /** 徽章最小寬高，虛擬單位。數字為一位數時仍是一個圓。 */
  badgeMinSize: 56,
  /** 徽章內距，虛擬單位。 */
  badgePaddingX: 18,
  badgePaddingY: 10,
  /** 徽章字級，虛擬單位。 */
  badgeFontSize: 32,
} as const;

/**
 * 一顆要被畫出來的方團團。
 * One dumpling to be drawn.
 *
 * 刻意**不直接用 Matter 的 `Body`**：`render/` 不該知道物理引擎的存在，
 * 而且這樣測試可以餵純資料。
 * Deliberately not a Matter `Body`: `render/` should not know the engine exists, and
 * it lets tests feed plain data.
 */
export interface RenderBody {
  levelId: number;
  x: number;
  y: number;
  /** 碰撞半徑，虛擬單位。決定 sprite 縮放。 */
  radius: number;
  /** 弧度。 */
  angle: number;
  /**
   * 額外的畫面縮放倍率（相對於「半徑對應的尺寸」）。合成剛產生時大於 1，播完回到 1。
   * An extra draw-scale multiplier on top of the radius-derived size. It is above 1 right
   * after a merge and settles back to 1.
   */
  scale?: number;
  /**
   * 目前速度（世界單位／步），選填。
   * Current velocity in world units per step; optional.
   *
   * 供 QA 與除錯讀取用 —— 合成是否繼承動量（見 `game/mergeSettle.ts`）在畫面上看不出來，
   * 但可以由這個欄位驗證。渲染器目前不強制使用它。
   * Available for QA and debugging — whether a merge inherited momentum (see
   * `game/mergeSettle.ts`) is invisible on screen but verifiable here. The renderer is not
   * required to use it.
   */
  velocity?: { x: number; y: number };
}

/** 投放下落前的預覽。 */
export interface RenderAim {
  levelId: number;
  x: number;
  /** 預覽的圓心 Y，等於 `GameSession` 的投放高度。 */
  y: number;
  radius: number;
}

/** sprite 來源；`SpriteLoader` 在結構上已滿足此介面。 */
export interface SpriteSource {
  get(levelId: number): { image: HTMLImageElement; ok: boolean } | undefined;
}

export interface StageFrame {
  geometry: ContainerGeometry;
  bodies: readonly RenderBody[];
  /** 目前滑鼠位置的投放預覽；null 表示不畫。 */
  aim: RenderAim | null;
  /** 輔助線的顏色（預覽用）；未提供時用 `AIM_GUIDE_STYLE.color`。 */
  guideColor?: string;
  /**
   * 溢位警戒；`danger` 為真時顯示紅線、警戒區與中央倒數。
   * Overflow warning; when `danger` is true the line, the zone and the centred countdown show.
   *
   * 未提供時不畫線也不畫區。`danger` 為假時**完全不畫**（不只是淡化）—— 使用者定案：
   * 停定之前不該有任何提示。
   * Omitted means nothing is drawn; a false `danger` also draws nothing rather than a faint
   * wash, because the user's rule is that nothing shows until the breach settles.
   */
  overflow?: {
    /** 紅虛線的 Y（虛擬單位）。 */
    lineY: number;
    /** 警戒區的上緣（＝線）。 */
    zoneTop: number;
    /** 警戒區的下緣（＝容器頂緣）。 */
    zoneBottom: number;
    /** 線的左緣 X。 */
    x: number;
    /** 線的寬度。 */
    width: number;
    /** 是否處於「越線且已停定」的狀態；真＝顯示脈動與倒數。 */
    danger: boolean;
    /** 脈動相位 `0..1`，由迴圈以時間驅動；`0` 代表谷值。 */
    pulse: number;
    /** 剩餘秒數（整數）；畫在警戒區的正中央。 */
    secondsLeft: number;
  };
  /**
   * 方團團與投放預覽的裁切上界（虛擬 Y）。未提供時為 0（＝畫布頂端）。
   * The clip's top edge in virtual units for dumplings and the drop preview. Defaults to 0,
   * the canvas top.
   *
   * 讓呼叫端能把裁切往下拉（例如除錯時想看清楚被容器蓋住的部分），也把「頂端是開口的」
   * 寫成明碼而不是靠畫布邊界的副作用。
   * Lets the caller pull the clip down (e.g. to inspect what the container hides while
   * debugging) and states that the top is open on purpose rather than leaving it as a side
   * effect of the canvas boundary.
   */
  clipTop?: number;
  /**
   * 除錯輔助。提供時額外畫出容器的外框、物理空腔、投放線與**碰撞框標註**。
   * Only wired up behind `?debug=1` in development.
   */
  debug?: {
    cavity: Rect;
    spawnY: number;
    /**
     * 每顆方團團的碰撞體頂點（世界座標），每個元素是一顆的**凸部件**清單。
     * 一顆圓形（無輪廓）只有一個部件；一個凹輪廓會被物理引擎拆成數個。
     *
     * 可空：沒有碰撞框資料時只是不畫標註，其餘輔助線照舊。
     * Collider vertices per dumpling in world space, one list per **convex part**. A circle has
     * a single part; a concave outline is split into several by the engine.
     *
     * Optional: absent simply means no annotations, the other guides still draw.
     */
    colliders?: {
      levelId: number;
      parts: { x: number; y: number }[][];
    }[];
  };
}

/** 由碰撞半徑算出 sprite 的繪製邊長（虛擬單位）。 */
export function spriteDrawSize(radius: number): number {
  return SPRITE_SIZE * spriteScaleForRadius(radius);
}

/**
 * 畫一顆方團團：優先用素材，素材不可用時退回程式佔位圖。
 * Draw one dumpling, preferring the asset and falling back to the placeholder.
 */
function drawBody(
  ctx: CanvasRenderingContext2D,
  body: RenderBody,
  sprites: SpriteSource,
): void {
  const entry = sprites.get(body.levelId);
  /* 彈跳倍率與半徑換算相乘，兩者只在這一處合流。 */
  const pop = body.scale ?? 1;
  const scale = spriteScaleForRadius(body.radius) * pop;

  if (entry === undefined || !entry.ok) {
    drawPlaceholderDumpling(ctx, {
      x: body.x,
      y: body.y,
      radius: body.radius * pop,
      levelId: body.levelId,
    });
    return;
  }

  ctx.save();
  /* 平移 + 旋轉而非直接算座標：質心偏移與角度都只在這一處相乘。 */
  ctx.translate(body.x, body.y);
  ctx.rotate(body.angle);
  ctx.drawImage(
    entry.image,
    -SPRITE_ANCHOR.x * scale,
    -SPRITE_ANCHOR.y * scale,
    SPRITE_SIZE * scale,
    SPRITE_SIZE * scale,
  );
  ctx.restore();
}

/**
 * 畫一條從投放高度垂到下緣的輔助線，讓玩家看得出會落在哪一欄。
 * Draw a vertical guide from the drop height down to the floor so the landing
 * column is readable.
 *
 * 樣式見 `AIM_GUIDE_STYLE`（粗幼、節奏、顏色）。
 * Style comes from `AIM_GUIDE_STYLE`.
 */
function drawAimGuide(
  ctx: CanvasRenderingContext2D,
  aim: RenderAim,
  geometry: ContainerGeometry,
  color: string,
): void {
  const floorY = geometry.frame.y + geometry.frame.height;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = AIM_GUIDE_STYLE.lineWidth;
  ctx.setLineDash([...AIM_GUIDE_STYLE.dash]);
  ctx.beginPath();
  ctx.moveTo(aim.x, aim.y + aim.radius);
  ctx.lineTo(aim.x, floorY);
  ctx.stroke();
  ctx.restore();
}

/**
 * 畫溢位警戒區：紅線與容器頂緣之間的淺紅色帶。越線時脈動，平常只是很淡的一層。
 * Draw the overflow warning zone: the pale red band between the line and the container's
 * rim. It pulses while breached and stays a faint wash otherwise.
 *
 * 畫在方團團**之下**，因為它是背景提示而不是遮罩；紅線本身則畫在最上層（見 `drawStage`）。
 * Drawn **under** the dumplings because it is a background cue, not an overlay; the line
 * itself goes on top in `drawStage`.
 */
function drawOverflowZone(
  ctx: CanvasRenderingContext2D,
  overflow: NonNullable<StageFrame['overflow']>,
): void {
  /* 尚未起算就整段跳過：不畫線、不畫區、不畫倒數（使用者定案）。 */
  if (!overflow.danger) return;

  const top = Math.min(overflow.zoneTop, overflow.zoneBottom);
  const height = Math.abs(overflow.zoneBottom - overflow.zoneTop);
  if (height <= 0) return;

  const alpha =
    OVERFLOW_STYLE.zoneAlphaMin +
    (OVERFLOW_STYLE.zoneAlphaMax - OVERFLOW_STYLE.zoneAlphaMin) * overflow.pulse;

  ctx.save();
  ctx.fillStyle = `rgba(${OVERFLOW_STYLE.zoneColor}, ${alpha.toFixed(3)})`;
  ctx.fillRect(overflow.x, top, overflow.width, height);
  ctx.restore();
}

/**
 * 畫警戒區正中央的倒數徽章：圓角深紅底、白色邊框、白色數字。
 * Draw the countdown badge at the centre of the warning zone: rounded deep-red fill, white
 * border, white number.
 *
 * 位置取警戒區的**垂直與水平中心**（使用者定案），所以容器一改尺寸它就自己跟著置中，
 * 不需要另一組座標。徽章的圓角半徑取 `height / 2`，因此一位數時是一個正圓、兩位數時
 * 自動變成左右延伸的膠囊。
 * The position is the zone's **vertical and horizontal centre** (the user's decision), so it
 * re-centres itself when the container changes size without a second set of coordinates. The
 * corner radius is `height / 2`, which makes a single digit a circle and lets two digits
 * stretch into a capsule on their own.
 */
function drawOverflowCountdown(
  ctx: CanvasRenderingContext2D,
  overflow: NonNullable<StageFrame['overflow']>,
): void {
  if (!overflow.danger) return;

  const text = String(overflow.secondsLeft);
  const centreX = overflow.x + overflow.width / 2;
  const centreY = (overflow.zoneTop + overflow.zoneBottom) / 2;

  ctx.save();
  ctx.font = `700 ${String(OVERFLOW_STYLE.badgeFontSize)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(text).width;
  const width = Math.max(
    OVERFLOW_STYLE.badgeMinSize,
    textWidth + OVERFLOW_STYLE.badgePaddingX * 2,
  );
  const height = Math.max(
    OVERFLOW_STYLE.badgeMinSize,
    OVERFLOW_STYLE.badgeFontSize + OVERFLOW_STYLE.badgePaddingY * 2,
  );
  const left = centreX - width / 2;
  const top = centreY - height / 2;
  const radius = height / 2;

  ctx.beginPath();
  ctx.roundRect(left, top, width, height, radius);
  ctx.fillStyle = OVERFLOW_STYLE.badgeFill;
  ctx.fill();
  ctx.lineWidth = OVERFLOW_STYLE.badgeStrokeWidth;
  ctx.strokeStyle = OVERFLOW_STYLE.badgeStroke;
  ctx.stroke();

  ctx.fillStyle = OVERFLOW_STYLE.badgeText;
  ctx.fillText(text, centreX, centreY);

  ctx.restore();
}

/**
 * 畫溢位紅線（虛線）。畫在方團團**之上**，因為它是一條必須隨時看得見的門檻。
 * Draw the dashed overflow line, above the dumplings, because it is a threshold that must
 * stay readable at all times.
 */
function drawOverflowLine(
  ctx: CanvasRenderingContext2D,
  overflow: NonNullable<StageFrame['overflow']>,
): void {
  /* 尚未起算就不畫；這條線本身也是提示的一部分。 */
  if (!overflow.danger) return;

  ctx.save();
  ctx.strokeStyle = OVERFLOW_STYLE.lineColor;
  ctx.lineWidth = OVERFLOW_STYLE.lineWidth;
  ctx.setLineDash([...OVERFLOW_STYLE.dash]);
  ctx.beginPath();
  ctx.moveTo(overflow.x, overflow.lineY);
  ctx.lineTo(overflow.x + overflow.width, overflow.lineY);
  ctx.stroke();
  ctx.restore();
}

/**
 * 除錯輔助線：容器外框、物理空腔、投放高度，以及**碰撞框標註**。
 * Debug guides: container frame, physics cavity, spawn height and the collider annotations.
 */
function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  geometry: ContainerGeometry,
  debug: NonNullable<StageFrame['debug']>,
): void {
  const { frame } = geometry;
  const { cavity, spawnY, colliders } = debug;

  ctx.save();
  ctx.lineWidth = DEBUG_STYLE.lineWidth;
  ctx.setLineDash([]);

  ctx.strokeStyle = DEBUG_STYLE.frame;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

  ctx.strokeStyle = DEBUG_STYLE.cavity;
  ctx.strokeRect(cavity.x, cavity.y, cavity.width, cavity.height);

  ctx.strokeStyle = DEBUG_STYLE.spawn;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(frame.x, spawnY);
  ctx.lineTo(frame.x + frame.width, spawnY);
  ctx.stroke();

  /* 碰撞框：實線閉合多邊形 ＋ 每個頂點一個實心圓點。 */
  if (colliders !== undefined) {
    ctx.setLineDash([]);

    for (const collider of colliders) {
      for (const part of collider.parts) {
        /* 頂點少於 3 個畫不成多邊形（退化情形），直接跳過。 */
        if (part.length < 3) continue;

        ctx.strokeStyle = DEBUG_STYLE.colliderEdge;
        ctx.beginPath();
        ctx.moveTo(part[0].x, part[0].y);
        /* `closePath` 會自動連回第一點，所以只畫 n−1 條線段。 */
        for (let index = 1; index < part.length; index += 1) {
          ctx.lineTo(part[index].x, part[index].y);
        }
        ctx.closePath();
        ctx.stroke();

        /* 頂點用實心圓點：`fill` 不用 `stroke`，小半徑下才不會糊成一團。 */
        ctx.fillStyle = DEBUG_STYLE.colliderVertex;

        for (const vertex of part) {
          ctx.beginPath();
          ctx.arc(vertex.x, vertex.y, DEBUG_STYLE.colliderVertexRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  ctx.restore();
}

/**
 * 畫一個完整的畫面。
 * Draw one complete frame.
 *
 * @param ctx 已套用虛擬座標變換的 2D 上下文（見 `Viewport.applyTransform`）。
 *   A 2D context already transformed into virtual units.
 */
export function drawStage(
  ctx: CanvasRenderingContext2D,
  frame: StageFrame,
  sprites: SpriteSource,
): void {
  const { geometry, bodies, aim, overflow } = frame;

  /* 1. 槽的內部填充。必須先畫，否則方團團會看起來在外面。 */
  drawContainerBack(ctx, geometry);

  /* 2. 溢位警戒區：背景提示，壓在方團團之下。 */
  if (overflow !== undefined) {
    drawOverflowZone(ctx, overflow);
  }

  /* 輔助線在 sprite 之下，才不會蓋住方團團。 */
  if (aim !== null) {
    drawAimGuide(ctx, aim, geometry, frame.guideColor ?? AIM_GUIDE_STYLE.color);
  }

  /* 3. 全部方團團（依物理角度翻滾、依彈跳動畫縮放）。
   *
   * 用 `clipToPlayField()` 把方團團夾在看得見的遊戲區內。素材在圓心**上方**伸出
   * 2.16 倍半徑（`SPRITE_ANCHOR.y = 328` vs `SPRITE_BODY = 304`），所以疊高之後最頂那顆、
   * 以及生成在溢位線之上的投放預覽，都會有一截落在畫布之外。顯式裁切讓那一截**沿著
   * 容器邊界**被切掉，而不是在畫布邊緣隨機斷開；`clipY` 也讓「頂端是開口的」寫在明處。
   * All dumplings, rotated by physics and scaled by the pop animation.
   *
   * The clip keeps dumplings inside the visible play field. The art reaches 2.16 radii
   * **above** the centre (`SPRITE_ANCHOR.y = 328` against `SPRITE_BODY = 304`), so once the
   * pile is tall — and for the drop preview, which spawns above the overflow line — a slice
   * falls outside the canvas. Clipping explicitly cuts that slice **along the container's
   * boundary** instead of letting it break off at the canvas edge, and `clipY` documents that
   * the top is open on purpose.
   *
   * 線框在裁切之外繪製，所以左右牆與底部圓角永遠完整。
   * The outline is drawn outside the clip, so the walls and rounded corners stay whole.
   */
  ctx.save();
  clipToPlayField(ctx, geometry, frame.clipTop ?? 0);
  for (const body of bodies) {
    drawBody(ctx, body, sprites);
  }
  ctx.restore();

  /* 4. U 形線框。少了這步就沒有「裝在槽內」的感覺。 */
  drawContainerFront(ctx, geometry);

  /* 5. 溢位紅線壓在最上層，任何時候都讀得到。 */
  if (overflow !== undefined) {
    drawOverflowLine(ctx, overflow);
  }

  /* 5b. 中央倒數徽章：畫在紅線之上，因為它是最需要被讀到的數字。 */
  if (overflow !== undefined) {
    drawOverflowCountdown(ctx, overflow);
  }

  /*
   * 6. 投放預覽畫在最上層：它應該壓在線框上，因為它還沒進到槽裡。
   *
   * 同樣套用遊戲區裁切：預覽生成在**溢位線之上**，而它的藝術又比圓心高 2.16 倍半徑，
   * 所以在高等級（半徑大）時會有一截落在畫布頂端之外。不裁的話那一截會被畫布靜默切掉，
   * 看起來像素材缺一角；裁了則是乾淨地沿著可見邊界收邊。
   *
   * **不透明**（使用者定案）：預覽是「這一顆確定會掉下去」的承諾，畫成半透明反而像在說
   * 「可能會掉」。冷卻期間的隱藏由 `aim === null` 負責，不靠調 alpha —— 那是狀態而非風格。
   * The drop preview, drawn on top because it has not entered the trough yet.
   *
   * The same play-field clip applies: the preview spawns **above the overflow line** and its
   * art reaches 2.16 radii above the centre, so at high levels (larger radii) a slice lands
   * above the canvas top. Without the clip the canvas cuts it silently and the sprite appears
   * to be missing a corner; with it the edge is trimmed cleanly at the visible boundary.
   *
   * **Fully opaque** (the user's decision): the preview promises "this one *will* drop", and a
   * translucent body reads as "maybe". Hiding during the cooldown is `aim === null`'s job, not
   * an alpha trick — that is state, not styling.
   */
  if (aim !== null) {
    ctx.save();
    clipToPlayField(ctx, geometry, frame.clipTop ?? 0);
    drawBody(ctx, { ...aim, angle: 0 }, sprites);
    ctx.restore();
  }

  /* 7. 除錯輔助線永遠在最上層，否則看不到。 */
  if (frame.debug !== undefined) {
    drawDebugOverlay(ctx, geometry, frame.debug);
  }
}
