import './styles/main.css';
import { attachDropInput } from './core/input';
import { loadConfig } from './core/configLoader';
import { resolveLocalizedName } from './core/localizedName';
import type { AllConfig } from './core/types';
import { FrameLoop } from './game/loop';
import { createLocalLeaderboard, type LeaderboardSource } from './game/leaderboard';
import { createPreferencesStore, type PreferencesStore } from './game/preferences';
import { createProgressStore, type ProgressStore } from './game/progress';
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
import { createNotice } from './ui/notice';
import { createPublishPrompt, type PublishPromptView } from './ui/publishPrompt';
import { attachRestartConfirm } from './ui/restartButton';
import { attachStageScale } from './ui/scale';
import { createSettings, type SettingsView } from './ui/settings';
import { createSkillBar, type SkillBar } from './ui/skillBar';
import { createSkillHint, type SkillHint } from './ui/skillHint';
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
  skillBar: SkillBar;
  skillHint: SkillHint;
  session: GameSession;
  hud: Hud;
  loop: FrameLoop;
  gameOver: GameOverView;
  /** 榜單資料層（現階段為本地實作；接真後端時換掉這一個即可）。 */
  leaderboardSource: LeaderboardSource;
  /** 排行榜彈窗。 */
  leaderboard: LeaderboardView;
  /** 首次的發布詢問彈窗（名稱＋分享意願）。 */
  publishPrompt: PublishPromptView;
  /** 玩家偏好（語系、規則總開關、無盡模式）。 */
  preferences: PreferencesStore;
  /** 設定彈窗。 */
  settings: SettingsView;
  /** 遊戲說明彈窗。 */
  help: HelpView;
  /** 卸下投放輸入的事件綁定。 */
  detachInput: () => void;
  /** 停止監看視窗尺寸與名冊尺寸。 */
  detachScale: () => void;
  /** 取消語系變更的訂閱。 */
  detachI18n: () => void;
  /** 取消偏好變更的訂閱。 */
  detachPreferences: () => void;
}

async function bootstrap(): Promise<void> {
  const host = document.querySelector<HTMLElement>('#app');

  if (host === null) {
    throw new Error('Root element "#app" is missing from index.html.');
  }

  /*
   * 偏好要**在版面之前**讀：版面建立時就會用 `i18nText` 把每個標籤寫成當下語系的字，所以
   * 語系必須先確定。存檔有值就以存檔為準，沒有則跟隨裝置／瀏覽器語言（見
   * `game/preferences.ts`）。
   * Preferences are read **before the layout exists**: the layout writes every label with
   * `i18nText` at build time, so the locale has to be settled first. A saved value wins;
   * otherwise the device/browser language decides (see `game/preferences.ts`).
   */
  const preferences = createPreferencesStore();
  i18n.setLocale(preferences.locale);
  i18n.setDocumentLang();

  /* 先建版面：即使配置或素材全部失敗，玩家至少看得到骨架與非官方聲明。 */
  const layout = createLayout(host);

  /*
   * 語系一換就把整個版面重寫一遍：`applyTo()` 走 `[data-i18n]` 等標記，所有靜態文字（含之後
   * 才掛上去的排行榜、設定、說明彈窗，它們全都住在 `layout.root` 底下）一次換掉。動態文字
   * （帶數字的句子）由各自的模組自己重畫。
   * A locale change rewrites the whole layout in one `applyTo()` pass over the `[data-i18n]`
   * tags — including the leaderboard, settings and help popups mounted later, since they all
   * live under `layout.root`. Dynamic text (sentences with numbers) is redrawn by its own module.
   */
  const detachI18n = i18n.subscribe((): void => {
    i18n.applyTo(layout.root);
    i18n.setDocumentLang();
  });

  /*
   * 版面一建好就開始等比縮放，而不是等配置載入完 —— 否則在那段時間裡畫面會是一張
   * 超出視窗、被裁掉大半的 1920×1080 畫布。
   */
  const detachScale = attachStageScale({ stage: layout.stage });

  const config = await loadConfig();

  document.title = `${config.branding.gameName} ${config.branding.gameNameZh}`;
  layout.notice.append(createNotice({ zh: config.branding.noticeZh, en: config.branding.notice }));

  /*
   * 容器的左右展示餘裕（`container.json`）必須在畫布**被量測之前**套用：舞台一變寬，
   * `Viewport.resize()` 算出的虛擬寬度就跟著變，而外框會再內縮同樣的距離 —— 兩者相抵，
   * 容器尺寸與可玩寬度都不變，只是左右多了搖晃用的空間。
   * The container's display margins must be applied **before the canvas is measured**: widening
   * the stage changes the virtual width `Viewport.resize()` derives, and the frame insets by
   * the same amount. The two cancel, so the container's size and the play width are untouched
   * and only the room to shake is added.
   */
  layout.setContainerMargin(config.container.leftOffset, config.container.rightOffset);

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

  /*
   * 無盡模式由偏好驅動。它是**跨局設定**，所以在 `reset()` 之外（見 `game/session.ts`），
   * 這裡只需在開局前交一次，之後跟著偏好變。
   * Endless mode is driven by preferences. It is a **cross-run setting** and therefore lives
   * outside `reset()` (see `game/session.ts`); it is handed over once before the first run and
   * follows the preference from then on.
   */
  session.setEndless(preferences.endless);

  /**
   * 偏好一變就同步兩件事：語系交給 `i18n`（它會通知版面重寫），規則交給 `session`。
   * A preference change syncs two things: the locale goes to `i18n` (which notifies the layout
   * rewrite) and the rules go to `session`.
   */
  const detachPreferences = preferences.subscribe((): void => {
    i18n.setLocale(preferences.locale);
    session.setEndless(preferences.endless);
  });

  /*
   * 技能名的語系解析。`GameSession` 刻意不認識語系（見 `SkillCardState.name`），所以
   * `skills.json` 的逐語系名稱在這裡才被合併進去；技能欄每幀重畫，換語系時名字自然更新。
   * Locale resolution for skill names. `GameSession` deliberately knows nothing about locales
   * (see `SkillCardState.name`), so the per-locale names from `skills.json` are folded in here.
   * The bar redraws every frame, so a locale change updates the names by itself.
   */
  const skillNames = new Map(config.skills.skills.map((def) => [def.id, def.names]));

  /*
   * 技能欄。可不可以按完全由 `GameSession` 決定（它才看得到技力與累計消耗），所以這裡
   * 只需要在按下時把 id 交回去 —— 連「再按一次取消」也是 session 的規則。
   * The skill bar. Whether a card is pressable is entirely `GameSession`'s call (it is the only
   * thing that can see SP and cumulative spend), so this only hands the id back on press — even
   * "press again to cancel" is a session rule.
   */
  const skillBar = createSkillBar({
    host: hook<HTMLElement>(layout.regions.skill, 'skill-grid'),
    onActivate: (id): void => {
      session.activateSkill(id);
      /* 立刻反映一次，不必等下一個 frame —— 按下與畫面變化之間不該有一格延遲。 */
      skillBar.update(session.skillCards);
      spMeter.update({ value: session.spValue, max: session.spMax });
    },
    nameFor: (state): string =>
      resolveLocalizedName(state.name, skillNames.get(state.id), i18n.locale),
  });
  skillBar.update(session.skillCards);

  /*
   * 技能選取提示帶：當棄即棄／命運互換啟動時顯示。使用者定案：提示掛在 `.layout` 上、
   * 與 `main.stage` **同層**（畫布外、舞台下緣與聲明之間），不在畫布內 —— 所以它永遠
   * 不會蓋住容器，也不會與畫布或聲明重疊（容器底部留白相應減少，見 `container.json`）。
   * The skill-selection hint strip, shown while Discard! or Fate Swap arms. The user's
   * decision: the hint mounts on `.layout`, a **sibling** of `main.stage` (outside the
   * canvas, in the gap between the stage's bottom edge and the notice) — so it never covers
   * the container and never overlaps the canvas or the notice (the canvas's reserved bottom
   * band shrinks accordingly, see `container.json`).
   */
  const skillHint = createSkillHint({ host: layout.root });
  skillHint.update(session.skillCards);

  const updateHud = (): void => {
    hud.update({
      nextLevelId: session.upcomingLevelId,
      score: session.score,
      mergedCount: session.mergedCount,
      /* COMBO 卡：本次投放的合成次數（大數字）＋ 合共得分與倍率（第二行）。 */
      comboCount: session.comboCount,
      comboDropScore: session.dropScore,
      comboMultiplier: session.comboMultiplier,
      bestTry: progress.highScore,
    });
  };

  /**
   * 這一局開跑時的歷史最高分。結算覆蓋層用它判斷「NEW BEST」：分數現在**邊玩邊記**
   * （見下面的 frame callback），到結束那一刻 `progress.highScore` 已經包含本局分數，
   * 不能再拿它跟自己比。
   * The high score when this run started. The game-over overlay uses it to decide "NEW
   * BEST": the score is now recorded *while playing* (see the frame callback below), so at
   * the end `progress.highScore` already contains this run and cannot be compared to itself.
   */
  let runStartBest = progress.highScore;

  /*
   * 榜單資料層（現階段為本地實作）。UI 只依賴 `LeaderboardSource` 介面 —— 日後接真後端
   * （使用者定案：Docker 的 Postgres container，或 Vercel 支援的後端＋微資料庫；騰訊雲再後）
   * 時只要換掉這一行，排行榜彈窗與其餘 UI 都不必改。
   * The leaderboard data layer (local today). The UI depends only on the `LeaderboardSource`
   * interface, so wiring the real backend later (the user's plan: a Docker Postgres container, or
   * Vercel's backend plus a micro database; Tencent Cloud after that) replaces this one line and
   * leaves the popup and the rest of the UI untouched.
   */
  const leaderboardSource = createLocalLeaderboard();

  /**
   * 這一局的識別碼。一局會在多個時間點被記錄（見 `recordCurrentRun`），靠它 upsert 成同一筆。
   * The id of the run in progress. A run is recorded at several moments (see `recordCurrentRun`),
   * and this id turns them all into one upserted row.
   */
  let runId = createRunId();

  /**
   * 把**目前這一局**的成績送進榜單。可以安全地重複呼叫 —— 同一個 `runId` 只會 upsert 同一筆。
   * Record **the run in progress**. Safe to call repeatedly: the `runId` upserts a single row.
   *
   * 一局不只在一處結束。自然結束（溢位逾時）、玩家按重新開始把它丟掉、玩家關掉分頁或切到
   * 背景、以及玩家在排行榜發布列按下儲存的那一刻 —— 這些都是同一局的不同時間點，任何一個都
   * 可能是「最後一次機會」。以前只在自然結束與重新開始記錄，於是關分頁的一局就永遠消失了；
   * 現在全部走這一條，`runId` 保證不會變成兩筆。
   * A run does not end in one place. It can end naturally (overflow timed out), be abandoned with
   * restart, have its page closed or backgrounded, or be published the moment save is pressed in
   * the leaderboard — all the same run at different moments, any of which may be the last chance.
   * Previously only a natural end and a restart recorded it, so a run whose tab was closed simply
   * vanished. Everything now goes through here, and `runId` keeps it to one row.
   *
   * 完全沒有動靜的一局（0 分、0 次合成）不記：那些是誤按，記進去只會把榜洗掉。
   * A run with no activity at all (0 score, 0 merges) is skipped: a stray tap would otherwise
   * wash out the board.
   *
   * **規則總開關一開，這裡整個短路**（使用者定案）：「開啟期間的成績一律不記入排行榜」是總開關
   * 的定義，所以判準放在這一條唯一的記錄出口上，而不是散在四五個呼叫點各自檢查。
   * **With the master rule switch on, this short-circuits entirely** (the user's decision):
   * "nothing is recorded while it is on" is what the switch *means*, so the test lives on this
   * one recording exit rather than being repeated at each of the four or five call sites.
   */
  const recordCurrentRun = (): void => {
    if (preferences.rulesEnabled) return;
    if (session.score <= 0 && session.mergedCount <= 0) return;

    leaderboardSource.record({
      runId,
      score: session.score,
      maxCombo: session.maxCombo,
      merges: session.mergedCount,
    });
  };

  /**
   * 重設進行中的一局。結算覆蓋層的「再玩一次」與工具列的重新開始鍵共用這一條路，
   * 兩邊的行為（包括 BEST TRY 的基準點）才不會各養一份。
   * Reset the run in progress. The overlay's "play again" and the toolbar's restart share
   * this one path so both behaviours (including the BEST TRY baseline) stay identical.
   */
  const restartRun = (): void => {
    /* 先記錄再重設：`reset()` 會把這一局的成績清掉。 */
    recordCurrentRun();
    session.reset();
    /* 新的一局用新的 id，舊那筆才不會被這一局的成績覆蓋。 */
    runId = createRunId();
    shownGameOver = false;
    gameOver?.hide();
    runStartBest = progress.highScore;
    updateHud();
    updateSkills();
  };

  /*
   * 「這一局還沒結束就要走了」的兩個出口：分頁被關掉／切走。`pagehide` 涵蓋關閉、重新載入
   * 與前後頁導覽；`visibilitychange → hidden` 涵蓋切到背景（手機切 app、切分頁）。兩個都只
   * 呼叫 upsert，所以之後玩家回來繼續玩、這一局真的結束時，同一筆會被更新成最終成績。
   * The two exits for "leaving before the run is over": the page closing or going away.
   * `pagehide` covers close, reload and navigation; `visibilitychange → hidden` covers being
   * backgrounded (app switch on mobile, tab switch). Both merely upsert, so if the player comes
   * back and finishes the run, the same row is updated with the final numbers.
   */
  window.addEventListener('pagehide', recordCurrentRun);
  document.addEventListener('visibilitychange', (): void => {
    if (document.visibilityState === 'hidden') recordCurrentRun();
  });

  /**
   * 技力條與技能欄每幀同步。兩個元件都只在值真的變了才動 DOM，所以這樣做是便宜的。
   * The meter and the bar sync every frame; both only touch the DOM on a real change, so this
   * stays cheap.
   */
  const updateSkills = (): void => {
    spMeter.update({ value: session.spValue, max: session.spMax });
    skillBar.update(session.skillCards);
    skillHint.update(session.skillCards);
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
   * `onPublish` 把**正在進行**的這一局一併交出去：玩家按完儲存就預期看到自己的紀錄，而不是
   * 等這一局結束。`onSaved` 接著開榜，讓那一筆立刻出現在眼前。
   * `onPublish` hands over the run **in progress**, because the player expects to see his record
   * as soon as save is pressed; `onSaved` then opens the board so it is right there.
   */
  const publishPrompt = createPublishPrompt({
    host: layout.root,
    source: leaderboardSource,
    onPublish: recordCurrentRun,
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
   * 設定彈窗（工具列齒輪）。它把三個來源接在一起：偏好（語系／規則）、排行榜（名稱／分享）
   * 與上面同一條 `recordCurrentRun`。在設定裡按下儲存、且同意分享之後，會把**正在進行**的
   * 這一局交出去 —— 玩家改完名字立刻在榜上看到自己，和首次詢問走的是同一條路。
   * The settings popup (toolbar gear) ties three sources together: preferences (locale/rules),
   * the leaderboard (name/sharing) and the same `recordCurrentRun` path. Pressing save in
   * settings **with sharing on** hands over the run **in progress**, so a rename shows up on
   * the board immediately — the very same path the one-off prompt takes.
   */
  const settings = createSettings({
    host: layout.root,
    preferences,
    leaderboard: leaderboardSource,
    onPublish: recordCurrentRun,
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

      updateHud();
      updateSkills();

      if (current.isOver && !shownGameOver) {
        shownGameOver = true;
        /* 這一局到此為止：先上榜（upsert 最終成績），再彈結算。 */
        recordCurrentRun();
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
  };
  exposeForDebugging(context);
}

/**
 * 產生一局的識別碼。
 * Mint a run id.
 *
 * 用 `crypto.randomUUID`（安全上下文才有），沒有就退回「時間 ＋ 亂數」。這只是本地去重用的
 * 標籤，不需要密碼學強度；接上真後端時它會變成那一筆紀錄的 id。
 * Uses `crypto.randomUUID` where available, otherwise a time-plus-random fallback. It is only a
 * local de-duplication label, not a security token; with a real backend it becomes the record id.
 */
function createRunId(): string {
  const uuid = globalThis.crypto?.randomUUID;
  return typeof uuid === 'function'
    ? uuid.call(globalThis.crypto)
    : `${String(Date.now())}-${Math.random().toString(36).slice(2, 10)}`;
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
