/**
 * dsh-life-cycle —— 浏览器半端（设置里的「生命节奏」一页）
 * ============================================================================
 * 自注册脚本（和 dsh-feiyu-mood 一样的约定）：
 *
 *     window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 这一页要做的事：
 *   · 一眼看到小夜现在多少精力、在做什么、还剩多久、下次几点醒
 *   · 能看到最近几轮做了什么（流水）
 *   · 总开关、目标会话能改；「立刻醒一次」「精力回满」能手动触发
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-life-cycle',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-life-cycle'

    const getJson = async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }
    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }

    const CSS = `
[data-lc-wrap]{display:flex;flex-direction:column;gap:14px;padding:4px 2px 24px;}
[data-lc-card]{padding:14px 16px;border-radius:12px;background:rgba(127,127,127,.08);}
[data-lc-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-lc-energy]{height:14px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;flex:1 1 220px;min-width:180px;}
[data-lc-fill]{height:100%;border-radius:999px;transition:width .4s ease;}
[data-lc-num]{font-variant-numeric:tabular-nums;font-size:13px;opacity:.85;white-space:nowrap;}
[data-lc-big]{font-size:20px;font-weight:600;}
[data-lc-sub]{font-size:12px;opacity:.65;margin-top:6px;line-height:1.6;}
[data-lc-title]{font-size:13px;font-weight:600;opacity:.8;margin-bottom:8px;}
[data-lc-list]{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow:auto;}
[data-lc-item]{font-size:12px;line-height:1.6;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.07);display:flex;gap:8px;}
[data-lc-time]{opacity:.55;white-space:nowrap;font-variant-numeric:tabular-nums;}
[data-lc-btn]{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;}
[data-lc-btn]:hover{background:rgba(127,127,127,.12);}
[data-lc-btn]:disabled{opacity:.4;cursor:default;}
[data-lc-input]{width:100%;box-sizing:border-box;padding:7px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font-size:13px;}
[data-lc-label]{font-size:12px;opacity:.7;margin-bottom:5px;display:block;}
[data-lc-msg]{font-size:12px;min-height:16px;opacity:.75;}
[data-lc-tag]{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.16);white-space:nowrap;}
`

    /** 精力条的配色：越接近满越绿，见底偏红。 */
    const 精力色 = (比例) => {
      if (!Number.isFinite(比例)) return '#888'
      if (比例 > 0.6) return '#3ba55d'
      if (比例 > 0.3) return '#d9a441'
      return '#d9534f'
    }

    /** 把毫秒差说成人话。 */
    const 说时长 = (毫秒) => {
      if (!Number.isFinite(毫秒)) return '—'
      if (毫秒 <= 0) return '已经到点'
      const 分 = Math.round(毫秒 / 60000)
      if (分 < 1) return '不到 1 分钟'
      if (分 < 60) return 分 + ' 分钟'
      const 时 = Math.floor(分 / 60)
      return 时 + ' 小时 ' + (分 % 60) + ' 分'
    }

    const 格式化时间 = (值) => {
      if (!值) return '—'
      try {
        const d = new Date(值)
        if (Number.isNaN(d.getTime())) return String(值)
        return d.toLocaleString('zh-CN', { hour12: false })
      } catch (e) {
        return String(值)
      }
    }

    function Panel() {
      const [数据, set数据] = React.useState(null)
      const [错误, set错误] = React.useState('')
      const [提示, set提示] = React.useState('')
      const [忙, set忙] = React.useState(false)
      const [会话框, set会话框] = React.useState(null)

      const 拉 = React.useCallback(async () => {
        try {
          const j = await getJson(API + '/state')
          set数据(j)
          set错误(j && j.ok === false ? String(j.说 || '读不到状态') : '')
        } catch (e) {
          set错误(String((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => {
        拉()
        const t = setInterval(拉, 10000)
        return () => clearInterval(t)
      }, [拉])

      const 动作 = async (体, 说明) => {
        set忙(true)
        set提示('')
        try {
          await postJson(API + '/state', 体)
          set提示(说明)
          await 拉()
        } catch (e) {
          set提示('失败：' + String((e && e.message) || e))
        } finally {
          set忙(false)
        }
      }

      const 改总开关 = async (下一个) => {
        set忙(true)
        set提示('')
        try {
          await postJson(API + '/config', { 总开关: 下一个 })
          set提示(下一个 ? '总开关已打开' : '总开关已关闭')
          await 拉()
        } catch (e) {
          set提示('失败：' + String((e && e.message) || e))
        } finally {
          set忙(false)
        }
      }

      const 存会话 = async () => {
        const 值 = String(会话框 == null ? (数据 && 数据.会话) || '' : 会话框).trim()
        set忙(true)
        set提示('')
        try {
          await postJson(API + '/config', { 目标会话: 值 })
          set提示('目标会话已保存')
          await 拉()
        } catch (e) {
          set提示('失败：' + String((e && e.message) || e))
        } finally {
          set忙(false)
        }
      }

      if (!数据) {
        return h('div', { 'data-lc-wrap': '' },
          h('div', { 'data-lc-card': '' }, 错误 ? '读不到状态：' + 错误 : '正在读取…'))
      }

      const 状 = 数据.状态 || {}
      const 规则 = 数据.规则 || {}
      const 上限 = 状.energyMax || 规则.上限 || 1020
      const 精力 = typeof 状.energy === 'number' ? 状.energy : null
      const 比例 = 精力 == null ? NaN : 精力 / 上限
      const 下次 = 状.sleepingUntil || 状.nextWakeAt
      const 距下次 = 下次 ? Date.parse(下次) - Date.now() : NaN
      const 睡着 = 状.awake === false
      const 睡眠 = 状.sleep && typeof 状.sleep === 'object' ? 状.sleep : null
      const 睡了 = 睡眠 ? Date.now() - Date.parse(睡眠.startedAt) : NaN
      const 最近的 = (状.log || []).slice(-6).reverse()
      const 总开关 = 数据.总开关 !== false

      return h('div', { 'data-lc-wrap': '' },
        // —— 状态卡 ——
        h('div', { 'data-lc-card': '' },
          h('div', { 'data-lc-row': '' },
            h('div', { 'data-lc-big': '' }, 睡着 ? '睡着' : '醒着'),
            h('span', { 'data-lc-tag': '' }, 总开关 ? '闹钟开着' : '闹钟关着'),
            h('span', { 'data-lc-tag': '' }, 睡着 ? '睡觉中' : '清醒'),
          ),
          h('div', { 'data-lc-row': '', style: { marginTop: '10px' } },
            h('div', { 'data-lc-energy': '' },
              h('div', {
                'data-lc-fill': '',
                style: { width: (Number.isFinite(比例) ? Math.max(0, Math.min(1, 比例)) * 100 : 0) + '%', background: 精力色(比例) },
              })),
            h('span', { 'data-lc-num': '' }, (精力 == null ? '—' : Math.round(精力)) + ' / ' + 上限),
          ),
          h('div', { 'data-lc-sub': '' },
            (状.inProgress && typeof 状.inProgress === 'object'
              ? h('span', {}, '正在做：' + (状.inProgress.分类 || '?') + '｜' + (状.inProgress.内容 || '（没写内容）')
                + '（计划 ' + (状.inProgress.耗时分钟 || '?') + ' 分钟'
                + (状.inProgress.精力翻倍 ? '，精力翻倍' : '')
                + (状.inProgress.延期次数 ? '，已顺延 ' + 状.inProgress.延期次数 + ' 次' : '') + '）')
              : '这会儿没在做事情'),
            h('br'),
            '下次醒来：' + (下次 ? 格式化时间(下次) + '（' + 说时长(距下次) + '）' : '还没定'),
            h('br'),
            '最近更新：' + 格式化时间(状.lastUpdate),
            h('br'),
            '目录：' + (数据.目录 || '—'),
          ),
          h('div', { 'data-lc-row': '', style: { marginTop: '12px' } },
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: () => 动作({ 立刻醒: true }, '已经叫醒了，几十秒内会醒一次') }, '立刻醒一次'),
            h('button', { 'data-lc-btn': '', disabled: 忙 || 睡着, onClick: () => 动作({ 立刻睡: true }, '已经去睡了，睡多久由插件掷') }, '立刻睡一觉'),
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: () => 动作({ 重置精力: true }, '精力已回满') }, '精力回满'),
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: () => 改总开关(!总开关) }, 总开关 ? '关掉闹钟' : '打开闹钟'),
          ),
          h('div', { 'data-lc-msg': '' }, 提示 || 错误),
        ),

        // —— 睡眠与生理 ——
        h('div', { 'data-lc-card': '' },
          h('div', { 'data-lc-title': '' }, '睡眠（由插件算）'),
          h('div', { 'data-lc-sub': '' },
            睡眠
              ? [
                  '这一觉从 ' + 格式化时间(睡眠.startedAt) + ' 开始，' + 格式化时间(睡眠.until) + ' 到点',
                  '已睡 ' + 说时长(睡了) + '，还剩 ' + 说时长(距下次),
                  '起点精力 ' + Math.round(睡眠.baseEnergy) + '，现在 ' + (精力 == null ? '—' : Math.round(精力)),
                  '本觉梦境：' + (睡眠.dreamUsed ? '已经做过一个' : '还没做') + '｜惊醒：' + (睡眠.startleUsed ? '已经惊醒过' : '还没'),
                  '下一个检查点：' + 格式化时间(睡眠.nextCheckAt) + '（每小时掷一次惊醒/做梦）',
                ].map((行, i) => h('div', { key: i }, 行))
              : [
                  '醒着——精力不会自己恢复，只有睡觉才涨。',
                  '睡觉的方式：往 log 里写一条 分类=睡觉 的记录，睡多久、怎么醒由插件接手。',
                ].map((行, i) => h('div', { key: i }, 行)),
          ),
          h('div', { 'data-lc-sub': '', style: { marginTop: '8px', opacity: '.6' } },
            '规则：上限 ' + 上限 + '｜每分钟恢复 ' + (规则.每分钟恢复 == null ? '—' : 规则.每分钟恢复)
              + '｜睡眠 ' + (规则.睡觉时长小时 ? 规则.睡觉时长小时.join('~') + ' 小时' : '—')
              + '｜惊醒 ' + (规则.惊醒每小时 == null ? '—' : (规则.惊醒每小时 * 100).toFixed(1) + '%/小时')
              + '｜做梦 ' + (规则.做梦每小时 == null ? '—' : (规则.做梦每小时 * 100).toFixed(1) + '%/小时')
              + '（精力为负时 ' + (规则.做梦负数每小时 == null ? '—' : (规则.做梦负数每小时 * 100).toFixed(1) + '%') + '）',
          ),
        ),

        // —— 目标会话 ——
        h('div', { 'data-lc-card': '' },
          h('div', { 'data-lc-title': '' }, '目标会话'),
          h('label', { 'data-lc-label': '' }, '闹钟响了往哪个会话里送消息（填会话 id，带不带 session- 前缀都行）'),
          h('input', {
            'data-lc-input': '',
            value: 会话框 == null ? String(数据.会话 || '') : 会话框,
            placeholder: 'session-xxxxxxxx-…',
            onChange: (e) => set会话框(e.target.value),
          }),
          h('div', { 'data-lc-row': '', style: { marginTop: '8px' } },
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: 存会话 }, '保存'),
          ),
        ),

        // —— 最近做了些什么 ——
        h('div', { 'data-lc-card': '' },
          h('div', { 'data-lc-title': '' }, '最近几轮'),
          最近的.length === 0
            ? h('div', { 'data-lc-sub': '' }, '还没有记录。等第一轮做完就会出现在这儿。')
            : h('div', { 'data-lc-list': '' },
              ...最近的.map((条, i) => h('div', { 'data-lc-item': '', key: i },
                h('span', { 'data-lc-time': '' }, String(条.时间 || '')),
                h('span', {}, (条.分类 || '?') + '｜' + String(条.内容 || '') + '（' + (条.耗时分钟 || 0) + ' 分钟，'
                  + (Number(条.扣精力) < 0 ? '+' + Math.abs(Number(条.扣精力)) : '-' + Number(条.扣精力 || 0)) + '）'),
              )),
            ),
        ),

        // —— 最近的宿主日志 ——
        h('div', { 'data-lc-card': '' },
          h('div', { 'data-lc-title': '' }, '宿主日志（最后 12 行）'),
          h('div', { 'data-lc-list': '' },
            ...(数据.日志 && 数据.日志.length ? 数据.日志.map((行, i) => h('div', { 'data-lc-item': '', key: i },
              h('span', {}, String(行)))) : [h('div', { 'data-lc-sub': '', key: 'e' }, '（还没有日志）')]),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-life-cycle')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-life-cycle: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'life', order: 45, label: '生命节奏' },
          () => h(Panel),
        ))
      },
    }
  },
})
