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
- ✅ **配置驅動**：等級、技能、容器外框、品牌文案全放在 `public/config/`，改完即時生效
- ✅ **手繪向量角色**：方團團是手繪 SVG，無限縮放不失真，輪廓白框緊貼角色剪影而非圖片邊界
- ✅ **橫向 16:9 響應式**：容器不設固定像素尺寸，等比縮放並填滿可用空間
- ✅ **退化優先**：素材或配置缺失時會降級顯示，絕不白畫面
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
```

需要 Node.js 20 或以上。
</details>

## 📂 專案結構
<details>

```
EndchiMerge
├─docs                          # 說明文件
│  ├─physics.md                 # 物理參數的推導與暫定數值說明
│  └─design-main-screen.jpg     # 主畫面設計稿
├─public                        # 原樣 serve，不經打包器
│  ├─config                     # 遊戲配置（外部化，改完不需重新 build）
│  │  ├─levels.json             # 合成鏈 10 級與各級物理參數
│  │  ├─skills.json             # 技力設定與技能表
│  │  ├─container.json          # 容器 3D 外框參數
│  │  └─branding.json           # 遊戲名、公告、repo 連結
│  └─assets                     # 素材
│     ├─sprites                 # 角色 SVG（方團團）
│     ├─icons                   # 工具列圖示
│     ├─ui                      # 面板裝飾
│     └─audio                   # 音效
├─src
│  ├─core                       # 無業務邏輯的地基
│  │  ├─types.ts                # 配置與狀態的型別定義
│  │  ├─constants.ts            # 全域常數
│  │  └─rng.ts                  # 可注入種子的亂數（供測試）
│  ├─styles
│  │  ├─main.css                # reset 與版面宿主
│  │  ├─tokens.css              # 顏色／間距／圓角變數
│  │  └─panels.css              # 面板共用樣式
│  ├─main.ts                    # 應用入口
│  └─vite-env.d.ts
├─index.html
├─package.json
├─tsconfig.json / tsconfig.app.json / tsconfig.node.json
└─vite.config.ts
```

> 遊戲邏輯（`src/game/`、`src/render/`、`src/ui/`）會隨開發進度陸續加入。完整里程碑見 `docs/`。
</details>

## <span style="color:#569CD6">🚦 開發進度</span>
| 階段 | 範圍 | 狀態 |
|:--|:--|:--:|
| M0 | 腳手架、配置系統、SVG 載入與碰撞半徑校準 | 🚧 進行中 |
| M1–M2 | 版面骨架、視覺系統、蛇形名冊與輪廓白框 | ⏳ 待辦 |
| M3–M4 | 容器渲染、投放輸入、合成核心與 Combo | ⏳ 待辦 |
| M5–M6 | 技力與技能、解鎖系統與圖鑑 | ⏳ 待辦 |
| M7–M9 | 存檔與後端同步、排行榜、分析與反作弊 | ⏳ 待辦 |
| M10 | 部署、音效、無障礙 | ⏳ 待辦 |

## 🙏 特別鳴謝
- 玩法靈感來自《明日方舟：終末地》的「山團團」，版權歸 **鷹角網絡 / Gryphline** 所有
- 角色設計版權歸 **鷹角網絡 / Gryphline** 所有，本專案只作技術示範與同人創作之用
- AI 使用聲明：本專案大部分程式碼與文件由 AI 協助生成，角色 SVG 為手繪：
  - 代碼：Claude、CodeBuddy
  - 文本：Claude

### Contributors
<a href="https://github.com/Vocaloid2048/EndchiMerge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Vocaloid2048/EndchiMerge" />
</a>

---

[English Version](README-en.md)
