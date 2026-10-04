/**
 * Matter.js 引擎封裝。
 * Matter.js engine wrapper.
 *
 * 這一層的職責是**把引擎的形狀固定下來**：`core/` 的其餘模組與 `game/` 只透過這裡
 * 接觸 Matter.js，所以日後若要換引擎（例如升級到 Rapier）或調整求解器參數，只有
 * 一個檔案要改。
 * This layer fixes the engine's shape: the rest of `core/` and all of `game/` touch
 * Matter.js only through here, so replacing the engine or retuning the solver is a
 * one-file change.
 *
 * 為什麼是 Matter.js（design.md §7）：它內建順序衝量求解器與休眠判定，而自寫
 * 碰撞求解最難的部分正是**堆疊穩定性** —— 那恰好是合併類遊戲的命門。
 * Matter.js ships a sequential-impulse solver and sleeping; hand-rolling collision
 * resolution is hardest exactly where merge games live or die — stable stacking.
 */

import Matter from 'matter-js';
import {
  ENGINE_ENABLE_SLEEPING,
  ENGINE_POSITION_ITERATIONS,
  ENGINE_VELOCITY_ITERATIONS,
} from './constants';

export interface PhysicsOptions {
  /** 重力加速度；對應 `levels.json → settings.gravityY`。 */
  gravityY?: number;
}

/**
 * 建立圓形剛體。
 * Create a circular rigid body.
 *
 * 碰撞形狀一律是圓（design.md §4.3）：輪廓多為凹多邊形，需凸分解且在細碎頂點上
 * 抖動；圓是 Matter.js 的高效率路徑，而且畫面與物理的微小落差玩家幾乎無感。
 * Collision shapes are always circles: outlines are concave and jitter badly when
 * decomposed, while circles take Matter's fast path and the visual mismatch is
 * imperceptible.
 *
 * @param x 圓心 X（虛擬單位）/ Centre X in virtual units.
 * @param y 圓心 Y（虛擬單位）/ Centre Y in virtual units.
 * @param radius 半徑（虛擬單位，必須是作者填定的常數）/ Radius in virtual units.
 * @param definition 覆寫密度、彈性、摩擦等 / Density, restitution, friction overrides.
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
 * 建立靜態矩形（牆壁與地板）。
 * Create a static rectangle for walls and the floor.
 *
 * @param x 矩形中心 X / Centre X.
 * @param y 矩形中心 Y / Centre Y.
 * @param width 寬 / Width.
 * @param height 高 / Height.
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
 * 鎖定旋轉。
 * Lock rotation.
 *
 * 依 design.md §4.1，方團團是「平面、直立，不旋轉或僅小幅旋轉」的 sprite。這不只是
 * 美術偏好：碰撞形狀是**圓**而畫面是**方**，一旦自由旋轉，方塊在圓形碰撞體裡轉動
 * 就會把「畫面與物理不一致」這件事直接演給玩家看。
 * Per design.md §4.1 the dumplings are flat, upright sprites with no or only slight
 * rotation. This is not just art direction: the collider is a **circle** while the art
 * is a **square**, so free rotation would visibly betray the mismatch between them.
 *
 * 做法是把慣量設成無限大 —— 力矩除以無限大的慣量得到零角加速度，因此不必每幀歸零
 * 角速度，也不可能被碰撞推歪。
 * Setting inertia to infinity makes angular acceleration zero regardless of torque, so
 * nothing has to be reset each frame and no collision can tip a body over.
 */
export function lockRotation(body: Matter.Body): void {
  Matter.Body.setInertia(body, Number.POSITIVE_INFINITY);
  Matter.Body.setAngularVelocity(body, 0);
}

export class Physics {
  private readonly engine: Matter.Engine;

  constructor(options: PhysicsOptions = {}) {
    this.engine = Matter.Engine.create({
      /* 提高位置迭代可減少堆疊穿透；代價是 CPU（見 constants.ts 的說明）。 */
      positionIterations: ENGINE_POSITION_ITERATIONS,
      velocityIterations: ENGINE_VELOCITY_ITERATIONS,
      enableSleeping: ENGINE_ENABLE_SLEEPING,
      gravity: { x: 0, y: options.gravityY ?? 1, scale: 0.001 },
    });
  }

  /** 底層引擎；僅在必須直接呼叫 Matter API 時使用。 */
  get raw(): Matter.Engine {
    return this.engine;
  }

  /** 世界容器。 */
  get world(): Matter.World {
    return this.engine.world;
  }

  /**
   * 前進一個時間步。
   * Advance one step.
   *
   * @param deltaMs 經過的毫秒；呼叫端應傳入實際經過時間而非固定的 16.7，否則慢速
   *   裝置上物理會變慢。上限由呼叫端夾制。
   *   Pass the real elapsed time, not a fixed 16.7, or physics runs slow on slow
   *   devices.
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

  /** 移除所有非靜態剛體，保留牆壁與地板。 */
  removeDynamicBodies(): void {
    const dynamic = Matter.Composite.allBodies(this.engine.world).filter((body) => !body.isStatic);
    Matter.Composite.remove(this.engine.world, dynamic);
  }

  /**
   * 訂閱碰撞開始事件。
   * Subscribe to collision-start events.
   *
   * M3 只用它來……其實還不用；M4 的合成判定會掛在這裡。先建立介面是刻意的：
   * 碰撞處理器一旦散落在各模組，就再也收不回來。
   * M3 does not need it yet; M4 hangs merge detection here. Building the interface
   * now is deliberate: collision handlers scattered across modules never come back.
   *
   * @returns 取消訂閱的函式 / An unsubscribe function.
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
