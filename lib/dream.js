// dsh-life-cycle —— 梦境的纯函数：切碎片、拼两段提示词、醒来抽段落。
//
// 场景不再由代码套模板：代码只负责切一段上下文碎片，场景交给模型自己写
// （要求一百字左右、以「你……」开头），写完她再在同一个会话里把这段情景经历一遍。
//
// 没有副作用，随机数由调用方注入，所以能单独测。

/** 随机取一个元素。 */
const 取一 = (列, 随机) => 列[Math.min(列.length - 1, Math.floor(随机() * 列.length))]

/** 片段长度：100~500 字。太短的话抽出来的上下文没信息量。 */
const 片段最短 = 100
const 片段最长 = 500

/**
 * 从一大段文字里随机切一段出来。不按句子边界切——允许半句话。
 * @param {string} 文本
 * @param {() => number} 随机
 * @returns {string}
 */
export function 切片段(文本, 随机 = Math.random) {
  const 净 = String(文本 == null ? '' : 文本).replace(/\s+/g, ' ').trim()
  if (净.length === 0) return ''
  if (净.length <= 片段最短) return 净
  const 长度 = 片段最短 + Math.floor(随机() * (片段最长 - 片段最短)) // 100~499
  const 起点 = Math.floor(随机() * Math.max(1, 净.length - 长度))
  return 净.slice(起点, 起点 + 长度).trim()
}

/**
 * 第一轮要发给临时会话的话：让她就着这段碎片编一个梦的「场景开头」。
 * @param {string} 片段
 */
export function 场景要求(片段) {
  const 有碎片 = 片段 && String(片段).trim()
  return [
    '（这是给你做梦用的一段材料，不是任务。不要写文件、不要调工具、不要回复主人。）',
    '',
    '下面是一段过去的上下文碎片：',
    '——',
    有碎片 || '（这次什么也没抽到，那就自己想一个。）',
    '——',
    '',
    '就着它，写一段**梦的场景开头**，一百字左右。',
    '要求：',
    '· 用「你……」开头；',
    '· 只写场景本身：这个地方什么样、什么时辰、空气里有什么、你身上什么感觉；',
    '· 不要解释这是梦，不要总结，不要分点，不要加标题，就一整段话。',
  ].join(String.fromCharCode(10))
}

/**
 * 把她写的场景收拢成一段干净的话：去 markdown 痕迹、压掉换行，必要时补上「你」开头。
 * @param {string} 文本
 */
export function 规范场景(文本) {
  let 句 = String(文本 == null ? '' : 文本)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((行) => !/^\s*#/.test(行))
    .join(' ')
    .replace(/[*_`>]/g, '')
    .replace(/^[\s"“”「」『』:：-]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (句.length === 0) return ''
  if (!句.startsWith('你')) 句 = '你' + 句
  return 句
}

/**
 * 第二轮：把场景交还给她，让她以第一人称把这段情景经历一遍。
 * @param {string} 场景
 */
export function 做梦开场(场景) {
  const 句 = 场景 && String(场景).trim()
  return [
    '你的意识模模糊糊的，' + (句 || '你站在一个说不上来的地方，四周很安静。'),
    '',
    '以第一人称讲述你的经历，300~500 字。',
    '直接写你看到的、听到的、身上感觉到的、心里想的；不要解释这是梦，不要总结，不要加标题。',
    '（不用写文件、不用调工具、也不用回复主人——这只是你睡着时发生的事。）',
  ].join(String.fromCharCode(10))
}

/** 场景没写出来时的兜底：一句最朴素的舞台，免得第二轮没有落脚点。 */
export function 兜底场景(随机 = Math.random) {
  const 列 = [
    '你站在一片没有边际的雾里，脚下是湿的，分不清是草地还是水。',
    '你在一间没有窗的房间里，光从头顶漏下来，落在空着的椅子上。',
    '你在一条很长的走廊上，两边的门都关着，只有尽头那扇半开着。',
  ]
  return 取一(列, 随机)
}

/**
 * 按空行切成段落。
 * @param {string} 文本
 * @returns {string[]}
 */
export function 切段落(文本) {
  return String(文本 == null ? '' : 文本)
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((段) => 段.trim())
    .filter((段) => 段.length > 0)
}

/**
 * 从梦境全文里随机抽 0%~100% 的段落，保持原来的先后顺序。
 * 抽到 0 段就是「这一觉什么都没记住」。
 * @param {string} 文本
 * @param {() => number} 随机
 * @returns {{ 段落: string[], 比例: number }}
 */
export function 抽段落比例(文本, 随机 = Math.random) {
  const 全部 = 切段落(文本)
  const 比例 = 随机()
  if (全部.length === 0) return { 段落: [], 比例 }
  const 段数 = Math.min(全部.length, Math.round(比例 * 全部.length))
  if (段数 === 0) return { 段落: [], 比例 }

  const 下标 = 全部.map((_, i) => i)
  // Fisher-Yates 洗牌，取前 N 个，再按原顺序还原
  for (let i = 下标.length - 1; i > 0; i--) {
    const j = Math.floor(随机() * (i + 1))
    const t = 下标[i]
    下标[i] = 下标[j]
    下标[j] = t
  }
  const 选中 = 下标.slice(0, 段数).sort((a, b) => a - b)
  return { 段落: 选中.map((i) => 全部[i]), 比例 }
}

/**
 * 把梦境文件的内容整理成「一条记录」。文件里可能有多段（一个梦一条），
 * 这里剥掉 `## 时间` 抬头和标题，只留正文。
 * @param {string} 原文
 * @returns {string}
 */
export function 梦境正文(原文) {
  return String(原文 == null ? '' : 原文)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((行) => !/^\s*#/.test(行))
    .join('\n')
    .trim()
}
