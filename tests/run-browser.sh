#!/usr/bin/env bash
# 浏览器测试套件 —— 逻辑测试抓不到"能跑但行为不对"的问题。
# V0.88 的「结局无限刷奖励」、V0.89 的「修仙阁白屏」逻辑测试都全绿,只有这里能抓到。
# 部署前必跑。自起 server,结束自关。
set -u
cd "$(dirname "$0")/.."
PORT="${XX_TEST_PORT:-8894}"
PY="${PYTHON:-python3}"
pass=0; failed=0; failed_names=""

# —— 前置检查 ——
# playwright 缺失时**必须立刻停**,不能让它跑出一堆假红。
# 浏览器测试不是"锦上添花":历史上「修仙阁白屏」「结局无限刷奖励」
# 「去重误删方法」这几类事故,逻辑测试**全绿**,只有真跑浏览器才炸出来。
# 所以"跑不了"要当失败上报,不能默默跳过。
if ! $PY -c "import playwright" 2>/dev/null; then
  # 2026-10-10：Android/Termux 上 pip 会直接报
  #   "Could not find a version that satisfies the requirement playwright
  #    (from versions: none)"
  # 这**不是** pip 或网络坏了（实测 pip 能装别的包、pypi.org 也通）。
  # 是平台不兼容：playwright 只发 manylinux/glibc 的 wheel
  # （1.63.0 仅有 manylinux1_x86_64 与 manylinux_2_17_aarch64），
  # 而 Android 用的是 bionic libc。即便装上，它自带的 Chromium 也是
  # glibc 构建，同样跑不起来。所以这里**没有装得上的一条路**，
  # 别再在这上面反复试了 —— 要跑浏览器测试就换一台 glibc 机器。
  case "$(uname -s 2>/dev/null)" in
    Android|Linux)
      if $PY -c "import sys,platform; sys.exit(0 if 'android' in platform.platform().lower() else 1)" 2>/dev/null; then
        echo "❌ 本机是 Android/Termux，浏览器测试**结构性跑不了**（playwright 无 bionic wheel）"
        echo ""
        echo "   已验证：pypi.org 与 pythonhosted 均可达，pip 本身正常（能装别的包），"
        echo "   但 playwright 1.63.0 只提供 manylinux/glibc 构建，Android 用 bionic libc。"
        echo "   自带的 Chromium 同理跑不起来。"
        echo ""
        echo "   要跑这套测试 → 换一台 glibc 机器（桌面 Linux / macOS / WSL）。"
        echo "   这不是可以「装一下就好」的问题，别在这上面继续耗时。"
        exit 2
      fi
      ;;
  esac
  echo "❌ playwright 没装,浏览器测试无法执行"
  echo ""
  echo "   安装:"
  echo "     pip install playwright"
  echo "     $PY -m playwright install chromium"
  echo ""
  echo "   注意:这套测试是唯一能抓「重复定义 / 定义了但没人调用」这类 bug 的手段,"
  echo "   而那正是本项目反复出问题的地方。装不上就等于这套防线不存在。"
  exit 1
fi

# 2026-10-10：日志路径原本写死 /tmp —— Termux 没有 /tmp（临时目录是 $PREFIX/tmp），
# 那一行会把 server 拉不起来，报错还指向别处。改用 ${TMPDIR:-/tmp}，两边都兼容。
SRVLOG="${TMPDIR:-/tmp}/xx-test-server.log"
$PY -m http.server "$PORT" --bind 127.0.0.1 >"$SRVLOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT INT TERM
sleep 3
if ! curl -s --max-time 8 -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "❌ 本地服务器没起来(端口 $PORT 被占?换端口:XX_TEST_PORT=8895 bash tests/run-browser.sh)"
  exit 1
fi
echo "本地服务器 http://127.0.0.1:$PORT 就绪"
echo ""

# audit-reach 是可达性审计:不注入状态,从入口走一遍,抓「定义了但玩家拿不到」
# audit-loop 验证砍杀与修仙阁是同一个游戏(道行/源石真的互通)
# 注意 audit-ui.py 故意不在这里:它只出截图给人看,没有 pass/fail 判据,不是门禁
# 沙箱里后台进程容易被回收,结果直接落盘
if [ -n "${XX_BR_LOG:-}" ]; then exec > >(tee -a "$XX_BR_LOG") 2>&1; fi
for f in tests/t8*.py tests/t9*.py tests/audit-reach.py tests/audit-loop.py tests/full*.py; do
  [ -f "$f" ] || continue
  name=$(basename "$f" .py)
  echo "=== $name ==="

  # 输出落盘再判定,避免管道消费变量
  tmp=$(mktemp)
  timeout 300 $PY "$f" > "$tmp" 2>&1
  code=$?

  grep -E "✅|❌|JS错误" "$tmp" | sed 's/^/  /'

  # 判定:退出码非 0,或输出里出现 ❌,都算失败
  bad=0
  [ $code -ne 0 ] && bad=1
  grep -q "❌" "$tmp" && bad=1
  grep -qE "Traceback|TimeoutError" "$tmp" && bad=1

  if [ $bad -eq 0 ]; then
    pass=$((pass+1))
    echo "  → 通过"
  else
    failed=$((failed+1)); failed_names="$failed_names $name"
    [ $code -ne 0 ] && echo "  → 退出码 $code"
    grep -E "Traceback|Error:" "$tmp" | head -3 | sed 's/^/    /'
  fi
  rm -f "$tmp"
  echo ""
done

total=$((pass+failed))
echo "================================================"
echo "浏览器测试: $pass / $total 通过"
if [ $failed -eq 0 ]; then
  echo "✅ 全部通过"
else
  echo "❌ 失败:$failed_names"
fi
exit $failed
