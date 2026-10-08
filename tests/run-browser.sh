#!/usr/bin/env bash
# 浏览器测试套件 —— 逻辑测试抓不到"能跑但行为不对"的问题。
# V0.88 的「结局无限刷奖励」、V0.89 的「修仙阁白屏」逻辑测试都全绿,只有这里能抓到。
# 部署前必跑。自起 server,结束自关。
set -u
cd "$(dirname "$0")/.."
PORT="${XX_TEST_PORT:-8894}"
PY="${PYTHON:-python3}"
pass=0; failed=0; failed_names=""

$PY -m http.server "$PORT" --bind 127.0.0.1 >/tmp/xx-test-server.log 2>&1 &
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
# 沙箱里后台进程容易被回收,结果直接落盘
if [ -n "${XX_BR_LOG:-}" ]; then exec > >(tee -a "$XX_BR_LOG") 2>&1; fi
for f in tests/t8*.py tests/t9*.py tests/audit-reach.py tests/full*.py; do
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
