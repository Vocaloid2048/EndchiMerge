# 後端

這份文件說明 M9 交付的後端：它由什麼組成、怎麼設定、部署到哪裡，以及**資料庫可以放哪裡** ——
最後一項是使用者明確問的三個問題，答案在「§4 資料庫放哪裡」。

> **範圍**：M9 = 分析事件 ＋ 反作弊檢查（`design.md` §8）。反作弊只做 **T2**（伺服器頒發的短期
> 憑證），不做 T1 對稱簽章、也不做 T3 伺服器端重放 —— 這是使用者的定案。

---

## 1. 現況

後端是**三個端點**，跑在 Vercel Functions 上，資料庫是**任何 Postgres**。

| Method | Path                | 用途                                                       |
| ------ | ------------------- | -------------------------------------------------------- |
| `POST` | `/api/run/start`    | 開一局：伺服器鑄一張短期憑證（T2 的關鍵）                                   |
| `POST` | `/api/score`        | 提交成績：驗憑證 → 驗時間 → 驗合理性 → 寫榜                                |
| `GET`  | `/api/leaderboard`  | 取榜（`?limit=N`，預設 100、上限 200），附查詢者的自身名次                     |
| `GET`  | `/api/health`       | 自我檢查：**真的問一次資料庫**，回方言名稱與玩家數                                |

**資料庫支援 Postgres 與 MySQL 兩種方言**，共用同一份業務邏輯 —— 見 §5。
**The database supports both Postgres and MySQL**, sharing one copy of the business logic — see §5.

**架構不變**（`design.md` §6.1）：local-first。遊玩中只寫本地，破紀錄時非同步推送；開局載入時拉
伺服器 profile 合併。

> ⚠️ **客戶端尚未接上**。`src/game/leaderboard.ts` 目前仍走**本地**的 `LeaderboardSource`；
> `sync()` 是早就預留好的接縫（見 §8）。伺服器端已經可以用，但要等客戶端換成 HTTP 實作之後，
> 榜上才會真的出現別的裝置的成績。

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
      dialect.ts      **兩個方言之間所有差異的唯一去處** ＋ Binder
      postgres.ts     pg 驅動 ＋ Postgres 方言
      mysql.ts        mysql2 驅動 ＋ MySQL 方言
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
scripts/migrate.ts    npm run db:migrate —— 建表
```

**分層的理由**：端點檔案只匯出一行，所有邏輯住 `_lib`。這樣單元測試可以**不碰資料庫**直接呼叫
處理器（餵 `MemoryStore` ＋ 注入時鐘），見 `tests/api.test.ts`。**平台**與**方言**各自只有一個接縫，
所以要換掉任何一個都只動一個檔案。

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
| `DATABASE_URL`         | ✅  | —           | 任何 **Postgres 或 MySQL**。Neon 請用帶 **`-pooler`** 的主機名        |
| `DB_DIALECT`           |    | 從 URL 推斷     | `postgres` / `mysql`；看不出 scheme 或猜錯時才需要填                 |
| `RUN_TOKEN_SECRET`     | ✅  | —           | **≥ 32 字元**，短於此會被當成缺漏（短秘密等於沒有秘密）                       |
| `IP_STORAGE_MODE`      |    | `truncated` | `raw` / `truncated`（IPv4→/24、IPv6→/48）/ `hashed`（帶秘密 HMAC） |
| `IP_HASH_SECRET`       |    | 退回 token 秘密 | 與前者分開：輪替時機不同                                           |
| `ALLOWED_ORIGIN`       |    | 空（只同源）      | 前端不在同一個網域時必填（例如前端在騰訊 EdgeOne Pages）                     |
| `SUBMISSIONS_PER_HOUR` |    | `20`        | 每裝置每小時提交上限（含被退回的）                                      |
| `RUNS_PER_HOUR`        |    | `120`       | 每裝置每小時開局上限（防無限鑄造憑證）                                    |

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
| **本機開發／測試**           | 本地 Docker 容器或 NAS（見 §6）                                   |
| **自架版發行（Docker 三容器）** | NAS 上的 Postgres 或 MySQL ＋ 連線池，`design.md` §6.1 / Q15 的方向    |

> 這對應 `design.md` 的 **Q10（DB 選型）**：Vercel 走 **Neon**、騰訊走 **MySQL**，兩者都支援。
> **Q15（託管分工）** 因此更進一步收斂：可移植性現在不只是 「換一個環境變數」，而是「換一個環境變數
> ＋ 一個轉接頭」。

---

## 5. 共用程式碼：兩個方言、兩個平台

這一節是整個後端設計的**理由**。同一個後端要跑在四個角落，而它們兩兩不同：

|           | 執行環境                      | 資料庫                                   |
| --------- | ------------------------- | ------------------------------------- |
| **Vercel** | Node 函式（`req`/`res`）      | Neon ＝ **Postgres**                   |
| **EdgeOne** | Web 標準（`Request`/`Response`） | 腾讯云 **MySQL**（免費版／TDSQL-C）           |
| **自架**     | Node ＋ Docker             | 兩者皆可（`DATABASE_URL` 決定）               |

所以切成**兩個接縫**，各自只有一個檔案要知道差異：

| 接縫 | 位置 | 換掉它要動什麼 |
| --- | --- | --- |
| **平台** | `adapters/` | 一個檔案（`vercel.ts` / `fetch.ts`） |
| **方言** | `db/` | 一個檔案（`postgres.ts` / `mysql.ts`） |

中間的一切 —— `handlers.ts` 的反作弊、`sqlStore.ts` 的榜的邏輯、`requests.ts` 的標頭白名單 —— **一行
都不用重複**。這不是「順便」：重複的邏輯會漂移，而漂移的症狀是「Vercel 上正常、騰訊上分數算錯」，
那是最難查的一種 bug。

### 5.1 方言：差異集中在 `Dialect`

| 項目 | Postgres | MySQL |
| --- | --- | --- |
| 佔位符 | `$1, $2` | `?` |
| 時間型別 | `timestamptz` | `datetime(3)`（UTC） |
| 時間參數 | ISO 字串 ＋ `::timestamptz` | `Date` 物件 |
| 讀時間 | `extract(epoch …) * 1000` | `Date.getTime()` |
| 布林 | `true` / `false` | `1` / `0` |
| JSON | `jsonb` | `json` |
| 唯一鍵衝突 | `on conflict … do nothing` | `on duplicate key update` |
| 插入是否成功 | `returning` 的行數 | `affectedRows` |
| 空值排序 | `nulls last` | 沒有，要寫 `best_at is null` 排在前面 |
| `count(*)` | 回 bigint（字串）→ 要 `::int` | 回數字 |

`Dialect` 提供「語法」，`sqlStore.ts` 提供「邏輯」。語法分成兩種：三個寫入語句形狀差太多，各自寫在
自己的方言裡；其餘的 SELECT 用 `Binder` 產生。

**`Binder` 是同一份 SQL 能同時餵兩邊的關鍵。** 兩種佔位符的差異不只是文字：`$1` 可以引用多次而只傳
一份值，`?` 是**位置性**的、每次出現都吃掉一個參數。所以 `rankOf` 裡「同一個分數出現三次」在
Postgres 只要一個參數、在 MySQL 要三個 —— 修法是**每一次出現都綁一次**，Postgres 那邊多幾個沒必要
的參數，換來兩邊共用一份 SQL 文字。`tests/dialect.test.ts` 與 `tests/sqlStore.test.ts` 都有針對
「佔位符數 ＝ 參數數」的斷言。

> **三個容易出事的細節，都有測試守住：**
> 1. **`upsertProfile` 的欄位順序在 MySQL 是有意義的** —— `on duplicate key update` 由左至右求值，
>    所以 `best_score` 必須排在拿它比較的 `best_duration_ms`／`best_at` **之後**，否則時長永遠不會
>    跟著分數更新，而且不會報錯。
> 2. **不用 `insert ignore`** —— 它會把所有錯誤吞成警告，不只是重複鍵。
> 3. **不設 `FOUND_ROWS`** —— 那個 flag 會讓刻意的 no-op upsert 回報 `affectedRows = 1`，於是每個
>    重試都被當成新的一局。

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

1. **建資料庫**：Vercel 專案 → Storage → Marketplace → **Neon** → 建一個免費資料庫。Vercel 會自動
   把 `DATABASE_URL`（帶 `-pooler`）注入環境變數。
2. **建表**（兩種方式，選一個）：
   ```bash
   npm run db:migrate                       # 讀 .env 的 DATABASE_URL，兩個方言都支援
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

## 7. 測試

四層，**前三層不需要資料庫**：

| 檔案 | 測什麼 | 需要資料庫 |
| --- | --- | --- |
| `tests/api.test.ts` | 處理器：開局 → 提交 → 上榜、冪等、速率、憑證、合理性、健康檢查 | ✗ |
| `tests/dialect.test.ts` | 方言：佔位符、排序、upsert 順序、建表可重複執行、錯誤分類 | ✗ |
| `tests/sqlStore.test.ts` | 儲存層邏輯：**佔位符數 ＝ 參數數**、冪等的兩條路、交易與回滾、列轉換 | ✗ |
| `tests/db.integration.test.ts` | 真的 SQL：建表、憑證、最大值、同分名次、JSON 欄位、交易原子性 | **✓ gated** |

```bash
npm run typecheck
npx vitest run                # 前三層；整合層自動跳過

# 想把整合層也跑起來（**指向一個拋棄式的實例**）
TEST_DATABASE_URL='postgresql://…' npx vitest run tests/db.integration.test.ts
TEST_DATABASE_URL='mysql://…'      npx vitest run tests/db.integration.test.ts
```

### 為什麼整合測試是 gated 的

它**預設不跑**（`describe.skipIf`），因為這個 repo 與 CI 不該為了跑測試而背一個資料庫。但
**單元測試永遠測不到真 SQL**：`sqlStore.test.ts` 的假驅動驗的是「我們產生了什麼」，整合測試驗的是
「資料庫真的接受它」。兩者的交集才是「能跑」，而那個交集只有在真的連上去之後才存在 —— 尤其是 MySQL
的 `upsertProfile` 欄位順序，假驅動怎麼測都測不到。

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

- **客戶端接上 HTTP**：把 `src/game/leaderboard.ts` 的 `createLocalLeaderboard` 換成走
  `/api/leaderboard` 與 `/api/score` 的實作。`sync()` 這個方法就是為此預留的；`LeaderboardSource`
  介面維持不變，玩家側的程式碼不用動。
- **EdgeOne 骨架**：轉接層（`adapters/fetch.ts` 的 `createEdgeOneHandlers`）已經做好並有測試，但
  尚未建立 `node-functions/` 目錄、`edgeone` 設定與部署流程。要上的時候見 §5.2。
- **分析事件**：`design.md` §6.8 的 `events` 表與上報還沒做（schema 也還沒建）。
- **完整名稱驗證**：`handlers.ts` 的 `sanitiseName` 目前只做最低限度清洗（去控制／零寬字元、
  夾長度）。§6.4 的完整管線（32 加權單位、NFKC、字元白名單、七層關鍵詞摺疊）是後續工作，而且
  必須**客戶端與伺服器共用同一份實作** —— 兩邊各寫一套會出現「客戶端放行、伺服器退回」的錯誤。
- **`profile/sync` 與 `profile/name`**：`design.md` §6.6 列的另外兩個端點尚未實作。
- **整合測試尚未在任何真資料庫上跑過**：`tests/db.integration.test.ts` 已經寫好，但這個環境沒有
  Docker 或 `psql`，所以兩個方言都還沒被真的執行過。**第一次部署前請務必跑一次**（見 §7）——
  尤其是 MySQL 那條路。
