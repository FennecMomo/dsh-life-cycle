// dsh-life-cycle —— 梦境解析的测试
// 只测 host.js 里那个「把本觉的梦挑出来」的纯读函数：它决定醒来时消息里带哪些梦。
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { 读本觉梦境 } from '../lib/host.js'

test('读本觉梦境：只挑这一觉之后的梦，前面的旧梦不要', () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'lc-dreams-'))
  const 路径 = join(目录, '梦境.md')
  writeFileSync(路径, [
    '# 梦境',
    '',
    '## 2026/10/20 03:10',
    '很久以前的梦，不该被带进这一觉。',
    '',
    '## 2026/10/26 18:05',
    '梦见把视频方块塞进木箱子，缝太窄。后来对着箱子说了一句话，缝就变宽了。',
    '',
    '## 2026/10/26 19:40',
    '第二个梦：在空的教室里找一支笔。',
    '',
  ].join('\n'), 'utf8')

  const 起点 = Date.parse('2026-10-26T15:21:15+08:00')
  const 结果 = 读本觉梦境(路径, 起点)
  assert.ok(结果.includes('木箱子'), '本觉的梦要带上')
  assert.ok(结果.includes('空的教室'), '同一次睡觉里的第二个梦也要带上')
  assert.ok(!结果.includes('很久以前'), '上一觉的梦不该出现')

  rmSync(目录, { recursive: true, force: true })
})

test('读本觉梦境：文件不存在或全空时安静返回空串', () => {
  assert.equal(读本觉梦境(join(tmpdir(), '不存在的梦境.md'), Date.now()), '')
  const 目录 = mkdtempSync(join(tmpdir(), 'lc-dreams-empty-'))
  const 路径 = join(目录, '梦境.md')
  writeFileSync(路径, '', 'utf8')
  assert.equal(读本觉梦境(路径, 0), '')
  rmSync(目录, { recursive: true, force: true })
})
