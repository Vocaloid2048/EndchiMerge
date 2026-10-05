# 合成、連擊、溢位與解鎖

本檔說明一局的**規則層**：兩顆怎麼合成、連擊倍率怎麼算、什麼時候算溢位、什麼時候遊戲結束，
以及解鎖怎麼跨局存活。畫面上的位置與調參入口見 `rendering.md`；物理參數的推導見 `physics.md`。

規格來源：`plan.md` §3.1 / §3.2 / §5.2 / §5.3（使用者定案）。

---

## 1. 模組分工

| 檔案 | 責任 |
|---|---|
| `src/game/merge.ts` | 純函式：兩顆等級 → 合成結果等級（或 `null`） |
| `src/game/combo.ts` | 純函式 `comboMultiplier(n)` ＋ `ComboTracker`（串長與窗口） |
| `src/game/overflow.ts` | `OverflowMonitor`：連續溢位計時與判定 |
| `src/game/progress.ts` | `ProgressStore`：解鎖集合 ＋ 最高分，寫入 localStorage |
| `src/game/spawnQueue.ts` | 掉落佇列：加權抽樣，並依解鎖集合過濾 |
| `src/game/session.ts` | 把上面幾個接起來，並投影成畫面資料 |
| `src/ui/gameOver.ts` | 結算覆蓋層（只呈現，不算分） |

**依賴方向**：`session.ts` 是唯一的整合點。`merge` / `combo` / `overflow` 都不認識 Matter.js，
也不認識 DOM，所以三者的邊界條件都能在單元測試裡釘住，不必猜畫面。

---

## 2. 合成

```
mergeResultId(a, b) = a.id === b.id ? a.mergeResult : null
```

**兩段式處理**（`session.ts`）：碰撞回呼 `collisionStart` 期間**只收集**候選對，
等這一步的物理跑完再由 `flushMerges()` 執行。理由是在碰撞回呼裡新增／移除剛體
等於在引擎解算途中改動世界，會產生難以重現的抖動與穿透。

| 規則 | 值 | 說明 |
|---|---|---|
| 觸發條件 | 同級接觸 | 不設穿透閾值（使用者選擇「同級接觸合成」） |
| 物件對冷卻 | `mergeCooldownMs` = 100ms | 同一顆剛體**生成後**多久內不得合成，避免鏈式合成一步跑完 |
| 一顆只能被用掉一次 | `claimed` Set | 同一批裡若有 A+B 與 A+C，A 只會被消耗一次 |
| 生成位置 | 兩顆質心的中點 | — |

> 冷卻比對的是「**生成時刻**」而不是「上一次被誰碰過」。這樣同一顆球不論跟誰碰撞，
> 都只在出生後 100ms 之後才可能合成，規則只有一條。

---

## 3. 連擊（Combo）

### 3.1 什麼算同一串

```
at == 上次合成的時刻（同一物理步）→ 同一批，不重複計數
at - 上次時刻 ≤ comboWindowMs(1000) → comboCount++（接續這一串）
其餘                              → comboCount = 1（重新起一串）
```

**同一批的判準是「時間戳相同」，不是「相隔 < 0.1 秒」。** 舊草案同時寫了
「< 0.1s 視為同一批、不重複計數」與「連鎖反應會形成高倍率」，兩句互相矛盾 ——
連鎖反應本來就落在極短間隔內，用 0.1s 當門檻會把整串吞掉。同一物理步的多場合併
共用同一個時間戳，所以「時間戳相同」才是真正要防的東西；跨步的連鎖反應正常累加。

節奏上，`session.step()` **先把時鐘往前推再跑物理**，因此碰撞回呼看到的時刻就是這一步的
時刻，同一批才判得出來。

### 3.2 倍率曲線

```
comboMultiplier(n) = min( e^(0.075 × n) / 10, 9 ) + 1        // n = comboCount
```

| n | 1 | 10 | 23 | 30 | 42 | 50 | 60 |
|---|---|---|---|---|---|---|---|
| 倍率 | ×1.1 | ×1.2 | ×1.6 | ×1.9 | ×3.3 | ×5.3 | **×10.0**（天花板） |

- **`n = 0` 回傳 `1.0`**，而不是公式算出的 `1.1`：靜止狀態顯示 ×1.1 會讓玩家以為一直有加成。
  這是唯一一處刻意偏離公式的地方。
- 緩慢上升是刻意的：`n = 60` 才到上限，鼓勵長時間串接而不是靠單次連鎖爆分。
- **調參入口**：`src/game/combo.ts → COMBO_CURVE`。`coefficient` 越小上升越慢；
  `cap + base` 就是天花板。

### 3.3 分數

```
得分 = score[合成後等級] × comboMultiplier（當下）
```

`ComboTracker.snapshotAt()` 是**無副作用**查詢，所以 HUD 可以每幀問一次而不影響玩法。
HUD 顯示時取一位小數（`×3.3`），避免 `×3.3000000000000003` 這種浮點尾巴。

---

## 4. 溢位與結束

### 4.1 幾何

溢位線**不是**寫死的 Y 座標，而是相對容器頂緣推導：

```
overflowLineY = frame.y - overflowAboveRim      // container.json，預設 30（頂緣上方 30）
spawnY        = frame.y - dropAboveRim          // container.json，預設 40（頂緣上方 40）
```

因此改 `container.json` 的 `topOffset` 時，容器、投放點與溢位線會一起移動。
**投放點刻意在溢位線之上**（40 > 30），玩家才看得到方團團出現在線的上方而不是憑空冒出來。
載入器會檢查這個大小關係（`checkDropClearsOverflow`），顛倒時發出警告。

### 4.2 判定規則

```
只要有【已經進槽】的方團團，其上緣（y - radius）越過溢位線：
    → 開始連續計時 overflowGraceMs（預設 3000ms）
場上沒有這種顆粒：
    → 計時器【立刻歸零】（不是累計）
計時器滿 → 這一局結束（isOver，單向，不會自己回復）
```

**為什麼是「連續」而不是「累計」**：正常遊玩時方團團本來就會短暫經過線上，
把這些瞬間累加起來會讓完全正常的局面被判出局。

### 4.3 「已經進槽」以**接觸**為準

這是 M4 驗收時抓到的一個真 bug，中間換過一次判定方式，兩代都值得記下來。

投放點在溢位線**上方** 10 個單位（40 vs 30），所以每顆剛生成的方團團，上緣一開始就在線之上，
要往下落 30 個單位才降到線下 —— 實測約 **14 個物理步（≈233ms）**。

於是：**連續投放時（間隔短於 233ms）這些穿越會首尾相接**，計時器一路爬滿 3 秒。
實測以每 100ms 投一顆，**第 31 顆、模擬時間 3.1 秒**就結束了這一局 ——
而容器裡只有 24 顆散落的方團團，堆疊最高點離溢位線還很遠。**規則量到的是「投放」，不是「堆疊」。**

**第一代修法（已作廢）**：`Entry.entered` 是單向旗標，**圓心曾經降到容器頂緣以下**就設為真。
問題是它仍然是幾何判斷：一顆剛投下、還在半空但恰好掠過頂緣的方團團也會被判成「進槽」，
而它其實誰都還沒碰到 —— 玩家看到的是「明明還在掉，怎麼就警告了」。

**現行修法：入堆的定義是「碰到其他方團團」，與位置無關。**
`Entry.entered` 仍是**單向**旗標（一次為真就永久為真），但觸發來源是
`collisionStart` 事件：一對碰撞中若**雙方都是方團團**，就把兩者的 `entered` 都設為真。
撞牆、撞地板、撞容器頂緣**一律不算**。

| 情境 | `entered` | 判定 |
|---|---|---|
| 剛投下、下墜中，未碰到任何方團團 | false | **不算**（還在空中） |
| 剛投下、下墜中，但已經擦到堆疊的頂端 | true | **算**（已入堆） |
| 掉到容器底部，只碰到地板／牆壁 | false | **不算**（孤兒，佔位但不算堆疊） |
| 已入堆、被後來的堆疊擠到頂緣之上 | true | **算**（＝槽裡溢出） |
| 已入堆、被擠到溢位線之上 | true | **算** |

> 「被擠到頂緣之上」必須算 —— 那正是「溢出」。所以旗標只能是單向的，
> 不能寫成「現在低於頂緣」這種即時判斷。
> 改以接觸判定之後，這件事變成自動的：一旦碰到過，`entered` 就再也不會回 false。

**複合剛體要注意**：輪廓碰撞體（§6）是複合剛體，Matter 的 `collisionStart` 配對裡帶的是
**子零件**（`body.parts` 的成員），`body.id` 與母體不同。直接查 `byBodyId` 會全部落空，
**合成與溢位偵測會一起靜默失效**（沒有錯誤、只是什麼都不發生）。
`GameSession.resolveEntry()` 會先查 `body.id`，查不到就沿 `body.parent` 再查一次。

**驗證方式**：`tests/overflow.test.ts`（監視器層）＋ `tests/session.test.ts`
的「does not start the countdown for a dumpling that is still in flight」（整合層，
以 `overflowGraceMs: 0` 讓任何一次誤判都會在第一幀立刻結束該局）。
把 `resolveEntry()` 換回直接的 `byBodyId.get()`，這兩處共 2 條測試會失敗。

### 4.4 結算

`isOver` 一旦成立就**永久為真**（要 `reset()` 才能復原）。因此結算覆蓋層在 `main.ts`
用 `shownGameOver` 旗標讓它**每局只彈一次** —— 少了它會每一幀重設焦點、重播「新紀錄」。

`GameSession.drop()` 在 `over` 之後直接忽略輸入，所以輸入層不必自己判斷遊戲狀態。

---

## 5. 解鎖與圖鑑

### 5.1 規則

- **解鎖條件**：該等級**首次被合成出來**。解鎖後永久保留，**跨局不重設**（`design.md` D5）。
- **鏈首一律解鎖**：`baseline` 是編號最小的等級，否則開局完全沒有東西可掉。
- **生成池同步過濾**：進池需要同時滿足

  ```
  droppable === true  &&  spawnWeight > 0  &&  unlocked.has(id)
  ```

  所以**即使 `levels.json` 標了 `droppable: true`，未解鎖的等級也不會出現在掉落佇列**。
  開局只有 Lv1 解鎖 ⇒ 初始只會掉 Lv1；每合出一級，那一級才加入池。

- **儲存鍵**：`endchimerge:unlocks`（JSON 陣列）、`endchimerge:high-score`。
  儲存體是**可注入**的（`ProgressStorage`），無痕模式或關閉 cookie 時 `localStorage`
  光是存取就拋錯，此時退回「只活在記憶體裡」；讀寫一律包 try/catch，壞掉的存檔視為空。

### 5.2 圖鑑 ＝ MELTING LIST

**不另開頁面**：`MELTING LIST` 面板本身就是圖鑑。已解鎖顯示角色素材，未解鎖顯示 `???` ＋
虛線圓角記號。格子依**等級編號**判斷解鎖（不是「索引小於幾」），所以不必假設等級表順序或編號連續。

`ProgressStore.onChange()` 是**唯一的通知路徑**：`session` 內部呼叫 `progress.unlock()`，
訂閱者收到通知後重畫名冊。畫面永遠跟著存檔走。

### 5.3 meta-progression 的邊界

`GameSession` **每局重建**，所以解鎖狀態不能存在裡面。分工是：

| 誰 | 負責 |
|---|---|
| `GameSession` | 知道「什麼時候該解鎖」（合出新等級時呼叫 `unlocks.unlock()`），並在成功時刷新生成池 |
| `ProgressStore` | 只知道「存了什麼」與集合運算，跨局存活 |

`GameSession.reset()` 只清「這一局的東西」（剛體、分數、連擊、溢位計時），
**保留解鎖與最高分**。

---

## 6. 調參速查

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| 溢位線在頂緣上方多高 | `container.json → overflowAboveRim` | `30` |
| 投放點在頂緣上方多高 | `container.json → dropAboveRim` | `40`（**必須大於上一項**） |
| 溢位寬限秒數 | `levels.json → settings.overflowGraceMs` | `3000` |
| 連擊窗口 | `levels.json → settings.comboWindowMs` | `1000` |
| 合成冷卻 | `levels.json → settings.mergeCooldownMs` | `100` |
| 連擊曲線 | `src/game/combo.ts → COMBO_CURVE` | `coefficient 0.075 / cap 9 / base 1` |
| 彈跳動畫時長與峰值 | `src/core/constants.ts → POP_ANIMATION_MS / POP_PEAK_SCALE` | `180ms / 1.3` |
| 溢位紅線與警戒區樣式 | `src/render/stage.ts → OVERFLOW_STYLE` | 見 `rendering.md` |
| 哪一級可被生成 | `levels.json → levels[].droppable / spawnWeight` | 全 `true` / `10` |
| 各級分數 | `levels.json → levels[].score` | `0, 1, 2, 4, … 256` |
