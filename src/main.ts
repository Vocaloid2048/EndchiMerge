import './styles/main.css';
import { attachDropInput } from './core/input';
import { loadConfig } from './core/configLoader';
import type { AllConfig } from './core/types';
import { FrameLoop } from './game/loop';
import { GameSession } from './game/session';
import { SpriteLoader } from './render/spriteLoader';
import { Viewport } from './render/viewport';
import { hook } from './ui/dom';
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
 * This file only assembles: it loads config and assets, builds the layout and the
 * viewport, and wires the modules together. It holds no game logic, per the dependency
 * direction in agent-readme §0.2.
 */

/** 執行期共享的組裝結果。 */
export interface AppContext {
  config: AllConfig;
  sprites: SpriteLoader;
  viewport: Viewport;
  layout: Layout;
  meltingList: MeltingList;
  spMeter: SpMeter;
  session: GameSession;
  hud: Hud;
  loop: FrameLoop;
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
   * Scaling starts as soon as the canvas exists rather than after the config load,
   * otherwise the first frame is an unscaled 1920×1080 canvas cropped by the viewport.
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

  const canvas = hook<HTMLCanvasElement>(layout.regions.container, 'stage-canvas');
  const viewport = new Viewport(canvas);

  const session = new GameSession({ config });
  const hud = new Hud({ layout, sprites, levels: config.levels.levels });

  /*
   * 除錯輔助線：開發模式下加上 `?debug=1` 就會疊出容器外框、物理空腔與投放線。
   * 這正是「哪個框對應哪個框」的答案，也是取代「瞎子摸象」最快的方法。
   * Debug guides: `?debug=1` in a dev build overlays the container frame, the physics
   * cavity and the spawn line — the quickest answer to "which rectangle is which".
   */
  const debugOverlay = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');

  const loop = new FrameLoop({
    viewport,
    session,
    sprites,
    debug: debugOverlay,
    onAfterFrame: (current): void => {
      hud.update({
        nextLevelId: current.upcomingLevelId,
        score: current.score,
        mergedCount: current.mergedCount,
      });
    },
  });

  /*
   * `observe()` 會立刻回報一次，所以不需要先手動量尺寸。
   * 視埠與 session 必須**一起**重算：前者決定縮放，後者決定牆壁位置，只更新其中一個
   * 會讓物理邊界與畫面框線錯開。
   * observe() reports once immediately. The viewport and the session are recomputed
   * together because one owns the scale and the other the wall positions.
   *
   * 畫布尺寸現在是固定設計值（不再隨視窗浮動），所以這條路徑實際上每次都算出同一組
   * 數字；留著是為了讓 `Viewport` 仍是唯一的縮放來源，而不是靠「它不會變」的假設。
   * The canvas is now a fixed design size, so this path recomputes the same numbers every
   * time. It stays because `Viewport` should remain the single owner of the scale rather
   * than relying on an assumption that nothing will ever change it.
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
  hud.update({
    nextLevelId: session.upcomingLevelId,
    score: session.score,
    mergedCount: session.mergedCount,
  });

  loop.start();

  /* 名冊格數現在由設計稿決定，不再依面板寬度量測。 */
  const meltingList = createMeltingList({
    host: hook(layout.regions.melting, 'melting-body'),
    levels: config.levels.levels,
    sprites,
  });

  const context: AppContext = {
    config,
    sprites,
    viewport,
    layout,
    meltingList,
    spMeter,
    session,
    hud,
    loop,
    detachInput,
    detachScale,
  };
  exposeForDebugging(context);
}

/**
 * 在開發模式下把組裝結果掛到 `window` 方便手動檢查。
 * 正式建置會被 Vite 的 `import.meta.env.DEV` 常數折疊掉，不會進產物。
 * Exposes the assembled context on `window` in development only; the production build
 * folds this away.
 */
function exposeForDebugging(context: AppContext): void {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['endchi'] = context;
  }
}

void bootstrap();
