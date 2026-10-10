# 多 Agent 协作约定 —— 轩轩修仙传

owner 2026-10-10 放了两个 agent 并行会话进来。三方在同一份仓库上干活，
而**彼此看不见对方**——从 Termux 内部无法枚举谁连进来了
（`/proc/net/tcp` 权限拒绝，别的 uid 的会话也读不到）。
所以协作的 rendezvous 点只能是**仓库本身**。这份文件就是那个点。

---

## 0. 三条铁律（违反的代价比收益大）

1. **不许 `--force` 推送。**
   有人正在你未提交的分支上工作。强推会**抹掉别人的东西**且无法撤销。
2. **不许 `git reset --hard`,不许 `git checkout <file>`。**
   这两条会静默覆盖工作区里**未提交的**改动。本项目已经因此丢过一次代码。
3. **先 fetch 再动手。** 开始前 `git fetch origin`,看一眼别人推了什么。
   远端经常有你没见过的提交(我们今天已经合并过对面 agent 的 6 个)。

---

## 1. 分区：谁管哪块，别越界

| 区域 | 文件 | 负责人 |
|---|---|---|
| 玩家体验批次 | `TICKETS.md` 的 `XX-PLAY-*` | **A（本会话）** |
| 剧情锚点 / 世界 / 支线 | `story.js` `worldgen.js` `quest.js` `world/` `build.js` `newlife.js` | **A** |
| UI 呈现层 | `js/xiuxian/ui/` `css/` | **A** |
| 局内砍杀 | `js/game/` `js/core/` | **B** |
| 数学/算法特性 | `js/game/collatz.js` 及其门禁 | **A**（已落地，接线时需 B 知会）|
| 运维脚本 | `tools/ops/` `bin/phones/` | **C** |
| 门禁/测试 | `tests/` | **共享**:新增门禁必须自带**注入反向验证** |

**B 要改 `js/game/spawner.js` 之前先看这里** —— 我在上面接了 Collatz 的三条曲线
(`hpMultAt` / `eliteHpMultAt` / `dmgMultAt`)、刷怪池档位偏置 (`poolIdx`)、奇偶信号
(`collatzParityAt`)。**默认中性**:未激活时调制系数恒为 1.0，
`poolIdx` 的档位边界与改动前**逐位相同**。所以你可以照常改，
但别把 `poolK()` 那条路径删掉,也别改 `AGGRO_K`/`SUSTAIN_K` 的语义。

---

## 2. 领活流程（避免撞车）

```
1. git fetch origin && git log --oneline HEAD..origin/main
2. 看第 2 节分区,确认这件事属于谁的区
3. 属于自己的区 → 干;不属于 → 记到下面「待认领」,别硬插
4. 从 origin/main 切自己的分支:git checkout -b <前缀>-<短描述>
5. 干完:本地全量 npm run check 必须 EXIT=0
6. 提交 → 推送 → 如果被拒(fetch first),fetch + merge,不要 force
```

---

## 3. 新增门禁的硬要求

这是本项目吃过最多亏的地方。**门禁写错比没有门禁更坏**。

- **断言必须独立于被检查的数据。**
  本轮已抓到两处「断言与实现同源」导致永远为绿的假绿:
  `region-layer-regression` 拿 `visibleNodes()` 过滤集当分母,而实现用的是同一个过滤;
  Collatz 门禁原先只查「函数名被调用」,把 HUD 里拼接后缀那行删掉照样绿。
- **每条新门禁必须做注入式反向验证**:把被守的代码改坏,门禁必须变红。
  光「跑绿了」不算数。本轮已做 13 条注入,全部捕获。
- **扫源码前必须用 `lib-uimod` 的 `codeMask` 剥注释。**
  本轮已经栽了 6 次:注释里的 `node:'n8'` 被当成真实引用。
- **基准必须来自真实可考数据**,不能沿用注释或旧测试里的虚构值。
- **导出了但没人用的代码 = 没写。** 本轮 Collatz 模块一度 6 个导出里 4 个生产引用为 0。
- **新模块必须进 `sw.js` 离线预缓存**,否则离线白屏(`lint-precache` 会报红)。

---

## 4. 当前状态（2026-10-10 23:40）

- 分支 `fix/player-complain-20261010`,`main` = `d79d94f`
- 全量 `npm run check` **EXIT=0 零红条**
- 已合并对面 agent 的 6 个提交(runit sshd 根因、两个测试脚本的 Termux 兼容性、
  package-lock、manifest 重生成)
- **T2X(192.168.1.130) sshd 进程已退出**,主机活着但 8022/5555/2222 全 closed。
  今天第三次。连不上就是连不上,不要 force、不要假装同步了。

## 5. 待认领（不属于 A 的区，做之前先在这里登记）

- `js/game/spawner.js` 的无尽模式(`setEndless`)难度上限 —— 目前没有天花板,
  长时间挂机会指数膨胀
- `js/game/director.js` 的生成预算导演在多篝火/多矿脉下的表现
- `tools/visual/` 的截图流程(依赖 adb,而 Termux 的 adb 二进制在 Android 12 上链接不起来)
- `js/xiuxian/world/network.js` 与 `world/types.js` 目前是**暂存未接线**状态,
  按工单计划(Dijkstra 赶路 / 大世界类型契约)推进