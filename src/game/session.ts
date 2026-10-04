/**
 * 單局狀態。
 * One play session.
 *
 * M3 的範圍是「可以丟方團團」（design.md §8），所以這裡只做三件事：**投放**、
 * **瞄準**、以及把物理狀態投影成畫面資料。合成、Combo、彈跳動畫屬 M4。
 * M3 only needs "you can throw dumplings", so this holds drops, aiming, and the
 * projection of physics into render data. Merging, combos and pop animations are M4.
 *
 * 刻意**不**在這裡做的兩件事，都是刻意的範圍界線：
 * Two things are deliberately left out, both as scope boundaries:
 *
 * 1. **管理掉落順序** —— 那屬於 `SpawnQueue`（D22 的單一真實來源）。這裡只呼叫
 *    `take()`，絕不自行抽取，否則 NEXT 卡又會和實際掉落不一致。
 *    Spawn ordering belongs to `SpawnQueue`; this only calls `take()`, never draws,
 *    or the NEXT card drifts from the actual drop again.
 * 2. **判定溢出／上限** —— `maxBodies`、`overflowPenalty` 的規則在 design.md §10
 *    尚未定案。這裡只做「離開場地就回收」，避免剛體無限累積。
 *    Overflow rules are undecided (§10); this only recycles bodies that leave the
 *    field so the body count cannot grow without bound.
 */

import Matter from 'matter-js';
import { createCircleBody, lockRotation, Physics } from '../core/physics';
import { computeContainerBounds, createContainerBodies } from './containerBox';
import { SpawnQueue } from './spawnQueue';
import { computeContainerGeometry, type ContainerGeometry } from '../render/container';
import { createRng, type Rng } from '../core/rng';
import { WALL_THICKNESS } from '../core/constants';
import type { AllConfig, LevelDef, Rect } from '../core/types';
import type { RenderAim, RenderBody } from '../render/stage';

/**
 * 剛體離場多遠才算「真的不見了」。
 * How far outside the field a body must be before it counts as gone.
 *
 * 留一大段餘裕是為了不誤殺：被擠到牆上方（牆有 `DEFAULT_WALL_OVERHANG` 的延伸）
 * 或暫時被彈到高處的方團團都還算在場。
 * The margin is generous so a dumpling squeezed above the lip or bounced high is not
 * mistaken for a lost one.
 */
const FALL_OUT_MARGIN = 400;

export interface GameSessionOptions {
  config: AllConfig;
  /** 可注入的亂數來源；未提供時用固定種子以便重播。 */
  rng?: Rng;
  /** 覆寫亂數種子；只有未提供 `rng` 時有效。 */
  seed?: number;
  /** 初始虛擬寬度；之後由 `resize()` 更新。 */
  virtualWidth?: number;
  /** 虛擬高度；預設 1000。 */
  virtualHeight?: number;
}

export class GameSession {
  private readonly config: AllConfig;
  private readonly physics: Physics;
  private readonly spawnQueue: SpawnQueue;
  private readonly levels: readonly LevelDef[];

  private geometry: ContainerGeometry;
  private cavity: Rect;
  private wallBodies: Matter.Body[] = [];
  private dropped: { body: Matter.Body; level: LevelDef }[] = [];

  private virtualHeight: number;
  private aimX: number;

  constructor(options: GameSessionOptions) {
    this.config = options.config;
    this.levels = options.config.levels.levels;
    this.virtualHeight = options.virtualHeight ?? 1000;

    this.physics = new Physics({ gravityY: this.config.levels.settings.gravityY });
    this.spawnQueue = new SpawnQueue({
      levels: this.levels,
      rng: options.rng ?? createRng(options.seed ?? 1),
    });

    /* 先建一次，讓 `aimX` 與牆壁在任何 resize 之前就有合法值。 */
    this.geometry = this.buildGeometry(options.virtualWidth ?? 500, this.virtualHeight);
    this.cavity = computeContainerBounds(this.geometry.front, WALL_THICKNESS).cavity;
    this.aimX = this.cavity.x + this.cavity.width / 2;
    this.applyWalls();
  }

  /* ------------------------------------------------------------------ 幾何 */

  /** 目前的容器線框幾何；渲染器直接使用。 */
  get containerGeometry(): ContainerGeometry {
    return this.geometry;
  }

  /** 空腔邊界；除錯與測試用。 */
  get playArea(): Rect {
    return this.cavity;
  }

  /**
   * 依新的虛擬尺寸重算幾何與牆壁。
   * Recompute geometry and walls for a new virtual size.
   *
   * **不動既有剛體的位置**：它們的座標本來就是虛擬單位，鎖虛擬高度下換裝置
   * 只改變可用寬度（design.md §2.4）。這正是鎖高度的好處。
   * Existing bodies are not moved: their coordinates are already virtual units, and
   * locking the height means only the available width changes.
   */
  resize(virtualWidth: number, virtualHeight: number): void {
    if (virtualWidth <= 0 || virtualHeight <= 0) return;

    this.virtualHeight = virtualHeight;
    this.geometry = this.buildGeometry(virtualWidth, virtualHeight);
    this.cavity = computeContainerBounds(this.geometry.front, WALL_THICKNESS).cavity;
    this.applyWalls();
    this.aimX = this.clampAimX(this.aimX, this.nextLevel().radius);
  }

  private buildGeometry(virtualWidth: number, virtualHeight: number): ContainerGeometry {
    return computeContainerGeometry(virtualWidth, virtualHeight, this.config.container);
  }

  /** 換掉牆壁：先移除舊的再加新的，避免 resize 後留下兩套重疊的牆。 */
  private applyWalls(): void {
    if (this.wallBodies.length > 0) {
      this.physics.remove(...this.wallBodies);
    }
    const bounds = computeContainerBounds(this.geometry.front, WALL_THICKNESS);
    this.wallBodies = createContainerBodies(bounds.walls);
    this.physics.add(...this.wallBodies);
  }

  /* ------------------------------------------------------------------ 瞄準 */

  /** 目前瞄準的虛擬 X（已夾在空腔內）。 */
  get aimXValue(): number {
    return this.aimX;
  }

  /**
   * 設定瞄準位置。超出空腔時會夾到「方團團剛好貼牆」的位置。
   * Set the aim position, clamping so the dumpling just fits against the wall.
   */
  setAim(x: number): void {
    this.aimX = this.clampAimX(x, this.nextLevel().radius);
  }

  /** 把 X 夾到目前等級的半徑能完整放進空腔的範圍。 */
  private clampAimX(x: number, radius: number): number {
    const min = this.cavity.x + radius;
    const max = this.cavity.x + this.cavity.width - radius;

    /* 空腔比直徑還窄時 min > max，此時置中比夾到某側合理。 */
    if (min > max) return this.cavity.x + this.cavity.width / 2;

    return Math.min(Math.max(x, min), max);
  }

  /* ------------------------------------------------------------------ 投放 */

  /** 目前佇列最前面的等級編號；NEXT 卡要顯示的就是它。 */
  get nextLevelId(): number {
    return this.spawnQueue.peek();
  }

  /** 下一顆的完整定義。 */
  nextLevel(): LevelDef {
    return this.levelDef(this.spawnQueue.peek());
  }

  /**
   * 投放一顆。座標取自目前瞄準位置，等級取自佇列最前面。
   * Drop one dumpling at the current aim position, using the front of the queue.
   *
   * 因為等級是 `take()` 出來的，**掉下來的必然就是 NEXT 卡顯示的那一顆**（D22）。
   * Because the level comes from `take()`, what falls is necessarily what the NEXT
   * card showed (D22).
   */
  drop(): void {
    /*
     * 先 `take()` 再查定義：等級只讀一次，就不存在「peek 與 take 之間被換掉」的
     * 想像空間。掉下來的必然是最初預覽的那一顆。
     * Take first, then look up: reading the level once removes any room for the peek
     * and the take to disagree.
     */
    const id = this.spawnQueue.take();
    const level = this.levelDef(id);
    const x = this.clampAimX(this.aimX, level.radius);
    const y = this.config.levels.settings.aimY;

    const body = createCircleBody(x, y, level.radius, {
      density: level.density,
      restitution: level.restitution,
      friction: level.friction,
      frictionAir: level.frictionAir,
      /* 標記起來，除錯時看得出這顆是哪一級。 */
      label: `level-${String(id)}`,
    });

    /* design.md §4.1：sprite 必須保持直立，理由見 `lockRotation`。 */
    lockRotation(body);

    this.physics.add(body);
    this.dropped.push({ body, level });
  }

  /* ------------------------------------------------------------------ 推進 */

  /** 前進一步物理，並回收離場的剛體。 */
  step(deltaMs: number): void {
    this.physics.step(deltaMs);
    this.recycle();
  }

  private recycle(): void {
    const floor = this.geometry.front.y + this.geometry.front.height;
    const survivors: { body: Matter.Body; level: LevelDef }[] = [];
    const removed: Matter.Body[] = [];

    for (const entry of this.dropped) {
      const { y } = entry.body.position;
      const gone = y > floor + FALL_OUT_MARGIN || y < this.geometry.front.y - FALL_OUT_MARGIN;

      if (gone) removed.push(entry.body);
      else survivors.push(entry);
    }

    if (removed.length === 0) return;

    this.physics.remove(...removed);
    this.dropped = survivors;
  }

  /* ------------------------------------------------------------------ 輸出 */

  /** 場上所有方團團的畫面資料。 */
  get bodies(): RenderBody[] {
    return this.dropped.map((entry) => ({
      levelId: entry.level.id,
      x: entry.body.position.x,
      y: entry.body.position.y,
      radius: entry.level.radius,
      angle: entry.body.angle,
    }));
  }

  /** 投放預覽；`aimY` 就是預覽圓心的高度。 */
  get aimPreview(): RenderAim {
    const level = this.nextLevel();

    return {
      levelId: level.id,
      x: this.clampAimX(this.aimX, level.radius),
      y: this.config.levels.settings.aimY,
      radius: level.radius,
    };
  }

  /** 已投放的顆數。 */
  get dropCount(): number {
    return this.dropped.length;
  }

  /**
   * 目前分數。M3 尚未有合成，所以恆為 0；M4 會接上 `LevelDef.score`。
   * Current score. Always 0 in M3 because merging does not exist yet; M4 wires it up.
   */
  get score(): number {
    return 0;
  }

  /** 累計合成次數。M3 恆為 0，理由同上。 */
  get mergedCount(): number {
    return 0;
  }

  /** 目前虛擬高度。 */
  get virtualHeightValue(): number {
    return this.virtualHeight;
  }

  /* 依等級編號取回定義；編號來自佇列，必然存在，所以找不到就代表有真 bug。 */
  private levelDef(id: number): LevelDef {
    const level = this.levels.find((entry) => entry.id === id);

    if (level === undefined) {
      throw new Error(`Level ${String(id)} is missing from the level table.`);
    }

    return level;
  }
}
