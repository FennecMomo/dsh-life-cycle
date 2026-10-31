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
[data-lc-editor]{width:100%;box-sizing:border-box;min-height:340px;max-height:60vh;padding:10px 12px;border-radius:8px;border:1px solid rgba(127,127,127,.3);background:rgba(127,127,127,.04);color:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;tab-size:2;resize:vertical;white-space:pre;overflow:auto;}
[data-lc-editor]:focus{outline:1px solid rgba(127,127,127,.5);}
[data-lc-bad]{color:#d9534f;}
[data-lc-good]{color:#3ba55d;}
[data-lc-grid]{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;margin-top:8px;}
[data-lc-tile]{padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.09);border:1px solid rgba(127,127,127,.14);min-width:0;}
[data-lc-tile-h]{display:flex;align-items:center;gap:8px;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap;}
[data-lc-tile-n]{font-size:13px;font-weight:600;}
[data-lc-mini]{padding:7px 9px;border-radius:8px;background:rgba(127,127,127,.08);margin-top:6px;min-width:0;}
[data-lc-chips]{display:flex;gap:6px;flex-wrap:wrap;}
[data-lc-chip]{font-size:11px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.16);white-space:nowrap;}
[data-lc-kv]{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:12px;line-height:1.55;}
[data-lc-k]{opacity:.5;white-space:nowrap;}
[data-lc-v]{word-break:break-word;}
[data-lc-desc]{font-size:12px;line-height:1.6;margin:0 0 6px;opacity:.85;}
[data-lc-small]{font-size:11px;opacity:.55;margin-top:6px;line-height:1.5;}
[data-lc-ol],[data-lc-ul]{margin:0;padding-left:20px;font-size:12px;line-height:1.75;}
[data-lc-ul]{padding-left:16px;}
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

    // ---------- 行为清单：把 JSON 拆成一眼能看懂的卡片 ----------

    /** [a, b] 这种数字区间。 */
    const 是区间 = (值) => Array.isArray(值) && 值.length === 2 && 值.every((x) => typeof x === 'number')

    /** 一句话说完一个标量。 */
    const 短文本 = (值) => {
      if (值 === true) return '是'
      if (值 === false) return '否'
      if (值 === null || 值 === undefined) return '—'
      if (是区间(值)) return 值[0] + '~' + 值[1]
      if (Array.isArray(值)) return 值.map((x) => (x && typeof x === 'object' ? '…' : String(x))).join('、')
      if (typeof 值 === 'object') return ''
      return String(值)
    }

    const 百分比 = (值) => {
      const 数 = Number(值)
      if (!Number.isFinite(数)) return String(值)
      return Math.round(数 * 100) + '%'
    }

    /** 标量字段排成两列（键灰、值亮）。复杂结构跳过，交给专门的渲染。 */
    const 键值行 = (对象, 跳过 = []) => {
      const 行 = []
      let i = 0
      for (const [键, 值] of Object.entries(对象 || {})) {
        if (跳过.includes(键)) continue
        if (值 !== null && typeof 值 === 'object') continue
        const 位 = i++
        行.push(h('span', { 'data-lc-k': '', key: 'k' + 位 }, 键))
        行.push(h('span', { 'data-lc-v': '', key: 'v' + 位 }, 短文本(值)))
      }
      if (行.length === 0) return null
      return h('div', { 'data-lc-kv': '' }, ...行)
    }

    /** 字符串数组 → 列表；其它数组 → 一行文字。 */
    const 列表或文本 = (数组) => {
      if (!Array.isArray(数组) || 数组.length === 0) return null
      if (数组.every((x) => typeof x === 'string' || typeof x === 'number')) {
        return h('ul', { 'data-lc-ul': '' }, ...数组.map((x, i) => h('li', { key: i }, String(x))))
      }
      return h('div', { 'data-lc-desc': '' }, 短文本(数组))
    }

    /** 一个小方块：标题 + 占比 + 说明 + 标量字段 + 备注。 */
    const 小方块 = (标题, 对象) => {
      const 是对象 = 对象 && typeof 对象 === 'object' && !Array.isArray(对象)
      return h('div', { 'data-lc-mini': '', key: 标题 },
        h('div', { 'data-lc-tile-h': '' },
          h('span', { 'data-lc-tile-n': '' }, String(标题)),
          h('div', { 'data-lc-chips': '' },
            (是对象 && 对象.占比 != null) ? h('span', { 'data-lc-chip': '', key: 'r' }, '占比 ' + 百分比(对象.占比)) : null,
            (是对象 && 对象.概率 != null) ? h('span', { 'data-lc-chip': '', key: 'p' }, '概率 ' + 百分比(对象.概率)) : null,
          ),
        ),
        是对象 && 对象.说明 ? h('div', { 'data-lc-desc': '' }, String(对象.说明)) : null,
        是对象 ? 键值行(对象, ['说明', '占比', '概率', '备注']) : h('div', { 'data-lc-desc': '' }, 短文本(对象)),
        是对象 && 对象.备注 ? h('div', { 'data-lc-small': '' }, String(对象.备注)) : null,
      )
    }

    /** 分类卡片：概率/乘数/耗时做筹码，说明在上，子项排成小方块。 */
    const 分类卡片 = (名字, 对象) => {
      const 项 = 对象 && typeof 对象 === 'object' ? 对象 : {}
      const 子项 = 项.子项 && typeof 项.子项 === 'object' && !Array.isArray(项.子项) ? 项.子项 : null
      const 概率 = 项.概率 != null ? 项.概率 : 项.时段内概率
      return h('div', { 'data-lc-tile': '', key: 名字 },
        h('div', { 'data-lc-tile-h': '' },
          h('span', { 'data-lc-tile-n': '' }, String(名字)),
          h('div', { 'data-lc-chips': '' },
            概率 != null ? h('span', { 'data-lc-chip': '', key: 'p' }, '概率 ' + 百分比(概率)) : null,
            项.精力乘数 != null ? h('span', { 'data-lc-chip': '', key: 'm' }, '精力 ×' + 项.精力乘数) : null,
            项.耗时分钟 != null ? h('span', { 'data-lc-chip': '', key: 't' }, 短文本(项.耗时分钟) + ' 分钟') : null,
          ),
        ),
        项.说明 ? h('div', { 'data-lc-desc': '' }, String(项.说明)) : null,
        键值行(项, ['说明', '子项', '备注', '精力乘数', '耗时分钟', '概率']),
        列表或文本(项.高概率时段),
        子项 ? h('div', { 'data-lc-small': '' }, '子项') : null,
        子项 ? h('div', {}, ...Object.entries(子项).map(([子名, 子值]) => 小方块(子名, 子值))) : null,
        项.备注 ? h('div', { 'data-lc-small': '' }, String(项.备注)) : null,
      )
    }

    /** 留言箱那节：说明 + 两个行为 + 它自己的硬规矩。 */
    const 留言箱卡片 = (对象) => {      const 项 = 对象 && typeof 对象 === 'object' ? 对象 : {}
      const 行为 = Object.entries(项).filter(([键, 值]) => 值 && typeof 值 === 'object' && !Array.isArray(值))
      return h('div', { 'data-lc-card': '', key: '留言箱' },
        h('div', { 'data-lc-title': '' }, '留言箱'),
        项.说明 ? h('div', { 'data-lc-desc': '' }, String(项.说明)) : null,
        行为.length ? h('div', { 'data-lc-grid': '' }, ...行为.map(([键, 值]) => h('div', { 'data-lc-tile': '', key: 键 },
          h('div', { 'data-lc-tile-h': '' },
            h('span', { 'data-lc-tile-n': '' }, String(键).replace(/_/g, ' · ')),
            值.归类 ? h('span', { 'data-lc-chip': '' }, String(值.归类)) : null,
          ),
          h('div', { 'data-lc-kv': '' },
            ...Object.entries(值)
              .filter(([k, v]) => k !== '归类' && (v === null || typeof v !== 'object'))
              .flatMap(([k, v], i) => [
                h('span', { 'data-lc-k': '', key: 'k' + i }, k),
                h('span', { 'data-lc-v': '', key: 'v' + i }, 短文本(v)),
              ]),
          ),
        ))) : null,
        Array.isArray(项.硬规矩) && 项.硬规矩.length
          ? h('div', { 'data-lc-small': '', style: { marginTop: '10px' } }, '留言箱的规矩')
          : null,
        Array.isArray(项.硬规矩) ? h('ul', { 'data-lc-ul': '', style: { marginTop: '4px' } },
          ...项.硬规矩.map((x, i) => h('li', { key: i }, String(x)))) : null,
      )
    }

    /**
     * 把清单对象渲染成一串卡片（分类 / 决策流程 / 留言箱 / 硬规矩 / 其它）。
     * 纯函数，只依赖传进来的数据，方便离线冒烟测。
     */
    const 渲染清单内容 = (清单对象) => {
      const 是对象 = 清单对象 && typeof 清单对象 === 'object' && !Array.isArray(清单对象)
      if (!是对象) {
        return [h('div', { 'data-lc-sub': '', key: 'empty' }, '（清单没读出来，或者格式有问题——展开原文看看）')]
      }
      const 分类们 = 清单对象.分类 && typeof 清单对象.分类 === 'object' && !Array.isArray(清单对象.分类)
        ? 清单对象.分类 : {}
      const 已知 = ['分类', '决策流程', '留言箱', '硬规矩']
      const 其它键 = Object.keys(清单对象).filter((k) => !已知.includes(k))
      const 流程 = Array.isArray(清单对象.决策流程) ? 清单对象.决策流程 : []
      const 规矩 = Array.isArray(清单对象.硬规矩) ? 清单对象.硬规矩 : []

      const 卡片 = []

      // 分类：一格一类
      if (Object.keys(分类们).length) {
        卡片.push(h('div', { 'data-lc-grid': '', key: '分类' },
          ...Object.entries(分类们).map(([名, 值]) => 分类卡片(名, 值))))
      } else {
        卡片.push(h('div', { 'data-lc-sub': '', key: '分类空' }, '这份清单里没有「分类」。'))
      }

      // 决策流程
      if (流程.length) {
        卡片.push(h('div', { 'data-lc-tile': '', key: '决策流程', style: { marginTop: '10px' } },
          h('div', { 'data-lc-tile-h': '' }, h('span', { 'data-lc-tile-n': '' }, '决策流程')),
          h('ol', { 'data-lc-ol': '' }, ...流程.map((行, i) => h('li', { key: i }, String(行)))),
        ))
      }

      // 留言箱 + 硬规矩
      const 并排 = []
      if (清单对象.留言箱) 并排.push(留言箱卡片(清单对象.留言箱))
      if (规矩.length) {
        并排.push(h('div', { 'data-lc-card': '', key: '硬规矩', style: { background: 'rgba(127,127,127,.09)' } },
          h('div', { 'data-lc-title': '' }, '硬规矩'),
          h('ul', { 'data-lc-ul': '' }, ...规矩.map((行, i) => h('li', { key: i }, String(行)))),
        ))
      }
      if (并排.length) 卡片.push(h('div', { 'data-lc-grid': '', key: '并排', style: { marginTop: '10px' } }, ...并排))

      // 其它顶层字段
      if (其它键.length) {
        卡片.push(h('div', { 'data-lc-tile': '', key: '其它', style: { marginTop: '10px' } },
          h('div', { 'data-lc-tile-h': '' }, h('span', { 'data-lc-tile-n': '' }, '其它')),
          ...其它键.map((键) => h('div', { 'data-lc-mini': '', key: 键 },
            h('div', { 'data-lc-desc': '', style: { opacity: '.55', marginBottom: '2px' } }, 键),
            清单对象[键] && typeof 清单对象[键] === 'object'
              ? (列表或文本(Array.isArray(清单对象[键]) ? 清单对象[键] : null) || 键值行(清单对象[键])
                || h('div', { 'data-lc-desc': '' }, '（这个字段的结构没有专门渲染）'))
              : h('div', { 'data-lc-desc': '' }, 短文本(清单对象[键])),
          )),
        ))
      }

      return 卡片
    }

    function Panel() {
      const [数据, set数据] = React.useState(null)
      const [错误, set错误] = React.useState('')
      const [提示, set提示] = React.useState('')
      const [忙, set忙] = React.useState(false)
      const [会话框, set会话框] = React.useState(null)
      // 行为清单编辑器
      const [清单, set清单] = React.useState(null)
      const [清单文本, set清单文本] = React.useState('')
      const [清单脏, set清单脏] = React.useState(false)
      const [清单忙, set清单忙] = React.useState(false)
      const [清单话, set清单话] = React.useState('')
      const [展开原文, set展开原文] = React.useState(false)

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
          const 回 = await postJson(API + '/state', 体)
          if (体 && 体.做梦 === true) {
            set提示(回 && 回.做梦 === 'busy'
              ? '上一场梦还没跑完（一次只做一场），等它结束再点'
              : (回 && 回.做梦 === 'started' ? '开始做梦了，页面每 10 秒刷新一次进度' : 说明))
          } else {
            set提示(说明)
          }
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

      // ---------- 行为清单（actions.json）----------

      const 拉清单 = React.useCallback(async () => {
        try {
          const j = await getJson(API + '/actions')
          set清单(j)
          set清单文本(String((j && j.原文) || ''))
          set清单脏(false)
          set清单话(j && j.ok === false ? String(j.说 || '读不到清单') : '')
        } catch (e) {
          set清单话('读不到清单：' + String((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => {
        拉清单()
      }, [拉清单])

      const 存清单 = async () => {
        set清单忙(true)
        set清单话('')
        try {
          const j = await postJson(API + '/actions', { 原文: 清单文本 })
          if (j && j.ok) {
            set清单(j)
            set清单文本(String(j.原文 == null ? 清单文本 : j.原文))
            set清单脏(false)
            set清单话('已保存 ✓ 下一次 tick 就按新清单走（不用重启）')
          } else {
            set清单话('没保存：' + String((j && (j.说 || j.错误)) || '不知道为啥'))
          }
        } catch (e) {
          set清单话('保存失败：' + String((e && e.message) || e))
        } finally {
          set清单忙(false)
        }
      }

      const 格式化清单 = () => {
        try {
          const 对象 = JSON.parse(清单文本)
          set清单文本(JSON.stringify(对象, null, 2) + '\n')
          set清单脏(true)
          set清单话('已格式化，记得保存')
        } catch (e) {
          set清单话('格式不对，没法格式化：' + String((e && e.message) || e))
        }
      }

      const 恢复清单备份 = async () => {
        set清单忙(true)
        set清单话('')
        try {
          const j = await postJson(API + '/actions', { 恢复备份: true })
          if (j && j.ok) {
            await 拉清单()
            set清单话('已恢复成上一次保存前的版本')
          } else {
            set清单话('没恢复：' + String((j && (j.说 || j.错误)) || '不知道为啥'))
          }
        } catch (e) {
          set清单话('恢复失败：' + String((e && e.message) || e))
        } finally {
          set清单忙(false)
        }
      }

      const 校验清单 = () => {
        try {
          const 对象 = JSON.parse(清单文本)
          if (对象 === null || typeof 对象 !== 'object' || Array.isArray(对象)) {
            set清单话('最外层必须是对象 {…}')
            return
          }
          const 分类 = 对象.分类 && typeof 对象.分类 === 'object' && !Array.isArray(对象.分类)
            ? Object.keys(对象.分类) : []
          const 规矩 = Array.isArray(对象.硬规矩) ? 对象.硬规矩.length : 0
          set清单话('格式没问题：分类 ' + (分类.join('、') || '(空)') + '；硬规矩 ' + 规矩 + ' 条')
        } catch (e) {
          set清单话('格式不对：' + String((e && e.message) || e))
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
      const 最近一场梦 = 数据.最近一场梦 || null
      const 正在做梦 = 数据.做梦中 === true
      // 一觉只做一个梦：这一觉已经有了，按钮就别再让点
      const 这一觉做过了 = 睡着 && 睡眠 !== null && 睡眠.dreamUsed === true

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
            h('button', {
              'data-lc-btn': '',
              disabled: 忙 || 正在做梦 || 这一觉做过了,
              onClick: () => 动作({ 做梦: true }, '开始做梦了，做完会自己出现'),
            }, 正在做梦 ? '正在做梦…' : 这一觉做过了 ? '这一觉已经做过梦' : '现在做一个梦'),
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: () => 动作({ 重置精力: true }, '精力已回满') }, '精力回满'),
            h('button', { 'data-lc-btn': '', disabled: 忙, onClick: () => 改总开关(!总开关) }, 总开关 ? '关掉闹钟' : '打开闹钟'),
          ),
          h('div', { 'data-lc-sub': '' },
            正在做梦
              ? '正在做梦：临时会话 ' + ((最近一场梦 && 最近一场梦.临时会话) || '…')
                + '，碎片 ' + ((最近一场梦 && 最近一场梦.碎片字数) || 0) + ' 字'
                + (最近一场梦 && 最近一场梦.场景 ? '，场景：' + 最近一场梦.场景 + '…' : '，正在写场景…')
              : 最近一场梦
                ? '最近一场梦：' + (最近一场梦.状态 || '?')
                  + '｜' + (最近一场梦.开始 ? 格式化时间(最近一场梦.开始) : '')
                  + (最近一场梦.字数 ? '｜' + 最近一场梦.字数 + ' 字' : '')
                  + (最近一场梦.出错 ? '｜' + 最近一场梦.出错 : '')
                  + (最近一场梦.场景 ? '｜' + 最近一场梦.场景 + '…' : '')
                  + (这一觉做过了 ? '（这一觉的梦已经做过了，醒来才会清空梦境文件）' : '')
                : '还没做过梦（睡着时掷到，或点「现在做一个梦」）',
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

        // —— 行为清单 ——
        (() => {
          let 清单对象 = null
          try {
            清单对象 = 清单 && 清单.原文 ? JSON.parse(清单.原文) : null
          } catch (e) {
            清单对象 = null
          }
          const 是对象 = 清单对象 && typeof 清单对象 === 'object' && !Array.isArray(清单对象)
          const 分类们 = 是对象 && 清单对象.分类 && typeof 清单对象.分类 === 'object' && !Array.isArray(清单对象.分类)
            ? 清单对象.分类 : {}
          const 已知 = ['分类', '决策流程', '留言箱', '硬规矩']
          const 其它键 = 是对象 ? Object.keys(清单对象).filter((k) => !已知.includes(k)) : []
          const 流程 = 是对象 && Array.isArray(清单对象.决策流程) ? 清单对象.决策流程 : []
          const 规矩 = 是对象 && Array.isArray(清单对象.硬规矩) ? 清单对象.硬规矩 : []

          return h('div', { 'data-lc-card': '' },
            h('div', { 'data-lc-title': '' }, '行为清单'),
            h('div', { 'data-lc-sub': '' },
              '她这一轮做什么、按什么概率、有哪些底线，都从这份清单来。改完保存，下一次 tick 生效，不用重启。',
            ),
            h('div', { 'data-lc-chips': '', style: { marginTop: '8px' } },
              h('span', { 'data-lc-chip': '', key: 'a' }, '分类 ' + Object.keys(分类们).length + ' 类'),
              h('span', { 'data-lc-chip': '', key: 'b' }, '决策 ' + 流程.length + ' 步'),
              h('span', { 'data-lc-chip': '', key: 'c' }, '硬规矩 ' + 规矩.length + ' 条'),
              h('span', { 'data-lc-chip': '', key: 'd' }, (清单 && 清单.有备份 ? '有备份' : '还没有备份')),
              h('span', { 'data-lc-chip': '', key: 'e' }, 清单脏 ? '● 有未保存的改动' : '与文件一致'),
            ),
            h('div', { 'data-lc-sub': '' },
              清单 && 清单.检查
                ? (清单.检查.能用
                  ? h('span', { 'data-lc-good': '' }, '清单可用'
                    + ((清单.检查.警告 || []).length ? '｜⚠ ' + 清单.检查.警告.join('；') : ''))
                  : h('span', { 'data-lc-bad': '' }, '清单有问题：' + String(清单.检查.错误 || '')))
                : '正在读取清单…',
            ),
            h('div', { 'data-lc-sub': '', style: { opacity: '.45' } },
              String((清单 && 清单.路径) || '—') + '｜' + String((清单 && 清单.大小) || 0) + ' 字符'
                + '｜改于 ' + 格式化时间(清单 && 清单.修改时间),
            ),

            ...渲染清单内容(清单对象),

            // 原文编辑（默认收起来）
            h('div', { 'data-lc-row': '', style: { marginTop: '12px' } },
              h('button', { 'data-lc-btn': '', onClick: () => set展开原文((旧) => !旧) },
                展开原文 ? '收起原文编辑' : '编辑原文'),
              h('button', { 'data-lc-btn': '', disabled: 清单忙, onClick: 拉清单 }, '重新载入'),
              h('button', { 'data-lc-btn': '', disabled: 清单忙, onClick: 恢复清单备份 }, '恢复备份'),
            ),
            展开原文 ? h('div', { style: { marginTop: '10px' } },
              h('textarea', {
                'data-lc-editor': '',
                spellCheck: false,
                value: 清单文本,
                onChange: (e) => {
                  set清单文本(e.target.value)
                  set清单脏(true)
                },
              }),
              h('div', { 'data-lc-row': '', style: { marginTop: '8px' } },
                h('button', { 'data-lc-btn': '', disabled: 清单忙 || !清单脏, onClick: 存清单 }, 清单脏 ? '保存清单' : '没有改动'),
                h('button', { 'data-lc-btn': '', disabled: 清单忙, onClick: 校验清单 }, '检查格式'),
                h('button', { 'data-lc-btn': '', disabled: 清单忙, onClick: 格式化清单 }, '格式化'),
              ),
            ) : null,
            h('div', { 'data-lc-msg': '' }, 清单话),
          )
        })(),

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
      /** 只给离线冒烟测试用：把一份清单对象渲染成节点树。浏览器里没人会看这个键。 */
      __渲染清单内容: (对象) => 渲染清单内容(对象),
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
