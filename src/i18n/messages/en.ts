/**
 * English dictionary.
 * 英文字典。
 *
 * `zh-Hant.ts` 的對譯；鍵集合必須完全一致。
 * The English counterpart of `zh-Hant.ts`; the key set must match exactly.
 *
 * 技能名以**設定檔的官方英文名**為準（`skills.json` 的 `names.en`）：Cast Off / Protocol:
 * Levitate / Shake Up! / Fated Exchange。提示句裡的技能名照那個寫法固定，因為這兩項技能的
 * 名字是定死的（見 `skillHint.discard` / `skillHint.fate_swap`）。
 * Skill names follow the **official English names** in config (`names.en` in `skills.json`):
 * Cast Off / Protocol: Levitate / Shake Up! / Fated Exchange. The hint sentences spell those
 * names out, since the two skills are fixed.
 */

import type { Messages } from './zh-Hant';

export const en: Messages = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',

  'chrome.toolbar': 'Toolbar',
  'chrome.canvas':
    'Game container: aim with the arrow keys, drop with Space, or click to drop. Dumplings fall and merge here.',
  'chrome.music': 'Music',
  'chrome.spMeter': 'SP',

  'toolbar.leaderboard': 'Leaderboard',
  'toolbar.workshop': 'Workshop (coming soon)',
  'toolbar.help': 'How to play',
  'toolbar.settings': 'Settings',
  'toolbar.restart': 'Restart',

  'gameOver.aria': 'Game over',
  'gameOver.playAgain': 'Play again',

  'restart.title': 'Restart?',
  'restart.message':
    'The run in progress will be cleared — both its score and the board. Restart anyway?',
  'restart.confirm': 'Restart',

  'leaderboard.title': 'Leaderboard',
  'leaderboard.subtitle': 'All-time · Top {limit}',
  'leaderboard.close': 'Close leaderboard',
  'leaderboard.emptyShare': 'No records yet — go play a run!',
  'leaderboard.emptyNoShare': 'Sharing is off, so scores do not appear.',
  'leaderboard.unnamed': '(unnamed)',
  'leaderboard.comboValue': '{value} combo',
  'leaderboard.mergesValue': '{value} merges',
  'leaderboard.self':
    'Your best: {value} ({score} pts) · beats {percentile}% of your own runs ({total} total)',
  'leaderboard.tab.score': 'Best score',
  'leaderboard.tab.combo': 'COMBO',
  'leaderboard.tab.merges': 'Merges',

  'publish.name': 'Display name',
  'publish.namePlaceholder': 'Enter your name',
  'publish.units': '{used} / {max} units',
  'publish.consent': 'Show my scores on the leaderboard',

  'nameError.empty': 'Enter a name (at least 1 character)',
  'nameError.charset': 'Only letters, numbers, spaces and _ - . are allowed',
  'nameError.tooLong': 'Name too long (max {max} units; one CJK character counts as 2)',

  'publishPrompt.title': 'Publish your score',
  'publishPrompt.message':
    'Enter a display name and agree to share — only then do your scores appear on the leaderboard. You can change this later in Settings.',
  'publishPrompt.skip': 'Maybe later',

  'skillHint.discard': 'Cast Off: pick the dumpling to remove',
  'skillHint.fate_swap': 'Fated Exchange: pick two dumplings to swap',
  'skillHint.generic': 'Pick a dumpling',
  'skillHint.counter': '{base} ({selected}/{total}) · click empty space to cancel',

  'skillBar.cumulative': 'SP spent this run',
  'skillBar.free': 'Free',
  'skillBar.ariaCumulative': '{name} (SP spent this run {spent}/{threshold}, free)',
  'skillBar.ariaCost': '{name} (costs {cost} SP)',
  'skillBar.ariaLocked': '{name} (locked)',

  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.rules.heading': 'Gameplay / rule changes',
  'settings.rules.subtitle': 'With rules changed, scores are not recorded on the leaderboard',
  'settings.rules.master': 'Allow changing game rules',
  'settings.rules.masterNote':
    'Turn this on to adjust the rules below. While it is on, scores are not recorded on the leaderboard.',
  'settings.rules.endless': 'Endless mode',
  'settings.rules.endlessNote':
    'Touching the warning line no longer triggers the 5-second warning or ends the run — play for as long as you like.',
  'settings.rules.more': '(more to come)',
  'settings.language.heading': 'Language',
  'settings.language.subtitle': 'Interface language',
  'settings.language.note': 'Defaults to your device or browser language.',
  'settings.leaderboard.heading': 'Leaderboard',
  'settings.leaderboard.subtitle': 'Display name and sharing',
  'settings.leaderboard.note':
    'With sharing off, your scores do not appear on the leaderboard. You can come back and change this anytime.',

  'help.title': 'How to play',
  'help.close': 'Close help',
  'help.play.heading': 'How to play',
  'help.play.body':
    'Click the board or press Space to drop the dumpling in hand. Two of the same dumpling merge into the next tier, all the way up to Liino, the largest. If the pile crosses the warning line and stays there for 5 seconds, the run ends. Every drop and every merge banks SP, which you spend on skills such as Cast Off, Protocol: Levitate and Shake Up!.',
  'help.origin.heading': 'Why it exists',
  'help.origin.body':
    'EndchiMerge is an unofficial fan project: it takes the merge gameplay of Arknights: Endfield\u2019s \u201cOrbiPom! MERGE!\u201d web event as its blueprint and rebuilds it from scratch with Matter.js and Canvas, as a technical showcase and a piece of fan work.',
  'help.author.heading': 'Author',
  'help.author.body':
    'Built and maintained by Voc-\u591c\u82b7\u51b0. Suggestions and bug reports are welcome on GitHub.',
  'help.repo.label': 'GitHub repository',
  'help.copyright.heading': 'Copyright',
  'help.copyright.body':
    'An unofficial fan project, not affiliated with or endorsed by Hypergryph or Gryphline. Inspired by the merge gameplay of Arknights: Endfield; all character names and artwork remain the property of their respective owners. The project is entirely free — no in-app purchases, no ads — and is not monetised in any form.',
};
