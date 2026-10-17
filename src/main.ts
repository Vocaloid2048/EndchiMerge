import './styles/main.css';
import { attachDropInput } from './core/input';
import { loadConfig } from './core/configLoader';
import { resolveLocalizedName } from './core/localizedName';
import type { AllConfig } from './core/types';
import { FrameLoop } from './game/loop';
import type { LeaderboardSource } from './game/leaderboard';
import { createLocalStore } from './game/localStore';
import { createPreferencesStore, type PreferencesStore } from './game/preferences';
import { createProgressStore, type ProgressStore } from './game/progress';
import { createRemoteLeaderboard } from './game/remoteLeaderboard';
import { GameSession } from './game/session';
import { i18n } from './i18n';
import { SpriteLoader } from './render/spriteLoader';
import { buildSilhouetteCache } from './render/silhouetteLoader';
import { Viewport } from './render/viewport';
import { hook } from './ui/dom';
import { createGameOver, type GameOverView } from './ui/gameOver';
import { createHelp, type HelpView } from './ui/help';
import { Hud } from './ui/hud';
import { createLayout, type Layout } from './ui/layout';
import { createLeaderboard, type LeaderboardView } from './ui/leaderboard';
import { createMeltingList, type MeltingList } from './ui/meltingList';
import { createMobileGate, type MobileGate } from './ui/mobileGate';
import { createMusicToggle, type MusicToggle } from './ui/music';
import { createNotice } from './ui/notice';
import { createPublishPrompt, type PublishPromptView } from './ui/publishPrompt';
import { attachRestartConfirm } from './ui/restartButton';
import { attachStageScale } from './ui/scale';
import { createSettings, type SettingsView } from './ui/settings';
import { createSkillBar, type SkillBar } from './ui/skillBar';
import { createSkillGuide } from './ui/skillGuide';
import { createSkillHint, type SkillHint } from './ui/skillHint';
import { createSpMeter, type SpMeter } from './ui/spMeter';

/**
 * 應用程式入口：只做組裝 —— 載入配置與素材、建立版面與視埠，再串起各模組，不含任何遊戲邏輯。
 * Application entry point: pure assembly — it loads config and assets, builds the layout and the
 * viewport, and wires the modules together; no game logic lives here.
 */

/**
 * 執行期共享的組裝結果。
 * The shared assembly result, available at runtime.
 */
export interface AppContext {
  config: AllConfig;
  sprites: SpriteLoader;
  viewport: Viewport;
  layout: Layout;
  progress: ProgressStore;
  meltingList: MeltingList;
  spMeter: SpMeter;
  skillBar: SkillBar;
  skillHint: SkillHint;
  session: GameSession;
  hud: Hud;
  loop: FrameLoop;
  gameOver: GameOverView;
  leaderboardSource: LeaderboardSource;
  leaderboard: LeaderboardView;
  publishPrompt: PublishPromptView;
  preferences: PreferencesStore;
  settings: SettingsView;
  help: HelpView;
  detachInput: () => void;
  detachScale: () => void;
  detachI18n: () => void;
  detachPreferences: () => void;
  mobileGate: MobileGate;
  music: MusicToggle;
}

async function bootstrap(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#app');

  if (host === null) {
    throw new Error('Root element "#app" is missing from index.html.');
  }

  /*
   * 本地儲存層只建一次，三個模組共用：`revision` 必須是「有沒有東西要上載」的單一答案。
   * The local store is built once and shared by all three modules: `revision` must be the single
   * answer to "is there anything to upload".
   */
  const localStore = createLocalStore();

  /*
   * 偏好必須在版面之前讀：版面建立時就會以當下語系寫死每個標籤，所以語系要先確定。
   * Preferences must be read before the layout, which bakes every label in the current locale at
   * build time, so the locale has to be settled first.
   */
  const preferences = createPreferencesStore({ store: localStore });
  i18n.setLocale(preferences.locale);
  i18n.setDocumentLang();

  /* 先建版面：即使配置或素材全部失敗，玩家至少看得到骨架與非官方聲明。
     Build the layout first: even if all config/assets fail, the player still sees the skeleton and
     the notice. */
  const layout = createLayout(host);

  /*
   * 手機把關要掛在**畫布外**：它得用真實像素蓋滿整個視窗，而不是跟著 1920×1080 一起縮到三成。
   * The mobile gate mounts **outside the canvas**: it has to fill the viewport in real pixels rather
   * than shrink to a third along with the 1920×1080 stage.
   */
  const mobileGate = createMobileGate({ host });

  /*
   * 背景音樂：默認播放，音符鍵靜音。它不屬於任何區域，所以與配置、素材、物理都無關 ——
   * 版面一建好就可以開始，玩家不必等我下載完整份配置才聽到音樂。
   * The background music: playing by default, muted by the note button. It belongs to no region and
   * so depends on neither config nor assets nor physics — it can start as soon as the layout exists,
   * rather than waiting for the whole config.
   */
  const music = createMusicToggle({
    button: layout.chrome.music,
    src: `${import.meta.env.BASE_URL}assets/music/take-a-walk.mp3`,
    /* 上次靜音過就安靜開場；按鈕一按，選擇寫回偏好，下次照辦。 */
    /* Quiet when the last visit ended muted; a press writes the choice back, and the next visit follows it. */
    muted: preferences.musicMuted,
    onMutedChange: (muted): void => preferences.setMusicMuted(muted),
  });

  /*
   * 語系一換就把整個版面重寫一遍：`applyTo()` 走 `[data-i18n]` 等標記，連之後才掛上的彈窗一併換掉。
   * A locale change rewrites the whole layout in one `applyTo()` pass over the `[data-i18n]` tags,
   * including the popups mounted later.
   */
  const detachI18n = i18n.subscribe((): void => {
    i18n.applyTo(layout.root);
    i18n.setDocumentLang();
  });

  /* 版面一建好就開始等比縮放，別等配置載入：否則畫面會是一張超出視窗、被裁掉大半的 1920×1080 畫布。
     Start scaling as soon as the layout exists, rather than waiting for the config: otherwise the
     1920×1080 canvas overflows the window in the meantime. */
  const detachScale = attachStageScale({ stage: layout.stage });

  const config = await loadConfig();

  document.title = `${config.branding.gameName} ${config.branding.gameNameZh}`;
  layout.notice.append(createNotice({ zh: config.branding.noticeZh, en: config.branding.notice }));

  /*
   * 容器的左右展示餘裕必須在畫布被量測之前套用：舞台變寬與外框內縮相抵，容器尺寸與可玩寬度不變。
   * The container's display margins must be applied before the canvas is measured: the wider stage
   * and the frame inset cancel, leaving the container's size and the play width unchanged.
   */
  layout.setContainerMargin(config.container.leftOffset, config.container.rightOffset);

  /* 技力條的段數由 `sp.max` 決定（一點一條），所以要在配置到手之後才建。
     The SP meter's segment count follows `sp.max` (one pill per point), so it is built after the
     config arrives. */
  const spMeter = createSpMeter(hook<HTMLElement>(layout.regions.skill, 'sp-meter'));
  spMeter.update({ value: config.skills.sp.initial, max: config.skills.sp.max });

  /* 素材載入失敗不會拋錯，失敗的等級之後會退回程式佔位圖。
     Asset loading does not throw; a failed level falls back to a drawn placeholder. */
  const sprites = new SpriteLoader();
  await sprites.loadAll(config.levels.levels);

  /*
   * 輪廓碰撞框：素材一到手就為整條合成鏈導出多邊形；失敗的等級記為 `null`、遊玩時退回圓形。
   * Outline colliders: polygons are derived for the whole chain as assets arrive; a failed level is
   * recorded as `null` and falls back to a circle.
   */
  const silhouettes = buildSilhouetteCache(config.levels.levels, sprites);

  const canvas = hook<HTMLCanvasElement>(layout.regions.container, 'stage-canvas');
  const viewport = new Viewport(canvas);

  /*
   * meta-progression：解鎖與最高分跨局存活；鏈首（編號最小者）一律已解鎖，否則開局沒東西可掉。
   * Meta-progression: unlocks and the high score outlive a run; the head of the chain (the lowest id)
   * is always unlocked, or nothing could ever be dropped.
   */
  const baselineId = Math.min(...config.levels.levels.map((level) => level.id));
  const progress = createProgressStore({ baseline: [baselineId], store: localStore });

  /* 名冊稍後才建立，但解鎖事件可能更早觸發；用可變參考承接。
     The roster is built later but unlock events may fire first, so a mutable reference bridges the gap. */
  let meltingList: MeltingList | null = null;
  let gameOver: GameOverView | null = null;

  const session = new GameSession({ config, unlocks: progress, silhouettes });
  const hud = new Hud({ layout, sprites, levels: config.levels.levels });

  /*
   * 無盡模式由偏好驅動，是跨局設定（住在 `reset()` 之外），開局前交一次即可，之後跟著偏好變。
   * Endless mode is preference-driven and cross-run (it lives outside `reset()`); handing it over once
   * before the first run suffices, and it follows the preference from then on.
   */
  session.setEndless(preferences.endless);

  /**
   * 偏好一變就同步兩件事：語系交給 `i18n`，規則交給 `session`。
   * A preference change syncs two things: the locale to `i18n` and the rules to `session`.
   */
  const detachPreferences = preferences.subscribe((): void => {
    i18n.setLocale(preferences.locale);
    session.setEndless(preferences.endless);
  });

  /*
   * 技能名的語系解析：`GameSession` 刻意不認識語系，逐語系名稱在此併入；技能欄每幀重畫，換語系自然更新。
   * Skill-name locale resolution: `GameSession` deliberately knows no locales, so the per-locale names
   * are folded in here; the bar redraws each frame, so a locale change updates them by itself.
   */
  const skillNames = new Map(config.skills.skills.map((def) => [def.id, def.names]));

  /*
   * 技能欄：可不可以按完全由 `GameSession` 決定，這裡只把按下的 id 交回去（含「再按一次取消」）。
   * The skill bar: whether a card is pressable is entirely `GameSession`'s call, so this only hands
   * the pressed id back (even "press again to cancel" is a session rule).
   */
  const skillBar = createSkillBar({
    host: hook<HTMLElement>(layout.regions.skill, 'skill-grid'),
    onActivate: (id): void => {
      session.activateSkill(id);
      /* 立刻反映一次，別等下一個 frame —— 按下與畫面變化之間不該有一格延遲。
         Reflect it immediately rather than waiting for the next frame. */
      skillBar.update(session.skillCards);
      spMeter.update({ value: session.spValue, max: session.spMax });
    },
    nameFor: (state): string =>
      resolveLocalizedName(state.name, skillNames.get(state.id), i18n.locale),
  });
  skillBar.update(session.skillCards);

  /*
   * 技能選取提示帶：當技能啟動時顯示，掛在 `.layout` 上、與 `main.stage` 同層，所以永不覆蓋畫布或聲明。
   * The skill-selection hint strip, shown while a skill arms; it mounts on `.layout`, a sibling of
   * `main.stage`, so it never covers the canvas or the notice.
   */
  const skillHint = createSkillHint({ host: layout.root });
  skillHint.update(session.skillCards);

  /*
   * 技能說明彈窗（技能列表右上角的 (i)）。內容來自 `skills.json` 的定義，不碰 session ——
   * 說明是靜態的，場上發生什麼都不會改變它。
   * The skill guide popup (the "(i)" at the skill list's top-right). Its content comes from the
   * `skills.json` definitions and never touches the session: the copy is static and nothing on the
   * board changes it.
   */
  const skillGuide = createSkillGuide({
    host: layout.root,
    skills: config.skills.skills,
    nameFor: (def): string =>
      resolveLocalizedName(def.name, skillNames.get(def.id), i18n.locale),
  });

  const skillGuideButton = layout.regions.skill.querySelector<HTMLButtonElement>(
    'button[data-action="skill-guide"]',
  );
  if (skillGuideButton !== null) {
    skillGuideButton.addEventListener('click', (): void => {
      skillGuide.open();
    });
  }

  const updateHud = (): void => {
    hud.update({
      nextLevelId: session.upcomingLevelId,
      score: session.score,
      mergedCount: session.mergedCount,
      /* COMBO 卡：本次投放的合成次數（大數字）＋ 合共得分與倍率（第二行）。
         The COMBO card: this drop's merge count (big) and total score with multiplier (second line). */
      comboCount: session.comboCount,
      comboDropScore: session.dropScore,
      comboMultiplier: session.comboMultiplier,
      bestTry: progress.highScore,
    });
  };

  /**
   * 這一局開跑時的歷史最高分：分數現在邊玩邊記，結束時 `progress.highScore` 已含本局，不能再拿它跟自己比。
   * The high score when this run started: the score is now recorded live, so by the end
   * `progress.highScore` already includes this run and cannot be compared to itself.
   */
  let runStartBest = progress.highScore;

  /*
   * 榜單資料層（伺服器版）；UI 只依賴 `LeaderboardSource`，換實作只改這一段。`baseUrl` 留空＝同源，
   * 本機由 Vite 代理 `/api`，跨網域部署填 `VITE_API_BASE_URL`（伺服器另需 `ALLOWED_ORIGIN`）。
   * The leaderboard data layer (server-backed); the UI depends only on `LeaderboardSource`, so
   * swapping it changes this block alone. An empty `baseUrl` means same-origin: Vite proxies `/api`
   * locally, and a cross-origin deploy sets `VITE_API_BASE_URL` (plus `ALLOWED_ORIGIN` server-side).
   */
  const leaderboardSource = createRemoteLeaderboard({
    store: localStore,
    baseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
    version: __APP_VERSION__,
  });

  /*
   * 開一局：伺服器版在此鑄一張一次性憑證，其頒發時刻即為本局起點（反作弊靠它判斷宣稱時長），所以必須開局就呼叫。
   * Start a run: the server build mints a one-off token here, and its issue time is the run's start
   * (the anti-cheat's duration check), so it must happen now rather than at submission.
   */
  leaderboardSource.beginRun?.();

  /**
   * 把目前這一局的成績併入本機紀錄，每幀呼叫：紀錄只升不降，所以中途、結束、離開前各記一次結果都相同。
   * 規則總開關一開就整個短路（「開啟期間不記入排行榜」）—— 閘門必須在這唯一的寫入路徑上，因為本機紀錄就是要上載的那一筆。
   * Fold the run in progress into the local record, called every frame: the record is monotonic, so
   * recording mid-run, at the end and on the way out all land on the same numbers. With the master
   * rule switch on this short-circuits entirely ("nothing recorded while it is on") — the gate belongs
   * on this one write path, since the local record is the thing that gets uploaded.
   */
  const recordRun = (): boolean => {
    if (preferences.rulesEnabled) return false;

    /*
     * 開過無盡模式的那一局永遠不記 —— 即使玩家後來關掉了也一樣（`rankEligible` 是這一局的
     * 單向旗標）。關掉總開關會順手關掉無盡模式，所以光看偏好是看不見這件事的。
     * A run that ever had endless mode on is never recorded, even after switching it back off
     * (`rankEligible` is this run's one-way flag). Closing the master gate also closes endless,
     * so the preferences alone would not show it.
     */
    if (!session.rankEligible) return false;

    return leaderboardSource.record({
      score: session.score,
      maxCombo: session.maxCombo,
      merges: session.mergedCount,
      /*
       * 這一局**累計投放**了幾顆：伺服器的合理性檢查拿它當上界（合成數 ≤ 投放數），
       * 所以送的是投入量 `totalDrops` 而非場上顆數 `dropCount`（後者會被合成與回收減少）。
       * How many drops **this run** made: the server's rationality check uses it as the upper bound
       * ("merges ≤ drops"), so `totalDrops` is sent rather than the live body count `dropCount`, which
       * merging and recycling lower.
       */
      drops: session.totalDrops,
      /*
       * 時長跟著分數走（見 `LeaderboardEntry.durationMs`）：每幀都在記，留下的自然是創下最高分那一刻的時間。
       * The duration follows the score (see `LeaderboardEntry.durationMs`); recording every frame
       * leaves the time at which the best score was reached.
       */
      durationMs: session.elapsed,
    });
  };

  /**
   * 上載：把本機紀錄推上排行榜；未同意分享、或沒有未上載的更新時什麼都不做。
   * 呼叫時機：該局結束、重新開始、關分頁／切到背景、下次回來，以及遊戲中成績刷新時（見
   * `scheduleLiveSync`，帶 debounce）。
   * Upload: push the local record onto the board; does nothing without consent or with nothing
   * pending. Call sites: the run's end, a restart, page close/backgrounding, the next visit, and
   * live on each improvement (see `scheduleLiveSync`, debounced).
   */
  const syncRun = (): void => {
    leaderboardSource.sync();
  };

  /*
   * 即時上載（使用者定案「成績刷新即同步」）：成績每刷新一次就排一次短延遲的推播，遊戲進行中榜
   * 就會動。用 throttle + 尾部而非純 debounce：第一次刷新立即推（leading），之後至少每隔
   * `LIVE_SYNC_INTERVAL_MS` 推一次（連續刷新也不會空窗），最後停止刷新時再補一次尾部。兩個立即
   * 觸發點（一局結束、重新開始）仍直接走 `syncRun()`，不被這條延遲。
   * Live upload (the user's decision: "sync as the score improves"): each improvement schedules a
   * short-delayed push so the board moves during play. A throttle-with-trailing, not a plain
   * debounce: the first improvement pushes at once (leading), then at most once per
   * `LIVE_SYNC_INTERVAL_MS` even in a streak, and a final trailing push once improvements stop. The
   * two immediate triggers (run end, restart) still call `syncRun()` directly, undelayed.
   */
  const LIVE_SYNC_INTERVAL_MS = 2000;
  let liveSyncTimer: ReturnType<typeof setTimeout> | null = null;
  let liveSyncLastFired = 0;

  const scheduleLiveSync = (): void => {
    const now = Date.now();
    const since = now - liveSyncLastFired;

    /* 距上次推播已夠久 → 立刻推（leading），並清掉可能還掛著的尾部計時器。 */
    if (since >= LIVE_SYNC_INTERVAL_MS) {
      if (liveSyncTimer !== null) {
        clearTimeout(liveSyncTimer);
        liveSyncTimer = null;
      }

      liveSyncLastFired = now;
      syncRun();

      return;
    }

    /* 還沒到間隔、且已排了尾部計時器 → 什麼都不做。 */
    if (liveSyncTimer !== null) return;

    liveSyncTimer = setTimeout((): void => {
      liveSyncTimer = null;
      liveSyncLastFired = Date.now();
      syncRun();
    }, LIVE_SYNC_INTERVAL_MS - since);
  };

  /*
   * 下次回來：上次離開後若有刷新（`revision` 領先 `uploaded`），在這裡補一次上載。
   * Next visit: if anything improved since the last upload (`revision` ahead of `uploaded`), send it now.
   */
  syncRun();

  /**
   * 重設進行中的一局：結算覆蓋層的「再玩一次」與工具列的重新開始共用這一條路。
   * Reset the run in progress: the overlay's "play again" and the toolbar's restart share this path.
   */
  const restartRun = (): void => {
    /* 先記再上載，最後才重設：`reset()` 會把這一局的成績清掉。
       Record, upload, then reset — `reset()` clears this run's numbers. */
    recordRun();
    syncRun();
    session.reset();
    /*
     * 新的一局要重新鑄一張憑證（見 `LeaderboardSource.beginRun`），順序在 `syncRun()` 之後：
     * 上一局的提交需要上一局的憑證，而 `beginRun()` 會把「這一局的數字」清空。
     * A new run mints a fresh token (see `LeaderboardSource.beginRun`), after `syncRun()`: the
     * previous run's submission needs the previous token, and `beginRun()` clears this run's numbers.
     */
    leaderboardSource.beginRun?.();
    shownGameOver = false;
    gameOver?.hide();
    runStartBest = progress.highScore;
    updateHud();
    updateSkills();
  };

  /*
   * 「這一局還沒結束就要走了」的兩個出口：`pagehide` 涵蓋關閉、重新載入與導覽；
   * `visibilitychange → hidden` 涵蓋切到背景（手機切 app、切分頁）。
   * The two exits for "leaving before the run is over": `pagehide` covers close, reload and
   * navigation; `visibilitychange → hidden` covers being backgrounded.
   */
  window.addEventListener('pagehide', syncRun);
  document.addEventListener('visibilitychange', (): void => {
    if (document.visibilityState === 'hidden') syncRun();
  });

  /**
   * 技力條與技能欄每幀同步；兩者只在值真的變了才動 DOM，所以這樣做是便宜的。
   * The meter and the bar sync every frame; both only touch the DOM on a real change, so it stays cheap.
   */
  const updateSkills = (): void => {
    spMeter.update({ value: session.spValue, max: session.spMax });
    skillBar.update(session.skillCards);
    skillHint.update(session.skillCards);
  };

  /*
   * 結算覆蓋層：`shownGameOver` 讓它在同一局只彈一次 —— `isOver` 一旦成立就會一直是真。
   * The overlay fires once per run: `shownGameOver` guards it, since `isOver` stays true once set.
   */
  let shownGameOver = false;
  gameOver = createGameOver({
    host: layout.root,
    onRestart: restartRun,
  });

  /*
   * 重新開始鍵（工具列、設定右邊）：按下先彈出確認對話框，確認後走與結算覆蓋層同一條
   * `restartRun`。對話框掛在 `layout.root`（與結算覆蓋層同一個宿主），所以它跟整張畫布
   * 一起被等比縮放。
   * The toolbar restart button (right of settings): a press opens a confirmation dialog and
   * only a confirmed answer takes the same `restartRun` path as the game-over overlay. The
   * dialog mounts on `layout.root` (the overlay's host), so it scales with the canvas.
   */
  const restartButton = layout.regions.toolbar.querySelector<HTMLButtonElement>(
    'button[data-action="restart"]',
  );
  if (restartButton !== null) {
    attachRestartConfirm({ button: restartButton, host: layout.root, onRestart: restartRun });
  }

  /*
   * 排行榜（工具列獎盃鍵）：按下彈出模態 popup（使用者定案：不做獨立頁面）。彈窗掛在
   * `layout.root`，所以它與整張畫布一起被等比縮放；榜的內容與名次全部由
   * `leaderboardSource` 提供。
   * The leaderboard (toolbar trophy): a press opens a modal popup (the user's decision — no
   * separate page). It mounts on `layout.root` so it scales with the canvas, and every row and
   * rank comes from `leaderboardSource`.
   */
  const leaderboard = createLeaderboard({ host: layout.root, source: leaderboardSource });

  /*
   * 首次的發布詢問。顯示名稱與同意分享是**玩家設定**，不是榜單內容，所以只在第一次開榜之前
   * 單獨問一次（見 `ui/publishPrompt.ts`）；之後要改就到設定。
   * The one-off publish prompt. The display name and the sharing consent are **player settings**
   * rather than board content, so they are asked on their own once, before the board opens for
   * the first time (see `ui/publishPrompt.ts`) and edited in settings afterwards.
   *
   * `onSaved` 開榜，讓剛上榜的那一筆立刻出現在眼前。上載本身不必在這裡做：按下同意的那一刻
   * `setSharing(true)` 已經推上去了（見 `game/leaderboard.ts`）。
   * `onSaved` opens the board so the row that just went up is right there. The upload itself does
   * not belong here: ticking consent already pushed it (see `game/leaderboard.ts`).
   */
  const publishPrompt = createPublishPrompt({
    host: layout.root,
    source: leaderboardSource,
    onSaved: (): void => leaderboard.open(),
  });

  const leaderboardButton = layout.regions.toolbar.querySelector<HTMLButtonElement>(
    'button[data-action="leaderboard"]',
  );
  if (leaderboardButton !== null) {
    leaderboardButton.addEventListener('click', (): void => {
      if (leaderboardSource.publishPromptDone) leaderboard.open();
      else publishPrompt.open();
    });
  }

  /*
   * 「?」說明彈窗（工具列）。四段靜態文案，全部走 i18n 標記，所以語系一換由上面那條
   * `applyTo()` 一次改掉。
   * The "?" help popup (toolbar). Four static sections, all tagged for i18n, so the `applyTo()`
   * subscription above rewrites them in one pass on a locale change.
   */
  const help = createHelp({ host: layout.root });

  const helpButton = layout.regions.toolbar.querySelector<HTMLButtonElement>(
    'button[data-action="help"]',
  );
  if (helpButton !== null) {
    helpButton.addEventListener('click', (): void => {
      help.open();
    });
  }

  /*
   * 設定彈窗（工具列齒輪）。它把兩個來源接在一起：偏好（語系／規則）與排行榜（名稱／分享），
   * 而兩邊都**不需要**任何回呼 —— 語系與規則由 `preferences` 的訂閱推出去，上載由
   * `setSharing(true)` 自己處理。所以這裡沒有 `onPublish` 這種東西：同意分享的玩家不必再手動
   * 按上載（使用者定案）。
   * The settings popup (toolbar gear) ties two sources together: preferences (locale/rules) and
   * the leaderboard (name/sharing) — and neither needs a callback. The locale and the rules go out
   * through the `preferences` subscription, and the upload handles itself inside
   * `setSharing(true)`. So there is no `onPublish` here: a player who has consented never presses
   * an upload button (the user's decision).
   */
  const settings = createSettings({
    host: layout.root,
    preferences,
    leaderboard: leaderboardSource,
  });

  const settingsButton = layout.regions.toolbar.querySelector<HTMLButtonElement>(
    'button[data-action="settings"]',
  );
  if (settingsButton !== null) {
    settingsButton.addEventListener('click', (): void => {
      settings.open();
    });
  }

  /*
   * 除錯輔助線：開發模式下加上 `?debug=1` 就會疊出容器外框、物理空腔與投放線。
   */
  const debugOverlay = import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug');

  /*
   * 開發模式下的除錯把手：截圖／錄影腳本與 QA 要讀盤面（每顆的位置、等級）才不必靠猜，
   * 而 `session` 本來就沒有對外入口。刻意**不**綁 `?debug=1` —— 那個參數會疊出除錯輔助線，
   * 錄示意圖時不想把它們拍進去。正式建置不會留任何痕跡。
   * A dev-only debug handle: screenshot/recording scripts and QA need to read the board (each
   * body's position and level) instead of guessing, and `session` has no other way out. It is
   * deliberately **not** tied to `?debug=1`, which draws the debug guides that should stay out of
   * an illustration. A production build carries no trace of it.
   */
  if (import.meta.env.DEV) {
    (window as unknown as { __endchi?: { session: GameSession; viewport: Viewport } }).__endchi = {
      session,
      viewport,
    };
  }

  const loop = new FrameLoop({
    viewport,
    session,
    sprites,
    debug: debugOverlay,
    onAfterFrame: (current): void => {
      /*
       * BEST TRY 邊玩邊記（使用者定案）：分數一超過歷史最高就立刻寫入存檔並反映在
       * HUD 上，不再等到結束。`recordScore()` 在分數沒有超越時直接返回，不會動
       * localStorage，所以每幀呼叫是便宜的；`updateHud()` 要在它**之後**跑，
       * HUD 上的 BEST TRY 才會在同一幀更新。
       * BEST TRY updates live (the user's decision): the moment the score passes the high
       * score it is persisted and reflected in the HUD, not held back until the run ends.
       * `recordScore()` returns immediately when the score does not lead, so calling it
       * every frame is cheap; `updateHud()` must run *after* it so the HUD picks up the
       * new best within the same frame.
       */
      progress.recordScore(current.score);

      /*
       * 本機紀錄邊玩邊更新（使用者定案）：只升不降，沒有刷新時立刻返回，所以每幀呼叫是便宜
       * 的。因為它一直是最新的，關分頁、當機、斷電都不會掉本機成績；而刷新時會再排一次即時
       * 上載（`scheduleLiveSync`），所以榜在遊戲中也會動。
       * The local record tracks the run live (the user's decision): monotonic, and it returns
       * immediately when nothing improved, so calling it every frame is cheap. Because it is
       * always current, a closed tab or a crash costs nothing in the local record; and an
       * improvement also schedules a live upload (`scheduleLiveSync`), so the board moves in play.
       */
      if (recordRun()) scheduleLiveSync();

      updateHud();
      updateSkills();

      if (current.isOver && !shownGameOver) {
        shownGameOver = true;
        /* 這一局到此為止：先上載，再彈結算。 */
        syncRun();
        gameOver?.show({
          score: current.score,
          merged: current.mergedCount,
          /* 到結束這一刻最高分早已被即時記錄，直接讀現值即可。 */
          best: progress.highScore,
          isNewBest: current.score > runStartBest,
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
    /*
     * 同一顆按鈕在技能選取模式下改為「選球」：分岔在 `GameSession`，這裡只把虛擬座標交過去。
     * 鍵盤沒有座標，`null` ＝ 照目前瞄準點投放。
     * The same press becomes "pick a dumpling" while a skill is selecting; the fork lives in
     * `GameSession` and this only forwards the virtual coordinates. The keyboard has none, so
     * `null` means "drop at the current aim".
     */
    onDrop: (point): void => {
      if (point === null) session.drop();
      else session.canvasPointerAction(point.x, point.y);
    },
    onCancel: (): void => session.cancelSkill(),
    /*
     * 鍵盤每次按鍵都會問一次「現在瞄準在哪」，所以貼牆長按不會在輸入層留下一段看不見的
     * 溢出量（見 `input.ts`）。讀的是 session 已夾制的值，規則仍只住在 session。
     * The keyboard asks where the aim currently is on every press, so holding a key against
     * a wall leaves no invisible overflow behind (see `input.ts`). The value read is the
     * session's already-clamped one; the rules still live only in the session.
     */
    readAim: (): number => session.aimXValue,
  });

  /*
   * 開局就把焦點交給畫布。`keydown` 綁在畫布上（而不是 `window`），這樣在名稱欄打字時
   * 空白鍵才不會順手投下一顆；代價是畫布沒有焦點時方向鍵收不到，玩家得先點一下畫面。
   * 這裡補上開場的聚焦，方向鍵才會「一開局就能用」。`preventScroll` 是必要的 —— 少了它
   * 瀏覽器會為了把畫布帶進視野而捲動頁面。
   * Hand the focus to the canvas up front. `keydown` is bound to the canvas rather than to
   * `window` so that typing a space in the name field cannot drop a dumpling; the price is that
   * the arrows go nowhere until the canvas is focused, which used to mean clicking the board
   * first. Focusing here makes the arrow keys work from the very first press. `preventScroll`
   * matters: without it the browser scrolls the page to bring the canvas into view.
   */
  canvas.focus({ preventScroll: true });

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
    skillBar,
    skillHint,
    session,
    hud,
    loop,
    gameOver,
    leaderboardSource,
    leaderboard,
    publishPrompt,
    preferences,
    settings,
    help,
    detachInput,
    detachScale,
    detachI18n,
    detachPreferences,
    mobileGate,
    music,
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
