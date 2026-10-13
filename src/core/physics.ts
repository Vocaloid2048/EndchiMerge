/**
 * Matter.js 引擎封裝：`core/` 與 `game/` 只透過這裡接觸 Matter.js，換引擎或調參只有一個檔案要改。
 * The Matter.js engine wrapper: the rest of `core/` and all of `game/` touch Matter.js only through here, so swapping the engine or retuning is a one-file change.
 */

import Matter from 'matter-js';
import decomp from 'poly-decomp';
import {
  ENGINE_ENABLE_SLEEPING,
  ENGINE_GRAVITY_SCALE,
  ENGINE_POSITION_ITERATIONS,
  ENGINE_VELOCITY_ITERATIONS,
} from './constants';

/*
 * 把 `poly-decomp` 註冊給 Matter，`Bodies.fromVertices` 才能分解凹多邊形（見
 * `createPolygonBody`）；沒有這一步，凹輪廓會被硬套成凸包。註冊是全域且冪等的。
 * Registers `poly-decomp` so `Bodies.fromVertices` can decompose concave outlines (see
 * `createPolygonBody`); without it a concave outline is forced into its convex hull. Registration is global and idempotent.
 */
Matter.Common.setDecomp(decomp);

export interface PhysicsOptions {
  /**
   * 重力加速度；對應 `levels.json → settings.gravityY`。
   * The gravity acceleration, matching `levels.json → settings.gravityY`.
   */
  gravityY?: number;
}

/**
 * 建立圓形剛體（退回路徑：輪廓載入失敗或退化時才用）。
 * Creates a circular rigid body (the fallback for a failed or degenerate outline).
 */
export function createCircleBody(
  x: number,
  y: number,
  radius: number,
  definition: Matter.IChamferableBodyDefinition = {},
): Matter.Body {
  return Matter.Bodies.circle(x, y, radius, {
    /* 稍高的滑動摩擦讓堆疊不會像撞球一樣散開。 */
    friction: 0.3,
    frictionStatic: 0.5,
    frictionAir: 0.005,
    restitution: 0.15,
    ...definition,
  });
}

/**
 * 共用的剛體材質參數，讓圓形與多邊形手感一致（換形狀不該順便換掉摩擦與彈性）。
 * Shared body material defaults, so circles and polygons feel the same (swapping shape must not silently change friction or restitution).
 */
function materialDefaults(
  definition: Matter.IChamferableBodyDefinition,
): Matter.IChamferableBodyDefinition {
  return {
    /* 稍高的滑動摩擦讓堆疊不會像撞球一樣散開。 */
    friction: 0.3,
    frictionStatic: 0.5,
    frictionAir: 0.005,
    restitution: 0.15,
    ...definition,
  };
}

/**
 * 建立由輪廓多邊形構成的剛體：`fromVertices` 用 `poly-decomp` 把凹多邊形切成凸塊綁成複合剛體。
 * Creates a rigid body from an outline polygon: `fromVertices` cuts a concave polygon into convex pieces bound as one compound body.
 *
 * 多邊形退化或引擎無法分解時回傳 `null`，呼叫端應退回圓形。
 * Returns `null` for a degenerate polygon or a failed decomposition; the caller falls back to a circle.
 */
export function createPolygonBody(
  x: number,
  y: number,
  polygon: readonly { x: number; y: number }[],
  definition: Matter.IChamferableBodyDefinition = {},
): Matter.Body | null {
  if (polygon.length < 3) return null;

  const vertices = polygon.map((point) => ({ x: point.x, y: point.y }));

  try {
    const body = Matter.Bodies.fromVertices(x, y, [vertices], materialDefaults(definition), true);

    /*
     * 判準是質量而不是 `parts.length`：凸多邊形合法地只有一個 part、質量正常；
     * 用 `parts.length` 判斷會把所有正常凸輪廓誤判成失敗而全部退回圓形。
     * The criterion is mass, not `parts.length`: a convex polygon legitimately yields one part with a normal mass, and a parts-count test would reject every valid convex outline.
     */
    if (body === undefined || body === null) return null;
    if (!Number.isFinite(body.mass) || body.mass <= 0) return null;

    return body;
  } catch {
    return null;
  }
}

/**
 * 建立靜态矩形（牆壁與地板）。
 * Creates a static rectangle for walls and the floor.
 */
export function createStaticRect(
  x: number,
  y: number,
  width: number,
  height: number,
  definition: Matter.IChamferableBodyDefinition = {},
): Matter.Body {
  return Matter.Bodies.rectangle(x, y, width, height, {
    isStatic: true,
    /*
     * 牆壁不彈、不滑：球的動能應該被地面吸收，而不是被牆壁丟回來。
     * Walls neither bounce nor slide, so energy is absorbed rather than returned.
     */
    restitution: 0,
    friction: 0.5,
    ...definition,
  });
}

/**
 * 鎖定旋轉（可選，預設不啟用；只在 `levels.json → settings.lockRotation` 為真時呼叫）。
 * Locks rotation (opt-in, off by default; called only when `levels.json → settings.lockRotation` is true).
 *
 * 慣量變成無限大，所有力矩失效，方團團永遠正立。
 * Inertia becomes infinite, every torque produces nothing, and dumplings stay upright forever.
 */
export function lockRotation(body: Matter.Body): void {
  Matter.Body.setInertia(body, Number.POSITIVE_INFINITY);
  Matter.Body.setAngularVelocity(body, 0);
}

/**
 * 把一個剛體沿某方向推出去：位置位移讓穿透立刻消失，速度增量讓分開像「滑開」。
 * Pushes a body along a direction: the position shift removes the penetration immediately, the velocity kick makes the separation read as motion.
 *
 * 用 `Body.translate` 而不是直接改 `position`：前者會同步更新 `bounds` 與 `vertices`，
 * 直接賦值會留下過期幾何，在下一次碰撞偵測爆出幽靈碰撞。
 * Uses `Body.translate` rather than assigning `position`: the former keeps `bounds` and `vertices` in sync, while a raw assignment leaves stale geometry that surfaces as ghost collisions.
 */
export function pushBody(
  body: Matter.Body,
  nx: number,
  ny: number,
  distance: number,
  speed: number,
): void {
  if (distance > 0) Matter.Body.translate(body, { x: nx * distance, y: ny * distance });

  if (speed > 0) {
    Matter.Body.setVelocity(body, {
      x: body.velocity.x + nx * speed,
      y: body.velocity.y + ny * speed,
    });
  }
}

export class Physics {
  private readonly engine: Matter.Engine;

  constructor(options: PhysicsOptions = {}) {
    this.engine = Matter.Engine.create({
      /* 提高位置迭代可減少堆疊穿透；代價是 CPU（見 constants.ts 的說明）。 */
      positionIterations: ENGINE_POSITION_ITERATIONS,
      velocityIterations: ENGINE_VELOCITY_ITERATIONS,
      enableSleeping: ENGINE_ENABLE_SLEEPING,
      gravity: { x: 0, y: options.gravityY ?? 1, scale: ENGINE_GRAVITY_SCALE },
    });
  }

  /**
   * 底層引擎；僅在必須直接呼叫 Matter API 時使用。
   * The raw engine; only for calls that must reach the Matter API directly.
   */
  get raw(): Matter.Engine {
    return this.engine;
  }

  /**
   * 世界容器。
   * The world container.
   */
  get world(): Matter.World {
    return this.engine.world;
  }

  /**
   * 前進一個時間步；應傳入實際經過時間而非固定的 16.7，否則慢速裝置上物理會變慢。
   * Advances one step; pass the real elapsed time, not a fixed 16.7, or physics runs slow on slow devices.
   */
  step(deltaMs: number): void {
    Matter.Engine.update(this.engine, deltaMs);
  }

  setGravity(y: number): void {
    this.engine.gravity.y = y;
  }

  add(...bodies: Matter.Body[]): void {
    Matter.Composite.add(this.engine.world, bodies);
  }

  remove(...bodies: Matter.Body[]): void {
    Matter.Composite.remove(this.engine.world, bodies);
  }

  /**
   * 移除所有非靜態剛體，保留牆壁與地板。
   * Removes every non-static body, keeping the walls and floor.
   */
  removeDynamicBodies(): void {
    const dynamic = Matter.Composite.allBodies(this.engine.world).filter((body) => !body.isStatic);
    Matter.Composite.remove(this.engine.world, dynamic);
  }

  /**
   * 訂閱碰撞開始事件；回傳取消訂閱的函式。
   * Subscribes to collision-start events and returns an unsubscribe function.
   */
  onCollisionStart(handler: (pairs: readonly Matter.Pair[]) => void): () => void {
    const listener = (event: Matter.IEventCollision<Matter.Engine>): void => {
      /* 複製一份再交給外部，避免外部在處理途中又改動引擎的陣列。 */
      handler([...event.pairs]);
    };
    Matter.Events.on(this.engine, 'collisionStart', listener);
    return (): void => {
      Matter.Events.off(this.engine, 'collisionStart', listener);
    };
  }
}
