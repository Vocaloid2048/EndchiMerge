/**
 * 遊玩區的物理邊界。
 * The play area's physics boundaries.
 *
 * 依 `render/container.ts`：遊戲區 = 容器的 **`frame` 矩形**（平面 U 形的外框），
 * 物理邊界（左右牆＋地板）對齊它。這裡只做「幾何 → 矩形」與「矩形 → 靜態剛體」的換算，
 * 不含任何渲染，因為線框外觀屬於 `render/container.ts`。
 * Per `render/container.ts` the play area is the container's **`frame` rectangle** (the
 * flat U's outer box); the walls align to it. This module only maps geometry to rectangles
 * and rectangles to static bodies — the shell's look belongs to `render/container.ts`.
 *
 * 空腔（cavity）刻意比 frame **往內縮一個牆厚**（`WALL_THICKNESS`）：貼牆的方團團
 * 邊緣因此永遠落在框線內側，不會被線框壓過去或溢出畫布。
 * The cavity is deliberately inset from the frame by one wall thickness so a dumpling
 * resting against a wall always stays inside the drawn outline.
 */

import Matter from 'matter-js';
import { createStaticRect } from '../core/physics';
import { WALL_THICKNESS } from '../core/constants';
import type { Rect } from '../core/types';

/**
 * 左右牆向上延伸的量，避免下落中的方團團從側面溜出。
 * How far the side walls rise above the container's rim so a falling dumpling cannot slip
 * out sideways.
 *
 * **240 是下限，不是定值。** 這裡的數字只保證「蓋過畫布頂端的頭部空間」；實際高度由
 * `computeWallOverhang()` 依容器與投放點算出來，取兩者的較大值。原因是溢位線在頂緣
 * 上方，堆疊接近溢位線時最頂那幾顆的**藝術**（比碰撞體高 2.16 倍半徑）已經很接近畫布
 * 頂端，若牆只到那裡就可能在補齊前被擠出去。
 * **240 is a floor, not the value used.** This number only guarantees the walls clear the
 * headroom at the top of the canvas; the real height comes from `computeWallOverhang()`,
 * which derives it from the container and the drop point and takes the larger of the two. The
 * overflow line sits above the rim, so when a pile nears it the **art** of the topmost
 * dumplings (2.16 radii above the collider) is already close to the canvas top — a wall that
 * stopped there could let them be squeezed out before they settled.
 */
export const DEFAULT_WALL_OVERHANG = 240;

/**
 * 由容器與投放點算出左右牆該往上長多高。
 * Derive how far the side walls must rise, from the container and the drop point.
 *
 * 牆必須同時滿足兩件事：
 * 1. **蓋過投放點** —— 方團團是在 `spawnY` 生成的，若牆頂低於它，剛出現的那一顆就有一
 *    小段時間兩側無遮擋，連續投放時能被互相擠出去。
 * 2. **蓋過溢位線** —— 越線的堆疊是這一局最危急的狀態，那裡的顆粒最需要被框住。
 *
 * 兩者都取「頂緣以上多遠」，再加上 `DEFAULT_WALL_OVERHANG` 的餘裕，最後與下限取大。
 * The walls must satisfy two things at once:
 * 1. **clear the drop point** — dumplings are spawned at `spawnY`, so a wall top below that
 *    leaves the fresh dumpling briefly unfenced and rapid drops can squeeze each other out;
 * 2. **clear the overflow line** — a breaching stack is the most precarious state in the run,
 *    and those are exactly the bodies that most need fencing.
 *
 * Both are measured as "how far above the rim", `DEFAULT_WALL_OVERHANG` of slack is added,
 * and the floor wins if it is larger.
 *
 * @param frameTop 容器頂緣的 Y（虛擬單位）/ The container rim's Y in virtual units.
 * @param spawnY 投放點的 Y；方團團在這裡生成 / The drop point's Y, where dumplings appear.
 * @param overflowLineY 溢位線的 Y / The overflow line's Y.
 */
export function computeWallOverhang(
  frameTop: number,
  spawnY?: number,
  overflowLineY?: number,
): number {
  const candidates = [frameTop - DEFAULT_WALL_OVERHANG];

  /* 投放點與溢位線都轉成「頂緣以上多遠」，再往上多留一段餘裕。 */
  if (spawnY !== undefined && Number.isFinite(spawnY)) {
    candidates.push(spawnY - DEFAULT_WALL_OVERHANG);
  }
  if (overflowLineY !== undefined && Number.isFinite(overflowLineY)) {
    candidates.push(overflowLineY - DEFAULT_WALL_OVERHANG);
  }

  const top = Math.min(...candidates);

  return Math.max(DEFAULT_WALL_OVERHANG, frameTop - top);
}

export interface ContainerBounds {
  /** 空腔：方團團合法活動的矩形。 */
  cavity: Rect;
  /**
   * 三片靜態邊界，依序為左牆、右牆、地板。
   * 刻意回傳陣列而非具名欄位：呼叫端只需要「把它們全部加進世界」，
   * 而測試需要能逐一斷言位置。
   */
  walls: Rect[];
}

/**
 * 由前表面算出空腔。
 * Derive the cavity from the front face.
 *
 * 左右各縮一個牆厚、底部縮一個牆厚，**頂部不縮** —— 方團團要從上方投進來。
 * Insets left/right/bottom by one wall thickness; the top stays open for dropping.
 */
export function computePlayArea(front: Rect, thickness = WALL_THICKNESS): Rect {
  const inset = Math.max(0, thickness);
  return {
    x: front.x + inset,
    y: front.y,
    /* 面板極窄時仍要留至少 1 單位寬，否則 Matter 會拿到退化矩形。 */
    width: Math.max(1, front.width - inset * 2),
    height: Math.max(1, front.height - inset),
  };
}

/**
 * 由前表面算出左牆、右牆、地板三片矩形。
 * Derive the left wall, right wall and floor from the front face.
 *
 * 牆與地板都**往外長**（朝前表面的外側），所以空腔剛好等於 `computePlayArea()`
 * 的結果，兩者不會互相重疊。地板橫跨整個前表面寬度，讓底部兩個轉角沒有縫隙。
 * Every slab grows outward so the cavity matches `computePlayArea()` exactly and the
 * slabs never overlap it. The floor spans the full front width so the bottom corners
 * have no gap.
 */
export function computeWalls(
  front: Rect,
  thickness = WALL_THICKNESS,
  overhang = DEFAULT_WALL_OVERHANG,
): Rect[] {
  const t = Math.max(1, thickness);
  const rise = Math.max(0, overhang);

  const cavity = computePlayArea(front, t);
  const cavityBottom = cavity.y + cavity.height;
  const wallTop = front.y - rise;

  return [
    /* 左牆。 */
    { x: front.x, y: wallTop, width: t, height: cavityBottom - wallTop },
    /* 右牆。 */
    {
      x: cavity.x + cavity.width,
      y: wallTop,
      width: t,
      height: cavityBottom - wallTop,
    },
    /* 地板。 */
    { x: front.x, y: cavityBottom, width: front.width, height: t },
  ];
}

/**
 * 由前表面一次算出空腔與三片邊界。
 * Derive the cavity and all three slabs from the front face in one call.
 */
export function computeContainerBounds(
  front: Rect,
  thickness = WALL_THICKNESS,
  overhang = DEFAULT_WALL_OVERHANG,
): ContainerBounds {
  return {
    cavity: computePlayArea(front, thickness),
    walls: computeWalls(front, thickness, overhang),
  };
}

/**
 * 把矩形轉成靜態剛體。
 * Turn rectangles into static rigid bodies.
 *
 * 矩形在 Matter 是以**中心點**定址，而這裡的矩形是用左上角定址（與 canvas 一致），
 * 換算集中在這裡做一次。
 * Matter addresses rectangles by their centre while our rectangles use a top-left
 * origin to match the canvas; that conversion happens once, here.
 */
export function createContainerBodies(walls: readonly Rect[]): Matter.Body[] {
  return walls.map((wall) =>
    createStaticRect(
      wall.x + wall.width / 2,
      wall.y + wall.height / 2,
      wall.width,
      wall.height,
    ),
  );
}
