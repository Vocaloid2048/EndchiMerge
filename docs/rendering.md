# 渲染管線與調參地圖

本檔回答兩個問題：**畫面上的東西是哪一段程式畫的**、以及**想改某個數字該去哪裡改**。
目的很直接：不用再靠「瞇著眼看畫面」猜哪個框對應哪個框。

---

## 1. 每幀的呼叫鏈

```
main.ts（組裝）
  └─ FrameLoop.start()                       game/loop.ts
        └─ FixedStepper.advance()            切成整數個 1/60s 步
        └─ GameSession.step(dt)              game/session.ts  → core/physics.ts（Matter.js）
        └─ FrameLoop.draw()
              └─ Viewport.clear()            render/viewport.ts  → 套用虛擬座標變換
              └─ drawStage(ctx, frame, sprites)   render/stage.ts
```

`drawStage` 的繪製順序**就是**「裝在容器內」這個效果的全部來源，順序不可對調：

| # | 步驟 | 函式 |
|---|---|---|
| 1 | U 形內部填充（在方團團**之下**） | `render/container.ts` → `drawContainerBack()` |
| 2 | 溢位警戒區：線與頂緣之間的淺紅帶（背景提示） | `render/stage.ts` → `drawOverflowZone()` |
| 3 | 投放輔助虛線 | `render/stage.ts` → `drawAimGuide()` |
| 4 | 全部方團團（依物理角度旋轉、依彈跳倍率縮放） | `render/stage.ts` → `drawBody()` |
| 5 | U 形線框（在方團團**之上**） | `render/container.ts` → `drawContainerFront()` |
| 6 | 溢位紅虛線（**最上層**，門檻必須隨時看得見） | `render/stage.ts` → `drawOverflowLine()` |
| 7 | 投放預覽（壓在線框與紅線之上） | `render/stage.ts` → `drawBody()`（`globalAlpha = 0.85`） |
| 8 | 除錯輔助線（僅 `?debug=1`） | `render/stage.ts` → `drawDebugOverlay()` |

> **第 2 步在方團團之下、第 6 步在方團團之上**是刻意的：警戒區是背景提示（不該遮住角色），
> 紅線是門檻（不該被角色遮住）。

> **第 5 步是關鍵**：少了它，方團團看起來是貼在槽前面，而不是裝在槽裡面。
> **第 7 步在第 5、6 步之後**是刻意的：預覽還沒進到槽裡，所以它應該壓在線框與紅線之上。

---

## 2. 調參地圖

### 2.1 改 JSON 就好（不用碰程式）

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| 容器底部圓角 | `public/config/container.json → cornerRadius` | `32` |
| 容器線框粗細 | `container.json → strokeWidth` | `10`（虛擬單位，`VIRTUAL_HEIGHT = 1000`，故約畫布高的 1%） |
| 容器線框顏色 | `container.json → strokeColor` | `#FFFFFF` |
| 容器內部填充 | `container.json → fill` | `rgba(255, 255, 255, 0.20)` |
| 容器頂端留白（投放頭部空間） | `container.json → topOffset` | `200` |
| 瞄準範圍左右各內縮多少 | `container.json → spawnGap` | `16` |
| **投放點在容器頂緣上方多高** | `container.json → dropAboveRim` | `40` |
| **溢位紅線在容器頂緣上方多高** | `container.json → overflowAboveRim` | `30`（**必須小於上一項**，否則一生成就越線；載入器會警告） |
| 一個方團團的半徑 | `public/config/levels.json → levels[].radius` | `20 … 115` |
| 密度／彈性／摩擦／空氣阻力 | `levels.json → levels[].density / restitution / friction / frictionAir` | 見該檔 |
| 各級分數 | `levels.json → levels[].score` | `0, 1, 2, 4, … 256` |
| 重力 | `levels.json → settings.gravityY` | `1` |
| **方團團是否可旋轉** | `levels.json → settings.lockRotation` | `false` ＝ 依真實物理翻滾 |
| 溢位寬限秒數 | `levels.json → settings.overflowGraceMs` | `3000` |
| 連擊窗口 | `levels.json → settings.comboWindowMs` | `1000` |
| 合成冷卻 | `levels.json → settings.mergeCooldownMs` | `100` |
| 技能／技力 | `public/config/skills.json` | 見 `agent-readme.md` §SP |
| 品牌與非官方聲明 | `public/config/branding.json` | — |

> 規則本身（合成、連擊曲線、溢位判定、解鎖）見 `gameplay.md`，那份也有自己的調參速查。

### 2.2 改程式（樣式寫在程式裡的部分）

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| **全部角色的大小基數** | `src/core/constants.ts → SPRITE_BODY` | `304` |
| 素材畫布邊長（通常不動） | `constants.ts → SPRITE_SIZE` | `512` |
| 素材 body 中心（通常不動） | `constants.ts → SPRITE_ANCHOR` | `{ x: 256, y: 328 }` |
| **投放虛線的粗幼** | `src/render/stage.ts → AIM_GUIDE_STYLE.lineWidth` | `5` |
| **投放虛線的節奏** | `stage.ts → AIM_GUIDE_STYLE.dash` | `[10, 15]` |
| **投放虛線的顏色** | `stage.ts → AIM_GUIDE_STYLE.color` | `rgba(61, 61, 61, 0.69)` |
| **溢位紅線的粗幼／顏色／節奏** | `stage.ts → OVERFLOW_STYLE.lineWidth / lineColor / dash` | `4` / `rgba(226, 100, 95, 0.95)` / `[16, 14]` |
| **溢位警戒區的填色與脈動幅度** | `stage.ts → OVERFLOW_STYLE.zoneColor / zoneAlphaMax / zoneAlphaMin` | `226, 100, 95` / `0.28` / `0.1` |
| 警戒區脈動週期 | `src/game/loop.ts → overflowFrame()` 的 `Math.sin(this.nowMs / 260)` | 週期 520ms（除數減半＝加倍快） |
| **合成彈跳的時長與峰值** | `src/core/constants.ts → POP_ANIMATION_MS / POP_PEAK_SCALE` | `180ms / 1.3` |
| 除錯輔助線顏色 | `stage.ts → DEBUG_STYLE` | 洋紅／青／黃 |
| 牆壁厚度 | `src/core/constants.ts → WALL_THICKNESS` | `16` |
| 牆壁在頂緣以上的延伸 | `src/game/containerBox.ts → DEFAULT_WALL_OVERHANG` | `240` |
| 物理求解器迭代次數 | `constants.ts → ENGINE_POSITION_ITERATIONS / ENGINE_VELOCITY_ITERATIONS` | `8 / 6` |
| 虛擬世界高度（影響難度曲線） | `constants.ts → VIRTUAL_HEIGHT` | `1000` |

### 2.3 角色大小的換算

```
sprite 繪製邊長 = SPRITE_SIZE × spriteScaleForRadius(radius)
spriteScaleForRadius(radius) = (2 × radius) / SPRITE_BODY
```

兩個旋鈕、兩種效果：

- 改 **`radius`**（`levels.json`）→ 同時改碰撞大小與畫面大小，**相對關係不變**。
  輪廓碰撞體也是用 `scale = (2 × radius) / SPRITE_BODY` 換算出來的，所以這條依然成立。
- 改 **`SPRITE_BODY`**（`constants.ts`）→ 只改畫面與**輪廓**的大小，**圓形回退碰撞體不變**。
  變大 = 畫面比碰撞體大（方團團看起來更疊）；變小 = 看起來更瘦。
  這是「角色大小基數」的所在。**注意**：改它會同時移動輪廓的換算基準，
  所以只有走圓形回退路徑（素材缺失、輪廓退化）時才真的是「只改畫面」。
- `SPRITE_SIZE` 只是貼圖來源畫布的邊長，改它會破壞與素材的對應，**一般不應該動**。

### 2.4 輪廓碰撞體與 alpha 通道

碰撞多邊形是**離線從 sprite 的 alpha 通道**追出來的（`render/silhouette.ts`），
不是手繪的。因此：

| 事項 | 內容 |
|---|---|
| 追蹤參數 | `SILHOUETTE_OPTIONS`（`step = 2`、`threshold = 8`、`epsilon = 3`），位於 `render/silhouetteLoader.ts` |
| 換算基準 | `SPRITE_ANCHOR = (256, 328)`、`SPRITE_BODY = 304` |
| 典型結果 | 每級 30–46 個頂點（原始輪廓約 1200–1500 點） |
| 快取 | `buildSilhouetteCache()` 於 `main.ts` 開場建一次，逐級存 `Point[] \| null` |

**素材要求**：透明區域必須真的透明（alpha = 0）。若把角色合成到白底再匯出，
追出來的輪廓會是整個方框，等於退回圓形的精度。素材規格見
`public/assets/character/README.md`。

---

## 3. 除錯模式

```
npm run dev
http://127.0.0.1:5173/?debug=1
```

開發模式下會疊加三組輔助線（`FrameLoopOptions.debug` → `StageFrame.debug`）：

| 顏色 | 代表 |
|---|---|
| 洋紅實線 | 容器 `frame` 矩形（＝ U 形外框；物理就是從它推導） |
| 青色實線 | 物理空腔 `cavity`（方團團可活動的內緣） |
| 黃色虛線 | 投放高度 `spawnYValue` |

另可於 Console 用 `window.endchi`（僅開發模式）拿到 `session`、`viewport`、`layout` 等物件，
例如 `endchi.session.spawnYValue`、`endchi.session.playArea`。

---

## 4. 相關硬性規範

- 縮放與置中：`agent-readme.md` §「版面與縮放規範」（置中**必須**寫進 transform）。
- 容器、投放與旋轉：`agent-readme.md` §「容器、投放與旋轉」。
- 合成、連擊、溢位與解鎖的**規則**：`docs/gameplay.md`。
- 物理模型與半徑推導：`docs/physics.md`。

### 驗證腳本

畫面上的東西改完之後，除了單元測試，還有一支瀏覽器端的端到端檢查可以用：

```
# 先跑 dev server（`npm run dev`），再另開一個終端
node .tmp-verify/m4m6.cjs        # 合成／冷卻／彈跳／連擊／溢位／結算／解鎖／持久化
node .tmp-verify/overflow-probe.cjs   # 只驗溢位計時的波形
```

手法是**停掉 rAF 迴圈（`endchi.loop.stop()`）再手動餵固定步**，所以物理完全確定、
彈跳動畫（180ms）這種短暫狀態也截得到。`endchi.loop` 停了之後 HUD 不會自己更新，
所以每次手動步進後要自己呼叫一次 `endchi.hud.update(...)`（腳本裡的 `__t.sync()`）。
