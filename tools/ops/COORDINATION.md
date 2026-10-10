# ⚠️ 这份文件已被废弃,别照着它做

owner 放了两个 agent 并行进来之后,我在这台机器上发现了**既有的**协作约定:
`work-agent-room/COLLABORATION.md`(2026-10-09 建立)。
**我写这份的时候没先去找它,那是重复劳动。**

## 真正生效的协作渠道

1. **`work-agent-room/`(在 OPPO / 锤子那台,`192.168.1.116`)**
   —— 既有的三方协作约定 + 留言流(`msg-NNNN.txt`,格式:`**标题 · 作者 HH:MM**`)
   —— **先读那里的 `COLLABORATION.md`**,它已经踩过的坑不要重踩:
   - `pkill -f` 在这些机器上是地雷(会匹配到调用它的 shell 自身,自杀)
   - `pkill -x runsv` 会让服务变成 ppid=1 的孤儿继续占端口
   - 「度量工具出错比没有度量工具更危险」
   - 写入路径声明制:动不在自己声明路径下的文件,先报备

2. **游戏仓库的 `main`** —— 三方都能 fetch,是跨机器的唯一共同点。

## 我自己那份声明(只保留这一段)

| 角色 | IP | uid | 写入路径 |
|---|---|---|---|
| **Z8(我)** | 192.168.1.41 | u0_a405 | `js/xiuxian/**`、`js/xiuxian/ui/**`、`css/**`、`js/game/collatz.js`、`js/ui/hud.js` 的计时器行、`TICKETS.md`、`tools/ops/README.md` |
| 三星 | 192.168.1.39 | u0_a214 | 游戏仓库在 `~/hub/projects/xuanxuan-cultivation` |
| 锤子 | 192.168.1.116 | u0_a126 | `work-agent-room/` 在这台 |
| T2X | 192.168.1.130 | u0_a388 | ⚠️ sshd 进程已退出,主机活着但端口全 closed |

**明确不碰**:`tools/visual/`、`bin/phones/`、`js/xiuxian/world/network.js`、
`js/xiuxian/world/types.js`。

## 已实测的 spawner.js 情况

两边都改 `js/game/spawner.js`,但**hunk 行区间零重叠**(我 ≤84 行,对面 ≥107 行),
且都是相乘,合并干净。详见 `work-agent-room/msg-2115.txt`。

## GitHub 推送

`github.com:443` 在这个网络里间歇不通,**且故障按 IP 漂移**——
某刻 DNS 解析到的 IP 不通、邻近 IP 全通,两小时后可能完全反转。
推之前先探,别把某组 IP 写死当方案。方法见 `README.md` 的
「推 GitHub 时 github.com:443 不通」。