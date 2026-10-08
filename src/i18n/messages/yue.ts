/**
 * 粵語（書面粵文）字典。
 * Cantonese, in written colloquial form.
 *
 * 短標籤（設定、排行榜、取消）港人本來就通用，所以與繁中一致；**分別在句子** —— 這裡用
 * 「嘅／咗／唔／係／喺／畀／嚟」等粵文寫法，讀起來是講出來的中文，而不是標準書面語。
 * Short labels are the same as Traditional Chinese because that is what Hong Kong software
 * already uses; the difference shows up in **sentences**, written the way Cantonese is spoken
 * (`嘅` / `咗` / `唔` / `係` / `喺` …).
 */

import type { Messages } from './zh-Hant';

export const yue: Messages = {
  'common.cancel': '取消',
  'common.close': '閂',
  'common.save': '儲存',

  /* 設計稿標籤 / Mock labels（「下一隻」用粵語量詞，其他地方亦作「兩隻方團團」） */
  'label.score': '分數',
  'label.bestTry': '最高紀錄',
  'label.merged': '合成次數',
  'label.next': '下一隻',
  'label.combo': 'COMBO',
  'label.skillList': '技能表',
  'label.meltingList': '圖鑑',
  'label.gameOver': '遊戲結束',
  'label.newBest': '新紀錄',
  'label.best': '最高紀錄',
  'label.statSuffix': '：',

  'chrome.toolbar': '工具列',
  'chrome.canvas': '遊戲容器：撳方向鍵瞄準、空白鍵投放，或者用滑鼠撳落去投放。方團團會跌喺度同埋合成。',
  'chrome.music': '音樂開關',
  'chrome.spMeter': '技力',

  'toolbar.leaderboard': '排行榜',
  'toolbar.workshop': '創意工坊（即將推出）',
  'toolbar.help': '遊戲說明',
  'toolbar.settings': '設定',
  'toolbar.restart': '再嚟過',

  /* ── 結算覆蓋層 / Game-over overlay ────────────────────────────── */
  'gameOver.aria': '遊戲結束',
  'gameOver.playAgain': '再玩多次',

  /* ── 重新開始確認 / Restart confirmation ────────────────────────── */
  'restart.title': '真係要重新開始？',
  'restart.message': '呢局嘅分數同埋進度都會重置，確定要再嚟過嗎？',
  'restart.confirm': '再嚟過啦！',

  /* ── 排行榜彈窗 / Leaderboard popup ────────────────────────────── */
  'leaderboard.title': '排行榜',
  'leaderboard.subtitle': '全時段 · Top {limit}',
  'leaderboard.close': '關閉排行榜',
  'leaderboard.emptyShare': '宜家仲未有記錄 —— 快啲玩返局先啦！',
  'leaderboard.emptyNoShare': '由於未開分享，所以你嘅分數唔會Upload上去。',
  'leaderboard.unnamed': '（未命名）',
  'leaderboard.comboValue': '{value} 連',
  'leaderboard.mergesValue': '{value} 次',
  'leaderboard.self':
    '你嘅最佳：{value}（{score} 分）· 第 {rank} 名，共 {total} 位玩家',
  /* 100 名之後唔報名次，改報超越咗百分之幾嘅玩家（使用者定案）。 */
  'leaderboard.selfBeats':
    '你嘅最佳：{value}（{score} 分）· 超越 {beats}% 嘅玩家（共 {total} 位）',
  'leaderboard.tab.score': '最高分數',
  'leaderboard.tab.combo': 'COMBO 數',
  'leaderboard.tab.merges': '合成數',

  /* ── 發布欄位 / Publish fields ─────────────────────────────────── */
  'publish.name': '顯示名稱',
  'publish.namePlaceholder': '點稱呼？',
  'publish.units': '{used} / {max} 字元',
  'publish.consent': '同意將我嘅成績Upload上去排行榜度',

  'nameError.empty': '請輸入名稱（至少 1 個字）',
  'nameError.charset': '唔接受特殊符號，只接受中英文、數字、空格同 \"_\" \"-\" \".\"',
  'nameError.tooLong': '嗰名太長（上限 {max} 字元；中文字佔 2 個字元）',

  'publishPrompt.title': 'Upload 你嘅成績',
  'publishPrompt.message': '喺度打返個名先，同意咗分享之後，你嘅成績先會Upload上去排行榜；如果想改嘅話可以去設定頁更改。',
  'publishPrompt.skip': '遲啲先',

  'skillHint.discard': '當棄即棄：揀隻唔要嘅方團團',
  'skillHint.fate_swap': '命運互換：揀兩隻方團團交換位置',
  'skillHint.generic': '揀方團團',
  'skillHint.counter': '{base}（{selected}/{total}）・撳空白地方取消',

  'skillBar.cumulative': '累計用咗技力',
  'skillBar.free': '免',
  'skillBar.ariaCumulative': '{name}（累計用咗技力 {spent}/{threshold}，免費）',
  'skillBar.ariaCost': '{name}（要 {cost} 技力）',
  'skillBar.ariaLocked': '{name}（未解鎖）',

  'settings.title': '設定',
  'settings.close': '閂咗佢',
  'settings.rules.heading': '遊戲玩法',
  'settings.rules.subtitle': '如果改咗規則嘅話，嗰局嘅成績就唔會記錄喺排行榜度',
  'settings.rules.master': '准許更改遊戲規則',
  'settings.rules.masterNote': '開咗先可以改下面啲規則；開住嗰陣嘅成績唔會記錄喺排行榜度。',
  'settings.rules.endless': '無盡模式',
  'settings.rules.endlessNote': '掂到警戒線都唔會彈 5 秒警告同結束，可以一直玩落去。',
  'settings.rules.more': '（遲啲再補）',
  'settings.language.heading': '語言',
  'settings.language.subtitle': '介面顯示語言',
  'settings.language.note': '預設跟返你部機或者瀏覽器嘅語言揀。',
  'settings.leaderboard.heading': '排行榜',
  'settings.leaderboard.subtitle': '顯示名稱同分享意願',
  'settings.leaderboard.note':
    '唔同意分享嘅話，成績唔會上排行榜。同意咗之後，之後嘅成績會自己上載，唔使你手動撳掣；隨時都可以改。',

  'help.title': '遊戲說明',
  'help.close': '閂咗佢',
  'help.play.heading': '玩法',
  'help.play.body1':
    '撳一下上面吊住嗰隻方團團，或者撳空白鍵，就可以將方團團掟落去！當兩隻一樣嘅方團團貼埋一齊，就會合成爲下一級，目標係解鎖更高級嘅方團團，同埋拎更高分！',
  'help.play.body2':
    '投放嗰陣如果連續觸發合成，就會有 COMBO 分數加成，加成會一路累加，直至有次投放冇觸發 COMBO 嘅時候就會重置。',
  'help.play.body3':
    '玩家可以善用唔同效果嘅技能嚟提高分數；當中有COMBO、投方團團就會儲到技力，技力可以兌換指定嘅技能。',
  'help.play.body4':
    '如果堆疊太高、過咗警戒線，就要喺 5 秒內盡快清走個堆疊，超時就會Game Over。',
  'help.origin.heading': '點解有呢隻Mini Game嘅？',
  'help.origin.body1':
    '《方團團大作戰》係基於《明日方舟：終末地》嘅「融合！山團團！」網頁活動玩法嘅非官方粉絲延伸版本。',
  'help.origin.body2':
    '當初玩完呢個網頁活動之後意猶未盡，硬係覺得爭咁啲樂趣，諗住如果加多啲新技能、設定、角色，會唔會更加好玩？咁啱最近又喺度學用 AI Agent（加上自己唔太熟網頁遊戲開發），打算畀 Agent 照住我嘅期望自己搞掂成個專案（但後來發現我諗多咗），結果花咗半日時間參考官方嘅山團團，再加埋自己嘅諗法，一個一個咁整出方團團（所以睇落幾乎一樣？）。之後都嘥咗幾日時間同 Agent 一路傾一路改Code（所以啲Code主要係 Agent 寫，但方團團係我自己一個一個慢慢揑出嚟嘅）。',
  'help.origin.body3':
    '希望之後得閒再慢慢加唔同&有趣嘅玩法同角色（全圖鑑？），歡迎透過 PR 一齊協作！亦都想睇下而家社群對 AI 協作產物嘅主流睇法，係咪依然都係偏向拒絕……無論如何，希望大家玩得開心！',
  'help.author.heading': '作者',
  'help.author.avatarAlt': '夜芷冰嘅頭像',
  'help.author.discordAria': '喺 Discord 度搵夜芷冰',
  'help.author.githubAria': '喺 GitHub 度睇夜芷冰',
  'help.author.server': '入嚟我地嘅 Discord 伺服器',
  'help.author.serverAria': '加入《方團團大作戰》嘅 Discord 支援伺服器',
  'help.repo.label': 'GitHub Repo',
  'help.copyright.heading': '版權聲明',

  /** 版權聲明 - 不需要粵語翻譯 */
  'help.copyright.body1':
    '請注意：本專案與鷹角網絡（Hypergryph）及 Gryphline 無關。《方團團大作戰》僅為一款由粉絲自行開發之網頁遊戲，本遊戲中使用的素材均由 夜芷冰 及 社群協作者 製作，所有角色名稱與相關美術版權歸原權利人所有。本專案原始碼版權歸夜芷冰擁有。',
  'help.copyright.body2':
    '本專案完全免費、不含內購與廣告，亦不以任何形式營利。未經夜芷冰同意，「方團團」素材不得用作商業盈利或其他有損害任一方聲譽的用途（由其他社群協作者提供的素材，請先自行徵得其同意再使用）。',
};
