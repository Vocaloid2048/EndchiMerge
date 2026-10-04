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
 * 內部填充 → 輔助線 → 方團團 → U 形線框 → 投放預覽。
 * The draw order is the whole effect (see `render/container.ts`): interior fill → guide →
 * dumplings → U outline → drop preview.
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
   * 除錯輔助。提供時額外畫出容器的外框、物理空腔與投放線。
   * Debug overlay. When present, the frame, the physics cavity and the spawn line are
   * outlined as well. Only wired up behind `?debug=1` in development.
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
  const scale = spriteScaleForRadius(body.radius);

  if (entry === undefined || !entry.ok) {
    drawPlaceholderDumpling(ctx, {
      x: body.x,
      y: body.y,
      radius: body.radius,
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
  const { geometry, bodies, aim } = frame;

  /* 1. 槽的內部填充。必須先畫，否則方團團會看起來在外面。 */
  drawContainerBack(ctx, geometry);

  /* 輔助線在 sprite 之下，才不會蓋住方團團。 */
  if (aim !== null) {
    drawAimGuide(ctx, aim, geometry, frame.guideColor ?? AIM_GUIDE_STYLE.color);
  }

  /* 2. 全部方團團（依物理角度翻滾）。 */
  for (const body of bodies) {
    drawBody(ctx, body, sprites);
  }

  /* 3. U 形線框。少了這步就沒有「裝在槽內」的感覺。 */
  drawContainerFront(ctx, geometry);

  /* 4. 投放預覽畫在最上層：它應該壓在線框上，因為它還沒進到槽裡。 */
  if (aim !== null) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawBody(ctx, { ...aim, angle: 0 }, sprites);
    ctx.restore();
  }

  /* 5. 除錯輔助線永遠在最上層，否則看不到。 */
  if (frame.debug !== undefined) {
    drawDebugOverlay(ctx, geometry, frame.debug);
  }
}
