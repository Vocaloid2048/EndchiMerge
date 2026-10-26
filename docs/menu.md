# 遊戲選單與返回路徑

選單把《團圓大作戰》包成一個模組：開站先見選單，選遊戲才載入該遊戲；遊戲畫面左上角的返回鍵回到選單。
The menu wraps EndchiMerge as one module: the site opens on the menu, a game loads only once it is chosen,
and the back button at the game's top-left corner returns here.

遊戲本身的玩法、模式切換、設定頁與排行榜**完全未改動** —— 選單只決定「進哪一頁」。
The game itself is untouched: the rules, mode switching, settings and leaderboard all behave as before.
The menu only decides which page is shown.

---

## 1. 為什麼切換要重新載入

`?game=<id>` 決定畫面，切換走一次真正的導覽（`location.assign`），而不是在同一個頁面裡拆裝遊戲。

| 理由 | 說明 |
| --- | --- |
| **排行榜憑證** | `LeaderboardSource.beginRun()` 在開局時鑄一張一次性憑證，頒發時刻即本局起點。若在選單就把遊戲 boot 起來，玩家停留多久都算進本局，等於放寬了伺服器的宣稱時長檢查 |
| **配置只抓一次** | 等級表與技能名單在 boot 時寫進 `GameSession`；換遊戲等於換一份配置，與既有的「切模式＝reload」同一個理由 |
| **沒有拆裝路徑** | `GameSession.destroy()` 只卸掉碰撞訂閱，清不掉 Matter 世界；頁內切換需要一份完整的 teardown，現階段不值得 |
| **成本** | 一次導覽約 0.3–1s；BGM 由頭播放，但靜音偏好照樣保留 |

代價：選單期間沒有背景音樂（音樂元件掛在遊戲版面的 `chrome.music` 上）。

---

## 2. 路由

| 檔案 | 職責 |
| --- | --- |
| `src/game/gameCatalog.ts` | 遊戲目錄：`id`、名字的語系鍵、圖示路徑、`status`（`playable` / `planned`）。純資料 |
| `src/core/route.ts` | `parseRoute(search)` → `{kind:'menu'}` 或 `{kind:'game', id}`；`gameHref(id)` 產生相對連結 |

規則：

- 沒有 `game` 參數、參數為空、id 不在目錄內、或指向 `planned` 的遊戲 → **選單**（寧可回選單，也不要進到一個空白頁）。
- id 區分大小寫，只接受目錄內的字串聯集。
- 其他查詢參數（例如 `?debug=1`）不影響分流。

`src/main.ts` 的 `bootstrap()` 只做三件事：建立共用層（儲存、偏好、語系、手機把關）→ `parseRoute()` → 轉交
`bootMenu()` 或 `bootGame()`。`bootGame()` 就是原本的完整裝配，一行邏輯都沒有改。

---

## 3. 選單畫面

`src/ui/menu.ts` ＋ `src/styles/menu.css`，幾何全部來自 `src/core/design.ts` 的 `MENU_RECTS`
（三格各 320×380、間距 72、置中於 1920×1080 畫布）。

- 一格＝圖示（`public/assets/menu/<id>.svg`）＋ 遊戲名；整個格子是一顆 `<button>`，手機縮到三成後仍有 ~110px。
- `planned` 的遊戲：`disabled`、不透明度 0.45、右上角「即將推出」角標。
- 缺圖只降級成虛線框 —— `public/assets/menu/` 整份刪掉，選單照樣可用（與 `public/assets/sprites/` 同一個原則）。
- 選單**只**抓 `config/branding.json`（`loadBranding()`），不為了一行聲明載入等級表、技能與容器。
- 非官方聲明在兩個畫面都在：選單與遊戲共用 `ui/notice.ts` 與 `.layout__notice` 的樣式。

---

## 4. 返回鍵

設計稿的 `return_btn`（節點 `1408:2092`，`LAYOUT_RECTS.back` ＝ 64,64 128×128）本來被 SCORE 面板的
z-order 壓住、從不渲染。現在照原座標畫在面板**之上**（DOM 排在 `score` 之後），不另創位置。

| 情況 | 行為 |
| --- | --- |
| 未開局（`session.totalDrops === 0`） | 立即返回選單 |
| 已開局 | 彈確認對話框（`createConfirmDialog`，`holdMs: 5000`、`tone: 'accent'`）；確認鈕鎖五秒，期間只可按取消 |
| 取消（或 `Esc`） | 留在原局，狀態不變 |
| 確認 | 先 `recordRun()` ＋ `syncRun()`，再 `assign()` 到不帶 `?game=` 的路徑 |

「已開局」是**每個遊戲自己的定義**：`attachBackToMenu({ hasStarted })` 由該遊戲注入，合成玩法是
「投放過至少一顆」（分數與合成數只可能出現在第一顆之後）。無盡模式、技能選取等狀態都不參與這個判斷。

五秒與「切換玩法模式」「開啟無盡模式」同一個門檻 —— 三者都會結束目前這一局。

---

## 5. 加入一個新遊戲

1. 畫好圖示放 `public/assets/menu/<id>.svg`（正方形 viewBox，白色描邊）。
2. `src/game/gameCatalog.ts`：`GameId` 加 id、`GAME_CATALOG` 加一筆，`status` 由 `'planned'` 改 `'playable'`。
3. 五個語系字典各加 `game.<id>.name`（漏一個 `tsc` 就紅）。
4. `src/main.ts` 加該遊戲的啟動函式，並在 `bootGame()` 的分流處按 `route.id` 分派（現時只有 `'merge'`）。
5. 該遊戲自行定義 `hasStarted()` 並傳給 `attachBackToMenu()`。
6. `tests/route.test.ts` 與 `tests/gameCatalog.test.ts` 會自動覆蓋新的目錄；把新 id 補進 route 的案例即可。

---

## 6. 已知限制

- **瀏覽器上一頁**會繞過五秒閘門。不攔截：`popstate` 哨兵與「切換即 reload」的路由互相拉扯，而成績每幀已寫入本機紀錄、
  `pagehide` 會上載，不會掉分。返回鍵才是被認可的出口。
- **選單沒有背景音樂**（見 §1）。
- **模式（新玩法／傳統）仍在設定頁**：選單只負責選遊戲，不在選單選模式（使用者定案）。
- 選單與遊戲各自建立一份 `attachStageScale`；兩者不會同時存在。
