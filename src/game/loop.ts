/**
 * 畫面更新迴圈。
 * The frame loop.
 *
 * 每幀做三件事：推進物理、把狀態畫出來、通知外部（HUD）。刻意只有這三件 ——
 * 迴圈一旦開始夾帶規則，就會變成誰都不敢改的上帝物件。
 * Three things per frame: step physics, draw the state, notify the outside world (the
 * HUD). Deliberately only three — a loop that accumulates rules becomes untouchable.
 *
 * **物理用固定時間步**，由累加器把實際經過時間切成整數個 1/60 秒。這樣做的理由：
 * Physics runs on a **fixed timestep**, with an accumulator slicing real elapsed time
 * into whole 1/60s steps, because:
 *
 * 1. Matter.js 自己在 delta > 16.667ms 時會發出警告，而且大步長的求解精度會下降 ——
 *    合併類遊戲最容易出事的地方正是**堆疊穩定性**。
 *    Matter.js warns above 16.667ms and a large step loses solver accuracy exactly
 *    where merge games are most fragile: stable stacking.
 * 2. 用實際 delta 直接餵引擎會讓物理行為隨螢幕更新率改變（120Hz 與 60Hz 手感不同）。
 *    Feeding the raw delta makes physics depend on the display refresh rate.
 *
 * 步數上限是為了避免「追趕螺旋」：分頁回到前景時若累積了數十秒，一次補完會把整箱
 * 方團團炸開。上限之外的時間直接丟棄。
 * The step cap prevents a catch-up spiral: returning from a backgrounded tab with tens
 * of seconds accumulated would blow the box apart, so the excess is discarded.
 */

import type { SpriteSource } from '../render/stage';
import { drawStage } from '../render/stage';
import type { Viewport } from '../render/viewport';
import type { GameSession } from './session';

/** 固定物理步長，毫秒（60 Hz）。 */
export const FIXED_STEP_MS = 1000 / 60;

/** 單一畫面最多追趕幾個固定步。 */
export const MAX_SUBSTEPS = 5;

/**
 * 累加器的浮點容差，毫秒。
 * Floating-point tolerance for the accumulator, in milliseconds.
 *
 * 沒有它，`stepMs * maxSubsteps` 這種乘法再連減會留下一點點浮點塵埃，
 * 讓「一大段時間」只跑 `maxSubsteps - 1` 步。差一步在畫面上看不出來，
 * 但會讓物理的實際速率靜默地比預期慢，而且只在特定更新率下發生。
 * Without it, multiplying and repeatedly subtracting leaves float dust that makes a
 * large delta run `maxSubsteps - 1` steps. One step is invisible on screen but
 * silently slows the simulation, and only at certain refresh rates.
 */
const ACCUMULATOR_EPSILON = 1e-9;

export interface FixedStepperOptions {
  stepMs?: number;
  maxSubsteps?: number;
}

/**
 * 把不規則的實際時間切成整數個固定步。
 * Slice irregular real time into a whole number of fixed steps.
 *
 * 獨立成一個類別是為了可測試：累加器的邊界（正好等於一步、剛好差一點）是最容易寫錯
 * 又最難在畫面上察覺的地方。
 * Split out as a class so it can be tested: the accumulator's boundaries are the
 * easiest thing to get wrong and the hardest to notice on screen.
 */
export class FixedStepper {
  private readonly stepMs: number;
  private readonly maxSubsteps: number;
  private accumulator = 0;

  constructor(options: FixedStepperOptions = {}) {
    this.stepMs = options.stepMs ?? FIXED_STEP_MS;
    this.maxSubsteps = options.maxSubsteps ?? MAX_SUBSTEPS;

    if (this.stepMs <= 0) {
      throw new RangeError(`FixedStepper requires a positive step size, received ${String(this.stepMs)}.`);
    }
    if (!Number.isInteger(this.maxSubsteps) || this.maxSubsteps < 1) {
      throw new RangeError(
        `FixedStepper requires a positive integer substep cap, received ${String(this.maxSubsteps)}.`,
      );
    }
  }

  /** 尚未被消耗的零碎時間，毫秒。除錯與測試用。 */
  get pendingMs(): number {
    return this.accumulator;
  }

  /**
   * 回報這一幀應該跑幾步固定物理。
   * Report how many fixed steps this frame should run.
   *
   * @param deltaMs 距上一幀的實際毫秒 / Real elapsed milliseconds.
   */
  advance(deltaMs: number): number {
    /* 先夾制再累加：負值或離譜的大值都不該進到累加器。 */
    const maxAccumulated = this.stepMs * this.maxSubsteps;
    this.accumulator += Math.min(Math.max(deltaMs, 0), maxAccumulated);

    let steps = 0;
    /*
     * `+ EPSILON` 讓「剛好一步」不會因為浮點誤差被判成「還差一點」。迴圈本身也受
     * `maxSubsteps` 約束，所以放寬比較不會導致超步。
     * The epsilon keeps "exactly one step" from reading as "just short of one". The
     * loop is still bounded by maxSubsteps, so relaxing the comparison cannot overrun.
     */
    while (steps < this.maxSubsteps && this.accumulator + ACCUMULATOR_EPSILON >= this.stepMs) {
      /*
       * 用 `Math.max(0, ...)` 而非直接相減：減完可能落在極小的負值，負的累加器會
       * 讓下一幀少跑一步，症狀和浮點塵埃一樣難查。
       * Clamped rather than a plain subtraction: the result can land on a tiny negative,
       * and a negative accumulator costs the next frame a step — just as hard to trace.
       */
      this.accumulator = Math.max(0, this.accumulator - this.stepMs);
      steps += 1;
    }

    /*
     * 追不上就放棄落後的時間，而不是留著下一幀繼續追 —— 留著會讓每一幀都跑滿上限，
     * 物理永遠追不上真實時間，畫面看起來像慢動作。
     * When we cannot keep up, discard the lag rather than carrying it: keeping it makes
     * every subsequent frame hit the cap and the world runs in slow motion.
     */
    if (this.accumulator + ACCUMULATOR_EPSILON >= this.stepMs) this.accumulator = 0;

    return steps;
  }

  /** 清空累加器；分頁回到前景時呼叫，避免補上一大段時間。 */
  reset(): void {
    this.accumulator = 0;
  }
}

export interface FrameLoopOptions {
  viewport: Viewport;
  session: GameSession;
  sprites: SpriteSource;
  /** 每幀繪製完成後呼叫，用來更新 HUD。 */
  onAfterFrame?: (session: GameSession) => void;
  /** 覆寫固定步長。 */
  stepMs?: number;
  /** 覆寫單幀最大步數。 */
  maxSubsteps?: number;
}

export class FrameLoop {
  private readonly viewport: Viewport;
  private readonly session: GameSession;
  private readonly sprites: SpriteSource;
  private readonly onAfterFrame: ((session: GameSession) => void) | undefined;
  private readonly stepper: FixedStepper;
  private readonly stepMs: number;

  private handle: number | null = null;
  private lastTime = 0;

  constructor(options: FrameLoopOptions) {
    this.viewport = options.viewport;
    this.session = options.session;
    this.sprites = options.sprites;
    this.onAfterFrame = options.onAfterFrame;
    this.stepMs = options.stepMs ?? FIXED_STEP_MS;
    this.stepper = new FixedStepper({ stepMs: this.stepMs, maxSubsteps: options.maxSubsteps });
  }

  get running(): boolean {
    return this.handle !== null;
  }

  start(): void {
    if (this.handle !== null) return;

    this.stepper.reset();
    this.lastTime = performance.now();
    this.handle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.handle === null) return;

    cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  /**
   * 立刻畫一幀，不推進物理。
   * Draw one frame immediately without stepping physics.
   *
   * 給 resize 後的重繪與截圖驗證使用；不啟動迴圈，所以不會有計時器殘留。
   * Used for post-resize redraws and screenshot verification; it does not start the
   * loop, so nothing is left ticking.
   */
  renderOnce(): void {
    this.draw();
  }

  private readonly tick = (now: number): void => {
    /* 先排下一幀再做事：如此即使這一幀拋錯，迴圈也不會安靜地停掉。 */
    this.handle = requestAnimationFrame(this.tick);

    const steps = this.stepper.advance(now - this.lastTime);
    this.lastTime = now;

    for (let index = 0; index < steps; index += 1) {
      this.session.step(this.stepMs);
    }

    this.draw();
    this.onAfterFrame?.(this.session);
  };

  private draw(): void {
    /* `clear()` 會順便套用虛擬座標變換，之後所有繪製都用虛擬單位。 */
    this.viewport.clear();
    drawStage(
      this.viewport.context,
      {
        geometry: this.session.containerGeometry,
        bodies: this.session.bodies,
        aim: this.session.aimPreview,
      },
      this.sprites,
    );
  }
}
