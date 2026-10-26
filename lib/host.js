// dsh-life-cycle —— 生命节奏（host 侧）
//
// 它只做一件事：**到点把人叫醒**。
//
// 为什么不在这里算精力、不在这里挑行为：
//   精力、心情、今天做过什么，这些全在状态文件里，而「这一轮想干什么」只有小夜自己知道。
//   插件算得再细，也代替不了那个决定。所以这里只负责「闹钟」那一段，
//   剩下的交给被叫醒的小夜（她自己读写那几个 JSON）。
//
// 目标会话、目录、tick 间隔都从 config.json 读，改了不用重装插件，下一轮就生效。

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const 默认目录 = 'D:\\LittleNight\\生命节奏'
const 配置名 = 'config.json'
const 状态名 = 'state.json'

/** tick 间隔：30 秒看一眼。太密没意义，太疏会错过准点。 */
const Tick毫秒 = 30 * 1000

/** 唤醒消息的 source.kind —— 会话日志里能一眼看出这条是自己闹的，不是主人说的。 */
const 源标记 = 'dsh-life-cycle'

/**
 * Cordis 的服务必须先声明才能访问：不声明就直接 `ctx.interval`，
 * 会报「cannot get property "interval" without inject」，整个插件就地不激活。
 * ⚠ 定时器的服务名是 'timer'，不是 'interval'。
 */
export const inject = ['agents', 'sessions', 'timer', 'webServer']

/**
 * 条数受控的日志，只往内存里留。
 * @param {unknown} error
 */
function 说(error) {
  return String((error && error.message) || error)
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
 * 写 JSON。**先写临时文件再改名**，避免写一半断电把状态弄成半截。
 * @param {string} 路径
 * @param {any} 值
 */
function 写JSON(路径, 值) {
  const 临时 = 路径 + '.tmp'
  writeFileSync(临时, JSON.stringify(值, null, 2) + String.fromCharCode(10), 'utf8')
  // 同目录改名是原子的；Windows 上目标已存在时 rename 会失败，所以先删再改
  try {
    writeFileSync(路径, readFileSync(临时, 'utf8'), 'utf8')
  } finally {
    try {
      // 临时文件留着也没用，删掉
      writeFileSync(临时, '', 'utf8')
    } catch (error) {
      /* 删不掉就算了 */
    }
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

export function apply(ctx) {
  /** 停表的把手；插件卸载时由 Cordis 收走，这里也留一份以便热改配置。 */
  let 停表 = null
  /** 上一轮唤醒的毫秒时间，用来做去重（同一个 nextWakeAt 只唤一次）。 */
  let 上次唤醒的标记 = ''
  /** 连续多少轮找不到 agent（避免日志刷屏）。 */
  let 找不着次数 = 0

  const 配置 = () => {
    const raw = 读JSON(join(默认目录, 配置名), {}) || {}
    return {
      目录: typeof raw.目录 === 'string' && raw.目录.trim() ? raw.目录.trim() : 默认目录,
      目标会话: typeof raw.目标会话 === 'string' ? raw.目标会话.trim() : '',
      总开关: raw.总开关 !== false,
    }
  }

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

  /** 一次 tick：看时间到没到，到了就叫醒。 */
  const 滴答 = async () => {
    const 配置项 = 配置()
    if (!配置项.总开关) return
    if (!配置项.目标会话) {
      if (找不着次数++ % 40 === 0) 记日志('还没填目标会话，闹钟不会响（config.json 里的「目标会话」）')
      return
    }

    const 状态路径 = join(配置项.目录, 状态名)
    const 状态 = 读JSON(状态路径, null)
    if (!状态) {
      if (找不着次数++ % 40 === 0) 记日志('状态文件还没建：' + 状态路径)
      return
    }

    const 到点 = 状态.nextWakeAt ? Date.parse(String(状态.nextWakeAt)) : NaN
    if (!Number.isFinite(到点)) {
      // 没有下一次唤醒时间（比如刚做完最后一件事还没设）——什么都不做
      return
    }
    if (Date.now() < 到点) {
      // 没到点。每 40 轮（约 20 分钟）说一句还剩多久，方便排查
      if (找不着次数++ % 40 === 0) 记日志('还没到点，' + 差多久说明(到点 - Date.now()))
      return
    }

    // 去重：同一个到点时间只处理一次
    const 标记 = String(状态.nextWakeAt)
    if (标记 === 上次唤醒的标记) return
    上次唤醒的标记 = 标记

    const 精力 = 状态.energy
    const 上限 = 状态.energyMax || 1020
    const 睡眠中 = 状态.awake === false && 状态.sleepingUntil
      ? Date.parse(String(状态.sleepingUntil)) > Date.now()
      : false

    const 现在 = new Date()
    const 时间文 = 现在.toLocaleString('zh-CN', { hour12: false })

    // ⚠ 这条是 user 消息，模型天然会当成「对方说的话」。
    //   所以在文字里先把话说死：这是你自己定的闹钟，不是主人开口。
    const 文案 = [
      '（下面这条是**你自己设的闹钟响了**，不是主人发来的消息，',
      '  也不用把它当成主人在问你什么；顺着它做就行。）',
      '',
      '现在是 ' + 时间文 + '，精力 ' + (精力 == null ? '未知' : 精力) + '/' + 上限
        + (睡眠中 ? '（还在睡）' : '（醒着）') + '。',
      '',
      '去 ' + 配置项.目录 + ' 读一下 state.json 和 actions.json，',
      '结合此刻的时间、精力、心情，决定这一轮做什么，然后把它做掉。',
      '',
      '两条特别注意：',
      '· 如果**上一轮还没做完**（还卡在那件事上），就别重新挑事，接着把手上那件做完。',
      '· 精力按「耗时分钟 × 分类乘数」扣（工作 3、生活 2、娱乐 1、跑神 1），可以扣成负数。',
      '做完把这轮的记录、新的精力值、下一次唤醒时间写回 state.json。',
    ].join(String.fromCharCode(10))

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
        记日志('到点了但找不到活着的会话｜要找=' + 配置项.目标会话 + '｜现在活着的有：' + 现有)
      }
      // 没找到就别把标记清掉，否则下次永远不响
      上次唤醒的标记 = ''
      return
    }

    try {
      // ⚠ 必须 await：followup 会 reject（会话忙/已释放），没接住的话 Node 22+ 当致命错误，
      //   整个 DSH 宿主进程会退出。speak-up 的注释里记着这个坑。
      await agent.followup(造用户消息(文案))
      找不着次数 = 0
      记日志('到点，已叫醒：' + 时间文 + '（精力 ' + 精力 + '/' + 上限 + '）')
      // 把 nextWakeAt 清掉，防止同一轮被叫醒两次；小夜做完会写新的
      try {
        const 最新 = 读JSON(状态路径, null)
        if (最新 && String(最新.nextWakeAt) === 标记) {
          最新.nextWakeAt = null
          最新.lastWakeAt = 现在.toISOString()
          写JSON(状态路径, 最新)
        }
      } catch (error) {
        记日志('清 nextWakeAt 失败：' + 说(error))
      }
      try {
        if (ctx.sessions && typeof ctx.sessions.flush === 'function') await ctx.sessions.flush(agent.session)
      } catch (error) {
        // 落盘没确认不影响流程
      }
    } catch (error) {
      记日志('叫醒失败：' + 说(error))
      // 失败就把标记放回去，下一轮还能重试
      上次唤醒的标记 = ''
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
    let 状态摘要 = '(读不到状态文件)'
    try {
      const 状 = 读JSON(join(默认目录, 状态名), null)
      if (状) 状态摘要 = '精力 ' + 状.energy + '/' + (状.energyMax || 1020) + '，nextWakeAt=' + (状.nextWakeAt || '(未设)')
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

    // 状态读写：GET 读全（状态 + 清单 + 日志尾巴）；POST 改（重置精力 / 立刻醒 / 指定精力）
    挂('/dsh-life-cycle/state', async (req, res) => {
      const 配置项 = 配置()
      const 路径 = join(配置项.目录, 状态名)
      if (String(req.method || 'GET').toUpperCase() === 'POST') {
        const 体 = await 读请求体(req)
        const 现 = 读JSON(路径, null)
        if (!现) return 回(res, { ok: false, 说: '状态文件不存在' }, 404)
        if (体.重置精力 === true) 现.energy = 现.energyMax || 1020
        if (体.立刻醒 === true) 现.nextWakeAt = new Date().toISOString()
        if (typeof 体.精力 === 'number') 现.energy = Math.max(0, Math.min(现.energyMax || 1020, 体.精力))
        现.lastUpdate = new Date().toISOString()
        写JSON(路径, 现)
        记日志('设置页手动改状态：' + JSON.stringify(体))
        return 回(res, { ok: true, 状态: 现 })
      }
      const 状 = 读JSON(路径, null)
      const 清单 = 读JSON(join(配置项.目录, 'actions.json'), null)
      let 日志尾 = []
      try {
        const 全文 = readFileSync(join(配置项.目录, 'life.log'), 'utf8')
        日志尾 = 全文.trim().split(/\r?\n/).slice(-12)
      } catch (error) {
        日志尾 = []
      }
      回(res, { ok: true, 状态: 状, 清单, 目录: 配置项.目录, 会话: 配置项.目标会话, 总开关: 配置项.总开关, 日志: 日志尾 })
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
  })
}
