#!/data/data/com.termux/files/usr/bin/sh
#
# Termux 开机自启 ssh —— 三台手机(Z8 / 三星 / T2X)的统一入口
#
# 装法(每台各做一次):
#   1. 装 Termux:Boot(F-Droid / Play,包名 com.termux.boot)
#   2. mkdir -p ~/.termux/boot
#      cp termux-sshd-autostart.sh ~/.termux/boot/00-start-sshd
#      chmod +x ~/.termux/boot/00-start-sshd
#   3. 重启手机,看 $PREFIX/var/log/sshd-boot.log
#
# ─────────────────────────────────────────────────────────────────
# 为什么是 runit,而不是「脚本里直接起 sshd」
#
# 2026-10-10 那天 Z8 上并存过三套保活,互相抢同一批端口:
#   ① boot 脚本 手动 pkill -x sshd 再自己起一个
#   ② $PREFIX/var/service/sshd 由 runit(runsv)托管,进程退出自动重启
#   ③ ~/.local/bin/sshd-watchdog.sh 每 60s 用同一个 pidfile 探活再拉起
#
# 后果是开机必现的「启动失败(端口被占用?)」,以及 watchdog 与 runit
# 互相认为对方该负责的反复重启循环。pkill -x 是全局杀进程,不看
# 自己是 runit 的子进程。
#
# 结论:**保活是 runit 的 job,不该有第二份。**
# 本脚本只做两件事:① 确保 runit 起来 ② 自检并写日志。
# 服务挂了 runsv 自己会重启,这里不插手。
#
# ─────────────────────────────────────────────────────────────────
# ⚠️ 真正的坑:openssh 自带 var/service/sshd/down
#
# pkg install openssh 会装出 $PREFIX/var/service/sshd/,里面有个
# `down` 文件。runit 见到 down 就**不启动这个服务**。
# 也就是说:装完 openssh、Termux:Boot 也装好了、脚本也跑了,
# sshd 还是不会起来 —— 除非有人手工 rm 掉那个 down。
# Z8 上就是 00:50 手工删的,这个步骤此前没有进过任何文档。
# 本脚本第 3 步就是补这个洞。
#
# ─────────────────────────────────────────────────────────────────
# 本脚本刻意不碰的东西
#   ~/.ssh/authorized_keys、known_hosts、sshd_config —— 只读不改。
#   密钥与端口是各机事实,脚本无权替你决定。只 mkdir/chmod ~/.ssh 目录本身。
#
set -u

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
SVDIR="$PREFIX/var/service"
SVC="sshd"
LOGDIR="$PREFIX/var/log/sv"
LOG="${AUTOSTART_LOG:-$PREFIX/var/log/sshd-boot.log}"

# 覆盖点:仅供自测,正常装法不要设。
#   AUTOSTART_SVDIR  指到临时服务目录,验证「down 被删 / 冷启动」分支
#   AUTOSTART_PORTS 逗号分隔端口,替代从 sshd_config 解析
SVDIR="${AUTOSTART_SVDIR:-$SVDIR}"
PORT_OVERRIDE="${AUTOSTART_PORTS:-}"

mkdir -p "$PREFIX/var/log" 2>/dev/null

ts() { date '+%F %T' 2>/dev/null || echo '(no date)'; }

# ⚠️ 日志写不进去要**立刻退出**,不能装作没事。
#   这台机器吃过三次「明明失败了却报成功」的亏 ——
#   一次是 lint 把扫不到东西判成 ok,一次是 settle 抛异常被 catch 吞掉。
#   自己写的脚本不能再犯:写不进日志就等于没有诊断信息,
#   静默成功比失败更糟。
#
#   截断必须放进子 shell `( ... )`:POSIX 规定重定向失败对**特殊内建**
#   是致命错误,`: >"$LOG"` 直接把整个脚本带走(实测 dash 退 2),
#   后面的 `||` 和诊断信息根本没机会执行 —— 于是运维只看到一个
#   没有出处的 exit 2。子 shell 里失败只干掉子 shell,才轮得到我们报错。
( : >"$LOG" ) 2>/dev/null || {
  echo "无法创建 $LOG —— 目录不可写。自查: df -h \$PREFIX/var/log; mount | grep -i termux" >&2
  exit 1
}
say() { echo "$(ts) $*" >>"$LOG"; }

say "=== sshd 自启开始 ==="

# ── 1) 等 $PREFIX 挂上 ────────────────────────────────────────────
# Termux:Boot 给的启动很早,存储可能还没挂好。等 PREFIX/bin 出现再动手。
i=0
while [ ! -d "$PREFIX/bin" ] && [ "$i" -lt 30 ]; do
  sleep 2; i=$((i + 1))
done
if [ ! -d "$PREFIX/bin" ]; then
  say "❌ 等不到 $PREFIX/bin,放弃"
  exit 1
fi

# ── 2) 依赖 ──────────────────────────────────────────────────────
missing=""
for pkgname in openssh runit; do
  pkg list-installed 2>/dev/null | grep -q "^$pkgname/" || missing="$missing $pkgname"
done
if [ -n "$missing" ]; then
  say "缺少:$missing —— 开始安装"
  if ! pkg install -y $missing >>"$LOG" 2>&1; then
    say "❌ 安装失败,详见本日志"
    exit 1
  fi
  say "安装完成"
else
  say "依赖齐全(openssh + runit)"
fi

# ── 3) ★ 启用服务:删掉 down 文件 ─────────────────────────────────
# 没有这一步,runit 会安静地什么都不做 —— 见文件头「真正的坑」。
if [ -f "$SVDIR/$SVC/down" ]; then
  if rm -f "$SVDIR/$SVC/down" 2>/dev/null; then
    say "✅ 已删除 $SVDIR/$SVC/down(runit 之前不会启动 sshd)"
  else
    say "❌ 删不掉 $SVDIR/$SVC/down —— runit 不会启动 sshd。手工: rm -f $SVDIR/$SVC/down"
    exit 1
  fi
else
  say "服务已启用(无 down 文件)"
fi

# 只 chmod 目录本身,不动里面任何密钥文件。
mkdir -p "$HOME/.ssh" 2>/dev/null
chmod 700 "$HOME/.ssh" 2>/dev/null

# ── 4) 确保 runit 在跑 ───────────────────────────────────────────
# 只管 runsvdir 本身,不去 pkill 任何服务 —— 服务归 runsv 管。
if pgrep -f runsvdir >/dev/null 2>&1; then
  say "runit(runsvdir) 已在运行,跳过启动"
else
  mkdir -p "$LOGDIR" 2>/dev/null
  SVDIR="$SVDIR" LOGDIR="$LOGDIR" \
    setsid nohup "$PREFIX/bin/runsvdir" "$SVDIR" >/dev/null 2>&1 </dev/null &
  sleep 2
  if pgrep -f runsvdir >/dev/null 2>&1; then
    say "✅ runit(runsvdir) 启动成功"
  else
    say "❌ runit 启动失败 —— 下次开机重试;手工: service-daemon start"
    exit 1
  fi
fi

# ── 5) 自检:哪些端口真的在监听 ───────────────────────────────────
# 只**读**不修:自检的价值是留下痕迹,不是在这里抢 runit 的活。
# 「端口没起来」的正确修法是 sv restart <服务>,不是在本脚本里重起。
#
# 端口从 sshd_config 解析而不是写死 —— 各机可能不一样。
if [ -n "$PORT_OVERRIDE" ]; then
  PORTS="$PORT_OVERRIDE"
else
  PORTS=$(sed -n 's/^[[:space:]]*[Pp]ort[[:space:]]\{1,\}\([0-9]\{1,\}\).*/\1/p' \
          "$PREFIX/etc/ssh/sshd_config" 2>/dev/null | sort -u | tr '\n' ' ')
  # 判空用 tr -d 不用 ${PORTS// /} —— 后者是 bashism。
  # 本机 $PREFIX/bin/sh 是 dash,会直接 "Bad substitution" 退出。
  [ -z "$(printf '%s' "$PORTS" | tr -d ' ')" ] && PORTS="8022"
fi
say "待检端口:${PORTS}"

KEY="$HOME/.ssh/id_ed25519"
SSHUSER=$("$PREFIX/bin/whoami" 2>/dev/null || id -un 2>/dev/null || echo "")

for port in $PORTS; do
  if [ -z "$SSHUSER" ]; then
    say "⚠️  :$port 取不到用户名,跳过登录自检"
  elif [ ! -f "$KEY" ]; then
    # 没私钥不等于服务没起来。端口能连 ≠ 密钥能登,两者分开报。
    if nc -z -w 3 127.0.0.1 "$port" >/dev/null 2>&1; then
      say "⚠️  :$port 端口在听,但没有 $KEY,未验密钥登录"
    else
      say "❌ :$port 未监听且无密钥可验 —— 手工: sv restart $SVC"
    fi
  elif timeout 6 "$PREFIX/bin/ssh" -p "$port" \
        -o BatchMode=yes -o StrictHostKeyChecking=no \
        -o UserKnownHostsFile=/dev/null -o ConnectTimeout=4 \
        -i "$KEY" "$SSHUSER@127.0.0.1" 'true' >/dev/null 2>&1; then
    say "✅ :$port 密钥登录正常"
  else
    say "❌ :$port 密钥登录失败 —— 手工: sv restart $SVC;查 $LOGDIR/$SVC"
  fi
done

say "=== 自启结束 ==="
exit 0
