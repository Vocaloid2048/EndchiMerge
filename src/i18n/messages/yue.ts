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
  'settings.rules.heading': '遊戲玩法 / 規則更改',
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
  'help.play.body':
    '撳畫面或者撳空白鍵，掟低手上呢粒方團團。兩粒一樣嘅疊埋一齊就會合成下一級，一路疊到最大嘅「梨諾」。方團團堆得太高、過咗警戒線又停低 5 秒，呢局就完。每次投放同合成都會儲技力，用嚟開當棄即棄、協議：浮動、搖晃！呢啲技能。',
  'help.origin.heading': '製作緣由',
  'help.origin.body':
    '《方團團大作戰》係一個非官方嘅粉絲同人作品：以《明日方舟：終末地》網頁活動「OrbiPom! MERGE!」嘅合成玩法做藍本，用 Matter.js 同 Canvas 由零寫起，當係技術示範同同人創作。',
  'help.author.heading': '作者',
  'help.author.body': '由 Voc-夜芷冰 開發同維護。歡迎喺 GitHub 度畀意見或者報問題。',
  'help.repo.label': 'GitHub 專案',
  'help.copyright.heading': '版權聲明',
  'help.copyright.body':
    '非官方粉絲作品，同鷹角網絡（Hypergryph）及 Gryphline 冇任何關係，亦都冇得到佢哋認可或者授權。靈感嚟自《明日方舟：終末地》嘅合成玩法；所有角色名同相關美術版權都歸原權利人所有。呢個專案完全免費、冇內購冇廣告，亦都唔會用任何形式賺錢。',
};
