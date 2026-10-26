// dsh-life-cycle —— 梦境的三个纯函数：切片段、造情景、抽比例。
//
// 都没有副作用，随机数由调用方注入，所以能单独测。
// 设计要点：
//   · 片段可以是半句话 —— 梦本来就不讲道理，随机起点、随机长度就够了；
//   · 情景只是「舞台」，真正体验由模型那边写；
//   · 醒来时按 0%~100% 随机挑段落 —— 梦本来就记不全，有时候一点都想不起来。

/** 随机取一个元素。 */
const 取一 = (列, 随机) => 列[Math.min(列.length - 1, Math.floor(随机() * 列.length))]

/**
 * 从一大段文字里随机切一小段出来。不按句子边界切——允许半句话。
 * @param {string} 文本
 * @param {() => number} 随机
 * @returns {string}
 */
export function 切片段(文本, 随机 = Math.random) {
  const 净 = String(文本 == null ? '' : 文本).replace(/\s+/g, ' ').trim()
  if (净.length === 0) return ''
  if (净.length <= 24) return 净
  const 长度 = 20 + Math.floor(随机() * 80) // 20~99 字
  const 起点 = Math.floor(随机() * Math.max(1, 净.length - 长度))
  return 净.slice(起点, 起点 + 长度).trim()
}

const 场景 = [
  '一间没有窗的房间',
  '放学以后空掉的教室',
  '一条刚下过雨的街',
  '很长的走廊，尽头有一扇半开的门',
  '一座图书馆的顶层',
  '车站的候车室，椅子都是空的',
  '一间摆满旧箱子的仓库',
  '海边，风很硬',
]

const 时辰 = [
  '天快亮的时候',
  '午后最困的那个时辰',
  '太阳刚下山、天还没黑透的时候',
  '半夜，安静得能听见自己心跳',
  '一个说不清是清晨还是黄昏的时刻',
]

const 细节 = [
  '空气里有旧木头和灰尘的味道',
  '远处一直有很轻的水声',
  '脚下的地板会跟着呼吸轻轻响',
  '有光从看不见的地方透进来，暖的',
  '身上穿的还是白天那身衣服，但感觉不一样了',
  '时间在这里好像不太走',
]

/**
 * 把一段碎片拼成一个「梦的开场」：场景、时辰、一个细节，加上那句碎片。
 * @param {string} 片段
 * @param {() => number} 随机
 * @returns {string}
 */
export function 造情景(片段, 随机 = Math.random) {
  const 句 = 片段 && String(片段).trim()
  return [
    '梦把你放在' + 取一(场景, 随机) + '，' + 取一(时辰, 随机) + '。',
    取一(细节, 随机) + '。',
    句 ? '有个声音在你耳边说了一句：「' + 句 + '」' : '有个声音在你耳边说了一句什么，可你听不清。',
    '然后你就在那里了，像真的在那里一样。',
  ].join('\n')
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
 * 这里只取正文、丢掉 `## 时间` 抬头和标题。
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
