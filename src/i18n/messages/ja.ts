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

  /*
   * 設計稿標籤 / Mock labels.
   * 元の設計は英語表記だが、ユーザーの決定により各言語へ訳す。
   * The mock's own labels, translated per the user's decision.
   */
  'label.score': 'スコア',
  'label.bestTry': 'ハイスコア',
  'label.merged': '合成回数',
  'label.next': 'つぎ',
  'label.combo': 'コンボ',
  'label.skillList': 'スキル一覧',
  'label.meltingList': '図鑑',
  'label.gameOver': 'ゲームオーバー',
  'label.newBest': '新記録',
  'label.best': 'ハイスコア',
  'label.statSuffix': '：',

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
    'あなたのベスト：{value}（{score} 点）· {total} 人中 {rank} 位',
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
  'settings.rules.heading': 'ゲームプレイ',
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
    '共有がオフのときはスコアがランキングに表示されません。同意すると、以降のスコアは自動でアップロードされ、手動で押すボタンはありません。いつでも変更できます。',

  'help.title': '遊び方',
  'help.close': '説明を閉じる',
  'help.play.heading': '遊び方',
  'help.play.body1':
    '吊り下げられている方團團をクリックするか、スペースキーで落とします。同じ方團團が 2 つくっつくと次の段階に合成され、より上位の方團團の解放と、より高いスコアを目指します。',
  'help.play.body2':
    '落とすたびに合成が続くと COMBO ボーナスが付きます。ボーナスは積み重なり、合成が起きなかった落下でリセットされます。',
  'help.play.body3':
    'スキルはそれぞれ効果が違い、使いこなせばスコアを伸ばせます。コンボと方團團を落とすことで技力が貯まり、技力で好きなスキルを使えます。',
  'help.play.body4':
    '山が高くなり警告ラインを越えてしまったら、5 秒以内に山を崩してください。時間を過ぎるとそのプレイは終了となります。',
  'help.origin.heading': '制作のきっかけ',
  'help.origin.body1':
    '『方團團大作戰』は、『アークナイツ：エンドフィールド』のウェブイベント「OrbiPom! MERGE!」のゲームプレイを下敷きにした、非公式のファン派生版です。',
  'help.origin.body2':
    'あのウェブイベントを遊び終えても物足りなさが残り、何かが足りない気がしていました。もっとスキルや設定、キャラクターを足したら面白くなるのでは？ ちょうどその頃 AI Agent の使い方を学び始めていたこともあり（そもそもウェブゲーム開発はあまり詳しくありません）、自分の要望どおりにプロジェクトまるごと作ってもらおうと考えました（後に、それは望みすぎだと判明します）。実際には、半日かけて公式の山團團を参考に、自分のアイデアを足しながら方團團を 1 つずつ作りました（だからほぼ同じに見える？）。その後も数日かけて Agent と対話しながらソースを直していきました（ソースコードは主に Agent が書き、方團團は私が 1 つずつ手でこねたものです）。',
  'help.origin.body3':
    '今後もっと時間ができたら、いろいろな遊び方やキャラクターをのんびり追加していきたいです（全図鑑？）。PR での協力も大歓迎です！ また、AI との協働成果に対するコミュニティの一般的な見方が、いまも拒否寄りなのかどうかも見てみたいところです……とにかく、楽しんでもらえたら嬉しいです！',
  'help.author.heading': '作者',
  'help.author.avatarAlt': '夜芷冰 のアイコン',
  'help.author.discordAria': 'Discord で 夜芷冰 に連絡する',
  'help.author.githubAria': 'GitHub で 夜芷冰 を見る',
  'help.author.server': 'Discord サーバーに参加',
  'help.author.serverAria': '『方團團大作戰』の Discord サポートサーバーに参加する',
  'help.repo.label': 'GitHub リポジトリ',
  'help.copyright.heading': '権利表記',
  'help.copyright.body1':
    'ご注意：本プロジェクトは Hypergryph および Gryphline とは一切関係ありません。「方團團大作戰」はファンが自主制作したウェブゲームにすぎず、本作で使用している素材は 夜芷冰 とコミュニティの協力者が制作したものです。キャラクター名および関連するアートワークの権利は、それぞれの権利者に帰属します。本プロジェクトのソースコードの著作権は 夜芷冰 に帰属します。',
  'help.copyright.body2':
    '本プロジェクトは完全無料で、課金要素も広告もなく、いかなる形でも収益化していません。夜芷冰 の同意なく、「方團團」の素材を商業的な利益のために、またはいずれかの当事者の評判を損なう用途に使用することはできません（他のコミュニティ協力者が提供した素材については、まずご自身でその方の同意を得てください）。',
};
