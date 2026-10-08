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
 * 刻意**不翻譯**的字串：設計稿上的英文標籤（`SCORE` / `BEST TRY` / `MERGED` / `NEXT` /
 * `COMBO` / `SKILL LIST` / `MELTING LIST` / `GAME OVER` / `NEW BEST`）屬於設計語言，
 * 五種語言一律照原樣顯示，因此不在此表。
 * Strings deliberately **left untranslated**: the mock's English labels (`SCORE`, `BEST TRY`,
 * `MERGED`, `NEXT`, `COMBO`, `SKILL LIST`, `MELTING LIST`, `GAME OVER`, `NEW BEST`) are part of
 * the design language and read the same in every locale, so they are not listed here.
 */

export const zhHant = {
  /* ── 通用 / Shared ─────────────────────────────────────────────── */
  'common.cancel': '取消',
  'common.close': '關閉',
  'common.save': '儲存',

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
  'leaderboard.self':
    '你的最佳：{value}（{score} 分）· 超越你自己 {percentile}% 的場次（共 {total} 場）',
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
  'settings.rules.heading': '遊戲玩法 / 規則更改',
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
  'settings.leaderboard.note': '未同意分享時，成績不會上排行榜；之後隨時可以回來更改。',

  /* ── 遊戲說明彈窗 / Help popup ─────────────────────────────────── */
  'help.title': '遊戲說明',
  'help.close': '關閉說明',
  'help.play.heading': '玩法',
  /* ⚠️ 暫定稿：待使用者提供正式文案（見 docs/gameplay.md 可再濃縮）。 */
  'help.play.body':
    '點擊畫面或按空白鍵，投下手上這顆方團團。兩顆相同的方團團疊在一起就會合成下一級，一路疊到最大的「梨諾」。方團團堆得太高、越過警戒線並停住 5 秒，這一局就會結束。每次投放與合成都會累積技力，用來發動當棄即棄、協議：浮動、搖晃！等技能。',
  'help.origin.heading': '製作緣由',
  /* ⚠️ 暫定稿：使用者定案要親自撰寫，這裡先放一句佔位敘述。 */
  'help.origin.body':
    '《方團團大作戰》是一個非官方的粉絲同人作品：以《明日方舟：終末地》網頁活動「OrbiPom! MERGE!」的合成玩法為藍本，用 Matter.js 與 Canvas 從零重寫，作為技術示範與同人創作。',
  'help.author.heading': '作者',
  'help.author.body': '由 Voc-夜芷冰 開發與維護。歡迎在 GitHub 上提出建議或回報問題。',
  'help.repo.label': 'GitHub 專案',
  'help.copyright.heading': '版權聲明',
  'help.copyright.body':
    '非官方粉絲作品，與鷹角網絡（Hypergryph）及 Gryphline 無關，亦未獲其認可或授權。靈感來自《明日方舟：終末地》的合成玩法；所有角色名稱與相關美術版權歸原權利人所有。本專案完全免費、不含內購與廣告，亦不以任何形式營利。',
} as const;

/** 所有訊息的鍵。其餘語系都要提供完整的一組。 */
export type MessageKey = keyof typeof zhHant;

/** 一份完整的字典。 */
export type Messages = Record<MessageKey, string>;
