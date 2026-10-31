// dsh-life-cycle —— 生理引擎（纯函数，管事不管戏）
//
// 只管三件事：**精力怎么算、这一觉睡多久、睡着的每小时掷什么骰子**。
// 不读文件、不发消息、不碰 ctx；时间由调用方传进来，随机数也能注入，所以好测。
//
// 账本模型（写在 state.json 里）：
//   energyBase / energyBaseAt   锚点：这一刻的精力基准 + 从这一刻起按分钟恢复的速率
//   energy                      派生值，由锚点推算，宿主从不「累加式」改它
//   sleep { startedAt, until, baseEnergy, dreamUsed, startleUsed, nextCheckAt }
//
// 为什么要锚点而不是每次 tick 加一点：应用关掉、系统休眠、定时器漂移都会丢 tick，
// 只有「基准 + 绝对时间差」才不会把一整晚的恢复算丢。

const 每分钟 = 60000
const 每小时 = 3600000

/** 把任意值收成有限数字，收不住就用兜底。 */
const 数 = (值, 兜底) => (Number.isFinite(Number(值)) ? Number(值) : 兜底)

/** 收成 0~1 的概率。 */
const 比例 = (值) => Math.min(1, Math.max(0, 数(值, 0)))

/** 解析时间；失败就用兜底。 */
export function 时刻(值, 兜底) {
  const 毫秒 = Date.parse(String(值 == null ? '' : 值))
  return Number.isFinite(毫秒) ? 毫秒 : 兜底
}

export const 默认规则 = Object.freeze({
  上限: 1020,
  每分钟恢复: 2.42,
  睡觉时长小时: [5, 8],
  惊醒每小时: 0.05,
  做梦每小时: 0.15,
  做梦负数每小时: 0.6,
  每觉最多做梦: 1,
  乘数: Object.freeze({ 工作: 3, 生活: 2, 娱乐: 1, 跑神: 1 }),
})

/**
 * 从 actions.json 抽出生理规则。字段缺失或写坏都回落到默认值，
 * 手改那份清单不会把循环弄崩。
 * @param {any} 清单 actions.json 的解析结果
 */
export function 抽规则(清单) {
  const 源 = 清单 && typeof 清单 === 'object' ? 清单 : {}
  const 精力 = 源.精力 && typeof 源.精力 === 'object' ? 源.精力 : {}
  const 睡觉 = 源.睡觉 && typeof 源.睡觉 === 'object' ? 源.睡觉 : {}
  const 做梦 = 睡觉.做梦 && typeof 睡觉.做梦 === 'object' ? 睡觉.做梦 : {}
  const 惊醒 = 睡觉.惊醒 && typeof 睡觉.惊醒 === 'object' ? 睡觉.惊醒 : {}

  const 时长 = Array.isArray(睡觉.时长小时) ? 睡觉.时长小时 : []
  const 短 = 数(时长[0], 默认规则.睡觉时长小时[0])
  const 长 = 数(时长[1], 默认规则.睡觉时长小时[1])

  const 原乘数 = 精力.分类乘数 && typeof 精力.分类乘数 === 'object' ? 精力.分类乘数 : {}
  const 乘数 = {}
  for (const 分类 of Object.keys(默认规则.乘数)) 乘数[分类] = 数(原乘数[分类], 默认规则.乘数[分类])

  return {
    上限: Math.max(1, 数(精力.上限, 默认规则.上限)),
    每分钟恢复: Math.max(0, 数(精力.每分钟恢复, 默认规则.每分钟恢复)),
    睡觉时长小时: [Math.min(短, 长), Math.max(短, 长)],
    惊醒每小时: 比例(数(惊醒.每小时概率, 默认规则.惊醒每小时)),
    做梦每小时: 比例(数(做梦.每小时概率, 默认规则.做梦每小时)),
    做梦负数每小时: 比例(数(做梦.精力为负时概率, 默认规则.做梦负数每小时)),
    每觉最多做梦: Math.max(0, 数(做梦.每次睡觉最多, 默认规则.每觉最多做梦)),
    乘数,
  }
}

/** 某一时刻的精力：起点精力 + 睡过去的分钟 × 速率，封顶。 */
function 该时刻精力(起点精力, 起点毫秒, 时刻毫秒, 规则) {
  const 分钟 = Math.max(0, (时刻毫秒 - 起点毫秒) / 每分钟)
  return Math.min(规则.上限, 起点精力 + 分钟 * 规则.每分钟恢复)
}

/**
 * 老状态升级到账本版本 2。
 *
 * 老版本里「扣精力」是小夜自己算完、直接写进 energy 的，所以这些记录绝对不能再结一次；
 * 一律标记成已入账，锚点就钉在当时的 energy 上。
 * 同时把只有 awake:false 的老睡眠补成完整的 sleep 对象。
 *
 * @returns {boolean} 是否改动过
 */
export function 迁移(状态, 此刻, 版本 = 2) {
  let 改 = false

  if (数(状态.账本版本, 0) < 版本) {
    状态.energyBase = 数(状态.energy, 0)
    状态.energyBaseAt = 状态.lastUpdate || new Date(此刻).toISOString()
    if (Array.isArray(状态.log)) {
      for (const 条 of 状态.log) {
        if (条 && typeof 条 === 'object' && 条.入账 === undefined) 条.入账 = true
      }
    }
    状态.账本版本 = 版本
    改 = true
  }

  if (状态.awake === false && (!状态.sleep || typeof 状态.sleep !== 'object')) {
    const 起点 = 时刻(状态.energyBaseAt, 此刻)
    状态.sleep = {
      startedAt: new Date(起点).toISOString(),
      until: 状态.sleepingUntil || 状态.nextWakeAt || new Date(此刻 + 8 * 每小时).toISOString(),
      baseEnergy: 数(状态.energyBase, 数(状态.energy, 0)),
      dreamUsed: false,
      startleUsed: false,
      nextCheckAt: new Date(起点 + 每小时).toISOString(),
    }
    改 = true
  }

  return 改
}

/**
 * 把 state.energy 对齐到「此刻」。
 * 醒着不动（规则里只有睡觉才恢复精力），睡着就按锚点补算。
 * @returns {number} 此刻的精力
 */
export function 对齐(状态, 此刻, 规则) {
  状态.energyMax = 规则.上限
  状态.ratePerMinute = 规则.每分钟恢复

  let 基准 = 数(状态.energyBase, 数(状态.energy, 0))
  if (!Number.isFinite(时刻(状态.energyBaseAt, NaN))) 状态.energyBaseAt = new Date(此刻).toISOString()

  if (状态.awake !== false) {
    基准 = Math.min(规则.上限, 基准)
    状态.energyBase = 基准
    状态.energy = 基准
    return 基准
  }

  const 基准毫秒 = 时刻(状态.energyBaseAt, 此刻)
  const 精力 = Math.min(规则.上限, 基准 + Math.max(0, (此刻 - 基准毫秒) / 每分钟) * 规则.每分钟恢复)
  if (精力 !== 基准) {
    状态.energyBase = 精力
    状态.energyBaseAt = new Date(此刻).toISOString()
  }
  状态.energy = 精力
  return 精力
}

/**
 * 把 log 里还没入账的记录结进账本。
 * 小夜只写「时间 / 分类 / 内容 / 耗时分钟」，扣多少由这里按乘数算；
 * 她要是自己写了扣精力，就尊重她的数。
 *
 * ⚠ 睡着的时候不算行为：这一觉里冒出来的任何非「睡觉」记录都按 0 扣，
 *   只留个「睡眠期」标记，账本一分不动。睡觉就是睡觉，不能一边睡一边干活。
 *
 * @returns {{ 请求入睡: any[], 扣了: number, 睡觉期间的记录: any[] }}
 */
export function 入账(状态, 此刻, 规则) {
  const 请求入睡 = []
  const 睡觉期间的记录 = []
  let 扣了 = 0
  if (!Array.isArray(状态.log)) 状态.log = []

  for (const 条 of 状态.log) {
    if (!条 || typeof 条 !== 'object' || 条.入账 === true) continue
    条.入账 = true

    // 「分类=睡觉」是入睡的暗号：这次不扣钱，交给开睡()
    if (条.分类 === '睡觉') {
      条.扣精力 = 0
      条.耗时分钟 = 0
      请求入睡.push(条)
      continue
    }

    // 睡着期间写进来的东西不是行为，不扣精力，只打标记
    if (状态.awake === false) {
      条.扣精力 = 0
      条.睡眠期 = true
      睡觉期间的记录.push(条)
      continue
    }

    const 乘数 = 数(规则.乘数[条.分类], 1)
    const 耗时 = Math.max(0, 数(条.耗时分钟, 0))
    const 扣 = 条.扣精力 != null && Number.isFinite(Number(条.扣精力))
      ? Number(条.扣精力)
      : Math.round(耗时 * 乘数)

    条.扣精力 = 扣
    if (扣 === 0) continue

    对齐(状态, 此刻, 规则)
    状态.energyBase = 状态.energy - 扣
    状态.energy = 状态.energyBase
    扣了 += 扣
  }

  return { 请求入睡, 扣了, 睡觉期间的记录 }
}

/**
 * 入睡。时长在 5~8 小时之间随机取（区间来自 actions.json），
 * 起点以记录里的时间为准——应用关着错过了几分钟也能补上。
 * @param {any} 状态
 * @param {number} 此刻 毫秒
 * @param {any} 规则
 * @param {() => number} 随机
 * @param {any} [记录] 触发入睡的 log 条目
 */
export function 开睡(状态, 此刻, 规则, 随机 = Math.random, 记录) {
  const 起点 = Math.min(此刻, 时刻(记录 && 记录.时间, 此刻))
  对齐(状态, 起点, 规则)

  const 起点精力 = 数(状态.energy, 0)
  const [短, 长] = 规则.睡觉时长小时
  const 小时 = 短 + 随机() * Math.max(0, 长 - 短)
  const 分钟 = Math.max(1, Math.round(小时 * 60))
  const 到点 = 起点 + 分钟 * 每分钟

  状态.awake = false
  状态.energyBase = 起点精力
  状态.energyBaseAt = new Date(起点).toISOString()
  状态.energy = 起点精力
  状态.sleepingUntil = new Date(到点).toISOString()
  状态.nextWakeAt = new Date(到点).toISOString()
  状态.sleep = {
    startedAt: new Date(起点).toISOString(),
    until: new Date(到点).toISOString(),
    baseEnergy: 起点精力,
    dreamUsed: false,
    startleUsed: false,
    nextCheckAt: new Date(起点 + 每小时).toISOString(),
  }

  return { 起点, 到点, 时长分钟: 分钟, 起点精力 }
}

/** 收尾：醒来、清睡眠、把锚点钉在这一刻。 */
function 结束睡眠(状态, 事件, 类型, 醒于, 起点, 起点精力, 终点精力) {
  const 时长分钟 = Math.max(0, Math.round((醒于 - 起点) / 每分钟))
  事件.push({
    类型,
    醒于: new Date(醒于).toISOString(),
    起点: new Date(起点).toISOString(),
    时长分钟,
    起点精力: Math.round(起点精力),
    终点精力: Math.round(终点精力),
  })
  状态.awake = true
  状态.sleep = null
  状态.sleepingUntil = null
  状态.nextWakeAt = null
  状态.lastWakeAt = new Date(醒于).toISOString()
  状态.energy = 终点精力
  状态.energyBase = 终点精力
  状态.energyBaseAt = 状态.lastWakeAt
}

/**
 * 推进一步：睡眠物理 + 事件。
 * 返回事件数组（自然醒 / 到点 / 惊醒 / 做梦），可能为空。
 * @param {any} 状态
 * @param {number} 此刻 毫秒
 * @param {any} 规则
 * @param {() => number} 随机
 */
export function 推进(状态, 此刻, 规则, 随机 = Math.random) {
  const 事件 = []

  if (状态.awake !== false) {
    对齐(状态, 此刻, 规则)
    return 事件
  }

  // 兼容旧状态：只有 awake:false 没有 sleep 对象，就地补一个
  if (!状态.sleep || typeof 状态.sleep !== 'object') {
    const 起点 = 时刻(状态.energyBaseAt, 此刻)
    状态.sleep = {
      startedAt: new Date(起点).toISOString(),
      until: 状态.sleepingUntil || 状态.nextWakeAt || new Date(此刻 + 8 * 每小时).toISOString(),
      baseEnergy: 数(状态.energyBase, 数(状态.energy, 0)),
      dreamUsed: false,
      startleUsed: false,
      nextCheckAt: new Date(起点 + 每小时).toISOString(),
    }
  }

  const 睡眠 = 状态.sleep
  const 起点 = 时刻(睡眠.startedAt, 此刻)
  const 到点 = 时刻(睡眠.until, 此刻 + 8 * 每小时)
  const 起点精力 = 数(睡眠.baseEnergy, 数(状态.energy, 0))

  对齐(状态, 此刻, 规则)

  // 1) 自然醒：起点没满、睡到回满的那一刻
  if (起点精力 < 规则.上限 && 规则.每分钟恢复 > 0) {
    const 满的时刻 = 起点 + ((规则.上限 - 起点精力) / 规则.每分钟恢复) * 每分钟
    if (满的时刻 <= 此刻 && 满的时刻 <= 到点) {
      结束睡眠(状态, 事件, '自然醒', 满的时刻, 起点, 起点精力, 规则.上限)
      return 事件
    }
  }

  // 2) 闹钟到点
  if (到点 <= 此刻) {
    结束睡眠(状态, 事件, '到点', 到点, 起点, 起点精力, 该时刻精力(起点精力, 起点, 到点, 规则))
    return 事件
  }

  // 3) 每小时检查点：掷惊醒 / 做梦
  let 检查点 = 时刻(睡眠.nextCheckAt, 起点 + 每小时)
  if (检查点 <= 起点) 检查点 = 起点 + 每小时

  let 轮数 = 0
  while (检查点 <= 此刻 && 轮数++ < 48) {
    if (!睡眠.startleUsed && 随机() < 规则.惊醒每小时) {
      睡眠.startleUsed = true
      状态.sleep = 睡眠
      结束睡眠(状态, 事件, '惊醒', 检查点, 起点, 起点精力, 该时刻精力(起点精力, 起点, 检查点, 规则))
      return 事件
    }
    const 做梦概率 = 状态.energy < 0 ? 规则.做梦负数每小时 : 规则.做梦每小时
    if (!睡眠.dreamUsed && 规则.每觉最多做梦 > 0 && 随机() < 做梦概率) {
      睡眠.dreamUsed = true
      事件.push({
        类型: '做梦',
        时刻: new Date(检查点).toISOString(),
        精力: Math.round(状态.energy),
        起点: new Date(起点).toISOString(),
        已睡分钟: Math.round((检查点 - 起点) / 每分钟),
      })
    }
    检查点 += 每小时
    睡眠.nextCheckAt = new Date(检查点).toISOString()
  }

  状态.sleep = 睡眠
  状态.sleepingUntil = new Date(到点).toISOString()
  return 事件
}

/**
 * 她醒着，却一个闹钟都没定 —— 要不要插件补一个兜底的？
 *
 * 为什么要这个：插件只在「闹钟到点」或「睡着的时候到检查点」才会说话。她要是某轮结束
 * 忘了把 nextWakeAt 写回去（尤其是被外部事件叫醒、又没算成一次具体行为的那种），
 * 就再也没有下一次——不会报错，只是安静地永远停在那儿。
 *
 * 判定：醒着 + 没有有效的 nextWakeAt + 距上一次被叫（或上次落盘）已经超过宽限期。
 * 睡着的时候不归它管，睡觉有自己的 until。
 *
 * @param {any} 状态
 * @param {number} 此刻 毫秒
 * @param {number} 宽限毫秒 投递唤醒后多久还没定闹钟才算「忘了」
 * @returns {boolean}
 */
export function 该补闹钟(状态, 此刻, 宽限毫秒 = 10 * 60 * 1000) {
  if (!状态 || 状态.awake === false) return false
  if (Number.isFinite(时刻(状态.nextWakeAt, NaN))) return false
  const 上次叫 = 时刻(状态.lastWakeAt, NaN)
  const 参考 = Number.isFinite(上次叫) ? 上次叫 : 时刻(状态.lastUpdate, NaN)
  if (!Number.isFinite(参考)) return true
  return 此刻 - 参考 >= 宽限毫秒
}

/**
 * 检查行为清单（actions.json）的原文能不能用。给设置页那个编辑器做保存前的把关。
 *
 * 只查「这份文本能不能被当成清单用」：JSON 合法、最外层是对象；顺手把分类和硬规矩数出来，
 * 让主人一眼看出改完还剩几个分类。字段写得不对不拦（引擎读的时候自己有兜底），只给警告。
 *
 * @param {string} 原文
 * @returns {{ 能用: boolean, 错误: string, 分类: string[], 硬规矩条数: number, 警告: string[] }}
 */
export function 检查清单文本(原文) {
  const 文本 = String(原文 == null ? '' : 原文)
  const 空 = { 能用: false, 错误: '', 分类: [], 硬规矩条数: 0, 警告: [] }
  if (!文本.trim()) return { ...空, 错误: '内容是空的' }

  let 数据
  try {
    数据 = JSON.parse(文本)
  } catch (error) {
    return { ...空, 错误: 'JSON 格式不对：' + String((error && error.message) || error) }
  }
  if (数据 === null || typeof 数据 !== 'object' || Array.isArray(数据)) {
    return { ...空, 错误: '最外层必须是一个对象（以 { 开头、以 } 结尾）' }
  }

  const 分类 = 数据.分类 && typeof 数据.分类 === 'object' && !Array.isArray(数据.分类)
    ? Object.keys(数据.分类)
    : []
  const 硬规矩条数 = Array.isArray(数据.硬规矩) ? 数据.硬规矩.length : 0
  const 警告 = []
  if (分类.length === 0) 警告.push('没有「分类」，她这一轮会抽不到行为')
  if (硬规矩条数 === 0) 警告.push('没有「硬规矩」，她就没有底线约束了')

  return { 能用: true, 错误: '', 分类, 硬规矩条数, 警告 }
}
