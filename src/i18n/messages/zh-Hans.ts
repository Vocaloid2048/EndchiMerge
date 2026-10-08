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
  'settings.rules.heading': '游戏玩法',
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
  'help.play.body1':
    '点击悬挂中的方团团或按空格键，把方团团投下吧！当两个相同的方团团贴在一起，就会合成到下一级，目标是解锁更高级别的方团团，以及获取更高分数。',
  'help.play.body2':
    '当玩家在投放时连续触发合成，就会获得 COMBO 分数加成，加成将会累加，直至单次投放未触发 COMBO 则会重置。',
  'help.play.body3':
    '玩家可以善用不同效果的技能来提高分数；其中透过连击、投下方团团获得技力，技力可以兑换指定的技能。',
  'help.play.body4':
    '倘若堆叠太高超过警戒线，则需要在 5 秒内尽快清除堆叠，超时后则判定为本局结束。',
  'help.origin.heading': '制作缘由',
  'help.origin.body1':
    '《方团团大作战》是基于《明日方舟：终末地》的「合成！山团团」网页活动玩法的非官方粉丝延伸版本。',
  'help.origin.body2':
    '当初在玩完这个网页活动后意犹未尽，总感觉缺了一点乐趣，想说如果再添加一些新技能、设定、角色的话会不会更加好玩？刚好最近在尝试学习使用 AI Agent（加上不太熟悉网页游戏开发），打算让 Agent 基于我的期望自己完成整个项目（但后来发现我想太多了），结果花了半天时间参考官方的山团团、再加以自己的想法来制作一个个方团团（所以看起来几乎一样？）。后面也花了几天时间来跟 Agent 一边对话、一边修正源代码的部分（所以源代码的部分主要是 Agent 编写，但方团团是我自己一个个慢慢捏出来的）。',
  'help.origin.body3':
    '希望日后有更多空闲时间时，再慢慢添加不同有趣的玩法和角色（全图鉴？），也十分欢迎透过 PR 协作！也想看看现在社群对于 AI 协作产物的主流看法是否依然偏向拒绝……不论如何，希望大家玩得开心！',
  'help.author.heading': '作者',
  'help.author.avatarAlt': '夜芷冰的头像',
  'help.author.discordAria': '在 Discord 上联系夜芷冰',
  'help.author.githubAria': '在 GitHub 上查看夜芷冰',
  'help.author.server': '加入 Discord 服务器',
  'help.author.serverAria': '加入《方团团大作战》的 Discord 支援服务器',
  'help.repo.label': 'GitHub 项目',
  'help.copyright.heading': '版权声明',
  'help.copyright.body1':
    '请注意：本项目与鹰角网络（Hypergryph）及 Gryphline 无关。《方团团大作战》仅为一款由粉丝自行开发的网页游戏，本游戏中使用的素材均由 夜芷冰 及 社群协作者 制作，所有角色名称与相关美术版权归原权利人所有。本项目源代码版权归夜芷冰拥有。',
  'help.copyright.body2':
    '本项目完全免费、不含内购与广告，亦不以任何形式营利。未经夜芷冰同意，「方团团」素材不得用作商业盈利或其他有损害任一方声誉的用途（由其他社群协作者提供的素材，请先自行征得其同意再使用）。',
};
