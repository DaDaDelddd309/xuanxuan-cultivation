# tools/ops —— Termux 手机运维

三台开发机(Z8 / 三星 / T2X)的 ssh 可达性维护。

## 现状

| 机器 | 地址 | ssh 端口 | 备注 |
|---|---|---|---|
| Z8 | 192.168.1.41 | 8022 / 5555 | 本仓库所在机，sshd 由共享 runsvdir 托管 |
| 三星 | 192.168.1.39 | 8022 | 会议室所在机，**最常失联** |
| T2X | 192.168.1.130 | 8022 | 口令 `agent1234` |
| OPPO | 192.168.1.116 | 8022 | agent 基础设施，无游戏仓库 |

地址会漂。**排查前先实测**(`nmap -sn` + `nc -z`)，不要硬编码历史地址。

## 症状与判读

「ping 得通但 8022 Connection refused」= **主机活着，sshd 进程没了**。

`Connection refused` 和 `timeout` 必须分清：

- `Connection refused` —— 包到了、对面回了 RST。路径通，只是没人监听。**这是 sshd 没跑。**
- `timeout` —— 包被丢弃。才是防火墙/网络问题。

## 2026-10-10 排查结论

### ✗ 被推翻的两个流行猜测

1. **「runsvdir 一死，底下服务全部陪葬」——错的。**
   Z8 实测：杀掉 runsvdir 后，它的 `runsv` / `sshd` 子进程**不会跟着死**，
   而是被 init 收养（PPID 变 1）继续占用 8022/5555。端口照常在听。

2. **「CPU 被跑满导致 sshd 被杀」——不成立。**
   三星实测 `top`：`800%cpu 0%user 0%sys 800%idle`，CPU 完全空闲，
   而 `load average` 显示 30。**Android/Termux 下 loadavg 不可信**，别拿它当证据。

3. **「Termux 进程吃爆内存」——也不对。**
   三星 Termux 全部进程 RSS 合计仅 187MB，而系统显示 5.4G/5.7G 已用。
   占用主体在 Android 侧应用，Termux 里够不着、也管不了。

### ✓ 真正确认的坑

**openssh 包自带 `var/service/sshd/down`。**

```
pkg install openssh   →  $PREFIX/var/service/sshd/  （含 down 文件）
```

runit 见到 `down` 就**不启动该服务**。后果是：装完 openssh、Termux:Boot 也装好、
开机脚本也跑了，**sshd 依然起不来**，除非手工 `rm` 掉那个 `down`。
Z8 上是 2026-10-10 00:50 手工删的，此前没进过任何文档。

端到端实测：临时服务目录带 `down` 时 probe 不启动；删掉 `down` 后能启动。

### ✓ 正确的停服顺序

**先 `sv down <service>`，再停 runsvdir。** 顺序反了就会留下孤儿。

反例的连锁反应（Z8 实测走了四轮才收敛）：

1. 先杀 runsvdir → `runsv`/`sshd` 被 init 收养成孤儿，继续占端口；
2. reparent 是**异步**的 —— 杀 runsv 的瞬间子 sshd 还没变成 PPID=1，
   所以任何「按 PPID==1 过滤孤儿」的写法都会漏；
3. 漏掉的孤儿继续占着 8022/5555，此时 `sv up` 包内服务 →
   `Bind to port 8022 failed: Address already in use` → **无限重启**；
4. 此时端口表面「在听」，实际全靠孤儿撑着。孤儿一死，就彻底没人拉起。

### ⚠ Termux 上按进程匹配的三个陷阱

改脚本时踩过，记录在此：

1. **不能按 argv 里出现 `"sshd -D"` 匹配** —— 任何 shell 只要命令行里带这个
   字符串就会被误杀。实测把执行脚本的 shell 自己 `kill -9` 掉了。
2. **不能按 `comm == "sshd"` 匹配** —— 本机 `ps` 的 comm 字段被截断成路径
   （显示为 `/data/data/com.termux.`），该判据永远匹配不到。
3. **`pgrep -f` 会匹配到调用它的那条远程命令自身** —— 模式串就写在
   `ssh host '...pgrep -f "xxx"...'` 的 argv 里。校验结果请用 `ps` 复核，
   不要用 `pgrep` 自证。

可靠判据只有一条：`ps -eo pid,args` 后 `args[0]` **精确等于**二进制全路径。

### ✗ 试过并放弃的方案

把 sshd 拆到独立 runsvdir（`sshd-isolate.sh`）—— **已撤除，不予交付**。
两次 install 失败，其中一次把 Z8 唯一远程入口整个搞挂。
且它本来也解决不了根因（Android 杀整个 Termux 应用）。

## 怎么把 sshd 拉起来

```sh
sshd          # 前台起，手动
sv up sshd    # 交给 runit 托管（推荐）
```

`tools/ops/termux-sshd-autostart.sh` 是开机自启入口，装 Termux:Boot
（`com.termux.boot`）后放到 `~/.termux/boot/00-start-sshd`。

**注意**：保活是 runit 的 job，**不要有第二份**。Z8 上曾并存
「手动 sshd + runit + watchdog」三套保活抢同一批端口、写同一个 pidfile，
开机必然出现「启动失败（端口被占用?）」。

## 待办

- **三台都没装 Termux:Boot**（`com.termux.boot` 不在已装包里，只有 `com.termux`）。
  不装则开机后 sshd 永远不会自己起来。
- 建议把 Termux 加进 Android 的**电池优化白名单 / 不受限制**，这才是
  针对「Android 杀后台」的直接手段。Termux:Boot 只管开机，管不了运行中被杀。
