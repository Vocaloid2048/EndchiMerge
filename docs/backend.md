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

**架構不變**（`design.md` §6.1）：local-first。遊玩中只寫本地，破紀錄時非同步推送；開局載入時拉
伺服器 profile 合併。

> ⚠️ **客戶端尚未接上**。`src/game/leaderboard.ts` 目前仍走**本地**的 `LeaderboardSource`；
> `sync()` 是早就預留好的接縫（見 §7）。伺服器端已經可以用，但要等客戶端換成 HTTP 實作之後，
> 榜上才會真的出現別的裝置的成績。

### 檔案佈局

```
api/
  run/start.ts        薄轉接頭：export default endpointOf(handleRunStart)
  score.ts            薄轉接頭：export default endpointOf(handleScore)
  leaderboard.ts      薄轉接頭：export default endpointOf(handleLeaderboard)
  _lib/
    env.ts            環境變數 → Config（純函式，啟動時驗完）
    http.ts           ApiRequest / ApiResponse、欄位讀取、Vercel 轉接
    tokens.ts         簽章、驗章、指紋、run_id 產生
    limits.ts         上界（從遊戲配置推導）＋ 合理性檢查
    requests.ts       客戶端 IP、標頭白名單、接收紀錄列的組裝
    store.ts          Store 介面 ＋ MemoryStore（測試用）
    pgStore.ts        Store 的 Postgres 實作（模組層級連線池）
    handlers.ts       三個端點的核心邏輯（不含平台細節）
    runtime.ts        外殼：設定、接收紀錄、CORS、500 收斂
schema.sql            四張表（任何 Postgres 皆可）
vercel.json           建置設定與函式逾時
.env.example          環境變數的鍵名與說明（**只放鍵名，不放值**）
```

**分層的理由**：端點檔案只匯出一行，所有邏輯住 `_lib`。這樣單元測試可以**不碰資料庫**直接呼叫
處理器（餵 `MemoryStore` ＋ 注入時鐘），見 `tests/api.test.ts`。

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
| `DATABASE_URL`         | ✅  | —           | 任何 Postgres。Neon 請用帶 **`-pooler`** 的主機名                  |
| `RUN_TOKEN_SECRET`     | ✅  | —           | **≥ 32 字元**，短於此會被當成缺漏（短秘密等於沒有秘密）                       |
| `IP_STORAGE_MODE`      |    | `truncated` | `raw` / `truncated`（IPv4→/24、IPv6→/48）/ `hashed`（帶秘密 HMAC） |
| `IP_HASH_SECRET`       |    | 退回 token 秘密 | 與前者分開：輪替時機不同                                           |
| `ALLOWED_ORIGIN`       |    | 空（只同源）      | 前端不在 Vercel 上時必填（例如騰訊 EdgeOne Pages）                     |
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
| **Neon**（推薦）    | Serverless Postgres | 免費層寬鬆、**內建 pooler**、分支／時光回溯；Vercel 原生整合    |
| **Supabase**    | Postgres ＋ 周邊 | 帶 Auth／Storage／Realtime；這個專案用不到那些，但也不妨礙    |
| **Upstash**     | Redis        | 是 KV 不是 SQL，**不適用**本專案（榜要排序與聚合）           |

從 Marketplace 開一個 Neon，Vercel 會**自動把 `DATABASE_URL` 注入**專案的環境變數，不必手抄。
所以「在 Vercel 架小型資料庫」的正解是：**在 Vercel 的 Marketplace 開一個 Neon**，而不是找
Vercel 自家的東西。

### Q3：那到底該選哪個？

| 情境                    | 建議                                                       |
| --------------------- | -------------------------------------------------------- |
| **公開站正式部署**           | **Neon**（Marketplace 開，免費層起步）。內建 pooler、無動態 IP 問題、零維運 |
| **本機開發／測試**           | 本地 Docker 容器或 NAS（見 §5）                                   |
| **自架版發行（Docker 三容器）** | NAS 上的 Postgres ＋ PgBouncer，`design.md` §6.1 / Q15 的方向      |

> 這對應 `design.md` 的 **Q10（DB 選型）**：建議定為 **Neon**，其他 Postgres 保持可換（`pgStore.ts`
> 刻意只用標準 SQL）。**Q15（託管分工）** 仍未完全收斂，但本後端兩個方向都支援 —— 差別只是
> `DATABASE_URL`。

---

## 5. 部署到 Vercel

1. **建資料庫**：Vercel 專案 → Storage → Marketplace → **Neon** → 建一個免費資料庫。Vercel 會自動
   把 `DATABASE_URL`（帶 `-pooler`）注入環境變數。
2. **建表**：把 `schema.sql` 套到那個資料庫。
   ```bash
   psql "$DATABASE_URL" -f schema.sql
   ```
3. **加秘密**：Vercel → Project Settings → Environment Variables 填 `RUN_TOKEN_SECRET`（≥ 32 字元）。
   其餘選填見 `.env.example`。
4. **部署**：推上 Git，Vercel 依 `vercel.json` 建置（`npm run build` → `dist`）。三個端點自動生效。
5. **前端若不在 Vercel 上**：把前端的網域填進 `ALLOWED_ORIGIN`，否則瀏覽器會擋下回應。

**本機開發**（任何 Postgres 皆可）：

```bash
# 用 Docker 起一個 local Postgres
docker run -d --name endchi-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/postgres"
export RUN_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
psql "$DATABASE_URL" -f schema.sql
npm run dev
```

驗證：

```bash
# 開一局應該拿到一張憑證
curl -s localhost:3000/api/run/start -X POST -H 'content-type: application/json' \
  -d '{"deviceId":"dev-00000000-1111"}'
# 取榜
curl -s 'localhost:3000/api/leaderboard?limit=10'
```

---

## 6. 測試

後端測試**不需要資料庫**：端點只依賴 `Store` 介面，測試餵它 `MemoryStore`（`api/_lib/store.ts`）。
所以「開局 → 提交 → 上榜」整條路徑跑在毫秒內，而且驗的是**真的處理器**，不是替身。

```bash
npm run typecheck          # 含 api/（tsconfig.api.json）
npx vitest run tests/api.test.ts
```

`tests/api.test.ts` 覆蓋：設定的缺漏與預設、上界與配置同步、憑證的簽／驗／防竄改、時間的單邊
檢查、接收紀錄的位址正規化與**憑證永不入庫**、以及端到端（開局 → 提交 → 上榜、冪等重試、速率
限制、裝置不符、過期、偽造）。

`MemoryStore` 與 `PgStore` 都符合 `Store` 介面 —— 測試檔結尾有 `const storeContract: Store =
new MemoryStore()`，讓「介面改了但實作沒跟上」在型別檢查就爆。

---

## 7. 待辦與接縫

- **客戶端接上 HTTP**：把 `src/game/leaderboard.ts` 的 `createLocalLeaderboard` 換成走
  `/api/leaderboard` 與 `/api/score` 的實作。`sync()` 這個方法就是為此預留的；`LeaderboardSource`
  介面維持不變，玩家側的程式碼不用動。
- **分析事件**：`design.md` §6.8 的 `events` 表與上報還沒做（schema 也還沒建）。
- **完整名稱驗證**：`handlers.ts` 的 `sanitiseName` 目前只做最低限度清洗（去控制／零寬字元、
  夾長度）。§6.4 的完整管線（32 加權單位、NFKC、字元白名單、七層關鍵詞摺疊）是後續工作，而且
  必須**客戶端與伺服器共用同一份實作** —— 兩邊各寫一套會出現「客戶端放行、伺服器退回」的錯誤。
- **`profile/sync` 與 `profile/name`**：`design.md` §6.6 列的另外兩個端點尚未實作。
- **`_lib/store.ts` 的 `PgStore` 尚未在真實 Postgres 上跑過**：目前只經 `pgStore.ts` 的 SQL 與
  `MemoryStore` 的行為對齊驗證。第一次接真資料庫時要先跑一次 §5 的建表與端到端。
