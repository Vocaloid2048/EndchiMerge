# 合成、連擊、溢位與解鎖

本檔說明一局的**規則層**：兩顆怎麼合成、連擊倍率怎麼算、什麼時候算溢位、什麼時候遊戲結束，
以及解鎖怎麼跨局存活。畫面上的位置與調參入口見 `rendering.md`；物理參數的推導見 `physics.md`。

規格來源：`plan.md` §3.1 / §3.2 / §5.2 / §5.3（使用者定案）。

---

## 1. 模組分工

| 檔案 | 責任 |
|---|---|
| `src/game/merge.ts` | 純函式：兩顆等級 → 合成結果等級（或 `null`） |
| `src/game/outlineProximity.ts` | 純幾何：兩組世界座標輪廓 → 是否相接／邊緣間隙 |
| `src/game/mergeSettle.ts` | 純函式：動量繼承、質量、向下投影找支撐 |
| `src/game/combo.ts` | 純函式 `comboMultiplier(n)` ＋ `ComboTracker`（串長與窗口） |
| `src/game/overflow.ts` | `OverflowMonitor`：連續溢位計時與判定 |
| `src/game/progress.ts` | `ProgressStore`：解鎖集合 ＋ 最高分，寫入 localStorage |
| `src/game/spawnQueue.ts` | 掉落佇列：加權抽樣，並依解鎖集合過濾 |
| `src/game/sp.ts` | `SpResource`：技力計數器（累積、上限鉗制、扣費、累計消耗），**不含玩法規則** |
| `src/game/skills/*` | `Skill` 抽象基底 ＋ 四項技能子類別 ＋ registry；只透過 `SkillBoard` 窄介面作用 |
| `src/game/session.ts` | 把上面幾個接起來（含 `SkillBoard` 的實作），並投影成畫面資料 |
| `src/ui/skillBar.ts` | 技能欄（可不可以按由 session 決定，這裡只畫與回報 id） |
| `src/ui/spMeter.ts` | 技力條（一點一條，段數由 `sp.max` 決定） |
| `src/ui/gameOver.ts` | 結算覆蓋層（只呈現，不算分） |

**依賴方向**：`session.ts` 是唯一的整合點。`merge` / `combo` / `overflow` / `sp` 都不認識
Matter.js，也不認識 DOM，所以它們的邊界條件都能在單元測試裡釘住，不必猜畫面。
技能同樣被隔離：它們只認得 `SkillBoard`（見 §6.6），所以可以在 `FakeBoard` 上單獨測。

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
| 觸發條件（碰撞） | 同級接觸 | `collisionStart` 事件；不設穿透閾值 |
| 觸發條件（輪廓） | 同級 ＋ 輪廓邊緣間隙 ≤ `MERGE_OUTLINE_GAP` = 4 | **每步**掃描，補足「相鄰卻沒碰上」的縫隙 |
| 物件對冷卻 | `mergeCooldownMs` = 100ms | 同一顆剛體**生成後**多久內不得合成，避免鏈式合成一步跑完 |
| 一顆只能被用掉一次 | `claimed` Set | 同一批裡若有 A+B 與 A+C，A 只會被消耗一次 |
| 生成位置 | 兩顆質心的中點 | — |
| 生成動量 | 兩顆速度的質量加權平均 | 見 §2.4；質量 ＝ `密度 × π r²` |
| 生成後找支撐 | 向下吸附到最近支撐，上限 `MERGE_SETTLE_MAX_DROP` = 80 | 見 §2.5；避免貿然凌空 |
| 生成後推開鄰居 | 位移 ＝ 重疊深度 × `MERGE_PUSH_FACTOR` = 1.15 | 見 §2.3；深度上限 `MERGE_PUSH_MAX_DEPTH` = 12 |

### 2.1 為什麼除了碰撞還需要「近接掃描」

方團團用的是**輪廓碰撞體**（`Bodies.fromVertices` 分解出的凹多邊形），方形身體加上頭飾
尖角意味著兩顆貼在一起時，圓身之間仍會留下一道縫。`collisionStart` **只在「不接觸 →
接觸」的那一瞬間發射一次**，所以兩顆滾到相鄰位置卻始終差一點沒碰上時，事件永遠不會來 ——
玩家看到兩顆明顯相依卻不合成。

補救是 `session.step()` 每步執行的 `collectProximityMerges()`：

1. 碰撞路徑（`collectMerges`，在 `physics.step()` **之中**回呼）先收集
2. 近接掃描（在 `physics.step()` **之後**）再把剩下的配對掃一遍
3. 兩者**共用** `stepClaimed` 集合，所以一顆每步最多只被消耗一次

### 2.2 判定用輪廓邊緣間隙，不是圓心距離

原本用「圓心距離 < `(r₁+r₂) × 1.12`」，但這對**不同尺寸**的配對會系統性失準：一顆小顆粒
夾在兩顆大顆粒之間時，視覺上已經相依，圓心距離卻被「自己的半徑 ＋ 鄰居的半徑」綁死。
改用輪廓邊緣間隙沒有這個偏誤 —— 它直接量「兩張圖差多遠」。

- 幾何實作在 `src/game/outlineProximity.ts`（純函式，可在 node 測試）
- **沒有輪廓素材時退回圓形**：判定變成「圓心距離 ≤ `r₁+r₂`」（真的接觸才算）
- 效能：86 顆在場時每步 0.063ms，約 60fps 預算的 0.38%（量測見驗證腳本）

### 2.3 合成後推開鄰居

合成出來的那顆比兩顆原料都**大**，卻生成在兩者的質心 —— 多出來的面積沒有地方去，就會
陷進旁邊的方團團（使用者的截圖：新生成的小顆粒整個埋在大顆粒的左上角）。

補救在 `session.ts → pushNeighboursApart()`，於新顆粒生成後**立刻**執行：

```
對每個鄰居：
  深度、方向 = outlinePenetration(新顆粒輪廓, 鄰居輪廓)   // 沿連心線的區間重疊
  深度 = min(深度, MERGE_PUSH_MAX_DEPTH)
  鄰居位移 ＝ 方向 × 深度 × MERGE_PUSH_FACTOR      // 1.15
  鄰居速度 ＋＝ 方向 × 深度 × MERGE_PUSH_SPEED     // 0.05
```

| 參數 | 值 | 為什麼 |
|---|---|---|
| `MERGE_PUSH_FACTOR` | 1.15 | 略為過推；只推剛好分開的話，下一幀物理又把新顆粒壓回去 |
| `MERGE_PUSH_SPEED` | 0.05 | 附帶速度讓分開像「滑開」而不是「瞬移」 |
| `MERGE_PUSH_MAX_DEPTH` | 12 | 防止「小顆粒完全埋在大顆粒內」把鄰居彈到容器另一頭 |

**只推鄰居、不推自己**：合成結果的位置由規則決定（兩顆原料的質心），把它也推走會讓合成
結果「跳」到玩家預期之外的地方。

**為什麼只取連心線一軸**：Matter 求解器已經解掉其他軸的穿透，這裡要補的是「新生成的大顆粒
整個陷進鄰居」那種整塊重疊 —— 沿連心線推開最直接也最穩定。完整 SAT 會多出近 60 條軸，
而最小軸常常是抖動的次要軸，推開方向反而不自然。

**位移與速度都要給**：位置位移讓穿透**立刻**消失（只給速度會留下一幀穿模），速度增量讓它
繼續往外走而不是被推回原位。位置位移用 `Matter.Body.translate` 而非直接改 `position`，
否則 `bounds` 與 `vertices` 會停在舊位置，下一次碰撞偵測就會拿過期幾何比對。

### 2.4 合成結果繼承動量

生成位置取兩顆原料的質心中點，但**速度不是零** —— 用兩顆的**質量加權平均**接過來（幾何在
`src/game/mergeSettle.ts`）：

```
v_result = (m_a · v_a + m_b · v_b) / (m_a + m_b)
m = 密度 × π r²         // 與 LevelDef 的宣告一致
```

**為什麼要繼承**：兩顆正在下墜、或正被鄰居推擠的顆粒，若合成後憑空靜止出現在質心，玩家
一眼看得出不自然。動量守恆讓新顆粒沿著原本的運動方向繼續走。

**為什麼用質量加權而非算術平均**：質量不同時，重的那顆話語權更大；同級合成時兩者質量相等
（同 `radius`、同 `density`），結果自然退化為算術平均。

### 2.5 向下投影找支撐（避免貿然凌空）

質心中點有時落在半空中 —— 兩顆原料原本堆在高處、或被推開後才合成，頭頂忽然空掉。新顆粒若
原地出現就會在空中「定格」一下才落下。

補救在 `session.ts → settleOntoSupport()`，於生成後、**推開鄰居之前**執行：

1. 收集候選支撐：其他顆粒的包圍盒（`boundsOf`）＋ 容器地板
2. 用 `distanceToSupport()` 算出「圓底碰到支撐上緣」所需的下落距離
3. 距離 ≤ `MERGE_SETTLE_MAX_DROP`（80）時才 `translate` 吸附；太遠則維持自由落體

| 參數 | 值 | 為什麼 |
|---|---|---|
| `MERGE_SETTLE_MAX_DROP` | 80 | 超過就不吸；否則高處的合成結果會「瞬移」到地面，比凌空更怪 |

**地板取空腔底部而非外框底部**：牆體有厚度（`WALL_THICKNESS`），物理地板剛體坐在 `cavity`
之下，所以可站的平面比外框底部高一個牆厚。用外框底部會把顆粒塞進地板裡（回歸測試
`does not leave a merged body below the floor when the midpoint is near it` 守住這點）。

**用包圍盒而非真實輪廓**：這是「找最近的東西墊在下面」，不是碰撞解算。包圍盒只會讓投影
偏保守（提早落地），不會讓顆粒穿過鄰居；真實輪廓的相交測試成本高，且對凹形鄰居容易出現
「射線剛好穿過縫」的假陰性。

**順序：先吸附、再推鄰居**。反過來的話，推力會把新顆粒推離支撐面，接著的吸附又把它拉回去，
兩個修正互相抵銷。

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
comboMultiplier(n) = min( e^(0.25 × n) / 10, 9 ) + 1        // n = comboCount
```

| n | 1 | 4 | 8 | 12 | 14 | 18 |
|---|---|---|---|---|---|---|
| 倍率 | ×1.1 | ×1.3 | ×1.7 | ×3.0 | ×4.3 | **×10.0**（天花板） |

- **`n = 0` 回傳 `1.0`**，而不是公式算出的 `1.1`：靜止狀態顯示 ×1.1 會讓玩家以為一直有加成。
  這是唯一一處刻意偏離公式的地方。
- 曲線**上升很快**：`n = 4` 就到 ×1.3、`n = 14` 是 ×4.3，`n = 18` 觸頂 ×10.0（`e^4.5 / 10 ≈ 9`
  剛好追上 `cap`）。HUD 取一位小數顯示。
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
    → 立刻開始連續計時 overflowGraceMs（預設 5000ms）
場上沒有這種顆粒：
    → 計時器【立刻歸零】（不是累計）
計時器滿 → 這一局結束（isOver，單向，不會自己回復）
```

**沒有「停定」門檻**（修訂版，使用者定案）：最初版本要求越線顆粒在原地停留 200ms 才起算，
用意是別對「剛投下、還在掉」的瞬間誤報。但 §4.3 的接觸判定已經把「還在掉」排除掉了，這個
門檻於是不但多餘，還開了一個大洞：

> **玩家持續投放時，堆頂那顆一直被擾動、位移永遠超過門檻 → 停定永不成立 → 紅線與倒數
> 從不出現。** 場面看起來就是「堆到線上卻什麼都不發生」（使用者截圖回報的「卡住」）。

因為入堆與否已由接觸把關，**已入堆且越線的顆粒就是貨真價實的溢位，立刻起算**，不論它當下
靜止還是被推得搖搖晃晃。

**為什麼是「連續」而不是「累計」**：正常遊玩時方團團本來就會短暫經過線上，但因為未入堆
不算數，這些瞬時穿越不會被計入；只要場上沒有**已入堆**的顆粒越線，計時器立刻歸零。

**驗證方式**：`tests/overflow.test.ts` 的「已入堆即起算 / a piled breach counts immediately」
區塊，其中 `does not need the breaching body to be still — a jostled pile still counts` 直接
釘住這個修正（舊版在這個情境會回 `settled: false`）。

### 4.3 「已經進槽」以**接觸**為準

這是 M4 驗收時抓到的一個真 bug，中間換過一次判定方式，兩代都值得記下來。

投放點在溢位線**上方** 10 個單位（40 vs 30），所以每顆剛生成的方團團，上緣一開始就在線之上，
要往下落 30 個單位才降到線下 —— 實測約 **14 個物理步（≈233ms）**。

於是：**連續投放時（間隔短於 233ms）這些穿越會首尾相接**，計時器一路爬滿 3 秒。
實測以每 100ms 投一顆，**第 31 顆、模擬時間 3.1 秒**就結束了這一局 ——
而容器裡只有 24 顆散落的方團團，堆疊最高點離溢位線還很遠。**規則量到的是「投放」，不是「堆疊」。**

> 上述實測是在 `overflowGraceMs` 還是 **3000ms** 的年代做的；該值之後統一為 **5000ms**，
> 同樣的連續投放要約 61 顆才會填滿，但**成因與修法完全一樣**，所以數字保留原樣。

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

## 6. 技力與技能

完整規格見 [`../plan.md`](../plan.md) §3.3 與 `../design.md` §5；這裡只記「規則為什麼長這樣」。

### 6.1 技力（SP）的累積與上限

| 事件 | 增減 |
|---|---|
| 成功投放一顆 | `+sp.gainPerDrop`（`0.05`） |
| 每合成一次 | `+sp.gainPerCombo`（`0.05`） |
| 使用技能 | `−該技能的 cost`（由 JSON 定義，見 6.3） |

累積掛在**兩條不同的路徑**上，這是刻意的：只看投放會讓「一直投但都沒合成」也能存到滿，
只看合成又會懲罰剛開局。兩者都給，技力才同時反映「動作」與「成果」。

- **上限** `sp.max` 是「**正整數 1–10**」，因為技力計**一點一條**，上限同時就是段數。
  載入器會四捨五入並鉗進這個範圍，任何修正都發警告（寫 3.5 會變 4，寫 11 會變 10）。
- 硬上限 `SP_MAX_CEILING = 10` 是**安全閥**而不是玩法參數：超過它技力條會畫出面板之外。
- `setMaxOverride(value | null)` 供技能在條件成立時臨時加減上限（UI 保留 API，現行技能未使用）。

### 6.2 解鎖：看的是**當前值**，用掉即時上鎖

| `unlock.kind` | 條件 | 用於 |
|---|---|---|
| `sp` | 當前技力 ≥ 該技能的 `cost` | 當棄即棄！／協議：浮動／搖晃！ |
| `cumulativeSpent` | **本局累計消耗** ≥ `threshold` | 命運互換（免費，門檻 6） |

「當前值」而不是「歷史最高值」是使用者定案：技力計本身就是解鎖器，花掉就上鎖。
未解鎖的技能卡被一層灰遮罩蓋住，遮罩上顯示**還差多少**（收費技能＝當前值佔比，
累計消耗型＝累計消耗佔比）。

`cumulativeSpent` 型的技能**用完之後累計歸零**（`SpResource.resetSpent()`），所以它會重新上鎖，
下一次要再存滿 6 點才能用。`resetSpent()` 只清累計，**不動**當前值與臨時上限。

### 6.3 扣費時機：效果成功執行才扣

選取目標的期間**不扣**、取消**不退**、付不起則**完全不動任何狀態**（`SpResource.spend()`
先問再扣）。所以玩家不會遇到「按了、取消、技力白花」這種事。

### 6.4 技能作用期間禁止投放

`GameSession.canDrop` 在「選取中、浮動中、搖晃中」一律為假。規則只在這**一處**成立，
滑鼠、鍵盤、觸控都不可能繞過 —— 否則「技能施放期間禁止投放」會變成看哪個輸入管道而定的軟規則。

### 6.5 各技能的規則細節

**當棄即棄！**（`discard`，cost 1，點選 1 顆）
移除該顆剛體；其餘方團團自然塌落、重新堆疊 —— 那是物理的結果，不是額外規則。

> **「自然塌落」有個前提：它們必須是醒着的。** Matter 開了休眠（`ENGINE_ENABLE_SLEEPING`），
> 而引擎對休眠剛體是**完全跳過**的（`Engine._bodiesApplyGravity`、`Engine._bodiesUpdate` 都
> `continue`），`Sleeping.afterCollisions` 又只認「被夠快的移動物體撞到」。移除支撐**不產生
> 任何碰撞事件**，所以那一疊永遠醒不過來、就懸在半空。
> `GameSession.removeTarget()` 因此在移除後做一次 `wakeAll()`：O(n) 一次、n 是幾十，可忽略。

**協議：浮動**（`protocol_float`，cost 2，即時）
把重力翻成向上的淨加速度（`gravityY × (1 − liftFactor)`），並在容器頂緣**下方**
`floatCeilingBelowRim`（20）處放一片**隱形靜態平面**當天花板；顆粒升到那裡就被擋住，
誰都進不了警戒區。

> **為什麼是平面而不是每步傳送**：把越線的顆粒每步壓回線下，等於讓求解器的結果每幀被推翻
> 一次（會抖），而且「碰到才停」與「被搬回來」在手感上是兩件事。有實體接觸面，顆粒就會自然
> 疊成「壓在杯蓋下」的形狀。施放的那一刻另外做**一次** `clampCeiling()`，把已經在天花板
> 之上的顆粒先壓回平面下方 —— 否則它們會卡在平面內部，被求解器從最近的出口（通常是上方）
> 擠出容器。
>
> **浮動期間每步都叫醒全部顆粒**：休眠剛體收不到重力，不叫醒的話只有剛動過的顆粒會浮 ——
> 這正是「只有局部有浮動」那隻 bug。

> **浮動期間不判溢位**（`updateOverflow()` 直接跳過，計時器**凍結而非歸零**），
> 結束後再等 `FLOAT_OVERFLOW_BUFFER_MS`（0.5s）才恢復。天花板本來就在溢位線之下，
> 所以浮動期間的上緣不可能觸發溢位判定。
>
> 平面是**靜態**剛體，所以 `reset()` 的 `removeDynamicBodies()` 帶不走它，必須顯式移除 ——
> 否則上一局留下的隱形平面會讓新的一局從第一幀就撞到一道看不見的天花板。因為浮動與搖晃
> 共用這片平面，建立／移除只由一個開關（`GameSession.ceilingNeeded`，＝浮動中或搖晃中）決定，
> 兩邊同時結束才收掉，不會出現「浮動收掉、搖晃還在卻沒了蓋子」的空窗。

**搖晃！**（`shake`，cost 3，即時）
**地震**：容器沿一條與水平成 `axisTiltDeg`（15°）的斜線往復，位移疊在 `containerGeometry` 上，
並以 `Body.translate` 的**差量**搬動靜態牆壁；同時**每步對每一顆方團團施加慣性力**
（`applyShakeImpulse()`），另有 `upwardFactor`（10%）的持續向上托力。`sin(πt)` 包絡讓幅度從 0
起、回到 0，容器不會在開始或結束的瞬間跳一下。

> **搖晃也蓋同一片天花板。** 它與浮動共用 `container.json → floatCeilingBelowRim` 那片靜態
> 平面：兩者要的其實是同一件事 —— 把顆粒封在容器口以下。上托的那 10% 若沒有東西擋住，
> 顆粒會在往上的一瞬間集體冒出溢位線，所以施放時一樣叫醒全家、`clampCeiling()` 一次，
> 平面也一樣橫跨整個**可視範圍**（`display`，見下）。**只有一個旋鈕**是刻意的：兩個技能各留
> 一個，只會造出兩份日後各走各的副本。
>
> **為什麼「往上的一瞬間」不會真的越線**：天花板在溢位線下方，顆粒撞上它就在那裡定住，
> 所以上緣永遠停在線下。實測把方向力開到最大時，最高上緣是 `99.93`（天花板在 `100`）；
> 若把平面拿掉，同樣的參數會衝到 `-114` —— 越線 164 個單位。

> **牆只是畫面，顆粒的力是另一回事。** 牆是**靜態**剛體：`Body.translate` 不帶速度，而
> `Sleeping.afterCollisions` 對「靜態 vs 休眠」直接 `continue` —— 牆掃過去連叫醒都做不到。
> 所以「容器在動、球沒動」不是錯覺，是原本的實作真的只搬了牆。
>
> 慣性力的量值取自容器自己的加速度：站在震動地面上的物體感受到與地面**相同**的加速度，
> 容器位移是 `A·sin(ωt)`，所以 `Δv = A·ω²·sin(ωt)·Δt²`，再乘 `SHAKE_BODY_ACCEL_COUPLING`
> （0.3）折算成手感。

> **幅度會被夾在展示餘裕之內。** 容器的**寬度不變**，但畫布左右各讓出 `leftOffset`／
> `rightOffset`（`container.json`，預設 50）的**展示餘裕** —— 畫布的虛擬寬度同步加寬兩者的和，
> 所以可玩寬度與從前逐單位相同。搖晃的水平分量被夾在「餘裕 ÷ |cos(傾角)|」之內，容器滑到
> 兩端時外框仍在畫布內、邊線不會被切掉；同時方團團的裁切範圍是「外框 ＋ 兩側餘裕」而不是
> 外框本身，所以貼牆的方團團在晃動時也不會被裁掉半邊。想讓它搖得更遠就改大這兩個值。

> **穩定性護欄**：使用者給的幅度（2 秒 5 圈、半徑最多 1/3 容器寬）換算成牆壁線速度是每步數十
> 世界單位，照字面跑會把整箱甩飛、甚至穿透薄牆。`SHAKE_MAX_BODY_SPEED`（12）把最壞情況壓回
> 「被搖得很厲害」，而不是「炸開」。這是護欄，不是玩法參數。

**命運互換**（`fate_swap`，免費，點選 2 顆）
兩顆的**位置與速度一起**交換（只換位置會讓兩顆立刻沿舊慣性跑回去，看起來像沒換成功），
再對壓在新位置上的鄰居施加擾動。需要**兩個相異目標**，否則不作用。

### 6.6 架構：技能透過窄介面作用於棋盤

`src/game/skills/` 是 `Skill` 抽象基底 ＋ 四個子類別 ＋ `SKILL_CLASSES` registry；
技能只透過 **`SkillBoard` 窄介面**（`targets` / `removeTarget` / `swapTargets` / `floatAll` /
`shakeContainer` / `overflowLineY` / `containerWidth`）作用，`GameSession` 是唯一實作者。

好處是「新增技能 = 新增一個 class ＋ 登記 ＋ 一筆 JSON」，**核心迴圈與 Matter.js 都不用碰**；
技能也無法偷偷改到棋盤的其他狀態。`skills.json` 的 id 對不上任何 class 時**略過並警告**，
不是丟例外 —— 一份寫錯的設定不該讓整個遊戲起不來。

---

## 7. 調參速查

| 想改什麼 | 去哪改 | 現值 |
|---|---|---|
| 溢位線在頂緣上方多高 | `container.json → overflowAboveRim` | `30` |
| 投放點在頂緣上方多高 | `container.json → dropAboveRim` | `40`（**必須大於上一項**） |
| 溢位寬限秒數 | `levels.json → settings.overflowGraceMs` | `5000` |
| 連擊窗口 | `levels.json → settings.comboWindowMs` | `1000` |
| 合成冷卻 | `levels.json → settings.mergeCooldownMs` | `100` |
| 近接合成的邊緣間隙容差 | `src/core/constants.ts → MERGE_OUTLINE_GAP` | `4` |
| 合成後推開鄰居的力度 | `src/core/constants.ts → MERGE_PUSH_FACTOR / MERGE_PUSH_SPEED / MERGE_PUSH_MAX_DEPTH` | `1.15 / 0.05 / 12` |
| 合成後找支撐的吸附上限 | `src/core/constants.ts → MERGE_SETTLE_MAX_DROP` | `80` |
| 連擊曲線 | `src/game/combo.ts → COMBO_CURVE` | `coefficient 0.25 / cap 9 / base 1` |
| 彈跳動畫時長與峰值 | `src/core/constants.ts → POP_ANIMATION_MS / POP_PEAK_SCALE` | `180ms / 1.3` |
| 每次投放／合成的技力 | `skills.json → sp.gainPerDrop / sp.gainPerCombo` | `0.05 / 0.05` |
| 技力上限 | `skills.json → sp.max` | `3`（可設 1–10 正整數；硬上限常數 `SP_MAX_CEILING`） |
| 各技能的消耗 | `skills.json → skills[].cost` | `1 / 2 / 3 / 0` |
| 命運互換的解鎖門檻 | `skills.json → skills[].unlock.threshold` | `6`（累計消耗） |
| 浮動的時長與抬升倍率 | `skills.json → skills[].params.durationMs / liftFactor` | `1500 / 1.6` |
| 技能天花板在容器頂緣下方多深 | `container.json → floatCeilingBelowRim` | `20`（浮動與搖晃共用） |
| 技能天花板那塊隱形平面的厚度 | `src/core/constants.ts → CEILING_THICKNESS` | `40` |
| 容器左右兩側的展示餘裕 | `container.json → leftOffset / rightOffset` | `50 / 50`（寬度不變；搖晃幅度上限） |
| 搖晃的時長／圈數／幅度比例 | `skills.json → skills[].params.durationMs / revolutions / radiusFactor` | `2000 / 5 / 0.12` |
| 搖晃擺動軸的傾角／持續向上力 | `skills.json → skills[].params.axisTiltDeg / upwardFactor` | `15 / 0.1` |
| 搖晃半徑的硬上限 | `src/core/constants.ts → SHAKE_RADIUS_FACTOR_MAX` | `1/3` |
| 搖晃的速度護欄 | `src/core/constants.ts → SHAKE_MAX_BODY_SPEED` | `12` |
| 搖晃施加在顆粒上的加速度耦合 | `src/core/constants.ts → SHAKE_BODY_ACCEL_COUPLING` | `0.3` |
| 浮動結束後的溢位緩衝 | `src/core/constants.ts → FLOAT_OVERFLOW_BUFFER_MS` | `500` |
| 命運互換的周邊擾動 | `skills.json → skills[].params.disturbance` | `6` |
| 溢位紅線與警戒區樣式 | `src/render/stage.ts → OVERFLOW_STYLE` | 見 `rendering.md` |
| 技能選取標示的樣式 | `src/render/stage.ts → SELECTION_STYLE` | 見 `rendering.md` |
| 哪一級可被生成 | `levels.json → levels[].droppable / spawnWeight` | 全 `true` / `10` |
| 各級分數 | `levels.json → levels[].score` | `0, 1, 2, 4, … 256` |
