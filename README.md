# EndchiMerge - 方團團大作戰

![alt text](docs/endchi-screenshot.png)

> *「把兩顆一樣的方團團疊在一起，它們就會團圓成一顆更大的方團團。」*<br>
> *「為咗盡力還原原作，所以啲角、翼、耳（尤其係訣）都有碰撞框判定 OuOb」*

[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![AI Contribution](https://raw.githubusercontent.com/Essk/ai-contribution-level/main/badges/level-4.svg)](https://github.com/Essk/ai-contribution-level)


![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-B73BFE?style=flat&logo=vite&logoColor=FFD62E)
![Matter.js](https://img.shields.io/badge/Matter.js-4B5562?style=flat)
![Canvas 2D](https://img.shields.io/badge/Canvas_2D-E34F26?style=flat&logo=html5&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat&logo=vitest&logoColor=white)


| <span style="color:#FF99CC">📢 覺得有趣的話，歡迎分享給你的朋友！</span><br> | [按我試玩](https://endchi.voc2048.com) [騰訊雲](https://cn-endchi.voc2048.com) |
|-|-|
| <span style="color:#05C189">📧 提出建議或回報問題</span><br>| [歡迎 Issue 告訴我們](https://github.com/Vocaloid2048/EndchiMerge/issues) |

## <span style="color:#C3D630"> 🚧 請留意！
### 本專案為非官方粉絲作品
- 《方團團大作戰》是基於《明日方舟：終末地》的「融合！山團團！」網頁活動玩法的非官方粉絲延伸版本。
- 靈感及玩法參考至上述玩法
- 本專案**完全免費**，亦不會以內購、廣告等任何形式營利

### 資料收集方面
- 我們不會收集任何可識別個人資訊
- 惟若發現任何可疑行為（例如作弊、濫用），我們可能會阻止該IP位址日後的所有訪問。

### AI 使用聲明
- 本專案中，方團團為全手繪，使用 AI Agent 生成程式碼與部分文件
![Figma Endchi](docs/figma-endchi.png)

### 版權聲明
請注意：本專案與鷹角網絡（Hypergryph）及 Gryphline 無關。《方團團大作戰》僅為一款由粉絲自行開發之網頁遊戲，本遊戲中使用的素材均由 夜芷冰 及 社群協作者 製作，所有角色名稱與相關美術版權歸原權利人所有。本專案原始碼版權歸夜芷冰擁有。

本專案完全免費、不含內購與廣告，亦不以任何形式營利。未經夜芷冰同意，「方團團」素材不得用作商業盈利或其他有損害任一方聲譽的用途（由其他社群協作者提供的素材，請先自行徵得其同意再使用）。

## <span style="color:#569CD6">🗂️ 遊戲選單</span>

開站先見選單：一格一個遊戲（圖示在上、遊戲名在下），按下即進入；遊戲畫面左上角的返回鍵回到選單。

- 網址 `?game=merge` 直接進《團圓大作戰》，不帶參數就是選單。切換一律重新載入 —— 等級表、物理世界與排行榜憑證都只在進入遊戲的那一刻才建立。
- 已開局（投放過至少一顆）的局按返回會先彈確認，確認鈕鎖五秒；一顆都未投則直接返回。取消則留在原局，狀態不變。
- 未推出的遊戲（城市方塊、消消樂）在選單上標「即將推出」並停用。
- 加入新遊戲＝在 `src/game/gameCatalog.ts` 加一筆，再在 `src/main.ts` 加一個啟動分支；步驟見 `docs/menu.md`。

## <span style="color:#569CD6">🎮 玩法</span>
透過點擊懸掛中的方團團或按空白鍵，把方團團投下吧！當兩個相同的方團團貼在一起，就會合成到下一級，目標是解鎖更高等級的方團團，以及獲取更高分數。

當玩家在投放時連續觸發合成，就會獲得 COMBO 分數加成，加成將會累加，直至單次投放未有觸發 COMBO 則會重置。

玩家可以善用不同效果的技能來提高分數；當中透過連擊、投下方團團獲得技力，技力可以兌換指定的技能。

倘若堆疊太高超過警戒線，則需要在 5 秒內盡快清除堆疊，超時後則會判定為本局結束。

## <span style="color:#569CD6">🧩 合成鏈/圖鑑</span>

| 等級 | 角色 | 等級 | 角色 |
|:--:|:--|:--:|:--|
| 1 | 萊萬汀 | 6 | 莊方宜 |
| 2 | 潔爾佩塔 | 7 | 弭弗 |
| 3 | 伊馮 | 8 | 卡繆 |
| 4 | 湯湯 | 9 | 訣 |
| 5 | 洛茜 | 10 | 梨諾 |


## <span style="color:#569CD6">⚡ 技力與技能</span>
| 技能 | 效果 | 消耗 |
|:--|:--|:--:|
| 當棄即棄！ | 點選容器內其中一顆方團團，將它移除；上方的方團團會跟着塌落 | 1 |
| 協議：浮動 | 讓**所有**方團團向上浮起一段時間（合成機會大增），升到警戒區下方的一片隱形平面就停住 | 2 |
| 搖晃！ | 像地震一樣左右震動整個容器，把卡住的方團團抖散 | 3 |
| 命運互換 | 點選**兩顆**方團團互換位置，並牽動周邊的物理狀態 | \* |

> \* 解鎖條件：**累計消耗滿 6 點技力**後解鎖，使用後累計歸零，如此類推。

> 技能表同樣由 JSON 定義，技能數量並非寫死在程式裡；技力上限預設 3（可設為 1–10 的正整數）。
> 技能的扣費時機是**效果成功執行**時——選取中不扣、取消不退。技能作用期間（含正在選取目標）
> **禁止投放**。

## 🤔 製作緣由
當初在玩完這個網頁活動後意猶未盡，總感覺缺了一點樂趣，想說如果再添加一些新技能、設定、角色的話會不會更加好玩？

剛好最近在嘗試學習使用 AI Agent（加上不太熟悉網頁遊戲開發），打算讓 Agent 基於我的期望自己完成整個專案（但後來發現我想太多了），結果花了半天時間參考官方的山團團、再加以自己的想法來製作一個個方團團（所以看起來幾乎一樣？）。

後面也花了幾天時間來跟 Agent 一邊對答、一邊修正原始碼的部分（所以原始碼的部分主要是 Agent 編寫，但方團團是我自己一個個慢慢捏出來的）。

希望日後有更多空閒時間時，再慢慢添加不同有趣的玩法和角色（全圖鑑？），也十分歡迎透過 PR 協作！也想看看現在社群對於 AI 協作產物的主流看法是否依然偏向拒絕……

不論如何，希望大家玩得開心！

## 💻 如何在本地運行
<details>
建議使用 Node.js 22 或以上版本。

```bash
# 1. 克隆專案
git clone https://github.com/Vocaloid2048/EndchiMerge.git

# 2. 進入目錄
cd EndchiMerge

# 3. 安裝依賴
npm install

# 4. 啟動開發伺服器（前端 ＋ 後端 ＋ 資料庫，一個指令）
npm run dev
```

其他指令：

```bash
npm run build      # 型別檢查 + 打包
npm run preview    # 預覽打包結果
npm run typecheck  # 只跑型別檢查
npm test           # 跑測試（Vitest，單次；含真的 SQL，資料庫在記憶體裡）
npm run test:watch # 測試監看模式
npm run dev:web    # 只起前端（純 UI 改動用，打不到 API）
npm run db:migrate # 對 DATABASE_URL 指的資料庫建表（三個方言都支援）
```
</details>

### Contributors
<a href="https://github.com/Vocaloid2048/EndchiMerge/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Vocaloid2048/EndchiMerge" />
</a>

---

## <span style="color:#569CD6">🎵 音樂版權</span>

遊戲背景音樂採用 **Take A Walk** by Hotham，謹此致謝。

- **Music**: Take A Walk by Hotham — https://soundcloud.com/hothammusic
- **License**: Creative Commons — Attribution 3.0 Unported — CC BY 3.0
- **Free Download / Stream**: https://links.al/elY
- **Music promoted by Audio Library**: https://links.al/youtube

---

[English Version](README-en.md)
