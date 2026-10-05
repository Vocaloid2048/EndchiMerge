# 變更紀錄

本檔案記錄每個里程碑交付了什麼。專案尚未正式發佈，因此以**里程碑**（M0–M10）而非
語意化版本號分節；第一次上線（M10）之後才會開始打 tag。

里程碑的定義見工作文件 `design.md` §8。

---

## 未發佈 — `feat-drop-feature`（M4 合成核心 ＋ M6 解鎖與圖鑑 ＋ 輪廓碰撞）

分支關係：`feat-ui-init` → `dev` → `feat-drop-feature`。M5（技力與技能）依使用者指示**跳過**，
不在本節範圍；M6 不依賴 M5。`feat-drop-feature` 額外收錄兩項玩法修正：
**溢位入堆改以接觸判定**、**碰撞框由圓形改為光柵化輪廓（凸分解）**。

### 新增 — 合成核心、冷卻與計分

兩顆同級接觸就合成下一級。合成判定拆成**兩段**：碰撞回呼只收集候選對，等這一步的物理
跑完才由 `flushMerges()` 執行 —— 在碰撞回呼裡新增／移除剛體等於在引擎解算途中改動世界。

- `src/game/merge.ts`：純函式 `mergeResultId(a, b)`。
- `src/game/session.ts`：`collisionStart` → 收集（`claimed` 集合確保一顆只被用掉一次）
  → `flushMerges()` → `merge()`；合成體生成在兩顆的質心中點。
- **物件對冷卻** `mergeCooldownMs`（100ms，`levels.json`）：比對「生成時刻」而不是
  「上次被誰碰過」，所以同一顆球不論跟誰碰撞，規則都只有一條。
- 分數 ＝ `score[合成後等級] × 當下倍率`，累加後取整。
- `tests/merge.test.ts`、`tests/session.test.ts` 的「合成與計分」。

### 新增 — 連擊（Combo）與 HUD

倍率改為**非線性、緩慢上升**，`n = 60` 時到達天花板 ×10.0：

```
comboMultiplier(n) = min( e^(0.075 × n) / 10, 9 ) + 1
```

- `src/game/combo.ts`：`COMBO_CURVE` ＋ `comboMultiplier()` ＋ `ComboTracker`。
  `snapshotAt()` **無副作用**，所以 HUD 可以每幀查詢而不影響玩法。
- **「同一批」的判準改為「時間戳相同」。** 舊草案寫「相隔 < 0.1s 視為同一批、不重複計數」，
  但同一份草案又說連鎖反應**應該**堆出高倍率 —— 兩句互相矛盾：連鎖反應本來就落在極短間隔
  內，0.1s 的門檻會把它整串吞掉。同一物理步的多場合併共用同一個時間戳，這才是「同一批」
  真正要防的東西。為此 `session.step()` **先把時鐘往前推再跑物理**。
- `n = 0` 回傳 `1.0` 而不是公式算出的 `1.1`：靜止狀態顯示 ×1.1 會讓玩家以為一直有加成。
  這是唯一一處刻意偏離公式的地方，只影響「沒有連擊」那一格。
- COMBO 卡顯示串長與倍率，倍率取一位小數（`×3.3`），避免 `×3.3000000000000003`
  這種浮點尾巴（`src/ui/hud.ts`）。

### 新增 — 彈跳動畫

合成後新生成的那顆從峰值縮回原尺寸：`scale = 1 + (POP_PEAK_SCALE - 1) × (1 - t)²`。

- `src/core/constants.ts`：`POP_ANIMATION_MS`（180ms）與 `POP_PEAK_SCALE`（1.3）（調參入口）。
- `src/game/session.ts`：`pops` Map ＋ `popScale()`；`RenderBody.scale` 傳到渲染層。
- `src/render/stage.ts`：`drawBody()` 把彈跳倍率與半徑換算**只在這一處**相乘；佔位圖也吃同一個倍率。
- `tests/session.test.ts`：合成當步 `scale === 1.3`、播完回到 `1`。

### 新增 — 溢位線、3 秒寬限與結算

容器頂緣往上 `overflowAboveRim`（30）畫一條紅色虛線，線與頂緣之間是淺紅色警戒區；
投放點在再往上 `dropAboveRim`（40）的位置。越線後連續倒數 `overflowGraceMs`（3000ms），
逾時結束這一局。

- `src/game/overflow.ts`：`OverflowMonitor`。**連續計時而非累計** —— 方團團正常落下時就會
  短暫經過線上，累加那些瞬間會誤殺正常局面，所以場上沒有東西越線就立刻歸零。
- `src/render/stage.ts`：`OVERFLOW_STYLE`。警戒區畫在方團團**之下**（它是背景提示），
  紅線畫在**之上**（門檻必須隨時看得見）。脈動相位由 `game/loop.ts` 以時間驅動，渲染器不存狀態。
- `src/ui/gameOver.ts` ＋ `src/styles/game-over.css`：結算覆蓋層（SCORE / MERGED / BEST
  ＋ `NEW BEST` 徽章 ＋ 再玩一次）。`isOver` 一旦成立就永久為真，所以 `main.ts` 用
  `shownGameOver` 旗標讓它**每局只彈一次** —— 少了它會每一幀重設焦點、重播新紀錄。
- 「投放高度」與「溢位線高度」改為相對容器頂緣推導：
  `spawnYValue = frame.y - dropAboveRim`、`overflowLineY = frame.y - overflowAboveRim`。
  `container.json` 的 `spawnGap` 只負責瞄準範圍的左右內縮。載入器新增
  `checkDropClearsOverflow`：`dropAboveRim ≤ overflowAboveRim` 時發出語意警告。

### 修正 — 連續投放會把溢位寬限計時器自己填滿

投放點刻意在溢位線**上方** 10 個單位，所以每顆剛生成的方團團上緣一開始就在線之上，
要往下落 30 個單位才降到線下 —— 實測約 **14 個物理步（≈233ms）**。**間隔短於 233ms 的
連續投放**會讓這些穿越首尾相接，計時器一路爬滿 3 秒：以每 100ms 投一顆實測，
**第 31 顆、模擬時間 3.1 秒**就結束了這一局，而容器裡只有 24 顆散落的方團團，
堆疊最高點離溢位線還很遠。**規則量到的是「投放」，不是「堆疊」。**

修法是 `Entry.entered`：一顆方團團要先「入堆」，它的越線才被計入。
「剛投下、下墜中」不算；「已入堆、被後來的堆疊擠到頂緣之上」**要算**（那正是溢出），
所以旗標只能是單向鎖存，不能寫成「現在低於頂緣」這種即時判斷。

**入堆的定義在 `feat-drop-feature` 上換成了「接觸」。** 第一代用幾何判斷
（圓心曾經降到容器頂緣以下），但半空掠過頂緣、誰都還沒碰到的方團團也會被判成已入堆 ——
玩家看到的是「明明還在掉，怎麼就警告了」。現行版本改由 `collisionStart` 觸發：
一對碰撞中**雙方都是方團團**時，才把兩者的 `entered` 都鎖存為真。
撞牆、撞地板、撞容器頂緣**一律不計**。

- `src/game/overflow.ts`：`OverflowBody` 新增必要欄位 `entered`。
- `src/game/session.ts`：`Entry.entered` ＋ `collectMerges()` 內以接觸鎖存。
- `src/game/session.ts`：新增 `resolveEntry()` —— **輪廓碰撞體是複合剛體**，
  `collisionStart` 配對帶的是子零件（`body.id` ≠ 母體 id），直接查 `byBodyId` 會全部落空，
  合成與溢位偵測會一起**靜默失效**。先查 `body.id`，查不到就沿 `body.parent` 再查。
- `tests/overflow.test.ts`：新增「還在下墜的不算」「整串下墜中的顆粒填不滿計時器」
  「入堆之後被擠回頂緣之上仍要算」。
- `tests/session.test.ts`：新增整合層回歸測試（以 `overflowGraceMs: 0`，任何一次誤判都會在
  第一幀立刻結束該局）。**把 `resolveEntry()` 換回直接的 `byBodyId.get()`，
  這兩處共 2 條測試會失敗。**

### 改動 — 碰撞框由圓形改為光柵化輪廓

方團團的碰撞體原本一律是圓。實際做起來落差比預期大：本體框 304×304，但
**外輪廓有 6.5%–24.6% 落在框外**（`訣` Lv9 最誇張），用圓去包會出現「明明沒碰到卻黏住」，
用圓去切翅膀又會穿模。因此改為**沿 sprite 的 alpha 輪廓建多邊形剛體**。

- `src/render/silhouette.ts`（新）：純幾何、可在 node 測。Moore 鄰域邊界追蹤
  （8 連通、`step = 2`、`threshold = 8`）＋ **RDP 簡化**（`epsilon = 3`，以顯式堆疊實作
  而非遞迴）。原始輪廓約 1200–1500 點 → 簡化後 **30–46 個頂點**。附 `isDegenerate()`、
  `toVirtualPolygon()`、`contourToPolygon()`。
- `src/render/silhouetteLoader.ts`（新）：瀏覽器端膠水。`extractAlphaMask()` 用
  `OffscreenCanvas` 讀 alpha；`buildSilhouetteCache()` 逐級以
  `scale = (2 × radius) / SPRITE_BODY` 產生輪廓，失敗或素材缺失記 `null`。
- `src/core/physics.ts`：新增 `createPolygonBody()`
  （`Matter.Bodies.fromVertices(..., true)`）；有效性判準是**質量**
  （`Number.isFinite(mass) && mass > 0`），**不是** `parts.length` ——
  凸多邊形分解後本來就只有 1 個 part，用 parts 數量判斷會誤殺。
  模組頂層註冊 `Matter.Common.setDecomp(decomp)`；**少了這行，`fromVertices`
  對凹多邊形會直接回 `undefined`。**
- `src/poly-decomp.d.ts`（新）：`poly-decomp` 是 CJS 且**上游沒有 TS 型別**
  （`@types/poly-decomp` 不存在），手寫宣告。
- `src/game/session.ts`：`GameSessionOptions.silhouettes`（**可選**）＋
  `createBody()` 統一供 `drop()` / `merge()` 使用 —— 有輪廓就用多邊形，否則退回圓。
- **旋轉不再鎖定**（`lockRotation: false`）：輪廓碰撞體與 sprite 同角度，兩者永遠對齊；
  鎖住旋轉反而會讓 sprite 轉了、碰撞體沒轉。堆疊穩定後實測角度是散的，符合預期。
- 回退路徑：素材缺失、載入失敗、輪廓退化（頂點 < 3 或面積 ≈ 0）時一律退回圓；
  `silhouettes` 未注入時全場都是圓（測試沿用）。
- `package.json`：新增相依 `poly-decomp`。
- `tests/silhouette.test.ts`（16 條）、`tests/polygonBody.test.ts`（5 條）新增。
- `docs/physics.md` §「碰撞形狀一律為圓」整節改寫；`docs/rendering.md` §2.3 補註。
- **製圖注意**：輪廓取自 alpha 通道，所以 sprite 的透明區域必須**真的透明**。
  畫在白底上再匯出，輪廓會退化成整個方框，等於白做。

### 新增 — M6：解鎖系統與生成池過濾

- `src/game/progress.ts`：`ProgressStore` —— 解鎖集合 ＋ 最高分。儲存體**可注入**
  （`ProgressStorage`）：無痕模式或關閉 cookie 時 `localStorage` 光是存取就拋錯，此時退回
  「只活在記憶體裡」；讀寫一律包 try/catch，壞掉的存檔視為空。
- **鏈首一律解鎖**（`baseline` ＝編號最小的等級），否則開局完全沒有東西可掉。
- **生成池過濾**：`src/game/spawnQueue.ts` 的進池條件為
  `droppable && spawnWeight > 0 && unlocked.has(id)`。所以**即使 `levels.json` 標了
  `droppable: true`，未解鎖的等級也不會出現在掉落佇列**；開局只有 Lv1 解鎖，初始只掉 Lv1，
  每合出一級那一級才加入池。新增 `setUnlocked()` —— 接收新集合、剔除已不在池中的項目並補齊佇列。
- **解鎖跨局不重設**（`design.md` D5）。`GameSession` 每局重建，所以解鎖不能存在裡面：
  `session` 只在合出新等級時呼叫 `unlocks.unlock()`，並在成功時刷新生成池；
  `reset()` 只清「這一局的東西」（剛體、分數、連擊、溢位計時），保留解鎖與最高分。
- `tests/progress.test.ts`（14 條，含無痕模式與壞存檔）、`tests/spawnQueue.test.ts` 的閘門測試、
  `tests/session.test.ts` 的「解鎖與生成池」。

### 變更 — MELTING LIST 即圖鑑

使用者定案：**MELTING LIST 就是圖鑑**，不另開頁面。

- 解鎖判斷改為依**等級編號**（`unlocked.has(level.id)`），而不是「索引小於已解鎖數量」，
  這樣不必假設等級表順序或編號連續。
- `progress.onChange()` 是**唯一的通知路徑**：解鎖一發生就重畫名冊，把 `???` 換成角色圖。
- `aria-label` 改為「合成鏈圖鑑，共 N 級，已解鎖 M 級」。

### 新增 — 可供程式化驗證的 DOM hook

`data-hook` 屬性（`combo-count`、`combo-multiplier`、`merged`、`best-try`）讓驗證腳本不必
猜 class 名稱就能讀到 HUD 的值。

### 已知缺口（本節仍未涵蓋）

- **M5（技力與技能）依使用者指示跳過**：SKILL LIST 仍為空；`skills.json` 的 `fate_swap`
  消耗 4 技力但 `sp.max` 只有 3，該技能永遠無法解鎖。
- **容器容量與半徑的平衡尚未校準**：以 Lv1（r=20）對 730×784 的可用區，實測要連續投放
  約 130 顆（每 100ms 一顆、模擬約 13 秒）才會真的堆到溢位線。半徑與物理參數全是暫定值
  （`levels.json → _meta.provisional`），待 M0 的半徑校準原型定案後整表重算。
- **嚴重溢出時堆疊會畫到畫布頂端之外**：牆只比頂緣高 `DEFAULT_WALL_OVERHANG`（240），
  堆得比那更高時方團團會被畫布裁掉。
- 其餘同前一節（描邊快取、半徑校準原型、設計稿 aspect、名冊走線 5px 等）。

---

## 未發佈 — `feat-ui-init`（M0 前置缺口 + M1 + M2 + M3）

分支關係：`feat-ui-init` → `dev` → `main`。本節涵蓋的範圍是「可以丟方團團」；
合成、Combo 與彈跳動畫已由上一節的 M4 補上。

### 修正 — 縮放 25% ↔ 500% 時整張畫布往右下漂

`#app` 原本用 `display: grid; place-items: center` 置中 1920×1080 的設計畫布。但
`transform: scale()` **不改變 layout 尺寸**，畫布在幾乎所有視窗下都比容器大，而置中一個
超尺寸元素的行為**不保證**（瀏覽器會把溢出推到一側、把元素貼齊 `start`），
`transform-origin` 於是脫離視窗中心，整張畫布往右下漂、右側面板被 `overflow: hidden`
裁掉。25% 縮放時視窗 CSS px 反而大於 1920×1080，置中恢復正常 —— 所以這個 bug 只在切到
高倍率時看得見。

置中改寫進 transform 本身（`ui/scale.ts → stageTransform()`）：
`translate(-50%, -50%) scale(k)`。以 headless Chrome 實測，1076×519 視窗下舊做法偏移
`(+422, +281)`，新做法偏移 ≈ `0`。硬性規則已記入 `../agent-readme.md` §版面與縮放規範。

- `src/styles/main.css`：`#app` 移除 grid 置中。
- `src/styles/layout.css`：`.stage-scale` 改為 `absolute` + `translate(-50%, -50%) scale()`。
- `src/ui/scale.ts`：新增 `stageTransform()`。
- `tests/stageScale.test.ts`：新增 `stageTransform()` 的置中形式斷言。

### 變更 — 容器由 3D 斜投影線框改為平面 U 形

容器改為**平面 U 形**（左牆＋右牆＋底部，頂端開口，底部 16 圓角），內部填 20%
`#FFFFFF`。外觀與投放留白全部外部化到 `public/config/container.json`
（`cornerRadius` / `strokeWidth` / `strokeColor` / `fill` / `topOffset` / `spawnGap`）；
`perspectiveDx` / `perspectiveDy` / `frontTint` / `backTint` 已移除。

- `src/render/container.ts`：`ContainerGeometry` 由 `{ front, back }` 改為單一 `frame`；
  新增 `uPath()` 與 U 形描邊（往內縮半個線寬，模擬設計稿的 `strokeAlign: INSIDE`）。
- `src/core/types.ts` / `configLoader.ts`：`ContainerConfig` 欄位更新。

### 變更 — 投放位置改由幾何推導

投放高度改為 `spawnYValue = frame.y - spawnGap`（U 形頂緣**上方** `spawnGap`），
瞄準範圍夾到 `frame 左右邊緣 ± (spawnGap + radius)`。

- `src/game/session.ts`：新增 `spawnYValue` getter；`clampAimX()` 改以 `frame` 為基準。
- `GameSettings.aimY` 已**移除**（原本寫死 90，落在槽內部）。

### 變更 — 旋轉改為依真實物理

新增 `levels.json → settings.lockRotation`（預設 `false`）。`false` 時不再呼叫
`lockRotation()`，碰撞力矩會讓方團團翻滾、沿斜面滾落，堆積因而自然。`physics.ts` 的
`lockRotation()` 保留為 opt-in。取捨：碰撞體是**圓**、畫面是**方**，自由旋轉會讓兩者的
不一致看得見；此為對 `design.md` §4.1「平面直立」的覆蓋。

- `src/core/physics.ts`：`lockRotation()` 改為 opt-in 並更新說明。
- `tests/session.test.ts`：旋轉測試改為「預設會翻滾」＋「`lockRotation: true` 時保持直立」。

### 新增 — 除錯輔助線與渲染管線文檔

- `?debug=1`（開發模式）疊加容器外框、物理空腔與投放線
  （`game/loop.ts` → `StageFrame.debug` → `render/stage.ts → drawDebugOverlay()`）。
- 新增 `docs/rendering.md`：繪製順序、每個視覺元素對應的函式、以及完整調參地圖
  （含角色大小基數與投放虛線樣式的位置）。

### 新增 — M0 前置缺口（補完）

`dev` 當時只有配置 JSON、WebP 素材與 `core/{types,constants,rng}`，**沒有**任何載入
程式碼，`main.ts` 只是一行 stub。以下是把「半個 M0」補到可用的部分：

- **執行期配置載入器**（`core/configLoader.ts`）：四份 JSON 逐欄驗證，任何缺漏或非法值
  退回內建預設值並回報警告，單一檔案失敗不影響其他檔案。載入前先檢查回應是不是 HTML，
  避免 SPA fallback 以 200 回傳首頁而被靜默吞掉。
- **素材載入器**（`render/spriteLoader.ts`）與**程式化佔位方團團**
  （`render/placeholder.ts`）：素材缺失時降級顯示，不白畫面。
- **視埠座標系**（`render/viewport.ts`）：鎖定虛擬高度 `VIRTUAL_HEIGHT = 1000`，
  寬度隨容器浮動；DPR 只在投影時乘進去，物理一律在虛擬單位下計算。
- **sprite 正規化常數**（`core/constants.ts`）：512² 畫布、body 304、body 中心 (256, 328)，
  與 `design.md` §1.5.1 完全一致。
- **Matter.js 引擎封裝**（`core/physics.ts`）：固定圓形碰撞體、靜態牆壁／地板、
  固定時間步的推進介面。
- **測試環境**（Vitest）：`tests/` 與 `npm test` / `npm run test:watch`。

### 新增 — M1（版面骨架）

- 七區域版面：SCORE 卡、工具列、NEXT 卡、COMBO 卡、SKILL LIST、容器、MELTING LIST。
- Liquid Glass 面板近似（`backdrop-filter: blur(20px) saturate(180%)`）＋ 不支援時的降級填色。
- 非官方同人聲明橫幅，文案來自 `branding.json`。
- 響應式斷點與站台 favicon。

> 真折射需要 shader，現階段以 `backdrop-filter` 近似。

### 新增 — M2（蛇形名冊與輪廓白框）

- **蛇形自動佈局**（`ui/serpentine.ts`）：牛耕式排列、欄數依面板寬度反推並鉗制、
  U-turn 與尾端箭頭自動生成，格數不寫死。
- **名冊渲染**（`ui/meltingList.ts`）：已解鎖顯示素材，未解鎖顯示 `???`。
- **輪廓白框**（D20）：以 8 方向 `drop-shadow` 沿 alpha 剪影描邊，而非沿圖片邊界。
  為此改為**不裁切**素材，否則白框會沿著裁切線走。

### 新增 — M3（容器渲染、投放輸入、NEXT 佇列）

- **容器 3D 線框幾何**（`render/container.ts`）：前後兩面與透視偏移；兩面聯集剛好填滿
  畫布。繪製順序為後緣 → sprite → 前表面四邊，順序本身就是「裝在玻璃箱內」的效果來源。
- **物理邊界**（`game/containerBox.ts`）：遊戲區＝前表面矩形，左右牆與地板往外長，
  空腔比前表面往內縮一個牆厚，貼牆的方團團不會被線框壓過去。
- **舞台渲染**（`render/stage.ts`）：把碰撞半徑換算成 sprite 繪製縮放，讓**畫面中的身體
  與碰撞圓完全對齊**；附投放下落的虛擬輔助線。
- **直立 sprite**：方團團的旋轉被鎖定（慣量設為無限大），因為碰撞體是**圓**而畫面是
  **方**，自由旋轉會把兩者的不一致直接演給玩家看（`design.md` §4.1）。
- **掉落佇列**（`game/spawnQueue.ts`）：`spawnQueue` 是唯一的產生來源，NEXT 卡讀
  `peek()`、投放呼叫 `take()`，因此**顯示什麼就掉什麼**（D22）。
- **單局狀態**（`game/session.ts`）：投放、瞄準夾制、離場剛體回收、物理狀態投影。
- **投放輸入**（`core/input.ts`）：滑鼠指標與觸控（`pointermove` 瞄準、`pointerdown`
  投放），另支援方向鍵瞄準與空白／Enter 投放；畫布可聚焦並提供焦點框。
- **畫面迴圈**（`game/loop.ts`）：**固定時間步**（1/60 秒）＋ 累加器，物理行為不隨
  螢幕更新率改變；單幀步數設上限並丟棄落後時間，避免分頁回到前景時把整箱炸開。
- **HUD**（`ui/hud.ts`）：NEXT 卡與 SCORE 卡只在值真的變動時才寫 DOM。

### 新增 — 介面對齊 Figma 設計稿（v1.6）

前四節的介面是「跟著視窗跑的彈性排版」：面板寬用 `clamp()`、百分比與 flex 決定。這一批把
版面改成**固定 1920×1080 設計畫布上的絕對定位**，座標直接取自 Figma 檔 `方團團.fig` 的主畫面
frame `Group 445`（`1408:2062`）。

- **設計稿常數模組**（`core/design.ts`）：主畫面七個區域的矩形、安全內縮 64、面板圓角 32、
  以及 MELTING LIST 的格網與走線參數。**TypeScript 只持有它真的會讀的數字**；純 CSS 用的值
  （字級、工具列按鈕、技能卡內部）留在 `styles/*.css` 並註明對應節點，不做第二份副本。
- **畫布等比縮放**（`ui/scale.ts`）：`k = min(vw/1920, vh/1080)`，整個畫布一個
  `transform: scale()`。瀏覽器縮放到 110% / 90% 時只剩一個倍率改變，任何兩件東西的相對大小
  都是常數 —— 於是「縮小之後名冊多塞幾格、容器多放幾隻方團團」這個問題從根本上消失。
- **設計 token 橋**（`ui/designTokens.ts`）：把設計稿數字寫成 CSS 自訂屬性
  （`--design-w`、`--safe-inset`、`--melting-cell-w`…），TypeScript 與 CSS 不會各抄一份。
- **七區域依設計稿定位**（`ui/layout.ts`）：位置與尺寸以 inline style 從 `core/design.ts` 寫入，
  CSS 只負責外觀。設計稿把返回鍵與 SCORE 面板疊在同一點、z-order 在後，所以縮圖裡看不到返回鍵；
  裁定「照設計稿」→ **不渲染**，矩形只作紀錄。
- **技力條元件**（`ui/spMeter.ts`）：段數由 `sp.max` 決定，一點一段，只在值變動時動 DOM。
- **幾何背景美術**（`public/assets/ui/background.webp`）：深灰 → 海藍 → 粉的幾何漸層，
  取代原本的平面底色。

### 新增 — NEXT 語意修正（D22，v1.6）

NEXT 卡改為顯示**放下手上這顆之後**才上場的那顆，而不是馬上下來的那顆。

- **佇列深度 1 → 2**（`game/spawnQueue.ts`）：新增 `peekAt(index)`；`take()` 仍然只取出
  `peekAt(0)`，所以「掉下來的必是手上那顆」這條不變。
- **兩個「下一顆」分開命名**（`game/session.ts`）：`pendingLevelId`（`peekAt(0)`，驅動準心預覽）
  與 `upcomingLevelId`（`peekAt(1)`，驅動 NEXT 卡）。舊的單一 `nextLevelId` 移除 ——
  名字不分的結果就是玩家看到「卡上寫 A、掉下 B」。
- **HUD 改讀 `upcomingLevelId`**（`ui/hud.ts`、`main.ts`）。

### 新增 — MELTING LIST 重做（D19，v1.6）

- **固定格網**：內容區 367×472、**4 欄 × 5 列**、欄距 84.25、列距 94.4。格數少於滿格時只少用幾欄。
- **走位改為「直行蛇形」**（`ui/serpentine.ts`）：`col = floor(i/rows)`、
  `row = col 偶 ? i%rows : rows-1-(i%rows)`。判斷依據是設計稿 19 格的「缺一格」落在
  **最後一欄的第 1 列**，那是直行蛇形的簽名；牛耕式橫向會把空位留到最後一列。
- **連接線改為一筆畫**（`ui/meltingList.ts`）：設計稿的 `Arrow 1`（`1408:2184`）是一條連續折線，
  白色、線寬 5、轉彎 `cornerRadius: 32`、末端 `strokeCap: ARROW_LINES`。畫面上看到「一節一節」
  是因為整條線畫在素材**之下**，只有縫隙露出來 —— 所以模型是一條連續線，不是十幾條獨立線段。
  走完最後一欄後向右出欄（x=364）、沿右側走道落到下走道，以向下箭頭收尾。
- 格子沿用透明底（設計稿的名冊格沒有卡片底、標籤帶或徽章，角色直接浮在玻璃上）。

### 修正

- **工具列五顆鈕縱向疊起來**：膠囊同時有 `panel` 類別，而 `.panel` 是 `flex-direction: column`
  （面板內容一般都是直向堆疊）。`.toolbar` 只寫了 `display: flex`，於是鈕縱向排列，又因為總高
  超出膠囊而被 `flex-shrink` 壓到剩 48px —— 圖示看起來像爆出面板。補上 `flex-direction: row`。
- **容器描邊與設計稿不符**：`main_play_area`（`1408:2110`）是 `SOLID` 純白、`strokeWeight` 10、
  `INSIDE` 對齊、**無圓角**，而 `container.json` 是金色 3px 圓角 28。已改為白色 10px、圓角 0。
  （透視偏移仍是暫定值，見下方已知缺口。）
- **名冊連接線方向錯了會穿過素材**：垂直段原本固定寫成「第一個端點 +INK、第二個 −INK」，
  但奇數欄是**由下而上**走的，那樣的線會反向伸出、長度變成列距 ＋ 2×INK 而不是減 2×INK。
  改用 `Math.sign()` 讓同一個式子對兩個方向都成立。這個瑕疵只有單元測試看得出來。
- **固定時間步累加器的浮點誤差**：`stepMs * maxSubsteps` 相乘後再連減會留下浮點塵埃，
  使「一大段時間」只跑 `maxSubsteps - 1` 步。改為加入容差比較，並把累加器夾在零以上。
  這個瑕疵在畫面上只表現成物理偶爾慢半拍，靠肉眼幾乎不可能發現。
- **名冊輪廓白框沿著裁切線描邊**：原本因 `--art-scale` 放大並裁切，白框描的是裁切線
  而不是角色剪影。改為不裁切，並把描邊寬度降到 1.2px。
- **`/favicon.ico` 404**：補上 `public/favicon.svg` 與 `<link rel="icon">`。

### 已知缺口（尚未實作，非本分支範圍）

- **容器 aspect 未朝設計稿收斂**：設計稿的容器是**透視盒**（後上緣 444.85 寬、前表面 667 寬，
  後緣比前緣窄 105.55／116.6，上表面高 79.45），而本專案是**斜投影**模型（前後兩面同寬、僅平移，
  目前 26／−18）。要完全一致需要改投影模型，而那會改動前表面寬度 → 連帶改動物理可用寬度，
  因此暫不動。描邊（白色 10px、無圓角）已對齊。
- **SKILL LIST 目前是空的**：設計稿畫了 3 欄 × 4 列共 12 張技能卡（每欄一張圓形徽章 1/2/3、
  底部標籤帶寫 `Drop`），而 `skills.json` 只定義 4 個技能，且技能格渲染屬 M5。技力條段數
  （3）與設計稿一致，但設計稿示意「1 滿 2 空」，目前 `sp.initial = 0` 所以三段皆空。
- **MELTING LIST 目前只有 10 格（2 欄）**：格網幾何與走線都照設計稿，但格數＝合成鏈長度
  （`levels.json` 10 級），而設計稿畫的是滿格 19 格（4 欄）。角色數量增加時會自動填滿。
- **未解鎖格的樣式是自訂的**：設計稿 19 格全部有角色圖，無從得知未解鎖長什麼樣，目前用
  `???` ＋ 虛線圓角記號。
- **名冊走線的欄中心與設計稿差約 5px**：設計稿的格子是手放的（欄中心 36/122.8/203.3/288.6，
  欄距不勻），本專案用等距格網（42.125 起、欄距 84.25），走線因此比設計稿右移約 5px。等距是
  為了讓「N 變動時自動重排」有唯一解。
- **M0 的「描邊快取」與「半徑校準原型」仍缺**。`levels.json` 的 `_meta.provisional`
  已註明半徑與物理參數全是暫定值，待校準原型定案後整表重算。
- **`skills.json` 的 `fate_swap` 消耗 4 技力，但 `sp.max` 只有 3**，該技能永遠無法解鎖。
  載入時會發出警告，屬內容設定問題，待 M5 一併處理。
- ~~**溢出規則**（`maxBodies`、`overflowPenalty`、溢出時長）依 `design.md` §10 尚未定案。~~
  **已由 M4 定案**（見上一節）：溢位線相對容器頂緣 30、寬限 3000ms、只看「已進槽」的顆粒。
  原本連帶的現象是：把方團團投進已經擠滿的落點時，重疊解析的力量可能把它彈出容器上方
  （牆只比前表面高 240 單位），飛到離場邊界後會被回收，該顆就此消失。這個現象**仍然存在**
  （見上一節「嚴重溢出時堆疊會畫到畫布頂端之外」）；正規解法是「上一顆還沒離開投放區前
  禁止再投」，屬後續的投放節流規則，M4 未實作。

---

## 基準 — `dev` 分支

- 專案初始化、Vite + TypeScript 嚴格模式、雙 tsconfig 拆分。
- 外部化配置（`public/config/`）與素材目錄。
- 角色素材由 SVG 改為**正規化無損 WebP**（512²、body 304、透明留白）。
- 素材元數據簽名腳本、pre-commit hook 與 CI 後備驗證。
- 物理暫定參數推導文件（`docs/physics.md`）。
- 中／英雙語 README 與設計稿。

## 里程碑狀態

| 階段 | 範圍 | 狀態 |
|:--|:--|:--|
| M4 | 合成核心、冷卻、Combo、彈跳動畫 | ✅ 已完成（見上一節） |
| M5 | 技力與技能（含點選選取、「」括號） | ⏭️ **依使用者指示跳過** |
| M6 | 解鎖系統、`???`、圖鑑 | ✅ 已完成（見上一節） |
| M7 | 本地存檔與後端同步 | ⏳ 待辦 |
| M8 | 排行榜（全時／每日／每週）與用戶名驗證 | ⏳ 待辦 |
| M9 | 分析事件、反作弊檢查 | ⏳ 待辦 |
| M10 | 部署、音效、無障礙 | ⏳ 待辦 |

> M6 不依賴 M5，所以跳過 M5 不影響圖鑑與解鎖。M7 會接手目前由 `game/progress.ts`
> 獨力承擔的本地存檔（`endchimerge:unlocks` / `endchimerge:high-score`）。
