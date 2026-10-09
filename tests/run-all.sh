#!/bin/bash
# 逻辑测试全跑。任一失败即退出。
cd "$(dirname "$0")/.." || exit 1
fail=0
for t in t80 t81 t82 t83 t84 t85 t86 t87 t88 t89 t90 t91 t92 t93; do
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
# 完整 lint 套件:19 项,单一真源在 package.json 的 npm run lint。
# 原先这里手工列了 9 项,与 npm run lint 的 19 项不一致 —— 漏掉的 10 项
# (含 lint-arts / lint-contrast / lint-scope / lint-portraits 等)从来没被 run-all 检查过,
# 于是「run-all 全绿」并不代表基线完整(见 TICKETS XX-AUDIT-001)。
npm run lint || fail=$((fail+1))
# 死导出检测(XX-AUDIT-007):report-only,退出码恒为 0,不参与 fail 计数。
# 它是「提醒清单」不是门禁 —— 候选里混着真死代码与动态访问,机器分不开,
# 人工确认过的写进 deadexport-baseline.txt。挂在 run-all 里是为了
# 「每次跑基线都能看见有没有新增死导出」,而不是为了拦路。
node tests/lint-deadexport.mjs || true
if [ $fail -eq 0 ]; then echo "✅ 全部通过"; else echo "❌ 有失败"; fi
exit $fail
