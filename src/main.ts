import './styles/main.css';
import { attachDropInput } from './core/input';
import { loadConfig } from './core/configLoader';
import type { AllConfig } from './core/types';
import { FrameLoop } from './game/loop';
import { createProgressStore, type ProgressStore } from './game/progress';
import { GameSession } from './game/session';
import { SpriteLoader } from './render/spriteLoader';
import { buildSilhouetteCache } from './render/silhouetteLoader';
import { Viewport } from './render/viewport';
import { hook } from './ui/dom';
import { createGameOver, type GameOverView } from './ui/gameOver';
import { Hud } from './ui/hud';
import { createLayout, type Layout } from './ui/layout';
import { createMeltingList, type MeltingList } from './ui/meltingList';
import { createNotice } from './ui/notice';
import { attachStageScale } from './ui/scale';
import { createSpMeter, type SpMeter } from './ui/spMeter';

/**
 * 應用程式入口。
 * Application entry point.
 *
 * `main.ts` 只做**組裝**：載入配置與素材、建立版面與視埠，再把各模組接起來。
 * 它不含任何遊戲邏輯（agent-readme §0.2 的依賴方向）。
 * This file only assembles: it loads config and assets, builds the layout and the viewport,
 * and wires the modules together. It holds no game logic.
 */

/** 執行期共享的組裝結果。 */
export interface AppContext {
  config: AllConfig;
  sprites: SpriteLoader;
  viewport: Viewport;
  layout: Layout;
  progress: ProgressStore;
  meltingList: MeltingList;
  spMeter: SpMeter;
  session: GameSession;
  hud: Hud;
  loop: FrameLoop;
  gameOver: GameOverView;
  /** 卸下投放輸入的事件綁定。 */
  detachInput: () => void;
  /** 停止監看視窗尺寸與名冊尺寸。 */
  detachScale: () => void;
}

async function bootstrap(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#app');

  if (host === null) {
    throw new Error('Root element "#app" is missing from index.html.');
  }

  /* 先建版面：即使配置或素材全部失敗，玩家至少看得到骨架與非官方聲明。 */
  const layout = createLayout(host);

  /*
   * 版面一建好就開始等比縮放，而不是等配置載入完 —— 否則在那段時間裡畫面會是一張
   * 超出視窗、被裁掉大半的 1920×1080 畫布。
   */
  const detachScale = attachStageScale({ stage: layout.stage });

  const config = await loadConfig();

  document.title = `${config.branding.gameName} ${config.branding.gameNameZh}`;
  layout.notice.append(createNotice({ zh: config.branding.noticeZh, en: config.branding.notice }));

  /* 技力條的段數由 `sp.max` 決定（一點一條），所以要在配置到手之後才建。 */
  const spMeter = createSpMeter(hook<HTMLElement>(layout.regions.skill, 'sp-meter'));
  spMeter.update({ value: config.skills.sp.initial, max: config.skills.sp.max });

  /* 素材載入失敗不會拋錯，失敗的等級之後會退回程式佔位圖。 */
  const sprites = new SpriteLoader();
  await sprites.loadAll(config.levels.levels);

  /*
   * 輪廓碰撞框（光柵化輪廓法）：素材一到手就為整條合成鏈導出多邊形。失敗的等級記為
   * `null`，遊玩時退回圓形 —— 缺一張圖不該讓整個遊戲開不起來。
   * Outline colliders: outlines are derived for the whole chain as soon as assets arrive.
   * A failed level is recorded as `null` and falls back to a circle; one bad image must not
   * stop the game.
   */
  const silhouettes = buildSilhouetteCache(config.levels.levels, sprites);

  const canvas = hook<HTMLCanvasElement>(layout.regions.container, 'stage-canvas');
  const viewport = new Viewport(canvas);

  /*
   * meta-progression：解鎖與最高分跨局存活（design.md D5）。
   * 鏈首（編號最小者）一律已解鎖，否則開局會完全沒有東西可掉。
   * Meta-progression: unlocks and the high score outlive a run. The head of the chain (the
   * lowest id) is always unlocked; without it nothing could ever be dropped.
   */
  const baselineId = Math.min(...config.levels.levels.map((level) => level.id));
  const progress = createProgressStore({ baseline: [baselineId] });

  /* 名冊在下方才建立，但解鎖事件可能在建立之前就觸發；用可變參考承接。 */
  let meltingList: MeltingList | null = null;
  let gameOver: GameOverView | null = null;

  const session = new GameSession({ config, unlocks: progress, silhouettes });
  const hud = new Hud({ layout, sprites, levels: config.levels.levels });

  const updateHud = (): void => {
    hud.update({
      nextLevelId: session.upcomingLevelId,
      score: session.score,
      mergedCount: session.mergedCount,
      comboCount: session.comboCount,
      comboMultiplier: session.comboMultiplier,
      bestTry: progress.highScore,
    });
  };

  /*
   * 結算覆蓋層。`shownGameOver` 讓它在同一局只彈一次 —— `isOver` 一旦成立就會一直是
   * 真，少了這個旗標會每一幀都重設焦點與重播「新紀錄」。
   * The overlay fires once per run: `isOver` stays true, so without the flag it would refocus
   * and re-announce a new best every frame.
   */
  let shownGameOver = false;
  gameOver = createGameOver({
    host: layout.root,
    onRestart: (): void => {
      session.reset();
      shownGameOver = false;
      updateHud();
    },
  });

  /*
   * 除錯輔助線：開發模式下加上 `?debug=1` 就會疊出容器外框、物理空腔與投放線。
   */
  const debugOverlay = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');

  const loop = new FrameLoop({
    viewport,
    session,
    sprites,
    debug: debugOverlay,
    onAfterFrame: (current): void => {
      updateHud();

      if (current.isOver && !shownGameOver) {
        shownGameOver = true;
        const previousBest = progress.highScore;
        const best = progress.recordScore(current.score);
        gameOver?.show({
          score: current.score,
          merged: current.mergedCount,
          best,
          isNewBest: current.score > previousBest,
        });
      }
    },
  });

  /*
   * `observe()` 會立刻回報一次，所以不需要先手動量尺寸。
   * 視埠與 session 必須**一起**重算：前者決定縮放，後者決定牆壁位置，只更新其中一個
   * 會讓物理邊界與畫面框線錯開。
   */
  viewport.observe((): void => {
    viewport.resize();
    session.resize(viewport.virtualWidth, viewport.virtualHeight);
    /* 迴圈暫停時（例如背景分頁）resize 不會被下一幀帶到，所以這裡補畫一次。 */
    loop.renderOnce();
  });

  const detachInput = attachDropInput({
    target: canvas,
    viewport,
    onAim: (x): void => session.setAim(x),
    onDrop: (): void => session.drop(),
    initialAim: session.aimXValue,
  });

  /* 先寫一次 HUD，否則 NEXT 卡會空著等到第一次狀態變化。 */
  updateHud();

  loop.start();

  /* 名冊格數現在由設計稿決定，不再依面板寬度量測。 */
  meltingList = createMeltingList({
    host: hook(layout.regions.melting, 'melting-body'),
    levels: config.levels.levels,
    sprites,
    unlocked: progress.unlocked,
  });

  /*
   * 解鎖一發生就重畫名冊，把 `???` 換成角色圖。session 內部會呼叫 `progress.unlock()`，
   * 這個訂閱是唯一的通知路徑 —— 畫面永遠跟著存檔走。
   * Unlocks redraw the roster. The session calls `progress.unlock()` internally, and this
   * subscription is the only notification path, so the screen always follows the save.
   */
  progress.onChange((): void => meltingList?.setUnlocked(progress.unlocked));

  const context: AppContext = {
    config,
    sprites,
    viewport,
    layout,
    progress,
    meltingList,
    spMeter,
    session,
    hud,
    loop,
    gameOver,
    detachInput,
    detachScale,
  };
  exposeForDebugging(context);
}

/**
 * 在開發模式下把組裝結果掛到 `window` 方便手動檢查。
 * 正式建置會被 Vite 的 `import.meta.env.DEV` 常數折疊掉，不會進產物。
 */
function exposeForDebugging(context: AppContext): void {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['endchi'] = context;
  }
}

void bootstrap();
