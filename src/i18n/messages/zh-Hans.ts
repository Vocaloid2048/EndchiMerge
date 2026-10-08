/**
 * 简体中文字典。
 * Simplified Chinese.
 *
 * 由 `zh-Hant.ts` 轉寫，鍵集合必須完全一致（缺鍵會編譯失敗）。
 * Transcribed from `zh-Hant.ts`; the key set must match exactly (a missing key fails the build).
 */

import type { Messages } from './zh-Hant';

export const zhHans: Messages = {
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.save': '保存',

  'chrome.toolbar': '工具栏',
  'chrome.canvas': '游戏容器：方向键瞄准、空格键投放，或用鼠标点击投放。方团团在此落下与合成。',
  'chrome.music': '音乐开关',
  'chrome.spMeter': '技力',

  'toolbar.leaderboard': '排行榜',
  'toolbar.workshop': '创意工坊（即将推出）',
  'toolbar.help': '游戏说明',
  'toolbar.settings': '设置',
  'toolbar.restart': '重新开始',

  'gameOver.aria': '游戏结束',
  'gameOver.playAgain': '再玩一次',

  'restart.title': '重新开始？',
  'restart.message': '进行中的这一局分数与版面都会清空，确定要重新开始吗？',
  'restart.confirm': '重新开始',

  'leaderboard.title': '排行榜',
  'leaderboard.subtitle': '全时段 · Top {limit}',
  'leaderboard.close': '关闭排行榜',
  'leaderboard.emptyShare': '还没有记录 —— 先玩一局吧！',
  'leaderboard.emptyNoShare': '未开启分享，成绩不会上榜。',
  'leaderboard.unnamed': '（未命名）',
  'leaderboard.comboValue': '{value} 连',
  'leaderboard.mergesValue': '{value} 次',
  'leaderboard.self': '你的最佳：{value}（{score} 分）· 超越你自己 {percentile}% 的场次（共 {total} 场）',
  'leaderboard.tab.score': '最高分数',
  'leaderboard.tab.combo': 'COMBO 数',
  'leaderboard.tab.merges': '合成数',

  'publish.name': '显示名称',
  'publish.namePlaceholder': '输入你的名字',
  'publish.units': '{used} / {max} 单位',
  'publish.consent': '同意将我的成绩显示在排行榜上',

  'nameError.empty': '请输入名称（至少 1 个字）',
  'nameError.charset': '只能使用中英文、数字、空格与 _ - .',
  'nameError.tooLong': '名称太长（上限 {max} 单位；中文 1 字算 2 单位）',

  'publishPrompt.title': '发布你的成绩',
  'publishPrompt.message': '输入显示名称并同意分享，你的成绩才会出现在排行榜上；之后要修改可以到设置。',
  'publishPrompt.skip': '以后再说',

  'skillHint.discard': '当弃即弃：点选要弃掉的方团团',
  'skillHint.fate_swap': '命运互换：点选两颗方团团交换位置',
  'skillHint.generic': '点选方团团',
  'skillHint.counter': '{base}（{selected}/{total}）· 点击空白处取消',

  'skillBar.cumulative': '累计使用技力',
  'skillBar.free': '免',
  'skillBar.ariaCumulative': '{name}（累计使用技力 {spent}/{threshold}，免费）',
  'skillBar.ariaCost': '{name}（消耗 {cost} 技力）',
  'skillBar.ariaLocked': '{name}（未解锁）',

  'settings.title': '设置',
  'settings.close': '关闭设置',
  'settings.rules.heading': '游戏玩法 / 规则更改',
  'settings.rules.subtitle': '修改规则后，成绩不会记录在排行榜',
  'settings.rules.master': '允许更改游戏规则',
  'settings.rules.masterNote': '开启后才可调整以下规则；开启期间的成绩不会记录在排行榜上。',
  'settings.rules.endless': '无尽模式',
  'settings.rules.endlessNote': '碰到警戒线也不会触发 5 秒警告与结束，可以一直玩下去。',
  'settings.rules.more': '（未来再补充）',
  'settings.language.heading': '语言',
  'settings.language.subtitle': '界面显示语言',
  'settings.language.note': '默认依照你的设备或浏览器语言自动选择。',
  'settings.leaderboard.heading': '排行榜',
  'settings.leaderboard.subtitle': '显示名称与分享意愿',
  'settings.leaderboard.note': '未同意分享时，成绩不会上排行榜；之后随时可以回来更改。',

  'help.title': '游戏说明',
  'help.close': '关闭说明',
  'help.play.heading': '玩法',
  'help.play.body':
    '点击画面或按空格键，投下手上这颗方团团。两颗相同的方团团叠在一起就会合成下一级，一路叠到最大的「梨诺」。方团团堆得太高、越过警戒线并停住 5 秒，这一局就会结束。每次投放与合成都会累积技力，用来发动当弃即弃、协议：浮动、摇晃！等技能。',
  'help.origin.heading': '制作缘由',
  'help.origin.body':
    '《方团团大作战》是一个非官方的粉丝同人作品：以《明日方舟：终末地》网页活动「OrbiPom! MERGE!」的合成玩法为蓝本，用 Matter.js 与 Canvas 从零重写，作为技术示范与同人创作。',
  'help.author.heading': '作者',
  'help.author.body': '由 Voc-夜芷冰 开发与维护。欢迎在 GitHub 上提出建议或反馈问题。',
  'help.repo.label': 'GitHub 项目',
  'help.copyright.heading': '版权声明',
  'help.copyright.body':
    '非官方粉丝作品，与鹰角网络（Hypergryph）及 Gryphline 无关，亦未获其认可或授权。灵感来自《明日方舟：终末地》的合成玩法；所有角色名称与相关美术版权归原权利人所有。本项目完全免费、不含内购与广告，亦不以任何形式营利。',
};
