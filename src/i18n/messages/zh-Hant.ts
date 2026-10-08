/**
 * 繁體中文（香港）字典 —— **來源語言**。
 * Traditional Chinese (Hong Kong) — the **source** locale.
 *
 * 這一支是翻譯的唯一真實來源：鍵集合由它導出（`MessageKey`），其餘四個語系都必須提供同樣
 * 的鍵，缺一個就編譯不過。要新增文案，先加在這裡。
 * This file is the single source of truth for translations: the key set is derived from it
 * (`MessageKey`), and the other four locales must supply every key or the build fails. Add new
 * copy here first.
 *
 * 佔位符寫成 `{name}`，由 `t()` 代入（見 `src/i18n/index.ts`）。
 * Placeholders are written `{name}` and substituted by `t()`.
 *
 * **設計稿標籤**（`label.*`）原本刻意不翻譯，使用者後來定案要跟著語系走，因此已列進字典。
 * 英文字典照原樣收錄，因為那幾個字本來就是英文原文。
 * The **mock's own labels** (`label.*`) used to be left untranslated on purpose; the user has
 * since decided they should follow the locale, so they are in the tables now. The English table
 * carries them verbatim, since those strings are already the English original.
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
  'label.next': '下一顆',
  'label.combo': '連擊',
  'label.skillList': '技能列表',
  /* 使用者定案「MELTING LIST 就是圖鑑」（docs/CHANGELOG.md），所以照那個詞走。 */
  'label.meltingList': '圖鑑',
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
  'leaderboard.emptyShare': '還沒有紀錄 —— 先玩一局吧！',
  'leaderboard.emptyNoShare': '未開啟分享，成績不會上榜。',
  'leaderboard.unnamed': '（未命名）',
  'leaderboard.comboValue': '{value} 連',
  'leaderboard.mergesValue': '{value} 次',
  'leaderboard.self': '你的最佳：{value}（{score} 分）· 第 {rank} 名，共 {total} 位玩家',
  'leaderboard.tab.score': '最高分數',
  'leaderboard.tab.combo': 'COMBO 數',
  'leaderboard.tab.merges': '合成數',

  /* ── 發布欄位 / Publish fields ─────────────────────────────────── */
  'publish.name': '顯示名稱',
  'publish.namePlaceholder': '輸入你的名稱',
  'publish.units': '{used} / {max} 單位',
  'publish.consent': '同意將我的成績顯示在排行榜上',

  'nameError.empty': '請輸入名稱（至少 1 個字）',
  'nameError.charset': '只能使用中英文、數字、空白與 _ - .',
  'nameError.tooLong': '名稱太長（上限 {max} 單位；中文 1 字算 2 單位）',

  /* ── 首次發布詢問 / One-off publish prompt ─────────────────────── */
  'publishPrompt.title': '發布你的成績',
  'publishPrompt.message':
    '輸入顯示名稱並同意分享，你的成績才會出現在排行榜上；之後要修改可以到設定。',
  'publishPrompt.skip': '之後再說',

  /* ── 技能提示 / Skill hint ─────────────────────────────────────── */
  'skillHint.discard': '當棄即棄：點選要棄掉的方團團',
  'skillHint.fate_swap': '命運互換：點選兩顆方團團交換位置',
  'skillHint.generic': '點選方團團',
  'skillHint.counter': '{base}（{selected}/{total}）・點空白處取消',

  /* ── 技能欄 / Skill bar ────────────────────────────────────────── */
  'skillBar.cumulative': '累計使用技力',
  'skillBar.free': '免',
  'skillBar.ariaCumulative': '{name}（累計使用技力 {spent}/{threshold}，免費）',
  'skillBar.ariaCost': '{name}（消耗 {cost} 技力）',
  'skillBar.ariaLocked': '{name}（未解鎖）',

  /* ── 設定彈窗 / Settings popup ─────────────────────────────────── */
  'settings.title': '設定',
  'settings.close': '關閉設定',
  'settings.rules.heading': '遊戲玩法',
  'settings.rules.subtitle': '修改規則後，成績不會記錄在排行榜',
  'settings.rules.master': '允許更改遊戲規則',
  'settings.rules.masterNote':
    '開啟後才可調整以下規則；開啟期間的成績不會記錄在排行榜上。',
  'settings.rules.endless': '無盡模式',
  'settings.rules.endlessNote': '碰到警戒線也不會觸發 5 秒警告與結束，可以一直玩下去。',
  'settings.rules.more': '（未來再補充）',
  'settings.language.heading': '語言',
  'settings.language.subtitle': '介面顯示語言',
  'settings.language.note': '預設依照你的裝置或瀏覽器語言自動選擇。',
  'settings.leaderboard.heading': '排行榜',
  'settings.leaderboard.subtitle': '顯示名稱與分享意願',
  'settings.leaderboard.note':
    '未同意分享時，成績不會上排行榜。同意之後，之後的成績會自動上載，不必再手動儲存；隨時可以回來更改。',

  /* ── 遊戲說明彈窗 / Help popup ─────────────────────────────────── */
  /*
   * 內文由使用者親撰（2026-10-08），以下逐字照登，只做兩件事：
   *  1. 依原文段落切成 `body1` / `body2` …，因為排版是一段一個 `<p>`（段落間距靠 CSS，
   *     塞在單一字串裡就吃不到行距）。
   *  2. 補上原文省略的書名號（《方團團大作戰》）。
   * 原文版權段寫的「方團團大冒險」與本作名稱「方團團大作戰」不符，已統一為後者。
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
    '倘若堆疊太高超過警戒線，則需要在 5 秒內盡快清除堆疊，超時後則會判定為本局結束。',
  'help.origin.heading': '製作緣由',
  'help.origin.body1':
    '《方團團大作戰》是基於《明日方舟：終末地》的「合成！山團團」網頁活動玩法的非官方粉絲延伸版本。',
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
  'help.copyright.heading': '版權聲明',
  'help.copyright.body1':
    '請注意：本專案與鷹角網絡（Hypergryph）及 Gryphline 無關。《方團團大作戰》僅為一款由粉絲自行開發之網頁遊戲，本遊戲中使用的素材均由 夜芷冰 及 社群協作者 製作，所有角色名稱與相關美術版權歸原權利人所有。本專案原始碼版權歸夜芷冰擁有。',
  'help.copyright.body2':
    '本專案完全免費、不含內購與廣告，亦不以任何形式營利。未經夜芷冰同意，「方團團」素材不得用作商業盈利或其他有損害任一方聲譽的用途（由其他社群協作者提供的素材，請先自行徵得其同意再使用）。',
} as const;

/** 所有訊息的鍵。其餘語系都要提供完整的一組。 */
export type MessageKey = keyof typeof zhHant;

/** 一份完整的字典。 */
export type Messages = Record<MessageKey, string>;
