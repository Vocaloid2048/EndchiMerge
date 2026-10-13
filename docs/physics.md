# 物理參數

> 本文件記錄 `public/config/levels.json` 現行數字的推導規則，以及這些規則背後的技術理由。

## 座標系

```
VIRTUAL_HEIGHT = 1000                      // 鎖定的虛擬高度（core/constants.ts）
scale          = containerHeightPx / 1000  // 只用於畫面投影
VIRTUAL_WIDTH  = containerWidthPx / scale  // 隨容器浮動
```

半徑以**虛擬單位**定義，因此相對比例在所有裝置一致。重力與密度等物理常數同樣
以虛擬單位定義，`scale` 不參與物理計算——否則視窗一變，手感就會跟著變。

設計稿的容器約為 15:16（略高於寬），對應 `VIRTUAL_WIDTH ≈ 937.5`。

## 參數的推導規則

| 欄位 | 規則 | 現值 |
| --- | --- | --- |
| `radius` | 手工遞增數列（相鄰比約 1.15–1.5，非單一公比），前五級為掉落池、後五級為合成產物 | 15 → 110（15, 20, 30, 37.5, 48, 60, 70, 82.5, 95, 110） |
| `density` | 全部相同 | 0.0010 |
| `restitution` | 隨等級遞減 | 0.20 → 0.06 |
| `friction` | 全部相同 | 0.30 |
| `frictionAir` | 全部相同 | 0.005 |
| `score` | 2 的冪次，Lv1 固定為 0（永不經合成產生） | 0, 1, 2, 4 … 256 |
| `spawnWeight` | 只有前五級可掉落 | 20 / 25 / 25 / 15 / 15，其餘 0 |

`droppable` 與 `spawnWeight` 是兩道獨立的閘門：Lv1–Lv5 兩者皆開；Lv7 的 `droppable`
為 `true` 但權重為 0，實際不會掉出；Lv6／Lv8–Lv10 兩者皆關，只能靠合成產生。

**為何密度統一而非遞增**：密度統一意味質量 ∝ 面積 ∝ r²，這是物理上最自然的
預設。若讓密度隨等級遞增，Lv10 的質量會再乘上一個額外係數，質量比進一步膨脹，
求解器在堆疊時容易抖動。先用自然值，真要調再調。

**目前的質量比**：Lv10 對 Lv1 為 `(110 / 15)² ≈ 54×`。這個數字要在校準時
親自感受——太大會導致小球被壓穿，太小則大球推不動小球。

**為何 Lv1 的 `score` 是 0**：`score` 定義為「由合成產生時獲得的分數」。
Lv1 只能靠掉落產生，永遠不會是合成的結果，所以 0。實際得分由 Lv2 起算。

## 碰撞形狀：光柵化輪廓 ＋ 凸分解

碰撞體**以 sprite 的 alpha 輪廓建立**，而非單純的圓。

### 為什麼用輪廓

方團團的 sprite 是「本體方塊 ＋ 外掛裝飾（翅膀、角、尾巴）」。本體框是 304×304，
但**外輪廓有 6.5%–24.6% 落在這個框之外**（`訣` Lv9 最誇張，24.6%）。
用圓去包，玩家會看到兩顆「明明沒碰到」的方團團黏在一起；用圓去切，翅膀又會穿模。

| 素材 | 框外面積佔比 |
| --- | --- |
| 多數 Lv1–Lv8 | 6.5% – 15% |
| `訣`（Lv9） | **24.6%** |

### 怎麼做

1. **取輪廓**：`render/silhouette.ts` 把 sprite 的 alpha 通道當成點陣圖，
   用 **Moore 鄰域邊界追蹤**（8 連通）走出外輪廓。步長 `step = 2`（跳點掃描）、
   門檻 `threshold = 8`（alpha 大於 8 才算實心）。
   起點取**最左上**的實心點，方向從西側出發、逆時針試探 ——
   `dir = (cameFrom + 5 + k) % 8`（先退回上一格再順時針掃）。
2. **簡化**：**Ramer–Douglas–Peucker**，`epsilon = 3`。
   原始輪廓約 1200–1500 點，簡化後剩 **30–46 個頂點**，犄角與翅膀都保得住。
   RDP 用**顯式堆疊**實作（不是遞迴），避免極端輸入把 call stack 撐爆。
3. **換算到虛擬座標**：`toVirtualPolygon(contour, scale, anchorX, anchorY)`，
   其中 `scale = (2 × radius) / SPRITE_BODY`、`anchor = (256, 328)`。
   也就是**半徑仍然決定視覺大小**，輪廓只是把它換成同一尺寸的多邊形。
4. **建剛體**：`Matter.Bodies.fromVertices(x, y, [vertices], material, true)`，
   凹多邊形靠 **`poly-decomp`** 做凸分解。`core/physics.ts` 在模組頂層呼叫
   `Matter.Common.setDecomp(decomp)` 註冊一次 —— 少了這行，`fromVertices` 對凹多邊形
   會直接回 `undefined`。

### 回退路徑：圓

`synthetic` 素材（測試用假圖）、載入失敗、輪廓退化（頂點 < 3 或面積 ≈ 0）時
`contourToPolygon()` 回 `null`，`GameSession.createBody()` 就退回 `createCircleBody()`。
`GameSession` 的 `silhouettes` 是**可選**注入；未提供時全場都是圓。
`body` 有效性的判準是**質量**（`Number.isFinite(mass) && mass > 0`），不是
`parts.length` —— 凸多邊形分解後本來就只有 1 個 part，用 parts 數量判斷會誤殺。

### 旋轉

`lockRotation: false`。輪廓碰撞體與 sprite 用同一個角度，所以**兩者永遠對齊**；
鎖住旋轉反而會讓 sprite 轉了、碰撞體沒轉。堆疊穩定後實測角度是散的
（`[-453, -1, 243, 0, 84, -141]`），這正是預期的行為。

### 製圖注意

輪廓是從 **alpha 通道**取的，所以 sprite 的**透明區域必須真的透明**。
若把角色畫在白色背景上再匯出，輪廓會變成整個方框，等於退回圓的精度。

## 改動這份配置時的注意事項

1. `radius` 與 `spawnWeight` 高度耦合。改半徑而不改權重，難度曲線會靜默走樣。
2. `mergeResult` 形成單鏈，最後一級必須是 `null`。斷鏈會讓合成靜默失敗。
3. 新增等級時，`sprite` 必須是**相對於 `public/assets/`** 的路徑（例如 `character/萊萬汀_img.webp`），且檔名與磁碟上的檔案完全一致（含中文）。素材一律 512×512、body 304×304、body 中心 (256, 328)——詳見 `public/assets/character/README.md`。
4. 半徑不得使 `2 × radius > VIRTUAL_WIDTH`，否則該等級一出現就會卡在兩牆之間。
