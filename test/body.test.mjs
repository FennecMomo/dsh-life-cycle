// dsh-life-cycle —— 生理引擎的测试
//
// 这些用例只管 lib/body.js 的纯逻辑：精力账本、睡眠状态机、掷骰、入账。
// 时间全部注入固定值，随机数也注入，所以跑起来是确定的。
//
//   node --test test/
//
import test from 'node:test'
import assert from 'node:assert/strict'
import { 抽规则, 对齐, 入账, 开睡, 推进, 迁移, 默认规则 } from '../lib/body.js'

const 起点 = Date.parse('2026-10-26T15:00:00+08:00')
const 分钟 = 60 * 1000
const 小时 = 60 * 分钟

/** 固定返回同一个数的随机源。 */
const 恒 = (值) => () => 值

/** 依次返回给定数列的随机源（用完了就从头再来）。 */
const 序列 = (...值) => {
  let i = 0
  return () => 值[i++ % 值.length]
}

const 造状态 = (额外 = {}) => ({
  awake: true,
  energy: 900,
  energyMax: 1020,
  energyBase: 900,
  energyBaseAt: new Date(起点).toISOString(),
  log: [],
  ...额外,
})

const 规则 = 抽规则(null)

test('抽规则：清单缺失时回落到默认值', () => {
  assert.equal(规则.上限, 默认规则.上限)
  assert.equal(规则.每分钟恢复, 默认规则.每分钟恢复)
  assert.deepEqual(规则.睡觉时长小时, [5, 8])
  assert.equal(规则.乘数.工作, 3)
  assert.equal(规则.乘数.跑神, 1)
})

test('抽规则：从 actions.json 的形状里取值，坏值不炸', () => {
  const 清单 = {
    精力: { 上限: 500, 每分钟恢复: '坏值', 分类乘数: { 工作: 4, 生活: 'x' } },
    睡觉: {
      时长小时: [9, 6],
      做梦: { 每小时概率: 0.3, 精力为负时概率: 2, 每次睡觉最多: 1 },
      惊醒: { 每小时概率: -1 },
    },
  }
  const r = 抽规则(清单)
  assert.equal(r.上限, 500)
  assert.equal(r.每分钟恢复, 默认规则.每分钟恢复, '坏值回落默认')
  assert.deepEqual(r.睡觉时长小时, [6, 9], '上下界反了要自动摆正')
  assert.equal(r.乘数.工作, 4)
  assert.equal(r.乘数.生活, 2, '坏乘数回落默认')
  assert.equal(r.做梦负数每小时, 1, '概率上限收在 1')
  assert.equal(r.惊醒每小时, 0, '负概率收到 0')
})

test('对齐：醒着的时候精力不动，睡着才按分钟补算', () => {
  const 醒 = 造状态()
  对齐(醒, 起点 + 10 * 小时, 规则)
  assert.equal(醒.energy, 900)

  const 睡 = 造状态({ awake: false, energy: 500, energyBase: 500 })
  对齐(睡, 起点 + 60 * 分钟, 规则)
  assert.ok(Math.abs(睡.energy - (500 + 60 * 规则.每分钟恢复)) < 1e-9)
  assert.ok(Math.abs(睡.energyBase - 睡.energy) < 1e-9, '锚点要跟着推到此刻')
})

test('睡觉是渐进恢复：入睡那一刻不跳，之后一小时一小时往上走', () => {
  const 状态 = 造状态({ energy: 40, energyBase: 40 })
  const 入睡 = 开睡(状态, 起点, 规则, 恒(0))
  assert.equal(入睡.起点精力, 40)
  assert.equal(状态.energy, 40, '入睡瞬间精力不变，不能直接满格')
  assert.notEqual(状态.energy, 规则.上限)

  // 睡一小时
  推进(状态, 起点 + 小时, 规则, 恒(0.99))
  const 一小时后 = 状态.energy
  assert.ok(Math.abs(一小时后 - (40 + 60 * 规则.每分钟恢复)) < 1e-9, '一小时只涨 145 左右')
  assert.ok(一小时后 < 规则.上限, '一小时远没满')

  // 再睡一小时
  推进(状态, 起点 + 2 * 小时, 规则, 恒(0.99))
  const 两小时后 = 状态.energy
  assert.ok(两小时后 > 一小时后, '精力是往上走的')
  assert.ok(Math.abs(两小时后 - (40 + 120 * 规则.每分钟恢复)) < 1e-9)

  // 四条曲线点应该是一条直线：起飞慢、越睡越多
  assert.ok(Math.abs((两小时后 - 一小时后) - (一小时后 - 入睡.起点精力)) < 1e-9, '每分钟恢复速率恒定')
})

test('对齐：精力封顶在上限', () => {
  const 睡 = 造状态({ awake: false, energy: 1000, energyBase: 1000 })
  对齐(睡, 起点 + 5 * 小时, 规则)
  assert.equal(睡.energy, 规则.上限)
})

test('开睡：时长落在 5~8 小时，起点以记录时间为准', () => {
  const 状态 = 造状态()
  const 早 = 开睡(状态, 起点 + 3 * 分钟, 规则, 恒(0), { 时间: new Date(起点).toISOString() })
  assert.equal(早.时长分钟, 5 * 60, '随机 0 取最短 5 小时')
  assert.equal(早.起点, 起点, '起点用记录里的时间')
  assert.equal(状态.awake, false)
  assert.equal(状态.sleepingUntil, new Date(起点 + 5 * 小时).toISOString())
  assert.equal(状态.nextWakeAt, 状态.sleepingUntil)

  const 状态2 = 造状态()
  const 晚 = 开睡(状态2, 起点, 规则, 恒(1))
  assert.equal(晚.时长分钟, 8 * 60, '随机 1 取最长 8 小时')
})

test('推进：睡到精力回满就自然醒', () => {
  const 状态 = 造状态({ energy: 900, energyBase: 900 })
  开睡(状态, 起点, 规则, 恒(0))
  const 事件 = 推进(状态, 起点 + 60 * 分钟, 规则, 恒(0.99))
  assert.equal(事件.length, 1)
  assert.equal(事件[0].类型, '自然醒')
  assert.equal(状态.awake, true)
  assert.equal(状态.energy, 规则.上限)
  assert.equal(状态.sleep, null)
  assert.ok(Math.abs(事件[0].时长分钟 - 49.6) < 1, '大约 49.6 分钟回满')
})

test('推进：睡够闹钟到点就醒，精力没满也不拖', () => {
  const 状态 = 造状态({ energy: 0, energyBase: 0 })
  开睡(状态, 起点, 规则, 恒(0))
  const 事件 = 推进(状态, 起点 + 5 * 小时, 规则, 恒(0.99))
  assert.equal(事件[0].类型, '到点')
  assert.equal(事件[0].时长分钟, 300)
  assert.ok(Math.abs(事件[0].终点精力 - 300 * 规则.每分钟恢复) < 1)
  assert.equal(状态.awake, true)
  assert.equal(状态.nextWakeAt, null, '醒来后闹钟要清掉，等她自己定下一次')
})

test('推进：起点就满格时不会立刻「自然醒」，照样睡到闹钟响', () => {
  const 状态 = 造状态({ energy: 1020, energyBase: 1020 })
  开睡(状态, 起点, 规则, 恒(0))
  const 早 = 推进(状态, 起点 + 10 * 分钟, 规则, 恒(0.99))
  assert.equal(早.length, 0, '满格起点不触发自然醒')
  assert.equal(状态.awake, false)

  const 到 = 推进(状态, 起点 + 5 * 小时, 规则, 恒(0.99))
  assert.equal(到[0].类型, '到点')
})

test('推进：第一个检查点就可能惊醒，精力不回满', () => {
  const 状态 = 造状态({ energy: 0, energyBase: 0 })
  开睡(状态, 起点, 规则, 恒(0))
  const 事件 = 推进(状态, 起点 + 小时, 规则, 恒(0))
  assert.equal(事件[0].类型, '惊醒')
  assert.equal(状态.awake, true)
  assert.ok(Math.abs(状态.energy - 60 * 规则.每分钟恢复) < 1, '只回了一小时的精力')
  assert.ok(状态.energy < 规则.上限)
})

test('推进：做梦不打断睡觉，而且一觉最多一次', () => {
  const 状态 = 造状态({ energy: 0, energyBase: 0 })
  开睡(状态, 起点, 规则, 恒(0))
  // 惊醒骰子 0.9 不中，做梦骰子 0 中
  const 随机 = 序列(0.9, 0)
  const 第一轮 = 推进(状态, 起点 + 小时, 规则, 随机)
  assert.deepEqual(第一轮.map((e) => e.类型), ['做梦'])
  assert.equal(状态.awake, false, '做梦不醒')
  assert.equal(状态.sleep.dreamUsed, true)

  const 第二轮 = 推进(状态, 起点 + 2 * 小时, 规则, 序列(0.9, 0))
  assert.equal(第二轮.length, 0, '同一觉不会做第二个梦')
})

test('推进：精力为负时做梦概率换成 0.6', () => {
  const 负 = 抽规则({
    睡觉: { 做梦: { 每小时概率: 0.1, 精力为负时概率: 0.6 } },
  })
  // 起点 -500，睡一小时回 145 还是负的
  const 睡中 = 造状态({ energy: -500, energyBase: -500 })
  开睡(睡中, 起点, 负, 恒(0))
  // 0.5 < 0.6：精力为负时这一点就该做梦
  const 事件 = 推进(睡中, 起点 + 小时, 负, 序列(0.9, 0.5))
  assert.deepEqual(事件.map((e) => e.类型), ['做梦'])

  // 同样的 0.5，精力为正时按 0.1 掷，不会做梦
  const 醒着睡 = 造状态({ energy: 0, energyBase: 0 })
  开睡(醒着睡, 起点, 负, 恒(0))
  const 无 = 推进(醒着睡, 起点 + 小时, 负, 序列(0.9, 0.5))
  assert.equal(无.length, 0)
})

test('入账：工作 60 分钟按乘数 3 扣 180', () => {
  const 状态 = 造状态({ energy: 900, energyBase: 900, log: [{ 时间: '2026-10-26 15:00', 分类: '工作', 内容: '改代码', 耗时分钟: 60 }] })
  const 结果 = 入账(状态, 起点, 规则)
  assert.equal(结果.扣了, 180)
  assert.equal(状态.energy, 720)
  assert.equal(状态.log[0].扣精力, 180)
  assert.equal(状态.log[0].入账, true)

  const 再 = 入账(状态, 起点, 规则)
  assert.equal(再.扣了, 0, '同一条不会扣两次')
  assert.equal(状态.energy, 720)
})

test('入账：分类=睡觉 的记录只是暗号，不扣钱', () => {
  const 状态 = 造状态({ log: [{ 时间: '2026-10-26 15:00', 分类: '睡觉', 内容: '去睡了' }] })
  const 结果 = 入账(状态, 起点, 规则)
  assert.equal(结果.扣了, 0)
  assert.equal(结果.请求入睡.length, 1)
  assert.equal(状态.energy, 900)
})

test('入账：小夜自己写了扣精力就尊重她的数', () => {
  const 状态 = 造状态({
    log: [{ 时间: '2026-10-26 15:00', 分类: '娱乐', 内容: '刷B站', 耗时分钟: 40, 扣精力: 99 }],
  })
  入账(状态, 起点, 规则)
  assert.equal(状态.energy, 900 - 99)
})

test('入账：睡觉期间写进来的记录不算行为，一分精力都不扣', () => {
  const 状态 = 造状态({
    awake: false,
    energy: 300,
    energyBase: 300,
    log: [
      { 时间: '2026-10-26 18:05', 分类: '生活', 内容: '写日记', 耗时分钟: 30 },
      { 时间: '2026-10-26 18:06', 分类: '工作', 内容: '改代码', 耗时分钟: 60 },
    ],
  })
  const 结果 = 入账(状态, 起点, 规则)
  assert.equal(结果.扣了, 0, '睡着的时候不该扣精力')
  assert.equal(状态.energy, 300)
  assert.equal(结果.睡觉期间的记录.length, 2)
  for (const 条 of 状态.log) {
    assert.equal(条.扣精力, 0)
    assert.equal(条.睡眠期, true)
  }
})

test('推进：老状态没有 sleep 对象也能接管', () => {
  const 状态 = 造状态({
    awake: false,
    energy: 700,
    energyBase: 700,
    energyBaseAt: new Date(起点).toISOString(),
    sleepingUntil: new Date(起点 + 7 * 小时).toISOString(),
    nextWakeAt: new Date(起点 + 7 * 小时).toISOString(),
  })
  const 事件 = 推进(状态, 起点 + 分钟, 规则, 恒(0.99))
  assert.equal(事件.length, 0)
  assert.ok(状态.sleep && 状态.sleep.startedAt, '自动补上了 sleep 对象')
  assert.equal(状态.awake, false)
})

test('迁移：老账本不重复扣钱，睡眠被接管，满格也不立刻醒', () => {
  // 照真实的老状态捏一份：精力已经是扣完之后的值，log 里有历史流水
  const 老 = {
    energy: 1020,
    energyMax: 1020,
    ratePerMinute: 2.42,
    awake: false,
    sleepingUntil: new Date(起点 + 7 * 小时).toISOString(),
    nextWakeAt: new Date(起点 + 7 * 小时).toISOString(),
    lastUpdate: new Date(起点).toISOString(),
    log: [
      { 时间: '2026-10-26 11:45', 分类: '工作', 内容: '改代码', 耗时分钟: 15, 扣精力: 45 },
      { 时间: '2026-10-26 13:53', 分类: '生活', 内容: '梳尾巴', 耗时分钟: 15, 扣精力: 30 },
      { 时间: '2026-10-26 15:21', 分类: '睡觉', 内容: '睡了 7 小时，精力 8 → 1020', 耗时分钟: 420, 扣精力: -1016 },
    ],
  }

  const 改过 = 迁移(老, 起点 + 2 * 小时)
  assert.equal(改过, true)
  assert.equal(老.账本版本, 2)
  assert.equal(老.energyBase, 1020)
  assert.ok(老.sleep && 老.sleep.startedAt, '老睡眠补成 sleep 对象')
  assert.equal(老.sleep.until, new Date(起点 + 7 * 小时).toISOString())

  // 再跑一次不应该再有改动
  assert.equal(迁移(老, 起点 + 2 * 小时), false, '迁移要幂等')

  // 历史流水不能再结一次
  const 记账 = 入账(老, 起点 + 2 * 小时, 规则)
  assert.equal(记账.扣了, 0)
  assert.equal(老.energy, 1020, '精力没被重复扣')

  // 满格起点睡到闹钟响才醒，不会一上来就「自然醒」
  const 事件 = 推进(老, 起点 + 2 * 小时, 规则, 恒(0.99))
  assert.equal(事件.length, 0)
  assert.equal(老.awake, false)

  const 到点 = 推进(老, 起点 + 7 * 小时, 规则, 恒(0.99))
  assert.equal(到点[0].类型, '到点')
})
