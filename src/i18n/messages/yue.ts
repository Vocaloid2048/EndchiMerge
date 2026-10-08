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

  /* 設計稿標籤 / Mock labels（「下一粒」用粵語量詞，其他地方亦作「兩粒方團團」） */
  'label.score': '分數',
  'label.bestTry': '最高紀錄',
  'label.merged': '合成次數',
  'label.next': '下一粒',
  'label.combo': '連擊',
  'label.skillList': '技能列表',
  'label.meltingList': '圖鑑',
  'label.gameOver': '遊戲結束',
  'label.newBest': '新紀錄',
  'label.best': '最高紀錄',
  'label.statSuffix': '：',

  'chrome.toolbar': '工具列',
  'chrome.canvas': '遊戲容器：撳方向鍵瞄準、空白鍵投放，或者用滑鼠撳落去投放。方團團喺呢度跌落同合成。',
  'chrome.music': '音樂開關',
  'chrome.spMeter': '技力',

  'toolbar.leaderboard': '排行榜',
  'toolbar.workshop': '創意工坊（就快有）',
  'toolbar.help': '遊戲說明',
  'toolbar.settings': '設定',
  'toolbar.restart': '重新開始',

  'gameOver.aria': '遊戲結束',
  'gameOver.playAgain': '再玩一局',

  'restart.title': '重新開始？',
  'restart.message': '玩緊呢局嘅分數同版面都會清空，真係要重新開始？',
  'restart.confirm': '重新開始',

  'leaderboard.title': '排行榜',
  'leaderboard.subtitle': '全時段 · Top {limit}',
  'leaderboard.close': '閂咗個排行榜',
  'leaderboard.emptyShare': '仲未有紀錄 —— 快啲玩返局啦！',
  'leaderboard.emptyNoShare': '未開分享，成績唔會上榜。',
  'leaderboard.unnamed': '（未有名）',
  'leaderboard.comboValue': '{value} 連',
  'leaderboard.mergesValue': '{value} 次',
  'leaderboard.self': '你嘅最佳：{value}（{score} 分）· 贏過你自己 {percentile}% 嘅場次（共 {total} 場）',
  'leaderboard.tab.score': '最高分數',
  'leaderboard.tab.combo': 'COMBO 數',
  'leaderboard.tab.merges': '合成數',

  'publish.name': '顯示名稱',
  'publish.namePlaceholder': '入你個名',
  'publish.units': '{used} / {max} 單位',
  'publish.consent': '同意將我嘅成績顯示喺排行榜度',

  'nameError.empty': '請輸入名稱（最少 1 個字）',
  'nameError.charset': '只可以用中英文、數字、空格同 _ - .',
  'nameError.tooLong': '名稱太長（上限 {max} 單位；中文 1 字當 2 單位）',

  'publishPrompt.title': '發布你嘅成績',
  'publishPrompt.message': '入個顯示名、再同意分享，你嘅成績先會喺排行榜出現；之後想改可以去設定。',
  'publishPrompt.skip': '遲啲先',

  'skillHint.discard': '當棄即棄：揀粒要棄嘅方團團',
  'skillHint.fate_swap': '命運互換：揀兩粒方團團交換位置',
  'skillHint.generic': '揀方團團',
  'skillHint.counter': '{base}（{selected}/{total}）・撳空白地方取消',

  'skillBar.cumulative': '累計用咗技力',
  'skillBar.free': '免',
  'skillBar.ariaCumulative': '{name}（累計用咗技力 {spent}/{threshold}，免費）',
  'skillBar.ariaCost': '{name}（要 {cost} 技力）',
  'skillBar.ariaLocked': '{name}（未解鎖）',

  'settings.title': '設定',
  'settings.close': '閂咗設定',
  'settings.rules.heading': '遊戲玩法',
  'settings.rules.subtitle': '改咗規則，成績就唔會記錄喺排行榜',
  'settings.rules.master': '准許更改遊戲規則',
  'settings.rules.masterNote': '開咗先可以改下面啲規則；開住嗰陣嘅成績唔會記錄喺排行榜度。',
  'settings.rules.endless': '無盡模式',
  'settings.rules.endlessNote': '掂到警戒線都唔會彈 5 秒警告同結束，可以一直玩落去。',
  'settings.rules.more': '（遲啲再補）',
  'settings.language.heading': '語言',
  'settings.language.subtitle': '介面顯示語言',
  'settings.language.note': '預設跟你部機或者瀏覽器嘅語言揀。',
  'settings.leaderboard.heading': '排行榜',
  'settings.leaderboard.subtitle': '顯示名稱同分享意願',
  'settings.leaderboard.note': '唔同意分享嘅話，成績唔會上排行榜；之後幾時都可以返嚟改。',

  'help.title': '遊戲說明',
  'help.close': '閂咗說明',
  'help.play.heading': '玩法',
  'help.play.body1':
    '撳住上面吊住嗰粒方團團，或者撳空白鍵，就可以將方團團掟落去！兩粒一樣嘅方團團貼埋一齊就會合成上一級，目標係解鎖更高級嘅方團團，同埋拎更高分。',
  'help.play.body2':
    '投放嗰陣如果連續觸發合成，就會有 COMBO 分數加成，加成會一路累加，直至有一次投放冇觸發 COMBO 就會重置。',
  'help.play.body3':
    '玩家可以善用唔同效果嘅技能嚟提高分數；當中有連擊、投方團團就會儲到技力，技力可以兌換指定嘅技能。',
  'help.play.body4':
    '如果堆疊太高、過咗警戒線，就要喺 5 秒內盡快清走個堆疊，超時就會當呢局結束。',
  'help.origin.heading': '製作緣由',
  'help.origin.body1':
    '《方團團大作戰》係基於《明日方舟：終末地》嘅「融合！山團團！」網頁活動玩法嘅非官方粉絲延伸版本。',
  'help.origin.body2':
    '當初玩完呢個網頁活動之後意猶未盡，總覺得爭咁啲樂趣，諗住如果加多啲新技能、設定、角色，會唔會更加好玩？咁啱最近又喺度學用 AI Agent（加上自己唔太熟網頁遊戲開發），打算畀 Agent 照住我嘅期望自己搞掂成個專案（但後來發現我諗多咗），結果花咗半日時間參考官方嘅山團團，再加埋自己嘅諗法，一個一個咁整出方團團（所以睇落幾乎一樣？）。之後都花咗幾日時間同 Agent 一路傾一路改原始碼（所以原始碼主要係 Agent 寫，但方團團係我自己一個一個慢慢揑出嚟嘅）。',
  'help.origin.body3':
    '希望第日多啲空閒時間嗰陣，再慢慢加唔同有趣嘅玩法同角色（全圖鑑？），亦都好歡迎透過 PR 一齊協作！亦都想睇下而家社群對 AI 協作產物嘅主流睇法係咪依然偏向拒絕……無論如何，希望大家玩得開心！',
  'help.author.heading': '作者',
  'help.author.avatarAlt': '夜芷冰嘅頭像',
  'help.author.discordAria': '喺 Discord 度搵夜芷冰',
  'help.author.githubAria': '喺 GitHub 度睇夜芷冰',
  'help.author.server': '入 Discord 伺服器',
  'help.author.serverAria': '入《方團團大作戰》嘅 Discord 支援伺服器',
  'help.repo.label': 'GitHub 專案',
  'help.copyright.heading': '版權聲明',
  'help.copyright.body1':
    '請注意：呢個專案同鷹角網絡（Hypergryph）及 Gryphline 冇任何關係。《方團團大作戰》只係一款由粉絲自己整嘅網頁遊戲，遊戲入面用嘅素材都由 夜芷冰 同 社群協作者 製作，所有角色名同相關美術版權都歸原權利人所有。本專案原始碼版權歸夜芷冰擁有。',
  'help.copyright.body2':
    '呢個專案完全免費、冇內購冇廣告，亦都唔會用任何形式賺錢。未經夜芷冰同意，「方團團」素材唔可以用嚟商業賺錢，或者其他會損害任何一方聲譽嘅用途（由其他社群協作者提供嘅素材，請先自己徵得對方同意先用）。',
};
