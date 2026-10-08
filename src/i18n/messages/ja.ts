/**
 * 日本語辭典。
 * Japanese.
 *
 * `zh-Hant.ts` の対訳。キー集合は完全に一致させること（不足するとビルドが落ちる）。
 * The Japanese counterpart of `zh-Hant.ts`; the key set must match exactly.
 *
 * **スキル名は未確定**（ユーザーが後日入力）。それまでは原作どおりの中国語表記をそのまま
 * 使い、確定後に `skills.json` の `names.ja` へ入れる。だからヒント文のスキル名も原文表記。
 * **Skill names are not settled yet** (the user will supply them). Until then the original
 * Chinese names are used as-is and will move into `names.ja` in `skills.json` once decided —
 * which is why the hint sentences spell them in the original.
 */

import type { Messages } from './zh-Hant';

export const ja: Messages = {
  'common.cancel': 'キャンセル',
  'common.close': '閉じる',
  'common.save': '保存',

  'chrome.toolbar': 'ツールバー',
  'chrome.canvas':
    'ゲームコンテナ：方向キーで狙い、スペースキーで落とす、またはクリックで落とします。方團團はここで落下し、合成されます。',
  'chrome.music': '音楽',
  'chrome.spMeter': '技力',

  'toolbar.leaderboard': 'ランキング',
  'toolbar.workshop': 'クリエイティブ工房（近日公開）',
  'toolbar.help': '遊び方',
  'toolbar.settings': '設定',
  'toolbar.restart': 'リスタート',

  'gameOver.aria': 'ゲームオーバー',
  'gameOver.playAgain': 'もう一度',

  'restart.title': 'リスタートしますか？',
  'restart.message': '進行中のスコアと盤面はすべて消去されます。リスタートしますか？',
  'restart.confirm': 'リスタート',

  'leaderboard.title': 'ランキング',
  'leaderboard.subtitle': '全期間 · Top {limit}',
  'leaderboard.close': 'ランキングを閉じる',
  'leaderboard.emptyShare': 'まだ記録がありません —— まず 1 回遊んでみましょう！',
  'leaderboard.emptyNoShare': '共有がオフのため、スコアは掲載されません。',
  'leaderboard.unnamed': '（名無し）',
  'leaderboard.comboValue': '{value} コンボ',
  'leaderboard.mergesValue': '{value} 回合成',
  'leaderboard.self':
    'あなたのベスト：{value}（{score} 点）· 自分のこれまでの {percentile}% のプレイを上回っています（全 {total} 回）',
  'leaderboard.tab.score': '最高スコア',
  'leaderboard.tab.combo': 'COMBO 数',
  'leaderboard.tab.merges': '合成数',

  'publish.name': '表示名',
  'publish.namePlaceholder': '名前を入力',
  'publish.units': '{used} / {max} 単位',
  'publish.consent': 'スコアをランキングに表示することに同意する',

  'nameError.empty': '名前を入力してください（1 文字以上）',
  'nameError.charset': '使えるのは英数字・空白・_ - . のみです',
  'nameError.tooLong': '名前が長すぎます（上限 {max} 単位、漢字 1 文字は 2 単位）',

  'publishPrompt.title': 'スコアを公開',
  'publishPrompt.message':
    '表示名を入力し、共有に同意すると、スコアがランキングに表示されます。あとから設定で変更できます。',
  'publishPrompt.skip': 'あとで',

  'skillHint.discard': '當棄即棄：捨てる方團團を選んでください',
  'skillHint.fate_swap': '命運互換：入れ替える方團團を 2 つ選んでください',
  'skillHint.generic': '方團團を選んでください',
  'skillHint.counter': '{base}（{selected}/{total}）・空白をクリックでキャンセル',

  'skillBar.cumulative': '累計消費技力',
  'skillBar.free': '無料',
  'skillBar.ariaCumulative': '{name}（累計消費技力 {spent}/{threshold}、無料）',
  'skillBar.ariaCost': '{name}（{cost} 技力消費）',
  'skillBar.ariaLocked': '{name}（ロック中）',

  'settings.title': '設定',
  'settings.close': '設定を閉じる',
  'settings.rules.heading': 'ゲームプレイ / ルール変更',
  'settings.rules.subtitle': 'ルールを変更すると、スコアはランキングに記録されません',
  'settings.rules.master': 'ゲームルールの変更を許可する',
  'settings.rules.masterNote':
    'オンにすると以下のルールを変更できます。オンの間、スコアはランキングに記録されません。',
  'settings.rules.endless': 'エンドレスモード',
  'settings.rules.endlessNote':
    '警告ラインに触れても 5 秒警告とゲーム終了は発生せず、ずっと遊べます。',
  'settings.rules.more': '（今後追加）',
  'settings.language.heading': '言語',
  'settings.language.subtitle': 'インターフェースの表示言語',
  'settings.language.note': '初期値はお使いの端末またはブラウザの言語に従います。',
  'settings.leaderboard.heading': 'ランキング',
  'settings.leaderboard.subtitle': '表示名と共有の設定',
  'settings.leaderboard.note':
    '共有がオフのときはスコアがランキングに表示されません。いつでも変更できます。',

  'help.title': '遊び方',
  'help.close': '説明を閉じる',
  'help.play.heading': '遊び方',
  'help.play.body':
    '盤面をクリックするかスペースキーで、手持ちの方團團を落とします。同じ方團團が 2 つ重なると次の段階に合成され、最大の「梨諾」まで続きます。山が高くなり警告ラインを越えたまま 5 秒経つと、そのプレイは終了します。落とすたび、合成するたびに技力が貯まり、當棄即棄・協議：浮動・搖晃！などのスキルに使えます。',
  'help.origin.heading': '制作のきっかけ',
  'help.origin.body':
    '『方團團大作戰』は非公式のファン二次創作です。『アークナイツ：エンドフィールド』のウェブイベント「OrbiPom! MERGE!」の合成ゲームプレイを下敷きに、Matter.js と Canvas で一から作り直したもので、技術デモを兼ねた同人作品です。',
  'help.author.heading': '作者',
  'help.author.body':
    'Voc-夜芷冰 が開発・保守しています。GitHub での提案や不具合報告を歓迎します。',
  'help.repo.label': 'GitHub リポジトリ',
  'help.copyright.heading': '権利表記',
  'help.copyright.body':
    '非公式のファン作品であり、Hypergryph および Gryphline とは一切関係がなく、承認や許諾も受けていません。『アークナイツ：エンドフィールド』の合成ゲームプレイに着想を得ています。キャラクター名および関連するアートワークの権利は、それぞれの権利者に帰属します。本プロジェクトは完全無料で、課金要素も広告もなく、いかなる形でも収益化していません。',
};
