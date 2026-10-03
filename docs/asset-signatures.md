# 素材元數據簽名（Asset Metadata Signatures）

> 對象：`public/assets/character/` 底下的方團團素材（SVG / PNG / WebP）。
> 目標：每一份素材都帶有**不可見**的作者、授權與日期資訊，且這件事**不會被人忘記做**。

---

## 1. 為什麼是「不可見元數據」而不是可見浮水印

| 方案 | 判斷 |
| --- | --- |
| 可見浮水印（畫面上的簽名 / Logo） | ❌ 會破壞遊戲內素材的視覺，與設計稿衝突。只用於「對外發佈版」的導出圖。 |
| **不可見元數據（本方案）** | ✅ 肉眼不可見、不影響渲染、符合 XMP / RDF 標準。 |

**核心前提，必須先講清楚**：

> SVG / PNG / WebP 都是**使用者可直接編輯**的格式。任何簽名都能被移除或覆寫。
> 這個簽名是**署名與溯源**，**不是防拷貝 / DRM**。
> 真正的保護是：授權聲明（`LICENSE-ASSETS.md`、`NOTICE.md`）＋ 署名 ＋ **git 時間戳**。

---

## 2. 簽名內容與存放位置

簽名的內容定義在 `scripts/sign-assets.mjs` 的 `SIGNER` 物件（單一真實來源）：

| 欄位 | 值 |
| --- | --- |
| `dc:creator` | `Vocaloid2048` |
| `dc:rights` | 非官方同人延伸作品；角色名稱與原設定版權屬原權利人。 |
| `dc:source` | `https://github.com/Vocaloid2048/EndchiMerge` |
| `dcterms:created` | 首次簽名日期（之後重跑會**沿用**，避免 diff 雜訊） |
| `xmp:CreatorTool` | `EndchiMerge asset-signer v1` ← 這是 `--check` 用來辨識的字串 |

按格式存放的位置：

| 格式 | 位置 |
| --- | --- |
| `.svg` | `<svg>` 之後的 `<title>` / `<desc>` / `<metadata>`（內含 `rdf:RDF`） |
| `.png` | `iTXt` chunk，keyword = `XML:com.adobe.xmp`，緊接在 `IHDR` 之後 |
| `.webp` | RIFF `XMP ` chunk；若原檔是簡單格式（無 `VP8X`），自動升級為擴充容器並設 XMP 旗標 `0x04` |

二進位格式在寫檔前會做**往返驗證**（重新走訪 chunk 結構）；結構不合法就拋錯、不寫檔。

---

## 3. 使用方式

```sh
npm run sign          # 就地補簽 public/assets/character/（可重複執行，冪等）
npm run sign:check    # 只驗證；有素材未簽名則非零退出（CI 用）

# 直接呼叫（可指定檔案或目錄）
node scripts/sign-assets.mjs public/assets/character
node scripts/sign-assets.mjs --check public/assets/character
node scripts/sign-assets.mjs --dry-run public/assets/character
```

簽名是**冪等**的：已正確簽名的檔案重跑後輸出完全相同，因此不會產生無意義的 diff。

---

## 4. 自動化：兩道防線

```
開發者 commit
     │
     ▼
┌──────────────────────────────┐
│ .githooks/pre-commit         │  ← 第一防線（真正有效）
│ 掃 staged 的 character 圖片   │
│ 補簽 → git add → 才產生 commit │
└──────────────────────────────┘
     │  push
     ▼
┌──────────────────────────────┐
│ GitHub Action                │  ← 後備防線（只能事後發現）
│ sign-assets.mjs --check      │
│ 未簽名 → build 失敗           │
└──────────────────────────────┘
```

### 4.1 pre-commit hook（主要）

* 檔案：`.githooks/pre-commit`（**版控在 repo 內**）
* 安裝：`npm install` 後由 `package.json` 的 `prepare` 執行 `scripts/install-git-hooks.mjs`，
  設定 `git config core.hooksPath .githooks`
* 只處理 `public/assets/character/` 底下、本次已 staged 的 `svg` / `png` / `webp`
* 若找不到 `node` → **擋下 commit**（寧可吵，也不要產生未簽名的歷史）

### 4.2 GitHub Action（後備）

* 檔案：`.github/workflows/verify-asset-signatures.yml`
* 觸發：`push` / `pull_request` 且路徑命中 `public/assets/character/**` 或簽名腳本
* 行為：跑 `--check`，失敗就讓 workflow 紅燈

---

## 5. ⚠️ 關鍵問題：Action 完成前的 commit，別人拿得到未簽名版本嗎？

**拿得到。而且用 GitHub Action 做「事後補簽」在架構上無法阻止這件事。**

三個獨立的原因：

1. **時序**：GitHub Actions 只能在 `push` **成功之後**才被觸發。Action 開始跑的那一刻，
   未簽名的 commit 已經存在於遠端 repo。
2. **補簽只是多加一個 commit**：若 Action 用「補簽 + 自動 commit」的方式，原本那個未簽名的
   commit 仍在歷史中，任何人用 `git fetch origin <sha>` 都能取得（SHA 可由 PR 頁面或用戶端 reflog 得知）。
3. **就算 rewrite 也來不及**：即使 Action 用 force-push 改寫分支讓未簽名 commit 從分支頂端消失，
   它仍會在物件庫中殘留一段時間，且**任何在窗口期間 fetch 過的人手上已經有一份**。

### 結論

| 做法 | 未簽名版本會不會進到遠端？ |
| --- | --- |
| **pre-commit hook**（本方案） | **不會** —— commit 物件產生前就已補簽 |
| GitHub Action 事後補簽 | 會 —— 只能亡羊補牢 |
| GitHub Action 只驗證並失敗 | 會，但至少**不會被合併進 `main`** |

因此本專案採「**hook 為主、CI 為輔**」，CI 刻意**不做**自動補簽 commit。

### 那要怎麼做到「遠端永不出現未簽名版本」？

需要**推送前**就能拒絕的機制，而 github.com 不提供自訂 server-side hook：

| 選項 | 可行性 |
| --- | --- |
| pre-commit hook（本方案） | ✅ 能做，但可被 `--no-verify` 繞過 |
| 分支保護 + 必要狀態檢查 | ⚠️ 只能保證 `main` 乾淨；feature 分支上的 commit 仍可被 fetch |
| 自架 GitLab / Gitea 的 pre-receive hook | ✅ 最徹底，但要換託管平台 |
| GitHub Enterprise Server 的 pre-receive hook | ✅ 但要付費版 |

> 務實結論：對一個免費、開源的二創專案，**hook 已經足夠**。簽名是署名與溯源，
> 不是需要嚴防外洩的機密——沒有必要為此更換託管平台。

---

## 6. 已知限制 / 威脅模型

| 限制 | 說明 |
| --- | --- |
| 可被移除 | 開文字編輯器 / 重新導出即可清掉簽名 |
| 重新導出會消失 | Illustrator、Figma、Photoshop 等重新匯出通常不保留既有 chunk |
| `--no-verify` | 可繞過 pre-commit（但 CI 會擋，且可用分支保護攔在 `main` 之外） |
| 未安裝 hook | clone 後未跑 `npm install` 就 commit → 無 hook。CI 為此存在 |
| 無法證明「誰是原作者」 | 只證明「此檔案曾被本專案簽名」，非法律證據 |

---

## 7. 相關檔案

| 檔案 | 角色 |
| --- | --- |
| `scripts/sign-assets.mjs` | 簽名 / 驗證的核心（零外部依賴） |
| `scripts/install-git-hooks.mjs` | 設定 `core.hooksPath` |
| `.githooks/pre-commit` | commit 前自動補簽 |
| `.github/workflows/verify-asset-signatures.yml` | CI 後備驗證 |
| `public/assets/character/README.md` | 素材命名與契約 |
