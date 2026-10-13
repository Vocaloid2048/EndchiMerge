# 後端

這份文件說明 M9 交付的後端：它由什麼組成、怎麼設定、部署到哪裡，以及**資料庫可以放哪裡** ——
最後一項是使用者明確問的三個問題，答案在「§4 資料庫放哪裡」。

> **範圍**：M9 = 分析事件 ＋ 反作弊檢查（`design.md` §8）。反作弊只做 **T2**（伺服器頒發的短期
> 憑證），不做 T1 對稱簽章、也不做 T3 伺服器端重放 —— 這是使用者的定案。

---

## 1. 現況

後端是**四個端點**，跑在 Vercel Functions 上，資料庫是**任何 Postgres、MySQL 或（本機）SQLite**。

| Method | Path                | 用途                                                       |
| ------ | ------------------- | -------------------------------------------------------- |
| `POST` | `/api/run/start`    | 開一局：伺服器鑄一張短期憑證（T2 的關鍵）                                   |
| `POST` | `/api/score`        | 提交成績：驗憑證 → 驗時間 → 驗合理性 → 寫榜                                |
| `GET`  | `/api/leaderboard`  | 取榜（`?category=score\|combo\|merges`、`?limit=N`，預設 100、上限 200），附查詢者的自身名次   |
| `GET`  | `/api/health`       | 自我檢查：**真的問一次資料庫**，回方言名稱與玩家數                                |

**資料庫支援 Postgres、MySQL 與 SQLite 三種方言**，共用同一份業務邏輯 —— 見 §5。前兩者是**部署**選項
（Vercel 走 Neon、騰訊走 MySQL），SQLite 只服務**本機開發**，因為它是一個檔案而不是一個服務（見 §5.1.1）。

**架構不變**（`design.md` §6.1）：local-first。遊玩中只寫本地，破紀錄時非同步推送；開局載入時拉
伺服器 profile 合併。

**客戶端已經接上**（見 §6.6）：`src/game/remoteLeaderboard.ts` 是走 HTTP 的那一個
`LeaderboardSource`，`src/game/leaderboard.ts` 的本機實作留著當離線／無後端的退路，兩者共用同一份
本機紀錄邏輯。所以榜上現在真的會有別的裝置的成績。
**The client is wired up** (see §6.6): `src/game/remoteLeaderboard.ts` is the HTTP-backed
`LeaderboardSource`; the local implementation in `src/game/leaderboard.ts` stays as the offline /
no-backend fallback, and the two share one copy of the local-record logic. The board now really does
carry other devices' scores.

### 檔案佈局

```
api/
  run/start.ts        端點：export default vercelEndpoint(handleRunStart)
  score.ts            端點：export default vercelEndpoint(handleScore)
  leaderboard.ts      端點：export default vercelEndpoint(handleLeaderboard)
  health.ts           端點：export default vercelEndpoint(handleHealth)
  _lib/
    handlers.ts       四個端點的核心邏輯（不含平台細節）
    runtime.ts        外殼：設定、接收紀錄、CORS、500 收斂；**平台無關**
    http.ts           ApiRequest / ApiResponse / 欄位讀取；**平台無關**
    adapters/
      vercel.ts       Node 的 req/res → ApiRequest（＋ vercelEndpoint）
      fetch.ts        Web 的 Request/Response → ApiRequest（＋ EdgeOne 具名匯出）
    db/
      types.ts        Driver：query(sql, params) → { rows, affected }、transaction
      dialect.ts      **各方言之間所有差異的唯一去處** ＋ Binder
      postgres.ts     pg 驅動 ＋ Postgres 方言
      mysql.ts        mysql2 驅動 ＋ MySQL 方言
      sqlite.ts       node:sqlite 驅動 ＋ SQLite 方言（**本機開發用，不是部署選項**）
      index.ts        方言 → 驅動 → 儲存層的組裝點、ensureSchema
    sqlStore.ts       方言驅動的儲存層（邏輯只寫一次）
    store.ts          Store 介面 ＋ MemoryStore（測試用）
    tokens.ts         簽章、驗章、指紋、run_id 產生
    limits.ts         上界（從遊戲配置推導）＋ 合理性檢查
    requests.ts       客戶端 IP、標頭白名單、接收紀錄列的組裝
    env.ts            環境變數 → Config（純函式，啟動時驗完）
schema.sql            人看的 Postgres 版 schema（與程式的一致性由測試守住，見 §7）
vercel.json           建置設定與函式逾時
.env.example          環境變數的鍵名與說明（**只放鍵名，不放值**）
scripts/migrate.ts    npm run db:migrate —— 建表（任何方言）
scripts/dev.ts        npm run dev —— 前端 ＋ 後端 ＋ SQLite，見 §6.5
```

> ⚠️ **`api/**` 內每一處相對 import 都要帶 `.js`**（目錄要寫到 `/index.js`）：部署是**逐檔轉譯、
> 不打包**，而 `package.json` 是 `"type": "module"` —— 少一個副檔名在部署後就是
> `ERR_MODULE_NOT_FOUND`，本機卻完全看不出來。理由、出事的長相與怎麼防，見 §6。

客戶端那一邊的兩支（都在 `src/game/`，見 §6.6）：

```
leaderboard.ts         本機的一半（身份、顯示名、分享意願、本機紀錄）＋ 榜存在本機的實作
remoteLeaderboard.ts   榜在伺服器的實作：打 /api/run/start、/api/score、/api/leaderboard
```

**分層的理由**：端點檔案只匯出一行，所有邏輯住 `_lib`。這樣單元測試可以**不碰資料庫**直接呼叫
處理器（餵 `MemoryStore` ＋ 注入時鐘），見 `tests/api.test.ts`。**平台**與**方言**各自只有一個接縫，
所以要換掉任何一個都只動一個檔案。客戶端同理：`LeaderboardSource` 是那條接縫，而它現在真的被兩個
實作共用（見 §6.6）。

---

## 2. 反作弊：T2

**前提認知**（`design.md` §6.7）：物理跑在客戶端，分數本質上可偽造，**不可能完全防堵**。目標是
拉高作弊成本到不划算。

T2 的核心是 **`/api/run/start` 頒發的短期憑證**。它綁 `(run_id, device_id, 頒發時刻)`，提交時：

1. **先擋速率** —— 比對憑證便宜、比讀資料庫便宜。
2. **再驗憑證** —— 是不是我們發的（簽章）、是不是同一張（資料庫裡的指紋）、是不是這個裝置、過期沒。
3. **再驗時間** —— 宣稱的時長**不能超過**憑證頒發以來的實際時間。
4. **最後驗合理性** —— 上界（見下）。

### 為什麼是 T2 而不是 T1

T1 只是把提交簽個章。它能證明「這包東西沒被改過」，**但證明不了「這一局真的打了那麼久」** ——
因為時間是作弊者自己說的。

T2 的價值在**頒發時刻**：伺服器在開局時記下時間，於是提交時可以要求「你宣稱的時長不可能超過我
看著你流逝的時間」。這是 T1 結構上做不到的事。T3（伺服器端重放整條事件流）成本高得多，本專案
的作弊收益不值得，故不做。

### 時間檢查刻意是**單邊**的

只檢查上界，**不檢查下界**（打了比流逝時間短是合法的）：切到瀏覽器背景時模擬時鐘會停住，這時
「宣稱的時長」本來就會小於「牆上時鐘流逝的時間」。設下界會誤傷誠實玩家。

容許差距 `CLOCK_TOLERANCE_MS = 5 秒`只用來吸量測噪音（網路往返、計時器合併、首幀對齊）。真正的
作弊（宣告一局不存在的兩小時）差好幾個數量級，不會躲在 5 秒裡。

### 合理性上界是**從遊戲配置推導**的

`limits.ts` 的三個常數不是隨手填的，是從 `public/config/levels.json` 與 `src/game/combo.ts` 算
出來的：

| 常數                | 值     | 來源                                       |
| ----------------- | ----- | ---------------------------------------- |
| `DROP_COOLDOWN_MS` | 500   | `levels.json` 的 `settings.dropCooldownMs` |
| `MAX_LEVEL_SCORE`  | 256   | 第 10 級的 `score`                           |
| `MAX_MULTIPLIER`  | 10    | `COMBO_CURVE.cap (9) + base (1)`           |

於是推得：投放 ≤ `⌊時長/500⌋ + 2`（+2 給不受冷卻限制的開場第一顆）、合成 ≤ 投放、分數 ≤
合成 × 256 × 10。

> **`tests/api.test.ts` 有一條測試專門讀回那兩個檔案來比對**。上界一旦跟配置脫節就會變成**錯的
> 上界**，而錯的上界比沒有上界更糟：它會安靜地放過作弊，或誤傷誠實玩家。所以這條測試是整份檔案
> 裡最重要的一條。

**未通過檢查的提交仍然寫進 `scores`**（`verified = false`）。留著是為了審計：一次「明顯在試」的
提交比一次成功的作弊更有價值，因為前者告訴你有人在試。

---

## 3. 環境變數

完整清單與說明見 `.env.example`。要點：

| 變數                     | 必要 | 預設          | 說明                                                     |
| ---------------------- | -- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL`         | ✅  | —           | 任何 **Postgres 或 MySQL**；本機開發用 `sqlite:.mysql/endchi.db`。Neon 請用帶 **`-pooler`** 的主機名 |
| `DB_DIALECT`           |    | 從 URL 推斷     | `postgres` / `mysql` / `sqlite`；看不出 scheme 或猜錯時才需要填         |
| `RUN_TOKEN_SECRET`     | ✅  | —           | **≥ 32 字元**，短於此會被當成缺漏（短秘密等於沒有秘密）                       |
| `IP_STORAGE_MODE`      |    | `truncated` | `raw` / `truncated`（IPv4→/24、IPv6→/48）/ `hashed`（帶秘密 HMAC） |
| `IP_HASH_SECRET`       |    | 退回 token 秘密 | 與前者分開：輪替時機不同                                           |
| `ALLOWED_ORIGIN`       |    | 空（只同源）      | 前端不在同一個網域時必填（例如前端在騰訊 EdgeOne Pages）                     |
| `SUBMISSIONS_PER_HOUR` |    | `20`        | 每裝置每小時提交上限（含被退回的）                                      |
| `RUNS_PER_HOUR`        |    | `120`       | 每裝置每小時開局上限（防無限鑄造憑證）                                    |

`DB_DIALECT` 認得的三個 scheme 是 `postgres://`、`mysql://`（含 `mariadb://`）與 `sqlite:`（含
`sqlite3:`）。**從 scheme 猜的預設是 Postgres** —— 保留這條路的正常結果是「只填一個 `DATABASE_URL`
就能跑」，而猜錯的兩種後果不對稱：把 Postgres 猜成 SQLite 會拿到像檔案權限問題的 `SQLITE_CANTOPEN`，
把 SQLite 猜成 Postgres 則是一行立刻看得見的語法錯誤。

`npm run dev` 會在**沒有設定時**替你填 `DATABASE_URL=sqlite:.mysql/endchi.db` 與一個公開的開發用
`RUN_TOKEN_SECRET`（見 §6.5）—— 它只補沒有設的，所以 `.env` 永遠優先。

**產生秘密**：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`DATABASE_URL` 或 `RUN_TOKEN_SECRET` 缺了，執行期**直接拋錯**而不是套預設 —— 少一個環境變數時大聲
壞掉，比安靜地跑一個沒有反作弊的後端好。錯誤訊息**只含鍵名、不含值**（那種字串很容易被貼進 issue）。

---

## 4. 資料庫放哪裡

這一節回答使用者問的三個問題。

### Q1：在本地 NAS 架 Postgres，可行嗎？

**可行，但有四個坑**。NAS 上的 Postgres 與雲端的 Postgres 對這個後端是完全一樣的（`pgStore.ts`
只用標準 SQL，換供應商只改一個環境變數），差別全在**網路可達性**與**連線數**。

1. **Vercel 的函式預設用動態對外 IP。** 所以**不能用 IP 白名單**擋 —— 每次部署、每個實例的來源
   IP 都可能不同。要固定 egress IP 得買 Vercel 的 **Static IPs（Pro，約 $100/月）** 或
   **Secure Compute（Enterprise）**。
   → 實務結論：NAS 上的 5432 埠**必須對外公開**（埠轉發或反向代理），靠 `sslmode=require` ＋ 強
   密碼 ＋ 非預設埠 ＋ fail2ban 這類周邊措施防護。**直接把資料庫暴露到公網是有風險的**，要接受。
2. **上游頻寬是瓶頸。** 家用寬頻的**上傳**通常遠小於下載。每次查榜都是一趟 Vercel ↔ 你家 NAS：
   延遲取決於兩地距離，吞吐取決於你的上傳。建議查榜走快取、寫入是非同步的（正好符合 local-first）。
3. **必須有連線池。** 函式實例是短命的、而且會水平擴張 —— 每個實例 `max: 2` 條。實例一多，NAS
   上的 Postgres 直連很快就撞 `too many connections`。Neon 內建 pooler；**自架的話要自己上
   PgBouncer**（transaction mode），並讓 `DATABASE_URL` 指向它。
4. **可用性。** 休眠、斷電、ISP 斷線、憑證續期都會讓榜掛掉。這是自架的固有代價。

**結論**：NAS 自架最適合當**本機開發／測試**的資料庫（免花錢、資料自己拿著），也非常適合當
**自架版發行**的預設（`design.md` §6.1 的「Docker 三容器」方向）。但**不建議當公開站的正式 DB**，
除非你願意為 Static IPs 付費並接受上述可用性風險。

### Q2：在 Vercel 架個「微服務之類的小型資料庫」？

**Vercel 已經沒有自家的資料庫了。** Vercel Postgres 於 2024/12 – 2025/6 完全退場，資料全部遷移
到 Neon，`@vercel/postgres` 也已停止維護。現在 Vercel 上的資料庫一律走 **Marketplace**：

| 選項              | 型態           | 備註                                       |
| --------------- | ------------ | ---------------------------------------- |
| **Neon**（推薦）    | Serverless **Postgres** | 免費層寬鬆、**內建 pooler**、分支／時光回溯；Vercel 原生整合    |
| **Supabase**    | **Postgres** ＋ 周邊 | 帶 Auth／Storage／Realtime；這個專案用不到那些，但也不妨礙    |
| **Upstash**     | Redis        | 是 KV 不是 SQL，**不適用**本專案（榜要排序與聚合）           |

從 Marketplace 開一個 Neon，Vercel 會**自動把 `DATABASE_URL` 注入**專案的環境變數，不必手抄。
所以「在 Vercel 架小型資料庫」的正解是：**在 Vercel 的 Marketplace 開一個 Neon**，而不是找
Vercel 自家的東西。

> ⚠️ **Neon 是 Postgres，不是 MySQL。** Vercel Marketplace 上的 Neon 與 Supabase 都只提供
> **PostgreSQL** 協議。所以「Vercel ＋ Neon」與「騰訊免費 MySQL」是**兩個不同的方言**，而那正是
> 這個後端同時實作兩個方言、並把差異抽成 `Dialect` 的原因（見 §5）。
> ⚠️ **Neon is Postgres, not MySQL.** Both Neon and Supabase on the Vercel Marketplace speak only
> **PostgreSQL**. So "Vercel + Neon" and "Tencent's free MySQL" are **two different dialects** — which
> is exactly why this backend implements both and folds the differences into `Dialect` (see §5).

### Q3：那到底該選哪個？

| 情境                    | 建議                                                       |
| --------------------- | -------------------------------------------------------- |
| **公開站正式部署**           | **Neon**（Marketplace 開，免費層起步）。內建 pooler、無動態 IP 問題、零維運 |
| **騰訊／國內部署**           | 腾讯云 MySQL 免費版或 TDSQL-C（`DB_DIALECT=mysql`），配 EdgeOne Pages Function |
| **本機開發／測試**           | **SQLite**（`npm run dev` 自己起，不必裝任何東西）；想貼近正式環境就指向 Neon 的開發分支 |
| **自架版發行（Docker 三容器）** | NAS 上的 Postgres 或 MySQL ＋ 連線池，`design.md` §6.1 / Q15 的方向    |

> **「本機開發」那一行從 Docker 改成 SQLite**，理由是 Docker 在 Windows 上要先裝 Docker Desktop、
> 要先有 WSL2，而且每次開機都要等它醒 —— 這些成本全部落在那個「只是想改個 UI」的人身上。SQLite 是
> 一個檔案，`npm run dev` 就建好了；要測 Postgres／MySQL 專屬的行為時，`.env` 填一個真的連線字串
> 即可（`.env` 永遠優先於開發預設值）。見 §5.1.1。
>
> 這對應 `design.md` 的 **Q10（DB 選型）**：Vercel 走 **Neon**、騰訊走 **MySQL**，兩者都支援。
> **Q15（託管分工）** 因此更進一步收斂：可移植性現在不只是 「換一個環境變數」，而是「換一個環境變數
> ＋ 一個轉接頭」。加上 SQLite 之後，這條接縫第一次真的被用來**加一個方言**（`sqlStore.ts` 一行都
> 沒有動）。

---

## 5. 共用程式碼：三個方言、兩個平台

這一節是整個後端設計的**理由**。同一個後端要跑在幾個角落，而它們兩兩不同：

|           | 執行環境                      | 資料庫                                   |
| --------- | ------------------------- | ------------------------------------- |
| **Vercel** | Node 函式（`req`/`res`）      | Neon ＝ **Postgres**                   |
| **EdgeOne** | Web 標準（`Request`/`Response`） | 腾讯云 **MySQL**（免費版／TDSQL-C）           |
| **自架**     | Node ＋ Docker             | 兩者皆可（`DATABASE_URL` 決定）               |
| **本機開發**   | Node ＋ Vite（同一個行程）        | **SQLite**（一個檔案）                      |

所以切成**兩個接縫**，各自只有一個檔案要知道差異：

| 接縫 | 位置 | 換掉它要動什麼 |
| --- | --- | --- |
| **平台** | `adapters/` | 一個檔案（`vercel.ts` / `fetch.ts`） |
| **方言** | `db/` | 一個檔案（`postgres.ts` / `mysql.ts` / `sqlite.ts`） |

中間的一切 —— `handlers.ts` 的反作弊、`sqlStore.ts` 的榜的邏輯、`requests.ts` 的標頭白名單 —— **一行
都不用重複**。這不是「順便」：重複的邏輯會漂移，而漂移的症狀是「Vercel 上正常、騰訊上分數算錯」，
那是最難查的一種 bug。

### 5.1 方言：差異集中在 `Dialect`

| 項目 | Postgres | MySQL | SQLite（本機） |
| --- | --- | --- | --- |
| 佔位符 | `$1, $2` | `?` | `?` |
| 時間型別 | `timestamptz` | `datetime(3)`（UTC） | `integer`（UTC 毫秒） |
| 時間參數 | ISO 字串 ＋ `::timestamptz` | `Date` 物件 | 整數 |
| 讀時間 | `extract(epoch …) * 1000` | `Date.getTime()` | 原樣 |
| 布林 | `true` / `false` | `1` / `0` | `1` / `0` |
| JSON | `jsonb` | `json` | `text` |
| 唯一鍵衝突 | `on conflict … do nothing` | `on duplicate key update` | `on conflict … do nothing` |
| 插入是否成功 | `returning` 的行數 | `affectedRows` | `returning` 的行數 |
| 空值排序 | `nulls last` | 沒有，要寫 `best_at is null` 排在前面 | `nulls last` |
| `count(*)` | 回 bigint（字串）→ 要 `::int` | 回數字 | 回數字 |
| 逐列最大值 | `greatest(a, b)` | `greatest(a, b)` | `max(a, b)` |

**SQLite 只差三項寫法**（時間、`greatest`、`now()`）—— 它的 upsert 與 `returning` 與 Postgres 同形，
所以它也走 `insertScoreSignal = 'rows'` 那條路，不必碰 MySQL 的 `affectedRows`／`FOUND_ROWS` 地雷。

`Dialect` 提供「語法」，`sqlStore.ts` 提供「邏輯」。語法分成兩種：三個寫入語句形狀差太多，各自寫在
自己的方言裡；其餘的 SELECT 用 `Binder` 產生。

**`Binder` 是同一份 SQL 能同時餵三個方言的關鍵。** 兩種佔位符的差異不只是文字：`$1` 可以引用多次而
只傳一份值，`?` 是**位置性**的、每次出現都吃掉一個參數。所以 `rankOf` 裡「同一個分數出現三次」在
Postgres 只要一個參數、在 MySQL／SQLite 要三個 —— 修法是**每一次出現都綁一次**，Postgres 那邊多幾個
沒必要的參數，換來三邊共用一份 SQL 文字。`tests/dialect.test.ts` 與 `tests/sqlStore.test.ts` 都有針對
「佔位符數 ＝ 參數數」的斷言，而 `tests/dialect.test.ts` 的每一個迴圈都跑**三個**方言。

> **五個容易出事的細節，都有測試守住：**
> 1. **`upsertProfile` 的欄位順序在 MySQL 是有意義的** —— `on duplicate key update` 由左至右求值，
>    所以 `best_score` 必須排在拿它比較的 `best_duration_ms`／`best_at` **之後**，否則時長永遠不會
>    跟著分數更新，而且不會報錯。Postgres 與 SQLite 的 `excluded` 不受順序影響。
> 2. **不用 `insert ignore`** —— 它會把所有錯誤吞成警告，不只是重複鍵。
> 3. **一定要關掉 `FOUND_ROWS`** —— `mysql2` 的 `getDefaultFlags()` **預設就開著它**，而它把
>    `affectedRows` 由「真正寫入的行」改成「**匹配到的**行」，於是刻意的 no-op upsert
>    （`on duplicate key update run_id = run_id`）在既有列上回報 `1`，每次重試都被當成新的一局。
>    由 `mysql.ts` 的 `MYSQL_CLIENT_FLAGS = ['-FOUND_ROWS']` 關掉（`mergeFlags` 認得 `-` 前綴），
>    `tests/dialect.test.ts` 釘住「旗標在、裸的 `FOUND_ROWS` 不在」。這是**跑真的 MySQL 才發現的** ——
>    假驅動看不出來，Postgres 也完全不受影響。
> 4. **`scores.device_id` 不是外鍵**，而且這是**功能性**的要求，不是風格：有外鍵的話，新裝置的第一次
>    提交（`saveScore` 先寫 `scores`、才寫 `profiles`，而冪等是由第一句的結果決定的）與被退回的提交
>    （`verified = false` 故意不建 profile，要留審計痕跡卻不進榜）都會被拒絕——也就是說有外鍵就等於
>    「拒絕留檔」。`tests/dialect.test.ts` 有一條釘住「三個方言都不可以有 `references profiles`」。
> 5. **`scores.created_at` 是綁進去的，不是靠 DDL 的預設值**。這一欄同時是速率限制的視窗
>    （`countSubmissionsSince`）與審計時間，而 `MemoryStore` 用的是呼叫端傳進來的 `atMs` —— 靠預設值
>    會讓兩個 `Store` 實作靜靜分歧，而單元測試走的正是 `MemoryStore`。SQLite 的 `strftime` 更只有
>    **秒**的解析度，靠預設值連精度都對不上。

> 第 4、5 點都是**把整合測試從 gated 改成一律會跑**之後才發現的（見 §7）——兩者都不會拋錯，只會讓某
> 些東西永遠寫不進去、或讓本機與線上算出不同的名次。

### 5.1.1 SQLite：本機開發的資料庫

`api/_lib/db/sqlite.ts` 是一個**檔案**而不是一個服務，所以 `npm run dev` 與
`npx vitest run` 都不必先起任何東西。它用 Node 22 內建的 `node:sqlite`，**不加任何相依**；那個模組
的 API 還是 experimental（會印一行警告），對開發資料庫可以接受，要規避就換 `better-sqlite3`（同一個
`Driver` 換一個實作）。

⚠️ 它**不是**部署選項：Vercel／EdgeOne／騰訊雲的函式都跑在拋棄式檔案系統上，一個請求寫進去的檔案下
一個請求不一定看得到。所以 `connectionNotes()` 對它永遠回一條警告，而 `docs` 這裡再講一次。

**它修掉了一個真的卡住的問題。** 使用者原本要的是「每次啟動一個 MySQL，資料庫檔案放在 `.mysql/`」，
而這個 repo 的路徑含中文（`團圓大作戰`）—— `mysqld` 會**在第一個中文字截斷路徑**：
`--initialize-insecure` 成功，但啟動時讀不到自己的 error log（`Could not open file
'E:\hkust_repo\Vocaloid2048.err'` → `[MY-010119] Aborting`），而且對**相對路徑**也一樣。該目錄也沒有
8.3 短檔名可用。SQLite 走的是 Node 的 UTF-8 路徑處理，所以完全沒有這個問題。

**榜序是「每個分類各自一份」**，而且必須由**伺服器**決定。三個分類（分數／COMBO／合成）各自獨立取
最大值，所以一位「高分低連擊」的玩家在 COMBO 榜上不會出現在前 N 名裡；如果伺服器永遠照 `best_score`
排序，那個分頁就是錯的。`Dialect.boardOrder(category)` 與 `Store.topProfiles(category, …)`／
`rankOf(probe, category)` 共用同一份 `boardOrderKeys(category, timeOrder)`，所以**名次與列序必然
同源** —— 兩邊各寫一份排序遲早會漂移，而漂移的症狀（「我明明是第 3 名，榜上第 5」）只有玩家看得到。
`rankOf` 的 SQL 謂詞就是那串鍵的**前綴相等鏈**。

### 5.2 平台：EdgeOne 要接哪一個

EdgeOne Pages 有**兩種**函式，差別決定了能不能連資料庫：

| | Edge Functions | **Node Functions** |
| --- | --- | --- |
| 執行環境 | V8 isolate（邊緣節點） | **完整 Node.js**（中心化機房） |
| 冷啟動 | 毫秒級 | 秒級 |
| npm 生態 | 受限 | **完整支援** |
| 能連資料庫 | **不能**（無 TCP socket） | **可以**（EdgeOne 官方 MySQL 模板用 `mysql2`） |
| 呼叫形狀 | `export onRequestGet = async (ctx) => Response` | 同左（`ctx.request` 是標準 `Request`） |

**所以 EdgeOne 那邊要用 Node Functions**：它跑完整的 Node.js，`mysql2` 與 `pg` 都能用，我們的
`db/` 那一層可以整包照搬。Edge Functions（V8）沒有 TCP，接了也沒用。

接上去只要一行（`node-functions/api/score.js`）：

```js
import { handleScore } from '../../api/_lib/handlers';
import { endpoint } from '../../api/_lib/runtime';
import { createEdgeOneHandlers } from '../../api/_lib/adapters/fetch';

export const { onRequestGet, onRequestPost, onRequestOptions } =
  createEdgeOneHandlers(endpoint(handleScore));
```

三個具名匯出指向**同一個**處理器是刻意的：方法判斷只有一處（在處理器裡），三個平台入口不會各自
漂移 —— 用錯方法會拿到 405，而不是「路由不存在」。

**EdgeOne/邊緣環境要記得**：`ALLOWED_ORIGIN` 要填前端的網域（預設只接受同源）；`DB_DIALECT=mysql`；
`DATABASE_URL` 指向腾讯云 MySQL。

## 6. 部署到 Vercel

> **只想在本機跑起來的話不必看這一節** —— `npm run dev` 會自己起後端與 SQLite（見 §6.5）。這一節是
> 「要上線」的路徑。

### 部署前的硬規則：`api/**` 的相對 import 一律要帶 `.js`

放在第 1 步前面，是因為違反它的代價是**四個端點全部 500**，而本機不會有任何徵兆。

`package.json` 是 `"type": "module"`，而 `vercel.json` 把 `api/**/*.ts` 宣告成函式 —— Vercel 於是把它
**逐檔轉譯成 `.js`、不打包**。部署後跑的因此是 Node 的 ESM 解析器，它**要求相對路徑帶副檔名**：
`import` 一個沒有副檔名的路徑，它不會去猜 `.js` 或目錄 index，而是直接
`ERR_MODULE_NOT_FOUND`。

```ts
import { handleScore } from './_lib/handlers.js';     // ✅
import { createVercelHandler } from '../http.js';     // ✅
import { createStore } from './db/index.js';          // ✅ 目錄要寫到 index
import { handleScore } from './_lib/handlers';        // ❌ 部署後 500
```

**本機為什麼看不出來**：`tsx`（`npm run dev`）與 Vite（`npx vitest run`、`vite build`）都會替我們補上
副檔名，所以測試全綠、`build` 成功，都**不代表**部署正確。這一條是 2026-10-13 上線後第一個請求就吃到
500 才補上的（見 `CHANGELOG.md`）。

**怎麼防**：`tsconfig.api.json` 用 `module: "nodenext"` ＋ `moduleResolution: "nodenext"`，於是同一個
錯誤在 `npm run typecheck` 就變成 **TS2835**，不必等部署。這一檔只包含 `api`，所以 `src`（瀏覽器端，
照舊由 Vite 打包）不受影響；`api/` 之外維持原本的寫法即可。

1. **建資料庫**：Vercel 專案 → Storage → Marketplace → **Neon** → 建一個免費資料庫。Vercel 會自動
   把 `DATABASE_URL`（帶 `-pooler`）注入環境變數。
2. **建表**（兩種方式，選一個）：
   ```bash
   npm run db:migrate                       # 讀 .env 的 DATABASE_URL，三個方言都支援
   psql "$DATABASE_URL" -f schema.sql       # 或直接用 Postgres 客戶端套 schema.sql
   ```
   `db:migrate` 走的是 `db/` 那一層的 `ensureSchema`，所以它與程式**保證**一致，而 `schema.sql`
   是人看的參考（兩者的一致性由測試守住）。
3. **加秘密**：Vercel → Project Settings → Environment Variables 填 `RUN_TOKEN_SECRET`（≥ 32 字元）。
   其餘選填見 `.env.example`。
4. **部署**：推上 Git，Vercel 依 `vercel.json` 建置（`npm run build` → `dist`）。四個端點自動生效。
5. **確認**：打開 `/api/health` —— 它會真的問一次資料庫。回 `{ ok: true, database: "postgres", players: N }`
   就是通了；`503` 是連不上（檢查 `DATABASE_URL` 與 Neon 的 IP allowlist），`500` 是表沒建好
   （回頭跑第 2 步）。
6. **前端若不在同一個網域**：把前端的網域填進 `ALLOWED_ORIGIN`，否則瀏覽器會擋下回應。

**本機開發**（任何 Postgres 或 MySQL 皆可）：

```bash
# 用 Docker 起一個 local Postgres
docker run -d --name endchi-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"
export RUN_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"

npm run db:migrate      # 建表
npm run dev
```

驗證：

```bash
curl -s localhost:3000/api/health
# {"ok":true,"database":"postgres","players":0,"at":...}

# 開一局應該拿到一張憑證
curl -s localhost:3000/api/run/start -X POST -H 'content-type: application/json' \
  -d '{"deviceId":"dev-00000000-1111"}'
# 取榜
curl -s 'localhost:3000/api/leaderboard?limit=10'
```

---

## 6.5 本機開發：`npm run dev`

```bash
npm run dev        # API（SQLite）＋ Vite，兩者在同一個行程
npm run dev:web    # 只有 Vite（純 UI 改動，打不到 API）
```

它做四件事，順序有意義：

1. **補上開發用的環境變數預設值**（`DATABASE_URL=sqlite:.mysql/endchi.db`、一個公開的
   `RUN_TOKEN_SECRET`），而且**只補沒有設的** —— 所以 `.env` 永遠優先，想在本機測真的 Neon 或騰訊雲
   只要填 `DATABASE_URL`；
2. **建表**（`ensureSchema`，可重複執行）—— 所以 `git clone` 之後第一次跑就有一個能用的資料庫；
3. 用 `node:http` 起 API 伺服器（預設 `127.0.0.1:8787`，`DEV_API_PORT` 可改）；
4. 在同一個行程裡起 Vite，並把 `/api` 代理到 3 —— **客戶端因此用相對路徑 `/api/…` 就好**，不需要
   任何 CORS 設定或 `baseURL` 分支。

### 為什麼不用 `vercel dev`

那要多一個每次都連到雲端的 CLI、一份 `.vercel/`，而且它模擬的執行環境與正式環境仍然不完全一樣。這裡
走的是**正式環境那一個轉接頭**（`adapters/vercel.ts` 的 `createVercelHandler`），只把 Node 的
`req`／`res` 交給它 —— 而 Vercel 的 `res` 介面（`statusCode`／`setHeader`／`end`）本來就是
`node:http` 的 `ServerResponse` 的子集，所以連包裝都不必寫。本機與雲上因此跑的是**同一條**
轉接頭 → 外殼 → 處理器 → 儲存層的路徑，只有傳輸層不同。唯一刻意加的東西是一行
`x-forwarded-for`（假裝前面有反向代理），否則接收紀錄裡的 IP 永遠是空的 —— 而那個差異正是最容易一直
沒發現的一種。

### 路由是掃出來的

`scripts/dev.ts` **動態載入 `api/**` 底下每一個 `.ts`**，並用它自己的路徑當路由
（`api/run/start.ts` → `/api/run/start`）；以 `_` 開頭的檔案與資料夾跳過（Vercel 也這樣排除，所以
行為與部署一致）。所以**新增一個端點不必改這個檔案** —— 手抄一份路由表的話，總有一天會出現
「本機 404、線上正常」這種最花時間的 bug。打錯路徑時 404 的訊息會列出所有認得的路徑。

### 資料庫檔案

`.mysql/endchi.db`（連 WAL 的 `-wal`／`-shm` 一起）整個 `.mysql/` 都在 `.gitignore` 裡。要重來一個
乾淨的資料庫就是刪掉那個資料夾 —— 這也是 SQLite 比「本機 MySQL」好的地方：重來不需要停服務、不需要
`drop database`。

---

## 6.6 客戶端接上 HTTP

`src/game/remoteLeaderboard.ts` 是 `LeaderboardSource` 的伺服器實作。UI（`ui/leaderboard.ts`）只多了
**一行** `source.refresh?.()`，其餘完全沒動 —— 那正是當初把「榜從哪裡來」抽成介面的目的。

### 一次遊玩的完整時序

| 時機 | 客戶端 | 端點 |
| --- | --- | --- |
| 開局（含「再玩一次」） | `beginRun()` | `POST /api/run/start` → 一次性憑證 |
| 每一幀 | `record({ score, maxCombo, merges, drops, durationMs })` | —（只寫本機） |
| 局末／重新開始／切到背景／關分頁 | `sync()` | `POST /api/score` |
| 開榜、同意分享、提交成功之後 | `refresh()` | `GET /api/leaderboard?category=…` |

`beginRun()` 與 `refresh()` 是介面的**選填**成員：本機實作不需要它們，所以 UI 呼叫時用的是 `?.`。

### 三個非顯而易見的決定

1. **憑證在開局時鑄，不是提交時。** `POST /api/run/start` 回的憑證帶著**頒發時刻**，而
   `checkClaimedDuration` 拿它判斷「宣稱的時長不可能超過實際流逝的時間」。提交時才鑄的話那個差值
   永遠是零，任何超過容忍值（5 秒）的成績都會被退 —— 也就是**每一局正常的遊戲**。
2. **提交的是「某一局自己的數字」，不是本機紀錄。** 本機紀錄的三個最大值**可以來自不同的三局**
   （見 `LeaderboardEntry.durationMs` 的說明，那是刻意的），湊在一起送會宣稱一局同時打出了三個不同局
   的成績 —— `checkRationality` 會退它（`merges_exceed_drops`／`combo_exceeds_merges`），而那是對的。
   所以 `record()` 把**這一局**原封不動存下來，`sync()` 送的是它。這也是 `LeaderboardRun` 需要
   `drops` 的原因：那個欄位只有伺服器用得到（見下）。
3. **`snapshot()` 一定是快取。** 介面是同步的（UI 每個分頁都同步讀它），所以伺服器版留一份上次抓回來
   的榜；抓不到就**保留舊的** —— 寧可給一份稍舊但真實的排名，也不要在載入的那一瞬間把榜清空。

### `drops` 是投入量，不是場上顆數

`LeaderboardRun.drops` 要傳的是 `GameSession.totalDrops`（這一局**累計投放**了幾顆），不是
`GameSession.dropCount`（目前場上還有幾顆）。合成與回收都會讓後者變少，所以用它去送的話，一局玩得久
一點就會變成「合成 60 次但只投了 12 顆」而被退。

`drops` 在型別上是選填的（本機紀錄用不到它），未提供時客戶端會退回 `merges` —— 伺服器的下界是
「合成數 ≤ 投放數」，少報投入量是安全的，而送 0 會讓每一筆提交都被退。

### 失敗時會怎樣

| 情況 | 結果 |
| --- | --- |
| `sync()` 離線／逾時 | 標記留著，下一次 `sync()` 再送 |
| `sync()` 429 | 同上（「等一下再送」） |
| `sync()` 5xx | 同上（伺服器那邊暫時的事） |
| `sync()` 4xx（400／401／403／409） | **定論**：清掉標記並記一行，不再重試 |
| 200 但 `verified: false` | 已受理但**沒上榜**（不合理），記一行，不重試 |
| `refresh()` 離線／非 200 | 保留上一次的榜，不清空 |

⚠️ **同一局只提交一次。** `run_id` 是主鍵，重送拿到的是同一個裁決；而憑證在提交後就作廢，所以
「離線玩一局、隔天才上載」是不可能的（憑證早已過期）。這是「伺服器知道這一局是什麼時候開始的」的
代價，也是 T2 的本質。

⚠️ **上載失敗不影響遊戲。** 本機紀錄照樣每幀更新，下一局照樣玩；差別只是那筆成績這輩子不會上榜。

---

## 7. 測試

四層，**全都不需要外部服務**：

| 檔案 | 測什麼 | 需要外部服務 |
| --- | --- | --- |
| `tests/api.test.ts` | 處理器：開局 → 提交 → 上榜、冪等、速率、憑證、合理性、健康檢查、每個分頁的排序與自身名次 | ✗ |
| `tests/dialect.test.ts` | 方言：佔位符、**每個分類各自的榜序**、upsert 順序、連線旗標、建表可重複執行、外鍵與 `created_at` 的兩條硬規則、錯誤分類 | ✗ |
| `tests/sqlStore.test.ts` | 儲存層邏輯：**佔位符數 ＝ 參數數**、冪等的兩條路、交易與回滾、列轉換、`rankOf` 比的是哪一欄 | ✗ |
| `tests/db.integration.test.ts` | 真的 SQL：建表、憑證、最大值、同分名次、JSON 欄位、交易原子性、高分低連擊的 COMBO 榜、SQLite 驅動的三個 pragma／交易保證 | ✗（記憶體 SQLite） |
| `tests/leaderboard.test.ts` | 本機那一半：一局一局只留一行、只升不降、改名不新增、同意之前不上榜、上載時機、存檔被手改過 | ✗ |
| `tests/remoteLeaderboard.test.ts` | 伺服器那一半：**提交的是某一局自己的數字**、開局鑄憑證、4xx 定論 vs 429／網路失敗留著待送、抓榜失敗保留舊榜、壞掉的那一列只丟自己 | ✗（注入的假 `fetch`） |

```bash
npm run typecheck
npx vitest run                # 全部；整合層跑真的 SQL，只是資料庫在記憶體裡

# 想測真的 Postgres／MySQL（**指向一個拋棄式的實例**）
TEST_DATABASE_URL='postgresql://…' npx vitest run tests/db.integration.test.ts
TEST_DATABASE_URL='mysql://…'      npx vitest run tests/db.integration.test.ts
```

### 整合測試為什麼**不再**是 gated 的

它從前只有設了 `TEST_DATABASE_URL` 才跑，理由是「這個 repo 與 CI 不該為了跑測試而背一個資料庫」。
那個理由在加了 SQLite 之後消失了：記憶體資料庫連檔案都不是，所以**預設值就是
`sqlite::memory:`**，這個 suite 現在**一律會跑真的 SQL**。

而**單元測試永遠測不到真 SQL**：`sqlStore.test.ts` 的假驅動驗的是「我們產生了什麼」，整合測試驗的是
「資料庫真的接受它」。兩者的交集才是「能跑」。

**把 gated 拿掉本身就是收穫**：一改成一律執行，SQLite 立刻抓到兩個從來沒人看過的缺陷 ——
`scores.device_id` 的外鍵讓「新裝置的第一次提交」與「被退回的提交」永遠寫不進去，以及
`scores.created_at` 從來沒有被綁進去（於是 `SqlStore` 與 `MemoryStore` 對速率限制的判斷不一致）。兩個
都是在真庫上也存在、但因為 gated 而從來沒被執行過的路徑，見 §5.1 的第 4、5 點。

要貼近正式環境時，把 `TEST_DATABASE_URL` 指向真的資料庫：`mysql-memory-server`（devDependency）也可以
起一個**拋棄式的 MySQL**（下載一次、開在隨機空閒埠、`stop()` 就清乾淨）。

`tests/adapters.test.ts` 另外驗**兩個平台轉接頭得到同一個 `ApiRequest`** —— 那是最直接的「共用
程式碼」證明。

### `schema.sql` 與程式的一致性

`schema.sql` 是人看的 Postgres 參考（可以直接 `psql -f`），而真正的來源是 `db/postgres.ts` 的
`schema()`。兩者若漂移，測試會紅 —— 這是沿用這個專案既有的做法（比對 `limits.ts` 與
`levels.json` 的那一條同樣的道理）：**與其靠註解提醒，不如讓測試自己讀回來比對**。

`MemoryStore` 與 `SqlStore` 都符合 `Store` 介面 —— `tests/api.test.ts` 結尾有
`const storeContract: Store = new MemoryStore()`，讓「介面改了但實作沒跟上」在型別檢查就爆。

---

## 8. 待辦與接縫

- **EdgeOne 骨架**：轉接層（`adapters/fetch.ts` 的 `createEdgeOneHandlers`）已經做好並有測試，但
  尚未建立 `node-functions/` 目錄、`edgeone` 設定與部署流程。要上的時候見 §5.2。
- **前後端不同網域時的 CORS**：客戶端的 `baseUrl` 與伺服器的 `ALLOWED_ORIGIN` 兩個都要設，否則請求
  會被擋掉（本機同源，所以開發時看不到這個問題）。
- **分析事件**：`design.md` §6.8 的 `events` 表與上報還沒做（schema 也還沒建）。
- **完整名稱驗證**：`handlers.ts` 的 `sanitiseName` 目前只做最低限度清洗（去控制／零寬字元、
  夾長度）。§6.4 的完整管線（32 加權單位、NFKC、字元白名單、七層關鍵詞摺疊）是後續工作，而且
  必須**客戶端與伺服器共用同一份實作** —— 兩邊各寫一套會出現「客戶端放行、伺服器退回」的錯誤。
- **`profile/sync` 與 `profile/name`**：`design.md` §6.6 列的另外兩個端點尚未實作。目前改名只有
  「下一次提交時順便更新」，所以**改了名卻沒有刷新成績，榜上就還是舊名字**（客戶端的快取會先樂觀
  更新，但下一次抓榜會被真值蓋掉）。
- **客戶端送出的是「某一局」的成績，不是存檔合併後的 profile**：解鎖清單（`endchimerge:unlocks`）
  因此仍然只存在本機。要跨裝置合併就得有 `profile/sync`。
- **還沒有在任何真的 Postgres／MySQL 上跑過**：整合測試現在一律會跑，但預設打的是記憶體 SQLite。
  SQLite 與 Postgres 幾乎同形（`on conflict`、`returning`、`nulls last`、部分索引），所以它擋得住大
  部分的語法錯誤，**但擋不住方言差異本身** —— MySQL 的 `FOUND_ROWS` 就是這樣才被抓到的。第一次部署
  前請對真的 Neon／騰訊雲各跑一次（見 §7）。
