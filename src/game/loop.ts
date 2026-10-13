/**
 * 畫面更新迴圈：推進物理（固定時間步）、繪製、通知 HUD。
 * The frame loop: step physics (fixed timestep), draw, notify the HUD.
 */

import type { SpriteSource } from '../render/stage';
import { drawStage } from '../render/stage';
import type { Viewport } from '../render/viewport';
import type { GameSession } from './session';

/**
 * 固定物理步長，毫秒（60 Hz）。
 * The fixed physics step, in milliseconds (60 Hz).
 */
export const FIXED_STEP_MS = 1000 / 60;

/**
 * 單一畫面最多追趕幾個固定步。
 * The maximum number of fixed steps per frame.
 */
export const MAX_SUBSTEPS = 5;

/**
 * 累加器的浮點容差，毫秒；沒有它，浮點塵埃會讓「剛好一步」被誤判成「還差一點」。
 * Floating-point tolerance for the accumulator; without it, float dust reads "exactly one step" as "just short of one".
 */
const ACCUMULATOR_EPSILON = 1e-9;

export interface FixedStepperOptions {
  stepMs?: number;
  maxSubsteps?: number;
}

/**
 * 把不規則的實際時間切成整數個固定步（獨立成類以利測試累加器邊界）。
 * Slices irregular real time into whole fixed steps (a class so the accumulator's edges are testable).
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

  /**
   * 尚未被消耗的零碎時間，毫秒；除錯與測試用。
   * Unconsumed fractional time, in milliseconds; for debugging and tests.
   */
  get pendingMs(): number {
    return this.accumulator;
  }

  /**
   * 回報這一幀應該跑幾步固定物理。
   * Reports how many fixed steps this frame should run.
   */
  advance(deltaMs: number): number {
    /* 先夾制再累加：負值或離譜的大值都不該進到累加器。 */
    const maxAccumulated = this.stepMs * this.maxSubsteps;
    this.accumulator += Math.min(Math.max(deltaMs, 0), maxAccumulated);

    let steps = 0;
    while (steps < this.maxSubsteps && this.accumulator + ACCUMULATOR_EPSILON >= this.stepMs) {
      /* 用夾制而非直接相減：極小的負累加器會讓下一幀少跑一步。 */
      this.accumulator = Math.max(0, this.accumulator - this.stepMs);
      steps += 1;
    }

    /*
     * 追不上就丟棄落後的時間：留著會讓每一幀都跑滿上限，畫面像慢動作。
     * Discard the lag when we cannot keep up: carrying it pins every frame to the cap and the world runs in slow motion.
     */
    if (this.accumulator + ACCUMULATOR_EPSILON >= this.stepMs) this.accumulator = 0;

    return steps;
  }

  /**
   * 清空累加器；分頁回到前景時呼叫，避免補上一大段時間。
   * Clears the accumulator; call when the tab returns to the foreground.
   */
  reset(): void {
    this.accumulator = 0;
  }
}

export interface FrameLoopOptions {
  viewport: Viewport;
  session: GameSession;
  sprites: SpriteSource;
  /**
   * 每幀繪製完成後呼叫，用來更新 HUD。
   * Called after each frame is drawn, to update the HUD.
   */
  onAfterFrame?: (session: GameSession) => void;
  stepMs?: number;
  maxSubsteps?: number;
  /**
   * 疊加除錯輔助線（容器外框、物理空腔、投放線）；開發時由 `?debug=1` 開啟。
   * Overlays debug guides (container frame, physics cavity, spawn line); enabled by `?debug=1` in development.
   */
  debug?: boolean;
}

export class FrameLoop {
  private readonly viewport: Viewport;
  private readonly session: GameSession;
  private readonly sprites: SpriteSource;
  private readonly onAfterFrame: ((session: GameSession) => void) | undefined;
  private readonly stepper: FixedStepper;
  private readonly stepMs: number;
  private readonly debug: boolean;

  private handle: number | null = null;
  private lastTime = 0;
  /** 最近一幀的時間戳，驅動溢位警戒區與選取標示的脈動。 */
  private nowMs = 0;

  constructor(options: FrameLoopOptions) {
    this.viewport = options.viewport;
    this.session = options.session;
    this.sprites = options.sprites;
    this.onAfterFrame = options.onAfterFrame;
    this.stepMs = options.stepMs ?? FIXED_STEP_MS;
    this.debug = options.debug ?? false;
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
   * 立刻畫一幀，不推進物理（resize 後重繪與截圖驗證用；不會留下計時器）。
   * Draws one frame immediately without stepping physics (post-resize redraws and screenshots; leaves no timer).
   */
  renderOnce(): void {
    this.nowMs = performance.now();
    this.draw();
  }

  private readonly tick = (now: number): void => {
    /* 先排下一幀再做事：即使這一幀拋錯，迴圈也不會安靜地停掉。 */
    this.handle = requestAnimationFrame(this.tick);

    const steps = this.stepper.advance(now - this.lastTime);
    this.lastTime = now;
    this.nowMs = now;

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
        overflow: this.overflowFrame(),
        /*
         * 裁切上界固定為畫布頂端（虛擬 Y = 0）：素材在圓心上方伸出約 2.16 倍半徑，
         * 疊高或投放預覽會有一截超出去，顯式裁掉比讓畫布靜默切斷乾淨。
         * The clip's top is the canvas top (virtual y = 0): the art reaches ~2.16 radii above the
         * centre, so a tall pile or the preview hangs over — an explicit cut beats silent truncation.
         */
        clipTop: 0,
        /*
         * 技能選取的脈動相位（週期約 900ms），由時間推導，渲染器不存狀態；只改透明度。
         * The skill-selection pulse phase (about a 900ms period), derived from the clock so the renderer keeps no state; opacity only.
         */
        selectionPulse: 0.5 + 0.5 * Math.sin(this.nowMs / 450),
        debug: this.debug
          ? {
              cavity: this.session.playArea,
              spawnY: this.session.spawnYValue,
              /* 碰撞框標註：藍點（頂點）＋紅線（邊），對齊輪廓追蹤工具的畫面。 */
              colliders: this.session.colliderOutlines,
            }
          : undefined,
      },
      this.sprites,
    );
  }

  /**
   * 溢位警戒區的畫面資料；脈動相位由時間推導，渲染器本身不必保存狀態。
   * The overflow zone's frame data; the pulse phase is derived from time, so the renderer keeps no state.
   */
  private overflowFrame(): {
    lineY: number;
    zoneTop: number;
    zoneBottom: number;
    x: number;
    width: number;
    danger: boolean;
    pulse: number;
    secondsLeft: number;
  } {
    const frame = this.session.containerGeometry.frame;
    /* 0..1 的正弦脈動；週期 520ms。 */
    const pulse = 0.5 + 0.5 * Math.sin(this.nowMs / 260);

    return {
      lineY: this.session.overflowLineY,
      zoneTop: this.session.overflowLineY,
      zoneBottom: frame.y,
      x: frame.x,
      width: frame.width,
      /*
       * `danger` 只在越線且已入堆判定成立時為真；此前整個警戒（線、區、倒數）都不畫。
       * `danger` is true only for a settled piled breach; before that the whole warning stays hidden.
       */
      danger: this.session.overflowDanger,
      pulse,
      secondsLeft: this.session.overflowSecondsLeft,
    };
  }
}
