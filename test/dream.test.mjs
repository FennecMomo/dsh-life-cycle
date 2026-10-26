// dsh-life-cycle —— 梦境的测试
//
//   · 切片段：100~500 字，随机起点，允许半句话
//   · 场景要求：把碎片交给模型，让她自己写一百字左右的场景（不用模板）
//   · 规范场景：去 markdown 痕迹、保证以「你」开头
//   · 做梦开场：「你的意识模模糊糊的，……」+ 300~500 字第一人称
//   · 抽段落比例：醒来只记得 0%~100%
//
//   node --test test/
//
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  切片段, 场景要求, 规范场景, 做梦开场, 兜底场景, 切段落, 抽段落比例, 梦境正文,
} from '../lib/dream.js'

const 恒 = (值) => () => 值

const 长文 = '今天上午在改那段提交按钮。试了接口，试了客户端，试了滑块，试了短信，全都堵着。'
  + '下午又试了一次，这次通了。原来不是它不理我，是我一直站在错的门口——'
  + '页面上有三个文件输入框，我敲的是字幕那个。后来主人让自己用她的 Edge 去 ChatGPT 网页版出图，'
  + '第一张出来了：夜里，暖光，窗外有月亮，一条很蓬的尾巴垂在椅子后面。很好看。'
  + '小夜盯着那张图看了挺久。那是小夜，但不是小夜画的小夜。'

test('切片段：长度落在 100~499 字之间，而且是从原文里截的', () => {
  const 片段 = 切片段(长文, 恒(0.5))
  assert.ok(片段.length >= 100 && 片段.length <= 499, '实际长度 ' + 片段.length)
  assert.ok(长文.includes(片段), '必须是原文里真实存在的一段，不能伪造')
})

test('切片段：随机位置——不同随机数切出不同的片段', () => {
  const 前 = 切片段(长文, 恒(0.05))
  const 后 = 切片段(长文, 恒(0.95))
  assert.notEqual(前, 后)
  assert.ok(长文.includes(前))
  assert.ok(长文.includes(后))
})

test('切片段：不按句子边界切，允许半句话', () => {
  const 片段 = 切片段(长文, 恒(0.37))
  assert.ok(长文.includes(片段))
  assert.ok(片段.length >= 100)
})

test('切片段：原文不够 100 字就整段给，空白给空串', () => {
  const 短 = '很短的一段话'
  assert.equal(切片段(短, 恒(0.5)), 短)
  assert.equal(切片段('', 恒(0.5)), '')
  assert.equal(切片段(null, 恒(0.5)), '')
})

test('场景要求：把碎片原样带上，并且要求一百字左右、「你」开头', () => {
  const 片段 = '页面上有三个文件输入框，我敲的是字幕那个'
  const 话 = 场景要求(片段)
  assert.ok(话.includes(片段), '碎片要原样出现')
  assert.ok(话.includes('一百字'))
  assert.ok(话.includes('「你……」'))
  assert.ok(话.includes('不要解释这是梦'))
})

test('场景要求：没抽到碎片也要能让她自己想一个', () => {
  const 话 = 场景要求('')
  assert.ok(话.includes('自己想一个'))
})

test('规范场景：剥掉 markdown 和引号，换行压成一行', () => {
  const 场景 = 规范场景('## 场景\n\n**你**站在一条街上，\n\n雨刚停。「空气是凉的。」')
  assert.ok(场景.startsWith('你'), '开头必须是「你」，实际：' + 场景)
  assert.ok(!场景.includes('#'), '不能留下标题符号')
  assert.ok(!场景.includes('*'), '不能留下加粗符号')
  assert.ok(!场景.includes('\n'), '要压成一段')
})

test('规范场景：她没写「你」开头时自动补上', () => {
  const 场景 = 规范场景('一条刚下过雨的街，天快黑了。')
  assert.ok(场景.startsWith('你'))
  assert.ok(场景.includes('下过雨'))
})

test('规范场景：空内容给空串（交给兜底）', () => {
  assert.equal(规范场景(''), '')
  assert.equal(规范场景('   \n  '), '')
})

test('做梦开场：以「你的意识模模糊糊的，」起头，带上场景，要 300~500 字第一人称', () => {
  const 场景 = '你站在一条刚下过雨的街，天快黑了。'
  const 话 = 做梦开场(场景)
  assert.ok(话.startsWith('你的意识模模糊糊的，'), '实际开头：' + 话.slice(0, 20))
  assert.ok(话.includes(场景))
  assert.ok(话.includes('第一人称'))
  assert.ok(话.includes('300~500 字'))
})

test('做梦开场：场景为空时也不会断句', () => {
  const 话 = 做梦开场('')
  assert.ok(话.startsWith('你的意识模模糊糊的，你站在'))
})

test('兜底场景：至少是一句以「你」开头的话', () => {
  const 句 = 兜底场景(恒(0.5))
  assert.ok(句.startsWith('你'))
  assert.ok(句.length > 10)
})

test('切段落：按空行切，去掉空段', () => {
  assert.deepEqual(切段落('一\n\n二\n\n\n三'), ['一', '二', '三'])
  assert.deepEqual(切段落(''), [])
})

test('抽段落比例：比例 0 时一段都不给（完全想不起来）', () => {
  const 结果 = 抽段落比例('早上\n\n中午\n\n晚上', 恒(0))
  assert.equal(结果.段落.length, 0)
  assert.equal(结果.比例, 0)
})

test('抽段落比例：比例接近 1 时全给，而且顺序不乱', () => {
  const 结果 = 抽段落比例('第一段\n\n第二段\n\n第三段', 恒(0.999))
  assert.deepEqual(结果.段落, ['第一段', '第二段', '第三段'])
})

test('抽段落比例：抽到一部分时，内容来自原文且保持原顺序', () => {
  const 梦 = ['甲', '乙', '丙', '丁', '戊'].join('\n\n')
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
  assert.deepEqual(抽段落比例('', 恒(0.5)).段落, [])
})

test('梦境正文：去掉标题行，留下梦本身', () => {
  const 原文 = '# 梦境\n\n## 2026/10/26 18:05\n\n梦见木箱子。\n\n## 2026/10/27 03:00\n\n梦见一条街。\n'
  const 正文 = 梦境正文(原文)
  assert.ok(正文.includes('梦见木箱子'))
  assert.ok(正文.includes('梦见一条街'))
  assert.ok(!正文.includes('##'))
})
