# 變更紀錄

本檔案記錄每個里程碑交付了什麼。專案尚未正式發佈，因此以**里程碑**（M0–M10）而非
語意化版本號分節；第一次上線（M10）之後才會開始打 tag。

里程碑的定義見工作文件 `design.md` §8。

---

## 未發佈 — 客戶端接上後端：榜真的有別的玩家了（2026-10-13）

`LeaderboardSource` 這個接縫從排行榜重寫那天就留著，這一節是它第一次真的被接上。UI 只多了**一行**。

### 新增 — 伺服器版資料層（`src/game/remoteLeaderboard.ts`）

- `createRemoteLeaderboard()` 是 `LeaderboardSource` 的 HTTP 實作：`POST /api/run/start` 開局取憑證、
  `POST /api/score` 提交、`GET /api/leaderboard?category=…` 取榜。`fetch` 可注入，所以測試不碰網路。
- **提交的是「某一局自己的數字」，不是本機紀錄。** 本機紀錄的三個最大值可能來自不同的三局（那是
  刻意的），湊在一起送會被 `checkRationality` 判成不合理 —— 所以 `record()` 把這一局原封不動存下來，
  `sync()` 送的是它。這是使用者定案「任何刷新三個最大值之一的那一局都送」的實作。
- **憑證在開局時鑄，不是提交時。** 憑證的頒發時刻就是這一局的起點，`checkClaimedDuration` 拿它判斷
  「宣稱的時長不可能超過實際流逝的時間」。提交時才鑄的話那個差值永遠是零，**每一局正常的遊戲**都會
  被退。因此介面多了選填的 `beginRun()`。
- **`snapshot()` 一定是快取**（介面是同步的），所以另加選填的 `refresh()`；UI 在榜面開啟時呼叫它一次。
  抓不到就**保留上一次的榜**，而不是清空。
- 失敗分類處理：網路失敗／429／5xx 留著待送；4xx（400／401／403／409）是**定論**，清掉標記；200 但
  `verified: false` 代表「受理了但沒上榜」（不合理），記一行且不重試。任何一條都不影響遊戲本身。

### 變更 — 本機的一半抽出來，兩個實作共用（`src/game/leaderboard.ts`）

- 新增 `createPlayerRecord()`：**身份、顯示名、分享意願、本機紀錄**。本機榜與伺服器榜都建在它上面，
  所以「改名不新增一筆」「只升不降」「時長跟著分數走」這些規則**只有一份實作**。
- `createLocalLeaderboard()` 行為不變（50 條既有測試全過），只是改成使用它；`LeaderboardSource` 多了
  兩個選填成員（`refresh`／`beginRun`），本機實作兩個都不需要。

### 修正 — 少了「這一局投了幾個」，提交必被退

- `GameSession` 新增 `totalDrops`：這一局**累計投放**的顆數。`dropCount` 是「目前場上還有幾顆」，
  合成與回收都會讓它變少，拿它去送會變成「合成 60 次但只投了 12 顆」而被退。
- `LeaderboardRun` 新增選填的 `drops`；未提供時客戶端退回 `merges`（伺服器的下界是「合成 ≤ 投放」，
  少報是安全的，送 0 會讓每一筆都被退）。

### 新增 — 客戶端版本隨提交送出

- `vite.config.ts` 的 `define` 把 `package.json` 的版本編譯成 `__APP_VERSION__`，由 `main.ts` 交給
  `createRemoteLeaderboard`。伺服器只把它存進 `scores.version` 備查 —— 查一件舊事時，「這一筆是哪個
  版本的客戶端送出來的」是唯一問得出來的線索。

### 測試與驗證

- 新增 `tests/remoteLeaderboard.test.ts`（32 條），全部用注入的假 `fetch`。
- typecheck ✅、vitest **694 通過 / 0 略過**（34 檔）✅、build ✅。
- **對真的開發伺服器跑過一次端到端**（`npm run dev`，SQLite ＋ Vite 代理）：開局拿到憑證 → 提交
  `score=900, merges=12, drops=15, durationMs=8000` → **通過合理性檢查並出現在榜上**（同一局再送一次
  不重送）→ 把真的排行榜彈窗接到真的伺服器版資料層，在瀏覽器裡改名、開局、提交 `score=3000`，榜上
  出現兩列並顯示「你的最佳：3,000（3,000 分）· 第 1 名，共 2 位玩家」。

### 已知未完成

- **改名要等下一次提交才上到伺服器**：`profiles.display_name` 只由 `upsertProfile` 更新，所以客戶端的
  快取先樂觀改名，而伺服器的真值要等下一次提交。要做「立刻生效」就得有 `profile/name` 端點。
- **解鎖清單仍未上報**：客戶端送的是「某一局」的成績，解鎖集合只存在本機（要 `profile/sync`）。

---

## 未發佈 — M9 後端（Vercel Functions ＋ Postgres）與每局時長（2026-10-12）

> 本節涵蓋 `85e99dc`（客戶端顯示每局時長）與分支 `feat-backend` 上的後端（`3d5520f` 骨架，
> 以及其後的**可攜性重構**：兩個平台、兩個方言）。反作弊**只做 T2**（伺服器頒發的短期憑證），
> T1 對稱簽章與 T3 伺服器端重放皆不做（使用者定案）。

### 新增 — 每局遊玩時長，只在排行榜顯示（`85e99dc`，2026-10-13 改版）

- `src/ui/duration.ts`：`formatDuration(ms)` → **固定 `HH:mm:ss`**（`00:00:07`、`00:12:34`、
  `01:15:00`）。每個欄位都補零，所以榜上那一整欄時間字元對齊（列上已有 `tabular-nums`）；小時欄
  沒有上限，過了 `99:59:59` 長出第三位而不回繞；負值與非有限數視為 0。
- **位置改到排行榜**（使用者定案）：HUD 不再顯示當前這一局的時間，結算卡也拿掉那一格；榜上每一列
  在**該分類數值右邊**多一格 `HH:mm:ss`（`.leaderboard__duration`，欄寬 130px）。
- 因此 `85e99dc` 為此加的東西一併移除：HUD 的 `durationMs` 狀態欄位、分數卡的 `card__value-note`
  節點與 `layout.css` 的對應樣式、結算卡的第四格，以及「時長比對格式化字串」那個折衷（它存在的
  唯一理由是每幀呼叫但每秒才變一次）。分數卡因此收回一個節點（`card__value` 直接帶 `score-value`
  hook），與 COMBO 卡同構。
- `src/game/leaderboard.ts`：`durationMs` **跟著分數走** —— 只在分數真的刷新時才換。若獨立取最大值，
  榜上會出現「900 分、12 分鐘」這種自相矛盾的兩格。`collapseLegacy` 取「創下最高分那一局」的時長。
  **附帶後果寫進註解**：COMBO／合成分頁上那一格顯示的是該玩家**最高分那一局**的長度，不是創下
  那項紀錄那一局的長度（每位玩家只有一份時長；要每個分類各記一份得在資料層與後端各加一欄）。
- 五語字典的 `label.duration` 保留，改作榜上那一格的 `title`。

### 修正 — MySQL 的冪等訊號與分頁榜序（2026-10-13）

第一次把測試**指向一個真的 MySQL**（`mysql-memory-server`，拋棄式、隨機埠）時抓到兩個單元測試
在結構上不可能抓到的錯。兩者都只在 MySQL 一方發作，Postgres 一切正常：

- **冪等訊號失效**：`mysql2` 的 `getDefaultFlags()` **預設就開著 `FOUND_ROWS`**
  （`node_modules/mysql2/lib/connection_config.js`），而那個旗標把 `affectedRows` 由「真正寫入的列」
  改成「**匹配到的**列」。於是刻意空轉的 `on duplicate key update run_id = run_id` 在既有列上回報
  `1`，看起來就像新的一局 —— 重試會靜靜地重複記分。修法是一行黑名單 `flags: ['-FOUND_ROWS']`
  （`mergeFlags` 認得 `-` 前綴），收在具名常數 `MYSQL_CLIENT_FLAGS`，並由兩條單元測試釘住（旗標在、
  裸的 `FOUND_ROWS` 不在）。Postgres 不受影響 —— `returning` 的列數本來就是真的。
  另一條候選修法 `insert … select … from dual where not exists (…)` 也**實測正確**（1／0，交易內
  可用），但不採用：它會**複製一份插入欄位清單**，遲早與 `upsertProfile` 的欄位順序漂移。
- **榜序與分頁不一致**：三個分類（分數／COMBO／合成）各自獨立取最大值，所以**伺服器**必須按請求的
  分頁排序 —— 否則一位「高分低連擊」的玩家在 COMBO 榜上根本不會出現在前 N 名裡。`Dialect.boardOrder`
  改成收 `category`，`Store.topProfiles`／`rankOf` 也各收一個，兩者共用同一份
  `boardOrderKeys(category, timeOrder)`，名次與列序因此必然同源；`rankOf` 的謂詞就是那串鍵的
  **前綴相等鏈**。`GET /api/leaderboard` 多一個 `?category=`，不明值退回 `score`。

### 新增 — 後端（`api/`，Vercel Functions ＋ 任何 Postgres）

三個端點，邏輯全住 `api/_lib`、端點檔案只是一行轉接頭，所以單元測試可**不碰資料庫**直接呼叫處理器：

| Method | Path               | 用途                                          |
| ------ | ------------------ | ------------------------------------------- |
| `POST` | `/api/run/start`   | 開局：伺服器鑄一張短期憑證（T2 的關鍵）                       |
| `POST` | `/api/score`       | 提交：驗速率先行 → 憑證 → 冪等 → 時間 → 合理性 → 寫榜          |
| `GET`  | `/api/leaderboard` | 取榜（`limit` 預設 100、上限 200），附查詢者自身名次          |

- `api/_lib/env.ts`：`readConfig(env)` **純函式**，啟動時驗完。`DATABASE_URL` 與 `RUN_TOKEN_SECRET`
  （≥ 32 字元）是硬性缺漏 —— 短秘密等於沒有秘密，所以算「缺漏」而非「有點弱」。其餘**預設值一律
  取保守那一邊**（IP 截斷、速率生效、CORS 不放行）。
- `api/_lib/http.ts`：欄位讀取**拒絕小數與 NaN**，不四捨五入。`createVercelHandler` 用結構型別，
  不依賴 `@vercel/node`；未預期例外收斂成 500 且**不外洩訊息**。
- `api/_lib/tokens.ts`：簽章用 `\n` 串接的 canonical 輸入 ＋ `timingSafeEqual`；入庫的是**雜湊**
  （資料庫外洩不等於可直接拿去提交）。
- `api/_lib/pgStore.ts`：只用標準 SQL（`ON CONFLICT`、`GREATEST`、`jsonb`），換供應商只改
  `DATABASE_URL`。連線池是**模組層級**、`max: 2`（Postgres 連線約 10MB、開一次 50–100ms）。
- 冪等：`scores.run_id` 主鍵 ＋ `on conflict do nothing` —— 重試與併發都不會重複計分，重放舊局只拿回
  同一個裁決。

### 新增 — 反作弊 T2：頒發時刻才是關鍵

`runToken` 綁 `(run_id, device_id, 頒發時刻)`。**頒發時刻**讓伺服器在收到成績時知道這一局何時開始，
於是能要求「宣稱的時長不可能超過實際流逝的時間」——這是 T1 對稱簽章結構上做不到的事（T1 只能證明
「這包沒被改過」，證明不了「真的打了那麼久」）。

- 時間檢查刻意**單邊**：只查上界。切到背景時模擬時鐘會停住，「打得比流逝時間短」是合法的，設下界
  會誤傷誠實玩家。容許差距 5 秒只用來吸量測噪音。
- 合理性上界**從遊戲配置推導**（`dropCooldownMs=500`、第 10 級分數 `256`、`cap 9 + base 1 = 10`
  倍）：投放 ≤ `⌊時長/500⌋+2`、合成 ≤ 投放、分數 ≤ 合成 × 256 × 10。`tests/api.test.ts` 有一條
  測試**讀回 `levels.json` 與 `combo.ts` 比對** —— 上界與配置脫節會變成「錯的上界」，比沒有更糟。
- 未通過的提交**仍寫進 `scores`**（`verified = false`），留審計痕跡：一次「明顯在試」的提交比一次
  成功的作弊更有價值。

### 新增 — 接收紀錄（`requests` 表）

使用者定案：接收時看到的 **IP 與 headers 存進專門的 table**。

- **只存白名單標頭**；`cookie` / `authorization` **永不入庫**（有測試用黑名單反過來驗）。
- `IP_STORAGE_MODE` 三選：`raw` / `truncated`（**預設**，IPv4 → /24、IPv6 → /48）/ `hashed`（帶秘密
  HMAC 前 32 位、前綴 `h:`）。`truncated` 已足以回答「同一來源是否重複出現」。
- 客戶端 IP 取 forwarded 的第一個（其餘是代理），並正規化埠與 `::ffff:` 映射 —— 同一來源要維持
  同一來源。
- **4xx/5xx 也寫**：被擋下的請求才是這張表最想看的。寫入失敗**吞掉**錯誤，不讓紀錄把一次成功的
  提交變成 500。

### 新增 — 資料表與部署設定

- `schema.sql`：`profiles`（一位玩家一列）、`scores`（一局一列、`run_id` 主鍵即冪等來源）、
  `run_tokens`（T2 憑證）、`requests`（接收紀錄），含各索引。
- `vercel.json`、`.env.example`（只放鍵名與說明）、`tsconfig.api.json`（`types: ["node"]`，納入
  `tsc -b`）。
- `docs/backend.md`：端點、環境變數、**資料庫放哪裡**、部署與本機開發。回答使用者的三個問題：
  **NAS 自架 Postgres 可行**（但 Vercel 對外 IP 是動態的、不能用 IP 白名單，需自備 PgBouncer）；
  **Vercel 已無自家小型資料庫**（Vercel Postgres 已退場遷往 Neon，現只有 Marketplace）；公開站
  **建議 Neon**。

### 新增 — 可攜性：兩個平台、兩個方言，一份業務邏輯

使用者要求「留意未來需要和 EdgeOne 和騰訊免費資料庫服務共用代碼」，所以這一版把**兩個會各自漂移
的地方**各收成一個接縫；接縫之間（`handlers.ts`、`sqlStore.ts`、`requests.ts`）的邏輯只寫一次。

> ⚠️ **先更正一個前提**：Neon 是 **Postgres**，而騰訊的免費資料庫是 **MySQL**。兩者方言不同，所以
> **兩個方言都得做**，做一個不足以「共用」。以下就是兩者共存的作法 —— 換供應商不必改業務邏輯。

**接縫一 —— 平台（`api/_lib/adapters/`）**

| 平台                     | 檔案                  | 轉接什麼                                            |
| ---------------------- | ------------------- | ----------------------------------------------- |
| Vercel                 | `adapters/vercel.ts` | Node 的 `req`／`res` → `ApiRequest`（結構型別，不依賴 `@vercel/node`） |
| EdgeOne／任何 Fetch 平台    | `adapters/fetch.ts`  | Web 標準 `Request`／`Response`                      |

兩者都指向**同一個** `endpoint(core)`，所以「方法檢查」只有一份。`vercelEndpoint(core)` 就是
`createVercelHandler(endpoint(core))`，端點檔自己講明跑在哪個平台。EdgeOne 則另有具名匯出
（`onRequestGet`／`onRequestPost`／`onRequestOptions`），三者都走同一條 route。

**接縫二 —— 方言（`api/_lib/db/dialect.ts`）**

`Dialect` 是兩個方言**所有**差異的唯一去處：

| 差異     | Postgres                | MySQL                  |
| ------ | ----------------------- | ---------------------- |
| 佔位符    | `$1`                    | `?`（位置式）               |
| 時間型別   | `timestamptz`           | `datetime(3)`          |
| 時間參數   | ISO 字串 ＋ `::timestamptz` | `Date` 物件              |
| 讀時間    | `extract(epoch…)`       | `Date.getTime()`       |
| 布林     | `true`／`false`          | `1`／`0`                |
| JSON   | `jsonb`                 | `json`                 |
| upsert | `on conflict … do nothing` | `on duplicate key update` |
| 寫入訊號   | `returning` 的列           | `affectedRows`         |
| NULL 排序 | `nulls last`            | `is null`              |
| `count(*)` | 補 `::int`              | 原樣                     |

- **`Binder` 是「同一條 SQL 餵兩個方言」的關鍵**：綁值並回傳對應佔位符，**每次出現各綁一次** ——
  `$1` 可以重複用，`?` 不行。所以 SQL 字串只寫一份，佔位符由 Binder 生成。
- **三個 MySQL 陷阱**（都在程式裡留了註解，且各有測試守住）：
  - `on duplicate key update` **由左往右求值**，所以 `best_score` **必須排在**
    `best_duration_ms`／`best_at` **之後**，否則「時長跟著分數走」會靜靜地永遠不觸發。
  - **禁用 `insert ignore`** —— 它把所有錯誤都吞成 warning，不只是重複鍵。
  - **不可開 `CLIENT_FOUND_ROWS`** —— 開了會讓刻意空轉的 `on duplicate key update run_id = run_id`
    回報 `affectedRows = 1`，於是每次重試都像新的一局，冪等當場失效。
  - 另外：`charset: utf8mb4`（否則 emoji 入不了庫）、`timezone: 'Z'`（否則日期位移到行程的本地時區）。
- **`Driver` 介面**收掉驅動差異：`query(sql, params) → { rows, affected }`、`transaction(run)`
  （已在交易中就只執行，不疊一層）、`close()`。`api/_lib/sqlStore.ts`（`SqlStore implements Store`）
  取代了原本的 `pgStore.ts` —— 因為介面沒變，`tests/api.test.ts` 那些記憶體測試一行都不用改。

### 測試與驗證

- typecheck ✅、vitest **635 通過 / 12 略過**（33 檔）✅、build ✅。
  *（數字是當時的狀態；加了 SQLite 方言之後是 **662 通過 / 0 略過**，見下面那一節。）*
- 新增 `tests/duration.test.ts`（6 條）、`tests/api.test.ts`（54 條）；`tests/leaderboard.test.ts`
  新增「時長跟著分數」6 條。
- `tests/api.test.ts` 的後端測試**完全不需要資料庫**：餵 `MemoryStore` ＋ 注入時鐘，毫秒內跑完
  「開局 → 提交 → 上榜」，驗的是真的處理器。
- 可攜性分**四層**測，前三層都不需要資料庫：
  - `tests/adapters.test.ts`（17 條）：兩個平台的轉接頭對**同一個**處理器產出**相同**的
    `ApiRequest`；`allow` 標頭能活著穿過轉接層。
  - `tests/dialect.test.ts`（32 條）：Binder 佔位符／參數對齊、**每個分類各自的榜序**、寫入語句形狀
    （含 MySQL 欄位順序）、**連線旗標**（`-FOUND_ROWS`）、**DDL 可重複執行**、兩方言的表集合相同，
    以及 `schema.sql` 與程式**逐句一致**。
  - `tests/sqlStore.test.ts`（20 條）：用錄影驅動（`RecordingDriver`）跑整個儲存層 —— 通用斷言
    「每句的佔位符數 = 參數個數」、兩邊的冪等訊號、交易包覆與回滾、列映射，以及 `rankOf` 拿哪個
    分類的欄位去比。
  - `tests/db.integration.test.ts`（13 條，**只有設了 `TEST_DATABASE_URL` 才跑**）：真資料庫上的
    往返、「時長跟著分數」、冪等、被拒的局、同分排名、**高分低連擊的玩家在 COMBO 榜上排第一**、
    計數、JSON 標頭、交易原子性。
- **`schema.sql` 的一致性由測試守住**：檔案裡那份是給人看的（可以直接 `psql -f`），真正的來源是
  `db/postgres.ts` 的 `schema()`；測試把檔案讀回來逐句比對，漂移就會紅 —— 這是沿用本專案
  比對 `limits.ts` 與 `levels.json` 的同一手法。
- 無頭瀏覽器實測（Playwright，掛上真的版面與真的彈窗）：改版後 HUD 分數旁邊**沒有**時長、結算卡
  三格（分數 ／ 合成次數 ／ 最高紀錄）、排行榜每一列在分類數值右邊顯示 `HH:mm:ss`；三個分頁都
  對齊、無溢出、卡片在畫布內。

### 已知未完成

- **客戶端尚未接上後端**：`src/game/leaderboard.ts` 仍走本地 `LeaderboardSource`，
  `sync()` 是預留的接縫。伺服器端可用，但要換成 HTTP 實作後榜上才會出現別的裝置。
- **`SqlStore` 的 MySQL 路徑已在本機真庫上跑過一次**（拋棄式 `mysql-memory-server`，
  MySQL 8.4.9），上面那兩個修正就是這樣抓到的；但**尚未在雲上的 MySQL 跑過**。要上騰訊雲之前
  應再指一個真的 MySQL 實例跑一次整合測試（`TEST_DATABASE_URL=mysql://…`）。
- **EdgeOne 只做了轉接層**（使用者的定案）：`adapters/fetch.ts` 與 `createEdgeOneHandlers` 都在、
  也有測試，但**尚未部署到 EdgeOne** 驗證；屆時要選 **Node Functions** 而非 Edge Functions
  （後者是 V8 isolate、沒有 TCP，`mysql2`／`pg` 在裡面不能用）。
- **分析事件**（`design.md` §6.8 的 `events` 表與上報）未做；`profile/sync` 與 `profile/name` 未做。
- **完整名稱驗證**：`sanitiseName` 只做最低限度清洗；§6.4 的完整管線（32 加權單位、NFKC、七層
  關鍵詞摺疊）待做，且必須客戶端與伺服器**共用同一份實作**。

---

## 未發佈 — 本機開發：SQLite ＋ `npm run dev`，以及兩個只在真 SQL 上看得見的缺陷（2026-10-13）

> 使用者原本要的是「`npm run dev` 用 npm 起前端 ＋ 後端 ＋ 一個輕量 MySQL，資料庫檔案放 `.mysql/`」。
> MySQL 那一半**在這個 repo 做不到**：專案路徑含中文（`團圓大作戰`），而 `mysqld` 會在第一個中文字
> 截斷路徑 —— `--initialize-insecure` 寫得進去，啟動時卻讀不到自己的 error log
> （`Could not open file 'E:\hkust_repo\Vocaloid2048.err'` → `[MY-010119] Aborting`），連相對路徑也
> 一樣，而該目錄沒有 8.3 短檔名可用。使用者因此改成 **SQLite**，而這個改動順帶把整合測試從 gated
> 變成一律會跑 —— 於是抓到兩個從來沒被執行過的路徑上的缺陷。

### 新增 — SQLite：第三個方言，只服務本機開發（`api/_lib/db/sqlite.ts`）

- 用 Node 22 內建的 `node:sqlite`，**不加任何相依**。它是一個**檔案**而不是一個服務，所以
  `npm run dev` 與 `npx vitest run` 都不必先起任何東西。
- 這是 `Dialect` 這個接縫**第一次真的被用來加一個方言**：`sqlStore.ts`、`handlers.ts`、
  `runtime.ts`、`limits.ts`、`tokens.ts` 與所有端點檔**一行都沒有動**。改動只有 `DialectName` 多一個
  值、`dialectFromUrl` 認 `sqlite:`／`sqlite3:`、`db/index.ts` 的 `DIALECTS`／`createDriver`／
  `connectionNotesFor` 各多一個分支，加上新檔案本身。`db/index.ts` 的 `createDriver` 由三元改寫成
  `switch`，所以少一個分支會被 `never` 那一行擋下來。
- 它與另外兩個方言只差**三項寫法**：時間存 `integer`（UTC 毫秒）、逐列最大值用 `max(a, b)`（SQLite
  沒有 `greatest`）、現在時刻用 `(strftime('%s','now') * 1000)`（SQLite 沒有 `now()`）。
  反過來，`on conflict … do nothing` 與 `returning` 與 Postgres **同形**，所以它走
  `insertScoreSignal = 'rows'` 那條路，完全不碰 MySQL 的 `affectedRows` / `FOUND_ROWS` 地雷。
  它也有 `nulls last`（3.30 起；Node 22 內建 3.51），不必像 MySQL 那樣用 `best_at is null` 模擬。
- 驅動是**同步**的（`node:sqlite` 沒有非同步 API），所以每個方法只是把同步結果包成 resolved
  promise；交易因此比另外兩個方言簡單（沒有第二條連線、沒有 `begin` 落在別人身上的可能）。三個
  pragma：`foreign_keys = on`（SQLite 預設**不強制**外鍵，而這是一個安靜的失敗）、
  `journal_mode = WAL`、`busy_timeout = 5000`。
- ⚠️ 它**不是**部署選項，而且 `connectionNotes()` 對它永遠回一條警告：函式環境的檔案系統是拋棄式
  的，一個請求寫進去的檔案下一個請求不一定看得到。`docs/backend.md` §5.1.1 有完整說明。

### 新增 — `npm run dev`：一個指令，前端 ＋ 後端 ＋ 資料庫（`scripts/dev.ts`）

- 四件事：補開發用環境變數預設值（**只補沒有設的**，所以 `.env` 永遠優先）、`ensureSchema` 建表、
  用 `node:http` 起 API（`127.0.0.1:8787`，`DEV_API_PORT` 可改）、在同一個行程裡起 Vite 並把 `/api`
  代理到它。客戶端因此**用相對路徑 `/api/…` 就好**，不需要任何 CORS 設定或 `baseURL` 分支。
- **走的是正式環境那一個轉接頭**（`adapters/vercel.ts` 的 `createVercelHandler`），只把 Node 的
  `req`／`res` 交給它 —— 而 Vercel 的 `res` 介面（`statusCode`／`setHeader`／`end`）本來就是
  `node:http` 的 `ServerResponse` 的子集，所以連包裝都不必寫。本機與雲上跑的是**同一條**
  轉接頭 → 外殼 → 處理器 → 儲存層的路徑，只有傳輸層不同。這也比 `vercel dev` 少一個每次連到雲端的
  CLI 與一份 `.vercel/`。
- **路由是掃出來的**：動態載入 `api/**` 底下每一個 `.ts`，用它自己的路徑當路由（`api/run/start.ts`
  → `/api/run/start`），以 `_` 開頭者跳過（Vercel 也這樣排除）。所以**新增端點不必改這個檔案**；
  手抄一份路由表總有一天會出現「本機 404、線上正常」。打錯路徑的 404 會列出所有認得的路徑。
- 資料庫在 `.mysql/endchi.db`，連 WAL 的 `-wal`／`-shm` 一起整個資料夾進 `.gitignore`。要重來一個
  乾淨的資料庫就是刪掉那個資料夾。
- `npm run dev:web` 只起 Vite（純 UI 改動用）。`package.json` 的 `dev` 由 `vite` 改成跑這個腳本。

### 修正 — `scores.device_id` 的外鍵讓兩個正常路徑永遠寫不進去

三個方言的 schema 都把 `scores.device_id` 宣告成 `references profiles (device_id) on delete cascade`，
而那是**錯的**，它會拒絕兩個完全正常的寫入：

1. **新裝置的第一次提交**。`saveScore` 先寫 `scores` 再寫 `profiles` —— 順序不能反，因為「這一局
   是不是新的」是由 `scores` 那一句的結果決定的（冪等）。所以寫入的那一刻還沒有父列。
2. **被退回的提交**。`verified = false` 的局**故意**不建 profile（`design.md` §6.7：留審計痕跡、
   不進榜），所以它永遠沒有父列；有外鍵就等於「拒絕留檔」，而那正是要留的東西。

反過來，那條外鍵**買不到任何東西**：整個程式沒有任何地方刪除 profile，`on delete cascade` 是裝飾品。
所以它不是取捨而是矛盾 —— 三個方言一併移除，`schema.sql` 也一起改（它與程式的逐句一致性由測試守
住）。`tests/dialect.test.ts` 新增一條釘住「三個方言都不可以有 `references profiles`／`foreign key`」。

**為什麼從前沒發現**：這個缺陷在 Postgres 與 MySQL 上都存在，但整合測試是 gated 的、從沒真的跑過。

### 修正 — `scores.created_at` 從來沒有被綁進去（`SqlStore` 與 `MemoryStore` 分歧）

`scores.created_at` 靠 DDL 的預設值（Postgres 的 `now()`、SQLite 的 `strftime`）填，而
`sqlStore.insertScore` 明明收了一個 `atMs`。這一欄同時是**速率限制的視窗**
（`countSubmissionsSince`）、**審計時間**、以及 `getScore` 讀回來的 `atMs`，而 `MemoryStore` 三處都用
呼叫端傳進來的值 —— 於是兩個 `Store` 實作對同一份資料給出不同的答案，而單元測試走的正是
`MemoryStore`，看不到。

修法是把它綁進去（三個方言都多一個佔位符，`sqlStore` 多綁 `this.dialect.ts(row.atMs)`）。
SQLite 那邊還多一層理由：它的 `strftime` 只有**秒**的解析度，靠預設值連精度都與另外兩個方言對不上。
`tests/dialect.test.ts` 新增一條釘住 `insertScore` 的佔位符數**等於 13**（漏一個參數在 Postgres 會
報「參數不足」，在 MySQL／SQLite 卻會把值**錯位**吃進去而不報錯）。

### 變更 — 整合測試不再 gated，改為預設跑記憶體 SQLite

`tests/db.integration.test.ts` 從前只有設了 `TEST_DATABASE_URL` 才跑，理由是「這個 repo 與 CI 不該
為了跑測試而背一個資料庫」。加了 SQLite 之後那個理由消失了，所以預設值改成 **`sqlite::memory:`**，
`describe.skipIf` 與那個「已跳過」的公告區塊一併移除：**這個 suite 現在一律會跑真的 SQL**，而指向真的
Postgres／MySQL 仍然只是一個環境變數的事。記憶體資料庫還多一個好處 —— 每次都是乾淨的。

同一份檔案另外新增一個 `describe`，用獨立的記憶體資料庫驗**這個驅動額外做的三件事**：`pragma
foreign_keys = on` 真的生效（自己建一對父子表來驗，因為我們的 schema 現在沒有外鍵）、交易真的會
回滾、以及交易的巢狀呼叫不會開第二層。

### 測試與驗證

- typecheck ✅、vitest **662 通過 / 0 略過**（33 檔）✅。
- `tests/dialect.test.ts` 32 → **44 條**：每一個迴圈都跑**三個**方言（`DIALECTS` 加入
  `sqliteDialect`），新增 `sqlitePathFromUrl` 的路徑解析（`sqlite:`／`sqlite://`／`sqlite:///`／
  `sqlite://E:/`／`:memory:`／裸路徑）、`max` vs `greatest`、`now()` vs `strftime`、
  `insertScore` 的 13 個佔位符、以及「三個方言都沒有外鍵指向 `profiles`」。
- `tests/db.integration.test.ts` 13 → **16 條，而且不再略過**。**它一改成一律執行就抓到上面兩個
  修正**，兩者都是在真庫上也存在、卻因為 gated 而從來沒被執行過的路徑。
- **本機實測**（`npm run dev` 真的跑起來）：`/api/health` 回 `{"database":"sqlite"}`；
  開局 → 提交（`verified:true`、`rank:1`）→ 同一局重送拿回同一個裁決（`rank:null`）→ 取榜看到
  `durationMs:6200` 與 `self` 名次，**全部經由 Vite 的 5173 代理**；未知路徑回 404 並列出四個端點。

---



> 本節涵蓋 `fd51a19` → `b64cdd9` 共 **13 個 commit**。其中**排行榜身份模型被整組改寫**，
> 取代了下面「排行榜收尾」一節的 `runId`／upsert 描述；該節其餘部分（發布設定抽離成獨立
> 元件、Top 100、日期格式、移除主頁面鍵）**仍然有效**。

### 新增 — 五語訊息層（`src/i18n/`）

- 五個語系：`zh-Hant`（來源）／`zh-Hans`／`yue`／`en`／`ja`。**五份字典的鍵集合必須完全一致**，
  少一個鍵就是 build error —— 缺翻譯要當成漏字處理，不是「暫時沒有」。
- API：`t(key, params)` 取字；`applyTo(root)` 掃五種標記 —— `data-i18n`／`-aria-label`／
  `-title`／`-placeholder`／**`-alt`**。第五種是必要的：作者頭像的替代文字是一整句話，
  必須跟語系走，而 `alt` 沒有現成標記可用。
- **識別碼與 URL 不進字典**：`AUTHOR_NAME`、`SERVER_INVITE`、`Discord`／`GitHub` 品牌字分別是
  模組常數與字面值。字典是「以字串為鍵」的，把識別碼丟進去只會讓同一個東西在不同語系被翻成
  不同名字（那就不是識別碼了）。
- 語系偵測：儲存偏好 → `navigator.languages` → 預設 `zh-Hant`。

### 新增 — 玩家偏好（`src/game/preferences.ts`）

`endchimerge:preferences` 一個 JSON blob 裝三個值：語系、**規則總開關**、**無盡模式**。
規則開關刻意做成「總開關」而非「排行榜開關」：關掉之後連**本機紀錄**都不寫，所以閘門下不會
浮現一段幽靈成績。

### 新增 — 設定彈窗與「?」說明彈窗

- `src/ui/settings.ts`：四分類（規則／無盡／語言／排行榜）。所有改動**即時套用**，沒有儲存鍵。
  名稱欄只在 `change`（失焦或 Enter）才驗證並套用，不是每個 `input` —— 否則每打一個字都會
  觸發一次上載。
- `src/ui/help.ts`：四段（玩法 4 段／緣由 3 段／作者卡／版權 2 段）。作者卡含頭像、署名、
  Discord 與 GitHub 徽章、伺服器邀請連結；對外連結一律 `target="_blank"` ＋
  `rel="noopener noreferrer"`。
- **標籤一律拆成兩個節點**：`applyTo()` 是整個覆寫 `textContent` 的，`SCORE:` 這種
  「標籤＋標點」若和數值同一個節點，重繪會把後面追加的文字節點一起抹掉。
- 版權段使用者原稿寫「方團團**大冒險**」，專案名是「方團團**大作戰**」，統一用後者；
  非中文語系改用官方英文名 `OrbiPom! MERGE!`（中文回譯無來源可考）。

### 新增 — 無盡模式

越過警戒線不再警示、也不會結束該局。閘門位置在**寫入本機紀錄那一點**，而非只在排行出口 ——
本機紀錄就是被上載的那一筆，只檔出口會讓「不記錄」變成單純的「不顯示」。

### 新增 — 方向鍵

`←`／`→` 移動瞄準點、`↓` 投放、`↑` 刻意不做事（它在這個遊戲裡沒有對應動作）。
`keydown` 綁在**畫布**而不是 `window` —— 綁 `window` 的話在名稱欄打空白會順手投下一顆；
代價是開局得先聚焦，所以開場自動 `focus({ preventScroll: true })`。

### 變更 — 排行榜重寫：一位玩家一筆、只升不降

- **身份是 `playerId`（`endchimerge:device-id`），名字只是那一筆的一個欄位。** 改名只改那一筆：
  不新創紀錄，也不再需要「認領無名紀錄」那套補丁。
- 一位玩家每分類最多一筆；三個數值（最高分／最大 COMBO／合成數）**各自取歷史最大**、只升不降
  —— 打得差的一局連時間戳都不動。
- 兩層儲存：`profile`（本機最佳，邊玩邊更新，帶 `revision`）與 `board`（**只有 `sync()` 會寫它**，
  這是日後接後端的接縫）。
- 防竄改（`src/core/integrity.ts` 的 `seal` / `open`）：對**原始 JSON 文字**取摘要而非 parsed
  物件（re-stringify 不是 byte-stable）。模組抬頭明言這只是**門檻、不是防護**：鹽在 bundle 裡，
  真正的反作弊必須在伺服器端（M9）。
- 上載時機：該局結束、重新開始、`pagehide`／`visibilitychange → hidden`、下次開頁若有 pending，
  以及**勾下同意的那一刻** —— 因此 `onPublish` 那一系列鉤子全數移除。
- 空 profile 的時間戳原本是 `0`，改名（會推高 `revision`）後同意會立刻上載出一筆
  `1970/01/01`，改為當下時間。

### 變更 — 榜外名次只報百分比

`capEntries` 原本把自己那一筆跟著裁掉，排到第 101 名時 `self` 變成 `null`，連百分比都算不出來。
現在**無條件保留自己那一筆**（顯示仍只前 100）；`rank > LEADERBOARD_LIMIT` 時改顯示 `selfBeats`
（超越百分比，分母含自己）。

### 修正 — 使用者回報的四項

- **畫布的黃色邊框**：根因是 `.stage__canvas:focus-visible { outline: 3px solid var(--color-accent) }`
  （`--color-accent = #f9ff51`），開局自動聚焦所以一直亮著。**這不是 dev-only** —— 瀏覽器預設
  行為，dev 與 release 完全相同。
- 發布欄位勾／撤同意即套用，儲存鍵移除（欄位版面的內距一併對稱化）。
- 繁／簡中文把「單位」改「字元」（簡中依大陸用語作「字符」）；英文 `MELTING LIST` →
  **`COMPENDIUM`**（圖鑑）。粵語維持既有譯法不動。
- 排版跟隨語系（設計稿自身的標籤也走字典）。

### 修正 — 貼牆長按的隱形溢出

- **症狀**：貼牆長按方向鍵後，按另一邊要連按好幾下才肯動。
- **根因**：輸入層自己記住「上次送出的值」並以它為基準累加，而夾制住在 `GameSession.setAim()`
  —— 輸入層看不到。貼牆時 session 每次把值夾回牆上，輸入層那份副本卻一路往牆外飄（長按 40 次
  ＝ 已飄 800 虛擬單位）。**指標路徑同病**：滑鼠指到畫布外（clientX 5000）也把未夾制的值寫進去。
- **修法**：`DropInputOptions` 的 `initialAim` 換成 `readAim: () => number`，每次按鍵重新問
  「現在瞄準在哪」。輸入層因此不留任何遊戲狀態，夾制（含 resize 造成的重夾）對鍵盤完全透明。

### 測試與驗證

- typecheck ✅、vitest **488/488** ✅、build ✅；開發期間**逐 commit 都單獨驗過**（`git stash`
  確認每個 commit 可獨立通過）。
- 新增 `tests/input.test.ts`（6 條：node 環境用最小替身 target／viewport，不為了跑純函式拉進
  jsdom）、`tests/integrity.test.ts`；`tests/leaderboard.test.ts` 重寫；`tests/session.test.ts`
  補無盡模式 3 條。
- 無頭瀏覽器：新增 `help.mjs`／`labels.mjs`／`locales.mjs`／`record.mjs`／`arrowkeys.mjs`／
  `round4.mjs`／`endless.mjs`；**重寫 `gate.mjs`**（舊版在數筆數，那個模型已經不存在，改成比
  分數）與 `diag-border.mjs`。回歸全部通過。
- 貼牆修正做了**對照實驗**：把舊演算法暫時放回去，單元測試 4 條失敗、瀏覽器上「在牆上按另一邊
  81 → 81（不動）」；修好後 81 → 101（正好一步）。

### 已知未完成

- `public/config/skills.json` 的 `names` 仍缺 `zh-Hans`／`yue`／`ja`（英文取官方名；缺的語系由
  `resolveLocalizedName` 回退 `name`，不會留白）。
- `ja`／`en` 的「字元」用字（`単位`／`units`）尚未定案；簡中「字符」是否改回使用者的「字元」待確認。
- 名稱欄與技能卡聚焦時仍有一圈 accent 外框，尚未定案是否一併移除。

---

## 未發佈 — 排行榜收尾：一局一筆、發布設定獨立、Top 100（2026-10-06 / 10-08）

> ⚠️ 本節的 `runId`／upsert 模型已被上面「排行榜重寫」一節取代：現在一位玩家每分類只有一筆，
> 由 `playerId` 認人，`runId` 不再存在。其餘內容仍有效。

### 修正 — 「勾了同意、按了儲存，成績卻沒上榜」

儲存處理程式**先**呼叫 `setDisplayName()`，而它會**同步**觸發 `notify → render()`；重繪把
「同意分享」的勾選狀態重設回來源裡的值（仍是未勾選），緊接著的 `setSharing()` 讀到的就是
那個被蓋掉的值 —— 分享永遠開不起來，榜因此永遠是空的。修法兩件：

- 先把兩個輸入框的值抓成區域變數再動來源，`setSharing()` 與發布判斷都讀那份副本。
- 欄位只在宿主**開啟時**才同步回來源；由來源變更引發的重繪不再同步（同時修掉「勾好同意後
  切換分頁就掉勾」）。

### 變更 — 一局只佔一筆，且每個出口都記（使用者的試玩回報）

一局會在多處結束：自然溢出、按重新開始、關掉分頁、切到背景、以及按下儲存的那一刻。以前只
在前兩者記錄，關分頁的一局就永遠消失；重複記又會變成兩筆。

- `LeaderboardRun.runId` 讓 `record()` 成為 **upsert**：同一局記幾次都只佔一筆，後記的數值
  覆蓋先記的。
- `src/main.ts`：每局一個 `runId`（重新開始時換新），記錄出口由 2 個增為 5 個
  （`pagehide`、`visibilitychange → hidden` 補上）。
- `setDisplayName()` 會**認領先前空名的紀錄**：名稱是在榜上才問的，先玩後命名是常態，
  不認領的話玩家只會看到一片「（未命名）」而以為紀錄不見了。已有名字的不動。

### 變更 — 發布設定抽成獨立元件，只在首次開榜時問一次

使用者定案：顯示名稱與「同意分享」是**玩家設定**，不是榜單內容。

- 新增 `src/ui/publishFields.ts` ＋ `src/styles/publish-fields.css`：名稱欄（儲存鍵內嵌、
  貼右緣、寬度貼合文字）＋ 單位計數 ＋ 同意勾選 ＋ D10 驗證錯誤訊息。兩處宿主共用
  （首次詢問、日後的設定 popup）。
- 新增 `src/ui/publishPrompt.ts` ＋ `src/styles/publish-prompt.css`：首次的發布詢問。
  `LeaderboardSource` 增 `publishPromptDone` / `finishPublishPrompt()`（新儲存鍵
  `endchimerge:publish-prompt`）。**儲存、之後再說、Esc、點背景都算問過了** —— 否則關掉一次
  之後每次開榜都會再彈，就不是「首次」了。儲存後自動接著開榜。
- `src/ui/leaderboard.ts` 不再內嵌任何輸入框：看榜就是看榜。

### 變更 — 榜面（使用者定案）

- 日期時間改為 **`YYYY/MM/DD HH:mm`**（榜是全時段的，`MM-DD` 跨年會混在一起）。
- 每一列**不再重複顯示「XXXX 分」**：分數是「最高分數」分頁的主要數值，在另外兩個分頁它
  只是附帶資訊，每列都掛一串反而讓真正的排序依據失焦。
- **Top 10 → Top 100**：`LEADERBOARD_LIMIT = 100`，儲存保留每類前 100 名的聯集（≤300 筆）；
  榜身自帶 `max-height` 才會滾動（卡片的 `max-height` 只裁切、不會叫內容變矮）。

### 移除 — 工具列的「主頁面」鍵（`ic_game`）

排行榜、說明與設定都是模態，遊戲本體永遠在下面，一顆切回本體的按鈕無事可做。移除後工具列
回到設計稿的五顆鈕（`toolGroup` x 1262、寬 450），與音樂鍵維持原設計的 48px 間距；
`public/assets/ui/ic_game.svg` 一併刪除。

### 驗證

typecheck ✅、vitest **420/420** ✅（`tests/leaderboard.test.ts` 由 28 條增至 33 條）、build ✅。
另以無頭瀏覽器實測：工具列五顆且無 `home`、首次按獎盃出現詢問（榜未開）、儲存後詢問關閉並
自動開榜且「阿爺」上榜、第二次按下直接開榜、灌 105 筆得 100 列且可捲動、日期格式正確、
婉拒路徑（之後再說）下次不再詢問。

---

## 未發佈 — 排行榜（本地階段，2026-10-06）

> 這一節記錄當時的交付；**Top 10、發布列、每列顯示分數**三項已在上一節被取代。
> This section records what shipped then; **Top 10, the publish bar and the per-row score** were
> superseded in the section above.

### 新增 — 工具列獎盃鍵的排行榜彈窗

使用者定案：排行榜做**模態 popup**，不做獨立頁面。榜單最終要接真後端（Docker 的 Postgres
container，或 Vercel 支援的後端＋微資料庫；騰訊雲再後），所以**資料層先抽成可替換介面**，
現階段以本地實作落地。

- `src/game/leaderboard.ts`：`LeaderboardSource` 介面 ＋ `createLocalLeaderboard()`。落實使用者
  定案的四件事 —— **全時段單一榜**、**三個分類分頁**（最高分數／COMBO 數／合成數，是同一批
  紀錄的三種排序鍵）、**Top 10 每局都記**、**同意分享後才上榜**（全域開關）。儲存保留
  **每個分類各自前十名的聯集**（≤30 筆）：只按分數裁切，COMBO／合成分頁會從一開始就偏斜。
- `src/game/playerName.ts`：依 `design.md` D10 的顯示名驗證 —— NFKC 正規化、剔除零寬與控制
  字元、字元白名單（CJK 含擴充 A、拉丁、數字、空白、`_` `-` `.`）、加權長度上限 32 單位
  （CJK 2、其餘 1 → 純中文 16 字、純英文 32 字）。**D10 的關鍵詞過濾層刻意留待後端階段**：
  本地單人看不到其他玩家，本機過濾對任何人都不起作用，且它應與伺服器端驗證一起做，避免
  兩份清單各自漂移。
- `src/game/session.ts`：新增 `maxCombo`（這一局連勝的**峰值**）。榜單的 COMBO 分類讀它，
  而不是 `comboCount` —— 後者是當下串長，斷連歸零後會把「曾經 20 連」記成 0。
- `src/ui/leaderboard.ts` ＋ `src/styles/leaderboard.css`：彈窗本體（三分頁、名次／名稱／
  該分類數值／分數／日期、自己的最佳與百分位）；上方「發布列」在首次開啟時請玩家輸入顯示名
  並勾選是否分享，儲存後即時反映在榜上（未勾選則榜為空，仍可唯讀瀏覽）。
- `src/main.ts`：獎盃鍵（`data-action="leaderboard"`）開啟彈窗；一局結束（自然結束或玩家按
  重新開始）時記錄一次 —— `runRecorded` 保證不重複，0 分 0 合成的誤按不記。
- **百分位在此階段是「超越你自己 X% 的場次」**：真·跨玩家百分位需要伺服器，本地做不到。
  `LeaderboardRank.percentile` 這個欄位已預留位置，接上真後端後改由伺服器回傳真值，UI 文案
  同步更新即可。
- 驗證：typecheck ✅、vitest **410/410**（新增 `tests/leaderboard.test.ts` 23 條，另在
  `session.test.ts` 補兩條峰值測試）、build ✅。

---

## 未發佈 — 重新開始鍵改為確認對話框（使用者定案，2026-10-06）

### 變更 — 「再按一次同一顆鈕」改為模態確認

工具列的重新開始鍵原本靠**再按一次同一顆鈕**確認（第一次按下整顆轉紅、進入三秒確認窗，
逾時自動退回）。使用者定案改為**按下即彈出確認對話框**，二次按鈕整個移除。

- 新增 `src/ui/confirmDialog.ts`：可重用的模態確認框（標題／說明／取消／確認，確認鈕語氣
  可選 danger／accent）。`role="dialog"` ＋ `aria-modal="true"`、Esc 與點擊暗色背景皆為
  取消、Tab 焦點循環鎖在框內、關閉後焦點還原。開啟時焦點預設落在**取消** ——
  破壞性動作不該一按 Enter 就成立。
- `src/ui/restartButton.ts` 重寫：只負責把工具列按鈕接到對話框，確認後呼叫同一條
  `restartRun`（與結算覆蓋層的「再玩一次」共用同一條路徑）。
- 新增 `src/styles/confirm-dialog.css`（於 `styles/main.css` 匯入），沿用 `game-over.css`
  的設計稿像素與玻璃配方；移除已無用的 `.toolbar__button--confirm` 樣式與 `ui/layout.ts`
  的舊「雙重確認」註解。
- 結算覆蓋層的「再玩一次」維持不變：那一局已經結束，沒有進行中的東西可丟。

---

## 未發佈 — COMBO 曲線第三版（使用者定案，2026-10-06）

### 變更 — 倍率公式改為緩和曲線、小數兩位

倍率由 `min(e^(0.25n)/10, 9) + 1`（M5 版，上升太急：`n = 12` 就 ×3）改為：

```
comboMultiplier(n) = round2( min( e^(0.075n) / 1.5 − 1/1.5, 9 ) + 1 )
```

- 使用者示例即驗收：`n = 25 → ×4.68`、`n = 10 → ×1.74`。
- `×1.30` 在 `n = 5`，×10.00 天花板由 `n = 36` 起生效（`e^2.7/1.5 − 1/1.5 ≈ 9.25 ≥ 9`）。
- 倍率四捨五入到**小數兩位**（`COMBO_CURVE.decimals`），HUD 顯示與計分共用同一個值。
- `src/ui/hud.ts`：修正一處錯誤的顯示換算 —— 舊碼把 `comboMultiplier` 的結果**又套了一次**
  指數曲線（`e^(0.075·m)/1.5 − 1/1.5 + 1`）再取整，畫面上的倍率因此與實際計分不符；
  現在直接顯示 `toFixed(2)`。
- `src/game/combo.ts`（`COMBO_CURVE`）、`tests/combo.test.ts`（示例與封頂點重釘）、
  `README.md` / `README-en.md` / `docs/gameplay.md` 同步更新。

---

## 未發佈 — `feat-skill-feature`（M5 技力與技能）

分支關係：`dev` → `feat-skill-feature`。技能欄、技力計與四項技能全部落地，**M5 至此完成**。
本節同時**取代**前一節的兩處已知缺口：`skills.json` 的 `fate_swap` 死鎖（見下）與「SKILL LIST 為空」。
技能上線後使用者試玩回報的三個問題（移除支撐不掉、浮動只有局部、搖晃顆粒不跟）同屬本節，
見「修正 — 技能看不到物理反應」。

### 變更 — 技力經濟重定義（使用者定案）

舊草案（`plan.md` v4.0）寫「每次放入球 +1.0、上限 3.0、每個技能固定消耗 1.0、3 個技能」，
與 `design.md` v1.1 ＋ `skills.json` ＋ README 的「消耗由 JSON 定義、4 個技能」互相矛盾。
使用者於 2026-10-06 定案，以**後者**為準，數值如下：

```
投放  +sp.gainPerDrop（0.05）      合成  +sp.gainPerCombo（0.05）
上限  sp.max：預設 3，只接受 1–10 的正整數（硬上限 SP_MAX_CEILING = 10）
解鎖  依「當前值 ≥ 技能需要的技力」動態判斷；花掉立刻上鎖
消耗  由 skills.json 定義（當棄即棄！=1／協議：浮動=2／搖晃！=3／命運互換=0）
扣費  效果**成功執行**時才扣；選取中不扣、取消不退
```

- `src/core/constants.ts`：`SP_MAX_CEILING` 由 **5 改為 10**；新增 `SP_MIN = 1`、
  `SP_DEFAULT_MAX = 3`，以及技能的兩個護欄 `SHAKE_RADIUS_FACTOR_MAX`（1/3）與
  `FLOAT_OVERFLOW_BUFFER_MS`（500）、`SHAKE_MAX_BODY_SPEED`（12）；並把 Matter 的重力縮放
  提為 `ENGINE_GRAVITY_SCALE`（**浮動要把重力翻成負值，必須能一致地改寫它**）。
- `src/core/types.ts`：`SpSettings` 新增 `gainPerCombo`；新增
  `SkillUnlock = { kind: 'sp' } | { kind: 'cumulativeSpent'; threshold }`；
  `SkillParams` 由 `forceY` / `impulse` 改為 `liftFactor` / `revolutions` / `radiusFactor`。
- `public/config/skills.json`：全面重寫為 `sp` ＋ `skills[]` 結構（見下方「技能」）。

### 新增 — `SpResource`：技力計數器

`src/game/sp.ts`。**只是一個有上限、會累加、上限可臨時覆寫的計數器**，不含任何玩法規則
（它不知道有哪些技能）。供應 `gainForDrop()` / `gainForCombo()` / `canAfford()` /
`spend()` / `setMaxOverride()` / `resetSpent()` / `reset()`。

- **`spend()` 先問再扣**：付不起就**完全不動狀態**並回 `false`，呼叫端因此不會留下半扣的狀態。
  成功時同步累加**累計消耗**（供「命運互換」解鎖）。
- **`setMaxOverride(value | null)`**：技能滿足條件時可臨時加減上限。指定值鉗制在
  `[0, SP_MAX_CEILING]`；上限被調低時目前值也跟著夾下來，否則畫面會出現「第 4 條滿的、
  但上限只有 3」的矛盾。

### 新增 — 技能：`Skill` 抽象基底 ＋ 4 個子類別 ＋ registry

使用者定案要把技能拆成**各自一個 class 檔、繼承同一個抽象基底、放同一個資料夾**
（`src/game/skills/`）：

- `Skill.ts`：抽象基底。持有 `SkillDef`，對外暴露 `id / name / cost / targeting / unlock /
  pickCount / params / requiresTargets / durationMs`，並宣告 `apply(board, targets)`。
- `DiscardSkill.ts`（當棄即棄！）：`board.removeTarget(targets[0].id)`；目標已消失則 no-op。
  目標與其餘顆粒的「落下」是物理的事 —— 但前提是它們**醒着**，那由 `GameSession` 負責（見下）。
- `FloatSkill.ts`（協議：浮動）：`board.floatAll({ durationMs, liftFactor })`。
- `ShakeSkill.ts`（搖晃！）：把半徑比例**鉗到 `SHAKE_RADIUS_FACTOR_MAX`**、圈數至少 1、
  擺動軸傾角鉗到 60°、向上力鉗到水平衝量的一半，再 `board.shakeContainer(...)`。
- `FateSwapSkill.ts`（命運互換）：要求**兩個相異目標**，否則不作用；成功才
  `board.swapTargets(a, b, disturbance)`。
- `index.ts`：`SKILL_CLASSES` 對照表 ＋ `hasSkillImplementation()` / `createSkill()` /
  `createSkills()`。`skills.json` 的 id 對不上任何 class 時**略過並警告**，不是丟例外。
- `board.ts`：**`SkillBoard` 窄介面** —— `targets` / `removeTarget` / `swapTargets` /
  `floatAll` / `shakeContainer` / `overflowLineY` / `containerWidth`。技能只透過它作用於棋盤，
  **不得**直接碰 Matter.js 或 `GameSession` 的其他方法；`GameSession` 是唯一實作者。

### 變更 — 技能順序與解鎖的配置驗證

`src/core/configLoader.ts`：

- `sanitizeSp()` 把 `sp.max` **四捨五入並鉗進 `[SP_MIN, SP_MAX_CEILING]`**，任何修正都發警告；
  `Math.round(3.5) → 4`。
- `sanitizeUnlock()` 解析新的解鎖欄位；缺欄位時預設 `{ kind: 'sp' }`。
- `sortSkills()`：**先按消耗遞增；`unlock.kind !== 'sp'` 的技能一律殿後**（可用 `sortOrder` 覆寫）。
  所以欄位順序穩定為 當棄即棄 → 協議：浮動 → 搖晃！ → 命運互換。
- `checkSkillUnlockability()` 只對 `kind === 'sp'` 的技能檢查「消耗 > 硬上限」；
  `checkFreeSkillCost()` 對**免費（cost 0）卻同時以技力解鎖**的技能發警告 —— 那會是
  永遠按不下去的死格。

### 新增 — 命運互換：以「累計消耗」解鎖的免費技能

原先 `fate_swap` 消耗 4 技力、`sp.max` 只有 3，**永遠無法解鎖**（前一節已知缺口）。
使用者定案改為：

- **免費**（`cost: 0`），改以 `unlock: { kind: 'cumulativeSpent', threshold: 6 }` 解鎖 ——
  本局累計消耗滿 6 點技力後才可用。
- **用完累計歸零、重新上鎖**（`sp.resetSpent()`）。`resetSpent()` 只清累計，**不動**目前值與
  臨時上限，否則會把玩家剩下的技力一起抹掉。

### 新增 — 技力與技能接上 `GameSession`

`src/game/session.ts` 改動最大（`implements SkillBoard`）：

- **投放**與**合成**兩條路徑分別呼叫 `sp.gainForDrop()` / `sp.gainForCombo()`。
- `activateSkill(id)` / `cancelSkill()` / `canvasPointerAction()` / `pickTargetAt()`：
  需要選目標的技能進入**選取模式**，即時技能立刻生效。
  - **再按同一格 ＝ 取消**：這個判斷必須排在「技能忙碌就拒絕」**之前**，否則選取模式一開，
    同一個鍵就再也按不動，玩家只能靠 Esc 或點空白處退出（`design.md` §5.5）。
  - **點空白處或再點同一顆**也取消；點到第 `pickCount` 顆立刻作用。
  - 場上沒有方團團時**一律不受理**任何技能，免得白白扣技力。
- **技能作用期間禁止投放**：`canDrop` 增加 `!isSkillBusy`（＝選取中、浮動中或搖晃中）。
  規則只在這**一處**成立，滑鼠／鍵盤／觸控都無法繞過。
- **浮動**：把重力翻成向上的淨加速度（`gravityY × (1 − liftFactor)`），並在容器頂緣**下方**
  `floatCeilingBelowRim`（20）處放一片**隱形靜態平面**當天花板 —— 使用者要的「像杯口被壓住」。
  施放時另做**一次** `clampFloatCeiling()`，把已經在平面之上的顆粒先壓回下方（否則它們卡在
  平面內部，會被求解器從最近的出口擠出容器）。平面是**靜態**剛體，`removeDynamicBodies()`
  帶不走，所以 `reset()` 必須顯式移除它。

  > **註（後續已一般化）**：這片天花板之後**浮動與搖晃共用**（使用者：「搖晃那邊也添加跟浮動
  > 一樣的透明平面」）。`clampFloatCeiling()` 更名為 `clampCeiling()`，建立／移除改由單一開關
  > `ceilingNeeded`（浮動中或搖晃中）決定。`container.json` 的欄位名**仍是**
  > `floatCeilingBelowRim`（只有一個旋鈕）。此外容器左右各加了 `leftOffset`／`rightOffset`
  > 展示餘裕（預設 50），同時解決「搖晃時邊界與方團團被切掉」。
- **浮動期間不判溢位**：`updateOverflow()` 直接跳過（連計時器都不推進，**凍結而非歸零**），
  結束後再等 `FLOAT_OVERFLOW_BUFFER_MS`（0.5s）才恢復。天花板本來就在溢位線之下，所以浮動
  期間的上緣不可能觸發溢位判定。
- **搖晃＝地震**：容器沿一條與水平成 `axisTiltDeg`（15°）的斜線往復（`sin(πt)` 包絡，起訖皆為
  0，不會在開始／結束瞬間「跳」一下），位移疊在 `containerGeometry` 上（連帶溢位線、警戒區、
  裁切範圍一起走），並以 `Body.translate` 的**差量**搬動靜態牆壁。
  - **牆只是畫面**：牆是靜態剛體，`translate` 不帶速度，而 `Sleeping.afterCollisions` 對
    「靜態 vs 休眠」直接 `continue` —— 牆掃過去連叫醒都做不到。真正讓顆粒動起來的是
    `applyShakeImpulse()`：每步對每一顆施加慣性力，量值取自容器自己的加速度
    （`Δv = A·ω²·sin(ωt)·Δt²`），再乘 `SHAKE_BODY_ACCEL_COUPLING`（0.3）折算成手感，
    另有 `upwardFactor`（10%）的持續向上托力。
  - 使用者給的幅度（2 秒 5 圈、半徑最多 1/3 容器寬）**照字面跑會把整箱甩飛、甚至穿透薄牆**，
    因此有 `SHAKE_MAX_BODY_SPEED`（12）作為穩定性護欄：最壞情況是「被搖得很厲害」而不是「炸開」。
- `reset()`：清空技力、選取、浮動／搖晃狀態並**還原重力**（上一局可能在浮動中結束，
  不還原會讓新的一局一開始就反重力）。

### 修正 — 技能看不到物理反應（休眠剛體從未被喚醒）

使用者回報三個症狀，根因是同一個：**Matter 開了休眠，而引擎對休眠剛體是完全跳過的**。

`ENGINE_ENABLE_SLEEPING` 為 `true`，而 `Engine._bodiesApplyGravity` 與 `Engine._bodiesUpdate`
都是 `if (body.isStatic || body.isSleeping) continue;`；喚醒只發生在
`Sleeping.afterCollisions`，而它只認「被一顆 `motion` 夠大的**移動**物體撞到」，而且開頭就
`if (bodyA.isStatic || bodyB.isStatic) continue;`。

| 症狀 | 原因 |
|---|---|
| 移除一顆後，本來壓在它上面的方團團**懸空不掉** | 移除支撐**不產生碰撞事件**，那一疊永遠醒不過來 |
| 浮動**只有局部**浮起 | 重力翻了，但休眠顆粒收不到重力，只有剛動過的會浮 |
| 搖晃時顆粒**完全不跟** | 牆是**靜態**剛體，上述 `continue` 讓「靜態 vs 休眠」永遠不喚醒 |

修法是 `GameSession.wakeAll()`，在技能真正碰到棋盤時把全部顆粒叫醒：`removeTarget()` 移除後、
`swapTargets()` 交換後、`shakeContainer()` 開始時，以及浮動／搖晃進行中的每一步。成本是 O(n)
一次（n 是幾十），可忽略 —— 相對地，「每顆掛一個每幀觸發的 listener」既貴（每幀 O(n) 個回呼
＋ closure 配置）又**修不好這個問題**，因為物理本來每步就在跑。

同步改掉兩個「指令有下、物理沒跟上」的地方：搖晃不再只搬牆（改為對顆粒施加慣性力），浮動不再
只靠每步傳送壓回（改為實體天花板平面）。

### 新增 — 技能卡 UI 與畫布選取標示

- `src/ui/skillBar.ts`：技能欄（每行 3 格；第 4 個技能因此落在第二行第一格）。
  卡片＝**圓圈框住的圖示 ＋ 名稱 ＋ 貼齊右緣的徽章**（比照使用者提供的參考圖），累計消耗型
  技能在名稱下方多一行說明；未解鎖時**整張卡**被一層不透明灰遮罩蓋住，遮罩中間顯示解鎖進度
  百分比。可不可以按**完全由 `GameSession` 決定**（只有它看得到技力與累計消耗），這個模組
  只負責畫與回報 id。以**簽名比對**決定要不要動 DOM（每幀呼叫）。
  - **徽章顯示什麼由 `unlockKind` 決定**：收費技能顯示消耗數字（字級加大），累計消耗型技能
    顯示 `n/m` 進度並在下方標明「累計使用技力」。`SkillCardState` 因此多帶
    `unlockKind / cumulativeSpent / unlockThreshold`。
- `src/ui/icons.ts`：新增 `discard` / `float` / `shake` / `fateSwap` 四個圖示；
  造型刻意彼此差很遠，小尺寸下也分得出來。
- `src/render/stage.ts`：`SELECTION_STYLE` ＋ `drawSelectionBracket()` 畫「」角括號 ＋
  加粗外框，**第 1 顆白色、第 2 顆琥珀金**（`--color-accent`，與技力條同色）。
  標示的幾何完全由半徑推導，**不得位移剛體**；脈動只改透明度。畫在**遊戲區裁切之外**，
  貼邊的那一顆才不會被切掉半個括號。
- `src/game/loop.ts`：`selectionPulse = 0.5 + 0.5 × sin(nowMs / 450)`（週期約 900ms），
  由時鐘推導，渲染器不存狀態。
- `src/core/input.ts`：`onDrop` 改為 `(point: VirtualPoint | null) => void`（`null` ＝ 鍵盤，
  照目前瞄準點投放），新增 `onCancel`（`Esc`）取消選取。
- `src/styles/layout.css`：`.skill-card` 系列；卡片圓角 32（使用者定案的「edge round 32dp」），
  徽章貼右時的外側兩角就是靠這個圓角 ＋ `overflow: hidden` 裁出來的。`.skill-grid` 加
  `overflow-x: hidden` ＋ `scrollbar-gutter: stable` —— 三欄 120 ＋ 欄距 16 剛好 392 對上
  393 的內容區，一旦瀏覽器為垂直捲軸留寬就會冒出橫向捲軸（使用者定案：**只准垂直捲動**）。

### 修正 — `reset()` 之後容器會歪掉

`reset()` 把 `shakeOffset` 歸零，卻留下 `appliedShake`（「已經套到牆上的位移」）。
上一局若在搖晃中結束，下一步就會拿「0 − 舊位移」當差量**再把牆推一次**，
容器從此歪掉、再也回不去。修法是歸零後呼叫 `applyShakeToWalls()`，把差量補回來。

### 新增 — 展示餘裕、共用的技能天花板與寬限對齊（使用者試玩回報）

使用者試玩後的三點指示：①溢位寬限對齊 `5000ms`（**現行設計正確、不動**）；②搖晃也要蓋
一片跟浮動一樣的透明平面；③搖晃時容器左右要有**允許展示的空間**，否則邊界與方團團會被切掉。

- **溢位寬限統一為 5000ms —— 只改文檔，不改程式。** `levels.json` 與 `configLoader` 的預設
  **本來就是** `5000`，落後的是面向使用者的文件（README／`gameplay.md`／`rendering.md` 仍寫
  `3000`）。歷史記述一律**加註**而非改寫（見上一節與本節各處的「註（後續已…）」）。
- **展示餘裕 `leftOffset` / `rightOffset`（`container.json`，預設 50）。** 容器**寬度不變**：
  畫布的虛擬寬度同步加寬兩者的和，`computeContainerGeometry()` 再把外框內縮同一個量，兩者
  相抵，**物理可玩寬度與從前逐單位相同**。餘裕有兩個用途：
  - **給搖晃**：搖晃的水平分量被夾在「餘裕 ÷ |cos(傾角)|」之內（`GameSession.shakeContainer()`），
    容器滑到兩端時外框仍在畫布內、邊線不被切。
  - **給繪製**：`ContainerGeometry` 新增 `display`（＝外框 ＋ 兩側餘裕），`clipToPlayField()`
    改讀它。裁切範圍**不隨外框晃動**，所以貼牆的方團團不會被裁掉半邊。設計圖左右各有約
    128px 的板間空隙，50 個虛擬單位（≈41 設計 px）塞得下。
- **技能天花板改為浮動與搖晃共用。** 兩者要的是同一件事（把顆粒封在容器口以下），所以
  `container.json` **只有一個旋鈕**（欄位名仍是 `floatCeilingBelowRim`）、`session.ts` 只有
  一個開關 `ceilingNeeded`（＝浮動中或搖晃中）、一片平面橫跨 `display`。內部成員隨之更名
  （`floatCeilingBody`→`ceilingBody`、`clampFloatCeiling()`→`clampCeiling()`、
  `FLOAT_CEILING_THICKNESS`→`CEILING_THICKNESS`）。**兩個旋鈕只會造出兩份日後各走各的副本。**
  - **回歸證明**：把方向力開到最大時，最高上緣 `99.93`（天花板 `100`）；拿掉平面則衝到
    `-114`（越線 164 單位）。平面在重力 `0.2` 時確實把顆粒釘住，移除後 240 幀內落回 `y ≈ 954`。
- **連擊曲線：不動。** 使用者的問題（`COMBO=14 → ×4.3`）與現行公式
  `min(e^(0.25n)/10, 9) + 1` 相符（`n=14 → e^3.5/10 + 1 ≈ 4.31`），`n=18` 觸頂 ×10.0；
  文件中原先殘留的 `coefficient 0.075`（`n=60` 才觸頂）已更正為 `0.25`。**玩法數值未變。**

### 新增 — 測試

- `tests/sp.test.ts`（12 條）：累積、上限鉗制、`setMaxOverride`、`canAfford` / `spend`
  的邊界（付不起時不得改動任何狀態）、累計消耗與 `resetSpent()`。
- `tests/skills.test.ts`（15 條）：以 `FakeBoard` 驗證四個子類別的契約
  （移除目標、翻重力參數、半徑鉗制、需兩個相異目標，以及搖晃的傾角／向上力預設與鉗制）。
- `tests/sessionSkills.test.ts`（10 條）：**整合層**的行為測試，每一條都先讓堆疊**睡着**再施放，
  所以「沒有喚醒」的實作一定失敗（已驗證：拿掉 `wakeAll()` 會紅 3 條）。涵蓋移除支撐後上層
  落下、浮動抬升已入睡的顆粒、浮動停在頂緣下方的天花板、`reset()` 不留下那片隱形平面、
  地震甩動睡着的顆粒，以及累計消耗的解鎖資訊有傳到卡片。
  後四條針對**搖晃的天花板與幅度鉗制**：方向力最大時上緣不得越線（最高 `99.93` vs 天花板
  `100`，於重力 `0.2` 下量測，因為重力 `1` 時顆粒根本升不到平面、斷言分不出平面在不在）、
  搖晃結束後平面確實移除、搖晃的水平偏移被夾在 `leftOffset` 內、以及搖晃中途 `reset()` 不留殘骸。
  （已逐條驗證會抓到回歸：拿掉搖晃天花板紅 2 條、拿掉幅度鉗制紅 1 條。）
- `tests/container.test.ts`：新增 4 條幾何測試 —— 外框內縮而 `display` 仍是整張畫布、餘裕為 0、
  負值退化為 0、單邊餘裕達 40% 上限（500 寬畫布 → `frame.x = 200`、`frame.width = 100`）；
  另有一條「外框被搖動時 `display` 不動」的裁切測試。
- `tests/configLoader.test.ts`：新增 5 條（鉗到 10 並警告、7 靜默接受、3.5 → 4 並警告、
  `cumulativeSpent` 解析與排序、免費技能又收費時警告），取代原本的「鉗到 5」。
- 全套 374 條通過；`npm run build` 無錯誤。

---

## 未發佈 — `feat-drop-feature`（M4 合成核心 ＋ M6 解鎖與圖鑑 ＋ 輪廓碰撞）

分支關係：`feat-ui-init` → `dev` → `feat-drop-feature`。M5（技力與技能）在**本分支**依使用者指示
**跳過**，不在本節範圍（M5 已於後續的 `feat-skill-feature` 補上，見上一節）；M6 不依賴 M5。
`feat-drop-feature` 額外收錄兩項玩法修正：
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

> **註（後續已上調）**：`coefficient` 之後由 `0.075` 調到 **`0.25`**，曲線快得多、天花板
> 也提前到 `n = 18`。現行公式為 `comboMultiplier(n) = min(e^(0.25 × n) / 10, 9) + 1`；
> 以現行值：`n = 4 → ×1.3`、`n = 14 → ×4.3`、`n = 18 → ×10.0`。此段保留當時的 0.075 作為
> 歷史紀錄。

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

> **註（後續已統一）**：`overflowGraceMs` 之後統一為 **5000ms**（`levels.json` 與
> `configLoader` 的預設皆為 5000）。此段保留當時的 3000ms 作為歷史紀錄。

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

- ~~**M5（技力與技能）依使用者指示跳過**：SKILL LIST 仍為空；`skills.json` 的 `fate_swap`
  消耗 4 技力但 `sp.max` 只有 3，該技能永遠無法解鎖。~~
  **已由 `feat-skill-feature` 解決**（見上一節）：技能欄與四項技能全部落地；
  `fate_swap` 改為免費、以累計消耗 6 點解鎖。
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
- ~~**`skills.json` 的 `fate_swap` 消耗 4 技力，但 `sp.max` 只有 3**，該技能永遠無法解鎖。
  載入時會發出警告，屬內容設定問題，待 M5 一併處理。~~
  **已由 M5 解決**（`feat-skill-feature`）：`fate_swap` 改為免費技能，
  以「累計消耗滿 6 點技力」解鎖、用後累計歸零。
- ~~**溢出規則**（`maxBodies`、`overflowPenalty`、溢出時長）依 `design.md` §10 尚未定案。~~
  **已由 M4 定案**（見上一節）：溢位線相對容器頂緣 30、寬限 3000ms（後統一為 5000ms）、只看「已進槽」的顆粒。
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
| M4 | 合成核心、冷卻、Combo、彈跳動畫 | ✅ 已完成（見 `feat-drop-feature` 一節） |
| M5 | 技力與技能（含點選選取、「」括號） | ✅ 已完成（見第一節，`feat-skill-feature`） |
| M6 | 解鎖系統、`???`、圖鑑 | ✅ 已完成（見 `feat-drop-feature` 一節） |
| M8 | 排行榜與用戶名驗證 | ✅ 已完成（見「排行榜重寫」一節）<sup>[1]</sup> |
| M7 | 本地存檔與後端同步 | 🚧 進行中（分支 `feat-backend`；後端已存在，**客戶端尚未接上** —— `sync()` 是接縫） |
| M9 | 分析事件、反作弊檢查 | 🚧 進行中（**反作弊 T2 已交付**：憑證 ＋ 時間 ＋ 合理性 ＋ 速率 ＋ 接收紀錄；**分析事件未做**） |
| M10 | 部署、音效、無障礙 | ⏳ 待辦 |

> [1] **M8 的範圍（使用者定案，2026-10-12）**：身份（`playerId`，改名不新創）、名稱長度驗證
> （32 加權單位）、三個分類分頁、Top 100、日期格式、榜外百分比皆已完成。
> **不採納每日／每週榜期分頁** —— 維持單一全時段榜，`design.md` §6.5 原本的 `period` 過濾連帶
> 不實作（§6.5／§6.6 已同步修訂），因此 M7 的 `/api/leaderboard` 只需 `limit`。
>
> M6 不依賴 M5，所以 M5 的完成順序不影響圖鑑與解鎖。M7 會接手目前由 `game/progress.ts`
> 獨力承擔的本地存檔（`endchimerge:unlocks` / `endchimerge:high-score`），以及
> `game/leaderboard.ts` 的 `profile` / `board` 兩層儲存。
