#!/bin/bash
# 逻辑测试全跑。任一失败即退出。
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in t80 t81 t82 t83 t84 t85 t86 t87 t88 t89 t90; do
  f=""
  [ -f "tests/$t.mjs" ] && f="tests/$t.mjs"
  [ -z "$f" ] && [ -f "tests/$t.js" ] && f="tests/$t.js"
  [ -z "$f" ] && { echo "❌ 缺 $t"; fail=1; continue; }
  out=$(node "$f" 2>&1)
  line=$(echo "$out" | grep -E "^通过 [0-9]+ / 失败 [0-9]+$" | tail -1)
  n_ok=$(echo "$line" | sed -n 's/通过 \([0-9]*\).*/\1/p')
  n_no=$(echo "$line" | sed -n 's/.*失败 \([0-9]*\)/\1/p')
  echo "  $t: 通过 ${n_ok:-?} / 失败 ${n_no:-?}"
  if [ "${n_no:-1}" != "0" ]; then
    fail=1
    echo "$out" | grep -B1 "❌" | sed 's/^/      /'
  fi
done
echo ""
node tests/lint-imports.mjs || fail=$((fail+1))
node tests/lint-precache.mjs || fail=$((fail+1))
node tests/lint-version.mjs || fail=$((fail+1))
node tests/lint-methods.mjs || fail=$((fail+1))
node tests/lint-testversion.mjs || fail=$((fail+1))
if [ $fail -eq 0 ]; then echo "✅ 全部通过"; else echo "❌ 有失败"; fi
exit $fail
