/**
 * 繁體中文（香港）字典 —— 來源語言：鍵集合由它導出（`MessageKey`），其餘四個語系缺一個鍵就編譯不過。
 * Traditional Chinese (Hong Kong) — the source locale: the key set derives from it (`MessageKey`), and every other locale must match it exactly.
 *
 * 佔位符寫成 `{name}`，由 `t()` 代入（見 `src/i18n/index.ts`）。
 * Placeholders are written `{name}` and substituted by `t()`.
 */

export const zhHant = {
  /* ── 通用 / Shared ─────────────────────────────────────────────── */
  'common.cancel': '取消',
  'common.close': '關閉',
  'common.save': '儲存',

  /* ── 設計稿標籤 / Mock labels ──────────────────────────────────── */
  /*
   * 這些字在設計稿上是英文。同一組標籤會出現在兩個地方（HUD 與結算覆蓋層），所以共用同一組
   * 鍵，而不是每個畫面各寫一份 —— `label.score` 與 `label.merged` 都是兩處共用。
   * These read as English in the mock. The same labels appear in two places (the HUD and the
   * end-of-run overlay), so they share one set of keys rather than one per screen.
   */
  'label.score': '分數',
  'label.bestTry': '最高紀錄',
  'label.merged': '合成次數',
  'label.duration': '時長',
  'label.next': '下一顆',
  'label.combo': '連擊',
  'label.skillList': '技能列表',
  /*
   * 「MELTING LIST」就是圖鑑，顯示文字照那個詞走。
   * MELTING LIST is the compendium, so the displayed text follows that name.
   */
  'label.meltingList': '圖鑑',
  'label.meltingHint': '想玩不同模式？請到設定切換。',
  'mode.new': '新玩法',
  'mode.traditional': '傳統模式',
  'label.gameOver': '遊戲結束',
  'label.newBest': '新紀錄',
  'label.best': '最高紀錄',
  /*
   * 「標籤 ＋ 數值」之間的分隔號。中文用全形「：」，英文用半形「:」—— 標點也是語系的一部分，
   * 所以它是一個鍵，而不是寫死在程式或 CSS 裡。
   * The separator between a stat's label and its value. Chinese takes a fullwidth colon and
   * English a halfwidth one: punctuation is part of the locale, so it is a key rather than
   * something hard-coded in the script or the stylesheet.
   */
  'label.statSuffix': '：',

  /* ── 主畫面骨架 / Main-screen chrome ───────────────────────────── */
  'chrome.toolbar': '工具列',
  'chrome.canvas': '遊戲容器：方向鍵瞄準、空白鍵投放，或用滑鼠點擊投放。方團團在此落下與合成。',
  'chrome.music': '音樂開關',
  'chrome.musicMute': '關閉音樂',
  'chrome.musicUnmute': '開啟音樂',
  'chrome.spMeter': '技力',

  'toolbar.leaderboard': '排行榜',
  'toolbar.workshop': '創意工坊（即將推出）',
  'toolbar.help': '遊戲說明',
  'toolbar.settings': '設定',
  'toolbar.restart': '重新開始',

  /* ── 結算覆蓋層 / Game-over overlay ────────────────────────────── */
  'gameOver.aria': '遊戲結束',
  'gameOver.playAgain': '再玩一次',

  /* ── 重新開始確認 / Restart confirmation ────────────────────────── */
  'restart.title': '重新開始？',
  'restart.message': '進行中的這一局分數與版面都會清空，確定要重新開始嗎？',
  'restart.confirm': '重新開始',

  /* ── 排行榜彈窗 / Leaderboard popup ────────────────────────────── */
  'leaderboard.title': '排行榜',
  'leaderboard.subtitle': '全時段 · Top {limit}',
  'leaderboard.close': '關閉排行榜',
  'leaderboard.loading': '載入中…',
  'leaderboard.emptyShare': '還沒有紀錄 —— 先玩一局吧！',
  'leaderboard.emptyNoShare': '未開啟分享，成績不會上榜。',
  'leaderboard.unnamed': '（未命名）',
  'leaderboard.comboValue': '{value} 連',
  'leaderboard.mergesValue': '{value} 次',
  'leaderboard.self': '你的最佳：{value}（{score} 分）· 第 {rank} 名，共 {total} 位玩家',
  /*
   * 100 名之後不報名次：榜只列前 100，第 101 名起沒有對應的列可以看，改成報「超越了百分之多少的玩家」。
   * Past #100 no rank is reported: the board lists the top 100 only, so beyond that it reports the share of players beaten instead.
   */
  'leaderboard.selfBeats': '你的最佳：{value}（{score} 分）· 超越 {beats}% 的玩家（共 {total} 位）',
  'leaderboard.tab.score': '最高分數',
  'leaderboard.tab.combo': 'COMBO 數',
  'leaderboard.tab.merges': '合成數',
  'leaderboard.modeFilter': '模式篩選',
  'leaderboard.mode.all': '所有模式',
  'leaderboard.mode.new': '新玩法',
  'leaderboard.mode.traditional': '傳統模式',

  /* ── 發布欄位 / Publish fields ─────────────────────────────────── */
  'publish.name': '顯示名稱',
  'publish.namePlaceholder': '輸入你的名稱',
  'publish.units': '{used} / {max} 字元',
  'publish.consent': '同意將我的成績顯示在排行榜上',

  'nameError.empty': '請輸入名稱（至少 1 個字）',
  'nameError.charset': '只能使用中英文、數字、空白與 _ - .',
  'nameError.tooLong': '名稱太長（上限 {max} 字元；中文 1 字算 2 字元）',

  /* ── 首次發布詢問 / One-off publish prompt ─────────────────────── */
  'publishPrompt.title': '發布你的成績',
  'publishPrompt.message':
    '輸入顯示名稱並同意分享，你的成績才會出現在排行榜上；之後要修改可以到設定。',
  'publishPrompt.skip': '之後再說',

  /* ── 技能提示 / Skill hint ─────────────────────────────────────── */
  'skillHint.discard': '當棄即棄：點選要棄掉的方團團',
  'skillHint.fate_swap': '命運互換：點選兩顆方團團交換位置',
  'skillHint.ascend': '一步登天：點選要升級的方團團',
  'skillHint.generic': '點選方團團',
  'skillHint.counter': '{base}（{selected}/{total}）・點空白處取消',

  /* ── 技能欄 / Skill bar ────────────────────────────────────────── */
  'skillBar.cumulative': '累計使用技力',
  'skillBar.uses': '累計使用技能',
  'skillBar.free': '免',
  'skillBar.ariaCumulative': '{name}（累計使用技力 {spent}/{threshold}，免費）',
  'skillBar.ariaCumulativeUses': '{name}（累計使用技能 {uses}/{threshold}，免費）',
  'skillBar.ariaCost': '{name}（消耗 {cost} 技力）',
  'skillBar.ariaLocked': '{name}（未解鎖）',
  'skillBar.used': '已使用',
  'skillBar.ariaUsed': '{name}（本局已使用，不會再解鎖）',

  /* ── 技能說明 / Skill guide ────────────────────────────────────── */
  'skillGuide.open': '技能說明',
  'skillGuide.title': '技能說明',
  'skillGuide.close': '關閉技能說明',
  'skillGuide.groupPaid': '{cost} 點技力',
  'skillGuide.groupSpecial': '特殊技能',
  'skillGuide.cost': '消耗 {cost} 點技力',
  'skillGuide.costSpecial': '特殊技能',
  'skillGuide.unlockSp': '技力足夠就能發動，用掉即時上鎖。',
  'skillGuide.unlockSpent': '本局累計消耗 {threshold} 點技力後解鎖。',
  'skillGuide.unlockUses': '本局累計施放 {threshold} 次技能後解鎖。',
  'skillGuide.media': '示意圖／動畫',
  'skillGuide.desc.discard':
    '點一顆方團團，直接把它移出容器，不合成也不計分。用來清掉擋路的低級顆粒，或替大顆粒騰出空間。',
  'skillGuide.desc.ascend':
    '點一顆方團團，把它升到下一級，但下一級必須已在圖鑑解鎖。升級不計分、不計連擊，也不給技力 —— 它是一次購買。',
  'skillGuide.desc.protocol_float':
    '短時間內讓場上所有方團團向上浮起，以溢位線下方為天花板。給快要滿出來的堆疊一次喘息的機會。',
  'skillGuide.desc.scramble':
    '把場上所有方團團的位置隨機重排。重排用的是既有落點，所以顆粒不會被擠到同一點炸開。',
  'skillGuide.desc.combo_grace':
    '接下來 {drops} 次投放即使沒有合成，連擊也不會中斷。重複施放取較大值，不會累加。',
  'skillGuide.desc.shake':
    '容器左右搖晃，把堆疊搖散、讓顆粒重新落位。搖晃期間不能投放。',
  'skillGuide.desc.reshuffle':
    '清空容器，再重新落下 {count} 顆已解鎖的方團團。',
  'skillGuide.desc.fate_swap':
    '點選兩顆方團團，交換它們的位置與速度，並輕輕推開壓在新位置上的鄰居。需要兩個不同的目標。',
  'skillGuide.desc.shrink_all':
    '把場上所有方團團縮成同樣大小。已經更小的不受影響，之後合成出來的仍是原本尺寸。',
  'skillGuide.desc.square_core':
    '本局改用核心正方形判定邊緣，取代輪廓：碰撞體本身就是正方形，已經在場上與之後投放的都會換過去。本局只准用一次。',

  /* ── 設定彈窗 / Settings popup ─────────────────────────────────── */
  'settings.title': '設定',
  'settings.close': '關閉設定',
  'settings.modes.heading': '玩法模式',
  'settings.modes.subtitle': '切換後需要開新一局才會套用',
  'settings.modes.newNote': '使用新的方團團陣容與全部技能，分數上限較高。',
  'settings.modes.traditionalNote': '參照官方山團團的大小，只保留最初的 4 個技能。',
  'settings.modes.note':
    '切換會立即結束目前這一局並重新載入；兩個模式的成績與圖鑑進度各自記錄，切換回來會接回原本的進度。',
  'modeConfirm.title': '切換玩法模式？',
  'modeConfirm.message': '切換到「{mode}」後需要開新一局才會套用：目前這一局會立即結束並重新載入。',
  'modeConfirm.confirm': '切換並重新開始',
  'modeConfirm.confirmHold': '切換（{seconds}）',
  'settings.rules.heading': '遊戲玩法',
  'settings.rules.subtitle': '修改規則後，成績不會記錄在排行榜',
  'settings.rules.master': '允許更改遊戲規則',
  'settings.rules.masterNote':
    '開啟後才可調整以下規則；開啟期間的成績不會記錄在排行榜上。',
  'settings.rules.endless': '無盡模式',
  'settings.rules.endlessNote': '碰到警戒線也不會觸發 5 秒警告與結束；投放禁令不變，堆滿了就只能靠技能騰出空間。',
  'settings.rules.more': '（未來再補充）',
  'endlessConfirm.title': '開啟無盡模式？',
  'endlessConfirm.message':
    '本局的分數不會記錄在排行榜上；即使之後關掉無盡模式，這一局也不會補記。',
  'endlessConfirm.confirm': '開啟無盡模式',
  'endlessConfirm.confirmHold': '開啟（{seconds}）',
  'settings.language.heading': '語言',
  'settings.language.subtitle': '介面顯示語言',
  'settings.language.note': '預設依照你的裝置或瀏覽器語言自動選擇。',
  'settings.leaderboard.heading': '排行榜',
  'settings.leaderboard.subtitle': '顯示名稱與分享意願',
  'settings.leaderboard.note':
    '未同意分享時，成績不會上排行榜。同意之後，之後的成績會自動上載，不必再手動儲存；隨時可以回來更改。',

  /* ── 遊戲說明彈窗 / Help popup ─────────────────────────────────── */
  /*
   * 遊戲說明的內文：依原文段落切成 `body1` / `body2` …（排版一段一個 `<p>`，段落間距靠 CSS）。
   * The help popup's body copy, split into `body1` / `body2` … per original paragraph (one `<p>` each; spacing comes from CSS).
   */
  'help.title': '遊戲說明',
  'help.close': '關閉說明',
  'help.play.heading': '玩法',
  'help.play.body1':
    '透過點擊懸掛中的方團團或按空白鍵，把方團團投下吧！當兩個相同的方團團貼在一起，就會合成到下一級，目標是解鎖更高等級的方團團，以及獲取更高分數。',
  'help.play.body2':
    '當玩家在投放時連續觸發合成，就會獲得 COMBO 分數加成，加成將會累加，直至單次投放未有觸發 COMBO 則會重置。',
  'help.play.body3':
    '玩家可以善用不同效果的技能來提高分數；當中透過連擊、投下方團團獲得技力，技力可以兌換指定的技能。',
  'help.play.body4':
    '方團團不能放到警戒線以上：落點越線的那一顆不會落下。倘若堆疊仍然越過警戒線，則需要在 5 秒內盡快清除堆疊，超時後則會判定為本局結束。',
  'help.origin.heading': '製作緣由',
  'help.origin.body1':
    '《方團團大作戰》是基於《明日方舟：終末地》的「融合！山團團！」網頁活動玩法的非官方粉絲延伸版本。',
  'help.origin.body2':
    '當初在玩完這個網頁活動後意猶未盡，總感覺缺了一點樂趣，想說如果再添加一些新技能、設定、角色的話會不會更加好玩？剛好最近在嘗試學習使用 AI Agent（加上不太熟悉網頁遊戲開發），打算讓 Agent 基於我的期望自己完成整個專案（但後來發現我想太多了），結果花了半天時間參考官方的山團團、再加以自己的想法來製作一個個方團團（所以看起來幾乎一樣？）。後面也花了幾天時間來跟 Agent 一邊對答、一邊修正原始碼的部分（所以原始碼的部分主要是 Agent 編寫，但方團團是我自己一個個慢慢捏出來的）。',
  'help.origin.body3':
    '希望日後有更多空閒時間時，再慢慢添加不同有趣的玩法和角色（全圖鑑？），也十分歡迎透過 PR 協作！也想看看現在社群對於 AI 協作產物的主流看法是否依然偏向拒絕……不論如何，希望大家玩得開心！',
  'help.author.heading': '作者',
  'help.author.avatarAlt': '夜芷冰的頭像',
  'help.author.discordAria': '在 Discord 上聯絡夜芷冰',
  'help.author.githubAria': '在 GitHub 上查看夜芷冰',
  'help.author.server': '加入 Discord 伺服器',
  'help.author.serverAria': '加入《方團團大作戰》的 Discord 支援伺服器',
  'help.repo.label': 'GitHub 專案',
  'help.music.heading': '音樂',
  'help.music.lead': '背景音樂',
  'help.music.license': '授權',
  'help.music.promoted': '音樂推廣',
  'help.music.download': '免費下載／串流',
  'help.copyright.heading': '版權聲明',
  'help.copyright.body1':
    '請注意：本專案與鷹角網絡（Hypergryph）及 Gryphline 無關。《方團團大作戰》僅為一款由粉絲自行開發之網頁遊戲，本遊戲中使用的素材均由 夜芷冰 及 社群協作者 製作，所有角色名稱與相關美術版權歸原權利人所有。本專案原始碼版權歸夜芷冰擁有。',
  'help.copyright.body2':
    '本專案完全免費、不含內購與廣告，亦不以任何形式營利。未經夜芷冰同意，「方團團」素材不得用作商業盈利或其他有損害任一方聲譽的用途（由其他社群協作者提供的素材，請先自行徵得其同意再使用）。',
  /* ── 遊戲選單與返回 / Game menu and back ──────────────────────── */
  'menu.title': '選擇遊戲',
  'menu.planned': '即將推出',
  'game.merge.name': '團圓大作戰',
  'game.citybloxx.name': '城市方塊',
  'game.match3.name': '消消樂',
  'chrome.back': '返回選單',
  'back.title': '返回選單？',
  'back.message': '這一局已經開始，返回前會先記錄目前的分數。',
  'back.confirm': '返回選單',
  'mobile.rotateTitle': '請把裝置橫放',
  'mobile.rotateBody': '容器與技能列只在橫向放得下；橫放之後會自動進入全螢幕。',
  'mobile.landscape': '橫向並全螢幕',
} as const;

/** 所有訊息的鍵。其餘語系都要提供完整的一組。 */
export type MessageKey = keyof typeof zhHant;

/** 一份完整的字典。 */
export type Messages = Record<MessageKey, string>;
