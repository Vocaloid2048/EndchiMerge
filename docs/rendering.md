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
| 2 | 投放輔助虛線 | `render/stage.ts` → `drawAimGuide()` |
| 3 | 全部方團團（依物理角度旋轉） | `render/stage.ts` → `drawBody()` |
| 4 | U 形線框（在方團團**之上**） | `render/container.ts` → `drawContainerFront()` |
| 5 | 投放預覽（最上層，壓在線框上） | `render/stage.ts` → `drawBody()`（`globalAlpha = 0.85`） |
| 6 | 除錯輔助線（僅 `?debug=1`） | `render/stage.ts` → `drawDebugOverlay()` |

> **第 4 步是關鍵**：少了它，方團團看起來是貼在槽前面，而不是裝在槽裡面。
> **第 5 步在第 4 步之後**是刻意的：預覽還沒進到槽裡，所以它應該壓在線框上。

---

## 2. 調參地圖

### 2.1 改 JSON 就好（不用碰程式）

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| 容器底部圓角 | `public/config/container.json → cornerRadius` | `16` |
| 容器線框粗細 | `container.json → strokeWidth` | `10`（虛擬單位，`VIRTUAL_HEIGHT = 1000`，故約畫布高的 1%） |
| 容器線框顏色 | `container.json → strokeColor` | `#FFFFFF` |
| 容器內部填充 | `container.json → fill` | `rgba(255, 255, 255, 0.20)` |
| 容器頂端留白（投放頭部空間） | `container.json → topOffset` | `80` |
| 投放留白（頂緣上方高度＋左右內縮） | `container.json → spawnGap` | `8` |
| 一個方團團的半徑 | `public/config/levels.json → levels[].radius` | 13.5 … 124.5 |
| 密度／彈性／摩擦／空氣阻力 | `levels.json → levels[].density / restitution / friction / frictionAir` | 見該檔 |
| 重力 | `levels.json → settings.gravityY` | `1` |
| **方團團是否可旋轉** | `levels.json → settings.lockRotation` | `false` ＝ 依真實物理翻滾 |
| 技能／技力 | `public/config/skills.json` | 見 `agent-readme.md` §SP |
| 品牌與非官方聲明 | `public/config/branding.json` | — |

### 2.2 改程式（樣式寫在程式裡的部分）

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| **全部角色的大小基數** | `src/core/constants.ts → SPRITE_BODY` | `304` |
| 素材畫布邊長（通常不動） | `constants.ts → SPRITE_SIZE` | `512` |
| 素材 body 中心（通常不動） | `constants.ts → SPRITE_ANCHOR` | `{ x: 256, y: 328 }` |
| **投放虛線的粗幼** | `src/render/stage.ts → AIM_GUIDE_STYLE.lineWidth` | `2` |
| **投放虛線的節奏** | `stage.ts → AIM_GUIDE_STYLE.dash` | `[10, 12]` |
| **投放虛線的顏色** | `stage.ts → AIM_GUIDE_STYLE.color` | `rgba(232, 192, 122, 0.45)` |
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
- 改 **`SPRITE_BODY`**（`constants.ts`）→ **只改畫面大小**，碰撞圓不變。
  變大 = 畫面比碰撞體大（方團團看起來更疊）；變小 = 看起來更瘦。
  這是「角色大小基數」的所在。
- `SPRITE_SIZE` 只是貼圖來源畫布的邊長，改它會破壞與素材的對應，**一般不應該動**。

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
- 物理模型與半徑推導：`docs/physics.md`。
