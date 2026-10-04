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

/**
 * 應用程式入口。
 * Application entry point.
 *
 * `main.ts` 只做**組裝**：載入配置與素材、建立版面與視埠，再把各模組接起來。
 * 它不含任何遊戲邏輯（agent-readme §0.2 的依賴方向）。
 * This file only assembles: it loads config and assets, builds the layout and the
 * viewport, and wires the modules together. It holds no game logic, per the
 * dependency direction in agent-readme §0.2.
 */

/** 執行期共享的組裝結果。 */
export interface AppContext {
  config: AllConfig;
  sprites: SpriteLoader;
  viewport: Viewport;
  layout: Layout;
  meltingList: MeltingList;
  session: GameSession;
  hud: Hud;
  loop: FrameLoop;
  /** 卸下投放輸入的事件綁定。 */
  detachInput: () => void;
}

async function bootstrap(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#app');

  if (host === null) {
    throw new Error('Root element "#app" is missing from index.html.');
  }

  /* 先建版面：即使配置或素材全部失敗，玩家至少看得到骨架與非官方聲明。 */
  const layout = createLayout(host);

  const config = await loadConfig();

  document.title = `${config.branding.gameName} ${config.branding.gameNameZh}`;
  layout.notice.append(createNotice({ zh: config.branding.noticeZh, en: config.branding.notice }));

  /* 素材載入失敗不會拋錯，失敗的等級之後會退回程式佔位圖。 */
  const sprites = new SpriteLoader();
  await sprites.loadAll(config.levels.levels);

  const canvas = hook<HTMLCanvasElement>(layout.regions.container, 'stage-canvas');
  const viewport = new Viewport(canvas);

  const session = new GameSession({ config });
  const hud = new Hud({ layout, sprites, levels: config.levels.levels });
  const loop = new FrameLoop({
    viewport,
    session,
    sprites,
    onAfterFrame: (current): void => {
      hud.update({
        nextLevelId: current.nextLevelId,
        score: current.score,
        mergedCount: current.mergedCount,
      });
    },
  });

  /*
   * `observe()` 會立刻回報一次，所以不需要先手動量尺寸。
   * 視埠與 session 必須**一起**重算：前者決定縮放，後者決定牆壁位置，只更新其中
   * 一個會讓物理邊界與畫面框線錯開。
   * observe() reports once immediately, so no manual first measurement is needed. The
   * viewport and the session must be recomputed together: one owns the scale, the other
   * the wall positions, and updating only one misaligns physics from the frame.
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
    nextLevelId: session.nextLevelId,
    score: session.score,
    mergedCount: session.mergedCount,
  });

  loop.start();

  /* M2：名冊靠面板寬度反推欄數，故掛載後由它自己量測並監看尺寸。 */
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
    session,
    hud,
    loop,
    detachInput,
  };
  exposeForDebugging(context);
}

/**
 * 在開發模式下把組裝結果掛到 `window` 方便手動檢查。
 * 正式建置會被 Vite 的 `import.meta.env.DEV` 常數折疊掉，不會進產物。
 * Exposes the assembled context on `window` in development only; the production
 * build folds this away.
 */
function exposeForDebugging(context: AppContext): void {
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)['endchi'] = context;
  }
}

void bootstrap();
