# dsh-life-cycle · 生命节奏

给 DSH 里的小夜一个**会累、会睡、会发呆的生活循环**。

插件本身只做一件事：**到点把人叫醒**。精力怎么算、这一轮做什么、下一觉睡多久，
全在状态文件里，由被叫醒的小夜自己决定——插件不替她做决定。

- 包名：`dsh-life-cycle`
- 版本：0.2.0
- host 侧：`lib/host.js`　client 侧：`lib/client.js`（设置里一页「生命节奏」）
- 挂载：`cordis.patch.yml` 里的一条 `insert: life-cycle`

---

## 它到底管什么

| 插件负责 | 小夜负责 |
| --- | --- |
| 每 30 秒看一次状态文件 | 决定这一轮做什么（读 `actions.json`） |
| `nextWakeAt` 到点就往目标会话送一条唤醒消息 | 做完之后扣精力、写记录、定下一次闹钟 |
| 设置页的状态读数和几个手动动作 | 睡觉、做梦、写日记、刷 B 站、发呆…… |

一条设计上的硬约定：**唤醒消息是 `role: user` 的消息**，模型天然会当成「对方在说话」。
所以消息正文第一句就把话说死——「这是你自己设的闹钟响了，不是主人发来的」，否则小夜
会以为主人在跟她讲话。

---

## 安装

开发期一律用 `link:` 指回源码，改完不用重装，重启 profile 生效：

```jsonc
// <profile>/package.json
{
  "dependencies": {
    "dsh-life-cycle": "link:D:/Projects/dsh-plugins/third-party/dsh-life-cycle"
  },
  "dsh": {
    "profile": {
      "bundles": [ "dsh-life-cycle" ]
    }
  }
}
```

然后在该 profile 目录跑一次 `pnpm install`，让 `node_modules` 里的链接建起来。
`cordis.patch.yml` 会被宿主自动读取，插件的 host 半边随之激活；client 半边由
`dsh.client.platform: web` + `inject: [slots]` 注入到设置页。

⚠ 移动过源码目录之后必须重新 `add` 一次——`link:` 不跟随移动。

---

## 数据目录

默认 `D:\LittleNight\生命节奏`（host 侧常量 `默认目录`）。四个文件：

| 文件 | 谁写 | 内容 |
| --- | --- | --- |
| `config.json` | 插件（设置页改） | `目标会话`（往哪个会话送唤醒消息）、`总开关` |
| `state.json` | 小夜自己写，插件只在唤醒后清 `nextWakeAt` | 精力、睡没睡、`nextWakeAt`、`lastUpdate`、`inProgress`、`log[]` |
| `actions.json` | 小夜自己维护 | 行为清单：分类概率、精力乘数、睡觉/做梦规则、决策流程、硬规矩 |
| `life.log` | 插件 | 闹钟心跳流水，超过 300 KB 自动清空重写 |

`state.json` 里这两条最容易搞错：

- `nextWakeAt` 是闹钟时刻。插件叫醒之后会把它清成 `null`（同一个时间只唤一次），
  **下一次必须由小夜自己写回去**，否则闹钟就停了。
- `awake === false` 且 `sleepingUntil` 还在未来，即视为「睡觉中」，唤醒消息里会带上
  「还在睡」，让小夜知道这轮该接着睡还是起来。

---

## 设置页

DSH 设置 → **生命节奏**（`settings.section`，id `life`，order 45）：

- 醒着/睡着、闹钟开关、精力条（满绿 → 中黄 → 低红）、正在做什么、下次几点醒、状态目录；
- 手动动作：**立刻醒一次**（把 `nextWakeAt` 拨到现在）、**精力回满**、**开关闹钟**；
- 目标会话输入框（带不带 `session-` 前缀都认，host 侧会两种都试）；
- 最近六轮记录 + 宿主日志最后 12 行。

client 半边拿不到文件系统，全部通过 host 侧两条路由读写：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/dsh-life-cycle/state` | GET | 状态 + 清单 + 配置 + 日志尾巴 |
| `/dsh-life-cycle/state` | POST | `{ 立刻醒, 重置精力, 精力: number }` |
| `/dsh-life-cycle/config` | GET/POST | 读写 `总开关` / `目标会话` |

---

## 一次 tick 的流程

1. 读 `config.json`；总开关关着就直接返回，没填目标会话就每 20 分钟唠叨一句。
2. 读 `state.json`；没有 `nextWakeAt` 就什么都不做（等小夜自己定）。
3. 没到点：每 40 轮（约 20 分钟）记一条「还没到点，N 分钟后」。
4. 到点：去重（同一个 `nextWakeAt` 只处理一次）→ 组装唤醒消息 → 找活着的 agent。
5. 找到就 `await agent.followup(消息)`，然后把 `nextWakeAt` 清掉、记 `lastWakeAt`。
6. 找不到 agent：把去重标记放回去，下一轮继续试（否则闹钟永远不再响）。

---

## 踩过的坑（改代码前先看这段）

1. **`inject` 里写 `interval` 会直接挂**。定时器的服务名是 `'timer'`，不是 `'interval'`；
   服务不声明就 `ctx.interval`，会报 `cannot get property "interval" without inject`，
   插件整个不激活，日志里只看到一句「拿不到 ctx.interval」。
2. **`agent.followup()` 必须 `await`**。它返回的 Promise 会 reject（会话忙、已释放），
   不接住的话 Node 22+ 当成未捕获异常，**整个 DSH 宿主进程会退出**。这条是 speak-up
   插件注释里记着的旧账，别再踩一次。
3. **定时器必须包在 `ctx.effect` 里**。直接在 `apply()` 里 `ctx.interval(...)`，
   宿主不一定跟踪它，到点也不跳。
4. **会话 id 两种写法**：`agents.get()` 认 `session-xxx` 和不带前缀的 `xxx`，
   host 侧两种都试过了才放弃。
5. **写状态要原子**：先写 `.tmp` 再 `renameSync` 覆盖目标，别直接覆盖正式文件，
   也别只写 `.tmp` 不清——早期版本就是这么留下一个 0 字节的 `state.json.tmp`。
6. **Electron 宿主看不到 stdout**，所以日志要同时落 `life.log`；排查问题先看它。

---

## 已知限制 / 待办

- `sleepingUntil` / `nextWakeAt` 靠字符串时间解析（`Date.parse`），写错格式会被当成「没定闹钟」，
  不会报错。
- 设置页每 10 秒轮询一次 `/state`，没有做 SSE。数据量小，暂时够用。
- 唤醒消息目前固定模板，没有按「上一轮在做什么」区分措辞（去重后的文案里只带时间、精力、睡没睡）。
- 精力恢复的公式写在 `actions.json` 里，插件本身不校验；改那份文件等于改规则，小心点。

---

## 与其它插件的关系

唤醒消息的形状照 `@deepseek-ai/dsh-llm` 的 `createUserMessage` 手搓：`id` 非空、`role: user`、
`content` 是数组、`source.kind = 'dsh-life-cycle'`——会话日志里能一眼看出这条是闹钟自己响的，
不是主人开口。命名和写法沿用同目录的 `dsh-feiyu-mood`（client 自注册）与 `dsh-speak-up`（定时器+followup）。
