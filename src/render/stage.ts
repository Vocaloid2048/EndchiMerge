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
import { drawContainerBack, drawContainerFront } from './container';
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

/** 除錯輔助線的樣式；只在 `StageFrame.debug` 存在時使用。 */
const DEBUG_STYLE = {
  lineWidth: 1.5,
  frame: 'rgba(255, 84, 160, 0.95)',
  cavity: 'rgba(90, 220, 255, 0.95)',
  spawn: 'rgba(255, 214, 92, 0.95)',
} as const;

/**
 * 溢位線與警戒區的樣式。
 * Overflow line and warning-zone style.
 *
 * **調參入口**：紅線的粗幼／顏色、警戒區的填色都在這裡改。
 * **The tuning entry point** for the line's weight and colour and the zone's fill.
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
  zoneAlphaMin: 0.1,
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
   * 溢位警戒；`danger` 為真時啟動脈動。未提供時不畫線也不畫區。
   * Overflow warning; when `danger` is true the zone pulses. Omitted means nothing is drawn.
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
    /** 是否處於越線狀態；真＝脈動。 */
    danger: boolean;
    /** 脈動相位 `0..1`，由迴圈以時間驅動；`0` 代表谷值。 */
    pulse: number;
  };
  /**
   * 除錯輔助。提供時額外畫出容器的外框、物理空腔與投放線。
   * Only wired up behind `?debug=1` in development.
   */
  debug?: {
    cavity: Rect;
    spawnY: number;
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
  const top = Math.min(overflow.zoneTop, overflow.zoneBottom);
  const height = Math.abs(overflow.zoneBottom - overflow.zoneTop);
  if (height <= 0) return;

  const alpha = overflow.danger
    ? OVERFLOW_STYLE.zoneAlphaMin +
      (OVERFLOW_STYLE.zoneAlphaMax - OVERFLOW_STYLE.zoneAlphaMin) * overflow.pulse
    : OVERFLOW_STYLE.zoneAlphaMin;

  ctx.save();
  ctx.fillStyle = `rgba(${OVERFLOW_STYLE.zoneColor}, ${alpha.toFixed(3)})`;
  ctx.fillRect(overflow.x, top, overflow.width, height);
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
 * 除錯輔助線：容器外框、物理空腔、投放高度。
 * Debug guides: container frame, physics cavity and spawn height.
 */
function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  geometry: ContainerGeometry,
  debug: NonNullable<StageFrame['debug']>,
): void {
  const { frame } = geometry;
  const { cavity, spawnY } = debug;

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

  /* 3. 全部方團團（依物理角度翻滾、依彈跳動畫縮放）。 */
  for (const body of bodies) {
    drawBody(ctx, body, sprites);
  }

  /* 4. U 形線框。少了這步就沒有「裝在槽內」的感覺。 */
  drawContainerFront(ctx, geometry);

  /* 5. 溢位紅線壓在最上層，任何時候都讀得到。 */
  if (overflow !== undefined) {
    drawOverflowLine(ctx, overflow);
  }

  /* 6. 投放預覽畫在最上層：它應該壓在線框上，因為它還沒進到槽裡。 */
  if (aim !== null) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawBody(ctx, { ...aim, angle: 0 }, sprites);
    ctx.restore();
  }

  /* 7. 除錯輔助線永遠在最上層，否則看不到。 */
  if (frame.debug !== undefined) {
    drawDebugOverlay(ctx, geometry, frame.debug);
  }
}
