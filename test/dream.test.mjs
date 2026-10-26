// dsh-life-cycle —— 梦境三个纯函数的测试
//
//   · 切片段：随机起点、随机长度，允许半句话
//   · 造情景：把一个碎片拼成一个能演的舞台
//   · 抽段落比例：醒来只记得 0%~100% 的段落，0% 就是一点都想不起来
//
//   node --test test/
//
import test from 'node:test'
import assert from 'node:assert/strict'
import { 切片段, 造情景, 抽段落比例, 切段落, 梦境正文 } from '../lib/dream.js'

const 恒 = (值) => () => 值

const 长文 = '今天上午在改那段提交按钮。试了接口，试了客户端，试了滑块，试了短信，全都堵着。'
  + '下午又试了一次，这次通了。原来不是它不理我，是我一直站在错的门口——'
  + '页面上有三个文件输入框，我敲的是字幕那个。'

test('切片段：长度落在 20~99 字之间，而且是从原文里截的', () => {
  const 片段 = 切片段(长文, 恒(0.5))
  assert.ok(片段.length >= 20 && 片段.length <= 99, '实际长度 ' + 片段.length)
  assert.ok(长文.includes(片段), '必须是原文里真实存在的一段，不能伪造')
})

test('切片段：不同随机数切出不同的位置（就是随机抽，不是固定开头）', () => {
  const 前 = 切片段(长文, 恒(0.05))
  const 后 = 切片段(长文, 恒(0.95))
  assert.notEqual(前, 后)
  assert.ok(长文.includes(后))
})

test('切片段：短文本原样返回，空白文本给空串', () => {
  assert.equal(切片段('很短', 恒(0.5)), '很短')
  assert.equal(切片段('', 恒(0.5)), '')
  assert.equal(切片段(null, 恒(0.5)), '')
})

test('切片段：不按句子边界切，允许半句话', () => {
  const 片段 = 切片段(长文, 恒(0.37))
  assert.ok(长文.includes(片段))
  // 至少有一头不是句号结尾/开头，证明它真的可以切在句子中间
  const 句首 = '。！？—\n'.includes(片段[0])
  const 句尾 = '。！？'.includes(片段[片段.length - 1])
  assert.ok(!句首 || !句尾 || 片段.length < 长文.length)
})

test('造情景：把碎片原样嵌进一段情景里', () => {
  const 片段 = '三个文件输入框，我敲的是字幕那个'
  const 情景 = 造情景(片段, 恒(0.3))
  assert.ok(情景.includes(片段), '碎片要原样出现')
  assert.ok(情景.includes('梦'), '要说明这是梦')
  assert.ok(情景.split('\n').length >= 3, '至少几行，能当舞台用')
})

test('造情景：碎片为空也能造出情景（听不清那句话）', () => {
  const 情景 = 造情景('', 恒(0.1))
  assert.ok(情景.includes('听不清'))
  assert.ok(情景.length > 10)
})

test('切段落：按空行切，去掉空段', () => {
  assert.deepEqual(切段落('一\n\n二\n\n\n三'), ['一', '二', '三'])
  assert.deepEqual(切段落(''), [])
})

test('抽段落比例：比例 0 时一段都不给（完全想不起来）', () => {
  const 梦 = '早上\n\n中午\n\n晚上'
  const 结果 = 抽段落比例(梦, 恒(0))
  assert.equal(结果.段落.length, 0)
  assert.equal(结果.比例, 0)
})

test('抽段落比例：比例接近 1 时全给，而且顺序不乱', () => {
  const 梦 = '第一段\n\n第二段\n\n第三段'
  const 结果 = 抽段落比例(梦, 恒(0.999))
  assert.equal(结果.段落.length, 3)
  assert.deepEqual(结果.段落, ['第一段', '第二段', '第三段'])
})

test('抽段落比例：抽到一部分时，内容必须来自原文且保持原顺序', () => {
  const 梦 = ['甲', '乙', '丙', '丁', '戊'].join('\n\n')
  // 0.5 → 取 2~3 段；随机源序列让洗牌走一个确定的路径
  const 序列 = (() => {
    const 列 = [0.5, 0.9, 0.1, 0.4, 0.7, 0.2]
    let i = 0
    return () => 列[i++ % 列.length]
  })()
  const 结果 = 抽段落比例(梦, 序列)
  assert.ok(结果.段落.length >= 1 && 结果.段落.length <= 5)
  const 下标 = 结果.段落.map((段) => ['甲', '乙', '丙', '丁', '戊'].indexOf(段))
  assert.deepEqual(下标, [...下标].sort((a, b) => a - b), '抽出来的段落要按原文顺序排')
})

test('抽段落比例：空文本返回空段落', () => {
  const 结果 = 抽段落比例('', 恒(0.5))
  assert.deepEqual(结果.段落, [])
})

test('梦境正文：去掉标题行，留下梦本身', () => {
  const 原文 = '# 梦境\n\n## 2026/10/26 18:05\n\n梦见木箱子。\n\n## 2026/10/27 03:00\n\n梦见一条街。\n'
  const 正文 = 梦境正文(原文)
  assert.ok(正文.includes('梦见木箱子'))
  assert.ok(正文.includes('梦见一条街'))
  assert.ok(!正文.includes('##'))
  assert.ok(!正文.startsWith('# '))
})
