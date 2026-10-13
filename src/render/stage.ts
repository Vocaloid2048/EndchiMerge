/**
 * 遊戲區的畫布繪製：一個無狀態的繪製函式，所有狀態屬於 `game/`，畫面只把它投影出來。
 * Canvas drawing for the play area: a stateless draw function; all state belongs to `game/` and the canvas merely projects it.
 *
 * 繪製順序本身就是「裝在容器內」效果的來源（見 `render/container.ts`）：
 * 內部填充 → 溢位警戒區 → 輔助線 → 方團團 → U 形線框 → 選取標示 → 紅線 → 倒數 → 預覽。
 * The draw order is the whole effect (see `render/container.ts`): interior fill → overflow zone → guide → dumplings → U outline → selection marker → line → countdown → preview.
 */

import type { Rect } from '../core/types';
import type { ContainerGeometry } from './container';
import { drawContainerBack, drawContainerFront, clipToPlayField } from './container';
import { drawPlaceholderDumpling } from './placeholder';
import { SPRITE_ANCHOR, SPRITE_SIZE, spriteScaleForRadius } from '../core/constants';

/**
 * 投放輔助虛線的樣式；調參入口（`color` 只是預設值，`StageFrame.guideColor` 會覆寫）。
 * The aim-guide dash style; the tuning entry point (`color` is a default that `StageFrame.guideColor` overrides).
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
 * 除錯輔助線的樣式；只在 `StageFrame.debug` 存在時使用，調參入口。
 * The debug guides' style; used only when `StageFrame.debug` exists. The tuning entry point.
 */
const DEBUG_STYLE = {
  lineWidth: 1.5,
  frame: 'rgba(255, 84, 160, 0.95)',
  cavity: 'rgba(90, 220, 255, 0.95)',
  spawn: 'rgba(255, 214, 92, 0.95)',
  /*
   * 碰撞框：紅線描邊 ＋ 藍色頂點實心圓點，與輪廓追蹤工具的畫面一致 ——
   * 兩者回答同一個問題（「物理實際拿什麼在碰撞？」），顏色一致就不必在腦中對應。
   * Colliders: red edges with blue vertex dots, matching the contour tracer's rendering —
   * both answer "what is the engine actually colliding with?", and matching colours spare the mental mapping.
   */
  colliderEdge: 'rgba(255, 45, 85, 0.95)',
  colliderVertex: 'rgba(51, 214, 255, 0.95)',
  colliderVertexRadius: 3.5,
} as const;

/**
 * 溢位線與警戒區的樣式；紅線、警戒區與中央倒數徽章的調參入口。
 * The overflow line and warning-zone style; the tuning entry point for the line, the zone and the centred countdown badge.
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
  /** 警戒區的谷值 alpha。 */
  zoneAlphaMin: 0.1,
  /**
   * 尚未起算（越線但還在動）時的填色 alpha；0 ＝ 完全不顯示 —— 停定之前不該有任何提示。
   * Fill alpha before the breach has settled; 0 means invisible — nothing shows until it settles.
   */
  zoneAlphaIdle: 0,
  /** 倒數徽章的底／邊框／文字顏色。 */
  badgeFill: 'rgba(226, 100, 95, 0.82)',
  badgeStroke: 'rgba(255, 255, 255, 0.95)',
  badgeText: '#FFFFFF',
  /** 徽章邊框粗細，虛擬單位。 */
  badgeStrokeWidth: 3,
  /** 徽章最小寬高，虛擬單位；數字為一位數時仍是一個圓。 */
  badgeMinSize: 56,
  /** 徽章內距，虛擬單位。 */
  badgePaddingX: 18,
  badgePaddingY: 10,
  /** 徽章字級，虛擬單位。 */
  badgeFontSize: 32,
} as const;

/**
 * 一顆要被畫出來的方團團；刻意不是 Matter 的 `Body`，`render/` 不該知道物理引擎的存在。
 * One dumpling to be drawn; deliberately not a Matter `Body`, so `render/` never knows the engine exists.
 */
export interface RenderBody {
  levelId: number;
  x: number;
  y: number;
  /**
   * 碰撞半徑，虛擬單位；決定 sprite 縮放。
   * The collision radius in virtual units; drives the sprite scale.
   */
  radius: number;
  /**
   * 弧度。
   * The angle in radians.
   */
  angle: number;
  /**
   * 額外的畫面縮放倍率：合成剛產生時大於 1，播完回到 1。
   * An extra draw-scale multiplier; above 1 right after a merge, settling back to 1.
   */
  scale?: number;
  /**
   * 目前速度（世界單位／步），選填；供 QA 與除錯讀取（合成是否繼承動量在畫面上看不出來）。
   * Current velocity in world units per step, optional; for QA and debugging (whether a merge inherited momentum is invisible on screen).
   */
  velocity?: { x: number; y: number };
  /**
   * 這一顆是否在技能選取中，以及是第幾顆（1 起算）；用編號而非布林，
   * 第 2 顆才能換色，玩家才看得出「已選第一顆、在等第二顆」。
   * The pick number (1-based) while a skill is selecting; a number rather than a boolean lets the second pick change colour, so the player sees "first picked, waiting for the second".
   */
  pickIndex?: number;
}

/**
 * 投放下落前的預覽。
 * The preview shown before a drop falls.
 */
export interface RenderAim {
  levelId: number;
  x: number;
  /**
   * 預覽的圓心 Y，等於 `GameSession` 的投放高度。
   * The preview's centre Y, equal to `GameSession`'s drop height.
   */
  y: number;
  radius: number;
}

/**
 * sprite 來源；`SpriteLoader` 在結構上已滿足此介面。
 * The sprite source; `SpriteLoader` satisfies it structurally.
 */
export interface SpriteSource {
  get(levelId: number): { image: HTMLImageElement; ok: boolean } | undefined;
}

export interface StageFrame {
  geometry: ContainerGeometry;
  bodies: readonly RenderBody[];
  /**
   * 目前滑鼠位置的投放預覽；null 表示不畫。
   * The drop preview at the current pointer; `null` means do not draw.
   */
  aim: RenderAim | null;
  /**
   * 輔助線的顏色（預覽用）；未提供時用 `AIM_GUIDE_STYLE.color`。
   * The guide colour (for previews); falls back to `AIM_GUIDE_STYLE.color`.
   */
  guideColor?: string;
  /**
   * 溢位警戒；`danger` 為真時顯示紅線、警戒區與中央倒數，未提供或為假時完全不畫。
   * The overflow warning; with `danger` true the line, zone and countdown show — omitted or false draws nothing at all.
   */
  overflow?: {
    /**
     * 紅虛線的 Y（虛擬單位）。
     * The dashed line's Y, in virtual units.
     */
    lineY: number;
    /**
     * 警戒區的上緣（＝線）。
     * The zone's top edge (the line).
     */
    zoneTop: number;
    /**
     * 警戒區的下緣（＝容器頂緣）。
     * The zone's bottom edge (the container rim).
     */
    zoneBottom: number;
    /**
     * 線的左緣 X。
     * The line's left X.
     */
    x: number;
    /**
     * 線的寬度。
     * The line's width.
     */
    width: number;
    /**
     * 是否處於「越線且已停定」的狀態；真＝顯示脈動與倒數。
     * Whether a settled breach is active; true shows the pulse and countdown.
     */
    danger: boolean;
    /**
     * 脈動相位 `0..1`，由迴圈以時間驅動；`0` 代表谷值。
     * The pulse phase `0..1`, driven by the loop's clock; 0 is the trough.
     */
    pulse: number;
    /**
     * 剩餘秒數（整數）；畫在警戒區的正中央。
     * Whole seconds remaining; drawn at the zone's centre.
     */
    secondsLeft: number;
  };
  /**
   * 方團團與投放預覽的裁切上界（虛擬 Y），預設 0（畫布頂端）。
   * The clip's top edge for dumplings and the preview, in virtual Y; defaults to 0 (the canvas top).
   */
  clipTop?: number;
  /**
   * 技能選取的脈動相位 `0..1`（由迴圈以時間驅動）；未提供時標示恆亮。
   * The skill-selection pulse phase `0..1`, driven by the loop's clock; omitted means a steady marker.
   */
  selectionPulse?: number;
  /**
   * 除錯輔助：額外畫出容器外框、物理空腔、投放線與碰撞框標註（僅開發模式的 `?debug=1`）。
   * Debug aids: the container frame, physics cavity, spawn line and collider annotations (development only, behind `?debug=1`).
   */
  debug?: {
    cavity: Rect;
    spawnY: number;
    /**
     * 每顆方團團的碰撞體頂點（世界座標），每個元素是一顆的凸部件清單
     * （圓形只有一個部件，凹輪廓會被引擎拆成數個）；可空，沒有時只是不畫標註。
     * Collider vertices per dumpling in world space, one list per convex part (a circle has one; a concave outline is split into several); optional — absent simply means no annotations.
     */
    colliders?: {
      levelId: number;
      parts: { x: number; y: number }[][];
    }[];
  };
}

/**
 * 由碰撞半徑算出 sprite 的繪製邊長（虛擬單位）。
 * The sprite's draw size for a collision radius, in virtual units.
 */
export function spriteDrawSize(radius: number): number {
  return SPRITE_SIZE * spriteScaleForRadius(radius);
}

/**
 * 畫一顆方團團：優先用素材，素材不可用時退回程式佔位圖。
 * Draws one dumpling, preferring the asset and falling back to the placeholder.
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
 * 畫一條從投放高度垂到下緣的輔助線，讓玩家看得出會落在哪一欄（樣式見 `AIM_GUIDE_STYLE`）。
 * Draws a vertical guide from the drop height to the floor so the landing column is readable (style in `AIM_GUIDE_STYLE`).
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
 * 畫溢位警戒區：紅線與容器頂緣之間的淺紅色帶；畫在方團團之下（背景提示，不是遮罩）。
 * Draws the overflow warning zone: the pale red band between the line and the rim, under the dumplings (a background cue, not an overlay).
 */
function drawOverflowZone(
  ctx: CanvasRenderingContext2D,
  overflow: NonNullable<StageFrame['overflow']>,
): void {
  /* 尚未起算就整段跳過：不畫線、不畫區、不畫倒數。 */
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
 * 畫警戒區正中央的倒數徽章；位置取警戒區中心，容器改尺寸時自動置中，
 * 圓角半徑取 `height / 2`（一位數是正圓、兩位數自動變膠囊）。
 * Draws the countdown badge at the zone's centre, so it re-centres itself when the container resizes; the corner radius is `height / 2` (a circle for one digit, a capsule for two).
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
 * 畫溢位紅線（虛線）；畫在方團團之上，因為它是必須隨時看得見的門檻。
 * Draws the dashed overflow line above the dumplings — a threshold that must stay readable at all times.
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
 * 技能選取標示的樣式：「」角括號 ＋ 一圈加粗白框；括號長度、留白、粗幼與兩色的調參入口。
 * The skill-selection marker's style: 「」corner brackets plus a thickened outline; the tuning entry point for length, padding, weight and the two colours.
 */
const SELECTION_STYLE = {
  /** 角括號的線寬。 */
  strokeWidth: 6,
  /** 白框線寬（比括號細，讓括號成為視覺主角）。 */
  boxWidth: 3,
  /** 標示離方團團外緣的留白。 */
  padding: 9,
  /** 每一段折線的長度。 */
  bracketLength: 24,
  /** 白框圓角。 */
  boxRadius: 12,
  /** 第 1 顆的顏色（白）。 */
  firstColor: 'rgba(255, 255, 255, 0.98)',
  /** 第 2 顆的顏色（琥珀金，與技力條同色，用來區分兩個選取步驟）。 */
  secondColor: 'rgba(249, 255, 81, 0.98)',
  /** 脈動時的 alpha 下限；1 表示不脈動。 */
  pulseAlphaMin: 0.45,
} as const;

/**
 * 畫「」角括號 ＋ 白框，標示技能選取中的方團團。
 * Draws the 「」brackets and outline marking a dumpling picked for a skill.
 *
 * 標示不得位移：幾何完全由半徑決定，永遠跟著方團團卻不影響物理；脈動只改透明度。
 * The marker never moves the body: its geometry is derived from the radius alone, so it follows the dumpling without feeding back into physics; the pulse changes opacity only.
 */
function drawSelectionBracket(
  ctx: CanvasRenderingContext2D,
  body: RenderBody,
  pulse: number,
): void {
  const pick = body.pickIndex;
  if (pick === undefined) return;

  const half = body.radius + SELECTION_STYLE.padding;
  const left = body.x - half;
  const right = body.x + half;
  const top = body.y - half;
  const bottom = body.y + half;
  const length = Math.min(SELECTION_STYLE.bracketLength, half * 2);
  const color = pick > 1 ? SELECTION_STYLE.secondColor : SELECTION_STYLE.firstColor;
  const alpha = SELECTION_STYLE.pulseAlphaMin + (1 - SELECTION_STYLE.pulseAlphaMin) * pulse;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* 白框：一圈圓角矩形，把這顆圈起來。 */
  ctx.strokeStyle = color;
  ctx.lineWidth = SELECTION_STYLE.boxWidth;
  ctx.beginPath();
  ctx.roundRect(
    left,
    top,
    right - left,
    bottom - top,
    Math.min(SELECTION_STYLE.boxRadius, half),
  );
  ctx.stroke();

  /* 角括號：四個角各兩段折線，畫成「」的意象。 */
  ctx.lineWidth = SELECTION_STYLE.strokeWidth;

  const corners: readonly (readonly [number, number, number, number])[] = [
    /* [起點X, 起點Y, 水平方向, 垂直方向] */
    [left, top, 1, 1],
    [right, top, -1, 1],
    [left, bottom, 1, -1],
    [right, bottom, -1, -1],
  ];

  for (const [x, y, hx, vy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + hx * length, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + vy * length);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * 除錯輔助線：容器外框、物理空腔、投放高度，以及碰撞框標註。
 * Debug guides: the container frame, physics cavity, spawn height and collider annotations.
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
 * 畫一個完整的畫面；`ctx` 必須已套用虛擬座標變換（見 `Viewport.applyTransform`）。
 * Draws one complete frame; `ctx` must already be transformed into virtual units (see `Viewport.applyTransform`).
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
   * 用 `clipToPlayField()` 夾在看得見的遊戲區內：素材在圓心上方伸出 2.16 倍半徑，
   * 疊高與投放預覽都會有一截超出畫布；顯式裁切沿容器邊界切齊，而不是讓畫布隨機斷開。
   * All dumplings, rotated by physics and scaled by the pop animation.
   *
   * The clip keeps them inside the visible play field: the art reaches 2.16 radii above the
   * centre, so a tall pile and the preview both overhang the canvas; explicit clipping trims
   * along the container's boundary instead of breaking off at the canvas edge.
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

  /*
   * 4b. 技能選取標示：畫在線框之上（互動提示，任何時候都要讀得到），
   * 且不受遊戲區裁切影響，貼邊的那一顆才不會被切掉半個括號。
   * The skill-selection marker, above the outline (an interaction cue that must always read)
   * and outside the play-field clip so a dumpling at the edge does not lose half its bracket.
   */
  const pulse = frame.selectionPulse ?? 1;
  for (const body of bodies) {
    drawSelectionBracket(ctx, body, pulse);
  }

  /* 5. 溢位紅線壓在最上層，任何時候都讀得到。 */
  if (overflow !== undefined) {
    drawOverflowLine(ctx, overflow);
  }

  /* 5b. 中央倒數徽章：畫在紅線之上，因為它是最需要被讀到的數字。 */
  if (overflow !== undefined) {
    drawOverflowCountdown(ctx, overflow);
  }

  /*
   * 6. 投放預覽畫在最上層（它還沒進到槽裡），同樣套用遊戲區裁切；
   * 且為不透明 —— 預覽是「這一顆確定會掉下去」的承諾，半透明讀起來像「可能會掉」。
   * The drop preview, on top because it has not entered the trough yet, with the same clip;
   * fully opaque — the preview promises "this one will drop", and translucency reads as "maybe".
   *
   * 冷卻期間的隱藏由 `aim === null` 負責，不靠調 alpha —— 那是狀態而非風格。
   * Hiding during the cooldown is `aim === null`'s job, not an alpha trick — that is state, not styling.
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
