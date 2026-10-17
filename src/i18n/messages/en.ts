/**
 * English dictionary；`zh-Hant.ts` 的對譯，鍵集合必須完全一致。
 * The English counterpart of `zh-Hant.ts`; the key set must match exactly.
 *
 * 技能名以設定檔的官方英文名為準（`skills.json` 的 `names.en`），提示句照那個寫法固定。
 * Skill names follow the official English names in config (`names.en` in `skills.json`), and the hint sentences spell those out.
 */

import type { Messages } from './zh-Hant';

export const en: Messages = {
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',

  /*
   * 設計稿標籤 / Mock labels.
   * 英文這一欄照原樣 —— 這幾個字本來就是英文原文，也就是其他四語的翻譯來源。
   * This column is verbatim: these strings are the English original that the other four
   * locales translate from.
   */
  'label.score': 'SCORE',
  'label.bestTry': 'BEST TRY',
  'label.merged': 'MERGED',
  'label.duration': 'TIME',
  'label.next': 'NEXT',
  'label.combo': 'COMBO',
  'label.skillList': 'SKILL LIST',
  /*
   * 這個標籤在英文照「圖鑑」的意思走（`MELTING` 仍是程式內部識別名，改的只有顯示文字）。
   * This label follows the meaning of 圖鑑 in English (`MELTING` survives as an internal identifier — only the displayed text changed).
   */
  'label.meltingList': 'COMPENDIUM',
  'label.gameOver': 'GAME OVER',
  'label.newBest': 'NEW BEST',
  'label.best': 'BEST',
  'label.statSuffix': ':',

  'chrome.toolbar': 'Toolbar',
  'chrome.canvas':
    'Game container: aim with the arrow keys, drop with Space, or click to drop. Dumplings fall and merge here.',
  'chrome.music': 'Music',
  'chrome.musicMute': 'Mute music',
  'chrome.musicUnmute': 'Play music',
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
  'leaderboard.loading': 'Loading…',
  'leaderboard.emptyShare': 'No records yet — go play a run!',
  'leaderboard.emptyNoShare': 'Sharing is off, so scores do not appear.',
  'leaderboard.unnamed': '(unnamed)',
  'leaderboard.comboValue': '{value} combo',
  'leaderboard.mergesValue': '{value} merges',
  'leaderboard.self':
    'Your best: {value} ({score} pts) · #{rank} of {total} players',
  /* 100 位之後不報名次，改報超越了百分之多少的玩家。 / Past #100 the rank is not reported, only the share of players beaten. */
  'leaderboard.selfBeats':
    'Your best: {value} ({score} pts) · beats {beats}% of players ({total} total)',
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
  'skillHint.ascend': 'One Step Up: pick the dumpling to promote',
  'skillHint.generic': 'Pick a dumpling',
  'skillHint.counter': '{base} ({selected}/{total}) · click empty space to cancel',

  'skillBar.cumulative': 'SP spent this run',
  'skillBar.uses': 'skills cast',
  'skillBar.free': 'Free',
  'skillBar.ariaCumulative': '{name} (SP spent this run {spent}/{threshold}, free)',
  'skillBar.ariaCumulativeUses': '{name} ({uses}/{threshold} skills cast, free)',
  'skillBar.ariaCost': '{name} (costs {cost} SP)',
  'skillBar.ariaLocked': '{name} (locked)',
  'skillBar.used': 'Used',
  'skillBar.ariaUsed': '{name} (already used this run; it will not unlock again)',

  /* ── Skill guide ───────────────────────────────────────────────── */
  'skillGuide.open': 'Skill guide',
  'skillGuide.title': 'Skill guide',
  'skillGuide.close': 'Close the skill guide',
  'skillGuide.groupPaid': '{cost} SP',
  'skillGuide.groupSpecial': 'Special skills',
  'skillGuide.cost': 'Costs {cost} SP',
  'skillGuide.costSpecial': 'Special skill',
  'skillGuide.unlockSp': 'Ready whenever you can afford it, locked again once spent.',
  'skillGuide.unlockSpent': 'Unlocks after {threshold} SP spent this run.',
  'skillGuide.unlockUses': 'Unlocks after {threshold} skills cast this run.',
  'skillGuide.media': 'Illustration / animation',
  'skillGuide.desc.discard':
    'Pick one dumpling and take it off the board — no merge, no score. Use it to clear a low-level body in the way or make room for a big one.',
  'skillGuide.desc.ascend':
    'Pick one dumpling and promote it one level, provided the next level is already unlocked in the collection. No score, no combo, no SP — it is a purchase.',
  'skillGuide.desc.protocol_float':
    'Every dumpling floats upward for a moment, with the space just below the overflow line as its ceiling. A breather for a pile that is about to spill.',
  'skillGuide.desc.scramble':
    'Randomly permutes the positions of every dumpling. It reuses the spots already on the board, so bodies are never stacked onto one point and blown apart.',
  'skillGuide.desc.combo_grace':
    'The next {drops} drops will not break the chain even with nothing merged. Casting it again takes the larger value instead of adding.',
  'skillGuide.desc.shake':
    'Shakes the container side to side to loosen the pile and let the bodies settle again. No dropping while it shakes.',
  'skillGuide.desc.reshuffle':
    'Clears the container and drops {count} unlocked dumplings again.',
  'skillGuide.desc.fate_swap':
    'Pick two dumplings and swap their positions and velocities, nudging whatever sits on the new spots. Needs two distinct targets.',
  'skillGuide.desc.shrink_all':
    'Shrinks every dumpling on the board to the same size. Bodies already smaller are left alone, and anything merged later keeps its normal size.',
  'skillGuide.desc.square_core':
    'This run judges merge edges by the core square instead of the outline: the collider itself becomes a square, for bodies already on the board and for later drops alike. Once per run.',

  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.rules.heading': 'Gameplay',
  'settings.rules.subtitle': 'With rules changed, scores are not recorded on the leaderboard',
  'settings.rules.master': 'Allow changing game rules',
  'settings.rules.masterNote':
    'Turn this on to adjust the rules below. While it is on, scores are not recorded on the leaderboard.',
  'settings.rules.endless': 'Endless mode',
  'settings.rules.endlessNote':
    'Touching the warning line no longer triggers the 5-second warning or ends the run; the drop rule still applies, so once it is full only skills can make room.',
  'settings.rules.more': '(more to come)',
  'settings.language.heading': 'Language',
  'settings.language.subtitle': 'Interface language',
  'settings.language.note': 'Defaults to your device or browser language.',
  'settings.leaderboard.heading': 'Leaderboard',
  'settings.leaderboard.subtitle': 'Display name and sharing',
  'settings.leaderboard.note':
    'With sharing off, your scores stay off the leaderboard. Once you agree, later scores upload on their own — there is no button to press. You can change this anytime.',

  'help.title': 'How to play',
  'help.close': 'Close help',
  'help.play.heading': 'How to play',
  'help.play.body1':
    'Click the suspended dumpling — or press Space — to drop it. When two identical dumplings touch, they merge into the next tier. The goal is to unlock the higher tiers and rack up a bigger score.',
  'help.play.body2':
    'Merging on drop after drop builds a COMBO bonus. The bonus stacks up, and resets the moment a single drop merges nothing.',
  'help.play.body3':
    'Each skill does something different, and they are worth learning if you want a higher score. You bank SP from combos and from dropping dumplings, and SP is what you spend to cast them.',
  'help.play.body4':
    'A dumpling cannot be placed above the warning line: if it would land there, it does not drop at all. If the pile still crosses the line, you have 5 seconds to clear it back down — run out of time and the run ends.',
  'help.origin.heading': 'Why it exists',
  'help.origin.body1':
    'EndchiMerge is an unofficial fan spin-off built on the gameplay of the “OrbiPom! MERGE!” web event from Arknights: Endfield.',
  'help.origin.body2':
    'After finishing that web event I still wanted more — something felt missing. What if there were more skills, more settings, more characters? Would it be more fun? Around the same time I had started learning to work with AI agents (and I am not much of a web game developer to begin with), so the plan was to let an agent build the whole project from my brief. (It turned out I was asking for too much.) What actually happened: I spent half a day studying the official OrbiPoms and reworking them into my own versions, one at a time — which is why they look almost identical. Then came several days of back-and-forth with the agent, fixing the source as we went. So the source code is mostly the agent’s work, while every dumpling was shaped by hand, one by one.',
  'help.origin.body3':
    'Once I have more spare time I would like to keep adding new modes and characters at a leisurely pace (a full glossary, maybe?). Collaboration through pull requests is very welcome! I am also curious whether the community still leans towards rejecting AI-assisted work… Either way — I hope you have fun.',
  'help.author.heading': 'Author',
  'help.author.avatarAlt': 'Avatar of 夜芷冰',
  'help.author.discordAria': 'Message 夜芷冰 on Discord',
  'help.author.githubAria': 'View 夜芷冰 on GitHub',
  'help.author.server': 'Join the Discord server',
  'help.author.serverAria': 'Join the EndchiMerge support Discord server',
  'help.repo.label': 'GitHub repository',
  'help.music.heading': 'Music',
  'help.music.lead': 'Background music',
  'help.music.license': 'License',
  'help.music.promoted': 'Music promoted by',
  'help.music.download': 'Free download / stream',
  'help.copyright.heading': 'Copyright',
  'help.copyright.body1':
    'Please note: this project has no connection to Hypergryph or Gryphline. “EndchiMerge” is simply a web game developed by a fan; the assets used in it were made by 夜芷冰 and community contributors, and all character names and related artwork remain the property of their respective rights holders. The copyright of this project’s source code belongs to 夜芷冰.',
  'help.copyright.body2':
    'The project is entirely free — no in-app purchases, no ads — and is not monetised in any form. Without 夜芷冰’s permission, “EndchiMerge” assets may not be used for commercial profit or for any purpose that damages the reputation of any party. (For assets contributed by other community members, please obtain their permission first.)',
  'mobile.rotateTitle': 'Rotate your device',
  'mobile.rotateBody':
    'The container and the skill list only fit in landscape. Turning the device also goes fullscreen.',
  'mobile.landscape': 'Landscape + fullscreen',
};
