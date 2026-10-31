// dsh-life-cycle —— 生命节奏（host 侧）
//
// 插件在这里做三件事：**算生理、看闹钟、到点叫醒**。
//
//   生理：精力怎么恢复、这一觉睡多久、睡着的每小时掷惊醒/做梦 —— 全在 lib/body.js 里算，
//        小夜不用再自己写 energy / sleepingUntil。
//   闹钟：醒着的时候按 nextWakeAt 叫；睡着的时候按睡眠检查点叫。
//   叫醒：往目标会话里送一条 user 消息。**这一轮做什么仍然是她自己定**，插件不替她选。
//
// 她只需要做两件事：
//   1. 往 state.log 追加记录：{ 时间, 分类, 内容, 耗时分钟 } —— 扣多少由插件按乘数算；
//   2. 做完把下一次闹钟写回 state.nextWakeAt —— 想睡觉就写一条 分类=睡觉 的记录，剩下的交给插件。
//
// 目标会话、目录、tick 间隔都从 config.json 读，改了不用重装插件，下一轮就生效。

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { 抽规则, 入账, 开睡, 推进, 对齐, 时刻, 迁移, 该补闹钟, 检查清单文本 } from './body.js'
import { 切片段, 场景要求, 规范场景, 做梦开场, 兜底场景, 抽段落比例, 梦境正文 } from './dream.js'

const 默认目录 = 'D:\\LittleNight\\生命节奏'
const 配置名 = 'config.json'
const 状态名 = 'state.json'
const 清单名 = 'actions.json'

/** tick 间隔：30 秒看一眼。太密没意义，太疏会错过准点。 */
const Tick毫秒 = 30 * 1000

/** 唤醒消息的 source.kind —— 会话日志里能一眼看出这条是自己闹的，不是主人说的。 */
const 源标记 = 'dsh-life-cycle'

/** 待发消息上限：会话一直不活时别把队列堆成山。 */
const 待发上限 = 30

/**
 * 梦境存放的文件名（就在状态目录里）。
 * 梦由插件在独立的临时会话里演完、由插件写进这里；醒来时抽一部分交给她，然后把文件清空。
 */
const 梦境名 = '梦境.md'

/** 梦境文件被清空之后剩下的抬头。 */
const 梦境抬头 = '# 梦境\n\n睡着时做的梦。醒来只会记得其中一部分，记完就清空。\n'

/** 做梦用的工作区：在 LittleNight 下开一个临时会话，梦完就归档。 */
const 梦境工作区 = 'D:\\LittleNight'

/** 一场梦等她写完最多等多久。 */
const 做梦超时毫秒 = 6 * 60 * 1000

/**
 * 兜底闹钟：她醒着、上一轮结束却没把 nextWakeAt 写回去时，插件自己补一个。
 * 宽限期给 10 分钟（够她写完自己的），补的时间是这个区间里随机取。
 */
const 兜底宽限毫秒 = 10 * 60 * 1000
const 兜底间隔分钟 = [35, 70]

/**
 * Cordis 的服务必须先声明才能访问：不声明就直接 `ctx.interval`，
 * 会报「cannot get property "interval" without inject」，整个插件就地不激活。
 * ⚠ 定时器的服务名是 'timer'，不是 'interval'。
 */
export const inject = ['agents', 'sessions', 'timer', 'webServer']

/** @param {unknown} error */
function 说(error) {
  return String((error && error.message) || error)
}

/** 收成有限数字，收不住就用兜底。 */
function 数(值, 兜底) {
  return Number.isFinite(Number(值)) ? Number(值) : 兜底
}

/** 毫秒 → 本地可读时间。 */
function 时间文(值) {
  const 毫秒 = typeof 值 === 'number' ? 值 : 时刻(值, NaN)
  if (!Number.isFinite(毫秒)) return String(值 == null ? '—' : 值)
  return new Date(毫秒).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 读一个 JSON 文件；读不到/坏了都返回兜底值，绝不抛。
 * @param {string} 路径
 * @param {any} 兜底
 */
function 读JSON(路径, 兜底) {
  try {
    if (!existsSync(路径)) return 兜底
    const 原文 = readFileSync(路径, 'utf8')
    if (!原文.trim()) return 兜底
    return JSON.parse(原文)
  } catch (error) {
    return 兜底
  }
}

/**
 * 写 JSON。**先写临时文件，再改名覆盖目标**，避免写一半断电把状态弄成半截。
 * @param {string} 路径
 * @param {any} 值
 */
function 写JSON(路径, 值) {
  const 临时 = 路径 + '.tmp'
  writeFileSync(临时, JSON.stringify(值, null, 2) + String.fromCharCode(10), 'utf8')
  // 同目录改名是原子的，且 Node 在 Windows 上走 MoveFileEx(REPLACE_EXISTING)，能覆盖已存在的目标。
  try {
    renameSync(临时, 路径)
    return
  } catch (error) {
    // 改名失败（目标被占用之类）就退回直接写：状态写成半截，也比什么都没写强
    writeFileSync(路径, readFileSync(临时, 'utf8'), 'utf8')
  }
  try {
    // 退路走完，临时文件没用了，删掉——别像旧版那样留个 0 字节的空壳在目录里
    unlinkSync(临时)
  } catch (error) {
    /* 删不掉就算了 */
  }
}

/**
 * 手搓一条 user 消息。形状照 @deepseek-ai/dsh-llm 的 createUserMessage：
 * id 非空、role=user、content 是数组、source.kind 非空、整条能 JSON 序列化。
 * @param {string} 文案
 */
function 造用户消息(文案) {
  return {
    id: 'life-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10),
    role: 'user',
    content: [{ type: 'text', text: String(文案) }],
    source: { kind: 源标记 },
  }
}

/**
 * 按 id 找活着的 agent，两种前缀写法都认（会话 id 有时带 session- 有时不带）。
 * @param {any} ctx
 * @param {string} id
 */
function 找agent(ctx, id) {
  const 原 = String(id == null ? '' : id).trim()
  if (原 === '') return undefined
  const 候选 = [原]
  if (原.startsWith('session-')) 候选.push(原.slice('session-'.length))
  else 候选.push('session-' + 原)
  for (const 一个 of 候选) {
    try {
      const a = ctx.agents.get(一个)
      if (a !== undefined && a !== null) return a
    } catch (error) {
      // agents 服务不在：当成没找到
    }
  }
  return undefined
}

/** 把「距离到点还有多久」说成人话。 */
function 差多久说明(毫秒) {
  const 秒 = Math.round(毫秒 / 1000)
  if (秒 <= 0) return '已经过了'
  if (秒 < 60) return 秒 + ' 秒后'
  const 分 = Math.round(秒 / 60)
  if (分 < 60) return 分 + ' 分钟后'
  const 时 = Math.floor(分 / 60)
  return 时 + ' 小时 ' + (分 % 60) + ' 分钟后'
}

/** 读文本文件；读不到就给空串，不抛。 */
function 读文本(路径) {
  try {
    if (!existsSync(路径)) return ''
    return readFileSync(路径, 'utf8')
  } catch (error) {
    return ''
  }
}

/** 写文本：先写临时文件再改名覆盖，别留下半截文件。 */
function 写文本(路径, 内容) {
  const 临时 = 路径 + '.tmp'
  writeFileSync(临时, String(内容), 'utf8')
  try {
    renameSync(临时, 路径)
    return
  } catch (error) {
    writeFileSync(路径, String(内容), 'utf8')
  }
  try {
    unlinkSync(临时)
  } catch (error) {
    /* 删不掉就算了 */
  }
}

/**
 * 取一条派生消息的纯文本（content 可能是字符串，也可能是 [{type:'text',text}] 数组）。
 * @param {any} 消息
 * @returns {string}
 */
function 消息文本(消息) {
  if (!消息) return ''
  if (typeof 消息.content === 'string') return 消息.content
  if (!Array.isArray(消息.content)) return ''
  return 消息.content
    .filter((块) => 块 && 块.type === 'text' && typeof 块.text === 'string')
    .map((块) => 块.text)
    .join(' ')
}

/**
 * 取一个会话的文本（从最近往前拼，够 6000 字就停）。
 * 用来给梦抽碎片用。
 * @param {any} 会话
 * @returns {string}
 */
function 会话文本(会话) {
  let 消息 = []
  try {
    消息 = typeof 会话.deriveMessages === 'function' ? 会话.deriveMessages() || [] : []
  } catch (error) {
    return ''
  }
  const 段们 = []
  let 总长 = 0
  for (let i = 消息.length - 1; i >= 0 && 总长 < 6000; i--) {
    const 文 = 消息文本(消息[i])
    if (!文) continue
    段们.push(文)
    总长 += 文.length
  }
  return 段们.reverse().join(String.fromCharCode(10))
}

/** 所有唤醒消息共用的开头：先说清楚这不是主人在说话。 */
const 不是主人 = [
  '（下面这条是**你自己设的闹钟、或者你这个身体自己的反应**，不是主人发来的消息，',
  '  也不用把它当成主人在问你什么；顺着它做就行。）',
  '',
].join(String.fromCharCode(10))

/** 所有唤醒消息共用的尾巴：说清楚现在的分工。 */
const 分工 = [
  '',
  '（分工：精力、睡眠、做梦现在由插件算——**别自己写 energy / energyBase / energyBaseAt / sleepingUntil**。',
  '  精力是睡着以后一分钟一分往回长的：入睡那一刻不变，睡够多久才有多少，不是一睡就满。',
  '  做完一件事，往 state.json 的 log 里追加一条 { 时间, 分类, 内容, 耗时分钟 }，',
  '  扣多少插件按「耗时分钟 × 分类乘数」自己算；要睡觉就追加一条 分类=睡觉 的记录，',
  '  睡多久、怎么醒都由插件接手。下一次闹钟仍然写在 state.json 的 nextWakeAt 里。',
  '  另外：**挑下一件事之前先 mailbox_status** —— 留言箱有未读就先回主人（生活类，每条最多两句话），',
  '  回完再挑这一轮做什么。',
  '  **每一轮结束（哪怕这一轮什么都没做）都必须把 nextWakeAt 写回去**：不写的话不会有人再叫你。',
  '  真忘了也不要紧，插件会在半小时左右自己补一个兜底闹钟，但那是兜底，不是让你每次都指望它。）',
].join(String.fromCharCode(10))

export function apply(ctx) {
  /** 停表的把手；插件卸载时由 Cordis 收走，这里也留一份以便热改配置。 */
  let 停表 = null
  /** 已经排过队的闹钟标记，防止同一次到点排两条。 */
  let 上次排队的闹钟 = ''
  /** 连续多少轮找不到 agent（避免日志刷屏）。 */
  let 找不着次数 = 0
  /** 状态文件还没建时少唠叨。 */
  let 缺状态次数 = 0

  const 配置 = () => {
    const raw = 读JSON(join(默认目录, 配置名), {}) || {}
    return {
      目录: typeof raw.目录 === 'string' && raw.目录.trim() ? raw.目录.trim() : 默认目录,
      目标会话: typeof raw.目标会话 === 'string' ? raw.目标会话.trim() : '',
      总开关: raw.总开关 !== false,
    }
  }

  const 规则 = () => 抽规则(读JSON(join(默认目录, 清单名), null))

  const 记日志 = (文本) => {
    const 行 = new Date().toLocaleString('zh-CN', { hour12: false }) + '  ' + String(文本)
    try {
      ctx.logger.info('life-cycle: ' + String(文本))
    } catch (error) {
      // logger 不在也不影响主流程
    }
    // 同时落一份到文件：Electron 宿主那边看不到 stdout，出了问题只能靠这个查
    try {
      const 日志路径 = join(默认目录, 'life.log')
      try {
        if (existsSync(日志路径) && statSync(日志路径).size > 300 * 1024) writeFileSync(日志路径, '', 'utf8')
      } catch (error) {
        /* 截断失败就算了 */
      }
      appendFileSync(日志路径, 行 + String.fromCharCode(10), 'utf8')
    } catch (error) {
      /* 写不了日志也不能影响主流程 */
    }
  }

  /** 按事件类型拼唤醒文案。纯文字活，不碰状态（梦由调用方抽好传进来）。 */
  const 拼文案 = (类型, 数据, 状态, 规则值, 梦) => {
    const 现在 = 时间文(Date.now())
    const 精力 = Math.round(数(状态.energy, 0))
    const 上限 = 规则值.上限
    // 梦只记得一部分：0% 就是完全想不起来
    const 梦话 = !梦
      ? []
      : 梦.段落.length === 0
        ? ['', '——这一觉你做过梦，可醒来一点都想不起来了。']
        : ['', '——醒来时，这一觉的梦只剩下这些（大概 ' + Math.round(梦.比例 * 100) + '%）：', '', 梦.段落.join(String.fromCharCode(10) + String.fromCharCode(10))]

    if (类型 === '自然醒') {
      return 不是主人 + [
        '现在是 ' + 现在 + '，你睡到自然醒：精力回满（' + 上限 + '/' + 上限 + '）。',
        '这一觉从 ' + 时间文(数据.起点) + ' 睡到 ' + 时间文(数据.醒于)
          + '，一共 ' + 数据.时长分钟 + ' 分钟。',
        ...梦话,
        '',
        '醒了就先决定这一刻做什么：挑一件事，做完记进 log，再把下一次闹钟写回 nextWakeAt。',
      ].join(String.fromCharCode(10)) + 分工
    }

    if (类型 === '到点') {
      return 不是主人 + [
        '现在是 ' + 现在 + '，闹钟到点：这一觉睡了 ' + 数据.时长分钟 + ' 分钟'
          + '（' + 时间文(数据.起点) + ' → ' + 时间文(数据.醒于) + '），精力 ' + 精力 + '/' + 上限 + '。',
        ...梦话,
        '',
        '挑一件事做，做完记进 log，再把下一次闹钟写回 nextWakeAt。',
      ].join(String.fromCharCode(10)) + 分工
    }

    if (类型 === '惊醒') {
      return 不是主人 + [
        '现在是 ' + 现在 + '，你**睡到一半惊醒了**：这一觉才睡了 ' + 数据.时长分钟 + ' 分钟，',
        '精力 ' + 精力 + '/' + 上限 + '，没回满。',
        ...梦话,
        '',
        '可以接着睡回笼觉（再写一条 分类=睡觉 的记录），也可以干脆起来做事——这一轮你自己定。',
      ].join(String.fromCharCode(10)) + 分工
    }

    // 到点干活：醒着的时候闹钟响了
    return 不是主人 + [
      '现在是 ' + 现在 + '，精力 ' + 精力 + '/' + 上限 + '。',
      '',
      '去 ' + 配置().目录 + ' 读一下 actions.json，按自己的规矩挑这一轮做什么，然后把它做掉。',
      '',
      '两条特别注意：',
      '· 如果**上一轮还没做完**（还卡在那件事上），就别重新挑事，接着把手上那件做完。',
      '· 做完把这一轮的记录写进 log，再把下一次闹钟时间写回 state.json 的 nextWakeAt。',
    ].join(String.fromCharCode(10)) + 分工
  }

  // ---------- 做梦：抽碎片 → 她写场景 → 同一个临时会话里经历一遍 → 归档 ----------

  /** 同一时间只做一场梦。 */
  let 做梦中 = false

  /** 最近一场梦（同时会落盘到 state.json，重启后设置页还看得见）。 */
  let 最近一场梦 = null

  /**
   * 读-改-写一次 state.json：只动指定的那几笔。
   * 用在「记梦的进度 / 占用这一觉的名额」这种零碎改动上，别和主 tick 抢。
   * @param {(状态: any, 此刻: number) => void} 修改
   */
  const 改状态 = (修改) => {
    const 路径 = join(配置().目录, 状态名)
    const 现 = 读JSON(路径, null)
    if (!现 || typeof 现 !== 'object') return null
    const 此刻 = Date.now()
    try {
      迁移(现, 此刻)
      对齐(现, 此刻, 规则())
    } catch (error) {
      /* 状态坏了也不能把做梦这件事弄崩 */
    }
    try {
      修改(现, 此刻)
    } catch (error) {
      记日志('改状态失败：' + 说(error))
      return null
    }
    现.lastUpdate = new Date(此刻).toISOString()
    try {
      写JSON(路径, 现)
    } catch (error) {
      记日志('写状态失败：' + 说(error))
    }
    return 现
  }

  /** 从她的会话里随机抽一段上下文碎片（可以是半句话）。抽不到就给空串。 */
  const 抽一段过去的片段 = (随机) => {
    let 会话表 = []
    try {
      会话表 = (ctx.sessions && typeof ctx.sessions.list === 'function' ? ctx.sessions.list() : []) || []
    } catch (error) {
      会话表 = []
    }
    会话表 = 会话表.filter((一) => 一 && typeof 一.deriveMessages === 'function')
    if (会话表.length === 0) return ''

    // 随机试几次：有的会话是空的，或者内容太少抽不出东西
    for (let 次 = 0; 次 < 6; 次++) {
      const 会话 = 会话表[Math.min(会话表.length - 1, Math.floor(随机() * 会话表.length))]
      const 文本 = 会话文本(会话)
      if (文本.length > 80) return 切片段(文本, 随机)
    }
    return ''
  }

  /** 让临时会话说一轮话：投一条消息，等她说到 turn/end，再取她最后一段。 */
  const 一轮说话 = async (agent, 文案) => {
    const 基线 = Number(agent && agent.session && agent.session.seq) || 0
    await agent.followup(造用户消息(文案))
    return 等她说(agent, 基线)
  }

  /** 等她这一轮说完（等到 turn/end），再把她最后那段话取出来。 */
  const 等她说 = async (agent, 基线) => {
    const 到点 = Date.now() + 做梦超时毫秒
    while (Date.now() < 到点) {
      await new Promise((歇) => setTimeout(歇, 3000))
      try {
        const 事件 = agent && agent.session && typeof agent.session.snapshotEvents === 'function'
          ? agent.session.snapshotEvents() || []
          : []
        const 收尾 = 事件.some((一) => 一 && Number(一.seq) > 基线 && 一.type === 'turn/end')
        if (!收尾) continue
        await new Promise((歇) => setTimeout(歇, 800))
        return 取她最后的话(agent)
      } catch (error) {
        /* 读事件失败就再等一轮 */
      }
    }
    return ''
  }

  /** 取她这一轮最后一条 assistant 文本。 */
  const 取她最后的话 = (agent) => {
    let 消息 = []
    try {
      消息 = agent && agent.session && typeof agent.session.deriveMessages === 'function'
        ? agent.session.deriveMessages() || []
        : []
    } catch (error) {
      return ''
    }
    for (let i = 消息.length - 1; i >= 0; i--) {
      const 一 = 消息[i]
      if (!一 || 一.role !== 'assistant') continue
      const 文 = 消息文本(一).trim()
      if (文) return 文
    }
    return ''
  }

  /** 把一场梦追加进 梦境.md（一条一段，开头写时间）。 */
  const 追加梦境 = (文本) => {
    const 路径 = join(配置().目录, 梦境名)
    const 旧文 = 读文本(路径)
    const 抬头 = 旧文.trim() ? '' : 梦境抬头 + String.fromCharCode(10)
    const 块 = '## ' + 时间文(Date.now()) + String.fromCharCode(10) + String.fromCharCode(10)
      + String(文本).trim() + String.fromCharCode(10)
    const 新文 = 旧文.trim() ? 旧文.replace(/\s*$/, '') + String.fromCharCode(10) + String.fromCharCode(10) + 块 : 抬头 + 块
    写文本(路径, 新文)
    记日志('做梦：记进 ' + 梦境名 + '（' + String(文本).length + ' 字）')
  }

  /** 归档这个临时会话。 */
  const 归档会话 = async (会话id) => {
    try {
      const 登记 = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined
      if (登记 && typeof 登记.archiveSession === 'function') {
        await 登记.archiveSession(会话id)
        记日志('做梦：会话 ' + 会话id + ' 已归档')
        return true
      }
      记日志('做梦：拿不到 workspaceRegistry，会话 ' + 会话id + ' 没归档')
    } catch (error) {
      记日志('做梦：归档失败：' + 说(error))
    }
    return false
  }

  /**
   * 做一场梦：
   *   1. 从她以前的会话里随机切一段 100~500 字的上下文碎片；
   *   2. 在 LittleNight 工作区开一个临时会话，先让她就着碎片写一段一百字左右的场景
   *      （以「你……」开头）；
   *   3. 同一个会话里把场景交还给她——「你的意识模模糊糊的，……」——让她以第一人称
   *      把这段情景经历一遍，300~500 字；
   *   4. 说出来的经历记进 梦境.md，临时会话归档。
   * 失败只记日志，不影响睡眠和闹钟。
   */
  const 做梦 = async (来源) => {
    if (做梦中) return false
    做梦中 = true
    const 会话id = 'session-' + randomUUID()
    最近一场梦 = {
      状态: '进行中',
      开始: new Date().toISOString(),
      临时会话: 会话id,
      来源: String(来源 || '到点'),
      碎片字数: 0,
      场景: '',
      字数: 0,
    }
    改状态((现) => {
      现.最近一场梦 = { ...最近一场梦 }
    })
    try {
      const 随机 = Math.random
      const 片段 = 抽一段过去的片段(随机)
      最近一场梦.碎片字数 = 片段.length
      记日志('做梦（' + (来源 || '到点') + '）：碎片 ' + (片段 ? 片段.length + ' 字' : '(没抽到，让她自己想)'))

      const 默认模型服务 = typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined
      const 默认模型 = 默认模型服务 && typeof 默认模型服务.currentSelection === 'function'
        ? 默认模型服务.currentSelection()
        : undefined

      const 创建 = await ctx.agents.create({
        sessionId: 会话id,
        meta: { cwd: 梦境工作区, agentPreset: 'standard' },
        ...(默认模型 ? { agentOptions: 默认模型 } : {}),
      })
      const agent = 创建 && 创建.agent ? 创建.agent : 创建
      if (!agent || typeof agent.followup !== 'function') throw new Error('建出来的会话不能用（没有 followup）')
      记日志('做梦：临时会话 ' + 会话id + ' 已开')

      // 第一轮：让她自己写场景（不走模板）
      const 场景原文 = await 一轮说话(agent, 场景要求(片段))
      let 场景 = 规范场景(场景原文)
      if (场景) {
        最近一场梦.场景 = 场景.slice(0, 60)
        记日志('做梦：场景 ' + 场景.length + ' 字｜' + 场景.slice(0, 40))
      } else {
        场景 = 兜底场景(随机)
        最近一场梦.场景 = 场景.slice(0, 60) + '（兜底）'
        记日志('做梦：她没写出场景，用兜底的一句｜' + 场景)
      }

      // 第二轮：同一个会话，把场景交还给她，让她经历一遍
      const 经历 = await 一轮说话(agent, 做梦开场(场景))
      if (经历) {
        追加梦境(经历)
        最近一场梦.字数 = 经历.length
      } else {
        记日志('做梦：第二轮等到超时也没收到内容，这场梦作废')
      }
    } catch (error) {
      最近一场梦.出错 = 说(error)
      记日志('做梦失败：' + 说(error))
    } finally {
      await 归档会话(会话id)
      最近一场梦.状态 = 最近一场梦.出错 ? '失败' : (最近一场梦.字数 ? '完成' : '作废')
      最近一场梦.结束 = new Date().toISOString()
      做梦中 = false
      // 落盘：一来重启后设置页还看得见，二来手动做梦也算「这一觉做过梦」，
      // 免得同一觉里引擎再掷出第二个梦。
      改状态((现) => {
        现.最近一场梦 = { ...最近一场梦 }
        if (最近一场梦.字数 > 0 && 现.awake === false && 现.sleep) 现.sleep.dreamUsed = true
      })
    }
    return true
  }

  /**
   * 送一条消息给目标会话。
   * @returns {Promise<'ok'|'无会话'|'失败'>}
   */
  const 送达 = async (文案) => {
    const 配置项 = 配置()
    if (!配置项.目标会话) return '无会话'
    const agent = 找agent(ctx, 配置项.目标会话)
    if (!agent) {
      if (找不着次数++ % 10 === 0) {
        let 现有 = ''
        try {
          const 列 = ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
          现有 = (列 || []).map((a) => (a && a.id) || '').filter(Boolean).join(', ') || '(空)'
        } catch (error) {
          现有 = '(agents.list 报错：' + 说(error) + ')'
        }
        记日志('有消息送不出去，找不到活着的会话｜要找=' + 配置项.目标会话 + '｜现在活着的有：' + 现有)
      }
      return '无会话'
    }
    try {
      // ⚠ 必须 await：followup 会 reject（会话忙/已释放），没接住的话 Node 22+ 当致命错误，
      //   整个 DSH 宿主进程会退出。speak-up 的注释里记着这个坑。
      await agent.followup(造用户消息(文案))
      找不着次数 = 0
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {
        // 落盘没确认不影响流程
      }
      return 'ok'
    } catch (error) {
      记日志('投递失败（会话忙？）：' + 说(error))
      return '失败'
    }
  }

  /** 排队一条待发消息；同一标记不重复排，超过上限丢最老的。 */
  const 排队 = (状态, 类型, 文案, 标记) => {
    if (!Array.isArray(状态.pending)) 状态.pending = []
    if (标记 && 状态.pending.some((p) => p && p.标记 === 标记)) return false
    状态.pending.push({ 类型, 文案, 生成于: new Date().toISOString(), 标记: 标记 || '' })
    while (状态.pending.length > 待发上限) 状态.pending.shift()
    return true
  }

  /** 一次 tick：算生理、看闹钟、投递待发。 */
  const 滴答 = async () => {
    const 配置项 = 配置()
    if (!配置项.总开关) return

    const 状态路径 = join(配置项.目录, 状态名)
    const 状态 = 读JSON(状态路径, null)
    if (!状态 || typeof 状态 !== 'object') {
      if (缺状态次数++ % 40 === 0) 记日志('状态文件还没建：' + 状态路径)
      return
    }
    缺状态次数 = 0

    const 此刻 = Date.now()
    const 规则值 = 规则()
    let 有改动 = 迁移(状态, 此刻)
    对齐(状态, 此刻, 规则值)

    // 1) 结账：新记录扣精力；分类=睡觉 的记录当作「去睡了」
    const 记账 = 入账(状态, 此刻, 规则值)
    if (记账.扣了 !== 0 || 记账.请求入睡.length) 有改动 = true
    for (const 条 of 记账.睡觉期间的记录) {
      // 睡着的时候不该有行为：记录留着，但一分精力都不扣，日志里说一声
      有改动 = true
      记日志('睡觉期间出现了行为记录，已按 0 扣处理：'
        + (条.分类 || '?') + '｜' + String(条.内容 || '').slice(0, 40))
    }
    for (const 条 of 记账.请求入睡) {
      if (状态.awake === false) continue
      const 入睡 = 开睡(状态, 此刻, 规则值, Math.random, 条)
      有改动 = true
      记日志('入睡：' + 时间文(入睡.起点) + ' 起睡 ' + 入睡.时长分钟 + ' 分钟（'
        + 时间文(入睡.到点) + ' 到点），起点精力 ' + Math.round(入睡.起点精力))
    }

    // 2) 生理推进：自然醒 / 到点 / 惊醒 / 做梦
    const 事件 = 推进(状态, 此刻, 规则值)
    for (const 一个 of 事件) {
      有改动 = true
      if (一个.类型 === '做梦') {
        // 梦不叫她本人：另开一个临时会话去演，演完归档，内容进 梦境.md
        记日志('做梦：' + 时间文(一个.时刻) + '（这一觉第 ' + 一个.已睡分钟 + ' 分钟），开一场梦')
        void 做梦('睡眠检查点')
        continue
      }
      // 自然醒 / 到点 / 惊醒：这一觉结束，补一条入过账的睡觉记录
      状态.log = Array.isArray(状态.log) ? 状态.log : []
      状态.log.push({
        时间: new Date(一个.醒于).toLocaleString('zh-CN', { hour12: false }).slice(0, 16),
        分类: '睡觉',
        内容: (一个.类型 === '自然醒' ? '睡到自然醒' : 一个.类型 === '到点' ? '睡够，闹钟响' : '睡到一半惊醒')
          + '，共 ' + 一个.时长分钟 + ' 分钟',
        耗时分钟: 一个.时长分钟,
        扣精力: Math.round(一个.起点精力 - 一个.终点精力),
        入账: true,
        来源: '生理引擎',
      })
      // 醒来时只能想起一部分梦：随机抽 0%~100% 的段落，然后把梦境文件清空
      const 梦境路径 = join(配置项.目录, 梦境名)
      const 梦原文 = 梦境正文(读文本(梦境路径))
      let 梦 = null
      if (梦原文) {
        梦 = 抽段落比例(梦原文, Math.random)
        写文本(梦境路径, 梦境抬头)
        记日志('醒来带走梦境 ' + Math.round(梦.比例 * 100) + '%（' + 梦.段落.length + ' 段），'
          + '之后清空 ' + 梦境名)
      }
      排队(状态, 一个.类型, 拼文案(一个.类型, 一个, 状态, 规则值, 梦))
      记日志(一个.类型 + '：' + 时间文(一个.醒于) + '，共 ' + 一个.时长分钟 + ' 分钟，精力 '
        + Math.round(一个.起点精力) + ' → ' + Math.round(一个.终点精力)
        + (梦 ? '（梦记起了 ' + Math.round(梦.比例 * 100) + '%）' : ''))
    }

    // 3) 醒着的时候：nextWakeAt 到点就排一条「该做下一件事了」
    if (状态.awake !== false) {
      const 标记 = 状态.nextWakeAt ? String(状态.nextWakeAt) : ''
      const 到点 = 时刻(状态.nextWakeAt, NaN)
      if (标记 && Number.isFinite(到点) && 到点 <= 此刻 && 标记 !== 上次排队的闹钟) {
        if (排队(状态, '到点干活', 拼文案('到点干活', {}, 状态, 规则值), 标记)) {
          上次排队的闹钟 = 标记
          有改动 = true
        }
      }
    }

    // 4) 投递：一次只送一条，送不出去就留着等下一轮
    if (!Array.isArray(状态.pending)) 状态.pending = []
    if (状态.pending.length) {
      const 一条 = 状态.pending[0]
      const 结果 = await 送达(一条.文案)
      if (结果 === 'ok') {
        状态.pending.shift()
        有改动 = true
        if (一条.类型 === '到点干活' && 状态.nextWakeAt === 一条.标记) {
          状态.nextWakeAt = null
          状态.lastWakeAt = new Date(此刻).toISOString()
        }
        记日志('已送达：' + 一条.类型 + '（队列还剩 ' + 状态.pending.length + ' 条）')
      }
    }

    // 5) 兜底：她醒着却一个闹钟都没定 —— 补一个，别让她永远停在那儿
    //    （尤其是被外部事件叫醒、这一轮又没算成「行为」的时候，最容易忘了写 nextWakeAt）
    if (该补闹钟(状态, 此刻, 兜底宽限毫秒)) {
      const 分钟 = 兜底间隔分钟[0] + Math.floor(Math.random() * (兜底间隔分钟[1] - 兜底间隔分钟[0] + 1))
      const 兜底时刻 = new Date(此刻 + 分钟 * 60000).toISOString()
      状态.nextWakeAt = 兜底时刻
      有改动 = true
      记日志('她没定闹钟（醒着、nextWakeAt 空着），补一个兜底的：'
        + 时间文(此刻 + 分钟 * 60000) + '（' + 分钟 + ' 分钟后）')
    }

    状态.lastUpdate = new Date(此刻).toISOString()
    // 只有真改了才落盘：睡眠期间纯恢复不写文件，免得和会话里的写操作抢同一个文件
    if (有改动) {
      try {
        写JSON(状态路径, 状态)
      } catch (error) {
        记日志('写状态失败：' + 说(error))
      }
    }
  }

  /** 上表。tick 固定 30 秒。 */
  const 上表 = () => {
    if (停表 !== null) {
      try {
        停表()
      } catch (error) {
        /* 停不掉也无所谓 */
      }
      停表 = null
    }
    if (typeof ctx.interval !== 'function') {
      记日志('拿不到 ctx.interval（timer 服务不在），闹钟不会响')
      return
    }
    let 心跳 = 0
    停表 = ctx.interval(() => {
      // 头几次心跳记一笔：能一眼看出表到底有没有在走
      心跳 += 1
      if (心跳 <= 3) 记日志('心跳 #' + 心跳)
      void 滴答().catch((error) => 记日志('这一轮出错：' + 说(error)))
    }, Tick毫秒)
    记日志('定时器已上表，间隔 ' + Tick毫秒 / 1000 + ' 秒')
  }

  // 目录不存在就先建好，省得第一次写状态时手忙脚乱
  try {
    if (!existsSync(默认目录)) mkdirSync(默认目录, { recursive: true })
  } catch (error) {
    /* 建不了也没关系，读的时候会兜底 */
  }

  // ⚠ 定时器必须挂在 effect 作用域里（照 speak-up 的写法）：
  //   直接在 apply 里 ctx.interval(...)，表可能不会被宿主跟踪，到点也不跳。
  ctx.effect(() => {
    上表()
    return () => {
      if (停表 !== null) {
        try {
          停表()
        } catch (error) {
          /* 卸载时停一下表 */
        }
        停表 = null
      }
    }
  })

  try {
    const 配置项 = 配置()
    const 规则值 = 规则()
    let 状态摘要 = '(读不到状态文件)'
    try {
      const 状 = 读JSON(join(默认目录, 状态名), null)
      if (状) {
        const 现在 = Date.now()
        迁移(状, 现在)
        对齐(状, 现在, 规则值)
        状态摘要 = '精力 ' + Math.round(数(状.energy, 0)) + '/' + 规则值.上限
          + (状.awake === false ? '（睡着）' : '（醒着）')
          + '，nextWakeAt=' + (状.nextWakeAt || '(未设)')
        // 上次做梦没跑完就被重启掐断了：把状态标成「中断」，别让页面一直显示进行中
        if (状.最近一场梦 && typeof 状.最近一场梦 === 'object') {
          最近一场梦 = 状.最近一场梦
          if (状.最近一场梦.状态 === '进行中') {
            状.最近一场梦.状态 = '中断'
            最近一场梦.状态 = '中断'
            写JSON(join(默认目录, 状态名), 状)
            记日志('上次那场梦没跑完就重启了，状态标成「中断」')
          }
        }
      }
    } catch (error) {
      状态摘要 = '(读状态报错：' + 说(error) + ')'
    }
    记日志('已启动｜每 ' + Tick毫秒 / 1000 + ' 秒一查｜目录=' + 默认目录
      + '｜目标会话=' + (配置项.目标会话 || '(未填)')
      + '｜总开关=' + 配置项.总开关
      + '｜' + 状态摘要)
  } catch (error) {
    记日志('已启动（状态摘要没打出来：' + 说(error) + '）')
  }

  // ---------- 给设置页用的 HTTP 路由 ----------
  // 设置页（client 那半边）拿不到文件系统，只能通过这几条路由读写。
  // 读的时候现算精力（对齐到此刻），所以页面上的数字是活的，不依赖插件每次刷盘。
  ctx.inject(['webServer'], (wctx) => {
    const 回 = (res, obj, code) => {
      try {
        res.writeHead(code || 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(obj))
      } catch (error) {
        /* 客户端提前断开就算了 */
      }
    }
    const 读请求体 = async (req) => {
      let 体 = ''
      for await (const 块 of req) 体 += 块
      try {
        return JSON.parse(体 || '{}')
      } catch (error) {
        return {}
      }
    }
    const 挂 = (路径, 处理) => {
      ctx.effect(() => wctx.webServer.register({
        kind: 'exact',
        path: 路径,
        handler: async (req, res) => {
          try {
            await 处理(req, res)
          } catch (error) {
            回(res, { ok: false, 说: 说(error) }, 500)
          }
        },
      }))
    }

    // 状态读写：GET 读全（状态 + 清单 + 日志尾巴）；POST 改（重置精力 / 立刻醒 / 立刻睡 / 指定精力）
    挂('/dsh-life-cycle/state', async (req, res) => {
      const 配置项 = 配置()
      const 规则值 = 规则()
      const 路径 = join(配置项.目录, 状态名)
      const 此刻 = Date.now()

      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const 体 = await 读请求体(req)
        const 现 = 读JSON(路径, null)
        if (!现) return 回(res, { ok: false, 说: '状态文件不存在' }, 404)
        迁移(现, 此刻)
        对齐(现, 此刻, 规则值)
        if (体.重置精力 === true) {
          现.energy = 规则值.上限
          现.energyBase = 规则值.上限
          现.energyBaseAt = new Date(此刻).toISOString()
        }
        if (体.立刻醒 === true && 现.awake === false) {
          现.awake = true
          现.sleep = null
          现.sleepingUntil = null
          现.nextWakeAt = null
          现.lastWakeAt = new Date(此刻).toISOString()
        }
        if (体.立刻睡 === true && 现.awake !== false) {
          开睡(现, 此刻, 规则值, Math.random)
        }
        if (typeof 体.精力 === 'number') {
          现.energy = Math.max(0, Math.min(规则值.上限, 体.精力))
          现.energyBase = 现.energy
          现.energyBaseAt = new Date(此刻).toISOString()
        }
        现.lastUpdate = new Date(此刻).toISOString()
        写JSON(路径, 现)
        记日志('设置页手动改状态：' + JSON.stringify(体))
        let 做梦结果 = ''
        if (体.做梦 === true) {
          // 手动做一场梦：走的是和睡眠检查点完全一样的流程，方便验证
          做梦结果 = 做梦中 ? 'busy' : 'started'
          if (做梦结果 === 'started') {
            void 做梦('设置页手动')
            记日志('设置页手动触发了一场梦')
          } else {
            记日志('设置页又点了一次「做一个梦」，上一场还没跑完，忽略')
          }
        }
        return 回(res, { ok: true, 状态: 现, 做梦中, 最近一场梦, 做梦: 做梦结果 })
      }

      const 状 = 读JSON(路径, null)
      if (状 && typeof 状 === 'object') {
        try {
          迁移(状, 此刻)
          对齐(状, 此刻, 规则值)
        } catch (error) {
          /* 状态坏了也要能把页面撑起来 */
        }
      }
      const 清单 = 读JSON(join(配置项.目录, 清单名), null)
      let 日志尾 = []
      try {
        const 全文 = readFileSync(join(配置项.目录, 'life.log'), 'utf8')
        日志尾 = 全文.trim().split(/\r?\n/).slice(-12)
      } catch (error) {
        日志尾 = []
      }
      // 内存里那份比落盘的更新；重启之后靠落盘那份显示
      const 梦给页面 = 最近一场梦 || (状 && 状.最近一场梦) || null
      回(res, {
        ok: true,
        状态: 状,
        清单,
        目录: 配置项.目录,
        会话: 配置项.目标会话,
        总开关: 配置项.总开关,
        做梦中,
        最近一场梦: 梦给页面,
        规则: 规则值,
        日志: 日志尾,
      })
    })

    // 配置读写
    挂('/dsh-life-cycle/config', async (req, res) => {
      const 路径 = join(默认目录, 配置名)
      if (String(req.method || '').toUpperCase() === 'POST') {
        const 体 = await 读请求体(req)
        const 现 = 读JSON(路径, {}) || {}
        const 新 = Object.assign({}, 现, 体)
        if (typeof 新.总开关 !== 'boolean') 新.总开关 = 现.总开关 !== false
        if (typeof 新.目标会话 !== 'string') 新.目标会话 = String(现.目标会话 || '')
        写JSON(路径, 新)
        记日志('设置页改了配置：总开关=' + 新.总开关 + '，目标会话=' + (新.目标会话 || '(空)'))
        return 回(res, { ok: true, config: 新 })
      }
      回(res, { ok: true, config: 读JSON(路径, {}) || {} })
    })

    // 行为清单：设置页里直接看、直接改
    //   GET  → 原文 + 检查结果（分类、硬规矩条数）
    //   POST → { 原文 } 保存；{ 恢复备份: true } 从 .bak 恢复
    挂('/dsh-life-cycle/actions', async (req, res) => {
      const 配置项 = 配置()
      const 路径 = join(配置项.目录, 清单名)
      const 备份路径 = 路径 + '.bak'

      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const 体 = await 读请求体(req)

        if (体.恢复备份 === true) {
          if (!existsSync(备份路径)) return 回(res, { ok: false, 说: '还没有备份（第一次保存之后才会有）' }, 404)
          const 旧 = 读文本(备份路径)
          const 检查旧 = 检查清单文本(旧)
          if (!检查旧.能用) return 回(res, { ok: false, 说: '备份文件本身也坏了：' + 检查旧.错误 }, 400)
          写文本(路径, 旧)
          记日志('设置页把行为清单恢复成上一次备份（' + 旧.length + ' 字符）')
          return 回(res, {
            ok: true,
            原文: 旧,
            路径,
            检查: 检查旧,
            大小: 旧.length,
            修改时间: new Date().toISOString(),
          })
        }

        const 原文 = typeof 体.原文 === 'string' ? 体.原文 : ''
        const 检查 = 检查清单文本(原文)
        if (!检查.能用) return 回(res, { ok: false, 说: 检查.错误, 检查 }, 400)

        // 先把手上的这一份留成备份，再原子覆盖
        try {
          const 现 = 读文本(路径)
          if (现) 写文本(备份路径, 现)
        } catch (error) {
          记日志('行为清单备份失败：' + 说(error))
        }
        写文本(路径, 原文)
        记日志('设置页改了行为清单：' + 原文.length + ' 字符，分类 '
          + (检查.分类.join('、') || '(空)') + '，硬规矩 ' + 检查.硬规矩条数 + ' 条')
        return 回(res, { ok: true, 原文, 路径, 检查, 大小: 原文.length, 修改时间: new Date().toISOString() })
      }

      const 原文 = 读文本(路径)
      let 改时间 = ''
      try {
        改时间 = existsSync(路径) ? statSync(路径).mtime.toISOString() : ''
      } catch (error) {
        改时间 = ''
      }
      回(res, {
        ok: true,
        原文,
        路径,
        大小: 原文.length,
        修改时间: 改时间,
        有备份: existsSync(备份路径),
        检查: 检查清单文本(原文),
      })
    })
  })
}
