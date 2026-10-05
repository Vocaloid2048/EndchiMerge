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
import decomp from 'poly-decomp';
import {
  ENGINE_ENABLE_SLEEPING,
  ENGINE_POSITION_ITERATIONS,
  ENGINE_VELOCITY_ITERATIONS,
} from './constants';

/*
 * 把 `poly-decomp` 註冊給 Matter，`Bodies.fromVertices` 才能分解凹多邊形（見
 * `createPolygonBody`）。沒有這一步，「方形身體 ＋ 突出裝飾」的輪廓會被硬套成凸包，玩家
 * 會在沒碰到的地方被推開 —— 那正是我們要避免的。註冊是全域且冪等的，放在模組頂層最單純。
 * Register `poly-decomp` so `Bodies.fromVertices` can decompose concave outlines (see
 * `createPolygonBody`). Without it a concave outline is forced into its convex hull and the
 * player gets pushed apart while visibly clear of the body — the exact failure to avoid.
 * Registration is global and idempotent, so the module top level is the simplest home.
 */
Matter.Common.setDecomp(decomp);

export interface PhysicsOptions {
  /** 重力加速度；對應 `levels.json → settings.gravityY`。 */
  gravityY?: number;
}

/**
 * 建立圓形剛體。
 * Create a circular rigid body.
 *
 * 這是**退回路徑**：輪廓多邊形載入失敗或退化時才用（design.md §4.3 的原始設計）。圓是
 * Matter.js 的高效率路徑，但方團團的方形身體與裝飾讓它與畫面有落差，因此預設改用
 * `createPolygonBody()`；圓只保留給「輪廓拿不到」的情況。
 * This is the **fallback**: used when the outline polygon fails to load or is degenerate.
 * Circles are Matter's fast path, but the square body and decorations make them visibly
 * wrong, so `createPolygonBody()` is the default; the circle survives only for the case
 * where no outline could be derived.
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
 * 共用的剛體材質參數。
 * Shared body material defaults.
 *
 * 抽出來是為了讓圓形與多邊形**手感一致**：換碰撞形狀不該順便換掉摩擦與彈性，否則調參時
 * 會分不清是形狀還是材質造成的差異。
 * Extracted so circles and polygons **feel the same**: swapping the collider shape must not
 * silently change friction or restitution, or tuning would confound the two.
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
 * 建立**由輪廓多邊形**構成的剛體（光柵化輪廓法的落點）。
 * Create a rigid body from an **outline polygon** (where rasterised contour tracing lands).
 *
 * `Matter.Bodies.fromVertices` 會用 `poly-decomp` 把凹多邊形切成數個凸塊，並把它們綁成
 * 一個複合剛體 —— 這正是方團團「方形身體 ＋ 突出裝飾」需要的行為。
 * `Matter.Bodies.fromVertices` uses `poly-decomp` to cut a concave polygon into convex
 * pieces bound as one compound body — exactly what a square body with protruding
 * decorations needs.
 *
 * @param x 質心 X（虛擬單位）/ Centre-of-mass X in virtual units.
 * @param y 質心 Y（虛擬單位）/ Centre-of-mass Y in virtual units.
 * @param polygon 相對質心的輪廓頂點（虛擬單位）/ Outline vertices relative to the centre.
 * @param definition 覆寫密度、彈性、摩擦等 / Density, restitution, friction overrides.
 * @returns 成功時回傳剛體；多邊形退化或引擎無法分解時回傳 `null`，呼叫端應退回圓形。
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
     * 判準是**質量**而不是 `parts.length`：凸多邊形分解後只有一個 part（本體）也是合法的
     * 剛體（實測 `parts.length === 1`、質量正常），而分解失敗才會得到零質量空殼。用
     * `parts.length` 判斷會把所有正常凸輪廓誤判成失敗，全部退回圓形。
     * The criterion is **mass**, not `parts.length`: a convex polygon legitimately yields one
     * part (the body itself) with a normal mass, while only a failed decomposition produces a
     * zero-mass shell. Testing `parts.length` would reject every valid convex outline and
     * quietly fall back to circles for all of them.
     */
    if (body === undefined || body === null) return null;
    if (!Number.isFinite(body.mass) || body.mass <= 0) return null;

    return body;
  } catch {
    return null;
  }
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
 * 鎖定旋轉（**可選**，預設不啟用）。
 * Lock rotation (**opt-in**, off by default).
 *
 * 只有在 `levels.json → settings.lockRotation` 為 `true` 時才會呼叫。預設是**讓物理
 * 自由轉動**：碰撞產生的力矩會讓方團團翻滾、沿斜面滾落，堆積因而自然。
 * Called only when `levels.json → settings.lockRotation` is `true`. By default rotation is
 * **left to the engine**: contact torques tumble the dumplings and roll them down slopes,
 * which is what makes a pile settle naturally.
 *
 * 代價要知道：碰撞體是**輪廓多邊形**而畫面是方形 sprite，自由旋轉時兩者角度一致，所以
 * 落差反而變小（這正是採用輪廓碰撞框的理由）。要換回舊的直立手感就打開 `lockRotation`，
 * 那一瞬間所有力矩都失效（慣量無限大），方團團永遠正立。
 * The cost is worth knowing: the collider is an **outline polygon** while the art is a square
 * sprite. Free rotation keeps the two at the same angle, so the mismatch is *smaller* than
 * with a circle — which is why the outline collider was adopted. Flip `lockRotation` on to
 * get the old always-upright feel back: inertia becomes infinite, so every torque produces
 * zero angular acceleration.
 */
export function lockRotation(body: Matter.Body): void {
  Matter.Body.setInertia(body, Number.POSITIVE_INFINITY);
  Matter.Body.setAngularVelocity(body, 0);
}

/**
 * 把一個剛體沿某方向推出去（**位置**位移＋速度增量）。
 * Push a body along a direction — a **position** shift plus a velocity kick.
 *
 * 兩者都要，而且各有用途：
 *  - **位置**位移讓穿透**立刻**消失。只給速度的話，這一幀畫面仍然是穿模的，玩家會看到
 *    一瞬間的錯誤，然後才分開。
 *  - **速度**增量讓它「繼續往外走」而不是被推回原位，分開的動作才有物理感。
 * Two parts, each doing its own job: the **position** shift removes the penetration
 * immediately (velocity alone would leave one visibly wrong frame before anything separates),
 * and the velocity kick carries the body outward so the separation reads as motion rather than
 * a teleport.
 *
 * 用 `Body.translate` 而不是直接改 `position`：前者會同步更新 `bounds`、`vertices` 與
 * 質心，直接賦值只改位置、讓快取幾何與位置不一致 —— 那會在下一次碰撞偵測時爆出幽靈碰撞。
 * Uses `Body.translate` rather than assigning `position`: the former keeps `bounds`, `vertices`
 * and the centre of mass in sync, while a raw assignment leaves cached geometry stale — which
 * surfaces later as ghost collisions.
 *
 * @param body 目標剛體 / The body to push.
 * @param nx 方向單位向量 X / Unit direction X.
 * @param ny 方向單位向量 Y / Unit direction Y.
 * @param distance 位置位移量（世界單位）/ Position shift in world units.
 * @param speed 速度增量（世界單位／步）/ Velocity kick in world units per step.
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
