/**
 * 技能示意 GIF 產生器（第一段）：接管時間軸 → 逐幀驅動真實遊戲 → 截圖。
 * Skill GIF generator, stage one: take over the timeline, drive the real game frame by frame and
 * screenshot each frame. Stage two is `assemble-skill-gifs.py`, which turns the frames into GIFs.
 *
 * 用法 / Usage:
 *   1. 先開開發伺服器：`npm run dev`（腳本預設打 http://localhost:5199/）
 *   2. `CHROME_PATH=<chromium 執行檔> node scripts/capture-skill-gifs.mjs [skill-id]`
 *   3. `python scripts/assemble-skill-gifs.py`
 *
 * 需要 `playwright-core`（等同 repo 外的臨時依賴；`npm i -D playwright-core` 或指向任何已安裝的位置），
 * 而 `CHROME_PATH` 指向一個 Chromium／Chrome 執行檔 —— 不必下載瀏覽器。
 * Requires `playwright-core` and a Chromium/Chrome binary in `CHROME_PATH`; nothing needs downloading.
 *
 * 兩個關鍵前提：
 * 1. 假的 `requestAnimationFrame` ＋ 假的 `performance.now`，所以時間只由 `__pump()` 推進 ——
 *    每張截圖之間都是同一段物理時間，GIF 不會因為截圖慢而「跳格」。
 * 2. 開發模式會把 `session` 與 `viewport` 掛到 `window.__endchi`（見 `main.ts`），所以腳本讀得到
 *    每一顆的真實座標，不必靠猜位置去點它。
 * Two prerequisites: a fake rAF/performance.now so only `__pump()` advances time, and the dev-only
 * `window.__endchi` handle (see `main.ts`) so the script can read every body's real position
 * instead of guessing where to click.
 *
 * 兩段之間的約定：`canvas` 模式的幀是**透明** PNG，背景由合成器按 `background.webp` 補回；
 * 只有 `mode: 'page'`（連勢不墜要看連擊卡）才是已經含背景的整頁截圖。
 * Contract between the stages: `canvas` frames are **transparent** PNGs and the compositor puts the
 * backdrop back from `background.webp`; only `mode: 'page'` (the combo card) is a page screenshot.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXE = process.env.CHROME_PATH;
const OUT = path.join(os.tmpdir(), 'endchi-skill-gifs');
const BASE = process.env.DEV_URL ?? 'http://localhost:5199/';

if (EXE === undefined) {
  throw new Error('Set CHROME_PATH to a Chromium/Chrome executable, e.g. CHROME_PATH="C:/.../chrome.exe".');
}
/** 每 5 個 60fps 物理幀抓一張 ＝ 12fps 的 GIF。 / One shot every five physics frames = 12 fps. */
const CAPTURE_EVERY = 5;
/** 佈置階段每 9 塊抓一張（＝ 每 45 幀）：看得見盤面怎麼堆起來，又不至於佔滿格數。 */
/** One frame every nine blocks (45 frames) while setting up: the build-up shows without dominating. */
const LEAD_STRIDE = 9;
/** 施放前停留的物理幀數（約 0.4 秒）。 / Physics frames to hold the pre-cast board (about 0.4 s). */
const HOLD_BEFORE = 24;

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EXE });
/** 目前情境的頁面；輔助函式都靠它。 / The current scenario's page; every helper uses it. */
let page;

async function makePage(query) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

  await page.addInitScript(() => {
    window.__t = 0;
    window.__pending = null;
    window.requestAnimationFrame = (cb) => {
      window.__pending = cb;
      return 1;
    };
    window.cancelAnimationFrame = () => {
      window.__pending = null;
    };
    Object.defineProperty(window.performance, 'now', { configurable: true, value: () => window.__t });
    window.__pump = (frames, dt = 1000 / 60) => {
      for (let i = 0; i < frames; i += 1) {
        window.__t += dt;
        const cb = window.__pending;
        window.__pending = null;
        if (cb) cb(window.__t);
      }
    };
    localStorage.setItem('endchimerge:unlocks', JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    localStorage.setItem('endchimerge:share-score', 'true');
    localStorage.setItem('endchimerge:publish-prompt', 'true');
  });

  await context.route('**/config/skills.json', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    /* 示意圖只在乎「做出效果」，所以每個技能都免費且隨時可按。 */
    json.sp.max = 3;
    json.sp.initial = 3;
    json.sp.gainPerDrop = 10;
    json.sp.gainPerCombo = 10;
    for (const skill of json.skills) {
      skill.cost = 0;
      skill.unlock = { kind: 'sp' };
    }
    await route.fulfill({ json });
  });

  await page.goto(BASE + query, { waitUntil: 'networkidle' });
  await boot();
  return context;
}

/**
 * 等到技能卡建好。載入會等圖片解碼（真時間），而畫面更新要我們推幀（假時間），
 * 所以兩者交錯：給一點真時間，再推幾幀。
 * Wait until the cards exist. Loading waits on image decoding (real time) while drawing needs
 * pumped frames (fake time), so the two are interleaved.
 */
async function boot() {
  for (let i = 0; i < 60; i += 1) {
    await page.waitForTimeout(100);
    await page.evaluate(() => window.__pump(4));
    const ready = await page.evaluate(
      () => Boolean(window.__endchi) && document.querySelectorAll('button[data-skill-id]').length > 0,
    );
    if (ready) {
      await page.evaluate(() => window.__pump(4));
      return;
    }
  }
  throw new Error('the game never became ready');
}

/**
 * 逐塊推進物理並依 `captureStride` 抓幀。整段一次推完就沒有中間狀態可抓，而每塊 5 幀剛好
 * 對應 GIF 的 12 fps，所以「抓一張」＝「一格」。
 * Pump the physics in blocks, grabbing a frame every `captureStride` blocks. Pumping a whole stretch
 * at once would leave no intermediate states to capture, and one five-frame block is exactly one
 * GIF frame at 12 fps.
 */
let captureStride = Infinity;
let captureTick = 0;
let pendingShot = null;

async function settle(frames) {
  let remaining = frames;
  while (remaining > 0) {
    const step = Math.min(CAPTURE_EVERY, remaining);
    await page.evaluate((n) => window.__pump(n), step);
    remaining -= step;
    captureTick += 1;
    if (pendingShot !== null && captureTick % captureStride === 0) await pendingShot();
  }
}

/** 盤面快照：每顆的虛擬座標與半徑，加上畫布位置與縮放。 / Board snapshot plus canvas geometry. */
async function readBoard() {
  return page.evaluate(() => {
    const { session, viewport } = window.__endchi;
    const rect = document.querySelector('canvas').getBoundingClientRect();
    return {
      scale: viewport.scale,
      virtualWidth: viewport.virtualWidth,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      bodies: session.bodies.map((body) => ({
        levelId: body.levelId,
        x: body.x,
        y: body.y,
        radius: body.radius,
      })),
    };
  });
}

/** 虛擬座標 → 視窗座標。 / Virtual coordinates into viewport pixels. */
function toCss(board, point) {
  return {
    x: board.rect.x + point.x * board.scale,
    y: board.rect.y + point.y * board.scale,
  };
}

async function clickVirtual(board, point) {
  const css = toCss(board, point);
  await page.mouse.move(css.x, css.y);
  await page.mouse.down();
  await page.mouse.up();
}

/** 在某個虛擬 X 投放一顆（Y 不影響投放，只影響瞄準）。 / Drop at a virtual X (Y does not matter for dropping). */
async function dropAt(vx) {
  const board = await readBoard();
  await clickVirtual(board, { x: vx, y: board.virtualWidth * 0 });
  await settle(58);
}

/** 按畫面寬度的比例投放。 / Drop at a fraction of the visible width. */
async function drop(fx) {
  const board = await readBoard();
  await dropAt(board.virtualWidth * fx);
}

/** 挑一顆：`pick` 決定挑哪顆（預設最大）。 / Choose a body; the largest by default. */
function choose(bodies, pick) {
  if (bodies.length === 0) return null;
  const byRadius = [...bodies].sort((a, b) => a.radius - b.radius);
  if (pick === 'smallest') return byRadius[0];
  if (pick === 'leftmost') return [...bodies].sort((a, b) => a.x - b.x)[0];
  if (pick === 'rightmost') return [...bodies].sort((a, b) => b.x - a.x)[0];
  return byRadius[byRadius.length - 1];
}

/** 目前的連擊串長（直接讀 session）。 / The current chain length, read straight off the session. */
function chain() {
  return page.evaluate(() => window.__endchi.session.comboCount);
}

async function cast(id) {
  await page.click(`button[data-skill-id="${id}"]`);
  await settle(4);
}

/**
 * 一個情境：`setup` 佈置盤面，`act` 施放（可含點選），`hold` 是施放後要抓的物理幀數。
 * A scenario: `setup` builds the board, `act` casts (possibly with picks), `hold` is how many
 * physics frames to capture afterwards.
 */
const PILE = [0.24, 0.4, 0.56, 0.72];

const SCENARIOS = [
  {
    id: 'discard',
    hold: 60,
    async setup() {
      for (const fx of PILE) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('discard');
      const board = await readBoard();
      const target = choose(board.bodies);
      if (target !== null) await clickVirtual(board, target);
    },
    check: (before, after) => after.bodies.length === before.bodies.length - 1,
  },
  {
    id: 'ascend',
    hold: 60,
    async setup() {
      for (const fx of [0.28, 0.44, 0.6]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('ascend');
      const board = await readBoard();
      const target = choose(board.bodies, 'smallest');
      if (target !== null) await clickVirtual(board, target);
    },
    /* 顆數不變、其中一顆的等級變高 ＝ 升級生效。 / Same count, one body a level higher = the promotion landed. */
    check: (before, after) =>
      after.bodies.length === before.bodies.length &&
      after.bodies.some((body, index) => body.levelId > before.bodies[index].levelId),
  },
  {
    id: 'protocol_float',
    hold: 96,
    async setup() {
      for (const fx of [0.24, 0.38, 0.52, 0.66, 0.8]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('protocol_float');
    },
    check: (before, after) =>
      Math.min(...after.bodies.map((b) => b.y)) < Math.min(...before.bodies.map((b) => b.y)) - 40,
  },
  {
    id: 'scramble',
    /* 重排要有「之前」才看得懂：先看它把左邊堆成柱、右邊一顆孤立。 */
    /* A permutation needs a before: build a column on the left and one lonely body on the right. */
    lead: true,
    hold: 60,
    async setup() {
      /* 一邊擠成一堆、一邊孤立：重排之後「誰去了哪」才看得出來。 */
      /* A pile on the left, one lonely body on the right: only then does a permutation read. */
      for (const fx of [0.22, 0.26, 0.3, 0.34, 0.38, 0.78]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('scramble');
    },
    /* 重排是「位置互換」，所以看某一顆走了多遠，而不是看最小／最大 x。 */
    check: (before, after) =>
      before.bodies.some((body, index) => Math.abs(body.x - after.bodies[index].x) > 25),
  },
  {
    id: 'combo_grace',
    region: 'combo',
    mode: 'page',
    hold: 150,
    async setup() {
      /*
       * 一直往同一點丟，直到真的合成一次（掉落池不只一級，所以兩顆不一定同級）。
       * 連擊必須在施放前就 ≥ 1，否則護盾沒有東西可保，GIF 也看不出效果。
       * Keep dropping on one spot until a merge actually happens (the pool holds more than one
       * level, so two drops are not guaranteed to match). The chain has to be ≥ 1 before the cast,
       * or the shield has nothing to protect and the GIF shows nothing.
       */
      for (let i = 0; i < 14 && (await chain()) < 1; i += 1) await drop(0.5);
      await settle(45);
    },
    async act() {
      const before = await chain();
      await cast('combo_grace');
      for (const fx of [0.24, 0.8, 0.24]) await drop(fx);
      return before;
    },
    check: (before, after, extra) => typeof extra === 'number' && extra >= 1,
  },
  {
    id: 'shake',
    hold: 130,
    async setup() {
      for (const fx of [0.26, 0.4, 0.54, 0.68]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('shake');
    },
    check: () => true,
  },
  {
    id: 'reshuffle',
    /*
     * 「清空重落」必須先看見被清掉的是什麼：佈置階段逐顆下三顆，把容器填起來，
     * 之後那一下清空才有東西可以失去。
     * "Clear and re-rain" only reads if you see what got cleared: the lead-in drops three bodies
     * into the container, so the sweep actually takes something away.
     */
    lead: true,
    hold: 180,
    async setup() {
      /* 先把容器堆到有份量：清空時才有東西可失去。 */
      /* Fill the container first, so clearing it actually takes something away. */
      for (const fx of [0.24, 0.36, 0.48, 0.6, 0.72, 0.3, 0.54]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('reshuffle');
    },
    checkAt: 'final',
    check: (before, after) => after.bodies.length > before.bodies.length,
  },
  {
    id: 'fate_swap',
    hold: 60,
    async setup() {
      await drop(0.26);
      await drop(0.74);
      await settle(40);
    },
    async act() {
      await cast('fate_swap');
      const board = await readBoard();
      const left = choose(board.bodies, 'leftmost');
      const right = choose(board.bodies, 'rightmost');
      if (left !== null) await clickVirtual(board, left);
      await settle(4);
      if (right !== null) await clickVirtual(board, right);
    },
    /* 互換之後第一顆應該跑到另一邊。 / After the swap the first body ends up on the other side. */
    check: (before, after) => after.bodies[0].x > before.bodies[0].x + 25,
  },
  {
    id: 'shrink_all',
    hold: 60,
    async setup() {
      for (const fx of [0.26, 0.4, 0.54, 0.68]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('shrink_all');
    },
    check: (before, after) =>
      Math.max(...after.bodies.map((b) => b.radius)) <
      Math.max(...before.bodies.map((b) => b.radius)) - 5,
  },
  {
    id: 'square_core',
    /*
     * 這一招改的是**碰撞體**，靜態畫面看不出來；`?debug=1` 的除錯輔助線剛好把碰撞體畫成
     * 紅線 ＋ 藍點，所以只有這張圖開著它 —— 圓形輪廓變成四個角，一眼就看得出改了什麼。
     * This skill changes the **collider**, which a still frame does not show; `?debug=1` draws the
     * collider as red edges plus blue dots, so this one GIF keeps it on: the round outline becomes
     * four corners, and the change is obvious at a glance.
     */
    query: '?debug=1',
    /* 先看盤面怎麼落成，再看到同一批顆粒的碰撞體被換掉 —— 否則「換了」沒有參照物。 */
    /* See the board settle first, then watch the same bodies swap colliders; otherwise "changed" has nothing to compare against. */
    lead: true,
    hold: 90,
    async setup() {
      for (const fx of [0.3, 0.44, 0.58, 0.72, 0.38]) await drop(fx);
      await settle(40);
    },
    async act() {
      await cast('square_core');
    },
    check: (before, after) => after.bodies.length > 0,
  },
];

const only = process.argv[2];

for (const scenario of SCENARIOS) {
  if (only !== undefined && only !== scenario.id) continue;

  const context = await makePage(scenario.query ?? '');
  /*
   * 取景一律是**整塊畫布**：GIF 要能完整裝進彈窗的媒體框（`object-fit: contain`），
   * 任何預先裁掉的邊都會變成「有些東西永遠看不到」。
   * Every clip is the **whole canvas**: the GIF has to fit inside the popup's media frame
   * (`object-fit: contain`), and anything cropped away up front can never be seen.
   */
  const clip = await page.evaluate((region) => {
    const canvas = document.querySelector('canvas').getBoundingClientRect();
    if (region === null) {
      return { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height };
    }
    const extra = document.querySelector(`[data-region="${region}"]`).getBoundingClientRect();
    const x = Math.min(canvas.x, extra.x);
    const y = Math.min(canvas.y, extra.y);
    return {
      x,
      y,
      width: Math.max(canvas.x + canvas.width, extra.x + extra.width) - x,
      height: Math.max(canvas.y + canvas.height, extra.y + extra.height) - y,
    };
  }, scenario.region ?? null);

  const dir = path.join(OUT, scenario.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  /*
   * 預設直接抓**畫布**（透明 PNG，之後由 Python 疊上真正的背景圖）：把頁面截圖塞進 GIF 等於
   * 每格都帶一張不會動卻無法壓縮的照片背景 —— 第一版就是這樣變成 27MB。透明畫布 ＋ 由合成器
   * 疊回 `assets/ui/background.webp` 的對應區域，既保留真實色調，又只付一次代價。
   * 只有需要畫布以外東西的情境（連勢不墜要看連擊卡）才整頁截圖。
   * The default grabs the **canvas** (a transparent PNG; Python composites it onto the real
   * backdrop): baking page screenshots into a GIF makes every frame carry a photographic
   * background that never moves and cannot be compressed — that is what made the first attempt
   * 27MB. A transparent canvas plus the matching crop of `assets/ui/background.webp` keeps the true
   * colours while paying for the backdrop only once. Only a scenario needing something outside the
   * canvas (the combo card) shoots the page.
   */
  let index = 0;
  const shot = async () => {
    const file = path.join(dir, `${String(index).padStart(3, '0')}.png`);
    if (scenario.mode === 'page') {
      await page.screenshot({ clip, type: 'png', path: file });
    } else {
      const dataUrl = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
    }
    index += 1;
  };

  pendingShot = shot;
  captureTick = 0;

  /*
   * 「前設情景」：需要先看到盤面怎麼堆起來的技能（重排、清空重落、換幾何），佈置階段就開始抓，
   * 但抓得稀一點 —— 佈置只是背景故事，不該佔掉大半格數。
   * A lead-in: for the skills whose point is what the board looked like first (reshuffle, scramble,
   * a geometry swap), capture during setup as well — sparsely, because the build-up is context and
   * must not eat most of the frames.
   */
  captureStride = scenario.lead === true ? LEAD_STRIDE : Infinity;
  await scenario.setup();
  const before = await readBoard();

  /* 施放前停留約半秒：不然「之前」只閃一格，看不出前後差別。 */
  /* Hold the pre-cast board for about half a second; otherwise "before" is a single flash. */
  captureStride = 1;
  await settle(HOLD_BEFORE);

  const extra = await scenario.act();
  await settle(CAPTURE_EVERY);
  const after = await readBoard();

  const rounds = Math.floor(scenario.hold / CAPTURE_EVERY);
  for (let i = 0; i < rounds; i += 1) await settle(CAPTURE_EVERY);

  pendingShot = null;
  const final = scenario.checkAt === 'final' ? await readBoard() : after;
  const verdict = scenario.check(before, final, extra);

  const summary = {
    id: scenario.id,
    frames: index,
    clip,
    viewport: await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
    mode: scenario.mode ?? 'canvas',
    count: { before: before.bodies.length, after: after.bodies.length },
    levels: { before: before.bodies.map((b) => b.levelId), after: after.bodies.map((b) => b.levelId) },
    radii: { before: before.bodies.map((b) => Math.round(b.radius)), after: after.bodies.map((b) => Math.round(b.radius)) },
    pass: verdict,
  };

  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary));

  await context.close();
}

await browser.close();
