# EndchiMerge - 方團團大作戰

> *「把兩顆一樣的方團團疊在一起，它們就會團圓成一顆更大的方團團。」*<br>
> 一個用物理引擎驅動的瀏覽器合成遊戲。把方團團投進玻璃容器，同級的撞在一起就會合成下一級，一路疊到最大的那顆。

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![make-with-love-and-passion](https://img.shields.io/badge/make%20with%20%E2%9D%A4%EF%B8%8F+%F0%9F%94%A5-ffcaa1)

Techstack:<br>
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)
![Matter.js](https://img.shields.io/badge/Matter.js-4B5562?style=flat)
![Canvas 2D](https://img.shields.io/badge/Canvas_2D-E34F26?style=flat&logo=html5&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat&logo=vitest&logoColor=white)


| <span style="color:#FF99CC">📢 覺得有趣的話，歡迎分享給你的朋友！</span><br> | 遊戲即將上線（Vercel） |
|-|-|
| <span style="color:#05C189">📧 提出建議或回報問題</span><br>| [歡迎 Issue 告訴我們](https://github.com/Vocaloid2048/EndchiMerge/issues) |

## <span style="color:#C3D630"> 🚧 請留意！
### 本專案是非官方粉絲作品
- 與 **鷹角網絡（Hypergryph）** 及 **Gryphline** 沒有任何關係，亦未獲其認可或授權
- 靈感來自《明日方舟：終末地》的「山團團」玩法
- 所有角色名稱與相關美術版權歸原權利人所有
- 本專案**完全免費、不設內購、不設廣告**，亦不會以任何形式營利
- 若權利人認為有不妥之處，我們會立即配合下架

### 資料收集方面
- 我們不會收集任何個人敏感資料
- 遊戲進度與設定僅儲存於您目前的瀏覽器本地快取
- 當排行榜功能上線後，只會上傳：匿名裝置 UUID、您自訂的用戶名、分數。**不含任何可識別身分的資訊**


## <span style="color:#569CD6">🏞️ 設計稿</span>
|![主畫面設計稿](docs/design-main-screen.jpg)|
|-|
|主畫面設計稿（背景美術仍在製作中）|

## <span style="color:#569CD6">🎮 玩法</span>
1. 滑鼠移動／手指滑動 → 決定方團團的落點
2. 按下（或觸碰）→ 投放當前展示的方團團
3. 兩顆**同級**的方團團碰到一起 → 合成下一級
4. 連續不斷的合成會累積 **Combo**，分數加成越高
5. 容器滿溢就結束，結算你在這局拿到的分數

> **現況**：第 1–2 步已可實際操作——方團團會真的落下、翻滾、堆疊在容器裡，NEXT 卡
> 顯示的與實際掉落的必然是同一顆；也支援方向鍵瞄準與空白／Enter 投放。
> 第 3 步之後的合成與結算尚未實作（M4 起）。

## <span style="color:#569CD6">🧩 合成鏈（10 級）</span>
拿起最小的萊萬汀，一路疊到梨諾：

| 等級 | 角色 | 等級 | 角色 |
|:--:|:--|:--:|:--|
| 1 | 萊萬汀 | 6 | 莊方宜 |
| 2 | 潔爾佩塔 | 7 | 弭弗 |
| 3 | 伊馮 | 8 | 卡繆 |
| 4 | 湯湯 | 9 | 訣 |
| 5 | 洛茜 | 10 | 梨諾 |

> 合成鏈長度、角色名稱、每一級的物理參數全部寫在 JSON 裡，加角色或改數值都不需要重新編譯程式。

## <span style="color:#569CD6">⚡ 技力與技能</span>
每成功投放一顆方團團就累積 **1.0 技力**。技力計本身就是技能的解鎖器——**看的是當前值**，所以在計量表足夠高的時候，技能才會亮起；用掉了就會即時上鎖。

| 技能 | 效果 | 消耗 |
|:--|:--|:--:|
| 捨棄 | 點選容器內其中一顆方團團，將它移除 | 1 |
| 協議：浮動 | 讓**所有**方團團向上浮起一段時間（合成機會大增） | 2 |
| 搖晃！ | 震動整個容器，把卡住的方團團抖散 | 3 |
| 命運互換 | 點選**兩顆**方團團互換位置，並牽動周邊的物理狀態 | 4 |

> 技能表同樣由 JSON 定義，技能數量並非寫死在程式裡。

## <span style="color:#569CD6">✨ 專案特色</span>
- ✅ **真物理**：由 Matter.js 驅動，重力、碰撞、堆疊全部按真實力學公式計算，參數可調
- ✅ **固定時間步**：物理以固定 1/60 秒推進，手感不隨螢幕更新率改變；單幀步數設上限，
  分頁回到前景時不會一次補完而炸開
- ✅ **配置驅動**：等級、技能、容器外框、品牌文案全放在 `public/config/`，改完即時生效
- ✅ **手繪角色**：方團團原稿為手繪向量圖，導出為 512×512 無損 WebP；輪廓白框緊貼角色剪影而非圖片邊界
- ✅ **畫面與碰撞對齊**：sprite 依碰撞半徑等比縮放，畫面中的身體與物理圓完全重合
- ✅ **退化優先**：素材或配置缺失時會降級顯示，絕不白畫面
- ✅ **可測試**：確定性邏輯（配置載入、佈局、幾何、抽樣、時間步）都有單元測試
- ✅ **開源免費**：MIT 授權，隨便玩、隨便改

## 💻 如何在本地運行
<details>

```bash
# 1. 克隆專案
git clone https://github.com/Vocaloid2048/EndchiMerge.git

# 2. 進入目錄
cd EndchiMerge

# 3. 安裝依賴
npm install

# 4. 啟動開發伺服器
npm run dev
```

其他指令：

```bash
npm run build      # 型別檢查 + 打包
npm run preview    # 預覽打包結果
npm run typecheck  # 只跑型別檢查
npm test           # 跑單元測試（Vitest，單次）
npm run test:watch # 單元測試監看模式
```

需要 Node.js 20 或以上。
</details>

## 📂 專案結構
<details>

```
EndchiMerge
├─docs                          # 說明文件
│  ├─physics.md                 # 物理參數的推導與暫定數值說明
│  ├─asset-signatures.md        # 素材元數據簽名機制
│  ├─CHANGELOG.md               # 各里程碑的變更紀錄
│  └─design-main-screen.jpg     # 主畫面設計稿
├─public                        # 原樣 serve，不經打包器
│  ├─config                     # 遊戲配置（外部化，改完不需重新 build）
│  │  ├─levels.json             # 合成鏈 10 級與各級物理參數
│  │  ├─skills.json             # 技力設定與技能表
│  │  ├─container.json          # 容器 3D 外框參數
│  │  └─branding.json           # 遊戲名、公告、repo 連結
│  └─assets                     # 素材
│     ├─character               # 方團團角色素材（<角色名>_img.webp）
│     ├─icons                   # 工具列圖示
│     ├─ui                      # 面板裝飾
│     └─audio                   # 音效
├─src
│  ├─core                       # 無業務邏輯的地基
│  │  ├─types.ts                # 配置與狀態的型別定義
│  │  ├─constants.ts            # 全域常數（含 sprite 正規化三常數）
│  │  ├─rng.ts                  # 可注入種子的亂數（供測試）
│  │  ├─configLoader.ts         # 執行期配置載入與逐欄退回
│  │  ├─physics.ts              # Matter.js 引擎封裝
│  │  └─input.ts                # 投放輸入（指標與鍵盤）
│  ├─game                       # 單局邏輯
│  │  ├─session.ts              # 投放、瞄準、剛體回收
│  │  ├─spawnQueue.ts           # 掉落佇列（NEXT 的單一真實來源）
│  │  ├─containerBox.ts         # 物理邊界（牆與地板）
│  │  └─loop.ts                 # 固定時間步的畫面迴圈
│  ├─render                     # 畫面繪製
│  │  ├─viewport.ts             # 虛擬座標系與縮放
│  │  ├─container.ts            # 容器 3D 線框幾何
│  │  ├─stage.ts                # 容器與方團團的畫布繪製
│  │  ├─spriteLoader.ts         # 素材載入與降級
│  │  └─placeholder.ts          # 程式化佔位方團團
│  ├─ui                         # DOM 介面
│  │  ├─layout.ts               # 七區域版面骨架
│  │  ├─meltingList.ts          # 蛇形名冊
│  │  ├─serpentine.ts           # 蛇形佈局演算法
│  │  ├─hud.ts                  # NEXT／SCORE 卡更新
│  │  ├─icons.ts                # 內嵌 SVG 圖示
│  │  ├─notice.ts               # 非官方聲明
│  │  └─dom.ts                  # DOM 小工具
│  ├─styles
│  │  ├─main.css                # reset、版面宿主與引入順序
│  │  ├─tokens.css              # 顏色／間距／圓角變數
│  │  ├─panels.css              # 面板共用樣式（Liquid Glass）
│  │  ├─layout.css              # 七區域版面樣式
│  │  ├─melting-list.css        # 名冊格與箭頭
│  │  └─sprite.css              # 輪廓白框
│  ├─main.ts                    # 應用入口（只做組裝）
│  └─vite-env.d.ts
├─tests                         # Vitest 單元測試（確定性邏輯）
├─scripts
│  ├─sign-assets.mjs            # 角色素材元數據簽名（SVG / PNG / WebP）
│  └─install-git-hooks.mjs      # 設定 core.hooksPath（npm install 後自動執行）
├─.githooks
│  └─pre-commit                 # commit 前自動補上素材簽名
├─.github
│  └─workflows                  # CI（素材簽名後備驗證）
├─index.html
├─package.json
├─tsconfig.json / tsconfig.app.json / tsconfig.node.json / tsconfig.test.json
├─vite.config.ts
└─vitest.config.ts
```

> 依賴方向固定為 `core/` ← `game/` ← `render/` ← `ui/` ← `main.ts`：
> 底層不知道上層存在。`render/` 不認識 Matter.js，`render/stage.ts` 吃的是純資料。
</details>

## <span style="color:#569CD6">🚦 開發進度</span>
| 階段 | 範圍 | 狀態 |
|:--|:--|:--:|
| M0 | 腳手架、配置系統、WebP 素材載入 | ✅ 已完成（**描邊快取與半徑校準原型仍缺**） |
| M1 | 版面骨架（7 區域）、座標系、視覺系統、響應式 | ✅ 已完成 |
| M2 | 蛇形名冊（自動佈局）＋ 輪廓白框 | ✅ 已完成 |
| M3 | 容器渲染（3D 外框）、投放輸入、NEXT 佇列 | ✅ 已完成 |
| M4 | 合成核心、冷卻、Combo、彈跳動畫 | 🚧 進行中 |
| M5–M6 | 技力與技能、解鎖系統與圖鑑 | ⏳ 待辦 |
| M7–M9 | 存檔與後端同步、排行榜、分析與反作弊 | ⏳ 待辦 |
| M10 | 部署、音效、無障礙 | ⏳ 待辦 |

> M0 尚未收尾的是**描邊快取**與**碰撞半徑校準原型**：`levels.json` 的半徑與物理參數
> 目前全是暫定值，待校準原型定案後會整表重算。詳細變更見 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

## 🙏 特別鳴謝
- 玩法靈感來自《明日方舟：終末地》的「山團團」，版權歸 **鷹角網絡 / Gryphline** 所有
- 角色設計版權歸 **鷹角網絡 / Gryphline** 所有，本專案只作技術示範與同人創作之用
- AI 使用聲明：本專案大部分程式碼與文件由 AI 協助生成，角色原稿為手繪：
  - 代碼：Claude、CodeBuddy
  - 文本：Claude

### Contributors
<a href="https://github.com/Vocaloid2048/EndchiMerge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Vocaloid2048/EndchiMerge" />
</a>

---

[English Version](README-en.md)
